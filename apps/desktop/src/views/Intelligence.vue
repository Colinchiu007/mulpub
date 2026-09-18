<template>
  <div>
    <div class="cohere-page-header">
      <div class="int-header-row">
        <div class="int-header-main">
          <div class="page-title">内容情报</div>
          <div class="page-subtitle">
            跨平台搜索主题热度、高互动内容，为创作提供数据参考
            <span v-if="searching" class="int-searching">搜索中...</span>
          </div>
        </div>
        <div class="int-note">
          数据源: Reddit · HN · GitHub
        </div>
      </div>
    </div>

    <!-- 热门趋势面板 -->
    <TrendingPanel class="int-mb-md" />

    <!-- 搜索栏 -->
    <div class="cohere-content">
      <div class="cohere-card int-card-static">
        <div class="int-search-row">
          <div class="int-header-main">
            <label class="cohere-form-label">搜索主题</label>
            <input
              class="cohere-input int-input-md"
              v-model="query"
              placeholder="输入关键词，搜索各平台的高互动内容..."
              @keyup.enter="doSearch"
            />
          </div>
          <button class="cohere-btn-primary" @click="doSearch" :disabled="!query.trim() || searching">
            <el-icon><Search /></el-icon> {{ $t('intelligence.searchLabel') }}
          </button>
          <button class="cohere-btn-ghost" @click="clearSearch" :disabled="!query.trim()" title="清空">
            ✕
          </button>
        </div>

        <!-- 来源筛选 -->
        <div class="int-source-row">
          <label v-for="s in sourceOptions" :key="s.id" class="int-check-label">
            <input type="checkbox" :value="s.id" v-model="selectedSources" class="int-check-accent" />
            {{ s.label }}
          </label>
          <span class="int-note int-note--auto">
            按真实互动评分排序（非 SEO）
          </span>
        </div>
      </div>

      <!-- 搜索结果 -->
      <div v-if="result" class="cohere-card int-card-static int-mt-md">
        <div class="int-result-head">
          <span class="int-result-title"><el-icon><DataLine /></el-icon> {{ $t('intelligence.searchResults') }}</span>
          <span class="cohere-tag cohere-tag-info">{{ result.total }} 条</span>
          <span class="int-note int-note--auto">
            搜索于 {{ formatTime(result.timestamp) }}
          </span>
        </div>

        <EmptyState v-if="result.total === 0" :title="$t('emptyStates.intelligence.title')" />

        <div v-for="item in result.results" :key="`${item.source}-${item.id}`"
          class="intel-item"
          :style="{
            borderLeft: `3px solid ${sourceColor(item.source)}`,
            paddingLeft: '12px',
            marginBottom: 'var(--space-sm)',
            paddingBottom: 'var(--space-sm)',
            borderBottom: '1px solid var(--border)'
          }">
          <div class="int-item-row">
            <div class="int-item-main">
              <div class="int-badge-row">
                <span class="source-badge" :style="{ background: sourceColor(item.source) + '20', color: sourceColor(item.source) }">
                  {{ sourceLabel(item.source) }}
                </span>
                <span class="int-note">{{ item.author }}</span>
              </div>
              <a :href="item.url" target="_blank" rel="noopener"
                class="int-link">
                {{ item.title }}
              </a>
              <div v-if="item.snippet" class="int-snippet">
                {{ item.snippet.slice(0, 150) }}<span v-if="item.snippet.length > 150">...</span>
              </div>
              <div class="int-meta-row">
                <span>👍 {{ item.upvotes }}</span>
                <span>💬 {{ item.comments }}</span>
                <span v-if="item.extra?.labels">🏷 {{ item.extra.labels.join(', ') }}</span>
              </div>
            </div>
            <div class="int-score-side">
              <div class="engagement-score" :style="{ color: scoreColor(item.engagement) }">
                {{ item.engagement.toFixed(1) }}
              </div>
              <div class="int-score-hint">互动分</div>
              <button class="cohere-btn-ghost int-ref-btn" @click="useAsReference(item)" title="作为参考">
                <el-icon><DocumentCopy /></el-icon> {{ $t('intelligence.reference') }}
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- 标题分析 -->
      <div v-if="titleAnalysis" class="cohere-card int-card-static int-mt-md">
        <div class="int-result-title int-result-title--block"><el-icon><EditPen /></el-icon> {{ $t('intelligence.titleAnalysis') }}</div>
        <div v-if="titleAnalysis.patterns" class="int-mb-sm">
          <div class="int-pattern-hint">高互动标题高频词：</div>
          <div class="int-tag-row">
            <span v-for="[word, count] in titleAnalysis.patterns" :key="word"
              class="cohere-tag" :class="count >= 3 ? 'cohere-tag-success' : 'cohere-tag-info'">
              {{ word }} ({{ count }})
            </span>
          </div>
        </div>
        <div v-if="titleAnalysis.suggestion" class="intel-tip int-tip-fix">
          <el-icon><InfoFilled /></el-icon> {{ titleAnalysis.suggestion.tip }}
        </div>
      </div>
    </div>

    <!-- 引用查找对话框 -->
    <ReferenceFinder v-model:visible="refVisible" :searchText="refSearchText" @insert-reference="insertRef" />
  </div>
</template>

<script setup>
// eslint-disable-next-line no-unused-vars
import UiButton from "../components/UiButton.vue";
// eslint-disable-next-line no-unused-vars
import UiInput from "../components/UiInput.vue";
// eslint-disable-next-line no-unused-vars
import { ref, computed } from 'vue'
import { DocumentCopy, DataLine, EditPen, InfoFilled, Search } from '@element-plus/icons-vue'
import { useNotify } from '@/composables/useNotify'
import TrendingPanel from '@/components/TrendingPanel.vue'
import ReferenceFinder from '@/components/ReferenceFinder.vue'
import { intelligenceSearch, intelligenceSearchTitles } from '@/api/publisher'
import { reportError } from '@/utils/report-error'
import { formatDateTime } from '@/utils/datetime'

