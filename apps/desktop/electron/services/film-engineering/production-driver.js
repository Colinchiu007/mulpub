// @ts-check
'use strict'
/**
 * production-driver — L3 全量分批出片驱动（openspec change: film-full-corpus-production）
 *
 * 设计依据（design D6/D9 + tasks 组 7）：
 *  - 切批：批大小 PRODUCTION_BATCH_SIZE=10（144 镜 → 15 批 = 14×10+1×4）；
 *  - 批次 runId 确定性派生 prod-<taskId>-b<batchIndex>（重入可复算）；
 *  - 台账 ledger.json 为断点续跑唯一事实源（userData film-engineering/production/
 *    <taskId>/，由调用方注入 ledgerDir）：批次清单 + 每镜状态；写盘 .tmp + rename
 *    崩溃安全；
 *  - 重入协议（D6，与 video-gen「merge 信磁盘不信内存态」同构）：读台账 → 每批
 *    做磁盘产物复核（probe 注入，默认 shot_NNN.mp4 清单）→ 磁盘齐即跳过（零
 *    provider 调用），无论台账标 done/pending/failed；
 *  - 单批失败隔离：失败批标 failed 继续后续批；收口 renderManifest 仅在全部批
 *    done 且磁盘复核全过时产出（组 5 契约条目，orderIndex 0..N-1 连续），
 *    否则 null 不产出假清单；
 *  - 进度事件（7.4）：批次级即时 + 逐镜节流合并（EVENT_MERGE_MS 窗口取最新计数），
 *    事件负载只带计数/索引，不带 shotIds 数组（IPC 负载守卫）。
 *
 * 测试 seam：runBatch（替代真实子 run，签名 (batch, {onShotProgress}) → Promise）、
 * probe（(runId, count) → {missing:[shotIndex]}）、now（时间源）、mediaRoot。
 */

const fs = require('fs')
const path = require('path')
const { getFilmMediaRoot } = require('./film-render')

const PRODUCTION_BATCH_SIZE = 10
const EVENT_MERGE_MS = 500
const LEDGER_FILE = 'ledger.json'

/** 切批：保序、batchIndex 从 0 连续 */
function planBatches (shotIds, batchSize = PRODUCTION_BATCH_SIZE) {
  const size = Number.isInteger(batchSize) && batchSize > 0 ? batchSize : PRODUCTION_BATCH_SIZE
  const batches = []
  const list = Array.isArray(shotIds) ? shotIds : []
  for (let i = 0; i < list.length; i += size) {
    batches.push({ batchIndex: batches.length, shotIds: list.slice(i, i + size) })
  }
  return batches
}

/** 新建台账（确定性 runId；重复调用同输入产出一致批次结构） */
function createLedger ({ taskId, shotIds, batchSize }) {
  const size = Number.isInteger(batchSize) && batchSize > 0 ? batchSize : PRODUCTION_BATCH_SIZE
  const plan = planBatches(shotIds, size)
  return {
    schemaVersion: 1,
    taskId: String(taskId),
    batchSize: size,
    createdAt: new Date().toISOString(),
    batches: plan.map((b) => ({
      batchIndex: b.batchIndex,
      runId: 'prod-' + taskId + '-b' + b.batchIndex,
      shotIds: b.shotIds.slice(),
      shots: b.shotIds.map((sid) => ({ shotId: sid, status: 'pending' })),
      status: 'pending',
      error: null,
    })),
  }
}

/** 台账持久化：.tmp + rename（崩溃安全，不留半截 JSON） */
function saveLedger (ledgerDir, ledger) {
  fs.mkdirSync(ledgerDir, { recursive: true })
  const target = path.join(ledgerDir, LEDGER_FILE)
  const tmp = target + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify(ledger, null, 2))
  fs.renameSync(tmp, target)
}

/** 读台账：缺失/损坏/形状非法 → null（调用方 fail-closed 重建，不吞着跑） */
function loadLedger (ledgerDir) {
  const target = path.join(ledgerDir || '', LEDGER_FILE)
  let raw
  try { raw = fs.readFileSync(target, 'utf8') } catch { return null }
  let parsed
  try { parsed = JSON.parse(raw) } catch { return null }
  if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.batches)) return null
  if (parsed.schemaVersion !== 1 || typeof parsed.taskId !== 'string') return null
  return parsed
}

