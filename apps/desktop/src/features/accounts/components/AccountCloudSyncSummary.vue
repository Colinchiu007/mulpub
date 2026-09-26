<template>
  <div class="cloud-sync-summary" data-testid="cloud-sync-summary">
    <p v-if="summaryText" class="cloud-sync-summary-text" role="status" data-testid="cloud-sync-summary-text">{{ summaryText }}</p>
    <p v-else-if="errorKey" class="cloud-sync-summary-error" role="alert" data-testid="cloud-sync-summary-error">{{ t(errorKey) }}</p>
    <!-- 中止只在主进程侧生效：本行只在批次真的带回「曾请求停止」时出现，点击时不预渲染 -->
    <p v-if="stoppedEarly" class="cloud-sync-summary-stopped" role="status" data-testid="cloud-sync-stopped">{{ t('accountsPage.cloudSyncStopped') }}</p>
    <div v-if="stats.length" class="cloud-sync-summary-stats" data-testid="cloud-sync-summary-stats">
      <span
        v-for="stat in stats"
        :key="stat.outcome"
        :class="['cloud-sync-stat', outcomeClass(stat.outcome)]"
        :data-testid="`cloud-sync-stat-${stat.outcome}`"
      >{{ outcomeLabel(stat.outcome) }} {{ stat.count }}</span>
    </div>
  </div>
</template>

<script setup>
/**
 * AccountCloudSyncSummary — 终态汇总区（PRD §10.3）。
 *
 * 出现时机由父级的 `v-if="terminal"` 决定：批次未收口不得渲染汇总，
 * 「已停止」也只在批次真的带回停止请求时才出现（不预渲染、不伪造）。
 */
import { useI18n } from 'vue-i18n'

defineProps({
  summaryText: { type: String, default: '' },
  /** 批次级错误文案键（与逐条错误码同一份分组口径；无键则不渲染错误行） */
  errorKey: { type: String, default: '' },
  stoppedEarly: { type: Boolean, default: false },
  stats: { type: Array, default: () => [] },
  outcomeClass: { type: Function, default: () => '' },
  outcomeLabel: { type: Function, default: value => String(value || '') },
})

const { t } = useI18n()
</script>

<style scoped>
.cloud-sync-summary { padding-top: var(--apple-space-2); border-top: 1px solid var(--apple-border-subtle); display: flex; flex-direction: column; gap: var(--apple-space-2); }
.cloud-sync-summary-text { margin: 0; font-size: var(--apple-size-sm); font-weight: var(--apple-weight-semibold); color: var(--apple-ink-primary); }
.cloud-sync-summary-error { margin: 0; font-size: var(--apple-size-sm); color: var(--apple-error); }
.cloud-sync-summary-stopped { margin: 0; font-size: var(--apple-size-xs); color: var(--apple-ink-secondary); }
.cloud-sync-summary-stats { display: flex; flex-wrap: wrap; gap: var(--apple-space-2); font-size: var(--apple-size-xs); }
.is-success { color: var(--apple-success, #1f7a4d); }
.is-muted { color: var(--apple-ink-secondary); }
.is-warning { color: var(--apple-warning, #a2650b); }
.is-danger { color: var(--apple-error); }
</style>
