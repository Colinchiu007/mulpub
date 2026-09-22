import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { getApi } from '@/api/electron-bridge'

/**
 * 标签页 Store — 浏览器式标签管理
 *
 * 与主进程 WebviewManager 通过 IPC 通信，
 * 维护前端 reactive 状态，驱动 TabBar / NavBar 组件。
 */
export const useTabStore = defineStore('tabs', () => {
  // ── State ──
  const tabs = ref([])
  const activeTabId = ref(null)
  const navigation = ref({
    url: '',
    title: '',
    canGoBack: false,
    canGoForward: false,
    loading: false
  })

  // ── Unsubscribe handles ──
  const _unsubscribes = []
  let _tabsRefreshRequest = 0
  let _navigationRefreshRequest = 0
  let _tabUpdateVersion = 0
  const _tabLiveUpdates = new Map()

  // ── Getters ──
  const activeTab = computed(() => tabs.value.find(t => t.tabId === activeTabId.value) || null)
  const isHomeTab = computed(() => activeTab.value?.isHome === true)
  const hasTabs = computed(() => tabs.value.length > 0)
  const tabCount = computed(() => tabs.value.length)
  // 待保存（未回写凭证）的账号标签：驱动「全部保存」按钮与角标计数。
  const unsavedTabs = computed(() => tabs.value.filter(t => t.credentialSaveState === 'unsaved'))
  const unsavedCount = computed(() => unsavedTabs.value.length)

  // ── Internal: 获取 pageManager API ──
  function _api() {
    const api = getApi()?.pageManager
    if (!api) {
      console.warn('[tabStore] pageManager API not available')
      return null
    }
    return api
  }

  function _recordTabUpdate(data) {
    if (!data?.tabId) return
    const previous = _tabLiveUpdates.get(data.tabId)
    _tabLiveUpdates.set(data.tabId, {
      version: ++_tabUpdateVersion,
      title: typeof data.title === 'string' ? data.title : previous?.title,
      url: typeof data.url === 'string' ? data.url : previous?.url
    })
  }

  function _applyNewerTabUpdate(tab, requestVersion) {
    const update = _tabLiveUpdates.get(tab.tabId)
    if (!update || update.version <= requestVersion) return tab
    return {
      ...tab,
      ...(update.title !== undefined ? { title: update.title } : {}),
      ...(update.url !== undefined ? { url: update.url } : {})
    }
  }

  // ── Internal: 刷新完整 tab 列表 ──
  async function _refreshTabs(expectedActiveTabId = null) {
    const api = _api()
    if (!api) return
    const requestId = ++_tabsRefreshRequest
    const requestTabUpdateVersion = _tabUpdateVersion
    try {
      const result = await api.getAllTabs()
      if (requestId !== _tabsRefreshRequest) return
      // 确保 home tab 始终存在
      const homeExists = result.data?.some(t => t.isHome)
      if (!homeExists && result.data) {
        result.data.unshift({ tabId: 'home', url: '', title: '首页', loading: false, canGoBack: false, canGoForward: false, isActive: false, isHome: true })
      }
      if (result?.code === 0 && Array.isArray(result.data)) {
        tabs.value = result.data.map(tab => _applyNewerTabUpdate(tab, requestTabUpdateVersion))
        // 确保 activeTabId 同步
        const active = result.data.find(t => t.isActive)
        if (active && (!expectedActiveTabId || active.tabId === expectedActiveTabId)) {
          activeTabId.value = active.tabId
        }
      }
    } catch (e) {
      console.error('[tabStore] refreshTabs failed:', e)
    }
  }

  // ── Internal: 刷新导航状态 ──
  async function _refreshNavigation() {
    const api = _api()
    if (!api) return
    const requestId = ++_navigationRefreshRequest
    const requestedTabId = activeTabId.value
    const requestTabUpdateVersion = _tabUpdateVersion
    try {
      const result = await api.getActiveTab()
      if (requestId !== _navigationRefreshRequest || requestedTabId !== activeTabId.value) return
      if (result?.code === 0 && result.data && result.data.tabId === activeTabId.value) {
        const activeTabData = _applyNewerTabUpdate(result.data, requestTabUpdateVersion)
        navigation.value = {
          url: activeTabData.url || '',
          title: activeTabData.title || '',
          canGoBack: !!activeTabData.canGoBack,
          canGoForward: !!activeTabData.canGoForward,
          loading: !!activeTabData.loading
        }
        const tab = tabs.value.find(t => t.tabId === activeTabData.tabId)
        if (tab) {
          tab.title = activeTabData.title || tab.title
          tab.url = activeTabData.url || tab.url
        }
      }
    } catch (e) {
      console.error('[tabStore] refreshNavigation failed:', e)
    }
  }

  // ── Actions ──

  /**
   * 初始化：订阅主进程事件，加载初始状态
   * 应在 App.vue onMounted 中调用
   */
  async function init() {
    const api = _api()
    if (!api) return

    // 订阅事件
    _unsubscribes.push(
      api.onTabEvent('tab-created', (data) => {
        if (data?.tabId) activeTabId.value = data.tabId
        return Promise.all([_refreshTabs(data?.tabId || null), _refreshNavigation()])
      }),
      api.onTabEvent('tab-closed', (data) => {
        if (data?.tabId) _tabLiveUpdates.delete(data.tabId)
        return _refreshTabs()
      }),
      api.onTabEvent('tab-switched', (data) => {
        if (data?.tabId) activeTabId.value = data.tabId
        return Promise.all([_refreshTabs(data?.tabId || null), _refreshNavigation()])
      }),
      api.on('tab-loading', (data) => {
        if (data?.tabId === activeTabId.value) {
          navigation.value.loading = true
        }
      }),
      api.on('tab-finished-loading', (data) => {
        if (data?.tabId === activeTabId.value) {
          navigation.value.loading = false
        }
      }),
      api.on('tab-title-updated', (data) => {
        if (!data?.tabId) return
        _recordTabUpdate(data)
        const tab = tabs.value.find(t => t.tabId === data.tabId)
        if (tab && typeof data.title === 'string') {
          tab.title = data.title
        }
        if (data.tabId === activeTabId.value && typeof data.title === 'string') {
          navigation.value.title = data.title
        }
      }),
      api.onNavigationChanged((data) => {
        if (!data?.tabId) return
        _recordTabUpdate(data)
        const tab = tabs.value.find(t => t.tabId === data.tabId)
        if (tab) {
          tab.title = data.title || tab.title
          tab.url = data.url || tab.url
        }
        if (data.tabId === activeTabId.value) {
          navigation.value = {
            url: data.url || '',
            title: data.title || '',
            canGoBack: !!data.canGoBack,
            canGoForward: !!data.canGoForward,
            loading: false
          }
        }
      })
    )

    // 凭证保存态变化（自动/手动/批量保存成功后主进程广播）→ 实时熄灭对应标签角标。
    _unsubscribes.push(
      api.on('tab-credential-state-changed', (data) => {
        if (!data?.tabId) return
        const tab = tabs.value.find(t => t.tabId === data.tabId)
        if (tab) tab.credentialSaveState = data.credentialSaveState || null
      })
    )

    // 订阅主进程事件流
    await api.subscribeEvents()

    // 创建 home tab（首页标签，不创建 WebContentsView）
    const homeTab = {
      tabId: 'home',
      url: '',
      title: '首页',
      loading: false,
      canGoBack: false,
      canGoForward: false,
      isActive: true,
      isHome: true
    }
    tabs.value = [homeTab]
    activeTabId.value = 'home'
    // 加载初始状态
    await _refreshTabs()
    await _refreshNavigation()
  }

  /**
   * 销毁：取消所有订阅
   */
  async function dispose() {
    const api = _api()
    if (api) {
      for (const unsub of _unsubscribes) {
        try { unsub() } catch (_) { /* ignore */ }
      }
      _unsubscribes.length = 0
      await api.unsubscribeEvents()
    }
  }

  /**
   * 创建新标签页
   * @param {Object} opts - { url, cookies, accountId, platform }
   * @returns {string|null} tabId
   */
  async function createTab(opts = {}) {
    // Home tab 已存在，直接切换
    if (opts.isHome) {
      await switchToTab('home')
      return 'home'
    }
    const api = _api()
    if (!api) return null
    try {
      const result = await api.createNewTabPage(opts)
      if (result?.code === 0 && result.data?.tabId) {
        await _refreshTabs()
        return result.data.tabId
      }
    } catch (e) {
      console.error('[tabStore] createTab failed:', e)
    }
    return null
  }

  /**
   * 关闭标签页
   */
  async function closeTab(tabId) {
    const api = _api()
    if (!api) return
    try {
      await api.closeTab(tabId)
      await _refreshTabs()
      await _refreshNavigation()
    } catch (e) {
      console.error('[tabStore] closeTab failed:', e)
    }
  }

  /**
   * 查询账号标签凭证保存态（方案二：关闭护栏）。返回 data 或 null（无 API）。
   */
  async function getAccountTabSaveState(tabId) {
    const api = _api()
    if (!api || typeof api.getAccountTabSaveState !== 'function') return null
    try {
      const result = await api.getAccountTabSaveState(tabId)
      if (result?.code === 0 && result.data) return result.data
      return null
    } catch (e) {
      console.error('[tabStore] getAccountTabSaveState failed:', e)
      return null
    }
  }

  /**
   * 批量保存全部未保存账号标签（方案三：全部保存）。返回 data 或 null。
   */
  async function saveAllUnsavedAccounts() {
    const api = _api()
    if (!api || typeof api.saveAllUnsavedAccounts !== 'function') return null
    try {
      const result = await api.saveAllUnsavedAccounts()
      if (result?.code === 0 && result.data) {
        await _refreshTabs()
        return result.data
      }
      return null
    } catch (e) {
      console.error('[tabStore] saveAllUnsavedAccounts failed:', e)
      return null
    }
  }

  /**
   * 切换到指定标签页
   */
  async function switchToTab(tabId) {
    const api = _api()
    if (!api) return
    try {
      await api.switchToTab(tabId)
      activeTabId.value = tabId
      await _refreshNavigation()
    } catch (e) {
      console.error('[tabStore] switchToTab failed:', e)
    }
  }

  /**
   * 后退
   */
  async function goBack() {
    const api = _api()
    if (!api || !activeTabId.value) return
    try {
      await api.goBack(activeTabId.value)
    } catch (e) {
      console.error('[tabStore] goBack failed:', e)
    }
  }

  /**
   * 前进
   */
  async function goForward() {
    const api = _api()
    if (!api || !activeTabId.value) return
    try {
      await api.goForward(activeTabId.value)
    } catch (e) {
      console.error('[tabStore] goForward failed:', e)
    }
  }

  /**
   * 刷新当前标签页
   */
  async function reload(ignoreCache = false) {
    const api = _api()
    if (!api || !activeTabId.value) return
    try {
      await api.reload(activeTabId.value, ignoreCache)
    } catch (e) {
      console.error('[tabStore] reload failed:', e)
    }
  }

  /**
   * 搜索或导航到 URL
   */
  async function searchOrNavigate(query) {
    const api = _api()
    if (!api) return
    try {
      await api.searchOrNavigate(query, activeTabId.value)
    } catch (e) {
      console.error('[tabStore] searchOrNavigate failed:', e)
    }
  }

  /**
   * 导航到指定 URL
   */
  async function navigate(url) {
    const api = _api()
    if (!api || !activeTabId.value) return
    try {
      await api.navigate(activeTabId.value, url)
    } catch (e) {
      console.error('[tabStore] navigate failed:', e)
    }
  }

  return {
    // State
    tabs,
    activeTabId,
    navigation,
    // Getters
    activeTab,
    isHomeTab,
    hasTabs,
    tabCount,
    unsavedTabs,
    unsavedCount,
    // Actions
    init,
    dispose,
    createTab,
    closeTab,
    switchToTab,
    getAccountTabSaveState,
    saveAllUnsavedAccounts,
    goBack,
    goForward,
    reload,
    searchOrNavigate,
    navigate
  }
})
