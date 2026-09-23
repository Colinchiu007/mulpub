<template>
  <div>
    <div class="cohere-page-header">
      <div>
        <div class="page-title">{{ $t('autoPipeline.title') }}</div>
        <div class="page-subtitle">{{ $t('autoPipeline.subtitle') }}</div>
      </div>
    </div>

    <div class="cohere-content">
      <!-- 配置面板 -->
      <div class="cohere-card ap-card-panel">
        <div class="cohere-section-title">{{ $t('autoPipeline.configTitle') }}</div>

        <!-- 内容类型 -->
        <div class="ap-field-row">
          <span class="ap-label-strong ap-label-strong--gap">{{ $t('autoPipeline.contentType') }}：</span>
          <label class="ap-check-label ap-check-label--gap">
            <input type="radio" v-model="config.contentType" value="video" /> {{ $t('autoPipeline.videoPublish') }}
          </label>
          <label class="ap-check-label">
            <input type="radio" v-model="config.contentType" value="article" /> {{ $t('autoPipeline.articlePublish') }}
          </label>
        </div>

        <!-- 采集方式 -->
        <div class="ap-field-row">
          <span class="ap-label-strong ap-label-strong--gap">{{ $t('autoPipeline.sourceType') }}：</span>
          <select v-model="config.sourceType" class="ap-select">
            <option value="url">{{ $t('autoPipeline.singleUrl') }}</option>
            <option value="rss">{{ $t('autoPipeline.rssSource') }}</option>
            <option value="batch">{{ $t('autoPipeline.urlList') }}</option>
          </select>
        </div>

        <!-- URL 输入 -->
        <div v-if="config.sourceType === 'url'" class="ap-field-row">
          <input
            v-model="urlInput"
            :placeholder="$t('autoPipeline.urlPlaceholder')"
            class="ap-input"
            @keyup.enter="addUrl"
          />
          <button class="cohere-btn-secondary ap-btn-sm" @click="addUrl">{{ $t('autoPipeline.addUrl') }}</button>
          <div v-if="config.urls.length > 0" class="ap-url-count">
            {{ $t('autoPipeline.urlCount', { count: config.urls.length }) }}：
            <span v-for="(u, i) in config.urls" :key="i" class="ap-url-chip">
              {{ u.slice(0, 50) }}{{ u.length > 50 ? '...' : '' }}
              <span @click="removeUrl(i)" class="ap-url-remove">×</span>
            </span>
          </div>
        </div>

        <!-- URL 列表 / RSS -->
        <div v-else class="ap-field-row">
          <textarea
            v-model="urlListInput"
            :placeholder="config.sourceType === 'rss' ? $t('autoPipeline.rssPlaceholder') : $t('autoPipeline.listPlaceholder')"
            rows="4"
            class="ap-textarea"
          ></textarea>
          <div class="ap-hint">
            {{ config.sourceType === 'rss' ? $t('autoPipeline.rssHint') : $t('autoPipeline.listHint') }}
          </div>
        </div>

        <!-- 改写设置 -->
        <div class="ap-row-flex">
          <span class="ap-label-strong">{{ $t('autoPipeline.rewriteConfig') }}：</span>
          <select v-model="config.rewriteStyle" class="ap-select">
            <option v-for="s in rewriteStyles" :key="s.value" :value="s.value">{{ s.label }}</option>
          </select>
          <select v-model="config.rewriteLength" class="ap-select">
            <option v-for="l in rewriteLengths" :key="l.value" :value="l.value">{{ l.label }}</option>
          </select>
        </div>

        <!-- 发布设置 -->
        <div class="ap-row-flex">
          <span class="ap-label-strong">{{ $t('autoPipeline.publishConfig') }}：</span>
          <label class="ap-check-label">
            <input type="checkbox" v-model="config.publishAllAccounts" /> {{ $t('autoPipeline.publishAll') }}
          </label>
          <span class="ap-hint ap-hint--plain">
            {{ $t('autoPipeline.accountsDetected', { count: accountCount }) }}
          </span>
          <button class="cohere-btn-secondary ap-btn-sm" @click="refreshAccounts" :disabled="loadingAccounts">
            {{ loadingAccounts ? $t('autoPipeline.loadingAccounts') : $t('autoPipeline.refreshAccounts') }}
          </button>
        </div>

        <!-- 启动按钮 -->
        <div class="ap-start-row">
          <button
            class="cohere-btn-primary ap-btn-start"
            @click="startPipeline"
            :disabled="running || !canStart"
          >
            {{ running ? $t('autoPipeline.running') : $t('autoPipeline.start') }}
          </button>
          <button v-if="running" class="cohere-btn-secondary ap-btn-cancel" @click="cancelPipeline">
            {{ $t('autoPipeline.cancel') }}
          </button>
        </div>

        <div v-if="startError" class="ap-error-banner">
          {{ startError }}
        </div>
      </div>

      <!-- 执行进度 -->
      <div v-if="currentRun" class="cohere-card ap-card-panel">
        <div class="cohere-section-title">{{ $t('autoPipeline.progressTitle') }}</div>

        <!-- 总进度条 -->
        <div class="ap-progress-wrap">
          <div class="ap-progress-head">
            <span>{{ $t('autoPipeline.totalProgress') }}</span>
            <span>{{ currentRun.progress }}%</span>
          </div>
          <div class="ap-progress-track">
            <div
              class="ap-progress-fill"
              :style="{ width: currentRun.progress + '%', background: currentRun.status === 'completed' ? 'var(--color-success)' : currentRun.status === 'failed' ? 'var(--color-danger)' : 'var(--color-primary)' }"
            ></div>
          </div>
        </div>

        <!-- 各阶段卡片 -->
        <div class="ap-stage-grid">
          <div v-for="(stage, i) in currentRun.stages" :key="i" class="ap-stage-card" :class="'ap-stage--' + stage.status">
            <div class="ap-stage-head">
              <span>{{ stageStatusIcon(stage.status) }}</span>
              <span>{{ $t(STAGE_LABEL_KEYS[i]) }}：{{ stage.label }}</span>
            </div>
            <div v-if="stage.summary" class="ap-stage-summary">{{ stage.summary }}</div>
            <div v-if="stage.status === 'running'" class="ap-stage-progress-wrap">
              <div class="ap-mini-track">
                <div class="ap-progress-fill" :style="{ width: stage.progress + '%', background: 'var(--color-primary)' }"></div>
              </div>
            </div>
            <div v-if="stage.error" class="ap-stage-error">{{ stage.error }}</div>
          </div>
        </div>

        <!-- 结果摘要 -->
        <div v-if="currentRun.status === 'completed'" class="ap-banner ap-banner--completed">
          <div class="ap-banner-title">{{ $t('autoPipeline.completed') }}</div>
          <div class="ap-banner-hint">{{ $t('autoPipeline.completedSummary', { count: successCount }) }}</div>
        </div>
        <div v-if="currentRun.status === 'failed'" class="ap-banner ap-banner--failed">
          <div class="ap-banner-title ap-banner-title--danger">{{ $t('autoPipeline.failed') }}</div>
          <div class="ap-banner-hint">{{ $t('autoPipeline.failedHint') }}</div>
          <button class="cohere-btn-secondary ap-btn-resume" @click="resumePipeline">{{ $t('autoPipeline.resume') }}</button>
        </div>
      </div>

      <!-- 执行日志 -->
      <div v-if="currentRun && currentRun.logs && currentRun.logs.length > 0" class="cohere-card ap-card-panel">
        <div class="cohere-section-title">{{ $t('autoPipeline.logTitle') }}</div>
        <div ref="logContainer" class="ap-log-panel">
          <div v-for="(log, i) in currentRun.logs" :key="i" :style="{ color: logColor(log.level) }">
            <span class="ap-log-time">{{ log.time }}</span>
            <span> {{ log.message }}</span>
          </div>
        </div>
      </div>

      <!-- 历史运行 -->
      <div class="cohere-card ap-card-panel ap-card-panel--flush">
        <div class="cohere-section-title">{{ $t('autoPipeline.historyTitle') }}</div>
        <EmptyState v-if="runs.length === 0" icon="Promotion" :title="$t('autoPipeline.noHistory')" :description="$t('autoPipeline.noHistoryHint')" />
        <div v-else class="cohere-card-grid">
          <div v-for="r in runs" :key="r.runId" class="cohere-card" :style="{ borderLeft: '3px solid' + statusColor(r.status) }">
            <div class="card-top">
              <div class="card-icon">{{ runIcon(r.status) }}</div>
              <div class="card-info">
                <div class="card-platform">{{ r.config.contentType === 'video' ? $t('autoPipeline.videoPublish') : $t('autoPipeline.articlePublish') }} · {{ r.config.sourceType }}</div>
                <div class="card-account">{{ r.createdAt ? r.createdAt.slice(0, 16) : '' }} · {{ $t('autoPipeline.progress') }} {{ r.progress }}%</div>
              </div>
            </div>
            <div class="card-actions">
              <button @click="viewRun(r.runId)">{{ $t('autoPipeline.view') }}</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted, watch, nextTick } from 'vue'
