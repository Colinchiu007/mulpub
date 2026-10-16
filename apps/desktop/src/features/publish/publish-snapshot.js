// @ts-check
/**
 * publish-snapshot.js — 「内容快照 → 发布表单」的**唯一实现**
 *
 * 两个调用方，同一份字段口径：
 *   ① 草稿箱：`usePublishDrafts.applyDraft`（用户在草稿箱点「继续编辑」）
 *   ② 发布记录「再次发布」：`Publish.vue` 的 `?republish=<recordId>` 分支
 *
 * 为什么必须共用：两者对用户呈现的都是「把之前的内容还原回表单」，各写一份必然漂移；
 * 漂移的表现不是报错，而是「从草稿恢复有话题、再次发布没话题」这类静默少字段。
 * （本仓已有同型事故：`usePublishFlow` 与 `useBatchPublish` 各写一份 override 归一，
 * 结果是「批量面板可编辑但发布不生效」，见 publish-overrides.js 头注释。）
 *
 * 三条容易被改坏的边界：
 *   - **数组字段缺失回落 `[]` 而不是 `''`**：空串会触发 publish-contract 的
 *     「images 文件引用无效」，把纯文字内容挡在发布门外（E2E 2026-09-11 实测）。
 *   - **`rewriteHistoryId` 是 `string|null` 语义**：不得折成空串 —— 折了之后
 *     「没关联」与「关联被抹」不可区分，未来任何 `!= null` 的读法都会把 '' 当成有值。
 *   - **`publishTime` 是绝对时刻**：过期值静默沿用会让下一次发布被
 *     `validateScheduleEntries` 拒绝（「定时时间已过去」）且用户不知情。判据与草稿箱
 *     既有实现逐字一致（可解析且不晚于当前才算过期；不可解析的一律保留，不替用户猜）。
 */
import { normalizeRewriteLineage } from '@/utils/rewrite-lineage'
import { normalizePublishStringList } from './publish-contract'

/** 与主进程 `services/publish-republish-snapshot.js` 的 SNAPSHOT_FIELDS 同族（仅少 platform/accountId） */
export const SNAPSHOT_ARTICLE_FIELDS = [
  'title',
  'content',
  'author',
  // 「AI 生成声明」是**发布选项**而不是文案：表单默认 true，不还原就会在下一次发布时
  // 静默把用户上次的显式选择翻回默认（合规相关，不能靠默认值兜）。CCG 深度审查 i2 指出的
  // 「主进程存、渲染端不还原」正是这一格。
  'aiGenerated',
  'cover_url',
  'cover_path',
  'cover_file',
  'video_path',
  'images',
  'image_files',
  'tags',
  'topics',
  'mentions',
  'publishTime',
  // 归因链：改写关联必须与内容一起被存/取，否则「从草稿去发布」这条主路径永远接不上。
  // 它不是内容字段：不参与 computeDraftFingerprint（见 services/draft-fingerprint.js）。
  'rewriteHistoryId',
]

/** 数组型字段：缺失时必须回退为 `[]` 而非 `''` */
export const SNAPSHOT_ARRAY_FIELDS = new Set(['images', 'image_files', 'tags', 'topics', 'mentions'])

function toPlainJson (value) {
  return JSON.parse(JSON.stringify(value))
}

function replaceRecord (target, source) {
  for (const key of Object.keys(target)) delete target[key]
  Object.assign(target, toPlainJson(source || {}))
}

/**
 * 定时时间是否已过期。
 * @param {string} time
 * @param {number} [now]
 * @returns {boolean}
 */
export function isStaleScheduleTime (time, now = Date.now()) {
  const raw = String(time || '').trim()
  if (!raw) return false
  const ts = Date.parse(raw)
  if (Number.isNaN(ts)) return false
  return ts <= now
}

/**
 * 把快照写入发布表单。
 *
 * @param {object|null|undefined} snapshot 草稿或「再次发布」快照
 * @param {object} targets
 * @param {Record<string, unknown>} targets.article 发布表单（就地修改）
 * @param {{ value: string[] }} [targets.selectedPlatforms]
 * @param {{ value: Record<string, unknown> }} [targets.selectedAccounts]
 * @param {Record<string, unknown>} [targets.platformOverrides]
 * @param {{dropStaleSchedule?: boolean, now?: number}} [options]
 * @returns {{applied: boolean, staleScheduleTime: string, restoredScheduleTime: string}}
 *   applied=false 表示快照不可用（**未改动表单**）；staleScheduleTime 非空时由调用方提示用户
 */
export function applyPublishSnapshot (snapshot, targets, options = {}) {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
    return { applied: false, staleScheduleTime: '', restoredScheduleTime: '' }
  }
  const { article, selectedPlatforms, selectedAccounts, platformOverrides } = targets || {}
  if (!article || typeof article !== 'object') {
    return { applied: false, staleScheduleTime: '', restoredScheduleTime: '' }
  }

  for (const field of SNAPSHOT_ARTICLE_FIELDS) {
    // 归因关联例外：它是 string|null 语义，不能套通用的 `|| ''` 默认值。
    // 折成空串会让「没关联」与「关联被抹」不可区分。
    if (field === 'rewriteHistoryId') {
      article[field] = normalizeRewriteLineage(snapshot[field])
      continue
    }
    // 布尔选项例外：通用分支的 `snapshot[field] || ''` 会把 `false` 折成空串（在 checkbox 上
    // 反而为真），也会把「快照没有这个字段」的旧记录折成空串而不是保持表单当前值。
    if (field === 'aiGenerated') {
      if (typeof snapshot[field] === 'boolean') article[field] = snapshot[field]
      continue
    }
    article[field] = SNAPSHOT_ARRAY_FIELDS.has(field)
      ? (Array.isArray(snapshot[field]) ? toPlainJson(snapshot[field]) : [])
      : (snapshot[field] || '')
  }

  // 话题标签统一（topic-tag-unify）：UI 只剩「话题标签」一个入口（tags），
  // 历史草稿的 topics 一次性并入 tags，topics 字段清空防双份——引擎侧
  // mergeUniqueStrings 本就合并两者，这里提前合并让 UI 显示不缺话题。
  // 归一口径与引擎侧一致（normalizePublishStringList），禁止第二份归一实现。
  const mergedTags = normalizePublishStringList([
    ...(Array.isArray(article.tags) ? article.tags : []),
    ...(Array.isArray(article.topics) ? article.topics : []),
  ])
  article.tags = mergedTags
  article.topics = []

  const restoredScheduleTime = String(article.publishTime || '').trim()
  const staleScheduleTime = isStaleScheduleTime(restoredScheduleTime, options.now) ? restoredScheduleTime : ''
  if (staleScheduleTime && options.dropStaleSchedule !== false) article.publishTime = ''

  if (selectedPlatforms && 'value' in selectedPlatforms) {
    selectedPlatforms.value = Array.isArray(snapshot.platforms) ? toPlainJson(snapshot.platforms) : []
  }
  if (selectedAccounts && 'value' in selectedAccounts) {
    selectedAccounts.value = snapshot.accounts && typeof snapshot.accounts === 'object' && !Array.isArray(snapshot.accounts)
      ? toPlainJson(snapshot.accounts)
      : {}
  }
  if (platformOverrides && typeof platformOverrides === 'object') {
    replaceRecord(platformOverrides, snapshot.platformOverrides)
  }

  return { applied: true, staleScheduleTime, restoredScheduleTime }
}
