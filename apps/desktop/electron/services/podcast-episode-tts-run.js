'use strict'
/**
 * 刀 4 第 3 片·下半：把四个已落地的纯层**串成一次出期**（PRD §7.4 流程、§7.4.0 两层音色事实、
 * §7.4.1.1 音色解析、§7.4.2.1 口语化、§7.4.7 逐块合成、§13 第 3 条「TTS 计费二次确认」）。
 *
 * 这一层自己不发明任何判据，只做三件事：按顺序调用、把上游的结构化失败**逐字透传**、给渲染层
 * 一份能直接显示的 `estimate` 与 `voice.origin`。在本层新写一条校验就是第二份口径（本仓反复踩过
 * 「两层反向结论由调用顺序决定」），要加判据一律去改它所属的那一层。
 *
 * 四条不可让的口径：
 * 1. **一切出站都在确认之后**：口语化是一次 LLM 调用、每块 TTS 是一次计费调用。`prepareEpisodeTtsRun`
 *    是本层唯一「零出站」的出口，浮层的二次确认就是拿它的返回值渲染的（§6.4「uploadAudio 之前
 *    零出站零计费」把同一条纪律延伸到刀 4）。
 * 2. **`estimate` 只用于展示，永不参与判据**：预计时长是「码点 ÷ 语速区间」的粗估；合成结果里的
 *    `durationSec` 才是实测（§7.4.5 第 2 条同口径）。把预估当判据会造出一条拦不到真问题的假门。
 * 3. **失败必须带 `code` 与 `issues` 原样上抛**：四层的错误码各有落点（音色三层 / 分块 / 逐块 /
 *    口语化旁路），在本层重新包一个码等于把归因擦掉。
 * 4. **口语化的旁路方向不改结果形状**：`reason` 为 `no_provider`/`invoke_failed`/`empty_output`/
 *    `structure_rejected` 时用原文出一期——这是 §7.4.2.1 定下的「旁路不拒绝出期」，本层不得升格成失败。
 */
const { cpLen, planChunks } = require('./podcast-tts-compose')
const { resolveEpisodeVoice } = require('./podcast-tts-voice')
const { colloquializeCopy, COLLOQUIALIZE_REASONS } = require('./podcast-tts-colloquialize')
const { synthesizeEpisodeAudio, SYNTH_ERRORS } = require('./podcast-episode-synth')

/**
 * 展示用语速区间（码点/秒）。事实来源是 `podcast-episode-synth.js` 的注释与 `MIN_SEC_PER_CODEPOINT`：
 * edge-tts 中文常态约 4-5 码点/秒，而 10 码点/秒 是「整段被静音替换或严重截断」才可能出现的异常下界。
 * 这里取常态区间两侧做**粗估**，只进文案不进判据。
 */
const ESTIMATE_CP_PER_SEC = { low: 3.5, high: 5.5 }

const RUN_ERRORS = {
  INVALID_ARGS: SYNTH_ERRORS.INVALID_ARGS,
  CANCELLED: SYNTH_ERRORS.CANCELLED,
}

function runErr (code, message, issues) {
  const e = new Error(message)
  e.code = code
  if (Array.isArray(issues)) e.issues = issues
  return e
}

/**
 * 零出站的准备步骤：文案校验 → 音色解析 → 分块计划 → 展示量估算。
 *
 * 返回 `{ok:true, content, voice, chunks, estimate}` 或 `{ok:false, code, issues}`。
 * `voice` 逐字沿用 `resolveEpisodeVoice` 的扁平形状（`providerId/model/voiceId/origin/resolvedBy`），
 * 本层不重新包一层——包了就会造出「同一份音色配置有两个真源」。
 */
function prepareEpisodeTtsRun (input = {}, deps = {}) {
  const readPreference = deps.readPreference
  const getCapability = deps.getCapability
  if (typeof readPreference !== 'function' || typeof getCapability !== 'function') {
    return {
      ok: false,
      code: RUN_ERRORS.INVALID_ARGS,
      issues: [{ code: RUN_ERRORS.INVALID_ARGS, path: 'tts.deps', message: '准备层必须注入 readPreference 与 getCapability 两个读取实现' }],
    }
  }

  const content = typeof input.content === 'string' ? input.content : ''
  const voice = resolveEpisodeVoice({
    channelRef: input.channel && input.channel.voiceRef,
    defaultProvider: input.defaultProvider,
    readPreference,
    getCapability,
    warn: deps.warn,
  })
  if (voice.ok !== true) return { ok: false, code: voice.code, issues: voice.issues }

  const plan = planChunks(content, { maxCodepoints: input.maxCodepoints })
  if (plan.ok !== true) return { ok: false, code: plan.code, issues: plan.issues }

  const codepoints = cpLen(content)
  const round1 = (n) => Math.round(n * 10) / 10
  return {
    ok: true,
    content,
    voice,
    chunks: plan.chunks,
    estimate: {
      codepoints,
      blocks: plan.chunks.length,
      estimatedSecLow: round1(codepoints / ESTIMATE_CP_PER_SEC.high),
      estimatedSecHigh: round1(codepoints / ESTIMATE_CP_PER_SEC.low),
    },
  }
}

/**
 * 一次完整出期：`prepare` → 口语化（一次 LLM 出站，旁路不拒绝）→ 逐块合成（每块一次计费出站）。
 *
 * `deps` 的 `generateTTS` / `concatBlocks` / `probeImpl` / `invokeLlm` 全部由宿主注入；本层不
 * require 任何 provider，测试里也就没有真实出站（仓内 network-egress-guard 会红）。
 */
async function runEpisodeTts (input = {}, deps = {}) {
  const logger = deps.logger || { info () {}, warn () {}, error () {} }
  const prepared = prepareEpisodeTtsRun(input, deps)
  if (prepared.ok !== true) {
    throw runErr(prepared.code, prepared.issues[0] ? prepared.issues[0].message : '出期准备未通过', prepared.issues)
  }

  const cancelled = () => Boolean(input.cancelToken && input.cancelToken.cancelled === true)
  if (cancelled()) throw runErr(RUN_ERRORS.CANCELLED, '已在合成前取消，未产生任何 TTS 调用')

  const coll = await colloquializeCopy({
    content: prepared.content,
    title: input.title,
    enabled: input.colloquialize !== false,
    invoke: deps.invokeLlm,
    warn: deps.warn,
    logger,
  })

  const synth = await synthesizeEpisodeAudio({
    content: coll.content,
    outBase: input.outBase,
    voiceRef: { providerId: prepared.voice.providerId, model: prepared.voice.model, voiceId: prepared.voice.voiceId },
    gapSec: input.gapSec,
    maxCodepoints: input.maxCodepoints,
    cancelToken: input.cancelToken,
    generateTTS: deps.generateTTS,
    concatBlocks: deps.concatBlocks,
    probeImpl: deps.probeImpl,
    fsImpl: deps.fsImpl,
    logger,
    onBlock: deps.onBlock,
  })

  return Object.assign({}, synth, {
    voice: prepared.voice,
    colloquial: { applied: coll.applied === true, reason: coll.reason, usesOriginal: coll.reason !== COLLOQUIALIZE_REASONS.APPLIED },
    estimate: prepared.estimate,
  })
}

module.exports = {
  ESTIMATE_CP_PER_SEC,
  RUN_ERRORS,
  prepareEpisodeTtsRun,
  runEpisodeTts,
}