import { getApi } from '@/api/electron-bridge'
import { useNotify } from '@/composables/useNotify'
import { resolveNotifyText } from '@/utils/notifyCore'
import { formatUserError } from '@/utils/user-facing-error'

const { notifyError, notifySuccess, notifyWarning, notifyInfo } = useNotify()

// ─── 配置 ───
const config = ref({
  contentType: 'video',
  sourceType: 'url',
  urls: [],
  rewriteStyle: '轻松易懂',
  rewriteLength: 'keep',
  videoConfig: {},
  publishAllAccounts: true,
  platforms: [],
})

const urlInput = ref('')
const urlListInput = ref('')
const running = ref(false)
const currentRunId = ref(null)
const currentRun = ref(null)
const runs = ref([])
const startError = ref('')
const accountCount = ref(0)
const loadingAccounts = ref(false)
const logContainer = ref(null)
let pollTimer = null

const rewriteStyles = [
  { label: resolveNotifyText('collection.rewriteStyleEasy').text, value: '轻松易懂' },
  { label: resolveNotifyText('collection.rewriteStyleFormal').text, value: '正式严谨' },
  { label: resolveNotifyText('collection.rewriteStyleEyeCatching').text, value: '吸引眼球' },
  { label: resolveNotifyText('collection.rewriteStyleDeep').text, value: '深度分析' },
  { label: resolveNotifyText('collection.rewriteStyleCognitive').text, value: '认知锚点' },
]

