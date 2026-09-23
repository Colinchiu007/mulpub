<template>
  <div class="history-page">
    <div class="page-header">
      <h1>创作历史</h1>
      <p class="text-muted">查看已渲染的视频和流水线运行记录</p>
    </div>

    <div class="page-tabs">
      <button :class="['tab s2v-btn-ghost', { active: tab === 'renders' }]" @click="tab = 'renders'">渲染记录</button>
      <button :class="['tab s2v-btn-ghost', { active: tab === 'pipelines' }]" @click="tab = 'pipelines'; loadPipelines()">流水线记录</button>
    </div>

    <!-- 渲染记录 -->
    <div v-if="tab === 'renders'">
      <div
        v-if="runningPipelineCount > 0 || failedOrCancelledPipelineCount > 0"
        class="running-banner"
        role="button"
        tabindex="0"
        @click="showRunningPipelines"
        @keydown.enter="showRunningPipelines"
      >
        <span>
          有 {{ runningPipelineCount + failedOrCancelledPipelineCount }} 条流水线记录（
          {{ runningPipelineCount > 0 ? runningPipelineCount + ' 条运行中、' : '' }}{{ failedOrCancelledPipelineCount }} 条失败或已取消
          ），点击查看「流水线记录」
        </span>
      </div>
      <div v-if="renderLoading" class="loading-state" data-testid="render-history-loading">
        <UiSkeleton variant="list" :count="4" />
      </div>
      <div v-else>
        <div v-if="renderError" class="history-error"><p>{{ renderError }}</p><UiButton size="sm" @click="loadRenders">重试</UiButton></div>
        <EmptyState v-if="renders.length === 0" icon="VideoCamera" :title="$t('emptyStates.createHistoryRenders.title')" :description="$t('emptyStates.createHistoryRenders.message')">
          <template #actions>
            <UiButton @click="$router.push('/create')">去创作</UiButton>
          </template>
        </EmptyState>
        <div v-else class="render-list">
          <div v-for="(r, i) in renders" :key="i" class="render-card" tabindex="0" role="button" @keydown.enter="$router.push('/create/result?path=' + encodeURIComponent(r.outputPath || ''))" @click="$router.push('/create/result?path=' + encodeURIComponent(r.outputPath || ''))">
            <div class="render-info">
              <span class="render-icon"><el-icon><VideoCamera /></el-icon></span>
              <div class="render-meta">
                <span class="render-name">{{ r.composition || r.name || '视频 ' + (i + 1) }}</span>
                <span class="render-time">{{ formatTime(r.completedAt || r.createdAt) }}</span>
              </div>
            </div>
            <div class="render-status" :class="r.status || 'completed'">{{ statusLabel(r.status) }}</div>
            <div class="render-actions">
              <UiButton size="sm" @click.stop="$router.push('/publish')">发布</UiButton>
              <UiButton size="sm" variant="ghost" @click.stop="$router.push('/create/result?path=' + encodeURIComponent(r.outputPath || ''))">预览</UiButton>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 流水线记录 -->
    <div v-if="tab === 'pipelines'">
      <div v-if="pipelineLoading" class="loading-state" data-testid="pipeline-history-loading">
        <UiSkeleton variant="list" :count="4" />
      </div>
      <div v-else>
        <div v-if="pipelineError" class="history-error pipeline-history-error"><p>{{ pipelineError }}</p><UiButton size="sm" @click="loadPipelines">重试</UiButton></div>
        <EmptyState v-if="pipelines.length === 0" icon="🔄" title="暂无流水线运行记录" description="选择创作模式开始流水线，运行记录将在这里显示">
          <template #actions>
            <UiButton @click="$router.push('/create')">浏览流水线</UiButton>
          </template>
        </EmptyState>
        <div v-else class="pipeline-list">
          <div v-for="(p, i) in pipelines" :key="i" class="pipeline-card" :class="p.status" tabindex="0" role="button" @keydown.enter="openPipeline(p)" @click="openPipeline(p)">
            <div class="pipeline-info">
              <span class="pipeline-status-dot" :class="p.status"></span>
              <div class="pipeline-meta">
                <span class="pipeline-name">{{ humanName(p.pipelineName || p.name) }}</span>
                <span class="pipeline-time">{{ formatTime(p.completedAt || p.startedAt || p.createdAt) }}</span>
              </div>
            </div>
            <span class="pipeline-status" :class="p.status">{{ statusLabel(p.status) }}</span>
            <div v-if="p.status === 'running'" class="pipeline-progress">
              <div class="progress-bar"><div class="progress-fill" :style="{ width: pipelineProgress(p) + '%' }"></div></div>
              <span class="progress-text">{{ pipelineProgress(p) }}%</span>
            </div>
            <div class="pipeline-card-bottom">
              <div class="pipeline-stages">
                <span v-for="(s, si) in (p.stages || [])" :key="si" class="stage-tag" :class="stageClass(s)" :title="stageTitle(s)">
                  {{ stageLabel(s) }}
                </span>
              </div>
              <div class="pipeline-hints">
                <span v-if="p.status === 'running'" class="pipeline-running-hint">与流水线页面实时同步</span>
                <span v-if="p.status === 'paused' && p.pausedStage" class="pipeline-paused-hint">暂停环节：{{ stageLabel(p.pausedStage) }}</span>
                <span v-if="p.status === 'failed'" class="pipeline-paused-hint" style="background:var(--status-failed-bg);color:var(--status-failed-text);">生成失败</span>
                <span v-if="p.status === 'interrupted' && p.pausedStage" class="pipeline-paused-hint history-interrupted-hint">{{ interruptedStageText() }} · {{ stageLabel(p.pausedStage) }}</span>
                <span v-else-if="p.status === 'interrupted'" class="pipeline-paused-hint history-interrupted-hint">{{ interruptedHintText() }}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import { VideoCamera } from '@element-plus/icons-vue'
