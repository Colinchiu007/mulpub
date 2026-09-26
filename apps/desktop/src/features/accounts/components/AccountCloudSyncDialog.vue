<template>
  <UiModal
    :visible="visible"
    :title="t('accountsPage.cloudSyncTitle')"
    size="md"
    test-id="account-cloud-sync-dialog"
    :close-on-overlay="false"
    :close-on-esc="false"
    @close="requestClose"
  >
    <div class="cloud-sync-dialog" data-testid="account-cloud-sync-body">
      <!-- ══ 摘要确认态（PRD §10.1：loading-digest → digest-confirm | digest-error）══ -->
      <template v-if="phase === 'digest'">
        <p
          v-if="digestState === 'loading'"
          class="cloud-sync-line cloud-digest-loading"
          role="status"
          data-testid="cloud-digest-loading"
        >{{ t('accountsPage.cloudDigestLoading') }}</p>

        <p
          v-else-if="digestState === 'error'"
          class="cloud-sync-line cloud-digest-error"
          role="alert"
          data-testid="cloud-digest-error"
        >{{ t('accountsPage.cloudDigestFailed') }}</p>

        <template v-else>
          <p class="cloud-sync-line cloud-digest-total" data-testid="cloud-digest-total">{{ digestTotalText }}</p>
          <ul v-if="platformRows.length" class="cloud-digest-platforms" data-testid="cloud-digest-platforms">
            <li
              v-for="row in platformRows"
              :key="row.platform"
              class="cloud-digest-platform"
              :data-testid="`cloud-digest-platform-${row.platform}`"
            >
              <img
                v-if="isIconUrl(row.icon)"
                :src="row.icon"
                class="cloud-digest-platform-icon-img"
                :alt="row.label"
                width="20"
                height="20"
              >
              <span v-else class="cloud-digest-platform-icon" aria-hidden="true">{{ row.icon || row.initial }}</span>
              <span class="cloud-digest-platform-name">{{ row.label }}</span>
              <strong class="cloud-digest-platform-count">{{ row.count }}</strong>
            </li>
          </ul>
          <p class="cloud-sync-line cloud-digest-local" data-testid="cloud-digest-local">{{ t('accountsPage.cloudDigestLocal', { local: effectiveLocalCount }) }}</p>
          <p
            v-if="digest && digest.tombstones > 0"
            class="cloud-sync-line cloud-digest-tombstone"
            data-testid="cloud-digest-tombstone"
          >{{ t('accountsPage.cloudDigestTombstone', { count: digest.tombstones }) }}</p>
        </template>

        <!-- 隐私提示恒显示：首次同步的同意点（PRD §十五 合规），错误态也不隐藏 -->
        <p class="cloud-sync-hint cloud-digest-privacy" data-testid="cloud-digest-privacy">{{ t('accountsPage.cloudDigestPrivacy') }}</p>
      </template>

      <!-- ══ 过程态（同一弹窗内切换，不叠加第二个遮罩）══ -->
      <template v-else>
        <div class="cloud-sync-progress-head">
          <span class="cloud-sync-progress-text" data-testid="cloud-sync-progress">{{ t('accountsPage.cloudSyncProgress', { done: doneCount, total: progressTotal }) }}</span>
          <span class="cloud-sync-elapsed" data-testid="cloud-sync-elapsed">{{ t('accountsPage.cloudSyncElapsed', { seconds: elapsedSec }) }}</span>
        </div>
        <div class="batch-check-bar" aria-hidden="true">
          <div class="batch-check-bar-inner" :style="{ width: syncPercent + '%' }"></div>
        </div>
        <!-- 进行中平台集合：PRD §10.4 未提供带前缀的文案键，故只渲染平台名，不借用一键检测的「正在检测」文案 -->
        <p v-if="inflightLabels.length" class="cloud-sync-line cloud-sync-current" data-testid="cloud-sync-current">{{ inflightLabels.join('、') }}</p>

        <ul v-if="rows.length" class="cloud-sync-items" data-testid="cloud-sync-items">
          <li v-for="row in rows" :key="row.key" class="cloud-sync-item" :data-testid="`cloud-sync-item-${row.key}`">
            <span class="cloud-sync-item-platform">{{ row.label }}</span>
            <span class="cloud-sync-item-name" :data-testid="`cloud-sync-item-name-${row.key}`">{{ row.name }}</span>
            <span :class="['cloud-sync-item-outcome', outcomeClass(row.outcome)]" :data-testid="`cloud-sync-item-outcome-${row.key}`">{{ outcomeLabel(row.outcome) }}</span>
            <span v-if="row.reason" class="cloud-sync-item-reason" :data-testid="`cloud-sync-item-reason-${row.key}`">{{ row.reason }}</span>
          </li>
        </ul>

        <!-- 终态汇总区：只在批次结束后出现 -->
        <div v-if="terminal" class="cloud-sync-summary" data-testid="cloud-sync-summary">
          <p v-if="summaryText" class="cloud-sync-summary-text" role="status" data-testid="cloud-sync-summary-text">{{ summaryText }}</p>
          <p v-else-if="batchErrorKey" class="cloud-sync-summary-error" role="alert" data-testid="cloud-sync-summary-error">{{ t(batchErrorKey) }}</p>
          <!-- 中止只在主进程侧生效：本行只在批次真的带回「曾请求停止」时出现，点击时不预渲染 -->
          <p v-if="stoppedEarly" class="cloud-sync-summary-stopped" role="status" data-testid="cloud-sync-stopped">{{ t('accountsPage.cloudSyncStopped') }}</p>
          <div v-if="summaryStats.length" class="cloud-sync-summary-stats" data-testid="cloud-sync-summary-stats">
            <span
              v-for="stat in summaryStats"
              :key="stat.outcome"
              :class="['cloud-sync-stat', outcomeClass(stat.outcome)]"
              :data-testid="`cloud-sync-stat-${stat.outcome}`"
            >{{ outcomeLabel(stat.outcome) }} {{ stat.count }}</span>
          </div>
        </div>
      </template>
    </div>

    <template #footer>
      <template v-if="phase === 'digest'">
        <UiButton variant="ghost" data-testid="cloud-disconnect" :disabled="disconnectDisabled" :loading="disconnecting" @click="disconnectCloud">
          {{ t('accountsPage.cloudDisconnect') }}
        </UiButton>
        <UiButton variant="ghost" data-testid="cloud-sync-cancel" @click="requestClose">
          {{ t('accountsPage.cancel') }}
        </UiButton>
        <UiButton
          v-if="digestState === 'error'"
          variant="primary"
          data-testid="cloud-digest-retry"
          @click="loadDigest"
        >{{ t('accountsPage.cloudDigestRetry') }}</UiButton>
        <UiButton
          v-else
          variant="primary"
          data-testid="cloud-sync-start"
          :disabled="digestState !== 'ready' || effectiveLocalCount === 0"
          @click="startSync"
        >{{ t('accountsPage.cloudSync') }}</UiButton>
      </template>
      <template v-else>
        <UiButton v-if="!terminal" variant="ghost" data-testid="cloud-sync-background" @click="requestClose">
          {{ t('accountsPage.cloudSyncBackground') }}
        </UiButton>
        <!-- 停止阀：批次会把全部平台登录凭证发往服务端，进行中必须给出显式可停止出口。
             点击只置主进程中止标记，终态仍由批次返回决定（不在此伪造「已停止」）。 -->
        <UiButton
          v-if="!terminal"
          variant="ghost"
          data-testid="cloud-sync-stop"
          :disabled="stopDisabled"
          @click="requestAbortSync"
        >{{ stopping ? t('accountsPage.cloudSyncStopping') : t('accountsPage.cloudSyncStop') }}</UiButton>
        <UiButton v-if="terminal" variant="primary" data-testid="cloud-sync-finish" @click="requestClose">
          {{ t('accountsPage.cloudSyncClose') }}
        </UiButton>
      </template>
    </template>
  </UiModal>
