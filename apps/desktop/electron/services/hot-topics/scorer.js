// @ts-check
/**
 * hot-topics 统一热度评分器（纯函数，无副作用、无网络，便于单测桩化）
 *
 * 背景：v2 之前聚合仅按 CHANNEL_CONFIGS 数组顺序追加，非热度排序；跨渠道 rank 不可比、
 * hotValue 单位各异（B站=播放量/微博=讨论量/头条=hotEvent/百度常缺失）、RSS 类无 hotValue。
 * 本模块把一条选题映射到 [0,1] 的归一热度分，供 service 先评分、再排序、后截断。
 *
 * 评分合同（详见 PRD-HOT-TOPICS-HEAT-RANKING）：
 *   1. 渠道内归一（heatNorm）：同渠道条目 hotValue 取 log10 压缩后做 min-max 百分位映射到 [0,1]；
 *      单条或全同值 → 无分布信息视为无效（-1），与缺失一样退化用名次分（榜首仍满分、榜尾不虚高）。
 *   2. 名次兜底（rankNorm）：1 - (rank-1)/maxRankInChannel，榜单越靠前越接近 1；
 *      取 base = max(heatNorm, rankNorm)，保证缺 hotValue 的榜首不因字段缺失得 0。
 *   3. 渠道权重（weight）：CHANNEL_WEIGHTS[channel]，国民级综合榜=1.0，垂类/镜像榜<1，
 *      未登记渠道用 DEFAULT_WEIGHT。可经 deps.channelWeights 覆盖（P2 配置化）。
 *   4. 多榜加权（sourceBonus）：α·log2(sourceCount)，sourceCount=去重来源渠道数（mergedFrom+1），
 *      跨榜同现是最客观的"全民热点"信号，无需主观权重。α=SOURCE_BONUS_ALPHA。
 *   5. 时间衰减（decay）：半衰期 HALF_LIFE_MS 的指数衰减 2^(-age/H)，age=now-fetchedAt；
 *      跨轮保留的陈旧条目自然下沉。可经 deps.halfLifeMs 覆盖（P2 配置化）。
 *   最终：score = clamp01((base·weight + sourceBonus) · decay)。
 */

/** 国民级综合榜 1.0；垂类/镜像榜降权，避免单一小圈层或镜像源挤占全民热点位次 */
const CHANNEL_WEIGHTS = {
  weibo: 1.0,
  baidu: 1.0,
  douyin: 1.0,
  toutiao: 1.0,
  zhihu: 1.0,
  tencent: 0.95,
  tophub: 0.9, // 微博镜像，降权防重复计权
  bilibili: 0.85,
  sina_finance: 0.8,
  ithome_tech: 0.8,
}
const DEFAULT_WEIGHT = 0.9

/** 多榜加权系数：sourceCount=2 → +0.12，=4 → +0.24（log2 增长，抑制同源刷量） */
const SOURCE_BONUS_ALPHA = 0.12

/**
 * 主分离度上限：base·weight·decay ∈ [0,1]，乘 HEADROOM(0.9) 后顶部预留 ~0.1 给多榜加成，
 * 避免各渠道榜首都顶到 1.0 再 clamp 使多榜/热度信号被削平失去区分度。
 */
const HEADROOM = 0.9

/** 热度半衰期（毫秒）：热搜生命周期经验值 6h；age 翻倍则衰减到平方 */
const HALF_LIFE_MS = 6 * 60 * 60 * 1000

/** log10 压缩，abs 保护非正/非法值 */
function logNorm(v) {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? Math.log10(n + 1) : 0
}

function clamp01(x) {
  if (!Number.isFinite(x)) return 0
  return x < 0 ? 0 : x > 1 ? 1 : x
}

/**
 * 计算一批条目的统一热度分（就地写回 score / sourceCount，返回按分降序的新数组副本）。
 * @param {Array<{channel:string,rank:number,hotValue?:number|null,fetchedAt?:number,mergedFrom?:string[],categories?:string[],category?:string}>} topics
 * @param {{now?:number, channelWeights?:Record<string,number>, halfLifeMs?:number}} [opts]
 * @returns {Array<object>} 新数组（同引用对象，已写 score/sourceCount），score 降序 + 确定性 tie-break
 */
