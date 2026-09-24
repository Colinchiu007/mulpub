<script setup>
// 影视工程画布 - 分镜节点（左端 target 把手接收参考图连线；状态徽标回显出片进度）
import { Handle, Position } from '@vue-flow/core'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()
const props = defineProps({
  id: { type: String, required: true },
  data: { type: Object, required: true },
  selected: { type: Boolean, default: false },
})
defineEmits(['remove'])

const STATUS_LABEL = {
  idle: 'filmEngineering.canvas.statusIdle',
  ready: 'filmEngineering.canvas.statusIdle',
  generating: 'filmEngineering.canvas.statusGenerating',
  done: 'filmEngineering.canvas.statusDone',
  failed: 'filmEngineering.canvas.statusFailed',
}

function statusLabel (s) {
  return t(STATUS_LABEL[s] || STATUS_LABEL.idle)
}
function promptPreview (p) {
  const text = typeof p === 'string' ? p : ''
  return text.length > 90 ? text.slice(0, 90) + '...' : text
}
</script>

<template>
  <div class="fe-node fe-node--shot" :class="{ 'is-selected': selected }">
    <Handle type="target" :position="Position.Left" />
    <div class="fe-node__head">
      <span class="fe-node__type">{{ data.shot && data.shot.shotId ? data.shot.shotId : id }}</span>
      <button class="fe-node__remove" type="button" :title="t('filmEngineering.canvas.deleteNode')" @click.stop="$emit('remove', id)">×</button>
    </div>
    <div class="fe-node__body">
      <div class="fe-node__scene">{{ data.sceneId || '-' }}</div>
      <div class="fe-node__prompt">{{ promptPreview(data.shot && data.shot.prompt) }}</div>
      <div class="fe-node__foot">
        <span class="fe-node__badge" :class="'is-' + (data.status || 'idle')">{{ statusLabel(data.status) }}</span>
        <span v-if="data.refCount" class="fe-node__refs">{{ t('filmEngineering.canvas.refInjected', { n: data.refCount }) }}</span>
      </div>
      <div v-if="data.status === 'done' && data.outPath" class="fe-node__out">{{ data.outPath }}</div>
    </div>
  </div>
</template>

<style scoped>
.fe-node {
  width: 240px;
  border: 1px solid var(--el-border-color, #dcdfe6);
  border-radius: 8px;
  background: var(--el-bg-color, #fff);
  padding: 10px 12px;
  font-size: 12px;
}
.fe-node.is-selected { border-color: var(--color-primary); }
.fe-node__head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px; }
.fe-node__type { color: var(--el-text-color-secondary, #909399); font-size: 11px; letter-spacing: 1px; }
.fe-node__remove { border: none; background: transparent; cursor: pointer; color: var(--el-text-color-secondary, #909399); font-size: 14px; line-height: 1; }
.fe-node__scene { font-weight: 600; font-size: 12px; margin-bottom: 4px; }
.fe-node__prompt { color: var(--el-text-color-regular, #606266); line-height: 1.5; margin-bottom: 8px; word-break: break-all; }
.fe-node__foot { display: flex; justify-content: space-between; align-items: center; }
.fe-node__badge { padding: 1px 8px; border-radius: 10px; font-size: 11px; background: var(--el-fill-color-light, #f5f7fa); color: var(--el-text-color-secondary, #909399); }
.fe-node__badge.is-generating { background: var(--el-color-warning-light-9, #fdf6ec); color: var(--el-color-warning, #e6a23c); }
.fe-node__badge.is-done { background: var(--el-color-success-light-9, #f0f9eb); color: var(--el-color-success, #67c23a); }
.fe-node__badge.is-failed { background: var(--el-color-danger-light-9, #fef0f0); color: var(--el-color-danger, #f56c6c); }
.fe-node__refs { color: var(--color-primary); font-size: 11px; }
.fe-node__out { margin-top: 6px; color: var(--el-text-color-secondary, #909399); font-size: 11px; word-break: break-all; }
</style>
