// @ts-check
'use strict'

/**
 * digital-human-stages.js — 数字人（avatar-spokesperson）生成分支
 *
 * 存在理由（PRD-AVATAR-SPOKESPERSON-HEYGEN-WIRING-2026-10-19）：
 * avatar-spokesperson 的 generate 阶段此前复用通用文生视频链路——取
 * getDefault('video') 的通用模型、把用户主题当画面提示词、不传
 * character/voice/script。结果就是「数字人流水线其实在跑普通文生视频」。
 *
 * 本模块把数字人分支从 videogen-stages.js 抽出，两个理由：
 *  1. 语义边界清晰：数字人不需要「画面提示词 + prompt-engine 优化」，
 *     它需要（数字人形象 + 音色 + 口播文案）三要素，与通用分支是两套契约。
 *  2. videogen-stages.js 受 .github/scripts/check-max-lines.js 的挂账容差约束
 *     （登记值 975，容差 200），内联会把该文件推过线。
 */

const fs = require('fs')
const path = require('path')
const os = require('os')
const { execFile } = require('child_process')
const { emitStageItem, emitStageComplete } = require('./stage-progress')

/** 数字人流水线的机器名 */
const AVATAR_PIPELINE = 'avatar-spokesperson'

/**
 * 数字人 provider 固定为 HeyGen：仓库当前只有这一家数字人 adapter
 * （model-provider-seeds.js 中 category=video 里唯一带数字人语义的）。
 * 将来接第二家时把本常量换成 capability 解析即可，改动力仍集中在一处。
 * 允许 params.videoProvider 显式覆盖，保留人工指向其他数字人服务的口子。
 */
const DIGITAL_HUMAN_PROVIDER = 'heygen'

const VIDEO_POLL_TIMEOUT_MS = 10 * 60 * 1000
const VIDEO_POLL_INTERVAL_MS = 10 * 1000
const TERMINAL_STATES = ['failed', 'error', 'cancelled']

function nonEmpty (value) {
  return typeof value === 'string' && value.trim() ? value.trim() : ''
}

/**
 * 解析数字人 provider。
 *
 * 为什么不能用 getVideoProviderConfig：那个取 getDefault('video')，候选是
 * agnes-video/kling/runway/veo 等**通用文生视频**模型——它们不认
 * character/voice/script，把数字人参数发给它们等于把流水线跑成普通文生视频。
 *
 * @param {object} aiGenerator
 * @param {object} [params] 允许 params.videoProvider 显式覆盖
 * @param {{resolveProviderDefaultModel?: Function}} [deps] 注入便于单测
 * @returns {{providerId: string, model: string}|null}
 */
function resolveDigitalHumanProvider (aiGenerator, params, deps = {}) {
  const manager = aiGenerator && aiGenerator._modelProviderManager
  const override = nonEmpty(params && params.videoProvider)
  const providerId = override || DIGITAL_HUMAN_PROVIDER
  if (!manager || typeof manager.getProvider !== 'function') {
    // manager 不可用时不臆造 provider 可用性，交给调用方 fail closed
    return null
  }
  let provider = null
  try { provider = manager.getProvider(providerId) } catch (_) { /* 保持 null ⇒ 调用方 fail closed */ }
  if (!provider) return null
  const resolveModel = typeof deps.resolveProviderDefaultModel === 'function'
    ? deps.resolveProviderDefaultModel
    : (() => '')
  const model = typeof provider.id === 'string' && provider.id.trim()
    ? resolveModel(provider, 'video')
    : ''
  return { providerId, model: model || '' }
}

/**
 * 从上下文/参数中解析数字人三要素（character / voice / script）。
 *
 * 取值优先级：显式 params > stage.options > 前序 avatar_select 阶段产出。
 * 三要素任一缺失即返回 null，由调用方 fail closed——缺 character 会让 HeyGen
 * adapter 直接抛 INVALID_CONFIG，与其跑到网络层才炸，不如在本地给可操作错误。
 *
 * @returns {{character: string, voice: string, script: string}|null}
 */
function resolveDigitalHumanInputs (params, stage, context) {
  const box = context && context.avatar_select && typeof context.avatar_select === 'object'
    ? context.avatar_select
    : {}
  const pick = (key) => {
    const candidates = [params && params[key], stage && stage.options && stage.options[key], box[key]]
    for (const value of candidates) {
      const text = nonEmpty(value)
      if (text) return text
    }
    return ''
  }
  const character = pick('avatarId')
  const voice = pick('voiceId')
  // 口播文案候选：script 阶段产出（字符串）/ avatar_select 的 script / 用户主题兜底
  const script = nonEmpty(context && context.script)
    || nonEmpty(box.script)
    || nonEmpty(params && params.text)
  if (!character || !voice || !script) return null
  return { character, voice, script }
}

function getRunDir (runId) {
  return path.join(os.tmpdir(), 'story2video', 'videogen', String(runId || 'run'))
}

function runTool (binary, args, options = {}) {
  return new Promise((resolve, reject) => {
    execFile(binary, args, { maxBuffer: 64 * 1024 * 1024, ...options }, (error, stdout, stderr) => {
      if (error) reject(new Error(String(stderr || error.message).slice(0, 1200)))
      else resolve(String(stdout) + '\n' + String(stderr))
    })
  })
}

