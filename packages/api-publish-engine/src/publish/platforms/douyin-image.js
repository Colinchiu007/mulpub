'use strict'
/**
 * douyin-image.js — 抖音图文 API 直连发布链（D 方案，publish-throughput-optimization）
 *
 * 与 douyin-video.js 同构的六步链，差异仅在媒体上传段（多图 imagex）与 create 请求体（图文类型）：
 *   0. 前置校验（fail-closed，零请求）：签名材料齐备（复用视频链同款判据）+ images 非空 + 文件存在
 *   1. getSdkToken / 2. getAuthKey —— 与视频链完全同款（CSRF 轮换 + auth/v5）
 *   3. 逐图 imagex 上传（ApplyImageUpload → 单 POST → CommitImageUpload → Uri）——
 *      与视频链 uploadCover 同一 imagex 语义，循环 N 次
 *   4. create_v2 图文提交 —— bd-ticket-guard 头组与视频链同款；请求体按视频链 item.common
 *      结构同构 + 图文类型字段。⚠️ UNVERIFIED：图文 create 体字段**无真机取证切片**
 *      （01-docs/rpa-api-publish/evidence/yx-douyin-w2-slices.txt 只覆盖视频链），
 *      字段按同构推断书写；真机验证步骤与逐字段状态见
 *      01-docs/PRD-PUBLISH-THROUGHPUT-OPTIMIZATION-2026-10-04.md §D 取证表。
 *      API 失败自动回退 RPA 图文链（rpa-view-manager 既有 fallback），用户侧零新增风险面。
 *   5. 裁决：x-tt-verify-passport-decision / status_code 110 → risk_blocked（与视频链同口径）
 *
 * 合规红线（承 douyin-video.js）：只直连 douyin/byte 官方域名；私钥/ticket 不入日志。
 */
const fs = require('fs')
const crypto = require('crypto')
const aws4 = require('aws4')
const { createHttpClient } = require('../core/http-base')
const { errorCode } = require('../../error-codes')
const { clientSign, extractReePublicKey, webVersionFromTicket, CREATE_V2_PATH } = require('../../signer/douyin-ticket-guard')
const { findInlineTopicPositions, formatArticleBody } = require('../../content-formatter')

const CREATOR_BASE = 'https://creator.douyin.com'
const IMAGEX_BASE = 'https://imagex.bytedanceapi.com'
const APP_ID = 2906
const REGION = 'cn-north-1'
const IMAGEX_VERSION = '2018-08-01'
const IMAGEX_SERVICE_ID = 'jm8ajry58r'
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36'
const FAIL_MSG = '账号信息缺失，请重新授权此账号再试'
// 图文 create 的 csrf HEAD 池与视频链一致（模块常量不共享 import——两链独立演进，注释互指）
const CSRF_POOL = [
  '/web/api/media/anchor/search',
  '/web/api/media/aweme/create/',
  '/aweme/v1/creator/homepage/module/',
]

class DouyinImageError extends Error {
  constructor (message, code) {
    super(message)
    this.name = 'DouyinImageError'
    this.code = code === undefined ? errorCode.data_error : code
  }
}

function cookieValue (cookie, key) {
  const seg = String(cookie || '').split(key)[1]
  if (seg === undefined) return ''
  return seg.split(';')[0].trim()
}
function sha256hex (s) { return crypto.createHash('sha256').update(s, 'utf8').digest('hex') }
function crc32Hex (buf) { return ((zlib.crc32(buf) >>> 0)).toString(16).padStart(8, '0') }
const zlib = require('zlib')
function clean (t) { return String(t == null ? '' : t).replace(/\s*\n\s*$/, '').trim() }
function pickSigned (headers) {
  const out = {}
  for (const k of Object.keys(headers)) {
    if (/^(authorization|x-amz-date|x-amz-content-sha256|x-amz-security-token|content-type)$/i.test(k)) out[k] = headers[k]
  }
  return out
}
function hostOf (base) { try { return new URL(base).host } catch (e) { return '' } }

