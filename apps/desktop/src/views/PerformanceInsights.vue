<template>
  <div class="cohere-page performance-insights" data-testid="performance-insights">
    <div class="cohere-page-header">
      <div>
        <div class="page-title">{{ t('perfInsights.title') }}</div>
        <div class="page-subtitle">{{ t('perfInsights.subtitle') }}</div>
      </div>
      <div class="page-actions">
        <el-button size="small" @click="loadData">{{ t('perfInsights.refresh') }}</el-button>
        <el-button size="small" type="primary" @click="recompute">{{ t('perfInsights.recompute') }}</el-button>
      </div>
    </div>

    <div class="cohere-content">
      <div v-if="rows.length === 0 && !loading" class="empty-state">
        <p>{{ t('perfInsights.emptyTitle') }}</p>
        <p class="empty-hint">{{ t('perfInsights.emptyHint') }}</p>
      </div>

      <div v-for="dim in dimensions" :key="dim.key" class="dimension-block">
        <h3 class="dim-title">{{ dimLabel(dim.key) }}</h3>
        <el-table :data="rowsFor(dim.key)" size="small" v-loading="loading">
          <el-table-column :label="t('perfInsights.colValue')" min-width="140">
            <template #default="{ row }">{{ dimValueLabel(dim.key, row.value) }}</template>
          </el-table-column>
          <el-table-column :label="t('perfInsights.colSamples')" width="90">
            <template #default="{ row }">
              <span :class="{ 'low-sample': row.sample_count < 3 }">{{ row.sample_count }}</span>
              <span v-if="row.sample_count < 3" class="sample-warn">{{ t('perfInsights.lowSample') }}</span>
            </template>
          </el-table-column>
          <el-table-column prop="avg_views" :label="t('perfInsights.colAvgViews')" width="110">
            <template #default="{ row }">{{ formatNum(row.avg_views) }}</template>
          </el-table-column>
          <el-table-column prop="avg_likes" :label="t('perfInsights.colAvgLikes')" width="100">
            <template #default="{ row }">{{ formatNum(row.avg_likes) }}</template>
          </el-table-column>
          <el-table-column prop="avg_comments" :label="t('perfInsights.colAvgComments')" width="100">
            <template #default="{ row }">{{ formatNum(row.avg_comments) }}</template>
          </el-table-column>
          <el-table-column prop="avg_favorites" :label="t('perfInsights.colAvgFavorites')" width="100">
            <template #default="{ row }">{{ formatNum(row.avg_favorites) }}</template>
          </el-table-column>
          <el-table-column :label="t('perfInsights.colScore')" width="120">
            <template #default="{ row }">
              <el-progress :percentage="scorePct(row)" :stroke-width="12" :format="() => formatNum(row.engagement_score)" />
            </template>
          </el-table-column>
        </el-table>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { ElMessage } from 'element-plus'
import { listPatternPerformance, recomputeAttribution } from '@/api/knowledge-library'

const { t } = useI18n()
const rows = ref([])
const loading = ref(false)

const dimensions = [
  { key: 'hook_type' },
  { key: 'emotion_curve' },
  { key: 'narrative_structure' },
  { key: 'cta_style' },
]

const DIM_LABELS = { hook_type: 'perfInsights.dimHook', emotion_curve: 'perfInsights.dimCurve', narrative_structure: 'perfInsights.dimNarrative', cta_style: 'perfInsights.dimCta' }
// 值标签复用模式分析的枚举 key（同一套枚举体系）
const VALUE_KEY_PREFIX = { hook_type: 'knowledgeBase.patternHook_', emotion_curve: 'knowledgeBase.patternCurve_', narrative_structure: 'knowledgeBase.patternNarrative_', cta_style: 'knowledgeBase.patternCta_' }

function dimLabel(dim) { return t(DIM_LABELS[dim] || dim) }
function dimValueLabel(dim, value) {
  const key = (VALUE_KEY_PREFIX[dim] || '') + value
  // 已知枚举走 i18n；未知值原样展示（数据兼容）
  return key !== 'knowledgeBase.patternHook_' + value && te(key) ? t(key) : (value || '—')
}
function te(key) { try { return t(key) !== key } catch { return false } }

function rowsFor(dim) {
  return rows.value.filter(r => r.dimension === dim)
}

function formatNum(v) {
  const n = Number(v) || 0
  return n >= 10000 ? (n / 10000).toFixed(1) + t('perfInsights.tenThousand') : String(Math.round(n))
}

function scorePct(row) {
  const max = Math.max(...rowsFor(row.dimension).map(r => Number(r.engagement_score) || 0), 1)
  return Math.round(((Number(row.engagement_score) || 0) / max) * 100)
}

async function loadData() {
  loading.value = true
  try {
    const res = await listPatternPerformance({})
    rows.value = (res && res.code === 0 && res.data && res.data.items) || []
  } catch {
    rows.value = []
  } finally {
    loading.value = false
  }
}

async function recompute() {
  try {
    const res = await recomputeAttribution()
    if (res && res.code === 0) {
      ElMessage.success(t('perfInsights.recomputeDone'))
      loadData()
    } else {
      ElMessage.error((res && res.message) || t('perfInsights.recomputeFailed'))
    }
  } catch {
    ElMessage.error(t('perfInsights.recomputeFailed'))
  }
}

onMounted(loadData)
</script>

<style scoped>
.empty-state { text-align: center; padding: 60px 0; color: var(--el-text-color-secondary); }
.empty-hint { font-size: 13px; margin-top: 8px; }
.dimension-block { margin-bottom: 28px; }
.dim-title { margin: 0 0 10px; font-size: 15px; }
.low-sample { color: var(--el-color-warning); }
.sample-warn { font-size: 12px; color: var(--el-color-warning); margin-left: 4px; }
</style>
