'use strict'
/**
 * toutiao-video.js — 今日头条（西瓜）视频 API 轨
 *
 * ## 证据来源：实网抓包，不是猜测
 *
 * 2026-10-18 用可读的 `rpa-toutiao-<accountId>` 分区 cookie 起 Playwright，
 * `input[type=file].setInputFiles(<mp4>)` 真实上传，`page.route` 记录逐字请求，
 * 并对 `PublishVideo|create_v2|/publish$|article/publish` **硬 abort**（全程未发稿）。
 *
 * 抓到的五步：
 *
 * ```
 * ① GET  /xigua/api/upload/getAuthKey/?params={"type":"video","column":false,
 *         "ugc":false,"useImageX":true,"useStsToken":true}
 *      → { data: { spaceName:"middlevideo_toutiao", accessKey, uploadToken:{ SessionToken,... } } }
 * ② GET  <vod>?Action=ApplyUploadInner&Version=2020-11-19&SpaceName=middlevideo_toutiao
 *         &FileType=video&IsInner=1&FileSize=<n>&EnOID=1&app_id=1231&user_id=<uid>&s=<16hex>
 *      → Result.InnerUploadAddress.UploadNodes[0] = { Vid, StoreInfos[{StoreUri,Auth}],
 *                                                     UploadHost, SessionKey }
 * ③ POST <UploadHost>/upload/v1/<StoreUri>?uploadid=..&part_number=..&phase=transfer&part_offset=..
 * ④ POST <UploadHost>/upload/v1/<StoreUri>?uploadid=..&phase=finish&uploadmode=part
 * ⑤ POST <vod>?Action=CommitUploadInner&… → Result.Results[0].Vid
 * ⑥ POST /xigua/api/upload/PublishVideo     ← 本文件补的最后一环
 * ```
 *
 * ②③④⑤ 与抖音链同形，已抽到 `core/bytedance-vod.js` 单一实现；本文件只保留头条**独有**的三处：
 * getAuthKey 端点与响应形状、apply 的 `SpaceName`/`app_id=1231`/`EnOID=1`、发稿端点 `PublishVideo`。
 *
 * ## 与抖音的差异（逐项来自抓包，不是类比）
 *
 * | 项 | 抖音 | 头条 |
 * | --- | --- | --- |
 * | SpaceName | `aweme` | `middlevideo_toutiao`（由 getAuthKey 响应给出，本文件按响应取） |
 * | app_id | `2906` | `1231` |
 * | apply 额外参数 | 无 | `EnOID=1` |
 * | auth 端点 | `/web/api/media/upload/auth/v5/` | `/xigua/api/upload/getAuthKey/?params=…` |
 * | 发稿端点 | `aweme/create_v2` | `/xigua/api/upload/PublishVideo` |
 * | 签名材料 | 需 security-sdk 四类 + clientSign | 不需要（服务端凭 cookie 会话校验） |
 */

const fs = require('fs')
const { createHttpClient } = require('../core/http-base')
const {
  VOD_VERSION, REGION, hostOf, sha256hex, crc32hex, partSizeFor,
  applyQueryString, signedGet, signedPost, buildApplyQuery, uploadVideoToVod,
} = require('../core/bytedance-vod')

const MP_BASE = 'https://mp.toutiao.com'
const VOD_BASE = 'https://vod.bytedanceapi.com'

/** 头条视频 app_id（抓包逐字：`&app_id=1231`；抖音是 2906，两者不可混用） */
const TT_APP_ID = 1231
/** getAuthKey 未给 spaceName 时的兜底（抓包实测值） */
const TT_SPACE_NAME_FALLBACK = 'middlevideo_toutiao'

const AUTH_KEY_PATH = '/xigua/api/upload/getAuthKey/'
const PUBLISH_PATH = '/xigua/api/upload/PublishVideo'

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36'

/** getAuthKey 的 params（抓包逐字，四个布尔字段顺序与取值都不可省） */
const AUTH_PARAMS = { type: 'video', column: false, ugc: false, useImageX: true, useStsToken: true }

const FAIL_MSG = '头条号登录态缺失，请重新授权此账号再试'

class ToutiaoVideoError extends Error {
  constructor (message, code) {
    super(message)
    this.name = 'ToutiaoVideoError'
    this.code = code || 'TT_VIDEO_ERROR'
  }
}

