/**
 * 用**本地 mock 微信服务器**预演一次真实下单（E2E-1 的服务端半程）。
 *
 * ## 为什么需要它
 *
 * 之前的支付测试全都**注入 fetcher**：它们证明"provider 拿到某个响应后怎么处理"，
 * 但证明不了"provider 发出去的请求，微信会不会认"。
 * 而线上第一种失败恰恰是那个：`SIGN_ERROR` —— 签名原文/报文/时间戳任一处不对，全部下单失败。
 *
 * 这里的 mock 服务器**真的用商户公钥验签**（和微信做的是同一件事）：
 *   - 用真 RSA 密钥对签名 → mock 用公钥 verify
 *   - 验签失败返回 `{code:'SIGN_ERROR'}`，与微信的错误体同形
 *   - 因此：**签名算错这个测试就红**，不是断言字符串前缀那种假绿
 *
 * 它跑在 `127.0.0.1` 的临时端口上，不出网、不需要真凭据。
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const crypto = require('node:crypto');

const { WeChatNativeProvider, WECHAT_API_BASE } = require('../src/auth/payment-providers/wechat-native');
const { buildAuthorizationHeader } = require('../src/auth/payment-providers/wechat-native-factory');

const NATIVE_PATH = '/v3/pay/transactions/native';
const MCH_ID = '1900000000';
const SERIAL = 'SERIAL_MOCK_0001';
const APPID = 'wx_mock_appid';
const NOTIFY = 'https://example.test/api/v1/webhooks/payment';

function makeKeyPair () {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  return { publicKey, privateKey };
}

function parseAuth (header) {
  const [schema, rest = ''] = String(header || '').split(' ');
  const fields = {};
  for (const part of rest.split(',')) {
    const m = /^([a-z_]+)="(.*)"$/.exec(part.trim());
    if (m) fields[m[1]] = m[2];
  }
  return { schema, fields };
}

/**
 * 启动 mock 微信。`verifyPublicKey` 是**用来验签的公钥** ——
 * 故意与商户私钥不成对时，就能验证"mock 真的在验签"。
 */
async function startMockWeChat ({ verifyPublicKey }) {
  const seen = { requests: [], errors: [] };
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const fail = (status, code, message) => {
        if (res.headersSent) return;
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ code, message }));
      };
      try {
        const rawBody = Buffer.concat(chunks).toString('utf8');
        const { schema, fields } = parseAuth(req.headers.authorization);
        seen.requests.push({ method: req.method, url: req.url, rawBody, schema, fields });

        if (req.method !== 'POST' || req.url !== NATIVE_PATH) return fail(404, 'NOT_FOUND', '路径不对');
        if (schema !== 'WECHATPAY2-SHA256-RSA2048') return fail(401, 'SIGN_ERROR', '签名类型不对');
        if (fields.mchid !== MCH_ID) return fail(401, 'SIGN_ERROR', 'mchid 不匹配');
        if (fields.serial_no !== SERIAL) return fail(401, 'SIGN_ERROR', 'serial_no 不匹配');
        // 缺签名时先拦住：crypto.verify 收到 undefined 会抛 OpenSSL 错，
        // 在请求回调里抛出去就是"服务器崩了、客户端一直等"——失败会被伪装成超时。
        if (!fields.signature) return fail(401, 'SIGN_ERROR', '缺少签名');

        // 时间戳必须是**秒**且在 ±300s 内（毫秒会被这里挡下）
        const ts = Number(fields.timestamp);
        if (!(Number.isInteger(ts) && String(ts).length === 10)) {
          return fail(401, 'SIGN_ERROR', `timestamp 不是 10 位秒级：${fields.timestamp}`);
        }
        if (Math.abs(Date.now() / 1000 - ts) >= 300) return fail(401, 'SIGN_ERROR', 'timestamp 偏离过大');

        // 微信文档的签名原文：方法\n路径\n时间戳\n随机串\n报文主体\n
        const message = `POST\n${NATIVE_PATH}\n${fields.timestamp}\n${fields.nonce_str}\n${rawBody}\n`;
        let ok = false;
        try {
          ok = crypto.createVerify('RSA-SHA256')
            .update(message, 'utf8')
            .verify(verifyPublicKey, fields.signature, 'base64');
        } catch (error) {
          seen.errors.push(error);
          return fail(401, 'SIGN_ERROR', '验签过程异常：' + error.message);
        }
        if (!ok) return fail(401, 'SIGN_ERROR', '签名错误');

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ code_url: 'weixin://wxpay/bizpayurl?pr=MOCK123' }));
      } catch (error) {
        // 任何断言/异常都必须变成**响应**，而不是让连接悬着。
        seen.errors.push(error);
        fail(500, 'MOCK_HANDLER_ERROR', (error && error.message) || String(error));
      }
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return {
    seen,
    base: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve) => {
      // keep-alive 会让 server.close() 一直等，CI 上表现为随机超时。
      if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
      server.close(resolve);
    }),
  };
}

