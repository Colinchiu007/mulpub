/**
 * Platform Definitions — 平台元数据单一数据源
 *
 * 集中管理所有平台的登录 URL、显示名称、Dashboard URL、登录检测模式/选择器。
 * 所有 Electron 主进程模块从此文件引入，消除 6+ 处重复定义。
 *
 * 覆盖 15 个平台：
 *   wechat_mp, zhihu, weibo, douyin, xiaohongshu
 *   tencent_video, kuaishou, toutiao, bilibili, baijiahao
 *   youtube, tiktok, twitter, instagram, facebook
 *
 * 新增平台时只需在此文件添加一条记录，并确保 config/platforms.yaml 有对应配置。
 * 各消费者模块无需修改。
 *
 * @see config/platforms.yaml — 平台级配置（类型、URL、尺寸限制等）
 */

// ─── 登录页 URL ────────────────────────────
// 内嵌浏览器打开登录页时使用
const PLATFORM_LOGIN_URLS = {
  wechat_mp: 'https://mp.weixin.qq.com/',
  zhihu: 'https://www.zhihu.com/signin',
  weibo: 'https://weibo.com/login',
  douyin: 'https://creator.douyin.com/',
  xiaohongshu: 'https://creator.xiaohongshu.com/',
  tencent_video: 'https://channels.weixin.qq.com/',
  kuaishou: 'https://cp.kuaishou.com/',
  toutiao: 'https://mp.toutiao.com/',
  bilibili: 'https://passport.bilibili.com/login',
  baijiahao: 'https://baijiahao.baidu.com/',
  youtube: 'https://studio.youtube.com/',
  tiktok: 'https://www.tiktok.com/upload/',
  twitter: 'https://twitter.com/i/flow/login',
  instagram: 'https://www.instagram.com/accounts/login/',
  facebook: 'https://www.facebook.com/login/',
}

// ─── 创作者后台/Dashboard URL（分屏监控用）───
const PLATFORM_DASHBOARD_URLS = {
  wechat_mp: 'https://mp.weixin.qq.com/',
  zhihu: 'https://www.zhihu.com/',
  weibo: 'https://weibo.com/',
  douyin: 'https://creator.douyin.com/',
  xiaohongshu: 'https://creator.xiaohongshu.com/',
  tencent_video: 'https://channels.weixin.qq.com/',
  kuaishou: 'https://cp.kuaishou.com/',
  toutiao: 'https://mp.toutiao.com/',
  bilibili: 'https://member.bilibili.com/',
  baijiahao: 'https://baijiahao.baidu.com/',
  youtube: 'https://studio.youtube.com/',
  tiktok: 'https://www.tiktok.com/',
  twitter: 'https://twitter.com/home',
  instagram: 'https://www.instagram.com/',
  facebook: 'https://www.facebook.com/',
}

