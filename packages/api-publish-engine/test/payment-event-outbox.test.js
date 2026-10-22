/**
 * 支付回调留痕（PRD §15.9）的判据。
 *
 * 背景：`identity_webhook_events` 一直被文档称为「支付 outbox」，但实现里**一行都没写过**。
 * 这组测试锁三件事：
 *   ① 结算时**真的**落下事件行（INSERT → processed UPDATE）
 *   ② 同一订单重复投递**短路**，不再走 applySubscription（不发第二次权益）
 *   ③ 事件表写失败**不阻断**结算（用户已付钱，权益优先），但结果里必须带 `eventRecorded=false`
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { SubscriptionService } = require('../src/auth/subscription-service');
const { claimPaymentEvent, completePaymentEvent, paymentEventId } = require('../src/auth/payment-event-outbox');

const ORDER_ID = 'wpabcdefgh1234';

/** 记录所有 SQL 的假 client。 */
function makeClient (behaviour = {}) {
  const calls = [];
  return {
    calls,
    async query (sql, params) {
      calls.push({ sql, params });
      if (/INSERT INTO identity_webhook_events/.test(sql)) {
        if (behaviour.claimThrows) throw new Error('relation "identity_webhook_events" does not exist');
        return { rows: behaviour.alreadyClaimed ? [] : [{ id: params[0] }] };
      }
      if (/UPDATE identity_webhook_events/.test(sql)) {
        if (behaviour.completeThrows) throw new Error('update failed');
        return { rows: [] };
      }
      return { rows: [] };
    },
  };
}

function makeService (behaviour = {}) {
  const applied = [];
  const client = makeClient(behaviour);
  const order = {
    id: ORDER_ID,
    user_id: 'user-1',
    plan: 'standard',
    amount: 5900,
    currency: 'CNY',
    channel: 'payment',
    period: 'month',
    status: 'pending',
  };
  const repository = {
    async getOrderById (id) { return id === ORDER_ID ? order : null; },
    async markOrderPaid () {},
    async commerceTransaction (cb) {
      return cb({
        client,
        async applySubscription (args) {
          applied.push(args);
          return { plan: args.plan, periodEnd: new Date('2026-11-22T00:00:00Z'), downgradeSuppressed: false };
        },
        async createNotification () {},
      });
    },
  };
  const service = new SubscriptionService({
    repository,
    now: () => new Date('2026-10-23T00:00:00Z'),
  });
  return { service, client, applied };
}

test('payment-event-outbox：SQL 形状与幂等键', async (t) => {
  await t.test('事件 id 一单一值（重复投递落同一行）', () => {
    assert.equal(paymentEventId('abc'), 'wechat_pay:abc');
    assert.equal(paymentEventId('abc'), paymentEventId('abc'));
  });

  await t.test('claim 用 ON CONFLICT DO NOTHING，claimed 由 RETURNING 行数决定', async () => {
    const client = makeClient();
    const first = await claimPaymentEvent(client, { orderId: 'o1', receivedAt: new Date('2026-01-01T00:00:00Z') });
    assert.equal(first.claimed, true);
    assert.equal(first.id, 'wechat_pay:o1');
    const sql = client.calls[0].sql;
    assert.match(sql, /INSERT INTO identity_webhook_events/);
    assert.match(sql, /ON CONFLICT \(provider, id\) DO NOTHING/);
    assert.match(sql, /'processing'/);
    assert.deepEqual(client.calls[0].params.slice(0, 5), ['wechat_pay:o1', 'wechat_pay', 'checkout.completed', 'o1', 'o1']);
  });

  await t.test('已存在时 claimed=false（不抛错）', async () => {
    const client = makeClient({ alreadyClaimed: true });
    const r = await claimPaymentEvent(client, { orderId: 'o1' });
    assert.equal(r.claimed, false);
  });

  await t.test('complete 把行收口为 processed 并写 result', async () => {
    const client = makeClient();
    await completePaymentEvent(client, 'wechat_pay:o1', { plan: 'pro' });
    const call = client.calls[0];
    assert.match(call.sql, /SET status = 'processed'/);
    assert.equal(call.params[0], 'wechat_pay:o1');
    assert.equal(JSON.parse(call.params[1]).plan, 'pro');
  });

  await t.test('eventId 为空时 complete 是 no-op（不误伤全表）', async () => {
    const client = makeClient();
    await completePaymentEvent(client, null, {});
    assert.equal(client.calls.length, 0);
  });
});

