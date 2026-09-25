'use strict'
/**
 * douyin-video.js — 抖音准自包含视频发布链（W2 §2，Cookie + 直连平台官方 HTTP API）
 *
 * 六步链（逐字对照 01-docs/rpa-api-publish/evidence/yx-douyin-w2-slices.txt 取证切片）：
 *   0. 前置校验（fail-closed，零请求）：四类签名材料齐备 + clientSign 可签出 + 视频文件存在
 *   1. getSdkToken：creator HEAD，CSRF_POOL[idx%3] 轮换，x-ware-csrf-token.split(',')[1]
 *   2. getAuthKey：creator GET /web/api/media/upload/auth/v5/ → {AccessKeyID,SecretAccessKey,SessionToken}
 *   3. vod 上传（aws4 service:vod region:cn-north-1）：ApplyUploadInner → 分片 ★POST(phase=transfer)
 *      → finish(phase=finish) → CommitUploadInner → Result.Results[0].Vid
 *   4. 封面 imagex（aws4 service:imagex）：ApplyImageUpload → 单 ★POST → CommitImageUpload → Results[0].Uri
 *   5. create_v2：creator POST，bd-ticket-guard-* 头组（clientSign/ree/web-version）+ msToken + a_bogus 空
 *   6. 裁决：x-tt-verify-passport-decision → risk_blocked（D1 不自动验证）；status_code===0&&aweme_id → 成功
 *
 * 客户端 creator/vod/imagex/upload 四类 base 均可注入 → 测试全指本机假 HTTP 服务器，零外发。
 * 合规红线：只直连 douyin/byte 官方域名，绝不调用任何第三方签名服务；私钥/ticket 不入日志。
 */
const fs = require('fs')
const crypto = require('crypto')
const zlib = require('zlib')
const aws4 = require('aws4')
const { createHttpClient, requestWithRetry } = require('../core/http-base')
const { errorCode } = require('../../error-codes')
const { clientSign, extractReePublicKey, webVersionFromTicket, CREATE_V2_PATH } = require('../../signer/douyin-ticket-guard')

const CREATOR_BASE = 'https://creator.douyin.com'
const VOD_BASE = 'https://vod.bytedanceapi.com'
const IMAGEX_BASE = 'https://imagex.bytedanceapi.com'
const APP_ID = 2906
const REGION = 'cn-north-1'
const VOD_VERSION = '2020-11-19'
const IMAGEX_VERSION = '2018-08-01'
const IMAGEX_SERVICE_ID = 'jm8ajry58r'
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36'
const FAIL_MSG = '账号信息缺失，请重新授权此账号再试'

// csrf HEAD URL 池（D3：默认 idx=1 命中 /aweme/create/）
const CSRF_POOL = [
  '/web/api/media/anchor/search',
  '/web/api/media/aweme/create/',
  '/aweme/v1/creator/homepage/module/',
]

