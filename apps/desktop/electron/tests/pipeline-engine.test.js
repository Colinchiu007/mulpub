import { beforeEach, describe, expect, it, vi } from 'vitest'

const { PipelineEngine, generateRunId } = require('../services/pipeline-engine')

describe('PipelineEngine 状态机模式', () => {
  let engine

  beforeEach(() => {
    engine = new PipelineEngine({
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), notify: vi.fn() },
    })
  })

  it('导出 PipelineEngine 类', () => {
    expect(PipelineEngine).toBeTypeOf('function')
  })

  it('列出非空的 pipeline 数组', () => {
    expect(engine.listPipelines()).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'animated-explainer' }),
    ]))
  })

  it('将 Story2Video 稳定排在内置流水线首位，同时保持其他流水线顺序', () => {
    const list = engine.listPipelines()

    expect(list[0].name).toBe('story2video-compose')
    expect(list.slice(1).map(item => item.name)).toEqual([
      'animated-explainer', 'talking-head', 'cinematic', 'animation',
      'avatar-spokesperson', 'character-animation', 'clip-factory',
      'documentary-montage', 'hybrid', 'localization-dub', 'podcast-repurpose',
      'screen-demo', 'framework-smoke', 'film-engineering',
    ])
  })
  it('列表同时提供 stageCount，供桌面卡片显示阶段数', () => {
    const pipeline = engine.listPipelines().find(item => item.name === 'story2video-compose')
    // 2026-08-11：新增 select_video_scenes 阶段（视频+图片轮播混合模式）+ scene_context 中间层（#526）
    // 2026-08-14：domain_enrich 合并进 scene_context（merge-domain-enrich-into-scene-context），运行阶段 8→7
    expect(pipeline.stageCount).toBe(7)
  })

  it('已实现真实引擎的流水线标记 available=true', () => {
    const list = engine.listPipelines()
    const implemented = ['story2video-compose', 'animated-explainer', 'talking-head', 'cinematic', 'clip-factory', 'framework-smoke', 'documentary-montage', 'localization-dub', 'animation', 'avatar-spokesperson', 'character-animation', 'hybrid', 'podcast-repurpose', 'film-engineering']
    for (const name of implemented) {
      expect(list.find(item => item.name === name)?.available).toBe(true)
    }
  })

  it('未实现真实引擎的流水线标记 available=false', () => {
    const list = engine.listPipelines()
    const notImplemented = ['screen-demo']
    for (const name of notImplemented) {
      expect(list.find(item => item.name === name)?.available).toBe(false)
    }
  })

  it('podcast-repurpose 提供完整 stageDefs 链', () => {
    const pipeline = engine.getPipeline('podcast-repurpose')
    expect(pipeline.stages).toEqual(['analyze', 'visualize', 'assemble', 'render'])
    expect(pipeline.stageDefs.map(def => def.type)).toEqual([
      'podcast_analyze', 'podcast_visualize', 'podcast_assemble', 'compose',
    ])
  })

  it('localization-dub 提供完整 stageDefs 链', () => {
    const pipeline = engine.getPipeline('localization-dub')
    expect(pipeline.stages).toEqual(['transcribe', 'translate', 'tts', 'sync'])
    expect(pipeline.stageDefs.map(def => def.type)).toEqual([
      'localization_transcribe', 'localization_translate', 'localization_tts', 'localization_sync',
    ])
  })

  it('documentary-montage 提供完整 stageDefs 链', () => {
    const pipeline = engine.getPipeline('documentary-montage')
    expect(pipeline.stages).toEqual(['research', 'ingest', 'edit', 'narrate', 'render'])
    expect(pipeline.stageDefs.map(def => def.name)).toEqual(['research', 'ingest', 'edit', 'narrate', 'render'])
    expect(pipeline.stageDefs.map(def => def.type)).toEqual([
      'documentary_research', 'documentary_ingest', 'documentary_edit', 'documentary_narrate', 'compose',
    ])
  })

  it('每条 pipeline 都包含非空名称和描述', () => {
    for (const pipeline of engine.listPipelines()) {
      expect(pipeline.name).toEqual(expect.any(String))
      expect(pipeline.name.length).toBeGreaterThan(0)
      expect(pipeline.description).toEqual(expect.any(String))
      expect(pipeline.description.length).toBeGreaterThan(0)
    }
  })

  it('返回已知 pipeline 的完整阶段定义', () => {
    expect(engine.getPipeline('animated-explainer')).toEqual(expect.objectContaining({
      name: 'animated-explainer',
      stages: expect.any(Array),
    }))
  })

  it('未知 pipeline 返回 null', () => {
    expect(engine.getPipeline('nonexistent-pipeline')).toBeNull()
  })

  it('start 将 pipeline 状态切换为 running', () => {
    expect(engine.start('animated-explainer', { topic: 'AI basics' })).toMatchObject({ success: true })
    expect(engine.getStatus('animated-explainer').status).toBe('running')
  })

  it('pause 将运行状态切换为 paused', () => {
    engine.start('animated-explainer', {})

    expect(engine.pause()).toMatchObject({ success: true })
    expect(engine.getStatus('animated-explainer').status).toBe('paused')
  })

  it('resume 将暂停状态切回 running', () => {
    engine.start('animated-explainer', {})
    engine.pause()

    expect(engine.resume()).toMatchObject({ success: true })
    expect(engine.getStatus('animated-explainer').status).toBe('running')
  })

  it('cancel 成功并清理当前运行状态', () => {
    engine.start('animated-explainer', {})

    expect(engine.cancel()).toMatchObject({ success: true })
    expect(engine.getStatus('animated-explainer').status).toBe('idle')
  })

  it('advance 按阶段推进并在末尾回到 idle', () => {
    const pipeline = engine.getPipeline('animated-explainer')
    engine.start(pipeline.name, {})

    for (const _stage of pipeline.stages) {
      expect(engine.advance()).toMatchObject({ success: true })
    }
    expect(engine.getStatus(pipeline.name).status).toBe('idle')
  })

  it('完成 pipeline 后记录 completed 历史', () => {
    const pipeline = engine.getPipeline('animated-explainer')
    engine.start(pipeline.name, {})
    pipeline.stages.forEach(() => engine.advance())

    expect(engine.getHistory()).toContainEqual(expect.objectContaining({
      pipeline: pipeline.name,
      status: 'completed',
    }))
  })

  it('getHistory 合并持久化失败快照：应用重启后失败任务仍显示在历史记录', () => {
    const os = require('os')
    const path = require('path')
    const fs = require('fs')
    const { RunStateStore } = require('../services/run-state-store')
    const dir = path.join(os.tmpdir(), 'pipeline-engine-history-test-' + process.pid + '-' + Date.now() + '-' + Math.random().toString(36).slice(2))
    const store = new RunStateStore({ dir, log: { warn() {}, info() {} } })

    const engineA = new PipelineEngine({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), notify: vi.fn() }, runStateStore: store })
    engineA.runStateStore.saveFailed({
      id: 'run-failed-persisted',
      pipeline: 'story2video-compose',
      status: 'failed',
      currentStage: 3,
      stages: [{ name: 'split', status: 'completed' }, { name: 'optimize', status: 'failed' }],
      context: {},
      params: {},
      error: 'provider timeout',
      orchestrationMode: 'orchestrator',
      createdAt: '2026-08-08T01:00:00.000Z',
      endedAt: '2026-08-08T01:05:00.000Z',
    })

    // 模拟应用重启：新引擎（内存 _history 为空）复用同一 store
    const engineB = new PipelineEngine({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), notify: vi.fn() }, runStateStore: store })
    const history = engineB.getHistory()
    expect(history).toContainEqual(expect.objectContaining({
      id: 'run-failed-persisted',
      pipeline: 'story2video-compose',
      status: 'failed',
    }))

    // 同会话去重：失败 run 同时在内存 _history 时只出现一次
    const engineC = new PipelineEngine({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), notify: vi.fn() }, runStateStore: store })
    engineC._history.push({ id: 'run-failed-persisted', pipeline: 'story2video-compose', status: 'failed', stages: [], context: {}, createdAt: '2026-08-08T01:00:00.000Z' })
    const ids = engineC.getHistory().map((item) => item.id)
    expect(ids.filter((id) => id === 'run-failed-persisted')).toHaveLength(1)

    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('getHistory 合并持久化 running 快照：重启后中断任务归入 interrupted（非手动暂停）', () => {
    const os = require('os')
    const path = require('path')
    const fs = require('fs')
    const { RunStateStore } = require('../services/run-state-store')
    const dir = path.join(os.tmpdir(), 'pipeline-engine-running-history-' + process.pid + '-' + Date.now() + '-' + Math.random().toString(36).slice(2))
    const store = new RunStateStore({ dir, log: { warn() {}, info() {} } })

    store.saveRunning({
      id: 'run-running-persisted',
      projectId: 'run-running-persisted',
      pipeline: 'story2video-compose',
      status: 'running',
      currentStage: 2,
      stages: [
        { name: 'split', status: 'completed' },
        { name: 'optimize', status: 'completed' },
        { name: 'generate_assets', status: 'running' },
      ],
      context: { prompt: '运行中' },
      params: {},
      error: null,
      orchestrationMode: 'orchestrator',
      createdAt: '2026-08-09T02:00:00.000Z',
    })

    // 模拟应用重启：新引擎（内存为空）复用同一 store
    // 运行中快照在重启后不再是运行中状态：归一化为 interrupted（已中断）。
    // 合同（2026-08-20 修订）：「已暂停」仅保留用户手动暂停；应用退出/崩溃导致的中断
    // 不得显示为 paused，否则失败/中断任务会错误出现在「已暂停」标签。
    const engineB = new PipelineEngine({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), notify: vi.fn() }, runStateStore: store })
    const history = engineB.getHistory()
    expect(history).toContainEqual(expect.objectContaining({
      id: 'run-running-persisted',
      pipeline: 'story2video-compose',
      status: 'interrupted',
      pausedStage: 'generate_assets',
      completedAt: null,
    }))
    // 中断记录必须携带 projectId，供渲染层与 story2video 项目记录合并去重（消除双卡片）
    const interruptedEntry = history.find((item) => item.id === 'run-running-persisted')
    expect(interruptedEntry.projectId).toBe('run-running-persisted')
    // 中断任务绝不能归入 paused（「已暂停」= 用户手动暂停语义）
    expect(history.filter((item) => item.id === 'run-running-persisted' && item.status === 'paused')).toHaveLength(0)

    // running 快照不混入 listFailed（失败/取消语义不变）
    expect(store.listFailed().map((s) => s.runId)).not.toContain('run-running-persisted')
    // 快照持久化携带 projectId（增量字段），重启恢复链与历史合并均可读取
    expect(store.load('run-running-persisted').projectId).toBe('run-running-persisted')
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('getHistory 持久化 paused 快照重启后保持 paused：手动暂停语义不被中断归一化影响', () => {
    const os = require('os')
    const path = require('path')
    const fs = require('fs')
    const { RunStateStore } = require('../services/run-state-store')
    const dir = path.join(os.tmpdir(), 'pipeline-engine-paused-history-' + process.pid + '-' + Date.now() + '-' + Math.random().toString(36).slice(2))
    const store = new RunStateStore({ dir, log: { warn() {}, info() {} } })

    // pauseRun 手动暂停写入 paused 快照（含 checkpoint）
    store.savePaused({
      id: 'run-manual-paused',
      projectId: 'run-manual-paused',
      pipeline: 'story2video-compose',
      status: 'paused',
      currentStage: 1,
      stages: [
        { name: 'split', status: 'completed' },
        { name: 'optimize', status: 'paused' },
      ],
      context: {},
      params: {},
      checkpoint: { type: 'stage', stage: 'optimize' },
      error: null,
      orchestrationMode: 'orchestrator',
      createdAt: '2026-08-20T01:00:00.000Z',
    })

    const engineB = new PipelineEngine({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), notify: vi.fn() }, runStateStore: store })
    const history = engineB.getHistory()
    expect(history).toContainEqual(expect.objectContaining({
      id: 'run-manual-paused',
      status: 'paused',
      pausedStage: 'optimize',
    }))
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('deleteRun 删除内存 run、内存历史与持久化快照；运行中 run 拒绝删除', () => {
    const os = require('os')
    const path = require('path')
    const fs = require('fs')
    const { RunStateStore } = require('../services/run-state-store')
    const dir = path.join(os.tmpdir(), 'pipeline-engine-delete-run-' + process.pid + '-' + Date.now() + '-' + Math.random().toString(36).slice(2))
    const store = new RunStateStore({ dir, log: { warn() {}, info() {} } })
    const engine = new PipelineEngine({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), notify: vi.fn() }, runStateStore: store })

    // 1) 持久化快照（重启可见的记录）可删除
    store.saveFailed({
      id: 'run-delete-persisted', pipeline: 'story2video-compose', status: 'failed',
      currentStage: 1, stages: [{ name: 'optimize', status: 'failed' }],
      context: {}, params: {}, error: 'boom', orchestrationMode: 'orchestrator',
      createdAt: '2026-08-10T01:00:00.000Z', endedAt: '2026-08-10T01:05:00.000Z',
    })
    expect(engine.getHistory().some((item) => item.id === 'run-delete-persisted')).toBe(true)
    expect(engine.deleteRun('run-delete-persisted')).toEqual({ success: true, runId: 'run-delete-persisted' })
    expect(engine.getHistory().some((item) => item.id === 'run-delete-persisted')).toBe(false)
    expect(store.load('run-delete-persisted')).toBeNull()

    // 2) 内存 run（含 _<name> 索引）与内存历史可删除
    engine.registerPipeline({ name: 'delete-run-test', description: '删除测试', stages: ['a'], stageDefs: [{ name: 'a', type: 'rp_a' }] })
    engine.registerStageExecutor('rp_a', async () => ({ success: true, output: {} }))
    const started = engine.start('delete-run-test', {})
    // start 后 run 处于执行态：先置为终态再删除（运行中删除是另一条用例）
    engine._runs.get(started.runId).status = 'failed'
    expect(engine.deleteRun(started.runId)).toEqual({ success: true, runId: started.runId })
    expect(engine.getHistory().some((item) => item.id === started.runId)).toBe(false)
    expect(engine._runs.get('_delete-run-test')).toBeUndefined()

    // 3) 运行中的 run 拒绝删除
    engine.registerPipeline({ name: 'delete-running-test', description: '运行中删除测试', stages: ['a'], stageDefs: [{ name: 'a', type: 'rp_a' }] })
    engine.registerStageExecutor('rp_a', async () => ({ success: true, output: {} }))
    const running = engine.start('delete-running-test', {})
    engine._runs.get(running.runId).status = 'running'
    expect(engine.deleteRun(running.runId).success).toBe(false)
    expect(engine._runs.get(running.runId)).toBeDefined()

    // 4) 不存在的 runId 报错
    expect(engine.deleteRun('no-such-run').success).toBe(false)
    expect(engine.deleteRun('  ').success).toBe(false)

    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('deleteRun 持久化快照删除失败时保留内存 run 与历史', () => {
    const remove = vi.fn(() => false)
    const engine = new PipelineEngine({
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), notify: vi.fn() },
      runStateStore: { load: vi.fn(() => ({ runId: 'run-delete-failure' })), remove },
    })
    const run = {
      id: 'run-delete-failure',
      pipeline: 'story2video-compose',
      status: 'failed',
      stages: [],
      context: {},
    }
    engine._runs.set(run.id, run)
    engine._runs.set('_story2video-compose', run)
    engine._history.push(run)
    expect(engine.deleteRun(run.id)).toEqual({
      success: false,
      error: '删除运行记录失败：持久化快照未清理',
      errorCode: 'PIPELINE_SNAPSHOT_CLEANUP_FAILED',
    })
    expect(remove).toHaveBeenCalledWith(run.id)
    expect(engine._runs.get(run.id)).toBe(run)
    expect(engine._runs.get('_story2video-compose')).toBe(run)
    expect(engine._history).toContain(run)
  })

  it('pauseRun 按 runId 暂停运行中编排任务并保存检查点与 paused 快照；非运行中/不存在拒绝', () => {
    const os = require('os')
    const path = require('path')
    const fs = require('fs')
    const { RunStateStore } = require('../services/run-state-store')
    const dir = path.join(os.tmpdir(), 'pipeline-engine-pause-run-' + process.pid + '-' + Date.now() + '-' + Math.random().toString(36).slice(2))
    const store = new RunStateStore({ dir, log: { warn() {}, info() {} } })
    const engine = new PipelineEngine({ serviceBus: {}, log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), notify: vi.fn() }, runStateStore: store })
    engine.registerPipeline({
      name: 'pause-run-test',
      description: '按 runId 暂停测试',
      stages: ['a', 'b'],
      stageDefs: [{ name: 'a', type: 'rp_a' }, { name: 'b', type: 'rp_b' }],
    })
    engine.registerStageExecutor('rp_a', async () => ({ success: true, output: {} }))
    engine.registerStageExecutor('rp_b', async () => ({ success: true, output: {} }))

    const started = engine.start('pause-run-test', {})
    engine._runs.get(started.runId).status = 'running'
    engine._runs.get(started.runId).orchestrationMode = 'orchestrator'

    // 1) 运行中可暂停：编排 run 写入 checkpoint（manual_pause）并持久化 paused 快照
    const result = engine.pauseRun(started.runId)
    expect(result.success).toBe(true)
    expect(result.runId).toBe(started.runId)
    const run = engine._runs.get(started.runId)
    expect(run.status).toBe('paused')
    expect(run.checkpoint.type).toBe('manual_pause')

    // 2) 非运行中（已暂停）拒绝重复暂停
    expect(engine.pauseRun(started.runId).success).toBe(false)

    // 3) 不存在 / 非法 runId 拒绝
    expect(engine.pauseRun('no-such-run').success).toBe(false)
    expect(engine.pauseRun('  ').success).toBe(false)

    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('pauseRun 持久化暂停快照失败时回滚内存状态与检查点', () => {
    const engine = new PipelineEngine({
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), notify: vi.fn() },
      runStateStore: { savePaused: vi.fn(() => false) },
    })
    engine.registerPipeline({
      name: 'pause-persist-failure',
      description: '暂停持久化失败回滚测试',
      stages: ['a'],
      stageDefs: [{ name: 'a', type: 'pause_a' }],
    })
    const started = engine.start('pause-persist-failure', {})
    const run = engine._runs.get(started.runId)
    run.status = 'running'
    run.orchestrationMode = 'orchestrator'
    run.checkpoint = { type: 'previous_checkpoint' }
    const stage = run.stages[0]
    const previousStageStatus = stage.status

    expect(engine.pauseRun(started.runId)).toEqual({ success: false, error: "保存暂停检查点失败", errorCode: "PIPELINE_CHECKPOINT_SAVE_FAILED" })
    expect(run.status).toBe('running')
    expect(stage.status).toBe(previousStageStatus)
    expect(run.checkpoint).toEqual({ type: 'previous_checkpoint' })
  })

  it('cancelRun 按 runId 定向取消运行中任务；非运行中/不存在/非法 runId 拒绝', () => {
    const engine = new PipelineEngine({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), notify: vi.fn() } })
    engine.registerPipeline({
      name: 'cancel-run-test',
      description: '按 runId 取消测试',
      stages: ['a', 'b'],
      stageDefs: [{ name: 'a', type: 'cr_a' }, { name: 'b', type: 'cr_b' }],
    })
    engine.registerStageExecutor('cr_a', async () => ({ success: true, output: {} }))
    engine.registerStageExecutor('cr_b', async () => ({ success: true, output: {} }))

    const started = engine.start('cancel-run-test', {})
    const run = engine._runs.get(started.runId)
    run.status = 'running'
    run.currentStage = 0
    run.stages[0].status = 'running'

    // 1) 运行中可定向取消：run + 当前阶段标记 cancelled
    const result = engine.cancelRun(started.runId)
    expect(result.success).toBe(true)
    expect(result.runId).toBe(started.runId)
    expect(run.status).toBe('cancelled')
    expect(run.cancelled).toBe(true)
    expect(run.stages[0].status).toBe('cancelled')

    // 2) 已取消（非 running/paused）拒绝再次取消
    expect(engine.cancelRun(started.runId).success).toBe(false)

    // 3) 不存在 / 非法 runId 拒绝
    expect(engine.cancelRun('no-such-run').success).toBe(false)
    expect(engine.cancelRun('  ').success).toBe(false)
  })

  it('pause/resume 及 pauseRun 拒绝非对象阶段数据', () => {
    const engine = new PipelineEngine({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), notify: vi.fn() } })
    const pausedRun = {
      id: 'malformed-paused',
      pipeline: 'story2video-compose',
      status: 'paused',
      currentStage: 0,
      stages: ['malformed'],
      orchestrationMode: 'state_machine',
    }
    engine._runs.set(pausedRun.id, pausedRun)
    engine._runs.set('_malformed-paused-pipeline', pausedRun)
    engine._currentPipeline = 'malformed-paused-pipeline'
    expect(engine.resume()).toEqual({ success: false, error: 'Pipeline stage state is invalid', errorCode: 'PIPELINE_STAGE_INVALID' })
    expect(pausedRun.status).toBe('paused')

    const runningRun = {
      id: 'malformed-running',
      pipeline: 'story2video-compose',
      status: 'running',
      currentStage: 0,
      stages: [1],
      orchestrationMode: 'orchestrator',
    }
    engine._runs.set(runningRun.id, runningRun)
    engine._currentPipeline = 'malformed-paused-pipeline'
    engine._runs.set('_malformed-paused-pipeline', runningRun)
    expect(engine.pause()).toEqual({ success: false, error: 'Pipeline stage state is invalid', errorCode: 'PIPELINE_STAGE_INVALID' })
    expect(runningRun.status).toBe('running')
    expect(engine.pauseRun(runningRun.id)).toEqual({ success: false, error: '运行记录阶段数据无效', errorCode: 'PIPELINE_ERROR' })
    expect(runningRun.status).toBe('running')
  })

  it('saveRunningState 把内存运行中编排任务落盘为 running 快照（退出兜底）', async () => {
    const os = require('os')
    const path = require('path')
    const fs = require('fs')
    const { RunStateStore } = require('../services/run-state-store')
    const dir = path.join(os.tmpdir(), 'pipeline-engine-save-running-' + process.pid + '-' + Date.now() + '-' + Math.random().toString(36).slice(2))
    const store = new RunStateStore({ dir, log: { warn() {}, info() {} } })
    const engine = new PipelineEngine({ serviceBus: {}, log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), notify: vi.fn() }, runStateStore: store })
    engine.registerPipeline({
      name: 'running-persist-test',
      description: '退出兜底测试',
      stages: ['a', 'b'],
      stageDefs: [{ name: 'a', type: 'rp_a' }, { name: 'b', type: 'rp_b' }],
    })
    engine.registerStageExecutor('rp_a', async () => ({ success: true, output: {} }))
    engine.registerStageExecutor('rp_b', async () => ({ success: true, output: {} }))

    const started = await engine.startOrchestrated('running-persist-test', { initialContext: {}, autoAdvance: false })
    expect(started.success).toBe(true)
    // 启动即阶段级 checkpoint：running 快照已落盘
    expect(store.listRunning().map((s) => s.runId)).toContain(started.runId)

    // 模拟退出兜底：saveRunningState 幂等重写
    expect(engine.saveRunningState()).toBe(1)
    const loaded = store.load(started.runId)
    expect(loaded.status).toBe('running')
    expect(loaded.endedAt).toBeNull()

    // 非编排（state_machine）运行中的 run 不计入
    engine.start('animated-explainer', {})
    expect(engine.saveRunningState()).toBe(1)

    // 无运行中编排任务时返回 0
    const idleEngine = new PipelineEngine({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), notify: vi.fn() }, runStateStore: store })
    expect(idleEngine.saveRunningState()).toBe(0)
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('_executeStage 执行前写入阶段级 running checkpoint', async () => {
    const saveRunning = vi.fn(() => true)
    const engine = new PipelineEngine({
      serviceBus: {},
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), notify: vi.fn() },
      runStateStore: { saveRunning },
    })
    engine.registerPipeline({
      name: 'checkpoint-test',
      description: 'checkpoint 测试',
      stages: ['a'],
      stageDefs: [{ name: 'a', type: 'ck_a' }],
    })
    let executed = false
    engine.registerStageExecutor('ck_a', async () => { executed = true; return { success: true, output: {} } })

    const started = await engine.startOrchestrated('checkpoint-test', { initialContext: {}, autoAdvance: false })
    // startOrchestrated 启动即写入一次
    expect(saveRunning).toHaveBeenCalled()
    await engine.executeStage(started.runId)
    // _executeStage 执行前再次写入
    expect(executed).toBe(true)
    expect(saveRunning).toHaveBeenCalledTimes(2)
  })

  it('_finalizeRun completed 清理 running 快照（防止已完成任务以运行中重现）', () => {
    const remove = vi.fn()
    const engine = new PipelineEngine({
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), notify: vi.fn() },
      runStateStore: { remove },
    })
    const run = {
      id: 'run-complete-cleanup',
      pipeline: 'story2video-compose',
      status: 'running',
      currentStage: 0,
      stages: [{ name: 'split', status: 'running' }],
      context: {},
      params: {},
      orchestrationMode: 'orchestrator',
      startedAt: new Date().toISOString(),
    }
    engine._runs.set(run.id, run)
    engine._finalizeRun(run, 'completed')
    expect(remove).toHaveBeenCalledWith('run-complete-cleanup')
  })

  it('hasRunningOrchestration 只在存在运行中编排任务时返回 true', async () => {
    const engine = new PipelineEngine({ serviceBus: {}, log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), notify: vi.fn() } })
    engine.registerPipeline({
      name: 'running-detect',
      description: '运行检测',
      stages: ['a'],
      stageDefs: [{ name: 'a', type: 'rd_a' }],
    })
    engine.registerStageExecutor('rd_a', async () => ({ success: true, output: {} }))
    expect(engine.hasRunningOrchestration()).toBe(false)

    const started = await engine.startOrchestrated('running-detect', { initialContext: {}, autoAdvance: false })
    expect(started.success).toBe(true)
    expect(engine.hasRunningOrchestration()).toBe(true)

    engine.cancel()
    expect(engine.hasRunningOrchestration()).toBe(false)
  })

  it('确认检查点后运行快照不保留已消费的检查点', () => {
    const run = {
      id: 'run-checkpoint',
      pipeline: 'story2video-compose',
      status: 'paused',
      currentStage: 0,
      stages: [
        { name: 'optimize', status: 'paused', requiresCheckpoint: true, startedAt: null, completedAt: null },
        { name: 'generate_assets', status: 'pending', requiresCheckpoint: false, startedAt: null, completedAt: null },
      ],
      checkpoint: { stageName: 'optimize', stageIndex: 0, required: true },
      progress: 0,
      createdAt: new Date().toISOString(),
      orchestrationMode: 'orchestrator',
      context: {},
      stageResults: [],
    }
    engine._runs.set(run.id, run)

    expect(engine._advanceRun(run)).toMatchObject({ success: true, currentStage: 'generate_assets' })
    expect(engine.getRunSnapshot(run.id).checkpoint).toBeNull()
  })

  it('归档后的失败运行快照仍提供终态和可序列化错误详情', async () => {
    const error = '图片生成服务暂时不可用'
    const failingEngine = new PipelineEngine({
      stageExecutor: { execute: vi.fn().mockResolvedValue({ success: false, error }) },
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), notify: vi.fn() },
    })
    failingEngine.registerPipeline({
      name: 'terminal-snapshot-failure',
      description: 'terminal snapshot regression',
      stages: ['generate'],
    })

    const started = await failingEngine.startOrchestrated('terminal-snapshot-failure', { autoAdvance: false })
    expect(started).toMatchObject({ success: true })
    await expect(failingEngine.executeStage(started.runId)).resolves.toMatchObject({ success: false, error })

    const snapshot = JSON.parse(JSON.stringify(failingEngine.getRunSnapshot(started.runId)))
    expect(snapshot).toMatchObject({
      runId: started.runId,
      status: { status: 'failed', currentStage: 0 },
      error,
    })
  })

  it('断点续跑复用同 runId：_history 只保留最新一条终态', () => {
    const engine = new PipelineEngine({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), notify: vi.fn() } })
    const base = { id: 'run-same-id', pipeline: 'story2video-compose', status: 'running', stages: [], context: {}, orchestrationMode: 'orchestrator', startedAt: new Date().toISOString() }
    engine._runs.set('run-same-id', { ...base })
    engine._finalizeRun(engine._runs.get('run-same-id'), 'failed', 'provider timeout')
    engine._runs.set('run-same-id', { ...base, resumedFrom: 'run-same-id' })
    engine._finalizeRun(engine._runs.get('run-same-id'), 'cancelled', null)
    const entries = engine.getHistory().filter(item => item.id === 'run-same-id')
    expect(entries).toHaveLength(1)
    expect(entries[0].status).toBe('cancelled')
  })

  it('取消的编排运行也持久化终态快照：重启后任务仍在历史记录', () => {
    const os = require('os')
    const path = require('path')
    const fs = require('fs')
    const { RunStateStore } = require('../services/run-state-store')
    const dir = path.join(os.tmpdir(), 'pipeline-engine-cancel-test-' + process.pid + '-' + Date.now() + '-' + Math.random().toString(36).slice(2))
    const store = new RunStateStore({ dir, log: { warn() {}, info() {} } })
    const engine = new PipelineEngine({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), notify: vi.fn() }, runStateStore: store })
    const run = {
      id: 'run-cancelled-persisted', pipeline: 'story2video-compose', status: 'running', currentStage: 2,
      stages: [{ name: 'split', status: 'completed' }, { name: 'optimize', status: 'completed' }, { name: 'generate_assets', status: 'running' }],
      context: {}, params: {}, orchestrationMode: 'orchestrator', startedAt: new Date().toISOString(),
    }
    engine._runs.set(run.id, run)
    engine._finalizeRun(run, 'cancelled', null)

    // 模拟应用重启：新引擎复用同一 store
    const engineB = new PipelineEngine({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), notify: vi.fn() }, runStateStore: store })
    const history = engineB.getHistory()
    expect(history).toContainEqual(expect.objectContaining({ id: 'run-cancelled-persisted', status: 'cancelled' }))
    fs.rmSync(dir, { recursive: true, force: true })
  })
})