const query = ref('')
const searching = ref(false)
const result = ref(null)
const titleAnalysis = ref(null)
const { notifySuccess } = useNotify()

const sourceOptions = [
  { id: 'reddit', label: 'Reddit' },
  { id: 'hackernews', label: 'Hacker News' },
  { id: 'github', label: 'GitHub' },
]
const selectedSources = ref(['reddit', 'hackernews', 'github'])

const formatTime = (ts) => formatDateTime(ts, { invalidText: ts })

function sourceLabel (s) {
  const map = { reddit: 'Reddit', hackernews: 'HN', github: 'GitHub' }
  return map[s] || s
}

function sourceColor (s) {
  const map = { reddit: 'var(--color-source-reddit)', hackernews: 'var(--color-source-hn)', github: 'var(--color-text-primary)' }
  return map[s] || 'var(--color-text-muted)'
}

function scoreColor (score) {
  if (score >= 2.0) return '#2e7d32'
  if (score >= 1.0) return '#f57c00'
  return 'var(--color-text-muted)'
}

async function doSearch () {
  if (!query.value.trim() || searching.value) return
  searching.value = true
  result.value = null
  titleAnalysis.value = null
  try {
    const res = await intelligenceSearch(query.value.trim(), {
      sources: selectedSources.value,
      limit: 10,
    })
    result.value = res?.code === 0 ? res.data : null

    // Also get title analysis
    const titleRes = await intelligenceSearchTitles(query.value.trim(), {
      sources: selectedSources.value,
    })
    titleAnalysis.value = titleRes?.code === 0 ? (titleRes.data?.titleAnalysis || null) : null
  } catch (e) {
    reportError('Intelligence 搜索失败', e)
  } finally {
    searching.value = false
  }
}

function clearSearch () {
  query.value = ''
  result.value = null
  titleAnalysis.value = null
}

function useAsReference (item) {
  refSearchText.value = item.title
  refVisible.value = true
}

const refVisible = ref(false)
const refSearchText = ref('')

function insertRef (ref) {
  notifySuccess('intelligence.insertedRef', { params: { title: ref.title.slice(0, 30) } })
}
</script>

<style scoped>
.intel-item:hover {
  background: var(--hover-bg, var(--bg));
  border-radius: 4px;
}
.engagement-score {
  font-size: 20px;
  font-weight: 700;
  line-height: 1;
}
.intel-tip {
  border-left: 3px solid var(--coral,#f57c00);
  border-left: 3px solid #f57c00;
}

/* T1-3e：原 36 处内联样式全部类化；颜色一律 var(--color-*)。
 * 来源品牌色/情报分值色收编 tokens.css（--color-source-*/--color-intel-score-*）；
 * 链接 hover 由 JS mouseover/out 改为 CSS :hover；修复 .intel-tip 损坏的 var(--surface)3e0。 */
.int-header-row { display: flex; align-items: center; gap: var(--space-md); width: 100%; }
.int-header-main { flex: 1; }
.int-searching { margin-left: 8px; color: var(--color-danger); }
.int-note { font-size: var(--font-size-xs); color: var(--color-text-muted); }
.int-note--auto { margin-left: auto; }
.int-mb-md { margin-bottom: var(--space-md); }
.int-mb-sm { margin-bottom: var(--space-sm); }
.int-mt-md { margin-top: var(--space-md); }
.int-card-static { cursor: default; }
.int-search-row { display: flex; gap: var(--space-sm); align-items: flex-end; }
.int-search-main { flex: 1; }
.int-input-md { font-size: 14px; }
.int-source-row { display: flex; gap: 12px; margin-top: var(--space-sm); flex-wrap: wrap; }
.int-check-label { display: flex; align-items: center; gap: 4px; font-size: var(--font-size-sm); cursor: pointer; }
.int-check-accent { accent-color: var(--color-danger); }
.int-result-head { display: flex; align-items: center; gap: var(--space-sm); margin-bottom: var(--space-md); }
.int-result-title { font-weight: 600; font-size: var(--font-size-base); }
.int-result-title--block { margin-bottom: var(--space-sm); }
.int-item-row { display: flex; align-items: flex-start; gap: var(--space-sm); }
.int-item-main { flex: 1; min-width: 0; }
.int-badge-row { display: flex; align-items: center; gap: 6px; margin-bottom: 4px; }
.int-link { font-size: 14px; font-weight: 600; color: var(--color-text-primary); text-decoration: none; display: block; margin-bottom: 4px; }
.int-link:hover { color: var(--color-danger); }
.int-snippet { font-size: var(--font-size-sm); color: var(--color-text-muted); margin-bottom: 4px; line-height: 1.4; }
.int-meta-row { display: flex; gap: 12px; font-size: var(--font-size-xs); color: var(--color-text-muted); }
.int-score-side { text-align: right; flex-shrink: 0; }
.int-score-hint { font-size: 10px; color: var(--color-text-muted); }
.int-ref-btn { margin-top: 4px; font-size: var(--font-size-xs); }
.int-pattern-hint { font-size: var(--font-size-sm); color: var(--color-text-muted); margin-bottom: 6px; }
.int-tag-row { display: flex; flex-wrap: wrap; gap: 6px; }
.int-tip-fix { background: var(--color-bg-inset); border-radius: var(--r-sm); padding: 12px; font-size: var(--font-size-sm); }
.source-badge { font-size: 11px; padding: 2px 8px; border-radius: var(--r-xs); font-weight: 600; }

</style>
