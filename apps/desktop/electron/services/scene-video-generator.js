// @ts-check
'use strict'
/**
 * scene-video-generator.js — 单场景 AI 视频生成（提交 → 轮询 → 下载 → 校验）
 *
 * ## 为什么从 story2video-stages.js 抽出来
 *
 * `story2video-stages.js` 在 `.github/scripts/max-lines-baseline.json` 的 `targets`
 * 清单里是「点名还账」条目（target=4081、**容差 0**）——在该文件里**加一行**就会让
 * 主干的「债务熔断门禁」变红 ⇒ required check 连带红 ⇒ **全仓 open PR 一起被挡**。
 *
 * 本模块要做的恰恰是「给 generateSceneVideo 加参数」——那必然要加行。
 * 与其抬天花板（把债推给下一个碰到它的人），不如**把这段逻辑抽到独立文件**：
 * 抽取后 story2video-stages.js 低于 target ⇒ 债务已还，target 条目保持不动。
 *
 * 抽取边界按**依赖闭包**切分，保证原文件侧不留悬空引用：
 *   迁出：generateSceneVideo / pickFrameCountForSceneDuration / downloadVideoToFile /
 *         probeVideoFile / runTool / MAX_VIDEO_FILE_BYTES
 *   留在原文件：probeAudioFile（自带 execFileAsync，不用 runTool）、sleep（被 7 处使用）
 *
 * ## 契约
 *
 * 返回形状与抽取前**完全一致**（对外 API 不变）：
 *   成功 → { success: true, path }
 *   失败 → { success: false, error }
 *
 * 扩展点（2026-10-23）：新增模式与媒体参数透传 + onProgress 阶段回调。
 * 透传规则：**有值才写键**——不传扩展参数时，提交给适配器的参数集与扩展前逐字段相同。
 */

const { execFile } = require('child_process')
const fs = require('fs')
const http = require('http')
const https = require('https')
const path = require('path')

// 视频下载大小上限（与 story2video-paths MEDIA_RULES.video 一致：512MB）
const MAX_VIDEO_FILE_BYTES = 512 * 1024 * 1024

/** 轮询总时限（10 分钟） */
const POLL_DEADLINE_MS = 10 * 60 * 1000

/** 进度阶段文案（渲染层直接展示；percent 与服务端 progress 同源，不伪造连续增长） */
const PROGRESS_STAGES = Object.freeze({
  SUBMITTING: '提交视频生成任务',
  QUEUED: '排队中',
  GENERATING: '生成中',
  DOWNLOADING: '下载成片',
  COMPLETED: '完成',
})

/** 毫秒级等待 */
function sleep (ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** 场景估算时长 → 视频生成帧数档位（24fps 近似，满足 8n+1 规则的保守取值）。 */
function pickFrameCountForSceneDuration (durationSeconds) {
  const d = Number(durationSeconds)
  if (!Number.isFinite(d) || d <= 0) return 121
  if (d <= 5) return 121
  if (d <= 8) return 201
  if (d <= 10) return 241
  return 441
}

/**
 * 下载视频到本地。守卫（2026-08-11 W5）：仅 http/https、重定向 ≤5 跳、流式写入按字节上限截断。
 * @param {string} url
 * @param {string} dest
 * @param {object} [options] - { maxBytes?, maxRedirects? }
 */
function downloadVideoToFile (url, dest, options = {}) {
  const maxBytes = Number.isFinite(Number(options.maxBytes)) && Number(options.maxBytes) > 0 ? Number(options.maxBytes) : Infinity
  const maxRedirects = Number.isFinite(Number(options.maxRedirects)) ? Number(options.maxRedirects) : 5
  const follow = (currentUrl, redirectsLeft) => new Promise((resolve, reject) => {
    if (!/^https?:/i.test(currentUrl)) {
      reject(new Error('视频下载仅允许 http/https 协议'))
      return
    }
    const protocol = /^https:/i.test(currentUrl) ? https : http
    const request = protocol.get(currentUrl, (response) => {
      if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        response.resume()
        if (redirectsLeft <= 0) {
          reject(new Error('视频下载重定向次数超过上限'))
          return
        }
        follow(String(response.headers.location), redirectsLeft - 1).then(resolve, reject)
        return
      }
      if (response.statusCode !== 200) {
        response.resume()
        reject(new Error('视频下载失败，HTTP ' + response.statusCode))
        return
      }
      let written = 0
      let aborted = false
      const stream = fs.createWriteStream(dest)
      response.on('data', (chunk) => {
        written += chunk.length
        if (written > maxBytes) {
          aborted = true
          response.destroy()
          stream.destroy()
          fs.unlink(dest, () => {})
          reject(new Error('视频下载超过大小上限'))
          return
        }
        stream.write(chunk)
      })
      response.on('end', () => {
        if (aborted) return
        stream.end(() => stream.close(() => resolve(dest)))
      })
      stream.on('error', (error) => {
        fs.unlink(dest, () => {})
        reject(error)
      })
    })
    request.on('error', reject)
  })
  return follow(url, maxRedirects)
}