// ─── 登录成功后 URL 特征（URL 包含检测）──────
// auth-view-manager 使用 URL 变化检测登录完成
const PLATFORM_LOGIN_SUCCESS_PATTERNS = {
  wechat_mp: ['cgi-bin/home', 'cgi-bin/appmsg'],
  zhihu: ['zhihu.com/people', 'zhihu.com/home', 'zhuanlan.zhihu.com', 'www.zhihu.com/creator'],
  weibo: ['weibo.com/home', 'weibo.com/u/'],
  douyin: ['douyin.com'],
  xiaohongshu: ['creator.xiaohongshu.com'],
  // 视频号登录页与创作后台同域（channels.weixin.qq.com）：登录页为
  // /login.html（参考产品 authorizeUrl 同款），裸域名模式会把预登录登录页
  // 误判为“登录成功”，导致登录视图提前关闭并保存只有预登录 localStorage
  // 的无 Cookie 凭证（E2E 实测 cookies=0）。登录成功后的创作者后台路径为
  // /platform，据此精确匹配。
  tencent_video: ['channels.weixin.qq.com/platform'],
  // 快手登录页在独立域 passport.kuaishou.com/pc/account/login，登录成功后由平台自己的
  // 回调跳板 cp.kuaishou.com/rest/infra/sts 送回 cp.kuaishou.com/profile。
  // 2026-09-25 实测：未登录访问 cp.kuaishou.com/ 也会被前端路由到同一个 /profile
  // （只渲染营销壳），所以 cp 域无法靠路径区分登录态，必须靠 hasPlatformSessionCookie
  // 的会话凭证判定；而 passport 是纯登录域，任何路径都不可能是登录成功信号。
  // 此前 passport.kuaishou.com 被同时列入 AUTH_HOSTS 与成功模式，导致登录视图刚打开
  // 就被判「登录成功」，把只有埋点 Cookie 的登录页存成有效账号（账号名即登录页标题）。
  kuaishou: ['cp.kuaishou.com'],
  // 头条号登录页与创作后台同域（mp.toutiao.com）：未登录访问会 302 到
  // /login（2026-09-13 实测），裸域名模式会把预登录登录页误判为“登录成功”，
  // 导致登录视图提前关闭并保存无效账号（与百家号同款 bug）。
  // 登录成功后的创作者中心路径为 /profile_v4/...，据此精确匹配。
  toutiao: ['profile_v4'],
  bilibili: ['www.bilibili.com/', 'member.bilibili.com/'],
  // 百家号登录页与创作后台同域：未登录访问 baijiahao.baidu.com/ 会 302 到
  // /pcui/register/index 与 /builder/theme/bjh/login（2026-08-12 实测），裸域名
  // 模式会把预登录登录页误判为“登录成功”，导致登录视图提前关闭并保存无效账号。
  // 该平台关闭 URL 自动完成，改由用户点击“我已完成登录”（auth:complete-login）
  // 在提取到真实凭证后完成入库。
  baijiahao: [],
  youtube: ['studio.youtube.com', 'accounts.google.com/o/oauth2/approval'],
  tiktok: ['tiktok.com/upload'],
  twitter: ['twitter.com/home', 'twitter.com/explore', 'x.com/home', 'x.com/explore'],
  instagram: ['instagram.com/'],
  facebook: ['facebook.com/'],
}

// 登录完成判定和凭证提取共用的可信域名边界。
// 只允许明确的创作者/平台域名，避免把 query/hash 中伪造的成功路径当成登录完成。
const PLATFORM_AUTH_HOSTS = {
  wechat_mp: ['mp.weixin.qq.com'],
  zhihu: ['www.zhihu.com', 'zhihu.com', 'zhuanlan.zhihu.com'],
  weibo: ['weibo.com', 'www.weibo.com'],
  douyin: ['www.douyin.com', 'creator.douyin.com'],
  xiaohongshu: ['creator.xiaohongshu.com'],
  tencent_video: ['channels.weixin.qq.com'],
  // 不含 passport.kuaishou.com：那是登录域，见上方成功模式注释。Cookie 采集域
  // （PLATFORM_COOKIE_DOMAINS）仍保留它，登录态由根域 Cookie 承载，不受影响。
  kuaishou: ['cp.kuaishou.com'],
  toutiao: ['mp.toutiao.com'],
  bilibili: ['www.bilibili.com', 'bilibili.com', 'member.bilibili.com'],
  baijiahao: ['baijiahao.baidu.com'],
  youtube: ['studio.youtube.com', 'accounts.google.com'],
  tiktok: ['www.tiktok.com', 'tiktok.com'],
  twitter: ['twitter.com', 'www.twitter.com', 'x.com', 'www.x.com'],
  instagram: ['www.instagram.com', 'instagram.com'],
  facebook: ['www.facebook.com', 'facebook.com'],
}

