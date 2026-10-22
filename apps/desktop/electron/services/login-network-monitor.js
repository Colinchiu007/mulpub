// @ts-check
/**
 * login-network-monitor — 登录期网络观测的「按平台覆盖面」与判定口径
 *
 * 为什么独立成模块（2026-10-21，QM-6 外部评审 i4 + 仓内行数门禁硬要求）：
 * `login-network-diagnostics.js` 本刀之后超过 500 行上限
 * （`.github/scripts/check-max-lines.js` 的 NEW_OVER_LIMIT：新代码不得引入超大文件），
 * 且「监测域清单 / 过滤面 / 判定口径」是与「诊断机制」两类关注点，混在一处会互相淹没。
 *
 * 动因：头条号登录链路的请求此前**一条都不记**（过滤面只有微信/腾讯域），
 * 现场复现「点发送验证码后页面灰显好几秒才弹图形验证码」时无从归因 ——
 * 只能靠外部浏览器抓包倒推（实测：页面引用的 `s3a.bytecdn.cn/ta/resource/v0/analytics.js`
 * 被字节自己的边缘节点 504 掉，挂 9~17 秒；验证码组件来自 `sf16-secsdk.ibytedtos.com`
 * 的 `webmssdk.js` 520KB + `sf16-scmcdn-*.ibytedtos.com` 的 `captcha.js` 784KB，冷下载各 ~1.1s）。
 *
 * 这些域是**实测**出来的登录链路资源域，不是拍脑袋的清单；未登记的平台走默认
 * （微信域）过滤面，既有行为与既有契约锁一字不动。
 */

/**
 * 按平台的监测域（实测得来的头条号登录链路资源域）。
 * @type {Record<string, string[]>}
 */
const PLATFORM_MONITORED_HOSTS = {
  toutiao: [
    'toutiao.com',         // mp/sso：登录页与接口域
    'toutiaostatic.com',   // 登录页静态资源（bundle / 图片 / 背景视频）
    'bytecdn.cn',          // 静态 CDN（实测 analytics.js 在此域被 504）
    'ibytedtos.com',       // 风控与验证码 SDK（sf16-secsdk / sf16-scmcdn-*）
    'bytescm.com',
    'bytegoofy.com',
    'ibytedapm.com',
    'snssdk.com',
    'zijieapi.com',
    'bytedance.com'
  ]
}

/**
 * 该平台的监测域清单；未登记的平台返回 null（走默认过滤面）。
 * @param {string} platform
 * @returns {string[]|null}
 */
function monitoredHostsOf (platform) {
  const hosts = PLATFORM_MONITORED_HOSTS[platform]
  return Array.isArray(hosts) && hosts.length > 0 ? hosts : null
}

/**
 * 该平台的 webRequest 过滤面。未登记平台返回**原样**的默认常量（微信域），
 * 保证既有契约锁（onCompleted filter 精确等于微信四条）一字不变。
 * @param {string} platform
 * @param {string[]} defaultFilters
 * @returns {string[]}
 */
function urlFiltersFor (platform, defaultFilters) {
  const hosts = monitoredHostsOf(platform)
  if (!hosts) return defaultFilters
  const urls = []
  for (const host of hosts) {
    urls.push('*://' + host + '/*')
    urls.push('*://*.' + host + '/*')
  }
  return urls
}

/**
 * URL 的主机名（解析失败返回空串）。
 * @param {string} url
 * @returns {string}
 */
function hostOf (url) {
  if (typeof url !== 'string' || !url) return ''
  try { return new URL(url).hostname } catch (_e) { return '' }
}

/**
 * URL 的路径部分（解析失败返回空串）。
 * @param {string} url
 * @returns {string}
 */
function pathOf (url) {
  if (typeof url !== 'string' || !url) return ''
  try { return new URL(url).pathname } catch (_e) { return '' }
}

/**
 * 监测域匹配器：按平台编译一次，事件流里不再逐请求遍历域数组
 * （2026-10-21 CCG 外部评审 i6：原先每个请求都线性扫一遍 hosts 并重复解析主机名）。
 * @type {Map<string, RegExp>}
 */
const hostMatcherCache = new Map()