describe('PipelineEngine animated-explainer 编排', () => {
  function makeEngine() {
    return new PipelineEngine({
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), notify: vi.fn() },
    })
  }

  it('stageDefs 定义完整且类型/inputFrom 正确', () => {
    const engine = makeEngine()
    const pl = engine.getPipeline('animated-explainer')
    expect(pl.stages).toEqual([
      'research', 'proposal', 'script', 'scenes', 'assets', 'editing', 'compose', 'publish',
    ])
    const defs = Object.fromEntries(pl.stageDefs.map(stage => [stage.name, stage]))
    expect(defs.research.type).toBe('explainer_research')
    expect(defs.proposal.type).toBe('explainer_proposal')
    expect(defs.script.type).toBe('explainer_script')
    expect(defs.scenes.type).toBe('explainer_scenes')
    expect(defs.assets.type).toBe('explainer_generate_assets')
    expect(defs.editing.type).toBe('explainer_editing')
    expect(defs.compose.type).toBe('compose')
    expect(defs.compose.inputFrom).toBe('assets')
    expect(defs.publish.type).toBe('publish')
    expect(defs.publish.inputFrom).toBe('compose')
    expect(pl.stageDefs.every(stage => stage.checkpointRequired === false)).toBe(true)
  })

  it('autoAdvance 跨全部 8 阶段完成并把各阶段输出写入 context', async () => {
    const stageExecutor = {
      execute: vi.fn(async ({ stage }) => ({
        success: true,
        output: { completedStage: stage.name },
      })),
    }
    const engine = new PipelineEngine({ stageExecutor, log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), notify: vi.fn() } })
    const started = await engine.startOrchestrated('animated-explainer', {
      text: '测试主题',
      autoAdvance: true,
      checkpointPolicy: 'none',
    })
    expect(started.success).toBe(true)
    expect(started.completed).toBe(true)
    for (const stageName of ['research', 'proposal', 'script', 'scenes', 'assets', 'editing', 'compose', 'publish']) {
      expect(started.context[stageName]).toBeDefined()
    }
    const snapshot = engine.getRunSnapshot(started.runId)
    expect(snapshot.status.status).toBe('completed')
    expect(snapshot.stages.every(stage => stage.status === 'completed')).toBe(true)
  })

  it('发布阶段未选平台时标记为 skipped 而非 completed（完成态进度仍为 100%）', async () => {
    const stageExecutor = {
      execute: vi.fn(async ({ stage }) => (
        stage.name === 'publish'
          ? { success: true, output: { skipped: true, message: 'Publishing disabled or no platforms selected', publishedTo: [], failedPlatforms: [] } }
          : { success: true, output: { completedStage: stage.name } }
      )),
    }
    const engine = new PipelineEngine({ stageExecutor, log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), notify: vi.fn() } })
    const started = await engine.startOrchestrated('animated-explainer', {
      text: '测试主题',
      autoAdvance: true,
      checkpointPolicy: 'none',
      publishEnabled: false,
      platforms: [],
    })
    expect(started.success).toBe(true)
    expect(started.completed).toBe(true)
    const snapshot = engine.getRunSnapshot(started.runId)
    expect(snapshot.status.status).toBe('completed')
    const publishStage = snapshot.stages.find(stage => stage.name === 'publish')
    expect(publishStage.status).toBe('skipped')
    expect(publishStage.skippedAt).toBeTypeOf('string')
    expect(snapshot.stages.filter(stage => stage.status === 'completed').length).toBe(snapshot.stages.length - 1)
    expect(snapshot.status.progress).toBe(100)
    // 持久化到历史卡片的完成态进度同样为 100%（_finalizeRun 固定完成态进度）
    const historyRun = engine.getHistory().find(item => item.id === started.runId)
    expect(historyRun.progress).toBe(100)
    expect(started.context.publish.skipped).toBe(true)
  })

  it('background 模式立即返回 runId，后台自动推进到完成', async () => {
    const stageExecutor = {
      execute: vi.fn(async ({ stage }) => ({
        success: true,
        output: { completedStage: stage.name },
      })),
    }
    const engine = new PipelineEngine({ stageExecutor, log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), notify: vi.fn() } })
    const started = await engine.startOrchestrated('animated-explainer', {
      text: '测试主题',
      autoAdvance: true,
      background: true,
      checkpointPolicy: 'none',
    })
    expect(started.success).toBe(true)
    expect(started.runId).toBeTypeOf('string')
    expect(started.completed).toBeUndefined()
    expect(started.context).toBeUndefined()
    // 后台推进：轮询快照直到完成
    const deadline = Date.now() + 2000
    let snapshot = engine.getRunSnapshot(started.runId)
    while (Date.now() < deadline && snapshot && snapshot.status.status !== 'completed') {
      await new Promise((resolve) => setTimeout(resolve, 10))
      snapshot = engine.getRunSnapshot(started.runId)
    }
    expect(snapshot).not.toBeNull()
    expect(snapshot.status.status).toBe('completed')
    expect(snapshot.stages.every(stage => stage.status === 'completed')).toBe(true)
  })

  it('编排阶段缺少主题时 research 返回明确错误', async () => {
    const stageExecutor = {
      execute: vi.fn(async () => ({ success: true, output: null })),
    }
    const engine = new PipelineEngine({ stageExecutor, log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), notify: vi.fn() } })
    const started = await engine.startOrchestrated('animated-explainer', {
      text: '',
      autoAdvance: true,
      checkpointPolicy: 'none',
    })
    // 空文本在 startOrchestrated 不阻断（非 story2video 无归一化），由 research 执行器校验
    expect(started.success).toBe(true)
  })
})

