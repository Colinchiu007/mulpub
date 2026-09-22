// @ts-check
'use strict'
/**
 * film-engineering 流水线阶段契约测试（specs: 流水线阶段契约 / 成本确认 checkpoint）
 * 覆盖：六阶段执行链定义、generate_videos checkpointRequired=true、等待态 checkpoint 载荷可达前端
 */
const { PipelineEngine } = require('../pipeline-engine')
const { FILM_VIDEO_STAGE_TYPES } = require('./video-gen')

describe('film-engineering 流水线阶段契约（六阶段）', () => {
  let engine
  beforeEach(() => {
    engine = new PipelineEngine({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } })
  })

  it('PIPELINES 含六个阶段且顺序为 load→adapt→select→export→generate→render', () => {
    const pl = engine.getPipeline('film-engineering')
    expect(pl).toBeTruthy()
    expect(pl.stages).toEqual([
      'load_template', 'adapt_script', 'select_shots', 'export_prompts',
      'generate_videos', 'render',
    ])
    expect(pl.stageDefs.map((s) => s.name)).toEqual(pl.stages)
    expect(pl.stageDefs.map((s) => s.type)).toEqual([
      'film_load_template', 'film_adapt_script', 'film_select_shots',
      'film_export_prompts', FILM_VIDEO_STAGE_TYPES.GENERATE_VIDEOS, FILM_VIDEO_STAGE_TYPES.RENDER,
    ])
  })

  it('仅 film_generate_videos 声明 checkpointRequired=true（前四阶段与 render 维持 false）', () => {
    const pl = engine.getPipeline('film-engineering')
    const gates = pl.stageDefs.map((s) => [s.name, Boolean(s.checkpointRequired)])
    expect(gates).toEqual([
      ['load_template', false],
      ['adapt_script', false],
      ['select_shots', false],
      ['export_prompts', false],
      ['generate_videos', true],
      ['render', false],
    ])
  })

  it('listPipelines 的 stageCount 反映六阶段（桌面卡片阶段数）', () => {
    const item = engine.listPipelines().find((p) => p.name === 'film-engineering')
    expect(item.stageCount).toBe(6)
  })

  it('run 快照：generate_videos 阶段带 requiresCheckpoint，成本闸暂停后 checkpoint.context 携带逐镜确认卡载荷', async () => {
    // 直接驱动编排层：前四阶段用桩执行器快速通过，generate_videos 用真实 film executor
    const fs = require('fs')
    const os = require('os')
    const path = require('path')
    const { registerFilmVideoStages } = require('./video-gen')
    const orchestr = new PipelineEngine({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } })
    // StageExecutor 需存在（编排模式）；构造传 serviceBus 桩
    orchestr.stageExecutor = {
      _customExecutors: new Map(),
      register (type, fn) { this._customExecutors.set(type, fn) },
      async execute ({ runId, stage, params, context, onProgress }) {
        const fn = this._customExecutors.get(stage.type)
        if (!fn) return { success: false, error: 'no executor for ' + stage.type }
        // 测试 seam：_testSleep/_testDownload 是 executor 正式参数（生产 StageExecutor 不传自动用真实实现）
        return fn({
          runId, stage, params, context, onProgress,
          _testSleep: async () => {},
          _testDownload: async (url, dest) => { require('fs').writeFileSync(dest, 'fake-mp4') },
        })
      },
    }
    for (const t of ['film_load_template', 'film_adapt_script', 'film_select_shots', 'film_export_prompts']) {
      orchestr.registerStageExecutor(t, async () => ({ success: true, output: { ok: true } }))
    }
    orchestr.registerStageExecutor('film_render', async () => ({ success: true, output: { final: true } }))
    const calls = []
    const manager = {
      getDefault: (type) => (type === 'video' ? { id: 'mv', config: { models: ['m1'], capability_models: { video: 'm1' } } } : null),
      getProvider: () => ({ id: 'mv' }),
      callAdapter: async (p, m, payload) => {
        calls.push({ m, payload })
        if (m === 'generateVideo') return { code: 0, data: { taskId: 't1' } }
        return { code: 0, data: { status: 'completed', videoUrl: 'mock://v' } }
      },
    }
    orchestr.aiGenerator = { _modelProviderManager: manager }
    registerFilmVideoStages(orchestr)
    const shots = [
      { shotId: 's-0', title: '开场', prompt: 'p0 <<<aaaaaaaa-1111-4111-8111-111111111111>>>' },
      { shotId: 's-1', title: '收尾', prompt: 'p1' },
    ]
    const started = await orchestr.startOrchestrated('film-engineering', {
      autoAdvance: true,
      initialContext: { selectedShots: shots },
      aspect: '16x9',
      seconds: 5,
    })
    expect(started.success).toBe(true)
    // 停在成本闸：paused，未发生任何 provider 调用
    expect(started.paused).toBe(true)
    expect(calls.length).toBe(0)
    const runId = started.runId
    const snap = orchestr.getRunSnapshot(runId)
    expect(snap.status.status).toBe('paused')
    expect(snap.currentStage).toBe(4)
    expect(snap.checkpoint).toBeTruthy()
    const costCheck = snap.checkpoint.context && snap.checkpoint.context.generate_videos && snap.checkpoint.context.generate_videos.costCheck
    expect(costCheck).toBeTruthy()
    expect(costCheck.shots.map((s) => s.shotId)).toEqual(['s-0', 's-1'])
    expect(costCheck.aspect).toBe('16x9')
    expect(costCheck.seconds).toBe(5)
    // 确认后重入同阶段真实生成（confirmStageGate：merge patch → 重执行当前阶段）
    const confirmed = await orchestr.confirmStageGate(runId, {
      cost_confirmation: { confirmed: true, confirmedAt: new Date().toISOString() },
    })
    expect(confirmed.success).toBe(true)
    expect(calls.filter((c) => c.m === 'generateVideo').length).toBe(2)
    const runDir = path.join(os.tmpdir(), 'film-engineering', runId)
    expect(fs.existsSync(path.join(runDir, 'shot_000.mp4'))).toBe(true)
    expect(fs.existsSync(path.join(runDir, 'shot_001.mp4'))).toBe(true)
    const done = orchestr.getRunSnapshot(runId)
    // 生成阶段 gateCleared 后不再二次暂停：直进 render 并完结（或停在 render 前）
    expect(done.status.status).toBe('completed')
  })
})
