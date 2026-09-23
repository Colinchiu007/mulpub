// @ts-check
'use strict'
/**
 * production-driver L3 全量分批出片驱动测试（tasks 7.1/7.3/7.4；design D6/D9）
 *
 * 合同：
 *  - planBatches：批大小 10（144 镜 → 15 批 = 14×10+1×4）；边界 0/1/10/11；
 *  - 批次 runId 确定性派生（prod-<taskId>-b<batchIndex>），重入可复算；
 *  - 台账 ledger.json 持久化（.part tmp + rename 崩溃安全），批次清单 + 每镜状态；
 *  - 重入协议（D6）：读台账 → "已完成"批次磁盘产物复核（不信内存态）→
 *    仅未完成镜发起调用；台账 pending 但磁盘齐 → 仍复核通过跳过（双核）；
 *  - 单批失败隔离：失败批标记 failed，后续批照常，不产出假收口；
 *  - 全批收口自动生成 renderManifest（组 5 契约：orderIndex 0..N-1 连续、
 *    sourceKind generated、path 受控媒体根内）；
 *  - 进度事件（7.4）：批次级 + 逐镜经 emit 上报，窗口内节流合并；
 *    事件负载不含 shotIds 大数组（IPC 负载守卫）。
 *
 * seam：runBatch（替代真实子 run）/ probe / now / mediaRoot 全注入，零 provider。
 */
const fs = require('fs')
const path = require('path')
const os = require('os')
const {
  planBatches,
  createLedger,
  saveLedger,
  loadLedger,
  resolveResumePlan,
  buildRenderManifest,
  runProduction,
  PRODUCTION_BATCH_SIZE,
  EVENT_MERGE_MS,
} = require('./production-driver')

const ledgerDirs = []
function tmpLedgerDir () {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'prod-ledger-'))
  ledgerDirs.push(d)
  return d
}
afterEach(() => { while (ledgerDirs.length) { const d = ledgerDirs.pop(); try { fs.rmSync(d, { recursive: true, force: true }) } catch { /* 忽略 */ } } })

function ids (n) { return Array.from({ length: n }, (_, i) => 'shot-' + i) }

describe('planBatches（切批边界）', () => {
  it('批大小常量为 10', () => {
    expect(PRODUCTION_BATCH_SIZE).toBe(10)
  })

  it('0 镜 → 空计划', () => {
    expect(planBatches([])).toEqual([])
  })

  it('1 镜 → 1 批；10 镜 → 1 批；11 镜 → 2 批（10+1）', () => {
    expect(planBatches(ids(1)).map((b) => b.shotIds.length)).toEqual([1])
    expect(planBatches(ids(10)).map((b) => b.shotIds.length)).toEqual([10])
    expect(planBatches(ids(11)).map((b) => b.shotIds.length)).toEqual([10, 1])
  })

  it('144 镜 → 15 批（14×10+1×4），batchIndex 连续、shotIds 保序不重不漏', () => {
    const all = ids(144)
    const plan = planBatches(all)
    expect(plan.map((b) => b.shotIds.length)).toEqual([...Array(14).fill(10), 4])
    expect(plan.map((b) => b.batchIndex)).toEqual([...Array(15).keys()])
    expect(plan.flatMap((b) => b.shotIds)).toEqual(all)
  })
})

describe('createLedger / 持久化（D6 唯一事实源）', () => {
  it('批次 runId 确定性派生且唯一：prod-<taskId>-b<idx>', () => {
    const l = createLedger({ taskId: 'tk1', shotIds: ids(11) })
    expect(l.taskId).toBe('tk1')
    expect(l.batches.map((b) => b.runId)).toEqual(['prod-tk1-b0', 'prod-tk1-b1'])
    expect(l.batches.every((b) => b.status === 'pending')).toBe(true)
    expect(l.batches[0].shots.map((s) => s.status)).toEqual(Array(10).fill('pending'))
    // 同输入重入复算一致
    expect(createLedger({ taskId: 'tk1', shotIds: ids(11) }).batches).toEqual(l.batches)
  })

  it('save/load round-trip 一致；落盘经临时文件 rename（无 .tmp 残留）', () => {
    const dir = tmpLedgerDir()
    const l = createLedger({ taskId: 'tk2', shotIds: ids(3) })
    saveLedger(dir, l)
    expect(fs.readdirSync(dir).filter((f) => f.endsWith('.tmp'))).toEqual([])
    const back = loadLedger(dir)
    expect(back).toEqual(l)
    expect(fs.existsSync(path.join(dir, 'ledger.json'))).toBe(true)
  })

  it('loadLedger 损坏 JSON → null（调用方 fail-closed 重建，不吞着跑）', () => {
    const dir = tmpLedgerDir()
    fs.writeFileSync(path.join(dir, 'ledger.json'), '{broken')
    expect(loadLedger(dir)).toBeNull()
  })
})

