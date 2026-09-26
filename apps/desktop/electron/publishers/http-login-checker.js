// @ts-check
/**
 * HTTP API 登录检测 — 用保存的 Cookie 直接调用平台内部 API 判断登录态
 *
 * 参考同类产品 checkAccountAlive 逆向：不打开浏览器窗口，纯 HTTP 请求，
 * 每次检测 <1 秒（浏览器窗口方案需 4-8 秒/平台）。
 *
 * API 端点来源：参考产品 4.0 逆向（packages/main/dist/index.cjs）。
 * 各平台判断逻辑采用黑名单语义：仅平台明确告知未登录才判失效；
 * 其余不确定响应（风控页/结构变更/非预期状态码）返回 undefined，
 * 由调用方（account-manager.checkLoginStatus）降级到浏览器检测，
 * 避免平台风控拦截检测请求时把有效 Cookie 误判为已失效（假阳性）。
 * - douyin: GET /aweme/v1/creator/pc/user/info/ → status_code === 0 且有 user
 *   数据判有效；status_code === 8 或 status_msg/msg 含「未登录」判失效
 *   （对齐参考产品 checkAccountAlive）；其余一切 → 不确定，降级
 * - toutiao: GET /mp/agw/media/get_media_info → code === 0 且有 user.id
 *
 * platform_uid（云端账号合并键，docs/adr/0004、PRD-CLOUD-ACCOUNT-SYNC §5.1）：
 * 账号管理的八个平台（douyin/toutiao/wechat_mp/tencent_video/bilibili/kuaishou/
 * xiaohongshu/zhihu）都必须在 HTTP_CHECK_APIS 里登记 extract；取不到 uid 时一律
 * 「不产出该键」，绝不用昵称或页面标题派生。覆盖完整性由结构锁
 * http-login-checker-uid-coverage.test.js 拦截（新增平台未补 uid 即红）。
 */
const log = require('../services/logger')
const {
  PLATFORM_DASHBOARD_URLS,
  hasPlatformSessionCookie,
} = require('@multi-publish/shared-utils/src/platform-definitions')

/**
 * @typedef {Object} HttpCheckApi
 * @property {string} [url] - 端点地址；只有 uid 提取通道（uidSource:'cookie'）可省略
 * @property {Record<string,string>} headers
 * @property {'GET'|'POST'} [method] - 默认 GET
 * @property {string|(() => string)} [body] - POST JSON body（视频号 auth_data）；
 *               函数形态在每次发请求时求值，含 timestamp 的接口必须用函数形态，
 *               否则时间戳会被模块加载时刻冻结（进程存活越久偏差越大，平台按
 *               时间戳校验失败 → 检测结论失真）
 * @property {string} [contentType] - POST Content-Type（默认 application/json）
 * @property {(data:any)=>boolean|undefined} [check] - JSON 响应判定；undefined=不确定（降级浏览器检测）；check 与 checkHtml 互斥
 * @property {(html:string)=>boolean|undefined} [checkHtml] - HTML 响应判定（公众号 loginpage 正则）；undefined=不确定（降级浏览器检测）
 * @property {(cookieHeader:string)=>boolean} [precheck] - 请求前 cookie 预检（如 bilibili 必须含 bili_jct）
 * @property {'json'|'html'|'cookie'} [uidSource] - extract 的取数来源（默认 json）：
 *               json=JSON 响应；html=HTML 响应文本（须与 checkHtml 同页，不另造端点）；
 *               cookie=不发请求，只从已保存凭证派生（云端同步合并键 platform_uid 用）
 * @property {(payload:any, cookies?:Array<{name:string,value:string}>)=>{nickname?:string,followers?:number,platformAccountId?:string}} [extract]
 *               uid/资料提取器；取不到一律不产出键（禁止用昵称、页面标题等派生值冒充 platform_uid）
 */

/** 从平台响应字段安全取正整数计数（取不到返回 undefined，让调用方保持原值） */
function toCount (v) {
  const n = typeof v === 'number' ? v : (typeof v === 'string' && v.trim() ? Number(v) : NaN)
  if (!Number.isFinite(n) || n < 0) return undefined
  return Math.round(n)
}