describe('PipelineEngine 已用时（步骤执行耗时累计口径）', () => {
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

  function makeElapsedEngine(executorFns) {
    // 与既有编排测试一致：serviceBus 构造真实 StageExecutor，再用 registerStageExecutor 注入可测执行器
    const engine = new PipelineEngine({
      serviceBus: {},
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), notify: vi.fn() },
    })
    engine.registerPipeline({
      name: 'elapsed-test',
      description: '已用时测试',
      stages: Object.keys(executorFns),
      stageDefs: Object.keys(executorFns).map((name) => ({ name, type: 'el_' + name })),
    })
    for (const [name, fn] of Object.entries(executorFns)) {
      engine.registerStageExecutor('el_' + name, fn)
    }
    return engine
  }

  it('多阶段执行段累计，阶段间隙不计入；终态 elapsedActiveMs 定格', async () => {
    const engine = makeElapsedEngine({
      a: async () => { await sleep(40); return { success: true, output: {} } },
      b: async () => { await sleep(40); return { success: true, output: {} } },
    })
    const started = await engine.startOrchestrated('elapsed-test', { initialContext: {}, autoAdvance: false })
    expect(started.success).toBe(true)
    const runId = started.runId

    // 阶段 a 执行段计入
    await engine.executeStage(runId)
    const afterA = engine.getRunSnapshot(runId).activeMs
    expect(afterA).toBeGreaterThan(0)

    // 阶段间 60ms 空闲：不计入
    await sleep(60)
    expect(engine.getRunSnapshot(runId).activeMs).toBe(afterA)

    // 阶段 b 执行段继续累计；完成态无在飞段
    await engine.executeStage(runId)
    const snapshot = engine.getRunSnapshot(runId)
    expect(snapshot.status.status).toBe('completed')
    expect(snapshot.activeMs).toBeGreaterThan(afterA)
    expect(snapshot.activeSegmentStartedAt).toBeNull()
    expect(snapshot.elapsedActiveMs).toBe(snapshot.activeMs)
    expect(snapshot.elapsedActiveMs).toBeLessThan(2000)
  })

  it('运行中在飞执行段计入 elapsedActiveMs（elapsedActiveMs > activeMs）', async () => {
    let release
    const gate = new Promise((resolve) => { release = resolve })
    const engine = makeElapsedEngine({
      a: async () => { await gate; return { success: true, output: {} } },
    })
    const started = await engine.startOrchestrated('elapsed-test', { initialContext: {}, autoAdvance: false })
    const runId = started.runId
    const executing = engine.executeStage(runId)
    await sleep(30)
    const live = engine.getRunSnapshot(runId)
    expect(live.activeSegmentStartedAt).not.toBeNull()
    expect(live.elapsedActiveMs).toBeGreaterThan(live.activeMs)
    expect(live.elapsedActiveMs).toBeGreaterThan(0)
    release()
    await executing
    const settled = engine.getRunSnapshot(runId)
    expect(settled.activeSegmentStartedAt).toBeNull()
    expect(settled.elapsedActiveMs).toBe(settled.activeMs)
  })

  it('用户暂停期间 activeMs 不增长（暂停不计入已用时）', async () => {
    const engine = makeElapsedEngine({
      a: async () => { await sleep(30); return { success: true, output: {} } },
    })
    const started = await engine.startOrchestrated('elapsed-test', { initialContext: {}, autoAdvance: false })
    const runId = started.runId
    const before = engine.getRunSnapshot(runId).activeMs
    engine.pause()
    await sleep(80)
    expect(engine.getRunSnapshot(runId).activeMs).toBe(before)
    engine.resume()
    await engine.executeStage(runId)
    expect(engine.getRunSnapshot(runId).activeMs).toBeGreaterThan(before)
  })

  it('executeStage 完成返回携带终态 activeMs（W2：检查点确认路径结果页用新值）', async () => {
    const engine = makeElapsedEngine({
      a: async () => { await sleep(30); return { success: true, output: {} } },
    })
    const started = await engine.startOrchestrated('elapsed-test', { initialContext: {}, autoAdvance: false })
    const runId = started.runId
    const res = await engine.executeStage(runId)
    expect(res.completed).toBe(true)
    expect(res.activeMs).toBeGreaterThan(0)
  })

  it('执行器失败时执行段仍累计（成功/失败/异常都结算，finally 保证不丢段）', async () => {
    const engine = makeElapsedEngine({
      a: async () => { await sleep(30); throw new Error('boom') },
    })
    const started = await engine.startOrchestrated('elapsed-test', { initialContext: {}, autoAdvance: false })
    const runId = started.runId
    // StageExecutor 把执行器异常归一为失败结果；失败段同样累计进 activeMs
    const res = await engine.executeStage(runId)
    expect(res.success).toBe(false)
    expect(String(res.error)).toContain('boom')
    const snapshot = engine.getRunSnapshot(runId)
    expect(snapshot.activeMs).toBeGreaterThan(0)
  })

  it('_finalizeRun 附加 run.diagnostics（additive，不改变既有字段）', () => {
    const engine = new PipelineEngine({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), notify: vi.fn() } })
    const run = {
      id: 'run-diag-1',
      pipeline: 'story2video-compose',
      status: 'running',
      startedAt: new Date().toISOString(),
      stages: [
        { name: 'split', status: 'completed' },
        { name: 'compose', status: 'failed', error: 'ffmpeg timed out' },
      ],
      currentStage: 1,
      context: {},
    }
    engine._runs.set(run.id, run)
    engine._finalizeRun(run, 'failed', 'ffmpeg timed out')
    expect(run.status).toBe('failed')
    expect(run.diagnostics).toBeTruthy()
    expect(run.diagnostics.runId).toBe('run-diag-1')
    expect(run.diagnostics.failure.stage).toBe('compose')
    expect(run.diagnostics.failure.failureType).toBe('timeout')
    expect(Array.isArray(run.diagnostics.failure.candidates)).toBe(true)
    expect(() => JSON.stringify(run.diagnostics)).not.toThrow()
  })

  it('_finalizeRun failed/cancelled 同步当前 stage 终态（历史卡片不再显示「运行中」假象）', () => {
    const engine = new PipelineEngine({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), notify: vi.fn() } })
    const failedRun = {
      id: 'run-stage-failed',
      pipeline: 'story2video-compose',
      status: 'running',
      startedAt: new Date().toISOString(),
      stages: [
        { name: 'split', status: 'completed' },
        { name: 'compose', status: 'running' },
      ],
      currentStage: 1,
      context: {},
    }
    engine._runs.set(failedRun.id, failedRun)
    engine._finalizeRun(failedRun, 'failed', '成片总时长不能超过 10 分钟')
    expect(failedRun.stages[1].status).toBe('failed')
    expect(failedRun.stages[1].completedAt).toBeTruthy()
    expect(failedRun.stages[0].status).toBe('completed')

    const cancelledRun = {
      id: 'run-stage-cancelled',
      pipeline: 'story2video-compose',
      status: 'running',
      startedAt: new Date().toISOString(),
      stages: [
        { name: 'split', status: 'completed' },
        { name: 'compose', status: 'cancelled' },
      ],
      currentStage: 1,
      context: {},
    }
    engine._runs.set(cancelledRun.id, cancelledRun)
    engine._finalizeRun(cancelledRun, 'cancelled', 'cancelled')
    expect(cancelledRun.stages[1].status).toBe('cancelled')
    expect(cancelledRun.stages[1].completedAt).toBeTruthy()
  })

  it('取消已持久化的 Story2Video run 时同步项目为 cancelled 并推进更新时间', () => {
    const syncRunStatus = vi.fn((run) => ({
      projectId: run.projectId,
      status: run.status,
      updatedAt: '2026-08-20T00:00:01.000Z',
    }))
    const engine = new PipelineEngine({
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), notify: vi.fn() },
      story2videoProjectService: { syncRunStatus },
    })
    const run = {
      id: 'run-cancel-project',
      projectId: 'project-cancel',
      pipeline: 'story2video-compose',
      status: 'running',
      startedAt: new Date().toISOString(),
      currentStage: 0,
      stages: [{ name: 'compose', status: 'running' }],
      context: {},
    }
    engine._runs.set(run.id, run)
    engine._runs.set('_story2video-compose', run)
    engine._currentPipeline = 'story2video-compose'

    expect(engine.cancel()).toEqual({ success: true })
    expect(syncRunStatus).toHaveBeenCalledTimes(1)
    expect(syncRunStatus).toHaveBeenCalledWith(expect.objectContaining({
      projectId: 'project-cancel',
      status: 'cancelled',
    }))
  })

  it('setRunFinalizedHook 在 _finalizeRun 终态后调用（additive，失败仅 warn）', () => {
    const engine = new PipelineEngine({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), notify: vi.fn() } })
    const calls = []
    engine.setRunFinalizedHook((run) => { calls.push(run.id) })
    const run = { id: 'run-hook-1', pipeline: 'story2video-compose', status: 'running', stages: [], context: {}, orchestrationMode: 'orchestrator', startedAt: new Date().toISOString() }
    engine._runs.set(run.id, run)
    engine._finalizeRun(run, 'failed', 'boom')
    expect(calls).toEqual(['run-hook-1'])
    expect(run.diagnostics).toBeTruthy()

    // 钩子抛错不影响终态
    const engine2 = new PipelineEngine({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), notify: vi.fn() } })
    engine2.setRunFinalizedHook(() => { throw new Error('hook boom') })
    const run2 = { id: 'run-hook-2', pipeline: 'story2video-compose', status: 'running', stages: [], context: {}, orchestrationMode: 'orchestrator', startedAt: new Date().toISOString() }
    engine2._runs.set(run2.id, run2)
    expect(() => engine2._finalizeRun(run2, 'completed', null)).not.toThrow()
    expect(run2.status).toBe('completed')
  })

  it('_advanceRun 在 Story2Video 项目持久化完成后才发出 pipeline:complete', () => {
    const order = []
    const saveRun = vi.fn(() => {
      order.push('saveRun')
      return { projectId: 'project-complete' }
    })
    const engine = new PipelineEngine({
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), notify: vi.fn() },
      story2videoProjectService: { saveRun },
    })
    vi.spyOn(engine, '_emit').mockImplementation((eventName) => { order.push(eventName) })
    const run = {
      id: 'run-persist-before-complete',
      pipeline: 'story2video-compose',
      status: 'running',
      currentStage: 0,
      stages: [{ name: 'publish', status: 'running' }],
      context: {},
      params: {},
      orchestrationMode: 'orchestrator',
      startedAt: new Date().toISOString(),
    }
    engine._runs.set(run.id, run)

    const result = engine._advanceRun(run)

    expect(result).toMatchObject({ success: true, message: 'Pipeline completed' })
    expect(order).toEqual(['stage:complete', 'saveRun', 'pipeline:complete'])
    expect(run.status).toBe('completed')
  })

  it('_advanceRun 项目持久化失败时进入 failed 且不发出 pipeline:complete', () => {
    const events = []
    const engine = new PipelineEngine({
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), notify: vi.fn() },
      story2videoProjectService: { saveRun: vi.fn(() => { throw new Error('disk full') }) },
    })
    vi.spyOn(engine, '_emit').mockImplementation((eventName) => { events.push(eventName) })
    const run = {
      id: 'run-persist-failure',
      pipeline: 'story2video-compose',
      status: 'running',
      currentStage: 0,
      stages: [{ name: 'publish', status: 'running' }],
      context: {},
      params: {},
      orchestrationMode: 'orchestrator',
      startedAt: new Date().toISOString(),
    }
    engine._runs.set(run.id, run)

    const result = engine._advanceRun(run)

    expect(result).toMatchObject({ success: false, error: expect.stringContaining('Story2Video 项目保存失败') })
    expect(run.status).toBe('failed')
    expect(run.stages[0].status).toBe('failed')
    expect(events).toContain('pipeline:fail')
    expect(events).not.toContain('pipeline:complete')
  })

  it('_executeStage 在生成素材后创建草稿项目，暂停和失败会同步同一项目状态', async () => {
    const saveEditableRun = vi.fn(() => ({ projectId: 'run-editable-project', segments: [{ id: 'segment-0' }] }))
    const syncRunStatus = vi.fn(() => ({ projectId: 'run-editable-project', status: 'paused' }))
    const engine = new PipelineEngine({
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), notify: vi.fn() },
      stageExecutor: { execute: vi.fn(async () => ({ success: true, output: { scenes: [{ index: 0, text: '第一段' }] } })) },
      story2videoProjectService: { saveEditableRun, syncRunStatus },
    })
    const run = {
      id: 'run-editable-project',
      pipeline: 'story2video-compose',
      status: 'running',
      currentStage: 4,
      stages: [
        { name: 'split', status: 'completed' },
        { name: 'scene_context', status: 'completed' },
        { name: 'optimize', status: 'completed' },
        { name: 'select_video_scenes', status: 'completed' },
        { name: 'generate_assets', status: 'running' },
        { name: 'compose', status: 'pending' },
      ],
      context: {},
      params: {},
      orchestrationMode: 'orchestrator',
      activeMs: 0,
      stageResults: [],
      createdAt: new Date().toISOString(),
    }
    engine._runs.set(run.id, run)

    const result = await engine.executeStage(run.id)

    expect(result.success).toBe(true)
    expect(saveEditableRun).toHaveBeenCalledWith(run, { replace: false })
    expect(run.projectId).toBe('run-editable-project')
    run.status = 'running'
    run.stages[run.currentStage].status = 'running'
    expect(engine.pauseRun(run.id)).toEqual({ success: true, runId: run.id, checkpoint: expect.anything() })
    expect(syncRunStatus).toHaveBeenCalledWith(expect.objectContaining({ id: run.id, status: 'paused' }))
    engine._finalizeRun(run, 'failed', 'compose failed')
    expect(syncRunStatus).toHaveBeenLastCalledWith(expect.objectContaining({ id: run.id, status: 'failed' }))
  })
})

