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
          >{{ cat.label }}</button>
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
        :title="t('hotTopics.emptyTitle')"
        :description="t('hotTopics.emptyDesc')"
        :action-text="t('hotTopics.emptyAction')"
        @action="refresh(true)"
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
          <span class="rank-badge" :title="t('hotTopics.sourceRank', { rank: topic.rank })">{{ viewIndex + 1 }}</span>
          <span class="topic-text" :title="getTopicSummary(topic)">{{ displayTopic(topic.topic) }}</span>
          <span class="tag category-tag" :class="'cat-' + topic.category">{{ t('hotTopics.categories.' + topic.category) }}</span>
          <span class="tag channel-tag">{{ t('hotTopics.channels.' + topic.channel) }}</span>
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
      @remove-favorite="removeFavorite"
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
import { aiRewrite, draftSave, storeGetSetting, pipelineStartOrchestrated, pipelineGetRunContext, pipelineCancelRun, onPipelineUpdate } from '@/api/publisher'
import { useNotify } from '@/composables/useNotify'
import PublishDestinationModal from '@/components/PublishDestinationModal.vue'
import UiModal from '@/components/UiModal.vue'
import HotTopicsCentralLoading from '@/components/HotTopicsCentralLoading.vue'
import { StageProgress } from './video-creation'
import { buildStory2VideoTextConfigFromSnapshot } from '@/story2video/s2v-config-snapshot'
import { STORY2VIDEO_STAGE_NAMES } from '@/domain/pipeline-constants'
import { getAppLocale } from '@/i18n'
import { showPipelineBackgroundToast } from '@/stores/pipeline-background-toast'
import HotTopicsFavorites from '@/components/HotTopicsFavorites.vue'
import { useHotTopicsFavorites } from '@/composables/useHotTopicsFavorites'

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

// ── 一键生成视频状态 ──
const genVideoModalOpen = ref(false)
const genVideoBusy = ref(false)
const genVideoTopic = ref(null)
const genVideoStages = ref([])
const genVideoRunId = ref(null)
const genVideoPhase = ref('idle') // idle | rewriting | starting | running | completed | failed | cancelled（后台脱离后复位为 idle，无 background 滞留态）
const genVideoErrorText = ref('')
const genVideoStartedAt = ref(0)
const genVideoRewrittenContent = ref('')
const genVideoDraftId = ref(null)
const genVideoRunProgress = ref(null)
let genVideoPollTimer = null
let genVideoUnsubscribe = null
let genVideoTickTimer = null
let genVideoSeq = 0
const GEN_VIDEO_TERMINAL_STAGE_STATUSES = new Set(['completed', 'skipped', 'failed', 'cancelled'])

// ── 常量 ──
const CATEGORY_KEYS = ['general', 'society', 'finance', 'tech', 'entertainment', 'sports', 'emotion', 'education', 'health', 'international']
// weibo 官方渠道成功时，tophub（同源微博榜）条目会被跨渠道去重合并到 weibo 名下——
// 下拉不再暴露 tophub 筛选，避免「显示有数据、切进去空列表」；服务层保留该渠道作微博数据兜底
const CHANNEL_KEYS = ['zhihu', 'toutiao', 'tencent', 'bilibili', 'douyin', 'baidu', 'weibo']
const BATCH_LIMIT = 20
const TOPIC_PREFIX_KEY = 'hotTopics.topicPrefix'
const REFRESH_INTERVAL_MS = 30 * 60 * 1000
const GEN_VIDEO_PIPELINE_NAME = 'story2video-compose'
const GEN_VIDEO_REWRITE_STAGE = 'rewrite_copy'
const GEN_VIDEO_STAGE_NAMES = Object.freeze([GEN_VIDEO_REWRITE_STAGE, ...STORY2VIDEO_STAGE_NAMES])
const GEN_VIDEO_POLL_INTERVAL_MS = 3000

// ── 计算 ──
const categoryOptions = computed(() => [
  { value: 'all', label: t('hotTopics.categoryAll') },
  ...CATEGORY_KEYS.map(k => ({ value: k, label: t('hotTopics.categories.' + k) })),
])
const channelOptions = computed(() => CHANNEL_KEYS.map(k => ({ value: k, label: t('hotTopics.channels.' + k) })))

const filteredTopics = computed(() => {
  return topics.value.filter(x =>
    (activeCategory.value === 'all' || x.category === activeCategory.value) &&
    (activeChannel.value === 'all' || x.channel === activeChannel.value),
  )
})

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

// ── 一键生成视频：计算属性 ──

