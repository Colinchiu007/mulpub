/**
 * hot-topics-one-click-video-driver.js
 *
 * 热门选题「一键生成视频」全链路真实 E2E（CDP 驱动已运行的 Electron 实例）。
 *
 * 覆盖链路（与 01-docs/PRD-HOT-TOPICS-MODULE-2026-09-11.md §3.10 / §6.6 / §6.7 对齐）：
 *   热门选题页 → 逐条点击【生成视频】→ 自动调用改写引擎（aiRewrite mode=create）
 *   → 自动存草稿 → 自动读取用户已保存的 story2video.lastOptions.v1
 *   → 自动启动「故事讲述」流水线（story2video-compose，inputMode=text, autoAdvance）
 *   → 【后台运行】脱离以便发起下一条（并行语义）→ 轮询至终态 → 提取真实成片
 *   → ffprobe 校验（分辨率/时长/编码）。
 *
 * 与既有 story2video-saved-options-driver.js 的差别：
 *   - 后者从「视频创作」页手动填文案启动单条；
 *   - 本驱动从「热门选题」页一键入口发起，并用【后台运行】验证并行发起能力
 *     （回归 01-docs/BUGFIX-HOT-TOPICS-GEN-VIDEO-PARALLEL-2026-09-13.md）。
 *
 * 传输层：apps/desktop/tests/e2e/lib/cdp-client.js（WebSocket 直连 CDP，
 * 不用 Playwright connectOverCDP —— 本机 Electron 43/Chrome 150 下后者握手会稳定超时）。
 *
 * 环境变量：
 *   E2E_CDP_URL        CDP 端点（默认 http://127.0.0.1:10967）
 *   E2E_VITE_ORIGIN    renderer 源（默认 http://127.0.0.1:6919）
 *   E2E_TOPIC_COUNT    本次驱动的选题条数（默认 20）
 *   E2E_MAX_ACTIVE     同时进行中的流水线上限（默认 2）
 *   E2E_LABEL          本次运行标签（输出文件名前缀，默认 hv）
 *   E2E_OUT_DIR        成片与报告输出目录（默认 C:/tmp/hot-topics-video-e2e/<label>）
 *   E2E_RUN_TIMEOUT_MS 全程上限（默认 60 分钟）
 *   E2E_SKIP_REFRESH   设为 1 则不点击刷新（复用当前列表）
 *   E2E_PUBLISH        设为 1 则在成片校验后自动发布到全部可用平台账号（能发的都发）
 *   E2E_PUBLISH_PLATFORMS 逗号分隔平台白名单（仅 E2E_PUBLISH=1 时生效；缺省全平台）
 *   E2E_PUBLISH_TIMEOUT_MS 单条发布队列终态等待上限（默认 15 分钟）
 */
'use strict'

const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')
const { CdpClient, sleep } = require('./lib/cdp-client')
const { buildPublishPlan, extractStoryText } = require('./lib/hot-video-publish-plan')