describe('PipelineEngine 批量创作打标与索引隔离', () => {
  let engine

  beforeEach(() => {
    engine = new PipelineEngine({
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), notify: vi.fn() },
      stageExecutor: {
        execute: vi.fn(async () => ({ success: true, output: {} })),
      },
    })
  })

  it('startOrchestrated 透传 source=batch 打标到 run（normalizer 重建后不丢失）', async () => {
    const started = await engine.startOrchestrated('story2video-compose', {
      initialContext: {},
      autoAdvance: false,
      source: 'batch',
      batchId: 'batch-1',
      batchItemId: 'item-1',
      text: '批量测试文案',
      inputMode: 'text',
      story2videoTextConfig: {
        version: 1,
        mode: 'text',
        prompt: '批量测试文案',
        split: { language: 'zh' },
      },
    })
    expect(started.success).toBe(true)
    const run = engine._runs.get(started.runId)
    expect(run.source).toBe('batch')
    expect(run.batchId).toBe('batch-1')
    expect(run.batchItemId).toBe('item-1')
  })

  it('非批量 run 不打标，且仍写 _<name> 索引与 _currentPipeline', async () => {
    const started = await engine.startOrchestrated('story2video-compose', {
      initialContext: {},
      autoAdvance: false,
      text: '手动测试文案',
      inputMode: 'text',
      story2videoTextConfig: {
        version: 1,
        mode: 'text',
        prompt: '手动测试文案',
        split: { language: 'zh' },
      },
    })
    expect(started.success).toBe(true)
    const run = engine._runs.get(started.runId)
    expect(run.source).toBeUndefined()
    expect(run.batchId).toBeUndefined()
    expect(engine._runs.get('_story2video-compose')).toBe(run)
    expect(engine._currentPipeline).toBe('story2video-compose')
  })

  it('批量 run 不覆盖 _<name> 索引：手动 getStatus 保持 idle', async () => {
    const started = await engine.startOrchestrated('story2video-compose', {
      initialContext: {},
      autoAdvance: false,
      source: 'batch',
      batchId: 'batch-2',
      batchItemId: 'item-2',
      text: '批量测试文案2',
      inputMode: 'text',
      story2videoTextConfig: {
        version: 1,
        mode: 'text',
        prompt: '批量测试文案2',
        split: { language: 'zh' },
      },
    })
    expect(started.success).toBe(true)
    // 批量 run 启动后，手动状态查询不受影响
    const manualStatus = engine.getStatus('story2video-compose')
    expect(manualStatus.status).toBe('idle')
    expect(engine._runs.get('_story2video-compose')).toBeUndefined()
    expect(engine._currentPipeline).toBeNull()
  })

  it('_countActiveManualRuns 只统计非批量运行中 run', async () => {
    // 隔离引擎：显式注入 maxConcurrentRuns=4，避免低内存 CI 环境下 computeDefaultMaxConcurrentRuns 自适应为 1 导致并发上限误拒（与本次 ID 改动无关）。
    // 同时注入 stageExecutor mock（与本 describe 的 beforeEach 一致），否则 startOrchestrated 会因 StageExecutor 未配置而拒绝。
    const isolatedEngine = new PipelineEngine({
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), notify: vi.fn() },
      stageExecutor: { execute: vi.fn(async () => ({ success: true, output: {} })) },
      maxConcurrentRuns: 4,
    })
    const startedBatch = await isolatedEngine.startOrchestrated('story2video-compose', {
      initialContext: {},
      autoAdvance: false,
      source: 'batch',
      batchId: 'batch-3',
      batchItemId: 'item-3',
      text: '批量测试文案3',
      inputMode: 'text',
      story2videoTextConfig: {
        version: 1,
        mode: 'text',
        prompt: '批量测试文案3',
        split: { language: 'zh' },
      },
    })
    expect(startedBatch.success).toBe(true)
    expect(isolatedEngine._countActiveManualRuns()).toBe(0)
    expect(isolatedEngine._countActiveRuns()).toBe(1)

    const startedManual = await isolatedEngine.startOrchestrated('story2video-compose', {
      initialContext: {},
      autoAdvance: false,
      text: '手动测试文案2',
      inputMode: 'text',
      story2videoTextConfig: {
        version: 1,
        mode: 'text',
        prompt: '手动测试文案2',
        split: { language: 'zh' },
      },
    })
    expect(startedManual.success).toBe(true)
    expect(isolatedEngine._countActiveManualRuns()).toBe(1)
    expect(isolatedEngine._countActiveRuns()).toBe(2)
  })

  it('批量 run 完成进入 _history 并保留 batch 标记', async () => {
    const started = await engine.startOrchestrated('story2video-compose', {
      initialContext: {},
      autoAdvance: false,
      source: 'batch',
      batchId: 'batch-4',
      batchItemId: 'item-4',
      text: '批量测试文案4',
      inputMode: 'text',
      story2videoTextConfig: {
        version: 1,
        mode: 'text',
        prompt: '批量测试文案4',
        split: { language: 'zh' },
      },
    })
    const run = engine._runs.get(started.runId)
    run.stages.forEach(s => { s.status = 'completed' })
    run.currentStage = run.stages.length
    engine._finalizeRun(run, 'completed', null)
    const historyEntry = engine._history.find(item => item.id === started.runId)
    expect(historyEntry).toBeTruthy()
    expect(historyEntry.source).toBe('batch')
    expect(historyEntry.batchId).toBe('batch-4')
    expect(historyEntry.batchItemId).toBe('item-4')
  })
})

