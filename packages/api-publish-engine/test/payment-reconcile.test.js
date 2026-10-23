/**
 * 支付对账的判据。
 *
 * 除常规行为外，这里有两条**结构性硬锁**：
 *   ① 对账脚本只能 SELECT（且不得 `FOR UPDATE` / `INTO`）——
 *      对账工具一旦能写库，就会有人用它"顺手修一下"，而自动修复资金不一致是最危险的动作。
 *   ② 必须先做 schema 预检 —— 连到空库/错库时所有 SELECT 都返回 0 行，
 *      那会被读成"三方一致"。工具失明伪装成好消息，是对账工具最危险的失败形态。
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const R = require('../scripts/payment-reconcile');

const SCHEMA_ROW = {
  identity_orders: 'identity_orders',
  identity_webhook_events: 'identity_webhook_events',
  identity_subscriptions: 'identity_subscriptions',
};

/** 按 sql 里的特征词返回对应的假结果；schema 预检默认通过。 */
function makeClient (rowsByNeedle = {}, schemaRow = SCHEMA_ROW) {
  const calls = [];
  return {
    calls,
    async query (sql, params) {
      calls.push({ sql, params });
      if (sql.includes('to_regclass')) return { rows: schemaRow ? [schemaRow] : [] };
      for (const [needle, rows] of Object.entries(rowsByNeedle)) {
        if (sql.includes(needle)) return { rows };
      }
      return { rows: [] };
    },
  };
}

test('payment-reconcile：只读硬锁', async (t) => {
  await t.test('所有判据都必须是 SELECT —— 禁止任何写语句与加锁', () => {
    assert.ok(R.CHECKS.length >= 5, '判据数量不能悄悄变少');
    for (const check of R.CHECKS) {
      const sql = String(check.sql).trim().toUpperCase();
      assert.ok(sql.startsWith('SELECT'), `${check.id} 必须以 SELECT 开头`);
      for (const verb of ['INSERT ', 'UPDATE ', 'DELETE ', 'ALTER ', 'DROP ', 'TRUNCATE ', 'CREATE ']) {
        assert.equal(sql.includes(verb), false, `${check.id} 不得含 ${verb.trim()}`);
      }
      // 评审补充：`SELECT … FOR UPDATE` / `SELECT … INTO` 能过上面那组判断，但都带副作用
      assert.equal(sql.includes('FOR UPDATE'), false, `${check.id} 不得加行锁`);
      assert.equal(/\sINTO\s/.test(sql), false, `${check.id} 不得 SELECT INTO`);
    }
  });

  await t.test('运行时真的只发出 SELECT（schema 预检 + 五条判据）', async () => {
    const client = makeClient();
    await R.runReconcile({ client });
    assert.equal(client.calls.length, R.CHECKS.length + 1, 'schema 预检 + 每条判据各一次');
    for (const call of client.calls) {
      assert.ok(String(call.sql).trim().toUpperCase().startsWith('SELECT'));
    }
  });

  await t.test('每条判据的 SQL 都真的被执行了（不是静态返回）', async () => {
    const client = makeClient();
    await R.runReconcile({ client });
    for (const check of R.CHECKS) {
      assert.ok(
        client.calls.some((c) => c.sql === check.sql),
        `${check.id} 的 SQL 没有被执行`,
      );
    }
  });

  // 2026-10-23 生产回归：旧实现是「统一绑两个参数，用不用随缘」，而
  // entitlement-without-paid-order 与 stuck-processing 的 SQL 只写了 $2、没写 $1。
  // PostgreSQL 对没出现的占位符无法推断类型 ⇒
  //   could not determine data type of parameter $1
  // 整条 SQL 直接失败，对账一条都跑不出来。当时单元测试全绿，
  // 因为假 client 把参数数组原样收下、从不校验。
  await t.test('每条判据的占位符必须从 $1 连续编号，且与 params 声明一致', async () => {
    const client = makeClient();
    await R.runReconcile({ client, limit: 7 });
    const checkCalls = client.calls.filter((c) => !c.sql.includes('to_regclass'));
    assert.equal(checkCalls.length, R.CHECKS.length);

    for (const call of checkCalls) {
      const check = R.CHECKS.find((c) => c.sql === call.sql);
      assert.ok(check, '每次查询都必须能对应回某个判据');

      const nums = [...new Set([...check.sql.matchAll(/\$(\d+)/g)].map((m) => Number(m[1])))]
        .sort((a, b) => a - b);
      assert.deepEqual(
        nums,
        Array.from({ length: check.params.length }, (_, i) => i + 1),
        `${check.id} 的占位符必须从 $1 连续编号（PG 不允许绑未出现的占位符）`,
      );

      assert.equal(call.params.length, check.params.length, `${check.id} 绑定个数必须等于 params 声明`);
      check.params.forEach((name, index) => {
        if (name === 'since') {
          assert.ok(call.params[index] instanceof Date, 'since 必须是 Date（不会把字符串拼进 SQL）');
        } else {
          assert.equal(call.params[index], 7, 'limit 必须原样传 --limit');
        }
      });
    }
  });

  await t.test('严格假 client：占位符个数与绑定个数不等就当场红', async () => {
    const strict = {
      async end () {},
      async query (sql, params = []) {
        const nums = [...new Set([...String(sql).matchAll(/\$(\d+)/g)].map((m) => Number(m[1])))];
        assert.equal(
          params.length,
          nums.length,
          `SQL 用了 ${nums.length} 个占位符却绑了 ${params.length} 个参数：${String(sql).trim().slice(0, 50)}…`,
        );
        return { rows: sql.includes('to_regclass') ? [SCHEMA_ROW] : [] };
      },
    };
    await R.runReconcile({ client: strict });
  });
});