/**
 * 平台原生 ID（platform_uid）的形态白名单：真实 uid 一律是有限字符集内的短标识。
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

/** @type {Record<string, HttpCheckApi>} */
const HTTP_CHECK_APIS = {
  douyin: {
    url: 'https://creator.douyin.com/aweme/v1/creator/pc/user/info/',
    headers: {
      Referer: 'https://creator.douyin.com/creator-micro/home',
      Origin: 'https://creator.douyin.com'
    },
    check: (data) => {
      // 黑名单语义（对齐参考产品 checkAccountAlive）：只有平台明确告知
      // 未登录才判失效；风控拦截/结构变更/其他状态码一律返回 undefined
      // 交由调用方降级浏览器检测，避免把有效 Cookie 误判为已失效。
      if (!data || typeof data !== 'object') return undefined // 风控页/非 JSON → 不确定，降级
      if (data.status_code === 0 && data.data && (data.data.uid || data.data.user_id || data.data.nickname !== undefined)) return true
      if (data.status_code === 8) return false // 对齐参考产品 checkAccountAlive：8=明确未登录
      const msg = data.status_msg || data.msg || data.message
      if (typeof msg === 'string' && msg.includes('未登录')) return false
      return undefined // 其余一切（其他码/缺字段/结构变更）→ 不确定，降级
    },
    extract: (d) => {
      const u = (d && d.data && (d.data.user || d.data)) || {}
      return { nickname: u.nickname || u.nick_name || u.uname || '', followers: toCount(u.follower_count != null ? u.follower_count : u.fans_count), platformAccountId: String(u.uid || u.user_id || '') }
    }
  },
  toutiao: {
    url: 'https://mp.toutiao.com/mp/agw/media/get_media_info',
    headers: {
      Referer: 'https://mp.toutiao.com/profile_v4/graphic/publish'
    },
    check: (data) => {
      // 黑名单语义：仅明确成功/明确未登录文案才给结论，其余降级浏览器检测
      if (!data || typeof data !== 'object') return undefined
      if (data.code === 0 && data.data && data.data.user && (data.data.user.id || data.data.user.user_id)) return true
      const msg = data.message || data.msg || data.status_msg
      if (typeof msg === 'string' && /未登录|请先登录|登录过期|重新登录/.test(msg)) return false
      return undefined
    },
    extract: (d) => {
      const u = (d && d.data && d.data.user) || {}
      return { nickname: u.name || u.screen_name || '', followers: toCount(u.fans_count != null ? u.fans_count : u.follower_count), platformAccountId: String(u.id || u.user_id || '') }
    }
  },
  // 公众号：对齐参考产品 getWeixingongzhonghaoUserInfo —— GET loginpage 页（带 cookie），
  // 登录态由 HTML 内嵌的 token=/uin:/nick_name 正则体现；未登录时这些字段缺失。
  // 这比「访问后台首页看是否 302」更可靠：Cookie（slave_sid）过期后访问 cgi-bin/home
  // 仍可能返回 200 渲染骨架，但 loginpage 页面未登录时不会内嵌 token。
  wechat_mp: {
    url: 'https://mp.weixin.qq.com/cgi-bin/loginpage?url=%2Fcgi-bin%2Fhome',
    headers: {
      Referer: 'https://mp.weixin.qq.com/',
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
    },
    checkHtml: (html) => {
      // 黑名单语义：token+uin 同时存在判有效；明确登录页文案判失效；
      // 空响应/风控页/结构变更（无 token 也无登录特征）→ 不确定，降级浏览器检测
      if (!html || typeof html !== 'string') return undefined
      // 对齐参考产品正则：&token=[0-9a-zA-Z]{3,} 与 uin:"[0-9]{3,}" 同时存在 → 已登录
      const hasToken = /&token=[0-9a-zA-Z]{3,}/.test(html) || /token=[0-9a-zA-Z]{3,}/.test(html)
      const hasUin = /uin:\s{0,}"[0-9]{3,}"/.test(html)
      if (hasToken && hasUin) return true
      if (/扫码登录|请使用微信扫码|请登录|welcome_login/.test(html)) return false
      return undefined
    },
    // platform_uid（云端合并键）来源与登录判定**同源同页**：登录态页面才会内嵌
    // `uin:"<数字>"`（公众号账号原生 ID），未登录时该字段缺失——这正是 checkHtml
    // 用来判有效的同一份证据，因此不新增任何端点 URL。
    // 仓库内取证结论：没有可靠证据支撑一个 JSON user-info 端点（`cgi-bin/home` 类
    // 接口在 Cookie 过期后仍可能返回 200 渲染骨架，见上方注释；仓内亦无该端点的
    // 响应字段证据），故不编造 URL，改为读已注册 loginpage 的 HTML。
    // 可靠性等级：中高 —— uin 由平台自身写入、同一公众号在多设备/多次登录下稳定；
    // 尚未做真凭证线级取证（openspec add-cloud-account-sync tasks 3.6），且只覆盖
    // 「当前登录的这一个号」，取不到时如实走 uid 缺失分支（同步侧判 uid-unavailable）。
    uidSource: 'html',
    extract: (html) => {
      if (!html || typeof html !== 'string') return {}
      // 明确登录页形态优先短路：即便页面内出现示例 uin 也不产出（与 checkHtml 同一黑名单）
      if (/扫码登录|请使用微信扫码|请登录|welcome_login/.test(html)) return {}
      const m = /uin:\s{0,}"([0-9]{3,})"/.exec(html)
      const uid = normalizeUid(m && m[1])
      return uid ? { platformAccountId: uid } : {}
    }
  },
  // 视频号：对齐参考产品 getShipinhaoUserInfo —— POST auth_data 接口（带 cookie），
  // errCode 300333/300334 判失效，data.finderUser 存在判有效。
  // 这比「访问后台首页看 302」更可靠，且渲染崩溃保护下视频号只能走 HTTP 检测。
  tencent_video: {
    url: 'https://channels.weixin.qq.com/cgi-bin/mmfinderassistant-bin/auth/auth_data',
    headers: {
      Referer: 'https://channels.weixin.qq.com'
    },
    method: 'POST',
    contentType: 'application/json',
    // 必须是函数：HTTP_CHECK_APIS 是模块级常量，直接写 JSON.stringify(Date.now())
    // 只会在 require 时求值一次，之后所有检测都带着同一个陈旧 timestamp。
    body: () => JSON.stringify({ timestamp: Date.now().toString().substring(0, 13), _log_finder_uin: '', _log_finder_id: '', rawKeyBuff: null, pluginSessionId: null, scene: 7, reqScene: 7 }),
    check: (data) => {
      // 黑名单语义：errCode 300333/300334 = 登录失效（参考产品判定）；
      // finderUser 存在判有效；其余结构（接口变更/风控）→ 不确定，降级
      if (!data || typeof data !== 'object') return undefined
      if (data.errCode === 300333 || data.errCode === 300334) return false
      if (data.errCode === 0 && data.data && data.data.finderUser) return true
      return undefined
    },
    extract: (d) => {
      const f = (d && d.data && d.data.finderUser) || {}
      return { nickname: f.nickname || f.finderUsername || '', followers: toCount(f.fansCount != null ? f.fansCount : f.fans_count), platformAccountId: String(f.uniqId || '') }
    }
  },
  // bilibili：对齐参考产品 getBilibiliUserInfo —— GET nav 接口（带 cookie + Referer），
  // code === -101 判失效，data.mid 存在判有效；cookie 必须含 bili_jct（缺失即失效）。
  bilibili: {
    url: 'https://api.bilibili.com/x/web-interface/nav',
    headers: {
      Referer: 'https://member.bilibili.com/'
    },
    precheck: (cookieHeader) => cookieHeader.includes('bili_jct='),
    check: (data) => {
      // 黑名单语义：code -101 = 明确未登录；code 0 且有 mid 判有效；
      // 其余状态码（风控 -352 等/结构变更）→ 不确定，降级
      if (!data || typeof data !== 'object') return undefined
      if (data.code === -101) return false
      if (data.code === 0 && data.data && data.data.mid) return true
      return undefined
    },
    extract: (d) => {
      const u = (d && d.data) || {}
      return { nickname: u.uname || '', followers: toCount(u.fans), platformAccountId: String(u.mid || '') }
    }
  },
  // 快手：雷区平台（AGENTS.md 记录 2026-09-25 事故）。未登录与登录后都落在
  // cp.kuaishou.com/profile，URL 判定本质不可区分；数据端点 cp.kuaishou.com/graphql
  // （publish-monitor.js:22）与 __NS_sig3 签名绑定（signer-assembly.js:183、
  // api-publish-engine/src/signer-local.js getKuaishouSign），纯 HTTP 通道取不到，
  // 所以本平台**不注册登录检测端点**（无 url → hasLoginCheck 为 false，检测行为不变），
  // 只登记 cookie 型 uid 来源。
  // uid 取 `userId`：CDP 实测「登录成功后才写入」的身份 Cookie
  // （platform-definitions.js PLATFORM_SESSION_COOKIE_MARKERS 注释；learnings.md
  // 2026-09-25 条目同名取证）。先过 hasPlatformSessionCookie 门禁——未登录形态只有
  // did/wid/_did/divid/kwssectoken 这类埋点/设备标识，「有 Cookie」不等于「已登录」，
  // 一律不产出。可靠性等级：中高（键名有实测证据；其值是否严格等于平台原生主键
  // 仍待 tasks 3.6 线级取证，取不到时同步侧判 uid-unavailable 整体跳过上行）。
  kuaishou: {
    headers: {},
    uidSource: 'cookie',
    extract: (_payload, cookies) => {
      if (!hasPlatformSessionCookie('kuaishou', cookies)) return {}
      const uid = normalizeUid(cookieValue(cookies, 'userId'))
      return uid ? { platformAccountId: uid } : {}
    }
  },
  // 小红书：仓库内**没有**可直接 GET 且响应字段已取证的 user-info JSON 端点——
  // 数据接口只到 creator 数据中心（analytics-providers.js:105，字段是笔记统计，
  // 且注释自承「实际 API 结构可能不同」），用户信息端点 /api/galaxy/user/info 仅出现在
  // 签名用例（api-publish-engine/test/test-signer.js:15），需 X-s/X-t 签名、响应字段无
  // 仓库内证据 → 不编造 URL、不猜字段名。
  // uid 因此走「已注册创作者域名 HTML（PLATFORM_DASHBOARD_URLS）+ DOM 采集器同款身份
  // 属性（data-account-id / data-user-id，见 PLATFORM_ACCOUNT_INFO_SELECTORS.xiaohongshu
  // 与 account-profile.js 通用回退清单）」，并要求全页唯一命中（见 extractUidFromHtml）。
  // 可靠性等级：低-中 —— 属性名有配置证据，但「服务端是否把身份属性直出在 HTML」
  // 未经真凭证实测（tasks 3.6）；未命中即返回 uid 缺失，不退化成昵称/页面标题
  // （2026-09-26「小红书创作服务平台」脏昵称事故即该兜底产出）。
  xiaohongshu: {
    url: PLATFORM_DASHBOARD_URLS.xiaohongshu,
    headers: {
      Referer: PLATFORM_DASHBOARD_URLS.xiaohongshu,
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
    },
    uidSource: 'html',
    extract: (html) => {
      const uid = extractUidFromHtml(html)
      return uid ? { platformAccountId: uid } : {}
    }
  },
  // 知乎：同样无仓库内取证的 JSON user-info 端点（api.zhihu.com/topstory、
  // www.zhihu.com/api/v4/articles、developer.zhihu.com/api/v1 均非「当前登录账号身份」
  // 接口），故与小红书同走 HTML 身份属性通道，端点用已注册主页
  // PLATFORM_DASHBOARD_URLS.zhihu（www.zhihu.com 已在 PLATFORM_AUTH_HOSTS 白名单内，
  // 且它不是登录地址 https://www.zhihu.com/signin）。
  // ⛔ 明确禁止的来源：`document.title`（真源里知乎账号 name 现值即「首页 - 知乎」
  // 这类页面标题）、og:title、昵称、头像 URL 及其任何派生值（AGENTS.md「标题类来源
  // 不得当结构化身份字段」+ PRD-CLOUD-ACCOUNT-SYNC §5.1）。本 extract 不产出
  // nickname/followers，缺席即「不修改」。
  // 可靠性等级：低-中（同小红书，待 tasks 3.6 实测确认 SSR 是否直出身份属性）。
  zhihu: {
    url: PLATFORM_DASHBOARD_URLS.zhihu,
    headers: {
      Referer: PLATFORM_DASHBOARD_URLS.zhihu,
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
    },
    uidSource: 'html',
    extract: (html) => {
      const uid = extractUidFromHtml(html)
      return uid ? { platformAccountId: uid } : {}
    }
  }
}

