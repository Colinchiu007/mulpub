/**
 * wechat-pay.js — 微信支付 preload 桥接。
 *
 * 方法名刻意用 `wechatPay*` 而**不是** `payment*`：
 * `buyout-removal.contract.test.js` 用 `/\bpayment[A-Z]\w+/` 锁「买断形态不回归」，
 * 复用旧名会与那把锁正面冲突。新命名 = 新语义（服务端下单 + 二维码，非本地 mock）。
 *
 * 两个方法都只返回**已归一化**的窄对象：
 *   - createOrder 返回 { orderId, qrDataUrl, expiresAt }（**不含 code_url 原文**：
 *     渲染层不需要 `weixin://` 协议串，也就没有"顺手 openExternal"的机会）
 *   - orderStatus 返回 { orderId, status, plan }
 */
function createWeChatPayApi (ipcRenderer) {
  return {
    wechatPayCreateOrder: (payload) => ipcRenderer.invoke('wechat-pay:create-order', payload),
    wechatPayOrderStatus: (payload) => ipcRenderer.invoke('wechat-pay:order-status', payload),
    wechatPayListOrders: () => ipcRenderer.invoke('wechat-pay:list-orders'),
  }
}

module.exports = { createWeChatPayApi }
