// @ts-check
'use strict'
/**
 * auto-plan — 自动模式规划层（openspec change: film-auto-mode）
 *
 * 职责（design D8/D10/D11/D26）：把「剧本 + 参考图 + 横竖屏 + 大概时长」这一步人类输入，
 * 变成可执行的分镜计划：
 *   validateAutoInputs → 输入域校验（拒即不落盘，design D22）
 *   planShotCount      → 目标镜数 N = clamp(round(T/s), 1, MAX_AUTO_SHOTS)
 *   splitAutoBeats     → 分场（复用 script-adapt.splitScript 语义）
 *   expandBeatsToCount → **只拆**（K<N 时按句末标点，不丢字）
 *   mergeBeatsToCount  → **只并**（K>N 时相邻合并，不丢字）——与 expand 单向分工，杜绝双重合并（R1-i2）
 *   detectCharacters   → 角色检出（用户标注 > 显式标记 > 对话动词 > 频次；停用词守卫）
 *   buildCharacterMap  → 按频次降序填 ROKO/JAXX/LULU/REIN 槽位
 *   bindReferencePaths → 逐镜参考绑定（人物命中 + 场景轮转；受控根纵深防御；≤2 张）
 *   planAutoShots      → 主入口（提示词复用 kit 模板块结构，绝不新写组装逻辑）
 *   buildShotFingerprint / buildPayloadHash / buildPlanId → 指纹与哈希（归属与审计，D17/D26）
 *
 * 纪律：本模块为纯函数 + 零 IO（不读盘、不调 provider），便于表格化用例覆盖；
 *       所有 provider 调用与落盘一律在 IPC 层（D21：执行不经 pipeline 引擎）。
 */

const crypto = require('crypto')
const os = require('os')
const path = require('path')
const { splitScript, buildTemplatePrompt } = require('./script-adapt')
const { VIDEO_REFERENCE_PARAM_BY_PROVIDER } = require('./video-reference-inputs')
const {
  MAX_CHARACTER_NAME_LENGTH, SLOT_ORDER, STOPWORDS,
  detectCharacters, buildCharacterMap, bindReferencePaths, buildReferenceWarnings,
} = require('./auto-plan-characters')
const {
  sha256, buildShotFingerprint, buildPayloadHash, buildPlanId, buildRefsFingerprint,
} = require('./auto-plan-fingerprint')
const { resolveShotDurationMs } = require('./shot-duration')

const MAX_AUTO_SHOTS = 120
const MAX_AUTO_SCRIPT_LENGTH = 10000
const MIN_AUTO_DURATION_SEC = 10
const MAX_AUTO_DURATION_SEC = 600
const AUTO_ASPECTS = Object.freeze(['16x9', '9x16'])
const AUTO_SHOT_SECONDS = Object.freeze([5, 8, 10])
/** 单镜时长上限（秒）：与 film-kit/shot-grammar.json 的 durationTiers.maxSec 同源口径 */
const MAX_AUTO_SHOT_SEC = 12
const MAX_AUTO_REFS = 8
/** 与 ipc-handlers/film-engineering.js:47-49 同源预估口径 */
const DISK_ESTIMATE_BYTES_PER_SHOT = 8 * 1024 * 1024
const WALLCLOCK_SECONDS_PER_SHOT = 300
const PRODUCTION_BATCH_SIZE = 10
const WALLCLOCK_WARN_SECONDS = 2 * 60 * 60
const MIN_SENTENCE_CHUNK_LENGTH = 2

/** 目标时长 ÷ 单镜秒数 → 目标镜数（四舍五入并 clamp；非法输入回落 1，fail-closed 不抛） */
function planShotCount (targetDurationSec, shotSeconds, opts = {}) {
  const maxShots = Number.isInteger(opts.maxShots) && opts.maxShots > 0 ? opts.maxShots : MAX_AUTO_SHOTS
  const t = Number(targetDurationSec)
  const s = Number(shotSeconds)
  if (!Number.isFinite(t) || !Number.isFinite(s) || s <= 0 || t <= 0) return 1
  const n = Math.round(t / s)
  if (!Number.isFinite(n) || n < 1) return 1
  return Math.min(n, maxShots)
}

