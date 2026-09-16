<template>
  <div class="cohere-content" role="tabpanel" :aria-label="t('collection.libraryTitle')">
    <div class="cohere-section-title library-header">
      <span data-testid="copy-library-count">{{ t('collection.libraryCount', { count: items.length }) }}</span>
      <div class="library-filters" role="group" :aria-label="t('collection.libraryFilterLabel')">
        <button
          v-for="f in FILTERS"
          :key="f.value"
          type="button"
          class="library-filter-btn"
          :class="{ active: filter === f.value }"
          :aria-pressed="filter === f.value"
          :data-testid="'copy-library-filter-' + f.value"
          @click="filter = f.value"
        >{{ t(f.labelKey) }}</button>
      </div>
    </div>

    <EmptyState
      v-if="items.length === 0"
      icon="📚"
      :title="t('collection.libraryEmptyTitle')"
      :description="t('collection.libraryEmptyDesc')"
    />
    <EmptyState
      v-else-if="filteredItems.length === 0"
      icon="🔍"
      :title="t('collection.libraryFilterEmptyTitle')"
      :description="t('collection.libraryFilterEmptyDesc')"
    />
    <div v-else class="cohere-card-grid" data-testid="copy-library-list">
      <div
        v-for="item in filteredItems"
        :key="item.id"
        class="cohere-card copy-library-card"
        :data-testid="'copy-library-item-' + item.id"
      >
        <div class="card-top">
          <div class="card-icon">{{ item.origin === ORIGIN_REWRITE ? '✨' : '📰' }}</div>
          <div class="card-info">
            <div class="card-platform">
              <span
                class="copy-origin-badge"
                :class="item.origin === ORIGIN_REWRITE ? 'is-rewrite' : 'is-collect'"
                :data-testid="'copy-library-badge-' + item.id"
              >{{ originLabel(item.origin) }}</span>
              <span class="copy-library-title">{{ item.title || t('collection.libraryUntitled') }}</span>
            </div>
            <div class="card-account" :data-testid="'copy-library-meta-' + item.id">{{ metaText(item) }}</div>
          </div>
        </div>
        <div class="card-actions">
          <button type="button" @click="openPreview(item)">{{ t('collection.libraryView') }}</button>
          <button
            type="button"
            class="primary"
            :data-testid="'copy-library-rewrite-' + item.id"
            @click="openRewrite(item)"
          >{{ t('collection.libraryRewrite') }}</button>
        </div>
      </div>
    </div>

    <CopyRewriteModal
      v-if="rewriteSource"
      :source="rewriteSource"
      @close="rewriteSource = null"
      @rewritten="onRewritten"
    />

    <!-- 文案内容预览（只读） -->
    <div v-if="previewItem" class="copy-preview-overlay" data-testid="copy-preview-overlay" @click.self="previewItem = null">
      <div class="copy-preview-modal" role="dialog" aria-modal="true" :aria-label="t('collection.libraryPreviewTitle')">
        <header class="copy-preview-header">
          <h3 class="copy-preview-title">{{ previewItem.title || t('collection.libraryUntitled') }}</h3>
          <button
            type="button"
            class="copy-preview-close"
            :aria-label="t('collection.libraryClose')"
            data-testid="copy-preview-close"
            @click="previewItem = null"
          >✕</button>
        </header>
        <div class="copy-preview-meta">
          <span class="copy-origin-badge" :class="previewItem.origin === ORIGIN_REWRITE ? 'is-rewrite' : 'is-collect'">
            {{ originLabel(previewItem.origin) }}
          </span>
          <span>{{ metaText(previewItem) }}</span>
        </div>
        <pre class="copy-preview-content" data-testid="copy-preview-content">{{ previewItem.content }}</pre>
      </div>
    </div>
  </div>
</template>

<script setup>
/**
 * CopyLibraryPanel — 采集页「文案库」标签内容
 *
 * 列表数据 = 采集正文（collected_items 实时合成）+ 改写文案（copy_library_rewrites 持久化），
 * 用「采集 / 改写」标识区分性质；每行右侧「改写」按钮打开 CopyRewriteModal 选择改写选项，
 * 改写成功后由本组件 upsert 到文案库（同一来源只保留最新一次改写结果）。
 */
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { storeGetSetting } from '@/api/publisher'
import { useNotify } from '@/composables/useNotify'
import { useCopyLibrary, buildCopyLibraryItems, ORIGIN_COLLECT, ORIGIN_REWRITE } from '@/composables/useCopyLibrary'
import CopyRewriteModal from '@/components/CopyRewriteModal.vue'

const FILTERS = [
  { value: 'all', labelKey: 'collection.libraryFilterAll' },
  { value: ORIGIN_COLLECT, labelKey: 'collection.libraryOriginCollect' },
  { value: ORIGIN_REWRITE, labelKey: 'collection.libraryOriginRewrite' },
]

/** 采集记录持久化键名（与 Collection.vue 保持一致） */
const COLLECTED_ITEMS_KEY = 'collected_items'

