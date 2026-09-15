<template>
  <div class="mp-home" data-testid="mp-home">
    <!-- 欢迎区 -->
    <section class="mp-home-welcome">
      <HomeGreeting />
      <div class="mp-home-quick-actions">
        <button class="mp-home-action-btn mp-home-action-btn--primary" data-testid="home-new-publish" @click="go('/publish')">
          <span class="action-icon">✏️</span>
          <span>{{ t('home.newPublish') }}</span>
        </button>
        <button class="mp-home-action-btn" data-testid="home-add-account" @click="go('/accounts')">
          <span class="action-icon">👤</span>
          <span>{{ t('home.addAccount') }}</span>
        </button>
        <button class="mp-home-action-btn" @click="go('/publish/history')">
          <span class="action-icon">📋</span>
          <span>{{ t('home.publishHistory') }}</span>
        </button>
      </div>
    </section>

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

    <!-- 快捷入口 -->
    <section class="mp-home-shortcuts" data-testid="mp-home-shortcuts">
      <h3 class="mp-home-section-title">{{ t('home.shortcuts') }}</h3>
      <div class="mp-home-shortcut-grid">
        <div class="mp-home-shortcut" @click="go('/publish')">
          <span class="shortcut-icon">🚀</span>
          <span class="shortcut-label">{{ t('home.quickPublish') }}</span>
        </div>
        <div class="mp-home-shortcut" @click="go('/accounts')">
          <span class="shortcut-icon">🔐</span>
          <span class="shortcut-label">{{ t('home.accountManage') }}</span>
        </div>
        <div class="mp-home-shortcut" @click="go('/publish/history')">
          <span class="shortcut-icon">📊</span>
          <span class="shortcut-label">{{ t('home.publishHistory') }}</span>
        </div>
        <div class="mp-home-shortcut" @click="go('/dashboard')">
          <span class="shortcut-icon">📈</span>
          <span class="shortcut-label">{{ t('home.dashboard') }}</span>
        </div>
        <div class="mp-home-shortcut" @click="go('/collection')">
          <span class="shortcut-icon">📋</span>
          <span class="shortcut-label">{{ t('home.collection') }}</span>
        </div>
        <div class="mp-home-shortcut" @click="go('/comments')">
          <span class="shortcut-icon">💬</span>
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
          <span v-else>{{ p.icon }}</span> {{ p.label }}
        </span>
      </div>
    </section>

    <!-- 近期动态 -->
    <section class="mp-home-recent" data-testid="mp-home-recent">
      <h3 class="mp-home-section-title">{{ t('home.recentActivity') }}</h3>
      <div v-if="recentItems.length === 0" class="mp-home-empty">
        <span>{{ t('home.emptyRecent') }}</span>
      </div>
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
import { usePlatformStore } from '@/stores/platforms'
import { useAccountStore } from '@/stores/accounts'
import { useTabStore } from '@/stores/tab'
import LoginExpiredBanner from '@/components/LoginExpiredBanner.vue'
import HomeGreeting from '@/components/HomeGreeting.vue'
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
    { id: 'wechat_mp', icon: '💬', iconUrl: getPlatformIconUrl('wechat_mp') },
    { id: 'zhihu', icon: '❓', iconUrl: getPlatformIconUrl('zhihu') },
    { id: 'weibo', icon: '✧', iconUrl: getPlatformIconUrl('weibo') },
    { id: 'douyin', icon: '🎵', iconUrl: getPlatformIconUrl('douyin') },
    { id: 'xiaohongshu', icon: '📕', iconUrl: getPlatformIconUrl('xiaohongshu') },
    { id: 'tencent_video', icon: '▶', iconUrl: getPlatformIconUrl('tencent_video') },
    { id: 'kuaishou', icon: '🎬', iconUrl: getPlatformIconUrl('kuaishou') },
    { id: 'toutiao', icon: '📰', iconUrl: getPlatformIconUrl('toutiao') },
    { id: 'bilibili', icon: '📺', iconUrl: getPlatformIconUrl('bilibili') },
    { id: 'youtube', icon: '▶️', iconUrl: getPlatformIconUrl('youtube') },
    { id: 'tiktok', icon: '🎶', iconUrl: getPlatformIconUrl('tiktok') },
  ].map(p => ({ ...p, label: fallbackPlatformLabel(p.id) }))
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
  border: 1px solid #e0e0e8;
  border-radius: 8px;
  background: #fff;
  color: #4d4f6f;
  font-size: 13px;
  cursor: pointer;
  transition: all 0.15s ease;
}

.mp-home-action-btn:hover {
  border-color: #5048e5;
  color: #5048e5;
}

.mp-home-action-btn--primary {
  border-color: #5048e5;
  background: #5048e5;
  color: #fff;
}

.mp-home-action-btn--primary:hover {
  background: #3f37c9;
  color: #fff;
}

.action-icon {
  font-size: 15px;
}

/* 数据概览 */
.mp-home-stats {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 16px;
  margin-bottom: 32px;
}

.mp-home-stat-card {
  padding: 20px;
  border: 1px solid #e8eaf2;
  border-radius: 12px;
  background: #fff;
  text-align: center;
}

.stat-number {
  font-size: 28px;
  font-weight: 700;
  color: #25252b;
}

.stat-label {
  margin-top: 4px;
  color: #8b8e9a;
  font-size: 13px;
}

.mp-home-stat-card--success .stat-number { color: #2fc27a; }
.mp-home-stat-card--danger .stat-number { color: #f56c6c; }
.mp-home-stat-card--info .stat-number { color: #5048e5; }

/* 快捷入口 */
.mp-home-section-title {
  margin: 0 0 16px;
  color: #25252b;
  font-size: 16px;
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
  border: 1px solid #e8eaf2;
  border-radius: 10px;
  background: #fff;
  cursor: pointer;
  transition: all 0.15s ease;
}

.mp-home-shortcut:hover {
  border-color: #5048e5;
  box-shadow: 0 4px 12px rgba(80, 72, 229, 0.08);
}

.shortcut-icon {
  font-size: 24px;
}

.shortcut-label {
  color: #4d4f6f;
  font-size: 13px;
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
  font-size: 13px;
}

/* 近期动态 */
.mp-home-recent {
  margin-bottom: 32px;
}

.mp-home-empty {
  padding: 40px 20px;
  border: 1px dashed #e8eaf2;
  border-radius: 10px;
  background: #fafaff;
  color: #8b8e9a;
  text-align: center;
  font-size: 14px;
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
  font-size: 14px;
  font-weight: 500;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.recent-item-platform {
  padding: 2px 8px;
  border-radius: 4px;
  background: #f0efff;
  color: #5048e5;
  font-size: 11px;
  flex: 0 0 auto;
}

.recent-item-status {
  padding: 2px 10px;
  border-radius: 12px;
  font-size: 12px;
  flex: 0 0 auto;
}

.status-success { background: #e8f8ef; color: #2fc27a; }
.status-failed, .status-error { background: #fef0f0; color: #f56c6c; }
.status-pending, .status-publishing { background: #f0efff; color: #5048e5; }
.status-unknown { background: #f5f5f5; color: #999; }

.recent-item-time {
  color: #8b8e9a;
  font-size: 12px;
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