describe('resolveResumePlan（磁盘复核重入协议，不信台账内存态）', () => {
  const mkProbe = (presentByRun) => (runId, count) => {
    const present = presentByRun[runId] || []
    return { missing: Array.from({ length: count }, (_, i) => i).filter((i) => !present.includes(i)) }
  }

  it('done 批次磁盘产物齐全 → needRun false（零 provider 调用）', () => {
    const l = createLedger({ taskId: 't', shotIds: ids(12) })
    l.batches[0].status = 'done'
    const r = resolveResumePlan(l, { probe: mkProbe({ 'prod-t-b0': [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] }) })
    expect(r[0].needRun).toBe(false)
    expect(r[1].needRun).toBe(true)
  })

  it('done 批次磁盘缺产物 → 降级 needRun true（台账说完成不算数）', () => {
    const l = createLedger({ taskId: 't', shotIds: ids(12) })
    l.batches[0].status = 'done'
    const r = resolveResumePlan(l, { probe: mkProbe({ 'prod-t-b0': [0, 1, 2] }) })
    expect(r[0].needRun).toBe(true)
    expect(r[0].missing).toEqual([3, 4, 5, 6, 7, 8, 9])
  })

  it('pending 批次磁盘产物已齐（上次崩溃在写台账前）→ 复核通过 needRun false（双核）', () => {
    const l = createLedger({ taskId: 't', shotIds: ids(11) })
    const r = resolveResumePlan(l, { probe: mkProbe({ 'prod-t-b0': [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] }) })
    expect(r[0].needRun).toBe(false)
    expect(r[1].needRun).toBe(true)
  })
})

describe('buildRenderManifest（全批收口自动生成，组 5 契约）', () => {
  it('全部批次台账 done 且磁盘复核通过 → entries 保序连续、sourceKind generated、path 媒体根内', () => {
    const l = createLedger({ taskId: 't', shotIds: ids(11) })
    l.batches.forEach((b) => { b.status = 'done' })
    const mediaRoot = path.join(os.tmpdir(), 'film-engineering')
    const m = buildRenderManifest(l, {
      mediaRoot,
      probe: (runId, count) => ({ missing: [] }),
    })
    expect(m.ok).toBe(true)
    expect(m.entries.length).toBe(11)
    expect(m.entries.map((e) => e.orderIndex)).toEqual([...Array(11).keys()])
    expect(m.entries.map((e) => e.shotId)).toEqual(ids(11))
    expect(m.entries.every((e) => e.sourceKind === 'generated')).toBe(true)
    expect(m.entries[0].path.replace(/\\/g, '/')).toContain('film-engineering/prod-t-b0/shot_000.mp4')
    expect(m.entries[10].path.replace(/\\/g, '/')).toContain('prod-t-b1')
  })

  it('有批次未过磁盘复核（或台账未 done）→ ok:false 并列缺失，不产出假清单', () => {
    const l = createLedger({ taskId: 't', shotIds: ids(11) })
    l.batches.forEach((b) => { b.status = 'done' })
    const m = buildRenderManifest(l, {
      mediaRoot: path.join(os.tmpdir(), 'film-engineering'),
      probe: (runId) => (runId === 'prod-t-b1' ? { missing: [0] } : { missing: [] }),
    })
    expect(m.ok).toBe(false)
    expect(m.error).toMatch(/缺失/)
    expect(m.missing).toEqual([{ runId: 'prod-t-b1', shotIndex: 0 }])
  })
})