const rewriteLengths = [
  { label: resolveNotifyText('collection.rewriteLengthKeep').text, value: 'keep' },
  { label: resolveNotifyText('collection.rewriteLengthCompress').text, value: 'compress' },
  { label: resolveNotifyText('collection.rewriteLengthExpand').text, value: 'expand' },
]

const STAGE_LABEL_KEYS = [
  'autoPipeline.stage1',
  'autoPipeline.stage2',
  'autoPipeline.stage3',
  'autoPipeline.stage4',
]

const canStart = computed(() => {
  if (config.value.sourceType === 'url') return config.value.urls.length > 0
  return urlListInput.value.trim().length > 0
})

const successCount = computed(() => {
  if (!currentRun.value) return 0
  const publishStage = currentRun.value.stages.find((s) => s.id === 'publish')
  return publishStage && publishStage.summary ? publishStage.summary : ''
})

// ─── 方法 ───

function addUrl() {
  const u = urlInput.value.trim()
  if (!u) return
  if (!config.value.urls.includes(u)) {
    config.value.urls.push(u)
  }
  urlInput.value = ''
}

function removeUrl(i) {
  config.value.urls.splice(i, 1)
}

function stageStatusIcon(status) {
  const map = { completed: '✅', running: '🔄', failed: '❌', pending: '⏳', skipped: '⏭️', cancelled: '🚫' }
  return map[status] || '⏳'
}

function logColor(level) {
  // T1-3b：终端日志色收编 tokens.css（--color-terminal-*）
  const map = { error: 'var(--color-terminal-error)', warn: 'var(--color-terminal-warn)', info: 'var(--color-terminal-text)' }
  return map[level] || 'var(--color-terminal-text)'
}

function statusColor(status) {
  const map = { completed: 'var(--color-success)', running: 'var(--color-primary)', failed: 'var(--color-danger)', cancelled: 'var(--color-text-secondary)' }
  return map[status] || 'var(--color-text-secondary)'
}

function runIcon(status) {
  const map = { completed: '✅', running: '🔄', failed: '❌', cancelled: '🚫' }
  return map[status] || '🔄'
}

async function refreshAccounts() {
  loadingAccounts.value = true
  try {
    const api = getApi()
    if (api && api.accountList) {
      const res = await api.accountList()
      if (res && res.code === 0 && Array.isArray(res.data)) {
        accountCount.value = res.data.length
      }
    }
  } catch (_) { /* ignore */ }
  finally { loadingAccounts.value = false }
}

