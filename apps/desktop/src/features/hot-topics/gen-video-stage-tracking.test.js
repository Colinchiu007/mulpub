// @ts-check
import { describe, it, expect } from 'vitest'
import {
  GEN_VIDEO_REWRITE_STAGE,
  stageNamesForPipeline,
  createGenVideoStages,
  firstGenVideoPipelineStage,
  markFirstGenVideoStageRunning,
  markFirstGenVideoStageFailed,
  resetGenVideoStagesToPending,
  completeUnfinishedGenVideoStages,
  finalizeGenVideoTerminalStages,
  cancelGenVideoStages,
  isTerminalGenVideoStageStatus,
} from './gen-video-stage-tracking'

const NOW = '2026-10-17T00:00:00.000Z'

function stages(names) {
  return names.map((name) => ({ id: name, name, status: 'pending', startedAt: null, completedAt: null, progress: null }))
}

describe('gen-video-stage-tracking', () => {
  it('creates rewrite_copy + the selected pipeline real stages', () => {
    expect(createGenVideoStages('animated-explainer').map((s) => s.name)).toEqual([
      GEN_VIDEO_REWRITE_STAGE, 'research', 'proposal', 'script', 'scenes', 'assets', 'editing', 'compose', 'publish',
    ])
    expect(createGenVideoStages('story2video-compose')).toHaveLength(8)
    // Registry 缺失时回退 S2V 阶段（展示兜底）
    expect(createGenVideoStages('unknown-pipeline').map((s) => s.name)[1]).toBe('split')
  })

  it('marks the first non-rewrite stage running/failed without touching rewrite', () => {
    const list = stages(['rewrite_copy', 'research', 'compose'])
    list[0].status = 'completed'
    const running = markFirstGenVideoStageRunning(list, NOW)
    expect(running.name).toBe('research')
    expect(list[0].status).toBe('completed')
    expect(list[1]).toMatchObject({ status: 'running', startedAt: NOW, completedAt: null })

    const failed = markFirstGenVideoStageFailed(list, new Error('boom'), NOW)
    expect(failed).toMatchObject({ status: 'failed', error: 'boom', completedAt: NOW })
    expect(list[0].status).toBe('completed')
  })

  it('resets non-rewrite stages to pending for retry', () => {
    const list = stages(['rewrite_copy', 'research'])
    list[0].status = 'completed'
    list[1].status = 'failed'
    resetGenVideoStagesToPending(list)
    expect(list[0].status).toBe('completed')
    expect(list[1]).toMatchObject({ status: 'pending', startedAt: null, completedAt: null, error: null, progress: null })
  })

  it('completes unfinished stages on success and finalizes terminal states', () => {
    const done = stages(['rewrite_copy', 'a', 'b'])
    done[0].status = 'completed'
    done[1].status = 'skipped'
    done[2].status = 'running'
    completeUnfinishedGenVideoStages(done)
    expect(done.map((s) => s.status)).toEqual(['completed', 'skipped', 'completed'])

    const failed = stages(['rewrite_copy', 'a', 'b'])
    failed[0].status = 'completed'
    failed[1].status = 'running'
    finalizeGenVideoTerminalStages(failed, 'failed', 'provider 429')
    expect(failed[1].status).toBe('failed')
    expect(failed[1].error || failed[2].error).toContain('provider 429')

    const cancelled = stages(['rewrite_copy', 'a', 'b'])
    cancelled[1].status = 'running'
    finalizeGenVideoTerminalStages(cancelled, 'cancelled')
    expect(cancelled.map((s) => s.status)).toEqual(['cancelled', 'cancelled', 'cancelled'])
  })

  it('cancels running/pending/paused stages only', () => {
    const list = stages(['rewrite_copy', 'a', 'b', 'c'])
    list[0].status = 'completed'
    list[1].status = 'running'
    list[2].status = 'paused'
    cancelGenVideoStages(list)
    expect(list.map((s) => s.status)).toEqual(['completed', 'cancelled', 'cancelled', 'cancelled'])
  })

  it('exposes terminal status classification and null-safe helpers', () => {
    expect(isTerminalGenVideoStageStatus('completed')).toBe(true)
    expect(isTerminalGenVideoStageStatus('skipped')).toBe(true)
    expect(isTerminalGenVideoStageStatus('running')).toBe(false)
    expect(firstGenVideoPipelineStage(null)).toBeNull()
    expect(firstGenVideoPipelineStage([])).toBeNull()
    expect(markFirstGenVideoStageRunning([])).toBeNull()
    expect(stageNamesForPipeline('', ['x'])).toEqual(['x'])
  })
})
