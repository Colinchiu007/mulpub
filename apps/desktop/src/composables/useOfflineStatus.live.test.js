// @ts-check
/**
 * useOfflineStatus 的「实时检测」合同（UX 审计 1.7）
 *
 * 原实现的检测面只有一处：`init()` 里一次性读 `offlineStatus`，外加主进程的
 * `offline:restored`。而 `offline-manager.js::onNetworkChange` 只在
 * **恢复**那条边上通知前端（`if (wasOffline && !isOffline)`），断网那条边只改内部状态、
 * 不通知任何人 ⇒ 用户中途拔网线/断 WiFi，横幅**永远不出现**，
 * 直到重启应用（重新走那一次性读）才可能看到。这是「功能已建成但用户不可达」。
 *
 * 本文件锁四件事：
 *  ① 浏览器 `offline`/`online` 事件即时改状态（不等 IPC 往返）；
 *  ② 状态改变后仍要向主进程复核一次计数（`cachedTaskCount` 的真源是主进程缓存队列，
 *     浏览器事件只知连通性、不知队列深度）；
 *  ③ 监听器随 `dispose()` 成对解绑 —— 本仓多处 SPA 实例共存，泄漏的监听器会跨实例串写状态；
 *  ④ 读回失败**不得静默**（AGENTS.md「静默配置失败必须留日志」）：原实现两处
 *     `catch(function () { /* 静默失败 *\/ })` 让「IPC 坏了」与「网络正常」在界面上同形。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useOfflineStatus } from '../composables/useOfflineStatus'

/** 触发 window 上的浏览器网络事件（jsdom 不自动派发，必须手工 dispatch） */
function fireWindowEvent (type) {
  window.dispatchEvent(new Event(type))
}

