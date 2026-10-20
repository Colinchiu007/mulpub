/**
 * Shared, renderer-only history ordering and filtering contracts.
 *
 * History records come from more than one persistence path, so this module
 * deliberately accepts both camelCase and snake_case timestamps and never
 * mutates the caller's array.
 */
export const HISTORY_TIME_KEYS = Object.freeze([
  'updatedAt',
  'updated_at',
  'completedAt',
  'completed_at',
  'endedAt',
  'ended_at',
  'createdAt',
  'created_at',
])

/** 历史记录排序方式枚举（2026-09-04：视频创作-历史记录排序下拉） */
export const SORT_MODES = Object.freeze({
  UPDATED_DESC: 'updatedDesc',
  UPDATED_ASC: 'updatedAsc',
  CREATED_DESC: 'createdDesc',
  CREATED_ASC: 'createdAsc',
  VIDEO_DURATION_DESC: 'videoDurationDesc',
  VIDEO_DURATION_ASC: 'videoDurationAsc',
})

/** 排序下拉选项顺序（UI 展示顺序） */
export const SORT_OPTIONS = Object.freeze([
  SORT_MODES.UPDATED_DESC,
  SORT_MODES.UPDATED_ASC,
  SORT_MODES.CREATED_DESC,
  SORT_MODES.CREATED_ASC,
  SORT_MODES.VIDEO_DURATION_DESC,
  SORT_MODES.VIDEO_DURATION_ASC,
])

// 视频时长候选字段（与 CreateViewHistory.videoDuration 保持一致）
const VIDEO_DURATION_KEYS = Object.freeze(['videoDuration', 'video_duration', 'composeDuration', 'durationSeconds'])

// 历史状态标签清单（tab 顺序即 UI 顺序）：
//   recoverable = 聚合筛选 tab，同时覆盖 paused（用户手动暂停）与 interrupted（应用退出/崩溃中断），
//   展示层弱化差异，但底层 item.status 仍保留 paused/interrupted 原值，卡片内图标与提示区分不变
//   （2026-08-20 状态语义修订 + 2026-08-31 展示层聚合）
export const HISTORY_STATUSES = Object.freeze(['all', 'running', 'recoverable', 'failed', 'completed', 'cancelled'])
export const RECOVERABLE_STATUSES = Object.freeze(['paused', 'interrupted'])

const CREATION_TIME_KEYS = Object.freeze(['createdAt', 'created_at'])
const IDENTITY_KEYS = Object.freeze(['id', 'projectId', 'runId'])

function parseHistoryTime (value) {
  // null means "field missing/invalid"; a finite number (including epoch 0)
  // and a parseable ISO string are valid effective times.
  if (value === null || value === undefined || value === '') return null
  if (typeof value === 'string' && value.trim() === '') return null

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null
    // Accept seconds and milliseconds while keeping the public contract
    // explicit about finite epoch values.
    const milliseconds = Math.abs(value) < 1e11 ? value * 1000 : value
    return Number.isFinite(milliseconds) ? milliseconds : null
  }

  if (typeof value !== 'string') return null
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : null
}

function firstValidTime (item, keys) {
  if (!item || typeof item !== 'object') return 0
  for (const key of keys) {
    const parsed = parseHistoryTime(item[key])
    if (parsed !== null) return parsed
  }
  return 0
}

/** 返回 null 表示缺失（用于排序缺省值放最后） */
function firstValidTimeOrNull (item, keys) {
  if (!item || typeof item !== 'object') return null
  for (const key of keys) {
    const parsed = parseHistoryTime(item[key])
    if (parsed !== null) return parsed
  }
  return null
}

export function historyEffectiveTime (item) {
  return firstValidTime(item, HISTORY_TIME_KEYS)
}