function badParam (message) {
  return { ok: false, errorCode: 'AUTO_BAD_PARAM', message: message || '参数非法' }
}

function isAbsoluteString (v) {
  return typeof v === 'string' && v.trim() !== '' && path.isAbsolute(v)
}

/**
 * 输入域校验（全部校验在此完成；auto-start 只复查归属与受控根 —— design D22）
 * @returns {{ok: true} | {ok: false, errorCode: string, message: string}}
 */
function validateAutoInputs (input) {
  const o = input || {}
  const script = typeof o.script === 'string' ? o.script : ''
  if (script.trim() === '') return { ok: false, errorCode: 'AUTO_SCRIPT_EMPTY', message: '剧本不能为空' }
  if (o.script.length > MAX_AUTO_SCRIPT_LENGTH) {
    return { ok: false, errorCode: 'AUTO_SCRIPT_TOO_LONG', message: '剧本不能超过 ' + MAX_AUTO_SCRIPT_LENGTH + ' 字' }
  }
  if (!AUTO_ASPECTS.includes(o.aspect)) return badParam('aspect 必须为 ' + AUTO_ASPECTS.join('/'))
  if (!AUTO_SHOT_SECONDS.includes(Number(o.seconds))) return badParam('seconds 必须为 ' + AUTO_SHOT_SECONDS.join('/'))
  const t = o.targetDurationSec
  if (!Number.isInteger(t) || t < MIN_AUTO_DURATION_SEC || t > MAX_AUTO_DURATION_SEC) {
    return badParam('targetDurationSec 必须为 ' + MIN_AUTO_DURATION_SEC + '-' + MAX_AUTO_DURATION_SEC + ' 的整数')
  }
  const characterRefs = o.characterRefs === undefined ? [] : o.characterRefs
  if (!Array.isArray(characterRefs) || characterRefs.length > MAX_AUTO_REFS) {
    return badParam('characterRefs 必须为不超过 ' + MAX_AUTO_REFS + ' 项的数组')
  }
  for (const ref of characterRefs) {
    if (!ref || typeof ref.name !== 'string' || ref.name.trim() === '' || ref.name.length > MAX_CHARACTER_NAME_LENGTH) {
      return badParam('人物参考图必须含 1-' + MAX_CHARACTER_NAME_LENGTH + ' 字的角色名')
    }
    if (!isAbsoluteString(ref.path)) return badParam('人物参考图路径必须为绝对路径')
  }
  const sceneRefs = o.sceneRefs === undefined ? [] : o.sceneRefs
  if (!Array.isArray(sceneRefs) || sceneRefs.length > MAX_AUTO_REFS) {
    return badParam('sceneRefs 必须为不超过 ' + MAX_AUTO_REFS + ' 项的数组')
  }
  for (const p of sceneRefs) {
    if (!isAbsoluteString(p)) return badParam('场景参考图路径必须为绝对路径')
  }
  return { ok: true }
}

/** 分场（复用剧本套用引擎的分场语义：空行分段 + 标题行并入下一段） */
function splitAutoBeats (script) {
  const beats = splitScript(typeof script === 'string' ? script : '')
  return beats.map((b, i) => ({ index: i + 1, title: b.title || '', text: b.text || '' }))
}

/** 按句末标点切块（保留标点在前块） */
function splitIntoChunks (text) {
  const raw = String(text || '').match(/[^。！？!?；;\n]+[。！？!?；;]?/g) || []
  return raw.map((s) => s.trim()).filter((s) => s.length > 0)
}

/** 把 chunks 均分成 parts 组（保序、非空、不丢字） */
function groupChunks (chunks, parts) {
  const groups = []
  const base = Math.floor(chunks.length / parts)
  let extra = chunks.length % parts
  let cursor = 0
  for (let i = 0; i < parts; i++) {
    const size = base + (extra > 0 ? 1 : 0)
    if (extra > 0) extra -= 1
    const slice = chunks.slice(cursor, cursor + size)
    cursor += size
    if (slice.length > 0) groups.push(slice)
  }
  return groups
}

