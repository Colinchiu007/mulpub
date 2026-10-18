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
 * ④ POST <UploadHost>/upload/v1/<StoreUri>?uploadid=..&phase=finish&uploadmode=part
 * ⑤ POST <vod>?Action=CommitUploadInner&… → Result.Results[0].Vid
 * ⑥ POST /xigua/api/upload/PublishVideo
 * ```
 *
 * ②③④⑤ 与抖音链同形，已抽到 `core/bytedance-vod.js` 单一实现；本文件只保留头条**独有**的三处：
 * getAuthKey 端点与响应形状、apply 的 `SpaceName`/`app_id=1231`/`EnOID=1`、发稿端点 `PublishVideo`。
 *
 * ## 与抖音的差异（逐项来自取证，不是类比）
 *
 * | 项 | 抖音 | 头条 |
 * | --- | --- | --- |
 * | SpaceName | `aweme` | `middlevideo_toutiao`（由 getAuthKey 响应给出，本文件按响应取） |
 * | app_id | `2906` | `1231` |
 * | apply 额外参数 | 无 | `EnOID=1` |
 * | auth 端点 | `/web/api/media/upload/auth/v5/` | `/xigua/api/upload/getAuthKey/?params=…` |
 * | 发稿端点 | `aweme/create_v2` | `/xigua/api/upload/PublishVideo` |
 * | 签名材料 | 需 security-sdk 四类 + clientSign | 不需要（服务端凭 cookie 会话校验） |
 *
 * ## ⑥ 发稿端点与请求体的证据来路（2026-10-18 第 2 轮订正）
 *
 * ⚠️ 如实记录：本文件首次提交（PR #3935）时，`/xigua/api/upload/PublishVideo` 这个路径
 * **是从竞品语料按模式套出来的** —— 语料里那个 `PublishVideo` 其实是**微视**的
 * `media.weishi.qq.com/media-api/PublishVideo`，与头条无关；请求体也是按投稿语义推断的
 * `{title,abstract,vid,tags}`。那是**无证据的臆断**，不符合本项目「先取证再实现」的口径，
 * 而且当时页面的实网抓包里**从未出现过**该端点。
 *
 * 本轮改用确定性方法取证：把上传页加载的 60 个 JS bundle 全量落盘后本地检索，命中
 * `pgcfe/mp/xigua/7219.*.chunk.js`，其中同时包含调用点与**请求体构造器**：
 *
 * ```js
 * a.ZP.requestJsonNew("/xigua/api/upload/PublishVideo", Y, !0)   // ← 端点（实证）
 * // 成功判据（实证）：0===dt && 0===vt ⇒ status===0 && data.Code===0，并取 data.ItemId
 * var a = { publish: 1, timer: 2, draft: 0 }                     // ← PublishType 枚举（实证）
 * ```
 *
 * 请求体是**头条 PascalCase** 形状（与 snake_case 的文章接口完全不同），逐字取自 bundle：
 *
 * ```text
 * ItemId        "" 新建 / 已有 id = 编辑
 * Title         标题
 * Abstract      简介
 * VideoInfo     { Vid, VName, ThumbUri, ThumbUrl, Duration, VideoWidth, VideoHeight }
 * VideoType     3 = 横版视频，6 = 竖版小视频（bundle: Tt = U<1 ? 6 : 3）
 * PublishType   0 = 存草稿，1 = 发布，2 = 定时
 * From          "mp"（固定）
 * EnterFrom     5（固定）
 * IsNew         !ItemId
 * CreateSource  2（固定）
 * HashtagIds    [话题 id]
 * AttrsValueMap 属性表
 * HideInfo      { HideType }
 * ComplianceInfo AI/来源合规声明（IsAIGC / ComplianceType / CreativeInfo）
 * ```
 *
 * ## 发稿前的**五道平台侧闸门**（bundle 实证，每条都有平台原文提示语）
 *
 * | # | 闸门 | 平台原文 |
 * | --- | --- | --- |
 * | 1 | 实名认证 | `realNameNewDialog("video")` —— 未实名直接弹认证框，**根本不发请求** |
 * | 2 | 用户状态 | `当前用户状态不能发文！` |
 * | 3 | 视频上传完成 | `该视频还未上传完成，请上传完成再发表` |
 * | 4 | 标题长度 | 草稿：`保存草稿失败，标题限制为 N 字以内`；发布：`该视频的标题需要在 W～z 字之间` |
 * | 5 | **封面必填** | `该视频需要上传一个封面` |
 *
 * **这解释了 2026-10-18 真机点「存草稿」不发任何请求的现象**：该头条号
 * `GET /mp/agw/media/get_user_base_info` 返回 `is_auth:false`、`media_status:4`，
 * 页面顶部写着「请完善账号信息，解锁发布文章、视频等权益功能」⇒ 第 1 道闸就拦住，
 * 请求根本没发（因此**没有产生任何草稿**，全程可控）。
 * 结论：**头条真机发布的前置条件是账号完成实名/信息完善，属人工操作，不是代码缺陷。**
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

// 本文件的职责已按「有无副作用」切成三块，防止单文件再撞 `check-max-lines` 的 500 上限：
//   · toutiao-video-publish.js —— 纯契约（端点/枚举/body 构造/响应解析），无 IO
//   · toutiao-video-probes.js  —— 只读探测（发布权限 / 推荐封面），无副作用
//   · 本文件                    —— 有副作用的链编排（getAuthKey → apply → 分片 → commit → PublishVideo）
const {
  PUBLISH_PATH, PUBLISH_AUTH_PATH, REVIEW_LATENCY_PATH, POSTER_LIST_PATH,
  PUBLISH_TYPE, VIDEO_TYPE, ASPECT_RATIO,
  truncateByCodePoint, buildToutiaoPublishBody, parsePublishResponse,
  parsePosterListResponse, pickPosterUri,
  CSRF_HEADER, pickCsrfToken,
} = require('./toutiao-video-publish')
const { probePublishAuth, fetchPosterList } = require('./toutiao-video-probes')

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

/** 调用方给的是本地封面文件（给不出平台侧 URI）吗？仅用于错误文案区分 */
function hasLocalCoverOnly (coverInputs) {
  const local = coverInputs.filter(Boolean)
  return local.length > 0 && local.every((x) => typeof x === 'string')
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
    const h = {
      Cookie: this.cookie,
      'User-Agent': this.userAgent,
      Referer: this.mpBase + '/profile_v4/xigua/upload-video',
      Origin: this.mpBase,
    }
    // 写接口必须带 CSRF 头（2026-10-19 真机实证）：头名与 cookie 来源、
    // 以及「不带 / 用错 cookie 一律 403 invalid csrf token」的对照证据，
    // 全部写在 `toutiao-video-publish.js#pickCsrfToken` 的注释里（单一事实源）。
    const csrf = pickCsrfToken(this.cookie)
    if (csrf) h[CSRF_HEADER] = csrf
    return Object.assign(h, extra || {})
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

  /**
   * 组装 PublishVideo 的请求体。
   *
   * 字段形状**逐字取自应用 bundle**（见文件头 §⑥），不再是推断：
   * PascalCase、`VideoInfo` 嵌套对象、`PublishType` 用枚举、`From`/`EnterFrom`/`CreateSource` 固定值。
   *
   * @param {object} taskData  业务任务（title/content/tags/cover...）
   * @param {object} o
   * @param {string} o.vid           CommitUploadInner 返回的 Vid（必填）
   * @param {string} [o.thumbUri]    封面 StoreUri（平台**要求必填**，见闸门 5）
   * @param {string} [o.thumbUrl]    封面外链（可由 thumbUri 派生，此处不派生，留空由平台处理）
   * @param {number} [o.duration]    时长（秒）
   * @param {number} [o.width]
   * @param {number} [o.height]
   * @param {boolean|number} [o.publishType] 0 草稿 / 1 发布 / 2 定时；缺省按 draft 布尔映射
   * @param {boolean} [o.draft]
   * @param {Array} [o.hashtagIds]   话题 id 列表
   * @param {object} [o.compliance]  AI/来源合规声明
   * @param {string[]} [o.tags]      纯文本话题（无 id 时退回 AttrsValueMap 不建议，故仍走 HashtagIds 语义）
   */
  buildPublishBody (taskData, o = {}) {
    // 形状与判据都在 toutiao-video-publish.js 单一实现里（纯函数，可直测）
    return buildToutiaoPublishBody(taskData, o)
  }

  /**
   * 取**推荐封面**列表（平台按 vid 自动生成的候选封面）。
   * 实现与证据说明见 `toutiao-video-probes.js#fetchPosterList`。
   * @param {string} vid
   */
  async getPosterList (vid) {
    if (!vid) throw new ToutiaoVideoError('toutiao-video: getPosterList 需要 vid')
    return fetchPosterList(this.mp, this._mpHeaders({ 'Content-Type': 'application/json', Accept: 'application/json' }), vid, this.logger)
  }

  /**
   * 只读前置闸门：发布权限 + 审核延迟。
   * 实现与语义见 `toutiao-video-probes.js#probePublishAuth`（取不到 ⇒ unknown，不阻断）。
   */
  async checkPublishAuth () {
    this._assertPreconditions()
    return probePublishAuth(this.mp, this._mpHeaders({ Accept: 'application/json' }), this.logger)
  }

  /**
   * Step ⑥：PublishVideo 投稿。
   * 成功判据**逐字取自 bundle**：`status === 0 && data.Code === 0` 且 `data.ItemId` 存在。
   * （旧实现按 `status===0 && data.item_id` 判定，字段名是错的 —— 头像是 PascalCase 的 `ItemId`。）
   */
  async publish (postData) {
    const res = await this.mp.request({
      method: 'post', url: PUBLISH_PATH,
      data: JSON.stringify(postData), maxBodyLength: Infinity,
      headers: this._mpHeaders({ 'Content-Type': 'application/json', Accept: 'application/json' }),
      validateStatus: (s) => s >= 200 && s < 500,
    })
    const p = parsePublishResponse(res.data)
    if (p.ok) {
      return { success: true, mode: 'api', platform: 'toutiao', publishId: p.itemId }
    }
    return {
      success: false,
      platform: 'toutiao',
      code: p.code,
      error: p.message || ('头条发布失败(status=' + String(p.status) + ', code=' + String(p.code) + ')'),
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
    // 封面来源（调用方显式给出时优先用）
    //
    // ⚠️ 判据必须与 buildToutiaoPublishBody 接受封面来源**完全一致**，否则会出现
    // 「调用方给了 opts.thumbUri 却被本地闸门拦掉」这种自相矛盾（自扮演裁决 i1）。
    const coverInputs = [
      opts.cover && opts.cover.path, // 封面文件（未来 imagex 上传用）
      opts.cover,                    // 直接给封面对象
      opts.thumbUri,                 // 直接给封面 StoreUri（已上传）
      td.cover,
      td.coverPath,
    ]
    const hasCallerCover = coverInputs.some((x) => Boolean(x))
    const uid = this.resolveUid()

    // 闸门 1-2（只读·可选）：发布权限 / 账号状态。取不到不阻断，但把结论如实带出去。
    const auth = await this.checkPublishAuth().catch(() => null)
    if (auth && auth.canPublish === false) {
      return {
        success: false,
        platform: 'toutiao',
        code: 'NO_PUBLISH_PERMISSION',
        error: '该头条号当前无发布权限（GetPublishAuth.DisablePublish=true）。'
          + '平台侧原文：请完善账号信息，解锁发布文章、视频等权益功能。',
        auth,
      }
    }

    const creds = await this.getAuthKey()
    const vid = await this.uploadVideo(videoPath, creds, uid, opts.onProgress)
    if (opts.onProgress) opts.onProgress(80, '视频已上传，正在提交')

    // 闸门 5（封面必填）必须放在**上传之后**：平台的推荐封面是按 vid 自动生成的
    // （bundle 原文：「视频上传完毕后才能生成推荐封面，你可上传或自定义截取封面」）。
    // 所以顺序是：先看调用方有没有**平台侧可用的封面 URI** ⇒ 没有就向平台要推荐封面 ⇒
    // 都没有才失败。这样解掉了「先要封面才能上传、上传完才有封面」的死锁。
    //
    // ⚠️ 判据是「有没有可用 **URI**」，不是「有没有封面字段」：
    // `coverPath` 是本地文件路径，body 需要的是平台侧 URI，而头条封面上传尚未实现 ⇒
    // 只给 coverPath 时**仍然**要回落推荐封面（自扮演裁决：曾用 hasCallerCover 触发回落，
    // 结果 coverPath 让回落被跳过、thumbUri 又是空 ⇒ 必失败，属判据用错）。
    let thumbUri = opts.thumbUri || (td.cover && td.cover.uri) || ''
    let thumbUrl = opts.thumbUrl || (td.cover && td.cover.url) || ''
    const hasUsableCoverUri = Boolean(thumbUri)
    let posters = null
    if (!hasUsableCoverUri && !opts.skipCoverCheck) {
      posters = await this.getPosterList(vid).catch((e) => {
        this.logger && this.logger.warn && this.logger.warn(
          'toutiao-video: GetPosterList 不可用，回落失败: ' + String(e && e.message).slice(0, 120))
        return null
      })
      if (posters && posters.picked && posters.picked.uri) {
        thumbUri = posters.picked.uri
        if (opts.onProgress) opts.onProgress(85, '已自动选用平台推荐封面')
      }
    }
    if (!thumbUri && !opts.skipCoverCheck) {
      const hint = hasLocalCoverOnly(coverInputs)
        ? '调用方只提供了本地封面文件（cover/coverPath），但头条封面上传尚未实现 —— '
          + '请改传平台侧 thumbUri，或依赖平台推荐封面'
        : '调用方未提供 cover/thumbUri'
      throw new ToutiaoVideoError(
        '头条视频发布需要封面图（平台必填）：平台未生成推荐封面，且' + hint
        + '。平台侧原文：该视频需要上传一个封面'
      )
    }

    const body = this.buildPublishBody(td, {
      vid,
      itemId: opts.itemId,
      draft: opts.draft,
      publishType: opts.publishType,
      timerTime: opts.timerTime,
      hashtagIds: opts.hashtagIds,
      compliance: opts.compliance,
      thumbUri,
      thumbUrl,
      width: opts.width,
      height: opts.height,
      duration: opts.duration,
    })
    const r = await this.publish(body)
    const extra = {}
    if (auth) extra.auth = auth
    // 把「封面从哪来」如实带出去，便于真机排障（推荐封面命中键目前是候选探测）
    if (posters) extra.cover = { source: posters.picked && posters.picked.uri ? 'platform-poster' : 'caller', pickedKey: posters.picked && posters.picked.key, posterCount: (posters.posters || []).length }
    else if (thumbUri) extra.cover = { source: 'caller', pickedKey: null, posterCount: 0 }
    return Object.keys(extra).length ? Object.assign({}, r, extra) : r
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
    PUBLISH_AUTH_PATH,
    REVIEW_LATENCY_PATH,
    POSTER_LIST_PATH,
    AUTH_PARAMS,
    MP_BASE,
    VOD_BASE,
    VERSION: VOD_VERSION,
    REGION,
  },
  cookieValue,
  truncateByCodePoint,
  PUBLISH_TYPE,
  VIDEO_TYPE,
  ASPECT_RATIO,
  parsePosterListResponse,
  pickPosterUri,
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
