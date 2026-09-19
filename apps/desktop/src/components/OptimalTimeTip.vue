<template>
  <div class="cohere-card" style="cursor:default;padding:16px">
    <div style="font-weight:600;font-size:14px;margin-bottom:var(--space-md);padding-bottom:var(--space-sm);border-bottom:1px solid var(--border)">
      ⏰ 最佳发布时间
    </div>

    <!-- Loading -->
    <div v-if="loading" style="padding:20px 0" data-testid="optimal-time-loading">
      <UiSkeleton variant="text" width="60%" style="margin:0 auto" />
    </div>

    <!-- Short keyword -->
    <div v-else-if="!keyword || keyword.trim().length < 2" style="padding:12px 0;font-size:12px;color:var(--muted);text-align:center">
      请输入更长的关键词
    </div>

    <!-- Error -->
    <div v-else-if="error" style="padding:12px 0;font-size:13px;color:var(--coral)">
      {{ error }}
    </div>

    <!-- Not enough data -->
    <div v-else-if="notEnoughData" style="padding:12px 0;font-size:12px;color:var(--muted);text-align:center">
      数据不足，无法分析最佳发布时间
    </div>

    <!-- Results -->
    <div v-else-if="data">
      <!-- Best hour highlight -->
      <div style="text-align:center;padding:var(--space-md);margin-bottom:var(--space-md);background:linear-gradient(135deg,var(--surface)3e0,#ffe0b2);border-radius:10px">
        <div style="font-size:11px;color:var(--muted);margin-bottom:4px">推荐发布时段</div>
        <div style="font-size:36px;font-weight:800;color:#e65100;line-height:1.1">{{ data.bestHourCN }}:00</div>
        <div style="font-size:12px;color:var(--muted);margin-top:6px">
          最佳发布时段 UTC {{ data.bestHourUTC }}:00（北京时间 {{ data.bestHourCN }}:00）
        </div>
      </div>

      <!-- Top 3 hours -->
      <div style="margin-bottom:var(--space-md)">
        <div style="font-size:12px;color:var(--muted);margin-bottom:6px">其他推荐时段：</div>
        <div v-for="h in topHours" :key="h.hourCN" style="display:flex;align-items:center;gap:8px;padding:4px 0">
          <span style="font-size:13px;font-weight:600;min-width:50px;color:var(--text)">{{ h.hourCN }}:00</span>
          <div style="flex:1;height:8px;background:var(--border);border-radius:4px;overflow:hidden">
            <div :style="{
              width: barWidth(h.score),
              height: '100%',
              borderRadius: '4px',
              background: 'linear-gradient(90deg, #ffcc80, #e65100)',
              transition: 'width 0.4s ease',
            }"></div>
          </div>
          <span style="font-size:12px;color:var(--muted);min-width:40px;text-align:right">{{ h.score.toFixed(1) }}</span>
        </div>
      </div>

      <!-- Data badges -->
      <div style="display:flex;gap:var(--space-sm);flex-wrap:wrap;margin-bottom:var(--space-sm)">
        <span class="cohere-tag cohere-tag-info" style="font-size:11px">
          📊 {{ data.dataPoints || 0 }} 条数据
        </span>
      </div>

      <!-- Source distribution -->
      <div v-if="data.bySource" style="border-top:1px solid var(--border);padding-top:var(--space-sm)">
        <div style="font-size:12px;color:var(--muted);margin-bottom:4px">数据来源分布：</div>
        <div style="display:flex;flex-wrap:wrap;gap:6px">
          <span v-for="(count, source) in data.bySource" :key="source" class="cohere-tag" style="font-size:11px;background:var(--border);color:var(--text);padding:2px 8px;border-radius:4px">
            {{ source }}: {{ count }}
          </span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, watch, computed, onBeforeUnmount } from 'vue'
import { intelligenceGetOptimalTime } from '@/api/publisher'
import { formatUserError } from '@/utils/user-facing-error'

const props = defineProps({
  keyword: { type: String, required: true },
})

const loading = ref(false)
const error = ref(null)
const data = ref(null)
const notEnoughData = ref(false)

const topHours = computed(() => {
  if (!data.value || !data.value.topHours) return []
  return [...data.value.topHours]
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
})

function barWidth (score) {
  return Math.min(Math.max((score / 100) * 100, 5), 100) + '%'
}

let debounceTimer = null
// R20 修复：组件卸载时清理 debounce timer
onBeforeUnmount(() => { if (debounceTimer) clearTimeout(debounceTimer) })
watch(() => props.keyword, (newVal) => {
  if (debounceTimer) clearTimeout(debounceTimer)
  if (!newVal || newVal.trim().length < 2) {
    data.value = null
    error.value = null
    notEnoughData.value = false
    return
  }
  debounceTimer = setTimeout(async () => {
    loading.value = true
    error.value = null
    data.value = null
    notEnoughData.value = false
    try {
      const res = await intelligenceGetOptimalTime(newVal.trim())
      const payload = res?.code === 0 ? res.data : null
      if (payload && payload.recommendation) {
        const rec = payload.recommendation
        if (rec.topHours && rec.topHours.length > 0) {
          data.value = {
            topHours: rec.topHours,
            bestHourUTC: rec.bestHourUTC,
            bestHourCN: rec.bestHourCN,
            summary: rec.summary || '',
            dataPoints: rec.dataPoints || 0,
            bySource: payload.bySource || {},
          }
        } else {
          notEnoughData.value = true
        }
      } else {
        notEnoughData.value = true
      }
    } catch (e) {
      error.value = '分析失败: ' + formatUserError(e, { fallback: '未知错误' }).message
    } finally {
      loading.value = false
    }
  }, 600)
})
</script>

<style scoped>
</style>
