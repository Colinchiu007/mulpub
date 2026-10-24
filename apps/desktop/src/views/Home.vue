<template>
  <div class="mp-home" data-testid="mp-home">
    <!-- 欢迎区 -->
    <section class="mp-home-welcome">
      <div class="mp-home-greeting-col">
        <HomeGreeting />
        <p class="mp-home-overview" data-testid="home-overview">
          <span>{{ t('home.overview.accounts') }}</span>
          <strong class="overview-num">{{ accountCount }}</strong>
          <span class="overview-divider">·</span>
          <span>{{ t('home.overview.tasks') }}</span>
          <strong class="overview-num">{{ stats.total }}</strong>
        </p>
      </div>
      <div class="mp-home-quick-actions">
        <button class="mp-home-action-btn" data-testid="home-add-account" @click="go('/accounts')">
          <el-icon class="action-icon" :size="15"><User /></el-icon>
          <span>{{ t('home.addAccount') }}</span>
        </button>
        <button class="mp-home-action-btn" @click="go('/publish/history')">
          <el-icon class="action-icon" :size="15"><Tickets /></el-icon>
          <span>{{ t('home.publishHistory') }}</span>
        </button>
      </div>
    </section>

    <!-- 主任务卡：开始发布 -->
    <section
      class="mp-home-hero"
      data-testid="home-publish-hero"
      role="button"
      tabindex="0"
      @click="go('/publish')"
      @keydown.enter="go('/publish')"
      @keydown.space.prevent="go('/publish')"
    >
      <div class="hero-icon" aria-hidden="true">
        <el-icon :size="24"><Promotion /></el-icon>
      </div>
      <div class="hero-info">
        <h3 class="hero-title">{{ t('home.hero.title') }}</h3>
        <p class="hero-desc">{{ t('home.hero.desc') }}</p>
      </div>
    </section>

    <!-- 待办摘要（登录失效 / 失败任务；均为 0 时显示鼓励语） -->
    <p v-if="todoItems.length > 0" class="mp-home-todo" data-testid="home-todo">
      <span v-for="item in todoItems" :key="item.key" class="mp-home-todo-item" :class="`mp-home-todo-item--${item.tone}`">{{ item.label }}</span>
    </p>
    <p v-else-if="statsLoaded" class="mp-home-todo mp-home-todo--clear" data-testid="home-todo-clear">{{ t('home.todo.allClear') }}</p>

    <!-- 登录失效提醒 -->
    <LoginExpiredBanner
      :visible="showExpiredBanner"
      :expired-count="expiredAccountCount"
      :unsaved-count="tabStore.unsavedCount"
      :batch-loading="batchLogging"
      @batch-login="handleBatchLogin"
      @save-all="handleSaveAllUnsaved"
      @dismiss="showExpiredBanner = false"
    />

    <!-- 数据概览 -->
    <section class="mp-home-stats" data-testid="mp-home-stats">
      <div class="mp-home-stat-card">
        <div class="stat-number">{{ stats.total }}</div>
        <div class="stat-label">{{ t('home.statTotal') }}</div>
      </div>
      <div class="mp-home-stat-card mp-home-stat-card--success">
        <div class="stat-number">{{ stats.success }}</div>
        <div class="stat-label">{{ t('home.statSuccess') }}</div>
      </div>
      <div class="mp-home-stat-card mp-home-stat-card--danger">
        <div class="stat-number">{{ stats.failed }}</div>
        <div class="stat-label">{{ t('home.statFailed') }}</div>
      </div>
      <div class="mp-home-stat-card mp-home-stat-card--info">
        <div class="stat-number">{{ accountCount }}</div>
        <div class="stat-label">{{ t('home.boundAccounts') }}</div>
      </div>
    </section>

    <!-- 全 0 引导：立即新建发布 -->
    <EmptyState
      v-if="statsLoaded && isAllZero"
      class="mp-home-zero-cta"
      data-testid="home-zero-cta"
      :title="t('home.empty.title')"
      :description="t('home.empty.desc')"
      :action-text="t('home.empty.action')"
      @action="go('/publish')"
    >
      <template #icon>
        <el-icon class="mp-home-empty-glyph" :size="34"><Promotion /></el-icon>
      </template>
    </EmptyState>

    <!-- 快捷入口 -->
    <section class="mp-home-shortcuts" data-testid="mp-home-shortcuts">
      <h3 class="mp-home-section-title">{{ t('home.shortcuts') }}</h3>
      <div class="mp-home-shortcut-grid">
        <div class="mp-home-shortcut" role="button" tabindex="0" @click="go('/publish')" @keydown.enter.prevent="go('/publish')" @keydown.space.prevent="go('/publish')">
          <el-icon class="shortcut-icon" :size="22"><Promotion /></el-icon>
          <span class="shortcut-label">{{ t('home.quickPublish') }}</span>
        </div>
        <div class="mp-home-shortcut" role="button" tabindex="0" @click="go('/accounts')" @keydown.enter.prevent="go('/accounts')" @keydown.space.prevent="go('/accounts')">
          <el-icon class="shortcut-icon" :size="22"><Lock /></el-icon>
          <span class="shortcut-label">{{ t('home.accountManage') }}</span>
        </div>
        <div class="mp-home-shortcut" role="button" tabindex="0" @click="go('/publish/history')" @keydown.enter.prevent="go('/publish/history')" @keydown.space.prevent="go('/publish/history')">
          <el-icon class="shortcut-icon" :size="22"><DataAnalysis /></el-icon>
          <span class="shortcut-label">{{ t('home.publishHistory') }}</span>
        </div>
        <div class="mp-home-shortcut" role="button" tabindex="0" @click="go('/dashboard')" @keydown.enter.prevent="go('/dashboard')" @keydown.space.prevent="go('/dashboard')">
          <el-icon class="shortcut-icon" :size="22"><TrendCharts /></el-icon>
          <span class="shortcut-label">{{ t('home.dashboard') }}</span>
        </div>
        <div class="mp-home-shortcut" role="button" tabindex="0" @click="go('/collection')" @keydown.enter.prevent="go('/collection')" @keydown.space.prevent="go('/collection')">
          <el-icon class="shortcut-icon" :size="22"><Collection /></el-icon>
          <span class="shortcut-label">{{ t('home.collection') }}</span>
        </div>
        <div class="mp-home-shortcut" role="button" tabindex="0" @click="go('/comments')" @keydown.enter.prevent="go('/comments')" @keydown.space.prevent="go('/comments')">
          <el-icon class="shortcut-icon" :size="22"><ChatDotRound /></el-icon>
          <span class="shortcut-label">{{ t('home.comments') }}</span>
        </div>
      </div>
    </section>

    <!-- 支持平台 -->
    <section class="mp-home-platforms" data-testid="mp-home-platforms">
      <h3 class="mp-home-section-title">{{ t('home.supportedPlatforms') }}</h3>
      <div class="mp-home-platform-list">
        <span v-for="p in platforms" :key="p.id" class="mp-home-platform-tag">
          <img v-if="p.iconUrl" :src="p.iconUrl" class="home-platform-icon" :alt="p.label" width="18" height="18">
          <span v-else class="home-platform-glyph" aria-hidden="true">{{ p.label.slice(0, 1) }}</span> {{ p.label }}
        </span>
      </div>
    </section>

    <!-- 近期动态：全 0 引导态由上方 home-zero-cta 承担，此处隐藏避免双空态双按钮 -->
    <section v-if="!(statsLoaded && isAllZero)" class="mp-home-recent" data-testid="mp-home-recent">
      <div class="mp-home-recent-head">
        <h3 class="mp-home-section-title">{{ t('home.recentActivity') }}</h3>
        <button
          v-if="recentItems.length > 0"
          type="button"
          class="mp-home-recent-viewall"
          data-testid="home-recent-viewall"
          @click="go('/publish/history')"
        >{{ t('home.viewAllHistory') }}</button>
      </div>
      <EmptyState
        v-if="recentItems.length === 0"
        class="mp-home-recent-empty"
        compact
        :title="t('home.emptyRecent')"
        :action-text="t('home.empty.action')"
        @action="go('/publish')"
      >
        <template #icon>
          <el-icon class="mp-home-empty-glyph" :size="22"><Clock /></el-icon>
        </template>
      </EmptyState>
      <div v-else class="mp-home-recent-list">
        <div v-for="item in recentItems" :key="item.id" class="mp-home-recent-item">
          <div class="recent-item-info">
            <span class="recent-item-title">{{ item.title || t('home.untitled') }}</span>
            <span class="recent-item-platform">{{ getPlatformLabel(item.platform) }}</span>
          </div>
          <div class="recent-item-status" :class="`status-${item.status || 'unknown'}`">
            {{ statusLabel(item.status) }}
          </div>
          <span class="recent-item-time">{{ formatTime(item.created_at || item.createdAt || item.timestamp) }}</span>
        </div>
      </div>
    </section>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { getApi } from '@/api/electron-bridge'