</template>

<script setup>
/**
 * AccountCloudSyncDialog — 账号管理页【同步云端】弹窗（PRD-CLOUD-ACCOUNT-SYNC-2026-09-27 §10）
 *
 * 两态同弹窗（§10.1 状态机）：摘要确认态 / 过程态（含终态汇总）。
 * 关键约束：
 *   - 摘要 MUST 先有数据再显示数字：loading 期不渲染任何计数行，失败/不可达渲染 cloudDigestFailed + 重试，
 *     绝不用「云端现有 0 个」冒充空云端（§10.2）。
 *   - 平台分布顺序稳定：count desc → platform asc，不依赖响应数组顺序。
 *   - 关闭 = 后台继续：不取消已发起的批次，但 MUST 退订进度事件（offProgress 走 finally）。
 *   - 进行中提供【停止同步】：只置主进程中止标记（当前条完成后停止），终态仍由批次返回决定；
 *     点击时不得伪造「已停止」，也不得清空已渲染的逐条列表。
 *   - 应用级模态浮层：经 useEmbeddedViewSuspension 挂起/恢复内嵌 WebContentsView（AGENTS.md overlay 合同）。
 */
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import UiButton from '@/components/UiButton.vue'
import UiModal from '@/components/UiModal.vue'
import {
  accountsCloudDigest,
  accountsCloudDisconnect,
  accountsCloudSync,
  accountsCloudSyncAbort,
  onAccountsCloudSyncProgress,
} from '@/api/publisher'
import { useNotify } from '@/composables/useNotify'
import { releaseEmbeddedViewsForOverlay, suspendEmbeddedViewsForOverlay } from '@/composables/useEmbeddedViewSuspension'

