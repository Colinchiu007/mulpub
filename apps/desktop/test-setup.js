// @ts-check
/**
 * test-setup.js — vitest 全局测试设置
 *
 * 提供 4 个全局工具（vitest globals: true 已开启，无需 import）：
 * - __electronMock       — electron 模块的全局单例 mock（app/BrowserWindow 等）
 * - __registerMock(path, obj) — 注册模块 mock，拦截 Module.prototype.require
 * - __enableElectronMock()    — opt-in 启用 electron mock 拦截
 * - __resetElectronMock()     — 重置 electron mock 状态（beforeEach 调用）
 *
 * 设计原因：vi.mock 仅在 vitest SSR 转换层生效，不适用于 CJS require 加载的模块。
 * electron 主进程代码用 require() 加载，需要通过 Module._load 拦截。
 */
const Module = require('module')

// ─── 出站网络守卫（缺陷 G）───
// 为什么必须有：全仓 `nock` / `msw` / `setupServer` 命中为 **0** —— 没有任何传输层兜底，
// "测试不出网"完全依赖每个文件手工注入桩。漏一处就是一次真出站，而真出站挂起时先撞上的是框架
// testTimeout（10s），报错只剩一句 `Test timed out in 10000ms`，既看不到目标主机也看不出该注入什么。
// 加守卫前实测：一条 `fetch('http://example.org:8099/')` 的用例正好挂满 10.009s 被框架杀掉。
// 更糟的是"预算倒挂"：生产侧 axios `timeout: 15000` > `testTimeout=10000`，框架必然抢先。
//
// 口径：
// - **放行** loopback（127/8、::1、localhost、0.0.0.0）与 unix / named pipe —— 全仓 31 个测试文件
//   依赖 `listen(0, '127.0.0.1')` 的临时端口本地服务，误伤它们的代价远高于漏拦一例真出网。
// - 其余一律按 Node 自身连接失败语义 **异步 emit 'error'**（nextTick，给调用方同步挂 handler 的窗口），
//   错误信息里必须带主机名 + 出路指引，让人一次就能修对。
// - 在 connect 入口拦，因此 DNS 也不会发生（不会把 CI 拖进解析超时）。
const net = require('net')
const NETWORK_GUARD_APPLIED = '__mpTestNetworkGuardApplied'

function isLoopbackHostForTest (rawHost) {
  const host = String(rawHost || '').trim().replace(/^\[(.*)\]$/, '$1').toLowerCase()
  if (!host) return false
  if (host === 'localhost' || host === '::1' || host === '0.0.0.0' || host === '::') return true
  if (host.startsWith('127.')) return true
  if (host.startsWith('::ffff:127.')) return true
  return false
}

function readConnectTarget (args) {
  const first = args[0]
  // Node 24 的 http/undici 走 `net:254 Object.connect` 时，会把 `[options, cb]` **作为单个数组参数**
  // 传给 Socket.prototype.connect（实测 arg0 = Array，keys=['0','1']）。不展平就会把目标判成
  // unknown 而直接放过 —— 第一版守卫正是这样漏掉的，必须递归展开一层。
  if (Array.isArray(first)) return readConnectTarget(first)
  if (first && typeof first === 'object') {
    if (typeof first.path === 'string' && first.path) return { kind: 'path' }
    return { kind: 'host', host: first.host || first.hostname, port: first.port }
  }
  if (typeof first === 'string') {
    // 'connect(path)' 走这里；'connect(host, port)' 也走这里，用分隔符区分
    if (first.includes('/') || first.includes('\\')) return { kind: 'path' }
    return { kind: 'host', host: first, port: typeof args[1] === 'number' ? args[1] : undefined }
  }
  if (typeof first === 'number') {
    return { kind: 'host', host: typeof args[1] === 'string' ? args[1] : undefined, port: first }
  }
  return { kind: 'unknown' }
}