const CDP_URL = process.env.E2E_CDP_URL || 'http://127.0.0.1:10967'
const VITE_ORIGIN = process.env.E2E_VITE_ORIGIN || 'http://127.0.0.1:6919'
const CDP_PORT = Number(CDP_URL.replace(/^https?:\/\//, '').split(':')[1] || 10967)
const TOPIC_COUNT = Number(process.env.E2E_TOPIC_COUNT || 20)
const MAX_ACTIVE = Number(process.env.E2E_MAX_ACTIVE || 2)
const LABEL = process.env.E2E_LABEL || 'hv'
const OUT_DIR = process.env.E2E_OUT_DIR || path.join('C:/tmp/hot-topics-video-e2e', LABEL)
const RUN_TIMEOUT_MS = Number(process.env.E2E_RUN_TIMEOUT_MS || 60 * 60 * 1000)
const SKIP_REFRESH = process.env.E2E_SKIP_REFRESH === '1'
const PUBLISH_ENABLED = process.env.E2E_PUBLISH === '1'
const PUBLISH_PLATFORMS = (process.env.E2E_PUBLISH_PLATFORMS || '')
  .split(',').map((s) => s.trim()).filter(Boolean)
const PUBLISH_TIMEOUT_MS = Number(process.env.E2E_PUBLISH_TIMEOUT_MS || 15 * 60 * 1000)

const PIPELINE = 'story2video-compose'
const POLL_MS = 10000

function probe (file) {
  try {
    const out = execFileSync('ffprobe', [
      '-v', 'error',
      '-show_entries', 'stream=codec_name,width,height,avg_frame_rate',
      '-show_entries', 'format=duration,size,bit_rate',
      '-of', 'json', file,
    ], { encoding: 'utf8' })
    return JSON.parse(out)
  } catch (err) {
    return { probeFailed: err && err.message ? err.message : String(err) }
  }
}

/** 在流水线 run context 里深度搜索真实存在的成片路径。 */
function findOutput (node, depth, sources) {
  if (!node || typeof node !== 'object' || depth > 12) return null
  for (const key of ['videoPath', 'outputPath']) {
    const value = node[key]
    if (typeof value === 'string' && value && fs.existsSync(value)) {
      let real = null
      try { real = fs.realpathSync.native(value) } catch (_) { real = value }
      if (!sources || !sources.has(real)) return value
    }
  }
  for (const key of Object.keys(node)) {
    const value = node[key]
    if (value && typeof value === 'object') {
      const found = findOutput(value, depth + 1, sources)
      if (found) return found
    }
  }
  return null
}

const report = {
  label: LABEL,
  pipeline: PIPELINE,
  cdpUrl: CDP_URL,
  viteOrigin: VITE_ORIGIN,
  topicCount: TOPIC_COUNT,
  maxActive: MAX_ACTIVE,
  startedAt: new Date().toISOString(),
  identity: null,
  savedOptions: null,
  topics: [],
  runs: [],
  videos: [],
  errors: [],
  status: 'running',
}

const log = (...args) => console.log('[hv-driver]', ...args)

/** 读取热门选题列表（前 N 条，按 UI 展示顺序）。 */
const readTopicsExpr = (n) => `
(() => {
  const items = Array.from(document.querySelectorAll('[data-testid="hot-topic-item"]'))
  return items.slice(0, ${n}).map((el, i) => {
    const btn = el.querySelector('button[data-testid^="hot-topic-generate-video-"]')
    const txt = el.querySelector('.topic-text')
    return {
      index: i + 1,
      id: btn ? btn.getAttribute('data-testid').replace('hot-topic-generate-video-', '') : null,
      disabled: btn ? btn.disabled : null,
      topic: txt ? txt.textContent.trim() : '',
    }
  })
})()`

const clickGenerateExpr = (topicId) => `
(() => {
  const btn = document.querySelector('[data-testid="hot-topic-generate-video-${topicId}"]')
  if (!btn) return { ok: false, reason: 'button-missing' }
  if (btn.disabled) return { ok: false, reason: 'button-disabled' }
  btn.click()
  return { ok: true }
})()`

const MODAL_STATE_EXPR = `
(() => {
  const modal = document.querySelector('[data-testid="hot-topics-gen-video-modal"]')
  const bg = document.querySelector('[data-testid="hot-topics-gen-video-background"]')
  const cancel = document.querySelector('[data-testid="hot-topics-gen-video-cancel"]')
  const retry = document.querySelector('[data-testid="hot-topics-gen-video-retry"]')
  const closeBtn = document.querySelector('[data-testid="hot-topics-gen-video-close"]')
  const err = document.querySelector('[data-testid="hot-topics-gen-video-error"]')
  return {
    modalVisible: !!modal,
    canBackground: !!bg,
    canCancel: !!cancel,
    canRetry: !!retry,
    canClose: !!closeBtn,
    errorText: err ? err.textContent.trim() : '',
  }
})()`

async function main () {
  fs.mkdirSync(OUT_DIR, { recursive: true })
  let cdp = null
  let failed = false
  try {
    cdp = await CdpClient.attach(CDP_PORT, VITE_ORIGIN)
    log('CDP 已接入:', cdp.target.url)

    // 探针：捕获 pipelineStartOrchestrated 的 params/runId（幂等安装）
    await cdp.evaluate(`
(() => {
  if (window.__hvProbeInstalled) return 'already'
  window.__hvProbeInstalled = true
  window.__hvStarts = []
  const original = window.electronAPI && window.electronAPI.pipelineStartOrchestrated
  if (typeof original !== 'function') return 'no-api'
  window.electronAPI.pipelineStartOrchestrated = async (...args) => {
    const result = await original(...args)
    try {
      window.__hvStarts.push({
        name: args[0],
        runId: result && result.data && result.data.runId ? result.data.runId : null,
        code: result && result.code,
        message: result && result.message,
        textChars: args[1] && typeof args[1].text === 'string' ? Array.from(args[1].text).length : null,
        textHead: args[1] && typeof args[1].text === 'string' ? args[1].text.slice(0, 60) : null,
        textFull: args[1] && typeof args[1].text === 'string' ? args[1].text : null,
        at: Date.now(),
      })
    } catch (_) {}
    return result
  }
  return 'installed'
})()`)

    // 进入热门选题页（hash 路由；勿用整页 goto('/#/hot-topics')，纯 hash 跳转会 domcontentloaded 超时）
    await cdp.evaluate(`(window.location.hash = '#/hot-topics', 'ok')`)
    await cdp.waitFor(`/#\\/hot-topics/.test(location.hash)`, { timeout: 30000, label: 'route hot-topics' })
    await cdp.waitFor(
      `document.querySelectorAll('[data-testid="hot-topic-item"]').length > 0 || !!document.querySelector('[data-testid="hot-topics-empty"]')`,
      { timeout: 120000, label: 'topics rendered' })

    report.identity = await cdp.evaluate(`window.electronAPI.identityGetState().then(r => r.data).catch(e => ({ error: String(e) }))`)
    report.accounts = await cdp.evaluate(`window.electronAPI.listAccounts().then(r => (r.data||[]).map(a => a.platform + ':' + a.status)).catch(e => [String(e)])`)
    report.savedOptions = await cdp.evaluate(`window.electronAPI.storeGetSetting('story2video.lastOptions.v1')
      .then(r => (r && r.code === 0 ? r.data : { code: r && r.code, errorCode: r && r.errorCode }))
      .catch(e => ({ error: String(e) }))`)
    log('identity=' + (report.identity && report.identity.status) + ' accounts=' + JSON.stringify(report.accounts))

    if (report.identity && report.identity.status !== 'authenticated') {
      throw new Error('身份态非 authenticated（' + (report.identity && report.identity.status) + '），一键生成视频所需的 ai:rewrite / pipeline:startOrchestrated 会被许可证门禁拒绝')
    }

    if (!SKIP_REFRESH) {
      log('刷新话题列表（forceRefresh 语义）...')
      await cdp.evaluate(`
(() => {
  const btns = Array.from(document.querySelectorAll('.header-actions button'))
  if (btns[0]) btns[0].click()
  return 'clicked'
})()`)
      await sleep(3000)
      await cdp.waitFor(`!document.querySelector('[data-testid="hot-topics-central-loading"]')`,
        { timeout: 120000, interval: 1500, label: 'refresh done' }).catch(() => log('刷新等待超时（继续）'))
      await sleep(3000)
    }

    const topics = await cdp.evaluate(readTopicsExpr(TOPIC_COUNT))
    report.topics = topics
    log('选题数=' + topics.length)
    if (!topics.length) throw new Error('热门选题列表为空，无法驱动')

    const pending = topics.slice()
    const deadline = Date.now() + RUN_TIMEOUT_MS
    const retriedIds = new Set()

    // 并发门只统计「本驱动新发起」的 run：驱动启动前已处于 running/paused 的
    // 历史任务（含陈旧 paused 僵尸）不应永久阻塞门控（回归：热门选题 E2E 冒烟
    // 被 8 月两条 paused run 卡死）。
    const preExistingActive = new Set(await cdp.evaluate(`window.electronAPI.pipelineHistory()
      .then(h => ((h && h.data) || []).filter(r => r.pipeline === 'story2video-compose' && ['running','paused'].includes(r.status)).map(r => r.id))
      .catch(() => [])`))

    while (pending.length > 0 && Date.now() < deadline) {
      const activeAll = await cdp.evaluate(`window.electronAPI.pipelineHistory()
        .then(h => ((h && h.data) || []).filter(r => r.pipeline === 'story2video-compose' && ['running','paused'].includes(r.status)).map(r => r.id))
        .catch(() => [])`)
      const active = (Array.isArray(activeAll) ? activeAll : []).filter((id) => !preExistingActive.has(id))
      if (active.length >= MAX_ACTIVE) {
        log('活跃 run=' + active.length + '（上限 ' + MAX_ACTIVE + '，已排除存量 ' + preExistingActive.size + ' 条），等待 15s')
        await sleep(15000)
        continue
      }

      const topic = pending.shift()
      const entry = { topicId: topic.id, index: topic.index, title: topic.topic, status: 'pending', runId: null }
      report.runs.push(entry)

      const clickRes = await cdp.evaluate(clickGenerateExpr(topic.id))
      if (!clickRes || !clickRes.ok) {
        entry.status = 'skipped'
        entry.reason = (clickRes && clickRes.reason) || 'unknown'
        log('#' + topic.index + ' 跳过：' + entry.reason)
        continue
      }

      const beforeStarts = await cdp.evaluate(`(window.__hvStarts || []).length`)
      try {
        await cdp.waitFor(`!!document.querySelector('[data-testid="hot-topics-gen-video-modal"]')`,
          { timeout: 60000, label: 'modal open #' + topic.index })
        // 流水线真正起来：【后台运行】按钮出现 = phase running 且持有 runId
        const state = await cdp.waitFor(`
(() => {
  const bg = document.querySelector('[data-testid="hot-topics-gen-video-background"]')
  const retry = document.querySelector('[data-testid="hot-topics-gen-video-retry"]')
  if (bg) return 'running'
  if (retry) return 'failed'
  return false
})()`, { timeout: 12 * 60 * 1000, interval: 3000, label: 'pipeline running #' + topic.index })
        entry.reachedState = state
      } catch (e) {
        const st = await cdp.evaluate(MODAL_STATE_EXPR).catch(() => null)
        entry.status = 'failed'
        entry.reason = 'start-timeout: ' + e.message + ' state=' + JSON.stringify(st)
        report.errors.push('#' + topic.index + ' ' + entry.reason)
        log('#' + topic.index + ' 启动超时：' + e.message)
        await cdp.evaluate(`
(() => {
  const c = document.querySelector('[data-testid="hot-topics-gen-video-cancel"]')
  if (c) c.click()
  const x = document.querySelector('[data-testid="hot-topics-gen-video-modal"] [data-testid="ui-modal-close"]')
  if (x) x.click()
  return 'closed'
})()`).catch(() => {})
        await sleep(3000)
        if (!retriedIds.has(topic.id)) { retriedIds.add(topic.id); pending.push(topic) }
        continue
      }

      // runId 捕获（probe 优先，history 兜底）
      const starts = await cdp.evaluate(`(window.__hvStarts || [])`)
      const newStarts = Array.isArray(starts) ? starts.slice(beforeStarts) : []
      const hit = newStarts.filter((s) => s.name === PIPELINE).pop()
      if (hit) {
        entry.runId = hit.runId
        entry.rewriteChars = hit.textChars
        entry.rewriteHead = hit.textHead
        entry.rewriteFull = hit.textFull || null
        if (hit.code !== 0 || !hit.runId) entry.startError = hit.message || ('code=' + hit.code)
      }
      if (!entry.runId) {
        const hist = await cdp.evaluate(`window.electronAPI.pipelineHistory()
          .then(h => ((h && h.data) || []).filter(r => r.pipeline === 'story2video-compose')
            .sort((a,b) => new Date(b.createdAt) - new Date(a.createdAt))[0] || null).catch(() => null)`)
        if (hist && hist.id) entry.runId = hist.id
      }

      // 【后台运行】脱离：验证「脱离后可立即发起下一条」的并行语义
      entry.detachedToBackground = await cdp.evaluate(`
(() => {
  const bg = document.querySelector('[data-testid="hot-topics-gen-video-background"]')
  if (!bg) return false
  bg.click()
  return true
})()`)
      await cdp.waitFor(`!document.querySelector('[data-testid="hot-topics-gen-video-modal"]')`,
        { timeout: 60000, interval: 500, label: 'modal closed #' + topic.index }).catch(() => {})

      entry.status = entry.runId ? 'running' : 'unknown-runid'
      // 发起时改写全文还不存在（探针包不住 contextBridge，全文在 run context 里），故终态行才带真实字数
      log('#' + topic.index + ' 已发起 runId=' + entry.runId + ' detached=' + entry.detachedToBackground +
        ' 改写字数=' + (entry.rewriteChars || '待取'))
      await sleep(2000)
    }

    // 等待全部终态
    const watch = report.runs.filter((r) => r.runId && ['running', 'unknown-runid'].includes(r.status))
    log('等待 ' + watch.length + ' 条 run 终态 ...')
    while (watch.some((r) => !r.finishedAt) && Date.now() < deadline) {
      for (const r of watch) {
        if (r.finishedAt) continue
        const data = await cdp.evaluate(`window.electronAPI.pipelineGetRunContext(${JSON.stringify(r.runId)})
          .then(x => (x && x.data) || null).catch(() => null)`)
        if (!data) continue
        const status = (data.status && data.status.status) || data.status
        if (['completed', 'failed', 'cancelled'].includes(status)) {
          r.finishedAt = new Date().toISOString()
          r.finalStatus = status
          r.stages = (data.stages || []).map((s) => s.name + ':' + s.status).join(',')
          r.error = String((data.error && (data.error.message || JSON.stringify(data.error))) || '')
          const videoPath = findOutput(data.context || {}, 0, new Set())
          if (videoPath) r.videoPath = videoPath
          // electronAPI 是冻结的 contextBridge 对象，探针包不住 pipelineStartOrchestrated；
          // 改写全文从 run context 提取（scene_context 阶段固化的 full_text）。
          const storyText = extractStoryText(data.context || {})
          if (storyText) r.storyText = storyText
          if (storyText && !r.rewriteChars) r.rewriteChars = storyText.length
          // 限流降级取证（PRD §5.9）：optimize 阶段因 LLM 429 降级为模板策略的场景下标
          if (data.context && data.context.optimize_degraded) r.optimizeDegraded = data.context.optimize_degraded
          const failTail = status === 'completed' ? '' : ' err=' + r.error.slice(0, 260).replace(/\s+/g, ' ')
          log('runId=' + r.runId + ' -> ' + status +
            ' 改写字数=' + (r.rewriteChars || 0) +
            (r.optimizeDegraded ? ' 降级场景=' + r.optimizeDegraded.scenes.join(',') + '/' + r.optimizeDegraded.total : '') +
            (r.videoPath ? ' video=' + r.videoPath : ' (no video)') + failTail)
        }
      }
      if (watch.some((r) => !r.finishedAt)) await sleep(POLL_MS)
    }

    // 成片落盘 + ffprobe
    for (const r of report.runs) {
      if (!r.videoPath) continue
      const dest = path.join(OUT_DIR, LABEL + '-topic' + String(r.index).padStart(2, '0') + '.mp4')
      try {
        fs.copyFileSync(r.videoPath, dest)
        const entry = {
          topicIndex: r.index,
          topicId: r.topicId,
          title: r.title,
          runId: r.runId,
          sourcePath: r.videoPath,
          outputPath: dest,
          bytes: fs.statSync(r.videoPath).size,
          probe: probe(r.videoPath),
        }
        report.videos.push(entry)
        log('VIDEO ' + dest + ' bytes=' + entry.bytes + ' probe=' + JSON.stringify(entry.probe.format || entry.probe))
      } catch (e) {
        report.errors.push('copy failed for ' + r.runId + ': ' + e.message)
      }
    }

    // 发布阶段（E2E_PUBLISH=1）：每条成片 → publish:batch 入队 → queue:history 轮询终态
    report.publish = []
    if (PUBLISH_ENABLED && report.videos.length > 0) {
      const accounts = await cdp.evaluate(`window.electronAPI.listAccounts()
        .then(r => (r && r.data) || []).catch(() => [])`)
      for (const v of report.videos) {
        const run = report.runs.find((r) => r.index === v.topicIndex) || {}
        const item = { topicIndex: v.topicIndex, runId: v.runId, title: v.title, status: 'pending', targets: [] }
        report.publish.push(item)
        try {
          const coverPath = await cdp.evaluate(`window.electronAPI.extractVideoCover(${JSON.stringify(v.sourcePath)})
            .then(r => (r && r.code === 0 && r.data && r.data.coverPath) || null).catch(() => null)`)
          const plan = buildPublishPlan({
            accounts,
            options: PUBLISH_PLATFORMS.length ? { onlyPlatforms: PUBLISH_PLATFORMS } : {},
            topic: { title: run.title || v.title },
            rewrittenText: run.rewriteFull || run.storyText || '',
            videoPath: v.sourcePath,
            coverPath: coverPath || undefined,
          })
          item.targets = plan.targets
          const resp = await cdp.evaluate(`window.electronAPI.publishBatch(${JSON.stringify(plan.targets)}, ${JSON.stringify(plan.article)})`)
          if (!resp || resp.code !== 0 || !resp.data || !Array.isArray(resp.data.taskIds)) {
            throw new Error('publishBatch 失败: ' + JSON.stringify(resp))
          }
          item.taskIds = resp.data.taskIds
          log('#' + v.topicIndex + ' 发布入队 taskIds=' + item.taskIds.join(','))
          const pubDeadline = Date.now() + PUBLISH_TIMEOUT_MS
          while (Date.now() < pubDeadline) {
            const hist = await cdp.evaluate(`window.electronAPI.getQueueHistory()
              .then(r => (r && r.data) || []).catch(() => [])`)
            const tasks = (Array.isArray(hist) ? hist : []).filter((t) => item.taskIds.includes(t.id))
            item.tasks = tasks.map((t) => ({
              id: t.id, platform: t.platform, accountId: t.accountId, status: t.status,
              error: t.error ? String(t.error).slice(0, 300) : undefined,
              resultUrl: (t.result && (t.result.url || t.result.link)) || undefined,
            }))
            const terminal = ['success', 'failed', 'cancelled']
            if (tasks.length >= item.taskIds.length && tasks.every((t) => terminal.includes(t.status))) break
            await sleep(5000)
          }
          const okCount = (item.tasks || []).filter((t) => t.status === 'success').length
          item.status = okCount === item.taskIds.length ? 'published'
            : (okCount > 0 ? 'partial' : 'failed')
          log('#' + v.topicIndex + ' 发布终态 ' + item.status + ' (' + okCount + '/' + item.taskIds.length + ')')
        } catch (e) {
          item.status = 'error'
          item.error = e && e.message ? e.message : String(e)
          report.errors.push('#' + v.topicIndex + ' publish: ' + item.error)
          log('#' + v.topicIndex + ' 发布失败：' + item.error)
        }
      }
    }

    report.finishedAt = new Date().toISOString()
    report.status = report.videos.length > 0 ? 'ok' : 'failed'
  } catch (err) {
    failed = true
    report.status = 'failed'
    report.errors.push(err && err.stack ? err.stack : String(err))
    console.error('E2E_FAILED ' + (err && err.stack ? err.stack : err))
  } finally {
    fs.writeFileSync(path.join(OUT_DIR, LABEL + '-generate-report.json'), JSON.stringify(report, null, 2))
    if (cdp) cdp.close()
    console.log('REPORT_DIR=' + OUT_DIR)
    console.log('VIDEOS=' + report.videos.length)
    console.log('STATUS=' + report.status)
    if (!failed && report.videos.length > 0) console.log('E2E_OK')
    process.exit(failed || report.videos.length === 0 ? 1 : 0)
  }
}

main()
