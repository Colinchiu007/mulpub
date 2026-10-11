// @ts-check
/* global vi, __electronMock */
/**
 * webview-manager 系列测试的共享夹具。
 *
 * 提取动机：单文件测试上限 1500 行（`.github/scripts/check-max-lines.js` 债务熔断）——「账号标签
 * 凭证 localStorage 的 document-start 注入」契约从 `webview-manager.test.js` 拆到
 * `webview-manager-ls-document-start.test.js` 后，夹具必须**只有一份**，否则两份 mock 会漂移
 * （本仓「两份同名实现」教训）。本文件不是 `*.test.js`，不会被 vitest 收集；因此 eslint 的
 * 「测试文件」globals 覆盖（`**\/*.test.js`）不适用于它，两个全局在本文件顶部显式声明。
 *
 * 依赖 vitest 全局（`vi`）与 `test-setup.js` 注入的 `__electronMock`，故只能在测试运行时调用。
 */

function createMainWindow () {
  return {
    isDestroyed: () => false,
    getBounds: () => ({ x: 0, y: 0, width: 1440, height: 900 }),
    // 客户区尺寸（真实 BrowserWindow 会扣除标题栏/菜单栏/边框）
    getContentBounds: () => ({ x: 8, y: 39, width: 1424, height: 861 }),
    webContents: { send: vi.fn() },
    contentView: { addChildView: vi.fn(), removeChildView: vi.fn() }
  }
}

function patchViewAndSessionMocks () {
  __electronMock.WebContentsView = function (opts) {
    this._opts = opts || {}
    const handlers = {}
    // 真实 Electron：全新 WebContentsView 的 getURL() 为空串（尚无任何文档）；
    // 用例可经 __electronMock.__initialDocumentUrl 模拟「复用已有文档的 view」。
    let currentUrl = __electronMock.__initialDocumentUrl || ''
    // 导航历史模型：loadURL 推入一条 entry（about:blank 也算），removeEntryAtIndex 同步移除。
    // 只服务于「引导 about:blank 不得污染返回键」这一条不变量，其余用例不读它。
    const historyEntries = []
    this.webContents = {
      _handlers: handlers,
      _windowOpenHandler: null,
      // 真实 Electron 中 webContents.session 即构造时 webPreferences.session 传入的分区，mock 必须同物挂接；
      // 否则 Cookie 提取路径在测试中永远是 undefined，吞错路径会被误放行（2026-09-22 getAll 回归教训）。
      session: (opts && opts.webPreferences && opts.webPreferences.session) || null,
      on: function (evt, fn) { handlers[evt] = fn },
      once: function () {},
      canGoBack: function () { return historyEntries.length > 1 },
      canGoForward: function () { return false },
      getURL: function () { return currentUrl },
      navigationHistory: {
        _entries: historyEntries,
        getEntryAtIndex: function (i) { return historyEntries[i] || null },
        getActiveIndex: function () { return historyEntries.length - 1 },
        getAllEntries: function () { return historyEntries.slice() },
        length: function () { return historyEntries.length },
        canGoBack: function () { return historyEntries.length > 1 },
        removeEntryAtIndex: vi.fn(function (i) { historyEntries.splice(i, 1); return true }),
        clear: vi.fn(function () { historyEntries.length = 0 }),
      },
      loadURL: vi.fn(function (u) {
        currentUrl = String(u || '')
        historyEntries.push({ url: currentUrl })
        // 跨 mock 的时序取证口：用例可预设 __electronMock.__loadUrlLog 后按顺序断言
        // 「about:blank 引导 → CDP 注入 → 首个真实导航」这条不可交换的次序。
        if (Array.isArray(__electronMock.__loadUrlLog)) __electronMock.__loadUrlLog.push('loadURL:' + currentUrl)
        return Promise.resolve()
      }),
      executeJavaScript: vi.fn(function () { return Promise.resolve() }),
      isDestroyed: function () { return false },
      setWindowOpenHandler: function (fn) { this._windowOpenHandler = fn },
      // debugger mock：测试预设 __webContentsDebuggerFactory 返回 CDP stub；
      // 未预设时保持 undefined，等价真实环境 debugger 不可用（降级路径回归锚点）。
      debugger: (__electronMock.__webContentsDebuggerFactory ? __electronMock.__webContentsDebuggerFactory() : undefined),
    }
    this.setBounds = vi.fn()
    this.setVisible = vi.fn()
  }
  const partitions = []
  __electronMock.session._partitions = partitions
  // 测试可预设「分区残留 Cookie」：cleanSession 用例据此断言清除行为
  __electronMock.session._staleCookies = null
  __electronMock.session.fromPartition = function (partition) {
    const created = {
      partition,
      cookies: {
        // 契约：忠实镜像真实 Electron session.cookies API——只有 get/set/remove/flushStore，不存在 getAll。
        // 测试可通过 _store 预设 get() 返回值。
        setCalls: [],
        removeCalls: [],
        _store: undefined,
        set: function (cookie) { created.cookies.setCalls.push(cookie); return Promise.resolve() },
        get: function () { return Promise.resolve(created.cookies._store !== undefined ? created.cookies._store : (__electronMock.session._staleCookies || [])) },
        remove: function (url, name) { created.cookies.removeCalls.push({ url, name }); return Promise.resolve() },
        flushStore: function () { return Promise.resolve() },
      },
      on: function () {},
    }
    partitions.push(created)
    return created
  }
  return partitions
}

module.exports = { createMainWindow, patchViewAndSessionMocks }
