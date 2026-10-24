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
          <!-- 无更新看门狗（阶段 1.8）：任务卡住不再发事件时如实说「已 N 分钟无更新」，
               并解禁关闭 —— 措辞只陈述观测事实（多久没动静），不断言任务已死（那是猜）。
               role=status + aria-live 让屏读用户与视觉用户同时得知状态跃迁（WCAG 4.1.3）。 -->
          <span
            v-if="staleness.stale"
            class="ppp__badge ppp__badge--stale"
            data-testid="publish-progress-stale"
            role="status"
            aria-live="polite"
          >
            {{ t('publishPage.publishProgressPanel.staleBadge', { minutes: staleness.minutes }) }}
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
            :disabled="closeBlocked"
            :title="closeTitle"
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
        <span class="ppp__bar" role="progressbar"
          :aria-valuenow="store.aggregate.total > 0 ? Math.round(store.aggregate.done / store.aggregate.total * 100) : 0"
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
      <!-- 陈旧态下胶囊的提示改成「已 N 分钟无更新」（阶段 1.8）：继续宣称「进行中请勿关闭」
           会把一个未经证实的判断说给用户听；转圈保留，因为任务确实可能仍在后台跑。 -->
      <span v-if="staleness.stale" class="ppp__pill-hint">{{ t('publishPage.publishProgressPanel.staleBadge', { minutes: staleness.minutes }) }}</span>
      <span v-else-if="store.hasRunning" class="ppp__pill-hint">{{ t('publishPage.publishProgressPanel.hintRunning') }}</span>
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
import { usePublishProgressStaleness } from '@/composables/usePublishProgressStaleness'
import PublishProgressFooter from './PublishProgressFooter.vue'
import PublishProgressSession from './PublishProgressSession.vue'

const { t } = useI18n()
const store = usePublishProgressStore()

store.init()

// 无更新看门狗（阶段 1.8）：判据本体在 utils/publish-progress-staleness.js（阈值单点），
// 计时器由本组件持有（与自动收敛同源），store 保持纯状态。
const { staleness } = usePublishProgressStaleness({
  hasRunning: computed(() => store.hasRunning),
  sessions: () => store.sessions,
})

const closeBlocked = computed(() => store.hasRunning && !staleness.value.stale)

const closeTitle = computed(() => {
  if (closeBlocked.value) return t('publishPage.publishProgressPanel.closeDisabledHint')
  if (staleness.value.stale) return t('publishPage.publishProgressPanel.staleCloseHint')
  return t('publishPage.publishProgressPanel.close')
})

const progressWidth = computed(() => {
  const { done, total } = store.aggregate
  if (!total) return '0%'
  return Math.round((done / total) * 100) + '%'
})

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
  if (store.sessions.length === 0) {
    store.panelVisible = false
    return
  }
  // 还有运行中的会话：非陈旧态下 × 是禁用按钮（走不到这里）；陈旧态下语义是「收起」而不是
  // 「丢弃」——任务可能仍在后台跑，直接把会话从 store 摘掉会让它后来到达的成功/失败事件
  // 变成看不见的孤儿（证据丢失）。收进胶囊保留一条回程，面板也确实消失了（不是死按钮）。
  if (staleness.value.stale) store.minimizePanel()
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

/* 陈旧徽标（阶段 1.8）：复用既有语义 token，不新增色槽。
   对比按实测而非目测——浅档 #1e1b4b on #fef3c7 = 14.36:1，暗档 #f5f5f7 on #33240c = 13.79:1，
   两档都远高于 AA 的 4.5:1（暗色覆盖由 tokens.css 的 --color-warning-soft 同名槽负责）。 */
.ppp__badge--stale {
  color: var(--color-text-strong);
  background: var(--color-warning-soft);
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