const { t } = useI18n()
const { notifySuccess } = useNotify()
const { rewrites, load: loadRewrites, upsertRewrite } = useCopyLibrary()

const collectedItems = ref([])
const filter = ref('all')
const rewriteSource = ref(null)
const previewItem = ref(null)

const items = computed(() => buildCopyLibraryItems(collectedItems.value, rewrites.value))

const filteredItems = computed(() => (
  filter.value === 'all' ? items.value : items.value.filter((it) => it.origin === filter.value)
))

function originLabel (origin) {
  return origin === ORIGIN_REWRITE
    ? t('collection.libraryOriginRewrite')
    : t('collection.libraryOriginCollect')
}

function formatTime (value) {
  if (!value) return ''
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString()
}

function metaText (item) {
  const parts = [t('collection.libraryWordCount', { count: item.wordCount })]
  // 时间缺失（历史采集记录无 createdAt）时整段省略，避免出现「采集于 」空值
  const time = formatTime(item.createdAt)
  if (time) {
    parts.push(item.origin === ORIGIN_REWRITE
      ? t('collection.libraryRewrittenAt', { time })
      : t('collection.libraryCollectedAt', { time }))
  }
  if (item.origin === ORIGIN_REWRITE && item.fromTitle) {
    parts.push(t('collection.libraryFrom', { title: item.fromTitle }))
  }
  return parts.join(' · ')
}

async function loadCollectedItems () {
  const raw = await storeGetSetting(COLLECTED_ITEMS_KEY)
  if (raw == null) return
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
    collectedItems.value = Array.isArray(parsed) ? parsed : []
  } catch {
    collectedItems.value = []
  }
}

onMounted(async () => {
  await Promise.all([loadCollectedItems(), loadRewrites()])
})

function openPreview (item) {
  previewItem.value = item
}

function openRewrite (item) {
  rewriteSource.value = {
    // 来源键：采集正文用 collect:<采集 id>，改写文案用 rewrite:<改写记录 id>（链式改写）
    fromKey: item.id,
    title: item.title,
    content: item.content,
    platform: item.platform,
    sourceUrl: item.sourceUrl,
  }
}

async function onRewritten (payload) {
  const saved = await upsertRewrite(payload)
  if (saved) notifySuccess('collection.rewriteSuccess')
}

// 供单测断言内部状态
defineExpose({ items, filteredItems, filter, rewriteSource, previewItem, onRewritten, openRewrite, openPreview })
</script>

<style scoped>
.library-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.library-filters {
  display: flex;
  gap: 4px;
  background: var(--soft-stone, #f5f5f5);
  border-radius: 8px;
  padding: 3px;
}

.library-filter-btn {
  padding: 4px 12px;
  border: none;
  background: transparent;
  border-radius: 6px;
  font-size: 13px;
  cursor: pointer;
  color: var(--text-secondary, #666);
  transition: all 0.15s;
}
.library-filter-btn:hover { color: var(--text-primary, #333); }
.library-filter-btn.active {
  background: #fff;
  color: var(--primary, #ea580c);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
}

.copy-library-card .card-platform {
  display: flex;
  align-items: center;
  gap: 6px;
}

.copy-library-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.copy-origin-badge {
  flex-shrink: 0;
  padding: 1px 8px;
  border-radius: 10px;
  font-size: 12px;
  line-height: 18px;
  font-weight: 500;
}
.copy-origin-badge.is-collect {
  background: #eef4ff;
  color: #2563eb;
}
.copy-origin-badge.is-rewrite {
  background: #fef2f2;
  color: var(--coral, #ea580c);
}

.copy-preview-overlay {
  position: fixed;
  inset: 0;
  z-index: 2000;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(23, 23, 32, 0.45);
  padding: 20px;
}

.copy-preview-modal {
  width: min(720px, 100%);
  max-height: 86vh;
  display: flex;
  flex-direction: column;
  background: var(--surface, #fff);
  border-radius: 16px;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.22);
  padding: 18px 24px 22px;
}

.copy-preview-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.copy-preview-title {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  color: var(--text-primary, #25252b);
}

.copy-preview-close {
  border: none;
  background: transparent;
  color: var(--muted, #73777d);
  font-size: 16px;
  cursor: pointer;
  padding: 4px 8px;
  border-radius: 6px;
}
.copy-preview-close:hover { background: var(--soft-stone, #f5f5f5); color: var(--text-primary); }

.copy-preview-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  margin: 10px 0 12px;
  font-size: 12px;
  color: var(--muted, #73777d);
}

/* 长文本展示契约：显式换行 + 任意位置断词，避免长串英文/链接撑破弹窗 */
.copy-preview-content {
  margin: 0;
  overflow-y: auto;
  min-height: 0;
  padding: 12px;
  border-radius: 10px;
  background: var(--soft-stone, #f7f7f8);
  font-size: 13px;
  line-height: 1.7;
  color: var(--text-primary, #25252b);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  word-break: break-word;
}

@media (max-width: 768px) {
  .copy-preview-modal { padding: 16px; }
}
</style>
