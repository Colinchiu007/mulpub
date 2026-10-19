<template>
  <Teleport to="body">
    <!-- 展开浮卡：非模态（无遮罩、不阻塞交互、不接入浮层互斥合同——见
         PRD-OVERLAY-VIEW-SUSPENSION §6 与 PRD-PUBLISH-PROGRESS-UX §5.3/D4） -->
    <div
      v-if="store.panelVisible"
      class="publish-progress-panel"
      data-testid="publish-progress-panel"
      role="region"
      :aria-label="t('publishPage.publishProgressPanel.title')"
      @pointerdown="cancelAutoCollapse"
    >
      <div class="ppp__header">
        <span class="ppp__title">
          {{ t('publishPage.publishProgressPanel.title') }}
          <span v-if="store.hasRunning" class="ppp__badge ppp__badge--running">
            <el-icon class="ppp__spin"><Loading /></el-icon>
            {{ t('publishPage.publishProgressPanel.sessionRunning') }}
          </span>
        </span>
        <span class="ppp__actions">
          <button
            type="button"
            class="ppp__icon-btn"
            data-testid="publish-progress-minimize"
            :aria-label="t('publishPage.publishProgressPanel.minimize')"
            :title="t('publishPage.publishProgressPanel.minimize')"
            @click="handleMinimize"
          >
            <el-icon><Minus /></el-icon>
          </button>
          <button
            type="button"
            class="ppp__icon-btn"
            data-testid="publish-progress-close"
            :disabled="store.hasRunning"
            :title="store.hasRunning
              ? t('publishPage.publishProgressPanel.closeDisabledHint')
              : t('publishPage.publishProgressPanel.close')"
            :aria-label="t('publishPage.publishProgressPanel.close')"
            @click="handleClose"
          >
            <el-icon><Close /></el-icon>
          </button>
        </span>
      </div>

      <!-- 汇总行（panel-refine）：成功数直给（failed/cancelled 不计入「已完成」口径），单列 -->
      <div class="ppp__summary" data-testid="publish-progress-summary">
        <span>{{ t('publishPage.publishProgressPanel.summarySucceeded', { succeeded: store.aggregate.succeeded, total: store.aggregate.total }) }}</span>
        <span v-if="store.aggregate.failed > 0" class="ppp__summary-failed">
          {{ t('publishPage.publishProgressPanel.summaryFailed', { count: store.aggregate.failed }) }}
        </span>
        <span v-if="store.aggregate.cancelled > 0" class="ppp__summary-cancelled">
          {{ t('publishPage.publishProgressPanel.summaryCancelled', { count: store.aggregate.cancelled }) }}
        </span>
        <!-- 阶段 2.5（audit-14）：进度条改用软权重口径（在跑的任务按它自己的阶段百分比计入），
             并补一句「第 N / 共 M 项」这一**计数**出口——percent 不上报的链路也能说清在哪一步。
             注意「成功 x/total」仍走终态口径（done 没被软权重污染），两句话量的是不同的事。 -->
        <span
          v-if="store.aggregate.running > 0"
          class="ppp__summary-step"
          data-testid="publish-progress-step"
        >{{ t('publishPage.publishProgressPanel.summaryStep', { current: store.aggregate.step, total: store.aggregate.total }) }}</span>
        <span class="ppp__bar" role="progressbar"
          :aria-valuenow="store.aggregate.progressPercent"
          aria-valuemin="0" aria-valuemax="100"
        >
          <span class="ppp__bar-fill" :style="{ width: progressWidth }"></span>
        </span>
      </div>

      <div v-if="store.sessions.length === 0" class="ppp__empty">
        {{ t('publishPage.publishProgressPanel.emptyRunning') }}
      </div>

      <div v-else class="ppp__sessions">
        <PublishProgressSession
          v-for="session in store.sessions"
          :key="session.id"
          :session="session"
          :single="isSingleSession"
          @retry="handleTaskRetry"
          @copy-error="handleCopyError"
          @retry-failed="handleRetry"
        />
      </div>

      <PublishProgressFooter />
    </div>

    <!-- 最小化胶囊：常驻勿关提示（后台运行语义） -->
    <button
      v-else-if="store.panelMinimized && (store.hasRunning || store.sessions.length > 0)"
      type="button"
      class="publish-progress-pill"
      data-testid="publish-progress-pill"
      :aria-label="t('publishPage.publishProgressPanel.expand')"
      @click="store.expandPanel()"
    >
      <el-icon v-if="store.hasRunning" class="ppp__spin ppp__pill-icon"><Loading /></el-icon>
      <el-icon v-else class="ppp__pill-icon"><CircleCheckFilled /></el-icon>
      <span class="ppp__pill-text">
        {{ store.hasRunning
          ? t('publishPage.publishProgressPanel.pillRunning', { done: store.aggregate.done, total: store.aggregate.total })
          : t('publishPage.publishProgressPanel.pillDone', { done: store.aggregate.done, total: store.aggregate.total }) }}<template v-if="store.aggregate.failed > 0">{{ t('publishPage.publishProgressPanel.pillFailedPart', { count: store.aggregate.failed }) }}</template>
      </span>
      <span v-if="store.hasRunning" class="ppp__pill-hint">{{ t('publishPage.publishProgressPanel.hintRunning') }}</span>
    </button>
  </Teleport>
