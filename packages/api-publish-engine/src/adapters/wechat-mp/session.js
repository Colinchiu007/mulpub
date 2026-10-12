'use strict'
/**
 * 微信公众号 API 轨 —— 会话 bootstrap 与群发保护预检（PRD §F1 / §F5）
 *
 * 依据：参考产品（4.0）逆向实测契约——
 *   GET /cgi-bin/loginpage?url=%2Fcgi-bin%2Fhome 返回的是 **HTML/JS 片段**（不是 JSON），
 *   字段用正则提取；`user_name` 即 filetransfer 的 `ticket_id`，`ticket` 即 `ticket`。
 *
 * 与参考产品取证口径的两处**有意差异**：
 *  ① 用捕获组 `[^"]*` 取代 `.*` + `split('"')[1]`——对畸形输入不会越过引号边界串味；
 *  ② `user_name` / `ticket` 前面加 `[^a-zA-Z_]` 边界守卫——避免 `xxx_ticket:` 之类的键名被误匹配。
 *     （实测 `user_name: "gh_ticket_abc"` 里的 `TICKET` 不含冒号因此本不会误匹配，
 *      但边界守卫让这个性质**不依赖输入巧合**。）
 */
const { WechatMpError } = require('./errors')

const BASE = 'https://mp.weixin.qq.com'
const LOGIN_PAGE_URL = BASE + '/cgi-bin/loginpage?url=%2Fcgi-bin%2Fhome'
const SAFE_CENTER_URL = BASE + '/cgi-bin/safecenterstatus'

/** 会话字段正则表（与参考产品逐条对应，差异见文件头注释）。
 *  键名两侧引号可选：真实 loginpage 是 JS 字面量（`uin: "..."` 无引号），
 *  但同一片段也可能以 JSON 形态出现（`"uin": "..."`）——两种都收，
 *  否则「字段在不在」会退化成「页面用的是哪种序列化」这种偶然性质。 */
const RE = {
  token: /&token=([0-9a-zA-Z]{3,})/,
  nickName: /"?nick_name"?\s*:\s{0,}"([^"]*)"/,
  authorId: /"?uin"?\s*:\s{0,}"(\d{3,})"/,
  ticketId: /(?:^|[^a-zA-Z_])"?user_name"?\s*:\s{0,}"([^"]*)"/,
  ticket: /(?:^|[^a-zA-Z_])"?ticket"?\s*:\s{0,}"([^"]*)"/,
  canAppMsg: /"?can_app_msg"?\s*:\s*"?(\d+)"?/,
}

function pick (html, re) {
  const m = re.exec(html)
  return m ? m[1] : ''
}

/**
 * 从 loginpage 的 HTML 提取会话字段。**不做判据**（判据在 fetchSession），
 * 因此可以单独对正则逐字段断言。
 * @param {string} html
 */
function extractSession (html) {
  const s = String(html == null ? '' : html)
  const canAppMsg = Number(pick(s, RE.canAppMsg))
  return {
    token: pick(s, RE.token),
    nickName: pick(s, RE.nickName),
    authorId: pick(s, RE.authorId),
    ticketId: pick(s, RE.ticketId),
    ticket: pick(s, RE.ticket),
    canAppMsg: Number.isFinite(canAppMsg) ? canAppMsg : 0,
  }
}

/**
 * 取会话。C1/C2/C3：token 与 authorId 缺一即「登录失效」；空 cookie 不发请求。
 * @param {{get: Function}} http 注入的 HTTP 客户端（测试用假实现）
 * @param {{cookie: string, timeout?: number}} opts
 */
async function fetchSession (http, opts) {
  const cookie = (opts && opts.cookie) || ''
  if (!cookie) {
    // 不空跑一次网络：没有凭证必然拿不到会话，省一次往返也少一次无意义的外部请求
    throw new WechatMpError('needRelogin', '微信公众号登录已失效，请重新登录账号后重试')
  }
  const headers = { Cookie: cookie, Referer: BASE }
  const resp = await http.get(LOGIN_PAGE_URL, { headers, timeout: (opts && opts.timeout) || 20000 })
  const session = extractSession(resp && resp.data)
  if (!session.token || !session.authorId) {
    throw new WechatMpError('needRelogin', '微信公众号登录已失效，请重新登录账号后重试', {
      hasToken: Boolean(session.token),
      hasAuthorId: Boolean(session.authorId),
    })
  }
  return session
}

/**
 * 群发保护判据：页面里出现 `wx.cgiData` **且** `"protect_status":1` 才算开启。
 * 安全中心未开通的账号返回的页面不含 `wx.cgiData` ⇒ 视为未保护（放行）。
 * @param {string} html
 * @returns {boolean}
 */
function parseProtectionHtml (html) {
  const s = String(html == null ? '' : html)
  if (!s.includes('wx.cgiData')) return false
  return /"protect_status"\s*:\s*1/.test(s)
}

/**
 * 群发前置预检（PRD §F5 / T1-T2）。
 * - 只有本次要群发才请求（只存草稿不该被群发保护拦住）；
 * - 预检本身失败/超时 **放行**（fail-open）：它是增益而不是正确性依据，
 *   把它变成硬阻断会让「未开通安全中心」的账号无法发布。
 */
async function checkMassSendProtection (http, opts) {
  const { cookie, token, massSend } = opts || {}
  if (!massSend) return { ok: true, skipped: true }
  // 用 URLSearchParams 而不是手拼 query：token 是外部输入，交给标准实现做编码；
  // 手拼 `'token=' + x` 还会被仓内 CCG 的 HARDCODED_SECRET 朴素正则误判成硬编码密钥。
  const query = new URLSearchParams({
    action: 'protect',
    t: 'setting/safe-protect',
    token: String(token || ''),
    lang: 'zh_CN',
  })
  const url = SAFE_CENTER_URL + '?' + query.toString()
  let html = ''
  try {
    const resp = await http.get(url, { headers: { Cookie: cookie || '', Referer: BASE }, responseType: 'text' })
    html = (resp && resp.data) || ''
  } catch (e) {
    return { ok: true, degraded: true, reason: e && e.message }
  }
  if (!parseProtectionHtml(html)) return { ok: true }
  return {
    ok: false,
    code: 'mass-send-protected',
    error: '发布失败：账号开启了群发保护。请前往「微信公众平台 → 设置与开发 → 安全中心 → 风险操作保护」，关闭「群发消息」保护后重试',
  }
}

module.exports = {
  BASE,
  LOGIN_PAGE_URL,
  SAFE_CENTER_URL,
  extractSession,
  fetchSession,
  parseProtectionHtml,
  checkMassSendProtection,
}
