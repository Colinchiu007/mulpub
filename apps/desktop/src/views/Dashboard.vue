<template>
  <div>
    <div class="cohere-page-header">
      <div>
        <div class="page-title">数据看板</div>
        <div class="page-subtitle">各平台发布数据与趋势分析</div>
      </div>
      <div class="page-actions">
        <button class="cohere-btn-secondary" data-testid="dashboard-refresh-btn" @click="refreshSync" :disabled="syncing">
          {{ syncing ? '同步中...' : '⟳ 刷新数据' }}
        </button>
      </div>
    </div>

    <div class="cohere-content">
      <!-- 免费版横幅已撤下（dash-full-entitlement，用户决策方案 C）。
           原因：横幅文案「当前为免费版，部分功能受限」在本页是**误导** ——
           本页三个数据源（dashboard:stats / history:list / performance:overview）
           的门禁都是「登录」而非「套餐」，未登录时由下方 .dashboard-login-gate
           单独引导，本页没有任何一项内容因套餐受限。
           撤下后，套餐差异改由下方各区块的「锁区块占位」真实体现（PRD §3.2），
           那才是诚实且可验证的差异 —— 不再是"声称受限"而是"确实少看几块"。

           注意：若将来要把横幅加回来，**必须放在 .cohere-content 内部**（PR #3752 的教训）：
           放在外侧时它是全页唯一没有水平 padding（--space-xxl）的元素，背景色左侧
           直接贴容器边、与下方卡片不对齐，且会被 .banner-text 的 flex:1 拉满整页
           宽度 —— 比下方内容区更宽，视觉上不专业。该位置关系由
           Dashboard.style-guard.test.js 的回归锁机械守住。 -->

      <!-- 统计卡片网格 - 不规则布局 -->
      <div class="stats-grid">
        <!-- 大卡片：总发布 (占据 2 列) -->
        <div class="stat-card large">
          <div class="stat-decor" aria-hidden="true"></div>
          <div class="stat-icon"><el-icon><Promotion /></el-icon></div>
          <div class="stat-value">{{ totalArticles }}</div>
          <div class="stat-label">{{ t('dashboard.publishedContent') }}</div>
        </div>

        <!-- 小卡片：阅读 -->
        <div class="stat-card">
          <div class="stat-icon"><el-icon><View /></el-icon></div>
          <div class="stat-value">{{ totalViews > 10000 ? (totalViews / 10000).toFixed(1) + '万' : totalViews }}</div>
          <div class="stat-label">{{ t('dashboard.totalViews') }}</div>
        </div>

        <!-- 小卡片：评论 -->
        <div class="stat-card">
          <div class="stat-icon"><el-icon><ChatDotRound /></el-icon></div>
          <div class="stat-value">{{ totalComments }}</div>
          <div class="stat-label">{{ t('dashboard.totalComments') }}</div>
        </div>

        <!-- 小卡片：粉丝 -->
        <div class="stat-card">
          <div class="stat-icon"><el-icon><UserFilled /></el-icon></div>
          <div class="stat-value">{{ totalFollowers > 10000 ? (totalFollowers / 10000).toFixed(1) + '万' : totalFollowers }}</div>
          <div class="stat-label">{{ t('dashboard.totalFollowers') }}</div>
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
          <div class="panel-title"><el-icon><TrendCharts /></el-icon> {{ t('dashboard.publishStatsTitle') }}</div>
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
      <!-- 权益门控：未解锁时渲染占位（不发 IPC、不渲染真实数据），
           见 PRD §3.2.1 —— 这是体验分级，不是访问控制。 -->
      <DashboardLockedPanel v-if="!hasDashboardFull" name="trend" :title="$t('dashboard.trendTitle')" @upgrade="showUpgradeModal = true" />
      <div v-else-if="statsData && statsData.daily && statsData.daily.length > 0" class="cohere-card dash-panel trend-panel">
        <div class="dash-panel-title">
          <el-icon><TrendCharts /></el-icon> 
          {{ $t('dashboard.trendTitle') }}
          <span class="panel-subtitle">{{ t('dashboard.last14DaysHint') }}</span>
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
              <span class="bar-tooltip">{{ t('dashboard.countUnit', { count: d.total }) }}</span>
            </div>
            <span class="dash-trend-date">{{ d.date.slice(5) }}</span>
          </div>
        </div>
      </div>

      <!-- 作品互动回流（P2-6c）：数字一律来自 performance_snapshot 聚合 -->
      <DashboardLockedPanel v-if="!hasDashboardFull" name="perf" :title="$t('dashboard.metrics.title')" @upgrade="showUpgradeModal = true" />
      <PerformanceFlowPanel v-else class="dash-mt-xl" :reload-token="metricsReloadToken" />

      <!-- 平台分布 -->
      <DashboardLockedPanel v-if="!hasDashboardFull" name="platform" :title="$t('dashboard.platformDistTitle')" @upgrade="showUpgradeModal = true" />
      <div v-else-if="statsData && platformStats.length > 0" class="cohere-card dash-panel platform-panel">
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
              <el-icon :style="{color: r.success !== false ? 'var(--color-success)' : 'var(--color-danger)'}"><CircleCheckFilled v-if="r.success !== false" /><CircleCloseFilled v-else /></el-icon>
              {{ platformName(r.platform) }}: {{ r.title || r.article?.title || '(无标题)' }}
            </span>
          </li>
        </ul>
      </div>

      <!-- 账号健康度（新，free 可见）：运营必需信息，不给足会让用户无法判断基本可用与否 -->
      <div class="cohere-card dash-panel" data-testid="dashboard-account-health">
        <div class="dash-panel-title">
          <el-icon><UserFilled /></el-icon> {{ t('dashboard.accountHealthTitle') }}
        </div>
        <p v-if="accountHealth.state === 'auth'" class="dash-panel-note" data-testid="account-health-auth">
          {{ t('dashboard.loginGateHint') }}
        </p>
        <p v-else-if="accountHealth.state === 'error'" class="dash-panel-note" data-testid="account-health-error">
          {{ t('dashboard.accountHealthLoadFailed') }}
        </p>
        <p v-else-if="accountHealth.state === 'empty'" class="dash-panel-note" data-testid="account-health-empty">
          {{ t('dashboard.accountHealthEmpty') }}
        </p>
        <template v-else>
          <div class="dash-health-row">
            <span class="dash-health-chip ok">{{ t('dashboard.accountHealthOk', { count: accountHealth.ok }) }}</span>
            <span class="dash-health-chip bad">{{ t('dashboard.accountHealthBad', { count: accountHealth.bad }) }}</span>
            <span class="dash-health-chip unknown">{{ t('dashboard.accountHealthUnknown', { count: accountHealth.unknown }) }}</span>
          </div>
          <ul v-if="accountHealth.badAccounts.length > 0" class="dash-health-list">
            <li v-for="id in accountHealth.badAccounts" :key="id">{{ id }}</li>
            <li v-if="accountHealth.badOverflow > 0" class="dash-health-more">
              {{ t('dashboard.accountHealthMore', { count: accountHealth.badOverflow }) }}
            </li>
          </ul>
        </template>
      </div>

      <!-- 发布队列状态（新，free 可见） -->
      <div class="cohere-card dash-panel" data-testid="dashboard-queue-status">
        <div class="dash-panel-title">
          <el-icon><Timer /></el-icon> {{ t('dashboard.queueTitle') }}
        </div>
        <p v-if="queue.state === 'auth'" class="dash-panel-note" data-testid="queue-auth">
          {{ t('dashboard.loginGateHint') }}
        </p>
        <p v-else-if="queue.state === 'error'" class="dash-panel-note" data-testid="queue-error">
          {{ t('dashboard.queueLoadFailed') }}
        </p>
        <template v-else>
          <div class="dash-health-row">
            <span class="dash-health-chip run">{{ t('dashboard.queueRunning', { count: queue.running }) }}</span>
            <span class="dash-health-chip pending">{{ t('dashboard.queuePending', { count: queue.pending }) }}</span>
            <span class="dash-health-chip bad">{{ t('dashboard.queueFailed', { count: queue.failed }) }}</span>
          </div>
          <p v-if="queue.state === 'empty'" class="dash-panel-note" data-testid="queue-empty">
            {{ t('dashboard.queueEmpty') }}
          </p>
          <ul v-if="queue.failedTitles.length > 0" class="dash-health-list">
            <li v-for="(title, i) in queue.failedTitles" :key="i">{{ title }}</li>
          </ul>
        </template>
      </div>

      <!-- 题材表现榜（新，full 专属） -->
      <DashboardLockedPanel v-if="!hasDashboardFull" name="pattern" :title="t('dashboard.patternTitle')" @upgrade="showUpgradeModal = true" />
      <div v-else class="cohere-card dash-panel" data-testid="dashboard-pattern-board">
        <div class="dash-panel-title">
          <el-icon><TrendCharts /></el-icon> {{ t('dashboard.patternTitle') }}
        </div>
        <p v-if="patternBoard.state === 'auth'" class="dash-panel-note" data-testid="pattern-auth">
          {{ t('dashboard.loginGateHint') }}
        </p>
        <p v-else-if="patternBoard.state === 'error'" class="dash-panel-note" data-testid="pattern-error">
          {{ t('dashboard.patternLoadFailed') }}
        </p>
        <p v-else-if="patternBoard.state === 'empty'" class="dash-panel-note" data-testid="pattern-empty">
          {{ t('dashboard.patternEmpty') }}
        </p>
        <ol v-else class="dash-pattern-list">
          <li v-for="row in patternBoard.rows" :key="row.value" class="dash-pattern-row">
            <span class="dash-pattern-name">{{ row.value }}</span>
            <span class="dash-pattern-score">{{ row.score }}</span>
          </li>
        </ol>
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
            <div class="card-icon"><img v-if="isPlatformIconUrl(platformIcon(item.platform))" :src="platformIcon(item.platform)" class="mp-platform-icon" :alt="platformName(item.platform)" width="24" height="24"><span v-else>{{ platformIcon(item.platform) }}</span></div>
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
import { ChatDotRound, CircleCheckFilled, CircleCloseFilled, DataLine, Promotion, Timer, TrendCharts, UserFilled, View } from '@element-plus/icons-vue'
import { useI18n } from 'vue-i18n'
import { ElMessage } from 'element-plus'
// eslint-disable-next-line no-unused-vars
import { syncAll, syncPlatform } from '@/api/publisher'
import { usePlatformStore } from '@/stores/platforms'
import { useAccountStore } from '@/stores/accounts'
import { useIdentity } from '@/composables/useIdentity'
import { isAuthGateResult } from '@/utils/auth-gate'
import { getPlatformIconUrl, isPlatformIconUrl } from '@/composables/usePlatformIconUrl'
import { formatDateTime } from '@/utils/datetime'
import BenchmarkChart from '@/components/BenchmarkChart.vue'
import PerformanceFlowPanel from '@/features/dashboard/PerformanceFlowPanel.vue'
import DashboardLockedPanel from '@/features/dashboard/DashboardLockedPanel.vue'
// eslint-disable-next-line no-unused-vars
import UpgradeModal from '@/components/UpgradeModal.vue'
import { useIdentityStore } from '@/stores/identity'
import { hasFeatureOf, DASHBOARD_FULL_FEATURE } from '@/views/member-center/entitlement-gate'
import { accountBatchCheckLogin, getQueueStatus, getQueueHistory } from '@/api/publisher'
import { listPatternPerformance } from '@/api/knowledge-library'
import {
  toAccountHealthModel,
  toQueueStatusModel,
  toPatternBoardModel,
  AUTH_GATE,
} from '@/features/dashboard/dashboard-panels-model'

