/**
 * useBatchCreate —— 故事讲述批量创作域（CreateView 拆分第 3 步，FRONTEND-FILE-SPLIT-PLAN-2026-10 v3 §2.2）
 *
 * 承接壳的批量弹窗状态（10 个 s2vBatch*）、队列刷新/取消、批量启动与容量校验（15 个方法）。
 * 设计约束（与 useBgmLibrary / useTtsVoices 同构，见方案 §2.3）：
 *   - 模块级单例；无实例依赖（轮询定时器为显式启停方法，由壳的 open/close 与
 *     beforeUnmount 经代理调用，本模块不调 onMounted/onUnmounted）；
 *   - 跨域写点（s2vConfig 读写、IPC 脱壳、卸载守卫、locale 取值、错误弹窗、
 *     选项 toast、模型要求去重集）经 setupBatchCreateDeps 注入，不反向 import 壳；
 *   - 用户可见文案一律走 locale（deps.t / deps.translate）——本文件不得出现 CJK 字面量
 *     （CI Gate 7 --cjk 拦新路径，见方案 §2.6 发现 T1）；
 *   - 历史域的批量删除三方法与删除确认消息文案留在壳（依赖 deleting/history/
 *     story2videoBatchDeleteDialog，跨域过深）。
 */
import { reactive, computed, toRefs } from 'vue'
import {
  story2videoBatchCreate,
  story2videoBatchStatus,
  story2videoBatchCancel,
} from '@/api/publisher'
import { story2videoPickBatchFiles } from '@/api/publisher'
import { formatStory2VideoNotification, STORY2VIDEO_NOTIFICATION_KEYS } from '@/story2video/story2video-notifications'
import { getAppLocale } from '@/i18n'

/** 模块级状态（单例） */
export const state = reactive({
  s2vBatchDialogOpen: false,
  s2vBatchTab: 'text',
  s2vBatchVideoMode: 'off',
  s2vBatchTexts: [''],
  s2vBatchFiles: [],
  s2vBatchStarting: false,
  s2vBatchLoading: false,
  s2vBatchError: '',
  s2vBatches: [],
  s2vBatchPollTimer: null,
  S2V_BATCH_MAX_TEXTS: 10,
  S2V_BATCH_MAX_FILES: 20,
})

/** 壳注入的跨域依赖 */
let deps = null
const WINDOW_KEY = '__batchCreateDeps'

export function setupBatchCreateDeps(d) {
  deps = d
  if (typeof window !== 'undefined') window[WINDOW_KEY] = d
}

/** 取依赖；未注入即抛错（fail-closed，不静默降级） */
export function requireDeps() {
  const d = deps || (typeof window !== 'undefined' ? window[WINDOW_KEY] : null)
  if (!d) throw new Error('[useBatchCreate] deps not injected: shell component must call setupBatchCreateDeps first')
  return d
}

// ── 计算属性（壳以只读 computed 转发到模板；模块内以 .value 读取）──────


/** 计算属性表（壳 computed 转发） */
export const batchCreateComputeds = {

}

/** 状态桥接用 toRefs（壳 CreateView computed get/set 委托到这里） */
export const batchCreateRefs = toRefs(state)

// ---- 批量创作（2026-08-15 story2video-batch-create）----
function openS2VBatchDialog() {
  const d = requireDeps()
  state.s2vBatchDialogOpen = true
  state.s2vBatchError = ''
  refreshS2VBatches()
  // 弹窗打开期间 3s 轮询队列状态；关闭后停止（批量任务在主进程队列继续后台执行）
  if (!state.s2vBatchPollTimer) {
    state.s2vBatchPollTimer = setInterval(() => {
      if (state.s2vBatchDialogOpen) refreshS2VBatches()
    }, 3000)
  }
}

function closeS2VBatchDialog() {
  const d = requireDeps()
  state.s2vBatchDialogOpen = false
  if (state.s2vBatchPollTimer) {
    clearInterval(state.s2vBatchPollTimer)
    state.s2vBatchPollTimer = null
  }
}

function addS2VBatchText() {
  const d = requireDeps()
  if (state.s2vBatchTexts.length >= state.S2V_BATCH_MAX_TEXTS) return
  state.s2vBatchTexts.push('')
}

function removeS2VBatchText(index) {
  const d = requireDeps()
  if (state.s2vBatchTexts.length <= 1) return
  state.s2vBatchTexts.splice(index, 1)
}