/** 浮层互斥 owner 唯一标识（登记于 src/overlay-view-suspension.test.js） */
const OVERLAY_OWNER = 'account-cloud-sync-dialog'

const props = defineProps({
  visible: { type: Boolean, default: false },
  /** 本机账号数：摘要未回传 localCount 时的兜底口径 */
  localCount: { type: Number, default: 0 },
  platformLabel: { type: Function, default: value => value },
  platformIcon: { type: Function, default: () => '' },
})

const emit = defineEmits(['close', 'synced', 'running-change'])

const { t, te } = useI18n()
const { notifyConfirm, notifyError, notifySuccess } = useNotify()

const phase = ref('digest')
const digestState = ref('loading')
const digest = ref(null)
const disconnecting = ref(false)

const rows = ref([])
const inflight = ref([])
const progressTotal = ref(0)
const elapsedSec = ref(0)
const running = ref(false)
const terminal = ref(false)
const summary = ref(null)
const batchErrorKey = ref('')

// 停止阀状态（三个都必须显式区分，否则会出现「按钮说已停止、批次其实还在跑」）：
//   stopping     已请求中止、主进程已接受，等批次自己收口
//   stopInert    主进程回报 aborted:false（批次本就不在跑）→ 按钮失效，不改文案、不报错
//   stoppedEarly 批次收口时 stopping 仍为真 → 汇总区补一行「剩余账号未同步」
const stopping = ref(false)
const stopInert = ref(false)
const stoppedEarly = ref(false)

let ticker = null
let startedAt = 0
let offProgress = null
let overlayHeld = false

// ─── 摘要态 ─────────────────────────────────────
const effectiveLocalCount = computed(() => {
  const fromDigest = Number(digest.value?.localCount)
  return Number.isFinite(fromDigest) && digest.value?.localCount != null ? fromDigest : Number(props.localCount) || 0
})

const digestTotalText = computed(() => {
  const total = Number(digest.value?.total) || 0
  return total > 0
    ? t('accountsPage.cloudDigestTotal', { total })
    : t('accountsPage.cloudDigestEmpty')
})

/** 平台分布：count desc、platform asc（顺序稳定，与响应数组顺序无关） */
const platformRows = computed(() => {
  const list = Array.isArray(digest.value?.byPlatform) ? digest.value.byPlatform : []
  return list
    .map(item => ({
      platform: String(item?.platform || ''),
      count: Number(item?.count) || 0,
    }))
    .filter(item => item.platform)
    .sort((a, b) => b.count - a.count || a.platform.localeCompare(b.platform))
    .map(item => {
      const label = props.platformLabel(item.platform) || item.platform
      return {
        ...item,
        label,
        icon: props.platformIcon(item.platform) || '',
        initial: String(label || item.platform).slice(0, 1),
      }
    })
})