const syncing = ref(false)
const dismissBanner = ref(false)
const { t } = useI18n()
const showUpgradeModal = ref(false)
const platformData = ref([])
const statsData = ref(null)
const recentPublishes = ref([])
// 回流看板与页面共用同一个刷新入口：两个入口各自拉数据会拿到不同时刻的数字
const metricsReloadToken = ref(0)
// 未登录门禁态：dashboard:stats / history:list 要求登录（AUTH_REQUIRED），
// 旧实现静默吞掉导致空数据无引导（2026-09-15，与 publish-history 同范式）。
const statsLoginRequired = ref(false)
const { isAuthenticated: identityAuthenticated, signIn: identitySignIn } = useIdentity()
const platformStore = usePlatformStore()
platformStore.load()

// ─── 套餐权益分级（dash-full-entitlement）─────────────────────────────
// 一律走服务端 entitlement，**不用** licenseStore.isPro：后者是二值，
// 会把 standard 档误判成免费（调研确认的既有陷阱）。
// entitlement 在未登录/未取到时是 null，hasFeatureOf 内部已判空。
const identityStore = useIdentityStore()
const hasDashboardFull = computed(() => hasFeatureOf(identityStore.entitlement, DASHBOARD_FULL_FEATURE))

// 批量检测入参：从 store 取 id 后必须 JSON 脱壳 —— Vue ref 包着的是 reactive proxy，
// 直接传 IPC 会抛 "An object could not be cloned"（项目 QM-2 明写的纪律）。
const accountStore = useAccountStore()
const accountIdsForCheck = computed(() =>
  (accountStore.accounts || []).map((a) => a && a.id).filter((id) => typeof id === 'string' && id)
)

