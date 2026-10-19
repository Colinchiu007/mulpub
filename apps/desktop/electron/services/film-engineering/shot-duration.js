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
/** 吸附容差（秒）：raw 只超出档位不到该值时仍取该档，避免一字之差跳三秒（v7 对抗评审 i5） */
const DEFAULT_SNAP_TOLERANCE_SEC = 0.3
/** 各情绪档的中文语速（字/秒）；与 shot-grammar.json 的 emotionTiers 同源默认值 */
const ZH_CHARS_PER_SECOND = Object.freeze({ normal: 8, argument: 10, tender: 5 })
/** 英文语速（词/秒）；中文按字、英文按词，两者不可混算 */
const EN_WORDS_PER_SECOND = Object.freeze({ normal: 2.6, argument: 3.4, tender: 1.7 })

/**
 * 统计台词的可发音单位数：汉字按「字」，拉丁字母词按「词」。
 * 标点、空白、括号内的舞台提示不计入（它们不占说话时长）。
 *
 * **日文假名与韩文谚文刻意不计入**（v7 对抗评审 i8）：语速档（8/10/5 字每秒）是用中文
 * 语料标定的，把假名/谚文当成汉字折算会系统性低估日韩文案时长。当前产品只做中英，
 * 故对日韩文本采取「不计入」这个可解释的保守口径——若将来支持日韩，应新增独立语速档，
 * 而不是把字符集扩回来。
 * @param {string} text
 * @returns {{cjkChars: number, latinWords: number, total: number, excludedKanaHangul: number}}
 */
/**
 * 合并语速档：注入值优先，非法项忽略并保留内置默认。
 * @param {Record<string, number>} base
 * @param {any} injected
 * @returns {Record<string, number>}
 */
function mergeRates (base, injected) {
  if (!injected || typeof injected !== 'object') return base
  const out = Object.assign({}, base)
  for (const key of Object.keys(base)) {
    const n = Number(injected[key])
    if (Number.isFinite(n) && n > 0) out[key] = n
  }
  return out
}