/** 超时（毫秒）——HTTP API 检测应远快于浏览器窗口 */
const HTTP_CHECK_TIMEOUT_MS = 8000

/**
 * 条目是否具备「登录检测」能力：必须有端点 URL 和一种判定函数。
 * 只有 uid 提取来源（uidSource:'cookie'，如快手）没有端点，不得被当成登录检测支持，
 * 否则 tryHttpLoginCheck 会对一个不存在的 URL 发请求并污染登录态结论。
 * @param {HttpCheckApi|undefined} api
 * @returns {boolean}
 */
function hasLoginCheck (api) {
  return Boolean(api && api.url && (typeof api.check === 'function' || typeof api.checkHtml === 'function'))
}

/**
 * 将 Cookie 数组转为请求头 Cookie 字符串
 * @param {Array<{name:string, value:string}>} cookies
 * @returns {string}
 */
function cookiesToHeader (cookies) {
  if (!Array.isArray(cookies)) return ''
  return cookies.filter(c => c && c.name && c.value).map(c => c.name + '=' + c.value).join('; ')
}

/**
 * HTTP API 检测平台登录态（仅支持 HTTP_CHECK_APIS 中注册的平台）
 * @param {string} platform
 * @param {Array<{name:string, value:string}>} cookies
 * @returns {Promise<{supported: boolean, valid?: boolean, code?: string, error?: string}>}
 */
