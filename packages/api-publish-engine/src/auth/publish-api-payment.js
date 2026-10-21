'use strict'

/**
 * publish-api-payment.js — 微信 Native 支付路由（PublishApiServer 的 mixin）。
 *
 * 两个信任边界截然不同的端点，刻意写在同一个文件里，因为它们的**顺序**是安全前提：
 *   ① `POST /api/v1/webhooks/payment` —— **免登录 · 强验签**（微信平台证书 RSA-SHA256）。
 *      它必须排在 Bearer/API-key 鉴权之前，和 `/api/v1/auth/logto/webhook` 同层。
 *   ② `POST /api/v1/me/checkout` / `GET /api/v1/me/orders/{id}` —— **用户态**，
 *      走 Logto scope（profile:write / profile:read），在会员中心那段路由里。
 *
 * 为什么拆文件而不是内联进 publish-api-server.js：该文件有逐文件行数点名目标，
 * 新增路由会触发 TARGET_GREW 门禁；且本段自成一块（支付），边界清楚。
 * 体例同 publish-api-redeem-code-admin.js。
 */

const OUT_TRADE_NO_PATTERN = /^wp[a-z0-9]{8,64}$/

class PublishApiPaymentHelpers {
  /**
   * 支付 webhook。返回 true 表示已处理（调用方必须立即 return）。
   *
   * 三个不可让的纪律：
   *   ① **先读原始字节再验签**：解析成 JSON 再验签等于把不可信字节喂给业务字段。
   *      `_readRawBody` 是唯一入口（它有 256 KiB 上限）。
   *   ② **验签失败 401 且不入库**：入队就等于给伪造回调留了重放素材。
   *   ③ **内部错误仍返回 2xx**：微信对 4xx/5xx 会重投；错误已随事件落库
   *      （status='failed'）供重放修复，用 5xx 换来的只是重投风暴。
   */
  async _handlePaymentWebhook(req, res, method, url) {
    if (url !== "/api/v1/webhooks/payment") return false
    if (method !== "POST") {
      this._json(res, 405, { success: false, error: "METHOD_NOT_ALLOWED" })
      return true
    }
    const provider = this._paymentProvider
    if (!provider || typeof provider.parseWebhook !== "function") {
      // 未配置商户凭据：404 让微信侧配置错误一眼可见（不是"验证通过"）
      this._json(res, 404, { success: false, error: "PAYMENT_WEBHOOK_NOT_CONFIGURED" })
      return true
    }
    let rawBody
    try {
      rawBody = await this._readRawBody(req, 256 * 1024)
    } catch (error) {
      const status = error && Number.isInteger(error.status) ? error.status : 413
      this._json(res, status, { success: false, error: "PAYMENT_WEBHOOK_BODY_TOO_LARGE" })
      return true
    }
    let event
    try {
      event = await provider.parseWebhook({ rawBody, headers: req.headers })
    } catch (error) {
      // 验签类错误统一 401，且**不入库**（见文件头纪律②）
      const status = error && Number.isInteger(error.status) ? error.status : 401
      const code = error && error.code ? error.code : "PAYMENT_WEBHOOK_SIGNATURE_INVALID"
      this._logError(code, error, this._ctx(req, { hook: "payment-webhook" }))
      this._json(res, status, { success: false, error: code })
      return true
    }
    try {
      if (!this._subscriptionService) {
        this._json(res, 200, { success: true, ignored: true, reason: "SUBSCRIPTION_SERVICE_NOT_CONFIGURED" })
        return true
      }
      const result = await this._subscriptionService.settlePaymentWebhook({
        orderId: event.orderId,
        providerReference: event.orderId ? `wechat:${event.orderId}` : null,
        amountCents: event.amountCents,
        occurredAt: event.occurredAt,
        type: event.type,
      })
      this._json(res, 200, { success: true, ...result })
    } catch (error) {
      // 内部错误仍 2xx（纪律③）：错误落日志，微信不重投；对账靠订单表 + 事件表。
      const code = error && error.code ? error.code : "PAYMENT_WEBHOOK_INTERNAL"
      this._logError(code, error, this._ctx(req, { hook: "payment-webhook" }))
      this._json(res, 200, { success: true, processed: false, error: code })
    }
    return true
  }

  /**
   * `POST /api/v1/me/checkout`。body **白名单**：只取 `plan` / `period` 两个字符串，
   * 其余键（尤其 `amount`）一律丢弃 —— 金额由服务端按 plan-matrix 计算。
   */
  async _handleMemberCheckout(req, res, method, url) {
    if (url !== "/api/v1/me/checkout") return false
    if (method !== "POST") {
      this._json(res, 405, { error: "METHOD_NOT_ALLOWED" })
      return true
    }
    if (!this._subscriptionService) {
      this._json(res, 503, { error: "SUBSCRIPTION_SERVICE_NOT_CONFIGURED" })
      return true
    }
    const userId = this._memberUserId(req)
    if (!userId) {
      this._json(res, 503, { error: "BUSINESS_USER_REPOSITORY_NOT_CONFIGURED" })
      return true
    }
    const body = await this._parseBody(req)
    try {
      const result = await this._subscriptionService.createCheckout({
        userId,
        plan: body && typeof body.plan === "string" ? body.plan : "",
        period: body && typeof body.period === "string" ? body.period : "",
      })
      this._json(res, 200, { success: true, ...result })
    } catch (error) {
      this._commerceFailure(req, res, error)
    }
    return true
  }

  /**
   * `GET /api/v1/me/orders/{id}`。**只返回属于当前用户的订单**：
   * 别人的订单返回 404 而不是 403 —— 403 会泄露「这个订单号存在」。
   */
  async _handleMemberOrderDetail(req, res, method, url) {
    if (url.indexOf("/api/v1/me/orders/") !== 0) return false
    if (method !== "GET") {
      this._json(res, 405, { error: "METHOD_NOT_ALLOWED" })
      return true
    }
    const orderId = url.slice("/api/v1/me/orders/".length)
    if (!OUT_TRADE_NO_PATTERN.test(orderId)) {
      this._json(res, 404, { error: "ORDER_NOT_FOUND" })
      return true
    }
    const repository = this._commerceRepository()
    if (!repository || typeof repository.getOrderById !== "function") {
      this._json(res, 503, { error: "BUSINESS_USER_REPOSITORY_NOT_CONFIGURED" })
      return true
    }
    const userId = this._memberUserId(req)
    if (!userId) {
      this._json(res, 503, { error: "BUSINESS_USER_REPOSITORY_NOT_CONFIGURED" })
      return true
    }
    try {
      const order = await repository.getOrderById(orderId)
      if (!order || order.user_id !== userId) {
        this._json(res, 404, { error: "ORDER_NOT_FOUND" })
        return true
      }
      this._json(res, 200, {
        order: {
          id: order.id,
          plan: order.plan,
          amount: order.amount,
          currency: order.currency,
          channel: order.channel,
          status: order.status,
          period: order.period || null,
          createdAt: order.created_at || null,
          paidAt: order.paid_at || null,
        },
      })
    } catch (error) {
      this._commerceFailure(req, res, error)
    }
    return true
  }
}

function applyPaymentHelpers (Proto) {
  const names = Object.getOwnPropertyNames(PublishApiPaymentHelpers.prototype)
  for (const key of names) {
    if (key === 'constructor') continue
    Object.defineProperty(Proto.prototype, key, Object.getOwnPropertyDescriptor(PublishApiPaymentHelpers.prototype, key))
  }
}

module.exports = { applyPaymentHelpers, PublishApiPaymentHelpers, OUT_TRADE_NO_PATTERN }
