'use strict'
/**
 * 微信公众号 API 轨 —— 草稿请求体、创建与回读（PRD §F3 / §5.3 / §5.4）
 *
 * 依据：参考产品（4.0）`buildArticles()` 的扁平化写法——
 *   `for (const k in article) body.push(`${k}${index}=` + encodeURIComponent(v))`
 * 即字段名后面**直接拼文章序号**（`title0` / `content0` / `cdn_url0`…），
 * 顶层再拼 token/lang/f/ajax/random/AppMsgId=/count/articlenum/data_seq/
 * operate_from=Chrome/isnew=0/remind_flag=null。
 *
 * 封面是这套契约里最容易抄错的一处：参考产品把**同一个上传 URL 写进 5 个槽位**
 * （cdn_url / cdn_235_1_url / cdn_16_9_url / cdn_1_1_url / cdn_url_back），
 * 而不是 `thumb_media_id`/`fileid`。少写任一槽位就可能出现"草稿有封面比例不对"。
 */
const { BASE } = require('./session')
const { WechatMpError } = require('./errors')
const { neutralFields } = require('./draft-defaults')

/** 封面槽位（AC-7：五者必须同值）。 */
const COVER_SLOTS = ['cdn_url', 'cdn_235_1_url', 'cdn_16_9_url', 'cdn_1_1_url', 'cdn_url_back']

const MAX_TITLE = 64
const MAX_DIGEST = 120
const MAX_AUTHOR = 60

function truncate (v, n) {
  const s = String(v == null ? '' : v)
  return s.length > n ? s.slice(0, n) : s
}

function isHttpUrl (v) {
  return /^https?:\/\//i.test(String(v == null ? '' : v))
}

/**
 * 评论三态（D5）。取值语义：0=关闭、1=仅粉丝、2=仅粉丝N天、3=所有人。
 * 缺省按「所有人可评」——与本仓既有语义（openComment 缺省为开）一致。
 */
function mapCommentSetting (value) {
  const v = value == null ? 3 : Number(value)
  const out = { need_open_comment: 0, only_fans_can_comment: 0, only_fans_days_can_comment: 0 }
  if (v === 1) return { ...out, need_open_comment: 1, only_fans_can_comment: 1 }
  if (v === 2) return { ...out, need_open_comment: 1, only_fans_days_can_comment: 1 }
  if (v === 3) return { ...out, need_open_comment: 1 }
  return out
}

/**
 * 文章 → 扁平字段（不含序号）。
 * @param {object} article  {title, content, digest, author, contentSourceUrl, commentSetting, isOriginal, allowFastReprint, openFansMsg, disableRecommend, copyrightType}
 * @param {string} coverUrl 已上传的封面 URL（可为空串）
 */
function buildArticleFields (article, coverUrl) {
  const a = article || {}
  const fields = neutralFields()
  fields.title = truncate(a.title, MAX_TITLE)
  fields.author = truncate(a.author, MAX_AUTHOR)
  fields.digest = truncate(a.digest, MAX_DIGEST)
  fields.content = String(a.content == null ? '' : a.content)
  fields.sourceurl = isHttpUrl(a.contentSourceUrl) ? String(a.contentSourceUrl) : ''
  fields.allow_fast_reprint = a.allowFastReprint ? 1 : 0
  fields.claim_source_type = a.claimSourceType ? 1 : 0
  fields.copyright_type = a.isOriginal ? 1 : 0
  fields.original_article_type = a.originalArticleType == null ? '' : String(a.originalArticleType)
  if (a.openFansMsg) fields.open_fansmsg = 1
  if (a.disableRecommend) fields.disable_recommend = 1
  const cover = String(coverUrl == null ? '' : coverUrl)
  for (const slot of COVER_SLOTS) fields[slot] = cover
  Object.assign(fields, mapCommentSetting(a.commentSetting))
  // 关闭评论时补 reply_flag（参考产品：needOpenComment 为 0 时置 2）
  if (Number(a.commentSetting == null ? 3 : a.commentSetting) === 0) fields.reply_flag = Number(a.needOpenReply == null ? 2 : a.needOpenReply)
  return fields
}

/** 扁平字段 → 请求体（字段名 + 序号；跳过 null/undefined）。 */
function serializeFields (fields, index) {
  const idx = Number.isFinite(Number(index)) ? Number(index) : 0
  const parts = []
  for (const [key, value] of Object.entries(fields || {})) {
    if (value === undefined || value === null) continue
    parts.push(key + idx + '=' + encodeURIComponent(String(value)))
  }
  return parts.join('&')
}

/**
 * 构造建草稿请求体（纯函数，逐字段可断言）。
 * @param {object} article
 * @param {number} index 文章序号（首条为 0）
 */
function buildDraftBody (article, index) {
  const coverUrl = article && article.coverUrl ? String(article.coverUrl) : ''
  return serializeFields(buildArticleFields(article, coverUrl), index)
}

