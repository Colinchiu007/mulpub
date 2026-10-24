'use strict'
/**
 * publish-api-redeem.js — `POST /api/v1/redeem` 路由 + 兑换失败限流（PublishApiServer 的 mixin）。
 *
 * ## 为什么单独成文件
 *
 * `publish-api-server.js` 在逐文件行数门禁的 `targets`（**点名还账**）清单里
 * （`max-lines-baseline.json` 的 `targets` = 1574，**零增长容差**，
 * 判定式是 `lines > ceiling` ⇒ 1574 仍合法、1575 即红）。
 * 兑换限流需要在这个路由里插入若干行 ⇒ 直接改会撞零容差天花板 ⇒
 * **把整段路由搬进本文件，主文件里换成一行调用** ⇒ 主文件净减行。
 *
 * 与既有 `publish-api-commerce.js` / `publish-api-redeem-code-admin.js` 同一范式：
 * 方法定义在本文件，用 `applyRedeemRouteHelpers` 挂回 PublishApiServer 原型。
 *
 * ## 路由行为（与搬迁前逐字一致）
 *
 *   POST /api/v1/redeem，scope `profile:write`
 *   body: { code }   成功: { success: true, ...redeemResult }
 *   错误: 走既有的 `_commerceFailure`（保留语义码，如 REDEEM_CODE_FORMAT/NOT_FOUND/USED/…）
 *
 * ## 新增：兑换失败限流（温和档）
 *
 * 见 `redeem-rate-limit.js` 的口径说明：**端点级 + 失败计数**，
 * 同一用户 60 秒内失败 ≥ 5 次 / 同一 IP 10 分钟内失败 ≥ 30 次 ⇒ 429。
 * 命中时不透露剩余次数。一次成功会清零该用户的失败计数。
 */

/** 限流器实例挂载键（实例级 ⇒ 多实例各算各的，与仓内既有 rate-limiter 同形态）。 */
const LIMITER_KEY = '_redeemFailureLimiter'

class PublishApiRedeemHelpers {
  /**
   * 懒取限流器。
   * 放实例上而不是模块级单例：测试可以各自 new 一个 server ⇒ 计数天然隔离。
   */
  _redeemLimiter () {
    if (!this[LIMITER_KEY]) {
      const { RedeemFailureLimiter } = require('./redeem-rate-limit')
      this[LIMITER_KEY] = new RedeemFailureLimiter()
    }
    return this[LIMITER_KEY]
  }

  /** 取请求来源 IP：优先 socket，其次 X-Forwarded-For（部署在反向代理后面时）。 */
  _redeemClientIp (req) {
    if (!req) return null
    const direct = req.socket && req.socket.remoteAddress
    if (direct) return direct
    const forwarded = req.headers && req.headers['x-forwarded-for']
    if (typeof forwarded === 'string' && forwarded) return forwarded.split(',')[0].trim()
    return null
  }

  /**
   * `POST /api/v1/redeem` 路由。返回 true 表示「已处理」，调用方应立即 return。
   */
  async _handleMemberRedeem (req, res, method, url) {
    if (method !== 'POST' || url !== '/api/v1/redeem') return false
    if (!this._subscriptionService) { this._json(res, 503, { error: 'SUBSCRIPTION_SERVICE_NOT_CONFIGURED' }); return true }
    const userId = this._memberUserId(req)
    if (!userId) { this._json(res, 503, { error: 'BUSINESS_USER_REPOSITORY_NOT_CONFIGURED' }); return true }
    const body = await this._parseBody(req)
    const ip = this._redeemClientIp(req)
    const limiter = this._redeemLimiter()
    // 限流门：先看历史失败次数。命中 ⇒ 429，且**不透露剩余次数**。
    // ⚠️ acquire 是**原子**的（内部无 await）：检查 + 预占额度一起完成。
    // 若拆成「先 check 再占位」，并发请求会同时读到旧计数而全部通过 ⇒ 限流被绕过。
    const gate = limiter.acquire(userId, ip)
    if (gate.blocked) {
      this._json(res, 429, { error: 'REDEEM_RATE_LIMITED', message: '尝试过于频繁，请稍后再试' })
      return true
    }
    try {
      const result = await this._subscriptionService.redeem({ userId, code: body && body.code })
      limiter.recordSuccess(userId)
      this._json(res, 200, { success: true, ...result })
    } catch (error) {
      // 只把「探测型」失败计入限流（格式错 / 不存在）；已用 / 停用 / 过期是正常业务。
      // ⚠️ 但**非探测型也必须释放预占额度**：否则 pending 永久累积，
      // 用户只是反复拿自己的旧码来试，也会被限流在门外。
      const { isProbeFailure } = require('./redeem-rate-limit')
      if (isProbeFailure(error)) limiter.recordFailure(userId, ip)
      else limiter.releasePending(userId)
      this._commerceFailure(req, res, error)
    }
    return true
  }
}

function applyRedeemRouteHelpers (Proto) {
  const names = Object.getOwnPropertyNames(PublishApiRedeemHelpers.prototype)
  for (const key of names) {
    if (key === 'constructor') continue
    Object.defineProperty(Proto.prototype, key, Object.getOwnPropertyDescriptor(PublishApiRedeemHelpers.prototype, key))
  }
}

module.exports = { applyRedeemRouteHelpers, PublishApiRedeemHelpers }
