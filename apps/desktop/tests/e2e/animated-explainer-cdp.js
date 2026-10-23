#!/usr/bin/env node
// @ts-check
/**
 * animated-explainer-cdp.js — 「AI 讲解视频」流水线的 CDP 端到端运行器
 *
 * 用 Chrome DevTools Protocol（原生 WebSocket，不用 Playwright 的 connectOverCDP：
 * 本仓 Electron 43 上 connectOverCDP 侧握手会稳定超时，理由见 lib/cdp-client.js 头注）
 * 直接驱动**已启动的桌面端**，跑完 animated-explainer 的 8 个阶段并校验成片。
 *
 * 覆盖的阶段（apps/desktop/electron/services/pipeline-engine.js 的 stageDefs）：
 *   research → proposal → script → scenes → assets → editing → compose → publish
 *
 * 两种驱动模式：
 *   --mode=api（默认）：CDP → window.electronAPI.pipelineStartOrchestrated(...)
 *                       直接触发编排，与仓库既有 E2E（tests/e2e/video-model-pipelines.js）同款。
 *   --mode=ui ：CDP → DOM 操作真实界面（选流水线卡片 → 填主题 → 点启动），
 *                       额外覆盖前端表单校验与登录门这条链路。
 *
 * Provider：默认指向本地桩（tests/e2e/lib/local-provider-hub.js），
 * LLM 走 OpenAI 兼容端点、图片走 Stable Diffusion WebUI 兼容端点，均免 API Key。
 *
 * 用法：
 *   node apps/desktop/tests/e2e/animated-explainer-cdp.js \
 *     --cdp-port=9222 --vite-port=5174 \
 *     --llm-base-url=http://127.0.0.1:8787/v1 \
 *     --image-base-url=http://127.0.0.1:7860 \
 *     --out-dir=/tmp/explainer-out --runs=2
 *
 * 退出码：0 = 全部轮次都产出了可播放成片；1 = 有轮次失败（报告里带原因）。
 */

'use strict'

const fs = require('fs')
const path = require('path')
const { execFile } = require('child_process')
const { promisify } = require('util')

const execFileAsync = promisify(execFile)

const { CdpClient, sleep } = require('./lib/cdp-client')
// ffprobe 必须用仓库自己的解析（media-tool-paths）：Windows runner 的 PATH 上没有 ffprobe，
// 预置包 ffmpeg-ffprobe-static 才有；直接 spawn 'ffprobe' 在 CI 上必 ENOENT。
const { findFfprobe } = require('../../electron/services/media-tool-paths')

const DEFAULT_CDP_PORT = 9222
const DEFAULT_VITE_PORT = 5174
const TERMINAL_STATUSES = new Set(['completed', 'failed', 'cancelled'])

/** 解析 --key=value / --key value 两种写法 */
function parseArgs (argv) {
  const args = {}
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]
    if (!token.startsWith('--')) continue
    const body = token.slice(2)
    const eq = body.indexOf('=')
    if (eq !== -1) {
      args[body.slice(0, eq)] = body.slice(eq + 1)
      continue
    }
    const next = argv[i + 1]
    if (next && !next.startsWith('--')) {
      args[body] = next
      i++
    } else {
      args[body] = 'true'
    }
  }
  return args
}

function log (...parts) {
  console.log('[explainer-cdp]', ...parts)
}

/** ffprobe 取成片规格（拿不到就返回 probe-failed，不让校验步骤整体失败） */
async function probeVideo (file) {
  const ffprobe = findFfprobe()
  if (!ffprobe) return { ok: false, error: 'ffprobe 不可用（未找到可执行文件）' }
  try {
    const { stdout } = await execFileAsync(ffprobe, [
      '-v', 'error',
      '-show_entries', 'stream=codec_type,codec_name,width,height',
      '-show_entries', 'format=duration,size',
      '-of', 'json', file,
    ], { timeout: 20000 })
    const data = JSON.parse(stdout)
    const video = (data.streams || []).find(s => s.codec_type === 'video') || {}
    const audio = (data.streams || []).find(s => s.codec_type === 'audio') || {}
    const format = data.format || {}
    return {
      ok: true,
      videoCodec: video.codec_name || null,
      width: video.width || null,
      height: video.height || null,
      hasAudio: Boolean(audio.codec_name),
      audioCodec: audio.codec_name || null,
      durationSeconds: format.duration ? Number(Number(format.duration).toFixed(2)) : null,
      sizeBytes: format.size ? Number(format.size) : null,
    }
  } catch (error) {
    return { ok: false, error: String(error && error.message ? error.message : error) }
  }
}