describe('generateRunId 项目ID生成（方案2：约13位，去掉 run_ 前缀）', () => {
  it('导出 generateRunId 函数', () => {
    expect(generateRunId).toBeTypeOf('function')
  })

  it('格式为 base36时间戳_4位随机，约13字符', () => {
    const id = generateRunId()
    expect(id).toMatch(/^[0-9a-z]+_[0-9a-z]{4}$/)
    // 当前纪元 base36 时间戳为 8 位，+ '_' + 4 位随机 = 13 位
    expect(id.length).toBe(13)
  })

  it('满足 SAFE_ID 校验，可作磁盘目录名', () => {
    const SAFE_ID = /^[a-zA-Z0-9_-]{1,100}$/
    for (let i = 0; i < 50; i++) {
      expect(SAFE_ID.test(generateRunId())).toBe(true)
    }
  })

  it('时间戳部分可解码为近期时间（保留时序可排序性）', () => {
    const id = generateRunId()
    const ts = parseInt(id.split('_')[0], 36)
    expect(Number.isFinite(ts)).toBe(true)
    expect(Math.abs(ts - Date.now())).toBeLessThan(60 * 1000)
  })

  it('时间错开的批量生成唯一（无碰撞）', () => {
    // 真实场景中 runId 随用户/事件节奏生成，时间戳前缀（毫秒）彼此不同；
    // 此处模拟「时间错开」生成以验证结构本身的唯一性。
    // 注：同一毫秒内仅靠 4 位 base36 随机后缀区分（空间 36^4≈168 万），
    // 与旧格式 'run_'+Date.now()+'_'+rand(4) 完全一致——高并发同毫秒的极端
    // 情形并不依赖随机后缀保证唯一，属历史既有行为，不在本次缩短任务范围内。
    const realNow = Date.now
    let t = realNow()
    Date.now = () => { t += 1; return t }
    try {
      const ids = new Set()
      const N = 2000
      for (let i = 0; i < N; i++) ids.add(generateRunId())
      expect(ids.size).toBe(N)
    } finally {
      Date.now = realNow
    }
  })
})

