<template>
  <div class="app-root">
    <OfflineIndicator />

    <template v-if="isFullScreenRoute">
      <main class="fullscreen-main" data-testid="fullscreen-view">
        <router-view />
      </main>
    </template>

    <!-- 内嵌主页壳态（PRD-TAB-INDEPENDENT-HOME F1）：+ 新标签中的独立 SPA 实例
         运行于 WebContentsView（仅覆盖内容矩形），外层窗口的 TabBar/NavBar/Sidebar
         已在其视野之外——本实例若再渲染一份会造成双份 chrome 视觉错乱，故只渲染
         模块导航 + 工作区内容。 -->
    <template v-else-if="isHomeShell">
      <div class="mp-home-shell-root" data-testid="mp-home-shell">
        <MpModuleNav />
        <main class="mp-workspace cohere-main" data-testid="mp-workspace">
          <RouteLoadError v-if="routeLoadError" v-bind="routeLoadError" @retry="retryRouteLoad" @refresh="refreshRouteLoad" />
          <router-view />
        </main>
      </div>
    </template>

    <template v-else>
      <div class="mp-shell" data-testid="mp-shell">
        <MpSidebar @open-settings="showSettingsDialog = true" />
        <div class="mp-shell-main">
          <!-- 浏览器式标签栏 -->
          <TabBar
            @switch-tab="onSwitchTab"
            @close-tab="onCloseTab"
            @create-tab="onCreateTab"
          />
          <!-- 导航栏（后退/前进/URL）。
               壳态收敛 6a 修订（2026-09-23）：首页虚拟标签不再用空白占位行，
               改为渲染 NavBar 的「只读态」——地址栏置灰禁用、刷新按钮隐藏，
               前进/后退经 vue-router SPA 历史（useSpaNavHistory）仍有效，🏠 回首页。
               与浏览器标签视觉一致，消除「首页无、新标签有」的割裂；
               NavBar 高度 40px 不变，主进程 WebContentsView TOP=76px 契约保持。
               浏览器/登录标签（含「保存账号」入口）渲染完整可用 NavBar。 -->
          <NavBar
            :current-url="navigation.url"
            :current-title="navigation.title"
            :can-go-back="navCanGoBack"
            :can-go-forward="navCanGoForward"
            :is-home="isHomeTab"
            :loading="navigation.loading"
            :is-login-tab="isLoginTab"
            :account-unsaved="activeTabUnsaved"
            :saving="savingAccount"
            @go-back="onGoBack"
            @go-forward="onGoForward"
            @reload="tabStore.reload()"
            @go-home="goHome"
            @navigate="onNavigate"
            @save-account="onSaveAccount"
          />
          <!-- 模块导航（仅首页标签显示） -->
          <MpModuleNav v-if="isHomeTab" />
          <!-- 主内容区 -->
          <main class="mp-workspace cohere-main" data-testid="mp-workspace">
            <RouteLoadError v-if="routeLoadError" v-bind="routeLoadError" @retry="retryRouteLoad" @refresh="refreshRouteLoad" />
            <router-view v-if="!isLoginTab" />
          </main>
        </div>
      </div>
      <BackToTop />
    </template>

    <UpdateNotification />
    <SettingsDialog :visible="showSettingsDialog" @close="closeSettingsDialog" />
    <PipelineBackgroundToast />
  </div>
</template>

