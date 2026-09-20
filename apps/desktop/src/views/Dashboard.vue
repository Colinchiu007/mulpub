<template>
  <div>
    <div class="cohere-page-header">
      <div>
        <div class="page-title">数据看板</div>
        <div class="page-subtitle">各平台发布数据与趋势分析</div>
      </div>
      <div class="page-actions">
        <button class="cohere-btn-secondary" @click="refreshSync" :disabled="syncing">
          {{ syncing ? '同步中...' : '⟳ 刷新数据' }}
        </button>
      </div>
    </div>

    <!-- 试用横幅 -->
    <TrialBanner :dismissed="dismissBanner" @upgrade="showUpgradeModal = true" @dismiss="dismissBanner = true" />

    <div class="cohere-content">
      <!-- 汇总卡片 -->
      <div class="cohere-stat-grid">
        <div class="cohere-stat-card">
          <div class="stat-icon">📤</div>
          <div class="stat-value">{{ totalArticles }}</div>
          <div class="stat-label">总发布</div>
        </div>
        <div class="cohere-stat-card">
          <div class="stat-icon"><el-icon><View /></el-icon></div>
          <div class="stat-value">{{ totalViews > 10000 ? (totalViews / 10000).toFixed(1) + '万' : totalViews }}</div>
          <div class="stat-label">总阅读</div>
        </div>
        <div class="cohere-stat-card">
          <div class="stat-icon"><el-icon><ChatDotRound /></el-icon></div>
          <div class="stat-value">{{ totalComments }}</div>
          <div class="stat-label">评论</div>
        </div>
        <div class="cohere-stat-card">
          <div class="stat-icon">👥</div>
          <div class="stat-value">{{ totalFollowers > 10000 ? (totalFollowers / 10000).toFixed(1) + '万' : totalFollowers }}</div>
          <div class="stat-label">粉丝</div>
        </div>
      </div>

      <!-- 未登录门禁：发布统计/最近发布需登录后可见 -->
      <div v-if="statsLoginRequired" class="dashboard-login-gate" role="status" data-testid="dashboard-login-gate">
        <span class="gate-hint">{{ t('dashboard.loginGateHint') }}</span>
        <button class="gate-sign-in" type="button" data-testid="dashboard-sign-in" @click="signInFromGate">{{ t('dashboard.signInNow') }}</button>
      </div>

      <!-- 发布统计 -->
      <div v-if="statsData" class="cohere-stat-grid dash-mb-md">
        <div class="cohere-stat-card">
          <div class="stat-value">{{ statsData.total }}</div>
          <div class="stat-label">累计发布</div>
        </div>
        <div class="cohere-stat-card">
          <div class="stat-value dash-stat-success">{{ statsData.success }}</div>
          <div class="stat-label">成功</div>
        </div>
        <div class="cohere-stat-card">
          <div class="stat-value dash-stat-danger">{{ statsData.failed }}</div>
          <div class="stat-label">失败</div>
        </div>
        <div class="cohere-stat-card">
          <div class="stat-value">{{ statsData.successRate || 0 }}%</div>
          <div class="stat-label">成功率</div>
        </div>
      </div>

      <!-- 发布趋势（最近 14 天） -->
      <div v-if="statsData && statsData.daily && statsData.daily.length > 0" class="cohere-card dash-panel">
        <div class="dash-panel-title"><el-icon><TrendCharts /></el-icon> {{ $t('dashboard.trendTitle') }}</div>
        <div class="dash-trend-track">
          <div v-for="d in last14Days" :key="d.date" :title="d.date + ': ' + d.total + ' 篇'" class="dash-trend-col">
            <div class="dash-trend-bar" :style="{width:'100%', height: Math.max(4, (d.total / dailyMax) * 60) + 'px', background: d.total > 0 ? 'var(--color-danger)' : 'var(--color-border)', opacity: d.total > 0 ? 0.7 + (d.total / dailyMax) * 0.3 : 0.3}"></div>
            <span class="dash-trend-date">{{ d.date.slice(5) }}</span>
          </div>
        </div>
      </div>

      <!-- 平台分布 -->
      <div v-if="statsData && platformStats.length > 0" class="cohere-card dash-panel">
        <div class="dash-panel-title"><el-icon><DataLine /></el-icon> {{ $t('dashboard.platformDistTitle') }}</div>
        <div class="dash-dist-list">
          <div v-for="p in platformStats" :key="p.platform" class="dash-dist-row">
            <span class="dash-dist-name">{{ platformName(p.platform) }}</span>
            <div class="dash-dist-track">
              <div class="dash-dist-fill" :style="{width: (p.total / maxPlatformTotal) * 100 + '%'}"></div>
            </div>
            <span class="dash-dist-count">{{ p.total }} 篇</span>
          </div>
        </div>
      </div>

      <!-- 最近发布 -->
      <div v-if="recentPublishes.length > 0" class="cohere-card dash-panel">
        <div class="dash-panel-title"><el-icon><Timer /></el-icon> {{ $t('dashboard.recentTitle') }}</div>
        <ul class="cohere-timeline">
          <li v-for="r in recentPublishes" :key="r.id" class="cohere-timeline-item" :class="r.success !== false ? 'success' : 'danger'">
            <span class="tl-time">{{ formatTime(r.timestamp) }}</span>
            <span class="tl-text">
              <span :style="{color: r.success !== false ? 'var(--color-success)' : 'var(--color-danger)'}">{{ r.success !== false ? '✅' : '❌' }}</span>
              {{ platformName(r.platform) }}: {{ r.title || r.article?.title || '(无标题)' }}
            </span>
          </li>
        </ul>
      </div>

      <!-- 各平台数据 -->
      <div class="cohere-section-title">各平台数据</div>
      <EmptyState v-if="platformData.length === 0" :title="$t('emptyStates.dashboard.title')" :description="$t('emptyStates.dashboard.message')">
        <template #icon><el-icon><DataLine /></el-icon></template>
      </EmptyState>
      <div v-else class="cohere-card-grid dash-grid-280">
        <div v-for="item in platformData" :key="item.platform" class="cohere-card">
          <div class="card-top">
            <div class="card-icon"><img v-if="isIconUrl(platformIcon(item.platform))" :src="platformIcon(item.platform)" :alt="platformName(item.platform)" width="24" height="24"><span v-else>{{ platformIcon(item.platform) }}</span></div>
            <div class="card-info">
              <div class="card-platform">{{ platformName(item.platform) }}</div>
              <div v-if="!item.error" class="card-meta">
                更新于 {{ formatTime(item.syncedAt) }}
              </div>
              <div v-else class="dash-fail-note">数据获取失败</div>
            </div>
          </div>
          <div v-if="!item.error" class="card-stats">
            <div class="stat-item"><span class="stat-num">{{ item.views ?? '-' }}</span><span class="stat-lbl">阅读</span></div>
            <div class="stat-item"><span class="stat-num">{{ item.comments ?? '-' }}</span><span class="stat-lbl">评论</span></div>
            <div class="stat-item"><span class="stat-num">{{ item.likes ?? '-' }}</span><span class="stat-lbl">点赞</span></div>
            <div class="stat-item"><span class="stat-num">{{ item.followers ?? '-' }}</span><span class="stat-lbl">粉丝</span></div>
          </div>
        </div>
      </div>
    </div>

    <!-- 内容基准比较 -->
    <div class="cohere-section-title dash-mt-xl"><el-icon><DataLine /></el-icon> 内容基准比较</div>
    <div class="dash-bench-row">
      <input class="cohere-input dash-bench-input" v-model="benchmarkTitle" placeholder="输入文章标题进行基准比较..." @keyup.enter="doBenchmark" />
      <button class="cohere-btn-primary" @click="doBenchmark" :disabled="!benchmarkTitle.trim()">分析</button>
    </div>
    <BenchmarkChart v-if="benchmarkActiveTitle" :title="benchmarkActiveTitle" :key="benchmarkActiveTitle" />
  </div>
