'use strict'
/**
 * 刀 4 · tasks 4.4b 第②项：单集 `compliance` 三态标记（完整合同见 PRD §8.2）。
 *
 * 这是一条**旁路**：只读重跑一次引擎校验，把结论追加成 `compliance` 键。
 * 四条不可让：
 * 1. **判据不在本层重写**：唯一实现是 `@multi-publish/shared-utils/src/podcast-rss` 的
 *    `validateEpisode`（§8.2.1）。本层一个 `EPISODE_*` 码字面量都不写——写了就是第二份判据，
 *    两处必漂移，漂移的症状是「界面说不合规、保存却通过」。结构锁见同目录测试 L5。
 * 2. **`stock` 只看凭据**：`mimeSource === STOCK_SOURCE` **且** index 的 `stockStamp.at` 在位，
 *    缺一就不判 stock。「时间戳看起来很旧」不是来源证据——形态猜来源是本仓反复记过的错法（L4）。
 *    `STOCK_SOURCE` 的取值与固化层 `podcast-episode-stock-mime.js` 同源（QM-6 前端评审点名此处）。
 * 3. **不得毁掉主路，也不得伪造主路**：校验器抛错只把那一期标 invalid 并出声（§8.2.3 行 2）；
 *    组装异常由调用方兜住、回落成不带该键的原返回（行 4）。非对象元素**原样透传**——把 `null`
 *    映射成 `{compliance}` 是在列表里凭空造一条渲染行，那是"不丢期"的反面（QM-6 前端评审命中）。
 * 4. **合格与否只信引擎的判定**：`state=ok` 只由 `res.ok === true` 得出，不用「有没有编码原因」
 *    反推（那样会把「引擎说不合格但没给码」读成合格）。引擎给出不合格却没编码原因时，
 *    落 `FALLBACK_REASON_CODE`——它与"校验器炸了"共用同一个兜底码，语义都是**本层无法据实编码原因**。
 */
const path = require('node:path')

const { validateEpisode: engineValidateEpisode } = require('@multi-publish/shared-utils/src/podcast-rss')

/** 闭集：出现第四个值即视为合同被破坏（§8.2.2「枚举外即抛」）。 */
const COMPLIANCE_STATES = ['ok', 'invalid', 'stock']
/**
 * 与固化层**同一个常量**（QM-6 后端评审 W1：本层再写一份 `'stock'` 就是第二份真源）。
 * 症状不是编译错而是静默失配：固化层哪天改成 'stocked'，本层的 `mimeSource === 'stock'` 永假
 * ⇒ 存量单集整批被当成无凭据重跑引擎、可能全翻 invalid，正是 §7.9 要避免的那件事。
 */
const { STOCK_SOURCE } = require('./podcast-episode-stock-mime')
/** 引擎判不合格却没给编码原因、或校验器自身抛错时的兜底码（IPC 域既有码，渲染层取得到文案）。 */
const FALLBACK_REASON_CODE = 'PODCAST_EPISODE_INVALID'

const INDEX_FILE = 'index.json'

function defaultNow () {
  return new Date().toISOString()
}

/** 闭集出口：任何档位改动都必须同时改 §8.2.2，否则这里抛，而不是把第四态静默发给界面。 */
function finalize (c) {
  if (!COMPLIANCE_STATES.includes(c.state)) {
    const e = new Error('compliance.state 越出闭集：' + String(c.state))
    e.code = FALLBACK_REASON_CODE
    throw e
  }
  return c
}

/**
 * 单期判定。只读传入对象，绝不改写它（列表里的对象是服务层的真源快照，写脏就等于写盘）。
 * @param {object} p
 * @param {any} p.episode
 * @param {string|null} [p.stockStamp] index.json 的 stockStamp.at
 * @param {Function} [p.validateEpisode] 引擎判据，默认真实现
 * @param {number} [p.index]
 * @param {() => string} [p.now]
 */
