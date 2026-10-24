'use strict'
/**
 * 刀 4 第 3 片·下半：把四个已落地的纯层**串成一次出期**（PRD §7.4 流程、§7.4.0 两层音色事实、
 * §7.4.1.1 音色解析、§7.4.2.1 口语化、§7.4.7 逐块合成、§13 第 3 条「TTS 计费二次确认」）。
 *
 * **音色链已收敛为两层**（2026-10-19 用户裁决，PRD §7.4.1.2 是唯一真源）：① 用户偏好 →
 * ② capability 的 `defaultVoiceId` → ③ 都拿不到就拒绝出期。曾经的第 ① 档「频道 `voiceRef`」
 * 已撤档（写侧从未存在，见 `podcast-tts-voice.js` 头注释）。本层**不得再消费频道 voiceRef**：
 * 留着不可达的档位比少一条更坏——下一个读者会以为「频道可以配音色」，于是永远不去补真正需要的
 * 入口。定位键是 `input.defaultProvider`（`providerId` + `model`），缺它就没有 ①② 的查询键。
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
 * 语速 → 秒数的换算基准（码点/秒）。事实来源是 `podcast-episode-synth.js` 的注释与
 * `MIN_SEC_PER_CODEPOINT`：edge-tts 中文常态约 4-5 码点/秒，而 10 码点/秒 是「整段被静音替换或
 * 严重截断」才可能出现的异常下界。
 *
 * ⛔ **轴向**：这里的 `slow` / `fast` 是**语速**轴，不是时长轴。慢速（3.5 码点/秒）⇒ 同样的文案
 * 要读更久 ⇒ 秒数**多**；快速（5.5 码点/秒）⇒ 秒数**少**。所以时长下界用的是 `fast` 那个分母、
 * 上界用的是 `slow` 那个分母——看起来「对调」是对的：语速轴的名字不能直接当时长轴用。
 *
 * 取值口径：`slow: 3.5` **不在** 4-5 这个常态区间之内，它是常态下界 4 码点/秒**往下**留的一档余量
 * ——预计时长是给用户看的**上界**，宁可估得保守一点（时长偏长），也不能估短了让用户以为这一期
 * 比实际短。`fast: 5.5` 同理是常态上界 5 往上留一档。两端各留一档余量是为了「常态波动 + 标点停顿」
 * 也能被算进去；它仍然只是文案，永不参与判据。
 */
const CP_PER_SEC_BY_SPEED = { slow: 3.5, fast: 5.5 }

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
 *
 * 入参：`input.content`（文案原文）、`input.defaultProvider`（`{providerId, model}`，**必填**——
 * 它是 ①② 两级的定位键，缺它音色层直接拒绝，本层不代为猜一个 provider）。
 *
 * **同步执行**：本层是**纯同步**函数，在整篇文案上一次性完成
 * 依赖校验 / 音色解析 / 分块计划 / 估算。它不 await、不发请求，所以没有「让出事件循环」这一步；
 * 代价是超长文案会同步占用主线程一小段时间。调用方若要在大文本上调用，**应当在调用前**按
 * 上游的长度上限挡住（分块层有 `MAX_CHUNK_CODEPOINTS` 的块上限，但本层不设整篇上限），
 * 而不是指望本层在处理中途响应取消——本层没有可取消的东西（它零出站）。
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
  // 语速轴 → 时长轴的映射写在这里（而不是让读者去反推分母）：
  //   快语速（fast）⇒ 同样的文案读得少 ⇒ 秒数**小** ⇒ 时长**下界**
  //   慢语速（slow）⇒ 读得多 ⇒ 秒数**大** ⇒ 时长**上界**
  const secAtFastSpeed = round1(codepoints / CP_PER_SEC_BY_SPEED.fast)
  const secAtSlowSpeed = round1(codepoints / CP_PER_SEC_BY_SPEED.slow)
  return {
    ok: true,
    content,
    voice,
    chunks: plan.chunks,
    estimate: {
      codepoints,
      blocks: plan.chunks.length,
      estimatedSecLow: secAtFastSpeed,
      estimatedSecHigh: secAtSlowSpeed,
    },
  }
}