if (!net.Socket.prototype.connect[NETWORK_GUARD_APPLIED]) {
  const originalConnect = net.Socket.prototype.connect
  const guardedConnect = function (...args) {
    const target = readConnectTarget(args)
    if (target.kind !== 'path' && !target.host) {
      // 读不出目标就放行是必要的（不能因守卫误伤正常用例），但必须**出声**：
      // 静默放过等于守卫被 Node 的一次版本升级悄悄摘掉，正是本仓库已经吃过两次的"假绿"形状。
      if (!net.Socket.prototype.connect.__mpGuardWarned) {
        net.Socket.prototype.connect.__mpGuardWarned = true
        console.warn('[TEST-NETWORK-BLOCKED] 守卫警告：无法从 connect 参数中识别目标主机（kind='
          + target.kind + '），本次放行。Node 版本=' + process.version
          + '，arg0 类型=' + (args[0] && args[0].constructor && args[0].constructor.name))
      }
    }
    if (target.kind === 'host' && target.host && !isLoopbackHostForTest(target.host)) {
      const socket = this
      const portText = target.port === undefined ? '' : ':' + target.port
      const detail = `[TEST-NETWORK-BLOCKED] 单元测试禁止真实出站连接：${target.host}${portText}。`
        + '请注入传输层桩（global.fetch = vi.fn() / __registerMock("axios", 桩) / 构造注入 axios|fetchImpl），'
        + '或把被测服务起在 127.0.0.1 的临时端口（listen(0, "127.0.0.1")）后访问 loopback 地址。'
      const error = new Error(detail)
      error.code = 'ERR_TEST_NETWORK_BLOCKED'
      error.host = target.host
      error.port = target.port

      // **必须同时落一份"账"并 console.warn**：Node 22 的 _http_client 会把 socket 早期错误改写成
      // `socket hang up`（CI 实测，本地 Node 24 不会），错误文案到不了调用方 —— 只在异常里带信息
      // 等于"可诊断性依赖运行时版本"。记录 + 打印与版本无关。
      const blocked = globalThis.__mpBlockedEgress || (globalThis.__mpBlockedEgress = { list: [], seen: new Set() })
      const key = target.host + portText
      blocked.list.push({ host: target.host, port: target.port, at: Date.now(), node: process.version })
      if (!blocked.seen.has(key)) {
        blocked.seen.add(key)
        console.warn(detail)
      }

      process.nextTick(() => {
        const hasListener = socket.listenerCount('error') > 0
        if (!socket.destroyed && hasListener) {
          try { socket.emit('error', error) } catch (_) { /* 已被上层消化 */ }
          // destroy **不带** error 参数：上面已 emit 过，再传 error 会让 Node 二次触发 'error'，
          // 而调用方常用 once('error') —— 第二次没有监听者就变成 unhandled error 污染 CI 日志。
          socket.destroy()
        } else {
          // 没有错误监听者的调用方：把错误交给 Node 默认处理（抛出未捕获异常 = 响亮失败）。
          // 不能只 destroy() —— 那会让"等 error 事件"的调用方静默挂起，比崩掉更糟。
          socket.destroy(error)
        }
      })
      return socket
    }
    return originalConnect.apply(this, args)
  }
  guardedConnect[NETWORK_GUARD_APPLIED] = true
  net.Socket.prototype.connect = guardedConnect
}

// ─── 语言确定性 ───
// 测试环境固定系统语言为 zh-CN（user-facing-messages 规范），保证中文文案断言可复现。
// 该赋值已抽到 setupFiles 的**第一项** test-setup-locale.js：本文件顶部的 import 会被
// ESM 提升到文件体之前执行，若写在这里，任何在顶部 import 链里加载 @/i18n 的组件
// （如 UiSkeleton.vue）都会先按 jsdom 默认 en-US 初始化 locale，导致默认语言漂移。

