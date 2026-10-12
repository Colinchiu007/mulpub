'use strict'
/**
 * 微信公众号 API 轨 —— 发布/群发链（wechat-mp-publish-track）。
 *
 * 契约来源：参考产品逆向取证（packages/main/dist/index.cjs，2026-10-12 逐函数提取），
 * 与 wechat-mp-api-publish-track（#3375）同源。两条路径共用 `cgi-bin/masssend` 发送端点，
 * 靠 query/body 区分：
 *   - 发布（不推送粉丝，无配额）：`is_release_publish_page=1` + `isFreePublish=true`，无 operation_seq
 *   - 群发（推送粉丝，有配额）：  群发页取 `operation_seq`，可选 `action=time_send`（定时）
 *
 * 成功判据是**平台自己的应答**：`base_resp.ret === 0`（参考产品同判据，失败 5s 后重试一次）。
 * 这与 #3375 的「假成功」修复同一纪律：受理码 ≠ 完成码，必须用业务应答判定。
 *
 * 设计约束：
 * - http 依赖注入（无网络可测，同 session.js/draft.js 口径）。
 * - 每道前置检查独立可断言；失败文案可直接展示给用户（可操作）。
 * - 未知形态 fail-closed：ret 缺失/非 0 一律失败，不猜测。
 */

const BASE = 'https://mp.weixin.qq.com/cgi-bin'

const EDIT_REFERER = (appMsgId, token) =>
  `${BASE}/appmsg?t=media/appmsg_edit&action=edit&type=10&appmsgid=${appMsgId}&token=${token}&lang=zh_CN`

function random10 () {
  return `0.947380${String(Date.now()).slice(-10)}`
}

function getReqId (len) {
  const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  let out = ''
  for (let i = 0; i < len; i++) out += CHARS[Math.floor(Math.random() * CHARS.length)]
  return out
}

/** 群发/发布前置检查（全部 POST cgi-bin/masssend，按 action 区分）。
 * 响应统一解包 axios 形状（resp.data），与 session.js/draft.js 同口径。 */
function unwrap (resp) {
  const d = resp && resp.data !== undefined ? resp.data : resp
  return d && typeof d === 'object' ? d : {}
}

function masssendAction (http, cookie, token, appMsgId, { query, body, refererAppMsgId }) {
  const params = new URLSearchParams(query)
  const form = new URLSearchParams(body)
  return http.post(
    `${BASE}/masssend?${params.toString()}`,
    form.toString(),
    {
      headers: {
        Cookie: cookie,
        'Content-Type': 'application/x-www-form-urlencoded',
        Referer: EDIT_REFERER(refererAppMsgId || appMsgId, token),
        Origin: 'https://mp.weixin.qq.com',
      },
    },
  ).then(unwrap)
}

/**
 * 发布路径的 4 道检查（参考产品 createPublicMsg）：
 * for_check 打包预检 → check_same_material 重复素材 → copyright 原创校验 → check_ad 广告位 → check_music 音乐。
 * 返回 { ok, code, error }；ok=false 时 error 为可直接展示的文案。
 */