class DouyinVideoError extends Error {
  constructor (message, code) {
    super(message)
    this.name = 'DouyinVideoError'
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
function clean (t) { return String(t == null ? '' : t).replace(/\s*\n\s*$/, '').trim() }
function pickSigned (headers) {
  const out = {}
  for (const k of Object.keys(headers)) {
    if (/^(authorization|x-amz-date|x-amz-content-sha256|x-amz-security-token|content-type)$/i.test(k)) out[k] = headers[k]
  }
  return out
}
function hostOf (base) { try { return new URL(base).host } catch (e) { return '' } }

/** 分片大小阶梯（字节）：<=500MB→3MiB，<=1GB→5MiB，否则 10MiB */
function partSizeFor (size) {
  const MB = 1024 * 1024
  if (size > 1000 * MB) return 10 * MB
  if (size > 500 * MB) return 5 * MB
  return 3 * MB
}

/** 构造 create_v2 投稿体；纯函数，供链与薄适配器共用 */
function buildDouyinPostData (taskData, ctx) {
  return {
    item: {
      common: {
        item_title: clean(taskData.title),
        content_desc: clean(taskData.content || taskData.desc || ''),
        video_id: ctx.videoId,
        media_type: 4,
        visibility_type: ctx.visibilityType,
        cover_poster_ids: [],
        poi_name: '',
        text_extra: [],
        is_aigc: false,
      },
      cover: { poster: ctx.coverPoster },
      declare: { user_declare_info: '{}' },
    },
  }
}

class DouyinVideoChain {
  constructor (opts = {}) {
    this.cookie = opts.cookie
    this.userAgent = opts.userAgent || UA
    this.logger = opts.logger || console
    this.region = opts.region || REGION
    this.appId = opts.appId === undefined ? APP_ID : opts.appId
    this.csrfIdx = opts.csrfIdx === undefined ? 1 : opts.csrfIdx
    this.creatorBase = opts.creatorBase || CREATOR_BASE
    this.vodBase = opts.vodBase || VOD_BASE
    this.imagexBase = opts.imagexBase || IMAGEX_BASE
    this.uploadScheme = opts.uploadScheme || 'https:'
    const timeout = opts.timeout
    const headers = { 'User-Agent': this.userAgent }
    this.creator = opts.creator || createHttpClient({ baseURL: this.creatorBase, timeout, agents: opts.agents, headers })
    this.vod = opts.vod || createHttpClient({ baseURL: this.vodBase, timeout, headers })
    this.imagex = opts.imagex || createHttpClient({ baseURL: this.imagexBase, timeout, headers })
    this.upload = opts.uploadHttp || createHttpClient({ timeout, headers })
  }

  _creatorHeaders (extra) {
    return Object.assign({ Cookie: this.cookie, 'User-Agent': this.userAgent }, extra || {})
  }

  /** Step 0：fail-closed 前置校验（零请求）——四类签名材料齐备 + clientSign 可签出 */
  _assertPreconditions () {
    const c = String(this.cookie || '')
    if (!c) throw new DouyinVideoError('douyin-video: missing cookie (fail-closed)', errorCode.data_error)
    if (!c.includes('s_sdk_crypt_sdk=') || !c.includes('s_sdk_sign_data_key/web_protect=')) {
      throw new DouyinVideoError(FAIL_MSG, errorCode.data_error)
    }
    if (!c.includes('bd_ticket_guard_client_data') ) {
      throw new DouyinVideoError(FAIL_MSG, errorCode.data_error)
    }
    if (!c.includes('sid_tt=')) {
      throw new DouyinVideoError(FAIL_MSG, errorCode.data_error)
    }
    // 预生成 clientSign（失败=私钥非法/材料缺失 → 脱敏授权提示）
    try { this._clientData = clientSign(c) } catch (e) { throw new DouyinVideoError(FAIL_MSG, errorCode.data_error) }
    this._ree = extractReePublicKey(c)
    const sd = decodeSignData(c)
    this._webVersion = webVersionFromTicket(sd && sd.ticket)
  }

  /** Step 1：getSdkToken —— creator HEAD csrf，取 x-ware-csrf-token 第二段 */
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

  /** Step 2：getAuthKey —— creator GET auth/v5（非 JSON 风控重试），返回 {AccessKeyID,...} */
  async getAuthKey () {
    const res = await requestWithRetry(this.creator, {
      method: 'get', url: '/web/api/media/upload/auth/v5/', headers: this._creatorHeaders({ Accept: 'application/json' }),
    })
    const d = res.data || {}
    const authStr = d.auth
    if (!authStr) throw new DouyinVideoError('douyin-video: 未获取上传授权(auth)', errorCode.data_error)
    let a
    try { a = typeof authStr === 'string' ? JSON.parse(authStr) : authStr } catch (e) { throw new DouyinVideoError('douyin-video: auth 解析失败', errorCode.data_error) }
    return { accessKeyId: a.AccessKeyID, secretAccessKey: a.SecretAccessKey, sessionToken: a.SessionToken }
  }

  _applyQuery (params) {
    return Object.keys(params).map((k) => encodeURIComponent(k) + '=' + encodeURIComponent(params[k])).join('&')
  }

  /** 通用 aws4 签名 GET（vod/imagex apply） */
  async _signedGet (client, base, service, query, creds) {
    const path = '/?' + query
    const headers = { 'x-amz-content-sha256': sha256hex('') }
    const o = { host: hostOf(base), path, method: 'GET', headers, service, region: this.region }
    aws4.sign(o, creds)
    return client.request({ method: 'get', url: path, headers: pickSigned(o.headers), validateStatus: (s) => s >= 200 && s < 500 })
  }

  /** 通用 aws4 签名 POST（vod/imagex commit，JSON 体） */
  async _signedPost (client, base, service, path, bodyObj, creds) {
    const bodyStr = JSON.stringify(bodyObj)
    const headers = { 'content-type': 'application/json', 'x-amz-content-sha256': sha256hex(bodyStr) }
    const o = { host: hostOf(base), path, method: 'POST', headers, body: bodyStr, service, region: this.region }
    aws4.sign(o, creds)
    return client.request({ method: 'post', url: path, data: bodyStr, headers: pickSigned(o.headers), maxBodyLength: Infinity, validateStatus: (s) => s >= 200 && s < 500 })
  }

  /** Step 3：vod 视频上传链 → Vid（apply→transfer 分片→finish→CommitUploadInner） */
  async uploadVideo (filePath, creds, uid, onProgress) {
    const size = fs.statSync(filePath).size
    const applyQ = this._applyQuery({
      Action: 'ApplyUploadInner', Version: VOD_VERSION, SpaceName: 'aweme', FileType: 'video',
      IsInner: 1, FileSize: size, app_id: this.appId, user_id: uid, s: crypto.randomBytes(8).toString('hex'),
    })
    const ar = await this._signedGet(this.vod, this.vodBase, 'vod', applyQ, creds)
    const node = (((ar.data || {}).Result || {}).InnerUploadAddress || {}).UploadNodes || []
    if (!node.length) throw new DouyinVideoError('douyin-video: vod apply 无 UploadNodes', errorCode.data_error)
    const n0 = node[0]
    const store = (n0.StoreInfos || [])[0] || {}
    const uploadId = crypto.randomUUID()
    const base = this.uploadScheme + '//' + n0.UploadHost + '/upload/v1/' + store.StoreUri
    const partSize = partSizeFor(size)
    const total = Math.max(1, Math.ceil(size / partSize))
    const fh = fs.openSync(filePath, 'r')
    const crcs = new Map()
    try {
      for (let i = 0; i < total; i++) {
        const start = i * partSize
        const len = Math.min(partSize, size - start)
        const buf = Buffer.alloc(len)
        fs.readSync(fh, buf, 0, len, start)
        const crc = crc32Hex(buf)
        const url = base + '?uploadid=' + uploadId + '&part_number=' + (i + 1) + '&phase=transfer&part_offset=' + start
        await this.upload.request({
          method: 'post', url, data: buf, maxBodyLength: Infinity,
          headers: { Authorization: store.Auth, 'Content-CRC32': crc, 'Content-Type': 'application/octet-stream', 'X-Storage-U': uid, 'User-Agent': this.userAgent },
          validateStatus: (s) => s >= 200 && s < 500,
        })
        crcs.set(i + 1, crc)
        if (onProgress) onProgress(Math.round(((i + 1) / total) * 70), '视频上传中')
      }
    } finally { fs.closeSync(fh) }
    if (crcs.size < total) throw new DouyinVideoError('douyin-video: 分片缺失（' + crcs.size + '/' + total + '）', errorCode.io_error)
    // finish
    await this.upload.request({
      method: 'post', url: base + '?uploadid=' + uploadId + '&phase=finish&uploadmode=part', data: '',
      headers: { Authorization: store.Auth, 'Content-Type': 'text/plain', 'X-Storage-U': uid, 'User-Agent': this.userAgent },
      validateStatus: (s) => s >= 200 && s < 500,
    })
    // CommitUploadInner
    const commitPath = '/?Action=CommitUploadInner&' + this._applyQuery({ Version: VOD_VERSION, SpaceName: 'aweme', app_id: this.appId, user_id: uid })
    const commitBody = { SessionKey: n0.SessionKey, Functions: [{ name: 'GetMeta' }, { name: 'Snapshot', input: { SnapshotTime: 0 } }] }
    const cr = await this._signedPost(this.vod, this.vodBase, 'vod', commitPath, commitBody, creds)
    const results = (((cr.data || {}).Result || {}).Results || [{}])
    const vid = results[0] && results[0].Vid
    if (!vid) throw new DouyinVideoError('douyin-video: CommitUploadInner 未返回 Vid', errorCode.data_error)
    return vid
  }

  /** Step 4：封面 imagex 上传链 → poster Uri */
  async uploadCover (coverPath, creds, uid) {
    const buf = fs.readFileSync(coverPath)
    const applyQ = this._applyQuery({ Action: 'ApplyImageUpload', Version: IMAGEX_VERSION, ServiceId: IMAGEX_SERVICE_ID, app_id: this.appId, user_id: uid, s: crypto.randomBytes(8).toString('hex') })
    const ar = await this._signedGet(this.imagex, this.imagexBase, 'imagex', applyQ, creds)
    const node = (((ar.data || {}).Result || {}).InnerUploadAddress || {}).UploadNodes || []
    if (!node.length) throw new DouyinVideoError('douyin-video: imagex apply 无 UploadNodes', errorCode.data_error)
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
    if (!uri) throw new DouyinVideoError('douyin-video: CommitImageUpload 未返回 Uri', errorCode.data_error)
    return uri
  }

  buildPostData (taskData, ctx) { return buildDouyinPostData(taskData, ctx) }

  /** Step 5：create_v2 投稿 + Step 6 裁决 */
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
    // Step 6 裁决
    const verify = (res.headers && res.headers['x-tt-verify-passport-decision']) || ''
    if (String(verify).trim()) {
      return { success: false, risk_blocked: true, platform: 'douyin', error: '抖音触发安全验证，请在创作者中心手动完成验证后重试（不自动换号）' }
    }
    const d = res.data || {}
    if (d.status_code === 0 && d.aweme_id) {
      return { success: true, mode: 'api', platform: 'douyin', publishId: String(d.aweme_id), draft: opts.draft !== false }
    }
    if (d.status_code === 110) {
      return { success: false, risk_blocked: true, platform: 'douyin', error: '抖音验证失败(110)，请手动完成验证后重试' }
    }
    return { success: false, code: d.status_code, platform: 'douyin', error: d.status_msg || '抖音发布失败' }
  }

  /** 全链编排 */
  async run (taskData, opts = {}) {
    this._assertPreconditions()
    if (!taskData || !taskData.video || !taskData.video.path) throw new DouyinVideoError('douyin-video: taskData.video.path required', errorCode.data_error)
    if (!fs.existsSync(taskData.video.path)) throw new DouyinVideoError('douyin-video: video file not found: ' + taskData.video.path, errorCode.io_error)
    const uid = cookieValue(this.cookie, 'uid_tt=') || cookieValue(this.cookie, 'user_id=')
    const sdkToken = await this.getSdkToken()
    const creds = await this.getAuthKey()
    const videoId = await this.uploadVideo(taskData.video.path, creds, uid, opts.onProgress)
    const coverPath = (taskData.cover && taskData.cover.path) || taskData.video.path
    const coverPoster = fs.existsSync(coverPath) ? await this.uploadCover(coverPath, creds, uid) : ''
    const visibilityType = Number(taskData.visibility_type != null ? taskData.visibility_type : (opts.draft === false ? 102 : 0))
    const postData = this.buildPostData(taskData, { videoId, coverPoster, visibilityType })
    return this.publish(postData, sdkToken, opts)
  }
}

function decodeSignData (cookie) {
  try {
    const raw = cookieValue(cookie, 'security-sdk/s_sdk_sign_data_key/web_protect=')
    return JSON.parse(JSON.parse(decodeURIComponent(raw)).data)
  } catch (e) { return null }
}

module.exports = {
  DouyinVideoChain,
  DouyinVideoError,
  buildDouyinPostData,
  partSizeFor,
  cookieValue,
  CSRF_POOL,
  CREATOR_BASE,
  VOD_BASE,
  IMAGEX_BASE,
}
