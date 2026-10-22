<template>
  <!-- 单会话扁平（去卡中卡嵌套/去会话徽标重复）；多会话分组卡+点徽标 -->
  <div class="ppp__session" :class="{ 'ppp__session--flat': single }">
    <div v-if="!single" class="ppp__session-head">
      <span class="ppp__session-title" :title="sessionTitle(session)">{{ sessionTitle(session) }}</span>
      <span class="ppp__session-badge" :class="session.status === 'done' ? 'ppp__session-badge--done' : 'ppp__session-badge--running'">
        <span class="ppp__session-badge-dot"></span>
        {{ session.status === 'done'
          ? t('publishPage.publishProgressPanel.sessionDone')
          : t('publishPage.publishProgressPanel.sessionRunning') }}
      </span>
    </div>
    <PublishProgressTaskRow
      v-for="taskId in session.taskOrder"
      :key="taskId"
      :task="session.tasks[taskId]"
      :stall-minutes="stall.taskStallMinutes(taskId)"
      @retry="emit('retry', session, taskId)"
      @copy-error="emit('copy-error', $event)"
    />
    <button
      v-if="session.status === 'done' && store.sessionFailedCount(session.id) > 0"
      type="button"
      class="ppp__retry-btn"
      data-testid="publish-progress-retry-failed"
      :disabled="store.retrying"
      @click="emit('retry-failed', session)"
    >
      <el-icon><RefreshRight /></el-icon>
      {{ store.retrying
        ? t('publishPage.publishProgressPanel.retrying')
        : t('publishPage.publishProgressPanel.retryFailed', { count: store.sessionFailedCount(session.id) }) }}
    </button>
  </div>
</template>

<script setup>
/**
 * PublishProgressSession —— 发布进度面板的会话分组卡（publish-progress-panel-refine）
 *
 * 职责：会话头（标题+点徽标，仅多会话）+ 任务行列表 + 会话级「重试失败项」按钮。
 * - 单会话（single=true）扁平呈现：无卡片边框/底色嵌套、无会话徽标（与头部聚合徽标重复）。
 * - 任务行内联重试/复制经 emit 上抛（携带 session 上下文），Panel 持有 store 调用——
 *   本组件不直接改写任务状态（retry-failed 点击上抛，Panel 调 store.retryFailed）。
 * - 独立组件（逐文件行数门禁 < 500 行，PublishProgressPanel.vue 拆分承载面之一）。
 */
import { useI18n } from 'vue-i18n'
import { RefreshRight } from '@element-plus/icons-vue'
import { usePublishProgressStore } from '@/stores/publishProgress'
import { usePublishProgressStall } from '@/stores/publishProgressStall'
import PublishProgressTaskRow from './PublishProgressTaskRow.vue'

defineProps({
  /** Session（store publishProgress 会话） */
  session: { type: Object, required: true },
  /** 单会话扁平模式（Panel computed isSingleSession 传入） */
  single: { type: Boolean, default: false },
})

const emit = defineEmits(['retry', 'copy-error', 'retry-failed'])

const { t } = useI18n()
const store = usePublishProgressStore()
// 与 Panel 取到的是同一个 tracker（按 store 实例缓存）—— 同一分钟数只能有一份真相。
const stall = usePublishProgressStall(store)

function sessionTitle(session) {
  if (session.title) return session.title
  if (session.recovered) return t('publishPage.publishProgressPanel.recoveredTitle')
  const time = new Date(session.createdAt || Date.now())
    .toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
  return t('publishPage.publishProgressPanel.sessionTitleTimeFallback', { time })
}
</script>

<style scoped>
.ppp__session {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-1);
  padding: var(--spacing-2);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-bg-inset);
}

/* 单会话扁平（publish-progress-panel-refine）：去卡中卡嵌套 */
.ppp__session--flat {
  padding: 0;
  border: none;
  background: transparent;
}

.ppp__session-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--spacing-2);
}

.ppp__session-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--font-size-sm);
  font-weight: 500;
  color: var(--color-text-primary);
}

/* 会话徽标（publish-progress-panel-refine）：点+文字，去色块底（状态色收敛） */
.ppp__session-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  flex: 0 0 auto;
  font-size: var(--font-size-xs);
  color: var(--color-text-secondary);
}

.ppp__session-badge-dot {
  width: 6px;
  height: 6px;
  border-radius: var(--radius-full);
  background: var(--color-primary);
}

.ppp__session-badge--done .ppp__session-badge-dot {
  background: var(--color-success);
}

.ppp__retry-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  align-self: flex-start;
  margin-top: var(--spacing-1);
  padding: 3px 10px;
  border: 1px solid var(--color-border-strong, var(--color-border));
  border-radius: var(--radius-sm);
  background: var(--color-bg-card);
  color: var(--color-text-primary);
  font-size: var(--font-size-xs);
  cursor: pointer;
}

.ppp__retry-btn:hover:not(:disabled) {
  border-color: var(--color-primary);
  color: var(--color-primary);
}

.ppp__retry-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>