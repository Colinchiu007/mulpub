'use strict'
/**
 * 刀 4 第 2 块：逐块 TTS 合成 + 块间显式静音 + 拼接后实测（PRD §7.4.2 第 3-5 步、§7.4.3 第 ② 层）。
 *
 * 这一层是 `extractMix` 的**等价替身**：它必须返回与 `extractEpisodeAudio` 同形状的结果
 * （`{outPath, durationSec, sizeBytes, mime}`，且三个量都是**实测**），因为 `probe` 及其之后的
 * 手柄逐字复用刀 3——形状一变，三处一致校验与 strict 预校验就会静默失去意义。
 *
 * 四条不可让的口径（都对应一种"看起来正常工作"的静默失真）：
 * 1. **逐块串行**：多数 TTS provider 按并发计费/限流，并发会把限流变成整期失败；重试语义沿用
 *    `withAssetTransientRetry`，由注入的 `generateTTS` 自己负责——**本层不得再套第二层重试**
 *    （两层重试相乘会让一次抖动变成数十次真实调用）。
 * 2. **块级 degraded 必须逐块记账并在 probe 之前拦**：`generateTTS` 的三级降级最终返回
 *    `anullsrc` 生成的 3 秒静音并带 `degraded:true`。只看返回码会把一期"每块都是静音"的节目
 *    当成成功（见记忆 degraded-placeholder-not-success）。
 * 3. **时长只用实测**：provider 申报值不参与任何判据（§7.4.5 第 2 条同口径）。
 * 4. **块间静音显式插入**：仓内既有 concat 是"块间不加静音"，直接沿用会把口语念成连读，
 *    而听感问题不会在任何日志里留下痕迹。
 */
const { planChunks, MAX_CHUNK_CODEPOINTS, cpLen } = require('./podcast-tts-compose')

const GAP_MIN_SEC = 0.3
const GAP_MAX_SEC = 0.6
const GAP_DEFAULT_SEC = 0.4
/**
 * 「拼接结果短得不合理」的下限，单位是**秒/码点**（floor = 总码点 × 该值）。
 * 取值必须是**显著快于任何真实口播都不可能被误杀**的语速，否则这条判据会拦掉合法整期：
 * edge-tts 中文常态约 4-5 码点/秒（0.2-0.25 秒/码点），本层实测最快一档约 6 码点/秒，
 * 故取下界 0.1 秒/码点（= 10 码点/秒，约为常态语速两倍）——只有「整段被静音替换 / 严重截断」
 * 这种连 10 字/秒都达不到的形状才会命中。原值 0.2 恰落在常态语速上界（零余量），
 * 2026-10-11 QM-6 后端评审以 Warning 命中后下调，并配「快语速不误杀」负控。
 * 用固定 `块数 × 3s` 当反例（PRD §7.4.3 原句），一段 10 块、每块 1 秒的合法口播就会被误拒。
 */
const MIN_SEC_PER_CODEPOINT = 0.1

const SYNTH_ERRORS = {
  NO_CHUNKS: 'PODCAST_TTS_NO_CHUNKS',
  BLOCK_DEGRADED: 'PODCAST_TTS_CHUNK_DEGRADED',
  ALL_FAILED: 'PODCAST_TTS_ALL_FAILED',
  PARTIAL_FAILED: 'PODCAST_TTS_BLOCK_FAILED',
  AUDIO_TOO_SHORT: 'PODCAST_TTS_AUDIO_TOO_SHORT',
  CONCAT_FAILED: 'PODCAST_TTS_CONCAT_FAILED',
  CANCELLED: 'PODCAST_PUBLISH_CANCELLED',
  INVALID_ARGS: 'PODCAST_EPISODE_INVALID',
}

/** 块间静音秒数：越界一律**出声纠正**到闭集内，不静默采纳调用方给的数（也!= 拒绝到整期失败）。 */
function normalizeGap (raw, warn) {
  const n = Number(raw)
  if (!Number.isFinite(n) || n <= 0) {
    if (n === 0) {
      if (warn) warn('[podcast-synth] gapSec=0 会让块间连读，按合同改取默认 ' + GAP_DEFAULT_SEC + 's')
      return GAP_DEFAULT_SEC
    }
    if (warn) warn('[podcast-synth] gapSec 非法（' + raw + '），回落默认 ' + GAP_DEFAULT_SEC + 's')
    return GAP_DEFAULT_SEC
  }
  if (n < GAP_MIN_SEC || n > GAP_MAX_SEC) {
    const clamped = Math.min(GAP_MAX_SEC, Math.max(GAP_MIN_SEC, n))
    if (warn) warn('[podcast-synth] gapSec=' + n + ' 超出闭集 [' + GAP_MIN_SEC + ',' + GAP_MAX_SEC + ']，钳为 ' + clamped + 's')
    return clamped
  }
  return n
}

