'use strict'
/**
 * toutiao-video-publish.js — 头条视频**发稿契约**（请求体构造 + 响应判据 + 只读闸门）
 *
 * 从 `toutiao-video.js` 拆出（该文件 513 行超 `check-max-lines` 的 500 上限，按既有范式拆）。
 * 拆分边界是「纯契约 vs 链编排」：
 *   · 本文件 = 纯函数 + 端点常量 + 请求体形状，**不发请求、不持状态**，可单测直击
 *   · `toutiao-video.js` = 链（getAuthKey → apply → 分片 → commit → 调本文件发稿）
 *
 * ## 证据来路（2026-10-18，来自应用自身 bundle 而非竞品语料）
 *
 * 把上传页加载的 60 个 JS bundle 全量落盘后本地检索，命中
 * `pgcfe/mp/xigua/7219.*.chunk.js`，其中同时包含调用点、成功判据与枚举：
 *
 * ```js
 * a.ZP.requestJsonNew("/xigua/api/upload/PublishVideo", Y, !0)
 * // 成功判据：0===dt && 0===vt  ⇒  status===0 && data.Code===0，并取 data.ItemId
 * var a = { publish: 1, timer: 2, draft: 0 }        // PublishType
 * // VideoType：Tt = U < 1 ? 6 : 3；发布后 3===Y.VideoType 路由横版页，否则小视频页
 * ```
 *
 * ⚠️ 历史教训（写在这里防止再犯）：PR #3935 首次提交时，`/xigua/api/upload/PublishVideo`
 * 这个路径是**从竞品语料按同名端点套出来的**（语料里那个 `PublishVideo` 属于**微视**
 * `media.weishi.qq.com/media-api/PublishVideo`），请求体也是按投稿语义推断的 snake_case
 * `{title,abstract,vid}`。两处都是**无证据臆断**：当时抓包的 URL 全清单里从未出现过该端点，
 * 而头条这个接口实际是 PascalCase。**同名不等于同接口，跨平台套用必须重新取证。**
 */

/** 发稿端点（bundle 逐字） */
const PUBLISH_PATH = '/xigua/api/upload/PublishVideo'
/** 两个只读前置闸门（bundle 实证存在，比 DOM 探测可靠） */
const PUBLISH_AUTH_PATH = '/xigua/api/upload/GetPublishAuth'
const REVIEW_LATENCY_PATH = '/xigua/api/upload/GetPublishPageReviewLatency'

/**
 * PublishType 枚举 —— 逐字取自 bundle：`var a = { publish: 1, timer: 2, draft: 0 }`
 * ⚠️ 草稿是 **0**（不是 1）。传错会把草稿当正式发布，是本模块最危险的一个常量。
 */
const PUBLISH_TYPE = Object.freeze({ draft: 0, publish: 1, timer: 2 })

/**
 * VideoType 枚举 —— 取自 bundle：`Tt = U < 1 ? 6 : 3`（`U` 即 `aspectRatio`）。
 * 3 = 横版视频（发布后进 `content-manage-v2`）；6 = 竖版小视频（进 `small-video`）。
 */
const VIDEO_TYPE = Object.freeze({ landscape: 3, verticalSmall: 6 })

/**
 * 平台宽高比常量 —— 取自 bundle：`Z = VideoWidth < VideoHeight ? .62 : 1.78`
 * 竖版 0.62、横版 1.78；它同时是 `VideoType` 的判据（`U < 1` ⇒ 竖版）和 body 里的 `aspectRatio`。
 */
const ASPECT_RATIO = Object.freeze({ vertical: 0.62, landscape: 1.78 })

/** 推荐封面列表端点（bundle 逐字：`(0,u.t9)("/ixigua/api/upload/GetPosterList/", {body:{vid}})`） */
const POSTER_LIST_PATH = '/ixigua/api/upload/GetPosterList/'

