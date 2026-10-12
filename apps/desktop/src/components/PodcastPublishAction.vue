<template>
  <UiModal
    v-if="visible"
    :visible="visible"
    :title="t('podcast.episode.title')"
    size="lg"
    test-id="podcast-publish-action"
    :close-on-esc="true"
    @close="requestClose"
  >
    <div class="podcast-episode" data-testid="podcast-episode-overlay">
      <!-- §6.4 交互与挂起合同：这句必须写在界面上，否则用户会拿关窗口当「停止」。 -->
      <p class="podcast-episode-note" data-testid="podcast-episode-close-hint">{{ t('podcast.episode.closeNotCancel') }}</p>

      <ol class="podcast-episode-phases" data-testid="podcast-episode-phases">
        <li
          v-for="step in EPISODE_PHASE_STEPS"
          :key="step"
          class="podcast-episode-phase"
          :data-state="phaseState(step)"
          :data-testid="`podcast-episode-phase-${step}`"
        >{{ t('podcast.episode.phase.' + step) }}</li>
      </ol>

      <p v-if="publishing" class="podcast-episode-running" data-testid="podcast-episode-running">{{ t('podcast.episode.running') }}</p>
      <!-- §6.4.2 降级路径：主进程目前只给链末信封、没有 podcast:episode:publish:progress，
           所以这里显式说明「进度不可用，只能结束后回看」，绝不画一条停在首相位的假进度条。 -->
      <p v-if="publishing && !progressAvailable" class="podcast-episode-progress-unavailable" data-testid="podcast-episode-progress-unavailable">{{ t('podcast.episode.progressUnavailable') }}</p>

      <p
        v-if="measured"
        class="podcast-episode-measured"
        data-testid="podcast-episode-measured"
      >{{ t('podcast.episode.measured', { duration: measured.durationSec == null ? '-' : measured.durationSec, bytes: measured.sizeBytes == null ? '-' : measured.sizeBytes, mime: measured.mime || '-' }) }}</p>

      <p
        v-if="resultText"
        class="podcast-episode-result"
        :data-state="state"
        data-testid="podcast-episode-result"
      >{{ resultText }}</p>

      <p
        v-if="failureText"
        class="podcast-episode-failure"
        :data-code="failureCode"
        data-testid="podcast-episode-failure"
      >{{ failureText }}</p>

      <ul v-if="hasIssues" class="podcast-episode-issues" data-testid="podcast-episode-issues">
        <li v-for="(it, i) in issues" :key="i">{{ issueText(it) }}</li>
      </ul>

      <p v-if="detailText" class="podcast-episode-detail" data-testid="podcast-episode-detail">{{ t('podcast.episode.detail', { detail: detailText }) }}</p>

      <p v-if="cancelText" class="podcast-episode-cancel-state" :data-outcome="cancelOutcome || 'error'" data-testid="podcast-episode-cancel-state">{{ cancelText }}</p>

      <p v-if="retryText" class="podcast-episode-retry-state" :data-state="retryState" data-testid="podcast-episode-retry-state">{{ retryText }}</p>

      <div class="podcast-episode-actions">
        <button
          type="button"
          data-testid="podcast-episode-cancel"
          :disabled="!cancellable"
          :title="cancellable ? '' : t('podcast.episode.cancelDisabled')"
          @click="onCancel"
        >{{ t('podcast.episode.cancel') }}</button>
        <button
          v-if="state === 'partial'"
          type="button"
          data-testid="podcast-episode-retry-feed"
          :disabled="retrying || !activeChannelId"
          @click="onRetryFeed"
        >{{ t('podcast.hosting.retryFeed') }}</button>
      </div>

      <p v-if="!cancellable" class="podcast-episode-cancel-disabled" data-testid="podcast-episode-cancel-disabled">{{ t('podcast.episode.cancelDisabled') }}</p>
    </div>
  </UiModal>
</template>

<script setup>
/**
 * PodcastPublishAction.vue — 成片一键出期的应用级模态浮层（刀 3 第 4 片，PRD §6.4 显示项）
 *
 * 为什么是独立子组件而不是写进结果页/创作页：两个入口共用同一份状态机与同一组显示项，
 * 而两个页面都已贴着逐文件行数门禁的上限（ResultView 还被 targets 零容差盯着）。
 *
 * 两条不可破：
 * 1. **应用级模态必须挂起内嵌视图**（WebContentsView 是压在渲染 DOM 之上的原生图层，z-index 无效）。
 *    释放由 `visible` 状态驱动 ⇒ 走 `watch(visible)` 的 false 分支，并另加 `onBeforeUnmount` 兜底
 *    （父组件直接 v-if 掉本组件时 visible 不经过 false，少一条就是残留挂起计数）。
 *    owner 已在 src/overlay-view-suspension.test.js 登记。
 * 2. **相位与可取消性一律取自信封**（判据唯一实现在编排层）。本浮层不排相位、不猜相位：
 *    `phaseState` 只把「信封轨迹里出现过的相位」标成已完成，其余保持 pending；
 *    取消按钮的可点性只看 `cancellable`。
 *    §6.4.2 已裁决补第三条通道 `podcast:episode:publish:progress`（载荷带 `cancellable`，由主进程算）；
 *    在它落地之前，本浮层走该节明写的**降级路径**：显式声明「进度不可用，仅结束后回看轨迹」，
 *    取消按钮禁用并说明原因——不得画假进度条，也不得「点了试试」。
 */
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import UiModal from './UiModal.vue'
import { issueText } from '@/composables/usePodcastChannel'
import { releaseEmbeddedViewsForOverlay, suspendEmbeddedViewsForOverlay } from '@/composables/useEmbeddedViewSuspension'
import { EPISODE_PHASE_STEPS, usePodcastEpisodePublish } from '@/composables/usePodcastEpisodePublish'
import { usePodcastHosting } from '@/composables/usePodcastHosting'