async function checkLoginViaHttpApi (platform, cookies) {
  const api = HTTP_CHECK_APIS[platform]
  if (!hasLoginCheck(api)) return { supported: false }

  const cookieHeader = cookiesToHeader(cookies)
  if (!cookieHeader) return { supported: true, valid: false, code: 'CHECK_LOGIN_NO_CREDENTIAL' }
  if (typeof api.precheck === 'function' && !api.precheck(cookieHeader)) {
    log.info('HttpLoginChecker', platform + ': cookie precheck failed (missing required key) → expired')
    return { supported: true, valid: false, code: 'CHECK_LOGIN_COOKIE_EXPIRED' }
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), HTTP_CHECK_TIMEOUT_MS)
  try {
    const fetchOptions = {
      method: api.method || 'GET',
      headers: {
        ...api.headers,
        Cookie: cookieHeader,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      },
      signal: controller.signal,
      redirect: 'manual'
    }
    if (api.method === 'POST') {
      fetchOptions.headers['Content-Type'] = api.contentType || 'application/json'
      fetchOptions.body = typeof api.body === 'function' ? api.body() : (api.body || '{}')
    }
    const response = await fetch(api.url, fetchOptions)
    clearTimeout(timer)

    // 3xx：Location 指向登录页 = Cookie 失效；其他重定向（含拿不到 Location）
    // 可能是风控跳转，不判失效 → 不确定，降级浏览器检测（黑名单语义）
    if (response.status === 301 || response.status === 302 || response.status === 303 || response.status === 307) {
      const location = response.headers.get('location') || ''
      if (/login|passport|signin|sso/i.test(location)) {
        log.info('HttpLoginChecker', platform + ': redirect to ' + location.slice(0, 80) + ' → expired')
        return { supported: true, valid: false, code: 'CHECK_LOGIN_COOKIE_EXPIRED' }
      }
      log.info('HttpLoginChecker', platform + ': redirect to ' + location.slice(0, 80) + ' → inconclusive → fallback')
      return { supported: true, valid: undefined, code: 'CHECK_LOGIN_INCONCLUSIVE' }
    }

    if (!response.ok) {
      // 401/403 = 平台明确未授权 → Cookie 失效；其余非 2xx（404/429/5xx 等）
      // 可能是风控/临时故障，不判失效 → 不确定，降级浏览器检测
      if (response.status === 401 || response.status === 403) {
        log.info('HttpLoginChecker', platform + ': HTTP ' + response.status + ' → expired')
        return { supported: true, valid: false, code: 'CHECK_LOGIN_COOKIE_EXPIRED' }
      }
      log.info('HttpLoginChecker', platform + ': HTTP ' + response.status + ' → inconclusive → fallback')
      return { supported: true, valid: undefined, code: 'CHECK_LOGIN_INCONCLUSIVE' }
    }

    // HTML 响应判定（公众号 loginpage 正则）
    if (typeof api.checkHtml === 'function') {
      const html = await response.text().catch(() => '')
      const valid = api.checkHtml(html)
      if (valid === undefined) {
        // 判定不确定（风控页/结构变更/空响应）→ 不判失效，降级浏览器检测
        log.info('HttpLoginChecker', platform + ': HTML check → inconclusive (html len=' + html.length + ') → fallback')
        return { supported: true, valid: undefined, code: 'CHECK_LOGIN_INCONCLUSIVE' }
      }
      log.info('HttpLoginChecker', platform + ': HTML check → ' + (valid ? 'valid' : 'expired') + ' (html len=' + html.length + ')')
      return { supported: true, valid, code: valid ? 'CHECK_LOGIN_SUCCESS_HTTP_API' : 'CHECK_LOGIN_COOKIE_EXPIRED' }
    }

    // JSON 响应判定
    const data = await response.json().catch(() => null)
    const valid = typeof api.check === 'function' ? api.check(data) : false
    if (valid === undefined) {
      // 判定不确定（风控页/结构变更/非预期状态码）→ 不判失效，降级浏览器检测
      log.info('HttpLoginChecker', platform + ': API check → inconclusive (data keys: ' + (data ? Object.keys(data).slice(0, 5).join(',') : 'null') + ')')
      return { supported: true, valid: undefined, code: 'CHECK_LOGIN_INCONCLUSIVE' }
    }
    log.info('HttpLoginChecker', platform + ': API check → ' + (valid ? 'valid' : 'expired') + ' (data keys: ' + (data ? Object.keys(data).slice(0, 5).join(',') : 'null') + ')')
    return { supported: true, valid, code: valid ? 'CHECK_LOGIN_SUCCESS_HTTP_API' : 'CHECK_LOGIN_COOKIE_EXPIRED' }
  } catch (e) {
    clearTimeout(timer)
    const isAbort = e && (e.name === 'AbortError' || e.name === 'TimeoutError')
    log.warn('HttpLoginChecker', platform + ': ' + (isAbort ? 'timeout' : 'error') + ' → ' + (e && e.message ? e.message : String(e)))
    // 网络错误不判失效，返回 unknown 让调用方降级到浏览器检测
    return { supported: true, valid: undefined, code: isAbort ? 'CHECK_LOGIN_HTTP_TIMEOUT' : 'CHECK_LOGIN_HTTP_ERROR', error: e && e.message }
  }
}