// 平台可能使用父域 Cookie；仍然限定在对应平台的根域内。
const PLATFORM_COOKIE_DOMAINS = {
  wechat_mp: ['mp.weixin.qq.com', 'weixin.qq.com'],
  tencent_video: ['channels.weixin.qq.com', 'weixin.qq.com'],
  zhihu: ['zhihu.com'],
  weibo: ['weibo.com', 'sina.com.cn'],
  douyin: ['douyin.com'],
  xiaohongshu: ['xiaohongshu.com'],
  kuaishou: ['kuaishou.com', 'passport.kuaishou.com'],
  toutiao: ['toutiao.com'],
  bilibili: ['bilibili.com'],
  // BDUSS/BAIDUID 等真实登录态由 passport.baidu.com 设置在 .baidu.com 父域上，
  // 仅白名单 baijiahao.baidu.com/passport.baidu.com 会把登录态静默滤掉导致发布失败。
  baijiahao: ['baijiahao.baidu.com', 'passport.baidu.com', 'baidu.com'],
  youtube: ['youtube.com', 'studio.youtube.com', 'accounts.google.com'],
  tiktok: ['tiktok.com'],
  twitter: ['twitter.com', 'x.com'],
  instagram: ['instagram.com'],
  facebook: ['facebook.com'],
}

// 平台 localStorage 会话标记：部分平台（如视频号）登录态依赖 localStorage 而非仅 Cookie。
// 供 checkLocalCredentials 判定 cookies=0 的快照是否仍能构成有效凭证；值为非空即视为会话证据。
// 未列入的平台视为不依赖 localStorage 登录态。新增标记键必须以 CDP 实测取证为准，
// 且不得混入埋点/上报类噪声键（__ml::aid、UvFirstReportLocalKey 等）。
const PLATFORM_LS_SESSION_MARKERS = {
  tencent_video: ['finder_username'],
}

/**
 * 判定 localStorage 是否含有该平台已知会话标记的非空值。
 * @param {string} platform
 * @param {Object} localStorageData
 * @returns {boolean}
 */
function hasPlatformLsSessionMarker (platform, localStorageData) {
  const markers = PLATFORM_LS_SESSION_MARKERS[platform]
  if (!Array.isArray(markers) || markers.length === 0) return false
  if (!localStorageData || typeof localStorageData !== 'object') return false
  return markers.some(key => {
    const value = localStorageData[key]
    return typeof value === 'string' ? value.trim().length > 0 : Boolean(value)
  })
}

function normalizeHost (value) {
  return String(value || '').trim().toLowerCase().replace(/^\.+/, '').replace(/\.$/, '')
}

// 平台会话凭证标记：登录页本身也会写入埋点 Cookie，「有 Cookie」不等于「已登录」。
// 快手实测：未登录访问 cp.kuaishou.com 即有 did/wid/kwssectoken/kwpsecproductname/
// kwfv1/kwscode 六个匿名 Cookie，登录成功后才出现 kuaishou.web.cp.api_st（会话票据，
// 名字即登录 URL 里的 sid）、userId 与 bUserId。因此凡声明了标记的平台，登录完成
// 与凭证入库都必须命中其中至少一个非空值；未声明的平台沿用既有行为。
// 新增标记键必须以真实登录态 DevTools/CDP 实测取证为准，且不得混入设备/埋点标识
// （did、_did、wid、divid 等一律不可用）。
const PLATFORM_SESSION_COOKIE_MARKERS = {
  kuaishou: ['kuaishou.web.cp.api_st', 'userId', 'bUserId'],
}

/**
 * 判定已采集的 Cookie 是否构成该平台的真实登录态。
 * @param {string} platform
 * @param {Array<{name?: string, value?: string}>} cookies
 * @returns {boolean} 未声明标记的平台返回 true（不改变既有行为）
 */
function hasPlatformSessionCookie (platform, cookies) {
  const markers = PLATFORM_SESSION_COOKIE_MARKERS[platform]
  if (!Array.isArray(markers) || markers.length === 0) return true
  if (!Array.isArray(cookies)) return false
  return cookies.some(cookie => {
    if (!cookie || !markers.includes(cookie.name)) return false
    const value = cookie.value
    return typeof value === 'string' ? value.trim().length > 0 : Boolean(value)
  })
}

/**
 * @param {string} platform
 * @param {string} hostname
 * @returns {boolean}
 */
function isPlatformAuthHost (platform, hostname) {
  const normalized = normalizeHost(hostname)
  return (PLATFORM_AUTH_HOSTS[platform] || []).some(host => normalizeHost(host) === normalized)
}

/**
 * @param {string} platform
 * @param {string} rawUrl
 * @returns {boolean}
 */