const disconnectDisabled = computed(() => digestState.value !== 'ready' || disconnecting.value || (Number(digest.value?.total) || 0) === 0)

/** 停止按钮只在「已请求且主进程已接受」或「批次本就不在跑」时失效；其余保持可点，让用户能重试。 */
const stopDisabled = computed(() => stopping.value || stopInert.value)

function isIconUrl (value) {
  return typeof value === 'string' && (value.startsWith('/') || value.startsWith('data:') || value.startsWith('http'))
}

async function loadDigest () {
  digestState.value = 'loading'
  digest.value = null
  try {
    const result = await accountsCloudDigest()
    const data = result?.code === 0 ? result?.data : null
    // 三份「不算成功」的形态必须一致地走错误态：调用失败、明确不可达、以及 total 缺席的残缺响应。
    // 最后一条尤其重要——残缺响应若按 0 处理，界面上就出现「云端现有 0 个账号」冒充空云端（PRD §10.2）。
    if (!data || data.reachable === false || data.total == null) {
      digestState.value = 'error'
      digest.value = null
      return
    }
    digest.value = {
      total: Number(data.total) || 0,
      byPlatform: Array.isArray(data.byPlatform) ? data.byPlatform : [],
      tombstones: Number(data.tombstones) || 0,
      localCount: data.localCount == null ? null : Number(data.localCount) || 0,
      reachable: true,
    }
    digestState.value = 'ready'
  } catch (_) {
    digest.value = null
    digestState.value = 'error'
  }
}

// ─── 逐条结果 / 结果标签 ─────────────────────────
const OUTCOME_LABEL_KEYS = {
  created: 'accountsPage.cloudOutcomeCreated',
  updated: 'accountsPage.cloudOutcomeUpdated',
  unchanged: 'accountsPage.cloudOutcomeUnchanged',
  restored: 'accountsPage.cloudOutcomeRestored',
  'skipped-tombstone': 'accountsPage.cloudOutcomeSkippedTombstone',
  'conflict-resolved-local': 'accountsPage.cloudOutcomeConflictLocal',
  'conflict-resolved-cloud': 'accountsPage.cloudOutcomeConflictCloud',
  'invalid-credential': 'accountsPage.cloudOutcomeInvalidCredential',
  'uid-unavailable': 'accountsPage.cloudOutcomeUidUnavailable',
  failed: 'accountsPage.cloudOutcomeFailed',
}

const OUTCOME_CLASS = {
  created: 'is-success',
  updated: 'is-success',
  restored: 'is-success',
  unchanged: 'is-muted',
  'skipped-tombstone': 'is-muted',
  'uid-unavailable': 'is-muted',
  'conflict-resolved-local': 'is-warning',
  'conflict-resolved-cloud': 'is-warning',
  'invalid-credential': 'is-danger',
  failed: 'is-danger',
}

/** 未登记的 outcome（如 §5.2 的 tombstone-backfilled）不得渲染成假标签：留空 + muted。 */
function outcomeLabel (outcome) {
  const key = OUTCOME_LABEL_KEYS[outcome]
  return key ? t(key) : ''
}

function outcomeClass (outcome) {
  return OUTCOME_CLASS[outcome] || 'is-muted'
}

// ─── 错误码 → 文案键（PRD §7.5）───────────────────
// PRD 表里的键写作 accountsPage.cloudSync.err.<code>，但 vue-i18n 只按对象路径解析，
// 'cloudSync' 不能同时是按钮文案叶子与 err 的父对象；locale 实际落为 cloudSyncErr.<code>
// （沿用同命名空间 accountCheckStatus 的错误码表先例）。未登记的码返回空串：
// 后端原始 error 串不得直出到界面（i18n-user-facing-messages）。
const ERROR_CODE_KEYS = {
  UNAUTHORIZED: 'unauthorized',
  BUSINESS_USER_REPOSITORY_NOT_CONFIGURED: 'serviceUnavailable',
  KMS_UNAVAILABLE: 'kmsUnavailable',
  CREDENTIAL_TOO_LARGE: 'credentialTooLarge',
  SYNC_BUDGET_EXCEEDED: 'budgetExceeded',
  CLOUD_SYNC_IN_PROGRESS: 'inProgress',
}

