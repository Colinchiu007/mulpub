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
          <!-- 导航栏（后退/前进/刷新/URL） -->
          <NavBar
            :current-url="navigation.url"
            :current-title="navigation.title"
            :can-go-back="navigation.canGoBack"
            :can-go-forward="navigation.canGoForward"
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
import { getApi } from '@/api/electron-bridge'
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
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { ElMessage } from 'element-plus'
import { useAccountActions } from '@/composables/useAccountActions'
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

function goHome() {
  const homeTab = tabStore.tabs.find(t => t.isHome)
  if (homeTab) {
    tabStore.switchToTab(homeTab.tabId)
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
.mp-workspace { min-width: 0; min-height: 0; flex: 1; overflow: auto; }
.fullscreen-main { min-height: 0; flex: 1; overflow: auto; }
</style>