/**
 * 一次完整出期：`prepare` → 口语化（一次 LLM 出站，旁路不拒绝）→ 逐块合成（每块一次计费出站）。
 *
 * `deps` 的 `generateTTS` / `concatBlocks` / `probeImpl` / `invokeLlm` 全部由宿主注入；本层不
 * require 任何 provider，测试里也就没有真实出站（仓内 network-egress-guard 会红）。
 *
 * **取消契约**：`input.cancelToken` 是**透传**给合成层的，
 * 本层只读它的 `cancelled` 布尔位（`cancelled === true` 才算取消），**不校验它的形状**——
 * 形状判据归合成层（`podcast-episode-synth.js`），本层再写一份就是第二份口径。
 * 取消检查点在 `prepare` 之后、第一次出站之前；块间取消沿用合成层。
 *
 * **路径职责**：`input.outBase` 是宿主给的输出基名，**不是用户输入**；路径的校验与拼接归合成层
 * （`podcast-episode-synth.js` 负责 `outBase` 形状与落盘路径），本层只做原样透传，
 * 不在这里写第二套路径规则。
 */
async function runEpisodeTts (input = {}, deps = {}) {
  const logger = deps.logger || { info () {}, warn () {}, error () {} }
  const prepared = prepareEpisodeTtsRun(input, deps)
  if (prepared.ok !== true) {
    throw runErr(prepared.code, prepared.issues[0] ? prepared.issues[0].message : '出期准备未通过', prepared.issues)
  }

  const cancelled = () => Boolean(input.cancelToken && input.cancelToken.cancelled === true)
  if (cancelled()) throw runErr(RUN_ERRORS.CANCELLED, '已在合成前取消，未产生任何 TTS 调用')

  // 口语化层的出口契约是 `{content:string, applied:boolean, reason:string}`，且它**内部**已 try/catch
  // 住 provider 侧异常（调用抛错 ⇒ `invoke_failed`；空返回 ⇒ `empty_output`；结构不合格 ⇒
  // `structure_rejected`），三种情况都**用原文继续出一期**、都**不抛**。
  // 所以本层**不再包一层 catch**：那是一条走不到的路——不可达的兜底等于没有兜底，还会让人误以为
  // 「这里防住了什么」。「口语化不阻断出期」这条契约由**拥有它的那一层**负责，本层只消费它的结构化结果。
  const coll = await colloquializeCopy({
    content: prepared.content,
    title: input.title,
    enabled: input.colloquialize !== false,
    invoke: deps.invokeLlm,
    warn: deps.warn,
    logger,
  })

  // 交给生成器的音色**只有三段**（`providerId`/`model`/`voiceId`）。`origin` / `resolvedBy` 是**显示位**
  // （界面据此标注「用户偏好 / provider 默认」），生成器不消费它们，所以这里显式截断成一个新对象，
  // 不把整份解析结果透下去——否则同一个键既表示「生成器要用的」又表示「界面要看的」，两处消费者
  // 各取一半字段时就会互相误读。完整形状原样挂在返回值的 `voice` 上给界面用。
  const synthVoice = {
    providerId: prepared.voice.providerId,
    model: prepared.voice.model,
    voiceId: prepared.voice.voiceId,
  }

  const synth = await synthesizeEpisodeAudio({
    content: coll.content,
    outBase: input.outBase,
    // `voiceRef` 是**合成层自己的入参名**（`podcast-episode-synth.js` 的契约，并由它原样透传给
    // `generateTTS` 的适配层契约），与已撤档的「频道 meta 里的音色字段」是两个概念：后者是**数据来源**
    // （从频道配置里读音色），前者是**已解析好的音色**的传递参数。这里传的是解析结果，不是频道配置。
    // 同名不同义，故在此写明而不是改名——改名会同时打断合成层与适配层两处契约。
    voiceRef: synthVoice,
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
  CP_PER_SEC_BY_SPEED,
  RUN_ERRORS,
  prepareEpisodeTtsRun,
  runEpisodeTts,
}