function errorKeyFor (code) {
  const normalized = String(code || '')
  const suffix = ERROR_CODE_KEYS[normalized] || (normalized ? camelFromErrorCode(normalized) : '')
  if (!suffix) return ''
  const key = `accountsPage.cloudSyncErr.${suffix}`
  return te(key) ? key : ''
}

/** ACCOUNT_UID_INVALID → uidInvalid；未登记的码返回空串（不直出后端原文，避免技术串泄漏到 UI） */
function camelFromErrorCode (code) {
  const stripped = code.replace(/^(ACCOUNT|CREDENTIAL|CLOUD|SYNC|BUSINESS)_/, '')
  const parts = stripped.split('_').filter(Boolean).map(part => part.toLowerCase())
  if (!parts.length || parts.length > 3) return ''
  return parts[0] + parts.slice(1).map(part => part[0].toUpperCase() + part.slice(1)).join('')
}

function reasonFor (code) {
  const key = errorKeyFor(code)
  return key ? t(key) : ''
}

function rowKeyOf (payload) {
  const accountId = payload.accountId == null ? '' : String(payload.accountId)
  if (accountId) return accountId
  if (payload.index != null) return `${payload.platform || 'account'}-${payload.index}`
  return `${payload.platform || 'account'}-${rows.value.length}`
}

function upsertRow (payload, outcome) {
  const key = rowKeyOf(payload)
  const existing = rows.value.find(row => row.key === key)
  const next = {
    key,
    platform: String(payload.platform || existing?.platform || ''),
    name: payload.name != null ? String(payload.name) : (existing?.name ?? ''),
    outcome: outcome == null ? (existing?.outcome ?? '') : outcome,
    reason: payload.code ? reasonFor(payload.code) : (existing?.reason ?? ''),
  }
  next.label = props.platformLabel(next.platform) || next.platform
  if (existing) {
    rows.value = rows.value.map(row => (row.key === key ? next : row))
  } else {
    rows.value = [...rows.value, next]
  }
}

const doneCount = computed(() => rows.value.filter(row => row.outcome).length)
const syncPercent = computed(() => {
  const total = Number(progressTotal.value) || 0
  if (!total) return 0
  return Math.min(100, Math.round((doneCount.value / total) * 100))
})
const inflightLabels = computed(() => [...new Set(inflight.value)].map(id => props.platformLabel(id) || id))

function handleProgressEvent (payload) {
  if (!payload || typeof payload !== 'object') return
  const total = Number(payload.total) || 0
  if (total) progressTotal.value = total
  const platform = String(payload.platform || '')
  if (payload.phase === 'done') {
    upsertRow(payload, payload.outcome == null ? 'failed' : String(payload.outcome))
    if (platform) {
      const at = inflight.value.indexOf(platform)
      const next = inflight.value.slice()
      if (at !== -1) next.splice(at, 1)
      inflight.value = next
    }
    return
  }
  // start 边界（执行前）：先落一行「已发起」，让每条账号都有可观察的 start→done 两次变化
  upsertRow(payload, null)
  if (platform && !inflight.value.includes(platform)) inflight.value = [...inflight.value, platform]
}

function subscribeProgress () {
  if (offProgress) return
  try {
    const unsubscribe = onAccountsCloudSyncProgress(handleProgressEvent)
    if (typeof unsubscribe === 'function') offProgress = unsubscribe
  } catch (_) { /* 事件订阅失败不阻断批次（与一键检测同口径） */ }
}

function unsubscribeProgress () {
  if (!offProgress) return
  const unsubscribe = offProgress
  offProgress = null
  try { unsubscribe() } catch (_) { /* ignore */ }
}

// ─── 秒表 ──────────────────────────────────────
function startTicker () {
  stopTicker()
  elapsedSec.value = 0
  startedAt = Date.now()
  ticker = setInterval(() => {
    elapsedSec.value = Math.max(0, Math.floor((Date.now() - startedAt) / 1000))
  }, 1000)
}

function stopTicker () {
  if (ticker) {
    clearInterval(ticker)
    ticker = null
  }
}

