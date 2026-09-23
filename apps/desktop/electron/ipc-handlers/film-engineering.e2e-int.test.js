// @ts-check
'use strict'
/**
 * film-full-corpus-production E2E 集成测试（任务 9.1 / 9.2）
 *
 * 9.1：真实 kit（userData 全量 mini-kit 12 镜，两级回退链走真实现）→ 分页浏览 →
 *      经真实 IPC 通道 production-plan / production-run-batch ×2（逐批过闸）→
 *      12 镜 manifest 收口 → film_render 真实 ffmpeg 合成 final.mp4（时长 = Σ）。
 * 9.2：回收链路——5 镜 resultUrl 经本机临时 HTTP 服务 download-recycled（真实
 *      fetch/ffprobe）+ 2 镜生成产物混合 manifest → 合成成片（时长 = Σ ±0.5s）。
 *
 * provider 以 _testGenerateShotVideo 模拟（写真实同规格 mp4 落盘），
 * 其余链路（driver/台账/磁盘双核/IPC 校验/下载合同/渲染）全部走真实实现。
 * 环境缺 ffmpeg/ffprobe 时整组 skip（与 film-render.manifest-int 同口径）。
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { execFileSync } from 'node:child_process'

vi.mock('../services/logger', () => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}))

__enableElectronMock()

const { findFfmpeg, findFfprobe } = await import('../services/media-tool-paths')
const FFMPEG = findFfmpeg()
const FFPROBE = findFfprobe()
const hasTools = Boolean(FFMPEG && FFPROBE)

const UUID = '3caa2f3a-52b5-4293-9237-0c8f76c7158a'
const SCENE_ID = 'e2e-scene'
const SHOT_COUNT = 12
const RECYCLE_COUNT = 5

/** 生成一个真实可 ffprobe 的 2 秒 720p 片段 */
function makeClip (outPath, seconds = 2) {
  execFileSync(FFMPEG, [
    '-v', 'error', '-y',
    '-f', 'lavfi', '-i', 'testsrc2=duration=' + seconds + ':size=1280x720:rate=24',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p',
    outPath,
  ], { timeout: 120000 })
}

