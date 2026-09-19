<template>
  <UiModal
    :visible="visible"
    @close="$emit('update:visible', false)"
    title="🔗 引用查找"
    width="600px"
    :close-on-click-modal="false"
    destroy-on-close
  >
    <!-- Search bar -->
    <div style="display:flex;gap:var(--space-sm);margin-bottom:var(--space-md)">
      <input
        class="cohere-input"
        v-model="query"
        placeholder="输入搜索关键词..."
        style="flex:1;font-size:14px"
        @keyup.enter="doSearch"
      />
      <button class="cohere-btn-primary" @click="doSearch" :disabled="!query.trim() || searching">
        搜索
      </button>
    </div>

    <!-- Loading -->
    <div v-if="searching" style="text-align:center;padding:30px 0;color:var(--muted);font-size:13px">
      搜索中...
    </div>

    <!-- Empty state -->
    <div v-else-if="!searched" style="text-align:center;padding:30px 0;color:var(--muted);font-size:13px">
      输入关键词搜索权威来源
    </div>

    <!-- No results -->
    <div v-else-if="searched && (!results || results.length === 0)" style="text-align:center;padding:30px 0;color:var(--muted);font-size:13px">
      未找到相关来源
    </div>

    <!-- Results -->
    <div v-else style="display:flex;flex-direction:column;gap:var(--space-sm)">
      <div v-for="(ref, idx) in results" :key="idx"
        style="padding:var(--space-sm);background:#f8f9fa;border-radius:6px;border:1px solid var(--border)">
        <!-- Title -->
        <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:var(--space-sm);margin-bottom:4px">
          <a :href="ref.url" target="_blank" rel="noopener"
            style="font-size:14px;font-weight:600;color:var(--action-blue);text-decoration:none;flex:1;min-width:0"
            @mouseover="e => e.target.style.textDecoration = 'underline'"
            @mouseout="e => e.target.style.textDecoration = 'none'">
            {{ ref.title }}
          </a>
          <button class="cohere-btn-ghost" @click="insertReference(ref)" style="font-size:12px;padding:2px 8px;white-space:nowrap">
            插入
          </button>
        </div>

        <!-- Source badge -->
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
          <span style="font-size:11px;font-weight:600;padding:1px 6px;border-radius:3px;background:var(--border);color:var(--muted)">
            {{ ref.source }}
          </span>
          <span style="font-size:11px;color:var(--muted)">互动: {{ ref.engagement }}</span>
        </div>

        <!-- Snippet -->
        <div v-if="ref.snippet" style="font-size:12px;color:var(--muted);line-height:1.4;margin-bottom:6px">
          {{ ref.snippet.slice(0, 180) }}<span v-if="ref.snippet.length > 180">...</span>
        </div>

        <!-- Relevance score bar -->
        <div style="display:flex;align-items:center;gap:6px">
          <span style="font-size:11px;color:var(--muted);white-space:nowrap">相关度</span>
          <div style="flex:1;height:6px;background:var(--border);border-radius:3px;overflow:hidden">
            <div :style="{
              width: Math.min(ref.relevance || 0, 60) / 60 * 100 + '%',
              height: '100%',
              borderRadius: '3px',
              background: relevanceColor(ref.relevance || 0),
              transition: 'width 0.3s ease',
            }"></div>
          </div>
          <span :style="{ fontSize: '11px', color: relevanceColor(ref.relevance || 0), fontWeight: 600 }">
            {{ ref.relevance || 0 }}
          </span>
        </div>
      </div>
    </div>
  </UiModal>
</template>

<script setup>
import UiModal from "../components/UiModal.vue";
import { ref, watch } from 'vue'
import { intelligenceFindReferences } from '@/api/publisher'
import { reportError } from '@/utils/report-error'

const props = defineProps({
  visible: { type: Boolean, required: true },
  searchText: { type: String, default: '' },
})

const emit = defineEmits(['update:visible', 'insert-reference'])

const query = ref(props.searchText)
const searching = ref(false)
const searched = ref(false)
const results = ref(null)

watch(() => props.searchText, (val) => {
  query.value = val
})

watch(() => props.visible, (val) => {
  if (val) {
    query.value = props.searchText
    if (props.searchText && props.searchText.trim()) {
      doSearch()
    }
  } else {
    searched.value = false
    results.value = null
  }
})

function relevanceColor (score) {
  if (score >= 40) return '#67c23a'
  if (score >= 20) return '#e6a23c'
  return '#999'
}

async function doSearch () {
  if (!query.value.trim() || searching.value) return
  searching.value = true
  searched.value = true
  try {
    const res = await intelligenceFindReferences(query.value.trim(), { limit: 5 })
    const data = res?.code === 0 ? res.data : null
    results.value = (data && data.references) || []
  } catch (e) {
    reportError('参考内容查找失败', e)
    results.value = []
  } finally {
    searching.value = false
  }
}

function insertReference (ref) {
  emit('insert-reference', { title: ref.title, url: ref.url, snippet: ref.snippet || '' })
  emit('update:visible', false)
}
</script>

<style scoped>
/* Dialog needs custom styling for the relevance bars */
/* :deep(.el-dialog__body) removed - using UiModal */
</style>
