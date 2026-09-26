// @ts-check
/**
 * 平台原生 ID（platform_uid）的取值原语 —— 云端账号合并键的身份来源。
 *
 * 三条取数通道（`uidSource: json | html | cookie`）共用这一份收口：
 * 形态白名单与唯一性守卫若各写一份，就会重演本仓「同一判定抄成多份必然漂移」的事故
 * （登录态三态映射 #2433 是前例），而这里漂移的后果是**数据归属**被静默改写。
 */

/**
 * 形态白名单：真实 uid 一律是有限字符集内的短标识。
 * 用白名单而不是黑名单，是因为「不像 uid」的字符串无穷多（页面标题、昵称、
 * 模板占位 `{{userId}}`、整块容器文本），而合法字符集是封闭的。
 */
const UID_VALUE_RE = /^[A-Za-z0-9_.:-]{1,64}$/
/** 形态合法但语义为「无值」的占位字面量（SSR 模板未填充时会原样输出 0/null/undefined） */
const UID_PLACEHOLDER_VALUES = new Set(['0', 'null', 'undefined', 'nan', 'none'])

/**
 * 归一化 uid 候选值。不合规一律返回空串 = 不产出，交由调用方的「uid 缺失」分支处理，
 * 绝不在这里猜一个值出来（合并键错了会把两台设备的不同账号并成一条）。
 * @param {unknown} raw
 * @returns {string}
 */
function normalizeUid (raw) {
  const v = typeof raw === 'number' && Number.isFinite(raw)
    ? String(raw)
    : (typeof raw === 'string' ? raw.trim() : '')
  if (!v) return ''
  if (UID_PLACEHOLDER_VALUES.has(v.toLowerCase())) return ''
  if (!UID_VALUE_RE.test(v)) return ''
  return v
}

/** 从 Cookie 数组按名取首个非空值（cookie 型 uid 来源用） */
function cookieValue (cookies, name) {
  if (!Array.isArray(cookies)) return ''
  for (const c of cookies) {
    if (c && c.name === name && c.value) return String(c.value)
  }
  return ''
}

/**
 * HTML 里可承载平台账号身份的属性名 —— 与页面内 DOM 采集器同一份契约
 * （`packages/shared-utils/src/account-profile.js` 的 idSelectors 通用回退清单）。
 * 两处必须同步，漂移由 http-login-checker-uid-coverage.test.js 的结构锁拦下。
 */
const UID_HTML_ATTRS = ['data-user-id', 'data-account-id', 'data-user']

/**
 * 从服务端直出的 HTML 源码里取平台账号身份属性。
 *
 * 唯一性守卫是这条通道的核心安全条件：创作者中心页面里的评论区、协作成员列表、
 * 推荐作者卡片同样会带 `data-user-id`，那是**别人**的 ID。取「第一个命中」等于把
 * 本机账号的身份绑到一个随机访客上（比取不到更糟——它会静默把两条不同账号合成一条）。
 * 因此命中值不唯一时一律不产出（黑名单语义：不确定就不给结论）。
 * @param {string} html
 * @returns {string} 归一化后的 uid；未命中或不唯一返回空串
 */
function extractUidFromHtml (html) {
  if (!html || typeof html !== 'string') return ''
  /** @type {Set<string>} */
  const found = new Set()
  for (const attr of UID_HTML_ATTRS) {
    // 只认元素属性位（`<tag ... attr="value"`），避免匹配到正文/注释里的同名字符串
    const re = new RegExp('<[a-zA-Z][a-zA-Z0-9_-]*[^>]*?\\b' + attr + '\\s*=\\s*"([^"]{1,80})"', 'g')
    let m = re.exec(html)
    let guard = 0
    while (m !== null && guard++ < 50) {
      const uid = normalizeUid(m[1])
      if (uid) found.add(uid)
      m = re.exec(html)
    }
  }
  if (found.size !== 1) return ''
  return Array.from(found)[0]
}

module.exports = {
  UID_VALUE_RE,
  UID_PLACEHOLDER_VALUES,
  UID_HTML_ATTRS,
  normalizeUid,
  cookieValue,
  extractUidFromHtml,
}