async function runPublishChecks (http, ctx) {
  const { cookie, token, appMsgId } = ctx
  const baseBody = { appmsgid: appMsgId, token, lang: 'zh_CN', f: 'json', ajax: '1' }

  // ① 打包预检（发布页专属）
  const forCheck = await masssendAction(http, cookie, token, appMsgId, {
    query: { 't': 'ajax-response', for_check: '1', is_release_publish_page: '1', token, lang: 'zh_CN' },
    body: baseBody,
  })
  if (!forCheck || Number(forCheck.base_resp && forCheck.base_resp.ret) !== 0) {
    return { ok: false, code: 'publish-for-check-failed', error: `发布失败：${(forCheck && forCheck.base_resp && forCheck.base_resp.err_msg) || '打包预检未通过'}` }
  }

  // ② 重复素材
  const same = await masssendAction(http, cookie, token, appMsgId, {
    query: { action: 'check_same_material' },
    body: baseBody,
  })
  if (!same || Number(same.base_resp && same.base_resp.ret) !== 0) {
    return { ok: false, code: 'publish-same-material', error: `发布失败：${(same && same.base_resp && same.base_resp.err_msg) || '与已发表内容重复'}` }
  }

  // ③ 原创校验：err_msg === 'default' 才算通过（参考产品判据）；冲突时给出冲突文章链接
  const cr = await masssendAction(http, cookie, token, appMsgId, {
    query: { action: 'get_appmsg_copyright_stat', token, lang: 'zh_CN' },
    body: { ...baseBody, random: random10(), first_check: '1', type: '10' },
  })
  const crMsg = cr && cr.base_resp && cr.base_resp.err_msg
  if (crMsg !== 'default') {
    if (typeof crMsg === 'string' && crMsg.includes('found reprint from other article')) {
      let conflictUrl = ''
      try { conflictUrl = (((JSON.parse(cr.list || '{}') || {}).list || [])[0] || {}).source_url || '' } catch (e) { void e }
      return { ok: false, code: 'publish-copyright-conflict', error: `发布失败：文章未通过原创校验，与已发表文章冲突${conflictUrl ? `：${conflictUrl}` : ''}` }
    }
    return { ok: false, code: 'publish-copyright-failed', error: `发布失败：${crMsg || '原创校验未通过'}` }
  }

  // ④ 广告位
  const ad = await masssendAction(http, cookie, token, appMsgId, {
    query: { action: 'check_ad', token, lang: 'zh_CN' },
    body: { ...baseBody, random: random10(), is_release_publish_page: '1', send_time: '0' },
  })
  if (!ad || Number(ad.base_resp && ad.base_resp.ret) !== 0) {
    return { ok: false, code: 'publish-ad-check-failed', error: `发布失败：${(ad && ad.base_resp && ad.base_resp.err_msg) || '广告位校验未通过'}` }
  }

  // ⑤ 音乐
  const music = await masssendAction(http, cookie, token, appMsgId, {
    query: { action: 'check_music' },
    body: { ...baseBody, masssend_check: '1' },
  })
  if (!music || Number(music.base_resp && music.base_resp.ret) !== 0) {
    return { ok: false, code: 'publish-music-check-failed', error: `发布失败：${(music && music.base_resp && music.base_resp.err_msg) || '音乐版权校验未通过'}` }
  }

  return { ok: true }
}

/** 拉群发页（群发路径第一步；页面里取 operation_seq，未签协议时先签）。 */
async function fetchMassSendPage (http, ctx) {
  const { cookie, token, appMsgId } = ctx
  const params = new URLSearchParams({ 't': 'mass/send', type: '10', appmsgid: appMsgId, token, lang: 'zh_CN' })
  const resp = await http.get(`${BASE}/masssendpage?${params.toString()}`, {
    headers: { Cookie: cookie, Referer: EDIT_REFERER(appMsgId, token), Origin: 'https://mp.weixin.qq.com' },
  })
  const d = resp && resp.data !== undefined ? resp.data : resp
  return typeof d === 'string' ? d : String(d || '')
}

/** 未签署群发协议时签署（参考产品 getAllowSign）。 */
async function ensureProtocolSigned (http, ctx, pageText) {
  const text = String(pageText || '')
  if (!(text.includes('腾讯提醒你') && text.includes('同意以上声明'))) return { signed: false }
  const { cookie, token, appMsgId } = ctx
  const params = new URLSearchParams({ cgi: 'setprotocolsign', lang: 'zh_CN', token })
  await http.post(`${BASE}/setprotocolsign?${params.toString()}`, new URLSearchParams({ issigned: '1' }).toString(), {
    headers: { Cookie: cookie, 'Content-Type': 'application/x-www-form-urlencoded', Referer: EDIT_REFERER(appMsgId, token), Origin: 'https://mp.weixin.qq.com' },
  })
  const after = new URLSearchParams({ 't': 'mass/send', lang: 'zh_CN', token })
  const body = await http.get(`${BASE}/masssendpage?${after.toString()}`, {
    headers: { Cookie: cookie, Referer: EDIT_REFERER(appMsgId, token), Origin: 'https://mp.weixin.qq.com' },
  })
  return { signed: true, pageText: body }
}

