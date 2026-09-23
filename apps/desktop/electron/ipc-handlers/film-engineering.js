// @ts-check
'use strict'
/**
 * film-engineering IPC handlers
 *
 * 通道（全部 withSenderCheck + 入参运行时校验）：
 *   film-engineering:status
 *   film-engineering:list-scenes
 *   film-engineering:list-shots          (sceneId)
 *   film-engineering:get-shot            (shotId)
 *   film-engineering:doctrine
 *   film-engineering:copy-text           (shotId, mode)
 *   film-engineering:copy-texts          (shotIds, mode)
 *   film-engineering:adapt-script        (script, characterMap, llmEnabled?)
 *   film-engineering:export              (selectedShots, format)
 *   film-engineering:generate-selected   (selectedShots, opts)
 *   film-engineering:download-recycled   ({ taskId, items: [{ shotId, orderIndex }] })
 *   film-engineering:production-plan     ({ shotIds })
 *   film-engineering:production-run-batch ({ taskId, shotIds, batchIndex, aspect?, seconds? })
 *   film-engineering:production-status   ({ taskId, shotIds })
 *   事件推送 film-engineering:production-update（runProduction emit → sender.send，节流后计数负载）
 */

const EC = require('../core/error-codes').ERROR
const { withSenderCheck } = require('./helpers')
const fs = require('fs')
const path = require('path')
const {
  generateShotVideo, resolveFilmVideoProvider, getFilmRunDir, FILM_ASPECTS, FILM_DURATIONS,
} = require('../services/film-engineering/video-gen')
const { downloadShot } = require('../services/film-engineering/shot-downloader')
const { getFilmMediaRoot } = require('../services/film-engineering/film-render')
const {
  runProduction, planBatches, loadLedger, resolveResumePlan, buildRenderManifest, shotFileName, PRODUCTION_BATCH_SIZE,
} = require('../services/film-engineering/production-driver')
const { runBatchViaVideoGen } = require('../services/film-engineering/production-runner')

const MAX_SCRIPT_LENGTH = 10000
const MAX_CHARACTER_MAP_KEYS = 10
const MAX_SHOTS_ARRAY = 50
const MAX_GENERATE_BATCH = 20
const MAX_RECYCLE_BATCH = 50
const RECYCLE_CONCURRENCY = 4
const MAX_PRODUCTION_SHOTS = 1000
// 计划预览估算口径（design Risks：POC 实测单镜 4.5-8.5MB 取上限；并发 2、单镜均值 ~10min）
const DISK_ESTIMATE_BYTES_PER_SHOT = 8 * 1024 * 1024
const WALLCLOCK_SECONDS_PER_SHOT = 300

/** 磁盘信物复核默认实现（D6）：runDir 下 shot_NNN.mp4 存在性，missing 为批内索引 */
function defaultFilmProbe (runId, count) {
  const dir = getFilmRunDir(runId)
  const missing = []
  for (let i = 0; i < count; i++) {
    if (!fs.existsSync(path.join(dir, shotFileName(i)))) missing.push(i)
  }
  return { missing }
}

function validateProductionArgs (EC, params) {
  const taskId = params.taskId
  if (typeof taskId !== 'string' || !taskId.trim() || taskId !== path.basename(taskId)) {
    return { code: EC.VALIDATION_ERROR, message: 'taskId 必须为非空且路径安全的字符串' }
  }
  const shotIds = params.shotIds
  if (!Array.isArray(shotIds) || shotIds.length === 0 || shotIds.length > MAX_PRODUCTION_SHOTS) {
    return { code: EC.VALIDATION_ERROR, message: 'shotIds 必须为 1-' + MAX_PRODUCTION_SHOTS + ' 项的数组' }
  }
  for (const id of shotIds) {
    if (typeof id !== 'string' || !id.trim()) {
      return { code: EC.VALIDATION_ERROR, message: 'shotIds 含非法分镜 id' }
    }
  }
  return null
}

