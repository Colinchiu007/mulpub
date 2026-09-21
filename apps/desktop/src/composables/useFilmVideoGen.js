// @ts-check
/**
 * useFilmVideoGen — 电影工程「分镜视频生成 + 成本确认 + 单镜重试 + 成片」前端驱动（tasks 5.1/5.2，D2/D6/D7/D9）
 *
 * 驱动范式（与 useHotTopicsGenVideo 同构）：
 *   - pipelineStartOrchestrated('film-engineering', { autoAdvance, initialContext:{selectedShots}, aspect, seconds })
 *   - onPipelineUpdate 实时推送 + 3s 轮询 pipelineGetRunContext 兜底（终态权威源）；
 *   - checkpoint 停在 generate_videos → costCheck 确认卡；确认 → confirmStageGate(cost_confirmation)；
 *     取消 → cancelRun（引擎 paused 态不允许无确认 advance，重发起走新 run，成本闸前零计费）；
 *   - 逐镜结果 = context.generate_videos.videoResults（磁盘为真的合并语义由 film_render 阶段保证）；
 *   - 单镜重试走独立 IPC（只传 runId/shotIndex/参数，prompt 由主进程取 run 内原文，前端不携带）；
 *   - completed → context.render.finalPath（打开文件夹/另存由 View 走既有 story2video shell IPC）。
 *
 * 文案合同：本 composable 不注入 i18n，只透出 errorCode/原始信息，View 层负责本地化映射。
 */
import { ref, computed } from 'vue'
import {
  pipelineStartOrchestrated,
  pipelineGetRunContext,
  pipelineCancelRun,
  pipelineConfirmStageGate,
  onPipelineUpdate,
  filmEngineeringRetryShot,
} from '@/api/publisher'

export const FILM_MAX_VIDEO_BATCH = 10
export const FILM_VIDEO_ASPECTS = ['16x9', '9x16', 'source']
export const FILM_VIDEO_DURATIONS = [5, 8, 10]
export const FILM_VIDEO_DEFAULT_ASPECT = '16x9'
export const FILM_VIDEO_DEFAULT_SECONDS = 5

const POLL_INTERVAL_MS = 3000
const FILM_GENERATE_STAGE = 'generate_videos'
const TERMINAL_STATUSES = ['completed', 'failed', 'cancelled']