/** 成片视频的合法扩展名（compose 产物） */
const VIDEO_EXTENSIONS = new Set(['.mp4', '.webm', '.mov', '.mkv'])

/**
 * 从运行快照里递归找第一个真实存在的**视频**路径。
 *
 * 只认视频扩展名是必需的：compose 的产物结构里同时挂着图片（imagePath）与
 * 分段视频（videoPath），若把 'path' 这类泛用键也当作成片，会先命中
 * `.../img_0000.png` ⇒ 报告里出现「成片是 PNG」这种假阳性。
 */
function findVideoPath (node, depth = 0, exists = fs.existsSync) {
  if (!node || typeof node !== 'object' || depth > 8) return null
  for (const key of ['videoPath', 'outputPath', 'path']) {
    const value = node[key]
    if (typeof value === 'string' && value && VIDEO_EXTENSIONS.has(path.extname(value).toLowerCase()) && exists(value)) {
      return value
    }
  }
  for (const key of Object.keys(node)) {
    const value = node[key]
    if (value && typeof value === 'object') {
      const found = findVideoPath(value, depth + 1, exists)
      if (found) return found
    }
  }
  return null
}

class ExplainerCdpRunner {
  constructor (options) {
    this.options = options
    this.client = null
  }

  async connect () {
    const origin = 'http://127.0.0.1:' + this.options.vitePort
    this.client = await CdpClient.attach(this.options.cdpPort, origin, {
      retries: 30,
      backoffMs: 2000,
    })
    log('CDP 已连接：', origin)
  }

  close () {
    if (this.client) this.client.close()
    this.client = null
  }

  /** 页面内求值（带 JSON 化，避免复杂对象跨 CDP 边界时丢字段） */
  async evalJson (expression) {
    const raw = await this.client.evaluate('(async () => { return JSON.stringify(await (' + expression + ')) })()')
    if (typeof raw !== 'string') return raw
    try { return JSON.parse(raw) } catch (_) { return raw }
  }

  /** 确认桌面端可用（开发模式下访问级别为 admin，免登录） */
  async probeRuntime () {
    const expression = '(async () => ({' +
      ' version: await window.electronAPI.getVersion(),' +
      ' services: (await window.electronAPI.servicesGetStatus()) || null' +
      '}))()'
    const info = await this.evalJson(expression)
    log('运行时探针：', JSON.stringify(info).slice(0, 400))
    return info
  }

