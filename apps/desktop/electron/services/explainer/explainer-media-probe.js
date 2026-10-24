// @ts-check
/**
 * explainer-media-probe — 成片的**产物有效性**探测（IO 层）
 *
 * ## 为什么要有这一层
 *
 * 产出型工具的成败判据是**产物有效性**，不是进程退出码。
 * ⚠ 仓内既有事实：Remotion 渲染实测「CLI 抛 TimeoutError 但 mp4 完全有效」
 *   ⇒ 只读 rc 的一方会把一次成功报成失败。
 *
 * ## 「有音轨」对静音缺陷完全失明
 *
 * 数字静音同样产出完整的音频流 ⇒ 只断言「有音频流」对静音缺陷**完全失明**。
 * ⇒ 必须用**响度读数**判：数字静音约 −91 dB，真人旁白约 −30 dB，极静环境音约 −79 dB。
 * ⇒ 阈值取 **−85 dB**（比数字静音高 6 dB、比极静环境音低 4 dB）⇒ 环境音不误判、静音被抓住。
 * ⚠ 阈值是**实测标定**的，不是拍脑袋 ⇒ 它写进产物 `metadata`，可复核。
 *
 * ## 诚实边界：哪些判不了
 *
 * `unreadable_text`（画面里的文字是否可读）、`broken_overlays`、`missing_assets`
 * 需要**视觉理解**，不是 ffprobe/ffmpeg 能判的。
 * ⇒ 本模块**不假装能判**：统一返回 false，并把「未执行的检查」登记进
 *   `metadata.checks_not_performed` ⇒ 读报告的人一眼看到「这三项没人看过」。
 *   （这正是上游 final_review 由 agent 做、而机械层只兜底技术项的分工。）
 */

'use strict'

const { execFile } = require('child_process')
const fs = require('fs')
const path = require('path')
const { findFfmpeg, findFfprobe } = require('../media-tool-paths')

/** 数字静音下界上方的判定阈值（dB）—— 实测标定，见文件头 */
const SILENCE_THRESHOLD_DB = -85
/** 抽帧数量下限（上游 final_review schema：frames_sampled minimum = 4） */
const MIN_SAMPLED_FRAMES = 4

function execTool (binary, args, timeoutMs = 120000) {
  return new Promise((resolve) => {
    execFile(binary, args, { maxBuffer: 32 * 1024 * 1024, timeout: timeoutMs }, (error, stdout, stderr) => {
      resolve({ ok: !error, stdout: String(stdout || ''), stderr: String(stderr || ''), error })
    })
  })
}

/** 解析 ffprobe 的 `avg_frame_rate`（形如 "30/1"） */
function parseRate (raw) {
  const text = String(raw || '').trim()
  if (!text) return null
  const parts = text.split('/')
  const num = Number(parts[0])
  const den = Number(parts[1] || 1)
  if (!Number.isFinite(num) || !Number.isFinite(den) || den === 0) return null
  return Number((num / den).toFixed(3))
}

/**
 * 探测容器与流信息。
 * @param {string} inputPath
 * @returns {Promise<object>} {valid_container, duration_seconds, resolution, fps, has_audio, codec, file_size_bytes, issues[]}
 */
async function probeContainer (inputPath) {
  const issues = []
  const empty = {
    valid_container: false,
    duration_seconds: 0,
    resolution: '',
    fps: null,
    has_audio: false,
    codec: '',
    file_size_bytes: 0,
    issues,
  }
  if (!inputPath || !fs.existsSync(inputPath)) {
    issues.push('产物文件不存在：' + String(inputPath || '(空)'))
    return empty
  }
  const ffprobe = findFfprobe()
  if (!ffprobe) {
    issues.push('ffprobe 不可用，无法探测产物')
    return empty
  }
  const result = await execTool(ffprobe, [
    '-v', 'error',
    '-show_entries', 'format=duration,size,format_name',
    '-show_entries', 'stream=codec_type,codec_name,width,height,avg_frame_rate,channels,sample_rate',
    '-of', 'json',
    inputPath,
  ])
  if (!result.ok) {
    issues.push('ffprobe 失败：' + (result.stderr || '').trim().slice(0, 300))
    return empty
  }
  let parsed
  try {
    parsed = JSON.parse(result.stdout)
  } catch (error) {
    issues.push('ffprobe 输出无法解析为 JSON')
    return empty
  }
  const format = parsed.format || {}
  const streams = Array.isArray(parsed.streams) ? parsed.streams : []
  const video = streams.find(s => s.codec_type === 'video')
  const audio = streams.find(s => s.codec_type === 'audio')

  const duration = Number(format.duration)
  if (!Number.isFinite(duration) || duration <= 0) issues.push('ffprobe 读不到有效时长')
  if (!video) issues.push('产物里没有视频流')

  return {
    valid_container: Boolean(video) && Number.isFinite(duration) && duration > 0,
    duration_seconds: Number.isFinite(duration) ? Number(duration.toFixed(3)) : 0,
    resolution: video && video.width ? String(video.width) + 'x' + String(video.height) : '',
    fps: video ? parseRate(video.avg_frame_rate) : null,
    has_audio: Boolean(audio),
    codec: video ? String(video.codec_name || '') : '',
    file_size_bytes: Number(format.size) || (fs.existsSync(inputPath) ? fs.statSync(inputPath).size : 0),
    issues,
  }
}

