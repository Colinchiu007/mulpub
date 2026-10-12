<template>
  <div class="col-list-wrap">
    <div class="cohere-section-title col-section-title col-section-title--flex">
      <span>{{ $t('collection.resultsCount', { count: items.length }) }}</span>
      <label class="col-check-label">
        <input type="checkbox" :checked="allSelected" @change="$emit('toggleSelectAll', $event.target.checked)" data-testid="batch-select-all" />{{ $t('collection.zhihuFavlist.selectAll') }}
      </label>
      <button class="cohere-btn-secondary col-btn-clear" @click="$emit('clear')">{{ $t('collection.clearResults') }}</button>
    </div>

    <!-- 空态（Q10-e：旧行为为整块不渲染，现补统一空态引导） -->
    <EmptyState
      v-if="items.length === 0"
      data-testid="collection-results-empty"
      :title="$t('collection.resultsEmptyTitle')"
      :description="$t('collection.resultsEmptyDesc')"
      :action-text="$t('collection.resultsEmptyAction')"
      @action="$emit('emptyAction')"
    >
      <template #icon><el-icon><Link /></el-icon></template>
    </EmptyState>

    <template v-else>
      <!-- 批量操作条（勾选后浮出） -->
      <div v-if="batchSelectedCount > 0" class="batch-bar" data-testid="batch-action-bar">
        <span class="batch-bar-count">{{ $t('collection.batch.selectedCount', { count: String(batchSelectedCount) }) }}</span>
        <template v-if="batchPlatformOptions.length">
          <select v-model="platformScope" class="zb-select" data-testid="batch-platform-scope">
            <option v-for="p in batchPlatformOptions" :key="p.id" :value="p.id">{{ p.label }}</option>
          </select>
          <label v-for="acc in batchAccountOptions" :key="acc.id" class="zb-check">
            <input
              type="checkbox"
              :checked="isAccountSelected('imageText', acc.id)"
              :disabled="acc.disabled"
              @change="$emit('toggleBatchAccount', 'imageText', acc.id)"
            />{{ acc.name || acc.id }}
          </label>
        </template>
        <span class="zb-flex1"></span>
        <button class="cohere-btn-primary" :disabled="batchPublishing" @click="$emit('batchPublishImages')" data-testid="batch-publish-images">{{ $t('collection.batch.publishImages') }}</button>
        <button class="cohere-btn-primary" :disabled="batchPublishing" @click="$emit('batchGenerateVideos')" data-testid="batch-generate-videos">{{ $t('collection.batch.generateVideos') }}</button>
        <button class="cohere-btn-primary" :disabled="batchPublishing || !batchVideoPoolCount" @click="$emit('batchPublishVideos')" data-testid="batch-publish-videos">
          {{ $t('collection.batch.publishVideos') }}{{ batchVideoPoolCount ? `（${batchVideoPoolCount}）` : '' }}
        </button>
      </div>
      <!-- 视频平台/账号（仅本批有产物时显示） -->
      <div v-if="batchSelectedCount > 0 && batchVideoPoolCount && batchVideoPlatformOptions.length" class="batch-bar batch-bar--video">
        <span class="col-hint">{{ $t('collection.batch.videoPlatformLabel') }}</span>
        <select v-model="videoPlatformScope" class="zb-select" data-testid="batch-video-platform-scope">
          <option v-for="p in batchVideoPlatformOptions" :key="p.id" :value="p.id">{{ p.label }}</option>
        </select>
        <label v-for="acc in batchVideoAccountOptions" :key="'v' + acc.id" class="zb-check">
          <input
            type="checkbox"
            :checked="isAccountSelected('video', acc.id)"
            :disabled="acc.disabled"
            @change="$emit('toggleBatchAccount', 'video', acc.id)"
          />{{ acc.name || acc.id }}
        </label>
      </div>
      <div v-if="batchVideoPoolCount" class="col-hint batch-pool-note" data-testid="batch-video-pool">
        {{ $t('collection.batch.videoPoolNote', { count: String(batchVideoPoolCount) }) }}
      </div>

      <div class="cohere-card-grid">
        <div v-for="item in items" :key="item.id" class="cohere-card" :class="{ 'col-item--active': item.id === activeId }">
          <div class="card-top">
            <input
              type="checkbox"
              :checked="isSelected(item.id)"
              class="card-check"
              :data-testid="'batch-item-check-' + item.id"
              @change="$emit('toggleSelect', item)"
            />
            <div class="card-icon"><el-icon><component :is="item.mediaType === 'video' ? VideoCamera : Document" /></el-icon></div>
            <div class="card-info">
              <!-- 一级：标题 + 元信息（Q10-c 层级重排） -->
              <div class="card-platform">{{ item.title || $t('collection.recordsUntitled') }}</div>
              <div class="card-account">
                {{ item.source || 'url' }} · {{ item.wordCount || (item.content || '').length }}{{ $t('collection.wordCountUnit') }}
                <template v-if="item.mediaType === 'video' && item.duration"> · {{ formatDuration(item.duration) }}</template>
                <template v-if="item.mediaType === 'video' && item.platform && platformKeys.includes(item.platform)"> · {{ platformLabel(item.platform) }}</template>
              </div>
              <!-- 二级：徽标区 -->
              <div v-if="item.rewriteFailed" class="card-badge card-badge--warning">{{ $t('collection.zhihuFav.rewriteFailedBadge') }}</div>
              <div v-else-if="item.rewrittenContent" class="card-badge" :title="item.rewrittenContent">{{ $t('collection.zhihuFav.rewrittenBadge') }}：{{ item.rewrittenContent.slice(0, 40) }}</div>
              <div v-if="item.imageFallbacks && item.imageFallbacks.length" class="card-badge">{{ $t('collection.zhihuFav.imageFallbackBadge', { count: String(item.imageFallbacks.length) }) }}</div>
            </div>
          </div>
          <!-- 三级：操作主次分级（创建草稿/发布 primary；查看/视频创作 secondary） -->
          <div class="card-actions">
            <button class="is-primary" :data-testid="'result-draft-' + item.id" @click="$emit('createDraft', item)">{{ $t('collection.recordsCreateDraft') }}</button>
            <button class="is-primary" :data-testid="'result-publish-' + item.id" @click="$emit('publish', item)">{{ $t('collection.recordsPublish') }}</button>
            <button :data-testid="'result-view-' + item.id" @click="$emit('select', item)">{{ $t('collection.recordsEdit') }}</button>
            <button :data-testid="'result-video-' + item.id" @click="$emit('toVideo', item)">{{ $t('collection.recordsToVideo') }}</button>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup>