function flush () {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

describe('useOfflineStatus — 实时检测（浏览器 online/offline）', () => {
  let originalElectronAPI
  let offlineStatusMock
  let disposers

  beforeEach(() => {
    originalElectronAPI = window.electronAPI
    disposers = []
    offlineStatusMock = vi.fn().mockResolvedValue({ code: 0, data: { offline: false, cachedCount: 0 } })
    window.electronAPI = {
      offlineStatus: offlineStatusMock,
      onOfflineRestored: vi.fn(() => () => {}),
    }
  })

  afterEach(() => {
    while (disposers.length > 0) disposers.pop()()
    window.electronAPI = originalElectronAPI
  })

  function create () {
    const api = useOfflineStatus()
    // ⛔ 必须把 dispose 记进清理队列：init() 会往 window 上挂监听，
    // 未 dispose 的旧实例在后续用例里仍然活着，它们的 handler 会抢先消费
    // offlineStatusMock 的 once 实现 —— 于是"当前实例拿到第几号响应"
    // 变成前面跑过几条用例的函数（本仓实测：正是这条泄漏把新鲜度守卫的用例喂成假失败）。
    disposers.push(api.dispose)
    return api
  }

  it('浏览器 offline 事件立即把 isOffline 置真（不等 IPC 往返）', () => {
    const { isOffline, init } = create()
    init()
    fireWindowEvent('offline')
    expect(isOffline.value).toBe(true)
  })

  it('浏览器 online 事件立即把 isOffline 置假', () => {
    const { isOffline, init } = create()
    init()
    fireWindowEvent('offline')
    expect(isOffline.value).toBe(true)
    fireWindowEvent('online')
    expect(isOffline.value).toBe(false)
  })

  it('浏览器事件后必须向主进程复核一次状态（计数真源在主进程队列）', async () => {
    offlineStatusMock.mockResolvedValue({ code: 0, data: { offline: true, cachedCount: 3 } })
    const { cachedTaskCount, init } = create()
    init()
    const before = offlineStatusMock.mock.calls.length
    fireWindowEvent('offline')
    await flush()
    expect(offlineStatusMock.mock.calls.length).toBeGreaterThan(before)
    expect(cachedTaskCount.value).toBe(3)
  })

  it('主进程复核给出的连通性优先于浏览器事件（两边不一致时不得各写各的）', async () => {
    // 浏览器说 online，但主进程的 net 栈仍判离线（代理掉了 / DNS 不通）
    offlineStatusMock.mockResolvedValue({ code: 0, data: { offline: true, cachedCount: 0 } })
    const { isOffline, init } = create()
    init()
    // ⛔ 必须先把 init 那一次读回落地再触发事件：否则「init 的写入」会在事件之后到达，
    // 把断言喂成对的结果 —— 变异反证 M4（复核不回写连通性）实测就是这样被洗绿的。
    await flush()
    fireWindowEvent('online')
    await flush()
    expect(isOffline.value).toBe(true)
  })

  it('dispose 之后浏览器事件不再改状态，且 window 监听器被解绑', () => {
    const removeSpy = vi.spyOn(window, 'removeEventListener')
    const { isOffline, init, dispose } = create()
    init()
    dispose()
    fireWindowEvent('offline')
    expect(isOffline.value).toBe(false)
    const removedTypes = removeSpy.mock.calls.map((c) => c[0])
    expect(removedTypes).toContain('offline')
    expect(removedTypes).toContain('online')
    removeSpy.mockRestore()
  })

  it('dispose 幂等：重复调用不得二次解绑或抛错', () => {
    const { init, dispose } = create()
    init()
    dispose()
    const removeSpy = vi.spyOn(window, 'removeEventListener')
    expect(() => dispose()).not.toThrow()
    expect(removeSpy).not.toHaveBeenCalled()
    removeSpy.mockRestore()
  })

  it('读回失败不得静默：必须留一条 warn，且状态保持浏览器事件给出的值', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    offlineStatusMock.mockRejectedValue(new Error('IPC unavailable'))
    const { isOffline, init } = create()
    init()
    await flush()
    // ⛔ init 自己那次失败也已经 warn 过一次；不清掉它就分不清「事件后的复核有没有出声」。
    // 变异反证 M5（复核 catch 退回静默）实测就是这样被 init 的那条 warn 洗绿的。
    warnSpy.mockClear()
    fireWindowEvent('offline')
    await flush()
    expect(isOffline.value).toBe(true)
    expect(warnSpy.mock.calls.length).toBeGreaterThan(0)
    expect(warnSpy.mock.calls.some((c) => String(c.join(' ')).includes('offline'))).toBe(true)
    warnSpy.mockRestore()
  })

  it('迟到的复核响应必须丢弃（QM-6 i1：多次复核不得按到达顺序覆盖）', async () => {
    // 让第 1 次（init）挂起，第 2 次（事件后复核）先返回，再放行第 1 次。
    // 无新鲜度守卫时，第 1 次的过期结论会最后落地并把状态改回旧值。
    let releaseFirst = null
    const first = new Promise((resolve) => { releaseFirst = () => resolve({ code: 0, data: { offline: false, cachedCount: 0 } }) })
    offlineStatusMock
      .mockImplementationOnce(() => first)
      .mockImplementationOnce(() => Promise.resolve({ code: 0, data: { offline: true, cachedCount: 7 } }))
    const { isOffline, cachedTaskCount, init } = create()
    init()
    await flush()
    fireWindowEvent('offline')
    await flush()
    expect(isOffline.value).toBe(true)
    expect(cachedTaskCount.value).toBe(7)

    releaseFirst()
    await flush()
    expect(isOffline.value, '过期响应不得把已确认的离线改回在线').toBe(true)
    expect(cachedTaskCount.value, '过期响应不得把队列深度改回旧值').toBe(7)
  })

  it('init 那一次读回也参与同一把新鲜度序号（它不是"更早的合法写者"）', async () => {
    // 场景：init 的读回挂起 → 用户此刻断网 → 事件后复核先返回「离线」→ init 的迟到响应说「在线」
    // 与上一条同构，但强调**两条写入路径共用一个 epoch**，不得各自计数。
    let releaseInit = null
    const initPromise = new Promise((resolve) => { releaseInit = () => resolve({ code: 0, data: { offline: false, cachedCount: 0 } }) })
    offlineStatusMock
      .mockImplementationOnce(() => initPromise)
      .mockImplementationOnce(() => Promise.resolve({ code: 0, data: { offline: true, cachedCount: 2 } }))
    const { isOffline, init } = create()
    init()
    fireWindowEvent('offline')
    await flush()
    expect(isOffline.value).toBe(true)
    releaseInit()
    await flush()
    expect(isOffline.value).toBe(true)
  })

  it('两次复核之间也要丢弃迟到者（守卫不得只防 init，M14 逼出来的形态）', async () => {
    // 快速连点/网络抖动会产生**并发复核**：先发起的那次可能后返回。
    // 场景：offline(A) → online(B)，B 先回（在线），A 后回（离线）。
    // 迟到守卫只在 init 上有、复核上没有的话，A 会把用户已经恢复的网络重新报成离线。
    let releaseA = null
    const promiseA = new Promise((resolve) => { releaseA = () => resolve({ code: 0, data: { offline: true, cachedCount: 5 } }) })
    offlineStatusMock
      .mockImplementationOnce(() => Promise.resolve({ code: 0, data: { offline: false, cachedCount: 0 } })) // init
      .mockImplementationOnce(() => promiseA)                                                              // 第 1 次复核（offline 事件）
      .mockImplementationOnce(() => Promise.resolve({ code: 0, data: { offline: false, cachedCount: 0 } })) // 第 2 次复核（online 事件）
    const { isOffline, cachedTaskCount, init } = create()
    init()
    await flush()
    fireWindowEvent('offline')
    await flush()
    fireWindowEvent('online')
    await flush()
    expect(isOffline.value).toBe(false)

    releaseA()
    await flush()
    expect(isOffline.value, '先发起的复核后返回时不得覆盖更新的结论').toBe(false)
    expect(cachedTaskCount.value).toBe(0)
  })

  it('init 返回的 API 形状必须包含 dispose（组件卸载链要用它）', () => {
    const api = create()
    expect(Object.keys(api).sort()).toEqual(['cachedTaskCount', 'dispose', 'init', 'isOffline'])
  })

  it('未 init 就 dispose 不抛错（组件可能在挂载前就被卸载）', () => {
    const { dispose } = create()
    expect(() => dispose()).not.toThrow()
  })
})