export function latestHistoryTimestamp (...items) {
  let latest = null
  for (const item of items) {
    if (!item || typeof item !== 'object') continue
    for (const key of HISTORY_TIME_KEYS) {
      const parsed = parseHistoryTime(item[key])
      if (parsed !== null && (latest === null || parsed > latest)) latest = parsed
    }
  }
  return latest === null ? null : new Date(latest).toISOString()
}

function historyCreatedTime (item) {
  return firstValidTime(item, CREATION_TIME_KEYS)
}

/** 返回 null 表示缺失 */
function historyCreatedTimeOrNull (item) {
  return firstValidTimeOrNull(item, CREATION_TIME_KEYS)
}

/** 返回 null 表示缺失 */
function historyEffectiveTimeOrNull (item) {
  return firstValidTimeOrNull(item, HISTORY_TIME_KEYS)
}

function historyStableIdentity (item) {
  if (!item || typeof item !== 'object') return ''
  for (const key of IDENTITY_KEYS) {
    const value = item[key]
    if (value !== null && value !== undefined && String(value).trim() !== '') return String(value)
  }
  return ''
}

export function compareHistoryItems (a, b, aIndex = 0, bIndex = 0) {
  const effectiveDelta = historyEffectiveTime(b) - historyEffectiveTime(a)
  if (effectiveDelta !== 0) return effectiveDelta

  const createdDelta = historyCreatedTime(b) - historyCreatedTime(a)
  if (createdDelta !== 0) return createdDelta

  const identityDelta = historyStableIdentity(a).localeCompare(historyStableIdentity(b))
  return identityDelta !== 0 ? identityDelta : aIndex - bIndex
}

export function sortHistoryByEffectiveTime (items) {
  if (!Array.isArray(items)) return []
  return items
    .map((item, index) => ({ item, index }))
    .sort((left, right) => compareHistoryItems(left.item, right.item, left.index, right.index))
    .map(entry => entry.item)
}

/**
 * 提取视频时长（秒），用于排序。
 * 字段候选与 CreateViewHistory.videoDuration 保持一致，排除流水线执行耗时（activeMs/duration）。
 * @returns {number|null} 秒数或 null（缺失）
 */
export function historyVideoDuration (item) {
  if (!item || typeof item !== 'object') return null
  // 直接字段候选
  for (const key of VIDEO_DURATION_KEYS) {
    const value = item[key]
    if (value === null || value === undefined || value === '') continue
    const num = Number(value)
    if (Number.isFinite(num) && num >= 0) return num
  }
  // 嵌套 video.duration
  const video = item.video
  if (video && typeof video === 'object') {
    const dur = video.duration
    if (dur !== null && dur !== undefined && dur !== '') {
      const num = Number(dur)
      if (Number.isFinite(num) && num >= 0) return num
    }
  }
  return null
}

/**
 * 提取任务显式标题（不含回退到流水线名或未命名任务）。
 * 用于重复标题检测：只有显式命名的任务才参与比对。
 * @returns {string} 修剪后的标题，空串表示无显式标题
 */
export function historyExplicitTitle (item) {
  if (!item || typeof item !== 'object') return ''
  const title = item.title
  if (typeof title === 'string' && title.trim()) return title.trim()
  const params = item.params && typeof item.params === 'object' ? item.params : {}
  const paramsTitle = params.title || params.publishTitle
  if (typeof paramsTitle === 'string' && paramsTitle.trim()) return paramsTitle.trim()
  return ''
}

/**
 * 在历史记录列表中检测重复标题，返回身份集合。
 * 完全匹配（修剪后逐字相等），区分大小写。无显式标题的条目不参与比对。
 * @param {Array} items - 历史记录数组
 * @param {object} [options]
 * @param {function} [options.titleOf] - 提取标题函数，默认 historyExplicitTitle
 * @param {function} [options.identityOf] - 提取身份函数，默认 (item, index) => String(item?.id || item?.projectId || item?.runId || index)
 * @returns {Set<string>} 存在重复标题的条目身份集合
 */