describe('runProduction（驱动：顺序、隔离、续跑、事件）', () => {
  // 可增长磁盘 mock：只有 runBatch 真实落盘后 probe 才算齐（新跑必 needRun）
  function mkDisk () {
    const files = {}
    return {
      files,
      probe: (runId, count) => ({
        missing: Array.from({ length: count }, (_, i) => i).filter((i) => !(files[runId] || []).includes(i)),
      }),
      fill: (runId, count) => { files[runId] = Array.from({ length: count }, (_, i) => i) },
    }
  }

  it('两批顺序执行 → 台账 done 收口 + renderManifest 产出', async () => {
    const dir = tmpLedgerDir()
    const disk = mkDisk()
    const calls = []
    const r = await runProduction({
      taskId: 'tk', shotIds: ids(11), ledgerDir: dir,
      runBatch: async (batch) => { calls.push(batch.batchIndex); disk.fill(batch.runId, batch.shotIds.length) },
      probe: disk.probe, emit: () => {},
    })
    expect(calls).toEqual([0, 1])
    expect(r.ok).toBe(true)
    expect(r.renderManifest.entries.length).toBe(11)
    const back = loadLedger(dir)
    expect(back.batches.map((b) => b.status)).toEqual(['done', 'done'])
    expect(back.batches[0].shots.every((s) => s.status === 'done')).toBe(true)
  })

  it('单批失败隔离：失败批 failed，后续批照常执行，不产出收口清单', async () => {
    const dir = tmpLedgerDir()
    const disk = mkDisk()
    const r = await runProduction({
      taskId: 'fl', shotIds: ids(21), ledgerDir: dir,
      runBatch: async (batch) => {
        if (batch.batchIndex === 1) throw new Error('provider 炸了')
        disk.fill(batch.runId, batch.shotIds.length)
      },
      probe: disk.probe, emit: () => {},
    })
    expect(r.ok).toBe(false)
    expect(r.failedBatches.map((b) => b.batchIndex)).toEqual([1])
    expect(r.renderManifest).toBeNull()
    const back = loadLedger(dir)
    expect(back.batches.map((b) => b.status)).toEqual(['done', 'failed', 'done'])
  })

  it('崩溃恢复续跑：已完成批零调用（台账+磁盘双核），从断点批继续', async () => {
    const dir = tmpLedgerDir()
    const disk = mkDisk()
    // 第一轮：批 0 成功落盘后"进程中断"（批 1 未跑）
    await runProduction({
      taskId: 'cr', shotIds: ids(11), ledgerDir: dir,
      runBatch: async (batch) => {
        if (batch.batchIndex === 1) throw new Error('进程被杀')
        disk.fill(batch.runId, batch.shotIds.length)
      },
      probe: disk.probe, emit: () => {},
    })
    // 第二轮：新台账状态从盘读回，批 0 零调用
    const calls = []
    const r2 = await runProduction({
      taskId: 'cr', shotIds: ids(11), ledgerDir: dir,
      runBatch: async (batch) => { calls.push(batch.batchIndex); disk.fill(batch.runId, batch.shotIds.length) },
      probe: disk.probe, emit: () => {},
    })
    expect(calls).toEqual([1])
    expect(r2.ok).toBe(true)
    expect(r2.renderManifest.entries.length).toBe(11)
  })

  it('failed 批重入会重试（重入协议对 failed 不豁免；磁盘无信物则必重跑）', async () => {
    const dir = tmpLedgerDir()
    // 磁盘信物可增：runBatch 成功才落盘，失败轮后磁盘为空 → 重入必重跑
    const disk = { 'prod-rt-b0': [] }
    const probe = (runId, count) => ({
      missing: Array.from({ length: count }, (_, i) => i).filter((i) => !(disk[runId] || []).includes(i)),
    })
    await runProduction({
      taskId: 'rt', shotIds: ids(3), ledgerDir: dir,
      runBatch: async () => { throw new Error('boom') },
      probe, emit: () => {},
    })
    const calls = []
    const r2 = await runProduction({
      taskId: 'rt', shotIds: ids(3), ledgerDir: dir,
      runBatch: async (batch) => { calls.push(batch.batchIndex); disk[batch.runId] = [0, 1, 2] },
      probe, emit: () => {},
    })
    expect(calls).toEqual([0])
    expect(r2.ok).toBe(true)
  })

  it('进度事件（7.4）：批次级 + 逐镜节流合并；负载不含 shotIds 数组', async () => {
    const dir = tmpLedgerDir()
    const disk = mkDisk()
    const events = []
    let clock = 1000
    const r = await runProduction({
      taskId: 'ev', shotIds: ids(11), ledgerDir: dir,
      runBatch: async (batch, ctx) => {
        for (let i = 0; i < batch.shotIds.length; i++) {
          clock += 100 // 每镜 100ms，窗口 500ms → 合并
          ctx.onShotProgress(i, 'done')
        }
        disk.fill(batch.runId, batch.shotIds.length)
      },
      probe: disk.probe,
      emit: (e) => events.push(e),
      now: () => clock,
    })
    expect(r.ok).toBe(true)
    // 逐镜 20 次上报，节流后显著少于 20；且必须有批次开始/完成与最终收口事件
    const shotEvents = events.filter((e) => e.type === 'production:shot-progress')
    expect(shotEvents.length).toBeLessThan(20)
    expect(events.some((e) => e.type === 'production:batch' && e.status === 'running' && e.batchIndex === 0)).toBe(true)
    expect(events.some((e) => e.type === 'production:batch' && e.status === 'done')).toBe(true)
    expect(events.some((e) => e.type === 'production:complete')).toBe(true)
    // IPC 负载守卫：任何事件不得携带 shotIds 大数组
    expect(events.every((e) => e.payload === undefined || !Array.isArray(e.payload.shotIds))).toBe(true)
    // 合并事件计数单调（节流不回退）
    const last = shotEvents[shotEvents.length - 1]
    expect(last.doneCount).toBe(11)
  })

  it('EVENT_MERGE_MS 窗口外的镜事件仍上报（不吞最后状态）', async () => {
    const dir = tmpLedgerDir()
    const disk = mkDisk()
    const events = []
    let clock = 0
    await runProduction({
      taskId: 'ev2', shotIds: ids(11), ledgerDir: dir,
      runBatch: async (batch, ctx) => {
        if (batch.batchIndex > 0) return // 只统计首批的逐镜事件
        clock += EVENT_MERGE_MS + 1
        ctx.onShotProgress(0, 'done')
        clock += EVENT_MERGE_MS + 1
        ctx.onShotProgress(1, 'done')
        disk.fill(batch.runId, batch.shotIds.length)
      },
      probe: disk.probe, emit: (e) => events.push(e), now: () => clock,
    })
    expect(events.filter((e) => e.type === 'production:shot-progress').length).toBe(2)
  })

  it('runOnlyBatch（D9 逐批确认）：只执行指定批，其余待跑批保持 pending 不产假收口', async () => {
    const dir = tmpLedgerDir()
    const disk = mkDisk()
    const calls = []
    const mk = (only) => runProduction({
      taskId: 'rb', shotIds: ids(21), ledgerDir: dir,
      runBatch: async (batch) => { calls.push(batch.batchIndex); disk.fill(batch.runId, batch.shotIds.length) },
      probe: disk.probe, emit: () => {}, runOnlyBatch: only,
    })
    const r0 = await mk(0)
    expect(calls).toEqual([0])
    expect(r0.ledger.batches.map((b) => b.status)).toEqual(['done', 'pending', 'pending'])
    expect(r0.renderManifest).toBeNull() // 未完备不产清单
    await mk(1)
    await mk(2)
    expect(calls).toEqual([0, 1, 2])
    const r3 = await mk(null)
    expect(calls).toEqual([0, 1, 2]) // 已齐批零 provider 调用
    expect(r3.ok).toBe(true)
    expect(r3.renderManifest.entries.length).toBe(21)
  })

  it('runOnlyBatch 非整数 → fail-closed 抛错', async () => {
    await expect(runProduction({
      taskId: 'x', shotIds: ids(2), ledgerDir: tmpLedgerDir(),
      runBatch: async () => {}, probe: () => ({ missing: [] }), runOnlyBatch: 1.5,
    })).rejects.toThrow(/runOnlyBatch/)
  })

  it('shotIds/ledgerDir 非法 → fail-closed 抛错（不静默）', async () => {
    await expect(runProduction({ taskId: '', shotIds: ['a'], ledgerDir: tmpLedgerDir() })).rejects.toThrow(/taskId/)
    await expect(runProduction({ taskId: 't', shotIds: [], ledgerDir: tmpLedgerDir() })).rejects.toThrow(/shotIds/)
  })
})