/**
 * **只拆**：段落数 < 目标数时，把最长的可拆段落按句末标点拆开（不丢字、不造空镜）
 * 合并一律交给 mergeBeatsToCount（单向分工，见 design D8 / 评审 R1-i2）
 */
function expandBeatsToCount (beats, targetCount) {
  const target = Number.isInteger(targetCount) && targetCount > 0 ? targetCount : 0
  let list = (Array.isArray(beats) ? beats : []).map((b) => ({ ...b }))
  if (target <= list.length) return list
  for (;;) {
    if (list.length >= target) break
    let bestIdx = -1
    let bestChunks = null
    for (let i = 0; i < list.length; i++) {
      const chunks = splitIntoChunks(list[i].text)
      const splittable = chunks.length >= 2 && chunks.every((c) => c.length >= MIN_SENTENCE_CHUNK_LENGTH)
      if (!splittable) continue
      if (!bestChunks || list[i].text.length > list[bestIdx].text.length) { bestIdx = i; bestChunks = chunks }
    }
    if (bestIdx < 0 || !bestChunks) break
    const need = target - list.length
    const parts = Math.min(bestChunks.length, need + 1)
    if (parts < 2) break
    const groups = groupChunks(bestChunks, parts)
    if (groups.length < 2) break
    const source = list[bestIdx]
    const replacement = groups.map((g) => ({ index: 0, title: source.title, text: g.join('') }))
    list = list.slice(0, bestIdx).concat(replacement, list.slice(bestIdx + 1))
  }
  return list.map((b, i) => ({ ...b, index: i + 1 }))
}

/** **只并**：段落数 > 目标数时相邻合并（保序、不丢字、不复制内容） */
function mergeBeatsToCount (beats, targetCount) {
  const target = Number.isInteger(targetCount) && targetCount > 0 ? targetCount : 0
  const list = (Array.isArray(beats) ? beats : []).map((b) => ({ ...b }))
  if (target <= 0 || list.length <= target) return list
  const groups = groupChunks(list, target)
  return groups.map((g, i) => ({
    index: i + 1,
    title: g[0].title || '',
    text: g.map((b) => b.text).join(''),
  }))
}


/**
 * 主入口：剧本 + 参考图 + 参数 → 可执行分镜计划（零 provider 调用、零落盘）
 * @returns {{ok: true, shots: Array<object>, characterMap: object, warnings: Array<object>, estimates: object, plannedDurationSec: number, refsFingerprint: string, scriptHash: string}
 *          | {ok: false, errorCode: string, message: string}}
 */