export function collectDuplicateTitleIdentities (items, { titleOf = historyExplicitTitle, identityOf } = {}) {
  const list = Array.isArray(items) ? items : []
  const resolveIdentity = typeof identityOf === 'function'
    ? identityOf
    : (item, index) => String(item?.id || item?.projectId || item?.runId || index)
  const groups = new Map()
  list.forEach((item, index) => {
    const title = String(titleOf(item, index) || '').trim()
    if (!title) return
    if (!groups.has(title)) groups.set(title, [])
    groups.get(title).push(String(resolveIdentity(item, index)))
  })
  const duplicates = new Set()
  for (const identities of groups.values()) {
    if (identities.length < 2) continue
    for (const id of identities) duplicates.add(id)
  }
  return duplicates
}

/** 根据排序模式获取排序主键值，null 表示缺失 */
function sortPrimaryValue (item, mode) {
  if (mode === SORT_MODES.UPDATED_DESC || mode === SORT_MODES.UPDATED_ASC) return historyEffectiveTimeOrNull(item)
  if (mode === SORT_MODES.CREATED_DESC || mode === SORT_MODES.CREATED_ASC) return historyCreatedTimeOrNull(item)
  if (mode === SORT_MODES.VIDEO_DURATION_DESC || mode === SORT_MODES.VIDEO_DURATION_ASC) return historyVideoDuration(item)
  return historyEffectiveTimeOrNull(item)
}

function isAscending (mode) {
  return typeof mode === 'string' && mode.endsWith('Asc')
}

/** 比较主键值：缺失值统一放最后 */
function comparePrimary (a, b, mode) {
  const av = sortPrimaryValue(a, mode)
  const bv = sortPrimaryValue(b, mode)
  if (av === null && bv === null) return 0
  if (av === null) return 1
  if (bv === null) return -1
  return isAscending(mode) ? av - bv : bv - av
}

/** 次级排序：有效时间倒序 → 创建时间倒序 → 身份升序 → 原始索引 */
function tieBreakCompare (a, b, aIndex, bIndex) {
  const eff = historyEffectiveTime(b) - historyEffectiveTime(a)
  if (eff !== 0) return eff
  const created = historyCreatedTime(b) - historyCreatedTime(a)
  if (created !== 0) return created
  const identity = historyStableIdentity(a).localeCompare(historyStableIdentity(b))
  if (identity !== 0) return identity
  return aIndex - bIndex
}

/**
 * 按指定排序模式对历史记录排序（不修改原数组）。
 * @param {Array} items
 * @param {string} [sortMode] - 默认 UPDATED_DESC
 * @returns {Array} 排序后的新数组
 */
export function sortHistory (items, sortMode) {
  const list = Array.isArray(items) ? items : []
  const mode = Object.values(SORT_MODES).includes(sortMode) ? sortMode : SORT_MODES.UPDATED_DESC
  return list
    .map((item, index) => ({ item, index }))
    .sort((left, right) => {
      const primary = comparePrimary(left.item, right.item, mode)
      if (primary !== 0) return primary
      return tieBreakCompare(left.item, right.item, left.index, right.index)
    })
    .map(entry => entry.item)
}

export function filterHistoryByStatus (items, status = 'all', sortMode) {
  const list = Array.isArray(items) ? items : []
  const filtered = status === 'all'
    ? list
    : status === 'recoverable'
      ? list.filter(item => item && RECOVERABLE_STATUSES.includes(item.status))
    : list.filter(item => item && item.status === status)
  return sortHistory(filtered, sortMode || SORT_MODES.UPDATED_DESC)
}

export function historyStatusCounts (items) {
  const counts = { all: 0, running: 0, recoverable: 0, paused: 0, interrupted: 0, failed: 0, completed: 0, cancelled: 0 }
  for (const item of Array.isArray(items) ? items : []) {
    counts.all += 1
    if (Object.prototype.hasOwnProperty.call(counts, item?.status)) counts[item.status] += 1
    if (RECOVERABLE_STATUSES.includes(item?.status)) counts.recoverable += 1
  }
  return counts
}