function isPlatformLoginSuccessUrl (platform, rawUrl) {
  let parsed
  try { parsed = new URL(String(rawUrl)) } catch (_) { return false }
  if (!['http:', 'https:'].includes(parsed.protocol)) return false
  if (!isPlatformAuthHost(platform, parsed.hostname)) return false
  try {
    const loginUrl = new URL(PLATFORM_LOGIN_URLS[platform])
    const normalizePath = pathname => pathname.replace(/\/+$/, '') || '/'
    if (
      parsed.origin === loginUrl.origin &&
      normalizePath(parsed.pathname) === normalizePath(loginUrl.pathname)
    ) return false
  } catch (_) { /* 未配置登录页时由下方模式匹配决定 */ }
  const haystack = `${parsed.hostname}${parsed.pathname}${parsed.search}`.toLowerCase()
  return (PLATFORM_LOGIN_SUCCESS_PATTERNS[platform] || [])
    .some(pattern => haystack.includes(String(pattern).toLowerCase()))
}

/**
 * 判断 Cookie domain 是否属于指定平台，允许平台配置的父域。
 * @param {string} platform
 * @param {string} domain
 * @returns {boolean}
 */
function isPlatformCookieDomain (platform, domain) {
  const normalized = normalizeHost(domain)
  if (!normalized) return false
  return (PLATFORM_COOKIE_DOMAINS[platform] || []).some(host => {
    const candidate = normalizeHost(host)
    // baidu.com 父域条目只允许精确匹配（BDUSS 由 passport 设置在 .baidu.com），
    // 不允许任意 *.baidu.com 子域 cookie 冒充（例如 .evil.baidu.com）。
    if (candidate === 'baidu.com') return normalized === 'baidu.com'
    return normalized === candidate || normalized.endsWith(`.${candidate}`)
  })
}

// ─── 登录成功 CSS 选择器（DOM 检测）──────────
// 用于 Playwright / RPA 引擎页面内检测登录状态
const PLATFORM_LOGIN_SUCCESS_SELECTORS = {
  wechat_mp: ['.index_main', '.menu_box', 'a[href*="cgi-bin/home"]'],
  zhihu: ['.AppHeader-profileAvatar', '.ProfileHeader-avatar', 'img[alt="avatar"]', '[class*="ProfileHeader"]'],
  weibo: ['.gn_name', '.Avatar', '[node-type="userInfo"]'],
  douyin: ['.user-info', '.account-info', '.creator-header'],
  xiaohongshu: ['[class*="avatar"]', '[class*="userInfo"]', '.user-avatar'],
  tencent_video: ['.channel-header', '.creator-header', '[class*="weixinChannel"]'],
  kuaishou: ['.user-info', '.profile-avatar', '[class*="creator-header"]'],
  toutiao: ['.user-avatar', '.header-avatar', '[class*="avatar"]', '.nickname'],
  bilibili: [],
  baijiahao: ['.user-info', '.user-avatar', '.nickname', '[class*="user"]'],
  youtube: ['#avatar-btn', 'ytcp-avatar', '[class*="avatar"]'],
  tiktok: ['[data-testid="user-avatar"]', '[class*="avatar"]', '.user-avatar'],
  twitter: ['div[data-testid="primaryColumn"]', 'div[data-testid="SideNav_AccountSwitcher_Button"]', 'header[role="banner"]'],
  instagram: ['svg[aria-label="Home"]', 'nav[role="navigation"]', 'section main article', 'a[href="/direct/inbox/"]'],
  facebook: ['a[aria-label*="profile"]', 'a[aria-label*="Profile"]', 'div[aria-label*="Account"]', 'div[data-pagelet*="root"]'],
}