<script setup>
import { getApi, invokePageManager } from '@/api/electron-bridge'
import MpModuleNav from '@/layouts/MpModuleNav.vue'
import MpSidebar from '@/layouts/MpSidebar.vue'
import TabBar from '@/components/TabBar.vue'
import NavBar from '@/components/NavBar.vue'
import OfflineIndicator from '@/components/OfflineIndicator.vue'
import UpdateNotification from '@/components/UpdateNotification.vue'
import SettingsDialog from '@/components/SettingsDialog.vue'
import BackToTop from '@/components/BackToTop.vue'
import PipelineBackgroundToast from '@/components/PipelineBackgroundToast.vue'
import RouteLoadError from '@/components/RouteLoadError.vue'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useAccountActions } from '@/composables/useAccountActions'
import { useSpaNavHistory } from '@/composables/useSpaNavHistory'
import { formatUserError } from '@/utils/user-facing-error'
import { useRoute, useRouter } from 'vue-router'
import { clearRouteLoadError, routeLoadError } from '@/router'
import { useLicenseStore } from '@/stores/license'
import { useIdentityStore } from '@/stores/identity'
import { useTabStore } from '@/stores/tab'
import { notifySettingsDialogClosed } from '@/stores/settings-dialog'
import { isHomeShellSearch } from '@/utils/home-shell'
import { storeToRefs } from 'pinia'

const router = useRouter()
const route = useRoute()
const licenseStore = useLicenseStore()
const identityStore = useIdentityStore()
const tabStore = useTabStore()
const { navigation, isHomeTab: isHomeTabFromStore, activeTabId } = storeToRefs(tabStore)
// 内嵌主页壳态（+ 新标签中的独立 SPA 实例）：URL search 含 mp-home-shell=1。
// 该实例本身就是 WebContentsView（浏览器标签），不是主窗口的 home 虚拟标签，
// 因此按 home 壳渲染（隐藏 NavBar、显示模块导航），但不参与主窗口标签系统（见 S4）。
const isHomeShell = isHomeShellSearch(typeof window !== 'undefined' ? window.location.search : '')
const isHomeTab = computed(() => isHomeShell || isHomeTabFromStore.value)
const accountActions = useAccountActions()
const { t } = useI18n()

// ── 登录标签（参考产品式全屏登录视图）──
// 「保存账号」按钮显示条件：认证登录标签（isLogin）或账号浏览器标签（accountId，
// 首页批量登录打开的普通标签，同样需要手动保存凭证入口）
const isLoginTab = computed(() => {
  const tab = tabStore.activeTab
  return tab?.isLogin === true || (tab?.accountId != null && !tab.isHome)
})
const savingAccount = ref(false)
// 活动标签是否为「未保存」账号标签：驱动 NavBar 保存按钮脉冲动画（方案三）。
const activeTabUnsaved = computed(() => tabStore.activeTab?.credentialSaveState === 'unsaved')

// ── 壳态互斥上报（T0-6b，A1 决策）──
// 工作台壳态（首页虚拟标签，SPA 渲染）下浏览器壳与工作台不同时展示：
// 上报主进程隐藏全部内嵌 WebContentsView；切回浏览器壳时恢复。
// 上报失败静默（非 Electron 环境/主进程未就绪时不影响渲染层）。
watch(isHomeTab, (home) => {
  // 内嵌主页实例是浏览器标签（WebContentsView），上报 workbench 壳态会让主进程
  // 隐藏包括它自己在内的全部视图；壳态互斥仅由主窗口的 home 虚拟标签驱动。
  if (isHomeShell) return
  invokePageManager('setShellMode', home ? 'workbench' : 'browser')
}, { immediate: true })

// ── NavBar 左右箭头可用性（2026-09-15 修复）──
// home 标签是虚拟标签（无 WebContentsView），主进程对其 canGoBack/canGoForward
// 恒为 false，导致 NavBar 左右箭头在所有 SPA 页面（均运行于 home 标签）永久禁用。
// 修复：home 标签下以 vue-router 历史栈（useSpaNavHistory）为准；
// 浏览器标签下仍用主进程上报的 WebContentsView 历史状态。
const spaNav = useSpaNavHistory(router)
const navCanGoBack = computed(() =>
  isHomeTab.value ? spaNav.canGoBack.value : navigation.value.canGoBack
)
const navCanGoForward = computed(() =>
  isHomeTab.value ? spaNav.canGoForward.value : navigation.value.canGoForward
)