async function startPipeline() {
  const api = getApi()
  if (!api || !api.autoPipelineStart) {
    notifyWarning('autoPipeline.unavailable')
    return
  }

  // 构建配置
  const cfg = { ...config.value }
  if (cfg.sourceType !== 'url') {
    const lines = urlListInput.value.split('\n').filter(Boolean).map((l) => l.trim())
    if (cfg.sourceType === 'rss') {
      cfg.rssUrl = lines[0] || ''
      cfg.urls = []
    } else {
      cfg.urls = lines
    }
  }

  startError.value = ''
  running.value = true

  try {
    const res = await api.autoPipelineStart(cfg)
    if (res && res.success) {
      currentRunId.value = res.runId
      notifySuccess('autoPipeline.started')
      startPolling()
    } else {
      startError.value = (res && res.error) || '启动失败'
      notifyError('autoPipeline.startFailed', { message: startError.value })
      running.value = false
    }
  } catch (e) {
    startError.value = formatUserError(e, { fallback: '启动失败' }).message
    notifyError('autoPipeline.startFailed', { message: startError.value })
    running.value = false
  }
}

async function cancelPipeline() {
  const api = getApi()
  if (!api || !api.autoPipelineCancel || !currentRunId.value) return
  try {
    await api.autoPipelineCancel(currentRunId.value)
    notifyInfo('autoPipeline.cancelled')
  } catch (_) { /* ignore */ }
}

async function resumePipeline() {
  const api = getApi()
  if (!api || !api.autoPipelineCancel || !currentRunId.value) return
  // Note: resume is not a separate IPC; we restart the run
  notifyInfo('autoPipeline.resuming')
  // Attempt to re-run the same config
  running.value = true
  startError.value = ''
  try {
    const res = await api.autoPipelineStart(config.value)
    if (res && res.success) {
      currentRunId.value = res.runId
      startPolling()
    } else {
      startError.value = (res && res.error) || '恢复失败'
      running.value = false
    }
  } catch (e) {
    startError.value = formatUserError(e, { fallback: '恢复失败' }).message
    running.value = false
  }
}

function startPolling() {
  stopPolling()
  pollTimer = setInterval(async () => {
    if (!currentRunId.value) return
    const api = getApi()
    if (!api || !api.autoPipelineGetRun) return
    try {
      const snapshot = await api.autoPipelineGetRun(currentRunId.value)
      if (snapshot && snapshot.runId) {
        currentRun.value = snapshot
        if (snapshot.status === 'completed' || snapshot.status === 'failed' || snapshot.status === 'cancelled') {
          running.value = false
          listRuns()
        }
        // 自动滚动日志
        nextTick(() => {
          if (logContainer.value) {
            logContainer.value.scrollTop = logContainer.value.scrollHeight
          }
        })
      }
    } catch (_) { /* ignore */ }
  }, 1500)
}

function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
}

async function listRuns() {
  const api = getApi()
  if (!api || !api.autoPipelineListRuns) return
  try {
    const res = await api.autoPipelineListRuns()
    if (res && res.code === 0 && Array.isArray(res.data)) {
      runs.value = res.data
    }
  } catch (_) { /* ignore */ }
}

function viewRun(runId) {
  currentRunId.value = runId
  startPolling()
}

onMounted(async () => {
  await refreshAccounts()
  await listRuns()
})

onUnmounted(() => {
  stopPolling()
})
</script>

<style scoped>
/* T1-3b：原 56 处内联样式全部类化；颜色一律 var(--color-*)（tokens.css 语义槽，
 * 阶段状态/终端日志色已收编 --color-stage-* 与 --color-terminal-*）。 */
.ap-card-panel { padding: var(--space-md); margin-bottom: var(--space-lg); }
.ap-card-panel--flush { margin-bottom: 0; }

