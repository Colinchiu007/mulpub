<template>
  <div v-if="visible" class="title-assistant">
    <div class="ta-header">
      <span style="font-weight:600;font-size:13px">📊 标题参考</span>
      <button class="cohere-btn-ghost" @click="$emit('close')" style="font-size:12px;padding:2px 6px">✕</button>
    </div>
    <div v-if="loading" style="text-align:center;padding:20px 0;font-size:13px;color:var(--muted)">
      正在分析同类标题...
    </div>
    <div v-else-if="error" style="padding:12px;font-size:13px;color:var(--coral)">
      {{ error }}
    </div>
    <div v-else-if="!data" style="padding:12px;font-size:12px;color:var(--muted);text-align:center">
      输入标题后自动分析
    </div>
    <div v-else>
      <!-- 标题建议 -->
      <div v-if="data.suggestion" class="ta-section">
        <div class="ta-tip">
          💡 {{ data.suggestion.tip }}
        </div>
      </div>

      <!-- 高频词 -->
      <div v-if="data.patterns" class="ta-section">
        <div style="font-size:12px;color:var(--muted);margin-bottom:4px">同类标题高频词：</div>
        <div style="display:flex;flex-wrap:wrap;gap:4px">
          <span v-for="[word, count] in data.patterns" :key="word"
            class="cohere-tag"
            :style="{
              fontSize: '11px',
              background: count >= 3 ? 'var(--coral)' : 'var(--border)',
              color: count >= 3 ? 'var(--surface)' : 'var(--muted)',
              padding: '2px 6px',
              borderRadius: '4px'
            }">
            {{ word }}
          </span>
        </div>
      </div>

      <!-- 参考标题列表 -->
      <div v-if="data.titles && data.titles.length > 0" class="ta-section">
        <div style="font-size:12px;color:var(--muted);margin-bottom:4px">高互动参考：</div>
        <div v-for="t in data.titles.slice(0, 5)" :key="t.id" class="ta-ref-item">
          <div style="font-size:12px;line-height:1.3;margin-bottom:2px">{{ t.title }}</div>
          <div style="font-size:11px;color:var(--muted)">
            <span :style="{ color: scoreColor(t.engagement) }">🔥 {{ t.engagement.toFixed(1) }}</span>
            <span v-if="t.source === 'reddit'" style="margin-left:6px">Reddit</span>
            <span v-else-if="t.source === 'hackernews'" style="margin-left:6px">HN</span>
            <span v-else style="margin-left:6px">GitHub</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, watch, onBeforeUnmount } from 'vue'
import { intelligenceSearchTitles } from '@/api/publisher'
import { formatUserError } from '@/utils/user-facing-error'

const props = defineProps({
  title: { type: String, default: '' },
  visible: { type: Boolean, default: false },
})

// eslint-disable-next-line no-unused-vars
const emit = defineEmits(['close'])

const loading = ref(false)
const data = ref(null)
const error = ref(null)

function scoreColor (score) {
  if (score >= 2.0) return '#2e7d32'
  if (score >= 1.0) return '#f57c00'
  return '#999'
}

// Debounced search when title changes
let debounceTimer = null
// R20 修复：组件卸载时清理 debounce timer（原未清理导致卸载后 async 回调修改已销毁组件状态）
onBeforeUnmount(() => { if (debounceTimer) clearTimeout(debounceTimer) })
watch(() => props.title, (newVal) => {
  if (debounceTimer) clearTimeout(debounceTimer)
  if (!newVal || newVal.length < 3) {
    data.value = null
    return
  }
  debounceTimer = setTimeout(async () => {
    loading.value = true
    error.value = null
    try {
      const res = await intelligenceSearchTitles(newVal, { limit: 6 })
      const payload = res?.code === 0 ? res.data : null
      if (payload && payload.titleAnalysis) {
        const analysis = payload.titleAnalysis
        data.value = {
          patterns: analysis.patterns,
          suggestion: analysis.suggestion,
          titles: (payload.results || []).slice(0, 6),
        }
      } else {
        data.value = null
      }
    } catch (e) {
      error.value = '搜索失败: ' + formatUserError(e, { fallback: '未知错误' }).message
      data.value = null
    } finally {
      loading.value = false
    }
  }, 800) // 800ms debounce
})

watch(() => props.visible, (v) => {
  if (!v) { data.value = null; error.value = null }
})
</script>

<style scoped>
.title-assistant {
  background: var(--card-bg, var(--surface));
  border: 1px solid var(--border, #e0e0e0);
  border-radius: 8px;
  padding: 12px;
  margin-top: 12px;
  font-size: 13px;
}
.ta-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--border, #e0e0e0);
}
.ta-section {
  margin-bottom: 10px;
}
.ta-tip {
  background: var(--surface)3e0;
  border-left: 3px solid #f57c00;
  padding: 8px 10px;
  border-radius: 4px;
  font-size: 12px;
  line-height: 1.4;
}
.ta-ref-item {
  padding: 6px 0;
  border-bottom: 1px solid var(--border, var(--border));
}
.ta-ref-item:last-child { border-bottom: none; }
</style>