async function onSaveAccount () {
  if (savingAccount.value) return
  savingAccount.value = true
  try {
    const tab = tabStore.activeTab
    let result
    if (tab?.isLogin === true) {
      // 认证登录标签：走 auth-view-manager completeLogin（提取隔离视图凭证）
      result = await accountActions.completeLogin('browser')
    } else if (tab?.accountId != null) {
      // 账号浏览器标签：提取该标签 session 分区凭证并回写加密凭证库
      const api = (await import('@/api/electron-bridge')).getApi()
      const saveResult = api?.pageManager?.saveAccountTabCredentials
        ? await api.pageManager.saveAccountTabCredentials(tab.tabId)
        : null
      if (saveResult?.code === 0) {
        result = { code: 0 }
      } else {
        const reason = saveResult?.message || saveResult?.data?.reason || ''
        result = {
          code: saveResult?.code ?? -1,
          message: reason.includes('未检测到') || reason.includes('No login credentials')
            ? t('accountsPage.saveAccountTabNoCredential')
            : t('accountsPage.saveAccountTabFailed')
        }
      }
    } else {
      return
    }
    if (result?.code !== 0) {
      ElMessage.error(formatUserError(result, { fallback: t('accounts.saveFailed') }).message)
    } else {
      ElMessage.success(t('accounts.saved'))
    }
  } catch (error) {
    ElMessage.error(formatUserError(error, { fallback: t('accounts.saveFailed') }).message)
  } finally {
    savingAccount.value = false
  }
}

const showSettingsDialog = ref(false)
let unsubscribeNavigate = null

// 关闭「设置」弹窗并通知依赖模型配置的视图刷新（如图片轮播的服务商/音色能力下拉），
// 避免“新增模型后关闭弹窗仍看不到新模型”的陈旧状态（2026-08-12 Bug 修复）。
function closeSettingsDialog () {
  showSettingsDialog.value = false
  notifySettingsDialogClosed()
}

// 全屏路由（脱离任何导航壳，独立整屏渲染）：首跑引导
const isFullScreenRoute = computed(() => route.path === '/first-run')

// ── 标签页操作 ──

function onSwitchTab(tabId) {
  tabStore.switchToTab(tabId)
}

async function onCloseTab(tabId) {
  // 方案二（护栏）：关闭尚未保存凭证的账号标签前弹三选一确认，杜绝静默丢失登录态。
  const state = await tabStore.getAccountTabSaveState(tabId)
  if (state && state.isAccountTab && state.credentialSaveState === 'unsaved') {
    let action
    try {
      await ElMessageBox.confirm(
        t('tabBar.closeUnsavedMessage'),
        t('tabBar.closeUnsavedTitle'),
        {
          type: 'warning',
          confirmButtonText: t('tabBar.closeUnsavedSaveAndClose'),
          cancelButtonText: t('tabBar.closeUnsavedDiscard'),
          closeButtonText: t('tabBar.closeUnsavedCancel'),
          showClose: true,
          distinguishCancelAndClose: true,
        }
      )
      action = 'save'
    } catch (err) {
      // cancel → 直接关闭（cancelButtonText）；close/× → 取消，留在页面
      if (err === 'cancel') action = 'discard'
      else return
    }
    if (action === 'save') {
      try {
        const api = getApi()
        const res = api?.pageManager?.saveAccountTabCredentials ? await api.pageManager.saveAccountTabCredentials(tabId) : null
        if (!res || res.code !== 0) ElMessage.warning(t('tabBar.closeUnsavedDiscardedWarn'))
      } catch (e) {
        ElMessage.warning(t('tabBar.closeUnsavedDiscardedWarn'))
      }
      await tabStore.closeTab(tabId)
    } else if (action === 'discard') {
      await tabStore.closeTab(tabId)
    }
    return
  }
  tabStore.closeTab(tabId)
}

  async function onCreateTab() {
    // 「+」新标签：内容为应用主页的独立 SPA 实例，与首页固化标签完全解耦（F1/F2）。
    await tabStore.createTab({ homeShell: true, title: t('tabs.newTabTitle') })
  }

  function onGoBack() {
    if (isHomeTab.value) {
      try { router.back() } catch (error) { console.warn('[tab] goBack failed', error) }
      return
    }
    tabStore.goBack()
  }

  function onGoForward() {
    if (isHomeTab.value) {
      try { router.forward() } catch (error) { console.warn('[tab] goForward failed', error) }
      return
    }
    tabStore.goForward()
  }

