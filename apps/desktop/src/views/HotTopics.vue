<template>
  <div class="hot-topics-page">
    <div class="cohere-page-header">
      <div>
        <div class="page-title">{{ t('hotTopics.pageTitle') }}</div>
        <div class="page-subtitle">{{ t('hotTopics.pageDesc') }}</div>
      </div>
      <div class="header-actions">
        <span v-if="lastRefreshText" class="last-refresh">{{ lastRefreshText }}</span>
        <button class="cohere-btn-secondary" :disabled="loading || publishing" @click="refresh(true)">
          {{ loading ? t('hotTopics.refreshing') : t('hotTopics.refresh') }}
        </button>
      </div>
    </div>

    <div class="cohere-content">
      <!-- 标签页切换 -->
      <div class="tab-bar" role="tablist">
        <button
          role="tab"
          :aria-selected="activeTab === 'hot'"
          class="tab-btn"
          :class="{ active: activeTab === 'hot' }"
          @click="activeTab = 'hot'"
        >{{ t('hotTopics.tabHot') }}</button>
        <button
          role="tab"
          :aria-selected="activeTab === 'favorites'"
          class="tab-btn"
          :class="{ active: activeTab === 'favorites' }"
          @click="activeTab = 'favorites'"
        >{{ t('hotTopics.tabFavorites') }}<span v-if="favorites.length > 0" class="fav-count">{{ favorites.length }}</span></button>
      </div>

      <!-- 热门选题：仅 hot tab 下显示 -->
      <div v-if="activeTab === 'hot'">
      <!-- 部分渠道失败警告 -->
      <el-alert
        v-if="failedChannels.length > 0"
        type="warning"
        :title="partialFailText"
        closable
        style="margin-bottom: 12px"
      />

      <!-- 分类筛选 + 渠道筛选 -->
      <div class="filter-row">
        <div class="category-chips" role="tablist" aria-label="category filter">
          <button
            v-for="cat in categoryOptions"
            :key="cat.value"
            role="tab"
            :aria-selected="activeCategory === cat.value"
            class="category-chip"
            :class="{ active: activeCategory === cat.value }"
            @click="activeCategory = cat.value"
          >{{ cat.label }}<span v-if="cat.value !== 'all'" class="chip-count" :data-testid="'hot-topic-cat-count-' + cat.value">{{ categoryCounts[cat.value] || 0 }}</span></button>
        </div>
        <el-select v-model="activeChannel" class="channel-select" style="width: 160px" :disabled="publishing">
          <el-option :label="t('hotTopics.channelAll')" value="all" />
          <el-option
            v-for="ch in channelOptions"
            :key="ch.value"
            :label="ch.label + (channelStats[ch.value] && !channelStats[ch.value].ok ? ' (' + t('hotTopics.channelUnavailable') + ')' : '')"
            :value="ch.value"
          />
        </el-select>
      </div>

      <!-- 批量操作条 / 发布进度区（改写完成后保留进度区展示结果与去发布入口，直到用户返回） -->
      <div v-if="!publishing && !publishDone" class="batch-bar" data-testid="hot-topics-batch-bar">
        <label class="select-all-label">
          <input type="checkbox" :checked="allFilteredSelected" @change="toggleSelectAll" />
          {{ allFilteredSelected ? t('hotTopics.deselectAll') : t('hotTopics.selectAll') }}
        </label>
        <span class="selected-count">{{ selectedCountText }}</span>
        <label class="hot-viral-toggle" data-testid="hot-use-viral">
          <input type="checkbox" v-model="hotUseViral" class="coral-check" />
          <span>{{ t('hotTopics.useViralLibrary') }}</span>
        </label>
        <div class="batch-actions">
          <button class="cohere-btn-secondary" :disabled="selectedIds.size === 0" @click="createCopyBatch">
            {{ t('hotTopics.createCopy') }}
          </button>
          <button class="cohere-btn-primary" :disabled="selectedIds.size === 0" @click="startPublish">
            {{ t('hotTopics.publishBtn') }}
          </button>
        </div>
      </div>
      <div v-else class="publish-progress" data-testid="hot-topics-publish-progress">
        <div class="progress-header">
          <span>{{ progressText }}</span>
          <button v-if="!publishDone" class="cohere-btn-secondary" @click="cancelPublish">{{ t('hotTopics.publishCancel') }}</button>
          <button v-else class="cohere-btn-secondary" @click="backToBatch">{{ t('hotTopics.backToBatch') }}</button>
        </div>
        <el-progress :percentage="progressPct" :stroke-width="10" />
        <div class="progress-items">
          <div v-for="item in publishQueue" :key="item.id" class="progress-item" :class="item.status">
            <span class="pi-topic" :title="item.topic">{{ item.topic }}</span>
            <span class="pi-status">
              <template v-if="item.status === 'pending'">…</template>
              <template v-else-if="item.status === 'rewriting'">⏳</template>
              <template v-else-if="item.status === 'success'">✅</template>
              <template v-else-if="item.status === 'failed'">
                ❌ <button class="retry-btn" @click="retryPublishItem(item)">{{ t('hotTopics.publishRetry') }}</button>
              </template>
            </span>
          </div>
        </div>
        <div v-if="publishDone" class="publish-done">
          <span>{{ publishDoneText }}</span>
          <!-- 无成功草稿时隐藏去发布按钮，避免点击无反馈（审查 Warning：取消且零成功场景） -->
          <button v-if="hasSuccessfulDrafts" class="cohere-btn-primary" @click="goToDestination">{{ t('hotTopics.toPublish') }}</button>
        </div>
      </div>

      <!-- 选题列表（加载态由中央提示覆盖，此处仅空态/列表） -->
      <EmptyState
        v-if="filteredTopics.length === 0 && !loading"
        data-testid="hot-topics-empty"
        icon="🔥"
        :title="categoryEmpty ? t('hotTopics.emptyCategoryTitle') : t('hotTopics.emptyTitle')"
        :description="categoryEmpty ? t('hotTopics.emptyCategoryDesc') : t('hotTopics.emptyDesc')"
        :action-text="categoryEmpty ? t('hotTopics.boostAction') : t('hotTopics.emptyAction')"
        @action="categoryEmpty ? boostCurrentCategory() : refresh(true)"
      />
      <div v-else class="topics-list">
        <div
          v-for="(topic, viewIndex) in filteredTopics"
          :key="topic.id"
          class="topic-item"
          :class="{ selected: selectedIds.has(topic.id) }"
          data-testid="hot-topic-item"
        >
          <input
            type="checkbox"
            class="topic-check"
            :checked="selectedIds.has(topic.id)"
            :data-testid="'hot-topic-check-' + topic.id"
            @change="toggleSelect(topic.id)"
          />
          <span class="rank-badge" :title="rankBadgeTitle(topic)">{{ topic.viewRank ?? viewIndex + 1 }}</span>
          <span class="topic-text" :title="getTopicSummary(topic)">{{ displayTopic(topic.topic) }}</span>
          <span v-for="catKey in topicCategories(topic).slice(0, 2)" :key="catKey" class="tag category-tag" :class="'cat-' + catKey">{{ t('hotTopics.categories.' + catKey) }}</span>
          <span class="tag channel-tag">{{ t('hotTopics.channels.' + topic.channel) }}</span>
          <span
            v-if="sourceCount(topic) >= 2"
            class="tag multi-badge"
            data-testid="hot-topic-multi-badge"
            :title="t('hotTopics.multiBadgeTip', { sources: mergedNames(topic).join('、') })"
          >{{ t('hotTopics.multiBadge') }}</span>
          <span v-if="topic.trend === 'up'" class="trend-arrow trend-up" data-testid="hot-topic-trend-up" :title="t('hotTopics.trendUp')">↑</span>
          <span v-if="topic.trend === 'down'" class="trend-arrow trend-down" data-testid="hot-topic-trend-down" :title="t('hotTopics.trendDown')">↓</span>
          <span v-if="topic.trend === 'new'" class="tag trend-new" data-testid="hot-topic-trend-new">{{ t('hotTopics.trendNew') }}</span>
          <span v-if="topic.hotValue" class="hot-value">{{ formatHotValue(topic.hotValue) }}</span>
          <span class="update-time">{{ formatTime(topic.fetchedAt || lastRefresh) }}</span>
          <button
            class="cohere-btn-secondary item-fav-btn"
            :data-testid="'hot-topic-fav-' + topic.id"
            @click="toggleFavorite(topic)"
          >{{ isFavorited(topic.id) ? '♥' : '♡' }}</button>
          <button class="cohere-btn-secondary item-create-btn" @click="createCopySingle(topic)">
            {{ t('hotTopics.createCopy') }}
          </button>
          <button
            class="cohere-btn-secondary item-analyze-btn"
            :data-testid="'hot-topic-analyze-' + topic.id"
            @click="analyzeSingle(topic)"
          >{{ t('hotTopics.analyzeAction') }}</button>
          <button
            class="cohere-btn-primary item-gen-video-btn"
            :data-testid="'hot-topic-generate-video-' + topic.id"
            :disabled="genVideoBusy"
            @click="startGenerateVideo(topic)"
          >
            {{ t('hotTopics.generateVideo') }}
          </button>
        </div>
      </div>
    </div>

    <!-- 收藏选题 tab（独立组件减少 HotTopics.vue 行数） -->
    <HotTopicsFavorites
      :activeTab="activeTab"
      :favorites="favorites"
      :getTopicSummary="getTopicSummary"
      :displayTopic="displayTopic"
      :formatFavoritedAt="formatFavoritedAt"
      :formatHotValue="formatHotValue"
      :genVideoBusy="genVideoBusy"
      @remove-favorite="removeFavorite"
      @create-copy="createCopySingle"
      @generate-video="startGenerateVideo"
    />
    </div>

    <!-- 中央加载提示：首次进入无缓存 / 手动刷新时显示（非弹窗，全屏居中动态提示） -->
    <HotTopicsCentralLoading
      :visible="showCentralLoading"
      :title="t('hotTopics.refreshLoadingTitle')"
      :description="t('hotTopics.refreshLoadingDesc')"
    />

    <!-- 发布去向弹窗（复用采集页） -->
    <PublishDestinationModal
      :visible="showPublishModal"
      @close="showPublishModal = false"
      @publish-article="onPublishArticle"
      @publish-video="onPublishVideo"
    />

    <!-- 一键生成视频进度弹窗（复用视频创作页同款 UiModal + StageProgress UI） -->
    <UiModal
      :visible="genVideoModalOpen"
      :title="genVideoModalTitle"
      size="xl"
      width="960px"
      variant="progress"
      test-id="hot-topics-gen-video-modal"
      :close-on-overlay="false"
      :close-on-esc="false"
      @close="handleGenVideoClose"
    >
      <div class="gen-video-modal-content" data-testid="hot-topics-gen-video-content">
        <StageProgress
          v-if="genVideoStages.length"
          :stages="genVideoStages"
          :progress-percent="genVideoProgressPercent"
          :elapsed-ms="genVideoElapsedMs"
          :summary="genVideoSummary"
          :show-time-guidance="true"
        />
      </div>
      <template #footer>
        <span v-if="genVideoErrorText" class="gen-video-error-text" data-testid="hot-topics-gen-video-error">{{ genVideoErrorText }}</span>
        <button
          v-if="genVideoCanRetry"
          class="cohere-btn-primary"
          data-testid="hot-topics-gen-video-retry"
          @click="retryGenVideo"
        >{{ t('hotTopics.genVideoRetry') }}</button>
        <button
          v-if="genVideoCanBackground"
          class="cohere-btn-secondary"
          data-testid="hot-topics-gen-video-background"
          @click="detachGenVideoToBackground"
        >{{ t('hotTopics.genVideoBackgroundRun') }}</button>
        <button
          v-if="genVideoCanCancel"
          class="cohere-btn-secondary"
          data-testid="hot-topics-gen-video-cancel"
          @click="cancelGenVideo"
        >{{ t('hotTopics.genVideoCancel') }}</button>
        <button
          v-if="genVideoTerminal"
          class="cohere-btn-secondary"
          data-testid="hot-topics-gen-video-close"
          @click="closeGenVideoModal"
        >{{ t('hotTopics.genVideoClose') }}</button>
      </template>
    </UiModal>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { hotTopicsFetch, hotTopicsGetCache } from '@/api/hot-topics'
