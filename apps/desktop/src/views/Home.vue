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
        <div class="mp-home-shortcut" @click="go('/publish')">
          <el-icon class="shortcut-icon" :size="22"><Promotion /></el-icon>
          <span class="shortcut-label">{{ t('home.quickPublish') }}</span>
        </div>
        <div class="mp-home-shortcut" @click="go('/accounts')">
          <el-icon class="shortcut-icon" :size="22"><Lock /></el-icon>
          <span class="shortcut-label">{{ t('home.accountManage') }}</span>
        </div>
        <div class="mp-home-shortcut" @click="go('/publish/history')">
          <el-icon class="shortcut-icon" :size="22"><DataAnalysis /></el-icon>
          <span class="shortcut-label">{{ t('home.publishHistory') }}</span>
        </div>
        <div class="mp-home-shortcut" @click="go('/dashboard')">
          <el-icon class="shortcut-icon" :size="22"><TrendCharts /></el-icon>
          <span class="shortcut-label">{{ t('home.dashboard') }}</span>
        </div>
        <div class="mp-home-shortcut" @click="go('/collection')">
          <el-icon class="shortcut-icon" :size="22"><Collection /></el-icon>
          <span class="shortcut-label">{{ t('home.collection') }}</span>
        </div>
        <div class="mp-home-shortcut" @click="go('/comments')">
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

onMounted(async () => {
  subscribeAutoRefresh()
  try {
    platformStore.load()
    await accountStore.ensureLoaded()
    await refreshExpiredAccounts()
    const api = getApi()
    if (api) {
      // 发布统计与数据看板同源：dashboard:stats（publish-history JSONL 聚合）。
      // SQLite publish_history 表已无生产写入方（store:add-publish-record 零调用），读它只会得到空值或迁移快照残留。
      if (api.dashboardStats) {
        const res = await api.dashboardStats()
        if (res && res.code === 0 && res.data) {
          stats.value = { total: res.data.total || 0, success: res.data.success || 0, failed: res.data.failed || 0, daily: Array.isArray(res.data.daily) ? res.data.daily : [] }
        }
      }
      statsLoaded.value = true
      if (api.historyList) {
        const res = await api.historyList({ limit: 5, offset: 0 })
        // history:list 合同为 { total, records }（与 Dashboard/Calendar 口径一致）；
        // 旧判定 Array.isArray(res.data) 恒为 false，导致近期动态永远为空。
        if (res && res.code === 0 && Array.isArray(res.data && res.data.records)) {
          recentItems.value = res.data.records.slice(0, 5)
        }
      }
    }
  } catch (e) {
    reportError('加载首页数据失败', e)
  }
})

onUnmounted(() => {
  disposeExpiredBanner()
})
</script>

<style scoped>
.mp-home {
  max-width: 960px;
  margin: 0 auto;
  padding: 32px 24px;
}

.mp-home-welcome {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 24px;
  margin-bottom: 20px;
}

.mp-home-greeting-col {
  min-width: 0;
}

/* 概览行：账号数 + 本月发布（tabular-nums 保证数字对齐） */
.mp-home-overview {
  display: flex;
  align-items: baseline;
  gap: 6px;
  margin: 4px 0 0;
  color: var(--color-text-secondary);
  font-size: var(--font-size-sm);
}

.overview-num {
  color: var(--color-text-primary);
  font-variant-numeric: tabular-nums;
  font-weight: 600;
}

.overview-divider {
  color: var(--color-text-muted);
}

.mp-home-quick-actions {
  display: flex;
  gap: 10px;
}

.mp-home-action-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 18px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  background: var(--color-bg-card);
  color: var(--color-text-secondary);
  font-size: var(--font-size-sm);
  cursor: pointer;
  transition: all 0.15s ease;
}

.mp-home-action-btn:hover {
  border-color: var(--color-primary);
  color: var(--color-primary);
}

.mp-home-action-btn--primary {
  border-color: var(--color-primary);
  background: var(--color-primary);
  color: var(--color-on-primary);
}

.mp-home-action-btn--primary:hover {
  background: var(--color-primary-hover);
  color: var(--color-on-primary);
}

.action-icon {
  flex: 0 0 auto;
}

/* 待办摘要（真实数据项，全 0 显示鼓励语） */
.mp-home-todo {
  display: flex;
  align-items: center;
  gap: 12px;
  margin: 0 0 24px;
  color: var(--color-text-secondary);
  font-size: var(--font-size-sm);
}

.mp-home-todo--clear {
  color: var(--color-text-muted);
}

.mp-home-todo-item {
  padding: 3px 12px;
  border-radius: var(--radius-full);
  font-size: var(--font-size-xs);
}

.mp-home-todo-item--warn {
  background: #fef3c7;
  color: #92400e;
}

.mp-home-todo-item--danger {
  background: var(--coral-soft, #fef0f0);
  color: var(--color-danger);
}

/* 主任务卡：开始发布 + 连续天数（hover 抬升 + 右上角品牌淡紫弧形渐变装饰） */
.mp-home-hero {
  position: relative;
  display: flex;
  align-items: center;
  gap: 16px;
  margin-bottom: 24px;
  padding: 22px 24px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-bg-card);
  cursor: pointer;
  overflow: hidden;
  transition: box-shadow 0.15s ease, border-color 0.15s ease;
}

.mp-home-hero::before {
  content: '';
  position: absolute;
  top: -48px;
  right: -48px;
  width: 168px;
  height: 168px;
  border-radius: 50%;
  background: radial-gradient(circle, var(--color-primary-light) 0%, transparent 72%);
  pointer-events: none;
}

