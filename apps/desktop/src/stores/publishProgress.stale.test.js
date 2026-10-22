// @ts-check
/**
 * publishProgress 的「无更新」派生层（UX 审计 1.8 / audit-15，ux-audit-stale-watchdog）
 *
 * 修前的真实形态：store 在四处写 `task.lastEventAt`，**全仓零读取**；
 * `PublishProgressPanel.vue:36` 的关闭按钮是 `:disabled="store.hasRunning"`，
 * 而 hasRunning 只能被终态事件解除 ⇒ RPA 窗口挂死时事件永不到来，
 * 面板转圈、「勿关应用」、关闭按钮永久灰掉，用户只剩「取消全部」一条也可能挂死的路。
 *
 * 本文件把「lastEventAt 有了读者」钉成契约，并锁住两条最容易做错的边界：
 * ① 只读派生 —— 陈旧不得改写 phase（「没有新事件」不是失败的证据）；
 * ② 定时器惰性且单实例 —— 常驻 15s tick 会让每条路由都付它用不到的唤醒成本。
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

const mockOnProgress = vi.hoisted(() => vi.fn())
const mockOnBatchProgress = vi.hoisted(() => vi.fn())
const mockGetQueueStatus = vi.hoisted(() => vi.fn())
const mockRetryTask = vi.hoisted(() => vi.fn())
const mockCancelTask = vi.hoisted(() => vi.fn())

vi.mock('@/api/publisher', () => ({
  onProgress: (...args) => mockOnProgress(...args),
  onBatchProgress: (...args) => mockOnBatchProgress(...args),
  getQueueStatus: (...args) => mockGetQueueStatus(...args),
  retryTask: (...args) => mockRetryTask(...args),
  cancelTask: (...args) => mockCancelTask(...args),
}))

function progressEvent(overrides = {}) {
  return {
    platform: 'douyin',
    taskId: 'task-1',
    stage: 'uploading video...',
    phase: 'progress',
    stageKey: 'upload',
    percent: 20,
    batchId: null,
    ...overrides,
  }
}

const MIN = 60000

describe('publishProgress store — 无更新派生层（1.8）', () => {
  /** 活跃 tick 计数：数"当前活着的 setInterval"，不是"调用过几次 setInterval" */
  let liveTimers
  let realSetInterval
  let realClearInterval

  beforeEach(async () => {
    setActivePinia(createPinia())
    mockOnProgress.mockReset()
    mockOnBatchProgress.mockReset()
    mockGetQueueStatus.mockReset()
    mockRetryTask.mockReset()
    mockCancelTask.mockReset()
    mockOnProgress.mockReturnValue(() => {})
    mockOnBatchProgress.mockReturnValue(() => {})
    mockGetQueueStatus.mockResolvedValue({ code: 0, data: { running: [], queue: [] } })
    window.localStorage.clear()

    vi.useFakeTimers({ now: new Date('2026-10-22T00:00:00Z').getTime() })

    liveTimers = new Set()
    realSetInterval = globalThis.setInterval
    realClearInterval = globalThis.clearInterval
    globalThis.setInterval = (fn, ms, ...rest) => {
      const id = realSetInterval(fn, ms, ...rest)
      liveTimers.add(id)
      return id
    }
    globalThis.clearInterval = (id) => {
      liveTimers.delete(id)
      return realClearInterval(id)
    }
  })

  afterEach(() => {
    globalThis.setInterval = realSetInterval
    globalThis.clearInterval = realClearInterval
    liveTimers = null
    vi.useRealTimers()
  })

  async function makeStore() {
    const mod = await import('./publishProgress')
    return { store: mod.usePublishProgressStore(), mod }
  }

  // ─── 1.1 阈值到界 ⇒ 判陈旧 ───────────────────────────────────
  it('无事件满 3 分钟 ⇒ 该任务进陈旧集合并给出分钟数', async () => {
    const { store } = await makeStore()
    store.registerSession({ taskIds: ['t-1'], title: 'x' })
    store.handleProgressEvent(progressEvent({ taskId: 't-1' }))
    expect(store.stalledTaskIds, '刚收到事件不应陈旧').toEqual([])

    vi.advanceTimersByTime(3 * MIN)
    expect(store.stalledTaskIds).toContain('t-1')
    expect(store.hasStalledRunning).toBe(true)
    expect(store.taskStallMinutes('t-1')).toBe(3)
  })

  // ─── 1.2 边界：未到阈值不判（把 >= 的那一侧钉住）─────────────
  it('差 1 毫秒到阈值不得判陈旧', async () => {
    const { store } = await makeStore()
    store.registerSession({ taskIds: ['t-1'], title: 'x' })
    store.handleProgressEvent(progressEvent({ taskId: 't-1' }))
    vi.advanceTimersByTime(3 * MIN - 1)
    expect(store.stalledTaskIds).toEqual([])
    expect(store.hasStalledRunning).toBe(false)
  })

  // ─── 1.3 新事件解除 ─────────────────────────────────────────
  it('随后再来一个事件必须刷新锚点并解除陈旧', async () => {
    const { store } = await makeStore()
    store.registerSession({ taskIds: ['t-1'], title: 'x' })
    store.handleProgressEvent(progressEvent({ taskId: 't-1' }))
    vi.advanceTimersByTime(4 * MIN)
    expect(store.stalledTaskIds).toContain('t-1')

    store.handleProgressEvent(progressEvent({ taskId: 't-1', percent: 60 }))
    expect(store.stalledTaskIds, '新事件后必须立刻不陈旧').toEqual([])
    expect(store.taskStallMinutes('t-1')).toBe(0)
  })

  // ─── 1.4 只读派生：不得改写 phase / aggregate ────────────────
  it('陈旧是附加展示态：phase 与 aggregate 一律不得被改写成失败', async () => {
    const { store } = await makeStore()
    store.registerSession({ taskIds: ['t-1'], title: 'x' })
    store.handleProgressEvent(progressEvent({ taskId: 't-1' }))
    const before = store.sessions[0].tasks['t-1'].phase
    const failedBefore = store.aggregate.failed

    vi.advanceTimersByTime(10 * MIN)

    // ⚠ 顺序即判据：必须**先读 stalledTaskIds**，再断 phase。
    // `stalledTaskIds` 是 computed —— 反证 S2 把 `task.phase='failed'` 写在它的求值路径里，
    // 若先断 phase 再读派生值，那次副作用发生在断言之后，锁就变成"抓不到自己声称的东西"（实测 PARTIAL_RED）。
    // 生产里渲染就是这个顺序（先算派生、再按 phase 上色），所以测试必须照这个次序排队。
    expect(store.stalledTaskIds).toContain('t-1')
    expect(store.sessions[0].tasks['t-1'].phase, '「没有新事件」不是失败的证据').toBe(before)
    expect(store.aggregate.failed).toBe(failedBefore)
  })

  // ─── 1.5 终态不参与 ─────────────────────────────────────────
  it('终态任务即便超过阈值也不得进陈旧集合', async () => {
    const { store } = await makeStore()
    store.registerSession({ taskIds: ['t-1', 't-2'], title: 'x' })
    store.handleProgressEvent(progressEvent({ taskId: 't-1', phase: 'success', stageKey: 'done', percent: 100 }))
    store.handleProgressEvent(progressEvent({ taskId: 't-2' }))

    vi.advanceTimersByTime(5 * MIN)

    expect(store.stalledTaskIds, 't-1 已终态，不得显示无更新').toEqual(['t-2'])
    expect(store.hasStalledRunning).toBe(true)
  })

  // ─── 1.6 混合态不得解禁 ─────────────────────────────────────
  it('部分陈旧 + 部分在动 ⇒ hasStalledRunning 必须为 false（还有在动的就不许关）', async () => {
    const { store } = await makeStore()
    store.registerSession({ taskIds: ['t-1', 't-2'], title: 'x' })
    store.handleProgressEvent(progressEvent({ taskId: 't-1' }))
    vi.advanceTimersByTime(4 * MIN)
    // t-2 的锚点是"现在"，t-1 已经 4 分钟没动
    store.handleProgressEvent(progressEvent({ taskId: 't-2' }))

    expect(store.stalledTaskIds).toEqual(['t-1'])
    expect(store.hasStalledRunning, '只要还有未陈旧的任务就不得解禁关闭').toBe(false)
  })

  // ─── 1.7 定时器生命周期 ─────────────────────────────────────
  it('有 running 时恰好 1 个 tick；全部终态后必须停掉', async () => {
    const { store } = await makeStore()
    store.registerSession({ taskIds: ['t-1'], title: 'x' })
    store.handleProgressEvent(progressEvent({ taskId: 't-1' }))
    expect(liveTimers.size, '存在非终态任务 ⇒ 需要 tick 推进墙钟').toBe(1)

    store.handleProgressEvent(progressEvent({ taskId: 't-1', phase: 'success', stageKey: 'done', percent: 100 }))
    expect(liveTimers.size, '全部终态 ⇒ tick 必须停').toBe(0)
  })

  it('重复 init() 不得叠加第二个定时器（进程级单例教训同 autoUpdater）', async () => {
    const { store } = await makeStore()
    store.init()
    store.init()
    store.registerSession({ taskIds: ['t-1'], title: 'x' })
    store.handleProgressEvent(progressEvent({ taskId: 't-1' }))
    expect(liveTimers.size, '活跃 tick 必须恰好 1 个').toBe(1)
  })

  it('陈旧判定两路时钟同域：读的是 Date.now()，不是事件带来的主进程时间戳', async () => {
    const { store, mod } = await makeStore()
    // 事件里带一个"很久以前"的主进程 timestamp —— 不得拿它当锚点（跨域比较）
    store.registerSession({ taskIds: ['t-1'], title: 'x' })
    store.handleProgressEvent(progressEvent({ taskId: 't-1', timestamp: 1_600_000_000_000 }))
    expect(store.stalledTaskIds, '锚点必须是渲染端 Date.now() 写的 lastEventAt').toEqual([])

    vi.advanceTimersByTime(3 * MIN)
    expect(store.stalledTaskIds).toEqual(['t-1'])
    expect(mod.STALL_AFTER_MS).toBe(3 * MIN)
  })
})
