/**
 * page-manager preload API
 *
 * Browser-like tab management IPC bridge.
 * Exposed via window.electronAPI.pageManager.
 */
function createPageManagerApi(ipcRenderer) {
  return {
    pageManager: {
      // ── Tab CRUD ──
      createNewTabPage: (opts) => ipcRenderer.invoke('page-manager:create-new-tab-page', opts),
      closeTab: (tabId) => ipcRenderer.invoke('page-manager:close-tab', tabId),
      switchToTab: (tabId) => ipcRenderer.invoke('page-manager:switch-tab', tabId),

      // ── Navigation ──
      navigate: (tabId, url) => ipcRenderer.invoke('page-manager:navigate', { tabId, url }),
      goBack: (tabId) => ipcRenderer.invoke('page-manager:go-back', tabId),
      goForward: (tabId) => ipcRenderer.invoke('page-manager:go-forward', tabId),
      reload: (tabId, ignoreCache) => ipcRenderer.invoke('page-manager:reload', { tabId, ignoreCache }),
      searchOrNavigate: (query, tabId) => ipcRenderer.invoke('page-manager:search-or-navigate', { query, tabId }),
      // 共享左侧边栏驱动当前聚焦的 home-shell 标签在其自身 SPA 内导航（主进程定向投递到该标签 webContents）
      navigateActiveHomeShell: (path) => ipcRenderer.invoke('page-manager:navigate-active-home-shell', { path }),

      // ── Query ──
      getAllTabs: () => ipcRenderer.invoke('page-manager:get-all-tabs'),
      getActiveTab: () => ipcRenderer.invoke('page-manager:get-active-tab'),
      getHomeTab: () => ipcRenderer.invoke('page-manager:get-home-tab'),
      saveCookies: (tabId) => ipcRenderer.invoke('page-manager:save-cookies', tabId),
      saveAccountTabCredentials: (tabId) => ipcRenderer.invoke('page-manager:save-account-tab-credentials', tabId),
      // 查询账号标签凭证保存态（方案二：关闭护栏）
      getAccountTabSaveState: (tabId) => ipcRenderer.invoke('page-manager:account-tab-save-state', tabId),
      // 批量保存全部未保存账号标签（方案三：全部保存）
      saveAllUnsavedAccounts: () => ipcRenderer.invoke('page-manager:save-all-unsaved-accounts'),

      // ── Event subscription ──
      subscribeEvents: (subscriberId) => ipcRenderer.invoke('page-manager:subscribe-events', { subscriberId }),
      unsubscribeEvents: (subscriberId) => ipcRenderer.invoke('page-manager:unsubscribe-events', { subscriberId }),

      // ── 左侧导航栏宽度同步 ──
      setSidebarWidth: (width) => ipcRenderer.invoke('page-manager:set-sidebar-width', width),
      // T0-6b 壳态互斥：渲染层上报壳态（'workbench'|'browser'），主进程切换内嵌视图可见性
      setShellMode: (mode) => ipcRenderer.invoke('page-manager:set-shell-mode', mode),
      // 弹窗互斥（2026-09-23）：应用级模态浮层打开期间挂起内嵌 WebContentsView，
      // 否则原生图层压住弹窗（设置/升级/关闭确认）。owner 标识浮层来源，ref-count 释放。
      suspendEmbeddedViews: (owner) => ipcRenderer.invoke('page-manager:suspend-embedded-views', owner),
      resumeEmbeddedViews: (owner) => ipcRenderer.invoke('page-manager:resume-embedded-views', owner),

      /**
       * 监听导航状态变化（URL/标题/前进后退状态）
       * callback 收到 { tabId, url, title, canGoBack, canGoForward }
       */
      onNavigationChanged: (cb) => {
        const h = (_, payload) => cb(payload?.data || payload)
        ipcRenderer.on('page-manager:navigation-changed', h)
        return () => ipcRenderer.removeListener('page-manager:navigation-changed', h)
      },

      /**
       * 监听单个 tab 事件（created/closed/switched）
       * callback 收到 { tabId, ... } 原始数据
       */
      onTabEvent: (event, cb) => {
        const h = (_, payload) => cb(payload?.data || payload)
        ipcRenderer.on('page-manager:' + event, h)
        return () => ipcRenderer.removeListener('page-manager:' + event, h)
      },

      // ── 通用事件监听入口 ──
      on: (channel, cb) => {
        const h = (_, payload) => cb(payload?.data || payload)
        ipcRenderer.on('page-manager:' + channel, h)
        return () => ipcRenderer.removeListener('page-manager:' + channel, h)
      },
    },
  };
}
module.exports = { createPageManagerApi };