class DouyinImageChain {
  constructor (opts = {}) {
    this.cookie = opts.cookie
    this.userAgent = opts.userAgent || UA
    this.logger = opts.logger || console
    this.region = opts.region || REGION
    this.appId = opts.appId === undefined ? APP_ID : opts.appId
    this.csrfIdx = opts.csrfIdx === undefined ? 1 : opts.csrfIdx
    this.creatorBase = opts.creatorBase || CREATOR_BASE
    this.imagexBase = opts.imagexBase || IMAGEX_BASE
    this.uploadScheme = opts.uploadScheme || 'https:'
    const timeout = opts.timeout
    const headers = { 'User-Agent': this.userAgent }
    this.creator = opts.creator || createHttpClient({ baseURL: this.creatorBase, timeout, agents: opts.agents, headers })
    this.imagex = opts.imagex || createHttpClient({ baseURL: this.imagexBase, timeout, headers })
    this.upload = opts.uploadHttp || createHttpClient({ timeout, headers })
  }

  _creatorHeaders (extra) {
    return Object.assign({ Cookie: this.cookie, 'User-Agent': this.userAgent }, extra || {})
  }

  /** Step 0：fail-closed 前置校验（判据与 douyin-video._assertPreconditions 同款——
   *  签名材料四类齐备 + clientSign 可签出；刻意不复制代码，注释锚定同款语义，防两处漂移由测试兜底） */
  _assertPreconditions () {
    const c = String(this.cookie || '')
    if (!c) throw new DouyinImageError('douyin-image: missing cookie (fail-closed)', errorCode.data_error)
    if (!c.includes('s_sdk_crypt_sdk=') || !c.includes('s_sdk_sign_data_key/web_protect=')) {
      throw new DouyinImageError(FAIL_MSG, errorCode.data_error)
    }
    if (!c.includes('bd_ticket_guard_client_data')) throw new DouyinImageError(FAIL_MSG, errorCode.data_error)
    if (!c.includes('sid_tt=')) throw new DouyinImageError(FAIL_MSG, errorCode.data_error)
    try { this._clientData = clientSign(c) } catch (e) { throw new DouyinImageError(FAIL_MSG, errorCode.data_error) }
    this._ree = extractReePublicKey(c)
    // webVersionFromTicket 需要解析 sign_data（与视频链 decodeSignData 同款）
    try {
      const raw = cookieValue(c, 'security-sdk/s_sdk_sign_data_key/web_protect=')
      const sd = JSON.parse(JSON.parse(decodeURIComponent(raw)).data)
      this._webVersion = webVersionFromTicket(sd && sd.ticket)
    } catch (e) { this._webVersion = webVersionFromTicket(null) }
  }

  /** Step 1：getSdkToken（与视频链同款） */
  async getSdkToken () {
    const path = CSRF_POOL[this.csrfIdx % CSRF_POOL.length]
    const res = await this.creator.request({
      method: 'head', url: path,
      headers: this._creatorHeaders({ Referer: this.creatorBase + '/content/upload', 'x-secsdk-csrf-request': '1', 'x-secsdk-csrf-version': '1.2.7' }),
      validateStatus: (s) => s >= 200 && s < 500,
    })
    const tok = (res.headers && res.headers['x-ware-csrf-token']) || ''
    return String(tok).split(',')[1] || ''
  }

  /** Step 2：getAuthKey（与视频链同款） */
  async getAuthKey () {
    const res = await this.creator.request({
      method: 'get', url: '/web/api/media/upload/auth/v5/', headers: this._creatorHeaders({ Accept: 'application/json' }),
      validateStatus: (s) => s >= 200 && s < 500,
    })
    const d = res.data || {}
    const authStr = d.auth
    if (!authStr) throw new DouyinImageError('douyin-image: 未获取上传授权(auth)', errorCode.data_error)
    let a
    try { a = typeof authStr === 'string' ? JSON.parse(authStr) : authStr } catch (e) { throw new DouyinImageError('douyin-image: auth 解析失败', errorCode.data_error) }
    return { accessKeyId: a.AccessKeyID, secretAccessKey: a.SecretAccessKey, sessionToken: a.SessionToken }
  }

  _applyQuery (params) {
    return Object.keys(params).map((k) => encodeURIComponent(k) + '=' + encodeURIComponent(params[k])).join('&')
  }

  _signedGet (client, base, service, query, creds) {
    return this._signedGetAsync(client, base, service, query, creds)
  }

