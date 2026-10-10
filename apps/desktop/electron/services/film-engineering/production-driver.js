// @ts-check
'use strict'
/**
 * production-driver — L3 全量分批出片驱动（openspec change: film-full-corpus-production）
 *
 * 设计依据（design D6/D9 + tasks 组 7）：
 *  - 切批：批大小 PRODUCTION_BATCH_SIZE=10（144 镜 → 15 批 = 14×10+1×4）；
 *  - 批次 runId 确定性派生 prod-<taskId>-<fp10(批次分镜集)>-b<batchIndex>（重入可复算；
 *    指纹使「同一 taskId 换分镜集」落入不同目录，避免旧产物被新任务采纳）；
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

const crypto = require('crypto')
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

/**
 * 批次分镜集指纹（10 位十六进制 = 40 bit）。
 *
 * 为什么必须有：runId 此前只由 taskId + 批次号决定，而 taskId 是**用户手输**的。
 * 同一 taskId 换一组分镜、恰好每批数量相同时，目录名不变 ⇒ 上一组的 shot_NNN.mp4
 * 仍在 ⇒ 磁盘复核判「已齐」⇒ 整批跳过。台账（#3110）虽已正确比对 shotId，
 * 但产物层没有身份，就会出现「清单声称新分镜、文件里装的是旧分镜」的反向失效。
 *
 * 口径：按**批次自身**的分镜序计算（非整任务），换第 1 批不影响第 0 批目录；
 * 用 '\n' 而非 ',' 分隔以免 shotId 含分隔符时产生歧义碰撞。
 * 位宽取 10（8 位 32bit 在万级批次下生日碰撞已不可忽略，10 位在 10^6 批次下仍约 10^-6）。
 * 指纹仅作身份标识，不作安全用途。
 */
function fingerprintBatch (shotIds) {
  const payload = (Array.isArray(shotIds) ? shotIds : []).map((s) => String(s)).join('\n')
  return crypto.createHash('sha1').update(payload, 'utf8').digest('hex').slice(0, 10)
}

/**
 * 默认批次 runId：`prod-<taskId>-<fp10>-b<N>`，产物落 `<mediaRoot>/<runId>/`。
 *
 * 存量台账零影响：断点续跑的 runId 一律取自**台账所载 `b.runId`**
 * （见 resolveResumePlan / buildRenderManifest），SHALL NOT 在续跑路径重新派生；
 * `createLedger` 是唯一调用派生的入口，且仅在台账缺失/损坏/分镜集不匹配时执行。
 * 因此旧格式台账直接沿用其历史 runId，新台账才用新格式，无需任何迁移。
 */
function defaultRunIdFor (taskId, batchIndex, shotIds) {
  const fp = shotIds ? fingerprintBatch(shotIds) : null
  return 'prod-' + taskId + (fp ? '-' + fp : '') + '-b' + batchIndex
}

