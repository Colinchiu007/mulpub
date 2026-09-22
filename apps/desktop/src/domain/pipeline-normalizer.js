/**
 * pipeline-normalizer.js — 流水线状态归一化/合并/元数据纯函数
 * Stage 1.3 从 CreateView.vue 提取，行为完全不变。
 */

import {
  PIPELINE_RUN_STATUSES,
  PIPELINE_STAGE_STATUSES,
} from './pipeline-constants'

export function normalizeProgressPercent(value, fallback = null) {
  const numeric = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numeric)) return fallback
  return Math.max(0, Math.min(100, Math.round(numeric)))
}

export function normalizePipelineStage(stage) {
  if (!stage || typeof stage !== 'object' || Array.isArray(stage)) return null
  const name = typeof stage.name === 'string' && stage.name.trim()
    ? stage.name.trim()
    : (typeof stage.stage === 'string' && stage.stage.trim() ? stage.stage.trim() : '')
  if (!name) return null
  if (typeof stage.status !== 'string' || !PIPELINE_STAGE_STATUSES.includes(stage.status)) return null
  const status = stage.status
  const progress = stage.progress && typeof stage.progress === 'object' && !Array.isArray(stage.progress)
    ? { ...stage.progress }
    : null
  if (progress) {
    const percent = normalizeProgressPercent(progress.percent)
    if (percent === null) delete progress.percent
    else progress.percent = percent
  }
  return { ...stage, name, status, ...(progress ? { progress } : {}) }
}

export function normalizePipelineStages(stages, fallback = []) {
  const source = Array.isArray(stages) ? stages : fallback
  return source.map(normalizePipelineStage).filter(Boolean)
}

export function pipelineStageKey(stage, index) {
  if (!stage || typeof stage !== 'object') return String(index)
  return String(stage.id || stage.name || stage.stage || index)
}

export function mergePipelineStages(previousStages, incomingStages) {
  const previous = Array.isArray(previousStages) ? previousStages : []
  if (!Array.isArray(incomingStages)) return previous
  if (previous.length === 0) return incomingStages

  const incomingByKey = new Map(incomingStages.map((stage, index) => [pipelineStageKey(stage, index), stage]))
  if (incomingStages.length >= previous.length) {
    return incomingStages.map((stage, index) => {
      const previousStage = previous.find((item, previousIndex) => pipelineStageKey(item, previousIndex) === pipelineStageKey(stage, index))
      if (!previousStage || typeof previousStage !== 'object') return stage
      return {
        ...previousStage,
        ...stage,
        ...(previousStage.progress || stage.progress
          ? { progress: { ...(previousStage.progress || {}), ...(stage.progress || {}) } }
          : {}),
      }
    })
  }
  return previous.map((stage, index) => {
    const incoming = incomingByKey.get(pipelineStageKey(stage, index))
    if (!incoming || typeof incoming !== 'object') return stage
    return {
      ...stage,
      ...incoming,
      ...(stage.progress || incoming.progress
        ? { progress: { ...(stage.progress || {}), ...(incoming.progress || {}) } }
        : {}),
    }
  })
}

export function normalizePipelineStatusSnapshot(snapshot, fallbackStages = []) {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return null
  if (typeof snapshot.status !== 'string' || !snapshot.status.trim()) return null
  const status = snapshot.status.trim()
  if (!PIPELINE_RUN_STATUSES.includes(status)) return null
  const stages = normalizePipelineStages(snapshot.stages, fallbackStages)
  const progress = normalizeProgressPercent(snapshot.progress, null)
  const checkpoint = snapshot.checkpoint && typeof snapshot.checkpoint === 'object' && !Array.isArray(snapshot.checkpoint)
    ? { ...snapshot.checkpoint }
    : null
  return {
    ...snapshot,
    status,
    ...(progress === null ? {} : { progress }),
    stages,
    checkpoint,
  }
}

export function hasManualPipelineCheckpoint(snapshot, needsCheckpoint = false, context = null) {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return Boolean(needsCheckpoint)
  const checkpoint = snapshot.checkpoint && typeof snapshot.checkpoint === 'object' && !Array.isArray(snapshot.checkpoint)
    ? snapshot.checkpoint
    : null
  // cost_confirm：电影工程成本确认入口闸（film-engineering-video-gen D2）——
  // 等待态识别放公共层，订阅链消费方（含电影工程页）无需 film 侧特判。
  const checkpointKinds = new Set(['scene_asset_selection', 'content_policy', 'needs_user_input', 'waiting_approval', 'approval', 'cost_confirm'])
  const checkpointType = String(checkpoint?.type || '').trim().toLowerCase()
  const checkpointReason = String(checkpoint?.reason || '').trim().toLowerCase()
  if (checkpointKinds.has(checkpointType) || checkpointKinds.has(checkpointReason)) return true
  if (snapshot.status === 'waiting_approval' || snapshot.status === 'needs_user_input') return true
  const snapshotContext = snapshot.context && typeof snapshot.context === 'object' && !Array.isArray(snapshot.context)
    ? snapshot.context
    : null
  const contextCandidates = context?.generate_assets?.candidates || snapshotContext?.generate_assets?.candidates
  if (snapshot.status === 'paused' && Array.isArray(contextCandidates) && contextCandidates.length > 0) return true
  const stages = Array.isArray(snapshot.stages) ? snapshot.stages : []
  return Boolean(needsCheckpoint || stages.some(stage => {
    if (!stage || typeof stage !== 'object' || Array.isArray(stage)) return false
    const status = String(stage.status || '').trim().toLowerCase()
    if (!['paused', 'waiting_approval', 'needs_user_input'].includes(status)) return false
    const stageType = String(stage.checkpointType || stage.checkpoint || '').trim().toLowerCase()
    const stageName = String(stage.name || stage.stage || '').trim().toLowerCase()
    return stage.requiresCheckpoint === true
      || checkpointKinds.has(stageType)
      || stageName === 'finalize_assets'
  }))
}