/** 30 分钟过期运行阈值（与 CreateView.vue / usePipelineHistory.js 保持一致） */
export const STALE_RUNNING_THRESHOLD_MS = 30 * 60 * 1000

/**
 * 将过期运行中的任务标记为 interrupted（应用退出/崩溃残留）。
 * 直接修改传入数组中的元素（mutation），不返回新数组。
 * @param {Array} items - 历史记录数组
 * @param {number} [now] - 当前时间戳，默认 Date.now()
 */
export function markStaleRunningAsInterrupted (items, now = Date.now()) {
  if (!Array.isArray(items)) return
  for (const item of items) {
    if (item && item.status === 'running') {
      const updatedAt = item.updatedAt ? new Date(item.updatedAt).getTime() : 0
      if (updatedAt && (now - updatedAt) > STALE_RUNNING_THRESHOLD_MS) {
        item._originalStatus = item.status
        item.status = 'interrupted'
        if (!item.pausedStage) {
          const stages = Array.isArray(item.stages) ? item.stages : []
          const runningStage = stages.find(s => s && s.status === 'running') || stages[stages.length - 1]
          item.pausedStage = runningStage ? (runningStage.name || runningStage.stage || '') : ''
        }
      }
    }
  }
}

/**
 * 为 failed 状态的任务补充 pausedStage（失败环节）。
 * 直接修改传入数组中的元素（mutation）。
 * @param {Array} items - 历史记录数组
 */
export function fillFailedPausedStage (items) {
  if (!Array.isArray(items)) return
  for (const item of items) {
    if (item && item.status === 'failed' && !item.pausedStage) {
      const stages = Array.isArray(item.stages) ? item.stages : []
      const failedStage = stages.find(s => s && s.status === 'failed')
        || stages.find(s => s && s.status !== 'completed')
        || stages[stages.length - 1]
      item.pausedStage = failedStage ? (failedStage.name || failedStage.stage || '') : ''
    }
  }
}


export function historyDisplayTime (item) {
  return historyEffectiveTime(item)
}

/**
 * compose 预检稳定错误码 → locale 文案 key（2026-10-20 error-message-user-friendly-audit）。
 *
 * 主进程 `story2video-compose-engine.js` 的 COMPOSE_ERROR_CODES 落库到 run.errorCode，
 * 历史卡片据此取自然语言文案。**必须显式列举，不得按字符串规则拼 key**——
 * 拼错会静默渲染成 i18n key 原文（`story2video.compose_xxx`）直接显示给用户。
 *
 * 与主进程常量保持一对一：新增 COMPOSE_* 错误码时必须同步此处与
 * `locales/story2video/{zh,en}.js` 的 compose_* 文案。
 */
export const COMPOSE_ERROR_KEY_MAP = Object.freeze({
  COMPOSE_FFMPEG_NOT_FOUND: 'story2video.compose_ffmpeg_not_found',
  COMPOSE_INVALID_ASSET_MANIFEST: 'story2video.compose_invalid_asset_manifest',
  COMPOSE_INPUT_SIZE_EXCEEDED: 'story2video.compose_input_size_exceeded',
  COMPOSE_SCENE_MEDIA_UNREADABLE: 'story2video.compose_scene_media_unreadable',
  COMPOSE_SCENE_AUDIO_UNREADABLE: 'story2video.compose_scene_audio_unreadable',
  COMPOSE_SEGMENT_DURATION_EXCEEDED: 'story2video.compose_segment_duration_exceeded',
  COMPOSE_DURATION_EXCEEDED: 'story2video.compose_duration_exceeded',
  COMPOSE_AUDIO_DURATION_EXCEEDED: 'story2video.compose_audio_duration_exceeded',
})