// ─── 终态汇总 ──────────────────────────────────
const counters = computed(() => {
  const data = summary.value
  if (!data) return null
  const pick = key => Number(data[key]) || 0
  const created = pick('created')
  const updated = pick('updated')
  const unchanged = pick('unchanged')
  const restored = pick('restored')
  const skipped = pick('skipped')
  const conflicts = pick('conflicts')
  const invalid = pick('invalid')
  const failed = pick('failed')
  return {
    created,
    updated,
    unchanged,
    restored,
    skipped,
    conflicts,
    invalid,
    failed,
    ok: created + updated + unchanged + restored + conflicts,
    fail: invalid + failed,
  }
})

const summaryText = computed(() => {
  const c = counters.value
  if (!c) return ''
  if (c.ok === 0 && c.fail > 0) return t('accountsPage.cloudSyncAllFailed', { fail: c.fail })
  if (c.fail > 0) return t('accountsPage.cloudSyncPartial', { ok: c.ok, fail: c.fail })
  return t('accountsPage.cloudSyncDone', { created: c.created, updated: c.updated, restored: c.restored })
})

/** 汇总区逐类计数：优先按 items 的终态统计（与逐条列表同源，不会出现两个口径） */
const summaryStats = computed(() => {
  const items = Array.isArray(summary.value?.items) ? summary.value.items : []
  if (items.length) {
    const counts = new Map()
    for (const item of items) {
      const outcome = String(item?.outcome || 'failed')
      counts.set(outcome, (counts.get(outcome) || 0) + 1)
    }
    return [...counts.entries()]
      .filter(([outcome]) => OUTCOME_LABEL_KEYS[outcome])
      .map(([outcome, count]) => ({ outcome, count }))
  }
  const c = counters.value
  if (!c) return []
  return [
    { outcome: 'created', count: c.created },
    { outcome: 'updated', count: c.updated },
    { outcome: 'unchanged', count: c.unchanged },
    { outcome: 'restored', count: c.restored },
    { outcome: 'skipped-tombstone', count: c.skipped },
    { outcome: 'conflict-resolved-local', count: c.conflicts },
    { outcome: 'invalid-credential', count: c.invalid },
    { outcome: 'failed', count: c.failed },
  ].filter(item => item.count > 0)
})

// ─── 动作 ──────────────────────────────────────
function normalizeSummaryData (data) {
  const items = Array.isArray(data?.items) ? data.items : []
  return {
    created: Number(data?.created) || 0,
    updated: Number(data?.updated) || 0,
    unchanged: Number(data?.unchanged) || 0,
    restored: Number(data?.restored) || 0,
    skipped: Number(data?.skipped) || 0,
    conflicts: Number(data?.conflicts) || 0,
    invalid: Number(data?.invalid) || 0,
    failed: Number(data?.failed) || 0,
    items: items.map(item => ({
      platform: String(item?.platform || ''),
      accountId: item?.accountId == null ? '' : String(item.accountId),
      name: item?.name == null ? '' : String(item.name),
      outcome: item?.outcome == null ? 'failed' : String(item.outcome),
      code: item?.code == null ? '' : String(item.code),
    })),
  }
}

async function startSync () {
  if (running.value) return
  running.value = true
  emit('running-change', true)
  phase.value = 'running'
  rows.value = []
  inflight.value = []
  progressTotal.value = effectiveLocalCount.value
  elapsedSec.value = 0
  terminal.value = false
  summary.value = null
  batchErrorKey.value = ''
  stopping.value = false
  stopInert.value = false
  stoppedEarly.value = false
  startTicker()
  try {
    subscribeProgress()
    const result = await accountsCloudSync()
    if (result?.code === 0 && result.data) {
      summary.value = normalizeSummaryData(result.data)
      for (const item of summary.value.items) upsertRow(item, item.outcome || 'failed')
      emit('synced')
    } else {
      batchErrorKey.value = errorKeyFor(result?.error || result?.data?.errorCode || result?.code)
      if (batchErrorKey.value) notifyError(batchErrorKey.value)
      else notifyError('accountsPage.operationFailed', { message: t('accountsPage.operationFailed') })
    }
  } catch (error) {
    batchErrorKey.value = errorKeyFor(error?.code || error?.error)
    if (batchErrorKey.value) notifyError(batchErrorKey.value)
    else notifyError('accountsPage.operationFailed', { message: t('accountsPage.operationFailed') })
  } finally {
    // 退订 + 停表放在 finally：批次结束即停止订阅，不残留监听与定时器
    try { unsubscribeProgress() } finally {
      stopTicker()
      inflight.value = []
      running.value = false
      // 「已停止」只在批次自己收口的那一刻成立：stopping 仍为真说明主进程接受了中止
      stoppedEarly.value = stopping.value
      terminal.value = true
      emit('running-change', false)
    }
  }
}

