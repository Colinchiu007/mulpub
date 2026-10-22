// @ts-check
/**
 * 发布进度的「无更新」派生层（UX 审计 1.8 / audit-15，ux-audit-stale-watchdog）
 *
 * 被测对象是 `publishProgressStall.js`，**不是** store —— 这是本批实现过程中改过一次的位置：
 * 第一版把这层写进 `publishProgress.js`，实测把 496 行的宿主推过 `check-debt-budget.js`
 * 的 ≥500 行熔断（FILES_OVER_500 96 > 95）。正解是把派生层搬出去（先例：同目录
 * `publishProgressSessionMerge.js`），而不是把基线调大。
 *
 * 修前的真实形态：store 在四处写 `task.lastEventAt`，**全仓零读取**；
 * `PublishProgressPanel.vue` 的关闭按钮是 `:disabled="store.hasRunning"`，
 * 而 hasRunning 只能被终态事件解除 ⇒ RPA 窗口挂死时事件永不到来，
 * 面板转圈、「勿关应用」、关闭按钮永久灰掉，用户只剩「取消全部」一条也可能挂死的路。
 *
 * 本文件把「lastEventAt 有了读者」钉成契约，并锁住四条最容易做错的边界：
 * ① 只读派生 —— 陈旧不得改写 phase（「没有新事件」不是失败的证据）；
 * ② 阈值边界（>= 的那一侧）与两路时钟同域；
 * ③ 定时器惰性、单实例、会自泊 —— 常驻 15s tick 会让每条路由都付它用不到的唤醒成本；
 * ④ tracker 按 store 实例缓存（模块级单例会跨实例泄漏定时器）。
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

describe('publishProgressStall — 无更新派生层（1.8）', () => {
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
    const stallMod = await import('./publishProgressStall')
    const store = mod.usePublishProgressStore()
    return { store, mod, stallMod, stall: stallMod.usePublishProgressStall(store) }
  }

  /**
   * 起墙钟。生产里这一步由面板 mount 完成（见 PublishProgressPanel.test.js 的生命周期用例），
   * store 级用例没有面板，所以必须显式调**同一个公共入口** —— 不得为了测试另开一条内部通道。
   * 这也是本层的一条真实契约：没有 tick ⇒ 分钟数不推进（读数只认 nowTs，见模块注释）。
   */
  function startClock (stall) {
    stall.beginStallClock()
    return stall
  }

  // ─── 1.1 阈值到界 ⇒ 判陈旧 ───────────────────────────────────
  it('无事件满 3 分钟 ⇒ 该任务进陈旧集合并给出分钟数', async () => {
    const { store, stall } = await makeStore()
    store.registerSession({ taskIds: ['t-1'], title: 'x' })
    startClock(stall)
    store.handleProgressEvent(progressEvent({ taskId: 't-1' }))
    expect(stall.stalledTaskIds, '刚收到事件不应陈旧').toEqual([])

    vi.advanceTimersByTime(3 * MIN)
    expect(stall.stalledTaskIds).toContain('t-1')
    expect(stall.hasStalledRunning).toBe(true)
    expect(stall.taskStallMinutes('t-1')).toBe(3)
  })

  // ─── 1.2 边界：未到阈值不判（把 >= 的那一侧钉住）─────────────
  it('差 1 毫秒到阈值不得判陈旧', async () => {
    const { store, stall } = await makeStore()
    store.registerSession({ taskIds: ['t-1'], title: 'x' })
    startClock(stall)
    store.handleProgressEvent(progressEvent({ taskId: 't-1' }))
    vi.advanceTimersByTime(3 * MIN - 1)
    expect(stall.stalledTaskIds).toEqual([])
    expect(stall.hasStalledRunning).toBe(false)
  })

  // ─── 1.3 新事件解除 ─────────────────────────────────────────
  it('随后再来一个事件必须刷新锚点并解除陈旧', async () => {
    const { store, stall } = await makeStore()
    store.registerSession({ taskIds: ['t-1'], title: 'x' })
    startClock(stall)
    store.handleProgressEvent(progressEvent({ taskId: 't-1' }))
    vi.advanceTimersByTime(4 * MIN)
    expect(stall.stalledTaskIds).toContain('t-1')

    store.handleProgressEvent(progressEvent({ taskId: 't-1', percent: 60 }))
    expect(stall.stalledTaskIds, '新事件后必须立刻不陈旧').toEqual([])
    expect(stall.taskStallMinutes('t-1')).toBe(0)
  })

  // ─── 1.4 只读派生：不得改写 phase / aggregate ────────────────
  it('陈旧是附加展示态：phase 与 aggregate 一律不得被改写成失败', async () => {
    const { store, stall } = await makeStore()
    store.registerSession({ taskIds: ['t-1'], title: 'x' })
    store.handleProgressEvent(progressEvent({ taskId: 't-1' }))
    startClock(stall)
    const before = store.sessions[0].tasks['t-1'].phase
    const failedBefore = store.aggregate.failed

    vi.advanceTimersByTime(10 * MIN)

    // ⚠ 顺序即判据：必须**先读 stalledTaskIds**，再断 phase。
    // 反证 S2 把 `task.phase='failed'` 写在它的求值路径里，
    // 若先断 phase 再读派生值，那次副作用发生在断言之后，锁就变成"抓不到自己声称的东西"（实测 PARTIAL_RED）。
    // 生产里渲染就是这个顺序（先算派生、再按 phase 上色），所以测试必须照这个次序排队。
    expect(stall.stalledTaskIds).toContain('t-1')
    expect(store.sessions[0].tasks['t-1'].phase, '「没有新事件」不是失败的证据').toBe(before)
    expect(store.aggregate.failed).toBe(failedBefore)
  })

  // ─── 1.5 终态不参与 ─────────────────────────────────────────
  it('终态任务即便超过阈值也不得进陈旧集合', async () => {
    const { store, stall } = await makeStore()
    store.registerSession({ taskIds: ['t-1', 't-2'], title: 'x' })
    store.handleProgressEvent(progressEvent({ taskId: 't-1', phase: 'success', stageKey: 'done', percent: 100 }))
    startClock(stall)
    store.handleProgressEvent(progressEvent({ taskId: 't-2' }))

    vi.advanceTimersByTime(5 * MIN)

    expect(stall.stalledTaskIds, 't-1 已终态，不得显示无更新').toEqual(['t-2'])
    expect(stall.hasStalledRunning).toBe(true)
  })

  // ─── 1.6 混合态不得解禁 ─────────────────────────────────────
  it('部分陈旧 + 部分在动 ⇒ hasStalledRunning 必须为 false（还有在动的就不许关）', async () => {
    const { store, stall } = await makeStore()
    store.registerSession({ taskIds: ['t-1', 't-2'], title: 'x' })
    startClock(stall)
    store.handleProgressEvent(progressEvent({ taskId: 't-1' }))
    vi.advanceTimersByTime(4 * MIN)
    // t-2 的锚点是"现在"，t-1 已经 4 分钟没动
    store.handleProgressEvent(progressEvent({ taskId: 't-2' }))

    expect(stall.stalledTaskIds).toEqual(['t-1'])
    expect(stall.hasStalledRunning, '只要还有未陈旧的任务就不得解禁关闭').toBe(false)
  })

  // ─── 1.7 定时器生命周期 ─────────────────────────────────────
  it('begin 后恰好 1 个 tick；仍有非终态任务不得停，全部终态后一个 tick 内自泊', async () => {
    const { store, stall, stallMod } = await makeStore()
    store.registerSession({ taskIds: ['t-1'], title: 'x' })
    store.handleProgressEvent(progressEvent({ taskId: 't-1' }))

    stall.beginStallClock()
    expect(liveTimers.size, '显式 begin ⇒ 起一个 tick').toBe(1)

    vi.advanceTimersByTime(stallMod.STALL_TICK_MS)
    expect(liveTimers.size, '任务仍在跑 ⇒ tick 不得自泊').toBe(1)

    store.handleProgressEvent(progressEvent({ taskId: 't-1', phase: 'success', stageKey: 'done', percent: 100 }))
    vi.advanceTimersByTime(stallMod.STALL_TICK_MS)
    expect(liveTimers.size, '全部终态 ⇒ tick 必须自泊，不给每条路由留白唤醒').toBe(0)
  })

  it('重复 begin 不得叠加第二个定时器；end 必须真的交还句柄（同 autoUpdater 教训）', async () => {
    const { store, stall } = await makeStore()
    store.registerSession({ taskIds: ['t-1'], title: 'x' })
    store.handleProgressEvent(progressEvent({ taskId: 't-1' }))

    stall.beginStallClock()
    stall.beginStallClock()
    stall.beginStallClock()
    expect(liveTimers.size, '活跃 tick 必须恰好 1 个').toBe(1)

    stall.endStallClock()
    expect(liveTimers.size, '宿主卸载必须能把定时器交还').toBe(0)
    stall.endStallClock()
    expect(liveTimers.size, '重复 end 不得报错也不得复活').toBe(0)
  })

  it('面板反复挂载不得各起一个 tracker：同一 store 实例返回同一份派生态', async () => {
    const { store, stallMod } = await makeStore()
    const first = stallMod.usePublishProgressStall(store)
    const second = stallMod.usePublishProgressStall(store)
    expect(second, 'Panel 与 Session 必须共用同一个时钟（否则同一分钟数两份真相）').toBe(first)
    expect(liveTimers.size, '取用本身不得起定时器 —— 只有宿主 begin 才起').toBe(0)
  })

  it('陈旧判定两路时钟同域：读的是 Date.now()，不是事件带来的主进程时间戳', async () => {
    const { store, stall, stallMod } = await makeStore()
    // 事件里带一个"很久以前"的主进程 timestamp —— 不得拿它当锚点（跨域比较）
    store.registerSession({ taskIds: ['t-1'], title: 'x' })
    startClock(stall)
    store.handleProgressEvent(progressEvent({ taskId: 't-1', timestamp: 1_600_000_000_000 }))
    expect(stall.stalledTaskIds, '锚点必须是渲染端 Date.now() 写的 lastEventAt').toEqual([])

    vi.advanceTimersByTime(3 * MIN)
    expect(stall.stalledTaskIds).toEqual(['t-1'])
    expect(stallMod.STALL_AFTER_MS).toBe(3 * MIN)
  })
})
