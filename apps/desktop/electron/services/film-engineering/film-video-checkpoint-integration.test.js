// @ts-check
'use strict'
/**
 * film-engineering 成本确认 checkpoint 集成测试（specs: 成本确认 checkpoint / 视频生成）
 *
 * 合同：流水线从任何路径恢复（含应用重启后 resumeOrchestration）SHALL 重新经过成本确认点，
 * 不存在绕过路径；advance（确认）前零 provider 调用。
 *
 * 保真度：仅 mock manager.callAdapter（provider 边界）；下载走本机临时 HTTP 服务器的
 * 真实 downloadToFile 路径（禁 mock 终函数），断言落盘字节与源一致。
 * 跨实例重启：engine1 停闸 → 共享真实 RunStateStore（临时目录）→ engine2 resumeOrchestration。
 */
const fs = require('fs')
const os = require('os')
const path = require('path')
const http = require('http')
const { PipelineEngine } = require('../pipeline-engine')
const { RunStateStore } = require('../run-state-store')
const { registerFilmVideoStages } = require('./video-gen')

const FAKE_MP4 = Buffer.from('FAKE-MP4-CONTENT-0123456789'.repeat(64))

/** 启动本机临时假 mp4 下载源（真实 http:// 路径） */
function startFakeMp4Server() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      if (req.method === 'GET' && /^\/v\/\d+\.mp4$/.test(req.url)) {
        res.writeHead(200, { 'Content-Type': 'video/mp4', 'Content-Length': String(FAKE_MP4.length) })
        res.end(FAKE_MP4)
      } else {
        res.writeHead(404)
        res.end()
      }
    })
    server.listen(0, '127.0.0.1', () => resolve(server))
  })
}

/**
 * 构造编排引擎：前四阶段 + render 用桩快速通过，generate_videos 用真实 film executor；
 * callAdapter 为唯一 provider mock 点，下载/轮询注入真实实现（sleep 零等待）。
 */
function makeOrchestrator({ port, calls, storeDir }) {
  const orchestr = new PipelineEngine({
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    runStateStore: new RunStateStore({ dir: storeDir, log: { info() {}, warn() {} } }),
  })
  orchestr.stageExecutor = {
    _customExecutors: new Map(),
    register(type, fn) { this._customExecutors.set(type, fn) },
    async execute({ runId, stage, params, context, onProgress }) {
      const fn = this._customExecutors.get(stage.type)
      if (!fn) return { success: false, error: 'no executor for ' + stage.type }
      // 测试 seam：_testSleep 零等待；_testDownload 不注入 → 真实 downloadToFile（http:// 本地源）
      return fn({ runId, stage, params, context, onProgress, _testSleep: async () => {} })
    },
  }
  for (const t of ['film_load_template', 'film_adapt_script', 'film_select_shots', 'film_export_prompts']) {
    orchestr.registerStageExecutor(t, async () => ({ success: true, output: { ok: true } }))
  }
  orchestr.registerStageExecutor('film_render', async () => ({ success: true, output: { final: true } }))
  const manager = {
    getDefault: (type) => (type === 'video' ? { id: 'mv', config: { models: ['m1'], capability_models: { video: 'm1' } } } : null),
    getProvider: () => ({ id: 'mv' }),
    callAdapter: async (p, m, payload) => {
      calls.push({ m, payload })
      if (m === 'generateVideo') return { code: 0, data: { taskId: 't' + calls.length } }
      const index = String(payload && (payload.videoId || payload.taskId) || '').replace('t', '') || '0'
      return { code: 0, data: { status: 'completed', videoUrl: `http://127.0.0.1:${port}/v/${index}.mp4` } }
    },
  }
  orchestr.aiGenerator = { _modelProviderManager: manager }
  registerFilmVideoStages(orchestr)
  return orchestr
}

function makeShots() {
  return [
    { shotId: 's-0', title: '开场', prompt: 'p0 <<<aaaaaaaa-1111-4111-8111-111111111111>>>' },
    { shotId: 's-1', title: '收尾', prompt: 'p1' },
  ]
}

async function startUntilGate(orchestr) {
  return orchestr.startOrchestrated('film-engineering', {
    autoAdvance: true,
    initialContext: { selectedShots: makeShots() },
    aspect: '16x9',
    seconds: 5,
  })
}