function buildCompliance (p) {
  const episode = p.episode
  const stamp = typeof p.stockStamp === 'string' && p.stockStamp ? p.stockStamp : null
  const v = typeof p.validateEpisode === 'function' ? p.validateEpisode : engineValidateEpisode
  const now = typeof p.now === 'function' ? p.now : defaultNow

  if (episode && typeof episode === 'object' && episode.mimeSource === STOCK_SOURCE && stamp) {
    // 存量沿用：没有「重跑」这件事，checkedAt 留空串——填时刻等于谎称校验过
    return finalize({ state: 'stock', reasons: [], checkedAt: '' })
  }

  let res
  try {
    res = v(episode, typeof p.index === 'number' ? p.index : 0)
  } catch (e) {
    // 校验器抛错不算「没有结论」：这一期如实标不合规，其余各期照常判
    return finalize({ state: 'invalid', reasons: [FALLBACK_REASON_CODE], checkedAt: now() })
  }
  const issues = res && Array.isArray(res.issues) ? res.issues : []
  const reasons = issues
    .map((it) => (it && typeof it.code === 'string' ? it.code.trim() : ''))
    .filter((c) => c.length > 0)
  if (res && res.ok === true) return finalize({ state: 'ok', reasons: [], checkedAt: now() })
  return finalize({
    state: 'invalid',
    reasons: reasons.length ? reasons : [FALLBACK_REASON_CODE],
    checkedAt: now(),
  })
}

/**
 * 逐期追加 `compliance`（键追加在末尾；数组长度与顺序不变；非对象元素原样透传）。
 * @param {object} p
 * @param {any[]} p.episodes
 * @param {string|null} [p.stockStamp]
 * @param {string} [p.channelId] 只用于日志定位，不进返回值
 */
function annotateEpisodes (p) {
  const episodes = Array.isArray(p.episodes) ? p.episodes : []
  const log = p.logger || { warn () {} }
  let uncoded = 0
  let foreign = 0
  const out = episodes.map((episode, i) => {
    if (!episode || typeof episode !== 'object') {
      foreign++
      return episode
    }
    const compliance = buildCompliance({
      episode,
      stockStamp: p.stockStamp,
      validateEpisode: p.validateEpisode,
      index: i,
      now: p.now,
    })
    if (compliance.state === 'invalid' && compliance.reasons.length === 1 && compliance.reasons[0] === FALLBACK_REASON_CODE) uncoded++
    return Object.assign({}, episode, { compliance })
  })
  // 日志只记频道与计数：这里流过的是用户尚未发布的标题，不得进日志（AGENTS：logger 只脱敏凭证不够）
  if ((uncoded > 0 || foreign > 0) && typeof log.warn === 'function') {
    log.warn('[podcast-compliance] channel=' + String(p.channelId || '') +
      ' 无法据实编码原因期数=' + uncoded + '/' + out.length +
      ' 非对象元素原样透传=' + foreign)
  }
  return out
}

/**
 * 从 index.json 读 `stockStamp.at`。读不到一律返回 null——本层不猜来源。
 * 与固化宿主同用 registry 的 `resolveRoot()`，不再开第二条找路径的路（两处判路径必漂移）。
 */
function readStockStamp (p) {
  const registry = p && p.registry
  const fsImpl = p.fsImpl || require('node:fs')
  const log = p.logger || { warn () {} }
  if (!registry || typeof registry.resolveRoot !== 'function') return null
  let file
  try {
    file = path.join(String(registry.resolveRoot()), INDEX_FILE)
  } catch (e) {
    return null
  }
  try {
    if (!fsImpl.existsSync(file)) return null
    const index = JSON.parse(fsImpl.readFileSync(file, 'utf8'))
    const at = index && index.stockStamp && index.stockStamp.at
    return typeof at === 'string' && at ? at : null
  } catch (e) {
    if (typeof log.warn === 'function') log.warn('[podcast-compliance] index 读取失败，本列表不判存量档：' + e.message)
    return null
  }
}

module.exports = { annotateEpisodes, buildCompliance, readStockStamp }
module.exports.COMPLIANCE_STATES = COMPLIANCE_STATES
module.exports.STOCK_SOURCE = STOCK_SOURCE
module.exports.FALLBACK_REASON_CODE = FALLBACK_REASON_CODE
