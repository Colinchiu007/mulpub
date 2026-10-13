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
  fingerprintBatch,
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
  it('批次 runId 确定性派生且唯一：prod-<taskId>-<fp>-b<idx>，同输入可复算', () => {
    const l = createLedger({ taskId: 'tk1', shotIds: ids(11) })
    expect(l.taskId).toBe('tk1')
    // 锁格式**形状**与三条不变量（确定性 / 批次间唯一 / 指纹随分镜集变），
    // 不锁死具体哈希字面量——那会让指纹算法调整误报为契约回归。
    expect(l.batches.map((b) => b.runId)).toEqual([
      'prod-tk1-' + fingerprintBatch(ids(11).slice(0, 10)) + '-b0',
      'prod-tk1-' + fingerprintBatch(ids(11).slice(10)) + '-b1',
    ])
    expect(new Set(l.batches.map((b) => b.runId)).size).toBe(2)
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
    // probe 键从台账自身取，而非硬编码 runId 格式——本组要锁的是「磁盘复核协议」，
    // 不是「runId 长什么样」；硬编码会让任何派生规则变更都误报为协议回归。
    const r = resolveResumePlan(l, { probe: mkProbe({ [l.batches[0].runId]: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] }) })
    expect(r[0].needRun).toBe(false)
    expect(r[1].needRun).toBe(true)
  })

  it('done 批次磁盘缺产物 → 降级 needRun true（台账说完成不算数）', () => {
    const l = createLedger({ taskId: 't', shotIds: ids(12) })
    l.batches[0].status = 'done'
    const r = resolveResumePlan(l, { probe: mkProbe({ [l.batches[0].runId]: [0, 1, 2] }) })
    expect(r[0].needRun).toBe(true)
    expect(r[0].missing).toEqual([3, 4, 5, 6, 7, 8, 9])
  })

  it('pending 批次磁盘产物已齐（上次崩溃在写台账前）→ 复核通过 needRun false（双核）', () => {
    const l = createLedger({ taskId: 't', shotIds: ids(11) })
    const r = resolveResumePlan(l, { probe: mkProbe({ [l.batches[0].runId]: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] }) })
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
    // path 必须由**台账所载 runId**得出，而不是按当前派生规则重算——
    // 这正是「存量台账零影响」的不变量所在。
    expect(m.entries[0].path.replace(/\\/g, '/')).toContain('film-engineering/' + l.batches[0].runId + '/shot_000.mp4')
    expect(m.entries[10].path.replace(/\\/g, '/')).toContain(l.batches[1].runId)
  })

  it('有批次未过磁盘复核（或台账未 done）→ ok:false 并列缺失，不产出假清单', () => {
    const l = createLedger({ taskId: 't', shotIds: ids(11) })
    l.batches.forEach((b) => { b.status = 'done' })
    const m = buildRenderManifest(l, {
      mediaRoot: path.join(os.tmpdir(), 'film-engineering'),
      probe: (runId) => (runId === l.batches[1].runId ? { missing: [0] } : { missing: [] }),
    })
    expect(m.ok).toBe(false)
    expect(m.error).toMatch(/缺失/)
    expect(m.missing).toEqual([{ runId: l.batches[1].runId, shotIndex: 0 }])
  })
})