/** 弹窗标题（选题名截断 30 字，避免标题过长） */
const genVideoModalTitle = computed(() => {
  const topic = genVideoTopic.value?.topic || ''
  const short = topic.length > 30 ? topic.slice(0, 30) + '…' : topic
  return t('hotTopics.genVideoTitle', { topic: short })
})

/** 总进度：按已完成阶段数估算；流水线 run progress 映射到当前阶段区间 */
const genVideoProgressPercent = computed(() => {
  const total = GEN_VIDEO_STAGE_NAMES.length
  if (genVideoPhase.value === 'completed') return 100
  const done = countCompletedGenStages()
  const base = (done / total) * 100
  if (genVideoPhase.value === 'rewriting' || genVideoPhase.value === 'starting') {
    return Math.min(99, Math.round(base))
  }
  const runPct = Number(genVideoRunProgress.value)
  if (Number.isFinite(runPct) && runPct >= 0) {
    return Math.min(99, Math.round(base + (Math.min(runPct, 100) / 100) * ((1 / total) * 100)))
  }
  return Math.min(99, Math.round(base))
})

const genVideoTick = ref(0)
const genVideoElapsedMs = computed(() => {
  void genVideoTick.value // 响应式依赖：1s tick 驱动 Date.now 重算（Date.now 非响应式源）
  return genVideoStartedAt.value > 0 ? Math.max(0, Date.now() - genVideoStartedAt.value) : null
})

const genVideoSummary = computed(() => {
  if (genVideoPhase.value === 'rewriting') return t('hotTopics.genVideoStartToast')
  return ''
})

const genVideoTerminal = computed(() =>
  ['completed', 'failed', 'cancelled'].includes(genVideoPhase.value),
)

const genVideoCanRetry = computed(() => genVideoPhase.value === 'failed')

const genVideoCanCancel = computed(() =>
  ['rewriting', 'starting', 'running'].includes(genVideoPhase.value),
)

/** 后台运行：仅流水线已真正启动（running 且持有 runId）时可脱离；
 * 改写/启动阶段还没有主进程 run，脱离无意义（spec 规则 2：方法内重校验状态）。 */
const genVideoCanBackground = computed(() =>
  genVideoPhase.value === 'running' && Boolean(genVideoRunId.value),
)

function countCompletedGenStages() {
  return genVideoStages.value.filter(s => s && s.status === 'completed').length
}

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