/** 从 cookie 串取 key 的值（`; ` 分隔，取第一个 '=' 之后到下一个 ';'） */
function cookieValue (cookie, key) {
  const s = String(cookie || '')
  const m = s.match(new RegExp('(?:^|;\\s*)' + key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '=([^;]*)'))
  return m ? m[1].trim() : ''
}

class ToutiaoVideoChain {
  /**
   * @param {object} opts
   * @param {string} opts.cookie          mp.toutiao.com 的 cookie 串
   * @param {string} [opts.mpBase]        creator 类 base（可注入假服务器）
   * @param {string} [opts.vodBase]       vod base（可注入假服务器）
   * @param {string} [opts.userAgent]
   * @param {string|number} [opts.uid]    cookie 无 uid 时的兜底
   * @param {number} [opts.timeout]
   * @param {object} [opts.agents]
   * @param {Function} [opts.httpClientFactory] 测试注入点
   * @param {object} [opts.logger]
   */
  constructor (opts = {}) {
    this.cookie = opts.cookie || ''
    this.userAgent = opts.userAgent || UA
    this.logger = opts.logger || console
    this.region = opts.region || REGION
    this.appId = opts.appId === undefined ? TT_APP_ID : opts.appId
    this.mpBase = opts.mpBase || MP_BASE
    this.vodBase = opts.vodBase || VOD_BASE
    this.uploadScheme = opts.uploadScheme || 'https:'
    this._uidFallback = opts.uid

    const mk = opts.httpClientFactory || createHttpClient
    const timeout = opts.timeout
    const headers = { 'User-Agent': this.userAgent }
    this.mp = opts.mpClient || mk({ baseURL: this.mpBase, timeout, agents: opts.agents, headers })
    this.vod = opts.vod || mk({ baseURL: this.vodBase, timeout, agents: opts.agents, headers })
    this.upload = opts.uploadHttp || mk({ timeout, agents: opts.agents, headers })
  }

  /** 平台用户 id：优先 cookie 的 uid_tt，其次构造时注入值 */
  resolveUid () {
    return cookieValue(this.cookie, 'uid_tt') || String(this._uidFallback || '')
  }

  _mpHeaders (extra) {
    return Object.assign({
      Cookie: this.cookie,
      'User-Agent': this.userAgent,
      Referer: this.mpBase + '/profile_v4/xigua/upload-video',
      Origin: this.mpBase,
    }, extra || {})
  }

  /**
   * Step 0：fail-closed 前置校验（**零请求**）
   * 头条不需要抖音那套 security-sdk 签名材料，只需登录会话 cookie。
   */
  _assertPreconditions () {
    const c = String(this.cookie || '')
    if (!c) throw new ToutiaoVideoError('toutiao-video: missing cookie (fail-closed)')
    if (!cookieValue(c, 'sessionid') && !cookieValue(c, 'sessionid_ss')) {
      throw new ToutiaoVideoError(FAIL_MSG)
    }
    if (!this.resolveUid()) throw new ToutiaoVideoError('toutiao-video: 缺 uid_tt（无法定位账号）')
  }

  /**
   * Step 1：getAuthKey —— 取 VOD 空间与 STS 凭证。
   *
   * 抓包逐字：`GET /xigua/api/upload/getAuthKey/?params=<encodeURIComponent(JSON)>`
   * 注意是 **GET + query**，不是 POST body —— 裸 POST `{}` 实测返回 403 `invalid csrf token`。
   */
  async getAuthKey () {
    this._assertPreconditions()
    const url = AUTH_KEY_PATH + '?params=' + encodeURIComponent(JSON.stringify(AUTH_PARAMS))
    const res = await this.mp.request({
      method: 'get', url,
      headers: this._mpHeaders({ Accept: 'application/json' }),
      validateStatus: (s) => s >= 200 && s < 500,
    })
    const d = (res.data || {}).data || {}
    const tok = d.uploadToken || {}
    const sessionToken = tok.SessionToken || tok.sessionToken
    if (!sessionToken) {
      const code = (res.data || {}).code
      const msg = (res.data || {}).msg || (res.data || {}).message
      throw new ToutiaoVideoError(
        'toutiao-video: 未获取上传授权' + (code ? '(code=' + code + ')' : '') + (msg ? ': ' + msg : '')
      )
    }
    return {
      spaceName: d.spaceName || TT_SPACE_NAME_FALLBACK,
      sessionToken,
      accessKeyId: tok.AccessKeyId || d.accessKey,
      secretAccessKey: tok.SecretAccessKey,
      expiredTime: tok.ExpiredTime,
    }
  }