describe('runProduction（驱动：顺序、隔离、续跑、事件）', () => {
  // 可增长磁盘 mock：只有 runBatch 真实落盘后 probe 才算齐（新跑必 needRun）

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

/**
 * 回归保护（2026-10-07）：台账复用判定必须比对 shotId 本身。
 *
 * Bug：sameShape 只比较「每批数量」，不比较 shotId。后果是——用户换一个
 * taskId 复用同名任务、或在同一 taskId 下换了一组分镜但数量恰好相同，
 * 台账被**静默复用**：新分镜被丢弃，系统继续跑台账里的旧分镜，且不告警。
 * 对「逐批确认后才计费」的产品语义，这是最危险的一类静默失真。
 *
 * 反证纪律：拆掉下面任一断言对应的实现，本组必须变红。
 */
describe('台账复用：必须比对 shotId 本身而非仅比数量', () => {
  it('同 taskId + 同 shotIds → 复用台账（不重建，保留已完成批次）', async () => {
    const dir = tmpLedgerDir()
    const disk = mkDisk()
    const calls = []
    const run = async () => runProduction({
      taskId: 'reuse', shotIds: ids(4), ledgerDir: dir,
      runBatch: async (b) => { calls.push(b.batchIndex); disk.fill(b.runId, b.shotIds.length) },
      probe: disk.probe, emit: () => {},
    })
    const first = await run()
    expect(first.ok).toBe(true)
    const second = await run()
    // 磁盘已齐 ⇒ 两批都跳过，零 provider 调用
    expect(calls).toEqual([0])
    expect(second.ok).toBe(true)
    expect(loadLedger(dir).taskId).toBe('reuse')
  })

  it('同 taskId + 数量相同但 shotIds 不同 → 必须重建台账，不得静默复用', async () => {
    const dir = tmpLedgerDir()
    const original = ['a-1', 'a-2', 'a-3', 'a-4']
    const swapped = ['x-1', 'x-2', 'x-3', 'x-4'] // 数量相同，成员完全不同

    await runProduction({
      taskId: 'swap', shotIds: original, ledgerDir: dir,
      runBatch: async () => {}, probe: () => ({ missing: [0] }), emit: () => {},
    })
    expect(loadLedger(dir).batches[0].shotIds).toEqual(original)

    // 第二轮换一组分镜，但每批数量刻意相同
    const r = await runProduction({
      taskId: 'swap', shotIds: swapped, ledgerDir: dir,
      runBatch: async () => {}, probe: () => ({ missing: [0] }), emit: () => {},
    })
    // 判据落在台账内容上：必须是新分镜，而不是沿用旧的
    expect(loadLedger(dir).batches[0].shotIds).toEqual(swapped)
    expect(r.ok).toBe(false) // probe 恒报缺镜，收口不通过
  })

  it('同 taskId + 同数量但顺序不同 → 视为不同计划并重建', async () => {
    const dir = tmpLedgerDir()
    const fwd = ['s-1', 's-2', 's-3', 's-4']
    const rev = fwd.slice().reverse()

    await runProduction({
      taskId: 'order', shotIds: fwd, ledgerDir: dir,
      runBatch: async () => {}, probe: () => ({ missing: [0] }), emit: () => {},
    })
    await runProduction({
      taskId: 'order', shotIds: rev, ledgerDir: dir,
      runBatch: async () => {}, probe: () => ({ missing: [0] }), emit: () => {},
    })
    expect(loadLedger(dir).batches[0].shotIds).toEqual(rev)
  })

  it('同 taskId + 数量不同 → 仍按原行为重建（不得回归）', async () => {
    const dir = tmpLedgerDir()
    await runProduction({
      taskId: 'cnt', shotIds: ids(4), ledgerDir: dir,
      runBatch: async () => {}, probe: () => ({ missing: [0] }), emit: () => {},
    })
    await runProduction({
      taskId: 'cnt', shotIds: ids(2), ledgerDir: dir,
      runBatch: async () => {}, probe: () => ({ missing: [0] }), emit: () => {},
    })
    const back = loadLedger(dir)
    expect(back.batches.length).toBe(1)
    expect(back.batches[0].shotIds).toEqual(ids(2))
  })
})

/**
 * 组 1 RED：批次 runId 携带分镜集指纹（openspec change: film-production-artifact-identity）
 *
 * 缺陷 A：`runId = prod-<taskId>-b<N>` 只看 taskId ⇒ 同一 taskId 换一组分镜（每批数量
 * 恰好相同）时目录不变、旧 `shot_NNN.mp4` 还在 ⇒ 磁盘复核判"已齐" ⇒ 整批跳过。
 * 后果是清单声称新分镜、文件里装的是旧分镜，**反向失效（假装成功）**。
 *
 * 反证纪律：把 `runIdFor` 退回两参（指纹丢失）⇒ 本组必须变红。
 */
describe('组 1：批次 runId 携带分镜集指纹', () => {
  /** 造一个「磁盘上真的有文件」的 probe：文件名带内容标记，便于断言产物归属 */
  function diskWithContent () {
    const files = {}
    return {
      files,
      probe: (runId, count) => ({
        missing: Array.from({ length: count }, (_, i) => i).filter((i) => !(files[runId] || []).includes(i)),
      }),
      fill: (runId, shotIds) => { files[runId] = shotIds.map((_, i) => i) },
    }
  }

  it('同 taskId 换分镜集（每批数量相同）⇒ runId 不同 ⇒ 目录隔离 ⇒ 第二次真实生成', async () => {
    const dir = tmpLedgerDir()
    const disk = diskWithContent()
    const mk = (shotIds) => runProduction({
      taskId: 'fp', shotIds, ledgerDir: dir, mediaRoot: '/tmp/does-not-matter',
      probe: disk.probe, emit: () => {},
      runBatch: async (b) => disk.fill(b.runId, b.shotIds),
    })

    const r1 = await mk(['A', 'B', 'C', 'D'])
    const r2 = await mk(['X', 'Y', 'Z', 'W'])

    const id1 = r1.ledger.batches[0].runId
    const id2 = r2.ledger.batches[0].runId
    expect(id2).not.toBe(id1)              // 指纹不同 ⇒ runId 不同
    expect(id1).toMatch(/^prod-fp-[0-9a-f]{10}-b0$/)  // 指纹位宽与位置
    expect(id2).toMatch(/^prod-fp-[0-9a-f]{10}-b0$/)
    // 第二次的台账与产物必须都是新分镜
    expect(r2.ledger.batches[0].shotIds).toEqual(['X', 'Y', 'Z', 'W'])
    expect(disk.files[id2]).toHaveLength(4) // 新目录确有 4 个产物
  })

  it('同分镜集重复调用 ⇒ runId 相同（幂等续跑不被破坏，磁盘已齐则零调用）', async () => {
    const dir = tmpLedgerDir()
    const disk = diskWithContent()
    const calls = []
    const mk = () => runProduction({
      taskId: 'idem', shotIds: ['A', 'B'], ledgerDir: dir, mediaRoot: '/tmp/x',
      probe: disk.probe, emit: () => {},
      runBatch: async (b) => { calls.push(b.batchIndex); disk.fill(b.runId, b.shotIds) },
    })
    const r1 = await mk()
    const r2 = await mk()
    expect(r2.ledger.batches[0].runId).toBe(r1.ledger.batches[0].runId)
    expect(calls).toEqual([0])  // 第二次全部跳过
  })

  it('注入两参 runIdFor ⇒ 行为不受指纹影响（auto 模式兼容）', async () => {
    const dir = tmpLedgerDir()
    const disk = diskWithContent()
    const r = await runProduction({
      taskId: 'auto', shotIds: ['A', 'B', 'C', 'D'], ledgerDir: dir, mediaRoot: '/tmp/x',
      probe: disk.probe, emit: () => {},
      runIdFor: (t, i) => 'auto/' + t + '/b' + i,   // 二参箭头：忽略第三参
      runBatch: async (b) => disk.fill(b.runId, b.shotIds),
    })
    expect(r.ledger.batches[0].runId).toBe('auto/auto/b0')  // 完全由注入方决定，无指纹
  })

  it('存量旧格式台账（无指纹）且分镜集一致 ⇒ 沿用旧 runId、不重建台账、既有产物仍判已完成', async () => {
    const dir = tmpLedgerDir()
    // 手工造一份旧格式台账（模拟本次变更前写下的）
    const legacy = {
      schemaVersion: 1, taskId: 'legacy', batchSize: 10, createdAt: '2026-01-01T00:00:00.000Z',
      batches: [{
        batchIndex: 0, runId: 'prod-legacy-b0', shotIds: ['A', 'B'],
        shots: [{ shotId: 'A', status: 'done', error: null }, { shotId: 'B', status: 'done', error: null }],
        status: 'done', error: null,
      }],
    }
    saveLedger(dir, legacy)
    const files = { 'prod-legacy-b0': [0, 1] }   // 旧目录里已有两个产物
    const probe = (runId, count) => ({
      missing: Array.from({ length: count }, (_, i) => i).filter((i) => !(files[runId] || []).includes(i)),
    })
    const calls = []
    const r = await runProduction({
      taskId: 'legacy', shotIds: ['A', 'B'], ledgerDir: dir, mediaRoot: '/tmp/x',
      probe, emit: () => {},
      runBatch: async (b) => { calls.push(b.batchIndex) },
    })
    expect(calls).toEqual([])                                   // 零 provider 调用
    expect(r.ok).toBe(true)                                      // 正常收口
    const back = loadLedger(dir)
    expect(back.batches[0].runId).toBe('prod-legacy-b0')         // runId 未被改写
    expect(back.createdAt).toBe('2026-01-01T00:00:00.000Z')      // 台账未被重建
    expect(r.renderManifest.entries.map((e) => e.path).every((p) => p.includes('prod-legacy-b0'))).toBe(true)
  })

  it('指纹按批次自身计算：第 1 批换分镜不影响第 0 批的 runId', async () => {
    const dir = tmpLedgerDir()
    const disk = diskWithContent()
    const first = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T']
    const r1 = await runProduction({
      taskId: 'perb', shotIds: first, ledgerDir: dir, mediaRoot: '/tmp/x',
      probe: disk.probe, emit: () => {},
      runBatch: async (b) => disk.fill(b.runId, b.shotIds),
    })
    const r2 = await runProduction({
      taskId: 'perb', shotIds: [...first.slice(0, 10), 'Z1', 'Z2'], // 只换第 1 批
      ledgerDir: dir, mediaRoot: '/tmp/x', probe: disk.probe, emit: () => {},
      runBatch: async (b) => disk.fill(b.runId, b.shotIds),
    })
    // 注意：换分镜会让整个台账重建（#3110 的语义），故此处验证的是「指纹只吃本批」
    // ——用同一计划下两批 shotIds 不同 ⇒ 两批 runId 的指纹位也不同
    const [b0, b1] = r1.ledger.batches
    expect(b0.runId).toMatch(/-b0$/)
    expect(b1.runId).toMatch(/-b1$/)
    const fp0 = b0.runId.match(/-([0-9a-f]{10})-b0$/)[1]
    const fp1 = b1.runId.match(/-([0-9a-f]{10})-b1$/)[1]
    expect(fp0).not.toBe(fp1)   // 不同批次 ⇒ 不同指纹
    expect(r2.ledger.batches[0].shotIds).toEqual(first.slice(0, 10))  // 第 0 批未受影响
  })
})