import { aiRewrite, draftSave } from '@/api/publisher'
import { useNotify } from '@/composables/useNotify'
import PublishDestinationModal from '@/components/PublishDestinationModal.vue'
import UiModal from '@/components/UiModal.vue'
import HotTopicsCentralLoading from '@/components/HotTopicsCentralLoading.vue'
import { StageProgress } from './video-creation'
import HotTopicsFavorites from '@/components/HotTopicsFavorites.vue'
import { useHotTopicsFavorites } from '@/composables/useHotTopicsFavorites'
import { useHotTopicsGenVideo } from '@/composables/useHotTopicsGenVideo'

const router = useRouter()
const { t } = useI18n()
const { notifyError, notifyInfo } = useNotify()

// ── 状态 ──
const topics = ref([])
const channelStats = ref({})
const loading = ref(false)
const showCentralLoading = ref(false) // 中央加载提示：首次无缓存抓取 / 手动刷新时显示
const lastRefresh = ref(0)
const activeCategory = ref('all')
const activeChannel = ref('all')
const selectedIds = ref(new Set())

// 标签页与收藏（逻辑抽到 composable）
const {
  activeTab, favorites,
  isFavorited, toggleFavorite, loadFavorites, removeFavorite,
  formatHotValue, getTopicSummary, formatFavoritedAt,
} = useHotTopicsFavorites()