test('判据的 SQL 形状锁（锁住两条评审修复，防止重构时悄悄退回）', async (t) => {
  await t.test('事件-订单判据必须 LEFT JOIN：孤儿事件不能被 JOIN 丢掉', () => {
    const check = R.CHECKS.find((c) => c.id === 'event-processed-order-pending');
    assert.match(check.sql, /LEFT JOIN\s+identity_orders/);
    assert.match(check.sql, /o\.id IS NULL OR o\.status <> 'paid'/, '订单不存在也必须算差异');
  });

  await t.test('反向孤儿判据必须有长度守卫：`wechat:` 只有 7 字符时 substring 会得到空串', () => {
    const check = R.CHECKS.find((c) => c.id === 'entitlement-without-paid-order');
    assert.match(check.sql, /length\(s\.provider_reference\)\s*>\s*7/);
  });
});
test('payment-reconcile：schema 预检（防"连错库也报一致"）', async (t) => {
  await t.test('三张表都在 ⇒ 正常继续', async () => {
    const report = await R.runReconcile({ client: makeClient() });
    assert.equal(report.ok, true);
  });

  await t.test('缺表 ⇒ 抛 PAYMENT_RECONCILE_SCHEMA_MISSING，绝不返回"一致"', async () => {
    const client = makeClient({}, { ...SCHEMA_ROW, identity_subscriptions: null });
    await assert.rejects(() => R.runReconcile({ client }), (e) => {
      assert.equal(e.code, 'PAYMENT_RECONCILE_SCHEMA_MISSING');
      assert.match(e.message, /identity_subscriptions/);
      return true;
    });
  });

  await t.test('CLI 层：缺表 ⇒ rc=2（不是 0）', async () => {
    const code = await R.main(['--json'], {
      env: { BUSINESS_DATABASE_URL: 'postgres://x' },
      createClient: () => ({ query: async () => ({ rows: [] }), end: async () => {} }),
    });
    assert.equal(code, 2);
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

  await t.test('LIMIT 打满 ⇒ 标记 truncated（"200 条"不得被读成真实条数）', async () => {
    const rows = Array.from({ length: 3 }, (_, i) => ({ id: 'o' + i }));
    const report = await R.runReconcile({
      client: makeClient({ 'SELECT o.id, o.user_id': rows }),
      limit: 3,
    });
    const hit = report.results.find((r) => r.id === 'paid-without-entitlement');
    assert.equal(hit.truncated, true);
    assert.equal(report.truncatedBlocking, 1);
    assert.equal(report.ok, false, '截断时 count>0 ⇒ 仍然是阻塞');
    assert.match(R.formatText(report), /被 LIMIT=3 截断/);
  });

  await t.test('未打满 ⇒ truncated=false', async () => {
    const report = await R.runReconcile({ client: makeClient(), limit: 3 });
    assert.equal(report.results.every((r) => r.truncated === false), true);
  });

  await t.test('报告带检查窗口（否则历史差异被默认窗口藏住无人知）', async () => {
    const report = await R.runReconcile({ client: makeClient(), sinceDays: 7, limit: 50 });
    assert.equal(report.inspectionWindow.sinceDays, 7);
    assert.equal(report.inspectionWindow.limit, 50);
    assert.match(report.inspectionWindow.since, /^\d{4}-\d{2}-\d{2}T/);
    assert.match(R.formatText(report), /检查窗口/);
  });

  await t.test('每条结果都带可操作的 hint（不是只报数字）', async () => {
    const report = await R.runReconcile({ client: makeClient() });
    for (const r of report.results) {
      assert.ok(r.hint && r.hint.length > 20, `${r.id} 缺少可操作提示`);
    }
  });

  await t.test('sample 最多 5 条，但 count 是真实条数', async () => {
    const many = Array.from({ length: 9 }, (_, i) => ({ id: 'o' + i }));
    const report = await R.runReconcile({ client: makeClient({ 'SELECT o.id, o.user_id': many }), limit: 100 });
    const hit = report.results.find((r) => r.id === 'paid-without-entitlement');
    assert.equal(hit.count, 9);
    assert.equal(hit.sample.length, 5);
    assert.equal(hit.truncated, false);
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
      createClient: () => ({
        query: async (sql) => {
          if (sql.includes('to_regclass')) return { rows: [SCHEMA_ROW] };
          return sql.includes('SELECT o.id, o.user_id') ? { rows } : { rows: [] };
        },
        end: async () => {},
      }),
    });
    assert.equal(await R.main(['--json'], { env: { BUSINESS_DATABASE_URL: 'postgres://x' }, ...mk([{ id: 'o1' }]) }), 1);
    assert.equal(await R.main(['--json'], { env: { BUSINESS_DATABASE_URL: 'postgres://x' }, ...mk([]) }), 0);
  });

  await t.test('client 一定会被 end（不泄漏连接）', async () => {
    let ended = false;
    const code = await R.main(['--json'], {
      env: { BUSINESS_DATABASE_URL: 'postgres://x' },
      createClient: () => ({
        query: async (sql) => (sql.includes('to_regclass') ? { rows: [SCHEMA_ROW] } : { rows: [] }),
        end: async () => { ended = true; },
      }),
    });
    assert.equal(code, 0);
    assert.equal(ended, true);
  });
});