function scoreTopics(topics, opts = {}) {
  if (!Array.isArray(topics) || topics.length === 0) return []
  const now = typeof opts.now === 'number' ? opts.now : Date.now()
  // 覆盖采用合并语义（评审 m-1）：未列渠道保持内置值，非法项（非有限正数）逐项丢弃
  const override = opts.channelWeights && typeof opts.channelWeights === 'object' && !Array.isArray(opts.channelWeights)
    ? Object.fromEntries(Object.entries(opts.channelWeights).filter(([, v]) => Number.isFinite(v) && v > 0))
    : {}
  const weights = Object.assign({}, CHANNEL_WEIGHTS, override)
  const halfLife = typeof opts.halfLifeMs === 'number' && opts.halfLifeMs > 0 ? opts.halfLifeMs : HALF_LIFE_MS

  // 第一遍：按渠道统计 log 域 min/max 与最大名次（供归一化与名次兜底）
  /** @type {Map<string,{min:number,max:number,maxRank:number}>} */
  const stat = new Map()
  for (const t of topics) {
    const ch = t.channel || 'unknown'
    let s = stat.get(ch)
    if (!s) { s = { min: Infinity, max: -Infinity, maxRank: 0 }; stat.set(ch, s) }
    const lv = logNorm(t.hotValue)
    if (lv > 0) {
      if (lv < s.min) s.min = lv
      if (lv > s.max) s.max = lv
    }
    const r = Number(t.rank) || 1
    if (r > s.maxRank) s.maxRank = r
  }

  for (const t of topics) {
    const ch = t.channel || 'unknown'
    const s = stat.get(ch) || { min: 0, max: 0, maxRank: 1 }
    // 1) 渠道内 log 百分位归一（缺 hotValue 的条目 heatNorm=−1 表示"无有效热度"，交由名次兜底）
    const lv = logNorm(t.hotValue)
    let heatNorm
    if (lv <= 0 || !Number.isFinite(s.min)) {
      heatNorm = -1
    } else if (s.max - s.min < 1e-9) {
      heatNorm = -1 // 渠道内全同值/单条 → 热度无分布信息，交名次兜底（防榜尾孤条得假满分）
    } else {
      heatNorm = (lv - s.min) / (s.max - s.min)
    }
    // 2) 名次兜底：rank 1 → ~1，末位 → ~0
    const maxRank = Math.max(s.maxRank, 1)
    const rankNorm = clamp01(1 - ((Number(t.rank) || 1) - 1) / maxRank)
    const base = Math.max(heatNorm, rankNorm)
    // 3) 多榜加权：去重来源渠道数 = 主渠道 + mergedFrom（不含自身）
    const srcSet = new Set([ch].concat(Array.isArray(t.mergedFrom) ? t.mergedFrom : []))
    const sourceCount = srcSet.size
    t.sourceCount = sourceCount
    const sourceBonus = SOURCE_BONUS_ALPHA * Math.log2(Math.max(sourceCount, 1))
    // 4) 渠道权重
    const weight = typeof weights[ch] === 'number' ? weights[ch] : DEFAULT_WEIGHT
    // 5) 时间衰减
    const fa = Number(t.fetchedAt)
    const age = Number.isFinite(fa) && fa > 0 ? Math.max(0, now - fa) : 0
    const decay = Math.pow(2, -age / halfLife)
    t.score = clamp01(base * weight * decay * HEADROOM + sourceBonus)
  }

  // 排序：score 降序；确定性 tie-break（名次升序 → 渠道名升序 → id 升序）避免同分抖动
  const out = topics.slice().sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    const ra = Number(a.rank) || 1, rb = Number(b.rank) || 1 // 缺 rank 视同榜首，与评分侧 || 1 口径一致（评审 m-3）
    if (ra !== rb) return ra - rb
    const ca = a.channel || '', cb = b.channel || ''
    if (ca !== cb) return ca < cb ? -1 : 1
    const ia = a.id || '', ib = b.id || ''
    return ia < ib ? -1 : ia > ib ? 1 : 0
  })
  // 统一名次（视图序号真源）
  out.forEach((t, i) => { t.viewRank = i + 1 })
  return out
}

/**
 * 计算趋势标记：与上一轮缓存的名次对比。
 * @param {Array<object>} sorted 本轮已排序条目（含 viewRank）
 * @param {Array<object>} prevTopics 上一轮缓存 topics（可能未排序，按数组序视为上轮名次）
 * @returns {Array<object>} 就地写 trend: 'up'|'down'|'new'|'flat'，返回 sorted
 */
function markTrend(sorted, prevTopics, opts = {}) {
  const riseBand = typeof opts.riseBand === 'number' ? opts.riseBand : 3
  if (!Array.isArray(sorted)) return sorted
  const prevIndex = new Map()
  if (Array.isArray(prevTopics)) {
    prevTopics.forEach((t, i) => {
      // 跨轮 id 不稳定（渠道:名次 组合会变），优先用选题文本匹配
      const k = t && (String(t.topic || '').trim() || String(t.id || ''))
      if (k) prevIndex.set(k, i + 1)
    })
  }
  for (const t of sorted) {
    const k = String(t.topic || '').trim() || String(t.id || '')
    const prev = prevIndex.get(k)
    if (prev === undefined) {
      t.trend = prevTopics && prevTopics.length ? 'new' : null
      continue
    }
    const diff = prev - (t.viewRank || prev) // 正=名次上升
    t.trend = diff >= riseBand ? 'up' : diff <= -riseBand ? 'down' : 'flat'
  }
  return sorted
}

module.exports = {
  scoreTopics,
  markTrend,
  logNorm,
  clamp01,
  CHANNEL_WEIGHTS,
  DEFAULT_WEIGHT,
  SOURCE_BONUS_ALPHA,
  HEADROOM,
  HALF_LIFE_MS,
}
