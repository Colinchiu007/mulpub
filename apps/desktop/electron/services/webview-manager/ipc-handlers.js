// @ts-check
/**
 * WebviewManager IPC 桥接模块
 * 注册所有 page-manager: IPC handlers
 */
const log = require('../logger')
const EC = require('../../core/error-codes').ERROR
const { withSenderCheck } = require('../../ipc-handlers/helpers')

module.exports = {
  /**
   * 注册 IPC handlers（供 main.js 调用）
   */
  registerIpcHandlers (injectedIpcMain) {
    // P1-14：必须注入 access-controlled ipcMain（createAccessControlledIpcMain）。
    // 禁止回退全局 ipcMain —— 那会同时绕过 isTrustedSender 来源校验与许可证/权益门禁，
    // 且在纯 Node（单测）下退化成无信息量的 TypeError。未注入即 fail-closed 抛错。
    if (!injectedIpcMain) {
      throw new Error('[IPC] webview-manager registerIpcHandlers 需要注入受控 ipcMain（禁止使用全局 ipcMain）');
    }
    var ipcMain = injectedIpcMain;
    var self = this;

    // ─── page-manager: IPC handlers（新标签页系统）──

    ipcMain.handle('page-manager:create-new-tab-page', withSenderCheck(function (_, arg) {
      try {
        var tabId = self.createNewTabPage(arg || {})
        return tabId ? { code: 0, data: { tabId: tabId } } : { code: EC.REQUEST_ERROR, message: '创建标签页失败，请重试' }
      } catch (e) { log.warn('WebviewManager', 'ipc handler error: ' + ((e && e.message) || e)); return { code: EC.REQUEST_ERROR, message: e.message } }
    }))

    ipcMain.handle('page-manager:close-tab', withSenderCheck(function (_, tabId) {
      try {
        self.closeTab(tabId)
        return { code: 0 }
      } catch (e) { log.warn('WebviewManager', 'ipc handler error: ' + ((e && e.message) || e)); return { code: EC.REQUEST_ERROR, message: e.message } }
    }))

    ipcMain.handle('page-manager:switch-tab', withSenderCheck(function (_, tabId) {
      try {
        self.switchToTab(tabId)
        return { code: 0 }
      } catch (e) { log.warn('WebviewManager', 'ipc handler error: ' + ((e && e.message) || e)); return { code: EC.REQUEST_ERROR, message: e.message } }
    }))

    ipcMain.handle('page-manager:navigate', withSenderCheck(function (_, arg) {
      if (!arg || typeof arg !== 'object') return { code: EC.VALIDATION_ERROR, message: 'Missing args' }
      try {
        self.navigateTab(arg.tabId, arg.url)
        return { code: 0 }
      } catch (e) { log.warn('WebviewManager', 'ipc handler error: ' + ((e && e.message) || e)); return { code: EC.REQUEST_ERROR, message: e.message } }
    }))

    // 共享左侧边栏驱动当前聚焦的 home-shell 标签在其自身 SPA 内导航（见 navigateActiveHomeShell）
    ipcMain.handle('page-manager:navigate-active-home-shell', withSenderCheck(function (_, arg) {
      try {
        var path = arg && arg.path
        return { code: 0, data: self.navigateActiveHomeShell(path) }
      } catch (e) { log.warn('WebviewManager', 'ipc handler error: ' + ((e && e.message) || e)); return { code: EC.REQUEST_ERROR, message: e.message, data: { handled: false } } }
    }))

    // home-shell SPA 上报页面标题（2026-10-03）：按调用方 webContents 定位标签，
    // 更新 _tabStates.title 并广播 tab-title-updated。
    // ⚠️ 标识匹配必须用 webContents.id（electron.d.ts: readonly id: number 属性）——
    // WebContents 类不存在 getId() 方法（评审实测 d.ts 全段 0 处），用了即恒不匹配的死探针
    //（同族事故：AGENTS.md 已登记的 getVisibilityState 假探针，单测全绿真机死链）。
    ipcMain.handle('page-manager:report-tab-title', withSenderCheck(function (event, arg) {
      try {
        var title = arg && typeof arg.title === 'string' ? arg.title.trim().slice(0, 200) : ''
        if (!title) return { code: EC.VALIDATION_ERROR, message: 'Missing title' }
        var senderId = event && event.sender && typeof event.sender.id === 'number' ? event.sender.id : null
        if (senderId !== null) {
          var matched = null
          self._tabViews.forEach(function (view, tabId) {
            if (matched || !view.webContents) return
            if (typeof view.webContents.isDestroyed === 'function' && view.webContents.isDestroyed()) return
            if (typeof view.webContents.id === 'number' && view.webContents.id === senderId) matched = tabId
          })
          if (matched && self._tabStates.has(matched)) {
            var state = self._tabStates.get(matched)
            if (state.title !== title) {
              state.title = title
              self._broadcast('tab-title-updated', { tabId: matched, title: title })
            }
            return { code: 0, data: { matched: true } }
          }
          // 归属失败必须可观测：静默成功会让链路断裂零信号（QM-6 评审 MAJOR）
          log.warn('WebviewManager', 'report-tab-title: no tab matches senderId=' + senderId)
          return { code: 0, data: { matched: false } }
        }
        return { code: 0, data: { matched: false } }
      } catch (e) { log.warn('WebviewManager', 'ipc handler error: ' + ((e && e.message) || e)); return { code: EC.REQUEST_ERROR, message: e.message } }
    }))

    ipcMain.handle('page-manager:go-back', withSenderCheck(function (_, tabId) {
      try {
        self.goBack(tabId)
        return { code: 0 }
      } catch (e) { log.warn('WebviewManager', 'ipc handler error: ' + ((e && e.message) || e)); return { code: EC.REQUEST_ERROR, message: e.message } }
    }))

    ipcMain.handle('page-manager:go-forward', withSenderCheck(function (_, tabId) {
      try {
        self.goForward(tabId)
        return { code: 0 }
      } catch (e) { log.warn('WebviewManager', 'ipc handler error: ' + ((e && e.message) || e)); return { code: EC.REQUEST_ERROR, message: e.message } }
    }))

    ipcMain.handle('page-manager:reload', withSenderCheck(function (_, arg) {
      if (!arg || typeof arg !== 'object') return { code: EC.VALIDATION_ERROR, message: 'Missing args' }
      try {
        self.reload(arg.tabId, arg.ignoreCache)
        return { code: 0 }
      } catch (e) { log.warn('WebviewManager', 'ipc handler error: ' + ((e && e.message) || e)); return { code: EC.REQUEST_ERROR, message: e.message } }
    }))

    ipcMain.handle('page-manager:get-all-tabs', withSenderCheck(function () {
      try {
        return { code: 0, data: self.getAllTabs() }
      } catch (e) { log.warn('WebviewManager', 'ipc handler error: ' + ((e && e.message) || e)); return { code: EC.REQUEST_ERROR, message: e.message, data: [] } }
    }))

    ipcMain.handle('page-manager:get-active-tab', withSenderCheck(function () {
      try {
        return { code: 0, data: self.getActiveTab() }
      } catch (e) { log.warn('WebviewManager', 'ipc handler error: ' + ((e && e.message) || e)); return { code: EC.REQUEST_ERROR, message: e.message, data: null } }
    }))

    ipcMain.handle('page-manager:get-home-tab', withSenderCheck(function () {
      try {
        return { code: 0, data: self.getHomeTab() }
      } catch (e) { log.warn('WebviewManager', 'ipc handler error: ' + ((e && e.message) || e)); return { code: EC.REQUEST_ERROR, message: e.message, data: null } }
    }))

    ipcMain.handle('page-manager:search-or-navigate', withSenderCheck(function (_, arg) {
      if (!arg || typeof arg !== 'object') return { code: EC.VALIDATION_ERROR, message: 'Missing args' }
      try {
        self.searchOrNavigate(arg.query, arg.tabId)
        return { code: 0 }
      } catch (e) { log.warn('WebviewManager', 'ipc handler error: ' + ((e && e.message) || e)); return { code: EC.REQUEST_ERROR, message: e.message } }
    }))

    ipcMain.handle('page-manager:subscribe-events', withSenderCheck(function (event) {
      try {
        var sender = event && event.sender
        if (!sender || typeof sender.once !== 'function' || sender.isDestroyed()) {
          return { code: EC.REQUEST_ERROR, message: '渲染进程不可用，无法订阅标签事件' }
        }
        // id 一律由服务方生成，且不采信调用方传入值：唯一性是跨实例误删的根因，
        // 让调用方自带 id 等于把这个保证重新交还给调用方。
        self._subscriberSeq += 1
        var subscriberId = 'sub-' + self._subscriberSeq + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8)
        self._subscribers.add(subscriberId)
        // 按 sender 记账并在渲染进程销毁时回收：注销已不再全清，若崩溃/被杀的实例
        // 无人回收，其 id 会永久驻留，使每次广播对同一主窗口多发一条重复 IPC。
        var owned = self._senderSubscribers.get(sender)
        if (!owned) {
          owned = new Set()
          self._senderSubscribers.set(sender, owned)
          sender.once('destroyed', function () {
            self._senderSubscribers.delete(sender)
            owned.forEach(function (id) { self._subscribers.delete(id) })
          })
        }
        owned.add(subscriberId)
        return { code: 0, data: { subscriberId: subscriberId } }
      } catch (e) { log.warn('WebviewManager', 'ipc handler error: ' + ((e && e.message) || e)); return { code: EC.REQUEST_ERROR, message: e.message } }
    }))

    ipcMain.handle('page-manager:unsubscribe-events', withSenderCheck(function (_, arg) {
      try {
        // 只按调用方自身的 id 注销。缺失 id 时不做任何删除：_subscribers 是跨
        // 渲染进程实例共享的集合，清空会让其他实例永久收不到 tab-created/tab-switched
        // （登录页照常弹出，但 TabBar 不再出现新标签）。
        var subscriberId = (arg && arg.subscriberId) || ''
        if (subscriberId) {
          self._subscribers.delete(subscriberId)
          self._senderSubscribers.forEach(function (ids) { ids.delete(subscriberId) })
        } else {
          log.warn('WebviewManager', 'unsubscribe-events 缺失 subscriberId，已忽略')
        }
        return { code: 0 }
      } catch (e) { log.warn('WebviewManager', 'ipc handler error: ' + ((e && e.message) || e)); return { code: EC.REQUEST_ERROR, message: e.message } }
    }))

    ipcMain.handle('page-manager:save-cookies', withSenderCheck(function (_, tabId) {
      try {
        self.saveCookies(tabId)
        return { code: 0 }
      } catch (e) { log.warn('WebviewManager', 'ipc handler error: ' + ((e && e.message) || e)); return { code: EC.REQUEST_ERROR, message: e.message } }
    }))

    ipcMain.handle('page-manager:save-account-tab-credentials', withSenderCheck(async function (_, tabId) {
      if (typeof tabId !== 'string' || !tabId) return { code: EC.VALIDATION_ERROR, message: '缺少 tabId' }
       try {
        const result = await self.saveAccountTabCredentials(tabId)
        if (result && result.ok) {
          const win = self.mainWindow
          if (win && !win.isDestroyed()) {
            win.webContents.send('auth:completed', { platform: result.platform, accountId: result.accountId })
          }
          return { code: 0, data: result }
        }
        return { code: EC.REQUEST_ERROR, message: result?.reason || 'save-failed', data: result }
      } catch (e) { log.warn('WebviewManager', 'ipc handler error: ' + ((e && e.message) || e)); return { code: EC.REQUEST_ERROR, message: e.message } }
    }))

    ipcMain.handle('page-manager:account-tab-save-state', withSenderCheck(function (_, tabId) {
      if (typeof tabId !== 'string' || !tabId) return { code: EC.VALIDATION_ERROR, message: '缺少 tabId' }
      try {
        return { code: 0, data: self.getAccountTabSaveState(tabId) }
      } catch (e) { log.warn('WebviewManager', 'ipc handler error: ' + ((e && e.message) || e)); return { code: EC.REQUEST_ERROR, message: e.message } }
    }))

    ipcMain.handle('page-manager:save-all-unsaved-accounts', withSenderCheck(async function () {
      try {
        const data = await self.saveAllUnsavedAccounts()
        return { code: 0, data: data }
      } catch (e) { log.warn('WebviewManager', 'ipc handler error: ' + ((e && e.message) || e)); return { code: EC.REQUEST_ERROR, message: e.message } }
    }))

    // ─── 左侧导航栏宽度同步 ──

    // ─── 壳态互斥（T0-6b）：渲染层上报壳态，主进程切换内嵌视图可见性 ───
    ipcMain.handle('page-manager:set-shell-mode', withSenderCheck(function (_, mode) {
      try {
        self.setShellMode(mode)
        return { code: 0 }
      } catch (e) { log.warn('WebviewManager', 'ipc handler error: ' + ((e && e.message) || e)); return { code: EC.REQUEST_ERROR, message: e.message } }
    }))

    // ─── 弹窗互斥（2026-09-23）：应用级浮层打开/关闭时挂起/恢复内嵌视图 ───
    ipcMain.handle('page-manager:suspend-embedded-views', withSenderCheck(function (_, owner) {
      try {
        return { code: 0, data: { suspended: self.suspendEmbeddedViewsForOverlay(owner) } }
      } catch (e) { log.warn('WebviewManager', 'ipc handler error: ' + ((e && e.message) || e)); return { code: EC.REQUEST_ERROR, message: e.message } }
    }))

    ipcMain.handle('page-manager:resume-embedded-views', withSenderCheck(function (_, owner) {
      try {
        return { code: 0, data: { resumed: self.releaseEmbeddedViewsForOverlay(owner) } }
      } catch (e) { log.warn('WebviewManager', 'ipc handler error: ' + ((e && e.message) || e)); return { code: EC.REQUEST_ERROR, message: e.message } }
    }))

    ipcMain.handle('page-manager:set-sidebar-width', withSenderCheck(function (_, width) {
      try {
        self.setSidebarWidth(width)
        return { code: 0 }
      } catch (e) { log.warn('WebviewManager', 'ipc handler error: ' + ((e && e.message) || e)); return { code: EC.REQUEST_ERROR, message: e.message } }
    }))

    // 阶段 1.2（audit-6）：渲染层常驻 chrome（运营公告横幅）的额外顶部下移。
    // WebContentsView 是原生图层、不按 CSS 定位，横幅插在 DOM 流里必须把内嵌视图一起下移，
    // 否则横幅被外部网页整块盖住（与 2026-09-23 设置弹窗被盖住同形）。
    ipcMain.handle('page-manager:set-top-inset', withSenderCheck(function (_, px) {
      try {
        self.setTopInset(px)
        return { code: 0 }
      } catch (e) { log.warn('WebviewManager', 'ipc handler error: ' + ((e && e.message) || e)); return { code: EC.REQUEST_ERROR, message: e.message } }
    }))
  }
}