function probeDuration (p) {
  const out = execFileSync(FFPROBE, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', p], { encoding: 'utf8', timeout: 60000 })
  return parseFloat(String(out).trim())
}

function uuidFor (i) {
  const h = i.toString(16).padStart(8, '0')
  return h + '-1111-4111-8111-111111111111'
}

describe.skipIf(!hasTools)('production E2E（任务 9.1/9.2，模拟 provider + 真实 ffmpeg）', () => {
  let fx = null
  let registerHandlers = null
  let sessionTmp = null
  const cleanupDirs = []
  const tmpRoots = []
  let originalNodeEnv
  let originalIsPackaged
  let originalTmp

  /** 会话私有媒体根（与 production 代码的 os.tmpdir()/film-engineering 同解析） */
  function mediaRoot () { return path.join(sessionTmp, 'film-engineering') }

  function buildKitDir () {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'film-e2e-kit-'))
    tmpRoots.push(dir)
    const shots = []
    for (let i = 0; i < SHOT_COUNT; i++) {
      const shot = {
        shotId: uuidFor(i),
        sceneId: SCENE_ID,
        prompt: 'E2E shot ' + i + ' prompt. GEO SPATIAL LAYOUT: centered.',
        model: 'seedance_2_0',
        refTokens: [UUID],
        width: 1280,
        height: 720,
      }
      // 下载合同只信 https（validateDownloadUrl）；_testFetch 把主机重写到本机临时服务
      if (i < RECYCLE_COUNT) shot.resultUrl = 'https://recycle.invalid/clip-' + i + '.mp4'
      shots.push(shot)
    }
    const manifest = {
      schemaVersion: 1,
      filmMeta: {
        title: 'E2E Hell Grind',
        durationSec: 24,
        logline: 'Twelve-shot end-to-end fixture film.',
        characters: [{ name: 'ROKO', descriptor: 'street kid' }],
      },
      scenes: [{ id: SCENE_ID, name: '1. E2E SCENE', count: SHOT_COUNT, parentId: null, level: 0 }],
      allowedHosts: ['recycle.invalid'],
    }
    const references = { [UUID]: { kind: 'character', name: 'ROKO', imageUrls: ['https://cdn.example.com/roko.png'] } }
    const doctrine = {
      blocks: [{ key: 'geo_spatial_layout', label: 'GEO SPATIAL LAYOUT', zh: '地理空间布局', en: 'Geo spatial layout' }],
      rules: [{ key: 'batch-10-15', title: 'Batch iteration 10-15', zh: '批量迭代 10-15 法则', en: 'Batch 10-15 rule' }],
      glossary: [{ term: 'seedance', zh: '种子舞', en: 'Seedance' }],
    }
    fs.writeFileSync(path.join(dir, 'film-manifest.json'), JSON.stringify(manifest))
    fs.writeFileSync(path.join(dir, 'shot-library.json'), JSON.stringify(shots))
    fs.writeFileSync(path.join(dir, 'reference-registry.json'), JSON.stringify(references))
    fs.writeFileSync(path.join(dir, 'prompt-doctrine.json'), JSON.stringify(doctrine))
    return { dir, shots }
  }

  function startRecycleServer (pool) {
    return new Promise((resolve) => {
      const server = http.createServer((req, res) => {
        const m = /^\/clip-(\d+)\.mp4$/.exec(req.url || '')
        if (!m || !pool[Number(m[1])]) { res.writeHead(404); res.end(); return }
        const buf = fs.readFileSync(pool[Number(m[1])])
        res.writeHead(200, { 'content-type': 'video/mp4', 'content-length': String(buf.length) })
        res.end(buf)
      })
      server.listen(0, '127.0.0.1', () => resolve(server))
    })
  }

  /** 经 manifest 直通 + film_render 阶段合成成片（返回 final.mp4 路径） */
  async function composeFromManifest (manifest, runTag) {
    const { PipelineEngine } = await import('../services/pipeline-engine.js')
    const { registerFilmRenderStage } = await import('../services/film-engineering/film-render.js')
    const engine = new PipelineEngine({ log: { info () {}, warn () {}, error () {} } })
    engine.stageExecutor = { _customExecutors: new Map(), register (type, fn) { this._customExecutors.set(type, fn) } }
    engine._stageExecutors = engine.stageExecutor._customExecutors
    registerFilmRenderStage(engine)
    const renderFn = engine._stageExecutors.get('film_render')
    // 与既有 manifest-int 同口径：film_render 假定 runDir 已存在（真实 pipeline 由上游阶段创建）
    fs.mkdirSync(path.join(mediaRoot(), 'e2e-run-' + runTag), { recursive: true })
    const result = await renderFn({
      runId: 'e2e-run-' + runTag,
      stage: { name: 'render', type: 'film_render', options: {} },
      params: { aspect: '16x9' },
      context: { renderManifest: manifest },
      onProgress: () => {},
    })
    expect(result.success, 'render fail: ' + JSON.stringify(result)).toBe(true)
    expect(result.output.source).toBe('renderManifest')
    return result.output.finalPath
  }

  beforeAll(async () => {
    // 片段池在会话外一次性生成（12 个 2 秒 720p 真实 mp4），回收服务静态托管
    const poolDir = fs.mkdtempSync(path.join(os.tmpdir(), 'film-e2e-pool-'))
    tmpRoots.push(poolDir)
    const pool = []
    for (let i = 0; i < SHOT_COUNT; i++) {
      const p = path.join(poolDir, 'clip-' + i + '.mp4')
      makeClip(p)
      pool.push(p)
    }
    const server = await startRecycleServer(pool)
    const port = server.address().port
    const kit = buildKitDir()
    fx = { ...kit, pool, server, port }
  }, 240000)

  afterAll(async () => {
    if (fx) await new Promise((r) => fx.server.close(r))
    for (const d of [...cleanupDirs, ...tmpRoots]) {
      try { fs.rmSync(d, { recursive: true, force: true }) } catch { /* 忽略 */ }
    }
  })

  beforeEach(async () => {
    vi.resetModules()
    originalNodeEnv = process.env.NODE_ENV
    originalIsPackaged = __electronMock.app.isPackaged
    originalTmp = { TMPDIR: process.env.TMPDIR, TEMP: process.env.TEMP, TMP: process.env.TMP }
    delete process.env.NODE_ENV
    __electronMock.app.isPackaged = false
    // 会话私有临时根：os.tmpdir() 按 env 重定向（afterEach 还原），使
    // getFilmMediaRoot/getFilmRunDir 与并发 film 测试目录隔离、afterAll 可整树清理
    sessionTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'film-e2e-session-'))
    tmpRoots.push(sessionTmp)
    process.env.TMPDIR = sessionTmp
    process.env.TEMP = sessionTmp
    process.env.TMP = sessionTmp
    const mod = await import('./film-engineering')
    registerHandlers = mod.default || mod
  })

  afterEach(() => {
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV
    else process.env.NODE_ENV = originalNodeEnv
    __electronMock.app.isPackaged = originalIsPackaged
    Object.assign(process.env, originalTmp)
    sessionTmp = null
  })

  async function setup () {
    const svcMod = await import('../services/film-engineering/film-engineering-service.js')
    const FilmEngineeringService = svcMod.FilmEngineeringService || svcMod.default
    const service = new FilmEngineeringService({
      kitDir: path.join(process.cwd(), 'electron', 'film-kit'), // 精简 kit（回退级，正常不进）
      userDataKitDir: fx.dir, // fixture 全量 mini-kit（首级）
      log: { info () {}, warn () {}, error () {} },
    })
    const aiGenerator = {
      _modelProviderManager: {
        getDefault: (type) => (type === 'video' ? { id: 'mock-video-provider', models: ['mock-t2v'], config: {} } : null),
      },
    }
    const generateCalls = []
    const deps = {
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      filmEngineeringService: service,
      aiGenerator,
      _testGenerateShotVideo: async ({ shot, index, runDir }) => {
        generateCalls.push({ shotId: shot.shotId, index })
        fs.mkdirSync(runDir, { recursive: true })
        fs.copyFileSync(fx.pool[index], path.join(runDir, 'shot_' + String(index).padStart(3, '0') + '.mp4'))
        return { success: true }
      },
      // 回收下载：真实 fetch 指向本机临时服务（合同主机名仍是登记的 recycle.invalid）
      _testFetch: (url, opts) => fetch(url.replace('https://recycle.invalid', 'http://127.0.0.1:' + fx.port), opts),
      _testLookup: async () => ['203.0.113.10'], // 公网占位（SSRF 守卫按解析结果判定）
    }
    const handlers = {}
    const ipcMain = { handle: vi.fn((ch, fn) => { handlers[ch] = fn }) }
    registerHandlers(ipcMain, deps)
    const sentEvents = []
    const event = {
      senderFrame: { url: 'http://localhost:5174/' },
      sender: { send: (ch, payload) => sentEvents.push({ ch, payload }) },
    }
    return { service, handlers, event, generateCalls, sentEvents }
  }

  it('9.1a 真实 kit 链加载：userData 全量优先 + 分页浏览', async () => {
    const { handlers, event } = await setup()
    const st = await handlers['film-engineering:status'](event)
    expect(st.code).toBe(0)
    expect(st.data.available).toBe(true)
    expect(st.data.kitSource).toBe('userData-full')
    expect(st.data.shotCount).toBe(SHOT_COUNT)
    // 分页浏览：limit 5 三页拉全 12 镜且无重复
    const pages = []
    for (const offset of [0, 5, 10]) {
      const r = await handlers['film-engineering:list-shots'](event, SCENE_ID, { limit: 5, offset })
      expect(r.code).toBe(0)
      expect(r.data.total).toBe(SHOT_COUNT)
      pages.push(...r.data.shots.map((s) => s.shotId))
    }
    expect(new Set(pages).size).toBe(SHOT_COUNT)
  })

  it('9.1b 12 镜两批过闸出片 → manifest 收口 → 真实合成 final.mp4', async () => {
    const { handlers, event, generateCalls, sentEvents } = await setup()
    const shotIds = Array.from({ length: SHOT_COUNT }, (_, i) => uuidFor(i))
    const taskId = 'e2e-prod-' + Date.now()

    // 确认前零副作用：无台账
    const before = await handlers['film-engineering:production-status'](event, { taskId, shotIds })
    expect(before.data.exists).toBe(false)

    const plan = await handlers['film-engineering:production-plan'](event, { shotIds })
    expect(plan.code).toBe(0)
    expect(plan.data.batchCount).toBe(2)
    expect(plan.data.batches.map((b) => b.shotCount)).toEqual([10, 2])
    expect(plan.data.diskEstimateBytes).toBe(SHOT_COUNT * 8 * 1024 * 1024)
    expect(generateCalls.length).toBe(0) // plan 只读零计费

    // 批 0 过闸：仅前 10 镜，收口清单未就绪（防假成片）
    const b0 = await handlers['film-engineering:production-run-batch'](event, { taskId, shotIds, batchIndex: 0 })
    expect(b0.code).toBe(0)
    expect(b0.data.batchStatus).toBe('done')
    expect(b0.data.renderManifest).toBe(null)
    expect(b0.data.manifestError).toBeTruthy()

    // 批 1 过闸：全批 done → 12 条目有序清单
    const b1 = await handlers['film-engineering:production-run-batch'](event, { taskId, shotIds, batchIndex: 1 })
    expect(b1.code).toBe(0)
    expect(b1.data.batchStatus).toBe('done')
    expect(b1.data.renderManifest.length).toBe(SHOT_COUNT)
    expect(b1.data.renderManifest.map((e) => e.orderIndex)).toEqual(Array.from({ length: SHOT_COUNT }, (_, i) => i))
    expect(b1.data.renderManifest.every((e) => e.sourceKind === 'generated')).toBe(true)
    expect(generateCalls.length).toBe(SHOT_COUNT)

    // 断点视图双核：全 done，重跑零 provider 调用
    const status = await handlers['film-engineering:production-status'](event, { taskId, shotIds })
    expect(status.data.exists).toBe(true)
    expect(status.data.doneCount).toBe(SHOT_COUNT)
    expect(status.data.batches.every((b) => b.status === 'done' && !b.needRun)).toBe(true)
    await handlers['film-engineering:production-run-batch'](event, { taskId, shotIds, batchIndex: 0 })
    expect(generateCalls.length).toBe(SHOT_COUNT) // 磁盘复核通过不再出片

    // production-update 事件推送含收口完成
    expect(sentEvents.some((e) => e.ch === 'film-engineering:production-update' && e.payload.type === 'production:complete')).toBe(true)

    // manifest 直通合成 → film_render 真实 ffmpeg 出 final.mp4（12×2s）
    const finalPath = await composeFromManifest(b1.data.renderManifest, taskId + '-final')
    const dur = probeDuration(finalPath)
    expect(dur).toBeGreaterThan(SHOT_COUNT * 2 - 0.5)
    expect(dur).toBeLessThan(SHOT_COUNT * 2 + 0.5)
  }, 300000)

  it('9.2 回收链路：5 镜 HTTP 下载 + 2 镜生成产物混合出片', async () => {
    const { handlers, event } = await setup()
    const taskId = 'e2e-recycle-' + Date.now()
    const items = Array.from({ length: RECYCLE_COUNT }, (_, i) => ({ shotId: uuidFor(i), orderIndex: i }))
    // 第 6 项无 resultUrl（该镜未登记下载 URL）→ 单项失败不炸批
    items.push({ shotId: uuidFor(6), orderIndex: 5 })

    const r = await handlers['film-engineering:download-recycled'](event, { taskId, items })
    expect(r.code).toBe(0)
    expect(r.data.allOk).toBe(false)
    const okEntries = []
    for (let i = 0; i < RECYCLE_COUNT; i++) {
      expect(r.data.results[i].ok).toBe(true)
      okEntries.push(r.data.results[i].entry)
    }
    expect(r.data.results[RECYCLE_COUNT].ok).toBe(false)
    expect(r.data.results[RECYCLE_COUNT].error).toMatch(/resultUrl/)
    // 下载产物经 ffprobe 验证落会话媒体根 recycled 目录，命名按 orderIndex
    for (const e of okEntries) {
      expect(e.sourceKind).toBe('downloaded')
      expect(fs.existsSync(e.path)).toBe(true)
      expect(path.dirname(e.path)).toBe(path.join(mediaRoot(), 'production', taskId, 'recycled'))
    }

    // 混合 manifest：5 下载（order 0-4）+ 2 生成产物（order 5-6）→ 合成 7 段成片
    const genDir = fs.mkdtempSync(path.join(mediaRoot(), 'e2e-mixgen-'))
    cleanupDirs.push(genDir)
    const genEntries = [5, 6].map((k, j) => {
      const p = path.join(genDir, 'shot_' + String(j).padStart(3, '0') + '.mp4')
      fs.copyFileSync(fx.pool[k], p)
      return { shotId: uuidFor(k), path: p, sourceKind: 'generated', orderIndex: RECYCLE_COUNT + j }
    })
    const manifest = [...okEntries, ...genEntries].sort((a, b) => a.orderIndex - b.orderIndex)
    const finalPath = await composeFromManifest(manifest, taskId + '-mix')
    const dur = probeDuration(finalPath)
    expect(dur).toBeGreaterThan(7 * 2 - 0.5)
    expect(dur).toBeLessThan(7 * 2 + 0.5)
  }, 300000)
})