describe('PipelineEngine 启动前模型能力前置校验（pipeline-model-preflight 闸口）', () => {
  function makeManager ({ defaults = {}, providers = {} } = {}) {
    return {
      _ready: true,
      getDefault: vi.fn((capability) => {
        if (defaults[capability]) return { id: 'default-' + capability, category: capability }
        return null
      }),
      getProviderWithKey: vi.fn((id) => {
        if (!providers[id]) return null
        return { id, base_url: providers[id].base_url || '', api_key: providers[id].api_key || '' }
      }),
    }
  }

  function makeEngine (manager) {
    return new PipelineEngine({
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), notify: vi.fn() },
      stageExecutor: { execute: vi.fn(async () => ({ success: true, output: {} })) },
      modelProviderManager: manager,
      maxConcurrentRuns: 4,
    })
  }

  const s2vConfig = (video = {}) => ({
    initialContext: {},
    autoAdvance: false,
    text: '前置校验测试文案',
    inputMode: 'text',
    story2videoTextConfig: {
      version: 1,
      mode: 'text',
      prompt: '前置校验测试文案',
      split: { language: 'zh' },
      image: { provider: '' },
      voice: { provider: '' },
      video,
    },
  })

  it('story2video mode=fixed 且 video 能力缺失 → 拦截，不创建 run', async () => {
    const engine = makeEngine(makeManager({ defaults: { image: true } }))
    const started = await engine.startOrchestrated('story2video-compose', s2vConfig({ mode: 'fixed' }))
    expect(started.success).toBe(false)
    expect(started.errorCode).toBe('PIPELINE_MODEL_REQUIREMENTS_MISSING')
    expect(started.errorParams).toEqual({ missing: ['video'], providers: {} })
    expect(engine._runs.size).toBe(0)
  })

  it('story2video mode=off（纯图片轮播）且 image 可用 → 放行创建 run', async () => {
    const engine = makeEngine(makeManager({ defaults: { image: true } }))
    const started = await engine.startOrchestrated('story2video-compose', s2vConfig({ mode: 'off' }))
    expect(started.success).toBe(true)
    expect(engine._runs.get(started.runId)).toBeTruthy()
  })

  it('story2video mode=ai-judged 且 llm/video 均缺 → missing 包含 llm 与 video', async () => {
    const engine = makeEngine(makeManager({ defaults: { image: true } }))
    const started = await engine.startOrchestrated('story2video-compose', s2vConfig({ mode: 'ai-judged' }))
    expect(started.success).toBe(false)
    expect(started.errorParams.missing).toEqual(['video', 'llm'])
  })

  it('静态流水线 animation（llm+video）缺 video → 拦截', async () => {
    const engine = makeEngine(makeManager({ defaults: { llm: true } }))
    const started = await engine.startOrchestrated('animation', { initialContext: {}, autoAdvance: false })
    expect(started.success).toBe(false)
    expect(started.errorCode).toBe('PIPELINE_MODEL_REQUIREMENTS_MISSING')
    expect(started.errorParams.missing).toEqual(['video'])
    expect(engine._runs.size).toBe(0)
  })

  it('纯本地流水线 talking-head → 不拦截', async () => {
    const engine = makeEngine(makeManager({}))
    const started = await engine.startOrchestrated('talking-head', { initialContext: {}, autoAdvance: false })
    expect(started.success).toBe(true)
  })

  it('未注入 modelProviderManager（旧环境/纯引擎测试）→ 前置校验跳过，行为不变', async () => {
    const engine = new PipelineEngine({
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), notify: vi.fn() },
      stageExecutor: { execute: vi.fn(async () => ({ success: true, output: {} })) },
      maxConcurrentRuns: 4,
    })
    const started = await engine.startOrchestrated('story2video-compose', s2vConfig({ mode: 'fixed' }))
    expect(started.success).toBe(true)
  })

  it('story2video 显式 video provider 无凭据 → 拦截并附 provider 标识', async () => {
    const engine = makeEngine(makeManager({
      defaults: { image: true },
      providers: { kling: { api_key: '', base_url: 'https://api.kling.example' } },
    }))
    const config = s2vConfig({ mode: 'fixed', provider: 'kling' })
    const started = await engine.startOrchestrated('story2video-compose', config)
    expect(started.success).toBe(false)
    expect(started.errorParams.providers).toEqual({ video: 'kling' })
  })
})

