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
      // 共享左侧边栏驱动当前聚焦的 home-shell 标签在其自身 SPA 内导航（主进程定向投递到该标签 webContents）；reportTabTitle：home-shell SPA 上报当前页面标题——主进程按调用方 webContents 定位标签并更新标题
      navigateActiveHomeShell: (path) => ipcRenderer.invoke('page-manager:navigate-active-home-shell', { path }),
      reportTabTitle: (title) => ipcRenderer.invoke('page-manager:report-tab-title', { title }),
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
      subscribeEvents: () => ipcRenderer.invoke('page-manager:subscribe-events'),
      unsubscribeEvents: (subscriberId) => ipcRenderer.invoke('page-manager:unsubscribe-events', { subscriberId }),

      // ── 左侧导航栏宽度 / 收起状态同步 ──
      setSidebarWidth: (width) => ipcRenderer.invoke('page-manager:set-sidebar-width', width),
      // 阶段 1.2：常驻 chrome（公告横幅）的额外顶部下移；卸载/关闭时必须回写 0
      setTopInset: (px) => ipcRenderer.invoke('page-manager:set-top-inset', px),
      // 全局折叠按钮（2026-10-18）：收起时内嵌 WebContentsView 改为 x=0 全宽。
      // 与 setSidebarWidth 分开：宽度守卫拒绝 0，收起是显式布尔状态。
      setSidebarCollapsed: (collapsed) => ipcRenderer.invoke('page-manager:set-sidebar-collapsed', collapsed),
      /**
       * 监听折叠状态广播（多窗口同步）。
       *
       * 折叠是应用级状态：主进程 WebviewManager 是唯一真源，任一窗口点击后它会把
       * 所有内嵌视图重排，并向**每个窗口**广播。本窗口若不跟上，DOM 侧栏还显示着
       * 却被原生视图盖住 ⇒ 点击错乱。
       * callback 收到布尔值（true = 已收起）。
       *
       * 载荷形状异常（既无 data.collapsed 也无顶层 collapsed）时传 null 而非 undefined：
       * 渲染层 applyRemoteCollapsed 对非布尔一律忽略，null 与 undefined 都会被挡下，
       * 但 null 在控制台/断点里可辨识为「显式的空值」，undefined 则与「忘了传参」同形，
       * 会把「主进程发了坏载荷」这个问题隐藏掉（CCG 深度审查 i3）。
       */
      onSidebarCollapsedChanged: (cb) => {
        const h = (_, payload) => {
          const raw = payload?.data?.collapsed ?? payload?.collapsed
          cb(typeof raw === 'boolean' ? raw : null)
        }
        ipcRenderer.on('page-manager:sidebar-collapsed-changed', h)
        return () => ipcRenderer.removeListener('page-manager:sidebar-collapsed-changed', h)
      },
      // T0-6b 壳态互斥：渲染层上报壳态（'workbench'|'browser'），主进程切换内嵌视图可见性
      setShellMode: (mode) => ipcRenderer.invoke('page-manager:set-shell-mode', mode),
      // 弹窗互斥（2026-09-23）：应用级模态浮层打开期间挂起内嵌 WebContentsView，
      // 否则原生图层压住弹窗（设置/升级/关闭确认）。owner 标识浮层来源，ref-count 释放。
      suspendEmbeddedViews: (owner) => ipcRenderer.invoke('page-manager:suspend-embedded-views', owner),
      resumeEmbeddedViews: (owner) => ipcRenderer.invoke('page-manager:resume-embedded-views', owner),

      /**
       * 监听导航状态变化（URL/标题/前进后退/加载态）
       * callback 收到 { tabId, url, title, canGoBack, canGoForward, loading }
       * loading 缺席时渲染层必须保持现状，不得凭猜测收口转圈。
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