</template>

<script setup>
// eslint-disable-next-line no-unused-vars
import UiButton from "../components/UiButton.vue";
import { getApi } from '@/api/electron-bridge'
// eslint-disable-next-line no-unused-vars
import UiInput from "../components/UiInput.vue";
import { ref, computed, onMounted, watch } from 'vue'
import { ChatDotRound, DataLine, Timer, TrendCharts, View } from '@element-plus/icons-vue'
import { useI18n } from 'vue-i18n'
import { ElMessage } from 'element-plus'
// eslint-disable-next-line no-unused-vars
import { syncAll, syncPlatform } from '@/api/publisher'
import { usePlatformStore } from '@/stores/platforms'
import { useIdentity } from '@/composables/useIdentity'
import { isAuthGateResult } from '@/utils/auth-gate'
import { getPlatformIconUrl } from '@/composables/usePlatformIconUrl'
import { formatDateTime } from '@/utils/datetime'
import BenchmarkChart from '@/components/BenchmarkChart.vue'
import TrialBanner from '@/components/TrialBanner.vue'
// eslint-disable-next-line no-unused-vars
import UpgradeModal from '@/components/UpgradeModal.vue'

const syncing = ref(false)
const dismissBanner = ref(false)
const { t } = useI18n()
const showUpgradeModal = ref(false)
const platformData = ref([])
const statsData = ref(null)
const recentPublishes = ref([])
// 未登录门禁态：dashboard:stats / history:list 要求登录（AUTH_REQUIRED），
// 旧实现静默吞掉导致空数据无引导（2026-09-15，与 publish-history 同范式）。
const statsLoginRequired = ref(false)
const { isAuthenticated: identityAuthenticated, signIn: identitySignIn } = useIdentity()
const platformStore = usePlatformStore()
platformStore.load()

