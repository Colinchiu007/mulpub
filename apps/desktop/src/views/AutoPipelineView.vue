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
      <div class="cohere-card" style="padding:var(--space-md);margin-bottom:var(--space-lg)">
        <div class="cohere-section-title">{{ $t('autoPipeline.configTitle') }}</div>

        <!-- 内容类型 -->
        <div style="margin-bottom:var(--space-sm)">
          <span style="font-weight:600;margin-right:var(--space-sm)">{{ $t('autoPipeline.contentType') }}：</span>
          <label style="margin-right:var(--space-md);cursor:pointer">
            <input type="radio" v-model="config.contentType" value="video" /> {{ $t('autoPipeline.videoPublish') }}
          </label>
          <label style="cursor:pointer">
            <input type="radio" v-model="config.contentType" value="article" /> {{ $t('autoPipeline.articlePublish') }}
          </label>
        </div>

        <!-- 采集方式 -->
        <div style="margin-bottom:var(--space-sm)">
          <span style="font-weight:600;margin-right:var(--space-sm)">{{ $t('autoPipeline.sourceType') }}：</span>
          <select v-model="config.sourceType" style="border:1px solid var(--border);border-radius:6px;padding:6px 10px;font-size:14px">
            <option value="url">{{ $t('autoPipeline.singleUrl') }}</option>
            <option value="rss">{{ $t('autoPipeline.rssSource') }}</option>
            <option value="batch">{{ $t('autoPipeline.urlList') }}</option>
          </select>
        </div>

        <!-- URL 输入 -->
        <div v-if="config.sourceType === 'url'" style="margin-bottom:var(--space-sm)">
          <input
            v-model="urlInput"
            :placeholder="$t('autoPipeline.urlPlaceholder')"
            style="width:100%;border:1px solid var(--border);border-radius:6px;padding:8px 12px;font-size:14px;margin-bottom:4px"
            @keyup.enter="addUrl"
          />
          <button class="cohere-btn-secondary" style="font-size:12px;padding:2px 8px" @click="addUrl">{{ $t('autoPipeline.addUrl') }}</button>
          <div v-if="config.urls.length > 0" style="margin-top:4px;font-size:12px;color:var(--text-secondary)">
            {{ $t('autoPipeline.urlCount', { count: config.urls.length }) }}：
            <span v-for="(u, i) in config.urls" :key="i" style="display:inline-block;background:var(--soft-stone);padding:2px 6px;border-radius:4px;margin:2px">
              {{ u.slice(0, 50) }}{{ u.length > 50 ? '...' : '' }}
              <span @click="removeUrl(i)" style="cursor:pointer;margin-left:4px;color:var(--danger)">×</span>
            </span>
          </div>
        </div>

        <!-- URL 列表 / RSS -->
        <div v-else style="margin-bottom:var(--space-sm)">
          <textarea
            v-model="urlListInput"
            :placeholder="config.sourceType === 'rss' ? $t('autoPipeline.rssPlaceholder') : $t('autoPipeline.listPlaceholder')"
            rows="4"
            style="width:100%;border:1px solid var(--border);border-radius:6px;padding:8px 12px;font-size:14px;resize:vertical"
          ></textarea>
          <div style="font-size:12px;color:var(--text-secondary);margin-top:2px">
            {{ config.sourceType === 'rss' ? $t('autoPipeline.rssHint') : $t('autoPipeline.listHint') }}
          </div>
        </div>

        <!-- 改写设置 -->
        <div style="margin-bottom:var(--space-sm);display:flex;gap:var(--space-md);flex-wrap:wrap;align-items:center">
          <span style="font-weight:600">{{ $t('autoPipeline.rewriteConfig') }}：</span>
          <select v-model="config.rewriteStyle" style="border:1px solid var(--border);border-radius:6px;padding:6px 10px;font-size:14px">
            <option v-for="s in rewriteStyles" :key="s.value" :value="s.value">{{ s.label }}</option>
          </select>
          <select v-model="config.rewriteLength" style="border:1px solid var(--border);border-radius:6px;padding:6px 10px;font-size:14px">
            <option v-for="l in rewriteLengths" :key="l.value" :value="l.value">{{ l.label }}</option>
          </select>
        </div>

        <!-- 发布设置 -->
        <div style="margin-bottom:var(--space-sm);display:flex;gap:var(--space-md);flex-wrap:wrap;align-items:center">
          <span style="font-weight:600">{{ $t('autoPipeline.publishConfig') }}：</span>
          <label style="cursor:pointer">
            <input type="checkbox" v-model="config.publishAllAccounts" /> {{ $t('autoPipeline.publishAll') }}
          </label>
          <span style="font-size:12px;color:var(--text-secondary)">
            {{ $t('autoPipeline.accountsDetected', { count: accountCount }) }}
          </span>
          <button class="cohere-btn-secondary" style="font-size:12px;padding:2px 8px" @click="refreshAccounts" :disabled="loadingAccounts">
            {{ loadingAccounts ? $t('autoPipeline.loadingAccounts') : $t('autoPipeline.refreshAccounts') }}
          </button>
        </div>

        <!-- 启动按钮 -->
        <div style="margin-top:var(--space-md);display:flex;gap:var(--space-sm);align-items:center">
          <button
            class="cohere-btn-primary"
            @click="startPipeline"
            :disabled="running || !canStart"
            style="font-size:15px;padding:10px 24px"
          >
            {{ running ? $t('autoPipeline.running') : $t('autoPipeline.start') }}
          </button>
          <button v-if="running" class="cohere-btn-secondary" @click="cancelPipeline" style="font-size:13px">
            {{ $t('autoPipeline.cancel') }}
          </button>
        </div>

        <div v-if="startError" style="margin-top:8px;padding:6px 10px;background:#fff3f3;border-radius:4px;font-size:12px;color:#d32f2f">
          {{ startError }}
        </div>
      </div>

      <!-- 执行进度 -->
      <div v-if="currentRun" class="cohere-card" style="padding:var(--space-md);margin-bottom:var(--space-lg)">
        <div class="cohere-section-title">{{ $t('autoPipeline.progressTitle') }}</div>

        <!-- 总进度条 -->
        <div style="margin-bottom:var(--space-sm)">
          <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:4px">
            <span>{{ $t('autoPipeline.totalProgress') }}</span>
            <span>{{ currentRun.progress }}%</span>
          </div>
          <div style="background:var(--soft-stone);border-radius:6px;height:10px;overflow:hidden">
            <div
              :style="{ width: currentRun.progress + '%', background: currentRun.status === 'completed' ? 'var(--success)' : currentRun.status === 'failed' ? 'var(--danger)' : 'var(--primary)', height:'100%', transition:'width 0.3s' }"
            ></div>
          </div>
        </div>

        <!-- 各阶段卡片 -->
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:var(--space-sm);margin-bottom:var(--space-md)">
          <div v-for="(stage, i) in currentRun.stages" :key="i" :style="{
            padding:'var(--space-sm)',
            borderRadius:'8px',
            border:'1px solid var(--border)',
            background: stage.status === 'completed' ? '#e8f5e9' : stage.status === 'running' ? '#e3f2fd' : stage.status === 'failed' ? '#ffebee' : stage.status === 'skipped' ? '#f5f5f5' : '#fff',
          }">
            <div style="font-weight:600;font-size:14px;display:flex;align-items:center;gap:6px">
              <span>{{ stageStatusIcon(stage.status) }}</span>
              <span>{{ $t(STAGE_LABEL_KEYS[i]) }}：{{ stage.label }}</span>
            </div>
            <div v-if="stage.summary" style="font-size:12px;color:var(--text-secondary);margin-top:4px">{{ stage.summary }}</div>
            <div v-if="stage.status === 'running'" style="margin-top:4px">
              <div style="background:var(--soft-stone);border-radius:4px;height:6px;overflow:hidden">
                <div :style="{ width: stage.progress + '%', background: 'var(--primary)', height:'100%', transition:'width 0.3s' }"></div>
              </div>
            </div>
            <div v-if="stage.error" style="font-size:11px;color:var(--danger);margin-top:4px">{{ stage.error }}</div>
          </div>
        </div>

        <!-- 结果摘要 -->
        <div v-if="currentRun.status === 'completed'" style="padding:var(--space-sm);background:#e8f5e9;border-radius:8px">
          <div style="font-weight:600;font-size:14px">{{ $t('autoPipeline.completed') }}</div>
          <div style="font-size:12px;color:var(--text-secondary);margin-top:4px">{{ $t('autoPipeline.completedSummary', { count: successCount }) }}</div>
        </div>
        <div v-if="currentRun.status === 'failed'" style="padding:var(--space-sm);background:#ffebee;border-radius:8px">
          <div style="font-weight:600;font-size:14px;color:var(--danger)">{{ $t('autoPipeline.failed') }}</div>
          <div style="font-size:12px;color:var(--text-secondary);margin-top:4px">{{ $t('autoPipeline.failedHint') }}</div>
          <button class="cohere-btn-secondary" style="margin-top:8px;font-size:13px" @click="resumePipeline">{{ $t('autoPipeline.resume') }}</button>
        </div>
      </div>

      <!-- 执行日志 -->
      <div v-if="currentRun && currentRun.logs && currentRun.logs.length > 0" class="cohere-card" style="padding:var(--space-md);margin-bottom:var(--space-lg)">
        <div class="cohere-section-title">{{ $t('autoPipeline.logTitle') }}</div>
        <div ref="logContainer" style="max-height:300px;overflow-y:auto;font-family:monospace;font-size:12px;background:#1e1e1e;color:#d4d4d4;padding:var(--space-sm);border-radius:6px">
          <div v-for="(log, i) in currentRun.logs" :key="i" :style="{ color: logColor(log.level) }">
            <span style="color:#888">{{ log.time }}</span>
            <span> {{ log.message }}</span>
          </div>
        </div>
      </div>

      <!-- 历史运行 -->
      <div class="cohere-card" style="padding:var(--space-md)">
        <div class="cohere-section-title">{{ $t('autoPipeline.historyTitle') }}</div>
        <EmptyState v-if="runs.length === 0" icon="🚀" :title="$t('autoPipeline.noHistory')" :description="$t('autoPipeline.noHistoryHint')" />
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
  const map = { error: '#f44336', warn: '#ff9800', info: '#d4d4d4' }
  return map[level] || '#d4d4d4'
}

function statusColor(status) {
  const map = { completed: 'var(--success)', running: 'var(--primary)', failed: 'var(--danger)', cancelled: 'var(--text-secondary)' }
  return map[status] || 'var(--text-secondary)'
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
