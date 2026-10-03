<template>
  <div
    class="ppp__task"
    data-testid="publish-progress-task"
    :class="'ppp__task--' + task.phase"
  >
    <span class="ppp__task-platform">{{ platformLabel(task.platform) }}</span>
    <span class="ppp__task-status">
      <el-icon v-if="task.phase === 'success'" class="ppp__icon ppp__icon--success ppp__pop"><CircleCheckFilled /></el-icon>
      <el-icon v-else-if="task.phase === 'failed'" class="ppp__icon ppp__icon--failed"><CircleCloseFilled /></el-icon>
      <el-icon v-else-if="task.phase === 'cancelled'" class="ppp__icon ppp__icon--cancelled"><RemoveFilled /></el-icon>
      <el-icon v-else-if="task.phase === 'retry'" class="ppp__icon ppp__icon--retry"><RefreshRight /></el-icon>
      <el-icon v-else-if="task.phase === 'blocked' || task.phase === 'queued'" class="ppp__icon ppp__icon--blocked"><Clock /></el-icon>
      <el-icon v-else class="ppp__icon ppp__icon--running ppp__spin"><Loading /></el-icon>
      <span class="ppp__task-status-text">{{ statusText }}</span>
    </span>
    <!-- 步骤指示：dot-stepper（6 圆点+连线，仅当前步词在状态列承载）——
         publish-progress-panel-refine 取代整链 6 词文字（视觉降噪主刀口） -->
    <span v-if="showStepChain" class="ppp__steps" data-testid="publish-progress-steps" aria-hidden="true">
      <template v-for="(step, idx) in STEP_CHAIN" :key="step">
        <span
          v-if="idx > 0"
          class="ppp__step-line"
          :class="{ 'ppp__step-line--past': isPastStep(task.stageKey, step) }"
        ></span>
        <span
          class="ppp__dot"
          :class="{
            'ppp__dot--current': task.stageKey === step,
            'ppp__dot--past': isPastStep(task.stageKey, step),
          }"
        ></span>
      </template>
    </span>
    <span v-else-if="task.phase === 'failed'" class="ppp__task-error" :title="task.error">
      {{ truncateError(task.error) }}
    </span>
    <span v-else-if="task.phase === 'blocked' && task.remainingWait" class="ppp__task-wait">
      {{ t('publishPage.publishProgressPanel.blockedWaitMinutes', { minutes: Math.max(1, Math.ceil(task.remainingWait / 60000)) }) }}
      <span
        v-if="blockedBucketLabel"
        class="ppp__task-wait-bucket"
        data-testid="publish-progress-task-bucket"
      >{{ blockedBucketLabel }}</span>
    </span>
    <span v-else-if="task.stageKey === 'detail' && task.stage" class="ppp__task-detail">
      {{ task.stage }}
    </span>
    <span v-if="showPercent" class="ppp__task-percent">
      {{ task.percent }}%
    </span>
    <!-- 失败行内联操作（publish-progress-panel-refine）：单任务重试 + 复制完整错误 -->
    <span v-if="task.phase === 'failed'" class="ppp__task-actions">
      <button
        type="button"
        class="ppp__row-btn"
        data-testid="publish-progress-task-retry"
        :title="t('publishPage.publishProgressPanel.retryTask')"
        :aria-label="t('publishPage.publishProgressPanel.retryTask')"
        @click="$emit('retry')"
      >
        <el-icon><RefreshRight /></el-icon>
      </button>
      <button
        type="button"
        class="ppp__row-btn"
        data-testid="publish-progress-task-copy-error"
        :title="t('publishPage.publishProgressPanel.copyError')"
        :aria-label="t('publishPage.publishProgressPanel.copyError')"
        @click="$emit('copy-error', task.error)"
      >
        <el-icon><CopyDocument /></el-icon>
      </button>
    </span>
  </div>
</template>

