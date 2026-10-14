// @ts-check
'use strict'
/**
 * film-engineering 全量出片（production）相关 IPC 通道。
 *
 * 拆分理由（`.github/scripts/check-max-lines.js` 的 maxFileLines 门禁）：
 * `film-engineering.js` 在 488 行时距 500 上限只剩 12 行余量，任意一条新通道都会
 * 触发 `NEW_OVER_LIMIT`。本仓既有先例即 `production-runner.js`（同为过该门禁而拆出）。
 * 本模块把**全量出片族**通道整体抽出，使主文件回到有实际余量的规模。
 *
 * 覆盖通道：
 *   - film-engineering:production-retry-shot   按出片台账定位批次的单镜重试
 *   - film-engineering:production-plan        批次计划预览（只读、零 Provider 调用）
 *   - film-engineering:production-run-batch  逐批执行（驱动 production-driver）
 *   - film-engineering:production-status     断点视图（只读台账 + 磁盘双核）
 *
 * 合同见 openspec/specs/film-engineering/spec.md 的「全量分批出片驱动」「失败分镜单镜重试」。
 */
const fs = require('fs')
const path = require('path')
const { withSenderCheck } = require('./helpers')
const { getFilmMediaRoot } = require('../services/film-engineering/film-render')
const DISK_ESTIMATE_BYTES_PER_SHOT = 8 * 1024 * 1024
const MAX_PRODUCTION_SHOTS = 1000
const WALLCLOCK_SECONDS_PER_SHOT = 300

const { runProduction, loadLedger, planBatches, resolveResumePlan, buildRenderManifest, PRODUCTION_BATCH_SIZE } = require('../services/film-engineering/production-driver')
const { runBatchViaVideoGen } = require('../services/film-engineering/production-runner')
const { generateShotVideo, resolveFilmVideoProvider, getFilmRunDir, FILM_ASPECTS, FILM_DURATIONS } = require('../services/film-engineering/video-gen')

/** 出片台账 taskId 参数校验（路径遍历防护）；供 plan / run-batch / status 复用 */
function validateProductionArgs (EC, params) {
  const taskId = params.taskId
  if (typeof taskId !== 'string' || !taskId.trim() || taskId !== path.basename(taskId)) {
    return { code: EC.VALIDATION_ERROR, message: 'taskId 必须为非空且路径安全的字符串' }
  }
  const shotIds = params.shotIds
  if (!Array.isArray(shotIds) || shotIds.length === 0 || shotIds.length > 1000) {
    return { code: EC.VALIDATION_ERROR, message: 'shotIds 必须为 1-1000 项的数组' }
  }
  for (const id of shotIds) {
    if (typeof id !== 'string' || !id.trim()) {
      return { code: EC.VALIDATION_ERROR, message: 'shotIds 含非法分镜 id' }
    }
  }
  return null
}

/** run 目录磁盘信物复核：shot_NNN.mp4 存在性；missing 为批内索引 */
function defaultFilmProbe (runId, count) {
  const dir = getFilmRunDir(runId)
  const missing = []
  for (let i = 0; i < count; i++) {
    if (!fs.existsSync(path.join(dir, 'shot_' + String(i).padStart(3, '0') + '.mp4'))) missing.push(i)
  }
  return { missing }
}

/**
 * 注册全量出片族通道。
 * @param {object} ipcMain
 * @param {object} deps —— 需含 log / filmEngineeringService / aiGenerator / pipelineEngine
 * @param {object} EC —— error-codes 的 ERROR 枚举
 * @param {Function} withKit —— 主文件提供的信封包装器（保持错误信封口径单源）
 * @param {Function} kitError —— 主文件提供的 FILM_KIT_UNAVAILABLE 判定（信封口径单源）
 */
