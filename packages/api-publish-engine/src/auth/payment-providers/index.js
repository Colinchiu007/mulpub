'use strict'
/**
 * PaymentProvider 抽象（通道无关契约）。
 *
 * 为什么只有三个方法：上游 DESIGN-MEMBER-CENTER-P2-PAYMENT-2026-09-24.md §3 定义了六方法
 * （含 cancelSubscription / changePlan），那是为 MoR 托管订阅（Paddle/Lemon Squeezy）设计的。
 * 微信 Native 是 PSP 直连，**没有订阅 ID**（每次下单独立）、没有 API 取消/改套餐语义。
 * 对空气设计这两个方法正是上游 R-A 红线警告的事——故收缩为三方法，能力声明全部为 false
 * 是诚实的数据，UI 据此隐藏对应入口（上游 §10.3 的能力驱动文案机制保留但本期全走 false 分支）。
 *
 * 归一化事件形状与上游 §3 对齐但收缩：只保留本期真正会到来的三类事件。
 */

/** 验签失败专用错误：调用方必须映射 401，且**不得入库不得改变任何订阅状态**。 */
class WebhookSignatureError extends Error {
  constructor(code, message, status = 401) {
    super(message || code)
    this.name = 'WebhookSignatureError'
    this.code = code
    this.status = status
  }
}

/** 供应商上游故障（下单超时/返回错误）：调用方映射 502，订单留 pending。 */
class PaymentProviderError extends Error {
  constructor(code, message, status = 502) {
    super(message || code)
    this.name = 'PaymentProviderError'
    this.code = code
    this.status = status
  }
}

// 归一化事件类型。checkout.completed 是唯一会推进订阅状态的；payment.failed / refunded
// 本期只记录不动订阅（无自助退款功能）。
const NORMALIZED_EVENT_TYPES = Object.freeze([
  'checkout.completed',
  'payment.failed',
  'refunded',
])

/**
 * 抽象基类。子类必须实现三个方法；capabilities() 有默认实现（全 false），
 * 因为「什么都不支持」是安全的默认值——漏声明等于该功能不出现，而不是默认可点。
 */
class PaymentProvider {
  constructor(options = {}) {
    if (new.target === PaymentProvider) {
      throw new TypeError('PaymentProvider 是抽象类，不得直接实例化')
    }
    this.logger = options.logger || null
  }

  /** 创建一次结账会话，返回收银台所需的载荷。微信 Native 返回 code_url（转二维码用）。 */
  // eslint-disable-next-line no-unused-vars
  async createCheckout({ orderId, plan, period, amountCents, currency, attach }) {
    throw new TypeError('createCheckout 未实现')
  }

  /** 解析并验签 webhook 原始请求 → 归一化事件。验签失败抛 WebhookSignatureError。 */
  // eslint-disable-next-line no-unused-vars
  async parseWebhook({ rawBody, headers }) {
    throw new TypeError('parseWebhook 未实现')
  }

  /** 通道能力声明（供上层降级决策）。默认全 false = 安全默认值。 */
  capabilities() {
    return {
      immediateCancel: false,
      refunds: false,
      proration: false,
      autoRenewToggle: false,
      trial: false,
      coupons: false,
      customerPortal: false,
    }
  }

  _log(level, message, meta) {
    if (this.logger && typeof this.logger[level] === 'function') {
      this.logger[level](message, meta)
    }
  }
}

module.exports = {
  PaymentProvider,
  WebhookSignatureError,
  PaymentProviderError,
  NORMALIZED_EVENT_TYPES,
}