  /** 把本地桩写进模型设置：LLM → OpenAI 兼容端点；图片 → SD 兼容端点 */
  async configureProviders () {
    // 回环地址的本地端点免 API Key（model-provider-manager 的 canUseWithoutApiKey
    // 按「base_url 在回环上」判定，见 model-provider-local-no-key.test.js）。
    // 远端端点仍需 Key —— 显式传 --llm-api-key 才会带上。
    const llmUpdates = {
      base_url: this.options.llmBaseUrl,
      models: ['local-explainer'],
      enabled: true,
    }
    if (this.options.llmApiKey) llmUpdates.api_key = this.options.llmApiKey
    const llm = await this.evalJson(
      '(async () => window.electronAPI.modelProviderUpdate("ollama", ' + JSON.stringify(llmUpdates) + '))()'
    )
    const image = await this.evalJson(
      '(async () => window.electronAPI.modelProviderUpdate("local-diffusion", {' +
      ' base_url: ' + JSON.stringify(this.options.imageBaseUrl) + ',' +
      ' enabled: true }))()'
    )
    log('provider 配置：ollama=' + JSON.stringify(llm).slice(0, 200))
    log('provider 配置：local-diffusion=' + JSON.stringify(image).slice(0, 200))
    if (!llm || llm.code !== 0) throw new Error('LLM provider 配置失败: ' + JSON.stringify(llm))
    if (!image || image.code !== 0) throw new Error('图片 provider 配置失败: ' + JSON.stringify(image))

    const state = await this.evalJson('(async () => ({' +
      ' llm: await window.electronAPI.modelProviderGet("ollama"),' +
      ' image: await window.electronAPI.modelProviderGet("local-diffusion")' +
      '}))()')
    const llmData = state && state.llm && state.llm.data
    const imgData = state && state.image && state.image.data
    log('provider 读回：llm configured=' + (llmData && llmData.is_configured) +
      ' base_url=' + (llmData && llmData.base_url) +
      ' | image configured=' + (imgData && imgData.is_configured) +
      ' base_url=' + (imgData && imgData.base_url))
    if (!llmData || llmData.is_configured !== true) {
      throw new Error('LLM provider 未生效（is_configured 非 true）：' + JSON.stringify(llmData))
    }
    if (!imgData || imgData.is_configured !== true) {
      throw new Error('图片 provider 未生效（is_configured 非 true）：' + JSON.stringify(imgData))
    }
    return state
  }

  /** 走 DOM 驱动真实界面 */
  async startViaUi (topic) {
    log('UI 模式：进入「视频创作」页并操作界面')
    // 导航：**不能只改 location.hash**。实测（2026-10-23）：把 hash 改成 '#/create' 后
    // location.href 确实变了，但视图仍停在首页 —— 壳层没有响应这次 hash 变更；
    // 真实用户路径是点侧边栏的「视频创作」入口，那才会挂载 CreateView。
    // 因此这里以侧边栏入口为主，hash 赋值只作为兜底。
    const navigated = await this.evalJson('(async () => {' +
      ' const entry = document.querySelector(\'[data-testid="mp-primary-create"]\');' +
      ' if (entry) { entry.click(); return "sidebar"; }' +
      ' location.hash = "#/create"; return "hash";' +
      '})()')
    log('导航方式：', navigated)
    await this.client.waitFor(
      '!!document.querySelector(\'[data-pipeline-id="animated-explainer"]\')',
      { timeout: 90000, interval: 1000, label: 'pipeline-card' }
    )
    const clicked = await this.evalJson('(async () => {' +
      ' const card = document.querySelector(\'[data-pipeline-id="animated-explainer"]\');' +
      ' if (!card) return { ok: false, reason: "no-card" };' +
      ' card.click();' +
      ' await new Promise(r => setTimeout(r, 1200));' +
      ' const area = document.querySelector(".input-area textarea.form-textarea");' +
      ' if (!area) return { ok: false, reason: "no-textarea" };' +
      ' area.value = ' + JSON.stringify(topic) + ';' +
      ' area.dispatchEvent(new Event("input", { bubbles: true }));' +
      ' await new Promise(r => setTimeout(r, 800));' +
      ' const btn = document.querySelector(\'[data-testid="start-story2video"]\');' +
      ' if (!btn) return { ok: false, reason: "no-button" };' +
      ' const disabled = btn.disabled === true;' +
      ' btn.click();' +
      ' return { ok: true, disabled }' +
      '})()')
    log('UI 操作结果：', JSON.stringify(clicked))
    if (!clicked || clicked.ok !== true) throw new Error('UI 驱动失败: ' + JSON.stringify(clicked))
    if (clicked.disabled === true) throw new Error('启动按钮处于禁用态（主题未写入或流水线不可用）')
    return clicked
  }