/** 平台标题上限（config/platforms.yaml 的 toutiao.max_title = 30） */
const TITLE_LIMIT = 30
/** 简介上限 */
const ABSTRACT_LIMIT = 2000

/**
 * 按**码点**截断（不是 UTF-16 code unit）。
 *
 * 为什么不能用 `String#slice`：`'😀标题'.slice(0,1)` 会把代理对切成孤立高位代理，
 * 提交给平台即乱码/非法字符。头条标题上限 30 字，正是最容易踩到的位置。
 */
function truncateByCodePoint (s, max) {
  const str = String(s == null ? '' : s)
  if (max <= 0) return ''
  if (str.length <= max) return str // 快路径：无代理对时 length 即码点数
  const cps = Array.from(str)
  return cps.length <= max ? str : cps.slice(0, max).join('')
}

/**
 * 组装 PublishVideo 请求体（纯函数）。
 *
 * 字段形状**逐字对齐 bundle 的构造器**，不是推断。
 *
 * @param {object} taskData  业务任务
 * @param {object} o
 * @param {string} o.vid            CommitUploadInner 的 Vid（必填）
 * @param {string} [o.itemId]       有值 = 编辑已有作品，空 = 新建
 * @param {string} [o.thumbUri]     封面 StoreUri（平台必填，见 run() 的封面闸门）
 * @param {string} [o.thumbUrl]     封面外链
 * @param {number} [o.duration]     时长（秒）
 * @param {number} [o.width]
 * @param {number} [o.height]
 * @param {boolean} [o.draft]       true ⇒ PublishType=0
 * @param {number} [o.publishType]  显式覆盖 0/1/2
 * @param {number} [o.timerTime]    定时时间（秒）；给了就强制 PublishType=2
 * @param {Array} [o.hashtagIds]    话题 id 列表
 * @param {object} [o.compliance]   AI/来源合规声明
 * @returns {object} 请求体
 */
function buildToutiaoPublishBody (taskData, o = {}) {
  const td = taskData || {}
  const draft = o.draft === true || o.publishType === PUBLISH_TYPE.draft
  const height = Number(o.height || (td.video && td.video.height) || 0)
  const width = Number(o.width || (td.video && td.video.width) || 0)
  // 竖版判据与 bundle 一致：bundle 用 aspectRatio < 1，等价于「高>宽」。
  // 宽高缺失时按横版处理（平台默认 3），并在 aspectRatio 上体现。
  const hasDim = height > 0 && width > 0
  const isVertical = hasDim && height > width
  const aspectRatio = hasDim
    ? (isVertical ? ASPECT_RATIO.vertical : ASPECT_RATIO.landscape)
    : ASPECT_RATIO.landscape
  const hashtagIds = Array.isArray(o.hashtagIds)
    ? o.hashtagIds
    : (Array.isArray(td.hashtag_ids) ? td.hashtag_ids : [])

  let publishType
  if (o.timerTime) publishType = PUBLISH_TYPE.timer
  else if (o.publishType !== undefined) publishType = o.publishType
  else publishType = draft ? PUBLISH_TYPE.draft : PUBLISH_TYPE.publish

  const body = {
    ItemId: o.itemId || '',
    Title: truncateByCodePoint(td.title, TITLE_LIMIT),
    Abstract: truncateByCodePoint(td.content || td.abstract, ABSTRACT_LIMIT),
    VideoInfo: {
      Vid: o.vid || td.vid || '',
      VName: String((td.video && td.video.name) || ''),
      ThumbUri: o.thumbUri || '',
      ThumbUrl: o.thumbUrl || '',
      Duration: Number(o.duration || (td.video && td.video.duration) || 0),
      VideoWidth: width,
      VideoHeight: height,
    },
    VideoType: isVertical ? VIDEO_TYPE.verticalSmall : VIDEO_TYPE.landscape,
    // bundle 的 body 里还带 aspectRatio（Z），且它正是 VideoType 的判据来源
    aspectRatio,
    PublishType: publishType,
    From: 'mp',
    EnterFrom: 5,
    IsNew: !o.itemId,
    CreateSource: 2,
    Praise: false,
    HashtagIds: hashtagIds.filter(Boolean),
    HideInfo: { HideType: Number((td.hide_info && td.hide_info.hide_type) || 0) },
  }
  if (o.compliance) body.ComplianceInfo = o.compliance
  if (o.timerTime) body.TimerTime = o.timerTime
  return body
}

