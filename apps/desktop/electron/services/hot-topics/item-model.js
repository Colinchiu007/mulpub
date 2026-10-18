// @ts-check
/**
 * 热门选题条目模型的**单一实现**（kind 判别位 + 内容段归一 + 采集出口资格判据）。
 *
 * 规格真源：`openspec/changes/hot-topics-viral-items/specs/hot-topics-viral-items/spec.md`
 * 需求编号对应关系：
 *   - Requirement 1 判别位必填、旧数据读作 topic → `normalizeKind` / `withLegacyKind`
 *   - Requirement 2 item 三字段全空即不合格 → `hasContentFields` / `validateEntry` / `filterViableEntries`
 *   - Requirement 3 字段缺席 ≠ 空值 ≠ 兜底值 → `pickContentFields`
 *   - Requirement 5 投影链逐层透传 → 三个调用点（服务层两个采集出口 + IPC 收藏白名单）都调本模块，禁止各抄一份
 *
 * 为什么把丢弃点放在采集出口而不是渲染层：一旦不合格条目进入列表，它会继续经过
 * classifier（拿不存在的文本归类）、scorer（计入"多榜同现"）、界面（用渠道名兜底作者），
 * 四个消费层各自把同一份坏数据兜成不同形状，而症状只是"看着不太对"。
 */

const KIND_TOPIC = 'topic'
const KIND_ITEM = 'item'
const KINDS = [KIND_TOPIC, KIND_ITEM]

/** 作者名上限：超过即视为来源畸形（截断会得到一个"看起来真"的名字，比缺席更坏） */
const AUTHOR_MAX = 128
/** ISO 形态日期/时间；抓取时间戳（毫秒整数）不属于此形制，MUST NOT 冒充发布时间 */
const ISO_TIME_RE = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/
/** 互动数白名单：O-3（播放量）取证完成前，未在此列的键一律不采纳，避免留空壳字段 */
const INTERACTION_KEYS = ['like', 'comment', 'share', 'play']

/**
 * 判别位归一。非法值返回 null 而不是默认值——
 * 把非法值"修好"等于由消费层推断，正是 Requirement 1 要禁止的形态。
 * @param {unknown} value
 * @returns {string|null}
 */
function normalizeKind(value) {
  return typeof value === 'string' && KINDS.includes(value) ? value : null
}

/**
 * 内容段归一：只保留"真的存在且形态合法"的键。
 * 返回对象里缺席的键**不存在**（不是 undefined），这样下游能用 `in` / hasContentFields 区分两态。
 * @param {any} entry
 * @returns {{ author?: string, publishTime?: string, interaction?: Record<string, number> }}
 */
function pickContentFields(entry) {
  const out = {}
  if (!entry || typeof entry !== 'object') return out

  const author = typeof entry.author === 'string' ? entry.author.trim() : ''
  if (author && author.length <= AUTHOR_MAX) out.author = author

  const publishTime = typeof entry.publishTime === 'string' ? entry.publishTime.trim() : ''
  if (publishTime && ISO_TIME_RE.test(publishTime)) out.publishTime = publishTime

  const raw = entry.interaction
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const clean = {}
    for (const key of INTERACTION_KEYS) {
      const n = Number(raw[key])
      // 0 是真实读数必须保留；负数/小数/字符串/"没有"都不算一项
      if (raw[key] !== undefined && raw[key] !== null && Number.isFinite(n) && n >= 0 && Number.isInteger(n)) {
        clean[key] = n
      }
    }
    if (Object.keys(clean).length) out.interaction = clean
  }

  return out
}

/** @param {any} fields 由 pickContentFields 产出的对象 @returns {boolean} */
function hasContentFields(fields) {
  return !!fields && Object.keys(fields).length > 0
}

/**
 * 单条资格判据。
 * @param {any} entry
 * @returns {{ ok: boolean, reason: string|null }}
 */
function validateEntry(entry) {
  if (!entry || typeof entry !== 'object') return { ok: false, reason: 'ENTRY_INVALID' }

  const kind = normalizeKind(entry.kind)
  if (!kind) return { ok: false, reason: 'KIND_INVALID' }

  const text = typeof entry.topic === 'string' ? entry.topic.trim() : ''
  if (!text) return { ok: false, reason: 'TOPIC_TEXT_MISSING' }

  if (kind === KIND_ITEM && !hasContentFields(pickContentFields(entry))) {
    return { ok: false, reason: 'ITEM_NO_CONTENT' }
  }

  return { ok: true, reason: null }
}

/**
 * 采集出口过滤：返回 kept / dropped / reasonCounts。
 * 告警**只记渠道、计数与原因**，不记条目文本——同一出口将来会承载用户尚未发布的内容字段。
 * @param {Array<any>} entries
 * @param {{ channel?: string, log?: { warn?: (m: string) => void } }} [opts]
 * @returns {{ kept: any[], dropped: number, reasonCounts: Record<string, number> }}
 */
function filterViableEntries(entries, opts = {}) {
  const list = Array.isArray(entries) ? entries : []
  const kept = []
  /** @type {Record<string, number>} */
  const reasonCounts = {}
  let dropped = 0

  for (const entry of list) {
    const verdict = validateEntry(entry)
    if (verdict.ok) {
      kept.push(entry)
      continue
    }
    dropped += 1
    const reason = verdict.reason || 'ENTRY_INVALID'
    reasonCounts[reason] = (reasonCounts[reason] || 0) + 1
  }

  if (dropped > 0 && opts.log && typeof opts.log.warn === 'function') {
    const reasons = Object.keys(reasonCounts).sort().map(k => k + '=' + reasonCounts[k]).join(',')
    opts.log.warn('[hot-topics] 条目资格判据丢弃 channel=' + (opts.channel || 'unknown') +
      ' dropped=' + dropped + ' kept=' + kept.length + ' reasons=[' + reasons + ']（只记计数与原因，不记条目文本）')
  }

  return { kept, dropped, reasonCounts }
}

/**
 * 旧缓存读取归一：`kind` 缺席时读作 topic，**已有值原样保留**（非法值留给资格判据判红，不在这里修）。
 * 不做反向迁移：迁移会把历史数据写成当下口径，事后无法区分"当年就没有"与"当年没这个字段"。
 * @param {any} entry
 * @returns {any}
 */
function withLegacyKind(entry) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return entry
  if (entry.kind === undefined || entry.kind === null) return { ...entry, kind: KIND_TOPIC }
  return entry
}

module.exports = {
  KIND_TOPIC,
  KIND_ITEM,
  KINDS,
  AUTHOR_MAX,
  INTERACTION_KEYS,
  normalizeKind,
  pickContentFields,
  hasContentFields,
  validateEntry,
  filterViableEntries,
  withLegacyKind,
}
