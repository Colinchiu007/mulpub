/**
 * ai-writer-api 凭据比较原语（体检报告 P2 安全小项：API Key 非常数时间比较）
 *
 * 原写法 `key !== apiKey` 在第一个不同字节就短路返回：攻击者反复请求并统计响应耗时，
 * 可以逐字节确认「前缀猜对了没」，把破解复杂度从 O(字符集^长度) 降到 O(字符集×长度)。
 * HTTP 场景噪声大，但这是廉价且标准做法（Node 官方 crypto.timingSafeEqual 就是为此存在）。
 *
 * 口径：
 * - 两侧各做 SHA-256 ⇒ 摘要恒为 32 字节，可直接喂 timingSafeEqual（它要求等长，
 *   否则抛 RangeError；用长度判断分支又会把长度信息泄露成耗时差异）；
 * - 空 key / 非字符串一律不通过（fail-closed：绝不允许「两侧都空 ⇒ 相等」放行）；
 * - 纯函数、不依赖 express，便于单测与复用。
 */

var crypto = require("crypto")

function _sha256 (value) {
  return crypto.createHash("sha256").update(value, "utf8").digest()
}

/**
 * @param {any} provided 请求方带来的密钥（X-API-Key 头）
 * @param {any} expected 服务端配置的密钥
 * @returns {boolean} 是否匹配（内容无关的恒定耗时比较；空值恒为 false）
 */
function timingSafeKeyEqual (provided, expected) {
  if (typeof provided !== "string" || typeof expected !== "string") return false
  if (!provided || !expected) return false
  return crypto.timingSafeEqual(_sha256(provided), _sha256(expected))
}

module.exports = { timingSafeKeyEqual }