  /**
   * 构造 ApplyUploadInner 查询串（**独立成方法供契约测试直击三处头条差异**）。
   * @param {{size:number, spaceName:string, uid:string|number, suffix?:string}} o
   */
  _applyQueryFor (o) {
    return buildApplyQuery({
      size: o.size,
      spaceName: o.spaceName,
      appId: this.appId,
      uid: o.uid,
      // 头条独有：EnOID=1（抓包逐字）；抖音不带
      innerOid: true,
      suffix: o.suffix,
    })
  }

  /**
   * Step 2-5：apply → 分片 → finish → CommitUploadInner → Vid
   * 复用 `core/bytedance-vod.js`（与抖音同一实现）。
   */
  async uploadVideo (filePath, creds, uid, onProgress) {
    return uploadVideoToVod({
      vod: this.vod,
      upload: this.upload,
      vodBase: this.vodBase,
      creds: {
        accessKeyId: creds.accessKeyId,
        secretAccessKey: creds.secretAccessKey,
        sessionToken: creds.sessionToken,
      },
      filePath,
      uid,
      spaceName: creds.spaceName,
      appId: this.appId,
      innerOid: true,
      region: this.region,
      userAgent: this.userAgent,
      uploadScheme: this.uploadScheme,
      onProgress,
      ErrorClass: ToutiaoVideoError,
    })
  }

  /** 组装 PublishVideo 的 body（字段名按头条投稿语义；title/abstract 为平台字段名） */
  buildPublishBody (taskData, o = {}) {
    const td = taskData || {}
    const body = {
      title: String(td.title || '').slice(0, 30),
      abstract: String(td.content || td.abstract || '').slice(0, 2000),
      vid: o.vid || td.vid || '',
    }
    // 话题：头条走独立 tags 字段（与 DOM 轨一致，正文不重复携带）
    if (Array.isArray(td.tags) && td.tags.length) body.tags = td.tags
    if (o.draft) body.draft = true
    return body
  }

  /**
   * Step 6：PublishVideo 投稿。
   * 成功判据（按头条网关惯例）：`status === 0` 且拿到 `data.item_id`。
   */
  async publish (postData) {
    const res = await this.mp.request({
      method: 'post', url: PUBLISH_PATH,
      data: JSON.stringify(postData), maxBodyLength: Infinity,
      headers: this._mpHeaders({ 'Content-Type': 'application/json', Accept: 'application/json' }),
      validateStatus: (s) => s >= 200 && s < 500,
    })
    const d = res.data || {}
    const itemId = (d.data && (d.data.item_id || d.data.itemId || d.data.group_id)) || d.item_id
    if (d.status === 0 && itemId) {
      return { success: true, mode: 'api', platform: 'toutiao', publishId: String(itemId) }
    }
    return {
      success: false,
      platform: 'toutiao',
      code: d.status,
      error: d.message || d.msg || ('头条发布失败(status=' + String(d.status) + ')'),
    }
  }

  /** 全链编排 */
  async run (taskData, opts = {}) {
    this._assertPreconditions()
    const td = taskData || {}
    const videoPath = td.video && td.video.path
    if (!videoPath) throw new ToutiaoVideoError('toutiao-video: taskData.video.path required')
    if (!fs.existsSync(videoPath)) {
      throw new ToutiaoVideoError('toutiao-video: video file not found: ' + videoPath)
    }
    const uid = this.resolveUid()
    const creds = await this.getAuthKey()
    const vid = await this.uploadVideo(videoPath, creds, uid, opts.onProgress)
    if (opts.onProgress) opts.onProgress(80, '视频已上传，正在提交')
    const body = this.buildPublishBody(td, { vid, draft: opts.draft })
    return this.publish(body)
  }
}

module.exports = {
  ToutiaoVideoChain,
  ToutiaoVideoError,
  TT_APP_ID,
  TT_SPACE_NAME_FALLBACK,
  TT_VIDEO_API: {
    AUTH_KEY_PATH,
    PUBLISH_PATH,
    AUTH_PARAMS,
    MP_BASE,
    VOD_BASE,
    VERSION: VOD_VERSION,
    REGION,
  },
  cookieValue,
  // 便于复用方与测试直击共用实现
  buildApplyQuery,
  uploadVideoToVod,
  partSizeFor,
  hostOf,
  sha256hex,
  crc32hex,
  applyQueryString,
  signedGet,
  signedPost,
}
