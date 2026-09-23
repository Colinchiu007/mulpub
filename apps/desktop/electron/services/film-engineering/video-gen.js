// @ts-check
'use strict'
/**
 * film-engineering video-gen - 分镜视频生成阶段（film_generate_videos）
 *
 * 合同（openspec change: film-engineering-video-gen）：
 *   - 提示词原文直送：kit/剧本套用提示词（含 <<<uuid>>> 令牌）逐字符不变提交视频 provider，
 *     MUST NOT 经过 prompt-engine 视频优化链路（video-prompt-engine 豁免边界）；
 *   - provider 统一取默认视频能力（getDefault('video')），kit model 字段仅展示不路由；
 *     未配置 → VIDEO_MODEL_NOT_CONFIGURED fail-closed + 模型设置引导；
 *   - 画幅 16x9（默认）/9x16/source；时长全局 5/8/10s（默认 5s）→ 帧数映射；
 *   - 单批上限 MAX_VIDEO_BATCH=10；提交→轮询（10s 间隔 / 10min 上限）→下载 shot_NNN.mp4；
 *   - 部分失败以 partialFailure 继续，逐镜标注原因（单镜重试见 retry 通道）；
 *   - 成本确认入口闸（D2）：context.cost_confirmation.confirmed !== true 时阶段先行返回
 *     等待态 output（awaitingConfirmation + costCheck 逐镜清单），零 provider 调用；
 *     引擎按 stageDef checkpointRequired:true 将其转为 checkpoint 暂停，确认后重入同阶段真实生成。
 *
 * 注册方式：container.setup.js 中调用 registerFilmVideoStages(pipelineEngine)
 *（与 registerFilmEngineeringStages 并列；film_render 见 film-render.js）
 */

const fs = require('fs')
const os = require('os')
const path = require('path')
const { mapWithModelBudget, withModelBudget } = require('../model-call-scheduler')
const { emitStageStart, emitStageItem, emitStageComplete } = require('../stage-progress')
const { resolveProviderDefaultModel } = require('../model-provider-manager')

const FILM_VIDEO_STAGE_TYPES = {
  GENERATE_VIDEOS: 'film_generate_videos',
  RENDER: 'film_render',
}

const MAX_VIDEO_BATCH = 10
const FILM_ASPECTS = Object.freeze(['16x9', '9x16', 'source'])
const FILM_DURATIONS = Object.freeze([5, 8, 10])
const DEFAULT_FILM_SECONDS = 5
const FILM_FRAME_RATE = 24
const POLL_INTERVAL_MS = 10 * 1000
const POLL_DEADLINE_MS = 10 * 60 * 1000

/** 本次 run 受控媒体目录（与 story2video/videogen 同层的 film-engineering 根） */
function getFilmRunDir (runId) {
  return path.join(os.tmpdir(), 'film-engineering', String(runId || 'run'))
}

/** 时长（秒）→ 帧数映射（与 videogen 同表语义） */
function pickFilmFrameCount (seconds) {
  const d = Number(seconds)
  if (!Number.isFinite(d) || d <= 0) return 121
  if (d <= 5) return 121
  if (d <= 8) return 201
  if (d <= 10) return 241
  return 441
}

/**
 * 构建单镜提交载荷：prompt 逐字符原文；画幅映射 width/height（source 不下发尺寸）；
 * numFrames/frameRate 双写命名兼容（agnes 读驼峰、ltx 读下划线，沿用 videogen 载荷形状）。
 */
function buildShotSubmitPayload ({ shot, aspect, seconds, model }) {
  const numFrames = pickFilmFrameCount(seconds)
  /** @type {Record<string, unknown>} */
  const payload = {
    prompt: shot.prompt,
    numFrames,
    frameRate: FILM_FRAME_RATE,
    num_frames: numFrames,
    frame_rate: FILM_FRAME_RATE,
  }
  if (model) payload.model = model
  if (aspect === '16x9') {
    payload.width = 1280
    payload.height = 720
  } else if (aspect === '9x16') {
    payload.width = 720
    payload.height = 1280
  }
  return payload
}

