'use strict'
/**
 * wechat-pay.js — 微信 Native 支付的 IPC 通道（主进程）。
 *
 * 两条通道，命名刻意用 `wechat-pay:` 而**不是** `payment:`：
 *   ① `buyout-removal.contract.test.js` 用 `payment:` 前缀与 `payment[A-Z]` 桥接名
 *      锁「¥99 买断形态不回归」。复用旧名会与那把锁正面冲突，且 `payment` 是已移除的
 *      买断链路名字 —— 新命名 = 新语义。
 *   ② 该锁同步改造为「白名单里只允许 wechat-pay: 两条」，把模糊的"零命中"变成
 *      精确的"只有这两条"（见同 PR 的契约测试）。
 *
 * 职责边界（很重要）：
 *   - 本层**不计算金额**、**不判断档位合法性**（那是服务端 plan-matrix 的事，见 PRD §4.5）
 *   - 本层**不推进任何支付状态**（订单状态只能由服务端 webhook 推进，见 spec）
 *   - 本层只做三件事：登录态短路 → 调会员接口 → 把 code_url 转成二维码 data URL
 */

const { withSenderCheck, EC } = require('./helpers')

function safeError (error) {
  return error && typeof error.code === 'string' ? error.code : 'WECHAT_PAY_FAILED'
}

/** 只收两个白名单字段：其余键（尤其 amount）一律丢弃，绝不透传到服务端。 */
function pickCheckoutBody (payload) {
  const body = {
    plan: payload && typeof payload.plan === 'string' ? payload.plan : '',
    period: payload && typeof payload.period === 'string' ? payload.period : '',
  }
  // `orderId` 仅用于「继续支付」（复用既有 pending 订单）。有才带 —— 不传 undefined，
  // 保持「新建订单」的调用形状与加入本功能之前一致。
  if (payload && typeof payload.orderId === 'string' && payload.orderId) body.orderId = payload.orderId
  return body
}

function registerWeChatPayHandlers (ipcMain, deps = {}) {
  const authService = deps.authService
  const toQrDataUrl = deps.toQrDataUrl || require('../services/wechat-pay-qrcode').toQrDataUrl

  const memberRequest = async ({ payload, path, method, body, requireSubject }) => {
    const memberApiService = authService && authService.memberApiService
    if (!authService || !memberApiService || typeof memberApiService.request !== 'function') {
      return { code: EC.AUTH_ERROR, message: 'IDENTITY_NOT_CONFIGURED' }
    }
    const state = typeof authService.getState === 'function' ? authService.getState() : null
    const subject = state && state.user ? state.user.sub : null
    // 写通道（下单）在本地就短路未登录：让未登录请求走到服务端只会白跑一趟再拿
    // BUSINESS_USER_REQUIRED，且会在服务端留下无主日志。
    if (requireSubject && !subject) {
      return { code: EC.AUTH_ERROR, message: 'BUSINESS_USER_REQUIRED' }
    }
    void payload
    return { code: 0, data: await memberApiService.request({ subject, path, method, body }) }
  }

  ipcMain.handle('wechat-pay:create-order', withSenderCheck(async (_event, payload) => {
    try {
      const created = await memberRequest({
        payload,
        path: '/api/v1/me/checkout',
        method: 'POST',
        body: pickCheckoutBody(payload),
        requireSubject: true,
      })
      if (created.code !== 0) return created
      const data = created.data || {}
      if (typeof data.codeUrl !== 'string' || !data.codeUrl) {
        return { code: EC.REQUEST_ERROR, message: 'WECHAT_PAY_NO_CODE_URL' }
      }
      // code_url 是 `weixin://` 协议，**不能** shell.openExternal（系统没有处理器）；
      // 唯一正确形态是渲染成二维码让用户手机扫。
      let qrDataUrl
      try {
        qrDataUrl = await toQrDataUrl(data.codeUrl)
      } catch (error) {
        return { code: EC.REQUEST_ERROR, message: safeError(error) }
      }
      return {
        code: 0,
        data: {
          orderId: typeof data.orderId === 'string' ? data.orderId : null,
          qrDataUrl,
          expiresAt: typeof data.expiresAt === 'string' ? data.expiresAt : null,
        },
      }
    } catch (error) {
      return { code: EC.REQUEST_ERROR, message: safeError(error) }
    }
  }))

  // 只读轮询：返回服务端订单表当前状态的投影，**不产生任何写副作用**。
  ipcMain.handle('wechat-pay:order-status', withSenderCheck(async (_event, payload) => {
    try {
      const orderId = payload && typeof payload.orderId === 'string' ? payload.orderId : ''
      // 形状先挡一层：不把任意字符串拼进 URL（服务端也会校验，但本地先挡省一次往返）
      if (!/^wp[a-z0-9]{8,64}$/.test(orderId)) {
        return { code: EC.REQUEST_ERROR, message: 'BAD_PARAM' }
      }
      const fetched = await memberRequest({
        payload,
        path: '/api/v1/me/orders/' + orderId,
        method: 'GET',
        // 轮询也要登录态：服务端本来就会 401，但本地先短路能省一次往返，
        // 且避免「未登录 renderer 也能拿订单号去探」的防御深度缺口。
        requireSubject: true,
      })
      if (fetched.code !== 0) return fetched
      const order = (fetched.data && fetched.data.order) || {}
      return {
        code: 0,
        data: {
          orderId: typeof order.id === 'string' ? order.id : orderId,
          status: typeof order.status === 'string' ? order.status : 'pending',
          plan: typeof order.plan === 'string' ? order.plan : null,
        },
      }
    } catch (error) {
      return { code: EC.REQUEST_ERROR, message: safeError(error) }
    }
  }))

  /**
   * 会员中心「订单与账单」列表。
   *
   * **投影而不是透传**：服务端 listOrders 是 SELECT *，含 provider_order_id /
   * provider_sub_id / discount_cents 等内部列。把它们原样交给渲染层等于把供应商侧
   * 标识外泄给一个可能被 XSS 影响的上下文；这里只白名单八个字段。
   */
  ipcMain.handle('wechat-pay:list-orders', withSenderCheck(async () => {
    try {
      const fetched = await memberRequest({
        path: '/api/v1/me/orders',
        method: 'GET',
        requireSubject: true,
      })
      if (fetched.code !== 0) return fetched
      const rows = (fetched.data && Array.isArray(fetched.data.orders)) ? fetched.data.orders : []
      return {
        code: 0,
        data: {
          orders: rows.map((row) => ({
            id: typeof row.id === 'string' ? row.id : '',
            plan: typeof row.plan === 'string' ? row.plan : '',
            amount: Number.isInteger(row.amount) ? row.amount : 0,
            currency: typeof row.currency === 'string' ? row.currency : 'CNY',
            status: typeof row.status === 'string' ? row.status : 'pending',
            period: typeof row.period === 'string' ? row.period : null,
            createdAt: row.created_at ? String(row.created_at) : null,
            paidAt: row.paid_at ? String(row.paid_at) : null,
          })),
        },
      }
    } catch (error) {
      return { code: EC.REQUEST_ERROR, message: safeError(error) }
    }
  }))
}


module.exports = { registerWeChatPayHandlers, pickCheckoutBody }