/** 用捆绑 ffprobe 校验视频可解码（存在视频流即可；损坏文件快速失败）。 */
async function probeVideoFile (videoPath) {
  const { findFfprobe } = require('./media-tool-paths')
  const ffprobe = findFfprobe()
  if (!ffprobe) return
  await runTool(ffprobe, ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=codec_type', '-of', 'csv=p=0', videoPath])
}

function runTool (binary, args) {
  return new Promise((resolve, reject) => {
    execFile(binary, args, { timeout: 30000, maxBuffer: 4 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(String(stderr || error.message).slice(0, 1200)))
        return
      }
      const output = String(stdout || '').trim()
      if (!output.includes('video')) {
        reject(new Error('视频文件缺少视频流'))
        return
      }
      resolve(output)
    })
  })
}

/**
 * 构造提交给 provider 适配器的参数。
 *
 * 透传规则：**有值才写键**。未传扩展参数时，返回的参数集与抽取前逐字段相同
 * （prompt / model / width / height / numFrames / frameRate / num_frames / frame_rate）。
 *
 * @param {object} input
 * @returns {Record<string, unknown>}
 */
function buildSubmitParams (input) {
  const {
    prompt, model, size, frameRate, numFrames,
    mode, images, audios, videos, firstFrame, lastFrame, aspectRatio, seed, seconds, sizeTier,
  } = input
  const submitParams = {
    prompt,
    model: model || undefined,
    width: size.width,
    height: size.height,
    numFrames,
    frameRate,
    num_frames: numFrames,
    frame_rate: frameRate,
  }
  if (mode) submitParams.mode = mode
  if (Array.isArray(images) && images.length > 0) submitParams.images = images
  if (Array.isArray(audios) && audios.length > 0) submitParams.audios = audios
  if (Array.isArray(videos) && videos.length > 0) submitParams.videos = videos
  if (firstFrame) {
    submitParams.firstFrame = firstFrame
    submitParams.first_frame = firstFrame
    // 供只认单张 `image` 的旧版适配器使用（如 agnes-video v2.0 的 img2video）
    submitParams.image = firstFrame
  }
  if (lastFrame) {
    submitParams.lastFrame = lastFrame
    submitParams.last_frame = lastFrame
  }
  if (aspectRatio) {
    submitParams.aspectRatio = aspectRatio
    submitParams.aspect_ratio = aspectRatio
  }
  // 分辨率档位（sizeTier）：不被模型支持的档位由适配器按能力描述拒收（本地拦截，不发无谓请求）
  if (sizeTier) submitParams.size = sizeTier
  // seed=0 是合法随机种子 ⇒ 用 != null 判空，不能用 ||
  if (seed !== null && seed !== undefined) submitParams.seed = seed
  // 显式 seconds 优先于由帧数推导的时长
  if (seconds !== null && seconds !== undefined && seconds !== '') {
    submitParams.seconds = Number(seconds)
  }
  return submitParams
}

/**
 * 单场景 AI 视频生成：generateVideo 提交 → getVideoStatus 轮询（≤10 分钟）→ 下载落盘。
 * 与 videogen-stages GENERATE 阶段同一契约（复用 provider 适配器能力）。
 *
 * @param {object} params
 * @param {object} params.manager
 * @param {string} params.providerId
 * @param {string} [params.model]
 * @param {string} params.prompt
 * @param {number} params.index
 * @param {number} [params.seconds]
 * @param {{width: number, height: number}} params.size
 * @param {number} [params.fps]
 * @param {string} params.runDir
 * @param {number} [params.pollIntervalMs]
 * @param {object} [params.providerRunContext]
 * @param {string} [params.mode] - text / keyframe / reference
 * @param {string[]} [params.images] - reference 模式参考图
 * @param {string[]} [params.audios] - reference 模式参考音频
 * @param {Array} [params.videos] - reference 模式参考视频
 * @param {string} [params.firstFrame] / [params.lastFrame] - keyframe 首尾帧
 * @param {string} [params.aspectRatio]
 * @param {number} [params.seed]
 * @param {(percent: number, stage: string) => void} [params.onProgress]
 * @returns {Promise<{success: true, path: string} | {success: false, error: string}>}
 */
