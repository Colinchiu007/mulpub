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
// 实现已收敛到 packages/shared-utils/src/network-egress-guard.js（全仓唯一一份）：
// 判定被抄成第二份必然漂移，本仓已在登录态三态映射与 Windows 文件锁夹具上各栽过一次。
// 行为契约（127/8 放行、账本 __mpBlockedEgress、unknown 出声、emit/destroy 语义）
// 由 apps/desktop/electron/services/network-egress-guard.test.js 锁住。
//
// 两个平面都必须装：socket 面只管**当前 realm**；#2783 的现场（`require('electron')` 在本 realm
// `spawnSync(process.execPath,[install.js])` 真下载 4 秒）恰恰发生在**子进程 realm**，
// 所以桌面 realm 若不装子进程面，这个缺陷的主案发现场就仍然无守卫（QM-6 外部评审独立命中）。
// 注入目标必须是共享 setup 本身（它同时装两面），而不是本文件 —— 本文件带 electron mock 装配，
// 用 `--require` 在子进程里加载它会拉起整个桌面测试外壳。
const egressGuard = require('../../packages/shared-utils/src/network-egress-guard.js')
egressGuard.installTestNetworkGuard()
egressGuard.installTestChildProcessGuard({
  setupPath: require.resolve('../../packages/shared-utils/network-egress-guard.setup.js'),
})

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
        // 与 once 同构：记录 handler 到 _handlers，使「事件是否被接线」可断言。
        // 旧实现是空函数，接线类回归（例如隐藏窗口没挂 render-process-gone）在测试里
        // 完全不可见——2026-10-16 排查 kuaishou 隐藏窗口崩溃时正是卡在这里。
        on: function (evt, handler) { this._handlers[evt] = handler; return this },
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

// ─── 测试期禁止执行 electron 的 install.js（#2794；采纳 QM-6 外部评审 Critical）───
// 机理：require(electron) 在"以为二进制没备好"的分支里会
// spawnSync(process.execPath, [<electron 包>/install.js])。CI 上那次 spawn 若真被执行就是数秒网络
// 取用，耗时会记到"当时正在跑的那条用例"头上（#2783 实测 15700ms 撞 testTimeout=10000），
// 而它打出的那一行与"夹具谎报导致的空转"**完全同字** —— 靠日志形状区分不了这两件事，
// 范围只到这一条 spawn，不声称覆盖测试期全部出站（那仍是 #2783 登记的欠账）。
// Node 对 'child_process' 与 'node:child_process' 返回**同一个**模块对象（本机实测），
// 所以这里补的动词对第三方包里裸写 require(child_process) 的调用同样生效。
const childProcessModule = require('node:child_process')
const ELECTRON_INSTALL_RE = /[\\/]node_modules[\\/]+electron[\\/]+install\.js$/
const GUARDED_SPAWNERS = ['spawnSync', 'spawn', 'execFileSync', 'execSync', 'fork']
function assertNoElectronInstallSpawn (fnName, args) {
  const flat = []
  for (const entry of args || []) {
    if (Array.isArray(entry)) { for (const inner of entry) flat.push(String(inner)) }
    else flat.push(String(entry))
  }
  const hit = flat.find((value) => ELECTRON_INSTALL_RE.test(value))
  if (hit !== undefined) {
    throw new Error(
      '[TEST-ELECTRON-INSTALL-SPAWN] ' + fnName + ' 试图执行 ' + hit +
        ' —— 这说明 require(electron) 走进了"二进制未备好"分支。' +
        '先跑 node scripts/ensure-electron.js 再重跑测试；桌面测试作业已由 quality-gate 的 Ensure Electron binary 步骤保证。'
    )
  }
}
for (const name of GUARDED_SPAWNERS) {
  const original = childProcessModule[name]
  if (typeof original !== 'function' || original.__mpNoElectronInstall) continue
  const wrapped = function (...args) {
    assertNoElectronInstallSpawn(name, args)
    return original.apply(this, args)
  }
  wrapped.__mpNoElectronInstall = true
  childProcessModule[name] = wrapped
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