/**
 * 抽帧 + 黑帧检测。
 *
 * ⚠ `unreadable_text` / `broken_overlays` / `missing_assets` **不判**（需视觉理解）
 *   ⇒ 返回 false 并登记到 `checks_not_performed`。
 *
 * @param {string} inputPath
 * @param {{ outDir?: string, count?: number, durationSeconds?: number }} options
 */
async function sampleFrames (inputPath, options = {}) {
  const count = Math.max(MIN_SAMPLED_FRAMES, Number(options.count) || MIN_SAMPLED_FRAMES)
  const outDir = options.outDir || path.join(path.dirname(inputPath), 'explainer-frames')
  const checksNotPerformed = ['unreadable_text', 'broken_overlays', 'missing_assets']
  const result = {
    frames_sampled: 0,
    frame_paths: [],
    black_frames_detected: false,
    broken_overlays: false,
    missing_assets: false,
    unreadable_text: false,
    issues: [],
    checks_not_performed: checksNotPerformed,
  }
  if (!inputPath || !fs.existsSync(inputPath)) {
    result.issues.push('产物文件不存在，无法抽帧')
    return result
  }
  const ffmpeg = findFfmpeg()
  if (!ffmpeg) {
    result.issues.push('ffmpeg 不可用，无法抽帧')
    return result
  }
  try {
    fs.mkdirSync(outDir, { recursive: true })
  } catch (error) {
    result.issues.push('无法创建抽帧目录：' + String(error && error.message))
    return result
  }

  const duration = Number(options.durationSeconds) || 0
  const positions = []
  for (let i = 0; i < count; i++) {
    positions.push(duration > 0 ? (duration * (i + 0.5)) / count : 0)
  }

  for (let i = 0; i < positions.length; i++) {
    const outPath = path.join(outDir, 'frame-' + (i + 1) + '.png')
    const run = await execTool(ffmpeg, [
      '-y', '-ss', String(positions[i].toFixed(3)), '-i', inputPath,
      '-frames:v', '1', outPath,
    ], 60000)
    if (run.ok && fs.existsSync(outPath) && fs.statSync(outPath).size > 0) {
      result.frames_sampled++
      result.frame_paths.push(outPath)
    } else {
      result.issues.push('第 ' + (i + 1) + ' 帧抽取失败（位置 ' + positions[i].toFixed(2) + ' 秒）')
    }
  }

  // 黑帧检测：blackdetect 扫全片
  const black = await execTool(ffmpeg, [
    '-i', inputPath, '-vf', 'blackdetect=d=0.2:pix_th=0.10', '-an', '-f', 'null', '-',
  ], 180000)
  if (black.ok && /black_start:/.test(black.stderr)) {
    result.black_frames_detected = true
    result.issues.push('检测到黑帧区间（blackdetect 有命中）')
  }

  if (result.frames_sampled < MIN_SAMPLED_FRAMES) {
    result.issues.push('只抽到 ' + result.frames_sampled + ' 帧，少于下游 schema 要求的 ' + MIN_SAMPLED_FRAMES + ' 帧')
  }
  return result
}

/**
 * 响度测量（`volumedetect`）。
 * @param {string} inputPath
 * @returns {Promise<{mean_volume_db:number|null,max_volume_db:number|null,is_silent:boolean,has_audio:boolean,issues:string[]}>}
 */
async function measureLoudness (inputPath) {
  const issues = []
  const result = { mean_volume_db: null, max_volume_db: null, is_silent: false, has_audio: false, issues }
  if (!inputPath || !fs.existsSync(inputPath)) {
    issues.push('产物文件不存在，无法测量响度')
    return result
  }
  const ffmpeg = findFfmpeg()
  if (!ffmpeg) {
    issues.push('ffmpeg 不可用，无法测量响度')
    return result
  }
  const run = await execTool(ffmpeg, [
    '-i', inputPath, '-af', 'volumedetect', '-vn', '-f', 'null', '-',
  ], 180000)
  const text = run.stderr || ''
  const meanMatch = text.match(/mean_volume:\s*(-?[\d.]+) dB/)
  const maxMatch = text.match(/max_volume:\s*(-?[\d.]+) dB/)
  if (meanMatch) result.mean_volume_db = Number(meanMatch[1])
  if (maxMatch) result.max_volume_db = Number(maxMatch[1])
  if (!meanMatch) {
    issues.push('volumedetect 没有输出 mean_volume（可能没有音频流）')
    return result
  }
  result.has_audio = true
  result.is_silent = result.mean_volume_db < SILENCE_THRESHOLD_DB
  if (result.is_silent) {
    issues.push('音轨平均响度 ' + result.mean_volume_db + ' dB 低于阈值 ' + SILENCE_THRESHOLD_DB +
      ' dB，判定为静音（数字静音约 −91 dB）')
  }
  return result
}

module.exports = {
  SILENCE_THRESHOLD_DB,
  MIN_SAMPLED_FRAMES,
  execTool,
  parseRate,
  probeContainer,
  sampleFrames,
  measureLoudness,
}
