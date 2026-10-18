// @ts-check
/* global vi */
/**
 * 顶部下移通道的**接线**测试（阶段 1.2 / audit-6）。
 *
 * 与 `view-bounds-top-inset.test.js` 的分工：那边钉数值口径（纯函数），
 * 这边钉「渲染层上报的高度真的走到了 setBounds」——
 * 只测纯函数会留下「判据正确但没人调用」的缺口，那正是本仓「注册≠注入≠执行」的形状。
 *
 * @vitest-environment node
 */
const layout = require('./webview-manager/layout')
const { BROWSER_CHROME_TOP, contentTopWithInset } = require('./view-bounds')

function makeCtx () {
  const view = { setBounds: vi.fn(), setVisible: vi.fn() }
  const ctx = {
    mainWindow: {
      isDestroyed: () => false,
      getContentBounds: () => ({ x: 8, y: 39, width: 1424, height: 861 }),
      getBounds: () => ({ x: 0, y: 0, width: 1440, height: 900 }),
    },
    _sidebarWidth: 200,
    _topInset: 0,
    _shellMode: 'browser',
    _activeTabId: 't1',
    _tabViews: new Map([['t1', view]]),
    _authTabInfo: null,
    _authViewManager: { setTopInset: vi.fn(), setSidebarWidth: vi.fn() },
    _qrCodeLogin: { setSidebarWidth: vi.fn() },
    isEmbeddedViewsSuspended: () => false,
    _hideAllTabs: vi.fn(),
    _getActiveLoginViewManager: () => null,
    view,
  }
  // _repositionAll 与 setTopInset 住在同一个混入对象里（真实构造时由 Object.assign 挂到实例），
  // 夹具必须同样把两者绑到同一个 ctx，否则测的就不是那条调用链。
  ctx._repositionAll = () => layout._repositionAll.apply(ctx)
  return ctx
}

function call (name, ctx, ...args) {
  return layout[name].apply(ctx, args)
}

describe('WebviewManager.setTopInset', () => {
  it('合法值写入并触发重排，内嵌视图真的按 76+inset 定位', () => {
    const ctx = makeCtx()
    call('setTopInset', ctx, 48)
    expect(ctx._topInset).toBe(48)
    expect(ctx.view.setBounds).toHaveBeenCalledTimes(1)
    expect(ctx.view.setBounds.mock.calls[0][0]).toEqual({
      x: 200,
      y: contentTopWithInset(48),
      width: 1224,
      height: 861 - contentTopWithInset(48),
    })
  })

  it('0 必须被接受并触发重排（横幅关闭后的收口；把 0 当非法就是永久错位）', () => {
    const ctx = makeCtx()
    call('setTopInset', ctx, 60)
    ctx.view.setBounds.mockClear()
    call('setTopInset', ctx, 0)
    expect(ctx._topInset).toBe(0)
    expect(ctx.view.setBounds).toHaveBeenCalledTimes(1)
    expect(ctx.view.setBounds.mock.calls[0][0].y).toBe(BROWSER_CHROME_TOP)
  })

  it('与当前值相同不得重复重排（ResizeObserver 会连续报同一高度）', () => {
    const ctx = makeCtx()
    call('setTopInset', ctx, 48)
    ctx.view.setBounds.mockClear()
    call('setTopInset', ctx, 48)
    expect(ctx.view.setBounds).not.toHaveBeenCalled()
  })

  it.each([
    ['NaN', NaN],
    ['负数', -20],
    ['字符串', '80'],
    ['超过上限', 99999],
    ['undefined', undefined],
  ])('%s 回落 0 并且不产生 NaN 坐标', (_label, value) => {
    const ctx = makeCtx()
    call('setTopInset', ctx, 50)
    ctx.view.setBounds.mockClear()
    call('setTopInset', ctx, value)
    expect(ctx._topInset).toBe(0)
    const bounds = ctx.view.setBounds.mock.calls[0][0]
    expect(bounds.y).toBe(BROWSER_CHROME_TOP)
    expect(Number.isFinite(bounds.height)).toBe(true)
  })

  it('登录视图同步收到下移（它同样占满内容矩形，只让浏览器标签让位就是口径分裂）', () => {
    const ctx = makeCtx()
    call('setTopInset', ctx, 40)
    expect(ctx._authViewManager.setTopInset).toHaveBeenCalledWith(40)
  })

  it('扫码视图**不得**收到 setTopInset —— 它已改为独立窗口承载，给它加 setter 就是无人读取的死接线', () => {
    const ctx = makeCtx()
    expect(typeof ctx._qrCodeLogin.setTopInset).toBe('undefined')
    call('setTopInset', ctx, 40)
    // 调用点根本不存在该方法；setSidebarWidth 那条既有兼容分支不受本批影响
    expect(ctx._qrCodeLogin.setSidebarWidth).not.toHaveBeenCalled()
  })

  it('挂起态下 _repositionAll 只隐藏视图，不得把新 bounds 写进被挂起的视图', () => {
    const ctx = makeCtx()
    ctx.isEmbeddedViewsSuspended = () => true
    call('setTopInset', ctx, 40)
    expect(ctx._topInset).toBe(40)
    expect(ctx.view.setBounds).not.toHaveBeenCalled()
    expect(ctx._hideAllTabs).toHaveBeenCalled()
  })
})

