'use strict'

/**
 * podcast-episode-source.js — 成片 → 播客单集音频的来源判定与抽取准备
 *
 * 为什么单独成模块（PRD §7 刀 3 步骤 1–2）：一键出期最容易出的错不是"抽不出音频"，
 * 而是**把一份不该发布的音频发出去**。两类必须挡在前面的情况：
 *   1) 静音占位旁白（`audioMeta.degraded === true`）——成片看着完整，抽出来的混音里
 *      那段是静音，用户要到听众投诉才发现；
 *   2) 实测尺寸/时长缺失或自相矛盾——RSS 的 `<enclosure length>` 与 `itunes:duration`
 *      是订阅端断点续传与列表展示的输入，写错比不写更坏。
 *
 * 三条不可破的口径：
 *   - **判据只认 `degraded === true`**，与 `ResultView.vue` 的降级素材告警同源同判据；
 *     不得拿 `source` 字符串当第二判据（占位旁白的 source 可能是任何值，
 *     而真实旁白也可能带 provider 字样——按字符串猜会把好稿子拦下、把坏稿子放行）。
 *   - **时长与字节必须实测**（ffprobe / stat），不得来自常量、LLM 估计或分段时长求和。
 *   - **抽取失败不回退旁白音频**：成片混音是唯一可发布的声音，退回旁白等于发一份
 *     与画面不同步的东西，且界面无法自证它是"完整的那一份"。
 */

const PODCAST_EPISODE_ERRORS = {
  DEGRADED_SOURCE: 'PODCAST_AUDIO_DEGRADED_SOURCE',
  NO_COMPOSE_OUTPUT: 'PODCAST_AUDIO_NO_COMPOSE_OUTPUT',
  ENCODER_UNAVAILABLE: 'PODCAST_AUDIO_ENCODER_UNAVAILABLE',
  EXTRACT_FAILED: 'PODCAST_AUDIO_EXTRACT_FAILED',
  MEASURE_FAILED: 'PODCAST_AUDIO_MEASURE_FAILED',
  SIZE_MISMATCH: 'PODCAST_AUDIO_SIZE_MISMATCH',
}

function err (code, message, extra) {
  const e = new Error(code + ': ' + message)
  e.code = code
  if (extra) Object.assign(e, extra)
  return e
}

/**
 * 降级标记读取：**与展示端同一份判据**（只认布尔 true）。
 * 返回的 kinds 沿用 `ResultView.vue` 的 `placeholder_image` / `silent_narration`，
 * 让"界面上已经告过警的东西"与"发布前拦下来的东西"是同一个语义，不是两套词表。
 */
function readDegradedFlags (project) {
  const segments = project && Array.isArray(project.segments) ? project.segments : []
  const silentNarrationSegmentIds = []
  let placeholderImage = false
  for (const seg of segments) {
    if (!seg || typeof seg !== 'object') continue
    // 刻意不读 seg.audioMeta.source：见文件头第二条口径
    if (seg.audioMeta && seg.audioMeta.degraded === true) {
      silentNarrationSegmentIds.push(String(seg.id != null ? seg.id : ''))
    }
    if (seg.imageMeta && seg.imageMeta.degraded === true) placeholderImage = true
  }
  return {
    silentNarration: silentNarrationSegmentIds.length > 0,
    placeholderImage,
    silentNarrationSegmentIds,
    segmentCount: segments.length,
  }
}

/**
 * 编码方案选择（纯函数，可测不依赖宿主）。
 * mp3 优先（聚合端兼容性最宽），其次原生 aac → m4a；两者都没有就 fail closed，
 * **不得**退到 pcm/WAV：那是合法 enclosure 类型，但体积是 10 倍量级，
 * 把「因为打包里没有编码器」转成「给用户发一份 200MB 的 feed」不是兜底而是新的死法。
 */
function planAudioCodec (encoderList) {
  const names = String(encoderList || '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
  const has = (n) => names.some((l) => l === n || l.endsWith(' ' + n) || new RegExp('\\b' + n + '\\b').test(l))
  if (has('libmp3lame')) return { codec: 'libmp3lame', ext: '.mp3', mime: 'audio/mpeg', args: ['-c:a', 'libmp3lame', '-q:a', '2'] }
  if (has('aac')) return { codec: 'aac', ext: '.m4a', mime: 'audio/mp4', args: ['-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart'] }
  return null
}

/** ffmpeg 混音抽取命令：只取音频、单声道 44.1k，与 Podcast 检查清单的推荐规格一致。 */
function buildMixArgs (plan, videoPath, outPath) {
  if (!plan) throw err(PODCAST_EPISODE_ERRORS.ENCODER_UNAVAILABLE, '打包的 ffmpeg 没有可用音频编码器（mp3/aac 都不在），已停止抽取')
  return [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-i', String(videoPath),
    '-vn', '-map', '0:a:0',
    '-ac', '1', '-ar', '44100',
    ...plan.args,
    String(outPath),
  ]
}

/** ffprobe 实测命令：时长与字节都要实测，不接受求和或申报值。 */
function buildProbeArgs (ffprobePath, filePath) {
  return [
    '-v', 'error',
    '-show_entries', 'format=duration,size:stream=codec_type,codec_name',
    '-of', 'default=noprint_wrappers=1',
    String(filePath),
  ]
}

function parseProbeOutput (text) {
  const out = { durationSec: null, sizeBytes: null, codecName: '', hasAudio: false }
  for (const line of String(text || '').split('\n')) {
    const m = line.match(/^\s*(duration|size|codec_type|codec_name)\s*=\s*(.+?)\s*$/)
    if (!m) continue
    const [, key, value] = m
    if (key === 'duration') {
      const n = Number(value)
      // 实测值优先于后读到的同名字段：ffprobe 会先给 format 再给 stream，取第一个有效数
      if (Number.isFinite(n) && n > 0 && out.durationSec == null) out.durationSec = n
    } else if (key === 'size') {
      const n = Number(value)
      if (Number.isInteger(n) && n > 0 && out.sizeBytes == null) out.sizeBytes = n
    } else if (key === 'codec_type') {
      if (value === 'audio') out.hasAudio = true
    } else if (key === 'codec_name' && !out.codecName && value !== 'None') {
      out.codecName = value
    }
  }
  return out
}

/** `length="NaN"` 是这类链路最常见的静默损坏：宁可不出期，也不发一个 NaN 进 feed。 */
function formatDuration (durationSec) {
  const n = Number(durationSec)
  if (!Number.isFinite(n) || n <= 0) return ''
  const total = Math.floor(n)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const mm = String(m).padStart(2, '0')
  const ss = String(s).padStart(2, '0')
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`
}

module.exports = {
  PODCAST_EPISODE_ERRORS,
  readDegradedFlags,
  planAudioCodec,
  buildMixArgs,
  buildProbeArgs,
  parseProbeOutput,
  formatDuration,
}