.mp-home-hero:hover,
.mp-home-hero:focus-visible {
  border-color: var(--color-primary);
  box-shadow: var(--shadow-card-hover);
  outline: none;
}

.hero-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 52px;
  height: 52px;
  border-radius: var(--radius-sm);
  background: var(--color-primary-light);
  color: var(--color-primary);
  flex: 0 0 auto;
}

.hero-info {
  flex: 1;
  min-width: 0;
}

.hero-title {
  margin: 0 0 4px;
  color: var(--color-text-primary);
  font-size: var(--font-size-md);
  font-weight: 600;
}

.hero-desc {
  margin: 0;
  color: var(--color-text-secondary);
  font-size: var(--font-size-sm);
}

/* 数据概览：紧凑 KPI 条（PRD §5.1，卡片高度 ≤96px） */
.mp-home-stats {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 16px;
  margin-bottom: 24px;
}

.mp-home-stat-card {
  padding: 14px 16px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-bg-card);
  text-align: center;
}

.stat-number {
  font-size: var(--font-size-lg);
  font-weight: 600;
  line-height: 1.3;
  color: var(--color-text-primary);
}

.stat-label {
  margin-top: 2px;
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
}

.mp-home-stat-card--success .stat-number { color: var(--color-success); }
.mp-home-stat-card--danger .stat-number { color: var(--color-danger); }
.mp-home-stat-card--info .stat-number { color: var(--color-primary); }

/* 全 0 引导与近期动态空态（统一 EmptyState，图标用主题色） */
.mp-home-zero-cta {
  min-height: 180px;
  margin-bottom: 24px;
  border: 1px dashed var(--color-border);
  border-radius: var(--radius-md);
}

.mp-home-recent-empty {
  min-height: 120px;
  border: 1px dashed var(--color-border);
  border-radius: var(--radius-sm);
}

.mp-home-empty-glyph {
  color: var(--color-primary);
}

/* 快捷入口 */
.mp-home-section-title {
  margin: 0 0 16px;
  color: #25252b;
  font-size: var(--font-size-base);
  font-weight: 600;
}

/* 深色模式覆盖（P4 2026-10-08）：#25252b 硬编码深灰在暗色 #1a1a1e 底上
 * 1.14:1 不可读（实测见研究方案 §3.3/§8）。改走 token，暗色自动切换。 */
[data-theme='dark'] .mp-home-section-title {
  color: var(--color-text-primary);
}

.mp-home-shortcuts {
  margin-bottom: 32px;
}

.mp-home-shortcut-grid {
  display: grid;
  grid-template-columns: repeat(6, 1fr);
  gap: 12px;
}

.mp-home-shortcut {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 18px 12px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-bg-card);
  cursor: pointer;
  transition: all 0.15s ease;
}

.mp-home-shortcut:hover {
  border-color: var(--color-primary);
  box-shadow: 0 4px 12px rgba(80, 72, 229, 0.08);
}

.shortcut-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border-radius: var(--radius-sm);
  background: var(--color-primary-light);
  color: var(--color-primary);
}

.shortcut-label {
  color: var(--color-text-secondary);
  font-size: var(--font-size-sm);
}

/* 平台列表 */
.mp-home-platforms {
  margin-bottom: 32px;
}

.mp-home-platform-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.mp-home-platform-tag {
  padding: 6px 14px;
  border: 1px solid #e8eaf2;
  border-radius: 20px;
  background: #f9f9fc;
  color: #4d4f6f;
  font-size: var(--font-size-sm);
}

/* 近期动态 */
.mp-home-recent {
  margin-bottom: 32px;
}

.mp-home-recent-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.mp-home-recent-viewall {
  border: none;
  background: transparent;
  color: var(--color-primary);
  font-size: var(--font-size-sm);
  cursor: pointer;
}

.mp-home-recent-viewall:hover {
  text-decoration: underline;
}

.mp-home-recent-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.mp-home-recent-item {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 14px 16px;
  border: 1px solid #e8eaf2;
  border-radius: 10px;
  background: var(--color-bg-card);
}

.recent-item-info {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 8px;
}

.recent-item-title {
  overflow: hidden;
  color: #25252b;
  font-size: var(--font-size-sm);
  font-weight: 500;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.recent-item-platform {
  padding: 2px 8px;
  border-radius: 4px;
  background: #f0efff;
  color: #5048e5;
  font-size: var(--font-size-xs);
  flex: 0 0 auto;
}

.recent-item-status {
  padding: 2px 10px;
  border-radius: 12px;
  font-size: var(--font-size-xs);
  flex: 0 0 auto;
}

.status-success { background: #e8f8ef; color: #2fc27a; }
.status-failed, .status-error { background: #fef0f0; color: #f56c6c; }
.status-pending, .status-publishing { background: #f0efff; color: #5048e5; }
.status-unknown { background: #f5f5f5; color: #999; }

.recent-item-time {
  color: #8b8e9a;
  font-size: var(--font-size-xs);
  flex: 0 0 auto;
}

@media (max-width: 768px) {
  .mp-home-stats { grid-template-columns: repeat(2, 1fr); }
  .mp-home-shortcut-grid { grid-template-columns: repeat(3, 1fr); }
  .mp-home-welcome { flex-direction: column; align-items: flex-start; }
}

@media (max-width: 480px) {
  .mp-home { padding: 16px 12px; }
  .mp-home-shortcut-grid { grid-template-columns: repeat(2, 1fr); }
}
</style>
