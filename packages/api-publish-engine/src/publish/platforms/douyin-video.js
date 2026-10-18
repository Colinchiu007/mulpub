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
const { createHttpClient, requestWithRetry } = require('../core/http-base')
const { errorCode } = require('../../error-codes')
const {
  clientSign, extractReePublicKey, webVersionFromTicket, CREATE_V2_PATH,
  hasSecurityMaterials, hasKeyIdOnlyMaterials, resolveSignDataPayload,
} = require('../../signer/douyin-ticket-guard')
// 话题内联描述（publish-topic-inline-description）：抖音是内联保留型平台——
// 描述里的 `#话题` 原样保留在 content_desc，text_extra 标记话题位置段
// （hashtag_id=0 纯文本话题，平台话题实体回填属 P2）。位置扫描用 content-formatter 单一实现。
const { findInlineTopicPositions, formatArticleBody } = require('../../content-formatter')
// 字节系共享 vod 上传协议 + aws4 签名器（apply→分片→finish→commit）。
// 2026-10-18 与头条视频链共用单一实现；vod 与 imagex 两个 service 都走这套签名。
const {
  partSizeFor, uploadVideoToVod, signedGet, signedPost,
} = require('../core/bytedance-vod')

const CREATOR_BASE = 'https://creator.douyin.com'
const VOD_BASE = 'https://vod.bytedanceapi.com'
const IMAGEX_BASE = 'https://imagex.bytedanceapi.com'
const APP_ID = 2906
const REGION = 'cn-north-1'
// VOD_VERSION 统一由 core/bytedance-vod.js 提供（2026-10-18 与头条链共用）。
const IMAGEX_VERSION = '2018-08-01'
const IMAGEX_SERVICE_ID = 'jm8ajry58r'
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36'
const FAIL_MSG = '账号信息缺失，请重新授权此账号再试'
/**
 * 签名材料**只剩 key id** 时的专用提示（2026-10-19 真机实证新增）。
 *
 * 实测形态：真实账号的 `__security_mc_1_s_sdk_crypt_sdk` /
 * `..._s_sdk_sign_data_key_web_protect` / `..._s_sdk_cert_key` 的值都**只有 18 字符**
 * （形如 `056709ca-4e73-9159`），是 **key id**，不是密文本体。
 *
 * 真材料在哪 —— **实测未找到**（此处曾写「在 IndexedDB `secure-store`，不可导出」，后经复测该库
 * `cryptvalues` 的 keyCount = 0，那条断言**不成立**，已订正）：
 *   · `localStorage['security-sdk/s_sdk_server_cert_key']` 只有**服务端证书**（无明文私钥）；
 *   · `localStorage['ztsdk_tcc_config']` 只有 secsdk 配置；
 *   · `window.secsdk` 存在但**只暴露 `csrf`**，无公开签名入口。
 * ⇒ 准确表述是「本机读不到可用的签名材料」，而**不是**「已知它不可导出」。
 *
 * ⇒ 纯 Node 侧签名**在本机不可行**；不是「账号信息缺失」，也不该提示用户去重新授权。
 */
const FAIL_MSG_MATERIAL_ONLY_ID = '抖音签名材料仅剩 key id（签名私钥不在 cookie 中，本机也读不到可用的私钥材料），'
  + '纯 API 轨无法完成 create_v2 签名；请改用 RPA/DOM 轨'

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
function crc32Hex (buf) { return ((zlib.crc32(buf) >>> 0)).toString(16).padStart(8, '0') }
function clean (t) { return String(t == null ? '' : t).replace(/\s*\n\s*$/, '').trim() }

// 已抽到 core/bytedance-vod.js 的：partSizeFor / sha256hex / pickSigned / hostOf / signedGet / signedPost

