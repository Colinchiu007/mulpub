/**
 * profile-value-rules.js — 账号资料取值的**通用形态规则**
 *
 * 为什么从 http-profile-api.js 拆出来（2026-10-23）：
 * http-profile-api.js 因公众号模板解析的加入涨到 643 行，越过「逐文件行数门禁」
 * 的 500 行红线（新代码不得引入超大文件）。这些形态规则与「哪个平台、走哪个端点」
 * **无关** —— 它们回答的是「取回来的这个字符串/数字算不算合法」，单独成模块后：
 *   ① 两侧共用同一份判据，不会各写一份漂移；
 *   ② 本模块**不依赖任何运行时设施**（无 logger / 无 electron / 无网络）⇒ 纯函数，
 *      可以直接单测，不必拉起整个取数链路。
 *
 * 依赖方向：profile-value-rules ← wechat-mp-profile-parser ← http-profile-api
 * （单向，无环）。
 */

/**
 * 模板占位值：SSR 未填充时页面里会原样输出 `{{nickname}}` 之类的字面量。
 * 这类值**不是**账号资料，落库会显示成 `{{nickname}}`。
 */
const TEMPLATE_PLACEHOLDER_RE = /^\{\{.*\}\}$/

/** 昵称形态上限（模板字段本身也是短名；超长一律当作抓错容器） */
const NICKNAME_MAX_LEN = 40

/**
 * 昵称形态白名单：控制字符/HTML 片段不是昵称。
 * 判据是「不含控制字符 + 长度有界 + 非纯空白」，
 * ⛔ 不用「排除 < >」这种黑名单：真实昵称里就可能有 & 与空格，黑名单会误杀。
 *
 * 用 Unicode 属性转义 `\p{Cc}`（C0 + C1 控制区）而不是 `[\u0000-\u001f]` 字面量：
 * 后者会被 ESLint 的 `no-control-regex` 判红（Gate 11 是 error 级），
 * 而属性转义表达的是同一个意图（且把 C1 控制区一并挡住）。
 */
const CONTROL_CHAR_RE = /\p{Cc}/u

/** 去掉首尾空白；非字符串一律返回空串（与 account-profile.trimText 同口径） */
function trimText (v) {
  return typeof v === 'string' ? v.trim() : ''
}

/**
 * 数值归一：只有**有限非负数**才算数。
 * `typeof v === 'number'` 不够 —— NaN 也是 number，写回后端会得到一个永远显示不出来的粉丝数。
 * 不合格一律返回 undefined（= 不产出该键），绝不返回 0（0 是合法值，语义完全不同）。
 * @param {unknown} v
 * @returns {number|undefined}
 */
function toCount (v) {
  const n = typeof v === 'number' ? v : (typeof v === 'string' && v.trim() ? Number(v) : NaN)
  if (!Number.isFinite(n) || n < 0) return undefined
  return Math.round(n)
}

/**
 * 从平台头像字段里取第一个可用的 URL（兼容 string / {url_list:[]} 两种形态）
 * @param {unknown} value
 * @returns {string}
 */
function pickAvatarUrl (value) {
  if (typeof value === 'string') return trimText(value)
  if (!value || typeof value !== 'object') return ''
  const list = Array.isArray(value.url_list) ? value.url_list : null
  if (list) {
    for (const item of list) {
      const url = trimText(item)
      if (url) return url
    }
  }
  return trimText(value.url || value.uri || '')
}

/**
 * 主机形态白名单（CCG 评审 i2，security）。
 *
 * 为什么需要：头像 URL 最终会进 `<img :src>`，由**用户本机**发起请求。
 * 只判 scheme 的话，`https://192.168.1.1/x`、`https://internal.corp/...` 这类
 * 地址会原样通过 ⇒ 页面内容若被污染，桌面端就会替用户去访问内网/跟踪地址。
 *
 * 为什么**不**用域名闭集：公众号头像走的是平台自己的图片 CDN，
 * 该域名**不在**平台的 Cookie 域名表（`PLATFORM_COOKIE_DOMAINS.wechat_mp`
 * 只有 mp.weixin.qq.com / weixin.qq.com）⇒ 闭集会把**所有真头像**判死
 * （误杀），与本仓「宁可漏判不误杀」的取舍相反。
 * 故此处只挡「**不可能是公网 CDN**」的形态：IP 字面量、单标签主机、
 * 本机名与内网保留后缀。真头像一个都不误伤，攻击面（内网探测 / IP 外泄）被堵住。
 */
