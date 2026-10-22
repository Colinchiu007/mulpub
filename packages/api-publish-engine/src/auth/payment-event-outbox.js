'use strict';

/**
 * 支付回调的**持久化留痕**（PRD §15.9）。
 *
 * ## 为什么有这个文件
 *
 * PRD §5.3 写的是「`identity_webhook_events` 复用为支付 outbox」，但 2026-10-23 核对发现
 * `_handlePaymentWebhook` 与 `settlePaymentWebhook` **都没有往这张表写过一行** ——
 * 回调到达没有任何持久化记录，事后追查只能翻服务端日志。
 *
 * 这类「文档说有、实现没有」的不一致比「压根没做」更危险：读文档的人会以为有。
 *
 * ## 幂等键为什么是订单号
 *
 * 微信重投同一笔支付时 `Wechatpay-Nonce` 会变（每次投递新生成），`transaction_id` 才是稳定的；
 * 但本模块拿到的是 `orderId`（= 我们自己的 `out_trade_no`），它**天然一单一值**，
 * 比 transaction_id 更适合当幂等键：一单只会有一条支付事件。
 *
 * 代价写在 §限制里：将来若同一订单出现**第二类**事件（退款通知等），会与这条撞键。
 * 届时需要把键从 `wechat_pay:<orderId>` 扩成 `wechat_pay:<orderId>:<event>`。
 *
 * ## 与既有 Logto outbox 的关系
 *
 * 表结构、`ON CONFLICT (provider, id)` 语义、`status` 取值都与 Logto 那条链路一致
 * （见 `postgres-webhook-store.js`），所以同一张表可以同时服务两条链路，
 * 靠 `provider` 区分：`logto` / `wechat_pay`。
 */

const PROVIDER = 'wechat_pay';
const DEFAULT_EVENT = 'checkout.completed';

/** 事件行 id：一单一值，重复投递落同一行。 */
function paymentEventId (orderId) {
  return `${PROVIDER}:${orderId}`;
}

/**
 * 抢占一条支付事件行。
 *
 * @param {{query: Function}} client 事务内的 pg client（`tx.client`）
 * @param {object} record
 * @param {string} record.orderId 订单号（幂等键）
 * @param {string} [record.event] 归一化事件类型
 * @param {Date|null} [record.occurredAt] 微信侧发生时间
 * @param {Date} [record.receivedAt] 本服务收到的时间
 * @param {string|null} [record.hookId] 投递标识（无稳定值时用订单号）
 * @returns {Promise<{id: string, claimed: boolean}>} `claimed=false` 表示这单之前已记过
 */
async function claimPaymentEvent (client, record = {}) {
  const orderId = String(record.orderId || '');
  if (!orderId) throw new TypeError('claimPaymentEvent: orderId is required');
  const id = paymentEventId(orderId);
  const receivedAt = record.receivedAt || new Date();
  const result = await client.query(
    `INSERT INTO identity_webhook_events
       (id, provider, event, hook_id, auth_subject, created_at, received_at, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'processing')
     ON CONFLICT (provider, id) DO NOTHING
     RETURNING id`,
    [
      id,
      PROVIDER,
      record.event || DEFAULT_EVENT,
      record.hookId || orderId,
      orderId,
      record.occurredAt || receivedAt,
      receivedAt,
    ],
  );
  return { id, claimed: Array.isArray(result.rows) && result.rows.length > 0 };
}

/** 结算成功后把事件行收口为 `processed` 并写入结果快照。 */
async function completePaymentEvent (client, eventId, result = {}) {
  if (!eventId) return;
  await client.query(
    `UPDATE identity_webhook_events
        SET status = 'processed', result = $2::jsonb, processed_at = NOW()
      WHERE id = $1`,
    [eventId, JSON.stringify(result || {})],
  );
}

module.exports = { DEFAULT_EVENT, PROVIDER, claimPaymentEvent, completePaymentEvent, paymentEventId };