/**
 * 请求中止进行中的批次（主进程 requestAbort：置标记，当前条完成后停止，不硬杀在途请求）。
 *
 * 三条口径：
 *   - aborted === true  → 只置 stopping，终态仍由批次返回决定（绝不在这里伪造「已停止」）；
 *   - aborted === false → 批次本就不在跑/已结束，按钮直接失效并等 startSync 的 finally 收口，不报错；
 *   - 调用失败         → 回滚按钮可重试，避免界面长期停在「正在停止…」而什么都没停。
 */
async function requestAbortSync () {
  if (stopping.value || stopInert.value) return
  stopping.value = true
  try {
    const result = await accountsCloudSyncAbort()
    if (result?.code === 0 && result?.data?.aborted === false) {
      stopping.value = false
      stopInert.value = true
      return
    }
    if (result?.code !== 0) {
      stopping.value = false
      notifyError('accountsPage.operationFailed', { message: t('accountsPage.operationFailed') })
    }
  } catch (_) {
    stopping.value = false
    notifyError('accountsPage.operationFailed', { message: t('accountsPage.operationFailed') })
  }
}

async function disconnectCloud () {
  if (disconnectDisabled.value) return
  const confirmed = await notifyConfirm('accountsPage.cloudDisconnectConfirm', {
    params: { count: Number(digest.value?.total) || 0 },
  })
  if (!confirmed) return
  disconnecting.value = true
  try {
    const result = await accountsCloudDisconnect('cloud')
    if (result?.code === 0 && result.data) {
      notifySuccess('accountsPage.cloudDisconnectSuccess')
      await loadDigest()
      return
    }
    // 部分失败：保留入口并如实报已删/剩余（PRD §11 最后一行），不隐藏「断开云端」
    notifyError('accountsPage.cloudDisconnectFailed', {
      params: {
        deleted: Number(result?.data?.deletedAccounts ?? result?.deletedAccounts ?? 0),
        remaining: Number(result?.remaining ?? result?.data?.remaining ?? 0),
      },
    })
  } catch (_) {
    notifyError('accountsPage.cloudDisconnectFailed', {
      params: { deleted: 0, remaining: Number(digest.value?.total) || 0 },
    })
  } finally {
    disconnecting.value = false
  }
}

// ─── 浮层互斥 + 生命周期 ────────────────────────
async function suspendOverlay () {
  if (overlayHeld) return
  overlayHeld = true
  try {
    await suspendEmbeddedViewsForOverlay(OVERLAY_OWNER)
  } catch (_) {
    overlayHeld = false
  }
}

async function releaseOverlay () {
  if (!overlayHeld) return
  overlayHeld = false
  await releaseEmbeddedViewsForOverlay(OVERLAY_OWNER)
}

/**
 * 关闭弹窗：进行中关闭 = 后台继续（不取消已发起的批次），但必须退订进度事件并停表；
 * 释放内嵌视图挂起一律走 finally（AGENTS.md overlay 合同）。
 */
async function requestClose () {
  try {
    if (running.value) unsubscribeProgress()
  } finally {
    stopTicker()
    await releaseOverlay()
  }
  emit('close')
}

// immediate：父级可能以 visible=true 直接挂载（独立夹具/测试），此时同样要复位状态并拉摘要
watch(() => props.visible, async (open, previous) => {
  if (open && !previous) {
    phase.value = 'digest'
    terminal.value = false
    summary.value = null
    batchErrorKey.value = ''
    rows.value = []
    inflight.value = []
    stopping.value = false
    stopInert.value = false
    stoppedEarly.value = false
    digestState.value = 'loading'
    await suspendOverlay()
    await loadDigest()
  } else if (!open && previous) {
    await requestClose()
  }
}, { immediate: true })

