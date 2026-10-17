// @ts-check
/**
 * 热门选题一键生成视频 —— 纯展示派生（hot-topics-pipeline-picker，2026-10-17）。
 *
 * 从 `useHotTopicsGenVideo.js` 抽出，避免 composable 越过 check-max-lines 的 500 行红线；
 * 这些都是「输入状态 → 展示值/按钮可用性」的纯函数，可脱离 Vue 穷举测试。
 */
import { getPipelineName } from '@/i18n/pipeline-labels'

/** 弹窗标题：选题名截断 30 字，避免标题过长。 */
export function buildGenVideoModalTitle(t, topicText) {
  const topic = typeof topicText === 'string' ? topicText : ''
  const short = topic.length > 30 ? topic.slice(0, 30) + '…' : topic
  return t('hotTopics.genVideoTitle', { topic: short })
}

/** 弹窗内「流水线：xxx」显示名；未选择返回空串。 */
export function buildGenVideoPipelineLabel(t, pipelineName) {
  const name = typeof pipelineName === 'string' ? pipelineName.trim() : ''
  return name ? getPipelineName(t, name) : ''
}

/** 改写阶段摘要（仅 rewriting 时有内容）。 */
export function buildGenVideoSummary(t, phase) {
  return phase === 'rewriting' ? t('hotTopics.genVideoStartToast') : ''
}

/** 终态判定：completed / failed / cancelled。 */
export function isGenVideoTerminalPhase(phase) {
  return ['completed', 'failed', 'cancelled'].includes(phase)
}

export function canRetryGenVideo(phase) {
  return phase === 'failed'
}

export function canCancelGenVideo(phase) {
  return ['rewriting', 'starting', 'running'].includes(phase)
}

/** 后台运行：仅流水线已真正启动（running 且持有 runId）时可脱离。 */
export function canBackgroundGenVideo(phase, runId) {
  return phase === 'running' && Boolean(runId)
}

/** 四按钮片：仅本次 run 成功且取得成片时可点；projectId 缺失（run-only）不影响解锁。 */
export function isGenVideoResultReady(phase, videoPath) {
  return phase === 'completed' && Boolean(String(videoPath || '').trim())
}

/** 已完成阶段数（总进度的分子）。 */
export function countCompletedGenVideoStages(stages) {
  if (!Array.isArray(stages)) return 0
  return stages.filter((stage) => stage && stage.status === 'completed').length
}

/**
 * 总进度：已完成阶段数/总阶段数，叠加流水线 run progress 映射到当前阶段区间。
 * 分母随所选流水线动态变化（含 rewrite_copy）。
 * @param {{phase:string, stages:Array<object>, runProgress:unknown}} input
 * @returns {number} 0-100
 */
export function computeGenVideoProgressPercent({ phase, stages, runProgress } = {}) {
  const total = Array.isArray(stages) && stages.length > 0 ? stages.length : 1
  if (phase === 'completed') return 100
  const base = (countCompletedGenVideoStages(stages) / total) * 100
  if (phase === 'rewriting' || phase === 'starting') return Math.min(99, Math.round(base))
  const runPct = Number(runProgress)
  if (Number.isFinite(runPct) && runPct >= 0) {
    return Math.min(99, Math.round(base + (Math.min(runPct, 100) / 100) * ((1 / total) * 100)))
  }
  return Math.min(99, Math.round(base))
}
