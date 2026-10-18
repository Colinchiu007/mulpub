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
      icon="Document"
      :title="t('copyLibrary.emptyTitle')"
      :description="t('copyLibrary.emptyDesc')"
    />

    <EmptyState
      v-else-if="filteredItems.length === 0"
      compact
      data-testid="copy-library-filter-empty"
      icon="Search"
      :title="t('copyLibrary.filterEmptyTitle')"
      :description="t('copyLibrary.filterEmptyDesc')"
      :action-text="t('copyLibrary.filterEmptyAction')"
      @action="originFilter = 'all'; searchQuery = ''"
    />

    <div v-else class="copy-library-grid" data-testid="copy-library-list">
      <article
        v-for="entry in renderedItems"
        :key="entry.id"
        class="copy-library-card"
        :data-testid="'copy-library-item-' + entry.id"
        role="button"
        tabindex="0"
        :aria-label="t('copyLibrary.viewDetailAria') + '：' + (entry.title || t('copyLibrary.untitled'))"
        @click="openDetail(entry)"
        @keydown.enter.prevent="openDetail(entry)"
        @keydown.space.prevent="openDetail(entry)"
      >
        <div class="copy-library-card-top">
        <!-- 与改写区那枚入口的差别只剩「正文要不要回源」：可见性判据两边同形（无频道一律不出现），
             但这里的正文按来源分档判——video 档列表态 content 只是预览，判据用 wordCount；
             其余三档判 content.trim()。判据的唯一实现是下面的 canShowEpisodeEntry。 -->
        <button
          v-if="canShowEpisodeEntry(entry)"
          type="button"
          class="copy-library-podcast-entry"
          :data-testid="'podcast-script-entry-' + entry.id"
          :aria-label="t('podcast.episode.entry')"
          @click.stop="openScriptEntry(entry)"
        >{{ t('podcast.episode.entry') }}</button>
          <span class="copy-library-origin-badge" :class="'is-' + entry.origin">{{ originLabel(entry.origin) }}</span>
          <span class="copy-library-title">{{ entry.title || t('copyLibrary.untitled') }}</span>
          <el-icon class="copy-library-view-icon" aria-hidden="true"><View /></el-icon>
        </div>
        <p class="copy-library-content">{{ entry.content }}</p>
        <div class="copy-library-meta">
          <span>{{ t('copyLibrary.wordCount', { count: entry.wordCount }) }}</span>
          <span v-if="entry.createdAt"> · {{ formatTime(entry.createdAt) }}</span>
          <span v-if="entry.metadata.truncated" :data-testid="'copy-library-truncated-' + entry.id"> · {{ t('copyLibrary.truncated') }}</span>
        </div>
      </article>
    </div>

    <!-- M-15：截断提示 + 加载更多（文案列表可能长期积累，一次全量渲染必然劣化） -->
    <LoadMoreRow v-if="itemsTruncated" data-testid="load-more-copies"
      :hint="t('copyLibrary.shownTruncated', { shown: renderedItems.length, total: filteredItems.length })"
      :button-text="t('copyLibrary.loadMoreCopies')"
      @more="copyRenderLimit += 35" />
  </div>
  <PodcastScriptEntry
    v-if="scriptEntry.openedOnce"
    v-model:visible="scriptEntry.visible"
    :channel-id="podcast.activeChannelId.value"
    :script="scriptEntry.script"
    :title="scriptEntry.title"
  />

</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { View } from '@element-plus/icons-vue'
import { useI18n } from 'vue-i18n'
import EmptyState from '@/components/EmptyState.vue'
import LoadMoreRow from '@/components/LoadMoreRow.vue'
import { useNotify } from '@/composables/useNotify'
import { story2videoGetProject } from '@/api/publisher'
import { setCopyDetailHandoff } from '@/utils/copy-detail-handoff'
import { useCopyLibrarySources, ORIGIN_DRAFT, ORIGIN_VIDEO } from '@/composables/useCopyLibrarySources'
import { ORIGIN_COLLECT, ORIGIN_REWRITE } from '@/composables/useCopyLibrary'
import PodcastScriptEntry from '@/components/PodcastScriptEntry.vue'
import { usePodcastChannel } from '@/composables/usePodcastChannel'

const { t } = useI18n()

// 文本出期入口（PRD §7.10.3.2 / §7.10.3.3）：频道用 usePodcastChannel 的既有解析（本视图不再解析第二份），
// 正文用 resolveCopyBody 的唯一取法；**取到才挂浮层**，先挂再取会让预览拿空正文白跑一趟并弹一句无关原因。
const podcast = usePodcastChannel()
const scriptEntry = ref({ visible: false, openedOnce: false, script: '', title: '' })
// 可见性按来源分档（tasks 4.3②-b 收尾②）：判据只写这一处，模板与点击路径共用。
// - video：列表态 content 只是 sourceText 的前 N 字预览，而来源过滤器只要求 sourceText || title 非空，
//   所以「content 为空、回源有全文」是合法输入 ⇒ 用 wordCount（同一份全文算出来的字数）判。
// - collect / rewrite / draft：正文就在 entry.content 里 ⇒ 判 trim 后非空。
//   rewrite 档原先那个「点了没反应的死按钮」就是这样收掉的：不是点击后拒，而是根本不出现。
// 不得放宽成恒显示，也不得退回统一按 content 判——那会把 video 档的可用入口一起藏掉。
function canShowEpisodeEntry (entry) {
  if (!podcast.activeChannelId.value) return false
  if (!entry || !entry.id) return false
  if (copyEntryOrigin(entry) === ORIGIN_VIDEO) return Number(entry.wordCount) > 0
  return String(entry.content || '').trim().length > 0
}
async function openScriptEntry (entry) {
  if (!canShowEpisodeEntry(entry)) return
  // 频道只读既有解析：v-if 已经保证它非空，原先那句 `|| await ensureChannel()` 是永远走不到的死分支。
  const channelId = podcast.activeChannelId.value
  const content = await resolveCopyBody(entry)
  if (!content || !content.trim()) return
  scriptEntry.value = { visible: true, openedOnce: true, script: content, title: entry.title || '' }
}
const router = useRouter()
const { notifyWarning } = useNotify()
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