import { accountBatchOpenLogin } from '@/api/publisher'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { ChatDotRound, Clock, Collection, DataAnalysis, Lock, Promotion, Tickets, TrendCharts, User } from '@element-plus/icons-vue'
import { usePlatformStore } from '@/stores/platforms'
import { useAccountStore } from '@/stores/accounts'
import { useTabStore } from '@/stores/tab'
import LoginExpiredBanner from '@/components/LoginExpiredBanner.vue'
import HomeGreeting from '@/components/HomeGreeting.vue'
import EmptyState from '@/components/EmptyState.vue'
import { getPlatformIconUrl } from '@/composables/usePlatformIconUrl'
import { useExpiredAccountsBanner } from '@/composables/useExpiredAccountsBanner'
import { useNotify } from '@/composables/useNotify'
import { formatDateTime } from '@/utils/datetime'
import { reportError } from '../utils/report-error'

const router = useRouter()
const { t } = useI18n()
const platformStore = usePlatformStore()
const accountStore = useAccountStore()
const tabStore = useTabStore()
const { notifySuccess, notifyError, notifyWarning } = useNotify()

const stats = ref({ total: 0, success: 0, failed: 0, daily: [] })
// 绑定账号数与账号页同源（accountStore → accounts:list → AccountManager 凭证体系）。
// SQLite accounts 表只镜像 OAuth 账号（双库分裂），读它会导致首页计数与账号页不一致。
const accountCount = computed(() => accountStore.accounts.length)
const recentItems = ref([])
const statsLoaded = ref(false)
// 懒触发的失效账号校验定时器句柄：卸载时清掉，避免离开首页后仍在跑
// （用户已看不到横幅，跑了也白跑，还白占主进程的批量检测槽位）。
let expiredBannerTimer = null

