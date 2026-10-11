'use strict'

/**
 * podcast-episode-extract.js — 成片抽全混音 + 实测尺寸/时长（刀 3 步骤 2–3）
 *
 * 顺序是有原因的，不能为了"少跑一次进程"而调整：
 *   1) 先读降级标记 ⇒ 静音占位旁白**在任何 spawn 之前**就被拦下（零副作用、零耗时、
 *      也不留下一个半成品文件）；
 *   2) 再问编码器 ⇒ 打包的 ffmpeg 没有 mp3/aac 编码器时 fail closed，
 *      **不得**退到 pcm/WAV（体积是 10 倍量级，等于给订阅端发一份抓取超时的 feed）；
 *   3) 抽混音 ⇒ 失败原样带上退出码与 stderr 尾巴，**不回退旁白音频**
 *      （旁白与画面不同步，且界面无法自证它是完整的那一份）；
 *   4) 对**抽出来的文件**实测 duration/size ⇒ 拿不到就是 MEASURE_FAILED，
 *      不得用分段时长求和（求和会把转场、编码器 padding 与容器时长的差异全吞掉）；
 *   5) 三处一致校验：`stat` 字节 == `ffprobe` 字节 ==（发布时）`putObject` 返回字节。
 *      两处不同即 SIZE_MISMATCH——这是"文件在写入后被别的进程改动/截断"的唯一廉价探测器，
 *      而 `<enclosure length>` 一旦写错，订阅端会缓存坏值并长期表现为"下载卡在 99%"。
 *
 * 宿主依赖全部注入（spawnImpl/fsImpl/ffmpegPath/ffprobePath）：测试里既不许起真进程，
 * 也不许真出站；生产侧由 `media-tool-paths.js` 解析打包资源（那是该口径的唯一实现）。
 *
 * 输出文件名由调用方给**去扩展名的基名**（`outBase`），扩展名由实测出来的编码方案补上：
 * 命名 hygiene 的单一实现是 `podcast-hosting-upload.safeFileStem`，在这里再推一遍就是
 * 第二份口径（两份必然漂移）；而让本模块补扩展名是为了消除一类静默损坏——
 * 调用方指定 `.mp3` 而宿主只有 aac 时，硬写会产出一个"扩展名 mp3、内容是 m4a"的文件，
 * 聚合端抓到它只会报"编码不支持"，排查方向完全错开。
 */

const {
  PODCAST_EPISODE_ERRORS,
  readDegradedFlags,
  planAudioCodec,
  buildMixArgs,
  buildProbeArgs,
  parseProbeOutput,
  formatDuration,
} = require('./podcast-episode-source')

const EXTRACT_TIMEOUT_MS = Number(process.env.MP_PODCAST_EXTRACT_TIMEOUT_MS) > 0
  ? Number(process.env.MP_PODCAST_EXTRACT_TIMEOUT_MS)
  : 180000
const PROBE_TIMEOUT_MS = Number(process.env.MP_PODCAST_PROBE_TIMEOUT_MS) > 0
  ? Number(process.env.MP_PODCAST_PROBE_TIMEOUT_MS)
  : 15000

function err (code, message, extra) {
  const e = new Error(code + ': ' + message)
  e.code = code
  if (extra) Object.assign(e, extra)
  return e
}

function tailOf (text, max = 240) {
  const s = String(text || '').replace(/\s+/g, ' ').trim()
  return s.length > max ? s.slice(-max) : s
}

/**
 * 带硬超时的宿主调用。超时语义是**失败**而不是"再等等"：
 * - 超时后迟到的 close/error 不得变成 unhandledRejection（监听器必须留在原 promise 上）；
 * - 超时时必须杀掉子进程，否则用户点第二次会攒出第二个 ffmpeg 抢同一个输出文件。
 */
function runWithTimeout (run, { timeoutMs, label, kill }) {
  let timer
  let settled = false
  const done = new Promise((resolve, reject) => {
    timer = setTimeout(() => {
      settled = true
      try { if (typeof kill === 'function') kill() } catch (_) { /* 杀不掉也不能掩盖超时 */ }
      reject(err(PODCAST_EPISODE_ERRORS.EXTRACT_FAILED, label + ' 超时 >' + timeoutMs + 'ms', { timedOut: true }))
    }, timeoutMs)
    Promise.resolve()
      .then(run)
      .then((v) => { if (!settled) { clearTimeout(timer); resolve(v) } }, (e) => { if (!settled) { clearTimeout(timer); reject(e) } })
  })
  return done
}

/**
 * 抽混音并实测。`spawnImpl({ command, args, cwd })` 必须返回
 * `{ code, stdout, stderr }`（0 为成功），失败抛错由本函数原样转成结构化码。
 */
