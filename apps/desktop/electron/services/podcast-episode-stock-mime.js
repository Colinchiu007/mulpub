'use strict'
/**
 * 刀 4 · tasks 4.4：存量单集 `mime` 一次性固化（合同见 PRD §7.9）。
 *
 * 为什么需要它：§7.6 的严格校验与 `compliance` 标记上线后，早于严格校验写入的**存量单集**
 * 会被整批读成「不合规」——用户看到的是自己的老节目一夜之间全部 blocked。那是把校验的代价
 * 转嫁给历史数据。固化的动作只做一件事：**按事实把"未填"变成"派生"**，既不重探测也不猜。
 *
 * 四条不可让（逐条对应一种"看起来正常工作"的静默失真）：
 * 1. **只补不改**：合法值原样保留、一个字节都不改；不重排数组顺序、不改键序。键序变化会把
 *    一次补字段伪装成整文件重写，并让并发写者读到错位快照。
 * 2. **不猜**：扩展名派生不出就保持原状并计入 `unresolved`。填一个看起来合理的默认值，等于
 *    给用户一条假证据，且让「没查到」与「查到是 mp3」在数据里无法区分。
 * 3. **容器判据只有那一份**：合法 `mime` 集与扩展名映射**由抽取层的编码计划表派生**
 *    （`ttsAudioContainers()` 一等导出；2026-10-12 QM-6 前端评审后，从"喂单一编码器清单反推"改成直读表），本文件不写第二份字面量集合。
 * 4. **恰好一次且幂等**：`stockStamp` 在位即不再改写；重跑必须 `filled=0` 且字节不变。
 *
 * 本层不 require provider / 不起进程 / 不读用户目录——全部经 `deps` 注入，因此测试里
 * 可以用真实 `fs` + `os.tmpdir()` 做「关闭再重开同一文件」的往返（合同 §7.9.5 第 1 条）。
 */
const { ttsAudioContainers } = require('./podcast-episode-source')

const STOCK_SOURCE = 'stock'
const MEASURED_SOURCE = 'measured'

/**
 * 从**唯一真源**取 `ext -> mime` 映射：分别只喂一种编码器，拿到两条计划。
 * 不写第二份表——新增容器时只可能在这里同步（源里加了第三条，这里自动多一条）。
 */
function stockMimeTable () {
  // 直接读源层的容器表导出，不再"喂假编码器清单"去反推——那是把选型 API 当字典用，
  // 源层一改判据顺序这里就会静默少一条（2026-10-12 QM-6 前端评审命中）。
  const plans = ttsAudioContainers()
  const byExt = new Map()
  const legal = new Set()
  for (const p of plans) {
    legal.add(p.mime)
    byExt.set(p.ext.toLowerCase(), p.mime)
  }
  // `.aac` 是存量里常见的裸扩展名，容器仍是 mp4；这条映射不属于编码计划表，显式声明并在此注释定位。
  byExt.set('.aac', byExt.get('.m4a'))
  return { byExt, legal, sources: plans.map((p) => p.codec) }
}

/** 取扩展名：先剥 query/fragment，再取末段（真实 URL 常带 `?sig=...`）。 */
function extOf (url) {
  const s = String(url || '')
  if (!s) return ''
  const clean = s.split('?')[0].split('#')[0]
  const dot = clean.lastIndexOf('.')
  if (dot < 0 || clean.length - dot > 6) return ''
  return clean.slice(dot).toLowerCase()
}

/**
 * 对**一份 episodes 数组**做派生（纯函数，无 IO）。
 * @returns {{episodes:Array, scanned:number, filled:number, unresolved:number, changed:boolean}}
 */
function freezeStockMimeInArray (episodes, opts = {}) {
  const { byExt, legal } = opts.table || stockMimeTable()
  const list = Array.isArray(episodes) ? episodes : []
  let filled = 0
  let unresolved = 0
  let changed = false
  const next = list.map((raw) => {
    if (raw == null || typeof raw !== 'object') return raw
    const ep = raw
    const current = typeof ep.mime === 'string' ? ep.mime.trim() : ''
    if (legal.has(current)) {
      // 合法：一个字节都不改（连 mimeSource 都不补——补它就是"改"）。
      return ep
    }
    const derived = byExt.get(extOf(ep.enclosureUrl || ep.url || ep.localPath || ep.path))
    if (!derived) {
      unresolved++
      return ep
    }
    filled++
    changed = true
    // 键序沿用原对象的插入顺序：只追加/覆盖 mime 与 mimeSource 两个键。
    return Object.assign({}, ep, { mime: derived, mimeSource: STOCK_SOURCE })
  })
  return { episodes: next, scanned: list.length, filled, unresolved, changed }
}

