// @ts-check
'use strict'
/**
 * film-manifest-compose-run.test.js — 收口合成 manifest 直通 run 全链回归（任务 9.3 冒烟发现）
 *
 * 9.3 真实冒烟暴露的集成缺口：composeFinal 只带 initialContext.renderManifest 发起
 * 编排 run 时——
 *   1) 前四阶段执行器（load_template/select_shots/export_prompts）只认 selectedShots，
 *      manifest-only run 在 load_template 即 fail（"需要 params.kitDir"）；
 *   2) generate_videos executor 虽 manifest 直通，但引擎在 executor 成功后仍按
 *      checkpointRequired 入口闸暂停等成本确认 → compose run 永远停在 paused；
 *   3) film_render manifest 模式使用全新 runId，runDir 不存在 → writeConcatList ENOENT。
 * 本测试以【真实】前四阶段 + video-gen + render（probe/tool seam）驱动完整
 * startOrchestrated run，断言零 provider 调用、无暂停直达 completed、finalPath 产出。
 */
const fs = require('fs')
const os = require('os')
const path = require('path')
const { PipelineEngine } = require('../pipeline-engine')
const { registerFilmEngineeringStages } = require('./film-engineering-stages')
const { registerFilmVideoStages, FILM_VIDEO_STAGE_TYPES } = require('./video-gen')
const { registerFilmRenderStage } = require('./film-render')

const SPEC = { codec: 'h264', width: 1280, height: 720, fps: '24/1', timebase: '1/12288', hasAudio: true, sampleRate: 44100, channels: 2 }

function makeOrchestrator () {
  const orchestr = new PipelineEngine({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } })
  const providerCalls = []
  orchestr.modelProviderManager = { getDefault: () => null, getProvider: () => null }
  orchestr.stageExecutor = {
    _customExecutors: new Map(),
    register (type, fn) { this._customExecutors.set(type, fn) },
    async execute ({ runId, stage, params, context, onProgress }) {
      const fn = this._customExecutors.get(stage.type)
      if (!fn) return { success: false, error: 'no executor for ' + stage.type }
      return fn({
        runId, stage, params, context, onProgress,
        _testSleep: async () => {},
        _testDownload: async (url, dest) => { fs.writeFileSync(dest, 'fake-mp4') },
        _testProbe: async () => ({ ...SPEC }),
        _testRunTool: async (binary, args) => {
          providerCalls.push(path.basename(String(args[args.length - 1])))
          fs.writeFileSync(args[args.length - 1], 'fake-final')
          return ''
        },
      })
    },
  }
  orchestr.aiGenerator = {
    _modelProviderManager: {
      getDefault: (t) => (t === 'video' ? { id: 'mv', config: { models: ['m1'], capability_models: { video: 'm1' } } } : null),
      getProvider: () => ({ id: 'mv' }),
      callAdapter: async () => { providerCalls.push('PROVIDER'); throw new Error('manifest 直通 run 不得发生 provider 调用') },
    },
  }
  return { orchestr, providerCalls }
}

function makeManifestFiles (n) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'film-engineering', 'mcr-test-'))
  const manifest = []
  for (let i = 0; i < n; i++) {
    const f = path.join(dir, 'shot_' + String(i).padStart(3, '0') + '.mp4')
    fs.writeFileSync(f, 'fake-clip-' + i)
    manifest.push({ shotId: 'shot-' + i, path: f, sourceKind: i % 2 === 0 ? 'generated' : 'downloaded', orderIndex: i })
  }
  return { dir, manifest }
}

