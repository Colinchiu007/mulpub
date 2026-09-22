// @ts-check
'use strict'
/**
 * film-pipeline-chaining-integration.test.js — 回归保护（issue #2193）
 *
 * 复现并守护：用【真实】前四阶段执行器（不打桩）驱动「勾选分镜直接出片」流，
 * 仅以 initialContext:{selectedShots} 发起（复刻 useFilmVideoGen.start 的真实入参，
 * 不传 kitDir / script / selectedShotIds），断言 run 能穿过 load→adapt→select→export
 * 停在 generate_videos 成本闸（paused + costCheck），确认后进入生成并 completed。
 *
 * 修复前该链在 adapt_script 处因 context.template 缺失而 failed（引擎按 stage 名嵌套写
 * context，旧执行器读扁平键）——本测试当时即 RED，精确复现 #2193。
 */
const fs = require('fs')
const os = require('os')
const path = require('path')
const { PipelineEngine } = require('../pipeline-engine')
const { registerFilmEngineeringStages } = require('./film-engineering-stages')
const { registerFilmVideoStages } = require('./video-gen')

function makeOrchestrator () {
  const orchestr = new PipelineEngine({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } })
  orchestr.modelProviderManager = { getDefault: () => null, getProvider: () => null }
  orchestr.stageExecutor = {
    _customExecutors: new Map(),
    register (type, fn) { this._customExecutors.set(type, fn) },
    async execute ({ runId, stage, params, context, onProgress }) {
      const fn = this._customExecutors.get(stage.type)
      if (!fn) return { success: false, error: 'no executor for ' + stage.type }
      return fn({
        runId, stage, params, context, onProgress,
        // video-gen 正式测试 seam（生产 StageExecutor 不传自动用真实实现）
        _testSleep: async () => {},
        _testDownload: async (url, dest) => { fs.writeFileSync(dest, 'fake-mp4') },
      })
    },
  }
  return orchestr
}

describe('film-engineering 出片流端到端串联（#2193 回归）', () => {
  it('真实前四阶段执行器：仅 initialContext.selectedShots 能停在成本闸，确认后 completed', async () => {
    const orchestr = makeOrchestrator()
    const engRes = registerFilmEngineeringStages(orchestr)
    expect(engRes.success).toBe(true)
    const vidRes = registerFilmVideoStages(orchestr)
    expect(vidRes.success).toBe(true)
    // render 打桩（非缺陷点，避免依赖真实 ffmpeg/concat）
    orchestr.registerStageExecutor('film_render', async () => ({ success: true, output: { final: true } }))

    const calls = []
    const manager = {
      getDefault: (t) => (t === 'video' ? { id: 'mv', config: { models: ['m1'], capability_models: { video: 'm1' } } } : null),
      getProvider: () => ({ id: 'mv' }),
      callAdapter: async (p, m) => {
        calls.push(m)
        if (m === 'generateVideo') return { code: 0, data: { taskId: 't1' } }
        return { code: 0, data: { status: 'completed', videoUrl: 'mock://v' } }
      },
    }
    orchestr.aiGenerator = { _modelProviderManager: manager }

    const shots = [
      { shotId: 's-0', sceneId: 'sc-0', prompt: 'p0', model: 'nano_banana_2', refTokens: [] },
    ]
    const started = await orchestr.startOrchestrated('film-engineering', {
      autoAdvance: true,
      initialContext: { selectedShots: shots }, // 复刻 UI：不传 kitDir/script/selectedShotIds
      aspect: '16x9',
      seconds: 5,
    })
    // 关键断言：穿过前四阶段、停在成本闸，且确认前零 provider 调用
    expect(started.success).toBe(true)
    expect(started.paused).toBe(true)
    expect(calls.length).toBe(0)
    const runId = started.runId
    const snap = orchestr.getRunSnapshot(runId)
    expect(snap.status.status).toBe('paused')
    expect(snap.checkpoint).toBeTruthy()
    expect(snap.checkpoint.stageName).toBe('generate_videos')
    const costCheck = snap.checkpoint.context && snap.checkpoint.context.generate_videos && snap.checkpoint.context.generate_videos.costCheck
    expect(costCheck).toBeTruthy()
    expect(costCheck.shots.map((s) => s.shotId)).toEqual(['s-0'])
    expect(costCheck.aspect).toBe('16x9')
    expect(costCheck.seconds).toBe(5)

    // 过成本闸 → 真实生成（_testDownload 落假 mp4）→ render 桩 → completed
    const confirmed = await orchestr.confirmStageGate(runId, {
      cost_confirmation: { confirmed: true, confirmedAt: new Date().toISOString() },
    })
    expect(confirmed.success).toBe(true)
    expect(calls.filter((c) => c === 'generateVideo').length).toBe(1)
    const runDir = path.join(os.tmpdir(), 'film-engineering', runId)
    expect(fs.existsSync(path.join(runDir, 'shot_000.mp4'))).toBe(true)
    const done = orchestr.getRunSnapshot(runId)
    expect(done.status.status).toBe('completed')
  })
})
