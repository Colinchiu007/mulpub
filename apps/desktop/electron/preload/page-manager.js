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

      // ── Query ──
      getAllTabs: () => ipcRenderer.invoke('page-manager:get-all-tabs'),
      getActiveTab: () => ipcRenderer.invoke('page-manager:get-active-tab'),
      getHomeTab: () => ipcRenderer.invoke('page-manager:get-home-tab'),
      saveCookies: (tabId) => ipcRenderer.invoke('page-manager:save-cookies', tabId),
      saveAccountTabCredentials: (tabId) => ipcRenderer.invoke('page-manager:save-account-tab-credentials', tabId),

      // ── Event subscription ──
      subscribeEvents: () => ipcRenderer.invoke('page-manager:subscribe-events'),
      unsubscribeEvents: () => ipcRenderer.invoke('page-manager:unsubscribe-events'),

      // ── 左侧导航栏宽度同步 ──
      setSidebarWidth: (width) => ipcRenderer.invoke('page-manager:set-sidebar-width', width),

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