</template>

<script setup>
/**
 * PublishProgressPanel —— 发布进度全局面板（publish-progress-ux，2026-09-28）
 *
 * 挂载：App.vue 根级全局唯一实例，setup 内 store.init() 完成 App 级事件订阅。
 * 形态：展开浮卡（会话×任务×步骤状态）↔ 最小化胶囊；非模态（不接入浮层互斥合同）。
 *
 * publish-progress-panel-refine 重构（2026-09-29）：
 * - 汇总口径改「成功 N/M」直给；单会话扁平化；fallback 会话标题带时间。
 * - footer 警示条 + 取消入口（PublishProgressFooter.vue）；单任务重试/复制（TaskRow emit 上抛）。
 * - 完成自动收敛（usePublishProgressAutoCollapse.js）；@pointerdown 取消收敛。
 * - 会话卡拆出 PublishProgressSession.vue（逐文件行数门禁拆分承载面）。
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { ElMessage } from 'element-plus'
import {
  CircleCheckFilled, Close, Loading, Minus,
} from '@element-plus/icons-vue'
import { usePublishProgressStore } from '@/stores/publishProgress'
import { usePublishProgressAutoCollapse } from '@/composables/usePublishProgressAutoCollapse'
import PublishProgressFooter from './PublishProgressFooter.vue'
import PublishProgressSession from './PublishProgressSession.vue'

const { t } = useI18n()
const store = usePublishProgressStore()

store.init()

const progressWidth = computed(() => store.aggregate.progressPercent + '%')

const isSingleSession = computed(() => store.sessions.length === 1)

function handleMinimize() {
  store.minimizePanel()
  if (store.consumeFirstHideToast()) {
    ElMessage({
      message: t('publishPage.publishProgressPanel.firstHideToast'),
      type: 'info',
      duration: 6000,
      showClose: true,
    })
  }
}

function handleClose() {
  store.clearFinished()
  if (store.sessions.length === 0) store.panelVisible = false
}

async function handleRetry(session) {
  const result = await store.retryFailed(session.id)
  if (result && (result.ok > 0 || result.fail > 0)) {
    ElMessage({
      message: t('publishPage.publishProgressPanel.retryPartial', { ok: result.ok, fail: result.fail }),
      type: result.fail > 0 ? 'warning' : 'success',
      duration: 4000,
    })
  }
}

/** 单任务内联重试（Session/TaskRow @retry 上抛 session+taskId） */
async function handleTaskRetry(session, taskId) {
  const result = await store.retryOne(session.id, taskId)
  if (result && (result.ok > 0 || result.fail > 0)) {
    ElMessage({
      message: t('publishPage.publishProgressPanel.retryPartial', { ok: result.ok, fail: result.fail }),
      type: result.fail > 0 ? 'warning' : 'success',
      duration: 4000,
    })
  }
}

/** 复制完整错误文本（TaskRow @copy-error 上抛；剪贴板失败如实 toast） */
async function handleCopyError(error) {
  const text = String(error || '')
  if (!text) return
  try {
    await navigator.clipboard.writeText(text)
    ElMessage({ message: t('publishPage.publishProgressPanel.copied'), type: 'success', duration: 2500 })
  } catch {
    ElMessage({ message: t('publishPage.publishProgressPanel.copyFailed'), type: 'error', duration: 2500 })
  }
}

