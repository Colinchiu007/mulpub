<template>
  <div class="copy-library-page">
    <header class="copy-library-header">
      <h1 data-testid="copy-library-title">{{ t('copyLibrary.pageTitle') }}</h1>
      <p class="copy-library-subtitle">{{ t('copyLibrary.pageSubtitle') }}</p>
    </header>

    <div class="copy-library-toolbar">
      <div class="copy-library-filters" role="group" :aria-label="t('copyLibrary.filterLabel')">
        <button
          v-for="f in ORIGIN_FILTERS"
          :key="f.value"
          type="button"
          class="copy-library-filter-btn"
          :class="{ active: originFilter === f.value }"
          :aria-pressed="originFilter === f.value"
          :data-testid="'copy-library-filter-' + f.value"
          @click="originFilter = f.value"
        >{{ t(f.labelKey) }}</button>
      </div>
      <label class="copy-library-search">
        <input
          v-model="searchQuery"
          type="search"
          data-testid="copy-library-search"
          :placeholder="t('copyLibrary.searchPlaceholder')"
          :aria-label="t('copyLibrary.searchAria')"
        >
      </label>
    </div>

    <div v-if="loading" class="copy-library-state" data-testid="copy-library-loading">{{ t('copyLibrary.loading') }}</div>

    <EmptyState
      v-else-if="items.length === 0"
      data-testid="copy-library-empty"
      icon="📝"
      :title="t('copyLibrary.emptyTitle')"
      :description="t('copyLibrary.emptyDesc')"
    />

    <EmptyState
      v-else-if="filteredItems.length === 0"
      compact
      data-testid="copy-library-filter-empty"
      icon="🔍"
      :title="t('copyLibrary.filterEmptyTitle')"
      :description="t('copyLibrary.filterEmptyDesc')"
      :action-text="t('copyLibrary.filterEmptyAction')"
      @action="originFilter = 'all'; searchQuery = ''"
    />

    <div v-else class="copy-library-grid" data-testid="copy-library-list">
      <article
        v-for="entry in filteredItems"
        :key="entry.id"
        class="copy-library-card"
        :data-testid="'copy-library-item-' + entry.id"
      >
        <div class="copy-library-card-top">
          <span class="copy-library-origin-badge" :class="'is-' + entry.origin">{{ originLabel(entry.origin) }}</span>
          <span class="copy-library-title">{{ entry.title || t('copyLibrary.untitled') }}</span>
        </div>
        <p class="copy-library-content">{{ entry.content }}</p>
        <div class="copy-library-meta">
          <span>{{ t('copyLibrary.wordCount', { count: entry.wordCount }) }}</span>
          <span v-if="entry.createdAt"> · {{ formatTime(entry.createdAt) }}</span>
          <span v-if="entry.metadata.truncated" :data-testid="'copy-library-truncated-' + entry.id"> · {{ t('copyLibrary.truncated') }}</span>
        </div>
      </article>
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import EmptyState from '@/components/EmptyState.vue'
import { useCopyLibrarySources, ORIGIN_DRAFT, ORIGIN_VIDEO } from '@/composables/useCopyLibrarySources'
import { ORIGIN_COLLECT, ORIGIN_REWRITE } from '@/composables/useCopyLibrary'

const { t } = useI18n()
const { items, loading, loadAll } = useCopyLibrarySources()

/** 来源筛选：全部 / 采集 / 改写 / 草稿 / 视频创作 */
const ORIGIN_FILTERS = [
  { value: 'all', labelKey: 'copyLibrary.filterAll' },
  { value: ORIGIN_COLLECT, labelKey: 'copyLibrary.filterCollect' },
  { value: ORIGIN_REWRITE, labelKey: 'copyLibrary.filterRewrite' },
  { value: ORIGIN_DRAFT, labelKey: 'copyLibrary.filterDraft' },
  { value: ORIGIN_VIDEO, labelKey: 'copyLibrary.filterVideo' },
]
const originFilter = ref('all')
const searchQuery = ref('')

const filteredItems = computed(() => {
  let list = items.value
  if (originFilter.value !== 'all') list = list.filter((e) => e.origin === originFilter.value)
  const query = searchQuery.value.trim().toLowerCase()
  if (query) {
    list = list.filter((e) => ((e.title || '') + ' ' + e.content).toLowerCase().includes(query))
  }
  return list
})

function originLabel (origin) {
  const map = {
    [ORIGIN_COLLECT]: t('copyLibrary.originCollect'),
    [ORIGIN_REWRITE]: t('copyLibrary.originRewrite'),
    [ORIGIN_DRAFT]: t('copyLibrary.originDraft'),
    [ORIGIN_VIDEO]: t('copyLibrary.originVideo'),
  }
  return map[origin] || origin
}

function formatTime (value) {
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleString()
}

onMounted(() => { loadAll() })
</script>

<style scoped>
.copy-library-page {
  padding: 24px;
  max-width: 1200px;
  margin: 0 auto;
}
.copy-library-header h1 {
  margin: 0 0 4px;
  font-size: 22px;
}
.copy-library-subtitle {
  margin: 0 0 16px;
  color: var(--color-text-secondary);
  font-size: 13px;
}
.copy-library-toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  margin-bottom: 16px;
  flex-wrap: wrap;
}
.copy-library-filters {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}
.copy-library-filter-btn {
  padding: 4px 12px;
  border: 1px solid var(--color-border);
  border-radius: 4px;
  background: transparent;
  cursor: pointer;
  font-size: 13px;
}
.copy-library-filter-btn.active {
  border-color: var(--color-primary);
  color: var(--color-primary);
}
.copy-library-search input {
  padding: 4px 10px;
  border: 1px solid var(--color-border);
  border-radius: 4px;
  min-width: 220px;
  font-size: 13px;
}
.copy-library-state {
  color: var(--color-text-secondary);
  text-align: center;
  padding: 40px 0;
}
.copy-library-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 12px;
}
.copy-library-card {
  border: 1px solid var(--color-border);
  border-radius: 6px;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.copy-library-card-top {
  display: flex;
  align-items: center;
  gap: 8px;
}
.copy-library-origin-badge {
  font-size: 11px;
  padding: 1px 8px;
  border-radius: 10px;
  white-space: nowrap;
  background: var(--color-bg-inset);
  color: var(--color-text-secondary);
}
.copy-library-origin-badge.is-rewrite { color: var(--color-primary); }
.copy-library-origin-badge.is-draft { color: var(--color-warning); }
.copy-library-origin-badge.is-video { color: var(--color-info-text); }
.copy-library-title {
  font-weight: 600;
  font-size: 14px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.copy-library-content {
  margin: 0;
  font-size: 13px;
  color: var(--color-text-primary);
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
  white-space: pre-line;
}
.copy-library-meta {
  font-size: 12px;
  color: var(--color-text-secondary);
}
</style>
