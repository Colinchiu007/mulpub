<template>
  <ul class="cloud-sync-items" data-testid="cloud-sync-items">
    <!-- data-error-code 只服务排障与测试断言：后端原始码绝不作为文字直出（见 errorKeyFor） -->
    <li
      v-for="row in rows"
      :key="row.key"
      class="cloud-sync-item"
      :data-testid="`cloud-sync-item-${row.key}`"
      :data-error-code="row.code || null"
    >
      <span class="cloud-sync-item-platform">{{ row.label }}</span>
      <span class="cloud-sync-item-name" :data-testid="`cloud-sync-item-name-${row.key}`">{{ row.name }}</span>
      <span :class="['cloud-sync-item-outcome', outcomeClass(row.outcome)]" :data-testid="`cloud-sync-item-outcome-${row.key}`">{{ outcomeLabel(row.outcome) }}</span>
      <span v-if="row.reason" class="cloud-sync-item-reason" :data-testid="`cloud-sync-item-reason-${row.key}`">{{ row.reason }}</span>
    </li>
  </ul>
</template>

<script setup>
/**
 * AccountCloudSyncItems — 逐条同步结果列表（PRD §10.3）。
 *
 * 纯展示：行数据与 outcome 口径都由父级注入，本组件不得自行翻译 outcome，
 * 否则「失败行必须有文字」这条规则就会出现第二个落点。
 */
defineProps({
  rows: { type: Array, default: () => [] },
  outcomeClass: { type: Function, default: () => '' },
  outcomeLabel: { type: Function, default: value => String(value || '') },
})
</script>

<style scoped>
.cloud-sync-items { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--apple-space-1); max-height: 240px; overflow-y: auto; }
.cloud-sync-item { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: baseline; gap: var(--apple-space-2); font-size: var(--apple-size-sm); color: var(--apple-ink-primary); }
.cloud-sync-item-platform { color: var(--apple-ink-secondary); }
.cloud-sync-item-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cloud-sync-item-outcome { font-size: var(--apple-size-xs); }
.cloud-sync-item-reason { grid-column: 1 / -1; color: var(--apple-ink-secondary); font-size: var(--apple-size-xs); }
/* outcome 色调与汇总区共用同一组类名（口径由 useCloudSyncResultModel 的 outcomeClass 决定） */
.is-success { color: var(--apple-success, #1f7a4d); }
.is-muted { color: var(--apple-ink-secondary); }
.is-warning { color: var(--apple-warning, #a2650b); }
.is-danger { color: var(--apple-error); }
</style>