/** 竞态守卫：刷新请求序号；background=true 后台静默刷新（不显示中央提示） */
async function refresh(force = false, { background = false } = {}) {
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
    const res = await hotTopicsFetch(force)
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

// ── 一键生成视频：编排方法 ──

/** 初始化弹窗 stages：改写 pending + 流水线 7 阶段 pending */
function initGenVideoStages() {
  genVideoStages.value = GEN_VIDEO_STAGE_NAMES.map(name => ({
    id: name, name, status: 'pending', startedAt: null, completedAt: null, progress: null,
  }))
}

function setGenStage(name, patch) {
  const stage = genVideoStages.value.find(s => s.name === name)
  if (!stage) return
  Object.assign(stage, patch)
}

/** 入口：点击【生成视频】 */
async function startGenerateVideo(topic) {
  if (genVideoBusy.value || !topic?.topic) return
  genVideoTopic.value = topic
  genVideoRewrittenContent.value = ''
  genVideoDraftId.value = null
  genVideoRunId.value = null
  genVideoRunProgress.value = null
  genVideoErrorText.value = ''
  genVideoStartedAt.value = Date.now()
  genVideoSeq++
  initGenVideoStages()
  genVideoModalOpen.value = true
  await runGenVideoRewrite(genVideoSeq)
}

/** 阶段一：文案改写（aiRewrite mode=create）+ 存草稿 */
async function runGenVideoRewrite(seq) {
  const topic = genVideoTopic.value
  if (!topic || seq !== genVideoSeq) return
  genVideoPhase.value = 'rewriting'
  genVideoBusy.value = true
  setGenStage(GEN_VIDEO_REWRITE_STAGE, { status: 'running', startedAt: new Date().toISOString(), completedAt: null, error: null })
  try {
    const res = await aiRewrite({ mode: 'create', content: buildRewriteInput(topic.topic), userSettings: { knowledgeOptions: { useViralLibrary: hotUseViral.value, usePersonalKnowledge: false } } })
    if (disposed || seq !== genVideoSeq) return
    if (res && res.code === 0 && res.data && res.data.success) {
      const content = res.data.result || ''
      if (!content.trim()) throw new Error('empty rewrite result')
      genVideoRewrittenContent.value = content
      // 存草稿（失败不阻断视频生成——草稿只是回溯入口）
      const draft = {
        id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        title: topic.topic.slice(0, 64),
        content,
        source: 'hot-topics',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }
      try {
        const saved = await draftSave(draft)
        if (saved && saved.code === 0) genVideoDraftId.value = draft.id
      } catch (_) { /* 草稿保存失败不阻断 */ }
      if (disposed || seq !== genVideoSeq) return
      setGenStage(GEN_VIDEO_REWRITE_STAGE, { status: 'completed', completedAt: new Date().toISOString() })
      await runGenVideoPipelineStart(seq)
    } else {
      throw new Error((res && res.message) || (res?.data && res.data.error) || 'rewrite failed')
    }
  } catch (e) {
    if (disposed || seq !== genVideoSeq) return
    setGenStage(GEN_VIDEO_REWRITE_STAGE, { status: 'failed', error: (e && e.message) || '', completedAt: new Date().toISOString() })
    genVideoPhase.value = 'failed'
    genVideoErrorText.value = t('hotTopics.genVideoRewriteFailed')
    genVideoBusy.value = false
  }
}

/** 阶段二：读取默认选项并启动故事讲述流水线 */
async function runGenVideoPipelineStart(seq) {
  if (seq !== genVideoSeq) return
  genVideoPhase.value = 'starting'
  setGenStage('split', { status: 'running', startedAt: new Date().toISOString() })
  try {
    // 读取用户保存的默认选项（owner-scoped SQLite；缺失回退内置默认）
    let snapshot = null
    try {
      snapshot = await storeGetSetting('story2video.lastOptions.v1')
    } catch (_) { snapshot = null }
    if (disposed || seq !== genVideoSeq) return
    const text = genVideoRewrittenContent.value
    const story2videoTextConfig = buildStory2VideoTextConfigFromSnapshot(text, snapshot)
    const params = {
      text,
      inputMode: 'text',
      checkpointPolicy: 'none',
      autoAdvance: true,
      background: true,
      uiLocale: getAppLocale(),
      story2videoTextConfig,
    }
    const res = await pipelineStartOrchestrated(GEN_VIDEO_PIPELINE_NAME, params)
    if (disposed || seq !== genVideoSeq) return
    const outcome = res?.data
    if (res?.code === 0 && typeof outcome?.runId === 'string' && outcome.runId.trim() && outcome.success !== false) {
      genVideoRunId.value = outcome.runId.trim()
      genVideoPhase.value = 'running'
      // 用启动返回的 stages 初始化流水线部分（保留改写 completed 状态）
      if (Array.isArray(outcome.stages) && outcome.stages.length > 0) {
        mergeGenStages(outcome.stages)
      }
      startGenVideoTracking()
    } else {
      throw new Error((res && res.message) || (outcome && outcome.error) || 'pipeline start failed')
    }
  } catch (e) {
    if (disposed || seq !== genVideoSeq) return
    // 流水线启动失败：改写已完成保留；流水线首阶段标 failed
    setGenStage('split', { status: 'failed', error: (e && e.message) || '', completedAt: new Date().toISOString() })
    genVideoPhase.value = 'failed'
    genVideoErrorText.value = t('hotTopics.genVideoPipelineFailed')
    genVideoBusy.value = false
  }
}

/** 合并流水线 stages 到弹窗 stages（保留改写阶段） */
function mergeGenStages(incomingStages) {
  if (!Array.isArray(incomingStages)) return
  for (const inc of incomingStages) {
    if (!inc || typeof inc.name !== 'string') continue
    const target = genVideoStages.value.find(s => s.name === inc.name)
    if (target) {
      // 终态守卫：已 completed/skipped/failed/cancelled 的阶段不被乱序推送降级回 running
      const nextStatus = GEN_VIDEO_TERMINAL_STAGE_STATUSES.has(target.status)
        ? target.status
        : (inc.status || target.status)
      Object.assign(target, {
        status: nextStatus,
        startedAt: inc.startedAt || target.startedAt,
        completedAt: inc.completedAt || target.completedAt,
        error: inc.error ?? target.error,
        progress: inc.progress ?? target.progress,
      })
    }
  }
}

/** 启动双通道跟踪：onPipelineUpdate 实时推送 + 3s 轮询兜底 */
function startGenVideoTracking() {
  stopGenVideoTracking()
  const runId = genVideoRunId.value
  if (!runId) return
  genVideoUnsubscribe = onPipelineUpdate(snapshot => handleGenVideoPush(snapshot))
  genVideoPollTimer = setInterval(() => pollGenVideoRun(runId), GEN_VIDEO_POLL_INTERVAL_MS)
  genVideoTickTimer = setInterval(() => { genVideoTick.value++ }, 1000)
  void pollGenVideoRun(runId)
}

function stopGenVideoTracking() {
  if (genVideoPollTimer) { clearInterval(genVideoPollTimer); genVideoPollTimer = null }
  if (genVideoUnsubscribe) { try { genVideoUnsubscribe() } catch (_) { /* 取消订阅失败无害，静默忽略 */ } genVideoUnsubscribe = null }
  if (genVideoTickTimer) { clearInterval(genVideoTickTimer); genVideoTickTimer = null }
}

/** 实时推送处理（runId 快照守卫） */
function handleGenVideoPush(snapshot) {
  if (disposed || !snapshot || typeof snapshot !== 'object') return
  const runId = genVideoRunId.value
  if (!runId || snapshot.runId !== runId) return
  const status = snapshot.status && typeof snapshot.status === 'object' ? snapshot.status : null
  if (Array.isArray(snapshot.stages)) mergeGenStages(snapshot.stages)
  else if (status && Array.isArray(status.stages)) mergeGenStages(status.stages)
  if (status && Number.isFinite(Number(status.progress))) genVideoRunProgress.value = Number(status.progress)
  const finalStatus = status?.status || snapshot.status
  if (typeof finalStatus === 'string' && ['completed', 'failed', 'cancelled'].includes(finalStatus)) {
    void pollGenVideoRun(runId, true)
  }
}

/** 轮询全量 run context（终态判定与 videoPath 提取的唯一权威来源） */
async function pollGenVideoRun(runId, force = false) {
  if (disposed || genVideoRunId.value !== runId) return
  try {
    const res = await pipelineGetRunContext(runId)
    if (disposed || genVideoRunId.value !== runId) return
    if (res?.code !== 0 || !res.data) return
    const returnedRunId = res.data.runId || res.data.id
    if (typeof returnedRunId === 'string' && returnedRunId.trim() && returnedRunId.trim() !== runId) return
    const status = res.data.status && typeof res.data.status === 'object' ? res.data.status : null
    const stages = Array.isArray(res.data.stages) ? res.data.stages : (status ? status.stages : null)
    if (Array.isArray(stages)) mergeGenStages(stages)
    if (status && Number.isFinite(Number(status.progress))) genVideoRunProgress.value = Number(status.progress)
    const runStatus = status?.status || res.data.status
    if (runStatus === 'completed') {
      finishGenVideoCompleted(res.data)
    } else if (runStatus === 'failed' || runStatus === 'cancelled') {
      finishGenVideoTerminal(runStatus, res.data)
    } else if (force && runStatus && !['running', 'paused'].includes(runStatus)) {
      finishGenVideoTerminal(runStatus, res.data)
    }
  } catch (_) { /* 轮询失败等下一轮 */ }
}

/** 完成：提取 videoPath 跳结果页 */
function finishGenVideoCompleted(data) {
  const context = data?.context && typeof data.context === 'object' ? data.context : null
  const publish = context?.publish?.data || context?.publish
  const compose = context?.compose?.data || context?.compose
  const videoPath = publish?.videoPath || publish?.path || compose?.videoPath || compose?.path || null
  stopGenVideoTracking()
  for (const s of genVideoStages.value) {
    if (s.status !== 'completed' && s.status !== 'skipped') s.status = 'completed'
  }
  genVideoPhase.value = 'completed'
  genVideoBusy.value = false
  if (videoPath) {
    const query = { path: videoPath }
    if (data?.context?.story2videoProject?.projectId) query.project = data.context.story2videoProject.projectId
    if (genVideoRunId.value) query.runId = genVideoRunId.value
    genVideoModalOpen.value = false
    router.push({ path: '/create/result', query })
  } else {
    genVideoPhase.value = 'failed'
    genVideoErrorText.value = t('hotTopics.genVideoPipelineFailed')
  }
}

/** 终态：failed / cancelled */
function finishGenVideoTerminal(status, data) {
  stopGenVideoTracking()
  const failedStage = genVideoStages.value.find(s => s.status === 'running' || s.status === 'failed')
  if (failedStage && status === 'failed') {
    failedStage.status = 'failed'
    if (!failedStage.error && data?.error) failedStage.error = String(data.error)
  }
  for (const s of genVideoStages.value) {
    if (s.status === 'running' || s.status === 'paused') s.status = status === 'cancelled' ? 'cancelled' : 'failed'
    else if (s.status === 'pending') s.status = 'cancelled'
  }
  genVideoPhase.value = status === 'cancelled' ? 'cancelled' : 'failed'
  genVideoErrorText.value = status === 'cancelled' ? t('hotTopics.genVideoCancelled') : t('hotTopics.genVideoPipelineFailed')
  genVideoBusy.value = false
}

/** 重试：改写已成功则从流水线启动开始；否则从改写开始 */
async function retryGenVideo() {
  if (genVideoPhase.value !== 'failed') return
  genVideoSeq++
  const seq = genVideoSeq
  genVideoBusy.value = true
  genVideoErrorText.value = ''
  genVideoRunId.value = null
  genVideoRunProgress.value = null
  genVideoStartedAt.value = Date.now()
  // 重置流水线阶段为 pending（保留改写阶段状态决定重试起点）
  for (const s of genVideoStages.value) {
    if (s.name !== GEN_VIDEO_REWRITE_STAGE) {
      Object.assign(s, { status: 'pending', startedAt: null, completedAt: null, error: null, progress: null })
    }
  }
  if (genVideoRewrittenContent.value) {
    // 改写产物已缓存：直接重试流水线启动
    await runGenVideoPipelineStart(seq)
  } else {
    setGenStage(GEN_VIDEO_REWRITE_STAGE, { status: 'pending', error: null })
    await runGenVideoRewrite(seq)
  }
}

/** 取消：改写/启动阶段 = 中止前端编排；流水线运行 = 调用 pipelineCancel（当前 run） */
async function cancelGenVideo() {
  if (!genVideoCanCancel.value) return
  genVideoSeq++
  const phase = genVideoPhase.value
  if (phase === 'running' && genVideoRunId.value) {
    stopGenVideoTracking()
    try {
      await pipelineCancelRun(genVideoRunId.value)
    } catch (_) { /* 取消失败也按前端取消处理 */ }
  } else {
    stopGenVideoTracking()
  }
  for (const s of genVideoStages.value) {
    if (s.status === 'running' || s.status === 'pending' || s.status === 'paused') s.status = 'cancelled'
  }
  genVideoPhase.value = 'cancelled'
  genVideoErrorText.value = t('hotTopics.genVideoCancelled')
  genVideoBusy.value = false
}

/** 前端跟踪态复位（唯一公共路径）：停跟踪 + 清空本次编排前端态 + 释放 busy。
 *  主进程 run 不受影响；必须释放 busy 以支持多任务并行（否则脱离后按钮永久禁用，PRD §6.7）。 */
function resetGenVideoFrontendState() {
  genVideoSeq++ // 使在途改写/启动响应失效，避免脱离后旧响应重新挂回弹窗
  stopGenVideoTracking()
  genVideoModalOpen.value = false
  genVideoPhase.value = 'idle'
  genVideoTopic.value = null
  genVideoStages.value = []
  genVideoRunId.value = null
  genVideoRunProgress.value = null
  genVideoStartedAt.value = 0
  genVideoErrorText.value = ''
  genVideoRewrittenContent.value = ''
  genVideoDraftId.value = null
  genVideoBusy.value = false
}

/** 弹窗关闭（右上角 × / 遮罩 / ESC 统一入口）：运行中（有 runId）= 后台运行；
 *  改写/启动（无 run）= 中止前端编排；终态 = 直接复位关闭。 */
function handleGenVideoClose() {
  if (genVideoTerminal.value) {
    resetGenVideoFrontendState()
    return
  }
  const detached = genVideoCanBackground.value
  resetGenVideoFrontendState()
  if (detached) notifyInfo('hotTopics.genVideoBackgroundHint')
}

/** 显式【后台运行】按钮：与右上角 × 同一后台语义（复用唯一公共脱离路径），
 * 额外触发全局居中提示（2026-09-12 需求：所有视频流水线弹窗统一提供该按钮）。 */
function detachGenVideoToBackground() {
  if (!genVideoCanBackground.value) return
  handleGenVideoClose()
  showPipelineBackgroundToast()
}

/** footer【关闭】按钮（仅终态显示）：语义别名，复用唯一复位路径。 */
const closeGenVideoModal = resetGenVideoFrontendState

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
  genVideoSeq++
  stopGenVideoTracking() // 停止轮询/订阅；主进程 run 不受影响（后台继续）
})
</script>

<style scoped src="./HotTopics.css"></style>
