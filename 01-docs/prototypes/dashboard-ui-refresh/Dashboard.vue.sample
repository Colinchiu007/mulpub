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
      <!-- 统计卡片网格 - 不规则布局 -->
      <div class="stats-grid">
        <!-- 大卡片：总发布 (占据 2 列) -->
        <div class="stat-card large">
          <div class="stat-icon">📤</div>
          <div class="stat-value">{{ totalArticles }}</div>
          <div class="stat-label">已发布内容</div>
          <div class="stat-change positive">
            <span>↑</span>
            较上周 +12%
          </div>
        </div>

        <!-- 小卡片：阅读 -->
        <div class="stat-card">
          <div class="stat-icon"><el-icon><View /></el-icon></div>
          <div class="stat-value">{{ totalViews > 10000 ? (totalViews / 10000).toFixed(1) + '万' : totalViews }}</div>
          <div class="stat-label">总阅读</div>
          <div class="stat-change positive">
            <span>↑</span>
            +8.5%
          </div>
        </div>

        <!-- 小卡片：评论 -->
        <div class="stat-card">
          <div class="stat-icon"><el-icon><ChatDotRound /></el-icon></div>
          <div class="stat-value">{{ totalComments }}</div>
          <div class="stat-label">总评论</div>
          <div class="stat-change positive">
            <span>↑</span>
            +23%
          </div>
        </div>

        <!-- 小卡片：粉丝 -->
        <div class="stat-card">
          <div class="stat-icon">👥</div>
          <div class="stat-value">{{ totalFollowers > 10000 ? (totalFollowers / 10000).toFixed(1) + '万' : totalFollowers }}</div>
          <div class="stat-label">总粉丝</div>
          <div class="stat-change negative">
            <span>↓</span>
            -2.1%
          </div>
        </div>
      </div>

      <!-- 未登录门禁：发布统计/最近发布需登录后可见 -->
      <div v-if="statsLoginRequired" class="dashboard-login-gate" role="status" data-testid="dashboard-login-gate">
        <span class="gate-hint">{{ t('dashboard.loginGateHint') }}</span>
        <button class="gate-sign-in" type="button" data-testid="dashboard-sign-in" @click="signInFromGate">{{ t('dashboard.signInNow') }}</button>
      </div>

      <!-- 发布统计 -->
      <div v-if="statsData" class="cohere-card dash-mb-md stats-login-panel">
        <div class="panel-header">
          <div class="panel-title"><el-icon><TrendCharts /></el-icon> 发布统计</div>
        </div>
        <div class="stats-grid-small">
          <div class="stat-card-mini success">
            <div class="stat-value-mini">{{ statsData.total }}</div>
            <div class="stat-label-mini">累计发布</div>
          </div>
          <div class="stat-card-mini success">
            <div class="stat-value-mini dash-stat-success">{{ statsData.success }}</div>
            <div class="stat-label-mini">成功</div>
          </div>
          <div class="stat-card-mini danger">
            <div class="stat-value-mini dash-stat-danger">{{ statsData.failed }}</div>
            <div class="stat-label-mini">失败</div>
          </div>
          <div class="stat-card-mini">
            <div class="stat-value-mini">{{ statsData.successRate || 0 }}%</div>
            <div class="stat-label-mini">成功率</div>
          </div>
        </div>
      </div>

      <!-- 发布趋势（最近 14 天） -->
      <div v-if="statsData && statsData.daily && statsData.daily.length > 0" class="cohere-card dash-panel trend-panel">
        <div class="dash-panel-title">
          <el-icon><TrendCharts /></el-icon> 
          {{ $t('dashboard.trendTitle') }}
          <span class="panel-subtitle">最近 14 天</span>
        </div>
        <div class="dash-trend-track" ref="trendChart">
          <div v-for="(d, index) in last14Days" :key="d.date" 
               :style="{ animationDelay: (0.2 + index * 0.05) + 's' }"
               class="dash-trend-col">
            <div class="dash-trend-bar" 
                 :style="{
                   height: Math.max(4, (d.total / dailyMax) * 160) + 'px',
                   background: d.total > 0 ? 'linear-gradient(to top, var(--lavender-primary), var(--lavender-accent))' : 'var(--color-border)',
                   opacity: d.total > 0 ? 0.7 + (d.total / dailyMax) * 0.3 : 0.3
                 }"
                 :data-value="d.total">
              <span class="bar-tooltip">{{ d.total }} 篇</span>
            </div>
            <span class="dash-trend-date">{{ d.date.slice(5) }}</span>
          </div>
        </div>
      </div>

      <!-- 平台分布 -->
      <div v-if="statsData && platformStats.length > 0" class="cohere-card dash-panel platform-panel">
        <div class="dash-panel-title">
          <el-icon><DataLine /></el-icon> 
          {{ $t('dashboard.platformDistTitle') }}
        </div>
        <div class="dash-dist-list">
          <div v-for="p in platformStats" :key="p.platform" 
               :style="{ animationDelay: (0.3 + platformStats.indexOf(p) * 0.1) + 's' }"
               class="dash-dist-row animate-on-scroll">
            <span class="dash-dist-name">{{ platformName(p.platform) }}</span>
            <div class="dash-dist-track">
              <div class="dash-dist-fill" 
                   :style="{ width: (p.total / maxPlatformTotal) * 100 + '%', animationDelay: (0.3 + platformStats.indexOf(p) * 0.1) + 's' }"></div>
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
      <div class="cohere-section-title dash-section-header">
        <el-icon><DataLine /></el-icon> 
        各平台数据
      </div>
      <EmptyState v-if="platformData.length === 0" 
                  :title="$t('emptyStates.dashboard.title')" 
                  :description="$t('emptyStates.dashboard.message')">
        <template #icon><el-icon><DataLine /></el-icon></template>
        <template #actions>
          <button class="btn-primary" @click="refreshSync">立即同步</button>
        </template>
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
/* === 奶油·薰衣草配色系统 === */
:root {
  --lavender-primary: #7c5cbf;
  --lavender-light: #f8f4ff;
  --lavender-accent: #f472b6;
  --deep-purple: #1e1b4b;
}