const props = defineProps({
  visible: { type: Boolean, default: false },
  project: { type: Object, default: null },
  segments: { type: Array, default: null },
  videoPath: { type: String, default: '' },
  title: { type: String, default: '' },
})
const emit = defineEmits(['close'])
const { t } = useI18n()

const OVERLAY_OWNER = 'podcast-episode-publish-overlay'
let overlayHeld = false
let startedForThisOpen = false

const {
  publishing,
  issues,
  state,
  cancellable,
  reachedPhases,
  stopProgressWatch,
  progressAvailable,
  measured,
  cancelOutcome,
  failureCode,
  failureText,
  resultText,
  cancelText,
  detailText,
  hasIssues,
  activeChannelId,
  start,
  requestCancel,
} = usePodcastEpisodePublish()

// partial 的出口＝只重试 feed，复用同一条 podcast:feed:publish（不得为浮层另开第二份发布实现）。
const { publishing: retrying, publishResult, hostingError, publishFeed } = usePodcastHosting()

const retryState = computed(() => {
  if (hostingError.value) return 'failed'
  const st = publishResult.value && publishResult.value.state
  return st === 'success' ? 'success' : (st ? 'failed' : '')
})
const retryText = computed(() => {
  if (hostingError.value) return t('podcast.hosting.publishFailed', { status: hostingError.value })
  const res = publishResult.value
  if (!res) return ''
  if (res.state === 'success') return t('podcast.hosting.publishSuccess', { count: res.itemCount || 0 })
  return t('podcast.hosting.publishFailed', { status: res.status == null ? (res.code || t('podcast.hosting.checkNoStatus')) : res.status })
})

function phaseState (step) {
  if (step === 'cancelled') return state.value === 'cancelled' ? 'done' : 'pending'
  return reachedPhases.value.includes(step) ? 'done' : 'pending'
}

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

function requestClose () {
  emit('close')
}

function onCancel () {
  // 按钮只在信封给了可取消性时可点；这里不做二次判据，直接转给第二条通道。
  requestCancel()
}

function onRetryFeed () {
  publishFeed(activeChannelId.value)
}

function startPublish () {
  if (startedForThisOpen) return
  startedForThisOpen = true
  start({
    project: props.project,
    segments: Array.isArray(props.segments) ? props.segments : undefined,
    videoPath: props.videoPath,
    title: props.title,
  })
}

// 打开即挂起并发起出期（PRD §6.4「一次点击 → 一条完整出期链」）；关闭只关浮层，不取消链。
// immediate 覆盖「以 visible=true 首次挂载」这条路径。
watch(() => props.visible, (open) => {
  if (open) {
    suspendOverlay()
    // 关闭浮层不取消发布（链在主进程），所以重开时**不得**再发起第二条链：
    // publishing 为真即上一次点下的链还在跑，此刻只需继续显示它的实时进度。
    // 原写法在每次 open 都重置 startedForThisOpen 并调 start()，会在同一条链在途时开出第二条链
    //（QM-6 后端评审命中的 Warning：轻则被忙标记拒绝、重则真的出两期）。
    if (!publishing.value) {
      startedForThisOpen = false
      startPublish()
    }
  } else {
    releaseOverlay()
  }
}, { immediate: true })

// 兜底：父组件直接 v-if 掉本组件或路由切走时 visible 不经过 false，只靠上面那条会残留挂起计数。
onBeforeUnmount(() => {
  stopProgressWatch()
  releaseOverlay()
})
</script>

<style scoped>
.podcast-episode { display: flex; flex-direction: column; gap: 8px; }
.podcast-episode-note { margin: 0; color: var(--el-text-color-secondary); font-size: var(--font-size-sm); }
.podcast-episode-phases { margin: 0; padding-left: 20px; font-size: var(--font-size-sm); }
.podcast-episode-phase[data-state='done'] { color: var(--el-color-success); }
.podcast-episode-phase[data-state='pending'] { color: var(--el-text-color-secondary); }
.podcast-episode-measured,
.podcast-episode-detail { font-size: var(--font-size-sm); color: var(--el-text-color-secondary); word-break: break-all; }
.podcast-episode-result { font-size: var(--font-size-sm); }
.podcast-episode-result[data-state='success'] { color: var(--el-color-success); }
.podcast-episode-result[data-state='partial'] { color: var(--el-color-warning); }
.podcast-episode-failure { font-size: var(--font-size-sm); color: var(--el-color-danger); }
.podcast-episode-issues { margin: 0; padding-left: 18px; font-size: var(--font-size-sm); color: var(--el-color-warning); }
.podcast-episode-actions { display: flex; gap: 10px; margin-top: 6px; flex-wrap: wrap; }
.podcast-episode-actions button { padding: 4px 12px; border: 1px solid var(--el-border-color); border-radius: var(--radius-sm); background: var(--el-fill-color-blank); cursor: pointer; }
.podcast-episode-actions button:disabled { opacity: 0.5; cursor: not-allowed; }
.podcast-episode-cancel-disabled { margin: 0; font-size: var(--font-size-xs); color: var(--el-text-color-secondary); }
</style>