/**
 * 检查平台是否支持 HTTP API 检测
 * 注意：只登记了 uid 提取来源（无端点 URL）的平台（快手）在此返回 false，
 * 登录检测行为与登记 uid 之前完全一致。
 * @param {string} platform
 * @returns {boolean}
 */
function isHttpCheckSupported (platform) {
  return hasLoginCheck(HTTP_CHECK_APIS[platform])
}

/**
 * HTTP API 快速路径入口（供 checkLoginStatus 调用）。
 * 有 Cookie 且平台已注册时尝试 HTTP API 检测；返回 null 表示不适用
 * （无 Cookie/未注册）或结果不确定（网络错误），调用方降级到浏览器检测。
 * @param {string} platform
 * @param {Array<{name:string, value:string}>} cookies
 * @param {string} accountId
 * @returns {Promise<{valid:boolean, code:string}|null>}
 */
async function tryHttpLoginCheck (platform, cookies, accountId) {
  if (!cookies || cookies.length === 0 || !isHttpCheckSupported(platform)) return null
  const httpResult = await checkLoginViaHttpApi(platform, cookies)
  if (httpResult.valid === undefined) {
    log.info('HttpLoginChecker', 'inconclusive ' + platform + ':' + accountId + ' → falling back to browser check')
    return null
  }
  log.info('HttpLoginChecker', 'fast-path ' + platform + ':' + accountId + ' valid=' + httpResult.valid + ' code=' + httpResult.code)
  return { valid: httpResult.valid, code: httpResult.code }
}