async function pickS2VBatchFiles() {
  const d = requireDeps()
  try {
    const res = await story2videoPickBatchFiles()
    const files = res?.code === 0 && Array.isArray(res.data?.files) ? res.data.files : []
    if (!files.length) return
    const merged = [...state.s2vBatchFiles]
    for (const file of files) {
      if (!file || typeof file.path !== 'string' || !file.path) continue
      if (merged.some(existing => existing.path === file.path)) continue
      if (merged.length >= state.S2V_BATCH_MAX_FILES) {
        state.s2vBatchError = d.t('create.story2video.batch.fileLimitError')
        break
      }
      merged.push({ name: file.name || String(file.path).split(/[\\/]/).pop(), path: file.path })
    }
    state.s2vBatchFiles = merged
  } catch (_) {
    state.s2vBatchError = d.t('create.story2video.batch.pickFailed')
  }
}

// 浏览器降级路径（非 Electron 环境）：隐藏 input 兜底选择
function handleS2VBatchFileInput(event) {
  const d = requireDeps()
  const selected = Array.from(event?.target?.files || [])
  const merged = [...state.s2vBatchFiles]
  for (const file of selected) {
    const path = typeof file.path === 'string' && file.path ? file.path : file.name
    if (merged.some(existing => existing.path === path)) continue
    if (merged.length >= state.S2V_BATCH_MAX_FILES) break
    merged.push({ name: file.name, path })
  }
  state.s2vBatchFiles = merged
  if (event?.target) event.target.value = ''
}

function removeS2VBatchFile(index) {
  const d = requireDeps()
  state.s2vBatchFiles.splice(index, 1)
}

function formatS2VBatchCreatedAt(iso) {
  const d = requireDeps()
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const pad = (n) => String(n).padStart(2, '0')
  return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate())
    + ' ' + pad(date.getHours()) + ':' + pad(date.getMinutes()) + ':' + pad(date.getSeconds())
}

function batchSummaryText(batch) {
  const d = requireDeps()
  const summary = batch && batch.summary ? batch.summary : null
  if (!summary) return ''
  const parts = []
  if (summary.running > 0) parts.push(d.t('create.story2video.batch.summaryRunning', { count: summary.running }))
  if (summary.pending > 0) parts.push(d.t('create.story2video.batch.summaryPending', { count: summary.pending }))
  if (summary.completed > 0) parts.push(d.t('create.story2video.batch.summaryCompleted', { count: summary.completed }))
  if (summary.failed > 0) parts.push(d.t('create.story2video.batch.summaryFailed', { count: summary.failed }))
  if (summary.cancelled > 0) parts.push(d.t('create.story2video.batch.summaryCancelled', { count: summary.cancelled }))
  return parts.join(' · ') || d.t('create.story2video.batch.summaryTotal', { total: summary.total })
}

function s2vBatchItemStatusText(item) {
  const d = requireDeps()
  const statusMap = {
    pending: ['create.story2video.batch.statusPending', 'Queued', 'Queued'],
    running: ['create.story2video.batch.statusRunning', 'Running', 'Running'],
    completed: ['create.story2video.batch.statusCompleted', 'Completed', 'Completed'],
    failed: ['create.story2video.batch.statusFailed', 'Failed', 'Failed'],
    cancelled: ['create.story2video.batch.statusCancelled', 'Cancelled', 'Cancelled'],
  }
  const entry = statusMap[item && item.status] || ['', String(item && item.status || ''), String(item && item.status || '')]
  return d.translate(entry[0], entry[1], entry[2])
}

function s2vBatchCanStart() {
  const d = requireDeps()
  if (state.s2vBatchStarting) return false
  if (state.s2vBatchTab === 'text') return state.s2vBatchTexts.some(text => String(text || '').trim().length > 0)
  return state.s2vBatchFiles.length > 0
}

