// @ts-check
/**
 * publish-from-project.js — 从 Story2Video 项目提取「发布」所需数据
 *
 * 职责：
 *   - 将已完成合成的 story2video 项目（历史记录/结果页）映射为发布页可用的预填充数据
 *   - 统一 CreateViewHistory「发布历史视频」与 ResultView「去发布」两条入口的数据契约
 *   - 标题/正文/话题标签的提取与兜底（含百家号标题长度截断）
 *
 * 数据来源优先级（见 story2video project.json 结构）：
 *   - video_path：project.videoPath
 *   - title：story2videoTextConfig.config.publish.title → project.title → project.sourceText
 *   - content：story2videoTextConfig.config.publish.content → project.sourceText → 拼接 segments[].text
 *   - tags：story2videoTextConfig.config.publish.tags
 *
 * 说明：百家号 API 发布不支持自定义封面（adapter 对 taskData.cover 直接拒绝），
 * 因此历史视频发布一律走视频首帧封面，不携带 cover。
 */

import { normalizePublishStringList } from './publish-contract'
import { PUBLISH_TITLE_MAX, truncateTitleByCodePoints } from './title-limits'

/**
 * 标题上限铁律（2026-10-18 用户要求）：最多 20 字，单一真源在 `title-limits.js`。
 * 保留本地常量名只为不破坏既有 import 语义。
 */
const DEFAULT_TITLE_MAX = PUBLISH_TITLE_MAX

function readPublishConfig (project) {
  if (!project || typeof project !== 'object') return {}
  const config = project.story2videoTextConfig
  if (!config || typeof config !== 'object') return {}
  const inner = config.config
  if (!inner || typeof inner !== 'object') return {}
  const publish = inner.publish
  return publish && typeof publish === 'object' ? publish : {}
}

function joinSegmentTexts (segments) {
  if (!Array.isArray(segments)) return ''
  return segments
    .map(segment => (segment && typeof segment.text === 'string' ? segment.text : ''))
    .filter(Boolean)
    .join('')
}

function truncateTitle (title, max = DEFAULT_TITLE_MAX) {
  return truncateTitleByCodePoints(String(title || '').trim(), max)
}

/**
 * 从 Story2Video 项目提取发布预填充数据。
 * @param {object} project story2video 项目对象（含 videoPath/title/sourceText/segments/story2videoTextConfig）
 * @returns {{ type: 'video', video_path: string, title: string, content: string, tags: string[] }}
 */
export function buildPublishFromProject (project) {
  const publish = readPublishConfig(project)
  const sourceText = typeof project?.sourceText === 'string' ? project.sourceText.trim() : ''
  const projectTitle = typeof project?.title === 'string' ? project.title.trim() : ''
  const segmentText = joinSegmentTexts(project?.segments)

  // 标题只认**显式标题**（用户填的 publish.title，或项目里独立存在的 title）。
  //
  // ⛔ 2026-10-18 起**不再**回退到 sourceText：那是本期修的原始缺陷
  //    （标题 = 正文前 N 字）。此函数是四条入口（视频创作 / 结果页 / 历史一键发布 /
  //    播客）共用的唯一提取点，所以这一处不改就等于缺陷换个入口继续存在。
  //    无显式标题 ⇒ 返回空串，由发布页的 noTitleHint + 发布前校验把用户拦到「请填标题」，
  //    比自动塞一段正文切片诚实（用户根本没写标题这件事必须被暴露，不能被填充掩盖）。
  const rawTitle = String(publish.title || projectTitle || '').trim()
  const rawContent = String(publish.content || sourceText || segmentText || '').trim()
  const tags = normalizePublishStringList(publish.tags)
  const videoPath = typeof project?.videoPath === 'string' ? project.videoPath.trim() : ''

  return {
    type: 'video',
    video_path: videoPath,
    title: truncateTitle(rawTitle),
    content: rawContent,
    tags,
  }
}

/**
 * 将发布预填充数据编码为路由 query（供跳转 /publish 使用）。
 * 路径与文案可能含反斜杠/特殊字符，统一 encodeURIComponent 后放入 query。
 * @param {{ type: 'video', video_path: string, title: string, content: string, tags: string[] }} data
 * @returns {object} 可直接作为 router.push query 的对象
 */
export function publishDataToQuery (data) {
  const query = {
    type: 'video',
    video_path: encodeURIComponent(data.video_path),
    title: encodeURIComponent(data.title),
    content: encodeURIComponent(data.content),
  }
  if (Array.isArray(data.tags) && data.tags.length > 0) {
    query.tags = encodeURIComponent(data.tags.join(','))
  }
  return query
}