/** 待办摘要：只展示有真实数据的项，全 0 显示鼓励语（PRD §5.2，禁止假数据） */
const todoItems = computed(() => {
  const items = []
  if (expiredAccountCount.value > 0) {
    items.push({ key: 'expired', tone: 'warn', label: t('home.todo.expired', { count: expiredAccountCount.value }) })
  }
  if (stats.value.failed > 0) {
    items.push({ key: 'failed', tone: 'danger', label: t('home.todo.failed', { count: stats.value.failed }) })
  }
  return items
})

const isAllZero = computed(() => stats.value.total === 0 && accountCount.value === 0)

const {
  expiredAccounts, expiredAccountCount, showExpiredBanner,
  refresh: refreshExpiredAccounts, subscribeAutoRefresh, dispose: disposeExpiredBanner,
} = useExpiredAccountsBanner(accountStore)

const platforms = computed(() => {
  if (platformStore.platforms.length > 0) {
    return platformStore.platforms.map(p => ({
      id: p.id,
      label: p.label,
      icon: platformStore.getIcon(p.id) || '',
      iconUrl: getPlatformIconUrl(p.id) || '',
    }))
  }
  return [
    'wechat_mp', 'zhihu', 'weibo', 'douyin', 'xiaohongshu', 'tencent_video',
    'kuaishou', 'toutiao', 'bilibili', 'youtube', 'tiktok',
  ].map(id => ({
    id,
    icon: '',
    iconUrl: getPlatformIconUrl(id),
    label: fallbackPlatformLabel(id),
  }))
})

function getPlatformLabel(id) {
  return platformStore.getLabel(id) || fallbackPlatformLabel(id)
}

function fallbackPlatformLabel(id) {
  const key = 'home.platforms.' + id
  const label = t(key)
  return label === key ? id : label
}

function statusLabel(status) {
  const map = { success: 'success', failed: 'failed', pending: 'pending', publishing: 'publishing', error: 'error' }
  return t('home.status.' + (map[status] || 'unknown'))
}

const formatTime = (value) => formatDateTime(value, { style: 'numeric-short' })

