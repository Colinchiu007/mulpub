// @ts-check
'use strict'
/**
 * 自动模式执行前置契约测试（openspec change: film-auto-mode，design D21/D31）
 *
 * 锁定两处「为复用而做的最小扩展」：
 *  1. production-driver 的 `runIdFor`：默认仍是 prod-<taskId>-b<N>（既有全量出片语义逐字不变），
 *     自动模式传 'auto/<taskId>/b<N>' 使产物落 <mediaRoot>/auto/<taskId>/b<N>/；
 *  2. ShotLibrary.listAllShots / FilmEngineeringService.listTemplateShots：规划阶段的模板来源
 *     （按 kit 原始顺序、受 limit 保护，不走场景过滤、不受 FULL_LOAD_LIMIT 约束）。
 */
const fs = require('fs')
const os = require('os')
const path = require('path')

const { runProduction, createLedger, defaultRunIdFor, shotFileName } = require('./production-driver')
const { ShotLibrary } = require('./shot-library')
const { FilmEngineeringService } = require('./film-engineering-service')

function tmpDir () {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'auto-exec-contract-'))
}

function syntheticKit (shotCount) {
  const shots = Array.from({ length: shotCount }, (_, i) => ({
    shotId: 's' + i,
    sceneId: 'sc' + (i % 2),
    prompt: 'PROMPT ' + i,
    model: 'seedance_2_0',
    refTokens: [],
  }))
  const sceneIndex = new Map([['sc0', shots.filter((s) => s.sceneId === 'sc0')], ['sc1', shots.filter((s) => s.sceneId === 'sc1')]])
  return {
    manifest: { schemaVersion: 1, filmMeta: { title: 'T' }, scenes: [], allowedHosts: [] },
    shots,
    references: {},
    doctrine: {},
    shotById: new Map(shots.map((s) => [s.shotId, s])),
    sceneIndex: new Map([['sc0', {}], ['sc1', {}]]),
    shotSceneIndex: sceneIndex,
    source: 'asar-bundled',
  }
}

describe('production-driver.runIdFor（自动模式产物落点）', () => {
  /**
   * 本组保护的是**自动模式的产物落点不受影响**。
   *
   * 2026-10-10（film-production-artifact-identity）：默认派生已加分镜集指纹
   * （三参），但**二参调用方必须仍拿到旧格式**——auto 模式注入的正是二参函数
   * （`film-engineering-auto.js:336` 的 `(t, batchIndex) => autoRunIdFor(t, batchIndex)`）。
   * 断言一律对着 `defaultRunIdFor(...)` 求值而非硬编码字面值，避免派生规则演进时
   * 把「auto 兼容」这条真正的契约误报为回归。
   */
  it('二参调用（auto 模式形态）→ 仍为 prod-<taskId>-b<N>，不带指纹（兼容不变量）', () => {
    expect(defaultRunIdFor('t1', 0)).toBe('prod-t1-b0')
    expect(defaultRunIdFor('t1', 7)).toBe('prod-t1-b7')
  })

  it('三参调用 → 带分镜集指纹，且换分镜集即换 runId', () => {
    const a = defaultRunIdFor('t1', 0, ['a', 'b', 'c'])
    const b = defaultRunIdFor('t1', 0, ['x', 'y', 'z'])
    expect(a).not.toBe(b)
    expect(a).toMatch(/^prod-t1-[0-9a-f]{10}-b0$/)
  })

  it('createLedger 未注入 runIdFor → 走默认派生（即三参形态）', () => {
    const ledger = createLedger({ taskId: 't1', shotIds: ['a', 'b', 'c'] })
    expect(ledger.batches.map((b) => b.runId)).toEqual([defaultRunIdFor('t1', 0, ['a', 'b', 'c'])])
  })

  it('runIdFor 非函数 → 回落默认（fail-open，不抛）', () => {
    const ledger = createLedger({ taskId: 't1', shotIds: ['a'], runIdFor: 'not-a-function' })
    expect(ledger.batches[0].runId).toBe(defaultRunIdFor('t1', 0, ['a']))
  })

  it('自定义 runIdFor：批次真正执行且 manifest 路径落在 auto/<taskId>/b<N>/', async () => {
    const dir = tmpDir()
    const seen = []
    let done = false
    const mediaRoot = path.join(os.tmpdir(), 'film-engineering')
    const r = await runProduction({
      taskId: 'auto-1',
      shotIds: ['auto-000'],
      ledgerDir: dir,
      mediaRoot,
      runIdFor: (taskId, batchIndex) => 'auto/' + taskId + '/b' + batchIndex,
      probe: () => ({ missing: done ? [] : [0] }),
      runBatch: async (batch) => { seen.push(batch.runId); done = true },
      emit: () => {},
    })
    expect(seen).toEqual(['auto/auto-1/b0'])
    expect(r.ok).toBe(true)
    expect(r.renderManifest.entries[0].path.replace(/\\/g, '/')).toContain('auto/auto-1/b0/' + shotFileName(0))
    const ledgerOnDisk = JSON.parse(fs.readFileSync(path.join(dir, 'ledger.json'), 'utf8'))
    expect(ledgerOnDisk.batches[0].runId).toBe('auto/auto-1/b0')
  })

  it('续跑沿用台账既有 runId（不因 runIdFor 变化而错位）', async () => {
    const dir = tmpDir()
    let done = false
    const opts = {
      taskId: 'auto-1',
      shotIds: ['auto-000'],
      ledgerDir: dir,
      runIdFor: (taskId, batchIndex) => 'auto/' + taskId + '/b' + batchIndex,
      probe: () => ({ missing: done ? [] : [0] }),
      runBatch: async () => { done = true },
      emit: () => {},
    }
    await runProduction(opts)
    done = false
    const second = await runProduction({ ...opts, runIdFor: () => 'SHOULD-NOT-BE-USED' })
    expect(second.ledger.batches[0].runId).toBe('auto/auto-1/b0')
  })
})