// 发布流程
const showPublishModal = ref(false)
// 创作场景默认开爆款库（Q18=A）：无原文风格约束，模式注入纯增益；可在 UI 关闭
const hotUseViral = ref(true)
const publishing = ref(false)
const publishQueue = ref([])
const publishMode = ref('article') // article | video
const publishDone = ref(false)
const publishCancelled = ref(false)
let refreshTimer = null
let requestSeq = 0
let disposed = false // 组件卸载标记：in-flight 改写/草稿保存不再写回状态

// 一键生成视频（编排状态/计算/方法整体抽到 composable，与收藏逻辑同法）
const {
  genVideoModalOpen, genVideoBusy, genVideoStages, genVideoErrorText,
  genVideoModalTitle, genVideoProgressPercent, genVideoElapsedMs, genVideoSummary,
  genVideoTerminal, genVideoCanRetry, genVideoCanCancel, genVideoCanBackground,
  startGenerateVideo, retryGenVideo, cancelGenVideo, handleGenVideoClose, detachGenVideoToBackground,
  closeGenVideoModal, disposeGenVideo,
  // 以下四项只被单测断言编排内部态、不参与模板渲染，故下方 defineExpose 显式声明为组件契约
  genVideoPhase, genVideoRunId, genVideoTopic, mergeGenStages,
} = useHotTopicsGenVideo({ buildRewriteInput, hotUseViral, isDisposed: () => disposed })

