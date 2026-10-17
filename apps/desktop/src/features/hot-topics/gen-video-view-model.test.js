// @ts-check
import { describe, it, expect } from 'vitest'
import {
  buildGenVideoModalTitle,
  buildGenVideoPipelineLabel,
  buildGenVideoSummary,
  isGenVideoTerminalPhase,
  canRetryGenVideo,
  canCancelGenVideo,
  canBackgroundGenVideo,
  isGenVideoResultReady,
  countCompletedGenVideoStages,
  computeGenVideoProgressPercent,
} from './gen-video-view-model'

const t = (key) => 'T:' + key

describe('gen-video-view-model', () => {
  it('truncates long topic titles to 30 chars + ellipsis', () => {
    expect(buildGenVideoModalTitle(t, 'short')).toBe('T:hotTopics.genVideoTitle')
    expect(buildGenVideoModalTitle(t, 'x'.repeat(31))).toBe('T:hotTopics.genVideoTitle')
    expect(buildGenVideoModalTitle(t, null)).toBe('T:hotTopics.genVideoTitle')
  })

  it('builds pipeline label, empty when not selected', () => {
    expect(buildGenVideoPipelineLabel(t, 'story2video-compose')).toBe('T:pipelines.names.story2video-compose')
    expect(buildGenVideoPipelineLabel(t, '')).toBe('')
    expect(buildGenVideoPipelineLabel(t, null)).toBe('')
  })

  it('returns the rewrite summary only while rewriting', () => {
    expect(buildGenVideoSummary(t, 'rewriting')).toBe('T:hotTopics.genVideoStartToast')
    expect(buildGenVideoSummary(t, 'running')).toBe('')
  })

  it('computes terminal/retry/cancel/background/result-ready gates', () => {
    expect(isGenVideoTerminalPhase('completed')).toBe(true)
    expect(isGenVideoTerminalPhase('failed')).toBe(true)
    expect(isGenVideoTerminalPhase('running')).toBe(false)
    expect(canRetryGenVideo('failed')).toBe(true)
    expect(canRetryGenVideo('running')).toBe(false)
    expect(canCancelGenVideo('rewriting')).toBe(true)
    expect(canCancelGenVideo('failed')).toBe(false)
    expect(canBackgroundGenVideo('running', 'run-1')).toBe(true)
    expect(canBackgroundGenVideo('running', '')).toBe(false)
    expect(canBackgroundGenVideo('starting', 'run-1')).toBe(false)
    expect(isGenVideoResultReady('completed', 'D:/v.mp4')).toBe(true)
    expect(isGenVideoResultReady('completed', '  ')).toBe(false)
    expect(isGenVideoResultReady('running', 'D:/v.mp4')).toBe(false)
  })

  it('counts completed stages defensively', () => {
    expect(countCompletedGenVideoStages([
      { status: 'completed' }, { status: 'running' }, null, { status: 'completed' },
    ])).toBe(2)
    expect(countCompletedGenVideoStages(null)).toBe(0)
  })

  it('computes progress with a dynamic stage total and run progress mapping', () => {
    const stages = [
      { status: 'completed' }, { status: 'running' }, { status: 'pending' }, { status: 'pending' },
    ]
    expect(computeGenVideoProgressPercent({ phase: 'completed', stages })).toBe(100)
    expect(computeGenVideoProgressPercent({ phase: 'rewriting', stages })).toBe(25)
    expect(computeGenVideoProgressPercent({ phase: 'running', stages, runProgress: 50 })).toBe(38)
    expect(computeGenVideoProgressPercent({ phase: 'running', stages, runProgress: 150 })).toBe(50)
    expect(computeGenVideoProgressPercent({ phase: 'running', stages, runProgress: null })).toBe(25)
    // 非 S2V 阶段总数（9）不改变公式：1/9 ≈ 11%
    const nine = Array.from({ length: 9 }, (_, i) => ({ status: i === 0 ? 'completed' : 'pending' }))
    expect(computeGenVideoProgressPercent({ phase: 'rewriting', stages: nine })).toBe(11)
    expect(computeGenVideoProgressPercent({ phase: 'rewriting', stages: [] })).toBe(0)
  })
})