describe('ShotLibrary.listAllShots（规划模板来源）', () => {
  it('按 kit 原始顺序返回 public 字段', () => {
    const lib = new ShotLibrary({ kit: syntheticKit(5) })
    const all = lib.listAllShots()
    expect(all).toHaveLength(5)
    expect(all.map((s) => s.shotId)).toEqual(['s0', 's1', 's2', 's3', 's4'])
    expect(Object.keys(all[0]).sort()).toEqual(['height', 'model', 'prompt', 'refTokens', 'resultUrl', 'sceneId', 'shotId', 'width'].sort())
  })

  it('limit 生效且非法 limit 回落默认（不抛）', () => {
    const lib = new ShotLibrary({ kit: syntheticKit(5) })
    expect(lib.listAllShots(2)).toHaveLength(2)
    expect(lib.listAllShots(0)).toHaveLength(5)
    expect(lib.listAllShots('x')).toHaveLength(5)
  })

  it('不受场景过滤与 FULL_LOAD_LIMIT 影响（跨场景全量模板）', () => {
    const lib = new ShotLibrary({ kit: syntheticKit(4) })
    expect(lib.listAllShots(4).map((s) => s.sceneId)).toEqual(['sc0', 'sc1', 'sc0', 'sc1'])
  })
})

describe('FilmEngineeringService.listTemplateShots（真实随包 kit 委托）', () => {
  it('返回非空模板分镜且带 prompt/model', () => {
    const svc = new FilmEngineeringService({ kitDir: path.join(__dirname, '..', '..', 'film-kit') })
    const shots = svc.listTemplateShots(5)
    expect(shots.length).toBe(5)
    expect(typeof shots[0].prompt).toBe('string')
    expect(shots[0].prompt.length).toBeGreaterThan(0)
    expect(typeof shots[0].model).toBe('string')
  })

  it('上限被尊重（不超过请求条数）', () => {
    const svc = new FilmEngineeringService({ kitDir: path.join(__dirname, '..', '..', 'film-kit') })
    expect(svc.listTemplateShots(3).length).toBeLessThanOrEqual(3)
  })
})

describe('production-driver.shouldStop（停止批间生效，未开始的批保持 pending）', () => {
  it('第 1 批跑完后请求停止 → 只跑 1 批，其余 pending 且台账落盘（可续跑）', async () => {
    const dir = tmpDir()
    const ran = []
    const doneBatches = new Set()
    let stop = false
    const r = await runProduction({
      taskId: 'auto-1',
      shotIds: Array.from({ length: 25 }, (_x, i) => 's' + i), // 3 批：10 / 10 / 5
      ledgerDir: dir,
      batchSize: 10,
      runIdFor: (taskId, batchIndex) => 'auto/' + taskId + '/b' + batchIndex,
      probe: (runId, count) => ({
        missing: doneBatches.has(runId) ? [] : Array.from({ length: count }, (_x, i) => i),
      }),
      shouldStop: () => stop,
      runBatch: async (batch) => {
        ran.push(batch.batchIndex)
        doneBatches.add(batch.runId)
        stop = true // 第 1 批完成后用户点了停止
      },
      emit: () => {},
    })
    expect(ran).toEqual([0])
    expect(r.stopped).toBe(true)
    expect(r.ledger.batches.map((b) => b.status)).toEqual(['done', 'pending', 'pending'])
    const onDisk = JSON.parse(fs.readFileSync(path.join(dir, 'ledger.json'), 'utf8'))
    expect(onDisk.batches[1].status).toBe('pending')
    expect(onDisk.batches[2].status).toBe('pending')
  })

  it('shouldStop 抛错不阻断执行（fail-open，避免一个坏钩子停掉整条流水线）', async () => {
    const dir = tmpDir()
    const ran = []
    const r = await runProduction({
      taskId: 'auto-2',
      shotIds: ['s0'],
      ledgerDir: dir,
      probe: () => ({ missing: [0] }),
      shouldStop: () => { throw new Error('boom') },
      runBatch: async (batch) => { ran.push(batch.batchIndex) },
      emit: () => {},
    })
    expect(ran).toEqual([0])
    expect(r.stopped).toBe(false)
  })
})