/* === 统计卡片网格 - 不规则布局 === */
.stats-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  grid-template-rows: auto auto;
  gap: var(--space-md);
  margin-bottom: var(--space-xl);
}

.stat-card {
  background: white;
  border-radius: var(--radius-lg);
  padding: var(--space-lg);
  box-shadow: var(--shadow-sm);
  transition: all 0.4s cubic-bezier(0.33, 1, 0.68, 1);
  position: relative;
  overflow: hidden;
  animation: fadeInUp 0.6s cubic-bezier(0.33, 1, 0.68, 1) forwards;
  opacity: 0;
}

.stat-card::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 4px;
  background: linear-gradient(90deg, var(--lavender-primary), var(--lavender-accent));
  opacity: 0;
  transition: opacity 0.3s cubic-bezier(0.33, 1, 0.68, 1);
}

.stat-card:hover {
  transform: translateY(-4px);
  box-shadow: var(--shadow-lg);
}

.stat-card:hover::before {
  opacity: 1;
}

.stat-card.large {
  grid-column: span 2;
  background: linear-gradient(135deg, var(--deep-purple) 0%, #4a3f8f 100%);
  color: white;
}

.stat-card.large::before {
  display: none;
}

.stat-card.large:hover {
  transform: scale(1.02);
}

.stat-icon {
  width: 48px;
  height: 48px;
  border-radius: var(--radius-md);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 24px;
  margin-bottom: var(--space-md);
  background: var(--lavender-light);
}

.stat-card.large .stat-icon {
  background: rgba(255, 255, 255, 0.2);
  backdrop-filter: blur(10px);
}

.stat-value {
  font-size: 42px;
  font-weight: 900;
  letter-spacing: -0.02em;
  margin-bottom: var(--space-xs);
  font-family: 'JetBrains Mono', monospace;
}

.stat-card.large .stat-value {
  font-size: 56px;
}

.stat-label {
  font-size: 14px;
  color: var(--text-secondary);
  font-weight: 500;
}

.stat-card.large .stat-label {
  color: rgba(255, 255, 255, 0.8);
}

.stat-change {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  border-radius: var(--radius-full);
  font-size: 12px;
  font-weight: 600;
  margin-top: var(--space-sm);
}

.stat-change.positive {
  background: rgba(16, 185, 129, 0.1);
  color: var(--success);
}

.stat-change.negative {
  background: rgba(239, 68, 68, 0.1);
  color: var(--error);
}

/* === 发布统计面板 === */
.stats-login-panel {
  animation: fadeInUp 0.6s cubic-bezier(0.33, 1, 0.68, 1) 0.1s backwards;
  opacity: 0;
}

.panel-header {
  margin-bottom: var(--space-md);
  padding-bottom: var(--space-sm);
  border-bottom: 1px solid var(--color-border);
}

.panel-title {
  font-weight: 600;
  font-size: 16px;
  color: var(--deep-purple);
  display: flex;
  align-items: center;
  gap: var(--space-sm);
}

.panel-subtitle {
  font-size: 12px;
  color: var(--text-secondary);
  font-weight: 400;
  margin-left: var(--space-sm);
}

.stats-grid-small {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: var(--space-md);
}

.stat-card-mini {
  background: var(--cream-surface);
  border-radius: var(--radius-md);
  padding: var(--space-md);
  text-align: center;
  transition: all 0.3s cubic-bezier(0.33, 1, 0.68, 1);
}

.stat-card-mini:hover {
  transform: translateY(-2px);
  box-shadow: var(--shadow-md);
}

.stat-card-mini.success {
  background: rgba(16, 185, 129, 0.05);
}

.stat-card-mini.danger {
  background: rgba(239, 68, 68, 0.05);
}

.stat-value-mini {
  font-size: 28px;
  font-weight: 700;
  font-family: 'JetBrains Mono', monospace;
  margin-bottom: 4px;
}

.stat-label-mini {
  font-size: 12px;
  color: var(--text-secondary);
}

/* === 趋势图表 === */
.trend-panel {
  animation: fadeInUp 0.6s cubic-bezier(0.33, 1, 0.68, 1) 0.2s backwards;
  opacity: 0;
}

.dash-trend-track {
  display: flex;
  align-items: flex-end;
  gap: 8px;
  height: 200px;
  padding: var(--space-md) 0;
  overflow-x: auto;
}

.dash-trend-col {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  min-width: 40px;
}

.dash-trend-bar {
  width: 100%;
  max-width: 40px;
  border-radius: var(--radius-sm) var(--radius-sm) 0 0;
  transition: all 0.3s cubic-bezier(0.33, 1, 0.68, 1);
  position: relative;
  cursor: pointer;
  animation: growBar 1s cubic-bezier(0.33, 1, 0.68, 1) forwards;
  animation-fill-mode: both;
  opacity: 0;
}

.dash-trend-bar:hover {
  filter: brightness(1.1);
  box-shadow: 0 8px 24px rgba(244, 114, 182, 0.2);
}

.bar-tooltip {
  position: absolute;
  top: -30px;
  left: 50%;
  transform: translateX(-50%);
  font-size: 12px;
  font-weight: 600;
  color: var(--deep-purple);
  opacity: 0;
  transition: opacity 0.3s cubic-bezier(0.33, 1, 0.68, 1);
}

.dash-trend-bar:hover .bar-tooltip {
  opacity: 1;
}

.dash-trend-date {
  font-size: 11px;
  color: var(--text-secondary);
  text-align: center;
}

/* === 平台分布 === */
.platform-panel {
  animation: fadeInUp 0.6s cubic-bezier(0.33, 1, 0.68, 1) 0.3s backwards;
  opacity: 0;
}

.dash-dist-row {
  display: flex;
  align-items: center;
  gap: var(--space-md);
  padding: var(--space-sm);
  border-radius: var(--radius-md);
  transition: all 0.3s cubic-bezier(0.33, 1, 0.68, 1);
  opacity: 0;
}

.dash-dist-row.animate-on-scroll {
  animation: fadeInLeft 0.6s cubic-bezier(0.33, 1, 0.68, 1) forwards;
}

.dash-dist-row:hover {
  background: var(--lavender-light);
}

.dash-dist-track {
  flex: 1;
  height: 16px;
  background: var(--lavender-light);
  border-radius: var(--radius-full);
  overflow: hidden;
}

.dash-dist-fill {
  height: 100%;
  background: linear-gradient(90deg, var(--lavender-primary), var(--lavender-accent));
  border-radius: var(--radius-full);
  transition: width 1.2s cubic-bezier(0.33, 1, 0.68, 1);
  animation: fillProgress 1.2s cubic-bezier(0.33, 1, 0.68, 1) forwards;
  animation-fill-mode: both;
  opacity: 0;
}

.dash-dist-count {
  font-weight: 700;
  color: var(--deep-purple);
  min-width: 60px;
  text-align: right;
  font-size: 14px;
}

/* === 章节标题 === */
.dash-section-header {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  margin-bottom: var(--space-lg);
  color: var(--deep-purple);
}

/* === 动画关键帧 === */
@keyframes fadeInUp {
  from {
    opacity: 0;
    transform: translateY(20px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@keyframes fadeInLeft {
  from {
    opacity: 0;
    transform: translateX(-20px);
  }
  to {
    opacity: 1;
    transform: translateX(0);
  }
}

@keyframes growBar {
  from {
    height: 0;
  }
}

@keyframes fillProgress {
  from {
    width: 0;
  }
}

/* T1-3e：原 25 处内联样式全部类化；颜色一律 var(--color-*)（旧别名 fallback 值
 * #f56c6c/#e0e0e0 均为未生效 fallback，直接丢弃零视觉回归）。 */
.dash-mb-md { margin-bottom: var(--space-md); }
.dash-mt-xl { margin-top: var(--space-xl); }
.dash-stat-success { color: var(--color-success); }
.dash-stat-danger { color: var(--color-danger); }
.dash-panel { cursor: default; margin-bottom: var(--space-md); padding: 16px; }
.dash-panel-title { font-weight: 600; font-size: 14px; margin-bottom: var(--space-md); }
.dash-fail-note { font-size: var(--font-size-xs); color: var(--color-danger); }
.dash-grid-280 { grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); }
.dash-bench-row { display: flex; gap: var(--space-sm); margin-bottom: var(--space-md); align-items: center; }
.dash-bench-input { flex: 1; font-size: 14px; }

/* 响应式 */
@media (max-width: 1024px) {
  .stats-grid {
    grid-template-columns: repeat(2, 1fr);
  }
  
  .stat-card.large {
    grid-column: span 2;
  }
}

@media (max-width: 768px) {
  .stats-grid {
    grid-template-columns: 1fr;
  }
  
  .stat-card.large {
    grid-column: span 1;
  }
  
  .stats-grid-small {
    grid-template-columns: repeat(2, 1fr);
  }
}
</style>