// ─── 新增区块状态（初值 loading，四态：loading/ready/empty/error/auth）────
const accountHealth = ref({ state: 'loading', ok: 0, bad: 0, unknown: 0, badAccounts: [], badOverflow: 0 })
const queue = ref({ state: 'loading', running: 0, pending: 0, failed: 0, failedTitles: [] })
const patternBoard = ref({ state: 'loading', rows: [] })

function platformName (id) { return platformStore.getLabel(id) || id }
function platformIcon (id) { return getPlatformIconUrl(id) || platformStore.getIcon(id) || '' }
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
    metricsReloadToken.value += 1
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

/**
 * 账号健康度、发布队列、题材表现榜三路**并行**取数（dash-full-entitlement）。
 *
 * 纪律（对齐项目 QM-2「首屏不得串行阻塞」）：
 * ① 三路并行（Promise.allSettled），最坏耗时不是各项之和；
 * ② 单路失败只停该路，其余照常渲染；
 * ③ 题材榜未解锁时**根本不发起**请求（PRD §3.2.1）。
 *
 * 防重入：onMounted、watch(identityAuthenticated)、watch(hasDashboardFull)
 * 三个入口都会调它，而权益是异步下发的（挂载时常为 null，随后才到位），
 * 不加闸门会让同一批数据被取 3~5 次（实测题材榜 IPC 被调 5 次）。
 */