onBeforeUnmount(() => {
  unsubscribeProgress()
  stopTicker()
  releaseOverlay()
})
</script>

<style scoped>
.cloud-sync-dialog { display: flex; flex-direction: column; gap: var(--apple-space-3); }
.cloud-sync-line { margin: 0; color: var(--apple-ink-secondary); font-size: var(--apple-size-sm); line-height: 1.5; }
.cloud-digest-total { color: var(--apple-ink-primary); font-weight: var(--apple-weight-semibold); }
.cloud-digest-error { color: var(--apple-error); }
.cloud-digest-platforms { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--apple-space-1); }
.cloud-digest-platform { display: grid; grid-template-columns: 24px minmax(0, 1fr) auto; align-items: center; gap: var(--apple-space-2); color: var(--apple-ink-secondary); font-size: var(--apple-size-sm); }
.cloud-digest-platform-icon { width: 24px; height: 24px; display: grid; place-items: center; border-radius: 6px; background: var(--apple-surface-tertiary); font-size: var(--apple-size-xs); }
.cloud-digest-platform-icon-img { width: 20px; height: 20px; object-fit: contain; }
.cloud-digest-platform-count { color: var(--apple-ink-primary); font-size: var(--apple-size-sm); }
.cloud-sync-hint { margin: 0; padding: var(--apple-space-2) var(--apple-space-3); border-radius: var(--apple-radius-sm); background: var(--apple-surface-tertiary); color: var(--apple-ink-secondary); font-size: var(--apple-size-xs); line-height: 1.5; }

.cloud-sync-progress-head { display: flex; align-items: baseline; justify-content: space-between; gap: var(--apple-space-2); }
.cloud-sync-progress-text { color: var(--apple-ink-primary); font-size: var(--apple-size-sm); font-weight: var(--apple-weight-semibold); }
.cloud-sync-elapsed { color: var(--apple-ink-secondary); font-size: var(--apple-size-xs); }
/* 进度条样式口径复用 Accounts.vue 的 .batch-check-bar（同名 scoped 规则，两处视觉一致） */
.batch-check-bar { width: 100%; height: 6px; overflow: hidden; border-radius: 3px; background: #f0f0f5; }
.batch-check-bar-inner { height: 100%; border-radius: 3px; background: linear-gradient(90deg, #6a62f0, #5048e5); transition: width 0.3s ease; }

.cloud-sync-items { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--apple-space-1); max-height: 240px; overflow-y: auto; }
.cloud-sync-item { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: baseline; gap: var(--apple-space-2); font-size: var(--apple-size-sm); color: var(--apple-ink-primary); }
.cloud-sync-item-platform { color: var(--apple-ink-secondary); }
.cloud-sync-item-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cloud-sync-item-outcome { font-size: var(--apple-size-xs); }
.cloud-sync-item-reason { grid-column: 1 / -1; color: var(--apple-ink-secondary); font-size: var(--apple-size-xs); }
.is-success { color: var(--apple-success, #1f7a4d); }
.is-muted { color: var(--apple-ink-secondary); }
.is-warning { color: var(--apple-warning, #a2650b); }
.is-danger { color: var(--apple-error); }

.cloud-sync-summary { padding-top: var(--apple-space-2); border-top: 1px solid var(--apple-border-subtle); display: flex; flex-direction: column; gap: var(--apple-space-2); }
.cloud-sync-summary-text { margin: 0; font-size: var(--apple-size-sm); font-weight: var(--apple-weight-semibold); color: var(--apple-ink-primary); }
.cloud-sync-summary-error { margin: 0; font-size: var(--apple-size-sm); color: var(--apple-error); }
.cloud-sync-summary-stopped { margin: 0; font-size: var(--apple-size-xs); color: var(--apple-ink-secondary); }
.cloud-sync-summary-stats { display: flex; flex-wrap: wrap; gap: var(--apple-space-2); font-size: var(--apple-size-xs); }
</style>