/**
 * 内容政策/需要用户输入类失败的统一门控关键字（与主进程 pipeline-engine.js
 * resumeOrchestration 的判定对齐）：命中即判定为不可原样恢复，必须修改文案后重新生成。
 * content 与 policy 之间允许空格/下划线/连字符或不带分隔符（content policy / content_policy /
 * content-policy / contentpolicy 均命中）。
 */
export const RESUME_BLOCKING_ERROR_PATTERN = /内容政策|needs_user_input|content[_\-\s]?policy|可能需要修改文案|repeatedly returned no result|多次未返回结果/i

/**
 * 内容政策/需用户输入的具体原因子集（不含 empty_result 短语）。
 * 历史页「场景提取」与「内容政策拦截」提示条用它判定，避免把多次空结果失败
 * （服务波动/账号问题）误标为内容安全审查（2026-08-16 复审解耦）。
 */
export const CONTENT_POLICY_ERROR_PATTERN = /内容政策|needs_user_input|content[_\-\s]?policy|可能需要修改文案/i

// 从内容政策子集派生，保证场景提取关键字清单单一来源（含中文「内容政策」变体），不会漂移。
const POLICY_SCENE_PATTERN = new RegExp(`Image\\s+#(\\d+)[^;]*?(?:${CONTENT_POLICY_ERROR_PATTERN.source})`, 'gi')

function compressSceneRanges (sceneNumbers) {
  const sorted = [...sceneNumbers].sort((a, b) => a - b)
  const parts = []
  let rangeStart = sorted[0]
  let prev = sorted[0]
  for (let i = 1; i <= sorted.length; i += 1) {
    const current = sorted[i]
    if (current === prev + 1) {
      prev = current
      continue
    }
    parts.push(prev === rangeStart ? String(rangeStart) : rangeStart + '-' + prev)
    if (current !== undefined) {
      rangeStart = current
      prev = current
    }
  }
  return parts
}

/**
 * 从失败错误文本中提取「内容政策拦截」的具体场景号。
 * 规则：仅统计 Image #N 段内命中门控关键字的失败项（瞬时失败如 aborted 不计入）；
 * 升序、去重。
 * @param {string|undefined|null} error - 历史任务的原始错误文本
 * @returns {number[]} 例如 [49, 73, 74]；无命中返回 []
 */
export function collectContentPolicySceneNumbers (error) {
  const raw = String(error || '')
  if (!raw) return []
  const sceneNumbers = new Set()
  POLICY_SCENE_PATTERN.lastIndex = 0
  let match
  while ((match = POLICY_SCENE_PATTERN.exec(raw)) !== null) {
    const scene = Number(match[1])
    if (Number.isInteger(scene) && scene > 0) sceneNumbers.add(scene)
  }
  return [...sceneNumbers].sort((a, b) => a - b)
}

/**
 * 将政策场景号序列化为结果页 focusScenes 路由 query（逗号分隔、区间展开逐号）。
 * @param {string|undefined|null} error - 历史任务的原始错误文本
 * @returns {string} 例如 '49,73,74'；无命中返回 ''
 */
export function policySceneQuery (error) {
  return collectContentPolicySceneNumbers(error).join(',')
}

/**
 * 将政策场景号压缩为可读字符串。
 * 连续区间压缩为 a-b。
 * @param {string|undefined|null} error - 历史任务的原始错误文本
 * @param {string} [locale] - 'zh'（默认，顿号分隔）或 'en'（逗号分隔）
 * @returns {string} 例如 '#49、#73-77'；无命中返回 ''
 */
export function contentPolicyScenes (error, locale = 'zh') {
  const sceneNumbers = collectContentPolicySceneNumbers(error)
  if (sceneNumbers.length === 0) return ''
  const separator = String(locale || '').trim().toLowerCase().startsWith('en') ? ', ' : '、'
  return '#' + compressSceneRanges(sceneNumbers).join(separator + '#')
}