// 题材榜单独一个入口：只有它受权益门控，与账号/队列解耦后，
// 权益到位时不会把已取到的账号/队列数据再拉一遍（拆分前的实测：5 次 IPC）。
let patternSeq = 0
async function loadPatternBoard () {
  const seq = ++patternSeq
  // 未解锁时**根本不发请求**：主进程对该通道不设权益防（PRD §3.2.1），
  // 发了会成功返回却不能显示，这个"拿到了但不给看"的状态无从解释，不如不发。
  if (!hasDashboardFull.value) {
    patternBoard.value = { state: 'loading', rows: [] }
    return
  }
  try {
    const res = await listPatternPerformance({ dimension: 'narrative_structure' })
    if (seq === patternSeq) patternBoard.value = toPatternBoardModel(res)
  } catch (e) {
    console.warn('Load pattern board failed:', e && e.message)
    if (seq === patternSeq) patternBoard.value = { state: 'error', rows: [] }
  }
}

let newPanelsSeq = 0
async function loadNewPanels () {
  const seq = ++newPanelsSeq
  const [accountRes, statusRes, historyRes] = await Promise.allSettled([
    accountBatchCheckLogin(JSON.parse(JSON.stringify(accountIdsForCheck.value))),
    getQueueStatus(),
    getQueueHistory(),
  ])
  // 被后来的调用取代则丢弃结果（防乱序写回）
  if (seq !== newPanelsSeq) return
  accountHealth.value = toAccountHealthModel(accountRes.status === 'fulfilled' ? accountRes.value : null)
  queue.value = toQueueStatusModel(
    statusRes.status === 'fulfilled' ? statusRes.value : null,
    historyRes.status === 'fulfilled' ? historyRes.value : null
  )
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
  // 新增三区块同样依赖登录态（队列/账号通道不在 public 列表）
  if (authed) loadNewPanels()
})

// 权益到位时只补取题材榜（PRD §3.2.1）：它是唯一受门控的区块。
// 账号/队列不受套餐限制，权益到位不该让它们再取一遍。
watch(hasDashboardFull, loadPatternBoard)

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

onMounted(() => { loadCached(); loadStats(); loadRecent(); loadNewPanels(); loadPatternBoard() })
</script>