  async _signedGetAsync (client, base, service, query, creds) {
    const path = '/?' + query
    const headers = { 'x-amz-content-sha256': sha256hex('') }
    const o = { host: hostOf(base), path, method: 'GET', headers, service, region: this.region }
    aws4.sign(o, creds)
    return client.request({ method: 'get', url: path, headers: pickSigned(o.headers), validateStatus: (s) => s >= 200 && s < 500 })
  }

  async _signedPost (client, base, service, path, bodyObj, creds) {
    const bodyStr = JSON.stringify(bodyObj)
    const headers = { 'content-type': 'application/json', 'x-amz-content-sha256': sha256hex(bodyStr) }
    const o = { host: hostOf(base), path, method: 'POST', headers, body: bodyStr, service, region: this.region }
    aws4.sign(o, creds)
    return client.request({ method: 'post', url: path, data: bodyStr, headers: pickSigned(o.headers), maxBodyLength: Infinity, validateStatus: (s) => s >= 200 && s < 500 })
  }

  /** Step 3：单张图片 imagex 上传 → Uri（与视频链 uploadCover 同一 imagex 语义） */
  async uploadImage (filePath, creds, uid) {
    const buf = fs.readFileSync(filePath)
    const applyQ = this._applyQuery({ Action: 'ApplyImageUpload', Version: IMAGEX_VERSION, ServiceId: IMAGEX_SERVICE_ID, app_id: this.appId, user_id: uid, s: crypto.randomBytes(8).toString('hex') })
    const ar = await this._signedGetAsync(this.imagex, this.imagexBase, 'imagex', applyQ, creds)
    const node = (((ar.data || {}).Result || {}).InnerUploadAddress || {}).UploadNodes || []
    if (!node.length) throw new DouyinImageError('douyin-image: imagex apply 无 UploadNodes', errorCode.data_error)
    const n0 = node[0]
    const store = (n0.StoreInfos || [])[0] || {}
    const url = this.uploadScheme + '//' + n0.UploadHost + '/upload/v1/' + store.StoreUri
    await this.upload.request({
      method: 'post', url, data: buf, maxBodyLength: Infinity,
      headers: { Authorization: store.Auth, 'Content-CRC32': crc32Hex(buf), 'Content-Type': 'application/octet-stream', 'X-Storage-U': uid, 'User-Agent': this.userAgent },
      validateStatus: (s) => s >= 200 && s < 500,
    })
    const commitPath = '/?Action=CommitImageUpload&' + this._applyQuery({ Version: IMAGEX_VERSION, ServiceId: IMAGEX_SERVICE_ID, app_id: this.appId, user_id: uid })
    const cr = await this._signedPost(this.imagex, this.imagexBase, 'imagex', commitPath, { SessionKey: n0.SessionKey }, creds)
    const results = (((cr.data || {}).Result || {}).Results || [{}])
    const uri = results[0] && results[0].Uri
    if (!uri) throw new DouyinImageError('douyin-image: CommitImageUpload 未返回 Uri', errorCode.data_error)
    return uri
  }

  /** Step 4：图文 create_v2 提交体。
   *  ⚠️ UNVERIFIED 字段（无真机取证切片，同构视频链推断，PRD §D 逐字段登记）：
   *  - media_type 数值（视频链为 4；图文取值未验证——保守不改，真机验证时确认）
   *  - images 数组元素形状（{uri} 推断；实际字段名可能是 image_uri/cover_uri 等）
   *  已验证锚点：item.common.item_title/content_desc/visibility_type/text_extra 形状与视频链一致
   *  （这些字段在视频 create_v2 中被服务端接受，属同一 creator API 面）。 */
  buildImagePostData (taskData, ctx) {
    // 正文承载形态（publish-article-body-format，2026-10-12）：抖音描述是**纯文本**语义
    // （计数器按可见字符算），Rich 编辑器来的 HTML 若原样透出会以字面量 `<p>` 出现在作品简介。
    // 先适配再 clean、再算 text_extra 偏移（偏移必须基于最终发送的文本）。
    const contentDesc = clean(formatArticleBody('douyin', taskData.content || taskData.desc || ''))
    const textExtra = findInlineTopicPositions(contentDesc, taskData.tags || []).map(pos => ({
      start: pos.start,
      end: pos.end,
      type: 0,
      user_id: '',
      hashtag_id: 0,
      hashtag_name: pos.name,
    }))
    return {
      item: {
        common: {
          item_title: clean(taskData.title),
          content_desc: contentDesc,
          // UNVERIFIED：视频链用 video_id；图文链按同构用 image_ids 承载多图 Uri
          image_ids: ctx.imageUris,
          media_type: 4, // UNVERIFIED：图文实际枚举值需真机确认
          visibility_type: ctx.visibilityType,
          cover_poster_ids: [],
          poi_name: '',
          text_extra: textExtra,
          is_aigc: taskData.aiGenerated === true,
        },
        cover: { poster: ctx.imageUris[0] || '' }, // UNVERIFIED：首图作封面（推断）
        declare: { user_declare_info: '{}' },
      },
    }
  }