/**
 * 一次性固化：遍历各频道的 episodes 文件 + 在 index 上落 `stockStamp`。
 *
 * `deps`（全部必填，缺席即抛 `PODCAST_EPISODE_INVALID`）：
 * - `listChannels()` → `[{ channelId, episodesFile }]`（**目录布局由宿主决定**，本层不假设按频道分文件还是单文件）
 * - `readEpisodes(episodesFile)` → `{ version, episodes }` | null（读不出由本层按 §7.9.3 跳过该频道）
 * - `writeEpisodes(episodesFile, store)` → 落盘（宿主负责原子替换；失败即抛，本层不重试）
 * - `readIndex()` / `writeIndex(index)` → `index.json` 侧的 `stockStamp`
 * - `withChannelLock(channelId, fn)` → 必须用 §7.7 那把按 channelId 的串行锁，本层不新造
 */
async function freezeStockMime (deps = {}) {
  const log = deps.logger || { info () {}, warn () {}, error () {} }
  const need = ['listChannels', 'readEpisodes', 'writeEpisodes', 'readIndex', 'writeIndex', 'withChannelLock']
  for (const k of need) {
    if (typeof deps[k] !== 'function') {
      const e = new Error('存量固化必须注入 ' + k + '（缺一个都不许默认读写真实目录）')
      e.code = 'PODCAST_EPISODE_INVALID'
      throw e
    }
  }

  const index = deps.readIndex() || {}
  if (index.stockStamp && index.stockStamp.at) {
    log.info('[podcast-stock] 已固化于 ' + index.stockStamp.at + '，本次不重复改写')
    return Object.assign({ skipped: true }, index.stockStamp)
  }

  const table = stockMimeTable()
  let scanned = 0
  let filled = 0
  let unresolved = 0
  let channels = 0
  const unresolvedChannels = []

  for (const ch of deps.listChannels()) {
    const channelId = ch && ch.channelId
    if (!channelId) { unresolvedChannels.push(String(ch && ch.channelId)); continue }
    let one
    try {
      one = await deps.withChannelLock(channelId, 'stock-mime-freeze', async () => {
        const store = deps.readEpisodes(ch.episodesFile)
        const list = store && Array.isArray(store.episodes) ? store.episodes : null
        if (!list) return { scanned: 0, filled: 0, unresolved: 0, changed: false }
        const r = freezeStockMimeInArray(list, { table })
        if (r.changed) deps.writeEpisodes(ch.episodesFile, Object.assign({}, store, { episodes: r.episodes }))
        return r
      })
    } catch (e) {
      // §7.9.3：单频道读不出/解析失败 ⇒ 跳过该频道，其余照常，且只 warn 不冒泡。
      log.warn('[podcast-stock] 频道 ' + channelId + ' 固化跳过：' + ((e && e.message) || String(e)))
      unresolvedChannels.push(channelId)
      continue
    }
    channels++
    scanned += one.scanned
    filled += one.filled
    unresolved += one.unresolved
  }

  const stamp = {
    at: new Date().toISOString(),
    channels,
    scanned,
    filled,
    unresolved,
    unresolvedChannels,
    source: table.sources.join('/'),
  }
  deps.writeIndex(Object.assign({}, index, { stockStamp: stamp }))
  log.info('[podcast-stock] 固化完成 channels=' + channels + ' scanned=' + scanned
    + ' filled=' + filled + ' unresolved=' + unresolved + ' skippedChannels=' + unresolvedChannels.length)
  return Object.assign({ skipped: false }, stamp)
}

module.exports = {
  STOCK_SOURCE,
  MEASURED_SOURCE,
  stockMimeTable,
  extOf,
  freezeStockMimeInArray,
  freezeStockMime,
}