function getAiGenerator (pipelineEngine) {
  return pipelineEngine.aiGenerator ||
    (pipelineEngine.container && typeof pipelineEngine.container.get === 'function'
      ? pipelineEngine.container.get('aiGenerator')
      : null)
}

/**
 * 解析默认视频 provider（双默认语义：用户默认 > 运营默认 > capability_models.video > models[0]）。
 * @returns {{ providerId: string, model: string, manager: object } | null}
 */
function resolveFilmVideoProvider (aiGenerator) {
  const manager = aiGenerator && aiGenerator._modelProviderManager
  const provider = manager && typeof manager.getDefault === 'function'
    ? manager.getDefault('video')
    : null
  if (!provider || typeof provider.id !== 'string' || !provider.id.trim()) return null
  const model = resolveProviderDefaultModel(provider, 'video')
  return { providerId: provider.id.trim(), model: model || '', manager }
}

/** 下载远端视频到本地（http/https，3xx 跟随一次 Location） */
async function downloadToFile (url, dest) {
  const http = require('http')
  const https = require('https')
  return new Promise((resolve, reject) => {
    const lib = String(url).startsWith('https:') ? https : http
    const file = fs.createWriteStream(dest)
    const request = lib.get(url, (response) => {
      if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        file.close()
        fs.unlinkSync(dest)
        downloadToFile(response.headers.location, dest).then(resolve, reject)
        return
      }
      if (response.statusCode !== 200) {
        file.close()
        fs.unlinkSync(dest)
        reject(new Error('视频下载失败，HTTP ' + response.statusCode))
        return
      }
      response.pipe(file)
      file.on('finish', () => { file.close(); resolve(dest) })
    })
    request.on('error', (err) => {
      file.close()
      if (fs.existsSync(dest)) fs.unlinkSync(dest)
      reject(err)
    })
  })
}

/**
 * 单镜生成：提交 → 轮询 → 下载。sleep/download 可注入（测试零等待 + 假落盘）。
 * 失败不抛出，统一返回 { index, shotId, success, path? , error? }。
 */
async function generateShotVideo ({ shot, index, runDir, aspect, seconds, providerCfg, providerRunContext, sleep, download, log }) {
  const sleepFn = sleep || ((ms) => new Promise((r) => setTimeout(r, ms)))
  const downloadFn = download || downloadToFile
  // 单镜失败统一出口：先记 warn（镜头序号 + shotId + 可辨识原因）再返回，杜绝静默失败
  const noteFail = (reason) => {
    if (log && typeof log.warn === 'function') {
      log.warn('FilmVideoGen', 'shot ' + index + ' (' + shot.shotId + ') failed: ' + reason)
    }
    return { index, shotId: shot.shotId, success: false, error: reason }
  }
  try {
    const payload = buildShotSubmitPayload({ shot, aspect, seconds, model: providerCfg.model })
    const submit = await providerCfg.manager.callAdapter(
      providerCfg.providerId, 'generateVideo', payload,
      providerRunContext ? { providerRunContext } : undefined,
    )
    // callAdapter 双层失败合同（外层 code!==0；内层 adapter 异常被包装 data.code<0）
    if (submit && submit.code !== 0) {
      return noteFail(submit.message || ('视频生成调用失败（provider: ' + providerCfg.providerId + '）'))
    }
    const data = submit && submit.data
    if (data && typeof data === 'object' && (data.code === -1 || data.code < 0)) {
      return noteFail(data.message || data.error || '视频生成失败（provider: ' + providerCfg.providerId + '）')
    }
    const taskId = data && (data.taskId || data.videoId || data.id || data.task_id)
    if (!taskId) {
      return noteFail('视频生成未返回任务 ID（provider: ' + providerCfg.providerId + '）')
    }
    const pollDeadline = Date.now() + POLL_DEADLINE_MS
    let videoUrl = null
    while (Date.now() < pollDeadline) {
      await sleepFn(POLL_INTERVAL_MS)
      const status = await providerCfg.manager.callAdapter(
        providerCfg.providerId, 'getVideoStatus', { videoId: taskId, taskId },
        providerRunContext ? { providerRunContext } : undefined,
      )
      const url = status && (status.videoUrl || status.url || (status.data && (status.data.videoUrl || status.data.url)))
      if (url) { videoUrl = url; break }
      const state = String((status && (status.status || (status.data && status.data.status))) || '').toLowerCase()
      if (['failed', 'error', 'cancelled'].includes(state)) break
    }
    if (!videoUrl) {
      return noteFail('视频生成超时或失败（provider: ' + providerCfg.providerId + '）')
    }
    const dest = path.join(runDir, 'shot_' + String(index).padStart(3, '0') + '.mp4')
    await downloadFn(videoUrl, dest)
    if (log && typeof log.info === 'function') {
      log.info('FilmVideoGen', 'shot ' + index + ' (' + shot.shotId + ') generated: ' + dest)
    }
    return { index, shotId: shot.shotId, success: true, path: dest }
  } catch (error) {
    return noteFail((error && error.message) ? error.message : String(error))
  }
}