/**
 * 取该平台的监测域正则（编译一次后复用）。
 * ⚠️ 域名里的**全部**正则元字符都要转义（2026-10-21 CCG 外部评审 i6）：
 * 只转义 `.` 时，将来某个平台域名里出现 `+`/`(` 之类的字符就会**静默**改变匹配语义。
 * @param {string} platform
 * @returns {RegExp|null}
 */
function hostMatcherOf (platform) {
  if (hostMatcherCache.has(platform)) return hostMatcherCache.get(platform) || null
  const hosts = monitoredHostsOf(platform)
  const matcher = hosts
    ? new RegExp('(^|\\.)(' + hosts.map(function (h) { return h.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') }).join('|') + ')$')
    : null
  hostMatcherCache.set(platform, matcher)
  return matcher
}

/**
 * URL 是否落在该平台的监测域内（主域与子域都算）。
 * @param {string} platform
 * @param {string} url
 * @returns {boolean}
 */
function isMonitoredHost (platform, url) {
  const matcher = hostMatcherOf(platform)
  if (!matcher) return false
  const host = hostOf(url)
  if (!host) return false
  return matcher.test(host)
}

/**
 * 图形验证码组件的资源标记（实测字节风控 SDK 的两个包）。
 * 这两个包的加载完成时刻 = 用户点「获取验证码」后灰显遮罩的结束时刻。
 *
 * 标记匹配的是**路径**而不是整条 URL（2026-10-21 CCG 外部评审 i5）：
 * 整条 URL 上做 `indexOf` 会把 `?x=webmssdk.js` 这类查询串、乃至别的域下同名路径
 * 一并命中 ⇒ 验证码组件日志误报、真正的组件加载反而淹没在噪声里。
 * 路径锚点用 `/webmssdk/`（版本目录，实测形态
 * `/obj/rc-web-sdk-giso/webmssdk/1.0.0.303/webmssdk.js`）而不是文件名 ——
 * 免得 `/proxy/webmssdk.js` 这类同尾路径误中。
 */
const CAPTCHA_SDK_MARKERS = ['/secsdk-captcha/', '/webmssdk/']

/**
 * @param {string} url
 * @returns {boolean}
 */
function isCaptchaSdkUrl (url) {
  const path = pathOf(url)
  if (!path) return false
  return CAPTCHA_SDK_MARKERS.some(function (m) { return path.indexOf(m) !== -1 })
}

/** 慢请求阈值（毫秒）：超过即认为「这一步卡了」。可经 MP_LOGIN_SLOW_REQUEST_MS 覆盖。 */
const DEFAULT_SLOW_REQUEST_MS = 3000

/**
 * @param {object} env
 * @returns {number}
 */
function resolveSlowRequestMs (env) {
  const src = env || process.env
  const raw = src && src.MP_LOGIN_SLOW_REQUEST_MS
  if (raw === undefined || raw === null || raw === '') return DEFAULT_SLOW_REQUEST_MS
  const n = Number(raw)
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_SLOW_REQUEST_MS
  return Math.min(n, 600000)
}

/**
 * 只观察「请求耗时」的平台：enable Network 后按 requestId 记发起时刻，
 * 结束时算耗时，超过阈值即记一条慢请求。只读事件、不拦截、不改写。
 * 头条号是第一个：登录链路的资源域多、失败面大（实测字节自家 CDN 会 504），
 * 而此前该平台一条请求都不记 ⇒ 现场只能靠外部抓包倒推。
 */
const TIMING_OBSERVE_PLATFORMS = ['toutiao']

/** 慢请求日志上限：登录页一次能拉几十个资源，全记会淹掉日志。 */
const SLOW_REQUEST_LOG_LIMIT = 20

module.exports = {
  PLATFORM_MONITORED_HOSTS,
  TIMING_OBSERVE_PLATFORMS,
  CAPTCHA_SDK_MARKERS,
  DEFAULT_SLOW_REQUEST_MS,
  SLOW_REQUEST_LOG_LIMIT,
  monitoredHostsOf,
  urlFiltersFor,
  hostOf,
  pathOf,
  hostMatcherOf,
  isMonitoredHost,
  isCaptchaSdkUrl,
  resolveSlowRequestMs
}
