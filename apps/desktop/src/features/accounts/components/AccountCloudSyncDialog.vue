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

        <AccountCloudSyncDigestBody
          v-else
          :digest="digest"
          :local-count="effectiveLocalCount"
          :platform-label="platformLabel"
          :platform-icon="platformIcon"
        />
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

        <AccountCloudSyncItems
          v-if="rows.length"
          :rows="rows"
          :outcome-class="outcomeClass"
          :outcome-label="outcomeLabel"
        />

        <!-- 终态汇总区：只在批次结束后出现 -->
        <AccountCloudSyncSummary
          v-if="terminal"
          :summary-text="summaryText"
          :error-key="batchErrorKey"
          :stopped-early="stoppedEarly"
          :stats="summaryStats"
          :outcome-class="outcomeClass"
          :outcome-label="outcomeLabel"
        />
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
import { createCloudSyncResultModel } from '../composables/useCloudSyncResultModel'
import { createCloudSyncRows } from '../composables/useCloudSyncRows'
import { useI18n } from 'vue-i18n'
import AccountCloudSyncDigestBody from './AccountCloudSyncDigestBody.vue'
import AccountCloudSyncItems from './AccountCloudSyncItems.vue'
import AccountCloudSyncSummary from './AccountCloudSyncSummary.vue'
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

const elapsedSec = ref(0)
const running = ref(false)
const terminal = ref(false)
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

const disconnectDisabled = computed(() => digestState.value !== 'ready' || disconnecting.value || (Number(digest.value?.total) || 0) === 0)

/** 停止按钮只在「已请求且主进程已接受」或「批次本就不在跑」时失效；其余保持可点，让用户能重试。 */
const stopDisabled = computed(() => stopping.value || stopInert.value)

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

// 结果模型（outcome 标签/色调、错误码分组与兜底文案）拆到 useCloudSyncResultModel：
// 它是与组件状态无关的纯口径，且「失败行必须有文字」这条规则需要有唯一落点。
const {
  OUTCOME_LABEL_KEYS,
  batchErrorKeyFor,
  outcomeClass,
  outcomeLabel,
  reasonFor,
} = createCloudSyncResultModel({ t, te })

// 逐条行状态与终态汇总拆到 useCloudSyncRows：start/done 双边界、「汇总与逐条列表同源」
// 这两条口径都只能有一个落点，留在组件里就没法被单独验证。
const {
  rows,
  inflight,
  progressTotal,
  summary,
  upsertRow,
  doneCount,
  syncPercent,
  inflightLabels,
  handleProgressEvent,
  resetRows,
  summaryText,
  summaryStats,
} = createCloudSyncRows({
  t,
  platformLabel: id => props.platformLabel(id),
  reasonFor,
  OUTCOME_LABEL_KEYS,
})

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
    uidUnavailable: Number(data?.uidUnavailable) || 0,
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
  resetRows(effectiveLocalCount.value)
  elapsedSec.value = 0
  terminal.value = false
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
      batchErrorKey.value = batchErrorKeyFor(result?.error || result?.data?.errorCode || result?.code)
      if (batchErrorKey.value) notifyError(batchErrorKey.value)
      else notifyError('accountsPage.operationFailed', { message: t('accountsPage.operationFailed') })
    }
  } catch (error) {
    batchErrorKey.value = batchErrorKeyFor(error?.code || error?.error)
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
    batchErrorKey.value = ''
    resetRows()
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
.cloud-digest-error { color: var(--apple-error); }

.cloud-sync-progress-head { display: flex; align-items: baseline; justify-content: space-between; gap: var(--apple-space-2); }
.cloud-sync-progress-text { color: var(--apple-ink-primary); font-size: var(--apple-size-sm); font-weight: var(--apple-weight-semibold); }
.cloud-sync-elapsed { color: var(--apple-ink-secondary); font-size: var(--apple-size-xs); }
/* 进度条样式口径复用 Accounts.vue 的 .batch-check-bar（同名 scoped 规则，两处视觉一致） */
.batch-check-bar { width: 100%; height: 6px; overflow: hidden; border-radius: 3px; background: #f0f0f5; }
.batch-check-bar-inner { height: 100%; border-radius: 3px; background: linear-gradient(90deg, #6a62f0, #5048e5); transition: width 0.3s ease; }


</style>