/** 构造 create_v2 投稿体；纯函数，供链与薄适配器共用 */
function buildDouyinPostData (taskData, ctx) {
  // 话题内联描述：描述里的 #话题 原样进 content_desc（描述为真源），
  // text_extra 按已知话题（tags 含描述解析值）标记位置段；无话题时空数组（兼容现状）
  // 正文承载形态（publish-article-body-format，2026-10-12）：描述是纯文本语义，
  // HTML 正文须先剥标签（否则 `<p>` 以字面量进作品简介）；偏移基于最终文本计算。
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
        video_id: ctx.videoId,
        media_type: 4,
        visibility_type: ctx.visibilityType,
        cover_poster_ids: [],
        poi_name: '',
        text_extra: textExtra,
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
    // 2026-10-13：判据改走 signer 的单一事实源 hasSecurityMaterials——
    // 此前 includes('s_sdk_sign_data_key/web_protect=') 依赖 '/'，而真实 cookie 名是
    // __security_mc_<N>_s_sdk_sign_data_key_web_protect（'/' → '_'），
    // 且 cookie 名不允许含 '/' ⇒ 该判据在真实账号上恒 false → Step 0 必然 fail-closed。
    if (!hasSecurityMaterials(c)) {
      throw new DouyinVideoError(FAIL_MSG, errorCode.data_error)
    }
    // ⚠️ 2026-10-19 真机实证新增的两级诊断（**不放松任何既有守卫**）：
    //
    // ① 材料只剩 key id ⇒ 抛**专用**诊断。实测真实账号的
    //    `__security_mc_1_s_sdk_crypt_sdk` / `..._sign_data_key_web_protect` / `..._cert_key`
    //    值都只有 18 字符（形如 `056709ca-4e73-9159`），是 key id 而非密文；
    //    真材料（含 `ec_privateKey` PEM）在页面 **IndexedDB `secure-store`**，
    //    WebCrypto 私钥设计上**不可导出** ⇒ 纯 Node 侧签名对本机真实账号**架构性不可行**。
    //    此前这种情况会落到通用 FAIL_MSG「账号信息缺失，请重新授权」，
    //    把「重新授权也拿不到」误导成「用户该重新登录」——这是本轮的实证修正。
    if (hasKeyIdOnlyMaterials(c)) {
      throw new DouyinVideoError(FAIL_MSG_MATERIAL_ONLY_ID, errorCode.data_error)
    }
    // ② ree 公钥 cookie 仍然 fail-closed：本仓**没有证据**表明可以省（真机实测走到这里时
    //    会话已过期，无法验证 create_v2 是否接受空 `bd-ticket-guard-ree-public-key`）。
    //    ⇒ 保持原判据不动，宁可在有证据前继续拒绝，也不把「未验证」当成「可省」。
    if (!c.includes('bd_ticket_guard_client_data')) {
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

  // 通用 aws4 签名 GET/POST 已抽到 core/bytedance-vod.js（`signedGet` / `signedPost`），
  // vod 与 imagex 两个 service 共用同一实现；此处不再保留第二份。

  /**
   * Step 3：vod 视频上传链 → Vid（apply→transfer 分片→finish→CommitUploadInner）
   *
   * 2026-10-18（toutiao-video-api）：本段与头条视频链同形，已抽到
   * `core/bytedance-vod.js` 单一实现；此处只传抖音的三个差异参数
   * （SpaceName=aweme、app_id=2906、**不带** EnOID）。行为与原实现逐字等价，
   * 回归由 `test/douyin-video-chain.test.js` 的步骤断言兜住。
   */
  async uploadVideo (filePath, creds, uid, onProgress) {
    return uploadVideoToVod({
      vod: this.vod,
      upload: this.upload,
      vodBase: this.vodBase,
      creds,
      filePath,
      uid,
      spaceName: 'aweme',
      appId: this.appId,
      innerOid: false,
      region: this.region,
      userAgent: this.userAgent,
      uploadScheme: this.uploadScheme,
      onProgress,
      ErrorClass: DouyinVideoError,
      // 保住原错误语义：`分片缺失` 在抖音链历史上是 io_error(-5)，其余两条是 data_error(-2)
      errorCodes: { noNodes: errorCode.data_error, shortChunks: errorCode.io_error, noVid: errorCode.data_error },
    })
  }

  /** Step 4：封面 imagex 上传链 → poster Uri */
  async uploadCover (coverPath, creds, uid) {
    const buf = fs.readFileSync(coverPath)
    const applyQ = this._applyQuery({ Action: 'ApplyImageUpload', Version: IMAGEX_VERSION, ServiceId: IMAGEX_SERVICE_ID, app_id: this.appId, user_id: uid, s: crypto.randomBytes(8).toString('hex') })
    const ar = await signedGet(this.imagex, this.imagexBase, 'imagex', applyQ, creds)
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
    const cr = await signedPost(this.imagex, this.imagexBase, 'imagex', commitPath, { SessionKey: n0.SessionKey }, creds)
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
  // 2026-10-13：改走 signer 的单一事实源（支持 __security_mc_<N>_ 新形态 + legacy 回落）
  return resolveSignDataPayload(cookie)
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
