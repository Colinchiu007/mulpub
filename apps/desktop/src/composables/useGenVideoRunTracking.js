// @ts-check
/**
 * useGenVideoRunTracking — 热门选题生成视频的 run 跟踪层
 * （fix-hot-topics-genvideo-title，2026-10-17 拆分产物）。
 *
 * 为什么拆：`useHotTopicsGenVideo.js` 加入【去发布】标题生成后到 508 行，
 * 越过 `check-max-lines` 的 500 行新代码红线（债务熔断 NEW_OVER_LIMIT），
 * 门禁处方是「按既有 mixin/composable 范式拆分」。跟踪层是最自然的边界：
 * 它只依赖「本模块自己持有的状态 + 两个终态回调」，不碰 UI 语义。
 *
 * 职责：双通道跟踪（onPipelineUpdate 实时推送 + 3s 轮询兜底）与终态分发。
 * 所有状态 ref 由调用方注入，本模块不 new ref——保持单一真源不搬家。
 */
import { ref } from 'vue'
import { pipelineGetRunContext, onPipelineUpdate } from '@/api/publisher'
import { isTerminalGenVideoStageStatus } from '@/features/hot-topics/gen-video-stage-tracking'

const POLL_INTERVAL_MS = 3000
const TICK_INTERVAL_MS = 1000

/** 可选的依赖覆盖（测试注入）；缺省走真实 API。 */
function defaultDeps () {
  return {
    isDisposed: () => false,
    onPipelineUpdate,
    pipelineGetRunContext,
  }
}

/**
 * @param {object} input
 * @param {import('vue').Ref<string|null>} input.runId
 * @param {import('vue').Ref<number>} input.tick
 * @param {import('vue').Ref<number|null>} input.progress
 * @param {import('vue').Ref<Array<object>>} input.stages
 * @param {(status: string, data: object) => void} input.onCompleted
 * @param {(status: string, data: object) => void} input.onTerminal
 * @param {ReturnType<typeof defaultDeps>} [input.deps]
 */
export function useGenVideoRunTracking({ runId, tick, progress, stages, onCompleted, onTerminal, deps = defaultDeps() }) {
  const pollTimer = ref(null)
  const unsubscribe = ref(null)
  const tickTimer = ref(null)

  /** 合并流水线 stages 到弹窗 stages（保留改写阶段） */
  function mergeGenStages (incomingStages) {
    if (!Array.isArray(incomingStages)) return
    for (const inc of incomingStages) {
      if (!inc || typeof inc.name !== 'string') continue
      const target = stages.value.find(s => s.name === inc.name)
      if (!target) continue
      // 终态守卫：已 completed/skipped/failed/cancelled 的阶段不被乱序推送降级回 running
      const nextStatus = isTerminalGenVideoStageStatus(target.status)
        ? target.status
        : (inc.status || target.status)
      Object.assign(target, {
        status: nextStatus,
        startedAt: inc.startedAt || target.startedAt,
        completedAt: inc.completedAt || target.completedAt,
        error: inc.error ?? target.error,
        progress: inc.progress ?? target.progress,
      })
    }
  }

  /** 轮询全量 run context（终态判定与 videoPath 提取的唯一权威来源） */
  async function pollGenVideoRun (id, force = false) {
    if (deps.isDisposed() || runId.value !== id) return
    try {
      const res = await deps.pipelineGetRunContext(id)
      if (deps.isDisposed() || runId.value !== id) return
      if (res?.code !== 0 || !res.data) return
      const returnedRunId = res.data.runId || res.data.id
      if (typeof returnedRunId === 'string' && returnedRunId.trim() && returnedRunId.trim() !== id) return
      const status = res.data.status && typeof res.data.status === 'object' ? res.data.status : null
      const stageList = Array.isArray(res.data.stages) ? res.data.stages : (status ? status.stages : null)
      if (Array.isArray(stageList)) mergeGenStages(stageList)
      if (status && Number.isFinite(Number(status.progress))) progress.value = Number(status.progress)
      const runStatus = status?.status || res.data.status
      if (runStatus === 'completed') {
        onCompleted(res.data)
      } else if (runStatus === 'failed' || runStatus === 'cancelled') {
        onTerminal(runStatus, res.data)
      } else if (force && runStatus && !['running', 'paused'].includes(runStatus)) {
        onTerminal(runStatus, res.data)
      }
    } catch (_) { /* 轮询失败等下一轮 */ }
  }

  /** 实时推送处理（runId 快照守卫） */
  function handleGenVideoPush (snapshot) {
    if (deps.isDisposed() || !snapshot || typeof snapshot !== 'object') return
    const id = runId.value
    if (!id || snapshot.runId !== id) return
    const status = snapshot.status && typeof snapshot.status === 'object' ? snapshot.status : null
    if (Array.isArray(snapshot.stages)) mergeGenStages(snapshot.stages)
    else if (status && Array.isArray(status.stages)) mergeGenStages(status.stages)
    if (status && Number.isFinite(Number(status.progress))) progress.value = Number(status.progress)
    const finalStatus = status?.status || snapshot.status
    if (typeof finalStatus === 'string' && ['completed', 'failed', 'cancelled'].includes(finalStatus)) {
      void pollGenVideoRun(id, true)
    }
  }

  function stopGenVideoTracking () {
    if (pollTimer.value) { clearInterval(pollTimer.value); pollTimer.value = null }
    if (unsubscribe.value) {
      try { unsubscribe.value() } catch (_) { /* 取消订阅失败无害，静默忽略 */ }
      unsubscribe.value = null
    }
    if (tickTimer.value) { clearInterval(tickTimer.value); tickTimer.value = null }
  }

  /** 启动双通道跟踪 */
  function startGenVideoTracking () {
    stopGenVideoTracking()
    const id = runId.value
    if (!id) return
    unsubscribe.value = deps.onPipelineUpdate(snapshot => handleGenVideoPush(snapshot))
    pollTimer.value = setInterval(() => pollGenVideoRun(id), POLL_INTERVAL_MS)
    tickTimer.value = setInterval(() => { tick.value++ }, TICK_INTERVAL_MS)
    void pollGenVideoRun(id)
  }

  return {
    mergeGenStages,
    pollGenVideoRun,
    startGenVideoTracking,
    stopGenVideoTracking,
  }
}