/** 新建台账（确定性 runId；重复调用同输入产出一致批次结构） */
function createLedger ({ taskId, shotIds, batchSize, runIdFor }) {
  const size = Number.isInteger(batchSize) && batchSize > 0 ? batchSize : PRODUCTION_BATCH_SIZE
  const makeRunId = typeof runIdFor === 'function' ? runIdFor : defaultRunIdFor
  const plan = planBatches(shotIds, size)
  return {
    schemaVersion: 1,
    taskId: String(taskId),
    batchSize: size,
    createdAt: new Date().toISOString(),
    batches: plan.map((b) => ({
      batchIndex: b.batchIndex,
      runId: String(makeRunId(String(taskId), b.batchIndex, b.shotIds)),
      shotIds: b.shotIds.slice(),
      shots: b.shotIds.map((sid) => ({ shotId: sid, status: 'pending', error: null })),
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
 *   runIdFor?: (taskId: string, batchIndex: number) => string,   // 默认 prod-<taskId>-b<N>；自动模式传 'auto/<taskId>/b<N>'
 * }} opts
 */
async function runProduction (opts) {
  const {
    taskId, shotIds, ledgerDir, runBatch, probe,
    emit = () => {}, now = Date.now,
    mediaRoot = getFilmMediaRoot(), batchSize = PRODUCTION_BATCH_SIZE,
    runOnlyBatch = null, runIdFor, shouldStop,
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

  // 台账：磁盘已有且批次结构与本次计划一致 → 续跑复用；否则（缺失/损坏/不一致）重建。
  //
  // 一致性必须比对 shotId **本身**而非仅比每批数量：台账以 taskId 为键，而 taskId
  // 是用户手输的（不是系统生成的），同一个 taskId 下换一组分镜、恰好每批数量相同
  // 是完全可能的场景。只比数量会让台账被静默复用——新分镜被丢弃、系统继续跑台账里
  // 的旧分镜且不告警。对「逐批确认后才计费」的产品语义，这是最危险的一类静默失真。
  let ledger = loadLedger(ledgerDir)
  const planShape = planBatches(shotIds, batchSize)
  const sameShotIds = (a, b) =>
    Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => v === b[i])
  const sameShape = ledger
    && ledger.taskId === taskId
    && ledger.batches.length === planShape.length
    && ledger.batches.every((b, i) => sameShotIds(b.shotIds, planShape[i].shotIds))
  if (!sameShape) {
    ledger = createLedger({ taskId, shotIds, batchSize, runIdFor })
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
  let stopped = false
  for (const p of plan) {
    const batch = ledger.batches[p.batchIndex]
    // D9 逐批确认语义：runOnlyBatch 只执行指定批，其余待跑批保持 pending 不执行
    if (runOnlyBatch !== null && runOnlyBatch !== undefined && p.batchIndex !== runOnlyBatch && p.needRun) continue
    // 停止（批间生效）：只看**开始一批之前**的标志，已开始的批必然跑完；
    // 未开始的批保持 pending（不写 failed），因此停下来的任务天然可续跑。
    if (typeof shouldStop === 'function' && p.needRun) {
      // 不要写成 `let stop = false`：try 与 catch 都会赋值，初始值必被覆盖
      // （ESLint no-useless-assignment 判 error，Gate 11 阻断）；两条路径都不留 undefined
      let stop

      try { stop = shouldStop() === true } catch { stop = false }
      if (stop) {
        stopped = true
        emit({ type: 'production:stopped', doneCount, totalCount, batchIndex: p.batchIndex })
        break
      }
    }
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
        onShotProgress: (shotIndex, status, reason) => {
          if (batch.shots[shotIndex]) {
            const next = status === 'done' ? 'done' : 'failed'
            if (batch.shots[shotIndex].status !== 'done' && next === 'done') doneCount++
            batch.shots[shotIndex].status = next
            batch.shots[shotIndex].error = next === 'done' ? null : (typeof reason === 'string' && reason ? reason.slice(0, 500) : null)
          }
          emitShotProgress({ batchIndex: p.batchIndex, shotIndex, reason: batch.shots[shotIndex] ? batch.shots[shotIndex].error : undefined })
        },
      })
      // 批后以磁盘信物为准复核（不信 runBatch 自报）；新转 done 的镜补计 doneCount
      const after = probe(batch.runId, batch.shotIds.length) || { missing: [] }
      const miss = Array.isArray(after.missing) ? after.missing : []
      batch.shots.forEach((s, i) => {
        if (!miss.includes(i) && s.status !== 'done') {
          s.status = 'done'
          s.error = null
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
  emit({ type: 'production:complete', ok, stopped, doneCount, totalCount, failedBatchCount: failedBatches.length })
  return {
    ok,
    stopped,
    ledger,
    renderManifest: manifest.ok ? manifest : null,
    manifestError: manifest.ok ? null : manifest.error,
    failedBatches,
  }
}

module.exports = {
  planBatches,
  fingerprintBatch,
  defaultRunIdFor,
  createLedger,
  defaultRunIdFor,
  saveLedger,
  loadLedger,
  resolveResumePlan,
  buildRenderManifest,
  runProduction,
  shotFileName,
  PRODUCTION_BATCH_SIZE,
  EVENT_MERGE_MS,
}
