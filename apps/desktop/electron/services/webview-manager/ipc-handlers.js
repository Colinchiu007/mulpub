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

    ipcMain.handle('page-manager:subscribe-events', withSenderCheck(function (_, arg) {
      try {
        var subscriberId = (arg && arg.subscriberId) || 'default-' + Date.now()
        self._subscribers.add(subscriberId)
        return { code: 0, data: { subscriberId: subscriberId } }
      } catch (e) { log.warn('WebviewManager', 'ipc handler error: ' + ((e && e.message) || e)); return { code: EC.REQUEST_ERROR, message: e.message } }
    }))

    ipcMain.handle('page-manager:unsubscribe-events', withSenderCheck(function (_, arg) {
      try {
        var subscriberId = (arg && arg.subscriberId) || ''
        if (subscriberId) { self._subscribers.delete(subscriberId) } else { self._subscribers.clear() }
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
  }
}