async function generateSceneVideo ({
  manager, providerId, model, prompt, index, seconds, size, fps, runDir, pollIntervalMs, providerRunContext,
  mode, images, audios, videos, firstFrame, lastFrame, aspectRatio, seed, sizeTier, onProgress,
}) {
  const frameRate = Number(fps) > 0 ? Number(fps) : 24
  const pollInterval = Number.isFinite(Number(pollIntervalMs)) && Number(pollIntervalMs) > 0 ? Number(pollIntervalMs) : 10000
  const numFrames = pickFrameCountForSceneDuration(seconds)
  const submitParams = buildSubmitParams({
    prompt, model, size, frameRate, numFrames,
    mode, images, audios, videos, firstFrame, lastFrame, aspectRatio, seed, seconds, sizeTier,
  })
  const report = typeof onProgress === 'function' ? onProgress : null
  if (report) report(2, PROGRESS_STAGES.SUBMITTING)
  const submit = providerRunContext
    ? await manager.callAdapter(providerId, 'generateVideo', submitParams, { providerRunContext })
    : await manager.callAdapter(providerId, 'generateVideo', submitParams)
  if (submit && submit.code !== 0) {
    return { success: false, error: (submit && submit.message) || ('视频生成调用失败（provider: ' + providerId + '）') }
  }
  const data = submit && submit.data
  // 适配器外层 code=0 但内层可能返回 { code: -1, message }（如 MiniMax 特殊套餐的 Missing task_id），
  // 此时 data.taskId 为空，必须透传适配器的真实错误消息，避免吞成「视频生成未返回任务 ID」。
  if (data && typeof data === 'object' && (Number(data.code) < 0 || data.success === false)) {
    return { success: false, error: (data.message || data.error || '视频生成失败（provider: ' + providerId + '）') }
  }
  const taskId = data && (data.taskId || data.videoId)
  if (!taskId) {
    return { success: false, error: '视频生成未返回任务 ID' + (data && data.message ? '：' + data.message : '') }
  }
  const pollDeadline = Date.now() + POLL_DEADLINE_MS
  let videoUrl = null
  let pollError = ''
  while (Date.now() < pollDeadline) {
    await sleep(pollInterval)
    // model 一并回传：查询接口要求 model_name 与提交时一致，
    // 而适配器内的「任务 ID → 模型」映射是进程内的（适配器重启即失效），跨重启续查只能靠它。
    const statusParams = { videoId: taskId, taskId, model: model || undefined }
    const status = providerRunContext
      ? await manager.callAdapter(providerId, 'getVideoStatus', statusParams, { providerRunContext })
      : await manager.callAdapter(providerId, 'getVideoStatus', statusParams)
    // provider 显式报错（code<0 / success=false，无 URL）视为终止态，避免空转整轮 10 分钟（2026-08-11 W3）
    if (status && (Number(status.code) < 0 || status.success === false)) {
      pollError = (status && status.message) || '视频生成任务失败（provider: ' + providerId + '）'
      break
    }
    const url = status && (status.videoUrl || status.url || (status.data && (status.data.videoUrl || status.data.url)))
    if (url) { videoUrl = url; break }
    const state = status && (status.status || (status.data && status.data.status)) || ''
    if (['failed', 'error', 'cancelled'].includes(String(state).toLowerCase())) {
      pollError = '视频生成任务状态为 ' + String(state) + '（provider: ' + providerId + '）'
      break
    }
    if (report) {
      // 服务端 progress 只有 10 / 100 两档 ⇒ 百分比如实透传，不伪造连续增长；
      // 「排队中 / 生成中」用 provider 的原始状态区分（适配器归一化后只剩 processing）。
      const rawState = String((status && status.providerStatus) || '').toLowerCase()
      const stage = rawState === 'queued' ? PROGRESS_STAGES.QUEUED : PROGRESS_STAGES.GENERATING
      const percent = Number(status && status.progress)
      report(Number.isFinite(percent) ? percent : 10, stage)
    }
  }
  if (!videoUrl) {
    return { success: false, error: pollError || '视频生成超时或失败（provider: ' + providerId + '）' }
  }
  if (report) report(90, PROGRESS_STAGES.DOWNLOADING)
  fs.mkdirSync(runDir, { recursive: true })
  const dest = path.join(runDir, 'scene_video_' + String(index).padStart(3, '0') + '.mp4')
  await downloadVideoToFile(videoUrl, dest, { maxBytes: MAX_VIDEO_FILE_BYTES })
  // 下载后校验：非空文件 + ffprobe 可解码，避免 HTML 错误页/截断文件伪装 mp4 拖到 compose 才暴露（2026-08-11 W4）
  if (!(fs.existsSync(dest) && fs.statSync(dest).size > 0)) {
    fs.unlink(dest, () => {})
    return { success: false, error: '视频下载结果为空或不可用' }
  }
  try {
    await probeVideoFile(dest)
  } catch (probeError) {
    fs.unlink(dest, () => {})
    return {
      success: false,
      error: '视频文件无法解码（' + (probeError && probeError.message ? probeError.message : String(probeError)).slice(0, 120) + '）',
    }
  }
  if (report) report(100, PROGRESS_STAGES.COMPLETED)
  return { success: true, path: dest }
}

module.exports = {
  generateSceneVideo,
  buildSubmitParams,
  pickFrameCountForSceneDuration,
  downloadVideoToFile,
  probeVideoFile,
  runTool,
  MAX_VIDEO_FILE_BYTES,
  PROGRESS_STAGES,
}