async function extractEpisodeAudio (options = {}) {
  const {
    project, videoPath, outBase,
    ffmpegPath, ffprobePath,
    spawnImpl, fsImpl, killImpl,
    extractTimeoutMs = EXTRACT_TIMEOUT_MS,
    probeTimeoutMs = PROBE_TIMEOUT_MS,
  } = options

  // 1) 降级判定放在**一切宿主访问之前**（连 stat 都不做）：这份稿子根本不该出期，
  //    让它依赖"成片文件在不在"会把真正的拒因掩盖成文件缺失。
  const degraded = readDegradedFlags(project)
  if (degraded.silentNarration) {
    throw err(PODCAST_EPISODE_ERRORS.DEGRADED_SOURCE,
      '检测到静音占位旁白（' + degraded.silentNarrationSegmentIds.length + ' 段），已阻止出期',
      { segmentIds: degraded.silentNarrationSegmentIds })
  }

  if (typeof spawnImpl !== 'function') throw err(PODCAST_EPISODE_ERRORS.EXTRACT_FAILED, '抽取必须注入 spawnImpl（测试与默认路径都不得起真进程）')
  const fs = fsImpl || require('fs')
  if (!ffmpegPath || !ffprobePath) throw err(PODCAST_EPISODE_ERRORS.EXTRACT_FAILED, '必须先由 media-tool-paths 解析出打包的 ffmpeg/ffprobe')
  if (!videoPath || !fs.existsSync(videoPath)) throw err(PODCAST_EPISODE_ERRORS.NO_COMPOSE_OUTPUT, '成片文件不存在，无法出期（请确认该项目已合成完成）')
  if (!outBase) throw err(PODCAST_EPISODE_ERRORS.EXTRACT_FAILED, '缺少输出基名（目录与名字由调用方决定，扩展名由编码方案补）')

  // 2) 编码器实测 → 方案
  const encoders = await runWithTimeout(
    () => spawnImpl({ command: ffmpegPath, args: ['-hide_banner', '-codecs'], probe: 'encoders' }),
    { timeoutMs: probeTimeoutMs, label: 'ffmpeg 编码器探测' },
  )
  const plan = planAudioCodec(encoders && encoders.stdout)
  if (!plan) throw err(PODCAST_EPISODE_ERRORS.ENCODER_UNAVAILABLE, '打包的 ffmpeg 不含 mp3/aac 编码器，已停止抽取（不退 WAV）')

  // 3) 抽混音
  const outPath = String(outBase) + plan.ext
  const mix = await runWithTimeout(
    () => spawnImpl({ command: ffmpegPath, args: buildMixArgs(plan, videoPath, outPath) }),
    // kill 由调用方注入：超时不杀进程的话，用户点第二次会攒出第二个 ffmpeg 抢同一个输出文件，
    // 那正是本模块要用三处一致校验去防的那类损坏。缺 killImpl 时如实传 null 让它可见。
    { timeoutMs: extractTimeoutMs, label: 'ffmpeg 抽混音', kill: typeof killImpl === 'function' ? killImpl : undefined },
  )
  if (!mix || mix.code !== 0) {
    throw err(PODCAST_EPISODE_ERRORS.EXTRACT_FAILED,
      '抽取失败（退出码 ' + (mix && mix.code != null ? mix.code : 'none') + '）',
      { stderr: tailOf(mix && mix.stderr) })
  }
  if (!fs.existsSync(outPath)) throw err(PODCAST_EPISODE_ERRORS.EXTRACT_FAILED, 'ffmpeg 报成功但输出文件不存在')

  // 4) 实测抽出来的文件
  const probe = await runWithTimeout(
    () => spawnImpl({ command: ffprobePath, args: buildProbeArgs(ffprobePath, outPath) }),
    { timeoutMs: probeTimeoutMs, label: 'ffprobe 实测' },
  )
  const measured = parseProbeOutput(probe && probe.stdout)
  if (!measured.hasAudio || !measured.durationSec || !measured.sizeBytes) {
    throw err(PODCAST_EPISODE_ERRORS.MEASURE_FAILED,
      '无法实测音频的时长或字节（已停止，不得用分段求和或申报值代替）',
      { measured })
  }

  // 5) stat 与 ffprobe 必须先一致（第三处在发布时由 putObject 的返回值补上）
  const statSize = fs.statSync(outPath).size
  if (statSize !== measured.sizeBytes) {
    throw err(PODCAST_EPISODE_ERRORS.SIZE_MISMATCH,
      '字节实测不一致（stat=' + statSize + ' ffprobe=' + measured.sizeBytes + '），已停止',
      { statSize, probeSize: measured.sizeBytes })
  }

  return {
    outPath,
    mime: plan.mime,
    codec: plan.codec,
    durationSec: measured.durationSec,
    durationText: formatDuration(measured.durationSec),
    sizeBytes: measured.sizeBytes,
    degraded,
  }
}

/**
 * 三处一致校验的最后一环。必须在 `putObject` **返回之后**调用：
 * 只有上传层回来的字节数与本地实测相同，才可以说「公网那份就是这个文件」。
 * 不相等即抛错——宁可让这一期停在 blocked，也不让 feed 里挂一个错的 length。
 */
function assertUploadSizeMatches (measuredSizeBytes, uploadedSizeBytes) {
  const a = Number(measuredSizeBytes)
  const b = Number(uploadedSizeBytes)
  if (!Number.isInteger(a) || !Number.isInteger(b) || a !== b) {
    throw err(PODCAST_EPISODE_ERRORS.SIZE_MISMATCH,
      '上传返回字节与本地实测不一致（local=' + a + ' uploaded=' + b + '），公网 feed 不应引用这一期',
      { localSize: a, uploadedSize: b })
  }
  return true
}

module.exports = {
  PODCAST_EPISODE_ERRORS,
  EXTRACT_TIMEOUT_MS,
  PROBE_TIMEOUT_MS,
  extractEpisodeAudio,
  assertUploadSizeMatches,
  runWithTimeout,
}