/* --- 配置区 --- */
.ap-field-row { margin-bottom: var(--space-sm); }
.ap-label-strong { font-weight: 600; }
.ap-label-strong--gap { margin-right: var(--space-sm); }
.ap-check-label { cursor: pointer; }
.ap-check-label--gap { margin-right: var(--space-md); }
.ap-select { border: 1px solid var(--color-border); border-radius: 6px; padding: 6px 10px; font-size: var(--font-size-sm); }
.ap-input { width: 100%; border: 1px solid var(--color-border); border-radius: 6px; padding: 8px 12px; font-size: var(--font-size-sm); margin-bottom: 4px; }
.ap-textarea { width: 100%; border: 1px solid var(--color-border); border-radius: 6px; padding: 8px 12px; font-size: var(--font-size-sm); resize: vertical; }
.ap-btn-sm { font-size: var(--font-size-xs); padding: 2px 8px; }
.ap-url-count { margin-top: 4px; font-size: var(--font-size-xs); color: var(--color-text-secondary); }
.ap-url-chip { display: inline-block; background: var(--color-bg-inset); padding: 2px 6px; border-radius: var(--r-xs); margin: 2px; }
.ap-url-remove { cursor: pointer; margin-left: 4px; color: var(--color-danger); }
.ap-hint { font-size: var(--font-size-xs); color: var(--color-text-secondary); margin-top: 2px; }
.ap-hint--plain { margin-top: 0; }
.ap-row-flex { margin-bottom: var(--space-sm); display: flex; gap: var(--space-md); flex-wrap: wrap; align-items: center; }
.ap-start-row { margin-top: var(--space-md); display: flex; gap: var(--space-sm); align-items: center; }
.ap-btn-start { font-size: var(--font-size-base); padding: 10px 24px; }
.ap-btn-cancel { font-size: var(--font-size-sm); }
.ap-error-banner {
  margin-top: 8px;
  padding: 6px 10px;
  background: var(--color-error-banner-bg);
  border-radius: var(--r-xs);
  font-size: var(--font-size-xs);
  color: var(--color-error-banner-text);
}

/* --- 进度 --- */
.ap-progress-wrap { margin-bottom: var(--space-sm); }
.ap-progress-head { display: flex; justify-content: space-between; font-size: var(--font-size-sm); margin-bottom: 4px; }
.ap-progress-track { background: var(--color-bg-inset); border-radius: 6px; height: 10px; overflow: hidden; }
.ap-progress-fill { height: 100%; transition: width 0.3s; }

/* --- 阶段卡片（状态底色走 --color-stage-* 槽位） --- */
.ap-stage-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: var(--space-sm); margin-bottom: var(--space-md); }
.ap-stage-card { padding: var(--space-sm); border-radius: 8px; border: 1px solid var(--color-border); }
.ap-stage--completed { background: var(--color-stage-completed-bg); }
.ap-stage--running { background: var(--color-stage-running-bg); }
.ap-stage--failed { background: var(--color-stage-failed-bg); }
.ap-stage--skipped { background: var(--color-stage-skipped-bg); }
.ap-stage--pending { background: var(--color-stage-pending-bg); }
.ap-stage--cancelled { background: var(--color-stage-skipped-bg); }
.ap-stage-head { font-weight: 600; font-size: var(--font-size-sm); display: flex; align-items: center; gap: 6px; }
.ap-stage-summary { font-size: var(--font-size-xs); color: var(--color-text-secondary); margin-top: 4px; }
.ap-stage-progress-wrap { margin-top: 4px; }
.ap-mini-track { background: var(--color-bg-inset); border-radius: var(--r-xs); height: 6px; overflow: hidden; }
.ap-stage-error { font-size: var(--font-size-xs); color: var(--color-danger); margin-top: 4px; }

/* --- 结果横幅 --- */
.ap-banner { padding: var(--space-sm); border-radius: 8px; }
.ap-banner--completed { background: var(--color-stage-completed-bg); }
.ap-banner--failed { background: var(--color-stage-failed-bg); }
.ap-banner-title { font-weight: 600; font-size: var(--font-size-sm); }
.ap-banner-title--danger { color: var(--color-danger); }
.ap-banner-hint { font-size: var(--font-size-xs); color: var(--color-text-secondary); margin-top: 4px; }
.ap-btn-resume { margin-top: 8px; font-size: var(--font-size-sm); }

/* --- 日志终端（色值走 --color-terminal-*） --- */
.ap-log-panel {
  max-height: 300px;
  overflow-y: auto;
  font-family: monospace;
  font-size: var(--font-size-xs);
  background: var(--color-terminal-bg);
  color: var(--color-terminal-text);
  padding: var(--space-sm);
  border-radius: 6px;
}
.ap-log-time { color: var(--color-terminal-muted); }
</style>
