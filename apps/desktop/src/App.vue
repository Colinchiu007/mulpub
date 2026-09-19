<template>
  <div class="app-root">
    <OfflineIndicator />

    <template v-if="isFullScreenRoute">
      <main class="fullscreen-main" data-testid="fullscreen-view">
        <router-view />
      </main>
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
          <!-- 导航栏（后退/前进/刷新/URL）。
               壳态收敛 6a（T0-6a）：工作台壳态（首页虚拟标签，SPA 渲染）下 NavBar 的
               地址栏/刷新/前进后退语义失效且误导用户，整行不渲染；改为与 .nav-bar
               等高（40px）的占位行，保证主进程 WebContentsView TOP=76px 定位不变。
               浏览器/登录标签（含「保存账号」入口）仍渲染完整 NavBar。 -->
          <NavBar
            v-if="!isHomeTab"
            :current-url="navigation.url"
            :current-title="navigation.title"
            :can-go-back="navCanGoBack"
            :can-go-forward="navCanGoForward"
            :is-home="isHomeTab"
            :loading="navigation.loading"
            :is-login-tab="isLoginTab"
            :saving="savingAccount"
            @go-back="onGoBack"
            @go-forward="onGoForward"
            @reload="tabStore.reload()"
            @go-home="goHome"
            @navigate="onNavigate"
            @save-account="onSaveAccount"
          />
          <div
            v-else
            class="mp-shell-nav-placeholder"
            data-testid="mp-nav-placeholder"
            aria-hidden="true"
          ></div>
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
import { ElMessage } from 'element-plus'
import { useAccountActions } from '@/composables/useAccountActions'
import { useSpaNavHistory } from '@/composables/useSpaNavHistory'
import { formatUserError } from '@/utils/user-facing-error'
import { useRoute, useRouter } from 'vue-router'
import { clearRouteLoadError, routeLoadError } from '@/router'
import { useLicenseStore } from '@/stores/license'
import { useIdentityStore } from '@/stores/identity'
import { useTabStore } from '@/stores/tab'
import { notifySettingsDialogClosed } from '@/stores/settings-dialog'
import { storeToRefs } from 'pinia'

const router = useRouter()
const route = useRoute()
const licenseStore = useLicenseStore()
const identityStore = useIdentityStore()
const tabStore = useTabStore()
const { navigation, isHomeTab, activeTabId } = storeToRefs(tabStore)
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

// ── 壳态互斥上报（T0-6b，A1 决策）──
// 工作台壳态（首页虚拟标签，SPA 渲染）下浏览器壳与工作台不同时展示：
// 上报主进程隐藏全部内嵌 WebContentsView；切回浏览器壳时恢复。
// 上报失败静默（非 Electron 环境/主进程未就绪时不影响渲染层）。
watch(isHomeTab, (home) => {
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

function onCloseTab(tabId) {
  tabStore.closeTab(tabId)
}

  async function onCreateTab() {
    await tabStore.createTab({ url: 'about:blank', title: '首页' })
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

// ── 侧边栏/模块导航自动切换：当用户在浏览器标签点击侧边栏进入 Vue SPA 页面时，
// 自动切回首页标签以隐藏 WebContentsView，露出 router-view 渲染内容。
let _routeGuard = null
onMounted(() => {
  licenseStore.load()
  identityStore.load()
  tabStore.init()
  spaNav.attach()

  const api = getApi()
  if (api && api.onNavigate) {
    unsubscribeNavigate = api.onNavigate((route) => {
      router.push(route)
    })
  }

  // 路由守卫：SPA 内部页面导航（侧边栏/router-link）→ 自动切到首页标签
  _routeGuard = router.beforeEach((to, from) => {
    if (to && to.path && to.path !== from?.path && !isHomeTab.value) {
      const homeTab = tabStore.tabs.find(t => t.isHome)
      if (homeTab && homeTab.tabId) {
        tabStore.switchToTab(homeTab.tabId)
      }
    }
  })
})

onBeforeUnmount(() => {
  spaNav.dispose()
  if (typeof unsubscribeNavigate === 'function') unsubscribeNavigate()
  unsubscribeNavigate = null
  if (typeof _routeGuard === 'function') {
    _routeGuard()
    _routeGuard = null
  }
  tabStore.dispose()
  identityStore.dispose()
})
</script>

<style>
body { margin: 0; padding: 0; }
html, body { height: 100%; overflow: hidden; }
#app { height: 100%; }
.app-root { height: 100%; display: flex; flex-direction: column; }
.mp-shell { min-height: 0; flex: 1; display: flex; min-width: 0; overflow: hidden; background: #f7f7fb; }
.mp-shell-main { min-width: 0; flex: 1; display: flex; flex-direction: column; overflow: hidden; }
/* 壳态收敛 6a：工作台壳态下 NavBar 的等高占位行（40px 与 .nav-bar 一致），
   保持 TabBar(36px) + 占位(40px) = 76px 的主进程 WebContentsView TOP 偏移不变 */
.mp-shell-nav-placeholder {
  flex-shrink: 0;
  height: 40px;
  background: #f7f7fb;
}
.mp-workspace { min-width: 0; min-height: 0; flex: 1; overflow: auto; }
.fullscreen-main { min-height: 0; flex: 1; overflow: auto; }
</style>
