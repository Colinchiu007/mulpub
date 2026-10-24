/**
 * 组装根测试：`createWeChatNativeProvider(env)` 与 `buildAuthorizationHeader`。
 *
 * 为什么这组测试必须存在（2026-10-22）：
 * 在它之前，`WeChatNativeProvider` **只在定义文件和测试里出现过**，生产代码从未 `new` 过它。
 * 111 条支付测试全绿，因为它们**注入** provider —— 被注入的东西永远不需要有人去构造它。
 * 这组测试覆盖的是"有人真的去构造它"这条路径。
 *
 * 签名部分用**真密钥对验签**（生成 RSA 2048 → 签名 → 用公钥 verify），
 * 不是断言字符串前缀。只断言形状的话，签名算法写错（比如把 `RSA-SHA256` 写成 `SHA256`、
 * 或签名原文少一个换行）依然会绿，而线上表现为微信返回 `SIGN_ERROR`、所有下单失败。
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const F = require('../src/auth/payment-providers/wechat-native-factory');
const { WeChatNativeProvider } = require('../src/auth/payment-providers/wechat-native');

/** 生成一对真实的 RSA 密钥（PEM），用于签名/验签往返。 */
function makeKeyPair () {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  return { publicKey, privateKey };
}

/** 从 `Authorization` 头里取字段（微信格式：`SCHEMA k="v",k="v"…`）。 */
function parseAuthHeader (header) {
  const [schema, rest] = String(header).split(' ');
  const fields = {};
  for (const part of rest.split(',')) {
    const m = /^([a-z_]+)="(.*)"$/.exec(part.trim());
    if (m) fields[m[1]] = m[2];
  }
  return { schema, fields };
}

const FULL_ENV = () => {
  const { publicKey, privateKey } = makeKeyPair();
  return {
    env: {
      PAYMENT_PROVIDER: 'wechat_native',
      WECHAT_PAY_APPID: 'wx_test_appid',
      WECHAT_PAY_MCH_ID: '1900000000',
      WECHAT_PAY_API_V3_KEY: 'a'.repeat(32),
      WECHAT_PAY_CERT_SERIAL_NO: 'SERIAL123',
      WECHAT_PAY_NOTIFY_URL: 'https://example.test/api/v1/webhooks/payment',
      WECHAT_PAY_CERT_CONTENT: privateKey,
      WECHAT_PAY_PLATFORM_PUBLIC_KEY: publicKey,
      WECHAT_PAY_PUBLIC_KEY_ID: 'PUB_KEY_ID_TEST',
    },
    publicKey,
    privateKey,
  };
};

test('createWeChatNativeProvider：环境变量 → provider', async (t) => {
  await t.test('PAYMENT_PROVIDER 非 wechat_native → null（可选能力，不抛错）', () => {
    assert.equal(F.createWeChatNativeProvider({}), null, '未设置必须按 none 处理');
    assert.equal(F.createWeChatNativeProvider({ PAYMENT_PROVIDER: 'none' }), null);
    //  WeChat_Native  归一化后**就是** wechat_native ⇒ 会进入构造并因缺字段而抛，
    // 不应被当成「未启用」而静默返回 null（那会让一个拼错大小写的生产配置变成「支付悄悄不生效」）。
    assert.throws(() => F.createWeChatNativeProvider({ PAYMENT_PROVIDER: ' WeChat_Native ' }), (e) => e.code === 'PAYMENT_CONFIG_INVALID');
  });

  await t.test('大小写与空格归一化后能启用', () => {
    const { env } = FULL_ENV();
    env.PAYMENT_PROVIDER = '  WeChat_Native  ';
    assert.ok(F.createWeChatNativeProvider(env) instanceof WeChatNativeProvider);
  });

  await t.test('缺字段 → PAYMENT_CONFIG_INVALID，且逐个点名', () => {
    const { env } = FULL_ENV();
    delete env.WECHAT_PAY_MCH_ID;
    delete env.WECHAT_PAY_APPID;
    assert.throws(() => F.createWeChatNativeProvider(env), (e) => {
      assert.equal(e.code, 'PAYMENT_CONFIG_INVALID');
      assert.match(e.message, /WECHAT_PAY_APPID/);
      assert.match(e.message, /WECHAT_PAY_MCH_ID/);
      return true;
    });
  });

  await t.test('apiV3Key 不是 32 字符 → PAYMENT_API_V3_KEY_INVALID', () => {
    const { env } = FULL_ENV();
    env.WECHAT_PAY_API_V3_KEY = 'too-short';
    assert.throws(() => F.createWeChatNativeProvider(env), (e) => e.code === 'PAYMENT_API_V3_KEY_INVALID');
  });

  await t.test('私钥文件读不出来 → PAYMENT_CERT_UNREADABLE（不静默返回空串）', () => {
    const { env } = FULL_ENV();
    delete env.WECHAT_PAY_CERT_CONTENT;
    env.WECHAT_PAY_CERT_PATH = '/no/such/key.pem';
    assert.throws(() => F.createWeChatNativeProvider(env), (e) => e.code === 'PAYMENT_CERT_UNREADABLE');
  });

  await t.test('平台公钥缺失 → 抛错（不能只接下单不接验签）', () => {
    const { env } = FULL_ENV();
    delete env.WECHAT_PAY_PLATFORM_PUBLIC_KEY;
    assert.throws(() => F.createWeChatNativeProvider(env), (e) => e.code === 'PAYMENT_CONFIG_INVALID' && /WECHAT_PAY_PLATFORM_PUBLIC_KEY/.test(e.message));
  });

  await t.test('完整配置 → 真的拿到 provider，且 capabilities 全 false', () => {
    const { env } = FULL_ENV();
    const p = F.createWeChatNativeProvider(env);
    assert.ok(p instanceof WeChatNativeProvider);
    const caps = p.capabilities();
    assert.equal(Object.values(caps).every((v) => v === false), true, '微信 Native 的能力边界必须诚实全 false');
  });
});