<style scoped>
/* === 奶油·薰衣草配色系统 === */
:global(:root) {
  --lavender-primary: #7c5cbf;
  --lavender-light: #f8f4ff;
  --lavender-accent: #f472b6;
  --deep-purple: #1e1b4b;
}

/* === 统计卡片网格 - 不规则布局 === */
.stats-grid {
  display: grid;
  /* 桌面 5 列 == hero(span2) + 3 普通卡 = 5 网格单元，单行铺满无孤儿换行 */
  grid-template-columns: repeat(5, 1fr);
  grid-template-rows: auto;
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
}

/* 深色模式覆盖（P4 2026-10-08）：background: white 是硬编码，暗色下不变 →
 * 深底上三张刺眼白卡（实测截图见研究方案 §3.3/§8）。改用 token 让暗色
 * 自动切换到 --color-bg-card（#232329）；白卡内文字继承暗色文字档。 */
[data-theme='dark'] .stat-card {
  background: var(--color-bg-card);
  box-shadow: none;
}

/* 深色模式覆盖（P4E 2026-10-09）：--deep-purple #1e1b4b 在 :global(:root)
 * 只定义了亮色值，暗色画布 #1a1a1e 上章节标题 1.09:1 不可读（contrast-audit
 * dashboard 1 处命中）。改用暗色提亮变体（同紫色相）。
 * 注意：--deep-purple 声明在 :global(:root)，若在此重声明变量需同作用域；
 * 直接覆盖消费元素颜色更稳（scoped 内对组件元素生效，不受注入顺序反超）。 */
[data-theme='dark'] .dash-section-header {
  color: var(--color-sidebar-accent);
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

/* hero 卡右侧装饰光晕：2 列宽内容仅占左半，柔光圆斑填充右半空区 */
.stat-decor {
  position: absolute;
  top: 50%;
  right: -30px;
  width: 160px;
  height: 160px;
  transform: translateY(-50%);
  border-radius: var(--radius-full);
  background: radial-gradient(circle at 32% 30%, rgba(255, 255, 255, 0.28), rgba(255, 255, 255, 0) 70%);
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.14);
  pointer-events: none;
}

.stat-icon {
  width: 48px;
  height: 48px;
  border-radius: var(--radius-md);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: var(--font-size-xl);
  margin-bottom: var(--space-md);
  background: var(--lavender-light);
}

.stat-card.large .stat-icon {
  background: rgba(255, 255, 255, 0.2);
  backdrop-filter: blur(10px);
}

.stat-value {
  font-size: clamp(2.4rem, 4vw, 2.8rem);
  font-weight: 900;
  letter-spacing: -0.02em;
  margin-bottom: var(--space-xs);
  font-family: 'JetBrains Mono', monospace;
}

.stat-card.large .stat-value {
  font-size: clamp(3rem, 5vw, 3.6rem);
}

.stat-label {
  font-size: var(--font-size-base);
  color: var(--color-text-secondary);
  font-weight: 500;
}

.stat-card.large .stat-label {
  color: rgba(255, 255, 255, 0.8);
}

/* === 发布统计面板 === */
.stats-login-panel {
  animation: fadeInUp 0.6s cubic-bezier(0.33, 1, 0.68, 1) 0.1s backwards;
}

.panel-header {
  margin-bottom: var(--space-md);
  padding-bottom: var(--space-sm);
  border-bottom: 1px solid var(--color-border);
}

.panel-title {
  font-weight: 600;
  font-size: var(--font-size-md);
  color: var(--deep-purple);
  display: flex;
  align-items: center;
  gap: var(--space-sm);
}

.panel-subtitle {
  font-size: var(--font-size-xs);
  color: var(--color-text-secondary);
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
  font-size: var(--font-size-xxl);
  font-weight: 700;
  font-family: 'JetBrains Mono', monospace;
  margin-bottom: 4px;
}

.stat-label-mini {
  font-size: var(--font-size-xs);
  color: var(--color-text-secondary);
}

/* === 趋势图表 === */
.trend-panel {
  animation: fadeInUp 0.6s cubic-bezier(0.33, 1, 0.68, 1) 0.2s backwards;
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
  font-size: var(--font-size-xs);
  font-weight: 600;
  color: var(--deep-purple);
  opacity: 0;
  transition: opacity 0.3s cubic-bezier(0.33, 1, 0.68, 1);
}

