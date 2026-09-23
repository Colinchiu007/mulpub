<template>
  <div class="cohere-card">
    <!-- Header -->
    <div class="cohere-page-header" style="margin-bottom: var(--space-md);">
      <div style="font-size: var(--font-size-md); font-weight: 600; color: var(--text); display: flex; align-items: center; gap: 8px;">
        <span><el-icon><DataLine /></el-icon> {{ $t('intelligence.benchmarkTitle') }}</span>
      </div>
    </div>

    <!-- Loading -->
    <div v-if="loading" style="padding: 8px 0" data-testid="benchmark-chart-loading">
      <UiSkeleton variant="chart" />
    </div>

    <!-- Error / insufficient data -->
    <div v-else-if="error || (data && data.error)" style="padding: 24px; text-align: center; color: var(--coral); font-size: var(--font-size-sm);">
      ⚠️ {{ error || data.error }}
    </div>

    <!-- Not enough data -->
    <div v-else-if="!data || !data.benchmark" style="padding: 24px; text-align: center;">
      <div v-if="data && data.message" style="color: var(--muted); font-size: var(--font-size-sm);">
        {{ data.message }}
      </div>
      <div v-else style="color: var(--muted); font-size: var(--font-size-sm);">
        数据不足，无法进行基准比较
      </div>
    </div>

    <!-- Results -->
    <div v-else>
      <!-- Sample size badge -->
      <div style="margin-bottom: var(--space-md);">
        <span class="cohere-tag" style="background: #ecf5ff; color: var(--action-blue); border: 1px solid #d9ecff; padding: 2px 10px; border-radius: 4px; font-size: var(--font-size-xs);">
          基于 {{ data.benchmark.sampleSize }} 条同类内容
        </span>
      </div>

      <!-- Engagement stats grid -->
      <div class="cohere-section-title" style="font-size: var(--font-size-sm); font-weight: 500; margin-bottom: var(--space-sm); color: var(--text);">
        互动分统计
      </div>
      <div class="cohere-stat-grid" style="display: grid; grid-template-columns: repeat(4, 1fr); gap: var(--space-sm); margin-bottom: var(--space-md);">
        <div class="cohere-stat-card" style="background: var(--bg); border-radius: 6px; padding: var(--space-md); text-align: center;">
          <div style="font-size: var(--font-size-xs); color: var(--muted); margin-bottom: 4px;">平均互动分</div>
          <div style="font-size: var(--font-size-lg); font-weight: 600; color: var(--text);">{{ data.benchmark.engagement.avg.toFixed(1) }}</div>
        </div>
        <div class="cohere-stat-card" style="background: var(--bg); border-radius: 6px; padding: var(--space-md); text-align: center;">
          <div style="font-size: var(--font-size-xs); color: var(--muted); margin-bottom: 4px;">中位互动分</div>
          <div style="font-size: var(--font-size-lg); font-weight: 600; color: var(--text);">{{ data.benchmark.engagement.median.toFixed(1) }}</div>
        </div>
        <div class="cohere-stat-card" style="background: var(--bg); border-radius: 6px; padding: var(--space-md); text-align: center;">
          <div style="font-size: var(--font-size-xs); color: var(--muted); margin-bottom: 4px;">Top 10%</div>
          <div style="font-size: var(--font-size-lg); font-weight: 600; color: var(--cohere-green);">{{ data.benchmark.engagement.top10.toFixed(1) }}</div>
        </div>
        <div class="cohere-stat-card" style="background: var(--bg); border-radius: 6px; padding: var(--space-md); text-align: center;">
          <div style="font-size: var(--font-size-xs); color: var(--muted); margin-bottom: 4px;">Top 25%</div>
          <div style="font-size: var(--font-size-lg); font-weight: 600; color: #e6a23c;">{{ data.benchmark.engagement.top25.toFixed(1) }}</div>
        </div>
      </div>

      <!-- Upvotes stats -->
      <div class="cohere-section-title" style="font-size: var(--font-size-sm); font-weight: 500; margin-bottom: var(--space-sm); color: var(--text);">
        点赞统计
      </div>
      <div class="cohere-stat-grid" style="display: grid; grid-template-columns: repeat(3, 1fr); gap: var(--space-sm); margin-bottom: var(--space-md);">
        <div class="cohere-stat-card" style="background: var(--bg); border-radius: 6px; padding: var(--space-md); text-align: center;">
          <div style="font-size: var(--font-size-xs); color: var(--muted); margin-bottom: 4px;">平均</div>
          <div style="font-size: var(--font-size-md); font-weight: 600; color: var(--text);">{{ data.benchmark.upvotes.avg.toFixed(0) }}</div>
        </div>
        <div class="cohere-stat-card" style="background: var(--bg); border-radius: 6px; padding: var(--space-md); text-align: center;">
          <div style="font-size: var(--font-size-xs); color: var(--muted); margin-bottom: 4px;">中位数</div>
          <div style="font-size: var(--font-size-md); font-weight: 600; color: var(--text);">{{ data.benchmark.upvotes.median.toFixed(0) }}</div>
        </div>
        <div class="cohere-stat-card" style="background: var(--bg); border-radius: 6px; padding: var(--space-md); text-align: center;">
          <div style="font-size: var(--font-size-xs); color: var(--muted); margin-bottom: 4px;">Top 10%</div>
          <div style="font-size: var(--font-size-md); font-weight: 600; color: var(--cohere-green);">{{ data.benchmark.upvotes.top10.toFixed(0) }}</div>
        </div>
      </div>

      <!-- Comments stats -->
      <div class="cohere-section-title" style="font-size: var(--font-size-sm); font-weight: 500; margin-bottom: var(--space-sm); color: var(--text);">
        评论统计
      </div>
      <div class="cohere-stat-grid" style="display: grid; grid-template-columns: repeat(3, 1fr); gap: var(--space-sm); margin-bottom: var(--space-md);">
        <div class="cohere-stat-card" style="background: var(--bg); border-radius: 6px; padding: var(--space-md); text-align: center;">
          <div style="font-size: var(--font-size-xs); color: var(--muted); margin-bottom: 4px;">平均</div>
          <div style="font-size: var(--font-size-md); font-weight: 600; color: var(--text);">{{ data.benchmark.comments.avg.toFixed(0) }}</div>
        </div>
        <div class="cohere-stat-card" style="background: var(--bg); border-radius: 6px; padding: var(--space-md); text-align: center;">
          <div style="font-size: var(--font-size-xs); color: var(--muted); margin-bottom: 4px;">中位数</div>
          <div style="font-size: var(--font-size-md); font-weight: 600; color: var(--text);">{{ data.benchmark.comments.median.toFixed(0) }}</div>
        </div>
        <div class="cohere-stat-card" style="background: var(--bg); border-radius: 6px; padding: var(--space-md); text-align: center;">
          <div style="font-size: var(--font-size-xs); color: var(--muted); margin-bottom: 4px;">Top 10%</div>
          <div style="font-size: var(--font-size-md); font-weight: 600; color: var(--cohere-green);">{{ data.benchmark.comments.top10.toFixed(0) }}</div>
        </div>
      </div>

      <!-- Top sources -->
      <div v-if="data.benchmark.topSources && data.benchmark.topSources.length" style="margin-top: var(--space-md);">
        <div style="font-size: var(--font-size-sm); color: var(--muted); margin-bottom: 6px;">热门来源</div>
        <div style="display: flex; gap: 6px; flex-wrap: wrap;">
          <span
            v-for="(src, i) in data.benchmark.topSources"
            :key="i"
            class="cohere-tag"
            style="background: #f0f9eb; color: var(--cohere-green); border: 1px solid #e1f3d8; padding: 2px 10px; border-radius: 4px; font-size: var(--font-size-xs);"
          >
            {{ src }}
          </span>
        </div>
      </div>

      <!-- Generated at -->
      <div v-if="data.benchmark.generatedAt" style="margin-top: var(--space-md); font-size: var(--font-size-xs); color: var(--muted); text-align: right;">
        生成时间: {{ data.benchmark.generatedAt }}
      </div>
    </div>

    <div class="cohere-divider" style="margin: var(--space-sm) 0 0;"></div>
  </div>
</template>

<script setup>
import { DataLine } from '@element-plus/icons-vue'
import { ref, onMounted, watch } from 'vue'
import { intelligenceGetBenchmark } from '@/api/publisher'
import { formatUserError } from '@/utils/user-facing-error'

const props = defineProps({
  title: {
    type: String,
    required: true
  }
})

const data = ref(null)
const loading = ref(false)
const error = ref(null)

async function fetchBenchmark() {
  data.value = null
  error.value = null

  if (!props.title || props.title.trim().length < 4) {
    error.value = '标题过短，无法分析'
    return
  }

  loading.value = true
  try {
    const result = await intelligenceGetBenchmark({ keyword: props.title, sampleSize: 12 })
    data.value = result?.code === 0 ? result.data : null
    if (result?.code !== 0) {
      error.value = formatUserError(result, { fallback: '获取基准数据失败' }).message
    }
  } catch (err) {
    error.value = formatUserError(err, { fallback: '获取基准数据失败' }).message
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  fetchBenchmark()
})

watch(() => props.title, () => {
  fetchBenchmark()
})
</script>

<style scoped>
.cohere-card {
  background: var(--card-bg);
  border-radius: 8px;
  padding: var(--space-xl);
}
</style>
