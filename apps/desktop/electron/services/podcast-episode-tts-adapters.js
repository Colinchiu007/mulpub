'use strict'
/**
 * 刀 4 第 3 片·接线：把合成层要求的四个注入实现，接成**生产可用**的真 adapter（PRD §7.4.8 的下游、
 * tasks 3.7 第⑦条「注入实现的返回契约必须写真 adapter 时同 PR 钉死」）。
 *
 * 合成层（`podcast-episode-synth.js`）刻意不 require 任何 provider / ffmpeg，全部靠注入；本文件就是
 * 那四个注入的生产实现。**判据一律留在各自的原生层**（音色判据在 §7.4.1.1、分块在 §7.4.2、块级
 * degraded 在 §7.4.7），本文件只做形状映射，因此它必须**比来源更保守**：拿不准就判 degraded。
 *
 * 三条不可让：
 * 1. **降级不得被消费成成功**（见记忆 degraded-placeholder-not-success）：`AssetGenerator.generateTTS`
 *    的三级回退最后一级是 ffmpeg `anullsrc` 静音，返回 `{code:0, data:{degraded:true}}`。本适配层对
 *    `code !== 0`、`data` 缺席、`data.path` 空、`degraded` **字段缺失** 一律判 `degraded:true`——
 *    把「没标 degraded」读成「没降级」就是把静音冒充口播（合成层的块级门禁随后会拒绝整期，
 *    这是刻意的：一条静音一期比一期失败更伤）。
 * 2. **入参键名按调用方契约，不按 provider 请求体**（AGENTS「适配器入参键必须与调用方契约键一致」）：
 *    合成层给的是 `voiceRef.{providerId,model,voiceId}`（camelCase），而 `generateTTS` 读 `opts.voice_id`
 *    或 `opts.voiceId`（`asset-generator.js:1037` 的 `firstNonEmptyString(opts?.voice_id, opts?.voiceId)`）。
 *    这里两键**同时给**，缺一个键名就会静默丢掉音色并恒用 provider 默认。
 * 3. **零隐式出站**：`spawnImpl` / `assetGenerator` / `readSetting` 全部由宿主注入；本文件不 require
 *    `node:child_process`，测试里因此不可能起真进程（仓内 network-egress-guard 与夹具纪律同源）。
 */

const ADAPTER_ERRORS = {
  ARGS_MISSING: 'PODCAST_EPISODE_INVALID',
  CONCAT_FAILED: 'PODCAST_TTS_CONCAT_FAILED',
  PROBE_FAILED: 'PODCAST_TTS_AUDIO_TOO_SHORT',
}

function argErr (which) {
  const e = new Error('TTS 生产适配层必须注入 ' + which + '（缺一个都不许默认走真实出站）')
  e.code = ADAPTER_ERRORS.ARGS_MISSING
  return e
}

/**
 * 把 `AssetGenerator.generateTTS` 包成合成层的 `( { text, index, voiceRef } ) => { path, degraded }`。
 */
function createGenerateTTS (deps = {}) {
  const assetGenerator = deps.assetGenerator
  if (!assetGenerator || typeof assetGenerator.generateTTS !== 'function') throw argErr('assetGenerator.generateTTS')
  return async function generateTTS (req = {}) {
    const ref = req.voiceRef || {}
    const opts = {
      index: req.index,
      providerId: ref.providerId,
      provider: ref.providerId,
      model: ref.model,
      voiceId: ref.voiceId,
      voice_id: ref.voiceId,
      // QM-6 后端评审 High：真正决定"哪个引擎跑"的键是 `voice_provider` / `voice_model`
      // （`asset-generator.js:1027` 的 `getConfiguredProvider(opts, ['voice_provider','voiceProvider'])`
      // 与 `:1072` 的 `opts?.voice_model || opts?.voiceModel`）。只给 providerId/model 时 provider 恒为
      // null ⇒ 直接落到 edge 兜底，配置的 provider/model 静默不生效。§7.4.9 第 2 条的"键名双给"
      // 因此必须覆盖**路由键**，不只是音色键。
      voice_provider: ref.providerId,
      voiceProvider: ref.providerId,
      voice_model: ref.model,
      voiceModel: ref.model,
    }
    let res
    try {
      res = await assetGenerator.generateTTS(req.text, opts)
    } catch (e) {
      return { path: null, degraded: true, reason: 'invoke_failed', message: (e && e.message) || String(e) }
    }
    const data = res && res.data
    if (!res || res.code !== 0 || !data || typeof data.path !== 'string' || data.path === '') {
      return { path: (data && data.path) || null, degraded: true, reason: 'provider_failed' }
    }
    // `degraded` 字段缺席 ⇒ 判降级：宁可拒出一期，也不把未知形状当成功。
    return { path: data.path, degraded: data.degraded !== false, mime: data.mime || data.format || null }
  }
}

/**
 * 音色层的两个读取实现：偏好与 capability 的单一真源各在其模块里，这里只接线不判定。
 */
function createVoiceReaders (deps = {}) {
  const { readSetting, getVoiceCapability } = deps
  if (typeof readSetting !== 'function' || typeof getVoiceCapability !== 'function') throw argErr('readSetting 与 getVoiceCapability')
  return {
    readPreference: (providerId, model) => readSetting('tts-voice-preference:v1:' + providerId + ':' + model),
    getCapability: (providerId, model) => getVoiceCapability(providerId, model),
  }
}