test('buildAuthorizationHeader：格式 + 真验签', async (t) => {
  await t.test('形如 WECHATPAY2-SHA256-RSA2048，五个字段齐全', () => {
    const { privateKey } = makeKeyPair();
    const header = F.buildAuthorizationHeader({
      mchId: '1900000000',
      serialNo: 'SERIAL123',
      privateKey,
      method: 'POST',
      path: '/v3/pay/transactions/native',
      body: { a: 1 },
      nonceStr: 'deadbeef',
      timestamp: '1700000000',
    });
    const { schema, fields } = parseAuthHeader(header);
    assert.equal(schema, 'WECHATPAY2-SHA256-RSA2048');
    assert.deepEqual(Object.keys(fields).sort(), ['mchid', 'nonce_str', 'serial_no', 'signature', 'timestamp']);
    assert.equal(fields.mchid, '1900000000');
    assert.equal(fields.serial_no, 'SERIAL123');
    assert.equal(fields.nonce_str, 'deadbeef');
    assert.equal(fields.timestamp, '1700000000');
  });

  await t.test('签名可用对应公钥验过，且原文是「五行、末尾换行」', () => {
    const { publicKey, privateKey } = makeKeyPair();
    const body = { appid: 'wx1', amount: { total: 5900 } };
    const header = F.buildAuthorizationHeader({
      mchId: '1900000000',
      serialNo: 'SERIAL123',
      privateKey,
      method: 'POST',
      path: '/v3/pay/transactions/native',
      body,
      nonceStr: 'n0nce',
      timestamp: '1700000000',
    });
    const { fields } = parseAuthHeader(header);

    // 微信文档的签名原文：方法\n路径\n时间戳\n随机串\n报文主体\n
    const expectedMessage = `POST\n/v3/pay/transactions/native\n1700000000\nn0nce\n${JSON.stringify(body)}\n`;
    const ok = crypto.createVerify('RSA-SHA256')
      .update(expectedMessage, 'utf8')
      .verify(publicKey, fields.signature, 'base64');
    assert.equal(ok, true, '签名必须能被公钥验过 —— 否则线上是 SIGN_ERROR');
  });

  await t.test('报文主体与「实际发出的 JSON.stringify」逐字节一致', () => {
    const { privateKey } = makeKeyPair();
    const body = { z: 1, a: 2 }; // 刻意乱序，确认不重排
    const header = F.buildAuthorizationHeader({
      mchId: 'm', serialNo: 's', privateKey, method: 'POST', path: '/p', body,
      nonceStr: 'n', timestamp: '1',
    });
    const { fields } = parseAuthHeader(header);
    const withReordered = `POST\n/p\n1\nn\n${JSON.stringify({ a: 2, z: 1 })}\n`;
    assert.equal(
      crypto.createVerify('RSA-SHA256').update(withReordered, 'utf8').verify(
        crypto.createPublicKey(privateKey), fields.signature, 'base64',
      ),
      false,
      '签名必须绑定真实字节序：若这里能验过，说明实现重排了 key，与实际发出的 body 不一致',
    );
  });
});

test('certificateProvider：只认配置的公钥 ID（换钥必须吵出来）', async (t) => {
  await t.test('serial 与 WECHAT_PAY_PUBLIC_KEY_ID 不一致 → null（fail-closed）', async () => {
    const { env, publicKey } = FULL_ENV();
    const p = F.createWeChatNativeProvider(env);
    assert.equal(await p.certificateProvider.getBySerial('PUB_KEY_ID_TEST'), publicKey.trim());
    assert.equal(await p.certificateProvider.getBySerial('PUB_KEY_ID_OTHER'), null,
      '换了公钥但没更新配置时必须失败，不能拿旧公钥默默验过');
  });

  await t.test('未配 PUBLIC_KEY_ID 时不按 serial 过滤（兼容只配一把公钥的部署）', async () => {
    const { env } = FULL_ENV();
    delete env.WECHAT_PAY_PUBLIC_KEY_ID;
    const p = F.createWeChatNativeProvider(env);
    assert.ok(await p.certificateProvider.getBySerial('任意serial'));
  });
});

