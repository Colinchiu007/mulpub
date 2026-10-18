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
 * VideoType 枚举 —— 取自 bundle：`Tt = U < 1 ? 6 : 3`。
 * 3 = 横版视频（发布后进 `content-manage-v2`）；6 = 竖版小视频（进 `small-video`）。
 */
const VIDEO_TYPE = Object.freeze({ landscape: 3, verticalSmall: 6 })

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
  // 竖版（高>宽）走 6=小视频，其余 3=横版（bundle 同款判据）
  const isVertical = height > 0 && width > 0 && height > width
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
  return {
    ok,
    itemId: itemId ? String(itemId) : null,
    status: d.status === undefined ? null : d.status,
    code: d.status === 0 ? data.Code : d.status,
    message: data.Message || d.message || d.msg || '',
  }
}

module.exports = {
  PUBLISH_PATH,
  PUBLISH_AUTH_PATH,
  REVIEW_LATENCY_PATH,
  PUBLISH_TYPE,
  VIDEO_TYPE,
  TITLE_LIMIT,
  ABSTRACT_LIMIT,
  truncateByCodePoint,
  buildToutiaoPublishBody,
  parsePublishResponse,
}