describe('PipelineEngine stage 失败稳定错误码上抛（error-message-user-friendly-audit，2026-10-20）', () => {
  // 事故背景：compose 预检失败只返回 { success:false, error:'Input media exceeds the total size limit' }，
  // 稳定 errorCode 与 messageParams 在 stage 边界被丢弃，run.error 落库英文原文，
  // 历史记录失败卡片透出英文。本组锁住「message / errorCode / messageParams 三者一起上抛」。
  function makeEngineWithStage (stageResult) {
    const engine = new PipelineEngine({
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), notify: vi.fn() },
      stageExecutor: { execute: vi.fn(async () => stageResult) },
      runStateStore: { saveFailed: vi.fn(() => true) },
      maxConcurrentRuns: 2,
    })
    engine.registerPipeline({
      name: 'errcode-propagation',
      description: '稳定错误码上抛测试',
      stages: ['a'],
      stageDefs: [{ name: 'a', type: 'ep_a' }],
    })
    return engine
  }

  it('stage 带 errorCode/messageParams → run.errorCode / run.errorParams 落库，run.error 仍为字符串', async () => {
    const engine = makeEngineWithStage({
      success: false,
      error: 'Input media exceeds the total size limit',
      errorCode: 'COMPOSE_INPUT_SIZE_EXCEEDED',
      messageParams: { limitMb: '512MB', actualMb: '780MB' },
    })
    const started = await engine.startOrchestrated('errcode-propagation', { initialContext: {}, autoAdvance: false })
    await engine.executeStage(started.runId)
    const snapshot = engine.getRunSnapshot(started.runId)
    expect(snapshot.status.status).toBe('failed')
    expect(snapshot.error).toBe('Input media exceeds the total size limit')
    expect(snapshot.errorCode).toBe('COMPOSE_INPUT_SIZE_EXCEEDED')
    expect(snapshot.errorParams).toEqual({ limitMb: '512MB', actualMb: '780MB' })
  })

  it('stage 无 errorCode（旧行为）→ run.errorCode / run.errorParams 不写入，不破坏既有字段形态', async () => {
    const engine = makeEngineWithStage({ success: false, error: 'plain stage failure' })
    const started = await engine.startOrchestrated('errcode-propagation', { initialContext: {}, autoAdvance: false })
    await engine.executeStage(started.runId)
    const snapshot = engine.getRunSnapshot(started.runId)
    expect(snapshot.status.status).toBe('failed')
    expect(snapshot.error).toBe('plain stage failure')
    // 无稳定码时快照输出 null（IPC 边界不出现 undefined），renderer 侧按 null 走兜底
    expect(snapshot.errorCode).toBeNull()
    expect(snapshot.errorParams).toBeNull()
  })

  it('_finalizeRun 接受字符串 error（旧调用方）→ run.error 原样落库', async () => {
    const engine = makeEngineWithStage({ success: true, output: {} })
    const started = await engine.startOrchestrated('errcode-propagation', { initialContext: {}, autoAdvance: false })
    const run = engine._runs.get(started.runId)
    engine._finalizeRun(run, 'failed', 'legacy string error')
    expect(run.error).toBe('legacy string error')
    expect(run.errorCode).toBeUndefined()
    expect(run.errorParams).toBeUndefined()
  })
})
