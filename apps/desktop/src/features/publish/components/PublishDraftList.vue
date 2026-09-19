<template>
  <section class="publish-draft-list" data-testid="publish-draft-list" aria-label="草稿列表">
    <div v-if="loading" class="draft-list-state" data-testid="draft-list-loading">
      <UiSkeleton variant="list" :count="3" />
    </div>
    <div v-else-if="drafts.length === 0" class="draft-list-state" data-testid="draft-list-empty">
      <strong>暂无草稿</strong>
      <span>保存草稿后，可以从这里继续编辑。</span>
    </div>
    <div v-else class="draft-list-items">
      <article v-for="draft in drafts" :key="draft.id" class="draft-list-card">
        <div class="draft-list-info">
          <strong>{{ draft.title || '无标题' }}</strong>
          <span class="draft-list-time">{{ formatTime(draft.updatedAt || draft.updated_at) }}</span>
          <span v-if="draft.platforms?.length" class="draft-list-platform-count">{{ draft.platforms.length }} 个平台</span>
        </div>
        <div class="draft-list-actions">
          <button
            type="button"
            class="draft-action-btn"
            :data-testid="`edit-draft-${draft.id}`"
            @click="$emit('edit', draft)"
          >继续编辑</button>
          <button
            type="button"
            class="draft-action-btn draft-action-btn--danger"
            :data-testid="`delete-draft-${draft.id}`"
            @click="$emit('delete', draft.id)"
          >删除</button>
        </div>
      </article>
    </div>
  </section>
</template>

<script setup>
import { formatDateTime } from '@/utils/datetime'

defineProps({
  drafts: { type: Array, default: () => [] },
  loading: { type: Boolean, default: false },
})

defineEmits(['edit', 'delete'])

const formatTime = (value) => formatDateTime(value, { emptyText: '更新时间未知', invalidText: '更新时间未知' })
</script>

<style scoped>
.publish-draft-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.draft-list-state {
  min-height: 160px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  border: 1px dashed #e8e8ec;
  border-radius: 10px;
  background: var(--color-bg-card);
  color: #73777d;
  text-align: center;
}

.draft-list-state strong {
  color: #25252b;
  font-size: var(--font-size-base);
}

.draft-list-items {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.draft-list-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 14px 16px;
  border: 1px solid #e8e8ec;
  border-radius: 10px;
  background: var(--color-bg-card);
  transition: border-color 0.15s;
}

.draft-list-card:hover {
  border-color: #c9c5ff;
}

.draft-list-info {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 12px;
}

.draft-list-info strong {
  overflow: hidden;
  color: #25252b;
  font-size: var(--font-size-sm);
  font-weight: 500;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.draft-list-time {
  color: #8b8e9a;
  font-size: var(--font-size-xs);
  flex: 0 0 auto;
}

.draft-list-platform-count {
  padding: 2px 8px;
  border-radius: 10px;
  background: #f0efff;
  color: #5048e5;
  font-size: var(--font-size-xs);
  flex: 0 0 auto;
}

.draft-list-actions {
  display: flex;
  flex: 0 0 auto;
  gap: 6px;
}

.draft-action-btn {
  padding: 5px 12px;
  border: 1px solid #e0e0e8;
  border-radius: 6px;
  background: var(--color-bg-card);
  color: #4d4f6f;
  font-size: var(--font-size-xs);
  cursor: pointer;
  transition: all 0.15s;
}

.draft-action-btn:hover {
  border-color: #5048e5;
  color: #5048e5;
}

.draft-action-btn--danger {
  color: #d85a68;
}

.draft-action-btn--danger:hover {
  border-color: #d85a68;
  color: #d85a68;
}
</style>
