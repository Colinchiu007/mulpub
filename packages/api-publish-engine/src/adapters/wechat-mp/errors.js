'use strict'
/**
 * 微信公众号 API 轨 —— 结构化错误
 *
 * 为什么要独立错误类：`publishViaApi()` 把 `{success:false}` 转成 throw
 * （src/index.js:95），并在那一步丢掉结构化信息。会话/上传/草稿三段
 * 需要把「哪一种失败」带到上层日志与用户文案里，因此用自定义错误携带 code。
 */

class WechatMpError extends Error {
  /**
   * @param {string} code  见 PRD §D9 错误码表
   * @param {string} message 面向用户的文案（可操作优先）
   * @param {object} [detail] 诊断明细（不得含 cookie/token 明文）
   */
  constructor (code, message, detail) {
    super(message)
    this.name = 'WechatMpError'
    this.code = code
    this.platform = 'wechat_mp'
    if (detail !== undefined) this.detail = detail
  }
}

module.exports = { WechatMpError }