/**
 * 解析 PublishVideo 响应（纯函数）。
 *
 * 成功判据**逐字取自 bundle**：`status === 0 && data.Code === 0` 且 `data.ItemId` 存在。
 * 三者缺一都不算成功 —— 尤其 `ItemId`，没有 id 就没有作品，不能谎报。
 *
 * @param {object} raw 网关响应体
 * @returns {{ok: boolean, itemId: string|null, code: number|undefined, message: string}}
 */
function parsePublishResponse (raw) {
  const d = raw || {}
  const data = d.data || {}
  const itemId = data.ItemId || null
  // 有些网关不回 Code（undefined）；回了就必须为 0
  const codeOk = data.Code === 0 || data.Code === undefined
  const ok = d.status === 0 && codeOk && Boolean(itemId)
  // 2026-10-19（toutiao-imagex-cover-chain）：提交时账号墙兜底 ——
  // 封面/上传链全通后，服务端对未实名账号的权威拒绝是 `Code 21000`
  // （原文「未实名认证/帐号不可用，可前往西瓜创作平台/西瓜App投稿」，真机实测）。
  // 这是 IsIdentifyAuth 提交前检测（buildPublishGateResult）的**提交时**对偶：
  // 即便提交前读数放行（滞后），提交时也会在这里拦下，UI 复用同一解法入口。
  const msg = data.Message || d.message || d.msg || ''
  const accountGate = data.Code === 21000 || /未实名认证|帐号不可用/.test(String(msg))
  return {
    ok,
    accountGate,
    itemId: itemId ? String(itemId) : null,
    status: d.status === undefined ? null : d.status,
    code: d.status === 0 ? data.Code : d.status,
    message: data.Message || d.message || d.msg || '',
  }
}

/**
 * 解析推荐封面列表响应（纯函数）。
 *
 * 证据（bundle 逐字）：
 * ```js
 * (0,u.t9)("/ixigua/api/upload/GetPosterList/", { body: { vid } })
 * // → (t||{}).data.Posters ；空数组则 UI 提示「视频上传完毕后才能生成推荐封面，你可上传或自定义截取封面」
 * ```
 *
 * ⚠️ 如实标注未知：**`Posters[]` 每一项的字段名未取证**（抓到的只是 `.Posters` 这一层）。
 * 因此 `pickPosterUri()` 采用**候选键探测**而不是写死单一键，并把命中的键一并返回，
 *  便于第一次真机跑通后回来把这里收敛成确定实现。
 *
 * @param {object} raw 网关响应体
 * @returns {{posters: Array, code: any}}
 */
function parsePosterListResponse (raw) {
  const d = raw || {}
  const data = d.data || {}
  const posters = Array.isArray(data.Posters) ? data.Posters : []
  return { posters, code: d.code !== undefined ? d.code : d.status }
}

/** 候选键（顺序即优先级）。真机跑通后应收敛为实际命中那一个。 */
const POSTER_URI_KEYS = ['Uri', 'PosterUri', 'CoverUri', 'ThumbUri', 'Url', 'PosterUrl', 'ThumbUrl']