// ─── electron mock 单例 ───
const electronMock = {
  app: {
    _handlers: {},
    // vi.fn 以支持 toHaveBeenCalledWith 断言；实现仍写入 _handlers 供 emit / 测试手动触发
    on: vi.fn(function (evt, fn) { this._handlers[evt] = fn; return this }),
    off: function (evt) { delete this._handlers[evt]; return this },
    emit: function (evt, ...args) { if (this._handlers[evt]) this._handlers[evt](...args) },
    quit: vi.fn(function () {}),
    getPath: function () { return '/tmp/test-electron-path' },
    getName: function () { return 'Multi-Publish' },
    getVersion: function () { return '0.0.0-test' },
    isReady: function () { return true },
    whenReady: function () { return Promise.resolve() },
    isPackaged: false,
    setAppUserModelId: function () {},
  },
  BrowserWindow: (function () {
    // 用 vi.fn 包装构造函数，使其具备 .mock 调用跟踪（供 toHaveBeenCalledTimes / mock.calls 断言）
    const fn = vi.fn(function MockBrowserWindow(opts) {
      this._opts = opts || {}
      this._handlers = {}
      this.webContents = {
        _handlers: {},
        send: function () {},
        on: function () {},
        once: function (evt, handler) { this._handlers[evt] = handler; return this },
        openDevTools: function () {},
        closeDevTools: function () {},
        isDestroyed: function () { return false },
        executeJavaScript: function () { return Promise.resolve() },
        loadURL: function () { return Promise.resolve() },
        loadFile: function () { return Promise.resolve() },
      }
      this.loadURL = vi.fn(function () { return Promise.resolve() })
      this.loadFile = vi.fn(function () { return Promise.resolve() })
      // on/once 记录 handler 到 _handlers，便于测试手动触发 ready-to-show/closed/resize 回调
      this.on = function (evt, handler) { this._handlers[evt] = handler; return this }
      this.once = function (evt, handler) { this._handlers[evt] = handler; return this }
      this.off = function (evt) { delete this._handlers[evt]; return this }
      this.show = vi.fn(function () {})
      this.hide = function () {}
      this.close = function () {}
      this.focus = function () {}
      this.minimize = function () {}
      this.maximize = function () {}
      this.restore = function () {}
      this.isDestroyed = function () { return this._destroyed }
      this.destroy = function () { this._destroyed = true }
      this._destroyed = false
      // Electron 30+ 窗口客户区容器：WebContentsView 等子视图的挂载点（vi.fn 供断言）
      this.contentView = { addChildView: vi.fn(function () {}), removeChildView: vi.fn(function () {}) }
      // 客户区尺寸（不含标题栏/边框），供子视图铺满布局使用
      this.getContentBounds = function () { return { x: 0, y: 0, width: 800, height: 600 } }
      this.isMinimized = function () { return false }
      this.isMaximized = function () { return false }
      this.isVisible = function () { return true }
      this.getBounds = function () { return { x: 0, y: 0, width: 800, height: 600 } }
      this.setBounds = function () {}
      this.setSize = function () {}
      this.setPosition = function () {}
      this.center = function () {}
      this.setTitle = function () {}
      // 记录实例（动态引用 fn._instances，使 __resetElectronMock 重置数组后仍生效）
      fn._instances.push(this)
    })
    fn._instances = []
    fn.getAllWindows = vi.fn(function () { return fn._instances.slice() })
    fn.fromWebContents = function () { return fn._instances[0] || null }
    fn.focusedWindow = null
    return fn
  })(),
  session: {
    defaultSession: {
      cookies: { get: function () { return Promise.resolve([]) }, set: function () { return Promise.resolve() } },
      on: function () {},
    },
    // 每个分区返回**新对象**（真实 Electron 语义：分区即独立 session）。
    // 若恒返回 defaultSession，login-network-diagnostics 的幂等标记
    // ses.__loginNetDiagAttached 会跨用例残留，使「监听注册一次」断言依赖用例顺序。
    fromPartition: function () {
      return {
        cookies: { get: function () { return Promise.resolve([]) }, set: function () { return Promise.resolve() } },
        on: function () {},
        webRequest: { onErrorOccurred: vi.fn(function () {}), onCompleted: vi.fn(function () {}) },
        resolveProxy: vi.fn(function () { return Promise.resolve('DIRECT') }),
      }
    },
  },
  ipcMain: {
    _handlers: {},
    handle: function (ch, fn) { this._handlers[ch] = fn },
    removeHandler: function (ch) { delete this._handlers[ch] },
    on: function (ch, fn) { this._handlers[ch] = fn },
    off: function (ch) { delete this._handlers[ch] },
  },
  ipcRenderer: {
    send: function () {},
    invoke: function () { return Promise.resolve({}) },
    // _handlers 记录订阅者：preload 侧推送事件（如 auth:access-level-invalidated）
    // 必须能在用例里被手动触发，否则「主进程推送 → 立即生效」的契约无法回归。
    _handlers: {},
    on: function (ch, fn) {
      this._handlers[ch] = this._handlers[ch] || []
      this._handlers[ch].push(fn)
      return this
    },
    off: function (ch, fn) { return this.removeListener(ch, fn) },
    removeListener: function (ch, fn) {
      this._handlers[ch] = (this._handlers[ch] || []).filter((h) => h !== fn)
      return this
    },
    removeAllListeners: function (ch) { delete this._handlers[ch]; return this },
    emit: function (ch, ...args) {
      const handlers = (this._handlers[ch] || []).slice()
      for (const handler of handlers) handler({ sender: this, kind: 'ipc' }, ...args)
      return handlers.length
    },
  },
  // preload/index.js 顶层调用 contextBridge.exposeInMainWorld，需提供空实现避免 TypeError
  contextBridge: {
    exposeInMainWorld: function () {},
  },
  WebContentsView: function (opts) {
    this._opts = opts || {}
    this.webContents = {
      send: function () {},
      on: function () {},
      once: function () {},
      loadURL: function () { return Promise.resolve() },
      executeJavaScript: function () { return Promise.resolve() },
      isDestroyed: function () { return false },
      // 后台节流开关（真实 WebContents 上的方法；VisibilityState 类字段宿主并不存在）
      getBackgroundThrottling: function () { return true },
    }
    // 用 vi.fn 记录布局调用：回归测试需断言登录视图从 (0,0) 铺满、不依赖硬编码偏移
    this.setBounds = vi.fn(function () {})
    this.setVisible = vi.fn(function () {})
    // View.getVisible()（d.ts 明示为"应否绘制"，非屏幕可见）——归因日志读它
    this.getVisible = function () { return true }
  },
  Menu: {
    buildFromTemplate: function (t) { return t },
    setApplicationMenu: function () {},
  },
  Tray: function () {
    this.setToolTip = function () {}
    this.setContextMenu = function () {}
    this.on = function () { return this }
    this.destroy = function () {}
  },
  nativeImage: {
    createFromPath: function () { return { isEmpty: function () { return true } } },
    createFromBuffer: function () { return { isEmpty: function () { return true } } },
  },
  shell: {
    openExternal: function () { return Promise.resolve() },
    openPath: function () { return Promise.resolve() },
    showItemInFolder: function () {},
  },
  dialog: {
    showMessageBox: function () { return Promise.resolve({ response: 0 }) },
    showErrorBox: function () {},
    showOpenDialog: function () { return Promise.resolve({ canceled: true, filePaths: [] }) },
    showSaveDialog: function () { return Promise.resolve({ canceled: true, filePath: '' }) },
  },
  Notification: function () {
    this.show = function () {}
    this.on = function () { return this }
  },
  globalShortcut: {
    register: function () { return true },
    unregister: function () {},
    unregisterAll: function () {},
  },
  powerMonitor: {
    on: function () {},
  },
  screen: {
    getPrimaryDisplay: function () { return { bounds: { width: 1920, height: 1080 }, workArea: { width: 1920, height: 1080, x: 0, y: 0 } } },
    getAllDisplays: function () { return [this.getPrimaryDisplay()] },
  },
  systemPreferences: {
    getUserDefault: function () { return '' },
  },
}