function countSpeechUnits (text) {
  const s = typeof text === 'string' ? text : ''
  if (!s.trim()) return { cjkChars: 0, latinWords: 0, total: 0, excludedKanaHangul: 0 }
  // 去掉成对括号内的舞台提示（中英文括号与方头括号）
  const stripped = s
    .replace(/[（(【[][^）)】\]]*[）)】\]]/g, ' ')
    .replace(/\[[^\]]*\]/g, ' ')
  const HAN = /[\u4e00-\u9fff]/g
  const KANA_HANGUL = /[\u3040-\u30ff\uac00-\ud7af]/g
  const cjk = stripped.match(HAN) || []
  const excludedKanaHangul = (stripped.match(KANA_HANGUL) || []).length
  const latin = stripped
    .replace(HAN, ' ')
    .replace(KANA_HANGUL, ' ')
    .match(/[A-Za-z][A-Za-z'’-]*/g) || []
  return { cjkChars: cjk.length, latinWords: latin.length, total: cjk.length + latin.length, excludedKanaHangul }
}

/**
 * 从剧本段落里挑出**真正会被念出来**的部分。
 *
 * 动因（v7 对抗评审 i1）：自动模式原先把整段 beat.text 当台词计时长，而 beat.text
 * 通常同时含动作与环境描述（「他推开门走进屋子」），按 8 字/秒折算会系统性高估时长。
 *
 * 口径：优先取成对引号内的内容（「」『』“”""）；没有引号时退化为整段——
 * 因为自动模式的输入不保证区分台词与动作，此时**宁可高估**（高估只会让镜头变宽裕，
 * 低估会切掉台词）。退化时返回 usedQuotes=false，供调用方在告警里说明。
 * @param {string} text
 * @returns {{dialogue: string, usedQuotes: boolean}}
 */
function extractDialogueText (text) {
  const s = typeof text === 'string' ? text : ''
  if (!s.trim()) return { dialogue: '', usedQuotes: false }
  const quoted = s.match(/[「『“"]([^」』”"]*)[」』”"]/g)
  if (quoted && quoted.length > 0) {
    const dialogue = quoted
      .map((q) => q.slice(1, -1))
      .filter((q) => q.trim())
      .join('\n')
    if (dialogue.trim()) return { dialogue, usedQuotes: true }
  }
  return { dialogue: s, usedQuotes: false }
}

/**
 * 把原始秒数吸附到支持档位。
 *
 * 规则（v7 对抗评审 i5 修订）：
 *   1. **默认不向下吸附**——向下会切掉台词尾部；
 *   2. 但允许 `toleranceSec` 的容差（默认 0.3s）：raw 只超出档位不到一档容差时仍取该档，
 *      避免「40 字→5s、41 字→8s（+60%）」这种一字之差的巨大跳变；
 *   3. 超过最大档返回最大档并置 overflow=true，由调用方决定是否拆镜；
 *   4. **容差只把悬崖挪到 t+tolerance，不消除悬崖**（v7 对抗评审第二轮 i7）：
 *      raw=5.3000 取 5s、raw=5.3001 取 8s。这是刻意接受的取舍——档位是模型的离散能力，
 *      任何「就近取档」都会引入向下取档从而可能截断台词。所以这里不假装连续：
 *      真值由 rawSec / snapDeltaSec 如实回传，调用方要连续量就自己用 rawSec。
 * @param {number} rawSec
 * @param {number[]} [tiers]
 * @param {{toleranceSec?: number}} [opts]
 * @returns {{sec: number, overflow: boolean, toleranceUsed: boolean}}
 */
function snapToTier (rawSec, tiers, opts) {
  const o = opts || {}
  const tolerance = Number.isFinite(Number(o.toleranceSec)) && Number(o.toleranceSec) >= 0
    ? Number(o.toleranceSec)
    : DEFAULT_SNAP_TOLERANCE_SEC
  const list = Array.isArray(tiers) && tiers.length > 0
    ? tiers.map(Number).filter((n) => Number.isFinite(n) && n > 0).sort((a, b) => a - b)
    : DEFAULT_TIERS.slice()
  const raw = Number(rawSec)
  if (!Number.isFinite(raw) || raw <= 0) return { sec: list[0], overflow: false, toleranceUsed: false }
  for (const t of list) {
    if (raw <= t) return { sec: t, overflow: false, toleranceUsed: false }
    if (raw <= t + tolerance) return { sec: t, overflow: false, toleranceUsed: true }
  }
  return { sec: list[list.length - 1], overflow: true, toleranceUsed: false }
}

/**
 * 按台词字数与情绪档推算单镜时长（F2 主函数）。
 *
 * 这是「无 TTS 时的最佳估计」，不是最终权威——最终以 TTS 实测为准。
 * @param {string} text 台词原文（无台词时可传空串，此时按最小档）
 * @param {string} [emotion] 情绪档 key：normal / argument / tender
 * @param {{tiers?: number[], maxSec?: number, minSec?: number, snapToleranceSec?: number}} [opts]
 * @returns {{ok: true, durationSec: number, durationMs: number, rawSec: number,
 *            source: 'formula', tierSec: number, snapDeltaSec: number, toleranceUsed: boolean,
 *            units: {cjkChars: number, latinWords: number, total: number, excludedKanaHangul: number},
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
  const toleranceSec = Number.isFinite(Number(o.snapToleranceSec)) && Number(o.snapToleranceSec) >= 0
    ? Number(o.snapToleranceSec)
    : DEFAULT_SNAP_TOLERANCE_SEC

  // 语速档可经 opts 注入（v7 对抗评审第二轮 i2）。SCHEMA.md 原写「emotionTiers.zhCharsPerSecond
  // 直接驱动时长推算」，但实现只读硬编码常量 —— 改资产语速零生效，属本 PR 自己修的「假同源」同型。
  // 现在：注入优先，缺省回落内置档；注入时只认正数，非法项忽略并保留默认。
  const zhRates = mergeRates(ZH_CHARS_PER_SECOND, o.zhCharsPerSecond)
  const enRates = mergeRates(EN_WORDS_PER_SECOND, o.enWordsPerSecond)

  const units = countSpeechUnits(text)
  const zhRate = zhRates[emo]
  const enRate = enRates[emo]
  // 中英混排时分别按各自语速折算，再相加——单一语速乘总数会系统性低估英文、高估中文
  const zhSec = units.cjkChars > 0 ? units.cjkChars / zhRate : 0
  const enSec = units.latinWords > 0 ? units.latinWords / enRate : 0
  const rawSec = zhSec + enSec

  const warnings = []
  if (units.total === 0) warnings.push('无台词：按最小档处理，建议由画面动作决定时长')
  if (units.excludedKanaHangul > 0) {
    warnings.push('含 ' + units.excludedKanaHangul + ' 个假名/谚文字符未计入语速：当前语速档只用中文标定，日韩文案时长会被低估，请手工设定')
  }
  if (rawSec < minSec && units.total > 0) warnings.push('推算时长低于最小值 ' + minSec + 's，已抬到最小值')
  if (rawSec > maxSec) {
    warnings.push('推算时长 ' + rawSec.toFixed(1) + 's 超过单镜上限 ' + maxSec + 's，必须按 long_dialogue_split 拆解台词，不得截断')
  }

  const effectiveRaw = Math.max(rawSec, units.total > 0 ? minSec : 0)
  const snapped = snapToTier(effectiveRaw, tiers, { toleranceSec })
  let tierSec = snapped.sec
  if (Number.isFinite(maxSec) && tierSec > maxSec) tierSec = maxSec
  if (snapped.overflow) warnings.push('推算时长超过最大档位，已取 ' + tierSec + 's')
  // 吸附落差如实回传：调用方要能看到「4.9s 的内容用了 8s 档位」这类跳变，
  // 而不是只拿到一个档位数字（v7 对抗评审 i5）
  const snapDeltaSec = Math.round((tierSec - rawSec) * 1000) / 1000

  return {
    ok: true,
    durationSec: tierSec,
    durationMs: Math.round(tierSec * 1000),
    rawSec,
    source: 'formula',
    tierSec,
    snapDeltaSec,
    toleranceUsed: snapped.toleranceUsed,
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
 * @param {{tiers?: number[], maxSec?: number, minSec?: number, defaultSec?: number,
 *          snapToleranceSec?: number, dialogueSource?: 'auto'|'verbatim',
 *          zhCharsPerSecond?: Record<string, number>, enWordsPerSecond?: Record<string, number>,
 *          requireQuotedDialogue?: boolean}} [ctx]
 *   dialogueSource='auto'（默认）时，若 shot 只给了 text，会先按引号抽取台词（见 extractDialogueText）；
 *   'verbatim' 表示 shot.dialogue 已是纯台词，不再抽取。
 * @returns {{ok: true, durationMs: number, durationSec: number, source: string,
 *            rawSec?: number, snapDeltaSec?: number, warnings: string[]}}
 *          | {ok: false, error: string}
 */
function resolveShotDurationMs (shot, ctx) {
  const s = shot || /** @type {any} */ ({})
  const c = ctx || {}
  const tiers = Array.isArray(c.tiers) && c.tiers.length > 0 ? c.tiers : DEFAULT_TIERS
  const maxSec = Number.isFinite(Number(c.maxSec)) ? Number(c.maxSec) : DEFAULT_MAX_SEC
  const minSec = Number.isFinite(Number(c.minSec)) ? Number(c.minSec) : MIN_SHOT_SEC
  const toleranceSec = Number.isFinite(Number(c.snapToleranceSec)) && Number(c.snapToleranceSec) >= 0
    ? Number(c.snapToleranceSec)
    : DEFAULT_SNAP_TOLERANCE_SEC
  const dialogueSource = c.dialogueSource === 'verbatim' ? 'verbatim' : 'auto'
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
    return { ok: true, durationMs: ms, durationSec: ms / 1000, source: 'user', rawSec: ms / 1000, snapDeltaSec: 0, warnings }
  }
  if (s.userDurationMs !== undefined && s.userDurationMs !== null) {
    warnings.push('用户设定时长非法（' + String(s.userDurationMs) + '），降级到下一来源')
  }

  // 2) tts：实测物理事实
  const ttsMs = asPositiveMs(s.ttsDurationMs)
  if (ttsMs !== null) {
    const ms = clampMs(ttsMs, 'TTS 实测时长')
    return { ok: true, durationMs: ms, durationSec: ms / 1000, source: 'tts', rawSec: ms / 1000, snapDeltaSec: 0, warnings }
  }
  if (s.ttsDurationMs !== undefined && s.ttsDurationMs !== null) {
    warnings.push('TTS 实测时长非法（' + String(s.ttsDurationMs) + '），降级到下一来源')
  }

  // 3) formula：按台词推算
  // 自动模式下 shot.text 往往是「动作 + 台词」混排，直接整段计时长会高估（v7 对抗评审 i1），
  // 故只在没有显式 dialogue 时按引号抽取真正会被念出来的部分。
  //
  // requireQuotedDialogue（自动模式）时，**没有引号就不算有台词**——退到档位兜底。
  // 否则纯动作镜会被按字/秒折算，120 字动作镜推出 15s 并触发「必须拆解台词」，
  // 而那个镜根本没有台词可拆（v7 对抗评审第二轮 i4）。
  let line = ''
  let usedQuotes = false
  if (typeof s.dialogue === 'string' && s.dialogue.trim()) {
    line = s.dialogue
    usedQuotes = true
  } else if (typeof s.text === 'string' && s.text.trim()) {
    if (dialogueSource === 'verbatim') {
      line = s.text
      usedQuotes = true
    } else {
      const ex = extractDialogueText(s.text)
      line = ex.dialogue
      usedQuotes = ex.usedQuotes
    }
  }
  const requireQuoted = c.requireQuotedDialogue === true
  const lineForTiming = requireQuoted && !usedQuotes ? '' : line
  if (requireQuoted && !usedQuotes && line.trim()) {
    warnings.push('本镜未检出引号台词：按动作描述处理，时长走档位兜底而不是按字/秒折算（若含台词请用「」标注）')
  }
  const est = estimateShotSeconds(lineForTiming, s.emotion, {
    tiers,
    maxSec,
    minSec,
    snapToleranceSec: toleranceSec,
    zhCharsPerSecond: c.zhCharsPerSecond,
    enWordsPerSecond: c.enWordsPerSecond,
  })
  if (!est.ok) return { ok: false, error: est.error }
  for (const w of est.warnings) warnings.push(w)
  // formula 与 tier 的差别只在「台词是否为空」：有台词就是推算，无台词才退到档位默认
  const hasLine = est.units.total > 0

  if (hasLine) {
    return {
      ok: true,
      durationMs: est.durationMs,
      durationSec: est.durationSec,
      source: 'formula',
      rawSec: est.rawSec,
      snapDeltaSec: est.snapDeltaSec,
      warnings,
    }
  }

  // 4) tier：兜底档位默认
  const defaultSec = Number.isFinite(Number(c.defaultSec)) && Number(c.defaultSec) > 0
    ? Number(c.defaultSec)
    : tiers[0]
  const clamped = snapToTier(defaultSec, tiers, { toleranceSec })
  const sec = Math.min(Math.max(clamped.sec, minSec), maxSec)
  return { ok: true, durationMs: Math.round(sec * 1000), durationSec: sec, source: 'tier', rawSec: defaultSec, snapDeltaSec: Math.round((sec - defaultSec) * 1000) / 1000, warnings }
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
  DEFAULT_SNAP_TOLERANCE_SEC,
  ZH_CHARS_PER_SECOND,
  EN_WORDS_PER_SECOND,
  mergeRates,
  countSpeechUnits,
  extractDialogueText,
  snapToTier,
  estimateShotSeconds,
  resolveShotDurationMs,
  resolvePlanDurations,
}