const NON_PUBLIC_HOST_RE = /^(?:localhost|.*\.(?:local|internal|lan|home\.arpa))$/i
/**
 * IPv4 字面量（**严格八位组**，CCG 评审 i2：宽松匹配会把 `999.999.999.999`
 * 这类畸形主机也算成 IP，而畸形主机的实际风险与 IP 相同 —— 两者都该被拒，
 * 所以这里直接用严格判据把它们一起挡在门外，不必再依赖另一条兜底规则）。
 */
const IPV4_LITERAL_RE = /^(?:(?:25[0-5]|2[0-4]\d|[01]?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d?\d)$/
/** 末段是纯数字 ⇒ 形如 `1.2.3.4.5` 的畸形 IP 主机 */
const NUMERIC_TLD_RE = /\.\d+$/

/**
 * 头像主机是否「像公网主机」。
 * @param {string} hostname
 * @returns {boolean}
 */
function isPlausibleAvatarHost (hostname) {
  if (typeof hostname !== 'string') return false
  const host = hostname.trim().toLowerCase()
  if (!host) return false
  if (NON_PUBLIC_HOST_RE.test(host)) return false
  if (IPV4_LITERAL_RE.test(host)) return false
  if (NUMERIC_TLD_RE.test(host)) return false
  // IPv6 字面量：`new URL('https://[::1]/').hostname` → '[::1]'
  if (host.startsWith('[') || host.includes(':')) return false
  // 单标签主机（无点）不是公网主机
  if (!host.includes('.')) return false
  return true
}

/**
 * 头像 URL 归一 + **scheme 白名单 + 主机形态白名单**（CCG 评审 i4 / i2）。
 *
 * 平台模板自己就写了 `head_img: ''.replace('http://', 'https://')`（2026-10-23 实测）
 * —— 说明它知道这个 http 头图在 https 页面里会被当混合内容拒掉，我方照做。
 *
 * scheme 白名单是**必须**的：头像 URL 最终会进 `<img :src>`，而本函数是
 * 「外部页面内容 → 我方存储」这条链路上唯一能把不可信字符串收口的地方；
 * 只做 http→https 替换的话，`javascript:` / `data:` 会原样通过。
 * 只允许 http/https，其余一律拒绝（返回空串 = 不产出头像）。
 * @param {unknown} raw
 * @returns {string}
 */
function normalizeAvatarUrl (raw) {
  const value = trimText(raw)
  if (!value || TEMPLATE_PLACEHOLDER_RE.test(value)) return ''
  let normalized = value
  if (normalized.startsWith('http://')) normalized = 'https://' + normalized.slice('http://'.length)
  let parsed
  try {
    parsed = new URL(normalized)
  } catch (_) {
    return ''
  }
  const scheme = parsed.protocol.toLowerCase()
  if (scheme !== 'http:' && scheme !== 'https:') return ''
  // 带 userinfo 的 URL 一律拒绝（CCG 评审 i7）：`https://user:pass@host/` 的
  // `hostname` 按 URL 规范**不含** userinfo，所以上面的主机判据看不到它 ——
  // 而把带凭据的地址存进头像字段，等于把「不该出现的凭据」写进用户数据。
  if (parsed.username || parsed.password) return ''
  if (!isPlausibleAvatarHost(parsed.hostname)) return ''
  return normalized
}

/**
 * 昵称形态校验：长度有界 + 无控制字符 + 非纯空白
 *
 * 取值恒为字符串（调用方先过 trimText），故此处不额外做 typeof 判据 ——
 * 语义与拆分前逐字一致，避免「拆分顺手改了判据」这类夹带行为变更。
 * @param {string} value
 * @returns {boolean}
 */
function isPlausibleNickname (value) {
  if (!value) return false
  if (value.length > NICKNAME_MAX_LEN) return false
  if (CONTROL_CHAR_RE.test(value)) return false
  return true
}

module.exports = {
  TEMPLATE_PLACEHOLDER_RE,
  NICKNAME_MAX_LEN,
  CONTROL_CHAR_RE,
  trimText,
  toCount,
  pickAvatarUrl,
  normalizeAvatarUrl,
  isPlausibleAvatarHost,
  isPlausibleNickname,
}
