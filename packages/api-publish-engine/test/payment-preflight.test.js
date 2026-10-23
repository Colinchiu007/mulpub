/**
 * 支付上线预检的判据。
 *
 * 这条命令存在的理由（2026-10-22/23 实测）：支付有**两类"配了却不能用"的缺口，且都不报错**——
 *   ① compose 不透传 ⇒ 容器读到的 env 是空 ⇒ 按 none 处理；
 *   ② provider 从未被构造 ⇒ 恒 null ⇒ 恒 503。
 * 两者的现象都是「前端功能不存在」，而 `validate-production-config` 只查变量存在性，
 * 不验凭据能否解析、装配能否成功、迁移有没有应用。这里逐项锁住。
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const P = require('../scripts/payment-preflight');

function makeKeyPair () {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  return { publicKey, privateKey };
}

function goodEnv () {
  const { publicKey, privateKey } = makeKeyPair();
  return {
    PAYMENT_PROVIDER: 'wechat_native',
    WECHAT_PAY_APPID: 'wx_test',
    WECHAT_PAY_MCH_ID: '1900000000',
    WECHAT_PAY_API_V3_KEY: 'a'.repeat(32),
    WECHAT_PAY_CERT_SERIAL_NO: 'SERIAL1',
    WECHAT_PAY_NOTIFY_URL: 'https://example.test/api/v1/webhooks/payment',
    WECHAT_PAY_CERT_CONTENT: privateKey,
    WECHAT_PAY_PLATFORM_PUBLIC_KEY: publicKey,
  };
}

const byId = (result, id) => result.checks.find((c) => c.id === id);

test('payment-preflight：逐项判据', async (t) => {
  await t.test('PAYMENT_PROVIDER=none ⇒ 只 SKIP，rc 视为通过（可选能力，不该报错）', async () => {
    const r = await P.runPreflight({ env: {}, skipDb: true });
    assert.equal(r.ok, true);
    assert.equal(byId(r, 'provider-kind').status, P.SKIP);
  });

  await t.test('非法 provider 值 ⇒ FAIL', async () => {
    const r = await P.runPreflight({ env: { PAYMENT_PROVIDER: 'alipay' }, skipDb: true });
    assert.equal(r.ok, false);
    assert.equal(byId(r, 'provider-kind').status, P.FAIL);
  });

  await t.test('环境变量缺失 ⇒ env FAIL，且逐条点名变量', async () => {
    const r = await P.runPreflight({ env: { PAYMENT_PROVIDER: 'wechat_native' }, skipDb: true });
    assert.equal(r.ok, false);
    const env = byId(r, 'env');
    assert.equal(env.status, P.FAIL);
    assert.match(env.detail, /WECHAT_PAY_NOTIFY_URL|WECHAT_PAY_APPID/);
  });

  await t.test('凭据可解析 + provider 可构造 ⇒ 两条都 PASS（对应缺口②）', async () => {
    const r = await P.runPreflight({ env: goodEnv(), skipDb: true });
    assert.equal(byId(r, 'env').status, P.PASS);
    assert.equal(byId(r, 'credentials').status, P.PASS);
    assert.equal(byId(r, 'provider').status, P.PASS);
    assert.equal(r.ok, true);
  });

  await t.test('凭据是垃圾 ⇒ credentials FAIL 且 provider 记 SKIP（不假装验过）', async () => {
    const env = goodEnv();
    env.WECHAT_PAY_CERT_CONTENT = 'not-a-pem';
    const r = await P.runPreflight({ env, skipDb: true });
    assert.equal(r.ok, false);
    assert.equal(byId(r, 'credentials').status, P.FAIL);
    assert.equal(byId(r, 'provider').status, P.SKIP);
  });

  await t.test('--skip-db ⇒ database SKIP（并提示上线前必须查一次）', async () => {
    const r = await P.runPreflight({ env: goodEnv(), skipDb: true });
    const db = byId(r, 'database');
    assert.equal(db.status, P.SKIP);
    assert.match(db.detail, /上线前必须查/);
  });

  await t.test('迁移已应用 ⇒ database PASS', async () => {
    const r = await P.runPreflight({
      env: goodEnv(),
      databaseUrl: 'postgres://x',
      deps: { createRepository: () => ({ assertReady: async () => {}, close: async () => {} }) },
    });
    assert.equal(byId(r, 'database').status, P.PASS);
  });

  await t.test('迁移未应用 ⇒ database FAIL，并指向 migrate-postgres', async () => {
    const r = await P.runPreflight({
      env: goodEnv(),
      databaseUrl: 'postgres://x',
      deps: {
        createRepository: () => ({
          assertReady: async () => { const e = new Error('missing'); e.code = 'BUSINESS_DATABASE_SCHEMA_NOT_READY'; throw e; },
          close: async () => {},
        }),
      },
    });
    assert.equal(r.ok, false);
    const db = byId(r, 'database');
    assert.equal(db.status, P.FAIL);
    assert.match(db.detail, /BUSINESS_DATABASE_SCHEMA_NOT_READY/);
    assert.match(db.detail, /migrate-postgres/);
  });

  await t.test('repository 一定会被关闭（不泄漏连接）', async () => {
    let closed = false;
    await P.runPreflight({
      env: goodEnv(),
      databaseUrl: 'postgres://x',
      deps: { createRepository: () => ({ assertReady: async () => {}, close: async () => { closed = true; } }) },
    });
    assert.equal(closed, true);
  });
});

test('payment-preflight：CLI 形态', async (t) => {
  await t.test('formatText 有失败项时说 ❌，否则说 ✅', async () => {
    const bad = await P.runPreflight({ env: { PAYMENT_PROVIDER: 'alipay' }, skipDb: true });
    assert.match(P.formatText(bad), /❌/);
    const ok = await P.runPreflight({ env: {}, skipDb: true });
    assert.match(P.formatText(ok), /✅/);
  });

  await t.test('--help 输出用法且 rc=0', async () => {
    assert.equal(await P.main(['--help']), 0);
  });

  await t.test('未知参数 ⇒ rc=2（用法错误，不与"检查失败"混为一谈）', async () => {
    assert.equal(await P.main(['--nope']), 2);
  });

  await t.test('检查失败 ⇒ rc=1', async () => {
    assert.equal(await P.main(['--skip-db'], { env: { PAYMENT_PROVIDER: 'alipay' } }), 1);
  });
});

// ——— 外部评审（2026-10-23）抓到的 5 条，全部成立并已修 ———
test('预检不得谎报：评审五条的回归锁', async (t) => {
  await t.test('close() 同步抛错时，database 结论不得被吞掉（Critical）', async () => {
    const r = await P.runPreflight({
      env: goodEnv(),
      databaseUrl: 'postgres://x',
      deps: {
        createRepository: () => ({
          assertReady: async () => {},
          // 同步抛：旧实现 `repo.close().catch(...)` 会在这里直接炸，异常顶掉刚算出的结论
          close: () => { throw new Error('boom'); },
        }),
      },
    });
    assert.equal(byId(r, 'database').status, P.PASS, '关闭失败不得改写「迁移已就绪」这条结论');
    assert.equal(r.ok, true);
  });

  await t.test('`--database-url --json` 不得把 flag 当连接串（High）', async () => {
    assert.equal(await P.main(['--database-url', '--json'], { env: goodEnv() }), 2);
    assert.equal(await P.main(['--database-url'], { env: goodEnv() }), 2);
  });

  await t.test('无 code 的 crypto 错误也要归到 credentials（Medium）', async () => {
    const r = await P.runPreflight({
      env: goodEnv(),
      skipDb: true,
      deps: {
        // 模拟 Node crypto 原生错误：没有 code，只有 message
        createProvider: () => { throw new Error('error:1E08010C:DECODER routines::unsupported'); },
      },
    });
    assert.equal(byId(r, 'credentials').status, P.FAIL, 'PEM 粘错应指向 credentials，而不是装配');
    assert.equal(byId(r, 'provider').status, P.SKIP);
  });

  await t.test('PAYMENT_PROVIDER=none 也要显式留一条 database SKIP（Low）', async () => {
    const r = await P.runPreflight({ env: {} });
    const db = byId(r, 'database');
    assert.ok(db, '结果里必须有 database 项，否则操作者会以为「查过了」');
    assert.equal(db.status, P.SKIP);
    assert.match(db.detail, /支付未启用/);
  });
});
test('半配置必须红：填了凭据但开关是 none（漏第二个 --env-file 的典型形态）', async (t) => {
  await t.test('有 WECHAT_PAY_* 但 PAYMENT_PROVIDER 未设 ⇒ FAIL，且提示查 --env-file', async () => {
    const r = await P.runPreflight({ env: { WECHAT_PAY_APPID: 'wx1' }, skipDb: true });
    assert.equal(r.ok, false, '不能报"通过"——那正是拆分 env 后最容易踩的坑');
    const kind = r.checks.find((c) => c.id === 'provider-kind');
    assert.equal(kind.status, P.FAIL);
    assert.match(kind.detail, /--env-file/);
    assert.match(kind.detail, /WECHAT_PAY_APPID/);
  });

  await t.test('一个凭据都没有 + none ⇒ 仍是 SKIP/通过（真的没打算启用）', async () => {
    const r = await P.runPreflight({ env: { PAYMENT_PROVIDER: 'none' }, skipDb: true });
    assert.equal(r.ok, true);
    assert.equal(r.checks.find((c) => c.id === 'provider-kind').status, P.SKIP);
  });

  await t.test('只填了 NOTIFY_URL 也算半配置（任何一项有值都算）', async () => {
    const r = await P.runPreflight({ env: { WECHAT_PAY_NOTIFY_URL: 'https://x.test/w' }, skipDb: true });
    assert.equal(r.ok, false);
  });
});