// ─── 模块 mock 注册表 ───
const mockRegistry = new Map()
let electronMockEnabled = false

function registerMock(modulePath, mockObj) {
  mockRegistry.set(modulePath, mockObj)
}

function enableElectronMock() {
  electronMockEnabled = true
}

function disableElectronMock() {
  electronMockEnabled = false
}

function resetElectronMock() {
  // 重置 handler 和实例
  electronMock.app._handlers = {}
  electronMock.ipcMain._handlers = {}
  // preload 侧订阅的推送事件同样复位，避免跨用例串味（旧模块实例的 handler 不应继续收推送）
  electronMock.ipcRenderer._handlers = {}
  electronMock.BrowserWindow._instances = []
  electronMock.BrowserWindow.focusedWindow = null
  // 清空 vi.fn 调用记录（不清实现）：app.on / app.quit / BrowserWindow 构造 / getAllWindows
  electronMock.app.on.mockClear()
  electronMock.app.quit.mockClear()
  electronMock.BrowserWindow.mockClear()
  electronMock.BrowserWindow.getAllWindows.mockClear()
  // 不清空 mockRegistry（测试可能跨 beforeEach 复用注册）
}

// ─── 拦截 Module._load ───
const originalLoad = Module._load
Module._load = function (request, parent, isMain) {
  // 1. electron mock（opt-in）
  if (electronMockEnabled && (request === 'electron' || request.startsWith('electron/'))) {
    return electronMock
  }
  // 2. 直接匹配 request 字符串（如 './services/logger'、'@multi-publish/...'）
  if (mockRegistry.has(request)) return mockRegistry.get(request)
  // 3. 通过 resolved filename 匹配（处理 require('./x') 与注册 key './x' 路径差异）
  if (parent && parent.filename) {
    // 内置模块（crypto/path/fs/...）不走 filename 匹配：Node 对内置模块 _resolveFilename
    // 返回自身名（如 'crypto'），会被 __registerMock('./crypto', ...) 归一化后误命中。
    // 刻意 mock 内置模块必须用精确名注册（如 __registerMock('fs', ...)），已在步骤 2 命中。
    if (Module.builtinModules.includes(request)) return originalLoad.apply(this, arguments)
    let resolved
    try { resolved = Module._resolveFilename(request, parent, isMain) } catch (e) { /* 模块不存在时跳过 */ }
    if (resolved) {
      if (mockRegistry.has(resolved)) return mockRegistry.get(resolved)
      for (const [key, val] of mockRegistry) {
        // 标准化 key 和 resolved：去掉 './' 前缀 + 统一路径分隔符为 '/'（Windows 兼容）
        const normalizedKey = key.replace(/^\.\//, '').replace(/\\/g, '/')
        const normalizedResolved = resolved.replace(/\\/g, '/')
        // 精确匹配路径段，避免 "path" 误匹配 "path-utils" 等子串问题
        if (normalizedKey && (
          normalizedResolved === normalizedKey ||
          normalizedResolved.endsWith('/' + normalizedKey) ||
          normalizedResolved.endsWith('/' + normalizedKey + '.js')
        )) return val
      }
    }
  }
  return originalLoad.apply(this, arguments)
}

// ─── 暴露全局变量（vitest globals: true） ───
global.__electronMock = electronMock
global.__registerMock = registerMock
global.__enableElectronMock = enableElectronMock
global.__disableElectronMock = disableElectronMock
global.__resetElectronMock = resetElectronMock

// ─── 全局 afterEach 清理（可选，测试文件可自行 beforeEach 调 __resetElectronMock） ───
// 不在此处自动调用 reset，避免干扰测试文件自己的 beforeEach 顺序

// ─── 全局组件注册（镜像 main.js 的全局注册） ───
// 确保 <EmptyState>/<LoadingState>/<UiSkeleton> 在单测中可被解析，与运行态一致。
// 否则 3.3 收编的视图测试会因组件无法解析而断言失败。
import { config as vtConfig } from '@vue/test-utils'
import EmptyState from './src/components/EmptyState.vue'
import LoadingState from './src/components/LoadingState.vue'
import UiSkeleton from './src/components/UiSkeleton.vue'
vtConfig.global.components = {
  ...(vtConfig.global.components || {}),
  EmptyState,
  LoadingState,
  UiSkeleton,
}

// ─── Element Plus 图标容器全局 stub（T1-5 图标语义化）───
// 组件模板里的 <el-icon><Xxx /></el-icon> 在真实应用由 Element Plus 插件全局注册；
// 单测环境未安装该插件，会打印 "Failed to resolve component: el-icon" 并影响渲染结果。
// 此处全局 stub 为不含 slot 的占位元素：既消除解析告警，也避免要求每个测试文件都注册图标子组件。
try {
  const { config } = require('@vue/test-utils')
  if (config && config.global) {
    config.global.stubs = Object.assign({}, config.global.stubs, {
      'el-icon': { template: '<span class="el-icon-stub" />' },
      'el-dialog': { template: '<div class="el-dialog"><slot></slot></div>' },
      'el-message-box': { template: '<div class="el-message-box"><slot></slot></div>' },
      'el-form': { template: '<form class="el-form"><slot></slot></form>' },
      'el-form-item': { template: '<div class="el-form-item"><slot></slot></div>' },
      'el-button': { template: '<button class="el-button"><slot></slot></button>' },
      'el-tabs': { template: '<div class="el-tabs"><slot></slot></div>' },
      'el-tab-pane': { template: '<div class="el-tab-pane"><slot></slot></div>' },
      'el-input': { template: '<input class="el-input" />' },
      'el-select': { template: '<select class="el-select"><slot></slot></select>' },
      'el-option': { template: '<option class="el-option"><slot></slot></option>' },
      'el-table': { template: '<table class="el-table"><slot></slot></table>' },
      'el-table-column': { template: '<th class="el-table-column"><slot></slot></th>' },
      'el-pagination': { template: '<div class="el-pagination"><slot></slot></div>' },
      'el-badge': { template: '<span class="el-badge"><slot></slot></span>' },
      'el-dropdown': { template: '<span class="el-dropdown"><slot></slot></span>' },
      'el-dropdown-menu': { template: '<ul class="el-dropdown-menu"><slot></slot></ul>' },
      'el-dropdown-item': { template: '<li class="el-dropdown-item"><slot></slot></li>' },
      'el-scrollbar': { template: '<div class="el-scrollbar"><slot></slot></div>' },
      // reference（触发器，始终可见）与默认 slot（弹出内容）都要渲染，
      // 否则放在 <template #reference> 里的可点击元素在单测中会丢失。
      'el-popover': { template: '<div class="el-popover"><slot name="reference"></slot><slot></slot></div>' },
      'el-tooltip': { template: '<span class="el-tooltip"><slot></slot></span>' },
      'el-switch': { template: '<span class="el-switch"><slot></slot></span>' },
      'el-slider': { template: '<div class="el-slider"><slot></slot></div>' },
      'el-rate': { template: '<div class="el-rate"><slot></slot></div>' },
      'el-color-picker': { template: '<span class="el-color-picker"><slot></slot></span>' },
      'el-transfer': { template: '<div class="el-transfer"><slot></slot></div>' },
      'el-skeleton': { template: '<div class="el-skeleton"><slot></slot></div>' },
      'el-skeleton-item': { template: '<div class="el-skeleton-item"><slot></slot></div>' },
      'el-tag': { template: '<span class="el-tag"><slot></slot></span>' },
      'el-card': { template: '<div class="el-card"><slot></slot></div>' },
      'el-row': { template: '<div class="el-row"><slot></slot></div>' },
      'el-col': { template: '<div class="el-col"><slot></slot></div>' },
      'el-space': { template: '<div class="el-space"><slot></slot></div>' },
      'el-backtop': { template: '<span class="el-backtop"><slot></slot></span>' },
      'el-page-header': { template: '<div class="el-page-header"><slot></slot></div>' },
      'el-divider': { template: '<hr class="el-divider" />' },
      'el-descriptions': { template: '<table class="el-descriptions"><slot></slot></table>' },
      'el-descriptions-item': { template: '<th class="el-descriptions-item"><slot></slot></th>' },
      'el-cascader': { template: '<div class="el-cascader"><slot></slot></div>' },
      'el-cascader-panel': { template: '<div class="el-cascader-panel"><slot></slot></div>' },
      'el-tree': { template: '<div class="el-tree"><slot></slot></div>' },
      'el-tree-node': { template: '<div class="el-tree-node"><slot></slot></div>' },
      'el-tree-v2': { template: '<div class="el-tree-v2"><slot></slot></div>' },
      'el-check-tag': { template: '<span class="el-check-tag"><slot></slot></span>' },
      'el-data-container': { template: '<div class="el-data-container"><slot></slot></div>' },
    })
  }
} catch (_) { /* 非组件测试场景（纯 node 用例）忽略 */ }