/** 从群发页 HTML 提取 operation_seq。参考产品正则只覆盖 `operation_seq:"…"`；
 * 真实页面存在数组形态 `operation_seq:["…"]`，这里兼容两者（提取语义不变：取第一个引号串）。 */
function extractOperationSeq (pageText) {
  const m = /operation_seq:\s*\[?\s*"([^"]*)"/.exec(String(pageText || ''))
  return (m && m[1]) || ''
}

/**
 * 群发路径检查（参考产品 createSendMsg）：群发页（含协议签署）→ 原创（64715 特判）→ 广告位 → 音乐。
 */
async function runMassSendChecks (http, ctx) {
  let page = await fetchMassSendPage(http, ctx)
  const signed = await ensureProtocolSigned(http, ctx, page)
  if (signed.signed) page = signed.pageText
  const operationSeq = extractOperationSeq(page)

  const { cookie, token, appMsgId } = ctx
  const baseBody = { appmsgid: appMsgId, token, lang: 'zh_CN', f: 'json', ajax: '1' }

  const cr = await masssendAction(http, cookie, token, appMsgId, {
    query: { action: 'get_appmsg_copyright_stat', token, lang: 'zh_CN' },
    body: { ...baseBody, random: random10(), first_check: '1', type: '10' },
  })
  if (cr && cr.base_resp && Number(cr.base_resp.ret) === 64715 &&
      typeof cr.base_resp.err_msg === 'string' && cr.base_resp.err_msg.includes('TEXT_NUM_TOO_SMALL')) {
    return { ok: false, code: 'masssend-original-too-short', error: '群发失败：申明原创的正文不少于 300 字' }
  }
  const ad = await masssendAction(http, cookie, token, appMsgId, {
    query: { action: 'check_ad', token, lang: 'zh_CN' },
    body: { ...baseBody, random: random10(), is_release_publish_page: '1', send_time: '0' },
  })
  if (!ad || Number(ad.base_resp && ad.base_resp.ret) !== 0) {
    return { ok: false, code: 'masssend-ad-check-failed', error: `群发失败：${(ad && ad.base_resp && ad.base_resp.err_msg) || '广告位校验未通过'}` }
  }
  const music = await masssendAction(http, cookie, token, appMsgId, {
    query: { action: 'check_music' },
    body: { ...baseBody, masssend_check: '1' },
  })
  if (!music || Number(music.base_resp && music.base_resp.ret) !== 0) {
    return { ok: false, code: 'masssend-music-check-failed', error: `群发失败：${(music && music.base_resp && music.base_resp.err_msg) || '音乐版权校验未通过'}` }
  }
  return { ok: true, operationSeq }
}

/**
 * 构造发送体（参考产品 buildPushData，21 字段全量对齐）。
 * @param {object} task { country, province, city, publishTime, isMulti }
 */
function buildPushBody (task, appMsgId, token, { operationSeq = '', isFreePublish = false } = {}) {
  task = task || {}
  const parts = []
  parts.push(`token=${token}`)
  parts.push(`lang=zh_CN&f=json&ajax=1&random=${Math.random()}`)
  parts.push('type=10')
  parts.push('ack=')
  parts.push('reprint_info=')
  parts.push('reprint_confirm=0')
  parts.push('list=')
  parts.push(`appmsgid=${appMsgId}`)
  parts.push('share_page=1')
  parts.push(`sex=${task.sex != null ? task.sex : 0}`)
  parts.push(`groupid=${task.groupId != null ? task.groupId : ''}`)
  parts.push(`isMulti=${task.isMulti ? '1' : '0'}`)
  parts.push('synctxweibo=0')
  parts.push('sync_version=1')
  parts.push(`isFreePublish=${isFreePublish}`)
  parts.push(`fingerprint=${getReqId(32)}`)
  if (isFreePublish) parts.push('isFreePublish=true')
  let country = task.country != null ? String(task.country) : ''
  if (country === '0' || country === '全部') country = ''
  parts.push(`country=${encodeURIComponent(country)}`)
  parts.push(`province=${encodeURIComponent(task.province != null ? String(task.province) : '')}`)
  parts.push(`city=${encodeURIComponent(task.city != null ? String(task.city) : '')}`)
  parts.push(`operation_seq=${operationSeq}`)
  parts.push(`req_id=${getReqId(32)}`)
  parts.push(`req_time=${Date.now()}`)
  if (task.publishTime) {
    parts.push('direct_send=1')
    parts.push(`send_time=${task.publishTime}`)
  } else {
    parts.push('send_time=0')
  }
  parts.push('code=')
  return parts.join('&')
}