test('signRequest：注入的时钟与随机串真的被用上', async (t) => {
  await t.test('Authorization 里的 timestamp / nonce_str 来自注入', () => {
    const { env } = FULL_ENV();
    const p = F.createWeChatNativeProvider(env, {
      now: () => new Date('2026-10-22T00:00:00Z'),
      nonce: () => 'FIXED_NONCE',
      fetcher: async () => ({ ok: true, json: async () => ({ code_url: 'weixin://x' }) }),
    });
    const headers = p.signRequest('POST', '/v3/pay/transactions/native', { a: 1 });
    const { fields } = parseAuthHeader(headers.Authorization);
    assert.equal(fields.nonce_str, 'FIXED_NONCE');
    assert.equal(fields.timestamp, String(Math.floor(Date.parse('2026-10-22T00:00:00Z') / 1000)));
  });
});

// ——— 组装根：这条才是当初能抓住 bug 的那条 ———
//
// 前面所有工厂单测都只证明「函数是对的」，证明不了「有人调用它」。
// 2026-10-22 的缺口正是后者：`createWeChatNativeProvider` 不存在，`SubscriptionService` 拿到的是
// `options.paymentProvider || null` ⇒ null。所以这条测试**不走注入**，而是走 `createLogtoRuntime`
// 的真实组装路径，断言 provider 真的被接上了。
test('组装根：createLogtoRuntime 会把 provider 交给 SubscriptionService', async (t) => {
  const { createLogtoRuntime } = require('../src/auth/logto-runtime');

  /** 最小仓储桩：runtime 只要求 initialize/assertReady 可用。 */
  const stubRepository = () => ({
    initialize: async () => {},
    assertReady: async () => {},
    pool: { query: async () => ({ rows: [] }) },
  });

  const baseEnv = () => ({
    IDENTITY_AUTH_ENABLED: 'true',
    IDENTITY_AUTH_REQUIRED: 'false',
    NODE_ENV: 'test',
    LOGTO_ENDPOINT: 'https://logto.example.test',
    LOGTO_API_RESOURCE: 'https://api.example.test',
  });

  await t.test('PAYMENT_PROVIDER=wechat_native ⇒ subscriptionService.paymentProvider 非 null', async () => {
    const { env } = FULL_ENV();
    const rt = await createLogtoRuntime({ env: { ...baseEnv(), ...env }, repository: stubRepository() });
    assert.ok(rt.subscriptionService, 'runtime 必须暴露 subscriptionService');
    assert.ok(
      rt.subscriptionService.paymentProvider instanceof WeChatNativeProvider,
      'provider 没被接上 ⇒ /me/checkout 恒 503 ⇒ 前端永远「支付通道暂未开放」',
    );
  });

  await t.test('未配置支付 ⇒ paymentProvider 为 null（入口 fail-closed，且不因缺变量启动失败）', async () => {
    const rt = await createLogtoRuntime({ env: baseEnv(), repository: stubRepository() });
    assert.equal(rt.subscriptionService.paymentProvider, null);
  });

  await t.test('显式注入 null 仍然生效（测试可控性不被默认值抢走）', async () => {
    const { env } = FULL_ENV();
    const rt = await createLogtoRuntime({
      env: { ...baseEnv(), ...env },
      repository: stubRepository(),
      paymentProvider: null,
    });
    assert.equal(rt.subscriptionService.paymentProvider, null);
  });
});
test('加载期校验凭据：垃圾内容必须在启动时炸，而不是等用户点购买', async (t) => {
  await t.test('商户私钥不是合法 PEM → PAYMENT_CERT_INVALID（构造期）', () => {
    const { env } = FULL_ENV();
    env.WECHAT_PAY_CERT_CONTENT = 'not a pem at all';
    assert.throws(() => F.createWeChatNativeProvider(env), (e) => e.code === 'PAYMENT_CERT_INVALID');
  });

  await t.test('平台公钥不可解析 → PAYMENT_CERT_INVALID（构造期）', () => {
    const { env } = FULL_ENV();
    env.WECHAT_PAY_PLATFORM_PUBLIC_KEY = 'garbage-garbage';
    assert.throws(() => F.createWeChatNativeProvider(env), (e) => e.code === 'PAYMENT_CERT_INVALID');
  });

  await t.test('裸 Base64 公钥（无 PEM 头）也能通过校验', () => {
    const { env, publicKey } = FULL_ENV();
    const bare = publicKey.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
    env.WECHAT_PAY_PLATFORM_PUBLIC_KEY = bare;
    assert.ok(F.createWeChatNativeProvider(env) instanceof WeChatNativeProvider, '微信支付公钥是裸 Base64 SPKI，必须支持');
  });
});