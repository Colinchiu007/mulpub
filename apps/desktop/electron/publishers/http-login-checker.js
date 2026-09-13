// @ts-check
/**
 * HTTP API 登录检测 — 用保存的 Cookie 直接调用平台内部 API 判断登录态
 *
 * 参考蚁小二 checkAccountAlive 逆向：不打开浏览器窗口，纯 HTTP 请求，
 * 每次检测 <1 秒（浏览器窗口方案需 4-8 秒/平台）。
 *
 * API 端点来源：蚁小二 4.0 逆向（packages/main/dist/index.cjs）。
 * 各平台判断逻辑：
 * - douyin: GET /aweme/v1/creator/pc/user/info/ → status_code === 0 且有 user 数据
 * - toutiao: GET /mp/agw/media/get_media_info → code === 0 且有 user.id
 */
const log = require('../services/logger')

/**
 * @typedef {Object} HttpCheckApi
 * @property {string} url
 * @property {Record<string,string>} headers
 * @property {'GET'|'POST'} [method] - 默认 GET
 * @property {string} [body] - POST JSON body（视频号 auth_data）
 * @property {string} [contentType] - POST Content-Type（默认 application/json）
 * @property {(data:any)=>boolean} [check] - JSON 响应判定；check 与 checkHtml 互斥
 * @property {(html:string)=>boolean} [checkHtml] - HTML 响应判定（公众号 loginpage 正则）
 * @property {(cookieHeader:string)=>boolean} [precheck] - 请求前 cookie 预检（如 bilibili 必须含 bili_jct）
 */

/** @type {Record<string, HttpCheckApi>} */
const HTTP_CHECK_APIS = {
  douyin: {
    url: 'https://creator.douyin.com/aweme/v1/creator/pc/user/info/',
    headers: {
      Referer: 'https://creator.douyin.com/creator-micro/home',
      Origin: 'https://creator.douyin.com'
    },
    check: (data) => Boolean(data && data.status_code === 0 && data.data && (data.data.uid || data.data.user_id || data.data.nickname !== undefined))
  },
  toutiao: {
    url: 'https://mp.toutiao.com/mp/agw/media/get_media_info',
    headers: {
      Referer: 'https://mp.toutiao.com/profile_v4/graphic/publish'
    },
    check: (data) => Boolean(data && data.code === 0 && data.data && data.data.user && data.data.user.id)
  },
  // 公众号：对齐蚁小二 getWeixingongzhonghaoUserInfo —— GET loginpage 页（带 cookie），
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
      if (!html || typeof html !== 'string') return false
      // 对齐蚁小二正则：&token=[0-9a-zA-Z]{3,} 与 uin:"[0-9]{3,}" 同时存在 → 已登录
      const hasToken = /&token=[0-9a-zA-Z]{3,}/.test(html) || /token=[0-9a-zA-Z]{3,}/.test(html)
      const hasUin = /uin:\s{0,}"[0-9]{3,}"/.test(html)
      return hasToken && hasUin
    }
  },
  // 视频号：对齐蚁小二 getShipinhaoUserInfo —— POST auth_data 接口（带 cookie），
  // errCode 300333/300334 判失效，data.finderUser 存在判有效。
  // 这比「访问后台首页看 302」更可靠，且渲染崩溃保护下视频号只能走 HTTP 检测。
  tencent_video: {
    url: 'https://channels.weixin.qq.com/cgi-bin/mmfinderassistant-bin/auth/auth_data',
    headers: {
      Referer: 'https://channels.weixin.qq.com'
    },
    method: 'POST',
    contentType: 'application/json',
    body: JSON.stringify({ timestamp: Date.now().toString().substring(0, 13), _log_finder_uin: '', _log_finder_id: '', rawKeyBuff: null, pluginSessionId: null, scene: 7, reqScene: 7 }),
    check: (data) => {
      // errCode 300333/300334 = 登录失效（蚁小二判定）
      if (data && (data.errCode === 300333 || data.errCode === 300334)) return false
      return Boolean(data && data.data && data.data.finderUser)
    }
  },
  // bilibili：对齐蚁小二 getBilibiliUserInfo —— GET nav 接口（带 cookie + Referer），
  // code === -101 判失效，data.mid 存在判有效；cookie 必须含 bili_jct（缺失即失效）。
  bilibili: {
    url: 'https://api.bilibili.com/x/web-interface/nav',
    headers: {
      Referer: 'https://member.bilibili.com/'
    },
    precheck: (cookieHeader) => cookieHeader.includes('bili_jct='),
    check: (data) => Boolean(data && data.code === 0 && data.data && data.data.mid)
  }
}

/** 超时（毫秒）——HTTP API 检测应远快于浏览器窗口 */
const HTTP_CHECK_TIMEOUT_MS = 8000

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
  if (!api) return { supported: false }

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
      fetchOptions.body = api.body || '{}'
    }
    const response = await fetch(api.url, fetchOptions)
    clearTimeout(timer)

    // 平台重定向到登录页 = Cookie 失效
    if (response.status === 301 || response.status === 302 || response.status === 303 || response.status === 307) {
      const location = response.headers.get('location') || ''
      log.info('HttpLoginChecker', platform + ': redirect to ' + location.slice(0, 80) + ' → expired')
      return { supported: true, valid: false, code: 'CHECK_LOGIN_COOKIE_EXPIRED' }
    }

    if (!response.ok) {
      log.info('HttpLoginChecker', platform + ': HTTP ' + response.status + ' → expired')
      return { supported: true, valid: false, code: 'CHECK_LOGIN_COOKIE_EXPIRED' }
    }

    // HTML 响应判定（公众号 loginpage 正则）
    if (typeof api.checkHtml === 'function') {
      const html = await response.text().catch(() => '')
      const valid = api.checkHtml(html)
      log.info('HttpLoginChecker', platform + ': HTML check → ' + (valid ? 'valid' : 'expired') + ' (html len=' + html.length + ')')
      return { supported: true, valid, code: valid ? 'CHECK_LOGIN_SUCCESS_HTTP_API' : 'CHECK_LOGIN_COOKIE_EXPIRED' }
    }

    // JSON 响应判定
    const data = await response.json().catch(() => null)
    const valid = typeof api.check === 'function' ? api.check(data) : false
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
 * @param {string} platform
 * @returns {boolean}
 */
function isHttpCheckSupported (platform) {
  return Boolean(HTTP_CHECK_APIS[platform])
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

module.exports = { checkLoginViaHttpApi, isHttpCheckSupported, cookiesToHeader, tryHttpLoginCheck }
