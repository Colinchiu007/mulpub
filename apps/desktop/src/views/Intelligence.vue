<template>
  <div>
    <div class="cohere-page-header">
      <div style="display:flex;align-items:center;gap:var(--space-md);width:100%">
        <div style="flex:1">
          <div class="page-title">内容情报</div>
          <div class="page-subtitle">
            跨平台搜索主题热度、高互动内容，为创作提供数据参考
            <span v-if="searching" style="margin-left:8px;color:var(--coral)">搜索中...</span>
          </div>
        </div>
        <div style="font-size:12px;color:var(--muted)">
          数据源: Reddit · HN · GitHub
        </div>
      </div>
    </div>

    <!-- 热门趋势面板 -->
    <TrendingPanel style="margin-bottom:var(--space-md)" />

    <!-- 搜索栏 -->
    <div class="cohere-content">
      <div class="cohere-card" style="cursor:default">
        <div style="display:flex;gap:var(--space-sm);align-items:flex-end">
          <div style="flex:1">
            <label class="cohere-form-label">搜索主题</label>
            <input
              class="cohere-input"
              v-model="query"
              placeholder="输入关键词，搜索各平台的高互动内容..."
              @keyup.enter="doSearch"
              style="font-size:14px"
            />
          </div>
          <button class="cohere-btn-primary" @click="doSearch" :disabled="!query.trim() || searching">
            🔍 搜索
          </button>
          <button class="cohere-btn-ghost" @click="clearSearch" :disabled="!query.trim()" title="清空">
            ✕
          </button>
        </div>

        <!-- 来源筛选 -->
        <div style="display:flex;gap:12px;margin-top:var(--space-sm);flex-wrap:wrap">
          <label v-for="s in sourceOptions" :key="s.id" style="display:flex;align-items:center;gap:4px;font-size:13px;cursor:pointer">
            <input type="checkbox" :value="s.id" v-model="selectedSources" style="accent-color:var(--coral)" />
            {{ s.label }}
          </label>
          <span style="margin-left:auto;font-size:12px;color:var(--muted)">
            按真实互动评分排序（非 SEO）
          </span>
        </div>
      </div>

      <!-- 搜索结果 -->
      <div v-if="result" class="cohere-card" style="cursor:default;margin-top:var(--space-md)">
        <div style="display:flex;align-items:center;gap:var(--space-sm);margin-bottom:var(--space-md)">
          <span style="font-weight:600;font-size:15px">📊 搜索结果</span>
          <span class="cohere-tag cohere-tag-info">{{ result.total }} 条</span>
          <span style="font-size:12px;color:var(--muted);margin-left:auto">
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
          <div style="display:flex;align-items:flex-start;gap:var(--space-sm)">
            <div style="flex:1;min-width:0">
              <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px">
                <span class="source-badge" :style="{ background: sourceColor(item.source) + '20', color: sourceColor(item.source), fontSize: '11px', padding: '2px 8px', borderRadius: '4px', fontWeight: 600 }">
                  {{ sourceLabel(item.source) }}
                </span>
                <span style="font-size:12px;color:var(--muted)">{{ item.author }}</span>
              </div>
              <a :href="item.url" target="_blank" rel="noopener"
                style="font-size:14px;font-weight:600;color:var(--text);text-decoration:none;display:block;margin-bottom:4px"
                @mouseover="e => e.target.style.color = 'var(--coral)'"
                @mouseout="e => e.target.style.color = 'var(--text)'">
                {{ item.title }}
              </a>
              <div v-if="item.snippet" style="font-size:13px;color:var(--muted);margin-bottom:4px;line-height:1.4">
                {{ item.snippet.slice(0, 150) }}<span v-if="item.snippet.length > 150">...</span>
              </div>
              <div style="display:flex;gap:12px;font-size:12px;color:var(--muted)">
                <span>👍 {{ item.upvotes }}</span>
                <span>💬 {{ item.comments }}</span>
                <span v-if="item.extra?.labels">🏷 {{ item.extra.labels.join(', ') }}</span>
              </div>
            </div>
            <div style="text-align:right;flex-shrink:0">
              <div class="engagement-score" :style="{ color: scoreColor(item.engagement) }">
                {{ item.engagement.toFixed(1) }}
              </div>
              <div style="font-size:10px;color:var(--muted)">互动分</div>
              <button class="cohere-btn-ghost" @click="useAsReference(item)" title="作为参考" style="margin-top:4px;font-size:12px">
                📋 参考
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- 标题分析 -->
      <div v-if="titleAnalysis" class="cohere-card" style="cursor:default;margin-top:var(--space-md)">
        <div style="font-weight:600;font-size:15px;margin-bottom:var(--space-sm)">📝 标题分析</div>
        <div v-if="titleAnalysis.patterns" style="margin-bottom:var(--space-sm)">
          <div style="font-size:13px;color:var(--muted);margin-bottom:6px">高互动标题高频词：</div>
          <div style="display:flex;flex-wrap:wrap;gap:6px">
            <span v-for="[word, count] in titleAnalysis.patterns" :key="word"
              class="cohere-tag" :class="count >= 3 ? 'cohere-tag-success' : 'cohere-tag-info'">
              {{ word }} ({{ count }})
            </span>
          </div>
        </div>
        <div v-if="titleAnalysis.suggestion" class="intel-tip" style="background:var(--surface)3e0;border-radius:8px;padding:12px;font-size:13px">
          💡 {{ titleAnalysis.suggestion.tip }}
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
  const map = { reddit: '#FF4500', hackernews: '#FF6600', github: 'var(--ink)' }
  return map[s] || 'var(--text-muted)'
}

function scoreColor (score) {
  if (score >= 2.0) return '#2e7d32'
  if (score >= 1.0) return '#f57c00'
  return 'var(--text-muted)'
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
</style>