/**
 * 注册 film_generate_videos 阶段执行器
 * @param {object} pipelineEngine - PipelineEngine 实例
 * @returns {{success: boolean, error?: string, registered?: string[]}}
 */
function registerFilmVideoStages (pipelineEngine) {
  if (!pipelineEngine || !pipelineEngine.stageExecutor) {
    return { success: false, error: 'PipelineEngine.stageExecutor not configured (ServiceBus missing)' }
  }
  const log = pipelineEngine.log && typeof pipelineEngine.log.warn === 'function'
    ? pipelineEngine.log
    : { info () {}, warn () {}, error () {} }

  pipelineEngine.registerStageExecutor(
    FILM_VIDEO_STAGE_TYPES.GENERATE_VIDEOS,
    async ({ runId, stage, params, context, onProgress, _testSleep, _testDownload }) => {
      emitStageStart(onProgress, { messageKey: 'stageProgress.filmGenerateVideosStart' })
      const shots = (context && Array.isArray(context.selectedShots)) ? context.selectedShots : []
      // 全量出片收口合成 run（组 8，任务 7.2 收口链）：无 selectedShots 但携带 renderManifest 时
      // 直通成本闸（零 provider 调用、不产 costCheck），后续 render 阶段按 manifest 跨 run 聚合合成。
      if (shots.length === 0 && Array.isArray(context && context.renderManifest) && context.renderManifest.length > 0) {
        return {
          success: true,
          // 零计费直通 run 对成本确认入口闸无意义：显式声明 checkpoint:false，
          // 引擎（_executeStage）尊重该字段不再按 stageDefs.checkpointRequired 暂停（9.3 冒烟回归）。
          checkpoint: false,
          output: { manifestMode: true, entryCount: context.renderManifest.length },
        }
      }
      if (shots.length === 0) {
        return { success: false, error: 'film_generate_videos 需要 context.selectedShots（先执行 film_select_shots）' }
      }
      if (shots.length > MAX_VIDEO_BATCH) {
        return { success: false, error: 'film_generate_videos 一次最多生成 ' + MAX_VIDEO_BATCH + ' 个分镜（当前 ' + shots.length + '）' }
      }
      for (const s of shots) {
        if (!s || typeof s.prompt !== 'string' || !s.prompt.trim()) {
          return { success: false, error: 'film_generate_videos 分镜提示词为空: ' + (s && s.shotId ? s.shotId : '未知分镜') }
        }
      }
      const aspect = (params && params.aspect) || (stage && stage.options && stage.options.aspect) || '16x9'
      if (!FILM_ASPECTS.includes(aspect)) {
        return { success: false, error: 'aspect 非法: ' + aspect + '（可选 ' + FILM_ASPECTS.join('/') + '）' }
      }
      const seconds = Number((params && params.seconds) || (stage && stage.options && stage.options.seconds) || DEFAULT_FILM_SECONDS)
      if (!FILM_DURATIONS.includes(seconds)) {
        return { success: false, error: 'seconds 非法: ' + seconds + '（可选 ' + FILM_DURATIONS.join('/') + '）' }
      }
      const providerCfg = resolveFilmVideoProvider(getAiGenerator(pipelineEngine))
      if (!providerCfg) {
        return {
          success: false,
          errorCode: 'VIDEO_MODEL_NOT_CONFIGURED',
          error: '影视工程视频生成需要视频模型（如 Seedance / Kling / Veo / CogVideo 等），请在模型设置中配置并设为默认视频 Provider 后重试',
        }
      }
      // 成本确认入口闸：未确认时只产出确认卡载荷，不发生任何 provider 调用（所有路径同受闸）
      const costConfirmed = !!(context && context.cost_confirmation && context.cost_confirmation.confirmed === true)
      if (!costConfirmed) {
        return {
          success: true,
          output: {
            awaitingConfirmation: true,
            costCheck: {
              totalShots: shots.length,
              maxBatch: MAX_VIDEO_BATCH,
              aspect,
              seconds,
              providerId: providerCfg.providerId,
              model: providerCfg.model || '',
              shots: shots.map((s, i) => ({
                index: i,
                shotId: s.shotId,
                title: s.title || '',
                aspect,
                seconds,
              })),
            },
          },
        }
      }
      const runDir = getFilmRunDir(runId)
      fs.mkdirSync(runDir, { recursive: true })

      /** @type {Array<{index: number, shotId: string, success: boolean, path?: string, error?: string}>} */
      let results
      try {
        const manager = providerCfg.manager
        const governor = pipelineEngine.governor
        const provider = typeof manager.getProvider === 'function' ? manager.getProvider(providerCfg.providerId) : null
        const requestedConcurrency = Number(stage && stage.options && stage.options.videoConcurrency) > 0
          ? Number(stage.options.videoConcurrency) : 2
        results = await mapWithModelBudget({
          items: shots,
          requestedConcurrency,
          fallbackConcurrency: 2,
          type: 'video',
          providerId: providerCfg.providerId,
          provider,
          manager,
          governor,
          fn: (shot, index) => withModelBudget(
            { governor, type: 'video', providerId: providerCfg.providerId, model: providerCfg.model },
            () => generateShotVideo({
              shot, index, runDir, aspect, seconds, providerCfg,
              sleep: _testSleep, download: _testDownload, log,
            }),
          ),
        })
        results = results.filter(Boolean)
      } catch (error) {
        // 预算调度器异常时降级串行，保结果顺序（合同不依赖并发度）
        log.warn('FilmVideoGen', 'mapWithModelBudget 失败，降级串行: ' + ((error && error.message) || error))
        results = []
        for (let i = 0; i < shots.length; i++) {
          results.push(await generateShotVideo({
            shot: shots[i], index: i, runDir, aspect, seconds, providerCfg,
            sleep: _testSleep, download: _testDownload, log,
          }))
        }
      }

      let done = 0
      for (const r of results) {
        if (r.success) {
          done += 1
          emitStageItem(onProgress, done, shots.length, {
            messageKey: 'stageProgress.filmGenerateVideos',
            kind: 'video',
            percentStart: 0,
            percentEnd: 100,
          })
        }
      }
      const ok = results.filter(r => r.success)
      if (ok.length === 0) {
        return { success: false, error: '影视工程分镜视频全部失败：' + results.map(r => r.error).join('；') }
      }
      emitStageComplete(onProgress, {
        messageKey: 'stageProgress.filmGenerateVideosComplete',
        summaryKey: ok.length === shots.length ? 'stageProgress.filmGenerateVideosSummary' : 'stageProgress.filmGenerateVideosPartialSummary',
        summaryParams: { done: ok.length, total: shots.length },
      })
      return {
        success: true,
        output: {
          videoResults: results,
          runDir,
          partialFailure: ok.length < shots.length,
        },
      }
    },
  )

  return { success: true, registered: [FILM_VIDEO_STAGE_TYPES.GENERATE_VIDEOS] }
}

module.exports = {
  FILM_VIDEO_STAGE_TYPES,
  MAX_VIDEO_BATCH,
  FILM_ASPECTS,
  FILM_DURATIONS,
  getFilmRunDir,
  pickFilmFrameCount,
  buildShotSubmitPayload,
  resolveFilmVideoProvider,
  generateShotVideo,
  registerFilmVideoStages,
}
