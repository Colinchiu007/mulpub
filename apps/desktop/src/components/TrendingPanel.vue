<template>
  <div class="cohere-card" style="cursor: default;">
    <!-- Header -->
    <div class="cohere-page-header" style="margin-bottom: var(--space-md);">
      <div style="font-size: var(--font-size-md); font-weight: 600; color: var(--text); display: flex; align-items: center; gap: 8px;">
        <span><el-icon><TrendCharts /></el-icon> 热门趋势</span>
      </div>
      <div style="font-size: var(--font-size-sm); color: var(--muted); margin-top: 2px;">跨平台热点发现</div>
    </div>

    <!-- Filter tabs -->
    <div style="display: flex; gap: 6px; margin-bottom: var(--space-md); flex-wrap: wrap;">
      <button
        v-for="src in allSources"
        :key="src.value"
        :class="activeSource === src.value ? 'cohere-btn-primary' : 'cohere-btn-ghost'"
        style="padding: 4px 14px; font-size: var(--font-size-sm); border-radius: 4px; cursor: pointer;"
        @click="activeSource = src.value"
      >
        {{ src.label }}
      </button>
    </div>

    <!-- Loading：统一骨架屏 -->
    <div v-if="loading" style="padding: 8px 0" data-testid="trending-loading">
      <UiSkeleton variant="list" :count="3" />
    </div>

    <!-- Error -->
    <div v-else-if="error" style="padding: 24px; text-align: center; color: var(--coral); font-size: var(--font-size-sm);">
      <div style="margin-bottom: 8px;">⚠️ {{ error }}</div>
      <button class="cohere-btn-ghost" style="padding: 6px 16px; font-size: var(--font-size-sm); cursor: pointer;" @click="fetchTrending">
        重新加载
      </button>
    </div>

    <!-- Empty -->
    <div v-else-if="!filteredItems.length" class="cohere-empty" style="padding: 32px 0; text-align: center; color: var(--muted);">
      暂无热门内容
    </div>

    <!-- Items list -->
    <div v-else style="display: flex; flex-direction: column; gap: var(--space-sm);">
      <div
        v-for="item in filteredItems"
        :key="item.source + ':' + item.title"
        style="border: 1px solid var(--border); border-radius: 6px; padding: var(--space-md); transition: background 0.15s;"
        @mouseenter="($event) => $event.currentTarget.style.background = 'var(--bg)'"
        @mouseleave="($event) => $event.currentTarget.style.background = 'transparent'"
      >
        <!-- Source badge -->
        <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 6px;">
          <span
            class="cohere-tag"
            :style="{
              background: sourceColor(item.source) + '18',
              color: sourceColor(item.source),
              border: '1px solid ' + sourceColor(item.source) + '40',
              fontSize: '11px',
              padding: '1px 8px',
              borderRadius: '4px',
              fontWeight: 600
            }"
          >
            {{ item.source }}
          </span>
          <span v-if="item.subreddit" style="font-size: var(--font-size-xs); color: var(--muted);">{{ item.subreddit }}</span>
          <span v-if="item.repo" style="font-size: var(--font-size-xs); color: var(--muted);">{{ item.repo }}</span>
        </div>

        <!-- Title -->
        <div style="margin-bottom: 6px;">
          <a
            :href="item.url"
            target="_blank"
            rel="noopener noreferrer"
            style="color: var(--text); text-decoration: none; font-size: var(--font-size-sm); font-weight: 500; line-height: 1.4;"
            @mouseenter="($event) => $event.target.style.color = 'var(--action-blue)'"
            @mouseleave="($event) => $event.target.style.color = 'var(--text)'"
          >
            {{ item.title }}
          </a>
        </div>

        <!-- Stats row -->
        <div style="display: flex; align-items: center; gap: 16px; font-size: var(--font-size-xs); color: var(--muted);">
          <span style="display: flex; align-items: center; gap: 3px;">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3H14z"/></svg>
            {{ item.upvotes ?? 0 }}
          </span>
          <span v-if="item.comments !== undefined" style="display: flex; align-items: center; gap: 3px;">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
            {{ item.comments }}
          </span>
          <span
            v-if="item.engagementScore != null"
            style="display: flex; align-items: center; gap: 3px; font-weight: 500;"
            :style="{ color: engagementColor(item.engagementScore) }"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
            {{ item.engagementScore.toFixed(1) }}
          </span>
        </div>
      </div>
    </div>

    <div class="cohere-divider" style="margin: var(--space-sm) 0 0;"></div>
  </div>
</template>

<script setup>
import { TrendCharts } from '@element-plus/icons-vue'
import { ref, computed, onMounted } from 'vue'
import { intelligenceFetchTrending } from '@/api/publisher'
import { formatUserError } from '@/utils/user-facing-error'

const props = defineProps({
  sources: {
    type: Array,
    default: () => ['reddit', 'hackernews', 'github']
  }
})

const allSources = [
  { label: '全部', value: 'all' },
  { label: 'Reddit', value: 'reddit' },
  { label: 'HN', value: 'hackernews' },
  { label: 'GitHub', value: 'github' }
]

const activeSource = ref('all')
const items = ref([])
const loading = ref(false)
const error = ref(null)

const filteredItems = computed(() => {
  if (activeSource.value === 'all') return items.value
  return items.value.filter(item => item.source === activeSource.value)
})

function sourceColor(source) {
  const map = { reddit: '#FF4500', hackernews: '#FF6600', github: 'var(--ink)' }
  return map[source] || 'var(--text-muted)'
}

function engagementColor(score) {
  if (score >= 2.0) return 'var(--cohere-green)'
  if (score >= 1.0) return '#e6a23c'
  return 'var(--muted)'
}

async function fetchTrending() {
  loading.value = true
  error.value = null
  try {
    const result = await intelligenceFetchTrending({
      sources: props.sources,
      limit: 20
    })
    items.value = result?.items ?? result ?? []
  } catch (err) {
    error.value = formatUserError(err, { fallback: '获取热门趋势失败，请稍后重试' }).message
    items.value = []
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  fetchTrending()
})
</script>

<style scoped>
.cohere-card {
  background: var(--card-bg);
  border-radius: 8px;
  padding: var(--space-xl);
}

a:hover {
  text-decoration: underline !important;
}
</style>