function registerHandlers (ipcMain, deps) {
  const log = deps.log || { info () {}, warn () {}, error () {} }
  const service = deps.filmEngineeringService
  const pipelineEngine = deps.pipelineEngine
  const aiGenerator = deps.aiGenerator

  function kitError (e) {
    const message = e instanceof Error ? e.message : String(e)
    return message.startsWith('FILM_KIT_UNAVAILABLE')
      ? { code: EC.REQUEST_ERROR, message }
      : null
  }

  function withKit (fn) {
    return (event, ...args) => {
      try {
        return { code: 0, data: fn(event, ...args) }
      } catch (e) {
        const kitErr = kitError(e)
        if (kitErr) return kitErr
        if (e && Number.isInteger(e.code)) {
          return { code: e.code, message: e instanceof Error ? e.message : String(e) }
        }
        log.warn('[film-engineering] error:', e instanceof Error ? e.message : String(e))
        return { code: EC.REQUEST_ERROR, message: e instanceof Error ? e.message : String(e) }
      }
    }
  }

  ipcMain.handle('film-engineering:status', withSenderCheck(withKit(() => service.getStatus())))

  ipcMain.handle('film-engineering:list-scenes', withSenderCheck(withKit(() => service.listScenes())))

  ipcMain.handle('film-engineering:list-shots', withSenderCheck(withKit((_e, sceneId, pageOpts) => {
    if (typeof sceneId !== 'string' || !sceneId.trim()) {
      throw Object.assign(new Error('sceneId 必须为非空字符串'), { code: EC.VALIDATION_ERROR })
    }
    // 分页参数负载守卫（任务 4.2）：必须是纯对象；limit/offset 必须是整数（或省略）。
    if (pageOpts !== undefined && pageOpts !== null) {
      if (typeof pageOpts !== 'object' || Array.isArray(pageOpts)) {
        throw Object.assign(new Error('分页参数必须为对象 {limit, offset}'), { code: EC.VALIDATION_ERROR })
      }
      for (const key of ['limit', 'offset']) {
        const v = pageOpts[key]
        if (v !== undefined && v !== null && !Number.isInteger(v)) {
          throw Object.assign(new Error('分页参数 ' + key + ' 必须为整数'), { code: EC.VALIDATION_ERROR })
        }
      }
    }
    return service.listShots(sceneId, pageOpts)
  })))

  ipcMain.handle('film-engineering:get-shot', withSenderCheck(withKit((_e, shotId) => {
    if (typeof shotId !== 'string' || !shotId.trim()) {
      throw Object.assign(new Error('shotId 必须为非空字符串'), { code: EC.VALIDATION_ERROR })
    }
    return service.getShot(shotId)
  })))

  ipcMain.handle('film-engineering:doctrine', withSenderCheck(withKit(() => service.getDoctrine())))

  ipcMain.handle('film-engineering:copy-text', withSenderCheck(withKit((_e, shotId, mode) => {
    if (typeof shotId !== 'string' || !shotId.trim()) {
      throw Object.assign(new Error('shotId 必须为非空字符串'), { code: EC.VALIDATION_ERROR })
    }
    const m = typeof mode === 'string' && mode.trim() ? mode.trim() : 'full'
    return { text: service.buildCopyText(shotId, m), mode: m }
  })))

  ipcMain.handle('film-engineering:copy-texts', withSenderCheck(withKit((_e, shotIds, mode) => {
    if (!Array.isArray(shotIds) || shotIds.length === 0 || shotIds.length > MAX_SHOTS_ARRAY) {
      throw Object.assign(new Error('shotIds 必须为 1-' + MAX_SHOTS_ARRAY + ' 项的数组'), { code: EC.VALIDATION_ERROR })
    }
    for (const id of shotIds) {
      if (typeof id !== 'string' || !id.trim()) {
        throw Object.assign(new Error('shotIds 含非法分镜 id'), { code: EC.VALIDATION_ERROR })
      }
    }
    const m = typeof mode === 'string' && mode.trim() ? mode.trim() : 'full'
    return { text: service.buildCopyTexts(shotIds, m), mode: m, count: shotIds.length }
  })))

  ipcMain.handle('film-engineering:adapt-script', withSenderCheck(async (_event, payload) => {
    const params = payload || {}
    const script = params.script
    const characterMap = params.characterMap
    if (typeof script !== 'string' || !script.trim()) {
      return { code: EC.VALIDATION_ERROR, message: '剧本不能为空' }
    }
    if (script.length > MAX_SCRIPT_LENGTH) {
      return { code: EC.VALIDATION_ERROR, message: '剧本不能超过 ' + MAX_SCRIPT_LENGTH + ' 字' }
    }
    if (!characterMap || typeof characterMap !== 'object' || Array.isArray(characterMap)) {
      return { code: EC.VALIDATION_ERROR, message: '角色映射必须为对象' }
    }
    const keys = Object.keys(characterMap)
    if (keys.length > MAX_CHARACTER_MAP_KEYS) {
      return { code: EC.VALIDATION_ERROR, message: '角色映射最多 ' + MAX_CHARACTER_MAP_KEYS + ' 个键' }
    }
    for (const k of keys) {
      if (typeof characterMap[k] !== 'string' || !characterMap[k].trim()) {
        return { code: EC.VALIDATION_ERROR, message: '角色映射[' + k + '] 必须为非空字符串' }
      }
    }
    try {
      const result = await service.adaptScript({
        script,
        characterMap,
        llmEnabled: params.llmEnabled === true,
      })
      if (!result.ok) {
        return { code: EC.REQUEST_ERROR, message: result.error }
      }
      return { code: 0, data: { adaptedShots: result.adaptedShots, llmEnhanced: result.llmEnhanced, warnings: result.warnings || [] } }
    } catch (e) {
      log.warn('[film-engineering] adapt-script error:', e instanceof Error ? e.message : String(e))
      return { code: EC.REQUEST_ERROR, message: e instanceof Error ? e.message : String(e) }
    }
  }))

  ipcMain.handle('film-engineering:export', withSenderCheck(withKit((_e, selectedShots, format) => {
    if (!Array.isArray(selectedShots) || selectedShots.length === 0 || selectedShots.length > MAX_SHOTS_ARRAY) {
      throw Object.assign(new Error('selectedShots 必须为 1-' + MAX_SHOTS_ARRAY + ' 项的数组'), { code: EC.VALIDATION_ERROR })
    }
    for (const s of selectedShots) {
      if (!s || typeof s.prompt !== 'string' || !s.prompt.trim() || s.prompt.length > 50000) {
        throw Object.assign(new Error('selectedShots 每项必须含非空 prompt（<=50000 字符）'), { code: EC.VALIDATION_ERROR })
      }
    }
    const fmt = format === 'markdown' ? 'markdown' : 'json'
    return service.exportPrompts(selectedShots, fmt)
  })))

  ipcMain.handle('film-engineering:generate-selected', withSenderCheck(async (_event, selectedShots, opts) => {
    if (!Array.isArray(selectedShots) || selectedShots.length === 0 || selectedShots.length > MAX_GENERATE_BATCH) {
      return { code: EC.VALIDATION_ERROR, message: 'selectedShots 必须为 1-' + MAX_GENERATE_BATCH + ' 项的数组' }
    }
    for (const s of selectedShots) {
      if (!s || typeof s.prompt !== 'string' || !s.prompt.trim() || s.prompt.length > 50000) {
        return { code: EC.VALIDATION_ERROR, message: 'selectedShots 每项必须含非空 prompt（<=50000 字符）' }
      }
    }
    try {
      const result = await service.generateSelected(selectedShots, opts || {})
      if (!result.ok) {
        return { code: EC.REQUEST_ERROR, message: result.error, data: result.results ? { results: result.results } : undefined }
      }
      return { code: 0, data: { results: result.results, partialFailure: result.partialFailure } }
    } catch (e) {
      log.warn('[film-engineering] generate-selected error:', e instanceof Error ? e.message : String(e))
      return { code: EC.REQUEST_ERROR, message: e instanceof Error ? e.message : String(e) }
    }
  }))

  // 单镜重试（D7）：service 直调，覆盖该镜 shot_NNN.mp4，绝不触碰流水线阶段状态机；
  // 原文直送合同——prompt 取 run 内 selectedShots[shotIndex].prompt 逐字符提交，不经优化器。
  ipcMain.handle('film-engineering:retry-shot', withSenderCheck(async (_event, payload) => {
    const params = payload || {}
    const runId = params.runId
    const shotIndex = params.shotIndex
    if (typeof runId !== 'string' || !runId.trim()) {
      return { code: EC.VALIDATION_ERROR, message: 'runId 必须为非空字符串' }
    }
    if (!Number.isInteger(shotIndex) || shotIndex < 0) {
      return { code: EC.VALIDATION_ERROR, message: 'shotIndex 必须为非负整数' }
    }
    const snapshot = pipelineEngine && typeof pipelineEngine.getRunSnapshot === 'function'
      ? pipelineEngine.getRunSnapshot(runId)
      : null
    if (!snapshot) {
      return { code: EC.VALIDATION_ERROR, message: 'runId 不属于任何运行中的流水线: ' + runId }
    }
    const shots = (snapshot.context && Array.isArray(snapshot.context.selectedShots)) ? snapshot.context.selectedShots : []
    if (shots.length === 0) {
      return { code: EC.VALIDATION_ERROR, message: 'selectedShots 为空，该 run 无可重试分镜' }
    }
    if (shotIndex >= shots.length) {
      return { code: EC.VALIDATION_ERROR, message: 'shotIndex 不属于该 run（有效范围 0-' + (shots.length - 1) + '）' }
    }
    const shot = shots[shotIndex]
    if (!shot || typeof shot.prompt !== 'string' || !shot.prompt.trim()) {
      return { code: EC.VALIDATION_ERROR, message: '该镜提示词为空，无法重试' }
    }
    const aspect = FILM_ASPECTS.includes(params.aspect) ? params.aspect : '16x9'
    const seconds = FILM_DURATIONS.includes(Number(params.seconds)) ? Number(params.seconds) : 5
    const providerCfg = resolveFilmVideoProvider(aiGenerator)
    if (!providerCfg) {
      return {
        code: EC.REQUEST_ERROR,
        errorCode: 'VIDEO_MODEL_NOT_CONFIGURED',
        message: '影视工程视频重试需要视频模型（如 Seedance / Kling / Veo / CogVideo 等），请在模型设置中配置并设为默认视频 Provider 后重试',
      }
    }
    const runDir = getFilmRunDir(runId)
    try { fs.mkdirSync(runDir, { recursive: true }) } catch (e) { /* 目录已存在，忽略 */ }
    const result = await generateShotVideo({
      shot, index: shotIndex, runDir, aspect, seconds, providerCfg,
      sleep: deps._testSleep, download: deps._testDownload, log,
    })
    if (!result.success) {
      return {
        code: EC.REQUEST_ERROR,
        message: result.error || '单镜重试失败',
        data: { index: shotIndex, shotId: result.shotId, success: false },
      }
    }
    return { code: 0, data: { index: shotIndex, shotId: result.shotId, success: true, path: result.path } }
  }))

// L3 原片回收下载（D7/任务 6.2）：显式触发、零自动预取；URL 一律取 kit resultUrl
  // （renderer 传入的 url 字段忽略），allowedHosts 取 kit manifest；落盘受控媒体根
  // production/<taskId>/recycled/shot_NNN.mp4，条目可直接进 renderManifest（组 5 合同）。
  // 单项失败隔离不中断批次；并发上限 4（D7）。
  ipcMain.handle('film-engineering:download-recycled', withSenderCheck(async (_event, payload) => {
    const params = payload || {}
    const taskId = params.taskId
    if (typeof taskId !== 'string' || !taskId.trim() || taskId !== path.basename(taskId)) {
      return { code: EC.VALIDATION_ERROR, message: 'taskId 必须为非空且路径安全的字符串' }
    }
    const items = params.items
    if (!Array.isArray(items) || items.length === 0 || items.length > MAX_RECYCLE_BATCH) {
      return { code: EC.VALIDATION_ERROR, message: 'items 必须为 1-' + MAX_RECYCLE_BATCH + ' 项的数组' }
    }
    const seen = new Set()
    for (const it of items) {
      if (!it || typeof it.shotId !== 'string' || !it.shotId.trim()) {
        return { code: EC.VALIDATION_ERROR, message: 'items 每项必须含非空 shotId' }
      }
      if (!Number.isInteger(it.orderIndex) || it.orderIndex < 0 || it.orderIndex >= 10000) {
        return { code: EC.VALIDATION_ERROR, message: 'orderIndex 必须为 0-9999 的整数' }
      }
      if (seen.has(it.orderIndex)) {
        return { code: EC.VALIDATION_ERROR, message: 'orderIndex 不得重复' }
      }
      seen.add(it.orderIndex)
    }
    let allowedHosts
    const jobs = []
    try {
      allowedHosts = service.getAllowedHosts()
      for (const it of items) {
        const shot = service.getShot(it.shotId)
        jobs.push({ item: it, url: shot && typeof shot.resultUrl === 'string' && shot.resultUrl ? shot.resultUrl : null })
      }
    } catch (e) {
      const kitErr = kitError(e)
      return kitErr || { code: EC.REQUEST_ERROR, message: e instanceof Error ? e.message : String(e) }
    }
    const destDir = path.join(getFilmMediaRoot(), 'production', taskId, 'recycled')
    const dl = deps._testDownloadShot || downloadShot
    const results = new Array(jobs.length)
    const queue = jobs.map((j, i) => i)
    const worker = async () => {
      while (queue.length > 0) {
        const i = queue.shift()
        const item = jobs[i].item
        const url = jobs[i].url
        if (!url) {
          results[i] = { shotId: item.shotId, orderIndex: item.orderIndex, ok: false, error: '该镜无 resultUrl，无法回收下载（需走批量出片重新生成）' }
          continue
        }
        const fileName = 'shot_' + String(item.orderIndex).padStart(3, '0') + '.mp4'
        const r = await dl({
          url,
          shotId: item.shotId,
          destDir,
          fileName,
          allowedHosts,
          fetchImpl: deps._testFetch,
          lookupImpl: deps._testLookup,
          probeImpl: deps._testProbe,
        })
        results[i] = r.ok
          ? { shotId: item.shotId, orderIndex: item.orderIndex, ok: true, entry: { shotId: item.shotId, path: r.entry.path, sourceKind: 'downloaded', orderIndex: item.orderIndex } }
          : { shotId: item.shotId, orderIndex: item.orderIndex, ok: false, error: r.error || '下载失败' }
      }
    }
    await Promise.all(Array.from({ length: Math.min(RECYCLE_CONCURRENCY, jobs.length) }, worker))
    return { code: 0, data: { results, allOk: results.every((x) => x && x.ok), destDir } }
  }))

  // ── L3 全量分批出片（任务 7.2/8.1/8.2，design D6/D9）──────────────────
  ipcMain.handle('film-engineering:production-plan', withSenderCheck(withKit((_e, payload) => {
    const params = payload || {}
    const bad = validateProductionArgs(EC, { taskId: 'plan', shotIds: params.shotIds })
    if (bad) throw Object.assign(new Error(bad.message), { code: bad.code })
    const plan = planBatches(params.shotIds)
    return {
      shotCount: params.shotIds.length,
      batchSize: PRODUCTION_BATCH_SIZE,
      batchCount: plan.length,
      batches: plan.map((b) => ({ batchIndex: b.batchIndex, shotCount: b.shotIds.length })),
      diskEstimateBytes: params.shotIds.length * DISK_ESTIMATE_BYTES_PER_SHOT,
      wallclockEstimateSeconds: params.shotIds.length * WALLCLOCK_SECONDS_PER_SHOT,
      mediaRoot: getFilmMediaRoot(),
    }
  })))

  // 逐批执行（D9）：renderer 每批先经计划/成本预览取得用户确认，再调本通道；
  // 进度事件经 film-engineering:production-update 推送（driver 已节流，负载只带计数）。
  ipcMain.handle('film-engineering:production-run-batch', withSenderCheck(async (event, payload) => {
    const params = payload || {}
    const bad = validateProductionArgs(EC, params)
    if (bad) return bad
    const batchIndex = params.batchIndex
    if (!Number.isInteger(batchIndex) || batchIndex < 0 || batchIndex >= MAX_PRODUCTION_SHOTS) {
      return { code: EC.VALIDATION_ERROR, message: 'batchIndex 必须为 0-999 的整数' }
    }
    if (!resolveFilmVideoProvider(aiGenerator)) {
      return {
        code: EC.REQUEST_ERROR,
        errorCode: 'VIDEO_MODEL_NOT_CONFIGURED',
        message: '影视工程批量出片需要视频模型（如 Seedance / Kling / Veo / CogVideo 等），请在模型设置中配置并设为默认视频 Provider 后重试',
      }
    }
    const aspect = FILM_ASPECTS.includes(params.aspect) ? params.aspect : '16x9'
    const seconds = FILM_DURATIONS.includes(Number(params.seconds)) ? Number(params.seconds) : 5
    try {
      const driver = deps._testRunProduction || runProduction
      const probe = deps._testProbe || defaultFilmProbe
      const r = await driver({
        taskId: params.taskId,
        shotIds: params.shotIds,
        ledgerDir: path.join(getFilmMediaRoot(), 'production', params.taskId),
        runOnlyBatch: batchIndex,
        probe,
        emit: (e) => {
          try {
            if (event.sender && typeof event.sender.send === 'function') event.sender.send('film-engineering:production-update', e)
          } catch { /* 窗口已销毁：事件推送失败不影响批次执行 */ }
        },
        runBatch: (batch, ctx) => runBatchViaVideoGen({
          batch, service, aiGenerator, aspect, seconds, log, deps,
          onShotProgress: ctx.onShotProgress,
        }),
      })
      const cur = (r.ledger.batches || []).find((b) => b.batchIndex === batchIndex) || null
      return {
        code: 0,
        data: {
          ok: r.ok,
          batchIndex,
          batchStatus: cur ? cur.status : null,
          batchError: cur ? cur.error || null : null,
          failedBatches: r.failedBatches,
          renderManifest: r.renderManifest ? r.renderManifest.entries : null,
          manifestError: r.manifestError,
        },
      }
    } catch (e) {
      const kitErr = kitError(e)
      if (kitErr) return kitErr
      log.warn('[film-engineering] production-run-batch error:', e instanceof Error ? e.message : String(e))
      return { code: EC.REQUEST_ERROR, message: e instanceof Error ? e.message : String(e) }
    }
  }))

  // 断点视图（8.3）：读台账 + 磁盘双核返回批/镜状态与收口清单（只读零 provider 调用）
  ipcMain.handle('film-engineering:production-status', withSenderCheck(withKit((_e, payload) => {
    const params = payload || {}
    const bad = validateProductionArgs(EC, { taskId: params.taskId, shotIds: params.shotIds })
    if (bad) throw Object.assign(new Error(bad.message), { code: bad.code })
    const probe = deps._testProbe || defaultFilmProbe
    const ledgerDir = path.join(getFilmMediaRoot(), 'production', params.taskId)
    const ledger = loadLedger(ledgerDir)
    if (!ledger) return { exists: false, batches: [], doneCount: 0, totalCount: params.shotIds.length, renderManifest: null }
    const plan = resolveResumePlan(ledger, { probe })
    let doneCount = 0
    plan.forEach((p) => { if (!p.needRun) doneCount += p.shotIds.length })
    const manifest = buildRenderManifest(ledger, { probe })
    return {
      exists: true,
      taskId: ledger.taskId,
      batches: ledger.batches.map((b) => ({
        batchIndex: b.batchIndex,
        status: b.status,
        error: b.error || null,
        needRun: (plan[b.batchIndex] || {}).needRun === true,
        shots: (b.shots || []).map((sh) => ({ ...sh })),
      })),
      doneCount,
      totalCount: (ledger.batches || []).reduce((n, b) => n + b.shotIds.length, 0),
      renderManifest: manifest.ok ? manifest.entries : null,
      manifestError: manifest.ok ? null : manifest.error,
    }
  })))
}

module.exports = registerHandlers
