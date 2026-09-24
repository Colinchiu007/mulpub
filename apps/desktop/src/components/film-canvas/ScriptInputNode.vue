<script setup>
// 影视工程画布 - 剧本输入节点（工程源头摘要卡）
// @vitest-ignore
import { Handle, Position } from '@vue-flow/core'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()
defineProps({
  data: { type: Object, required: true },
  selected: { type: Boolean, default: false },
})
</script>

<template>
  <div class="fe-node fe-node--script" :class="{ 'is-selected': selected }">
    <div class="fe-node__head">
      <span class="fe-node__type">{{ t('filmEngineering.canvas.scriptNode') }}</span>
    </div>
    <div class="fe-node__body">
      <div class="fe-node__title">{{ data.title || t('filmEngineering.canvas.noTitle') }}</div>
      <div class="fe-node__meta">{{ t('filmEngineering.canvas.scriptChars', { n: data.scriptLength || 0 }) }}</div>
    </div>
    <Handle type="source" :position="Position.Right" />
  </div>
</template>

<style scoped>
.fe-node {
  min-width: 200px;
  max-width: 260px;
  border: 1px solid var(--el-border-color, #dcdfe6);
  border-radius: 8px;
  background: var(--el-bg-color, #fff);
  padding: 10px 12px;
  font-size: 12px;
}
.fe-node.is-selected { border-color: var(--color-primary); }
.fe-node__head { display: flex; justify-content: space-between; margin-bottom: 6px; }
.fe-node__type { color: var(--el-text-color-secondary, #909399); font-size: 11px; letter-spacing: 1px; }
.fe-node__title { font-weight: 600; font-size: 13px; margin-bottom: 4px; word-break: break-all; }
.fe-node__meta { color: var(--el-text-color-secondary, #909399); }
</style>