/**
 * 把 extract 结果收口成 IPC/写回可用的对象：字段缺席 = 不修改（buildProfilePatch 语义）。
 * 空串昵称、空串 uid 一律不进结果，避免把上一次的真值反向清空。
 * @param {{nickname?:string,followers?:number,platformAccountId?:string}} [info]
 * @returns {{supported: boolean, nickname?: string, followers?: number, platformAccountId?: string}}
 */
function shapeInfoResult (info) {
  const out = { supported: true }
  if (!info || typeof info !== 'object') return out
  if (typeof info.nickname === 'string' && info.nickname.trim()) out.nickname = info.nickname.trim()
  if (typeof info.followers === 'number') out.followers = info.followers
  if (typeof info.platformAccountId === 'string' && info.platformAccountId) out.platformAccountId = info.platformAccountId
  return out
}

/**
 * 用保存的 Cookie 调平台创作者 API 提取账号资料（昵称/粉丝/平台ID）。
 * 与登录检测共用同一批已注册端点（对齐参考实现：不抓 DOM，直接读结构化 JSON）。
 * 只在平台注册了 extract 且响应可解析时返回字段；任何异常/缺字段一律省略键，
 * 由调用方（refreshProfileFromHttpApi）经 buildProfilePatch 决定「缺席=不修改」。
 *
 * uid 三来源由条目的 `uidSource` 声明（缺省 json）：
 *   json   —— 平台 user-info JSON 接口（抖音/头条/视频号/B站）
 *   html   —— 与 checkHtml 同页的响应文本（公众号 uin；小红书/知乎的 SSR 身份属性）
 *   cookie —— 不发请求，只从已保存凭证派生（快手的登录后身份 Cookie）
 * 三条来源共用同一形态白名单（normalizeUid）：不合规即不产出，禁止昵称/页面标题冒充。
 * @param {string} platform
 * @param {Array<{name:string, value:string}>} cookies
 * @returns {Promise<{supported: boolean, nickname?: string, followers?: number, platformAccountId?: string}>}
 */
