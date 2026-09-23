// @ts-check
/**
 * useFilmProduction — 影视工程「全量分批出片」前端驱动（tasks 8.1-8.4，design D6/D9/D10）
 *
 * 状态机（与后端三通道 production-plan / production-run-batch / production-status 对齐）：
 *   idle → plan-production() → plan-ready（8.1 批次计划预览：批次数/镜数/磁盘/墙钟估算）
 *   → begin()（用户发起确认）→ batching（8.2 逐批确认：currentBatch 确认卡 → confirmBatch()
 *     调 run-batch 单批；批后以 production-status 台账+磁盘双核重同步，进度事件仅增量刷新计数）
 *   → 全部批次收口自动得 renderManifest → manifest-ready
 *   → composeFinal()（manifest 直通 run：generate_videos 零调用过闸 → film_render 合成）→ done（finalPath）
 *   断点续跑：resume() 只读 production-status 恢复批/镜视图（8.3）；
 *   失败镜：retryShotInBatch() 复用 film-engineering:retry-shot（runId=prod-<taskId>-b<idx> 确定性派生）；
 *   回收引导（D10）：recycleAll() 分片（≤50/片）调 download-recycled，"先回收后精修"。
 *
 * 渲染纪律（8.4）：批/镜状态更新一律就地 mutate 字段（不整体替换数组对象），
 * 视图层展开态以 batchIndex 为键存于组件本地，进度刷新不重置用户展开态。
 * 文案合同：本 composable 不注入 i18n，只透出 errorCode/原始信息，View 层负责本地化映射。
 */
import { ref, computed } from 'vue'
import { getApi } from '@/api/electron-bridge'
import {
  pipelineStartOrchestrated,
  pipelineGetRunContext,
  onPipelineUpdate,
  filmEngineeringRetryShot,
} from '@/api/publisher'

const MAX_RECYCLE_BATCH = 50
const POLL_INTERVAL_MS = 3000

