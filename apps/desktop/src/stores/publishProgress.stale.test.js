/**
 * 发布进度「陈旧看门狗」回归锁（UX-AUDIT-2026-10-17 阶段 1.8 / audit-15）
 *
 * 动因：`lastEventAt` 在 store 里被写 4 次、被读 0 次。任务卡在「start 已发、
 * done 永不到」时，面板与真正在跑的运行态完全同形，而关闭按钮因 hasRunning 禁用
 * ⇒ 用户只能干等或重启应用。本锁把「什么时候该说出来」钉成行为表。
 *
 * 关键取向（不得反过来实现）：
 *  - 判据取 running 任务里**最近一次事件**，只要有任何任务刚动过就不算整体停滞；
 *  - 两个时刻锚点都缺 ⇒ 不判停滞（无从判断时宁可沉默，也不给用户假故障）；
 *  - 全部终态 ⇒ 不判停滞（那是已完成，不是卡住）。
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

const noop = vi.hoisted(() => vi.fn())
vi.mock('@/api/publisher', () => ({
  onProgress: () => noop,
  onBatchProgress: () => noop,
  getQueueStatus: vi.fn(async () => ({ code: 0, data: { running: [], queue: [] } })),
  retryTask: vi.fn(),
  cancelTask: vi.fn(),
}))

const STALE_AFTER_MS = 180000
const TICK_MS = 15000
const T0 = new Date('2026-10-18T08:00:00Z').getTime()

async function makeStore () {
  const { usePublishProgressStore } = await import('./publishProgress')
  return usePublishProgressStore()
}

function ev (taskId, overrides = {}) {
  return {
    platform: 'douyin', taskId, phase: 'progress', stageKey: 'upload',
    stage: 'uploading...', percent: 20, batchId: null, timestamp: Date.now(), ...overrides,
  }
}

describe('publishProgress 陈旧看门狗', () => {
  let setIntervalSpy
  let clearIntervalSpy

  beforeEach(() => {
    setActivePinia(createPinia())
    vi.resetModules()
    vi.useFakeTimers()
    vi.setSystemTime(T0)
    setIntervalSpy = vi.spyOn(globalThis, 'setInterval')
    clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval')
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  /** 把挂钟推进到「相对 T0 的绝对毫秒」。vitest 的 advanceTimersByTime 会**同时**推进
   *  Date.now()，所以既不能叠加 setSystemTime（会推成两倍），也不能把它当增量连续调用。 */
  const clock = { at: 0 }
  async function advance (deltaMs) {
    clock.at += deltaMs
    await vi.advanceTimersByTimeAsync(deltaMs)
  }

  it('刚收到事件时不报停滞；跨过 3 分钟阈值才报，并给出分钟数', async () => {
    const store = await makeStore()
    await store.init()
    store.registerSession({ taskIds: ['t-1'], title: '文章甲' })
    store.handleProgressEvent(ev('t-1', { phase: 'start', percent: 0 }))

    expect(store.stallInfo.stalled).toBe(false)

    await advance(STALE_AFTER_MS - 30000)
    expect(store.stallInfo.stalled, '150 秒不算停滞（平台侧正常慢）').toBe(false)

    await advance(STALE_AFTER_MS + 5000 - clock.at)
    expect(store.stallInfo.stalled).toBe(true)
    expect(store.stallInfo.minutes).toBe(3)
    expect(store.hasStalledTasks).toBe(true)
  })

  it('停滞期间来了新事件 ⇒ 立即复位（不得把一次沉默永久钉成故障）', async () => {
    const store = await makeStore()
    await store.init()
    store.registerSession({ taskIds: ['t-1'], title: '文章乙' })
    store.handleProgressEvent(ev('t-1'))
    await advance(STALE_AFTER_MS + 5000)
    expect(store.hasStalledTasks).toBe(true)

    store.handleProgressEvent(ev('t-1', { percent: 55 }))
    expect(store.stallInfo.stalled).toBe(false)
  })

  it('多个任务里只要有一个刚动过，就不算整体停滞', async () => {
    const store = await makeStore()
    await store.init()
    store.registerSession({ taskIds: ['t-1', 't-2'], title: '文章丙' })
    store.handleProgressEvent(ev('t-1'))
    store.handleProgressEvent(ev('t-2'))
    await advance(STALE_AFTER_MS + 5000)
    expect(store.hasStalledTasks).toBe(true)

    store.handleProgressEvent(ev('t-2', { percent: 90 }))
    expect(store.hasStalledTasks, 't-2 刚动过 ⇒ 面板不得报整体停滞').toBe(false)
  })

  it('全部终态后不报停滞（已完成 ≠ 卡住）', async () => {
    const store = await makeStore()
    await store.init()
    store.registerSession({ taskIds: ['t-1'], title: '文章丁' })
    store.handleProgressEvent(ev('t-1'))
    store.handleProgressEvent(ev('t-1', { phase: 'success', percent: 100 }))
    await advance(STALE_AFTER_MS + 60000)
    expect(store.hasStalledTasks).toBe(false)
  })

  it('既无 lastEventAt 又无 startedAt ⇒ 不判停滞（锚点缺席时沉默，不猜）', async () => {
    const store = await makeStore()
    await store.init()
    store.registerSession({ taskIds: ['t-1'], title: '文章戊' })
    await advance(STALE_AFTER_MS + 60000)
    expect(store.stallInfo.stalled).toBe(false)
    expect(store.stallInfo.runningTasks).toBe(1)
  })

  it('init() 幂等：重复 init 不得挂第二个 interval；stopStaleWatch 成对清理', async () => {
    const store = await makeStore()
    await store.init()
    await store.init()
    const created = setIntervalSpy.mock.calls.filter(c => c[1] === TICK_MS).length
    expect(created, '看门狗 interval 必须恰好一个').toBe(1)

    store.stopStaleWatch()
    expect(clearIntervalSpy).toHaveBeenCalled()
    store.stopStaleWatch() // 二次调用不得抛，也不得再 clear
    expect(clearIntervalSpy.mock.calls.length).toBe(1)
  })
})