/**
 * 发送（参考产品 pushMsgResponse）：
 * - 发布（notify=0）：URL 加 is_release_publish_page=1
 * - 定时群发：URL 加 action=time_send
 * 判据：base_resp.ret === 0；失败 5s 后重试一次；两次都失败 ⇒ fail-closed。
 */
async function sendPush (http, ctx, body, { notifySubscribers = 0, publishTime = 0 } = {}) {
  const { cookie, token, appMsgId } = ctx
  const build = () => {
    const params = new URLSearchParams({ 't': 'ajax-response', token, lang: 'zh_CN' })
    if (Number(notifySubscribers) === 0) params.set('is_release_publish_page', '1')
    if (Number(notifySubscribers) === 1 && publishTime) params.set('action', 'time_send')
    return `${BASE}/masssend?${params.toString()}`
  }
  const headers = {
    Cookie: cookie,
    'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
    Referer: EDIT_REFERER(appMsgId, token),
    Origin: 'https://mp.weixin.qq.com',
  }
  const attempt = async () => { const r = await http.post(build(), body, { headers }); const d = r && r.data !== undefined ? r.data : r; return d && typeof d === 'object' ? d : {} }
  const first = await attempt()
  const okOf = (r) => !!(r && r.base_resp && Number(r.base_resp.ret) === 0)
  if (okOf(first)) return { ok: true, response: first, retried: false }
  // 重试间隔 5s（参考产品同值）；delayFn 可注入，测试注入 0ms 避免真实等待
  const delayFn = ctx.delayFn || ((ms) => new Promise((resolve) => { const t = setTimeout(resolve, ms); if (t && t.unref) t.unref() }))
  await delayFn(5000)
  const second = await attempt()
  if (okOf(second)) return { ok: true, response: second, retried: true }
  const errMsg = (second && second.base_resp && second.base_resp.err_msg) || '平台未确认发送成功'
  return { ok: false, code: 'masssend-push-failed', error: `发送失败：${errMsg}`, response: second, retried: true }
}

/**
 * 编排入口：按 publishMode（'publish' | 'masssend'）走完整链。
 * 调用方必须已通过 checkMassSendProtection（masssend 时）且已建好草稿拿到 appMsgId。
 */
async function publishArticle (http, ctx) {
  const { publishMode, task } = ctx
  if (publishMode !== 'publish' && publishMode !== 'masssend') {
    return { ok: false, code: 'publish-mode-unsupported', error: `未知的发布方式：${publishMode}` }
  }
  const checks = publishMode === 'publish'
    ? await runPublishChecks(http, ctx)
    : await runMassSendChecks(http, ctx)
  if (!checks.ok) return checks

  const operationSeq = publishMode === 'masssend' ? (checks.operationSeq || '') : ''
  const isFreePublish = publishMode === 'publish'
  const body = buildPushBody(task || {}, ctx.appMsgId, ctx.token, { operationSeq, isFreePublish })
  const notifySubscribers = publishMode === 'publish' ? 0 : 1
  const sent = await sendPush(http, ctx, body, { notifySubscribers, publishTime: (task && task.publishTime) || 0 })
  return sent
}

module.exports = {
  runPublishChecks,
  runMassSendChecks,
  fetchMassSendPage,
  ensureProtocolSigned,
  extractOperationSeq,
  buildPushBody,
  sendPush,
  publishArticle,
  getReqId,
}
