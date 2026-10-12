// @ts-check
/**
 * account-metrics/link — 账号级作品 → 发布记录 的归因（纯函数，无 IO）
 *
 * 存在理由（PRD-PUBLISH-HISTORY-ENGAGEMENT-2026-10-12 §3.2 V12/V14）：
 * 采集回来的作品要显示在**发布记录**上，就必须与某条发布记录建立关联。本仓已有的关联键是
 * `tracked_content.publish_history_id = 发布任务 id（task.id）`（读侧 PublishHistory.vue 的 join，
 * 契约锁见 bootstrap/phase4-events-tracked-content.test.js T1/T3）。
 *
 * 但真实数据里这条链**只完成了一半**：实测 68 条发布记录中 58 条的作品 ID 为空
 * （抖音 DOM 成功路径不产出 postId、头条 artifact 未命中、快手用合成值 `published-<ts>` 冒充），
 * 于是「哪个平台作品 == 哪条发布记录」在库里根本没有锚点。
 *
 * 本模块补的就是这一段，判据按强度递减：
 *   ① `post_id` 精确相等（最强，来自平台返回的真实作品 ID）
 *   ② 归一标题相等 + 发布时间落在发布记录时间窗内，且**候选唯一**
 * 二级判据刻意取「唯一才认」：与本仓既有的 `tracked-content-link.js`
 * 「(platform, post_id) 恰好命中 1 条才补，歧义必须留空，不许猜」同一条纪律 ——
 * 猜错的关联会把 A 作品的播放数挂到 B 作品的记录上，比「没有数据」更伤。
 *
 * 纯函数：不读时钟/网络/文件，`nowMs` 与窗口都由入参给，因此可离线穷举。
 */
'use strict'

/** 标题匹配的时间窗：发布记录创建时刻与作品发布时刻的允许偏差。 */
const DEFAULT_TITLE_TIME_WINDOW_MS = 36 * 3600 * 1000

/**
 * 标题归一（用于「同一作品」判定）：
 *   ① NFKC 归一（全角→半角，避免「１」与「1」判为不同）；
 *   ② 去掉话题标记 `#...#`、@提及、以及全部标点与空白；
 *   ③ 小写化。
 * 只用于**比较**，不回写、不展示。空结果视为「无标题」，不参与二级匹配
 * （两条都没有标题的记录若允许匹配，会把整批无标题作品误配到一起）。
 * @param {unknown} value
 * @returns {string}
 */
function normalizeTitle (value) {
  if (typeof value !== 'string' || !value) return ''
  let s = value
  try { s = s.normalize('NFKC') } catch (_) { /* 老引擎无 normalize：退回原串 */ }
  s = s.replace(/#[^#]{0,80}#/g, ' ')          // 话题
  s = s.replace(/@[\w\u4e00-\u9fa5.-]{1,40}/g, ' ') // 提及
  // 去掉全部标点/符号/空白（保留字母数字与 CJK）
  s = s.replace(/[\p{P}\p{S}\s]+/gu, '')
  return s.toLowerCase()
}

/**
 * 时间戳解析：ISO 串或 epoch（秒/毫秒）。不可解析返回 NaN（不猜）。
 * @param {unknown} value
 * @returns {number}
 */
function parseTime (value) {
  if (value === null || value === undefined || value === '') return NaN
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value <= 0) return NaN
    return value > 1e12 ? value : value > 1e9 ? value * 1000 : NaN
  }
  const s = String(value)
  if (/^\d+$/.test(s)) return parseTime(Number(s))
  const ms = Date.parse(s)
  return Number.isFinite(ms) ? ms : NaN
}

/**
 * 一级：作品 ID 精确命中。
 * @param {Array<object>} trackedRows
 * @param {Array<object>} works
 * @returns {{links: Array<{trackedId: string, work: object, level: 1}>, usedWorkIds: Set<string>, usedTrackedIds: Set<string>}}
 */
function linkByPostId (trackedRows, works) {
  const links = []
  const usedWorkIds = new Set()
  const usedTrackedIds = new Set()
  const byKey = new Map()
  for (const row of trackedRows) {
    const pid = String(row.post_id || '').trim()
    if (!pid) continue
    byKey.set(String(row.platform || '').toLowerCase() + '\u0000' + pid, row)
  }
  for (const work of works) {
    const key = String(work.platform || '').toLowerCase() + '\u0000' + String(work.postId || '')
    const row = byKey.get(key)
    if (!row) continue
    if (usedTrackedIds.has(String(row.id))) continue
    usedWorkIds.add(String(work.postId))
    usedTrackedIds.add(String(row.id))
    links.push({ trackedId: String(row.id), work, level: 1 })
  }
  return { links, usedWorkIds, usedTrackedIds }
}

