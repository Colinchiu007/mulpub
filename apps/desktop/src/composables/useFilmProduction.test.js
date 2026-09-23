// @ts-check
/**
 * useFilmProduction — 全量分批出片前端驱动契约测试（tasks 8.1-8.4，design D6/D9/D10）
 *
 * 合同：
 *   - 8.1 planProduction 只读预览（批次数/镜数/估算），浏览器无 API 降级 noDesktop；
 *   - 8.2 逐批确认：确认后才有 run-batch 调用（确认前零调用）；累计已确认镜数/剩余批次数派生；
 *   - 批后以 production-status 双核重同步（就地 mutate，batches 数组引用不变——展开态保持）；
 *   - 进度事件计数单调不回退；batch 事件就地更新状态；
 *   - 8.3 resume 断点恢复（noLedger / pending 批恢复 / manifest 直达收口）；
 *     retryShotInBatch runId=prod-<taskId>-b<idx> 派生（不携带 prompt）；
 *     recycleAll 分片 ≤50 且 orderIndex 全局连续；
 *   - composeFinal manifest 直通 run → completed finalPath；
 *   - 8.4 dispose 清理 production/pipeline 双订阅。
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const fe = vi.hoisted(() => ({
  current: /** @type {any} */ (null),
}))

vi.mock('@/api/electron-bridge', () => ({
  getApi: () => (fe.current ? { filmEngineering: fe.current } : null),
}))

const publisher = vi.hoisted(() => ({
  pipelineStartOrchestrated: vi.fn(),
  pipelineGetRunContext: vi.fn(),
  onPipelineUpdate: vi.fn(() => () => {}),
  filmEngineeringRetryShot: vi.fn(),
}))

vi.mock('@/api/publisher', () => publisher)

import { useFilmProduction } from './useFilmProduction'

const IDS = Array.from({ length: 21 }, (_, i) => 's-' + i)
const PLAN = {
  shotCount: 21, batchSize: 10, batchCount: 3,
  batches: [{ batchIndex: 0, shotCount: 10 }, { batchIndex: 1, shotCount: 10 }, { batchIndex: 2, shotCount: 1 }],
  diskEstimateBytes: 21 * 8 * 1024 * 1024, wallclockEstimateSeconds: 21 * 300,
  mediaRoot: 'C:/media/film-engineering',
}

function statusOf (statuses, manifest = null, manifestError = null) {
  return {
    exists: true, taskId: 't1',
    batches: PLAN.batches.map((b, i) => ({
      batchIndex: b.batchIndex, status: statuses[i], error: null,
      needRun: statuses[i] === 'pending',
      shots: Array.from({ length: b.shotCount }, (_, k) => ({ shotIndex: k, shotId: 'x', status: statuses[i] === 'done' ? 'done' : 'pending' })),
    })),
    doneCount: statuses.reduce((n, s, i) => n + (s === 'done' ? PLAN.batches[i].shotCount : 0), 0),
    totalCount: 21, renderManifest: manifest, manifestError,
  }
}

function makeApi (over = {}) {
  return {
    productionPlan: vi.fn(async () => ({ code: 0, data: PLAN })),
    productionRunBatch: vi.fn(async () => ({ code: 0, data: { ok: false, batchIndex: 0, batchStatus: 'done', batchError: null, failedBatches: [], renderManifest: null, manifestError: null } })),
    productionStatus: vi.fn(async () => ({ code: 0, data: statusOf(['done', 'pending', 'pending']) })),
    downloadRecycled: vi.fn(async () => ({ code: 0, data: { results: [], allOk: true, destDir: 'D:/r' } })),
    onProductionUpdate: vi.fn(() => { fe.unsub = vi.fn(); return fe.unsub }),
    ...over,
  }
}