function registerProductionHandlers (ipcMain, deps, EC, withKit, kitError) {
  const log = deps.log || { info () {}, warn () {}, error () {} }
  const service = deps.filmEngineeringService
  const aiGenerator = deps.aiGenerator

/**
 * L3 出片台账批次单镜重试（openspec change: film-production-artifact-identity）。
 *
 * 为什么不能复用上面的 `retry-shot`：那条通道用 `pipelineEngine.getRunSnapshot(runId)`
 * 定位**流水线 run 快照**，而出片批次由 `runBatchViaVideoGen` 直接调 `generateShotVideo`、
 * 从不注册为流水线 run ⇒ 恒返回 null ⇒ 全量出片面板的「重试该镜」必然报
 * 「runId 不属于任何运行中的流水线」。
 *
 * 本通道改按**出片台账**定位：taskId → <mediaRoot>/production/<taskId>/ledger.json
 * → 按 batchIndex 取批次 → 按 shotIndex 取 shotId → `service.getShot(shotId)` 取**原文**
 * → 生成并覆盖该批次 runDir 的 shot_NNN.mp4。
 *
 * 副作用收益：渲染端不再拼接任何 runId，批次 runId 派生规则回到单一真源
 * （production-driver），消除跨层复刻。
 */
  ipcMain.handle('film-engineering:production-retry-shot', withSenderCheck(async (_event, payload) => {
    const params = payload || {}
    const taskId = params.taskId
    if (typeof taskId !== 'string' || !taskId.trim() || taskId !== path.basename(taskId)) {
      return { code: EC.VALIDATION_ERROR, message: 'taskId 必须为非空且路径安全的字符串' }
    }
    const batchIndex = params.batchIndex
    if (!Number.isInteger(batchIndex) || batchIndex < 0) {
      return { code: EC.VALIDATION_ERROR, message: 'batchIndex 必须为非负整数' }
    }
    const shotIndex = params.shotIndex
    if (!Number.isInteger(shotIndex) || shotIndex < 0) {
      return { code: EC.VALIDATION_ERROR, message: 'shotIndex 必须为非负整数' }
    }

    const ledger = loadLedger(path.join(getFilmMediaRoot(), 'production', taskId))
    if (!ledger) {
      return { code: EC.VALIDATION_ERROR, message: '未找到该任务的出片台账（可能尚未发起出片或台账已损坏）: ' + taskId }
    }
    const batch = (Array.isArray(ledger.batches) ? ledger.batches : []).find((b) => b && b.batchIndex === batchIndex)
    if (!batch) {
      return { code: EC.VALIDATION_ERROR, message: 'batchIndex 未在该出片台账中命中批次: ' + batchIndex }
    }
    const batchShots = Array.isArray(batch.shotIds) ? batch.shotIds : []
    if (batchShots.length === 0) {
      return { code: EC.VALIDATION_ERROR, message: '该批次无分镜记录，无法重试' }
    }
    if (shotIndex >= batchShots.length) {
      return { code: EC.VALIDATION_ERROR, message: 'shotIndex 不属于该批次（有效范围 0-' + (batchShots.length - 1) + '）' }
    }
    const shotId = batchShots[shotIndex]

    // 原文直送：按台账 shotId 从 kit 取该镜提示词，逐字符提交，不过任何优化器
    let shot
    try {
      shot = service.getShot(shotId)
    } catch (e) {
      return {
        code: EC.VALIDATION_ERROR,
        message: '取分镜原文失败（' + shotId + '）：' + (e instanceof Error ? e.message : String(e)),
      }
    }
    if (!shot || typeof shot.prompt !== 'string' || !shot.prompt.trim()) {
      return { code: EC.VALIDATION_ERROR, message: '该镜提示词为空，无法重试: ' + shotId }
    }

    const aspect = FILM_ASPECTS.includes(params.aspect) ? params.aspect : '16x9'
    const seconds = FILM_DURATIONS.includes(Number(params.seconds)) ? Number(params.seconds) : 5
    const providerCfg = resolveFilmVideoProvider(aiGenerator)
    if (!providerCfg) {
      return {
        code: EC.REQUEST_ERROR,
        errorCode: 'VIDEO_MODEL_NOT_CONFIGURED',
        message: '影视工程批量出片重试需要视频模型（如 Seedance / Kling / Veo / CogVideo 等），请在模型设置中配置并设为默认视频 Provider 后重试',
      }
    }
    const runId = String(batch.runId || '')
    if (!runId || runId !== path.basename(runId)) {
      return { code: EC.VALIDATION_ERROR, message: '台账所载批次 runId 非法: ' + runId }
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
        data: { batchIndex, shotIndex, shotId: result.shotId, success: false },
      }
    }
    return { code: 0, data: { batchIndex, shotIndex, shotId: result.shotId, success: true, path: result.path } }
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

module.exports = { registerProductionHandlers, validateProductionArgs, defaultFilmProbe }