function platformName (id) { return platformStore.getLabel(id) || id }
function platformIcon (id) { return getPlatformIconUrl(id) || platformStore.getIcon(id) || '' }
function isIconUrl (value) { return typeof value === 'string' && (value.startsWith('/') || value.startsWith('data:') || value.startsWith('http')) }
const formatTime = (iso) => formatDateTime(iso, { style: 'hour-minute' })

const totalArticles = computed(() => platformData.value.filter(d => !d.error).reduce((s, d) => s + (d.articles || 0), 0))
const totalViews = computed(() => platformData.value.filter(d => !d.error).reduce((s, d) => s + (d.views || 0), 0))
const totalComments = computed(() => platformData.value.filter(d => !d.error).reduce((s, d) => s + (d.comments || 0), 0))
const totalFollowers = computed(() => platformData.value.filter(d => !d.error).reduce((s, d) => s + (d.followers || 0), 0))

const last14Days = computed(() => {
  if (!statsData.value || !statsData.value.daily) return []
  return statsData.value.daily.slice(-14)
})

const dailyMax = computed(() => {
  const days = last14Days.value
  if (days.length === 0) return 1
  return Math.max(1, ...days.map(d => d.total))
})

const platformStats = computed(() => {
  if (!statsData.value || !statsData.value.perPlatform) return []
  return Object.entries(statsData.value.perPlatform)
    .map(([platform, data]) => ({ platform, ...data }))
    .sort((a, b) => b.total - a.total)
})

const maxPlatformTotal = computed(() => {
  if (platformStats.value.length === 0) return 1
  return Math.max(1, ...platformStats.value.map(p => p.total))
})

async function refreshSync () {
  if (!syncAll) return
  syncing.value = true
  try {
    await syncAll()
    await loadCached()
  } catch (e) {
    console.warn('Sync failed:', e.message)
    ElMessage.error(t('dashboard.syncFailed'))
  } finally {
    syncing.value = false
  }
}

async function loadStats () {
  const api = getApi()
  if (!api || !api.dashboardStats) return
  try {
    const res = await api.dashboardStats()
    if (isAuthGateResult(res)) {
      statsLoginRequired.value = true
      return
    }
    statsLoginRequired.value = false
    if (res.code === 0) statsData.value = res.data
  } catch (e) {
    console.warn('Load stats failed:', e.message)
    ElMessage.error(t('dashboard.loadStatsFailed'))
  }
}