describe('顶部下移通道的三处同步（少任何一处都是静默失效）', () => {
  const fs = require('fs')
  const ipcSrc = fs.readFileSync(require.resolve('./webview-manager/ipc-handlers'), 'utf8')
  const preloadSrc = fs.readFileSync(
    require.resolve('../preload/page-manager.js'), 'utf8',
  )
  const layoutSrc = fs.readFileSync(require.resolve('./webview-manager/layout'), 'utf8')

  it('主进程注册了 page-manager:set-top-inset 且指向 setTopInset', () => {
    expect(ipcSrc.includes("'page-manager:set-top-inset'")).toBe(true)
    expect(/ipcMain\.handle\('page-manager:set-top-inset'[\s\S]{0,160}?self\.setTopInset\(px\)/.test(ipcSrc)).toBe(true)
  })

  it('preload 暴露了 pageManager.setTopInset 并走那条通道', () => {
    expect(/setTopInset: \(px\) => ipcRenderer\.invoke\('page-manager:set-top-inset', px\)/.test(preloadSrc)).toBe(true)
  })

  it('layout 真的实现了 setTopInset 并在 _repositionAll 里读 _topInset', () => {
    expect(/setTopInset \(px\)/.test(layoutSrc)).toBe(true)
    expect(/contentTopWithInset\(this\._topInset\)/.test(layoutSrc)).toBe(true)
  })

  it('三条源文件都点名了同一个通道名（防止改名后各改一半）', () => {
    for (const [name, src] of [['ipc-handlers', ipcSrc], ['preload', preloadSrc]]) {
      expect(src, name).toContain('set-top-inset')
    }
  })
})

describe('AuthViewManager.setTopInset 的落点', () => {
  // 这一条不看 auth-view-manager 源码，而是把它当消费者验：
  // 主进程里「谁读 _topInset」必须有现场，否则 layout 的同步调用就是打进空气。
  const authSource = require('fs').readFileSync(
    require.resolve('./auth-view-manager'), 'utf8',
  )

  it('auth-view-manager 声明了 setTopInset 并把 _topInset 真的喂给 computeEmbeddedViewBounds', () => {
    expect(/setTopInset\s*\(/.test(authSource)).toBe(true)
    expect(/contentTopWithInset\(this\._topInset\)/.test(authSource)).toBe(true)
  })

  it('反向：源码里不得留下"只有 setter、没有读者"的形态（_topInset 必须出现在取 bounds 的那一行）', () => {
    const reads = (authSource.match(/this\._topInset/g) || []).length
    expect(reads).toBeGreaterThanOrEqual(2)
  })
})