export function useFilmVideoGen () {
  const runId = ref(null)
  const phase = ref('idle') // idle | awaiting-confirm | generating | done | failed | cancelled
  const costCheck = ref(null)
  const videoResults = ref(null)
  const stages = ref([])
  const progress = ref(0)
  const finalPath = ref(null)
  const runDir = ref(null)
  const errorCode = ref(null)
  const errorText = ref(null)
  const busy = ref(false)
  const chosen = ref({ aspect: FILM_VIDEO_DEFAULT_ASPECT, seconds: FILM_VIDEO_DEFAULT_SECONDS })

  let pollTimer = null
  let unsubscribe = null
  let disposed = false

  const shotResults = computed(() => {
    const check = costCheck.value
    const shots = check && Array.isArray(check.shots) ? check.shots : []
    if (shots.length === 0) return []
    const byIndex = new Map((videoResults.value || []).map((r) => [Number(r.index), r]))
    return shots.map((s) => {
      const r = byIndex.get(Number(s.index))
      let status = 'pending'
      if (r && r.success) status = 'success'
      else if (r && !r.success) status = 'failed'
      return {
        index: Number(s.index),
        shotId: s.shotId,
        title: s.title || '',
        aspect: s.aspect,
        seconds: s.seconds,
        status,
        path: (r && r.path) || null,
        error: (r && r.error) || null,
      }
    })
  })

  function stopTracking () {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null }
    if (unsubscribe) { try { unsubscribe() } catch (_) { /* 取消订阅失败无害 */ } unsubscribe = null }
  }

  function startTracking () {
    stopTracking()
    const id = runId.value
    if (!id) return
    unsubscribe = onPipelineUpdate((snapshot) => applySnapshot(snapshot, true))
    pollTimer = setInterval(() => { void poll() }, POLL_INTERVAL_MS)
    void poll()
  }

  async function poll () {
    if (disposed || !runId.value) return
    try {
      const res = await pipelineGetRunContext(runId.value)
      if (disposed || !res || res.code !== 0 || !res.data) return
      const returnedId = res.data.runId || res.data.id
      if (typeof returnedId === 'string' && returnedId.trim() && returnedId.trim() !== runId.value) return
      applySnapshot(res.data, false)
    } catch (_) { /* 轮询失败等下一轮 */ }
  }

  /** 快照消费：push 通道只认本 runId（串扰守卫）；progressOnly 快照无 context 时保留既有明细 */
  function applySnapshot (snapshot, fromPush) {
    if (disposed || !snapshot || typeof snapshot !== 'object') return
    if (fromPush && snapshot.runId !== runId.value) return
    const statusObj = snapshot.status && typeof snapshot.status === 'object' ? snapshot.status : null
    const runStatus = statusObj ? statusObj.status : snapshot.status
    if (Array.isArray(snapshot.stages)) stages.value = snapshot.stages
    if (statusObj && Number.isFinite(Number(statusObj.progress))) progress.value = Number(statusObj.progress)

    const context = snapshot.context && typeof snapshot.context === 'object' ? snapshot.context : null
    if (context) {
      const gv = context[FILM_GENERATE_STAGE] && typeof context[FILM_GENERATE_STAGE] === 'object' ? context[FILM_GENERATE_STAGE] : null
      if (gv) {
        if (gv.costCheck) costCheck.value = gv.costCheck
        if (Array.isArray(gv.videoResults)) videoResults.value = gv.videoResults
      }
      if (context.render && typeof context.render === 'object' && context.render.finalPath) {
        finalPath.value = context.render.finalPath
        runDir.value = context.render.runDir || runDir.value
      }
    }

    // 停在 generate_videos 成本确认闸（checkpoint 存在且已有 costCheck 载荷）→ 确认卡
    if (runStatus === 'paused' && snapshot.checkpoint && snapshot.checkpoint.stageName === FILM_GENERATE_STAGE) {
      if (costCheck.value) { phase.value = 'awaiting-confirm'; return }
    }
    if (runStatus === 'running') {
      if (phase.value !== 'done') phase.value = 'generating'
      return
    }
    if (runStatus === 'completed') { phase.value = 'done'; stopTracking(); return }
    if (runStatus === 'cancelled') { phase.value = 'cancelled'; stopTracking(); return }
    if (runStatus === 'failed') {
      phase.value = 'failed'
      const stageErr = (stages.value.find((s) => s.name === FILM_GENERATE_STAGE && s.status === 'failed') || {}).error
      const code = (snapshot.error && snapshot.error.errorCode) || (stageErr && stageErr.errorCode) || null
      errorCode.value = code
      errorText.value = (snapshot.error && (snapshot.error.message || snapshot.error.error)) || (stageErr && (stageErr.message || stageErr.error)) || null
      stopTracking()
    }
  }

  /** 发起视频生成 run（5.1 面板入口）：>10 镜前端拦截（后端兜底在 executor/重试通道） */
  async function start (selectedShots, opts = {}) {
    const shots = Array.isArray(selectedShots) ? selectedShots : []
    if (shots.length === 0) return { ok: false, errorCode: 'noShots' }
    if (shots.length > FILM_MAX_VIDEO_BATCH) return { ok: false, errorCode: 'tooManyShots' }
    const aspect = FILM_VIDEO_ASPECTS.includes(opts.aspect) ? opts.aspect : FILM_VIDEO_DEFAULT_ASPECT
    const seconds = FILM_VIDEO_DURATIONS.includes(Number(opts.seconds)) ? Number(opts.seconds) : FILM_VIDEO_DEFAULT_SECONDS
    busy.value = true
    try {
      // IPC 脱壳：Vue 响应式数组 → 纯 JSON（prompt 逐字符原文直送，不做任何改写）
      const payload = JSON.parse(JSON.stringify({
        autoAdvance: true,
        initialContext: { selectedShots: shots },
        aspect,
        seconds,
      }))
      const res = await pipelineStartOrchestrated('film-engineering', payload)
      if (!res || res.code !== 0 || !res.data || !res.data.success || !res.data.runId) {
        errorCode.value = (res && (res.data?.errorCode || res.errorCode)) || null
        errorText.value = (res && (res.data?.error || res.message)) || null
        phase.value = 'failed'
        return { ok: false, errorCode: 'startFailed', error: errorText.value }
      }
      runId.value = res.data.runId
      chosen.value = { aspect, seconds }
      costCheck.value = null
      videoResults.value = null
      finalPath.value = null
      runDir.value = null
      errorCode.value = null
      errorText.value = null
      progress.value = 0
      phase.value = 'generating'
      startTracking()
      return { ok: true, runId: runId.value }
    } catch (e) {
      errorText.value = (e && e.message) || String(e)
      phase.value = 'failed'
      return { ok: false, errorCode: 'startError', error: errorText.value }
    } finally {
      busy.value = false
    }
  }

  /** 成本确认（5.2 确认卡「确认」）：merge cost_confirmation 过闸重入生成 */
  async function confirmCost () {
    if (!runId.value) return { ok: false, errorCode: 'noRun' }
    busy.value = true
    try {
      const patch = JSON.parse(JSON.stringify({ cost_confirmation: { confirmed: true, confirmedAt: new Date().toISOString() } }))
      const res = await pipelineConfirmStageGate(runId.value, patch)
      if (!res || res.code !== 0 || !res.data || res.data.success === false) {
        const code = (res && res.data && res.data.errorCode) || null
        return { ok: false, errorCode: code || 'confirmFailed', error: (res && ((res.data && res.data.error) || res.message)) || null }
      }
      phase.value = 'generating'
      void poll()
      return { ok: true }
    } finally {
      busy.value = false
    }
  }

  /** 取消（5.2 确认卡「取消」）：终止该 run——成本闸前已发生的阶段零计费，重新发起走新 run */
  async function cancelCost () {
    if (!runId.value) return { ok: false, errorCode: 'noRun' }
    busy.value = true
    try {
      const res = await pipelineCancelRun(runId.value)
      if (!res || res.code !== 0) {
        return { ok: false, error: (res && res.message) || null }
      }
      stopTracking()
      phase.value = 'cancelled'
      return { ok: true }
    } finally {
      busy.value = false
    }
  }

  /** 单镜重试（D7）：只传定位参数，prompt 由主进程从 run 快照取原文 */
  async function retryShot (shotIndex) {
    if (!Number.isInteger(shotIndex) || shotIndex < 0) return { ok: false, errorCode: 'badIndex' }
    const payload = JSON.parse(JSON.stringify({
      runId: runId.value,
      shotIndex,
      aspect: chosen.value.aspect,
      seconds: chosen.value.seconds,
    }))
    const res = await filmEngineeringRetryShot(payload)
    if (res && res.code === 0 && res.data && res.data.success) {
      void poll()
      return { ok: true, data: res.data }
    }
    return { ok: false, error: (res && res.message) || null, errorCode: (res && res.errorCode) || null }
  }

  /** 重置回空闲（关闭面板/新一轮发起前） */
  function reset () {
    stopTracking()
    runId.value = null
    phase.value = 'idle'
    costCheck.value = null
    videoResults.value = null
    stages.value = []
    progress.value = 0
    finalPath.value = null
    runDir.value = null
    errorCode.value = null
    errorText.value = null
  }

  /** 视图卸载：停跟踪并拒绝后续回调 */
  function dispose () {
    disposed = true
    stopTracking()
  }

  return {
    runId, phase, busy, progress, stages,
    costCheck, shotResults, finalPath, runDir, errorCode, errorText, chosen,
    start, confirmCost, cancelCost, retryShot, reset, dispose, poll,
  }
}