async function fetchAccountInfoViaHttpApi (platform, cookies) {
  const api = HTTP_CHECK_APIS[platform]
  if (!api || typeof api.extract !== 'function') return { supported: false }
  if (api.uidSource === 'cookie') {
    // 纯本地派生：绝不为 cookie 型来源发网络请求（快手无可用签名端点）
    return shapeInfoResult(api.extract(null, Array.isArray(cookies) ? cookies : []))
  }
  const cookieHeader = cookiesToHeader(cookies)
  if (!cookieHeader) return { supported: true }
  if (typeof api.precheck === 'function' && !api.precheck(cookieHeader)) return { supported: true }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), HTTP_CHECK_TIMEOUT_MS)
  try {
    const fetchOptions = {
      method: api.method || 'GET',
      headers: {
        ...api.headers,
        Cookie: cookieHeader,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      },
      signal: controller.signal,
      redirect: 'manual'
    }
    if (api.method === 'POST') {
      fetchOptions.headers['Content-Type'] = api.contentType || 'application/json'
      fetchOptions.body = typeof api.body === 'function' ? api.body() : (api.body || '{}')
    }
    const response = await fetch(api.url, fetchOptions)
    clearTimeout(timer)
    // redirect:'manual' 下 3xx 的 ok 为 false → 与既有行为一致：不产出、不判失效
    if (!response.ok) return { supported: true }
    if (api.uidSource === 'html') {
      const html = await response.text().catch(() => '')
      return shapeInfoResult(api.extract(html))
    }
    const data = await response.json().catch(() => null)
    if (!data || typeof data !== "object") return { supported: true }
    return shapeInfoResult(api.extract(data))
  } catch (e) {
    clearTimeout(timer)
    return { supported: true }
  }
}

module.exports = {
  checkLoginViaHttpApi,
  isHttpCheckSupported,
  cookiesToHeader,
  tryHttpLoginCheck,
  fetchAccountInfoViaHttpApi,
  // 结构锁（http-login-checker-uid-coverage.test.js）需要遍历登记表本身与 uid 契约常量
  HTTP_CHECK_APIS,
  UID_HTML_ATTRS,
  normalizeUid,
  extractUidFromHtml,
}
