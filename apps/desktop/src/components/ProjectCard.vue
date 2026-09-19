<template>
  <div class="project-card" :class="'status-' + statusClass" @click="handleClick">
    <div class="project-card-thumb">
      <img v-if="project.thumbnail" :src="project.thumbnail" :alt="project.name" />
      <span v-else class="thumb-placeholder">🎬</span>
    </div>
    <div class="project-card-body">
      <div class="project-card-name">{{ project.name || '未命名项目' }}</div>
      <div class="project-card-meta">
        <span class="status-badge" :class="'badge-' + statusClass">{{ statusLabel }}</span>
        <span v-if="project.pipelineType" class="pipeline-tag">{{ pipelineName }}</span>
      </div>
      <div class="project-card-footer">
        <span class="footer-time">{{ formatTime(project.updatedAt || project.createdAt) }}</span>
        <span v-if="project.estimatedCost" class="footer-cost">{{ costLabel }}</span>
      </div>
    </div>
    <button class="delete-btn" @click.stop="handleDelete" title="删除项目">✕</button>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { getPipelineName } from '@/i18n/pipeline-labels'
import { formatDateTime } from '@/utils/datetime'

const props = defineProps({
  project: { type: Object, required: true },
})
const emit = defineEmits(['delete'])

const router = useRouter()
const { t } = useI18n()

const statusMap = {
  draft: { label: '草稿', class: 'draft' },
  running: { label: '运行中', class: 'running' },
  paused: { label: '已暂停', class: 'paused' },
  completed: { label: '已完成', class: 'completed' },
  failed: { label: '失败', class: 'failed' },
  cancelled: { label: '已取消', class: 'cancelled' },
}

const statusClass = computed(() => {
  const s = props.project.status
  return (statusMap[s] && statusMap[s].class) || 'draft'
})

const statusLabel = computed(() => {
  const s = props.project.status
  return (statusMap[s] && statusMap[s].label) || '草稿'
})

const costLabel = computed(() => {
  const c = props.project.estimatedCost
  if (!c) return ''
  const map = { low: '低成本', medium: '中成本', high: '高成本' }
  return map[c] || c
})

const pipelineName = computed(() => getPipelineName(t, props.project.pipelineType))

const formatTime = (iso) => formatDateTime(iso, { style: 'short' })

function handleClick() {
  router.push('/board/' + props.project.id)
}

function handleDelete() {
  emit('delete', props.project.id)
}
</script>

<style>
.project-card {
  position: relative;
  background: var(--bg-card, #fff);
  border: 1px solid var(--border-color, #e4e7ed);
  border-radius: 12px;
  overflow: hidden;
  cursor: pointer;
  transition: box-shadow 0.2s, border-color 0.2s;
}
.project-card:hover {
  box-shadow: 0 4px 12px rgba(0,0,0,0.08);
  border-color: var(--action-blue, #409eff);
}
.project-card-thumb {
  width: 100%;
  height: 140px;
  background: var(--bg-muted, #f5f7fa);
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}
.project-card-thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.thumb-placeholder {
  font-size: 48px;
  opacity: 0.4;
}
.project-card-body {
  padding: 12px 14px;
}
.project-card-name {
  font-size: 15px;
  font-weight: 600;
  margin-bottom: 8px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.project-card-meta {
  display: flex;
  gap: 8px;
  align-items: center;
  margin-bottom: 8px;
}
.status-badge {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 10px;
  font-weight: 500;
}
.badge-draft { background: var(--ep-info-light); color: var(--ep-info); }
.badge-running { background: var(--ep-primary-light); color: var(--ep-primary); }
.badge-paused { background: var(--ep-warning-light); color: var(--ep-warning); }
.badge-completed { background: var(--ep-success-light); color: var(--ep-success); }
.badge-failed { background: var(--ep-danger-light); color: var(--ep-danger); }
.badge-cancelled { background: var(--ep-info-light); color: var(--ep-info); }
.pipeline-tag {
  font-size: 11px;
  color: var(--text-muted, #909399);
  background: var(--bg-muted, #f5f7fa);
  padding: 2px 6px;
  border-radius: 4px;
}
.project-card-footer {
  display: flex;
  justify-content: space-between;
  font-size: 12px;
  color: var(--text-muted, #909399);
}
.delete-btn {
  position: absolute;
  top: 8px;
  right: 8px;
  width: 24px;
  height: 24px;
  border: none;
  background: rgba(255,255,255,0.8);
  border-radius: 50%;
  cursor: pointer;
  font-size: 12px;
  color: var(--text-muted, #909399);
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0;
  transition: opacity 0.2s;
}
.project-card:hover .delete-btn {
  opacity: 1;
}
.delete-btn:hover {
  background: var(--ep-danger-light);
  color: var(--ep-danger);
}
.status-running .project-card-thumb {
  border-bottom: 3px solid var(--ep-primary);
}
.status-completed .project-card-thumb {
  border-bottom: 3px solid var(--ep-success);
}
.status-failed .project-card-thumb {
  border-bottom: 3px solid var(--ep-danger);
}
.status-paused .project-card-thumb {
  border-bottom: 3px solid var(--ep-warning);
}
</style>