.dash-trend-bar:hover .bar-tooltip {
  opacity: 1;
}

.dash-trend-date {
  font-size: var(--font-size-xs);
  color: var(--color-text-secondary);
  text-align: center;
}

/* === 平台分布 === */
.platform-panel {
  animation: fadeInUp 0.6s cubic-bezier(0.33, 1, 0.68, 1) 0.3s backwards;
}

.dash-dist-row {
  display: flex;
  align-items: center;
  gap: var(--space-md);
  padding: var(--space-sm);
  border-radius: var(--radius-md);
  transition: all 0.3s cubic-bezier(0.33, 1, 0.68, 1);
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
}

.dash-dist-count {
  font-weight: 700;
  color: var(--deep-purple);
  min-width: 60px;
  text-align: right;
  font-size: var(--font-size-base);
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
.dash-panel-title { font-weight: 600; font-size: var(--font-size-base); margin-bottom: var(--space-md); }
.dash-fail-note { font-size: var(--font-size-xs); color: var(--color-danger); }
.dash-grid-280 { grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); }
.dash-bench-row { display: flex; gap: var(--space-sm); margin-bottom: var(--space-md); align-items: center; }
.dash-bench-input { flex: 1; font-size: var(--font-size-base); }

/* === 未登录门禁条（发布统计/最近发布登录后可见时的占位提示）=== */
.dashboard-login-gate {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-wrap: wrap;
  gap: var(--space-md);
  padding: var(--space-lg);
  margin-bottom: var(--space-lg);
  background: var(--cream-surface);
  border: 1px dashed var(--color-border-strong);
  border-radius: var(--radius-lg);
}

.gate-hint {
  font-size: var(--font-size-base);
  color: var(--color-text-secondary);
}

.gate-sign-in {
  appearance: none;
  -webkit-appearance: none;
  border: none;
  cursor: pointer;
  padding: 8px 18px;
  border-radius: var(--radius-pill);
  background: var(--lavender-primary);
  color: #fff;
  font-size: var(--font-size-sm);
  font-weight: 600;
  transition: all 0.3s cubic-bezier(0.33, 1, 0.68, 1);
}

.gate-sign-in:hover {
  filter: brightness(1.06);
  transform: translateY(-1px);
}

.gate-sign-in:active {
  transform: translateY(0);
}

/* === 新增区块：账号健康度 / 发布队列 / 题材榜（dash-full-entitlement）=== */
/* 与既有 .dash-panel-title 同形态，不再另起一套标题样式 */
.dash-panel-note {
  font-size: var(--font-size-sm);
  color: var(--color-text-secondary);
  margin: 0;
}
.dash-health-row {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-sm);
  margin-bottom: var(--space-sm);
}
.dash-health-chip {
  padding: 2px 10px;
  border-radius: var(--radius-full, 9999px);
  font-size: var(--font-size-xs);
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  background: var(--lavender-light);
  color: var(--deep-purple);
}
.dash-health-chip.ok { background: rgba(16, 185, 129, .12); color: var(--color-success); }
.dash-health-chip.bad { background: rgba(239, 68, 68, .12); color: var(--color-danger); }
.dash-health-chip.unknown { background: var(--color-border); color: var(--color-text-secondary); }
.dash-health-chip.run { background: var(--lavender-light); color: var(--deep-purple); }
.dash-health-chip.pending { background: var(--lavender-light); color: var(--deep-purple); }
.dash-health-list {
  margin: 0;
  padding-left: 18px;
  font-size: var(--font-size-sm);
  color: var(--color-text-primary);
}
.dash-health-more {
  color: var(--color-text-secondary);
  list-style: none;
  margin-left: -18px;
}
.dash-pattern-list {
  margin: 0;
  padding-left: 20px;
}
.dash-pattern-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-md);
  padding: 4px 0;
  font-size: var(--font-size-sm);
}
.dash-pattern-name { color: var(--color-text-primary); }
.dash-pattern-score {
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  color: var(--deep-purple);
}

/* 响应式 */
@media (max-width: 1024px) {
  .stats-grid {
    grid-template-columns: repeat(2, 1fr);
  }
  
  .stat-card.large {
    grid-column: span 1;
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
