// @ts-check
/**
 * 发布进度的「无更新」派生层（UX 审计 1.8 / audit-15，ux-audit-stale-watchdog）
 *
 * 被测对象是 `publishProgressStall.js`，**不是** store —— 这是本批实现过程中改过一次的位置：
 * 第一版把这层写进 `publishProgress.js`，实测把 496 行的宿主推过 `check-debt-budget.js`
 * 的 ≥500 行熔断（FILES_OVER_500 96 > 95）。正解是把代码搬出去（先例：同目录
 * `publishProgressSessionMerge.js`），而不是把基线调大。
 *
 * 修前的真实形态：store 在四处写 `task.lastEventAt`，**全仓零读取**；
 * `PublishProgressPanel.vue` 的关闭按钮是 `:disabled="store.hasRunning"`，
 * 而 hasRunning 只能被终态事件解除 ⇒ RPA 窗口挂死时事件永不到来，
 * 面板转圈、「勿关应用」、关闭按钮永久灰掉，用户只剩「取消全部」一条也可能挂死的路。
 *
 * 本文件把「lastEventAt 有了读者」钉成契约，并锁住六条最容易做错的边界：
 * ① 只读派生 —— 陈旧不得改写 phase（「没有新事件」不是失败的证据）；
 * ② 阈值边界两侧（179999 不判 / 180000 判）与两路时钟同域；
 * ③ 「按设计就静默」的相位（blocked / captcha）不得被判无更新；
 * ④ 定时器惰性、单实例、零 live 不建表、会自泊；
 * ⑤ tracker 按 store 实例缓存（模块级单例会跨实例泄漏定时器）；
 * ⑥ 多会话：任务落在第 2+ 个会话也必须出自己的分钟数（QM-6 第一轮 i1 Critical）。
 *
 * ⚠ 顺序契约：所有用例都按**生产时序**排队 ——
 * 登记 → 事件 → `startClock`（面板挂载/`watch(sessions.length)` 就是在这个时点叫表）→ 推进假时钟。
 * `beginStallClock()` 在没有非终态任务时刻意不建表（QM-6 第二轮 i2，spec「无运行中任务 ⇒ tick MUST 已停止」），
 * 所以把 startClock 提到登记之前会让整组用例的时钟永不推进 —— 那是**实现的行为**，不是测试写法自由。
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
  /** 本用例起过表的 tracker —— afterEach 一律收尾（QM-6 第一轮 i8） */
  let started

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
    started = []
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
    // QM-6 i8：用例之间不得留活着的 ticker。收尾必须发生在**还原 globalThis 之前**——
    // clearInterval 换成真的那一个之后，fake 句柄删不掉，活跃集合会跨用例累积，
    // 而现在所有断言只看本用例自己的 liveTimers，正好看不见它（靠测试编排顺序兜住的隐性泄漏）。
    for (const s of started) s.endStallClock()
    expect(liveTimers.size, '用例结束时活跃 tick 必须为 0').toBe(0)
    started = []
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
   * 起墙钟。生产里这一步由面板完成（挂载 + `watch(hasRunning / sessions.length)`），
   * store 级用例没有面板，所以显式调**同一个公共入口**，不得为测试另开内部通道。
   */
  function startClock (stall) {
    stall.beginStallClock()
    started.push(stall)
    return stall
  }

  // ─── 1.1 阈值到界 ⇒ 判陈旧 ───────────────────────────────────
  it('无事件满 3 分钟 ⇒ 该任务进陈旧集合并给出分钟数', async () => {
    const { store, stall } = await makeStore()
    store.registerSession({ taskIds: ['t-1'], title: 'x' })
    store.handleProgressEvent(progressEvent({ taskId: 't-1' }))
    startClock(stall)
    expect(stall.stalledTaskIds, '刚收到事件不应陈旧').toEqual([])

    vi.advanceTimersByTime(3 * MIN)
    expect(stall.stalledTaskIds).toContain('t-1')
    expect(stall.hasStalledRunning).toBe(true)
    expect(stall.taskStallMinutes('t-1')).toBe(3)
  })

  // ─── 1.2 边界：两侧都要真的踩到（QM-6 第一轮 i4）────────────
  it('差 1 毫秒不得判陈旧、到点必须判（边界由 end+begin 重新盖章精确命中）', async () => {
    const { store, stall } = await makeStore()
    store.registerSession({ taskIds: ['t-1'], title: 'x' })
    store.handleProgressEvent(progressEvent({ taskId: 't-1' }))
    startClock(stall)

    // 原先这条只写 advanceTimersByTime(3*MIN - 1) 就声称"差 1 毫秒"，但读数只随 15s tick 推进：
    // 最后一格落在 165000 ⇒ 实际比的是 165000 vs 180000，**根本没碰到 179999 那一侧**，
    // 边界契约是虚的。现在用公共出口把钟精确盖章（end 停机 + begin 重新盖章 = nowTs 取当场时钟）。
    vi.advanceTimersByTime(3 * MIN - 1)
    stall.endStallClock()
    stall.beginStallClock()
    expect(stall.stalledTaskIds, '179999ms 不得判陈旧').toEqual([])
    expect(stall.hasStalledRunning).toBe(false)

    vi.advanceTimersByTime(1)
    stall.endStallClock()
    stall.beginStallClock()
    expect(stall.stalledTaskIds, '180000ms 必须判陈旧（钉住 >= 的那一侧）').toEqual(['t-1'])
    expect(stall.hasStalledRunning).toBe(true)
  })

  // ─── 1.3 新事件解除 ─────────────────────────────────────────
  it('随后再来一个事件必须刷新锚点并解除陈旧', async () => {
    const { store, stall } = await makeStore()
    store.registerSession({ taskIds: ['t-1'], title: 'x' })
    store.handleProgressEvent(progressEvent({ taskId: 't-1' }))
    startClock(stall)
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
    store.handleProgressEvent(progressEvent({ taskId: 't-2' }))
    startClock(stall)

    vi.advanceTimersByTime(5 * MIN)

    expect(stall.stalledTaskIds, 't-1 已终态，不得显示无更新').toEqual(['t-2'])
    expect(stall.hasStalledRunning).toBe(true)
  })

  // ─── 1.6 混合态不得解禁 ─────────────────────────────────────
  it('部分陈旧 + 部分在动 ⇒ hasStalledRunning 必须为 false（还有在动的就不许关）', async () => {
    const { store, stall } = await makeStore()
    store.registerSession({ taskIds: ['t-1', 't-2'], title: 'x' })
    store.handleProgressEvent(progressEvent({ taskId: 't-1' }))
    vi.advanceTimersByTime(4 * MIN)
    // t-2 的锚点是"现在"，t-1 已经 4 分钟没动
    store.handleProgressEvent(progressEvent({ taskId: 't-2' }))
    startClock(stall)

    expect(stall.stalledTaskIds).toEqual(['t-1'])
    expect(stall.hasStalledRunning, '只要还有未陈旧的任务就不得解禁关闭').toBe(false)
  })

  // ─── 1.6b 多会话（QM-6 第一轮 i1 Critical）─────────────────
  it('第 2 个会话里的陈旧任务也必须给出分钟数（QM-6 i1 Critical）', async () => {
    const { store, stall } = await makeStore()
    // 本 store 支持多会话（MAX_SESSIONS=5），多会话是真实形态而非设想：
    // 原先 9 条用例全部只建一个会话，把 `if (!task) return 0` 这条错判完全遮住了。
    store.registerSession({ taskIds: ['a-1'], title: 'A' })
    store.registerSession({ taskIds: ['b-1'], title: 'B' })
    store.handleProgressEvent(progressEvent({ taskId: 'a-1' }))
    store.handleProgressEvent(progressEvent({ taskId: 'b-1' }))
    startClock(stall)

    vi.advanceTimersByTime(4 * MIN)

    expect(stall.stalledTaskIds, '两个会话各一个陈旧任务').toEqual(['a-1', 'b-1'])
    expect(stall.taskStallMinutes('a-1')).toBe(4)
    expect(stall.taskStallMinutes('b-1'), '后面的会话不得因第一个会话没命中而被判 0').toBe(4)
    expect(stall.maxStallMinutes).toBe(4)
  })

  it('未知 taskId 与终态任务都返回 0（i1 修法不得把「找不到」和「已结束」混成一类）', async () => {
    const { store, stall } = await makeStore()
    store.registerSession({ taskIds: ['t-1'], title: 'x' })
    store.handleProgressEvent(progressEvent({ taskId: 't-1', phase: 'success', stageKey: 'done', percent: 100 }))
    startClock(stall)

    vi.advanceTimersByTime(4 * MIN)

    expect(stall.taskStallMinutes('t-1'), '终态任务不得有分钟数').toBe(0)
    expect(stall.taskStallMinutes('nope'), '查不到的 id 不得抛错').toBe(0)
    expect(stall.taskStallMinutes(''), '空 id 直接 0').toBe(0)
  })

  // ─── 1.6c 按设计静默的相位（QM-6 第二轮 i3）─────────────────
  it('blocked / captcha 相位空闲再久也不得判无更新，且因此不得解禁关闭（QM-6 i3）', async () => {
    const { store, stall } = await makeStore()
    store.registerSession({ taskIds: ['t-cap', 't-blk'], title: 'x' })
    store.handleProgressEvent(progressEvent({ taskId: 't-blk', phase: 'blocked', stageKey: 'waiting' }))
    store.handleProgressEvent(progressEvent({ taskId: 't-cap', phase: 'captcha', stageKey: 'verify' }))
    startClock(stall)

    vi.advanceTimersByTime(10 * MIN)

    expect(stall.stalledTaskIds, '等人为/等平台动作的相位，静默是预期而非证据缺失').toEqual([])
    expect(stall.hasStalledRunning, '这两个相位仍是 live ⇒ 面板必须继续被看着').toBe(false)
    expect(stall.hasLiveTasks).toBe(true)
    expect(stall.taskStallMinutes('t-blk')).toBe(0)
    expect(stall.taskStallMinutes('t-cap')).toBe(0)

    // 但不得把它们当"已经完成"：换成真正会停滞的相位就必须判
    store.handleProgressEvent(progressEvent({ taskId: 't-cap', phase: 'progress', stageKey: 'fill' }))
    store.handleProgressEvent(progressEvent({ taskId: 't-blk', phase: 'progress', stageKey: 'fill' }))
    vi.advanceTimersByTime(4 * MIN)
    stall.endStallClock()
    stall.beginStallClock()
    expect(stall.hasStalledRunning, '同两个 id 回到普通相位后必须能判陈旧').toBe(true)
  })

  // ─── 1.6d 两条派生链不得错位（QM-6 第一轮 i3）──────────────
  it('存在非终态任务 ⇔ store.hasRunning ⇔ stall.hasLiveTasks（QM-6 i3/i4）', async () => {
    const { store, stall } = await makeStore()
    store.registerSession({ taskIds: ['t-1'], title: 'x' })
    expect(store.hasRunning, '刚登记（还没有事件）也必须算在跑 —— 否则关闭按钮直接解禁').toBe(true)
    expect(stall.hasLiveTasks, '登记即 live —— 面板解禁不得依赖 status 链').toBe(true)
    startClock(stall)

    store.handleProgressEvent(progressEvent({ taskId: 't-1' }))
    vi.advanceTimersByTime(4 * MIN)
    expect(store.hasRunning).toBe(true)
    expect(stall.hasLiveTasks).toBe(true)
    expect(stall.hasStalledRunning).toBe(true)

    store.handleProgressEvent(progressEvent({ taskId: 't-1', phase: 'success', stageKey: 'done', percent: 100 }))
    expect(store.hasRunning, '终态后两条链都要落下').toBe(false)
    expect(stall.hasLiveTasks).toBe(false)
    expect(stall.stalledTaskIds).toEqual([])
    expect(stall.hasStalledRunning, '全终态 ⇒ 不存在「全部无更新」这种说法').toBe(false)
  })

  // ─── 1.7 定时器生命周期 ─────────────────────────────────────
  it('begin 后恰好 1 个 tick；仍有非终态任务不得停，全部终态后一个 tick 内自泊', async () => {
    const { store, stall, stallMod } = await makeStore()
    store.registerSession({ taskIds: ['t-1'], title: 'x' })
    store.handleProgressEvent(progressEvent({ taskId: 't-1' }))

    startClock(stall)
    expect(liveTimers.size, '显式 begin ⇒ 起一个 tick').toBe(1)

    vi.advanceTimersByTime(stallMod.STALL_TICK_MS)
    expect(liveTimers.size, '任务仍在跑 ⇒ tick 不得自泊').toBe(1)

    store.handleProgressEvent(progressEvent({ taskId: 't-1', phase: 'success', stageKey: 'done', percent: 100 }))
    vi.advanceTimersByTime(stallMod.STALL_TICK_MS)
    expect(liveTimers.size, '全部终态 ⇒ tick 必须自泊，不给每条路由留白唤醒').toBe(0)
  })

  it('零非终态任务时 begin 不得建任何定时器（QM-6 第二轮 i2）', async () => {
    const { store, stall } = await makeStore()
    startClock(stall)
    expect(liveTimers.size, '面板在"没有任何发布活动"时挂载 ⇒ 一个定时器都不建').toBe(0)

    // 叫不回：新任务登记后再 begin 一次（生产里由 watch(sessions.length) 完成）就必须起表
    store.registerSession({ taskIds: ['t-1'], title: 'x' })
    store.handleProgressEvent(progressEvent({ taskId: 't-1' }))
    stall.beginStallClock()
    expect(liveTimers.size, '有活干之后同一个入口必须把表叫回来').toBe(1)
  })

  it('重复 begin 不得叠加第二个定时器；end 必须真的交还句柄（同 autoUpdater 教训）', async () => {
    const { store, stall } = await makeStore()
    store.registerSession({ taskIds: ['t-1'], title: 'x' })
    store.handleProgressEvent(progressEvent({ taskId: 't-1' }))
    startClock(stall)

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

  // ─── 1.8 恢复会话（QM-6 第一轮 i5）─────────────────────────
  it('恢复会话（queue:status 领养）启动当下不得被判无更新，但真的没事件时必须判（QM-6 i5）', async () => {
    const { store, stall } = await makeStore()
    mockGetQueueStatus.mockResolvedValue({ code: 0, data: { running: [{ id: 'orphan-1', platform: 'douyin' }], queue: [] } })
    await store.init()
    expect(store.sessions.length, '孤儿任务必须被领养成一个恢复会话').toBe(1)
    startClock(stall)
    expect(stall.stalledTaskIds, '领养新建会话的 createdAt 取的是本次运行的墙钟 ⇒ 不得开机即显示无更新').toEqual([])
    expect(stall.hasStalledRunning).toBe(false)

    // 回落链不能因此失灵：这次运行从此一个事件都没来，它最终必须被判无更新。
    vi.advanceTimersByTime(4 * MIN)
    expect(stall.stalledTaskIds).toEqual(['orphan-1'])
  })

  // ─── 1.9 时钟同域 ───────────────────────────────────────────
  it('陈旧判定两路时钟同域：读的是 Date.now()，不是事件带来的主进程时间戳', async () => {
    const { store, stall, stallMod } = await makeStore()
    // 事件里带一个"很久以前"的主进程 timestamp —— 不得拿它当锚点（跨域比较）
    store.registerSession({ taskIds: ['t-1'], title: 'x' })
    store.handleProgressEvent(progressEvent({ taskId: 't-1', timestamp: 1_600_000_000_000 }))
    startClock(stall)
    expect(stall.stalledTaskIds, '锚点必须是渲染端 Date.now() 写的 lastEventAt').toEqual([])

    vi.advanceTimersByTime(3 * MIN)
    expect(stall.stalledTaskIds).toEqual(['t-1'])
    expect(stallMod.STALL_AFTER_MS).toBe(3 * MIN)
  })
})