const { cancelAutoCollapse } = usePublishProgressAutoCollapse({
  hasRunning: computed(() => store.hasRunning),
  panelVisible: computed(() => store.panelVisible),
  panelMinimized: computed(() => store.panelMinimized),
  aggregate: () => store.aggregate,
  sessionCount: () => store.sessions.length,
  minimizePanel: () => store.minimizePanel(),
})
</script>

<style scoped>
/* 定位口径：右下角、BackToTop(1900) 之上、UpdateNotification(2000) 之下；
   bottom 抬高避让 BackToTop 44px 按钮（PRD-PUBLISH-PROGRESS-UX §5.3） */
.publish-progress-panel {
  position: fixed;
  right: var(--spacing-6);
  bottom: calc(var(--spacing-6) + 52px);
  z-index: 1950;

  display: flex;
  flex-direction: column;
  width: 380px;
  max-height: 60vh;
  padding: var(--spacing-3) var(--spacing-4);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  background: var(--color-bg-card);
  box-shadow: var(--shadow-float);
  overflow: hidden;
}

.ppp__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--spacing-2);
  padding-bottom: var(--spacing-2);
}

.ppp__title {
  display: flex;
  align-items: center;
  gap: var(--spacing-2);
  font-size: var(--font-size-md);
  font-weight: 600;
  color: var(--color-text-strong);
}

.ppp__badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 1px 8px;
  border-radius: var(--radius-full);
  font-size: var(--font-size-xs);
  font-weight: 500;
}

.ppp__badge--running {
  color: var(--color-primary);
  background: var(--color-primary-light, rgba(80, 72, 229, 0.1));
}

.ppp__actions {
  display: flex;
  gap: 4px;
}

.ppp__icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--color-text-secondary);
  cursor: pointer;
}

.ppp__icon-btn:hover:not(:disabled) {
  background: var(--color-bg-inset);
  color: var(--color-text-strong);
}

.ppp__icon-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.ppp__summary {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--spacing-2);
  padding-bottom: var(--spacing-2);
  font-size: var(--font-size-sm);
  color: var(--color-text-secondary);
}

.ppp__summary-failed {
  color: var(--color-danger);
}

.ppp__summary-cancelled {
  color: var(--color-text-muted);
}

/* 阶段 2.5：与"成功 x/y"同排但语义不同（一个是完成数，一个是当前第几项），
   用次要色 + 前置间隔点，避免读成两个互相矛盾的计数 */
.ppp__summary-step {
  color: var(--color-text-muted);
}

.ppp__bar {
  position: relative;
  flex: 1 1 100%;
  height: 4px;
  border-radius: var(--radius-full);
  background: var(--color-bg-inset);
  overflow: hidden;
}

.ppp__bar-fill {
  position: absolute;
  inset: 0 auto 0 0;
  border-radius: var(--radius-full);
  background: var(--color-primary);
  transition: width 240ms ease-out;
}

.ppp__empty {
  padding: var(--spacing-4) 0;
  font-size: var(--font-size-sm);
  color: var(--color-text-muted);
  text-align: center;
}

.ppp__sessions {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-3);
  overflow-y: auto;
}

/* 最小化胶囊 */
.publish-progress-pill {
  position: fixed;
  right: var(--spacing-6);
  bottom: calc(var(--spacing-6) + 52px);
  z-index: 1950;

  display: inline-flex;
  align-items: center;
  gap: var(--spacing-2);
  max-width: 320px;
  padding: 6px 12px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-full);
  background: var(--color-bg-card);
  box-shadow: var(--shadow-float);
  color: var(--color-text-primary);
  font-size: var(--font-size-xs);
  cursor: pointer;
}

.publish-progress-pill:hover {
  border-color: var(--color-primary);
}

.ppp__pill-icon {
  flex-shrink: 0;
  color: var(--color-primary);
}

.ppp__pill-text {
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.ppp__pill-hint {
  flex-shrink: 0;
  padding-left: var(--spacing-2);
  border-left: 1px solid var(--color-border);
  color: var(--color-text-muted);
  white-space: nowrap;
}

.ppp__spin {
  animation: ppp-rotate 1.2s linear infinite;
}

@keyframes ppp-rotate {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

@media (prefers-reduced-motion: reduce) {
  .ppp__spin {
    animation: none;
  }

  .ppp__bar-fill {
    transition: none;
  }
}
</style>