defineExpose({ genVideoPhase, genVideoRunId, genVideoTopic, mergeGenStages })

// ── 常量 ──
const CATEGORY_KEYS = ['general', 'society', 'finance', 'tech', 'entertainment', 'sports', 'emotion', 'education', 'health', 'international']
// weibo 官方渠道成功时，tophub（同源微博榜）条目会被跨渠道去重合并到 weibo 名下——
// 下拉不再暴露 tophub 筛选，避免「显示有数据、切进去空列表」；服务层保留该渠道作微博数据兜底
const CHANNEL_KEYS = ['zhihu', 'toutiao', 'tencent', 'bilibili', 'douyin', 'baidu', 'weibo', 'sina_finance', 'ithome_tech']
const BATCH_LIMIT = 20
const TOPIC_PREFIX_KEY = 'hotTopics.topicPrefix'
const REFRESH_INTERVAL_MS = 30 * 60 * 1000

// ── 计算 ──
const categoryOptions = computed(() => [
  { value: 'all', label: t('hotTopics.categoryAll') },
  ...CATEGORY_KEYS.map(k => ({ value: k, label: t('hotTopics.categories.' + k) })),
])
const channelOptions = computed(() => CHANNEL_KEYS.map(k => ({ value: k, label: t('hotTopics.channels.' + k) })))

