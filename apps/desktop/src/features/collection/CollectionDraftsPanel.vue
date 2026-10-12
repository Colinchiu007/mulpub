<template>
  <div class="cohere-content" role="tabpanel" :aria-label="$t('collection.draftsTitle')" data-testid="collection-drafts-panel">
    <div class="cohere-section-title col-section-title col-section-title--flex">
      <span>{{ $t('collection.draftsTitle') }} · {{ $t('collection.draftsCount', { count: String(draftCount) }) }}</span>
      <span style="flex:1"></span>
      <button class="cohere-btn-secondary col-btn-clear" :disabled="loading" data-testid="drafts-refresh" @click="onRefresh">
        {{ $t('collection.draftsRefresh') }}
      </button>
      <button class="cohere-btn-primary" data-testid="drafts-create" @click="emit('create')">
        {{ $t('collection.draftsEmptyAction') }}
      </button>
    </div>

    <!-- 加载态 -->
    <div v-if="loading && draftCount === 0" class="col-result-box" data-testid="drafts-loading">
      {{ $t('collection.draftsLoading') }}
    </div>

    <!-- 读取失败：如实显示，不得伪装成「暂无草稿」 -->
    <div v-else-if="loadError" class="col-error-banner" data-testid="drafts-load-error">
      {{ loadError }}
      <button class="cohere-btn-secondary col-btn-retry-sm" :disabled="loading" @click="onRefresh">
        🔄 {{ $t('collection.draftsRefresh') }}
      </button>
    </div>

    <!-- 空态 -->
    <EmptyState
      v-else-if="draftCount === 0"
      data-testid="collection-drafts-empty"
      :title="$t('collection.draftsEmptyTitle')"
      :description="$t('collection.draftsEmptyDesc')"
      :action-text="$t('collection.draftsEmptyAction')"
      @action="emit('create')"
    >
      <template #icon><el-icon><EditPen /></el-icon></template>
    </EmptyState>

    <div v-else class="cohere-card-grid" data-testid="collection-drafts-list">
      <div v-for="d in sortedDrafts" :key="d.id" class="cohere-card" :data-testid="'collection-draft-' + d.id">
        <div class="card-top">
          <div class="card-icon"><el-icon><Document /></el-icon></div>
          <div class="card-info">
            <div class="card-platform">{{ d.title || $t('collection.draftsUntitled') }}</div>
            <div class="card-account">
              {{ formatTime(resolveCreatedAt(d)) }} · {{ $t('collection.recordsWordCount', { count: String(resolveWordCount(d)) }) }}
              <template v-if="resolvePlatformCount(d) > 0"> · {{ $t('collection.draftsPlatformCount', { count: String(resolvePlatformCount(d)) }) }}</template>
              <template v-if="d.source"> · {{ sourceLabel(d.source) }}</template>
            </div>
            <!-- 正文摘要：纯标题草稿（剪贴板导入首行）在此露出内容，便于分辨 -->
            <div v-if="resolveSummary(d)" class="card-summary" :title="d.content">{{ resolveSummary(d) }}</div>
          </div>
        </div>
        <div class="card-actions">
          <button data-testid="draft-edit" @click="emit('edit', d)">{{ $t('collection.recordsEdit') }}</button>
          <button class="primary" data-testid="draft-publish" @click="emit('publish', d)">{{ $t('collection.recordsPublish') }}</button>
          <button class="danger" data-testid="draft-delete" @click="onDelete(d)">{{ $t('collection.recordsDelete') }}</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { onMounted, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Document, EditPen } from '@element-plus/icons-vue'
import { useCollectionDrafts } from '@/composables/useCollectionDrafts'
import { formatDateTime } from '@/utils/datetime'
import EmptyState from '@/components/EmptyState.vue'

const props = defineProps({
  active: { type: Boolean, default: false },
  /** 变更后需要重新拉取（如新建草稿、采集入库） */
  reloadToken: { type: [String, Number], default: 0 },
})

const emit = defineEmits(['edit', 'publish', 'create'])

const { t } = useI18n()
const {
  sortedDrafts,
  draftCount,
  loading,
  loadError,
  loadDrafts,
  removeDraft,
  resolveCreatedAt,
  resolveSummary,
  resolveWordCount,
  resolvePlatformCount,
} = useCollectionDrafts()

function formatTime (value) {
  return formatDateTime(value, { emptyText: t('collection.draftsTimeUnknown'), invalidText: t('collection.draftsTimeUnknown') })
}

// 采集页草稿的 source 字段是内部枚举（manual/clipboard/url/rss…），
// 未知值如实回显原值，不得兜底成某个具体平台名（同「来源标签禁止兜底品牌名」判据）。
function sourceLabel (source) {
  const key = 'collection.draftsSource_' + String(source || '')
  const translated = t(key)
  return translated === key ? String(source) : translated
}

async function onRefresh () {
  await loadDrafts()
}

async function onDelete (draft) {
  await removeDraft(draft && draft.id)
}

// 切到本页签或收到刷新信号时拉取；active 为 false 时不请求，避免无用 IPC。
onMounted(() => { if (props.active) loadDrafts() })
watch(() => props.active, (v) => { if (v) loadDrafts() })
watch(() => props.reloadToken, () => { if (props.active) loadDrafts() })

defineExpose({ loadDrafts })
</script>

<style scoped>
/* 摘要单行截断：长正文不得撑破卡片网格 */
.card-summary {
  margin-top: 2px;
  overflow: hidden;
  color: var(--color-text-secondary);
  font-size: var(--font-size-xs);
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