export function hasLegacyPipelineCheckpointEvidence(snapshot, context = null) {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return false
  const checkpoint = snapshot.checkpoint && typeof snapshot.checkpoint === 'object' && !Array.isArray(snapshot.checkpoint)
    ? snapshot.checkpoint
    : null
  if (checkpoint?.type || checkpoint?.reason) return false

  const snapshotContext = snapshot.context && typeof snapshot.context === 'object' && !Array.isArray(snapshot.context)
    ? snapshot.context
    : null
  const contextCandidates = context?.generate_assets?.candidates || snapshotContext?.generate_assets?.candidates
  if (snapshot.status === 'paused' && Array.isArray(contextCandidates) && contextCandidates.length > 0) return true

  const checkpointKinds = new Set(['scene_asset_selection', 'content_policy', 'needs_user_input', 'waiting_approval', 'approval', 'cost_confirm'])
  const stages = Array.isArray(snapshot.stages) ? snapshot.stages : []
  return stages.some(stage => {
    if (!stage || typeof stage !== 'object' || Array.isArray(stage)) return false
    const status = String(stage.status || '').trim().toLowerCase()
    const stageType = String(stage.checkpointType || stage.checkpoint || '').trim().toLowerCase()
    const stageName = String(stage.name || stage.stage || '').trim().toLowerCase()
    return ['paused', 'waiting_approval', 'needs_user_input'].includes(status)
      && (stage.requiresCheckpoint === true || checkpointKinds.has(stageType) || stageName === 'finalize_assets')
  })
}

export function normalizePipelineRunMeta(snapshot) {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return { valid: false, value: null }
  const invalidMeta = Symbol('invalid-pipeline-meta')
  const metaKeys = ['createdAt', 'endedAt', 'outputSizeBytes', 'activeMs', 'activeSegmentStartedAt']
  const fields = metaKeys.filter(key => Object.prototype.hasOwnProperty.call(snapshot, key))
  const readNonNegative = (key) => {
    if (!Object.prototype.hasOwnProperty.call(snapshot, key) || snapshot[key] === null || snapshot[key] === undefined || snapshot[key] === '') return null
    const numeric = Number(snapshot[key])
    return Number.isFinite(numeric) && numeric >= 0 ? numeric : invalidMeta
  }
  const activeMs = readNonNegative('activeMs')
  const outputSizeBytes = readNonNegative('outputSizeBytes')
  if (activeMs === invalidMeta || outputSizeBytes === invalidMeta) {
    return { valid: false, value: null }
  }
  const readDate = (key) => {
    if (!Object.prototype.hasOwnProperty.call(snapshot, key) || snapshot[key] === null || snapshot[key] === undefined || snapshot[key] === '') return null
    return typeof snapshot[key] === 'string' ? snapshot[key] : null
  }
  return {
    valid: true,
    fields,
    value: {
      createdAt: readDate('createdAt'),
      endedAt: readDate('endedAt'),
      outputSizeBytes,
      activeMs,
      activeSegmentStartedAt: readDate('activeSegmentStartedAt'),
    },
  }
}

export function mergePipelineRunMeta(previous, result) {
  if (!result?.valid) return previous || null
  const fields = Array.isArray(result.fields) ? result.fields : []
  if (fields.length === 0) return previous || null
  const merged = { ...(previous && typeof previous === 'object' ? previous : {}) }
  for (const field of fields) merged[field] = result.value[field]
  return merged
}

export function createPipelineRunMeta(createdAt = new Date().toISOString()) {
  return {
    createdAt: typeof createdAt === 'string' && createdAt ? createdAt : new Date().toISOString(),
    endedAt: null,
    outputSizeBytes: null,
    activeMs: null,
    activeSegmentStartedAt: null,
  }
}

export function createPipelineRunMetaFromSnapshot(snapshot = {}) {
  const base = createPipelineRunMeta(snapshot?.createdAt)
  const result = normalizePipelineRunMeta(snapshot)
  return mergePipelineRunMeta(base, result) || base
}

export function normalizePipelineContext(snapshot, fallback = null) {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return { valid: false, value: null }
  if (!Object.prototype.hasOwnProperty.call(snapshot, 'context')) return { valid: true, value: fallback, provided: false }
  const context = snapshot.context
  if (context === null || context === undefined) return { valid: true, value: null, provided: true }
  if (typeof context !== 'object' || Array.isArray(context)) return { valid: false, value: null, provided: true }
  return { valid: true, value: context, provided: true }
}