<script setup>
/**
 * PublishProgressTaskRow —— 发布进度面板的单任务行（publish-progress-ux）
 *
 * publish-progress-panel-refine 重构（2026-09-29）：
 * - 固定网格对齐（平台 | 状态 | 步骤/明细/错误 | 百分比右对齐 | 操作），取代 flex-wrap 跳动。
 * - dot-stepper 取代 6 词文字步骤链：过去步实心、当前步主色+脉冲、未来步空心；
 *   仅当前步一个词（由状态列承载最具体状态——运行行显示阶段词而非「进行中」）。
 * - queued 不预渲染步骤链（未开始不预支 6 步认知负担）；success 不显示 100%（终态图标已表达）。
 * - cancelled 中性态（非失败红态）；failed 行内联「重试此任务」「复制错误信息」（emit 上抛，
 *   本组件保持纯展示：props 单向 + 事件，不 import store、无剪贴板副作用）。
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  CircleCheckFilled, CircleCloseFilled, Clock, CopyDocument, Loading, RefreshRight, RemoveFilled,
} from '@element-plus/icons-vue'

const props = defineProps({
  /** TaskState（store publishProgress 会话内单任务） */
  task: { type: Object, required: true },
})

defineEmits(['retry', 'copy-error'])

const { t } = useI18n()

/** 步骤链（stageKey 顺序；waiting/retry/blocked/failed/cancelled/detail 以状态标签表达不进链） */
const STEP_CHAIN = ['prepare', 'upload', 'fill', 'submit', 'verify', 'done']

function platformLabel(platform) {
  if (!platform) return ''
  const key = 'home.platforms.' + platform
  const translated = t(key)
  // 缺 key 时 vue-i18n 返回 key 原文——回退平台原始 id（不泄漏 key 形态）
  return typeof translated === 'string' && translated !== key ? translated : platform
}

function statusLabel(phase) {
  const map = {
    queued: 'statusQueued',
    start: 'statusRunning',
    progress: 'statusRunning',
    retry: 'statusRetry',
    blocked: 'statusBlocked',
    success: 'statusSuccess',
    failed: 'statusFailed',
    cancelled: 'statusCancelled',
  }
  return t('publishPage.publishProgressPanel.' + (map[phase] || 'statusRunning'))
}

function stageLabel(stageKey) {
  const map = {
    prepare: 'stagePrepare', upload: 'stageUpload', fill: 'stageFill',
    submit: 'stageSubmit', verify: 'stageVerify', waiting: 'stageWaiting',
    done: 'stageDone', failed: 'stageFailed', detail: 'stageDetail',
  }
  return t('publishPage.publishProgressPanel.' + (map[stageKey] || 'stageDetail'))
}

/**
 * 状态列承载「最具体状态」：运行行显示当前阶段词（如「上传」）而非笼统「进行中」，
 * 消除「进行中 + 上传 + 40%」三重表达中的冗余一重；其余相位显示状态词。
 */
const statusText = computed(() => {
  const phase = props.task.phase
  if (phase === 'start' || phase === 'progress') {
    if (STEP_CHAIN.includes(props.task.stageKey)) return stageLabel(props.task.stageKey)
    if (props.task.stageKey === 'detail' && props.task.stage) return truncateStage(props.task.stage)
    return statusLabel(phase)
  }
  return statusLabel(phase)
})

const showStepChain = computed(() =>
  (props.task.phase === 'start' || props.task.phase === 'progress') && STEP_CHAIN.includes(props.task.stageKey))

/** 百分比只在运行行显示：success 的 100% 与终态图标四重冗余（去重），终态/排队不显示 */
const showPercent = computed(() =>
  props.task.percent !== null && props.task.percent !== undefined
  && (props.task.phase === 'start' || props.task.phase === 'progress'))

/** 阻塞归因只认守卫产出的两档取值（account/platform）；其他取值不渲染标签，避免把未知口径猜成一种归因 */
const blockedBucketLabel = computed(() => {
  const bucket = props.task.bucket
  if (bucket === 'account') return t('publishPage.publishProgressPanel.blockedBucketAccount')
  if (bucket === 'platform') return t('publishPage.publishProgressPanel.blockedBucketPlatform')
  return ''
})

function isPastStep(current, step) {
  const currentIdx = STEP_CHAIN.indexOf(current)
  const stepIdx = STEP_CHAIN.indexOf(step)
  return currentIdx >= 0 && stepIdx >= 0 && stepIdx < currentIdx
}

