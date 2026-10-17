// @ts-check
/**
 * 热门选题一键生成视频 —— 弹窗阶段跟踪纯函数（hot-topics-pipeline-picker，2026-10-17）。
 *
 * 为什么抽出来：`useHotTopicsGenVideo.js` 已逼近本仓 `check-max-lines` 的 500 行红线；
 * 阶段创建/查找/标记/终态归并都是"对 stages 数组的纯操作"，与 Vue 响应式无耦合，
 * 抽成模块后既能单测穷举，也能让 composable 专注于编排与竞态。
 */
import { STORY2VIDEO_STAGE_NAMES } from '@/domain/pipeline-constants'
import { getPipelineStageNames } from './gen-video-pipelines'

/** 改写阶段名：始终排在弹窗阶段列表第一位。 */
export const GEN_VIDEO_REWRITE_STAGE = 'rewrite_copy'

const TERMINAL_STAGE_STATUSES = new Set(['completed', 'skipped', 'failed', 'cancelled'])

/**
 * 所选流水线的阶段名（Registry 缺失时回退 S2V 阶段，仅作展示兜底；启动侧仍 fail-closed）。
 * @param {unknown} pipelineName
 * @param {readonly string[]} [fallback]
 * @returns {string[]}
 */
export function stageNamesForPipeline(pipelineName, fallback = STORY2VIDEO_STAGE_NAMES) {
  const names = getPipelineStageNames(pipelineName)
  if (names.length > 0) return names
  return Array.isArray(fallback) ? fallback.slice() : []
}

/**
 * 初始化弹窗阶段：rewrite_copy + 所选流水线真实阶段，全部 pending。
 * @param {unknown} pipelineName
 * @returns {Array<{id:string,name:string,status:string,startedAt:null,completedAt:null,progress:null}>}
 */
export function createGenVideoStages(pipelineName) {
  return [GEN_VIDEO_REWRITE_STAGE, ...stageNamesForPipeline(pipelineName)].map((name) => ({
    id: name,
    name,
    status: 'pending',
    startedAt: null,
    completedAt: null,
    progress: null,
  }))
}

/**
 * 按阶段名原地 patch（改写阶段状态推进用；找不到阶段时静默忽略）。
 * @param {Array<object>} stages
 * @param {string} name
 * @param {object} patch
 */
export function patchGenVideoStage(stages, name, patch) {
  if (!Array.isArray(stages)) return null
  const stage = stages.find((item) => item && item.name === name)
  if (!stage) return null
  Object.assign(stage, patch)
  return stage
}

/**
 * 第一个流水线阶段（跳过 rewrite_copy）；没有则返回 null。
 * @param {Array<object>} stages
 */
export function firstGenVideoPipelineStage(stages) {
  if (!Array.isArray(stages)) return null
  return stages.find((stage) => stage && stage.name !== GEN_VIDEO_REWRITE_STAGE) || null
}

/**
 * 启动流水线前：把第一个流水线阶段标 running。
 * @param {Array<object>} stages
 * @param {string} [now]
 */
export function markFirstGenVideoStageRunning(stages, now = new Date().toISOString()) {
  const stage = firstGenVideoPipelineStage(stages)
  if (!stage) return null
  Object.assign(stage, { status: 'running', startedAt: now, completedAt: null, error: null })
  return stage
}

/**
 * 启动失败：把第一个流水线阶段标 failed（改写阶段状态保留）。
 * @param {Array<object>} stages
 * @param {unknown} error
 * @param {string} [now]
 */
export function markFirstGenVideoStageFailed(stages, error, now = new Date().toISOString()) {
  const stage = firstGenVideoPipelineStage(stages)
  if (!stage) return null
  Object.assign(stage, {
    status: 'failed',
    error: typeof error === 'string' ? error : (error && error.message) || '',
    completedAt: now,
  })
  return stage
}

/**
 * 重试前：非改写阶段全部复位 pending（改写阶段状态决定重试起点，不动）。
 * @param {Array<object>} stages
 */
export function resetGenVideoStagesToPending(stages) {
  if (!Array.isArray(stages)) return
  for (const stage of stages) {
    if (!stage || stage.name === GEN_VIDEO_REWRITE_STAGE) continue
    Object.assign(stage, { status: 'pending', startedAt: null, completedAt: null, error: null, progress: null })
  }
}

/**
 * run completed：未终结的阶段统一补 completed（与既有 finishGenVideoCompleted 口径一致）。
 * @param {Array<object>} stages
 */
export function completeUnfinishedGenVideoStages(stages) {
  if (!Array.isArray(stages)) return
  for (const stage of stages) {
    if (!stage || stage.status === 'completed' || stage.status === 'skipped') continue
    stage.status = 'completed'
  }
}

/**
 * 终态（failed/cancelled）：running/paused 落终态、pending 落 cancelled；failed 时补错误信息。
 * @param {Array<object>} stages
 * @param {'failed'|'cancelled'} status
 * @param {unknown} [dataError]
 */
export function finalizeGenVideoTerminalStages(stages, status, dataError = null) {
  if (!Array.isArray(stages)) return
  const failedStage = stages.find((stage) => stage && (stage.status === 'running' || stage.status === 'failed'))
  if (failedStage && status === 'failed') {
    failedStage.status = 'failed'
    if (!failedStage.error && dataError) failedStage.error = String(dataError)
  }
  for (const stage of stages) {
    if (!stage) continue
    if (stage.status === 'running' || stage.status === 'paused') {
      stage.status = status === 'cancelled' ? 'cancelled' : 'failed'
    } else if (stage.status === 'pending') {
      stage.status = 'cancelled'
    }
  }
}

/**
 * 用户取消：running/pending/paused 全部标 cancelled。
 * @param {Array<object>} stages
 */
export function cancelGenVideoStages(stages) {
  if (!Array.isArray(stages)) return
  for (const stage of stages) {
    if (!stage) continue
    if (stage.status === 'running' || stage.status === 'pending' || stage.status === 'paused') {
      stage.status = 'cancelled'
    }
  }
}

/** 阶段是否已处于终态（供 merge 守卫复用，避免两处各写一份集合）。 */
export function isTerminalGenVideoStageStatus(status) {
  return TERMINAL_STAGE_STATUSES.has(status)
}