function go(path) {
  router.push(path)
}

const batchLogging = ref(false)

async function handleBatchLogin() {
  if (batchLogging.value) return
  const expiredAccountIds = expiredAccounts.value.map(account => account.id)
  if (expiredAccountIds.length === 0) {
    notifyWarning('home.loginExpiredBanner.batchLoginNoAccounts', { message: t('home.loginExpiredBanner.batchLoginNoAccounts') })
    return
  }
  batchLogging.value = true
  try {
    const result = await accountBatchOpenLogin(expiredAccountIds)
    if (!result || result.code !== 0) {
      const detail = result?.message || t('home.loginExpiredBanner.batchLoginUnknownError')
      notifyError('home.loginExpiredBanner.batchLoginFailed', { message: t('home.loginExpiredBanner.batchLoginFailed', { message: detail }) })
      return
    }
    const items = Array.isArray(result.data?.items) ? result.data.items : []
    if (items.length === 0) {
      notifyWarning('home.loginExpiredBanner.batchLoginNoLoginUrl', { message: t('home.loginExpiredBanner.batchLoginNoLoginUrl') })
      return
    }
    let opened = 0
    let failed = 0
    for (const item of items) {
      if (!item?.loginUrl) { failed += 1; continue }
      const tabId = await tabStore.createTab({
        url: item.loginUrl,
        platform: item.platform,
        accountId: item.accountId,
        // 批量登录目标全是失效账号：必须以干净会话打开登录页。
        // 若恢复旧身份 Cookie，微信等平台会在二维码环节静默拒绝（getqrcode 200 空体）。
        cleanSession: true,
        title: t('home.loginExpiredBanner.loginTabTitle', { platform: platformStore.getLabel(item.platform) || item.platform }),
      })
      if (tabId) {
        opened += 1
        await tabStore.switchToTab(tabId)
      } else {
        failed += 1
      }
    }
    if (opened > 0) {
      notifySuccess('home.loginExpiredBanner.batchLoginSuccess', { message: t('home.loginExpiredBanner.batchLoginSuccess', { count: opened }) })
    }
    if (failed > 0) {
      notifyWarning('home.loginExpiredBanner.batchLoginPartial', { message: t('home.loginExpiredBanner.batchLoginPartial', { count: failed }) })
    }
  } catch (e) {
    reportError('Batch login failed', e)
    notifyError('home.loginExpiredBanner.batchLoginFailed', { message: t('home.loginExpiredBanner.batchLoginFailed', { message: e?.message || t('home.loginExpiredBanner.batchLoginUnknownError') }) })
  } finally {
    batchLogging.value = false
  }
}

async function handleSaveAllUnsaved() {
  try {
    const result = await tabStore.saveAllUnsavedAccounts()
    if (!result) {
      notifyError('home.loginExpiredBanner.saveAllFailed', { message: t('home.loginExpiredBanner.saveAllFailed') })
      return
    }
    if (result.saved > 0 && result.failed.length === 0) {
      notifySuccess('home.loginExpiredBanner.saveAllSuccess', { message: t('home.loginExpiredBanner.saveAllSuccess', { count: result.saved }) })
    } else if (result.saved > 0 && result.failed.length > 0) {
      notifySuccess('home.loginExpiredBanner.saveAllSuccess', { message: t('home.loginExpiredBanner.saveAllSuccess', { count: result.saved }) })
      notifyWarning('home.loginExpiredBanner.saveAllPartial', { message: t('home.loginExpiredBanner.saveAllPartial', { count: result.failed.length }) })
    } else if (result.attempted === 0) {
      notifyWarning('home.loginExpiredBanner.saveAllNone', { message: t('home.loginExpiredBanner.saveAllNone') })
    } else {
      notifyWarning('home.loginExpiredBanner.saveAllPartial', { message: t('home.loginExpiredBanner.saveAllPartial', { count: result.failed.length }) })
    }
  } catch (e) {
    reportError('Save all unsaved failed', e)
    notifyError('home.loginExpiredBanner.saveAllFailed', { message: t('home.loginExpiredBanner.saveAllFailed') })
  }
}

