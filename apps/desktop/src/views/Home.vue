<template>
  <div class="mp-home" data-testid="mp-home">
    <!-- 欢迎区 -->
    <section class="mp-home-welcome">
      <HomeGreeting />
      <div class="mp-home-quick-actions">
        <button class="mp-home-action-btn mp-home-action-btn--primary" data-testid="home-new-publish" @click="go('/publish')">
          <el-icon class="action-icon" :size="15"><Edit /></el-icon>
          <span>{{ t('home.newPublish') }}</span>
        </button>
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

    <!-- 待办摘要（登录失效 / 失败任务；均为 0 时显示鼓励语） -->
    <p v-if="todoItems.length > 0" class="mp-home-todo" data-testid="home-todo">
      <span v-for="item in todoItems" :key="item.key" class="mp-home-todo-item" :class="`mp-home-todo-item--${item.tone}`">{{ item.label }}</span>
    </p>
    <p v-else-if="statsLoaded" class="mp-home-todo mp-home-todo--clear" data-testid="home-todo-clear">{{ t('home.todo.allClear') }}</p>

    <!-- 登录失效提醒 -->
    <LoginExpiredBanner
      :visible="showExpiredBanner"
      :expired-count="expiredAccountCount"
      :batch-loading="batchLogging"
      @batch-login="handleBatchLogin"
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

    <!-- 近期动态 -->
    <section class="mp-home-recent" data-testid="mp-home-recent">
      <h3 class="mp-home-section-title">{{ t('home.recentActivity') }}</h3>
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
          <span class="recent-item-time">{{ formatTime(item.created_at || item.createdAt) }}</span>
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
import { ChatDotRound, Clock, Collection, DataAnalysis, Edit, Lock, Promotion, Tickets, TrendCharts, User } from '@element-plus/icons-vue'
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

const stats = ref({ total: 0, success: 0, failed: 0 })
const accountCount = ref(0)
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

onMounted(async () => {
  subscribeAutoRefresh()
  try {
    platformStore.load()
    await accountStore.ensureLoaded()
    await refreshExpiredAccounts()
    const api = getApi()
    if (api) {
      if (api.storeGetPublishStats) {
        const res = await api.storeGetPublishStats()
        if (res && res.code === 0) stats.value = res.data
      }
      if (api.storeListAccounts) {
        const res = await api.storeListAccounts()
        if (res && res.code === 0) accountCount.value = (res.data || []).length
      }
      statsLoaded.value = true
      if (api.historyList) {
        const res = await api.historyList({ limit: 5, offset: 0 })
        if (res && res.code === 0 && Array.isArray(res.data)) {
          recentItems.value = res.data.slice(0, 5)
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
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  margin-bottom: 32px;
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
  margin: -20px 0 24px;
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
  background: #fff;
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