  /** 走编排 API 触发 */
  async startViaApi (topic) {
    const params = {
      text: topic,
      inputMode: 'text',
      checkpointPolicy: 'none',
      autoAdvance: true,
      background: true,
      storyboardMode: 'auto',
      style: 'clean-professional',
      resolution: this.options.resolution,
      aspectRatio: this.options.aspectRatio,
      fps: this.options.fps,
      format: 'mp4',
      subtitleEnabled: this.options.subtitleEnabled,
    }
    // 并发闸：设备上已有流水线在跑时，启动会被拒（PIPELINE_CONCURRENCY_LIMIT）。
    // 这是**正常的产品行为**，不是故障 —— 等待后重试即可，不该直接判定失败。
    const maxWaitMs = this.options.concurrencyWaitMs || 10 * 60 * 1000
    const deadline = Date.now() + maxWaitMs
    let attempt = 0
    while (true) {
      attempt++
      const result = await this.evalJson(
        '(async () => window.electronAPI.pipelineStartOrchestrated("animated-explainer", ' +
        JSON.stringify(params) + '))()'
      )
      const errorCode = result && result.data && result.data.errorCode
      if (result && result.code === 0 && result.data && result.data.success) {
        log('启动返回：', JSON.stringify(result).slice(0, 300))
        const runId = result.data.runId
        if (!runId) throw new Error('启动返回里没有 runId: ' + JSON.stringify(result))
        return runId
      }
      if (errorCode === 'PIPELINE_CONCURRENCY_LIMIT' && Date.now() < deadline) {
        const waitMs = Math.min(30000, 5000 * attempt)
        log('并发已满（' + JSON.stringify(result.data.errorParams || {}) + '），' + waitMs + 'ms 后重试')
        await sleep(waitMs)
        continue
      }
      log('启动返回：', JSON.stringify(result).slice(0, 400))
      throw new Error('启动失败: ' + JSON.stringify(result))
    }
  }

  /** 轮询运行快照直到终态 */
  async waitForRun (runId, timeoutMs) {
    const deadline = Date.now() + timeoutMs
    let lastStage = ''
    while (Date.now() < deadline) {
      const snapshot = await this.evalJson(
        '(async () => window.electronAPI.pipelineGetRunContext(' + JSON.stringify(runId) + '))()'
      ).catch(() => null)
      const data = snapshot && snapshot.data ? snapshot.data : null
      if (data) {
        const stage = (data.status && data.status.currentStage) || data.currentStage || ''
        const status = (data.status && data.status.status) || ''
        if (stage !== lastStage) {
          lastStage = stage
          log('阶段推进 →', stage || '(等待)', '状态=' + status)
        }
        if (TERMINAL_STATUSES.has(status)) return data
      }
      await sleep(2000)
    }
    throw new Error('等待运行结束超时（' + timeoutMs + 'ms），最后阶段=' + lastStage)
  }

  /** 跑一轮 */
  async runOnce (index, topic) {
    log('=== 第 ' + index + ' 轮开始：' + topic + ' ===')
    const startedAt = Date.now()
    let runId = null
    if (this.options.mode === 'ui') {
      await this.startViaUi(topic)
      // UI 模式下 runId 由渲染层持有；改为监听 pipeline:update 拿 runId
      runId = await this.waitForRunIdFromUpdates()
    } else {
      runId = await this.startViaApi(topic)
    }
    const snapshot = await this.waitForRun(runId, this.options.timeoutMs)
    const elapsedMs = Date.now() - startedAt
    const status = snapshot.status.status
    const result = {
      index,
      runId,
      status,
      elapsedMs,
      error: snapshot.error || null,
      errorCode: snapshot.errorCode || null,
      stageStatuses: (snapshot.stages || []).map(s => ({
        name: s.name,
        status: s.status,
        error: s.error || null,
      })),
      contextKeys: Object.keys(snapshot.context || {}),
      videoPath: null,
      probe: null,
    }
    if (status === 'completed') {
      const videoPath = findVideoPath(snapshot.context || {})
      if (videoPath) {
        result.videoPath = videoPath
        result.probe = await probeVideo(videoPath)
        const target = path.join(this.options.outDir, 'explainer-run-' + index + path.extname(videoPath))
        fs.mkdirSync(this.options.outDir, { recursive: true })
        fs.copyFileSync(videoPath, target)
        result.copiedTo = target
        log('成片：', videoPath, '→', target)
        log('规格：', JSON.stringify(result.probe))
      } else {
        result.error = '流水线已结束但未找到成片路径'
      }
    }
    return result
  }