function planAutoShots (input) {
  const o = input || {}
  const valid = validateAutoInputs(o)
  if (!valid.ok) return valid
  const templates = Array.isArray(o.templateShots) ? o.templateShots : []
  if (templates.length === 0) return { ok: false, errorCode: 'AUTO_NO_TEMPLATES', message: '没有可用模板分镜（film-kit 未加载或为空）' }

  const maxShots = Number.isInteger(o.maxShots) && o.maxShots > 0 ? o.maxShots : MAX_AUTO_SHOTS
  // 先按未 clamp 的原始镜数判上限（fail-closed 兜底）：clamp 之后的数恒 ≤ maxShots，
  // 若用 clamp 后的值判上限，该分支永远不可达（等于把防线写成死码）。
  const s = Number(o.seconds)
  const rawCount = s > 0 ? Math.round(Number(o.targetDurationSec) / s) : 1
  if (Number.isFinite(rawCount) && rawCount > maxShots) {
    return {
      ok: false,
      errorCode: 'AUTO_TOO_MANY_SHOTS',
      message: '计划镜数 ' + rawCount + ' 超过上限 ' + maxShots + '，请缩短大概时长或增大单镜秒数',
    }
  }
  const targetCount = planShotCount(o.targetDurationSec, o.seconds, { maxShots })

  const baseBeats = splitAutoBeats(o.script)
  // 理论不可达的 fail-closed 兜底（代码审查结论）：`validateAutoInputs` 已先拦下空白剧本（AUTO_SCRIPT_EMPTY），
  // 而 `splitScript` 对任何非空白输入都至少产出一段（连「只有标题行」也会补一段 text:''）。
  // 保留此分支作为「将来改了 splitScript 语义」的兜底，不删——但不要为它编造可达用例。
  if (baseBeats.length === 0) return { ok: false, errorCode: 'AUTO_NO_BEATS', message: '剧本无法分场（请用空行分隔场景）' }
  const expanded = expandBeatsToCount(baseBeats, targetCount)
  const beats = mergeBeatsToCount(expanded, targetCount)

  const detected = detectCharacters({ script: o.script, labeledRefs: o.characterRefs || [] })
  const characterMap = buildCharacterMap(detected.characters)
  const bound = bindReferencePaths({
    beats,
    characterRefs: o.characterRefs || [],
    sceneRefs: o.sceneRefs || [],
    mediaRoot: o.mediaRoot,
  })

  const shots = beats.map((beat, i) => {
    const template = templates[i % templates.length]
    const prompt = buildTemplatePrompt({ template, beatText: beat.text, characterMap })
    const refPaths = bound[i] ? bound[i].refPaths : []
    // v7 批次一 F2 + F34：给每镜补 durationMs（来源优先级链）。
    // 自动模式下还没有 TTS 实测，故走 formula（按本镜文案推算）→ tier（o.seconds 兜底）。
    // 这是**纯增量**：原先 `seconds` 的语义与 plannedDurationSec 一律不动，
    // 消费方可以继续只读 seconds；需要更细的时长就读 durationMs。
    const duration = resolveShotDurationMs(
      { dialogue: beat.text, emotion: beat.emotion },
      { tiers: AUTO_SHOT_SECONDS, maxSec: MAX_AUTO_SHOT_SEC, defaultSec: Number(o.seconds) },
    )
    return {
      index: i,
      shotId: 'auto-' + String(i).padStart(3, '0'),
      beatIndex: beat.index,
      title: beat.title || '',
      prompt,
      characterNames: Object.values(characterMap).filter((name) => String(beat.text || '').includes(name)),
      refPaths,
      seconds: Number(o.seconds),
      durationMs: duration.ok ? duration.durationMs : Math.round(Number(o.seconds) * 1000),
      durationSec: duration.ok ? duration.durationSec : Number(o.seconds),
      durationSource: duration.ok ? duration.source : 'tier',
      durationWarnings: duration.ok ? duration.warnings : [duration.error],
      status: 'pending',
    }
  })

  const plannedDurationSec = shots.length * Number(o.seconds)
  // 按台词推算的总时长（与档位基线并列展示，不替换任何既有字段）
  const estimatedDurationSec = Math.round(shots.reduce((acc, x) => acc + (Number(x.durationMs) || 0), 0) / 100) / 10
  const durationSourceCount = shots.reduce((acc, x) => {
    acc[x.durationSource] = (acc[x.durationSource] || 0) + 1
    return acc
  }, { formula: 0, tier: 0, tts: 0, user: 0 })
  const durationWarnings = []
  if (plannedDurationSec > 0 && Math.abs(estimatedDurationSec - plannedDurationSec) / plannedDurationSec > 0.2) {
    durationWarnings.push({
      code: 'W8',
      message: '按台词推算总时长 ' + estimatedDurationSec + ' 秒，与档位基线 ' + plannedDurationSec + ' 秒相差超过 20%'
        + '（推算 ' + durationSourceCount.formula + ' 镜 / 档位 ' + durationSourceCount.tier + ' 镜）。'
        + '最终以 TTS 实测为准；若差异过大请调整单镜秒数或拆分长台词镜头。',
    })
  }
  const wallclock = shots.length * WALLCLOCK_SECONDS_PER_SHOT
  const shotsWithReferences = shots.filter((s) => s.refPaths.length > 0).length
  // 空文案分镜（代码审查发现）：整篇只写一行场景标题（如单独一行 `INT.`）时，`splitScript` 会产出一段
  // `text:''`；这类镜的提示词里没有一点用户文案，而确认卡只显示「提示词字数」，用户看不出差异。
  // 因此显式给 W7 提示（不阻断——用户可能就是想要一张模板空镜）。
  const emptyBeatIndexes = beats.filter((b) => !String(b.text || '').trim()).map((b) => b.index)
  const warnings = [
    ...buildReferenceWarnings({ providerId: o.providerId, shotsWithReferences }),
    ...(shots.length > PRODUCTION_BATCH_SIZE
      ? [{ code: 'W2', message: '镜数超过 ' + PRODUCTION_BATCH_SIZE + '，将自动分 ' + Math.ceil(shots.length / PRODUCTION_BATCH_SIZE) + ' 批顺序执行（无需逐批确认）' }]
      : []),
    ...(plannedDurationSec !== Number(o.targetDurationSec)
      ? [{ code: 'W3', message: '实际时长约 ' + plannedDurationSec + ' 秒，与目标 ' + Number(o.targetDurationSec) + ' 秒存在差异（单镜 ' + Number(o.seconds) + ' 秒 × ' + shots.length + ' 镜）' }]
      : []),
    ...detected.warnings,
    ...(emptyBeatIndexes.length > 0
      ? [{
          code: 'W7',
          message: '有 ' + emptyBeatIndexes.length + ' 个分镜没有解析到文案（剧本里可能只写了场景标题行），这些镜将沿用模板原文：'
            + emptyBeatIndexes.slice(0, 5).map((i) => '#' + i).join(', '),
        }]
      : []),
    ...(wallclock > WALLCLOCK_WARN_SECONDS
      ? [{ code: 'W5', message: '墙钟预估约 ' + (wallclock / 3600).toFixed(1) + ' 小时，建议缩短时长或分批推进（支持停止与断点续跑）' }]
      : []),
    // 逐镜绑定警告（越界路径等）汇总为 W6，附前若干条便于定位
    ...(bound.some((b) => b.warnings.length > 0)
      ? [{
          code: 'W6',
          message: '部分参考图未通过受控目录校验已跳过：' + bound
            .filter((b) => b.warnings.length > 0)
            .slice(0, 3)
            .map((b) => '#' + b.index + ' ' + b.warnings.map((w) => w.reason).join(','))
            .join('; '),
        }]
      : []),
    ...durationWarnings,
  ]

  return {
    ok: true,
    shots,
    characterMap,
    warnings,
    plannedDurationSec,
    estimatedDurationSec,
    durationSourceCount,
    targetDurationSec: Number(o.targetDurationSec),
    shotsWithReferences,
    scriptHash: sha256(o.script),
    refsFingerprint: buildRefsFingerprint(o.characterRefs || [], o.sceneRefs || []),
    estimates: {
      shotCount: shots.length,
      batchCount: Math.ceil(shots.length / PRODUCTION_BATCH_SIZE),
      diskEstimateBytes: shots.length * DISK_ESTIMATE_BYTES_PER_SHOT,
      wallclockEstimateSeconds: wallclock,
      estimatedDurationSec,
    },
  }
}

module.exports = {
  MAX_AUTO_SHOTS,
  MAX_AUTO_SCRIPT_LENGTH,
  MIN_AUTO_DURATION_SEC,
  MAX_AUTO_DURATION_SEC,
  AUTO_ASPECTS,
  AUTO_SHOT_SECONDS,
  MAX_AUTO_SHOT_SEC,
  MAX_AUTO_REFS,
  SLOT_ORDER,
  DISK_ESTIMATE_BYTES_PER_SHOT,
  WALLCLOCK_SECONDS_PER_SHOT,
  PRODUCTION_BATCH_SIZE,
  WALLCLOCK_WARN_SECONDS,
  STOPWORDS,
  planShotCount,
  validateAutoInputs,
  splitAutoBeats,
  expandBeatsToCount,
  mergeBeatsToCount,
  detectCharacters,
  buildCharacterMap,
  bindReferencePaths,
  buildReferenceWarnings,
  buildShotFingerprint,
  buildPayloadHash,
  buildPlanId,
  buildRefsFingerprint,
  planAutoShots,
}