async function startS2VBatch() {
  const d = requireDeps()
  if (state.s2vBatchStarting) return
  state.s2vBatchError = ''
  const template = d.buildStory2VideoTextConfig('')
  delete template.prompt
  // 批量创作固定「全自动」创作模式 + 弹窗独立视频增强模式（不随主表单配置变化）
  template.creation = { mode: 'auto', materialMode: 'all-images' }
  template.video = { ...template.video, mode: state.s2vBatchVideoMode || 'off' }
  let payload
  if (state.s2vBatchTab === 'text') {
    const texts = state.s2vBatchTexts.map(text => String(text || '').trim()).filter(Boolean)
    if (!texts.length) {
      state.s2vBatchError = d.t('create.story2video.batch.noTextError')
      return
    }
    payload = { mode: 'text', texts, story2videoTextConfigTemplate: template, uiLocale: getAppLocale() }
  } else {
    const files = state.s2vBatchFiles.map(file => ({ path: file.path, name: file.name }))
    if (!files.length) {
      state.s2vBatchError = d.t('create.story2video.batch.noFileError')
      return
    }
    payload = { mode: 'files', files, story2videoTextConfigTemplate: template, uiLocale: getAppLocale() }
  }
  state.s2vBatchStarting = true
  try {
    const res = await story2videoBatchCreate(d.cloneForIpc(payload))
    if (res?.code === 0 && res?.data?.batchId) {
      await refreshS2VBatches()
      state.s2vBatchTexts = ['']
      state.s2vBatchFiles = []
    } else {
      const failedItems = Array.isArray(res?.failedItems) ? res.failedItems : []
      const failedLabel = failedItems.length > 0
        ? '（' + failedItems.map(item => item.label).join('、') + '）'
        : ''
      const message = (res?.message || d.t('create.story2video.batch.createFailedUnknown')) + failedLabel
      state.s2vBatchError = d.t('create.story2video.batch.createFailed', { message })
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    state.s2vBatchError = d.t('create.story2video.batch.createFailed', { message })
  } finally {
    state.s2vBatchStarting = false
  }
}

async function refreshS2VBatches() {
  const d = requireDeps()
  if (state.s2vBatchLoading) return
  state.s2vBatchLoading = true
  try {
    const res = await story2videoBatchStatus()
    if (res?.code === 0 && Array.isArray(res.data)) {
      state.s2vBatches = res.data
      surfaceS2VBatchModelRequirementErrors()
    }
  } catch (_) { /* 轮询失败静默，下个周期重试 */ } finally {
    state.s2vBatchLoading = false
  }
}

// 批量项启动前置校验失败（PIPELINE_MODEL_REQUIREMENTS_MISSING）→ 弹「去模型设置」提示
// 每 itemId 只弹一次，避免轮询周期重复打扰；用户补齐模型后再启动的批次不受影响。
function surfaceS2VBatchModelRequirementErrors() {
  const d = requireDeps()
  if (!Array.isArray(state.s2vBatches)) return
  if (!d.modelsRequiredShownItemIds) d.modelsRequiredShownItemIds = new Set()
  for (const batch of state.s2vBatches) {
    if (!batch || !Array.isArray(batch.items)) continue
    const item = batch.items.find((it) => it && it.status === 'failed' && it.errorCode === 'PIPELINE_MODEL_REQUIREMENTS_MISSING' && it.itemId)
    if (!item || d.modelsRequiredShownItemIds.has(item.itemId)) continue
    d.modelsRequiredShownItemIds.add(item.itemId)
    const errorParams = item.errorParams && typeof item.errorParams === 'object' ? item.errorParams : {}
    d.showStory2VideoErrorDialog({
      errorCode: 'PIPELINE_MODEL_REQUIREMENTS_MISSING',
      errorParams,
      error: typeof item.error === 'string' ? item.error : '',
    })
    return
  }
}

async function cancelS2VBatchItem(batchId, itemId) {
  const d = requireDeps()
  try {
    const res = await story2videoBatchCancel(batchId, [itemId])
    if (res?.code === 0) await refreshS2VBatches()
  } catch (_) { /* 取消失败静默 */ }
}

/** 方法表（壳同名代理转发） */
export const batchCreateMethods = {
  openS2VBatchDialog,
  closeS2VBatchDialog,
  addS2VBatchText,
  removeS2VBatchText,
  pickS2VBatchFiles,
  handleS2VBatchFileInput,
  removeS2VBatchFile,
  formatS2VBatchCreatedAt,
  batchSummaryText,
  s2vBatchItemStatusText,
  s2vBatchCanStart,
  startS2VBatch,
  refreshS2VBatches,
  surfaceS2VBatchModelRequirementErrors,
  cancelS2VBatchItem,
}

/** 测试复位（模块级单例状态跨用例泄漏防护）：仅测试环境使用 */
export function resetBatchCreateForTest() {
  const initial = {
    s2vBatchDialogOpen: false,
    s2vBatchTab: 'text',
    s2vBatchVideoMode: 'off',
    s2vBatchTexts: [''],
    s2vBatchFiles: [],
    s2vBatchStarting: false,
    s2vBatchLoading: false,
    s2vBatchError: '',
    s2vBatches: [],
    s2vBatchPollTimer: null,
    S2V_BATCH_MAX_TEXTS: 10,
    S2V_BATCH_MAX_FILES: 20,
  }
  Object.assign(state, initial)
  deps = null
  if (typeof window !== 'undefined') delete window[WINDOW_KEY]
}
