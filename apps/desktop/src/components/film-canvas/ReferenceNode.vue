<script setup>
// 影视工程画布 - 参考图节点（人物/场景共用，右端 source 把手连到分镜即注入）
import { Handle, Position } from '@vue-flow/core'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()
const props = defineProps({
  id: { type: String, required: true },
  type: { type: String, default: 'characterRef' },
  data: { type: Object, required: true },
  selected: { type: Boolean, default: false },
})
defineEmits(['remove'])

function isCharacter () {
  return props.type === 'characterRef'
}
</script>

<template>
  <div class="fe-node fe-node--ref" :class="{ 'is-selected': selected }">
    <div class="fe-node__head">
      <span class="fe-node__type">{{ isCharacter() ? t('filmEngineering.canvas.refCharacter') : t('filmEngineering.canvas.refScene') }}</span>
      <button class="fe-node__remove" type="button" :title="t('filmEngineering.canvas.deleteNode')" @click.stop="$emit('remove', id)">×</button>
    </div>
    <div class="fe-node__body">
      <div class="fe-node__title">{{ data.label || data.path || '-' }}</div>
      <div class="fe-node__meta">{{ data.mime || '' }}<template v-if="data.bytes"> · {{ (data.bytes / 1024 / 1024).toFixed(2) }} MB</template></div>
    </div>
    <Handle type="source" :position="Position.Right" />
  </div>
</template>

<style scoped>
.fe-node {
  min-width: 180px;
  max-width: 240px;
  border: 1px solid var(--el-border-color, #dcdfe6);
  border-radius: 8px;
  background: var(--el-bg-color, #fff);
  padding: 10px 12px;
  font-size: 12px;
}
.fe-node.is-selected { border-color: var(--color-primary); }
.fe-node__head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; }
.fe-node__type { color: var(--el-color-warning, #e6a23c); font-size: 11px; letter-spacing: 1px; }
.fe-node__remove { border: none; background: transparent; cursor: pointer; color: var(--el-text-color-secondary, #909399); font-size: 14px; line-height: 1; }
.fe-node__title { font-weight: 600; font-size: 12px; margin-bottom: 4px; word-break: break-all; }
.fe-node__meta { color: var(--el-text-color-secondary, #909399); }
</style>