// ── 账号未完善（无法发布）闸门 ───────────────────────────────────────────────
//
// 2026-10-19 真机实证：靠 `GetPublishAuth.authorPermission.IsIdentifyAuth === false`
// **可以**在提交前检测到这种账号，不需要等提交失败。
//
// 权威证据是平台自己的发布页：真机上传完成后点「发布」，弹出模态框
//   「账号信息未完善 —— 账号信息未完善，暂时不能进行发布文章、视频等权益操作，请完善后重试」
// 该弹窗的「去完善」按钮会打开下面的 `ACCOUNT_FIX_URL`（实测录到的弹出目标）。
//
// ⚠️ 注意判据的边界：`DisablePublish` / `BlockStatus` 在这种账号上仍是 false / 0，
// 所以**不能**用它们判断「能否发布」；`IsIdentifyAuth` 是目前唯一的提交前信号。
// 但它是否等价于「实名认证」未被单独证实（弹窗文案是更宽的「账号信息未完善」），
// 因此提示语只如实说「账号信息未完善」，不臆断成「未实名」。
const CODE_ACCOUNT_NOT_VERIFIED = 'ACCOUNT_NOT_VERIFIED'

/** 平台自己的「去完善」落地页（实测：弹窗「去完善」的弹出目标） */
const ACCOUNT_FIX_URL = 'https://mp.toutiao.com/profile_v4/personal/landing-type'

/** 头条认证页（二级入口，兜底用） */
const ACCOUNT_AUTH_URL = 'https://mp.toutiao.com/profile_v4/personal/auth?enter_from=main_page'

/**
 * 账号未完善闸门的失败结果（纯函数）。
 *
 * `helpUrl` 是给 UI 渲染「可点击查看」用的：指向平台自己的完善入口，
 * 而不是我方自建的说明页 —— 用户点进去就能直接解决问题。
 *
 * @param {object} [auth] probePublishAuth 的返回值（透传出去便于排查）
 * @returns {{success: boolean, platform: string, code: string, error: string, helpUrl: string, helpLabel: string, auth: object|undefined}}
 */
function buildAccountNotVerifiedResult (auth) {
  return {
    success: false,
    platform: 'toutiao',
    code: CODE_ACCOUNT_NOT_VERIFIED,
    error: '该头条号账号信息未完善，暂时无法发布视频（平台提示：账号信息未完善，'
      + '暂时不能进行发布文章、视频等权益操作，请完善后重试）。',
    helpUrl: ACCOUNT_FIX_URL,
    helpLabel: '去头条号完善账号信息',
    auth,
  }
}

/**
 * 发布前闸门（提交前、只读）——把两种「不该提交」的情形收敛到一处：
 *
 * | 情形 | 判据 | 结果码 |
 * | --- | --- | --- |
 * | 无发布权限 | `canPublish === false`（`DisablePublish=true`） | `NO_PUBLISH_PERMISSION` |
 * | 账号信息未完善 | `identityVerified === false`（`IsIdentifyAuth=false`） | `ACCOUNT_NOT_VERIFIED` |
 *
 * 后者在真机上的权威证据是平台发布页的模态框「账号信息未完善」（点「发布」时弹出），
 * 且此时 `DisablePublish` 仍是 false —— 所以两个判据必须分开看。
 *
 * @param {object|null} auth probePublishAuth 的返回值
 * @returns {object|null} 需要中止时返回失败结果（含 helpUrl），否则 null
 */
function buildPublishGateResult (auth) {
  if (!auth) return null
  if (auth.canPublish === false) {
    return {
      success: false,
      platform: 'toutiao',
      code: 'NO_PUBLISH_PERMISSION',
      error: '该头条号当前无发布权限（GetPublishAuth.DisablePublish=true）。'
        + '平台侧原文：请完善账号信息，解锁发布文章、视频等权益功能。',
      helpUrl: ACCOUNT_FIX_URL,
      helpLabel: '去头条号完善账号信息',
      auth,
    }
  }
  return isAccountIncomplete(auth) ? buildAccountNotVerifiedResult(auth) : null
}

