// @ts-check
'use strict'
/**
 * shot-duration — 单镜时长推算与来源优先级（v7 批次一 F2 + F34）
 *
 * 解决的问题（研究报告 §3.20 结论 4）：
 *   mulpub 原先只有全局三档 AUTO_SHOT_SECONDS=[5,8,10] 撑所有镜头，
 *   「台词 8 个字」与「台词 80 个字」拿到同一个时长。实测四方对照里
 *   mulpub 是唯一完全没有单镜时长维度的实现。
 *
 * 本模块给 Shot 补上 durationMs，并定义**来源优先级链**（高到低）：
 *   user   —— 用户在分镜表里显式设定（最终权威，不再推算）
 *   tts    —— TTS 实测时长（最真实的物理事实）
 *   formula—— 按台词字数与情绪档推算（无 TTS 时的最佳估计）
 *   tier   —— 全局档位默认（兜底，保证永远有值）
 *
 * 为什么是「一个字段 + 一条链」而不是三个功能：
 *   三个来源各自独立实施（TTS 接入、公式、用户设定），但产出统一写到
 *   Shot.durationMs；消费方（plan / render / 剪映导出）只读这一个字段。
 *   于是三者可以任意顺序分批上线，互不阻塞。
 *
 * 纪律：本模块为纯函数 + 零 IO，便于表格化用例覆盖。档位取值域由
 *       film-kit/shot-grammar.json 的 durationTiers 定义，本模块只接受注入。
 */

/** 来源优先级（高 → 低）；同一次解析取最高可用者 */
const DURATION_SOURCES = Object.freeze(['user', 'tts', 'formula', 'tier'])
/** 兜底档位：与 film-kit 默认一致；调用方可经 opts.tiers 覆盖 */
const DEFAULT_TIERS = Object.freeze([5, 8, 10, 12])
/** 单镜时长上限（秒）：超过即必须走长台词拆解，不得直接截断 */
const DEFAULT_MAX_SEC = 12
/** 单镜时长下限（秒）：低于它连一个动作都摆不下 */
const MIN_SHOT_SEC = 1
/** 各情绪档的中文语速（字/秒）；与 shot-grammar.json 的 emotionTiers 同源默认值 */
const ZH_CHARS_PER_SECOND = Object.freeze({ normal: 8, argument: 10, tender: 5 })
/** 英文语速（词/秒）；中文按字、英文按词，两者不可混算 */
const EN_WORDS_PER_SECOND = Object.freeze({ normal: 2.6, argument: 3.4, tender: 1.7 })

/**
 * 统计台词的可发音单位数：中日韩统一表意文字按「字」，其余按「词」。
 * 标点、空白、括号内的舞台提示不计入（它们不占说话时长）。
 * @param {string} text
 * @returns {{cjkChars: number, latinWords: number, total: number}}
 */
