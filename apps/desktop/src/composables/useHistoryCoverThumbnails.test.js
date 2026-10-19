// @ts-check
/**
 * useHistoryCoverThumbnails.test.js — 发布历史页「真实封面缩略图」回归锁
 *
 * 缺陷背景（2026-10-12 用户报障「历史记录页的缩略图好像不是发布的真实封面」）：
 * 写侧从来没落过封面键，读侧 `thumbnailUrl(record)` 恒为空 → 回退平台图标。
 * 写侧已由 `publish-record-cover.js` 补齐；本文件锁「读侧能把写侧的产物渲染出来」：
 *  ① 本地路径必须经 `cover:read-data` 转 dataURL（渲染层 CSP 的 img-src 不含 file:）；
 *  ② 远程 http(s) 走共享协议判据 `safeHttpUrl`；
 *  ③ 读取失败/存量无封面 → 回退平台图标（`coverUrlFor` 返回空串），不渲染破图；
 *  ④ 迟到响应不得覆盖新状态（错误证据比没有证据更糟）。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { effectScope, nextTick, ref } from 'vue'
import { isLocalImagePath, useHistoryCoverThumbnails } from './useHistoryCoverThumbnails'

function deferred () {
  let resolve
  const promise = new Promise((r) => { resolve = r })
  return { promise, resolve }
}

describe('useHistoryCoverThumbnails — 本地路径判据', () => {
  it('认得盘符 / 反斜杠 / UNC / file:// / POSIX 绝对路径', () => {
    for (const p of ['D:/c/a.png', 'D:\\c\\a.png', '\\\\server\\share\\a.png', 'file:///D:/c/a.png', '/tmp/a.png']) {
      expect(isLocalImagePath(p), p).toBe(true)
    }
  })

  it('URL 与相对路径不算本地路径', () => {
    for (const p of ['https://x/a.png', 'http://x/a.png', 'data:image/png;base64,AA', 'covers/a.png', './a.png', '', null, undefined]) {
      expect(isLocalImagePath(p), String(p)).toBe(false)
    }
  })
})

describe('useHistoryCoverThumbnails — 解析与加载', () => {
  let readCoverData

  beforeEach(() => {
    readCoverData = vi.fn(async () => ({ code: 0, data: { dataUrl: 'data:image/png;base64,LOCAL' } }))
  })

  function setup (list) {
    const records = ref(list)
    // 必须在 effect scope 内调用：composable 用了 onScopeDispose（真实组件里由组件实例提供作用域）
    const scope = effectScope()
    let api = null
    scope.run(() => { api = useHistoryCoverThumbnails(records, { readCoverData: () => readCoverData }) })
    return { records, api, scope }
  }

  it('本地 cover_path 经 IPC 转 dataURL 后返回（不直接把路径当 src）', async () => {
    const { api } = setup([{ id: '1', cover_path: 'D:/covers/a.png' }])

    expect(readCoverData).toHaveBeenCalledWith('D:/covers/a.png')
    await nextTick()
    await Promise.resolve()
    expect(api.coverUrlFor({ id: '1', cover_path: 'D:/covers/a.png' })).toBe('data:image/png;base64,LOCAL')
  })

  it('本地封面读取中先返回空串（不得闪成远程图或平台图标）', () => {
    const d = deferred()
    readCoverData.mockReturnValue(d.promise)
    const { api } = setup([{ id: '1', cover_path: 'D:/covers/b.png', cover_url: 'https://cdn.example.com/r.png' }])

    expect(api.coverUrlFor({ id: '1', cover_path: 'D:/covers/b.png', cover_url: 'https://cdn.example.com/r.png' })).toBe('')
  })

  it('本地封面读取失败后回退远程 URL', async () => {
    readCoverData.mockResolvedValue({ code: -1, message: '读取失败' })
    const { api } = setup([{ id: '1', cover_path: 'D:/covers/c.png' }])
    await nextTick(); await Promise.resolve(); await Promise.resolve()

    expect(api.coverUrlFor({ id: '1', cover_path: 'D:/covers/c.png', cover_url: 'https://cdn.example.com/r.png' }))
      .toBe('https://cdn.example.com/r.png')
  })

  it('远程 cover_url 直接可用（过 safeHttpUrl）', () => {
    const { api } = setup([])
    expect(api.coverUrlFor({ cover_url: 'https://cdn.example.com/a.png' })).toBe('https://cdn.example.com/a.png')
  })

  it('🔴 非 http(s) 的封面 URL 一律不产出（javascript:/data:/相对路径）', () => {
    const { api } = setup([])
    for (const bad of ['javascript:alert(1)', 'data:image/png;base64,AA', 'cdn.example.com/a.png', '//cdn.example.com/a.png']) {
      expect(api.coverUrlFor({ cover_url: bad }), bad).toBe('')
    }
  })

  it('存量记录（无 cover_path/cover_url）返回空串 → 视图回退平台图标', () => {
    const { api } = setup([])
    expect(api.coverUrlFor({ id: 'old', platform: 'wechat_mp' })).toBe('')
    expect(readCoverData).not.toHaveBeenCalled()
  })

  it('兼容存量键 coverUrl / thumbnailUrl / thumbnail / cover', () => {
    const { api } = setup([])
    expect(api.coverUrlFor({ coverUrl: 'https://x/a.png' })).toBe('https://x/a.png')
    expect(api.coverUrlFor({ thumbnailUrl: 'https://x/b.png' })).toBe('https://x/b.png')
    expect(api.coverUrlFor({ thumbnail: 'https://x/c.png' })).toBe('https://x/c.png')
    expect(api.coverUrlFor({ cover: 'https://x/d.png' })).toBe('https://x/d.png')
  })

  it('同一路径被多条记录引用时只读一次（按路径缓存去重）', async () => {
    const { api } = setup([
      { id: '1', cover_path: 'D:/shared/a.png' },
      { id: '2', cover_path: 'D:/shared/a.png' },
    ])
    await nextTick(); await Promise.resolve()

    expect(readCoverData).toHaveBeenCalledTimes(1)
    expect(api.coverUrlFor({ id: '1', cover_path: 'D:/shared/a.png' })).toBe('data:image/png;base64,LOCAL')
  })

  it('列表追加后只为新路径发起读取', async () => {
    const { records } = setup([{ id: '1', cover_path: 'D:/covers/one.png' }])
    await nextTick(); await Promise.resolve()
    expect(readCoverData).toHaveBeenCalledTimes(1)

    records.value = [{ id: '1', cover_path: 'D:/covers/one.png' }, { id: '2', cover_path: 'D:/covers/two.png' }]
    await nextTick(); await Promise.resolve()

    expect(readCoverData).toHaveBeenCalledTimes(2)
    expect(readCoverData).toHaveBeenLastCalledWith('D:/covers/two.png')
  })

  it('🔴 卸载后迟到响应不得写回状态（错误证据比没有证据更糟）', async () => {
    const d = deferred()
    readCoverData.mockReturnValueOnce(d.promise)
    const records = ref([{ id: '1', cover_path: 'D:/covers/slow.png' }])
    const scope = effectScope()
    let api = null
    scope.run(() => { api = useHistoryCoverThumbnails(records, { readCoverData: () => readCoverData }) })
    await nextTick()

    // 组件卸载 → generation 递增；此后旧响应即使成功回来也必须被丢弃
    scope.stop()
    d.resolve({ code: 0, data: { dataUrl: 'data:image/png;base64,STALE' } })
    await Promise.resolve(); await Promise.resolve(); await nextTick()

    expect(api.coverUrlFor({ cover_path: 'D:/covers/slow.png' })).toBe('')
  })

  it('读取器抛错时不抛出（降级为空串）', async () => {
    readCoverData.mockRejectedValue(new Error('boom'))
    const { api } = setup([{ id: '1', cover_path: 'D:/covers/throw.png' }])
    await nextTick(); await Promise.resolve(); await Promise.resolve()

    expect(api.coverUrlFor({ id: '1', cover_path: 'D:/covers/throw.png' })).toBe('')
  })

  it('IPC 通道缺失（浏览器 dev server）时不抛错，返回空串', async () => {
    const records = ref([{ id: '1', cover_path: 'D:/covers/none.png' }])
    const scope = effectScope()
    let api = null
    scope.run(() => { api = useHistoryCoverThumbnails(records, { readCoverData: () => undefined }) })
    await nextTick(); await Promise.resolve(); await nextTick()
    scope.stop()

    expect(api.coverUrlFor({ id: '1', cover_path: 'D:/covers/none.png' })).toBe('')
  })
})

// ── 阶段 2.1 / audit-34 ③：封面按可见区取数 ──
// 本机实测基线（monitorEventLoopDelay，页缓存预热）：同步读形态下 200 张 3MB 让主进程
// 一次性冻结 397ms、1000 张 1947ms。异步化只能压到 168ms / 1373ms ⇒ 承重的是"别为
// 看不见的行取数"。这条 describe 就是这条判据的行为锁。
describe('useHistoryCoverThumbnails — 可见区驱动（IntersectionObserver 在位时）', () => {
  let readCoverData
  let installedCallbacks
  let observedElements

  class FakeIO {
    constructor (cb, opts) {
      this.cb = cb
      this.opts = opts
      installedCallbacks.push(this)
    }

    observe (el) { observedElements.push(el) }

    unobserve (el) { el.__unobserved = (el.__unobserved || 0) + 1 }

    disconnect () { observedElements.length = 0 }
  }

  beforeEach(() => {
    readCoverData = vi.fn(async () => ({ code: 0, data: { dataUrl: 'data:image/png;base64,LOCAL' } }))
    installedCallbacks = []
    observedElements = []
    vi.stubGlobal('IntersectionObserver', FakeIO)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function setup (list) {
    const records = ref(list)
    const scope = effectScope()
    let api = null
    scope.run(() => { api = useHistoryCoverThumbnails(records, { readCoverData: () => readCoverData }) })
    return { records, api, scope }
  }

  it('绑定时不取数；进入视口才取一次（重复可见不得重复读盘）', async () => {
    const { api, scope } = setup([{ id: '1', cover_path: 'D:/covers/a.png' }])
    // 关键差集：IO 在位时整列表 watch 必须**不发**请求（这正是被消除的那一条）
    expect(readCoverData).not.toHaveBeenCalled()

    const el = { tagName: 'DIV' }
    api.observeCover(el, { id: '1', cover_path: 'D:/covers/a.png' })
    expect(observedElements).toEqual([el])
    expect(readCoverData).not.toHaveBeenCalled()

    const io = installedCallbacks[0]
    // 报告"未相交" ⇒ 仍不发请求；相交才发。两档必须能区分，否则等于没有门禁
    io.cb([{ target: el, isIntersecting: false }])
    expect(readCoverData).not.toHaveBeenCalled()

    io.cb([{ target: el, isIntersecting: true }])
    expect(readCoverData).toHaveBeenCalledTimes(1)
    expect(io.opts.rootMargin, '预取带必须写明（滚到才取 = 白屏一帧）').toBe('240px')

    // 同一元素再绑定 + 再次可见 ⇒ 不得第二次读盘（state 命中 + unobserve 两道）
    api.observeCover(el, { id: '1', cover_path: 'D:/covers/a.png' })
    io.cb([{ target: el, isIntersecting: true }])
    expect(readCoverData).toHaveBeenCalledTimes(1)
    expect(el.__unobserved, '取过数就该 unobserve，否则滚动时反复回调').toBe(1)

    await nextTick()
    expect(api.coverUrlFor({ id: '1', cover_path: 'D:/covers/a.png' })).toBe('data:image/png;base64,LOCAL')
    scope.stop()
  })

  it('远程封面不参与可见区：它本来就是 URL，无需主进程读盘', () => {
    const { api, scope } = setup([{ id: '2', cover_url: 'https://cdn.example.com/a.png' }])
    const el = {}
    api.observeCover(el, { id: '2', cover_url: 'https://cdn.example.com/a.png' })
    expect(observedElements).toEqual([])
    expect(readCoverData).not.toHaveBeenCalled()
    expect(installedCallbacks.length).toBe(1)
    scope.stop()
  })

  it('卸载时 disconnect（离开历史页不得留下观察者与回调）', () => {
    const { api, scope } = setup([{ id: '3', cover_path: 'D:/covers/c.png' }])
    const io = installedCallbacks[0]
    let disconnected = false
    io.disconnect = () => { disconnected = true }
    scope.stop()
    expect(disconnected).toBe(true)
    // 卸载后再绑定不得复活请求
    api.observeCover({}, { id: '3', cover_path: 'D:/covers/c.png' })
    expect(readCoverData).not.toHaveBeenCalled()
  })
})