import { ref, computed, watch } from 'vue'
import { Document, VideoCamera, Link } from '@element-plus/icons-vue'
import { PLATFORM_NAMES } from '@multi-publish/shared-utils/src/platform-definitions'
import EmptyState from '@/components/EmptyState.vue'

const props = defineProps({
  items: { type: Array, required: true },
  activeId: { type: String, default: null },
  selectedIds: { type: Array, default: () => [] },
  batchSelectedCount: { type: Number, default: 0 },
  batchVideoPoolCount: { type: Number, default: 0 },
  batchPublishing: { type: Boolean, default: false },
  batchPlatformOptions: { type: Array, default: () => [] },
  batchAccountOptions: { type: Array, default: () => [] },
  batchVideoPlatformOptions: { type: Array, default: () => [] },
  batchVideoAccountOptions: { type: Array, default: () => [] },
  /** 平台键集合（父级传入，保持既有 PLATFORM_KEYS 真源） */
  platformKeys: { type: Array, default: () => [] },
  /** 账号勾选判定与切换由父级 composable 持有（受控模式） */
  isAccountSelectedFn: { type: Function, default: () => () => false },
})

defineEmits(['select', 'createDraft', 'toVideo', 'publish', 'toggleSelect', 'toggleSelectAll', 'clear', 'emptyAction', 'batchPublishImages', 'batchGenerateVideos', 'batchPublishVideos', 'toggleBatchAccount'])


const platformScope = ref('')
const videoPlatformScope = ref('')

watch(() => props.batchPlatformOptions, (opts) => {
  if (opts.length && !platformScope.value) platformScope.value = opts[0].id
}, { immediate: true })
watch(() => props.batchVideoPlatformOptions, (opts) => {
  if (opts.length && !videoPlatformScope.value) videoPlatformScope.value = opts[0].id
}, { immediate: true })

const selectedSet = computed(() => new Set(props.selectedIds))
const allSelected = computed(() => props.items.length > 0 && props.batchSelectedCount === props.items.length)
const isSelected = (id) => selectedSet.value.has(id)
const isAccountSelected = (kind, accId) => props.isAccountSelectedFn(kind, kind === 'imageText' ? platformScope.value : videoPlatformScope.value, accId)

const platformLabel = (platform) => PLATFORM_NAMES[platform] || platform
const formatDuration = (duration) => {
  const n = Number(duration)
  if (!n) return ''
  const m = Math.floor(n / 60)
  const s = Math.round(n % 60)
  return m > 0 ? `${m}:${String(s).padStart(2, '0')}` : `${s}s`
}

defineExpose({ platformScope, videoPlatformScope })
</script>

<style scoped>
.batch-bar { display: flex; gap: var(--space-sm); align-items: center; flex-wrap: wrap; margin: 8px 0; padding: 10px 12px; border: 1px solid var(--color-border); border-radius: 8px; background: var(--color-bg-card); }
.batch-bar--video { margin: 0 0 8px; padding: 8px 12px; border-style: dashed; }
.batch-bar-count { font-size: var(--font-size-sm); }
.batch-pool-note { margin: 4px 0; }
.card-check { margin-right: 6px; }
.card-badge { font-size: var(--font-size-xs); color: var(--color-text-secondary); margin-top: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.card-badge--warning { color: var(--color-warning); }
.zb-select { border: 1px solid var(--color-border); border-radius: var(--r-xs, 6px); padding: 6px 8px; font-size: var(--font-size-xs); }
.zb-check { display: flex; align-items: center; gap: 3px; font-size: var(--font-size-xs); }
.zb-flex1 { flex: 1; }
</style>