/**
 * 二级：标题 + 时间窗，**候选唯一才认**。
 *
 * @param {Array<object>} trackedRows 未一级命中的行
 * @param {Array<object>} works 未一级命中的作品
 * @param {Map<string, object>} recordsByTaskId publish_history_id → 发布记录
 * @param {{windowMs?: number}} [opts]
 * @returns {{links: Array<{trackedId: string, work: object, level: 2}>, ambiguous: string[], noTitle: string[]}}
 */
function linkByTitleAndTime (trackedRows, works, recordsByTaskId, opts) {
  const windowMs = Number.isFinite(opts && opts.windowMs) ? opts.windowMs : DEFAULT_TITLE_TIME_WINDOW_MS
  const links = []
  const ambiguous = []
  const noTitle = []
  /** 每个作品只允许被认领一次（多行抢同一作品 = 重复计数） */
  const claimed = new Set()

  for (const row of trackedRows) {
    const record = recordsByTaskId.get(String(row.publish_history_id || ''))
    const rowTitle = normalizeTitle((record && record.title) || row.title || '')
    if (!rowTitle) { noTitle.push(String(row.id)); continue }
    const rowTime = parseTime(record && (record.timestamp || record.createdAt || record.publishedAt))
      || parseTime(row.created_at)
    const platform = String((record && record.platform) || row.platform || '').toLowerCase()

    const candidates = works.filter((w) => {
      if (claimed.has(String(w.postId))) return false
      if (String(w.platform || '').toLowerCase() !== platform) return false
      if (normalizeTitle(w.title) !== rowTitle) return false
      if (!Number.isFinite(rowTime)) return true // 记录侧无时间：退化为「标题唯一即认」
      const workTime = parseTime(w.publishedAt)
      if (!Number.isFinite(workTime)) return true // 作品侧无时间：同上
      return Math.abs(workTime - rowTime) <= windowMs
    })

    if (candidates.length === 1) {
      const work = candidates[0]
      claimed.add(String(work.postId))
      links.push({ trackedId: String(row.id), work, level: 2 })
    } else if (candidates.length > 1) {
      // 歧义必须留空，不许猜（与 tracked-content-link.js 同纪律）
      ambiguous.push(String(row.id))
    }
  }
  return { links, ambiguous, noTitle }
}

/**
 * 归因总入口。
 *
 * @param {object} input
 * @param {Array<object>} input.trackedRows 该归属下的 tracked_content 行
 * @param {Array<object>} input.works 本次采集到的作品（每项含 platform/postId/title/publishedAt/metrics）
 * @param {Array<object>} [input.records] 发布历史记录（含 id/taskId/platform/title/timestamp）
 * @param {number} [input.windowMs]
 * @returns {{links: Array<object>, ambiguous: string[], stats: {exact: number, fuzzy: number, ambiguous: number, unmatched: number}}}
 */
function planWorkLinks (input) {
  const trackedRows = Array.isArray(input && input.trackedRows) ? input.trackedRows : []
  const works = (Array.isArray(input && input.works) ? input.works : [])
    .map(w => ({ ...w, platform: String((w && w.platform) || '').toLowerCase() }))
    .filter(w => w.postId)
  const records = Array.isArray(input && input.records) ? input.records : []

  const recordsByTaskId = new Map()
  for (const r of records) {
    const taskId = String(r && (r.taskId || r.id) || '').trim()
    if (taskId) recordsByTaskId.set(taskId, r)
  }

  const level1 = linkByPostId(trackedRows, works)
  const restRows = trackedRows.filter(r => !level1.usedTrackedIds.has(String(r.id)))
  const restWorks = works.filter(w => !level1.usedWorkIds.has(String(w.postId)))
  const level2 = linkByTitleAndTime(restRows, restWorks, recordsByTaskId, { windowMs: input && input.windowMs })

  const links = level1.links.concat(level2.links)
  const linkedWorkIds = new Set(links.map(l => String(l.work.postId)))
  return {
    links,
    ambiguous: level2.ambiguous,
    stats: {
      exact: level1.links.length,
      fuzzy: level2.links.length,
      ambiguous: level2.ambiguous.length,
      unmatched: works.length - linkedWorkIds.size,
    },
  }
}

module.exports = {
  planWorkLinks,
  normalizeTitle,
  parseTime,
  DEFAULT_TITLE_TIME_WINDOW_MS,
}