/** 多标签兼容：categories[] 优先，回退主分类（旧缓存条目无 categories） */
function topicCategories(x) {
  return (Array.isArray(x.categories) && x.categories.length) ? x.categories : [x.category || 'general']
}

// 分类计数 chip（方案E）：多标签口径，条目在每个关联分类下都计数
const categoryCounts = computed(() => {
  const counts = {}
  for (const x of topics.value) for (const c of topicCategories(x)) counts[c] = (counts[c] || 0) + 1
  return counts
})

// 空分类判定：全局有数据但当前分类过滤后为空 → 提供「补拉该分类」入口（方案E）
const categoryEmpty = computed(() => activeCategory.value !== 'all' && topics.value.length > 0 &&
  !topics.value.some(x => topicCategories(x).includes(activeCategory.value)))

const filteredTopics = computed(() => {
  const list = topics.value.filter(x =>
    (activeCategory.value === 'all' || topicCategories(x).includes(activeCategory.value)) &&
    (activeChannel.value === 'all' || x.channel === activeChannel.value),
  )
  // 分类/渠道切换后保持"分类内由热到冷"（P0）；Array.sort 稳定，缺 score 旧条目沉底且保持原序
  return list.slice().sort((a, b) => (typeof b.score === 'number' ? b.score : -1) - (typeof a.score === 'number' ? a.score : -1))
})

/** 多源信号（P3 兼容：旧缓存无 sourceCount 时回退 mergedFrom 长度 +1） */
function sourceCount(x) {
  if (typeof x.sourceCount === 'number' && x.sourceCount > 0) return x.sourceCount
  // 旧缓存回退：去重且排除主渠道自身（同渠道跨榜合并会把自己 push 进 mergedFrom，评审 m-2）
  return 1 + new Set((Array.isArray(x.mergedFrom) ? x.mergedFrom : []).filter((c) => c && c !== x.channel)).size
}
function mergedNames(x) {
  return (Array.isArray(x.mergedFrom) ? x.mergedFrom : []).map(c => t('hotTopics.channels.' + c))
}
/** badge 提示：有统一分时展示「来源第 N 名 · 综合热度 X」，旧数据回退渠道名次 */
function rankBadgeTitle(x) {
  if (typeof x.score === 'number') return t('hotTopics.heatScoreTip', { rank: x.rank, heat: Math.round(x.score * 100) })
  return t('hotTopics.sourceRank', { rank: x.rank })
}

const allFilteredSelected = computed(() =>
  filteredTopics.value.length > 0 && filteredTopics.value.every(x => selectedIds.value.has(x.id)),
)

const selectedCountText = computed(() => t('hotTopics.selectedCount', { count: selectedIds.value.size }))

const failedChannels = computed(() =>
  Object.entries(channelStats.value)
    .filter(([, s]) => s && s.error)
    .map(([id]) => t('hotTopics.channels.' + id)),
)

const partialFailText = computed(() => t('hotTopics.partialFail', { channels: failedChannels.value.join('、') }))

const lastRefreshText = computed(() =>
  lastRefresh.value > 0 ? t('hotTopics.lastRefresh', { time: formatTime(lastRefresh.value) }) : '',
)

const progressText = computed(() => {
  const done = publishQueue.value.filter(x => x.status === 'success' || x.status === 'failed').length
  return t('hotTopics.publishProgress', { done, total: publishQueue.value.length })
})
const progressPct = computed(() => {
  if (publishQueue.value.length === 0) return 0
  const done = publishQueue.value.filter(x => x.status === 'success' || x.status === 'failed').length
  return Math.round((done / publishQueue.value.length) * 100)
})
const publishDoneText = computed(() => {
  const ok = publishQueue.value.filter(x => x.status === 'success').length
  if (publishCancelled.value) return t('hotTopics.publishCancelled', { count: ok })
  return t('hotTopics.publishDone', { count: ok })
})

/** 是否有可发布的成功草稿（取消且零成功时隐藏去发布按钮） */
const hasSuccessfulDrafts = computed(() =>
  publishQueue.value.some(x => x.status === 'success' && x.draftId),
)

// ── 方法 ──
function formatTime(ts) {
  if (!ts) return ''
  const d = new Date(ts)
  const pad = n => String(n).padStart(2, '0')
  return pad(d.getHours()) + ':' + pad(d.getMinutes())
}