async function loadRecent () {
  const api = getApi()
  if (!api || !api.historyList) return
  try {
    const res = await api.historyList({ limit: 5 })
    if (isAuthGateResult(res)) {
      statsLoginRequired.value = true
      return
    }
    if (res.code === 0) recentPublishes.value = (res.data && res.data.records) || []
  } catch (e) {
    console.warn('Load recent failed:', e.message)
    ElMessage.error(t('dashboard.loadRecentFailed'))
  }
}

async function signInFromGate () {
  // 打开登录窗口的唯一正确入口：identity.signIn()（主进程 Logto OAuth）；取消保持门禁态。
  try {
    await identitySignIn()
  } catch {
    /* 用户取消或登录窗关闭 */
  }
}

// 登录成功后自动重载看板数据，无需刷新页面。
watch(identityAuthenticated, (authed) => {
  if (authed && statsLoginRequired.value) {
    statsLoginRequired.value = false
    loadStats()
    loadRecent()
  }
})

async function loadCached () {
  const api = getApi()
  if (!api || !api.syncCached) return
  try {
    const res = await api.syncCached()
    if (res.code === 0) platformData.value = res.data || []
  } catch (e) {
    console.warn('Load cached failed:', e.message)
    ElMessage.error(t('dashboard.loadCachedFailed'))
  }
}

const benchmarkTitle = ref('')
const benchmarkActiveTitle = ref('')

function doBenchmark () {
  if (!benchmarkTitle.value.trim()) return
  benchmarkActiveTitle.value = benchmarkTitle.value.trim()
}

onMounted(() => { loadCached(); loadStats(); loadRecent() })
</script>

<style scoped>
.dashboard-login-gate {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-md, 16px);
  padding: 12px 16px;
  margin-bottom: var(--space-md, 16px);
  border: 0.5px solid var(--border-secondary, rgba(0, 0, 0, 0.3));
  border-radius: var(--border-radius-lg, 12px);
  background: var(--bg-secondary, #f6f6f4);
}
.gate-hint { font-size: var(--font-size-sm); color: var(--text-primary, #25252b); }
.gate-sign-in {
  padding: 6px 16px;
  border: none;
  border-radius: 8px;
  background: var(--brand-primary, #534ab7);
  color: #fff;
  font-size: var(--font-size-sm);
  cursor: pointer;
}

/* T1-3e：原 25 处内联样式全部类化；颜色一律 var(--color-*)（旧别名 fallback 值
 * #f56c6c/#e0e0e0 均为未生效 fallback，直接丢弃零视觉回归）。 */
.dash-mb-md { margin-bottom: var(--space-md); }
.dash-mt-xl { margin-top: var(--space-xl); }
.dash-stat-success { color: var(--color-success); }
.dash-stat-danger { color: var(--color-danger); }
.dash-panel { cursor: default; margin-bottom: var(--space-md); padding: 16px; }
.dash-panel-title { font-weight: 600; font-size: var(--font-size-sm); margin-bottom: var(--space-md); }
.dash-trend-track { display: flex; align-items: flex-end; gap: 4px; height: 80px; padding: 0 4px; }
.dash-trend-col { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 2px; }
.dash-trend-bar { border-radius: 3px 3px 0 0; transition: height 0.3s; }
.dash-trend-date { font-size: var(--font-size-xs); color: var(--color-text-muted); white-space: nowrap; }
.dash-dist-list { display: flex; flex-direction: column; gap: 8px; }
.dash-dist-row { display: flex; align-items: center; gap: 8px; }
.dash-dist-name { width: 60px; font-size: var(--font-size-xs); text-overflow: ellipsis; overflow: hidden; white-space: nowrap; }
.dash-dist-track { flex: 1; height: 16px; background: var(--color-border); border-radius: 8px; overflow: hidden; }
.dash-dist-fill { height: 100%; background: var(--color-danger); border-radius: 8px; opacity: 0.8; transition: width 0.3s; }
.dash-dist-count { width: 50px; text-align: right; font-size: var(--font-size-xs); color: var(--color-text-muted); }
.dash-fail-note { font-size: var(--font-size-xs); color: var(--color-danger); }
.dash-grid-280 { grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); }
.dash-bench-row { display: flex; gap: var(--space-sm); margin-bottom: var(--space-md); align-items: center; }
.dash-bench-input { flex: 1; font-size: var(--font-size-sm); }

</style>