  /** UI 模式下从 pipeline:update 事件流里取 runId */
  async waitForRunIdFromUpdates () {
    await this.client.evaluate('(function () {' +
      ' window.__mpPipelineEvents = [];' +
      ' if (!window.__mpPipelineHooked) {' +
      '   window.__mpPipelineHooked = true;' +
      '   window.electronAPI.onPipelineUpdate(function (s) { window.__mpPipelineEvents.push(s) });' +
      ' }' +
      ' return true })()')
    const deadline = Date.now() + 120000
    while (Date.now() < deadline) {
      const runId = await this.client.evaluate(
        '(function () { const e = window.__mpPipelineEvents || []; return e.length ? e[0].runId : null })()'
      )
      if (runId) return runId
      await sleep(500)
    }
    throw new Error('UI 模式下 120s 内未收到 pipeline:update 事件')
  }
}

async function main () {
  const args = parseArgs(process.argv.slice(2))
  const options = {
    cdpPort: Number(args['cdp-port'] || DEFAULT_CDP_PORT),
    vitePort: Number(args['vite-port'] || DEFAULT_VITE_PORT),
    llmBaseUrl: args['llm-base-url'] || 'http://127.0.0.1:8787/v1',
    llmApiKey: args['llm-api-key'] || '',
    imageBaseUrl: args['image-base-url'] || 'http://127.0.0.1:7860',
    topic: args.topic || '拖延症不是懒：拖延背后的情绪调节机制',
    outDir: args['out-dir'] || path.join(require('os').tmpdir(), 'explainer-cdp-out'),
    runs: Math.max(1, Number(args.runs || 1)),
    timeoutMs: Number(args['timeout-ms'] || 20 * 60 * 1000),
    concurrencyWaitMs: Number(args['concurrency-wait-ms'] || 10 * 60 * 1000),
    mode: args.mode === 'ui' ? 'ui' : 'api',
    resolution: args.resolution || '1920x1080',
    aspectRatio: args['aspect-ratio'] || '16:9',
    fps: Number(args.fps || 30),
    subtitleEnabled: args['subtitle-enabled'] === 'true',
  }

  const runner = new ExplainerCdpRunner(options)
  const report = { startedAt: new Date().toISOString(), options, runs: [] }
  let exitCode = 0
  try {
    await runner.connect()
    await runner.probeRuntime()
    await runner.configureProviders()
    for (let i = 1; i <= options.runs; i++) {
      try {
        report.runs.push(await runner.runOnce(i, options.topic))
      } catch (error) {
        report.runs.push({ index: i, status: 'error', error: String(error && error.message ? error.message : error) })
        exitCode = 1
      }
    }
  } catch (error) {
    report.fatal = String(error && error.stack ? error.stack : error)
    exitCode = 1
  } finally {
    runner.close()
    report.finishedAt = new Date().toISOString()
    fs.mkdirSync(options.outDir, { recursive: true })
    const reportPath = path.join(options.outDir, 'explainer-cdp-report.json')
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n', 'utf8')
    log('报告已写入：', reportPath)
  }

  const ok = report.runs.filter(r => r.status === 'completed' && r.videoPath).length
  log('结果：成功 ' + ok + ' / 共 ' + report.runs.length + ' 轮')
  process.exit(exitCode || (ok === report.runs.length ? 0 : 1))
}

if (require.main === module) {
  main().catch((error) => {
    console.error('[explainer-cdp] 未捕获异常：', error)
    process.exit(1)
  })
}

module.exports = { ExplainerCdpRunner, findVideoPath, probeVideo, parseArgs }
