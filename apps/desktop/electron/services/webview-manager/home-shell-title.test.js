// @ts-check
/**
 * home-shell 标签标题与地址栏契约测试（2026-10-03 Bug 修复）
 *
 * 用户报告：「+」新标签内打开应用内页面（如文案改写）后，
 *   ① TabBar 标签标题恒为「新标签页」，不随页面变化；
 *   ② NavBar 地址栏占位恒显示「新标签页」。
 *
 * 契约：
 *   C1  + 新标签创建时不得传锁定 title（title 会置 titleLocked，导致 page-title-updated
 *       被主进程永久忽略——c3c395570 引入的锁定语义只适用于登录/平台标签等静态标题场景）；
 *   C2  home-shell 标签初始标题走 locale（tabs.newTabTitle），主进程默认值与渲染层一致；
 *   C3  主进程 webview-manager 支持运行时标题上报（home-shell SPA 页面切换 → document.title
 *       同步 → page-title-updated → TabBar/NavBar 实时刷新），home-shell 态不锁定标题；
 *   C4  home-shell 标签在壳态（未导航外站）时，地址栏 url 保持置空 —— 用户需求：
 *       网址输入框显示为空（占位符展示页面标题），只有导航到真实外站后才显示 URL。
 *
 * 回归锁三层：
 *   - 本文件（主进程行为 + 渲染层源码契约）
 *   - electron/services/webview-manager.test.js（createNewTabPage 标题语义）
 *   - src/tab-independent-home.test.js（App.vue 不硬编码标题）
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const desktopDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const read = (rel) => readFileSync(join(desktopDir, rel), 'utf8')

describe('C1/C2：+ 新标签初始标题链路（渲染层源码契约）', () => {
  const appSrc = read('src/App.vue')

  it('App.vue 的 onCreateTab 不再向主进程传锁定 title', () => {
    // 锚定 createTab 调用行本身（不依赖字符切片窗口，避免误检/漏检）
    const createTabCalls = appSrc.match(/tabStore\.createTab\(\{[^}]*\}\)/g) || []
    expect(createTabCalls.length).toBeGreaterThan(0)
    const plusTabCall = createTabCalls.find(c => c.includes('homeShell: true'))
    expect(plusTabCall).toBeTruthy()
    expect(plusTabCall).not.toMatch(/title:/)
  })

  it('App.vue 在 home-shell 分支接线 useTabDocumentTitle（start/stop 成对）', () => {
    expect(appSrc).toMatch(/useTabDocumentTitle/)
    expect(appSrc).toMatch(/tabTitleReporter\.start\(\)/)
    expect(appSrc).toMatch(/tabTitleReporter\.stop\(\)/)
  })

  it('locales zh/en 成对含 tabs.newTabTitle（主进程初始标题语义的渲染层孪生键）', async () => {
    // locales 结构拆分后改为模块导入断言（FRONTEND-FILE-SPLIT-PLAN-2026-10 v3 §3.2-6）
    const zh = (await import('../../../src/locales/zh.js')).default
    const en = (await import('../../../src/locales/en.js')).default
    expect(zh.tabs.newTabTitle).toBe('新标签页')
    expect(en.tabs.newTabTitle).toBe('New Tab')
  })
})

describe('C3/C4：主进程 home-shell 标题上报与地址栏置空（行为测试，直连模块避免 loader mock 污染）', () => {
  let WebviewManager
  let tabLifecycleModule

  const loadModules = async () => {
    vi.resetModules()
    __resetElectronMock()
    // opt-in：让 require('electron') 命中全局 mock（裸 Node 下 require('electron') 返回二进制路径字符串）
    __enableElectronMock()
    __registerMock('../logger', { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })
    __registerMock('../credential-store', { loadCredential: vi.fn(() => null) })
    // tab-lifecycle 顶层 require 了 login-network-diagnostics / js-eval-payload / 同目录兄弟模块，
    // 全部 mock 成无害形态，聚焦被测行为。
    __registerMock('../login-network-diagnostics', { attachLoginNetworkDiagnostics: vi.fn() })
    __registerMock('../../core/js-eval-payload', { buildEvalScript: vi.fn(() => '') })
    __registerMock('./constants', { SAFE_IDENTIFIER: /^[a-zA-Z0-9_-]+$/, AUTH_TAB_ID: 'auth-tab', HOME_TAB_ID: 'home', PAGE_TARGET_BOOTSTRAP_URL: 'about:blank' })
    __registerMock('./utils', {
      _getUserDataDir: () => '',
      // 2026-10-11：返回值改为 { injected, blankBootstrapped }；home-shell 标签不走该路径，
      // 这里只需保持形状正确（缺项会让 tab-lifecycle 的 result.* 读取抛错）。
      _injectLocalStorageAtDocumentStart: () => Promise.resolve({ injected: false, blankBootstrapped: false }),
      _removeBootstrapBlankHistoryEntry: () => false,
      _isBootstrapBlankDocument: () => false,
      normalizeElectronCookie: () => null,
      _homeShellUrl: () => 'http://127.0.0.1:5174/?mp-home-shell=1',
      _homeShellPreloadPath: () => '/fake/home-shell-preload.js',
      _urlHasHomeShellParam: (url) => String(url).includes('mp-home-shell=1'),
      _parseHashRoute: (url) => {
        const hash = String(url).split('#')[1] || ''
        return '/' + hash.replace(/^#\/?/, '')
      },
    })
    const lifecycle = await import('./tab-lifecycle.js')
    tabLifecycleModule = lifecycle
    const ipcHandlersModule = await import('./ipc-handlers.js')
    WebviewManager = function () {}
    WebviewManager.prototype.createNewTabPage = lifecycle.createNewTabPage
    WebviewManager.prototype._setupNav = lifecycle._setupNav
    WebviewManager.prototype.registerIpcHandlers = ipcHandlersModule.registerIpcHandlers
    // 直连模块需自带 electron mock：session.fromPartition + WebContentsView
    globalThis.__electronMock.session.fromPartition = function (partition) {
      const created = {
        partition,
        cookies: {
          setCalls: [],
          removeCalls: [],
          set: function (cookie) { created.cookies.setCalls.push(cookie); return Promise.resolve() },
          get: function () { return Promise.resolve([]) },
          remove: function (url, name) { created.cookies.removeCalls.push({ url, name }); return Promise.resolve() },
          flushStore: function () { return Promise.resolve() },
        },
        on: function () {},
      }
      return created
    }
    globalThis.__electronMock.WebContentsView = function (opts) {
      this._opts = opts || {}
      const handlers = {}
      this.webContents = {
        _handlers: handlers,
        on: function (evt, fn) { handlers[evt] = fn },
        once: function () {},
        canGoBack: function () { return false },
        canGoForward: function () { return false },
        loadURL: vi.fn(function () { return Promise.resolve() }),
        executeJavaScript: vi.fn(function () { return Promise.resolve() }),
        isDestroyed: function () { return false },
        setWindowOpenHandler: function (fn) { this._windowOpenHandler = fn },
        debugger: undefined,
      }
      this.setBounds = vi.fn()
      this.setVisible = vi.fn()
    }
  }

  /** 组装最小可用的 manager 实例（只含 createNewTabPage 依赖的字段） */
  function createManager () {
    const wm = new WebviewManager()
    wm.mainWindow = {
      isDestroyed: () => false,
      contentView: { addChildView: vi.fn(), removeChildView: vi.fn() },
      webContents: { send: vi.fn() },
    }
    wm._tabViews = new Map()
    wm._tabStates = new Map()
    wm._activeTabId = 'home'
    wm._homeTabId = 'home'
    wm._tabIdCounter = 0
    wm._subscribers = new Set(['sub-1'])
    wm.isEmbeddedViewsSuspended = () => false
    wm._hideAllTabs = () => {}
    wm._repositionAll = () => {}
    wm._broadcast = function (event, data) {
      for (const id of wm._subscribers) {
        wm.mainWindow.webContents.send('page-manager:' + event, { subscriberId: id, data })
      }
    }
    wm._broadcastNav = function (tabId) {
      const state = wm._tabStates.get(tabId)
      if (!state) return
      wm._broadcast('navigation-changed', {
        tabId,
        url: state.url,
        title: state.title,
        homeShell: !!state.homeShell,
        spaRoute: state.spaRoute || '',
      })
    }
    wm._setupNav = tabLifecycleModule._setupNav
    wm._maybeScheduleAutoSave = () => {}
    return wm
  }

  it('homeShell:true 且不传 title → 初始标题为「新标签页」，且 titleLocked=false', async () => {
    await loadModules()
    const wm = createManager()
    const tabId = wm.createNewTabPage({ homeShell: true })
    const state = wm._tabStates.get(tabId)
    expect(state.title).toBe('新标签页')
    expect(state.titleLocked).toBe(false)
  })

  it('home-shell SPA 内页面设置 document.title → page-title-updated 实时更新标题并广播', async () => {
    await loadModules()
    const wm = createManager()
    const tabId = wm.createNewTabPage({ homeShell: true })
    const view = wm._tabViews.get(tabId)
    const handler = view.webContents._handlers['page-title-updated']

    handler({}, '文案改写')
    expect(wm._tabStates.get(tabId).title).toBe('文案改写')
    const sent = wm.mainWindow.webContents.send.mock.calls.map(c => c[0])
    expect(sent).toContain('page-manager:tab-title-updated')
    const payload = wm.mainWindow.webContents.send.mock.calls
      .filter(c => c[0] === 'page-manager:tab-title-updated').pop()
    expect(payload[1].data).toEqual({ tabId, title: '文案改写' })

    handler({}, '发布')
    expect(wm._tabStates.get(tabId).title).toBe('发布')
  })

  it('登录/平台标签显式传 title → 保持锁定语义（回归保护：静态标题场景不受本次修复影响）', async () => {
    await loadModules()
    const wm = createManager()
    const tabId = wm.createNewTabPage({ url: 'https://creator.douyin.com', title: '抖音' })
    const state = wm._tabStates.get(tabId)
    expect(state.title).toBe('抖音')
    expect(state.titleLocked).toBe(true)
    const view = wm._tabViews.get(tabId)
    view.webContents._handlers['page-title-updated']({}, '网页标题')
    expect(state.title).toBe('抖音')
  })

  it('home-shell 标签壳态下地址栏 url 保持空（占位符展示标题，不灌 file:// 路径）', async () => {
    await loadModules()
    const wm = createManager()
    const tabId = wm.createNewTabPage({ homeShell: true })
    const view = wm._tabViews.get(tabId)
    // SPA 内 hash 路由切换（search 仍含 mp-home-shell=1）：did-navigate 进壳态分支
    view.webContents._handlers['did-navigate']({}, 'file:///app/dist/index.html?mp-home-shell=1#/rewrite')
    expect(wm._tabStates.get(tabId).homeShell).toBe(true)
    expect(wm._tabStates.get(tabId).url).toBe('')
    // did-navigate-in-page 同样保持置空
    view.webContents._handlers['did-navigate-in-page']({}, 'file:///app/dist/index.html?mp-home-shell=1#/accounts')
    expect(wm._tabStates.get(tabId).url).toBe('')
    const tabRow = Array.from(wm._tabStates.entries())
      .map(([id, s]) => ({ tabId: id, url: s.url }))
      .find(t => t.tabId === tabId)
    expect(tabRow.url).toBe('')
  })

  it('reportTabTitle IPC：按调用方 webContents.id 定位标签并更新标题、广播', async () => {
    await loadModules()
    const wm = createManager()
    const tabId = wm.createNewTabPage({ homeShell: true })
    const view = wm._tabViews.get(tabId)
    // 真实 Electron 中 webContents.id 是 readonly number 属性（electron.d.ts），不是 getId() 方法
    view.webContents.id = 4242

    // 组装最小 IPC handler 注册器（withSenderCheck 用真实实现）
    const handlers = new Map()
    const ipcMain = { handle: (channel, wrapped) => handlers.set(channel, wrapped) }
    wm.registerIpcHandlers(ipcMain)

    const handler = handlers.get('page-manager:report-tab-title')
    expect(typeof handler).toBe('function')

    const senderEvent = { sender: { id: 4242 }, senderFrame: { url: 'app://localhost/index.html' } }
    const res = await handler(senderEvent, { title: '文案改写' })
    expect(res.code).toBe(0)
    expect(res.data).toEqual({ matched: true })
    expect(wm._tabStates.get(tabId).title).toBe('文案改写')
    const payload = wm.mainWindow.webContents.send.mock.calls
      .filter(c => c[0] === 'page-manager:tab-title-updated').pop()
    expect(payload[1].data).toEqual({ tabId, title: '文案改写' })

    // 同标题重复上报 → 不再广播（幂等）
    wm.mainWindow.webContents.send.mockClear()
    await handler(senderEvent, { title: '文案改写' })
    expect(wm.mainWindow.webContents.send.mock.calls
      .filter(c => c[0] === 'page-manager:tab-title-updated').length).toBe(0)
  })

  it('reportTabTitle IPC：多标签并存时按 sender 精确归属（tab2 上报不得改 tab1）', async () => {
    await loadModules()
    const wm = createManager()
    const tab1 = wm.createNewTabPage({ homeShell: true })
    wm._tabViews.get(tab1).webContents.id = 1
    const tab2 = wm.createNewTabPage({ homeShell: true })
    wm._tabViews.get(tab2).webContents.id = 2

    const handlers = new Map()
    wm.registerIpcHandlers({ handle: (channel, wrapped) => handlers.set(channel, wrapped) })
    const handler = handlers.get('page-manager:report-tab-title')

    // sender = tab2 上报 → 仅 tab2 变化、仅广播 tab2
    const res = await handler({ sender: { id: 2 }, senderFrame: { url: 'app://localhost/index.html' } }, { title: '发布' })
    expect(res.code).toBe(0)
    expect(wm._tabStates.get(tab2).title).toBe('发布')
    expect(wm._tabStates.get(tab1).title).toBe('新标签页')
    const titles = wm.mainWindow.webContents.send.mock.calls
      .filter(c => c[0] === 'page-manager:tab-title-updated')
      .map(c => c[1].data)
    expect(titles).toEqual([{ tabId: tab2, title: '发布' }])
  })

  it('reportTabTitle IPC：未知 sender 归属失败可观测（warn 日志 + matched:false）', async () => {
    await loadModules()
    const wm = createManager()
    const tabId = wm.createNewTabPage({ homeShell: true })
    wm._tabViews.get(tabId).webContents.id = 1111

    const handlers = new Map()
    wm.registerIpcHandlers({ handle: (channel, wrapped) => handlers.set(channel, wrapped) })
    const handler = handlers.get('page-manager:report-tab-title')

    const trusted = { sender: { id: 1111 }, senderFrame: { url: 'app://localhost/index.html' } }
    // 空 title → 校验错误
    expect((await handler(trusted, { title: '' })).code).not.toBe(0)
    // 未知 sender → code 0 但 data.matched=false 且有 warn 日志（链路断裂可发现）
    const stranger = { sender: { id: 9999 }, senderFrame: { url: 'app://localhost/index.html' } }
    const miss = await handler(stranger, { title: '陌生页面' })
    expect(miss.code).toBe(0)
    expect(miss.data).toEqual({ matched: false })
    expect(wm._tabStates.get(tabId).title).not.toBe('陌生页面')
    // sender 缺失 → code 0，无异常
    expect((await handler({}, { title: 'x' })).code).toBe(0)
    // 超长 title → clamp 到 200 字符
    const longTitle = 'x'.repeat(500)
    await handler(trusted, { title: longTitle })
    expect(wm._tabStates.get(tabId).title.length).toBe(200)
  })
})