// M-15：渲染层截断 —— 文案列表可能长期积累，一次全量渲染必然劣化
const copyRenderLimit = ref(30)
const renderedItems = computed(() => filteredItems.value.slice(0, copyRenderLimit.value))
const itemsTruncated = computed(() => filteredItems.value.length > renderedItems.value.length)

/**
 * 打开文案详情（一键发布页承载，2026-10-09 PRD-COPY-LIBRARY-DETAIL-ENTRY）。
 *
 * - 一次性交接载荷（copy-detail-handoff，读后即焚）携带正文/标题/来源跳转发布页；
 * - 视频来源先拉全文（列表态仅 500 字截断预览），失败降级预览并提示，不阻塞跳转；
 * - 载荷写入失败（存储不可用/content 空）不跳转并提示，避免「点了没反应」或空详情。
 * @param {object} entry 文案库统一条目（UNIFIED_ITEM）
 */
let openingDetail = false
/**
 * 文案库条目的「完整正文」唯一取法（PRD §7.10.3.3）。
 *
 * 列表态对视频来源只有截断预览，必须回源取全文；**详情跳转与播客出期共用这一份**，
 * 各自再写一次拉取就会在分页/草稿态上漂移。origin 在这里再解析一遍是**有意的**：
 * 把 openDetail 里的 sourceId 派生一并搬走会改动它的行为，那需要独立的用例先覆盖，
 * 不为「少三行重复」而静默换语义。
 */
async function resolveCopyBody (entry) {
  let body = entry.content || ''
  if (copyEntryOrigin(entry) === ORIGIN_VIDEO && entry.metadata && entry.metadata.videoProjectId) {
    try {
      const res = await story2videoGetProject(entry.metadata.videoProjectId)
      const fullText = res && res.code === 0 && res.data && typeof res.data.sourceText === 'string' ? res.data.sourceText : ''
      if (fullText.trim()) {
        body = fullText
      } else {
        notifyWarning('copyLibrary.videoFullTextFailed')
      }
    } catch {
      notifyWarning('copyLibrary.videoFullTextFailed')
    }
  }
  return body
}

// 条目 id 形如 `<origin>:<sourceId>`；origin 的取法只留这一份
function copyEntryOrigin (entry) {
  const sep = entry.id.indexOf(':')
  return sep > 0 ? entry.id.slice(0, sep) : entry.origin
}

async function openDetail (entry) {
  if (!entry || !entry.id || openingDetail) return
  openingDetail = true
  try {
  const sep = entry.id.indexOf(':')
  const origin = sep > 0 ? entry.id.slice(0, sep) : entry.origin
  const sourceId = sep > 0 ? entry.id.slice(sep + 1) : ''
  const content = await resolveCopyBody(entry)
  const ok = setCopyDetailHandoff({
    content,
    title: entry.title || '',
    origin,
    sourceId,
    platform: entry.platform || '',
    sourceUrl: entry.sourceUrl || '',
  })
  if (!ok) {
    notifyWarning('copyLibrary.handoffFailed')
    return
  }
  router.push({ path: '/publish', query: { from: 'copy-library' } })
  } finally {
    openingDetail = false
  }
}
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
  font-size: var(--font-size-lg);
}
.copy-library-subtitle {
  margin: 0 0 16px;
  color: var(--color-text-secondary);
  font-size: var(--font-size-sm);
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
  font-size: var(--font-size-sm);
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
  font-size: var(--font-size-sm);
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
  cursor: pointer;
  transition: border-color 0.15s, transform 0.15s, box-shadow 0.15s;
}
.copy-library-card:hover,
.copy-library-card:focus-visible {
  border-color: var(--color-primary);
  transform: translateY(-1px);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
  outline: none;
}
.copy-library-view-icon {
  margin-left: auto;
  color: var(--color-text-secondary);
  flex-shrink: 0;
}
.copy-library-card:hover .copy-library-view-icon {
  color: var(--color-primary);
}
.copy-library-card-static {
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
  font-size: var(--font-size-xs);
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
  font-size: var(--font-size-sm);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.copy-library-content {
  margin: 0;
  font-size: var(--font-size-sm);
  color: var(--color-text-primary);
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
  white-space: pre-line;
}
.copy-library-meta {
  font-size: var(--font-size-xs);
  color: var(--color-text-secondary);
}
</style>