function nowStamp (digits) {
  const ms = Date.now()
  return digits === 13 ? String(ms) : String(Math.floor(ms / 1000))
}

/**
 * 建草稿。**appMsgId 是唯一成功依据**（R4 / D7）：
 * 没有它一律视为未创建——旧实现正是「列表接口 ret:0 就当成功」的假成功。
 */
async function createDraft (http, opts) {
  const { cookie, session, body, count } = opts || {}
  const token = (session && session.token) || ''
  const n = Number(count == null ? 1 : count)
  // 顶层参数用 URLSearchParams（token 是外部输入，编码交给标准实现；
  // 手拼 `'token=' + x` 会被仓内 CCG 的 HARDCODED_SECRET 朴素正则误判）
  const top = new URLSearchParams({
    token: String(token || ''),
    lang: 'zh_CN',
    f: 'json',
    ajax: '1',
    random: '0.1617291' + nowStamp(10),
    AppMsgId: '',
    count: String(n),
    articlenum: String(n),
    data_seq: '0',
    operate_from: 'Chrome',
    isnew: '0',
    remind_flag: 'null',
  }).toString()
  const payload = top + '&' + String(body || '')
  const resp = await http.post(BASE + '/cgi-bin/operate_appmsg', payload, {
    headers: {
      Cookie: cookie || '',
      'X-Requested-With': 'XMLHttpRequest',
      Referer: BASE + '/cgi-bin/home',
      Origin: BASE,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    params: { t: 'ajax-response', sub: 'create', type: 77, token: token, lang: 'zh_CN' },
  })
  const data = (resp && resp.data) || {}
  const base = data.base_resp || {}
  const ret = data.ret !== undefined ? data.ret : base.ret
  const errMsg = base.err_msg || data.err_msg || ''
  if (String(ret) === '64714') {
    throw new WechatMpError('originality-required', '文章保存失败：请检查文章原创性（该内容可能已被其他账号声明原创）', { ret: String(ret) })
  }
  const appMsgId = data.appMsgId || data.app_msg_id || base.appMsgId
  if (appMsgId === undefined || appMsgId === null || String(appMsgId) === '' || String(appMsgId) === '0') {
    throw new WechatMpError('draft-not-created', '微信公众号草稿创建失败：' + (errMsg || '平台未返回草稿 ID'), { ret: ret === undefined ? '' : String(ret) })
  }
  return { appMsgId, raw: data }
}

/** HTML → 纯文本（去 script/style/标签，解码常见实体，收敛空白）。 */
function htmlToText (html) {
  return String(html == null ? '' : html)
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
}

function escapeHtml (s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * 回读校验（H1-H4，本仓新增，参考产品没有这一步）。
 * 三项齐全才算成功——「平台给了 appMsgId 但草稿是空的」必须能被抓住。
 */
async function readbackDraft (http, opts) {
  const { cookie, session, appMsgId, expect } = opts || {}
  const token = (session && session.token) || ''
  const query = new URLSearchParams({
    t: 'media/appmsg_edit',
    action: 'edit',
    type: '77',
    appmsgid: String(appMsgId),
    token: String(token || ''),
    lang: 'zh_CN',
  })
  const url = BASE + '/cgi-bin/appmsg?' + query.toString()
  const resp = await http.get(url, {
    headers: { Cookie: cookie || '', Referer: BASE + '/cgi-bin/home' },
    responseType: 'text',
  })
  const html = typeof (resp && resp.data) === 'string' ? resp.data : JSON.stringify((resp && resp.data) || '')
  const text = htmlToText(html)
  const e = expect || {}
  const wantTitle = String(e.title == null ? '' : e.title)
  const titleOk = !wantTitle || html.includes(wantTitle) || html.includes(escapeHtml(wantTitle))
  const wantContentText = htmlToText(e.content)
  const prefix = wantContentText.replace(/\s+/g, '').slice(0, 20)
  const contentOk = !prefix || text.replace(/\s+/g, '').includes(prefix)
  const coverUrl = String(e.coverUrl == null ? '' : e.coverUrl)
  let coverOk = true
  if (coverUrl) {
    try {
      const pathname = new URL(coverUrl).pathname
      coverOk = /mmbiz\.qpic\.cn/i.test(html) && html.includes(pathname)
    } catch (err) {
      coverOk = /mmbiz\.qpic\.cn/i.test(html)
    }
  }
  return { titleOk, contentOk, coverOk, ok: titleOk && contentOk && coverOk }
}

module.exports = {
  COVER_SLOTS,
  MAX_TITLE,
  MAX_DIGEST,
  MAX_AUTHOR,
  mapCommentSetting,
  buildArticleFields,
  serializeFields,
  buildDraftBody,
  createDraft,
  htmlToText,
  readbackDraft,
}