/**
 * 重入协议（D6）：磁盘产物复核为唯一裁决——磁盘齐 needRun=false（零 provider 调用），
 * 台账 done 但磁盘缺 → 降级重跑；pending/failed 但磁盘齐 → 复核通过跳过（双核）。
 * @param {object} ledger
 * @param {{ probe: (runId: string, count: number) => { missing: number[] } }} deps
 */
function resolveResumePlan (ledger, { probe }) {
  return (ledger.batches || []).map((b) => {
    const p = probe(b.runId, b.shotIds.length) || { missing: [] }
    const missing = Array.isArray(p.missing) ? p.missing : []
    return {
      batchIndex: b.batchIndex,
      runId: b.runId,
      shotIds: b.shotIds.slice(),
      missing: missing.slice(),
      needRun: missing.length > 0,
    }
  })
}

/** shot_NNN.mp4 命名（与 video-gen/film-render 磁盘信物一致） */
function shotFileName (shotIndex) {
  return 'shot_' + String(shotIndex).padStart(3, '0') + '.mp4'
}

/**
 * 全批收口自动生成 renderManifest（组 5 契约）。
 * 双判据：台账每批 status=done 且磁盘复核全过，否则不产出（防假成片清单）。
 * @param {object} ledger
 * @param {{ mediaRoot?: string, probe: Function }} deps
 */
function buildRenderManifest (ledger, { mediaRoot = getFilmMediaRoot(), probe }) {
  const entries = []
  const missing = []
  let orderIndex = 0
  for (const b of ledger.batches || []) {
    const p = probe(b.runId, b.shotIds.length) || { missing: [] }
    const miss = Array.isArray(p.missing) ? p.missing : []
    for (const mi of miss) missing.push({ runId: b.runId, shotIndex: mi })
    for (let i = 0; i < b.shotIds.length; i++) {
      if (miss.includes(i)) continue
      entries.push({
        shotId: b.shotIds[i],
        path: path.join(mediaRoot, b.runId, shotFileName(i)),
        sourceKind: 'generated',
        orderIndex: orderIndex++,
      })
    }
  }
  if (missing.length > 0 || (ledger.batches || []).some((b) => b.status !== 'done')) {
    return {
      ok: false,
      error: '收口失败：存在缺失/未完成镜头产物（缺失 ' + missing.length + ' 个）',
      missing,
    }
  }
  return { ok: true, entries }
}

/**
 * 驱动全量分批出片（顺序执行、隔离失败、崩溃续跑、事件节流）。
 * @param {{
 *   taskId: string, shotIds: string[], ledgerDir: string,
 *   runBatch: (batch: object, ctx: { onShotProgress: Function }) => Promise<void>,
 *   probe: (runId: string, count: number) => { missing: number[] },
 *   emit?: (event: object) => void, now?: () => number,
 *   mediaRoot?: string, batchSize?: number,
 *   runOnlyBatch?: number|null,
 * }} opts
 */