test('settlePaymentWebhook：留痕与结算的关系', async (t) => {
  await t.test('正常结算：先 INSERT 再 UPDATE，结果带 eventRecorded=true', async () => {
    const { service, client, applied } = makeService();
    const result = await service.settlePaymentWebhook({ orderId: ORDER_ID, providerReference: `wechat:${ORDER_ID}` });
    assert.equal(result.plan, 'standard');
    assert.equal(result.eventRecorded, true);
    assert.equal(applied.length, 1, '权益必须发放');
    const kinds = client.calls.map((c) => (/INSERT/.test(c.sql) ? 'insert' : 'update'));
    assert.deepEqual(kinds, ['insert', 'update'], '顺序必须是先抢占再收口');
  });

  await t.test('同一订单重复投递：短路，不再 applySubscription（不发第二次权益）', async () => {
    const { service, applied } = makeService({ alreadyClaimed: true });
    const result = await service.settlePaymentWebhook({ orderId: ORDER_ID });
    assert.equal(result.ignored, true);
    assert.equal(result.duplicate, true);
    assert.equal(applied.length, 0, '重复投递绝不能再次发放权益');
  });

  await t.test('事件表不可用：结算照常完成，但 eventRecorded=false（不静默）', async () => {
    const { service, applied } = makeService({ claimThrows: true });
    const result = await service.settlePaymentWebhook({ orderId: ORDER_ID });
    assert.equal(result.plan, 'standard', '用户已付钱，权益不能被可观测性拖累');
    assert.equal(result.eventRecorded, false);
    assert.equal(applied.length, 1);
  });

  await t.test('收口失败：已经结算的不回滚，eventRecorded 降级为 false', async () => {
    const { service, applied } = makeService({ completeThrows: true });
    const result = await service.settlePaymentWebhook({ orderId: ORDER_ID });
    assert.equal(result.plan, 'standard');
    assert.equal(result.eventRecorded, false);
    assert.equal(applied.length, 1);
  });

  await t.test('非 checkout.completed 事件不落库也不结算', async () => {
    const { service, client, applied } = makeService();
    const result = await service.settlePaymentWebhook({ orderId: ORDER_ID, type: 'refund.created' });
    assert.equal(result.ignored, true);
    assert.equal(client.calls.length, 0);
    assert.equal(applied.length, 0);
  });
});

test('eventRecorded 的三值契约（键永远存在）', async (t) => {
  await t.test('事务里没有 DB client（测试替身）⇒ 键存在且为 null，表示"不适用"', async () => {
    // 直接构造一个没有 client 的 tx，模拟旧式 fake repository。
    const applied = [];
    const repository = {
      async getOrderById () {
        return { id: ORDER_ID, user_id: 'u', plan: 'standard', amount: 100, channel: 'payment', period: 'month' };
      },
      async markOrderPaid () {},
      async commerceTransaction (cb) {
        return cb({
          async applySubscription (args) { applied.push(args); return { plan: args.plan, periodEnd: null }; },
          async createNotification () {},
        });
      },
    };
    const service = new SubscriptionService({ repository, now: () => new Date('2026-10-23T00:00:00Z') });
    const result = await service.settlePaymentWebhook({ orderId: ORDER_ID });
    assert.equal('eventRecorded' in result, true, '缺键会被调用方读成"成功"');
    assert.equal(result.eventRecorded, null, 'null = 不适用（没有可写的事件表），不是失败');
    assert.equal(applied.length, 1);
  });
});