function displayTopic(topic) {
  return topic.length > 60 ? topic.slice(0, 60) + '…' : topic
}

function toggleSelect(id) {
  const s = new Set(selectedIds.value)
  if (s.has(id)) s.delete(id)
  else s.add(id)
  selectedIds.value = s
}

function toggleSelectAll() {
  if (allFilteredSelected.value) {
    selectedIds.value = new Set()
  } else {
    selectedIds.value = new Set(filteredTopics.value.map(x => x.id))
  }
}

/** 竞态守卫：刷新请求序号；background=true 后台静默刷新（不显示中央提示）；
 *  boostCategories=方案B 定向补拉的分类列表（空分类补拉按钮传入当前分类） */
async function refresh(force = false, { background = false, boostCategories = [] } = {}) {
  if (publishing.value) return
  if (loading.value) {
    // 已有抓取 in-flight：手动刷新复用当前请求仅补显中央提示；后台刷新静默返回
    if (!background) showCentralLoading.value = true
    return
  }
  const seq = ++requestSeq
  loading.value = true
  if (!background) showCentralLoading.value = true
  try {
    const res = await hotTopicsFetch(force, boostCategories)
    if (seq !== requestSeq) return // 旧响应丢弃
    if (res && res.code === 0 && res.data) {
      topics.value = Array.isArray(res.data.topics) ? res.data.topics : []
      channelStats.value = res.data.channelStats || {}
      lastRefresh.value = res.data.fetchedAt || Date.now()
      if (topics.value.length === 0 && failedChannels.value.length > 0) {
        notifyError('hotTopics.loadFailed')
      }
    } else {
      notifyError('hotTopics.loadFailed')
    }
  } catch (_) {
    if (seq === requestSeq) notifyError('hotTopics.loadFailed')
  } finally {
    if (seq === requestSeq) {
      loading.value = false
      showCentralLoading.value = false
    }
  }
}

/** 空分类「补拉该分类」：强制刷新 + 定向补拉当前分类垂类榜（方案E→B） */
function boostCurrentCategory() {
  if (activeCategory.value === 'all') return refresh(true)
  return refresh(true, { boostCategories: [activeCategory.value] })
}

/** SWR：缓存优先渲染——命中缓存立即显示并后台静默刷新；未命中走网络抓取（中央加载提示） */
async function loadFromCacheThenRefresh() {
  // 初始化值在 try/catch 两条路径都会被覆盖，故不写初值（eslint no-useless-assignment）
  let cached
  try {
    cached = await hotTopicsGetCache()
  } catch (_) { cached = null }
  if (disposed) return
  const data = cached && cached.code === 0 ? cached.data : null
  if (data && Array.isArray(data.topics) && data.topics.length > 0) {
    topics.value = data.topics
    channelStats.value = data.channelStats || {}
    lastRefresh.value = data.fetchedAt || 0
    refresh(false, { background: true }) // 后台刷新：不打断已渲染内容
  } else {
    refresh(false) // 无可用缓存：网络抓取 + 中央加载提示
  }
}

/** 构造改写输入：<20 字符补引导语（与 RewriteView ≥20 校验对齐） */
function buildRewriteInput(topicText) {
  const prefix = t(TOPIC_PREFIX_KEY)
  return topicText.length >= 20 ? topicText : prefix + '\n' + topicText
}

function createCopySingle(topic) {
  router.push('/rewrite?topic=' + encodeURIComponent(topic.topic))
}

// P2-c：热榜条目一键联动爆款分析——跳转并带入 topic，分析页预填但不自动发起
function analyzeSingle(topic) {
  const title = typeof topic?.topic === 'string' ? topic.topic.trim() : ''
  if (!title) return
  router.push({ path: '/viral-analysis', query: { topic: title.slice(0, 200) } })
}

function createCopyBatch() {
  const selected = filteredTopics.value.filter(x => selectedIds.value.has(x.id))
  if (selected.length === 0) {
    notifyInfo('hotTopics.noSelection')
    return
  }
  if (selected.length > BATCH_LIMIT) {
    notifyInfo('hotTopics.batchLimit')
    return
  }
  // 本期简化：批量创作 = 逐条跳转首条自动开始；session 队列消费属后续迭代（PRD 3.4 已注明）
  router.push('/rewrite?topic=' + encodeURIComponent(selected[0].topic))
}