/** 该账号是否被判定为「账号信息未完善」（提交前、只读） */
function isAccountIncomplete (auth) {
  return Boolean(auth) && auth.identityVerified === false
}

/** 写接口的 CSRF 头名（2026-10-19 真机实证；证据见 pickCsrfToken 注释） */
const CSRF_HEADER = 'x-secsdk-csrf-token' // 2026-10-24 抓包：页面真实头名（旧值 x-csrf-token 是猜的）

/** 承载 CSRF 值的 cookie 名 */
const CSRF_COOKIE = 'xigua_csrf_token'

/**
 * 从 cookie 串里取写接口需要的 CSRF token（纯函数）。
 *
 * **真机实证（2026-10-19）**：西瓜/头条的写接口（PublishVideo 等）必须带 `x-csrf-token`，
 * 值取自 **cookie `xigua_csrf_token`**（实测 24 字符）。依据是应用自身 bundle
 * `xigua_entry.*.js` 里写接口统一走：
 *
 *     var i = v("xigua_csrf_token");            // v = cookie getter
 *     o.headers = { "x-csrf-token": i };        // POST 分支
 *
 * 真机对照实测（同一 cookie 串、同一请求体）：
 *
 * | 头部 | 结果 |
 * | --- | --- |
 * | 不带 | HTTP 403 `invalid csrf token` |
 * | `x-csrf-token: <csrf_session_id>` | HTTP 403 同 |
 * | `x-csrftoken: <csrf_session_id>` | HTTP 403 同 |
 * | `x-secsdk-csrf-token: <csrf_session_id>` | HTTP 403 同 |
 * | `X-CSRF-Token: <csrf_session_id>` | HTTP 403 同 |
 * | **`x-csrf-token: <xigua_csrf_token>`** | **200，403 消失，进入业务码判定** |
 *
 * 该 cookie 由西瓜发布页渲染时下发；取不到时返回空串，由调用方**不设该头**——
 * 让服务端如实拒绝，避免把「cookie 缺失」误诊成「签名算法不对」。
 *
 * @param {string} cookie
 * @returns {string}
 */
function pickCsrfToken (cookie) {
  const s = String(cookie == null ? '' : cookie)
  const m = s.match(new RegExp('(?:^|;\\s*)' + CSRF_COOKIE + '=([^;]*)'))
  return m ? decodeURIComponent(m[1].trim()) : ''
}

/**
 * 从推荐封面里挑一个 URI（纯函数，候选键探测见上）。
 * @param {Array} posters
 * @returns {{uri: string, key: string|null, poster: object|null}}
 */
function pickPosterUri (posters) {
  const list = Array.isArray(posters) ? posters : []
  for (const p of list) {
    if (!p || typeof p !== 'object') continue
    for (const k of POSTER_URI_KEYS) {
      const v = p[k]
      if (typeof v === 'string' && v) return { uri: v, key: k, poster: p }
    }
  }
  return { uri: '', key: null, poster: null }
}

module.exports = {
  PUBLISH_PATH,
  PUBLISH_AUTH_PATH,
  REVIEW_LATENCY_PATH,
  POSTER_LIST_PATH,
  PUBLISH_TYPE,
  VIDEO_TYPE,
  ASPECT_RATIO,
  TITLE_LIMIT,
  ABSTRACT_LIMIT,
  POSTER_URI_KEYS,
  CSRF_HEADER,
  CSRF_COOKIE,
  pickCsrfToken,
  // 账号未完善闸门（2026-10-19）：判据 + 平台「去完善」链接
  CODE_ACCOUNT_NOT_VERIFIED,
  ACCOUNT_FIX_URL,
  ACCOUNT_AUTH_URL,
  buildAccountNotVerifiedResult,
  isAccountIncomplete,
  buildPublishGateResult,
  truncateByCodePoint,
  buildToutiaoPublishBody,
  parsePublishResponse,
  parsePosterListResponse,
  pickPosterUri,
}