  /** Step 5：create_v2 图文提交 + Step 6 裁决（与视频链 publish 同构） */
  async publish (postData, sdkToken, opts = {}) {
    const ms = cookieValue(this.cookie, 'msToken=') || ('a12man123masb' + Date.now())
    const query = this._applyQuery({ read_aid: this.appId, aid: 1128, support_h265: 1, msToken: ms, a_bogus: '' })
    const url = CREATE_V2_PATH + '?' + query
    const res = await this.creator.request({
      method: 'post', url, data: JSON.stringify(postData), maxBodyLength: Infinity,
      headers: this._creatorHeaders({
        'Content-Type': 'application/json',
        'x-secsdk-csrf-token': sdkToken,
        'bd-ticket-guard-version': '2',
        'bd-ticket-guard-web-version': this._webVersion,
        'bd-ticket-guard-iteration-version': '1',
        'bd-ticket-guard-web-sign-type': '0',
        'bd-ticket-guard-ree-public-key': this._ree,
        'bd-ticket-guard-client-data': this._clientData,
        Referer: this.creatorBase + '/content/publish?enter_from=publish_page',
        Origin: this.creatorBase,
      }),
      validateStatus: (s) => s >= 200 && s < 500,
    })
    const verify = (res.headers && res.headers['x-tt-verify-passport-decision']) || ''
    if (String(verify).trim()) {
      return { success: false, risk_blocked: true, platform: 'douyin', error: '抖音触发安全验证，请在创作者中心手动完成验证后重试（不自动换号）' }
    }
    const d = res.data || {}
    if (d.status_code === 0 && (d.aweme_id || d.item_id)) {
      return { success: true, mode: 'api', platform: 'douyin', publishId: String(d.aweme_id || d.item_id), draft: opts.draft !== false }
    }
    if (d.status_code === 110) {
      return { success: false, risk_blocked: true, platform: 'douyin', error: '抖音验证失败(110)，请手动完成验证后重试' }
    }
    return { success: false, code: d.status_code, platform: 'douyin', error: d.status_msg || '抖音发布失败' }
  }

  /** 全链编排 */
  async run (taskData, opts = {}) {
    this._assertPreconditions()
    const images = taskData && Array.isArray(taskData.images) ? taskData.images : []
    if (!images.length) throw new DouyinImageError('douyin-image: taskData.images required (non-empty)', errorCode.data_error)
    for (const img of images) {
      const p = img && (img.path || img)
      if (!p || !fs.existsSync(p)) throw new DouyinImageError('douyin-image: image file not found: ' + String(p), errorCode.io_error)
    }
    const uid = cookieValue(this.cookie, 'uid_tt=') || cookieValue(this.cookie, 'user_id=')
    const sdkToken = await this.getSdkToken()
    const creds = await this.getAuthKey()
    const imageUris = []
    for (let i = 0; i < images.length; i++) {
      const p = images[i].path || images[i]
      const uri = await this.uploadImage(p, creds, uid)
      imageUris.push(uri)
      if (opts.onProgress) opts.onProgress(Math.round(((i + 1) / images.length) * 80), '图片上传中')
    }
    const visibilityType = Number(taskData.visibility_type != null ? taskData.visibility_type : (opts.draft === false ? 102 : 0))
    const postData = this.buildImagePostData(taskData, { imageUris, visibilityType })
    if (opts.onProgress) opts.onProgress(90, '提交发布')
    return this.publish(postData, sdkToken, opts)
  }
}

module.exports = { DouyinImageChain, DouyinImageError, CSRF_POOL, CREATOR_BASE, IMAGEX_BASE }
