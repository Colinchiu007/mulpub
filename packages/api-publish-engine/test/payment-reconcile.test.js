/**
 * 支付对账的判据。
 *
 * 除常规行为外，这里有一条**结构性硬锁**：对账脚本只能 SELECT。
 * 理由：对账工具一旦能写库，就会有人用它"顺手修一下"，而自动修复资金不一致是最危险的动作。
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const R = require('../scripts/payment-reconcile');

/** 按 sql 里的特征词返回对应的假结果。 */
function makeClient (rowsById = {}) {
  const calls = [];
  return {
    calls,
    async query (sql, params) {
      calls.push({ sql, params });
      for (const [needle, rows] of Object.entries(rowsById)) {
        if (sql.includes(needle)) return { rows };
      }
      return { rows: [] };
    },
  };
}

test('payment-reconcile：只读硬锁', async (t) => {
  await t.test('所有判据都必须是 SELECT —— 禁止任何写语句', () => {
    assert.ok(R.CHECKS.length >= 5, '判据数量不能悄悄变少');
    for (const check of R.CHECKS) {
      const sql = String(check.sql).trim().toUpperCase();
      assert.ok(sql.startsWith('SELECT'), `${check.id} 必须以 SELECT 开头`);
      for (const verb of ['INSERT ', 'UPDATE ', 'DELETE ', 'ALTER ', 'DROP ', 'TRUNCATE ', 'CREATE ']) {
        assert.equal(sql.includes(verb), false, `${check.id} 不得含 ${verb.trim()}`);
      }
    }
  });

  await t.test('运行时真的只发出 SELECT', async () => {
    const client = makeClient();
    await R.runReconcile({ client });
    assert.equal(client.calls.length, R.CHECKS.length);
    for (const call of client.calls) {
      assert.ok(String(call.sql).trim().toUpperCase().startsWith('SELECT'));
    }
  });

  await t.test('每条判据只绑两个参数：起始时间 + LIMIT', async () => {
    const client = makeClient();
    await R.runReconcile({ client, limit: 7 });
    for (const call of client.calls) {
      assert.equal(call.params.length, 2);
      assert.ok(call.params[0] instanceof Date, '参数1 必须是 Date（不会把字符串拼进 SQL）');
      assert.equal(call.params[1], 7);
    }
  });
});

test('payment-reconcile：结论口径', async (t) => {
  await t.test('全空 ⇒ ok=true、blocking=0', async () => {
    const report = await R.runReconcile({ client: makeClient() });
    assert.equal(report.ok, true);
    assert.equal(report.blocking, 0);
    assert.equal(report.results.length, R.CHECKS.length);
  });

  await t.test('只有 INFO 命中 ⇒ ok 仍为 true（历史单没有事件行属正常）', async () => {
    const report = await R.runReconcile({
      client: makeClient({ 'SELECT o.id, o.paid_at': [{ id: 'o1', paid_at: 'x' }] }),
    });
    const info = report.results.find((r) => r.id === 'paid-order-without-event');
    assert.equal(info.count, 1);
    assert.equal(report.ok, true, 'INFO 不该让对账失败');
  });

  await t.test('BLOCKING 命中 ⇒ ok=false，且 blocking 计数正确', async () => {
    const report = await R.runReconcile({
      client: makeClient({ 'SELECT o.id, o.user_id': [{ id: 'o1', user_id: 'u1' }] }),
    });
    const hit = report.results.find((r) => r.id === 'paid-without-entitlement');
    assert.equal(hit.count, 1);
    assert.equal(report.ok, false);
    assert.equal(report.blocking, 1);
  });

  await t.test('每条结果都带可操作的 hint（不是只报数字）', async () => {
    const report = await R.runReconcile({ client: makeClient() });
    for (const r of report.results) {
      assert.ok(r.hint && r.hint.length > 20, `${r.id} 缺少可操作提示`);
    }
  });

  await t.test('sample 最多 5 条，但 count 是真实条数', async () => {
    const many = Array.from({ length: 9 }, (_, i) => ({ id: 'o' + i }));
    const report = await R.runReconcile({ client: makeClient({ 'SELECT o.id, o.user_id': many }) });
    const hit = report.results.find((r) => r.id === 'paid-without-entitlement');
    assert.equal(hit.count, 9);
    assert.equal(hit.sample.length, 5);
  });
});

test('payment-reconcile：CLI 与输出', async (t) => {
  await t.test('formatText：0 条打 ✓，阻塞打 ✗，INFO 打 !', async () => {
    const clean = await R.runReconcile({ client: makeClient() });
    assert.match(R.formatText(clean), /✅/);
    const dirty = await R.runReconcile({ client: makeClient({ 'SELECT o.id, o.user_id': [{ id: 'o1' }] }) });
    assert.match(R.formatText(dirty), /❌/);
    const infoOnly = await R.runReconcile({ client: makeClient({ 'SELECT o.id, o.paid_at': [{ id: 'o1' }] }) });
    assert.match(R.formatText(infoOnly), /\[!\]/);
  });

  await t.test('--help rc=0；未知参数 rc=2；--since-days 非正数 rc=2', async () => {
    assert.equal(await R.main(['--help']), 0);
    assert.equal(await R.main(['--nope']), 2);
    assert.equal(await R.main(['--since-days', '0']), 2);
    assert.equal(await R.main(['--limit', 'abc']), 2);
  });

  await t.test('没有数据库地址 ⇒ rc=2（不静默当成"对账通过"）', async () => {
    assert.equal(await R.main([], { env: {} }), 2);
  });

  await t.test('有阻塞差异 ⇒ rc=1；干净 ⇒ rc=0', async () => {
    const mk = (rows) => ({
      createClient: () => ({ query: async (sql) => (sql.includes('SELECT o.id, o.user_id') ? { rows } : { rows: [] }), end: async () => {} }),
    });
    assert.equal(await R.main(['--json'], { env: { BUSINESS_DATABASE_URL: 'postgres://x' }, ...mk([{ id: 'o1' }]) }), 1);
    assert.equal(await R.main(['--json'], { env: { BUSINESS_DATABASE_URL: 'postgres://x' }, ...mk([]) }), 0);
  });

  await t.test('client 一定会被 end（不泄漏连接）', async () => {
    let ended = false;
    const code = await R.main(['--json'], {
      env: { BUSINESS_DATABASE_URL: 'postgres://x' },
      createClient: () => ({ query: async () => ({ rows: [] }), end: async () => { ended = true; } }),
    });
    assert.equal(code, 0);
    assert.equal(ended, true);
  });
});