/** 降级块必须**逐块**列出块号：只报「有块降级」等于让用户以为整期重跑，而真实成因是某一段文本。 */
function degradedIssue (blocks) {
  return {
    code: SYNTH_ERRORS.BLOCK_DEGRADED,
    path: 'tts.blocks',
    blocks: blocks.slice(),
    message: '第 ' + blocks.join('/') + ' 块被替换为静音，已阻止上传（是素材不可用，不是生成失败）',
  }
}

/**
 * @param {{chunks?:Array, content?:string, outBase:string, voiceRef?:object, gapSec?:number,
 *          generateTTS:Function, concatBlocks:Function, probeImpl:Function,
 *          fsImpl?:object, cancelToken?:{cancelled:boolean}, logger?:object, onBlock?:Function}} input
 * @returns {Promise<{outPath:string,durationSec:number,sizeBytes:number,mime:string,blocks:number,gapSec:number}>}
 */
async function synthesizeEpisodeAudio (input = {}) {
  const log = input.logger || { info () {}, warn () {}, error () {} }
  const fs = input.fsImpl || require('fs')
  if (typeof input.generateTTS !== 'function' || typeof input.concatBlocks !== 'function'
    || typeof input.probeImpl !== 'function') {
    const e = new Error('合成层必须注入 generateTTS / concatBlocks / probeImpl 三个实现（缺一个都不许默认走真实出站）')
    e.code = SYNTH_ERRORS.INVALID_ARGS
    throw e
  }
  if (!input.outBase || typeof input.outBase !== 'string') {
    const e = new Error('合成需要主进程给出的输出路径基名')
    e.code = SYNTH_ERRORS.INVALID_ARGS
    throw e
  }

  // 没给计划就给内容：分块判据仍只有 planChunks 一份，本层不另写切分。
  let chunks = Array.isArray(input.chunks) ? input.chunks : null
  if (!chunks) {
    const plan = planChunks(input.content || '', { maxCodepoints: input.maxCodepoints })
    if (!plan.ok) { const e = new Error(plan.issues[0] && plan.issues[0].message); e.code = plan.code; e.issues = plan.issues; throw e }
    chunks = plan.chunks
  }
  if (!chunks.length) {
    const e = new Error('没有可合成的文本块')
    e.code = SYNTH_ERRORS.NO_CHUNKS
    throw e
  }

  const gapSec = normalizeGap(input.gapSec == null ? GAP_DEFAULT_SEC : input.gapSec, (m) => log.warn(m))
  const cancelled = () => Boolean(input.cancelToken && input.cancelToken.cancelled === true)
  const produced = []
  const degradedBlocks = []
  const failedBlocks = []
  let codepoints = 0

  // 逐块**串行**：块与块之间是天然的安全取消点（§7.4.4 取消窗口比刀 3 更宽就建立在这个事实上）。
  for (const c of chunks) {
    // 取消只在**块与块之间**采样：末块已产出后 concat/probe 期间收到取消，本层会白跑一次拼接与实测，
    // 真正的拦截在宿主 podcast-episode-publish.js 于 uploadAudio 前再次采样并丢弃那一期
    // （PRD §7.4.4：已产出的块文件由宿主统一清理）。这是有意取舍，不是漏判。
    if (cancelled()) {
      const e = new Error('已在合成途中取消，已产出的块文件由宿主统一清理')
      e.code = SYNTH_ERRORS.CANCELLED
      throw e
    }
    codepoints += cpLen(c.text)
    let r
    try {
      r = await input.generateTTS({ text: c.text, para: c.para, index: c.index, voiceRef: input.voiceRef })
    } catch (err) {
      log.warn('[podcast-synth] 块 ' + (produced.length + failedBlocks.length + 1) + ' 调用异常: ' + ((err && err.message) || String(err)))
      failedBlocks.push(produced.length + failedBlocks.length + 1)
      continue
    }
    const n = produced.length + failedBlocks.length + 1
    // ⛔ 只认返回码不够：degraded 标记必须显式检查（降级产物在形状上与成功产物完全同形）。
    if (r && r.degraded === true) degradedBlocks.push(n)
    if (!r || !r.path) { failedBlocks.push(n); continue }
    produced.push({ path: r.path, index: n, para: c.para })
    if (typeof input.onBlock === 'function') {
      try { input.onBlock({ index: n, total: chunks.length, done: produced.length }) } catch (e) { /* 进度是旁路 */ }
    }
  }

  // 五类拒绝态不得合并成"合成失败"：降级 → 块失败 → 全部失败，各有自己的码。
  if (degradedBlocks.length) {
    const e = new Error('有块被替换为静音，不出这一期')
    e.code = SYNTH_ERRORS.BLOCK_DEGRADED
    e.issues = [degradedIssue(degradedBlocks)]
    e.degradedBlocks = degradedBlocks.slice()
    throw e
  }
  if (!produced.length) {
    const e = new Error('所有文本块都未取回可用音频（provider 全部失败）')
    e.code = SYNTH_ERRORS.ALL_FAILED
    e.issues = [{ code: SYNTH_ERRORS.ALL_FAILED, path: 'tts.blocks', blocks: failedBlocks, message: '共 ' + chunks.length + ' 块全部未取回音频' }]
    throw e
  }
  if (failedBlocks.length) {
    // 块级失败没有"跳过坏块继续"这个出口：那会产出一期内容缺失且听感突兀的节目对外发布。
    const e = new Error('第 ' + failedBlocks.join('/') + ' 块未取回音频；本层不提供跳过坏块继续')
    e.code = SYNTH_ERRORS.PARTIAL_FAILED
    e.issues = [{ code: SYNTH_ERRORS.PARTIAL_FAILED, path: 'tts.blocks', blocks: failedBlocks, message: '失败块：' + failedBlocks.join('/') }]
    throw e
  }

  const outPath = input.outBase + '.mp3'
  let built
  try {
    built = await input.concatBlocks({ paths: produced.map((p) => p.path), gapSec, outPath, blockCount: produced.length })
  } catch (err) {
    const e = new Error('拼接失败：' + ((err && err.message) || String(err)))
    e.code = SYNTH_ERRORS.CONCAT_FAILED
    throw e
  }
  if (!built || built.path !== outPath || !fs.existsSync(outPath)) {
    const e = new Error('拼接未产出预期文件，不出这一期')
    e.code = SYNTH_ERRORS.CONCAT_FAILED
    throw e
  }

  // 实测三件套：ffprobe 时长 + stat 字节 + 显式 mime（不得依赖 URL 猜容器，刀 3 §6.4 第 3 条同源）。
  const measured = await input.probeImpl(outPath)
  if (!measured || !(Number(measured.durationSec) > 0)) {
    const e = new Error('无法实测拼接后的音频时长，已停止（不得用 provider 申报值代替）')
    e.code = SYNTH_ERRORS.AUDIO_TOO_SHORT
    throw e
  }
  const stat = fs.statSync(outPath)
  // 磁盘实测是字节数唯一权威；probe 申报值只在**它申报了**的时候用来对账。
  // 原先写作 `Number(measured.sizeBytes) || stat.size`，则 probe 不报大小时 sizeBytes 直接等于 stat.size，
  // 下一行判据退化成恒等式——「三处一致校验」在这一路静默失效（QM-6 后端评审 Warning 命中）。
  const sizeBytes = stat.size
  const declared = Number(measured.sizeBytes)
  if (measured.sizeBytes != null && Number.isFinite(declared) && declared !== 0 && declared !== stat.size) {
    const e = new Error('拼接后的字节与 probe 申报不符（申报 ' + declared + '，磁盘实测 ' + stat.size + '）')
    e.code = SYNTH_ERRORS.AUDIO_TOO_SHORT
    throw e
  }
  const floor = codepoints * MIN_SEC_PER_CODEPOINT
  if (Number(measured.durationSec) + 1e-6 < floor) {
    const e = new Error('拼接后时长 ' + measured.durationSec + 's 低于按码点数推出的下限 ' + floor.toFixed(2) + 's，疑似整段被静音替换')
    e.code = SYNTH_ERRORS.AUDIO_TOO_SHORT
    e.issues = [{ code: SYNTH_ERRORS.AUDIO_TOO_SHORT, path: 'tts.duration', message: '块数 ' + produced.length + '，码点 ' + codepoints }]
    throw e
  }
  const mime = built.mime || measured.mime || 'audio/mpeg'
  log.info('[podcast-synth] 合成完成 blocks=' + produced.length + ' gap=' + gapSec
    + 's duration=' + measured.durationSec + 's bytes=' + stat.size + ' mime=' + mime)
  return {
    outPath, durationSec: Number(measured.durationSec), sizeBytes: stat.size, mime,
    blocks: produced.length, gapSec, codepoints,
  }
}

module.exports = {
  GAP_MIN_SEC, GAP_MAX_SEC, GAP_DEFAULT_SEC, MIN_SEC_PER_CODEPOINT,
  SYNTH_ERRORS, normalizeGap, synthesizeEpisodeAudio, degradedIssue,
  MAX_CHUNK_CODEPOINTS,
}
