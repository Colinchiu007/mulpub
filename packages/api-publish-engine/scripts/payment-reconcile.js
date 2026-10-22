#!/usr/bin/env node
'use strict';

/**
 * 支付对账：把「订单表 / 事件表 / 订阅表」三方的差集算出来。
 *
 * ## 为什么需要它
 *
 * 支付链路有四张表各记一半事实：
 *   - `identity_orders`     订单（pending → paid）
 *   - `identity_webhook_events` 回调到达与处理（2026-10-23 起）
 *   - `identity_subscriptions`  权益发放（`provider_reference = 'wechat:<orderId>'`）
 *   - 微信商户平台（钱实际到没到）
 *
 * 任何一环错位，用户看到的现象都一样：「我付了钱但没会员」。而日志只会告诉你
 * 「这个请求返回了什么」，不会告诉你「有多少单处在不一致状态」。灰度期每天要看的就是这个数。
 *
 * ## 硬约束：只读
 *
 * 本脚本**只允许 SELECT**。对账工具一旦能写库，就会有人用它「顺手修一下」，
 * 而自动修复不一致是资金路径上最危险的动作（改错了没人知道）。修正一律人工 + 单独脚本。
 * 结构锁见 `test/payment-reconcile.test.js` 的「只读」用例：任何非 SELECT 语句当场红。
 *
 * 用法：
 *   node packages/api-publish-engine/scripts/payment-reconcile.js
 *   node packages/api-publish-engine/scripts/payment-reconcile.js --since-days 7 --json
 */

const BLOCKING = 'blocking';
const INFO = 'info';

/**
 * 五项对账判据。
 *
 * `sql` 约定两个参数：`$1` = 起始时间，`$2` = LIMIT（未使用时也照样传，PG 允许多余参数绑定）。
 */
const CHECKS = [
  {
    id: 'paid-without-entitlement',
    severity: BLOCKING,
    title: '已支付但没发权益',
    hint: '最严重：用户付了钱拿不到会员。先看该单在 identity_webhook_events 有没有 processed 行；' +
      '没有则是回调没到或验签失败，有则是结算抛错（查日志 ORDER_REFERENCE_CONFLICT / PAYMENT_ORDER_NOT_FOUND）。' +
      '确认后按 PRD §15.9 的补发流程人工补。',
    sql: `SELECT o.id, o.user_id, o.plan, o.amount, o.paid_at
            FROM identity_orders o
           WHERE o.channel = 'payment' AND o.status = 'paid' AND o.created_at >= $1
             AND NOT EXISTS (
               SELECT 1 FROM identity_subscriptions s
                WHERE s.provider_reference = 'wechat:' || o.id)
           ORDER BY o.paid_at DESC NULLS LAST
           LIMIT $2`,
  },
  {
    id: 'entitlement-without-paid-order',
    severity: BLOCKING,
    title: '发了权益但订单不是已支付',
    hint: '反向孤儿：权益来源指向一个未支付/不存在的订单。可能是人工改了订单状态，' +
      '或 provider_reference 写错。**不要自动降级用户**，先核对微信商户平台该单是否真的收到钱。',
    sql: `SELECT s.user_id, s.plan, s.provider_reference, s.current_period_end
            FROM identity_subscriptions s
           WHERE s.provider_reference LIKE 'wechat:%'
             AND NOT EXISTS (
               SELECT 1 FROM identity_orders o
                WHERE o.id = substring(s.provider_reference from 8)
                  AND o.status = 'paid')
           LIMIT $2`,
  },
  {
    id: 'event-processed-order-pending',
    severity: BLOCKING,
    title: '回调已处理但订单仍非已支付',
    hint: '结算事务提交了事件收口却没把订单置 paid —— 事务边界可能被改坏。' +
      '这是代码缺陷信号，先回滚 `PAYMENT_PROVIDER=none` 再查。',
    sql: `SELECT e.id, e.auth_subject AS order_id, e.processed_at, o.status
            FROM identity_webhook_events e
            JOIN identity_orders o ON o.id = e.auth_subject
           WHERE e.provider = 'wechat_pay' AND e.status = 'processed'
             AND o.status <> 'paid' AND e.received_at >= $1
           LIMIT $2`,
  },
  {
    id: 'paid-order-without-event',
    severity: INFO,
    title: '已支付但无回调事件行',
    hint: '事件表 2026-10-23 才上线，历史订单必然没有 —— 属正常。' +
      '若**新单**出现在这里，说明事件写入被降级（日志会有 PAYMENT_EVENT_NOT_RECORDED）。',
    sql: `SELECT o.id, o.paid_at
            FROM identity_orders o
           WHERE o.channel = 'payment' AND o.status = 'paid' AND o.created_at >= $1
             AND NOT EXISTS (
               SELECT 1 FROM identity_webhook_events e
                WHERE e.provider = 'wechat_pay' AND e.auth_subject = o.id)
           LIMIT $2`,
  },
  {
    id: 'stuck-processing',
    severity: INFO,
    title: '事件卡在 processing 超过 10 分钟',
    hint: '结算成功但收口 UPDATE 失败。**权益已发**，不要据此重新发放；' +
      '仅代表留痕没闭环，清账需人工。',
    sql: `SELECT e.id, e.auth_subject AS order_id, e.received_at
            FROM identity_webhook_events e
           WHERE e.provider = 'wechat_pay' AND e.status = 'processing'
             AND e.received_at < now() - interval '10 minutes'
           LIMIT $2`,
  },
];