// ─── 平台账号信息提取选择器（昵称/粉丝/平台ID）──────
// 用于 Playwright 页面内提取账号信息；各平台按创作者中心 DOM 定制。
// 字段：nickname(昵称), followers(粉丝数), platformAccountId(平台用户ID)
const PLATFORM_ACCOUNT_INFO_SELECTORS = {
  wechat_mp: { nickname: ['.weui-desktop-account__name'], followers: ['.weui-desktop-account__fans'], platformAccountId: ['[data-account-id]'] },
  zhihu: { nickname: ['.ProfileHeader-name', '.AppHeader-profileAvatar + *'], followers: ['.NumberBoard-itemValue'], platformAccountId: ['[data-account-id]'] },
  weibo: { nickname: ['.gn_name', '.ProfileHeader-name'], followers: ['.gn_count span'], platformAccountId: ['[data-account-id]'] },
  douyin: { nickname: ['.user-name', '[class*="user-name"]'], followers: ['.fans-count', '[class*="fans"]'], platformAccountId: ['[data-account-id]'] },
  xiaohongshu: { nickname: ['.user-name', '[class*="user-name"]'], followers: ['.fans-count', '[class*="fans"]'], platformAccountId: ['[data-account-id]'] },
  tencent_video: { nickname: ['.channel-name', '[class*="channel-name"]'], followers: ['.fans-count', '[class*="fans"]'], platformAccountId: ['[data-account-id]'] },
  kuaishou: { nickname: ['.user-name', '[class*="user-name"]'], followers: ['.fans-count', '[class*="fans"]'], platformAccountId: ['[data-account-id]'] },
  toutiao: { nickname: ['.nickname', '[class*="nickname"]'], followers: ['.fans-count', '[class*="fans"]'], platformAccountId: ['[data-account-id]'] },
  bilibili: { nickname: ['.nickname', '[class*="nickname"]'], followers: ['.fans-count', '[class*="fans"]'], platformAccountId: ['[data-account-id]'] },
  baijiahao: { nickname: ['.user-name', '[class*="user-name"]'], followers: ['.fans-count', '[class*="fans"]'], platformAccountId: ['[data-account-id]'] },
  youtube: { nickname: ['#channel-name', '#text.ytd-channel-name'], followers: ['#subscriber-count'], platformAccountId: ['[data-account-id]'] },
  tiktok: { nickname: ['[data-e2e="user-title"]'], followers: ['[data-e2e="followers-count"]'], platformAccountId: ['[data-account-id]'] },
  twitter: { nickname: ['[data-testid="UserName"]'], followers: ['[href*="verified_followers"]'], platformAccountId: ['[data-account-id]'] },
  instagram: { nickname: ['h1'], followers: ['[href*="/followers/"]'], platformAccountId: ['[data-account-id]'] },
  facebook: { nickname: ['h1'], followers: ['[href*="/followers"]'], platformAccountId: ['[data-account-id]'] },
}

// ─── 平台展示元数据 ───────────────────────────
// JSON 同时被 Vite 浏览器端与 CommonJS 主进程消费，避免跨模块复制和 CJS 命名导入失败。
const { PLATFORM_NAMES, PLATFORM_ICONS } = require('./platform-display-definitions.json')

// ─── 支持二维码登录的平台列表 ─────────────────
const QR_CODE_PLATFORMS = ['wechat_mp', 'tencent_video', 'zhihu', 'weibo', 'toutiao', 'kuaishou']

/**
 * 获取平台显示名称
 * @param {string} platform
 * @returns {string}
 */
function getPlatformName(platform) {
  return PLATFORM_NAMES[platform] || platform
}

module.exports = {
  PLATFORM_LOGIN_URLS,
  PLATFORM_DASHBOARD_URLS,
  PLATFORM_LOGIN_SUCCESS_PATTERNS,
  PLATFORM_AUTH_HOSTS,
  PLATFORM_COOKIE_DOMAINS,
  PLATFORM_LS_SESSION_MARKERS,
  PLATFORM_SESSION_COOKIE_MARKERS,
  isPlatformAuthHost,
  hasPlatformLsSessionMarker,
  hasPlatformSessionCookie,
  isPlatformLoginSuccessUrl,
  isPlatformCookieDomain,
  PLATFORM_LOGIN_SUCCESS_SELECTORS,
  PLATFORM_ACCOUNT_INFO_SELECTORS,
  PLATFORM_NAMES,
  PLATFORM_ICONS,
  QR_CODE_PLATFORMS,
  getPlatformName,
}