function countSpeechUnits (text) {
  const s = typeof text === 'string' ? text : ''
  if (!s.trim()) return { cjkChars: 0, latinWords: 0, total: 0 }
  // 去掉成对括号内的舞台提示（中英文括号与方头括号）
  const stripped = s
    .replace(/[（(【\[][^）)】\]]*[）)】\]]/g, ' ')
    .replace(/\[[^\]]*\]/g, ' ')
  const cjk = stripped.match(/[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/g) || []
  const latin = stripped
    .replace(/[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/g, ' ')
    .match(/[A-Za-z][A-Za-z'’-]*/g) || []
  return { cjkChars: cjk.length, latinWords: latin.length, total: cjk.length + latin.length }
}

/**
 * 把原始秒数向上吸附到最近的支持档位（不向下，避免切掉台词尾部）。
 * 超过最大档时返回最大档，并置 overflow=true 由调用方决定是否拆镜。
 * @param {number} rawSec
 * @param {number[]} [tiers]
 * @returns {{sec: number, overflow: boolean}}
 */
function snapToTier (rawSec, tiers) {
  const list = Array.isArray(tiers) && tiers.length > 0
    ? tiers.map(Number).filter((n) => Number.isFinite(n) && n > 0).sort((a, b) => a - b)
    : DEFAULT_TIERS.slice()
  const raw = Number(rawSec)
  if (!Number.isFinite(raw) || raw <= 0) return { sec: list[0], overflow: false }
  for (const t of list) {
    if (raw <= t) return { sec: t, overflow: false }
  }
  return { sec: list[list.length - 1], overflow: true }
}

/**
 * 按台词字数与情绪档推算单镜时长（F2 主函数）。
 *
 * 这是「无 TTS 时的最佳估计」，不是最终权威——最终以 TTS 实测为准。
 * @param {string} text 台词原文（无台词时可传空串，此时按最小档）
 * @param {string} [emotion] 情绪档 key：normal / argument / tender
 * @param {{tiers?: number[], maxSec?: number, minSec?: number}} [opts]
 * @returns {{ok: true, durationSec: number, durationMs: number, rawSec: number,
 *            source: 'formula', tierSec: number, units: {cjkChars: number, latinWords: number, total: number},
 *            emotion: string, overflow: boolean, warnings: string[]}
 *          | {ok: false, error: string}}
 */
function estimateShotSeconds (text, emotion, opts) {
  const o = opts || {}
  const emo = typeof emotion === 'string' && Object.prototype.hasOwnProperty.call(ZH_CHARS_PER_SECOND, emotion)
    ? emotion
    : 'normal'
  const tiers = Array.isArray(o.tiers) && o.tiers.length > 0 ? o.tiers : DEFAULT_TIERS
  const maxSec = Number.isFinite(Number(o.maxSec)) ? Number(o.maxSec) : DEFAULT_MAX_SEC
  const minSec = Number.isFinite(Number(o.minSec)) ? Number(o.minSec) : MIN_SHOT_SEC

  const units = countSpeechUnits(text)
  const zhRate = ZH_CHARS_PER_SECOND[emo]
  const enRate = EN_WORDS_PER_SECOND[emo]
  // 中英混排时分别按各自语速折算，再相加——单一语速乘总数会系统性低估英文、高估中文
  const zhSec = units.cjkChars > 0 ? units.cjkChars / zhRate : 0
  const enSec = units.latinWords > 0 ? units.latinWords / enRate : 0
  const rawSec = zhSec + enSec

  const warnings = []
  if (units.total === 0) warnings.push('无台词：按最小档处理，建议由画面动作决定时长')
  if (rawSec < minSec && units.total > 0) warnings.push('推算时长低于最小值 ' + minSec + 's，已抬到最小值')
  if (rawSec > maxSec) {
    warnings.push('推算时长 ' + rawSec.toFixed(1) + 's 超过单镜上限 ' + maxSec + 's，必须按 long_dialogue_split 拆解台词，不得截断')
  }

  const effectiveRaw = Math.max(rawSec, units.total > 0 ? minSec : 0)
  const snapped = snapToTier(effectiveRaw, tiers)
  let tierSec = snapped.sec
  if (Number.isFinite(maxSec) && tierSec > maxSec) tierSec = maxSec
  if (snapped.overflow) warnings.push('推算时长超过最大档位，已取 ' + tierSec + 's')

  return {
    ok: true,
    durationSec: tierSec,
    durationMs: Math.round(tierSec * 1000),
    rawSec,
    source: 'formula',
    tierSec,
    units,
    emotion: emo,
    overflow: snapped.overflow,
    warnings,
  }
}

/**
 * 解析单个 Shot 的最终时长（F34 优先级链）。
 *
 * 优先级：user > tts > formula > tier。每一档都要过合法性校验——
 * 非法值不是「跳过继续降级」而是**记一条 warning 后降级**，因为静默降级
 * 会让「用户明明填了 30 秒却被改成 10 秒」这类问题不可见。
 *
 * @param {{durationMs?: unknown, ttsDurationMs?: unknown, userDurationMs?: unknown,
 *          text?: unknown, dialogue?: unknown, emotion?: unknown}} shot
 * @param {{tiers?: number[], maxSec?: number, minSec?: number, defaultSec?: number}} [ctx]
 * @returns {{ok: true, durationMs: number, durationSec: number, source: string, warnings: string[]}}
 *          | {ok: false, error: string}
 */
function resolveShotDurationMs (shot, ctx) {
  const s = shot || /** @type {any} */ ({})
  const c = ctx || {}
  const tiers = Array.isArray(c.tiers) && c.tiers.length > 0 ? c.tiers : DEFAULT_TIERS
  const maxSec = Number.isFinite(Number(c.maxSec)) ? Number(c.maxSec) : DEFAULT_MAX_SEC
  const minSec = Number.isFinite(Number(c.minSec)) ? Number(c.minSec) : MIN_SHOT_SEC
  const warnings = []

  const asPositiveMs = (v) => {
    const n = Number(v)
    if (!Number.isFinite(n) || n <= 0) return null
    return n
  }

  /** 出厂用户态值做一次取值范围收口 */
  const clampMs = (ms, label) => {
    const sec = ms / 1000
    if (sec > maxSec) {
      warnings.push(label + ' ' + sec.toFixed(2) + 's 超过单镜上限 ' + maxSec + 's，已截到上限（请改用拆镜而不是压缩时长）')
      return Math.round(maxSec * 1000)
    }
    if (sec < minSec) {
      warnings.push(label + ' ' + sec.toFixed(2) + 's 低于下限 ' + minSec + 's，已抬到下限')
      return Math.round(minSec * 1000)
    }
    return Math.round(ms)
  }

  // 1) user：显式设定，最终权威
  const userMs = asPositiveMs(s.userDurationMs)
  if (userMs !== null) {
    const ms = clampMs(userMs, '用户设定时长')
    return { ok: true, durationMs: ms, durationSec: ms / 1000, source: 'user', warnings }
  }
  if (s.userDurationMs !== undefined && s.userDurationMs !== null) {
    warnings.push('用户设定时长非法（' + String(s.userDurationMs) + '），降级到下一来源')
  }

  // 2) tts：实测物理事实
  const ttsMs = asPositiveMs(s.ttsDurationMs)
  if (ttsMs !== null) {
    const ms = clampMs(ttsMs, 'TTS 实测时长')
    return { ok: true, durationMs: ms, durationSec: ms / 1000, source: 'tts', warnings }
  }
  if (s.ttsDurationMs !== undefined && s.ttsDurationMs !== null) {
    warnings.push('TTS 实测时长非法（' + String(s.ttsDurationMs) + '），降级到下一来源')
  }

  // 3) formula：按台词推算
  const line = typeof s.dialogue === 'string' && s.dialogue.trim()
    ? s.dialogue
    : (typeof s.text === 'string' ? s.text : '')
  const est = estimateShotSeconds(line, s.emotion, { tiers, maxSec, minSec })
  if (!est.ok) return { ok: false, error: est.error }
  for (const w of est.warnings) warnings.push(w)
  // formula 与 tier 的差别只在「台词是否为空」：有台词就是推算，无台词才退到档位默认
  const hasLine = est.units.total > 0

  if (hasLine) {
    return { ok: true, durationMs: est.durationMs, durationSec: est.durationSec, source: 'formula', warnings }
  }

  // 4) tier：兜底档位默认
  const defaultSec = Number.isFinite(Number(c.defaultSec)) && Number(c.defaultSec) > 0
    ? Number(c.defaultSec)
    : tiers[0]
  const clamped = snapToTier(defaultSec, tiers)
  const sec = Math.min(Math.max(clamped.sec, minSec), maxSec)
  return { ok: true, durationMs: Math.round(sec * 1000), durationSec: sec, source: 'tier', warnings }
}

/**
 * 批量解析一组 Shot 的时长，并汇总来源分布（用于计划阶段的可见性）。
 * @param {Array<any>} shots
 * @param {object} [ctx]
 * @returns {{ok: true, items: Array<any>, distribution: Record<string, number>, totalDurationSec: number, warnings: string[]}
 *          | {ok: false, error: string}}
 */
function resolvePlanDurations (shots, ctx) {
  const list = Array.isArray(shots) ? shots : []
  const items = []
  const distribution = { user: 0, tts: 0, formula: 0, tier: 0 }
  const warnings = []
  let totalMs = 0
  for (let i = 0; i < list.length; i++) {
    const r = resolveShotDurationMs(list[i], ctx)
    if (!r.ok) return { ok: false, error: 'shots[' + i + ']: ' + r.error }
    items.push(r)
    distribution[r.source] = (distribution[r.source] || 0) + 1
    totalMs += r.durationMs
    for (const w of r.warnings) warnings.push('shots[' + i + ']: ' + w)
  }
  return {
    ok: true,
    items,
    distribution,
    totalDurationSec: Math.round(totalMs / 100) / 10,
    warnings,
  }
}

module.exports = {
  DURATION_SOURCES,
  DEFAULT_TIERS,
  DEFAULT_MAX_SEC,
  MIN_SHOT_SEC,
  ZH_CHARS_PER_SECOND,
  EN_WORDS_PER_SECOND,
  countSpeechUnits,
  snapToTier,
  estimateShotSeconds,
  resolveShotDurationMs,
  resolvePlanDurations,
}