/**
 * 首屏数据装配（2026-10-15 fix-newtab-home-slow）
 *
 * 修复前是**串行** await 链：
 *   platformStore.load() → accountStore.ensureLoaded() → refreshExpiredAccounts()
 *   → dashboardStats() → historyList()
 * 其中 refreshExpiredAccounts() 内部还要 accountStore.load() +
 * accountBatchCheckLogin()，后者逐账号跑 checkLoginStatus（HTTP 请求，单账号
 * 最坏 60s 硬超时）。整条链的最坏耗时 = 各项之和，直接表现为「+」新标签点下去
 * 3-4 秒才看到主页。
 *
 * 修复后按「用户何时真正需要它」分三档：
 *   ① 首帧必需：统计数字 + 近期动态（组件已渲染，只差数据）→ **并行**发起；
 *   ② 账号数（overview 那一个数字）→ 并入并行批，不再单独 await；
 *   ③ 失效账号横幅 → **完全不阻塞首屏**，等首帧稳定后再跑（懒触发）。
 *     它是「有问题才出现」的提示，本就不该让所有用户为它付出等待。
 *
 * 容错口径：每个数据源独立 try/catch，任一失败只让对应区块停在默认值，
 * 不互相拖累、不整页报错（首屏永远可见）。
 */
onMounted(() => {
  subscribeAutoRefresh()

  const api = getApi()

  // ── ①+② 并行批：统计 / 近期动态 / 账号数 ──
  // 无 electronAPI（纯浏览器调试/测试环境）时保持 statsLoaded=false 的原语义：
  // 「没拿到数据」不等于「确认是 0」，此时不进入全 0 引导态，继续显示近期动态空态。
  const loadStats = async () => {
    if (!api || typeof api.dashboardStats !== 'function') return
    try {
      const res = await api.dashboardStats()
      if (res && res.code === 0 && res.data) {
        stats.value = { total: res.data.total || 0, success: res.data.success || 0, failed: res.data.failed || 0, daily: Array.isArray(res.data.daily) ? res.data.daily : [] }
      }
    } catch (e) {
      reportError('home dashboard stats failed', e)
    } finally {
      statsLoaded.value = true
    }
  }

  const loadRecent = async () => {
    if (!api || typeof api.historyList !== 'function') return
    try {
      const res = await api.historyList({ limit: 5, offset: 0 })
      // history:list 合同为 { total, records }（与 Dashboard/Calendar 口径一致）；
      // 旧判定 Array.isArray(res.data) 恒为 false，导致近期动态永远为空。
      if (res && res.code === 0 && Array.isArray(res.data && res.data.records)) {
        recentItems.value = res.data.records.slice(0, 5)
      }
    } catch (e) {
      reportError('home recent activity failed', e)
    }
  }

  const loadAccounts = async () => {
    try {
      await accountStore.ensureLoaded()
    } catch (e) {
      // 账号取数失败不影响统计/动态：accountCount 停在 0，
      // 由账号页自己负责错误呈现（store 内已有 error/errorCode 状态）。
      reportError('home account count failed', e)
    }
  }

  const loadPlatforms = async () => {
    try {
      await platformStore.load()
    } catch (e) {
      // 平台元数据取数失败时 Home.vue 的 platforms computed 有硬编码回退清单
      // （见上面 platforms 定义），界面不会空。
      reportError('home platform metadata failed', e)
    }
  }

  // Promise.allSettled：单个 reject 不会让其他项被跳过，也不会漏出 unhandled rejection。
  void Promise.allSettled([loadStats(), loadRecent(), loadAccounts(), loadPlatforms()])

  // ── ③ 懒触发：失效账号校验（慢，且只在真有失效账号时才有可见产出）──
  // 用 setTimeout(0) 把它推到首帧之后：Vue 已完成首次渲染、浏览器已把
  // 静态区块画出来，此时再发起逐账号登录态校验，用户感知不到阻塞。
  // 若用户立刻离开首页，onUnmounted 会清掉这个定时器（见下面 disposeExpiredBanner 旁）。
  expiredBannerTimer = setTimeout(() => {
    expiredBannerTimer = null
    void refreshExpiredAccounts().catch((e) => reportError('home expired accounts refresh failed', e))
  }, 0)
})

onUnmounted(() => {
  if (expiredBannerTimer) { clearTimeout(expiredBannerTimer); expiredBannerTimer = null }
  disposeExpiredBanner()
})
</script>

<style scoped>
@import '../features/home/home-page.css';
</style>