/**
 * 用**生产签名器**（uildAuthorizationHeader，与工厂同一份实现）构造 provider。
 * 如果这里改用测试自带的签名实现，这条测试就只是在验证自己 —— 没有意义。
 */
function makeProvider ({ privateKey, base }) {
  return new WeChatNativeProvider({
    appid: APPID,
    mchId: MCH_ID,
    apiV3Key: 'a'.repeat(32),
    notifyUrl: NOTIFY,
    apiBase: base,
    fetcher: (url, init) => fetch(url, init),
    signRequest: (method, path, body) => ({
      Authorization: buildAuthorizationHeader({
        mchId: MCH_ID,
        serialNo: SERIAL,
        privateKey,
        method,
        path,
        body,
        nonceStr: crypto.randomBytes(16).toString('hex'),
        timestamp: String(Math.floor(Date.now() / 1000)),
      }),
    }),
  });
}

test('mock 微信下单：真实验签往返', async (t) => {
  await t.test('签名正确 ⇒ 拿到 code_url，且请求体符合微信契约', async () => {
    const { publicKey, privateKey } = makeKeyPair();
    const mock = await startMockWeChat({ verifyPublicKey: publicKey });
    try {
      const provider = makeProvider({ privateKey, base: mock.base });
      const result = await provider.createCheckout({
        orderId: 'wpabcdefgh1234',
        plan: 'standard',
        period: 'month',
        amountCents: 5900,
        attach: { userId: 'u1' },
      });

      assert.equal(result.codeUrl, 'weixin://wxpay/bizpayurl?pr=MOCK123');
      assert.equal(mock.seen.requests.length, 1);

      const body = JSON.parse(mock.seen.requests[0].rawBody);
      assert.equal(body.appid, APPID);
      assert.equal(body.mchid, MCH_ID);
      assert.equal(body.out_trade_no, 'wpabcdefgh1234');
      assert.equal(body.notify_url, NOTIFY, '回调地址必须与配置逐字一致');
      assert.deepEqual(body.amount, { total: 5900, currency: 'CNY' });
      assert.equal(JSON.parse(body.attach).userId, 'u1');
      assert.equal(mock.seen.requests[0].fields.serial_no, SERIAL);
    } finally {
      await mock.close();
    }
  });

  await t.test('签名不匹配 ⇒ mock 返回 SIGN_ERROR，provider 抛 PAYMENT_PROVIDER_UPSTREAM_REJECTED', async () => {
    // 故意用**另一对**公钥验签：签名必然验不过。
    // 这条同时证明前一条不是假绿 —— mock 真的在验签。
    const { privateKey } = makeKeyPair();
    const { publicKey: otherPublicKey } = makeKeyPair();
    const mock = await startMockWeChat({ verifyPublicKey: otherPublicKey });
    try {
      const provider = makeProvider({ privateKey, base: mock.base });
      await assert.rejects(
        () => provider.createCheckout({ orderId: 'wpabcdefgh1234', plan: 'standard', period: 'month', amountCents: 5900 }),
        (error) => {
          assert.equal(error.code, 'PAYMENT_PROVIDER_UPSTREAM_REJECTED');
          assert.match(error.message, /SIGN_ERROR/);
          return true;
        },
      );
    } finally {
      await mock.close();
    }
  });

  await t.test('不传 apiBase ⇒ 默认走生产域名（不会被悄悄改成 http）', () => {
    const provider = new WeChatNativeProvider({
      appid: APPID, mchId: MCH_ID, apiV3Key: 'a'.repeat(32), notifyUrl: NOTIFY,
      fetcher: async () => ({ ok: true, json: async () => ({}) }),
    });
    assert.equal(provider.apiBase, WECHAT_API_BASE);
    assert.match(provider.apiBase, /^https:\/\//, '默认必须是 https');
  });

  await t.test('apiBase 末尾斜杠会被去掉（避免 //v3 双斜杠导致签名路径不一致）', () => {
    const provider = new WeChatNativeProvider({
      appid: APPID, mchId: MCH_ID, apiV3Key: 'a'.repeat(32), notifyUrl: NOTIFY,
      apiBase: 'http://127.0.0.1:1234///',
      fetcher: async () => ({ ok: true, json: async () => ({}) }),
    });
    assert.equal(provider.apiBase, 'http://127.0.0.1:1234');
  });
});

test('评审补充的边界', async (t) => {
  const baseOptions = () => ({
    appid: APPID, mchId: MCH_ID, apiV3Key: 'a'.repeat(32), notifyUrl: NOTIFY,
    fetcher: async () => ({ ok: true, json: async () => ({}) }),
  });

  await t.test('apiBase 拒绝非回环的 http（防止签名与报文落到明文链路）', () => {
    assert.throws(
      () => new WeChatNativeProvider({ ...baseOptions(), apiBase: 'http://evil.example' }),
      /apiBase 必须是 https/,
    );
  });

  await t.test('apiBase 允许 https 与 http 回环（测试用）', () => {
    assert.ok(new WeChatNativeProvider({ ...baseOptions(), apiBase: 'https://api.mch.weixin.qq.com' }));
    assert.ok(new WeChatNativeProvider({ ...baseOptions(), apiBase: 'http://127.0.0.1:8080' }));
    assert.ok(new WeChatNativeProvider({ ...baseOptions(), apiBase: 'http://localhost:9000' }));
  });

  await t.test('200 里带**truthy 非字符串** code 不当成错误体（42）（`code` 字段可能是业务数据）', async () => {
    const provider = new WeChatNativeProvider({
      ...baseOptions(),
      fetcher: async () => ({ ok: true, status: 200, json: async () => ({ code: 42, code_url: 'weixin://ok' }) }),
    });
    const result = await provider.createCheckout({ orderId: 'wpabcdefgh1234', plan: 'standard', period: 'month', amountCents: 100 });
    assert.equal(result.codeUrl, 'weixin://ok');
  });

  await t.test('200 里带**字符串** code 仍按错误体处理（微信的错误体同形）', async () => {
    const provider = new WeChatNativeProvider({
      ...baseOptions(),
      fetcher: async () => ({ ok: true, status: 200, json: async () => ({ code: 'PARAM_ERROR', message: 'mchid 不匹配' }) }),
    });
    await assert.rejects(
      () => provider.createCheckout({ orderId: 'wpabcdefgh1234', plan: 'standard', period: 'month', amountCents: 100 }),
      (e) => e.code === 'PAYMENT_PROVIDER_UPSTREAM_REJECTED' && /PARAM_ERROR/.test(e.message),
    );
  });

  await t.test('非 2xx 且无 code ⇒ 错误信息带 HTTP 状态码（否则与"网络断了"无法区分）', async () => {
    const provider = new WeChatNativeProvider({
      ...baseOptions(),
      fetcher: async () => ({ ok: false, status: 502, json: async () => ({ message: 'bad gateway' }) }),
    });
    await assert.rejects(
      () => provider.createCheckout({ orderId: 'wpabcdefgh1234', plan: 'standard', period: 'month', amountCents: 100 }),
      (e) => e.code === 'PAYMENT_PROVIDER_UPSTREAM_FAILED' && /HTTP 502/.test(e.message),
    );
  });
});