async function runProduction (opts) {
  const {
    taskId, shotIds, ledgerDir, runBatch, probe,
    emit = () => {}, now = Date.now,
    mediaRoot = getFilmMediaRoot(), batchSize = PRODUCTION_BATCH_SIZE,
    runOnlyBatch = null,
  } = opts || {}
  if (typeof taskId !== 'string' || !taskId.trim() || taskId !== path.basename(taskId)) {
    throw new Error('production-driver: taskId 必须为非空且路径安全的字符串')
  }
  if (!Array.isArray(shotIds) || shotIds.length === 0) {
    throw new Error('production-driver: shotIds 必须为非空数组')
  }
  if (typeof runBatch !== 'function' || typeof probe !== 'function') {
    throw new Error('production-driver: 需要 runBatch 与 probe 注入')
  }
  if (runOnlyBatch !== null && runOnlyBatch !== undefined && !Number.isInteger(runOnlyBatch)) {
    throw new Error('production-driver: runOnlyBatch 必须为整数或 null')
  }

  // 台账：磁盘已有且批次结构与本次计划一致 → 续跑复用；否则（缺失/损坏/不一致）重建
  let ledger = loadLedger(ledgerDir)
  const planShape = planBatches(shotIds, batchSize)
  const sameShape = ledger
    && ledger.taskId === taskId
    && ledger.batches.length === planShape.length
    && ledger.batches.every((b, i) => b.shotIds.length === planShape[i].shotIds.length)
  if (!sameShape) {
    ledger = createLedger({ taskId, shotIds, batchSize })
    saveLedger(ledgerDir, ledger)
  }

  const totalCount = shotIds.length
  const plan = resolveResumePlan(ledger, { probe })
  let doneCount = 0
  plan.forEach((p) => { if (!p.needRun) doneCount += p.shotIds.length })

  // 逐镜事件节流：窗口内合并为最新计数（7.4）
  let lastShotEmitAt = -Infinity
  function emitShotProgress (extra) {
    const t = now()
    if (t - lastShotEmitAt >= EVENT_MERGE_MS) {
      lastShotEmitAt = t
      emit({ type: 'production:shot-progress', doneCount, totalCount, ...extra })
    }
  }

  const failedBatches = []
  for (const p of plan) {
    const batch = ledger.batches[p.batchIndex]
    // D9 逐批确认语义：runOnlyBatch 只执行指定批，其余待跑批保持 pending 不执行
    if (runOnlyBatch !== null && runOnlyBatch !== undefined && p.batchIndex !== runOnlyBatch && p.needRun) continue
    if (!p.needRun) {
      // 磁盘复核通过：台账态归一为 done（含上次崩溃在写盘前的场景）
      if (batch.status !== 'done') {
        batch.status = 'done'
        batch.shots.forEach((s) => { s.status = 'done' })
        saveLedger(ledgerDir, ledger)
      }
      emit({ type: 'production:batch', batchIndex: p.batchIndex, status: 'skipped-complete', doneCount, totalCount })
      continue
    }
    batch.status = 'running'
    batch.error = null
    saveLedger(ledgerDir, ledger)
    emit({ type: 'production:batch', batchIndex: p.batchIndex, status: 'running', doneCount, totalCount })
    try {
      await runBatch(batch, {
        onShotProgress: (shotIndex, status) => {
          if (batch.shots[shotIndex]) {
            const next = status === 'done' ? 'done' : 'failed'
            if (batch.shots[shotIndex].status !== 'done' && next === 'done') doneCount++
            batch.shots[shotIndex].status = next
          }
          emitShotProgress({ batchIndex: p.batchIndex, shotIndex })
        },
      })
      // 批后以磁盘信物为准复核（不信 runBatch 自报）；新转 done 的镜补计 doneCount
      const after = probe(batch.runId, batch.shotIds.length) || { missing: [] }
      const miss = Array.isArray(after.missing) ? after.missing : []
      batch.shots.forEach((s, i) => {
        if (!miss.includes(i) && s.status !== 'done') {
          s.status = 'done'
          doneCount = Math.min(doneCount + 1, totalCount)
        }
      })
      if (miss.length > 0) {
        batch.status = 'failed'
        batch.error = '批次生成后磁盘缺 ' + miss.length + ' 镜'
      } else {
        batch.status = 'done'
      }
    } catch (e) {
      batch.status = 'failed'
      batch.error = (e && e.message) || String(e)
    }
    saveLedger(ledgerDir, ledger)
    if (batch.status === 'failed') failedBatches.push({ batchIndex: p.batchIndex, error: batch.error })
    emit({ type: 'production:batch', batchIndex: p.batchIndex, status: batch.status, error: batch.error || null, doneCount, totalCount })
  }

  const manifest = buildRenderManifest(ledger, { mediaRoot, probe })
  const ok = failedBatches.length === 0 && manifest.ok
  emit({ type: 'production:complete', ok, doneCount, totalCount, failedBatchCount: failedBatches.length })
  return {
    ok,
    ledger,
    renderManifest: manifest.ok ? manifest : null,
    manifestError: manifest.ok ? null : manifest.error,
    failedBatches,
  }
}

module.exports = {
  planBatches,
  createLedger,
  saveLedger,
  loadLedger,
  resolveResumePlan,
  buildRenderManifest,
  runProduction,
  shotFileName,
  PRODUCTION_BATCH_SIZE,
  EVENT_MERGE_MS,
}
