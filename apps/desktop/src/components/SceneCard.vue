<template>
  <div class="scene-card" :class="'scene-' + statusClass" @click="$emit('select', scene.id)">
    <div class="scene-header">
      <span class="scene-index">#{{ scene.index !== undefined ? scene.index : '' }}</span>
      <span class="scene-badge" :class="'badge-' + statusClass">{{ statusLabel }}</span>
    </div>
    <div class="scene-body">
      <div class="scene-name">{{ scene.name || '未命名场景' }}</div>
      <div v-if="scene.prompt" class="scene-prompt">{{ truncatedPrompt }}</div>
      <div v-if="takes.length > 0" class="scene-takes">
        <img
          v-for="(take, i) in displayedTakes"
          :key="i"
          :src="take.thumbnail || take.url || take"
          class="take-thumb"
          :alt="'Take ' + (i + 1)"
        />
        <span v-if="takes.length > 3" class="take-more">+{{ takes.length - 3 }}</span>
      </div>
    </div>
    <div class="scene-footer">
      <span v-if="scene.provider" class="scene-provider">{{ scene.provider }}</span>
      <span v-if="scene.cost !== undefined && scene.cost !== null" class="scene-cost">¥{{ scene.cost }}</span>
      <span v-if="scene.qualityScore !== undefined && scene.qualityScore !== null" class="scene-quality">
        ★ {{ scene.qualityScore }}
      </span>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'

const props = defineProps({
  scene: { type: Object, required: true },
})
defineEmits(['select'])

const statusMap = {
  QUEUED: { label: '队列中', class: 'queued' },
  GENERATING: { label: '生成中', class: 'generating' },
  AWAITING: { label: '待审批', class: 'awaiting' },
  APPROVED: { label: '已批准', class: 'approved' },
  REJECTED: { label: '已驳回', class: 'rejected' },
  COMPLETED: { label: '已完成', class: 'completed' },
  FAILED: { label: '失败', class: 'failed' },
}

const statusClass = computed(() => {
  const s = props.scene.status
  return (statusMap[s] && statusMap[s].class) || 'queued'
})

const statusLabel = computed(() => {
  const s = props.scene.status
  return (statusMap[s] && statusMap[s].label) || '队列中'
})

const takes = computed(() => {
  return props.scene.takes || []
})

const displayedTakes = computed(() => {
  return takes.value.slice(0, 3)
})

const truncatedPrompt = computed(() => {
  const p = props.scene.prompt || ''
  return p.length > 80 ? p.substring(0, 80) + '...' : p
})
</script>

<style>
.scene-card {
  background: var(--bg-card, #fff);
  border: 1px solid var(--border-color, #e4e7ed);
  border-radius: 10px;
  overflow: hidden;
  cursor: pointer;
  transition: box-shadow 0.2s, border-color 0.2s;
}
.scene-card:hover {
  box-shadow: 0 2px 8px rgba(0,0,0,0.06);
  border-color: var(--action-blue, #409eff);
}
.scene-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border-light, #f0f0f0);
}
.scene-index {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-muted, #909399);
}
.scene-badge {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 10px;
  font-weight: 500;
}
.badge-queued { background: #f0f0f0; color: #909399; }
.badge-generating { background: #e6f0ff; color: #409eff; }
.badge-awaiting { background: #fdf6ec; color: #e6a23c; }
.badge-approved { background: #f0f9eb; color: #67c23a; }
.badge-rejected { background: #fef0f0; color: #f56c6c; }
.badge-completed { background: #f0f9eb; color: #67c23a; }
.badge-failed { background: #fef0f0; color: #f56c6c; }
.scene-body {
  padding: 12px;
}
.scene-name {
  font-size: 14px;
  font-weight: 600;
  margin-bottom: 6px;
}
.scene-prompt {
  font-size: 12px;
  color: var(--text-muted, #909399);
  line-height: 1.5;
  margin-bottom: 8px;
}
.scene-takes {
  display: flex;
  gap: 6px;
  align-items: center;
}
.take-thumb {
  width: 48px;
  height: 48px;
  object-fit: cover;
  border-radius: 6px;
  border: 1px solid var(--border-light, #f0f0f0);
}
.take-more {
  font-size: 12px;
  color: var(--text-muted, #909399);
  font-weight: 600;
}
.scene-footer {
  display: flex;
  gap: 12px;
  padding: 8px 12px;
  border-top: 1px solid var(--border-light, #f0f0f0);
  font-size: 12px;
  color: var(--text-muted, #909399);
}
.scene-provider {
  font-weight: 500;
}
.scene-quality {
  color: #e6a23c;
}
.scene-awaiting {
  border-color: #e6a23c;
  border-width: 2px;
}
.scene-failed {
  border-color: #f56c6c;
}
</style>