// 返回主页：切回首页标签 + 确保 SPA 路由回到首页。
// 原实现仅 switchToTab('home')：当用户已在首页标签时为 no-op（点击无效）；
// 且从浏览器标签返回时未恢复首页路由。现统一「切标签 + 路由归位」两步。
async function goHome () {
  const homeTab = tabStore.tabs.find(t => t.isHome)
  if (homeTab && activeTabId.value !== homeTab.tabId) {
    try { await tabStore.switchToTab(homeTab.tabId) } catch (error) { console.warn('[tab] switch home failed', error) }
  }
  if (route.path !== '/') {
    try { router.push('/') } catch (error) { console.warn('[tab] goHome push failed', error) }
  }
}

function onNavigate(query) {
  tabStore.searchOrNavigate(query)
}

// ── 路由错误恢复 ──

async function retryRouteLoad() {
  const failedPath = routeLoadError.value?.path || router.currentRoute.value.fullPath
  clearRouteLoadError()
  try {
    await router.replace(failedPath)
  } catch (error) {
    routeLoadError.value = {
      title: t('common.pageLoadFailed'),
      message: t('common.pageLoadFailedMessage'),
      details: error?.stack || error?.message || '',
      path: failedPath,
    }
  }
}

function refreshRouteLoad() {
  window.location.reload()
}

// ── 生命周期 ──

onMounted(() => {
  licenseStore.load()
  identityStore.load()
  // 内嵌主页实例跳过标签系统初始化与订阅（S4 广播风暴防护）：
  // 它是被标签系统管理的对象，而非管理者，不订阅 tab 事件、不驱动壳态互斥。
  if (!isHomeShell) {
    tabStore.init()
  }
  spaNav.attach()

  const api = getApi()
  if (api && api.onNavigate && !isHomeShell) {
    unsubscribeNavigate = api.onNavigate((route) => {
      router.push(route)
    })
  }
})

onBeforeUnmount(() => {
  spaNav.dispose()
  if (typeof unsubscribeNavigate === 'function') unsubscribeNavigate()
  unsubscribeNavigate = null
  if (!isHomeShell) tabStore.dispose()
  identityStore.dispose()
})
</script>

<style>
body { margin: 0; padding: 0; }
html, body { height: 100%; overflow: hidden; }
#app { height: 100%; }
.app-root { height: 100%; display: flex; flex-direction: column; }
.mp-shell { min-height: 0; flex: 1; display: flex; min-width: 0; overflow: hidden; background: var(--color-bg-inset); }
.mp-shell-main { min-width: 0; flex: 1; display: flex; flex-direction: column; overflow: hidden; }
/* 壳态收敛 6a 修订：首页标签现渲染只读 NavBar（40px），不再需要空白占位行；
   TabBar(36px) + NavBar(40px) = 主进程 WebContentsView TOP=76px 契约不变。 */
/* 内嵌主页壳态根容器：无外层 chrome，模块导航 + 内容区纵向铺满 */
.mp-home-shell-root { min-height: 0; flex: 1; display: flex; flex-direction: column; overflow: hidden; background: var(--color-bg-inset); }
.mp-workspace { min-width: 0; min-height: 0; flex: 1; overflow: auto; }
.fullscreen-main { min-height: 0; flex: 1; overflow: auto; }
</style>