function truncateError(error) {
  const text = String(error || '')
  return text.length > 120 ? text.slice(0, 120) + '…' : text
}

function truncateStage(stage) {
  const text = String(stage || '')
  return text.length > 16 ? text.slice(0, 16) + '…' : text
}
</script>

<style scoped>
/* 固定网格对齐（publish-progress-panel-refine）：平台/状态/操作为固定槽，
   中部内容 flex 填充，百分比与操作右对齐——多行间列位稳定不跳动 */
.ppp__task {
  display: flex;
  align-items: center;
  gap: var(--spacing-2);
  font-size: var(--font-size-xs);
  color: var(--color-text-secondary);
  min-width: 0;
}

.ppp__task-platform {
  flex: 0 0 auto;
  min-width: 56px;
  font-weight: 500;
  color: var(--color-text-primary);
}

.ppp__task-status {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  flex: 0 0 auto;
}

.ppp__task-status-text {
  color: var(--color-text-secondary);
}

/* 状态色收敛（publish-progress-panel-refine）：只给图标着语义色，文字统一中性——
   小浮窗里四种饱和色文字同时出现是「不精致」的成因 */
.ppp__icon--success { color: var(--color-success); }
.ppp__icon--failed { color: var(--color-danger); }
.ppp__icon--retry,
.ppp__icon--blocked { color: var(--color-warning); }
.ppp__icon--cancelled { color: var(--color-text-muted); }
.ppp__icon--running { color: var(--color-primary); }

/* dot-stepper：未来步空心、过去步实心灰、当前步主色+脉冲 */
.ppp__steps {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  flex: 1 1 auto;
  min-width: 0;
  margin-left: var(--spacing-1);
}

.ppp__dot {
  flex: 0 0 auto;
  width: 7px;
  height: 7px;
  box-sizing: border-box;
  border-radius: var(--radius-full);
  border: 1px solid var(--color-border-strong);
  background: transparent;
}

.ppp__dot--past {
  border: none;
  background: var(--color-text-muted);
}

.ppp__dot--current {
  width: 9px;
  height: 9px;
  border: none;
  background: var(--color-primary);
  animation: ppp-pulse 1.6s ease-in-out infinite;
}

.ppp__step-line {
  flex: 1 1 auto;
  min-width: 6px;
  height: 2px;
  border-radius: 1px;
  background: var(--color-border-strong);
}

.ppp__step-line--past {
  background: var(--color-text-muted);
}

.ppp__task-detail {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ppp__task-error {
  flex: 1 1 auto;
  min-width: 0;
  color: var(--color-danger);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ppp__task-percent {
  flex: 0 0 auto;
  margin-left: auto;
  font-variant-numeric: tabular-nums;
  color: var(--color-text-secondary);
}

.ppp__task-wait {
  flex: 1 1 auto;
  min-width: 0;
  color: var(--color-warning);
}

.ppp__task-wait-bucket {
  margin-left: 4px;
  color: var(--color-text-muted);
}

.ppp__task-actions {
  flex: 0 0 auto;
  margin-left: auto;
  display: inline-flex;
  gap: 2px;
}

.ppp__row-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  padding: 0;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--color-text-secondary);
  cursor: pointer;
}

.ppp__row-btn:hover {
  background: var(--color-bg-inset);
  color: var(--color-primary);
}

.ppp__spin {
  animation: ppp-rotate 1.2s linear infinite;
}

/* 成功图标入场（pop-in，240ms 与进度条过渡同节奏） */
.ppp__pop {
  animation: ppp-pop 240ms ease-out;
}

@keyframes ppp-rotate {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

@keyframes ppp-pulse {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.35); }
}

@keyframes ppp-pop {
  from { transform: scale(0.4); opacity: 0; }
  to { transform: scale(1); opacity: 1; }
}

@media (prefers-reduced-motion: reduce) {
  .ppp__spin,
  .ppp__pop {
    animation: none;
  }

  .ppp__dot--current {
    animation: none;
  }
}
</style>