export function useFilmProduction () {
  const api = () => (getApi() || {}).filmEngineering || null

  const phase = ref('idle') // idle | plan-ready | batching | manifest-ready | composing | done | failed
  const busy = ref(false)
  const plan = ref(null)
  const taskId = ref(null)
  const shotIds = ref([])
  const chosen = ref({ aspect: '16x9', seconds: 5 })
  /** @type {import('vue').Ref<Array<{batchIndex:number,shotCount:number,status:string,error:any,doneShots:number}>>} */
  const batches = ref([])
  const progress = ref({ doneCount: 0, totalCount: 0 })
  const renderManifest = ref(null)
  const manifestError = ref(null)
  const failedBatches = ref([])
  const confirmedBatchIndexes = ref([])
  const recycled = ref(null)
  const finalPath = ref(null)
  const errorCode = ref(null)
  const errorText = ref(null)

  let disposed = false
  let prodUnsubscribe = null
  let pipelineUnsubscribe = null
  let pollTimer = null
  let composeRunId = null

  const batchCount = computed(() => (plan.value ? plan.value.batchCount : 0))
  const remainingBatchCount = computed(() =>
    batches.value.filter((b) => b.status === 'pending' || b.status === 'failed').length)
  // 累计已确认预算口径（D9 缓解项）：已确认批的镜数合计（价格=镜数×参数，与 plan 估算同口径）
  const confirmedShotCount = computed(() =>
    batches.value
      .filter((b) => confirmedBatchIndexes.value.includes(b.batchIndex))
      .reduce((n, b) => n + b.shotCount, 0))
  const currentBatch = computed(() => {
    const pending = batches.value.find((b) => b.status === 'pending' || b.status === 'failed')
    return pending || null
  })

  function stopProdTracking () {
    if (prodUnsubscribe) { try { prodUnsubscribe() } catch (_) { /* 取消订阅失败无害 */ } prodUnsubscribe = null }
  }

  function startProdTracking () {
    stopProdTracking()
    const a = api()
    if (!a || typeof a.onProductionUpdate !== 'function') return
    prodUnsubscribe = a.onProductionUpdate((evt) => applyProductionEvent(evt))
  }

  /** 进度事件增量刷新（节流负载只带计数，单调不回退；不重建 batches，保展开态） */
  function applyProductionEvent (evt) {
    if (disposed || !evt || typeof evt !== 'object') return
    if (Number.isFinite(evt.doneCount)) {
      progress.value = {
        doneCount: Math.max(progress.value.doneCount, Number(evt.doneCount)),
        totalCount: Number.isFinite(evt.totalCount) ? Number(evt.totalCount) : progress.value.totalCount,
      }
    }
    if (evt.type === 'production:batch' && Number.isInteger(evt.batchIndex)) {
      const b = batches.value.find((x) => x.batchIndex === evt.batchIndex)
      if (b && typeof evt.status === 'string') {
        b.status = evt.status
        if (evt.error !== undefined) b.error = evt.error
      }
    }
  }

  function applyStatus (data) {
    if (!data || !Array.isArray(data.batches)) return
    for (const sb of data.batches) {
      if (!sb || !Number.isInteger(sb.batchIndex)) continue
      let entry = batches.value.find((b) => b.batchIndex === sb.batchIndex)
      if (!entry) {
        entry = { batchIndex: sb.batchIndex, shotCount: Array.isArray(sb.shots) ? sb.shots.length : 0, status: 'pending', error: null, doneShots: 0 }
        batches.value.push(entry)
        batches.value.sort((x, y) => x.batchIndex - y.batchIndex)
      }
      entry.status = sb.needRun === true ? (sb.status === 'failed' ? 'failed' : 'pending') : sb.status
      entry.error = sb.error || null
      entry.doneShots = Array.isArray(sb.shots) ? sb.shots.filter((s) => s && s.status === 'done').length : 0
      entry.shots = Array.isArray(sb.shots) ? sb.shots : entry.shots || null
      if (Number.isInteger(entry.shotCount) === false || entry.shotCount === 0) entry.shotCount = Array.isArray(sb.shots) ? sb.shots.length : entry.shotCount
    }
    if (Number.isFinite(data.doneCount)) progress.value.doneCount = Number(data.doneCount)
    if (Number.isFinite(data.totalCount)) progress.value.totalCount = Number(data.totalCount)
    renderManifest.value = Array.isArray(data.renderManifest) && data.renderManifest.length > 0 ? data.renderManifest : renderManifest.value
    manifestError.value = data.manifestError || null
  }

  async function syncStatus () {
    const a = api()
    if (!a || !taskId.value || shotIds.value.length === 0) return { ok: false, errorCode: 'noTask' }
    const res = await a.productionStatus(JSON.parse(JSON.stringify({ taskId: taskId.value, shotIds: shotIds.value.slice() })))
    if (!res || res.code !== 0) {
      return { ok: false, errorCode: 'statusFailed', error: (res && res.message) || null }
    }
    applyStatus(res.data)
    return { ok: true, data: res.data }
  }

  /** 收口判定：manifest 就绪即进入 manifest-ready */
  function checkConvergence () {
    if (renderManifest.value && renderManifest.value.length > 0) {
      phase.value = 'manifest-ready'
      return true
    }
    return false
  }

  /** 8.1 计划预览（只读零 provider 调用） */
  async function planProduction (ids) {
    const a = api()
    const list = Array.isArray(ids) ? ids : []
    if (!a) return { ok: false, errorCode: 'noDesktop' }
    if (list.length === 0) return { ok: false, errorCode: 'noShots' }
    busy.value = true
    try {
      const res = await a.productionPlan(JSON.parse(JSON.stringify({ shotIds: list })))
      if (!res || res.code !== 0) {
        errorCode.value = 'planFailed'
        errorText.value = (res && res.message) || null
        return { ok: false, errorCode: 'planFailed', error: errorText.value }
      }
      plan.value = res.data
      shotIds.value = list.slice()
      progress.value = { doneCount: 0, totalCount: res.data.shotCount }
      errorCode.value = null
      errorText.value = null
      phase.value = 'plan-ready'
      return { ok: true, plan: res.data }
    } catch (e) {
      errorCode.value = 'planError'
      errorText.value = (e && e.message) || String(e)
      return { ok: false, errorCode: 'planError', error: errorText.value }
    } finally {
      busy.value = false
    }
  }

  /** 用户确认发起（plan-ready → batching）：实例化批视图并订阅进度事件 */
  function begin (id) {
    if (!plan.value) return { ok: false, errorCode: 'noPlan' }
    if (!id || typeof id !== 'string' || !id.trim()) return { ok: false, errorCode: 'noTaskId' }
    taskId.value = id.trim()
    batches.value = (plan.value.batches || []).map((b) => ({
      batchIndex: b.batchIndex, shotCount: b.shotCount, status: 'pending', error: null, doneShots: 0, shots: null,
    }))
    renderManifest.value = null
    manifestError.value = null
    failedBatches.value = []
    confirmedBatchIndexes.value = []
    recycled.value = null
    phase.value = 'batching'
    startProdTracking()
    return { ok: true }
  }

  /** 8.2 逐批确认执行：单批 run-batch（确认后该批才开始计费）→ 双核重同步 */
  async function confirmBatch (batchIndex) {
    const a = api()
    if (!a || !taskId.value) return { ok: false, errorCode: 'noTask' }
    if (!Number.isInteger(batchIndex) || batchIndex < 0) return { ok: false, errorCode: 'badIndex' }
    if (!confirmedBatchIndexes.value.includes(batchIndex)) confirmedBatchIndexes.value.push(batchIndex)
    busy.value = true
    try {
      const payload = JSON.parse(JSON.stringify({
        taskId: taskId.value, shotIds: shotIds.value.slice(), batchIndex,
        aspect: chosen.value.aspect, seconds: chosen.value.seconds,
      }))
      const res = await a.productionRunBatch(payload)
      if (!res || res.code !== 0) {
        errorCode.value = res && res.errorCode ? res.errorCode : 'runFailed'
        errorText.value = (res && res.message) || null
        return { ok: false, errorCode: errorCode.value, error: errorText.value }
      }
      if (Array.isArray(res.data.failedBatches)) failedBatches.value = res.data.failedBatches
      if (Array.isArray(res.data.renderManifest)) renderManifest.value = res.data.renderManifest
      if (res.data.manifestError) manifestError.value = res.data.manifestError
      await syncStatus()
      if (!checkConvergence() && res.data.batchStatus === 'failed') phase.value = 'batching'
      return { ok: true, data: res.data }
    } catch (e) {
      errorCode.value = 'runError'
      errorText.value = (e && e.message) || String(e)
      return { ok: false, errorCode: 'runError', error: errorText.value }
    } finally {
      busy.value = false
    }
  }

  /** 手动收口（全部批次已 done 后取 manifest；断点续跑后常用） */
  async function finalize () {
    busy.value = true
    try {
      const r = await syncStatus()
      if (!r.ok) return r
      if (checkConvergence()) return { ok: true, manifest: renderManifest.value }
      return { ok: false, errorCode: 'notConverged', error: manifestError.value || null }
    } finally {
      busy.value = false
    }
  }

  /** 8.3 断点续跑：只读台账+磁盘双核恢复视图（零 provider 调用） */
  async function resume (id, ids) {
    const a = api()
    if (!a) return { ok: false, errorCode: 'noDesktop' }
    if (!id || !String(id).trim() || !Array.isArray(ids) || ids.length === 0) return { ok: false, errorCode: 'noTask' }
    busy.value = true
    try {
      taskId.value = String(id).trim()
      shotIds.value = ids.slice()
      batches.value = []
      renderManifest.value = null
      const res = await a.productionStatus(JSON.parse(JSON.stringify({ taskId: taskId.value, shotIds: shotIds.value })))
      if (!res || res.code !== 0) {
        return { ok: false, errorCode: 'statusFailed', error: (res && res.message) || null }
      }
      if (!res.data.exists) return { ok: false, errorCode: 'noLedger' }
      if (!plan.value) {
        const p = await a.productionPlan(JSON.parse(JSON.stringify({ shotIds: shotIds.value })))
        if (p && p.code === 0) plan.value = p.data
      }
      applyStatus(res.data)
      progress.value = { doneCount: res.data.doneCount || 0, totalCount: res.data.totalCount || shotIds.value.length }
      failedBatches.value = res.data.batches.filter((b) => b.status === 'failed').map((b) => ({ batchIndex: b.batchIndex, error: b.error || null }))
      phase.value = checkConvergence() ? 'manifest-ready' : 'batching'
      startProdTracking()
      return { ok: true, data: res.data }
    } catch (e) {
      return { ok: false, errorCode: 'resumeError', error: (e && e.message) || String(e) }
    } finally {
      busy.value = false
    }
  }

  /** 8.3 失败镜单镜重试：复用 retry-shot 通道（prompt 由主进程按 runId/shotIndex 取原文） */
  async function retryShotInBatch (batchIndex, shotIndex) {
    const a = api()
    if (!a || !taskId.value) return { ok: false, errorCode: 'noTask' }
    if (!Number.isInteger(batchIndex) || !Number.isInteger(shotIndex) || shotIndex < 0) return { ok: false, errorCode: 'badIndex' }
    const payload = JSON.parse(JSON.stringify({
      runId: 'prod-' + taskId.value + '-b' + batchIndex,
      shotIndex,
      aspect: chosen.value.aspect,
      seconds: chosen.value.seconds,
    }))
    const res = await filmEngineeringRetryShot(payload)
    if (res && res.code === 0 && res.data && res.data.success) {
      await syncStatus()
      checkConvergence()
      return { ok: true, data: res.data }
    }
    return { ok: false, error: (res && res.message) || null, errorCode: (res && res.errorCode) || null }
  }

  /** D10 回收通道："先回收后精修"——全部选中镜按 orderIndex 分片下载原片（≤50/片） */
  async function recycleAll () {
    const a = api()
    if (!a || shotIds.value.length === 0) return { ok: false, errorCode: 'noShots' }
    busy.value = true
    try {
      const results = []
      let destDir = null
      for (let off = 0; off < shotIds.value.length; off += MAX_RECYCLE_BATCH) {
        const items = shotIds.value.slice(off, off + MAX_RECYCLE_BATCH)
          .map((shotId, i) => ({ shotId, orderIndex: off + i }))
        const res = await a.downloadRecycled(JSON.parse(JSON.stringify({ taskId: taskId.value || 'default', items })))
        if (!res || res.code !== 0) {
          return { ok: false, errorCode: 'recycleFailed', error: (res && res.message) || null, results }
        }
        results.push(...(res.data.results || []))
        destDir = res.data.destDir || destDir
      }
      const okCount = results.filter((x) => x && x.ok).length
      recycled.value = { okCount, failCount: results.length - okCount, destDir, results }
      await syncStatus()
      return { ok: true, okCount, failCount: results.length - okCount, destDir }
    } catch (e) {
      return { ok: false, errorCode: 'recycleError', error: (e && e.message) || String(e) }
    } finally {
      busy.value = false
    }
  }

  /** 收口合成：manifest 直通 run（generate_videos 零调用过闸 → film_render 拼接 final.mp4） */
  async function composeFinal () {
    const manifest = renderManifest.value
    if (!Array.isArray(manifest) || manifest.length === 0) return { ok: false, errorCode: 'noManifest' }
    busy.value = true
    try {
      const payload = JSON.parse(JSON.stringify({
        autoAdvance: true,
        initialContext: { renderManifest: manifest },
      }))
      const res = await pipelineStartOrchestrated('film-engineering', payload)
      if (!res || res.code !== 0 || !res.data || !res.data.success || !res.data.runId) {
        errorCode.value = (res && (res.data && res.data.errorCode || res.errorCode)) || 'composeFailed'
        errorText.value = (res && ((res.data && res.data.error) || res.message)) || null
        phase.value = 'failed'
        return { ok: false, errorCode: errorCode.value, error: errorText.value }
      }
      composeRunId = res.data.runId
      phase.value = 'composing'
      stopPoll()
      pipelineUnsubscribe = onPipelineUpdate((snapshot) => applyComposeSnapshot(snapshot, true))
      pollTimer = setInterval(() => { void pollCompose() }, POLL_INTERVAL_MS)
      void pollCompose()
      return { ok: true, runId: composeRunId }
    } catch (e) {
      errorCode.value = 'composeError'
      errorText.value = (e && e.message) || String(e)
      phase.value = 'failed'
      return { ok: false, errorCode: 'composeError', error: errorText.value }
    } finally {
      busy.value = false
    }
  }

  // 合成 run 无需成本确认（generate_videos 对 manifest 直通闸）
  function applyComposeSnapshot (snapshot, fromPush) {
    if (disposed || !snapshot || typeof snapshot !== 'object') return
    if (fromPush && snapshot.runId !== composeRunId) return
    const statusObj = snapshot.status && typeof snapshot.status === 'object' ? snapshot.status : null
    const runStatus = statusObj ? statusObj.status : snapshot.status
    const context = snapshot.context && typeof snapshot.context === 'object' ? snapshot.context : null
    if (context && context.render && typeof context.render === 'object' && context.render.finalPath) {
      finalPath.value = context.render.finalPath
    }
    if (runStatus === 'completed') { phase.value = 'done'; stopPoll(); return }
    if (runStatus === 'failed') {
      phase.value = 'failed'
      errorCode.value = (snapshot.error && snapshot.error.errorCode) || null
      errorText.value = (snapshot.error && (snapshot.error.message || snapshot.error.error)) || null
      stopPoll()
    }
  }

  async function pollCompose () {
    if (disposed || !composeRunId) return
    try {
      const res = await pipelineGetRunContext(composeRunId)
      if (disposed || !res || res.code !== 0 || !res.data) return
      applyComposeSnapshot(res.data, false)
    } catch (_) { /* 轮询失败等下一轮 */ }
  }

  function stopPoll () {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null }
    if (pipelineUnsubscribe) { try { pipelineUnsubscribe() } catch (_) { /* 无害 */ } pipelineUnsubscribe = null }
  }

  function reset () {
    stopProdTracking()
    stopPoll()
    composeRunId = null
    phase.value = 'idle'
    plan.value = null
    taskId.value = null
    shotIds.value = []
    batches.value = []
    progress.value = { doneCount: 0, totalCount: 0 }
    renderManifest.value = null
    manifestError.value = null
    failedBatches.value = []
    confirmedBatchIndexes.value = []
    recycled.value = null
    finalPath.value = null
    errorCode.value = null
    errorText.value = null
  }

  /** 组件卸载：清理全部监听（8.4） */
  function dispose () {
    disposed = true
    stopProdTracking()
    stopPoll()
  }

  return {
    phase, busy, plan, taskId, shotIds, chosen, batches, progress,
    renderManifest, manifestError, failedBatches, confirmedBatchIndexes,
    confirmedShotCount, remainingBatchCount, currentBatch, batchCount,
    recycled, finalPath, errorCode, errorText,
    planProduction, begin, confirmBatch, finalize, resume, retryShotInBatch,
    recycleAll, composeFinal, syncStatus, reset, dispose,
  }
}