function parseArgs (argv = process.argv.slice(2)) {
  const result = { json: false, sinceDays: 30, limit: 200, databaseUrl: null, help: false, error: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--json') result.json = true;
    else if (arg === '--help' || arg === '-h') result.help = true;
    else if (arg === '--since-days') {
      const next = argv[i + 1];
      const n = Number(next);
      if (!next || String(next).startsWith('-') || !Number.isFinite(n) || n <= 0) result.error = 'PAYMENT_RECONCILE_ARGUMENT_INVALID: --since-days 需要正数';
      else { result.sinceDays = n; i += 1; }
    } else if (arg === '--limit') {
      const next = argv[i + 1];
      const n = Number(next);
      if (!next || String(next).startsWith('-') || !Number.isInteger(n) || n <= 0) result.error = 'PAYMENT_RECONCILE_ARGUMENT_INVALID: --limit 需要正整数';
      else { result.limit = n; i += 1; }
    } else if (arg === '--database-url') {
      const next = argv[i + 1];
      if (!next || String(next).startsWith('-')) result.error = 'PAYMENT_RECONCILE_ARGUMENT_INVALID: --database-url 缺少取值';
      else { result.databaseUrl = argv[++i]; }
    } else result.error = 'PAYMENT_RECONCILE_ARGUMENT_INVALID: ' + arg;
  }
  return result;
}

/**
 * 跑完五项判据。**纯逻辑**：只吃一个 `query` 能力，不自己建连接。
 *
 * @returns {Promise<{ok:boolean, blocking:number, results:Array}>} `ok` 只由 blocking 项决定
 */
async function runReconcile (options = {}) {
  const client = options.client;
  if (!client || typeof client.query !== 'function') throw new TypeError('runReconcile: client.query is required');
  const now = options.now || (() => new Date());
  const sinceDays = options.sinceDays || 30;
  const limit = options.limit || 200;
  const since = new Date(now().getTime() - sinceDays * 24 * 3600 * 1000);

  const results = [];
  for (const check of CHECKS) {
    const { rows } = await client.query(check.sql, [since, limit]);
    results.push({
      id: check.id,
      severity: check.severity,
      title: check.title,
      hint: check.hint,
      count: rows.length,
      sample: rows.slice(0, 5),
    });
  }
  const blocking = results.filter((r) => r.severity === BLOCKING && r.count > 0).length;
  return { ok: blocking === 0, blocking, results };
}

function formatText (report) {
  const lines = ['=== 支付对账 ==='];
  for (const r of report.results) {
    const mark = r.count === 0 ? '✓' : (r.severity === BLOCKING ? '✗' : '!');
    lines.push(`[${mark}] ${r.id.padEnd(32)} ${String(r.count).padStart(4)} 条  ${r.title}`);
    if (r.count > 0) {
      lines.push('     ' + r.hint);
      for (const row of r.sample) lines.push('     · ' + JSON.stringify(row));
      if (r.count > r.sample.length) lines.push(`     …… 共 ${r.count} 条，仅显示前 ${r.sample.length} 条`);
    }
  }
  lines.push(report.ok
    ? '✅ 三方一致（订单 / 事件 / 订阅），无阻塞性差异'
    : `❌ 有 ${report.blocking} 项阻塞性差异，先按上面的提示逐条核对，**不要自动修复**`);
  return lines.join('\n');
}

async function main (argv = process.argv.slice(2), deps = {}) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log('用法: payment-reconcile [--json] [--since-days N] [--limit N] [--database-url URL]');
    return 0;
  }
  if (args.error) {
    console.error(args.error);
    return 2;
  }
  const databaseUrl = args.databaseUrl || (deps.env || process.env).BUSINESS_DATABASE_URL;
  if (!databaseUrl) {
    console.error('PAYMENT_RECONCILE_DATABASE_URL_REQUIRED: 需要 BUSINESS_DATABASE_URL 或 --database-url');
    return 2;
  }
  const createClient = deps.createClient || ((url) => {
    const { Client } = require('pg');
    return new Client({ connectionString: url });
  });
  const client = createClient(databaseUrl);
  try {
    if (typeof client.connect === 'function') await client.connect();
    const report = await runReconcile({ client, sinceDays: args.sinceDays, limit: args.limit, now: deps.now });
    console.log(args.json ? JSON.stringify(report, null, 2) : formatText(report));
    return report.ok ? 0 : 1;
  } catch (error) {
    console.error('PAYMENT_RECONCILE_FAILED: ' + ((error && error.message) || error));
    return 2;
  } finally {
    if (typeof client.end === 'function') {
      try { await client.end(); } catch (_) { /* 关闭失败不该改写对账结论 */ }
    }
  }
}

if (require.main === module) {
  main().then((code) => { process.exitCode = code }).catch((error) => {
    console.error('PAYMENT_RECONCILE_FAILED: ' + ((error && error.message) || error));
    process.exitCode = 2;
  });
}

module.exports = { BLOCKING, CHECKS, INFO, formatText, main, parseArgs, runReconcile };