/**
 * ffmpeg 拼接：块间静音是**预物化的片段**参与 concat（`adelay`/`loudnorm` 都不在打包媒体工具的
 * `REQUIRED_FILTERS` 清单里，PRD §7.4.0 第 2 条因此明写不做响度归一）。
 *
 * 产物路径必须逐字等于调用方给的 `outPath`——合成层拿 `built.path !== outPath` 当拒绝判据。
 */
function createConcatBlocks (deps = {}) {
  const { ffmpegPath, spawnImpl, fsImpl } = deps
  if (!ffmpegPath) throw argErr('ffmpegPath（必须由 media-tool-paths 解析出打包件）')
  if (typeof spawnImpl !== 'function') throw argErr('spawnImpl')
  const fs = fsImpl || require('fs')
  return async function concatBlocks (req = {}) {
    const paths = Array.isArray(req.paths) ? req.paths : []
    if (!paths.length) {
      const e = new Error('没有可拼接的音频块')
      e.code = ADAPTER_ERRORS.CONCAT_FAILED
      throw e
    }
    const gapSec = Number(req.gapSec)
    const gapPath = req.outPath + '.gap.mp3'
    // 块间静音必须**参与 concat**：原先只把块喂进列表，gapSec 被静默丢掉，整期念成连读——
    // 听感问题不会在任何日志里留下痕迹（PRD §7.4.2 第 4 步与本文件头口径）。
    let gapFile = null
    if (Number.isFinite(gapSec) && gapSec > 0 && paths.length > 1) {
      const g = await spawnImpl({
        command: ffmpegPath,
        args: ['-hide_banner', '-y', '-f', 'lavfi', '-i', 'anullsrc=channel_layout=mono:sample_rate=44100',
          '-t', String(gapSec), '-c:a', 'libmp3lame', '-b:a', '128k', gapPath],
      })
      if (!g || g.code !== 0 || !fs.existsSync(gapPath)) {
        const e = new Error('块间静音片段生成失败，不出这一期（不得静默退化成无间隔拼接）')
        e.code = ADAPTER_ERRORS.CONCAT_FAILED
        throw e
      }
      gapFile = gapPath
    }
    const seq = gapFile ? paths.flatMap((p, i) => (i === paths.length - 1 ? [p] : [p, gapFile])) : paths
    const listPath = req.outPath + '.concat.txt'
    // concat demuxer 的列表先归一 Windows 反斜杠（与仓内既有实现 `story2video-compose-engine.js`
    // 的 `_plainConcat` 同口径：`os.tmpdir()` 在 Windows 给的是反斜杠路径，不归一会被解析成转义序列），
    // 再用单引号包裹并转义内部单引号。
    const BSL = String.fromCharCode(92)
    const body = seq.map((p) => "file '" + String(p).split(BSL).join('/').split("'").join("'\\''") + "'").join(String.fromCharCode(10))
    fs.writeFileSync(listPath, body + String.fromCharCode(10))
    try {
      const r = await spawnImpl({ command: ffmpegPath, args: ['-hide_banner', '-y', '-f', 'concat', '-safe', '0', '-i', listPath, '-c', 'copy', req.outPath] })
      if (!r || r.code !== 0 || !fs.existsSync(req.outPath)) {
        const e = new Error('拼接未产出预期文件')
        e.code = ADAPTER_ERRORS.CONCAT_FAILED
        throw e
      }
    } finally {
      try { fs.unlinkSync(listPath) } catch (_err) { /* 列表是临时产物，删不掉不影响交付 */ }
      if (gapFile) { try { fs.unlinkSync(gapFile) } catch (_err) { /* 同上 */ } }
    }
    return { path: req.outPath, mime: 'audio/mpeg', gapSec: gapFile ? gapSec : 0, gapInserted: gapFile != null }
  }
}

/**
 * ffprobe 实测：时长与字节都来自**这次实测**，provider 申报值不参与任何判据（§7.4.5 第 2 条同口径）。
 */
function createProbeImpl (deps = {}) {
  const { ffprobePath, spawnImpl } = deps
  if (!ffprobePath) throw argErr('ffprobePath（必须由 media-tool-paths 解析出打包件）')
  if (typeof spawnImpl !== 'function') throw argErr('spawnImpl')
  // 字节数不在这里取：磁盘 stat 是字节的唯一权威（PRD §7.4.7），故本工厂不需要 fsImpl
  return async function probeImpl (p) {
    let r
    try {
      r = await spawnImpl({ command: ffprobePath, args: ['-v', 'error', '-show_entries', 'format=duration,size', '-of', 'default=noprint_wrappers=1', p] })
    } catch (e) {
      const err = new Error('ffprobe 无法读取产物：' + ((e && e.message) || String(e)))
      err.code = ADAPTER_ERRORS.PROBE_FAILED
      throw err
    }
    const out = (r && (r.stdout || '')) || ''
    const dur = /duration=([\d.]+)/.exec(out)
    const size = /size=([\d]+)/.exec(out)
    if (!dur || !(Number(dur[1]) > 0)) {
      const e = new Error('ffprobe 未申报有效时长，已停止（不得用 provider 申报值代替）')
      e.code = ADAPTER_ERRORS.PROBE_FAILED
      throw e
    }
    return { durationSec: Number(dur[1]), sizeBytes: size ? Number(size[1]) : undefined, mime: 'audio/mpeg' }
  }
}

module.exports = {
  ADAPTER_ERRORS,
  createGenerateTTS,
  createVoiceReaders,
  createConcatBlocks,
  createProbeImpl,
}