function startPublish() {
  const selected = filteredTopics.value.filter(x => selectedIds.value.has(x.id))
  if (selected.length === 0) {
    notifyInfo('hotTopics.noSelection')
    return
  }
  if (selected.length > BATCH_LIMIT) {
    notifyInfo('hotTopics.batchLimit')
    return
  }
  showPublishModal.value = true
}

function onPublishArticle() {
  showPublishModal.value = false
  publishMode.value = 'article'
  startBatchRewrite()
}

function onPublishVideo(pipelineId) {
  showPublishModal.value = false
  publishMode.value = 'video'
  startBatchRewrite(pipelineId)
}

function startBatchRewrite(pipelineId) {
  const selected = filteredTopics.value.filter(x => selectedIds.value.has(x.id))
  publishQueue.value = selected.map(x => ({
    id: x.id, topic: x.topic, status: 'pending', draftId: null, pipelineId: pipelineId || null,
  }))
  publishing.value = true
  publishDone.value = false
  publishCancelled.value = false
  runQueue()
}

async function runQueue() {
  for (const item of publishQueue.value) {
    if (item.status !== 'pending') continue
    if (!publishing.value) break // 已取消
    item.status = 'rewriting'
    await rewriteOne(item)
  }
  publishing.value = false
  publishDone.value = true
}

async function rewriteOne(item) {
  try {
    const res = await aiRewrite({ mode: 'create', content: buildRewriteInput(item.topic), userSettings: { knowledgeOptions: { useViralLibrary: hotUseViral.value, usePersonalKnowledge: false } } })
    if (res && res.code === 0 && res.data && res.data.success) {
      const content = res.data.result || ''
      const draft = {
        id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        title: item.topic.slice(0, 64),
        content,
        source: 'hot-topics',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }
      const saved = await draftSave(draft)
      if (disposed) return // 已卸载：草稿已保存但不更新 UI 状态
      if (saved && saved.code === 0) {
        item.status = 'success'
        item.draftId = draft.id
        return
      }
      throw new Error('draft save failed')
    }
    throw new Error((res && res.message) || 'rewrite failed')
  } catch (e) {
    item.status = 'failed'
    item.error = (e && e.message) || ''
  }
}

async function retryPublishItem(item) {
  if (!publishing.value && !publishDone.value) return
  item.status = 'rewriting'
  await rewriteOne(item)
}

function cancelPublish() {
  publishing.value = false
  publishCancelled.value = true
  publishDone.value = true
}

/** 完成后返回批量操作条（重置发布状态，允许开始新一轮） */
function backToBatch() {
  publishDone.value = false
  publishCancelled.value = false
  publishQueue.value = []
  selectedIds.value = new Set()
}

function goToDestination() {
  const okItems = publishQueue.value.filter(x => x.status === 'success' && x.draftId)
  if (okItems.length === 0) return
  if (publishMode.value === 'video') {
    const last = okItems[okItems.length - 1]
    router.push({ path: '/create', query: { draft: last.draftId } })
  } else {
    router.push('/publish')
  }
}

// ── 生命周期 ──
onMounted(() => {
  loadFromCacheThenRefresh()
  loadFavorites()
  refreshTimer = setInterval(() => {
    if (document.hidden) return
    if (Date.now() - lastRefresh.value >= REFRESH_INTERVAL_MS) refresh(false, { background: true })
  }, 60 * 1000)
})

onUnmounted(() => {
  disposed = true
  if (refreshTimer) clearInterval(refreshTimer)
  requestSeq++ // 使 in-flight 响应失效
  loading.value = false // 防 KeepAlive/重挂载场景下陈旧加载态泄漏
  showCentralLoading.value = false
  publishing.value = false
  disposeGenVideo() // 停止轮询/订阅；主进程 run 不受影响（后台继续）
})
</script>

<style scoped src="./HotTopics.css"></style>
<style scoped src="../styles/hot-topics-list.css"></style>