describe('宿主 API 归属契约锁（webContents.id 是属性不是方法，防 getId 死探针复发）', () => {
  // 评审 CRITICAL 实证：本仓曾手写 view.webContents.getId()，而 electron.d.ts 的
  // WebContents 类 0 处声明该方法——恒不匹配的死探针被手搓 mock 掩成假绿。
  // 本锁三防：①所用 API 真在 d.ts 的 class WebContents 段内；②源码禁现 getId 死探针；
  // ③解析不到 d.ts / 声明集异常小时必须红（防解析退化成空集合的假绿）。

  /** 从 __dirname 逐级上溯查找 electron.d.ts（node-linker=hoisted 装在仓库根 node_modules） */
  function locateElectronDts () {
    let dir = dirname(fileURLToPath(import.meta.url))
    for (let depth = 0; depth < 10; depth++) {
      const candidate = join(dir, 'node_modules', 'electron', 'electron.d.ts')
      if (existsSync(candidate)) return candidate
      const parent = dirname(dir)
      if (parent === dir) break
      dir = parent
    }
    return null
  }

  it('electron.d.ts 的 class WebContents 段内声明 id（number）且无 getId（归属依据核验）', () => {
    const dtsPath = locateElectronDts()
    // 找不到 d.ts 直接红（不允许 return 跳过——静默跳过会让锁永久失效）
    expect(dtsPath).toBeTruthy()
    const dts = readFileSync(dtsPath, 'utf8')
    // 规模下界：解析退化成空串时下述断言必然失败，这里显式声明预期规模
    expect(dts.length).toBeGreaterThan(100000)
    const classStart = dts.indexOf('class WebContents ')
    const classBodyStart = dts.indexOf('class WebContents extends', classStart)
    const start = classBodyStart !== -1 ? classBodyStart : classStart
    expect(start).toBeGreaterThan(-1)
    // 取 class WebContents 的声明段（到下一个顶级 class 为止的近似切片）
    const nextClass = dts.indexOf('\n    class ', start + 10)
    const segment = dts.slice(start, nextClass === -1 ? start + 60000 : nextClass)
    // id 必须以属性形态声明（readonly id: number）
    expect(segment).toMatch(/\bid\s*:\s*number/)
    // getId() 实例方法在 WebContents 段内不存在（0 处）。
    // 段内的 getOrCreateDevToolsTargetId / fromDevToolsTargetId 含 "TargetId(" 字样，
    // 但都不叫 getId( —— 用词边界精确匹配，注释里的误命中也要排除。
    const getIdMethodDecls = segment.match(/(?<![a-zA-Z])getId\s*\(/g) || []
    expect(getIdMethodDecls.length).toBe(0)
  })

  it('源码禁现 webContents.getId( 死探针（ipc-handlers.js 归属逻辑用 .id 属性）', () => {
    const handlerSrc = read('electron/services/webview-manager/ipc-handlers.js')
    expect(handlerSrc).not.toMatch(/webContents\.getId\s*\(/)
    expect(handlerSrc).toMatch(/webContents\.id === senderId/)
  })
})
