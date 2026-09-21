// @ts-check
'use strict'
/**
 * 流水线公共层 checkpoint 归一化回归（film-engineering-video-gen 2.3 / D2 注记）：
 * 成本确认入口闸（cost_confirm）等待态必须被订阅链识别为「等待用户」检查点——
 * 修复放公共层（pipeline-normalizer / create-view-module-utils），禁止 film 侧特判。
 */
import { hasManualPipelineCheckpoint, hasLegacyPipelineCheckpointEvidence } from './pipeline-normalizer'
import * as viewUtils from '@/views/video-creation/create-view-module-utils'

// progressOnly 推送快照形态（getRunSnapshot 经 _sanitizeCheckpoint 裁剪：仅类型元数据，无 context）
const costGatePushSnapshot = {
  status: 'paused',
  currentStage: 4,
  checkpoint: { type: 'cost_confirm', stageName: 'generate_videos', stageIndex: 4, required: true },
  stages: [
    { name: 'generate_videos', status: 'paused', checkpointType: 'cost_confirm' },
  ],
}

describe('cost_confirm 等待态识别（公共层，两实现同步）', () => {
  it('pipeline-normalizer: hasManualPipelineCheckpoint 识别推送快照中的 cost_confirm 类型', () => {
    expect(hasManualPipelineCheckpoint(costGatePushSnapshot)).toBe(true)
  })

  it('pipeline-normalizer: 阶段级 requiresCheckpoint + paused 亦识别（无 checkpoint 元数据时）', () => {
    const snapshot = {
      status: 'paused',
      checkpoint: null,
      stages: [{ name: 'generate_videos', status: 'paused', requiresCheckpoint: true }],
    }
    expect(hasManualPipelineCheckpoint(snapshot)).toBe(true)
  })

  it('pipeline-normalizer: 非 cost_confirm 的普通 running 快照不误报', () => {
    const snapshot = {
      status: 'running',
      checkpoint: null,
      stages: [{ name: 'generate_videos', status: 'running' }],
    }
    expect(hasManualPipelineCheckpoint(snapshot)).toBe(false)
    expect(hasLegacyPipelineCheckpointEvidence(snapshot)).toBe(false)
  })

  it('create-view-module-utils: 视图侧重复实现与 domain 层同步识别 cost_confirm', () => {
    expect(viewUtils.hasManualPipelineCheckpoint(costGatePushSnapshot)).toBe(true)
  })
})