describe('film-engineering 收口合成 manifest 直通 run（9.3 冒烟回归）', () => {
  it('前四阶段执行器：manifest-only context 全部直通成功；无 manifest 无选择仍 fail-closed', async () => {
    const { orchestr } = makeOrchestrator()
    expect(registerFilmEngineeringStages(orchestr).success).toBe(true)
    const exec = (type, args) => orchestr.stageExecutor._customExecutors.get(type)(args)
    const { manifest } = makeManifestFiles(2)
    const ctx = { renderManifest: manifest }

    const lt = await exec('film_load_template', { params: {}, context: ctx })
    expect(lt.success, 'load_template 应对 renderManifest 直通: ' + JSON.stringify(lt)).toBe(true)
    const ad = await exec('film_adapt_script', { params: {}, context: ctx })
    expect(ad.success).toBe(true)
    const ss = await exec('film_select_shots', { params: {}, context: ctx })
    expect(ss.success, 'select_shots 应对 renderManifest 直通: ' + JSON.stringify(ss)).toBe(true)
    const ex = await exec('film_export_prompts', { params: {}, context: ctx })
    expect(ex.success, 'export_prompts 应对 renderManifest 空选择直通: ' + JSON.stringify(ex)).toBe(true)

    // 回归锚：既无 manifest 也无 selectedShots → 三道仍 fail-closed
    expect((await exec('film_load_template', { params: {}, context: {} })).success).toBe(false)
    expect((await exec('film_select_shots', { params: {}, context: {} })).success).toBe(false)
    expect((await exec('film_export_prompts', { params: {}, context: {} })).success).toBe(false)
  })

  it('generate_videos manifest 直通声明 checkpoint:false（成本闸对零计费 run 无意义）', async () => {
    const { orchestr } = makeOrchestrator()
    expect(registerFilmVideoStages(orchestr).success).toBe(true)
    const fn = orchestr.stageExecutor._customExecutors.get(FILM_VIDEO_STAGE_TYPES.GENERATE_VIDEOS)
    const { manifest } = makeManifestFiles(2)
    const res = await fn({ runId: 'mcr-x', stage: {}, params: {}, context: { renderManifest: manifest }, onProgress: () => {} })
    expect(res.success).toBe(true)
    expect(res.output.manifestMode).toBe(true)
    expect(res.checkpoint).toBe(false)
  })

  it('真实六阶段编排：manifest-only run 零 provider 调用、无暂停直达 completed 并产出 finalPath', async () => {
    const { orchestr, providerCalls } = makeOrchestrator()
    expect(registerFilmEngineeringStages(orchestr).success).toBe(true)
    expect(registerFilmVideoStages(orchestr).success).toBe(true)
    expect(registerFilmRenderStage(orchestr).success).toBe(true)
    const { manifest } = makeManifestFiles(3)

    const started = await orchestr.startOrchestrated('film-engineering', {
      autoAdvance: true,
      initialContext: { renderManifest: manifest },
    })
    expect(started.success, 'run 失败: ' + JSON.stringify(started.results || started.error)).toBe(true)
    expect(started.paused, 'manifest 直通 run 不得停在成本闸').not.toBe(true)
    const snap = orchestr.getRunSnapshot(started.runId)
    expect(snap.status.status).toBe('completed')
    expect(providerCalls.filter((c) => c === 'PROVIDER').length).toBe(0)
    const render = snap.context.render
    expect(render.finalPath).toBeTruthy()
    expect(fs.existsSync(render.finalPath)).toBe(true)
    expect(render.source).toBe('renderManifest')
    expect(render.clipCount).toBe(3)
    // runDir 由 render 阶段自建（全新 runId 无目录 → 修复前 writeConcatList ENOENT）
    expect(fs.existsSync(render.runDir)).toBe(true)
  })

  it('回归锚：selectedShots 流仍在 generate_videos 暂停等成本确认（checkpoint:false 不放宽）', async () => {
    const { orchestr, providerCalls } = makeOrchestrator()
    expect(registerFilmEngineeringStages(orchestr).success).toBe(true)
    expect(registerFilmVideoStages(orchestr).success).toBe(true)
    orchestr.registerStageExecutor('film_render', async () => ({ success: true, output: { final: true } }))
    const shots = [{ shotId: 's-0', sceneId: 'sc-0', prompt: 'p0', model: 'nano_banana_2', refTokens: [] }]
    const started = await orchestr.startOrchestrated('film-engineering', {
      autoAdvance: true,
      initialContext: { selectedShots: shots },
      aspect: '16x9', seconds: 5,
    })
    expect(started.success).toBe(true)
    expect(started.paused).toBe(true)
    expect(providerCalls.length).toBe(0)
  })
})