/** 下载视频到本地（与通用分支同一约定：scene_000.mp4） */
async function downloadToFile (url, dest) {
  const response = await fetch(url)
  if (!response.ok) throw new Error('HTTP ' + response.status)
  const buffer = Buffer.from(await response.arrayBuffer())
  fs.writeFileSync(dest, buffer)
}

/**
 * 执行数字人视频生成。
 *
 * 与通用分支的差异（不是「少做几步」，是语义不同）：
 *  - 不调 prompt-engine：那是通用文生视频提示词优化器，数字人不需要画面提示词，
 *    且 8013 未运行时它会 fail-closed 直接失败。
 *  - 提交参数是 { character, voice, script } 而非 { prompt, width, height, numFrames }。
 *  - 数字人一次生成即成片（单场景），不做多场景并行。
 *
 * 产物形状与通用分支一致（{ videos, scenes } + scene_000.mp4），MERGE 阶段零改动。
 *
 * @returns {Promise<{success: boolean, output?: object, error?: string, errorCode?: string}>}
 */
async function runDigitalHumanGenerate (options) {
  const { runId, manager, digitalHuman, inputs, providerRunContext, onProgress } = options
  const runDir = getRunDir(runId)
  fs.mkdirSync(runDir, { recursive: true })

  emitStageItem(onProgress, 1, 1, {
    messageKey: 'stageProgress.videogenGenerate',
    kind: 'video',
    percentStart: 0,
    percentEnd: 40,
  })

  let submit
  try {
    submit = await manager.callAdapter(digitalHuman.providerId, 'generateVideo', {
      character: inputs.character,
      voice: inputs.voice,
      script: inputs.script,
      ...(digitalHuman.model ? { model: digitalHuman.model } : {}),
    }, { providerRunContext })
  } catch (error) {
    return {
      success: false,
      error: '数字人视频生成调用失败：' + (error && error.message ? error.message : String(error)),
    }
  }

  if (submit && submit.code !== 0) {
    return {
      success: false,
      error: submit.message || ('数字人视频生成调用失败（provider: ' + digitalHuman.providerId + '）'),
    }
  }
  const data = submit && submit.data
  // 二层失败：adapter 抛异常被 callAdapter 包装成 { code:0, data:{ code:-1, message } }
  if (data && typeof data === 'object' && (data.code === -1 || data.code < 0)) {
    return {
      success: false,
      error: (data.message || data.error || ('数字人视频生成失败（provider: ' + digitalHuman.providerId + '）')),
    }
  }
  const taskId = data && (data.taskId || data.videoId || data.id || data.task_id)
  if (!taskId) {
    return {
      success: false,
      error: '数字人视频生成未返回任务 ID'
        + (data && typeof data === 'object'
          ? '，响应字段：' + JSON.stringify(Object.keys(data).filter(k => k !== 'model'))
          : '')
        + (submit && submit.message ? '；' + submit.message : ''),
    }
  }

  const pollDeadline = Date.now() + VIDEO_POLL_TIMEOUT_MS
  let videoUrl = null
  let lastState = ''
  while (true) {
    const status = await manager.callAdapter(
      digitalHuman.providerId,
      'getVideoStatus',
      { videoId: taskId, taskId },
      { providerRunContext },
    )
    const url = status && (status.videoUrl || status.url
      || (status.data && (status.data.videoUrl || status.data.url)))
    if (url) { videoUrl = url; break }
    lastState = String(
      (status && (status.status || (status.data && status.data.status))) || '',
    ).toLowerCase()
    if (TERMINAL_STATES.includes(lastState)) break
    if (Date.now() + VIDEO_POLL_INTERVAL_MS > pollDeadline) break
    await new Promise(r => setTimeout(r, VIDEO_POLL_INTERVAL_MS))
  }
  if (!videoUrl) {
    const reason = TERMINAL_STATES.includes(lastState)
      ? '任务状态为 ' + lastState
      : '轮询超时（上限 ' + Math.round(VIDEO_POLL_TIMEOUT_MS / 1000) + 's，末次状态=' + (lastState || 'unknown') + '）'
    return {
      success: false,
      error: '数字人视频生成失败：' + reason + '（provider: ' + digitalHuman.providerId + '）',
    }
  }

  const dest = path.join(runDir, 'scene_000.mp4')
  try {
    await downloadToFile(videoUrl, dest)
  } catch (error) {
    return {
      success: false,
      error: '数字人视频下载失败：' + (error && error.message ? error.message : String(error)),
    }
  }

  emitStageComplete(onProgress, {
    messageKey: 'stageProgress.videogenGenerateComplete',
    summaryKey: 'stageProgress.videogenSummary',
    summaryParams: { done: 1, total: 1 },
  })
  return { success: true, output: { videos: [{ index: 0, success: true, path: dest }], scenes: [] } }
}

module.exports = {
  AVATAR_PIPELINE,
  DIGITAL_HUMAN_PROVIDER,
  resolveDigitalHumanProvider,
  resolveDigitalHumanInputs,
  runDigitalHumanGenerate,
  runTool,
}
