// @ts-check
/**
 * 账号标签凭证 localStorage 的 document-start 注入契约：CDP Page 目标引导、注入守卫、降级路径。
 *
 * 拆出自 `webview-manager.test.js`（单文件测试上限 1500 行，check-max-lines 债务熔断）；夹具与它共用
 * `webview-manager-test-harness.js`。本文件覆盖的缺陷：用户报「点开已登录账号 → 先看到登录页 →
 * 刷新一次 → 过几秒才进创作者中心」，根因是早期注入从未生效（详见
 * `01-docs/PRD-ACCOUNT-TAB-FIRST-PAINT-LOGIN-2026-10-11.md`）。
 */
const { createMainWindow, patchViewAndSessionMocks } = require('./webview-manager-test-harness')

__enableElectronMock()

let WebviewManager
const credentialLoadMock = vi.fn(() => null)

// logger mock 跨用例稳定（credential-saver 在 require 期把 log 绑成本地引用；每轮新建会让日志断言恒 0）。
const loggerMock = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }

beforeEach(async () => {
  vi.resetModules()
  __resetElectronMock()
  Object.values(loggerMock).forEach(fn => fn.mockReset())
  __registerMock('./logger', loggerMock)
  __registerMock('./credential-store', { loadCredential: credentialLoadMock })
  patchViewAndSessionMocks()
  const mod = await import('./webview-manager.js')
  WebviewManager = mod.default || mod
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('WebviewManager 账号标签：凭证 localStorage 的 document-start 注入（CDP 引导 / 守卫 / 降级）', () => {
  it('页面加载完成后恢复凭证中的 localStorage', async () => {
    patchViewAndSessionMocks()
    credentialLoadMock.mockReturnValue({ localStorage: { token: 'xyz' } })
    const mod = await import('./webview-manager.js')
    const WM = mod.default || mod
    const wm = new WM()
    wm.mainWindow = createMainWindow()

    wm.createNewTabPage({ url: 'https://creator.zhihu.com', accountId: 'account-1' })

    const activeView = wm._tabViews.get(wm._activeTabId)
    activeView.webContents._handlers['did-finish-load']()
    expect(activeView.webContents.executeJavaScript).toHaveBeenCalled()
    const script = activeView.webContents.executeJavaScript.mock.calls[0][0]
    expect(script).toContain('"token":"xyz"')
    await Promise.resolve()
    expect(activeView.webContents.loadURL).toHaveBeenCalledWith('https://creator.zhihu.com')
  })

  it('debugger 可用时：先 about:blank 建立 Page 目标 → Page.enable → document-start 注入 → 首个真实导航（无二段导航）', async () => {
    patchViewAndSessionMocks()
    const order = []
    __electronMock.__loadUrlLog = order
    const dbg = {
      attach: vi.fn(function () {}),
      sendCommand: vi.fn(function (method) {
        if (method === 'Page.enable') order.push('cdp:Page.enable')
        if (method === 'Page.addScriptToEvaluateOnNewDocument') order.push('cdp:addScript')
        return Promise.resolve()
      }),
      detach: vi.fn(),
    }
    __electronMock.__webContentsDebuggerFactory = function () { return dbg }
    credentialLoadMock.mockReturnValue({ localStorage: { finder_username: 'v2_ctx' } })
    const mod = await import('./webview-manager.js')
    const WM = mod.default || mod
    const wm = new WM()
    wm.mainWindow = createMainWindow()

    wm.createNewTabPage({ url: 'https://channels.weixin.qq.com/', platform: 'tencent_video', accountId: 'tv-1' })

    const view = wm._tabViews.get(wm._activeTabId)
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(dbg.attach).toHaveBeenCalled()
    expect(dbg.sendCommand).toHaveBeenCalledWith('Page.addScriptToEvaluateOnNewDocument',
      expect.objectContaining({ source: expect.stringContaining('"finder_username"') }))

    // 不可交换的次序契约（2026-10-11 真机探针）：
    // ① 全新 view 必须先落一个文档，否则 Page 域命令永久挂起（首个导航被门控 → 空白等待）；
    // ② Page.enable 必须先于 addScript，否则 addScript 会返回 identifier 但脚本永不执行（静默 no-op）；
    // ③ 真实导航必须排在注入之后。
    expect(order.indexOf('loadURL:about:blank')).toBeGreaterThanOrEqual(0)
    expect(order.indexOf('cdp:Page.enable')).toBeGreaterThan(order.indexOf('loadURL:about:blank'))
    expect(order.indexOf('cdp:addScript')).toBeGreaterThan(order.indexOf('cdp:Page.enable'))
    const navIdx = order.indexOf('loadURL:https://channels.weixin.qq.com/')
    expect(navIdx).toBeGreaterThan(order.indexOf('cdp:addScript'))

    // 早期注入成功 → 不得再有 did-finish-load 补注入与二段真实导航（消除登录页闪烁）
    if (view.webContents._handlers['did-finish-load']) view.webContents._handlers['did-finish-load']()
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(view.webContents.executeJavaScript).not.toHaveBeenCalled()
    expect(view.webContents.loadURL.mock.calls.map(c => c[0])).toEqual([
      'about:blank',
      'https://channels.weixin.qq.com/',
    ])
    __electronMock.__webContentsDebuggerFactory = null
    __electronMock.__loadUrlLog = null
  })

  it('引导 about:blank 不污染标签状态：空白文档的 did-navigate 不改写 url/不广播导航', async () => {
    patchViewAndSessionMocks()
    const dbg = {
      attach: vi.fn(function () {}),
      sendCommand: vi.fn(function () { return Promise.resolve() }),
      detach: vi.fn(),
    }
    __electronMock.__webContentsDebuggerFactory = function () { return dbg }
    credentialLoadMock.mockReturnValue({ localStorage: { token: 'x' } })
    const mod = await import('./webview-manager.js')
    const WM = mod.default || mod
    const wm = new WM()
    wm.mainWindow = createMainWindow()

    const tabId = wm.createNewTabPage({ url: 'https://creator.xiaohongshu.com/', platform: 'xiaohongshu', accountId: 'xhs-1' })
    const view = wm._tabViews.get(tabId)
    const state = wm._tabStates.get(tabId)
    const broadcasts = []
    wm._broadcast = function (event, data) { broadcasts.push({ event, data }) }

    // 引导文档的导航事件：不得把 about:blank 暴露成标签 URL
    view.webContents._handlers['did-navigate']({}, 'about:blank')
    expect(state.url).toBe('https://creator.xiaohongshu.com/')
    expect(broadcasts.filter(b => b.event === 'navigation-changed')).toEqual([])

    // 首个真实文档提交：引导期结束，正常改写
    view.webContents._handlers['did-navigate']({}, 'https://creator.xiaohongshu.com/')
    expect(state.url).toBe('https://creator.xiaohongshu.com/')
    expect(broadcasts.filter(b => b.event === 'navigation-changed').length).toBe(1)
    __electronMock.__webContentsDebuggerFactory = null
  })

  it('引导空白文档的历史项在首个真实导航提交后被移除，返回键状态同步修正', async () => {
    patchViewAndSessionMocks()
    const dbg = {
      attach: vi.fn(function () {}),
      sendCommand: vi.fn(function () { return Promise.resolve() }),
      detach: vi.fn(),
    }
    __electronMock.__webContentsDebuggerFactory = function () { return dbg }
    credentialLoadMock.mockReturnValue({ localStorage: { token: 'x' } })
    const mod = await import('./webview-manager.js')
    const WM = mod.default || mod
    const wm = new WM()
    wm.mainWindow = createMainWindow()

    const tabId = wm.createNewTabPage({ url: 'https://creator.xiaohongshu.com/', platform: 'xiaohongshu', accountId: 'xhs-2' })
    const view = wm._tabViews.get(tabId)
    const state = wm._tabStates.get(tabId)
    await new Promise(resolve => setTimeout(resolve, 0))
    // 真实 Electron：引导 about:blank 与真实导航各占一条历史项
    expect(view.webContents.loadURL.mock.calls[0][0]).toBe('about:blank')
    view.webContents._handlers['did-navigate']({}, 'https://creator.xiaohongshu.com/')

    expect(view.webContents.navigationHistory.removeEntryAtIndex).toHaveBeenCalledWith(0)
    expect(state.canGoBack).toBe(false)
    __electronMock.__webContentsDebuggerFactory = null
  })

  // QM-6 评审 i1（auth 域）命中的带跳场景：平台真实首屏自带一次跳转时，摘除动作**只**认引导项，
  // 不得连带遮蔽/清除真实返回历史（AC-5 的 canGoBack=false 只对「单次真实导航」成立）。
  it('平台真实首屏自带跳转（两次真实 did-navigate）时：只摘引导项一次，真实返回历史如实保留', async () => {
    patchViewAndSessionMocks()
    const dbg = {
      attach: vi.fn(function () {}),
      sendCommand: vi.fn(function () { return Promise.resolve() }),
      detach: vi.fn(),
    }
    __electronMock.__webContentsDebuggerFactory = function () { return dbg }
    credentialLoadMock.mockReturnValue({ localStorage: { token: 'x' } })
    const mod = await import('./webview-manager.js')
    const WM = mod.default || mod
    const wm = new WM()
    wm.mainWindow = createMainWindow()

    const tabId = wm.createNewTabPage({ url: 'https://creator.xiaohongshu.com/', platform: 'xiaohongshu', accountId: 'xhs-redirect' })
    const view = wm._tabViews.get(tabId)
    const state = wm._tabStates.get(tabId)
    await new Promise(resolve => setTimeout(resolve, 0))
    // 历史：index0 = 引导 about:blank，index1 = 真实首跳
    expect(view.webContents.navigationHistory._entries.map(e => e.url)).toEqual([
      'about:blank',
      'https://creator.xiaohongshu.com/',
    ])

    view.webContents._handlers['did-navigate']({}, 'https://creator.xiaohongshu.com/')
    expect(view.webContents.navigationHistory.removeEntryAtIndex).toHaveBeenCalledTimes(1)
    expect(view.webContents.navigationHistory.removeEntryAtIndex).toHaveBeenCalledWith(0)
    expect(state.blankBootstrapPending).toBe(false)

    // 平台第二次真实跳转（新文档 = 新历史项）：引导期已结束 → 不得再次摘条目
    view.webContents.navigationHistory._entries.push({ url: 'https://creator.xiaohongshu.com/home' })
    view.webContents._handlers['did-navigate']({}, 'https://creator.xiaohongshu.com/home')
    expect(view.webContents.navigationHistory.removeEntryAtIndex).toHaveBeenCalledTimes(1)
    // 真实的两条历史必须如实反映到返回键状态（不再被引导逻辑改写）
    expect(state.canGoBack).toBe(true)
    expect(view.webContents.navigationHistory._entries.map(e => e.url)).toEqual([
      'https://creator.xiaohongshu.com/',
      'https://creator.xiaohongshu.com/home',
    ])
    __electronMock.__webContentsDebuggerFactory = null
  })

  // QM-6 评审 i1 的守卫本体：摘除只认「index0 且 url === about:blank 且不是 active entry」，
  // 任一不满足即一个字节都不许动（否则会误删真实返回历史）。
  it('引导项摘除只认 index0 的 about:blank；index0 是真实条目或本身是 active entry 时一律不动', async () => {
    const { _removeBootstrapBlankHistoryEntry } = await import('./webview-manager/utils.js')

    // ① index0 是真实条目 → 不动
    const removeReal = vi.fn(function () { return true })
    const viewRealFirst = {
      webContents: {
        navigationHistory: {
          getEntryAtIndex: () => ({ url: 'https://creator.xiaohongshu.com/' }),
          getActiveIndex: () => 1,
          removeEntryAtIndex: removeReal,
        },
      },
    }
    expect(_removeBootstrapBlankHistoryEntry(viewRealFirst)).toBe(false)
    expect(removeReal).not.toHaveBeenCalled()

    // ② 引导项恰好是 active entry（提交前）→ 不动（NavigationHistory 也不允许移除 active entry）
    const removeActive = vi.fn(function () { return true })
    const viewActiveBlank = {
      webContents: {
        navigationHistory: {
          getEntryAtIndex: () => ({ url: 'about:blank' }),
          getActiveIndex: () => 0,
          removeEntryAtIndex: removeActive,
        },
      },
    }
    expect(_removeBootstrapBlankHistoryEntry(viewActiveBlank)).toBe(false)
    expect(removeActive).not.toHaveBeenCalled()

    // ③ 正向：index0 是引导项且非 active → 移除 index0
    const removeBlank = vi.fn(function () { return true })
    const viewBlankFirst = {
      webContents: {
        navigationHistory: {
          getEntryAtIndex: () => ({ url: 'about:blank' }),
          getActiveIndex: () => 1,
          removeEntryAtIndex: removeBlank,
        },
      },
    }
    expect(_removeBootstrapBlankHistoryEntry(viewBlankFirst)).toBe(true)
    expect(removeBlank).toHaveBeenCalledWith(0)
  })

  // QM-6 评审 i2：注入脚本可能对 opaque origin（about:blank）执行，`localStorage` 访问会抛
  // SecurityError/TypeError；写法必须把 setItem 关在 try/catch 内，保证绝不外溢。
  it('注入脚本把每个 setItem 关在 try/catch 内（opaque origin 上执行也不外溢）', async () => {
    patchViewAndSessionMocks()
    const scripts = []
    const dbg = {
      attach: vi.fn(function () {}),
      sendCommand: vi.fn(function (method, params) {
        if (method === 'Page.addScriptToEvaluateOnNewDocument') scripts.push(params && params.source)
        return Promise.resolve()
      }),
      detach: vi.fn(),
    }
    __electronMock.__webContentsDebuggerFactory = function () { return dbg }
    credentialLoadMock.mockReturnValue({ localStorage: { token: 'x' } })
    const mod = await import('./webview-manager.js')
    const WM = mod.default || mod
    const wm = new WM()
    wm.mainWindow = createMainWindow()

    wm.createNewTabPage({ url: 'https://creator.xiaohongshu.com/', platform: 'xiaohongshu', accountId: 'xhs-guard' })
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(scripts).toHaveLength(1)
    expect(scripts[0]).toContain('try { localStorage.setItem(k, data[k]); } catch (e)')
    __electronMock.__webContentsDebuggerFactory = null
  })

  it('已有文档的 view 不做 about:blank 引导（复用路径不产生多余导航）', async () => {
    patchViewAndSessionMocks()
    __electronMock.__initialDocumentUrl = 'https://creator.xiaohongshu.com/'
    const dbg = {
      attach: vi.fn(function () {}),
      sendCommand: vi.fn(function () { return Promise.resolve() }),
      detach: vi.fn(),
    }
    __electronMock.__webContentsDebuggerFactory = function () { return dbg }
    credentialLoadMock.mockReturnValue({ localStorage: { token: 'x' } })
    const mod = await import('./webview-manager.js')
    const WM = mod.default || mod
    const wm = new WM()
    wm.mainWindow = createMainWindow()

    const tabId = wm.createNewTabPage({ url: 'https://creator.xiaohongshu.com/', platform: 'xiaohongshu', accountId: 'xhs-3' })
    const view = wm._tabViews.get(tabId)
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(view.webContents.loadURL.mock.calls.map(c => c[0])).toEqual(['https://creator.xiaohongshu.com/'])
    __electronMock.__initialDocumentUrl = ''
    __electronMock.__webContentsDebuggerFactory = null
  })

  it('debugger attach 失败时降级回旧行为：did-finish-load 后注入并二段导航（fail-open）', async () => {
    patchViewAndSessionMocks()
    __electronMock.__webContentsDebuggerFactory = function () {
      return {
        attach: vi.fn(function () { throw new Error('debugger may already be attached') }),
        sendCommand: vi.fn(function () { return Promise.resolve() }),
        detach: vi.fn(),
      }
    }
    credentialLoadMock.mockReturnValue({ localStorage: { finder_username: 'v2_ctx' } })
    const mod = await import('./webview-manager.js')
    const WM = mod.default || mod
    const wm = new WM()
    wm.mainWindow = createMainWindow()

    wm.createNewTabPage({ url: 'https://channels.weixin.qq.com/', platform: 'tencent_video', accountId: 'tv-2' })

    const view = wm._tabViews.get(wm._activeTabId)
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(view.webContents.loadURL).toHaveBeenCalledTimes(1)
    expect(view.webContents._handlers['did-finish-load']).toBeTruthy()

    view.webContents._handlers['did-finish-load']()
    expect(view.webContents.executeJavaScript).toHaveBeenCalled()
    const script = view.webContents.executeJavaScript.mock.calls[0][0]
    expect(script).toContain('"finder_username":"v2_ctx"')
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(view.webContents.loadURL).toHaveBeenCalledTimes(2)
    expect(view.webContents.loadURL).toHaveBeenLastCalledWith('https://channels.weixin.qq.com/')
    __electronMock.__webContentsDebuggerFactory = null
  })

  // ─── 2026-09-24 头条账号标签「一直加载不出来」事故回归对（两条不变量）───
  // 根因（PR #2327 引入）：首个导航被门控在 CDP addScriptToEvaluateOnNewDocument 的
  // promise 上，而该命令在头条账号分区可永久挂起（事故日志：标签存活近 2 分钟命令
  // 从未返回，关闭瞬间才以 target closed 失败）→ 页面永不导航；关闭后回调又对已销毁
  // webContents 调 loadURL → 未处理 TypeError。
  it('CDP 命令永久挂起时超时降级，首个导航照常发生（头条加载挂死回归）', async () => {
    patchViewAndSessionMocks()
    __electronMock.__webContentsDebuggerFactory = function () {
      return {
        attach: vi.fn(function () {}),
        // 永不 resolve/reject：忠实镜像事故现场的 CDP 挂起
        sendCommand: vi.fn(function () { return new Promise(function () {}) }),
        detach: vi.fn(),
      }
    }
    credentialLoadMock.mockReturnValue({ localStorage: { session_token: 'hang' } })
    vi.useFakeTimers()
    try {
      const mod = await import('./webview-manager.js')
      const WM = mod.default || mod
      const wm = new WM()
      wm.mainWindow = createMainWindow()

      wm.createNewTabPage({ url: 'https://mp.toutiao.com/', platform: 'toutiao', accountId: 'tt-hang-1' })
      const view = wm._tabViews.get(wm._activeTabId)

      await vi.advanceTimersByTimeAsync(0)
      // 契约不变：首个**真实**导航仍被早期注入门控。引导空白文档是 2026-10-11 新增的
      // 前置动作（先把 Page 目标带起来），它不是用户可见导航，因此不计入「已导航」。
      expect(view.webContents.loadURL.mock.calls.map(c => c[0])).toEqual(['about:blank'])

      await vi.advanceTimersByTimeAsync(10000) // 超过 LS_INJECTION_TIMEOUT_MS
      expect(view.webContents.loadURL).toHaveBeenCalledWith('https://mp.toutiao.com/')
      // 超时后走旧补注入路径（fail-open），LS 仍会在 did-finish-load 后恢复
      expect(view.webContents._handlers['did-finish-load']).toBeTruthy()
      // 超时路径仍须如实回报「已引导空白文档」→ 调用方据此移除历史项
      const state = wm._tabStates.get(wm._activeTabId)
      expect(state.blankBootstrapPending).toBe(true)
      view.webContents._handlers['did-navigate']({}, 'https://mp.toutiao.com/')
      expect(state.blankBootstrapPending).toBe(false)
      expect(view.webContents.navigationHistory.removeEntryAtIndex).toHaveBeenCalledWith(0)
    } finally {
      vi.useRealTimers()
      __electronMock.__webContentsDebuggerFactory = null
    }
  })

  it('标签关闭后 CDP 命令才失败时，导航回调静默跳过且不产生未处理拒绝（loadURL undefined 回归）', async () => {
    patchViewAndSessionMocks()
    const unhandled = []
    const onUnhandled = (err) => { unhandled.push(err) }
    process.on('unhandledRejection', onUnhandled)
    let rejectCmd = null
    __electronMock.__webContentsDebuggerFactory = function () {
      return {
        attach: vi.fn(function () {}),
        sendCommand: vi.fn(function () {
          return new Promise(function (_resolve, reject) { rejectCmd = reject })
        }),
        detach: vi.fn(),
      }
    }
    credentialLoadMock.mockReturnValue({ localStorage: { session_token: 'hang' } })
    try {
      const mod = await import('./webview-manager.js')
      const WM = mod.default || mod
      const wm = new WM()
      wm.mainWindow = createMainWindow()
      wm.createNewTabPage({ url: 'https://mp.toutiao.com/', platform: 'toutiao', accountId: 'tt-close-1' })
      const tabId = wm._activeTabId
      const view = wm._tabViews.get(tabId)
      // 真实 Electron：close 之后 view.webContents 不复存在
      view.webContents.close = vi.fn(function () { view.webContents = undefined })
      // 微任务冲刷：让早期注入链完成 sendCommand 调用并登记 reject 句柄
      await new Promise(resolve => setTimeout(resolve, 0))

      wm.closeTab(tabId)
      // 忠实镜像事故时序：关闭瞬间 CDP 命令才以 target closed 失败
      expect(typeof rejectCmd).toBe('function')
      rejectCmd(new Error('target closed while handling command'))
      await new Promise(resolve => setTimeout(resolve, 0))
      await new Promise(resolve => setTimeout(resolve, 0))

      expect(unhandled).toEqual([])
    } finally {
      process.off('unhandledRejection', onUnhandled)
      __electronMock.__webContentsDebuggerFactory = null
    }
  })
})