import '@/styles/history-page.css'
import { pipelineHistory } from '@/api/publisher'
import UiButton from '../components/UiButton.vue'
import { formatUserError } from '../utils/user-facing-error'

const HISTORY_LOAD_TIMEOUT_MS = 5000

function settleHistoryRequest (request) {
  let timeoutId
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(Object.assign(new Error('历史记录加载超时'), { code: 'HISTORY_LOAD_TIMEOUT' })), HISTORY_LOAD_TIMEOUT_MS)
  })
  return Promise.race([Promise.resolve().then(request), timeout]).finally(() => clearTimeout(timeoutId))
}
export default {
  
  components: { UiButton },
  data() {
    return {
      tab: 'renders',
      renders: [],
      renderLoading: true,
      renderError: '',
      renderRequestId: 0,
      pipelines: [],
      pipelineLoading: false,
      pipelineError: '',
      pipelineRequestId: 0,
      pipelinePollTimer: null,
    }
  },
  async mounted() {
    await this.loadRenders()
    // 同时加载流水线记录：存在运行中/失败/已取消流水线时默认展示流水线记录，
    // 避免用户进入历史页后以为失败/取消任务「消失」（默认 tab 是渲染记录，只含成功渲染项目）。
    await this.loadPipelines()
    if ((this.runningPipelineCount > 0 || this.failedOrCancelledPipelineCount > 0) && this.tab === 'renders') {
      this.tab = 'pipelines'
    }
  },
  computed: {
    runningPipelineCount() {
      return (this.pipelines || []).filter((p) => p && p.status === 'running').length
    },
    failedOrCancelledPipelineCount() {
      return (this.pipelines || []).filter((p) => p && (p.status === 'failed' || p.status === 'cancelled')).length
    },
  },
  methods: {
    showRunningPipelines() {
      this.tab = 'pipelines'
      this.loadPipelines()
    },
    async loadRenders() {
      const requestId = ++this.renderRequestId
      this.renderLoading = true
      this.renderError = ''
      try {
        const res = await settleHistoryRequest(async () => {
          const { storeListPublishHistory } = await import('@/api/publisher')
          return storeListPublishHistory({ limit: 50, type: 'render' })
        })
        if (requestId !== this.renderRequestId) return
        if (res?.code === 0) this.renders = res?.data?.records || []
        else this.renderError = formatUserError(res, { fallback: '渲染记录加载失败，请重试' }).message
      } catch (e) {
        if (requestId !== this.renderRequestId) return
        this.renderError = e?.code === 'HISTORY_LOAD_TIMEOUT' ? '渲染记录加载超时，请重试' : '渲染记录加载失败，请重试'
      } finally {
        if (requestId === this.renderRequestId) this.renderLoading = false
      }
    },
    async loadPipelines() {
      const requestId = ++this.pipelineRequestId
      this.pipelineLoading = true
      this.pipelineError = ''
      try {
        const r = await settleHistoryRequest(() => pipelineHistory())
        if (requestId !== this.pipelineRequestId) return
        if (r?.code === 0 && Array.isArray(r.data)) this.pipelines = r.data
        else this.pipelineError = formatUserError(r, { fallback: '流水线记录加载失败，请重试' }).message
      // stale running 检测：updatedAt 超过 30 分钟仍为 running 的任务视为已中断（超时/崩溃遗留）
      const STALE_RUNNING_THRESHOLD_MS = 30 * 60 * 1000
      const now = Date.now()
      for (const p of this.pipelines) {
        if (p && p.status === 'running') {
          const updatedAt = p.updatedAt ? new Date(p.updatedAt).getTime() : 0
          if (updatedAt && (now - updatedAt) > STALE_RUNNING_THRESHOLD_MS) {
            p._originalStatus = p.status
            p.status = 'interrupted'
            if (!p.pausedStage) {
              const stages = Array.isArray(p.stages) ? p.stages : []
              const runningStage = stages.find(s => s && s.status === 'running') || stages[stages.length - 1]
              p.pausedStage = runningStage ? (runningStage.name || runningStage.stage || '') : ''
            }
          }
        }
      }
          } catch (e) {    if (requestId !== this.pipelineRequestId) return
        this.pipelineError = e?.code === 'HISTORY_LOAD_TIMEOUT' ? '流水线记录加载超时，请重试' : '流水线记录加载失败，请重试'
      } finally {
        if (requestId === this.pipelineRequestId) {
          this.pipelineLoading = false
          this.schedulePipelineRefresh()
        }
      }
    },
    schedulePipelineRefresh() {
      if (this.pipelinePollTimer) { clearInterval(this.pipelinePollTimer); this.pipelinePollTimer = null }
      const hasRunning = (this.pipelines || []).some((p) => p && p.status === 'running')
      if (!hasRunning) return
      // 存在后台运行中的流水线：每 5s 轮询刷新进度状态（同流水线页面一致）
      this.pipelinePollTimer = setInterval(() => { this.loadPipelines() }, 5000)
    },
    openPipeline(p) {
      if (!p) return
      if (p.status === 'running' || p.status === 'failed' || p.status === 'cancelled' || p.status === 'paused' || p.status === 'interrupted') {
        // 运行中/失败/已取消：跳回创作页，CreateView 恢复查看该流水线进度/支持断点继续
        this.$router.push('/create')
        return
      }
      if (p.status === 'completed') {
        const context = p.context || {}
        const composeRaw = context.compose?.data || context.compose
        const exportRaw = context.export?.data || context.export
        const reportRaw = context.report?.data || context.report
        const videoPath = (composeRaw && (composeRaw.videoPath || composeRaw.path)) ||
          (exportRaw && (exportRaw.videoPath || exportRaw.path)) ||
          (reportRaw && (reportRaw.videoPath || reportRaw.path))
        this.$router.push('/create/result?path=' + encodeURIComponent(videoPath || ''))
      }
    },
    statusLabel(s) {
      const labels = { completed: '已完成', running: '运行中', failed: '生成失败', cancelled: '已取消', paused: '已暂停', interrupted: this.interruptedStatusLabel() }
      return labels[s] || s || '已完成'
    },
    interruptedStatusLabel() {
      const key = 'create.history.statuses.interrupted'
      const translated = typeof this.$t === 'function' ? this.$t(key) : null
      return translated || 'Interrupted'
    },
    stageClass(s) {
      if (s && typeof s === 'object') return s.status || ''
      return ''
    },
    interruptedStageText() {
      const key = 'stageProgress.interruptedStage'
      const translated = typeof this.$t === 'function' ? this.$t(key) : key
      return (typeof translated === 'string' && translated !== key) ? translated : 'Interrupted stage'
    },
    interruptedHintText() {
      const key = 'stageProgress.interruptedHint'
      const translated = typeof this.$t === 'function' ? this.$t(key) : key
      return (typeof translated === 'string' && translated !== key) ? translated : 'The task was interrupted by an app exit or crash. Resume from the breakpoint to continue.'
    },
    stageLabel(s) {
      const name = this.shortName(typeof s === 'string' ? s : (s?.name || s?.stage || ''))
      if (!s || typeof s !== 'object') return name
      const marks = { completed: '✓', skipped: '⏭', running: '⟳', failed: '✕', cancelled: '—', pending: '' }
      return (marks[s.status] ? marks[s.status] + ' ' : '') + name
    },
    stageTitle(s) {
      if (!s || typeof s !== 'object') return ''
      const statusText = { completed: '已完成', running: '进行中', failed: '失败', cancelled: '已取消', pending: '等待中', paused: '已暂停' }[s.status] || s.status || ''
      const progress = typeof s.progress === 'number' ? '（' + s.progress + '%）' : ''
      return statusText + progress
    },
    pipelineProgress(p) {
      if (!p) return 0
      if (typeof p.progress === 'number' && Number.isFinite(p.progress)) return Math.max(0, Math.min(100, Math.round(p.progress)))
      const stages = Array.isArray(p.stages) ? p.stages : []
      if (stages.length === 0) return 0
      const done = stages.filter((s) => s && typeof s === 'object' && ['completed', 'skipped', 'failed', 'cancelled'].includes(s.status)).length
      return Math.round((done / stages.length) * 100)
    },
    shortName(name) {
      if (!name) return ''
      return name.length > 10 ? name.substring(0, 10) + '...' : name
    },
    humanName(name) {
      if (!name) return ''
      return name.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
    },
    formatTime(iso) {
      if (!iso) return ''
      try { return new Date(iso).toLocaleString('zh-CN') } catch (e) { return iso }
    },
  },
  beforeUnmount() {
    if (this.pipelinePollTimer) { clearInterval(this.pipelinePollTimer); this.pipelinePollTimer = null }
  },
}
</script>


