// @ts-check
/**
 * quick-collect-materials — 检索素材的合并 / 去重 / 时间窗口 / 协议判据 / 排序
 *
 * 这一层是「结论有没有据」的唯一闸门，四条不可省：
 *   ① 协议判据：素材 url 一律过共享 `safeHttpUrl`（渲染端会把 sourceUrl 落进历史与 IPC，
 *      脏 url 不进库 —— 与 AGENTS.md 的 href scheme guard 同族，判据只有一份实现）；
 *   ② 时间窗口：`windowHours > 0` 时只看窗口内的素材，**缺时间戳的一律丢弃**
 *      （无法证明"最近"，留着就等于把旧闻当新闻）；
 *   ③ url 去重：保留 engagement 更高者（同一条新闻在三个源出现时不该占三行）；
 *   ④ 排序截断：engagement 倒序取前 N 条进提示词，避免把整个列表灌进 token 预算。
 *
 * 全部纯函数：判定只看入参，零网络、零时钟直读（`now` 由调用方注入）。
 */
const { safeHttpUrl } = require('@multi-publish/shared-utils/src/safe-http-url')

/** 进提示词的素材条数上限 */
const MATERIAL_LIMIT = 12
/** 单条素材标题 / 摘要的截断长度 */
const TITLE_MAX = 300
const SNIPPET_MAX = 200

/**
 * 归一单条素材。
 * @param {unknown} raw
 * @param {{ windowHours: number, now: number }} ctx  now = epoch 毫秒
 * @returns {{ ok: true, material: object } | { ok: false, reason: string }}
 */
function normalizeMaterial (raw, ctx) {
  const src = raw && typeof raw === 'object' ? /** @type {Record<string, any>} */ (raw) : null
  if (!src) return { ok: false, reason: 'invalid_shape' }

  const url = safeHttpUrl(src.url)
  if (!url) return { ok: false, reason: 'invalid_url' }

  const title = String(src.title == null ? '' : src.title).trim()
  if (!title) return { ok: false, reason: 'missing_title' }

  const windowHours = Number(ctx && ctx.windowHours) || 0
  const now = Number(ctx && ctx.now) || Date.now()
  const createdRaw = Number(src.created_utc)
  let createdUtc = Number.isFinite(createdRaw) && createdRaw > 0 ? createdRaw : null
  if (windowHours > 0) {
    if (createdUtc === null) return { ok: false, reason: 'missing_time' }
    const cutoff = (now - windowHours * 3600 * 1000) / 1000
    if (createdUtc < cutoff) return { ok: false, reason: 'out_of_window' }
    // 未来时间戳（源侧时钟漂移/脏数据）同样不可信：超过 now + 1 天即丢弃
    if (createdUtc > (now / 1000) + 86400) return { ok: false, reason: 'future_time' }
  }

  const engagement = Number(src.engagement)
  const snippet = String(src.snippet == null ? '' : src.snippet).trim().slice(0, SNIPPET_MAX)

  return {
    ok: true,
    material: {
      url,
      title: title.slice(0, TITLE_MAX),
      source: String(src.source == null ? '' : src.source),
      snippet,
      engagement: Number.isFinite(engagement) ? engagement : 0,
      createdUtc,
    },
  }
}

/**
 * 合并多源检索结果 → 进提示词的素材列表 + 丢弃原因计数。
 * @param {unknown[]} items 原始检索结果（多关键词结果应当先拼接再传入，本函数自行去重）
 * @param {{ windowHours?: number, now?: number, limit?: number }} [opts]
 * @returns {{ materials: object[], dropped: Record<string, number>, droppedTotal: number }}
 */
function mergeMaterials (items, opts = {}) {
  const windowHours = Number(opts.windowHours) || 0
  const now = Number(opts.now) || Date.now()
  const limit = Number.isFinite(opts.limit) && opts.limit > 0 ? opts.limit : MATERIAL_LIMIT

  const dropped = Object.create(null)
  /** @type {Map<string, object>} */
  const byUrl = new Map()

  // 先按原始 url 去重再归一：同一关键词的多轮检索（或同一素材被多个关键词命中）会把同一条
  // 素材送进来多次，若逐条归一，`dropped` 会把同一条脏数据重复计数（实测 2 个关键词命中
  // 同一条非法素材时报 dropped=2，看起来像两个问题）。
  /** @type {Map<string, object>} */
  const uniqueRaw = new Map()
  for (const item of Array.isArray(items) ? items : []) {
    const raw = item && typeof item === 'object' ? /** @type {Record<string, any>} */ (item) : null
    if (!raw) {
      dropped.invalid_shape = (dropped.invalid_shape || 0) + 1
      continue
    }
    const key = String(raw.url == null ? '' : raw.url)
    const prev = uniqueRaw.get(key)
    const eng = Number(raw.engagement)
    if (!prev || (Number.isFinite(eng) ? eng : 0) > (Number.isFinite(Number(prev.engagement)) ? Number(prev.engagement) : 0)) {
      uniqueRaw.set(key, raw)
    }
  }

  for (const item of uniqueRaw.values()) {
    const res = normalizeMaterial(item, { windowHours, now })
    if (!res.ok) {
      dropped[res.reason] = (dropped[res.reason] || 0) + 1
      continue
    }
    const prev = byUrl.get(res.material.url)
    if (!prev || res.material.engagement > prev.engagement) {
      byUrl.set(res.material.url, res.material)
    }
  }

  const materials = [...byUrl.values()]
    .sort((a, b) => (b.engagement - a.engagement) || (b.createdUtc || 0) - (a.createdUtc || 0))
    .slice(0, limit)

  let droppedTotal = 0
  for (const k of Object.keys(dropped)) droppedTotal += dropped[k]

  return { materials, dropped, droppedTotal }
}

/**
 * 检索三态（PRD §6.2）：素材有没有、检索跑没跑。
 *   - `skipped`：指令没配关键词 ⇒ 根本没联网检索；
 *   - `empty`  ：跑了但一条可用素材都没有；
 *   - `partial`：有素材，但至少有一个关键词/源档次的查询失败；
 *   - `ok`     ：有素材且无失败查询。
 * @param {{ queryCount: number, materialCount: number, failedQueries?: number }} input
 * @returns {'ok'|'partial'|'empty'|'skipped'}
 */
function summarizeRetrieval (input) {
  const queryCount = Number(input && input.queryCount) || 0
  const materialCount = Number(input && input.materialCount) || 0
  const failedQueries = Number(input && input.failedQueries) || 0
  if (queryCount <= 0) return 'skipped'
  if (materialCount <= 0) return 'empty'
  return failedQueries > 0 ? 'partial' : 'ok'
}

module.exports = {
  MATERIAL_LIMIT,
  TITLE_MAX,
  SNIPPET_MAX,
  normalizeMaterial,
  mergeMaterials,
  summarizeRetrieval,
}