describe('useFilmProduction', () => {
  beforeEach(() => { vi.clearAllMocks(); fe.unsub = null })
  afterEach(() => { vi.unstubAllGlobals() })

  it('8.1 planProduction 成功：phase=plan-ready，估算透传，totalCount=镜数', async () => {
    fe.current = makeApi()
    const c = useFilmProduction()
    const r = await c.planProduction(IDS)
    expect(r.ok).toBe(true)
    expect(c.phase.value).toBe('plan-ready')
    expect(c.plan.value.batchCount).toBe(3)
    expect(c.progress.value.totalCount).toBe(21)
    // 只读预览：零 run-batch 调用
    expect(fe.current.productionRunBatch).not.toHaveBeenCalled()
  })

  it('无桌面 API / 空选择：降级 noDesktop / noShots', async () => {
    fe.current = null
    const c = useFilmProduction()
    expect((await c.planProduction(IDS)).errorCode).toBe('noDesktop')
    fe.current = makeApi()
    expect((await c.planProduction([])).errorCode).toBe('noShots')
  })

  it('begin 守卫：无 plan / 无 taskId 拒绝；成功后批视图实例化并订阅进度事件', async () => {
    fe.current = makeApi()
    const c = useFilmProduction()
    expect(c.begin('t1').errorCode).toBe('noPlan')
    await c.planProduction(IDS)
    expect(c.begin('  ').errorCode).toBe('noTaskId')
    const r = c.begin('t1')
    expect(r.ok).toBe(true)
    expect(c.phase.value).toBe('batching')
    expect(c.batches.value.map((b) => b.status)).toEqual(['pending', 'pending', 'pending'])
    expect(fe.current.onProductionUpdate).toHaveBeenCalledTimes(1)
    c.dispose()
  })

  it('8.2 confirmBatch：确认后单批 run-batch（负载含 taskId/batchIndex/aspect/seconds），批后 status 双核重同步', async () => {
    fe.current = makeApi()
    const c = useFilmProduction()
    await c.planProduction(IDS)
    c.begin('t1')
    const arr = c.batches.value
    const r = await c.confirmBatch(0)
    expect(r.ok).toBe(true)
    expect(fe.current.productionRunBatch).toHaveBeenCalledTimes(1)
    const payload = fe.current.productionRunBatch.mock.calls[0][0]
    expect(payload.taskId).toBe('t1')
    expect(payload.batchIndex).toBe(0)
    expect(payload.shotIds).toEqual(IDS)
    expect(payload.aspect).toBe('16x9')
    expect(c.batches.value[0].status).toBe('done')
    expect(c.batches.value[0].doneShots).toBe(10)
    // 就地 mutate：数组引用不变（展开态不重置的机制前提）
    expect(c.batches.value).toBe(arr)
    expect(c.confirmedShotCount.value).toBe(10)
    expect(c.remainingBatchCount.value).toBe(2)
    c.dispose()
  })

  it('8.2 provider 未配置信封：errorCode 透出，phase 留 batching（该批可修正后重确认）', async () => {
    fe.current = makeApi({
      productionRunBatch: vi.fn(async () => ({ code: -1, errorCode: 'VIDEO_MODEL_NOT_CONFIGURED', message: '需要视频模型' })),
    })
    const c = useFilmProduction()
    await c.planProduction(IDS)
    c.begin('t1')
    const r = await c.confirmBatch(0)
    expect(r.ok).toBe(false)
    expect(r.errorCode).toBe('VIDEO_MODEL_NOT_CONFIGURED')
    expect(c.errorCode.value).toBe('VIDEO_MODEL_NOT_CONFIGURED')
    expect(c.phase.value).toBe('batching')
    c.dispose()
  })

  it('收口：run-batch 返回 renderManifest → phase=manifest-ready', async () => {
    const manifest = IDS.map((shotId, i) => ({ shotId, path: '/x/shot_' + i + '.mp4', sourceKind: 'generated', orderIndex: i }))
    fe.current = makeApi({
      productionRunBatch: vi.fn(async () => ({ code: 0, data: { ok: true, batchIndex: 2, batchStatus: 'done', batchError: null, failedBatches: [], renderManifest: manifest, manifestError: null } })),
      productionStatus: vi.fn(async () => ({ code: 0, data: statusOf(['done', 'done', 'done'], manifest) })),
    })
    const c = useFilmProduction()
    await c.planProduction(IDS)
    c.begin('t1')
    await c.confirmBatch(2)
    expect(c.phase.value).toBe('manifest-ready')
    expect(c.renderManifest.value.length).toBe(21)
    c.dispose()
  })

  it('8.4 进度事件：计数单调不回退；batch 事件就地更新；负载不触发数组重建', async () => {
    fe.current = makeApi()
    const c = useFilmProduction()
    await c.planProduction(IDS)
    c.begin('t1')
    const arr = c.batches.value
    const cb = fe.current.onProductionUpdate.mock.calls[0][0]
    cb({ type: 'production:shot-progress', doneCount: 15, totalCount: 21 })
    expect(c.progress.value.doneCount).toBe(15)
    cb({ type: 'production:shot-progress', doneCount: 12, totalCount: 21 })
    expect(c.progress.value.doneCount).toBe(15)
    cb({ type: 'production:batch', batchIndex: 1, status: 'running', doneCount: 15, totalCount: 21 })
    expect(c.batches.value[1].status).toBe('running')
    expect(c.batches.value).toBe(arr)
    cb(null)
    cb({})
    expect(c.batches.value).toBe(arr)
    c.dispose()
  })

  it('8.3 resume：无台账 noLedger；有台账恢复批视图；manifest 齐直达 manifest-ready', async () => {
    fe.current = makeApi({ productionStatus: vi.fn(async () => ({ code: 0, data: { exists: false, batches: [], doneCount: 0, totalCount: 21, renderManifest: null } })) })
    const c = useFilmProduction()
    expect((await c.resume('t1', IDS)).errorCode).toBe('noLedger')
    c.dispose()
    const manifest = [{ shotId: 's-0', path: '/x/shot_000.mp4', sourceKind: 'generated', orderIndex: 0 }]
    fe.current = makeApi({ productionStatus: vi.fn(async () => ({ code: 0, data: statusOf(['done', 'done', 'done'], manifest) })) })
    const c2 = useFilmProduction()
    const r = await c2.resume('t1', IDS)
    expect(r.ok).toBe(true)
    expect(c2.phase.value).toBe('manifest-ready')
    expect(c2.batches.value.map((b) => b.status)).toEqual(['done', 'done', 'done'])
    expect(c2.progress.value.doneCount).toBe(21)
    c2.dispose()
  })

  it('8.3 retryShotInBatch：runId 确定性派生 prod-<taskId>-b<idx>，不携带 prompt；成功后双核', async () => {
    publisher.filmEngineeringRetryShot.mockResolvedValue({ code: 0, data: { success: true } })
    fe.current = makeApi()
    const c = useFilmProduction()
    await c.planProduction(IDS)
    c.begin('t1')
    const r = await c.retryShotInBatch(2, 0)
    expect(r.ok).toBe(true)
    const p = publisher.filmEngineeringRetryShot.mock.calls[0][0]
    expect(p.runId).toBe('prod-t1-b2')
    expect(p.shotIndex).toBe(0)
    expect(p.prompt).toBeUndefined()
    expect(fe.current.productionStatus).toHaveBeenCalled()
    c.dispose()
  })

  it('D10 recycleAll：120 镜分 3 片（≤50），orderIndex 全局连续，聚合结果', async () => {
    const many = Array.from({ length: 120 }, (_, i) => 'm-' + i)
    fe.current = makeApi({
      productionPlan: vi.fn(async () => ({ code: 0, data: { ...PLAN, shotCount: 120 } })),
      downloadRecycled: vi.fn(async ({ items }) => ({
        code: 0,
        data: { results: items.map((it) => ({ shotId: it.shotId, orderIndex: it.orderIndex, ok: true, entry: {} })), allOk: true, destDir: 'D:/recycled' },
      })),
    })
    const c = useFilmProduction()
    await c.planProduction(many)
    c.begin('t1')
    const r = await c.recycleAll()
    expect(r.ok).toBe(true)
    expect(r.okCount).toBe(120)
    expect(fe.current.downloadRecycled).toHaveBeenCalledTimes(3)
    const last = fe.current.downloadRecycled.mock.calls[2][0]
    expect(last.items.length).toBe(20)
    expect(last.items[0].orderIndex).toBe(100)
    expect(c.recycled.value.destDir).toBe('D:/recycled')
    c.dispose()
  })

  it('composeFinal：manifest 直通 run 启动 → completed 快照 → done + finalPath；无 manifest 拒绝', async () => {
    publisher.pipelineStartOrchestrated.mockResolvedValue({ code: 0, data: { success: true, runId: 'run-compose' } })
    publisher.onPipelineUpdate.mockImplementation((cb) => {
      fe.composeCb = cb
      return vi.fn()
    })
    fe.current = makeApi()
    const c = useFilmProduction()
    expect((await c.composeFinal()).errorCode).toBe('noManifest')
    c.renderManifest.value = [{ shotId: 's-0', path: '/x/shot_000.mp4', sourceKind: 'generated', orderIndex: 0 }]
    const r = await c.composeFinal()
    expect(r.ok).toBe(true)
    expect(publisher.pipelineStartOrchestrated.mock.calls[0][1].initialContext.renderManifest.length).toBe(1)
    expect(c.phase.value).toBe('composing')
    fe.composeCb({ runId: 'other', status: { status: 'running' } }) // 串扰守卫
    expect(c.phase.value).toBe('composing')
    fe.composeCb({ runId: 'run-compose', status: { status: 'completed' }, context: { render: { finalPath: 'D:/out/final.mp4' } } })
    expect(c.phase.value).toBe('done')
    expect(c.finalPath.value).toBe('D:/out/final.mp4')
    c.dispose()
  })

  it('8.4 dispose：production/pipeline 双订阅全部清理', async () => {
    const unsubProd = vi.fn()
    const unsubPipe = vi.fn()
    publisher.onPipelineUpdate.mockReturnValue(unsubPipe)
    publisher.pipelineStartOrchestrated.mockResolvedValue({ code: 0, data: { success: true, runId: 'rc' } })
    fe.current = makeApi({ onProductionUpdate: vi.fn(() => unsubProd) })
    const c = useFilmProduction()
    await c.planProduction(IDS)
    c.begin('t1')
    // pipeline 订阅在 composeFinal 建立——双订阅需先合成再卸载
    c.renderManifest.value = [{ shotId: 's-0', path: '/x/shot_000.mp4', sourceKind: 'generated', orderIndex: 0 }]
    await c.composeFinal()
    c.dispose()
    expect(unsubProd).toHaveBeenCalled()
    expect(unsubPipe).toHaveBeenCalled()
    // dispose 后事件被忽略
    const cb = fe.current.onProductionUpdate.mock.calls[0][0]
    cb({ type: 'production:shot-progress', doneCount: 99, totalCount: 21 })
    expect(c.progress.value.doneCount).toBe(0)
  })

  it('finalize：未收口 notConverged 并透出 manifestError', async () => {
    fe.current = makeApi({
      productionStatus: vi.fn(async () => ({ code: 0, data: statusOf(['done', 'done', 'done'], null, '缺 2 镜：b2#0,b2#1') })),
    })
    const c = useFilmProduction()
    await c.planProduction(IDS)
    c.begin('t1')
    const r = await c.finalize()
    expect(r.ok).toBe(false)
    expect(r.errorCode).toBe('notConverged')
    expect(c.manifestError.value).toContain('缺 2 镜')
    c.dispose()
  })
})