describe('film-engineering 成本确认 checkpoint 集成（advance 前零调用 / 恢复重过闸）', () => {
  let server, port, calls, storeDir, runDirs

  beforeAll(async () => {
    server = await startFakeMp4Server()
    port = server.address().port
    storeDir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'film-store-')), 'run-state')
  })

  afterAll(async () => {
    await new Promise((r) => server.close(r))
  })

  beforeEach(() => {
    calls = []
    runDirs = []
  })

  afterEach(() => {
    for (const dir of runDirs) {
      try { fs.rmSync(dir, { recursive: true, force: true }) } catch { /* 清理失败不影响断言 */ }
    }
  })

  it('停闸零调用；确认后逐镜真实 HTTP 下载落盘且字节与源一致', async () => {
    const orchestr = makeOrchestrator({ port, calls, storeDir })
    const started = await startUntilGate(orchestr)
    expect(started.success).toBe(true)
    expect(started.paused).toBe(true)
    // advance（确认）前：任何路径零 provider 调用
    expect(calls.length).toBe(0)
    const runDir = path.join(os.tmpdir(), 'film-engineering', started.runId)
    runDirs.push(runDir)

    const done = await orchestr.confirmStageGate(started.runId, {
      cost_confirmation: { confirmed: true, confirmedAt: new Date().toISOString() },
    })
    expect(done.success).toBe(true)
    expect(calls.filter((c) => c.m === 'generateVideo').length).toBe(2)
    for (const name of ['shot_000.mp4', 'shot_001.mp4']) {
      const file = path.join(runDir, name)
      expect(fs.existsSync(file)).toBe(true)
      expect(fs.readFileSync(file).equals(FAKE_MP4)).toBe(true)
    }
    expect(orchestr.getRunSnapshot(started.runId).status.status).toBe('completed')
  })

  it('paused 快照跨引擎实例重启：恢复仍停在成本闸（paused、零调用），确认后才生成', async () => {
    const engine1 = makeOrchestrator({ port, calls, storeDir })
    const started = await startUntilGate(engine1)
    expect(started.paused).toBe(true)
    expect(calls.length).toBe(0)
    const runDir = path.join(os.tmpdir(), 'film-engineering', started.runId)
    runDirs.push(runDir)

    // 模拟应用重启：engine1 丢弃，engine2 只共享持久化快照目录
    const engine2 = makeOrchestrator({ port, calls, storeDir })
    const resumed = await engine2.resumeOrchestration(started.runId)
    expect(resumed.success).toBe(true)
    expect(resumed.paused).toBe(true)
    expect(calls.length).toBe(0)
    const snap = engine2.getRunSnapshot(started.runId)
    expect(snap.status.status).toBe('paused')
    expect(snap.checkpoint).toBeTruthy()
    expect(snap.checkpoint.type).toBe('cost_confirm')
    // 等待态载荷在恢复后仍可达前端（逐镜确认卡）
    const costCheck = snap.checkpoint.context && snap.checkpoint.context.generate_videos && snap.checkpoint.context.generate_videos.costCheck
    expect(costCheck).toBeTruthy()
    expect(costCheck.shots.map((s) => s.shotId)).toEqual(['s-0', 's-1'])

    const done = await engine2.confirmStageGate(started.runId, {
      cost_confirmation: { confirmed: true, confirmedAt: new Date().toISOString() },
    })
    expect(done.success).toBe(true)
    expect(calls.filter((c) => c.m === 'generateVideo').length).toBe(2)
    expect(fs.readFileSync(path.join(runDir, 'shot_000.mp4')).equals(FAKE_MP4)).toBe(true)
    expect(engine2.getRunSnapshot(started.runId).status.status).toBe('completed')
  })

  it('崩溃兜底（running 快照）恢复：重入阶段再次停在成本闸，不绕过', async () => {
    // 模拟阶段执行中强杀：磁盘快照停留在阶段执行前落盘的 running 快照（无 checkpoint、未确认），
    // 恢复路径从当前阶段重新执行 → 未确认的 context 必须先重过成本闸，不得发生 provider 调用。
    const store = new RunStateStore({ dir: storeDir, log: { info() {}, warn() {} } })
    const now = new Date().toISOString()
    const crashedRunId = 'film-crashed-' + Date.now()
    expect(store.saveRunning({
      id: crashedRunId,
      pipeline: 'film-engineering',
      orchestrationMode: 'orchestrator',
      currentStage: 4,
      stages: [
        { name: 'load_template', type: 'film_load_template', status: 'completed', startedAt: now, completedAt: now },
        { name: 'adapt_script', type: 'film_adapt_script', status: 'completed', startedAt: now, completedAt: now },
        { name: 'select_shots', type: 'film_select_shots', status: 'completed', startedAt: now, completedAt: now },
        { name: 'export_prompts', type: 'film_export_prompts', status: 'completed', startedAt: now, completedAt: now },
        { name: 'generate_videos', type: 'film_generate_videos', status: 'running', startedAt: now, completedAt: null },
        { name: 'render', type: 'film_render', status: 'pending', startedAt: null, completedAt: null },
      ],
      // 前四阶段输出已落 context；cost_confirmation 缺失（崩溃发生在确认之前）
      context: { selectedShots: makeShots(), load_template: { ok: true } },
      params: { aspect: '16x9', seconds: 5 },
      createdAt: now,
    })).toBe(true)

    const engine2 = makeOrchestrator({ port, calls, storeDir })
    const resumed = await engine2.resumeOrchestration(crashedRunId)
    expect(resumed.success).toBe(true)
    // 阶段级重执行会真实走到成本闸（异步推进）：轮询确认最终停在 paused 且零 provider 调用
    let snap
    for (let i = 0; i < 50; i++) {
      snap = engine2.getRunSnapshot(crashedRunId)
      if (snap && snap.status.status === 'paused') break
      await new Promise((r) => setTimeout(r, 20))
    }
    expect(calls.length).toBe(0)
    expect(snap.status.status).toBe('paused')
    expect(snap.currentStage).toBe(4)
    expect(snap.checkpoint && snap.checkpoint.type).toBe('cost_confirm')
    const costCheck = snap.checkpoint.context && snap.checkpoint.context.generate_videos && snap.checkpoint.context.generate_videos.costCheck
    expect(costCheck && costCheck.shots.map((s) => s.shotId)).toEqual(['s-0', 's-1'])
  })
})
