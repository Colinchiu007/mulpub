<template>
  <div class="cohere-page performance-insights" data-testid="performance-insights">
    <div class="cohere-page-header">
      <div>
        <div class="page-title">{{ t('perfInsights.title') }}</div>
        <div class="page-subtitle">{{ t('perfInsights.subtitle') }}</div>
      </div>
      <div class="page-actions">
        <el-select
          v-model="platform"
          size="small"
          class="platform-filter"
          data-testid="pi-platform-filter"
          :aria-label="t('perfInsights.platformFilterAria')"
        >
          <el-option :value="''" :label="t('perfInsights.allPlatforms')" />
          <el-option v-for="p in platformOptions" :key="p" :value="p" :label="platformLabel(p)" />
        </el-select>
        <el-button size="small" data-testid="pi-refresh-btn" :disabled="loading" @click="loadData">
          {{ t('perfInsights.refresh') }}
        </el-button>
        <el-button
          size="small"
          type="primary"
          data-testid="pi-recompute-btn"
          :loading="recomputing"
          :disabled="recomputing"
          @click="recompute"
        >
          {{ t('perfInsights.recompute') }}
        </el-button>
      </div>
    </div>

    <div class="cohere-content">
      <!-- 加载失败横幅：可重试，不吞错误 -->
      <div v-if="loadError" class="pi-error" data-testid="pi-error">
        <span>{{ t('perfInsights.loadFailed') }}</span>
        <el-button link size="small" @click="loadData">{{ t('perfInsights.refresh') }}</el-button>
      </div>

      <!-- 数据概览条：仅在有数据时呈现 -->
      <div v-if="!loading && rows.length > 0" class="pi-overview" data-testid="pi-overview">
        <div class="pi-stat">
          <div class="pi-stat-label">{{ t('perfInsights.overviewSamples') }}</div>
          <div class="pi-stat-value">{{ totalSamples }}</div>
        </div>
        <div class="pi-stat">
          <div class="pi-stat-label">{{ t('perfInsights.overviewPatterns') }}</div>
          <div class="pi-stat-value">{{ rows.length }}</div>
        </div>
        <div class="pi-stat">
          <div class="pi-stat-label">{{ t('perfInsights.overviewUpdated') }}</div>
          <div class="pi-stat-value">{{ latestUpdatedText }}</div>
        </div>
      </div>

      <!-- 全空态：解释数据从哪来，引导去改写/发布闭环 -->
      <div v-if="rows.length === 0 && !loading" class="pi-empty-state" data-testid="pi-empty-state">
        <el-icon class="pi-empty-icon"><DocumentCopy /></el-icon>
        <p class="pi-empty-title">{{ t('perfInsights.emptyTitle') }}</p>
        <p class="pi-empty-hint">{{ t('perfInsights.emptyHint') }}</p>
      </div>

      <!-- 四维卡片：头部（样本量/最优模式/更新时间）+ 排行表或维度内空态 -->
      <div class="pi-grid">
        <section v-for="dim in dimensions" :key="dim.key" class="pi-card" :data-testid="`pi-dim-${dim.key}`">
          <header class="pi-card-head">
            <div class="pi-card-head-main">
              <h3 class="pi-card-title">{{ dimLabel(dim.key) }}</h3>
              <span v-if="bestRow(dim.key)" class="pi-best-chip" data-testid="pi-best-pattern">
                {{ t('perfInsights.bestPrefix') }} · {{ dimValueLabel(dim.key, bestRow(dim.key).value) }}
              </span>
            </div>
            <div class="pi-card-meta">
              <span data-testid="pi-dim-samples">{{ t('perfInsights.samplesSummary', { n: dimSamples(dim.key) }) }}</span>
              <span data-testid="pi-dim-updated">{{ t('perfInsights.updatedAt', { time: dimUpdated(dim.key) }) }}</span>
            </div>
          </header>

          <table v-if="rowsFor(dim.key).length > 0" class="pi-table" v-loading="loading">
            <thead>
              <tr>
                <th class="col-rank">#</th>
                <th class="col-value">{{ t('perfInsights.colValue') }}</th>
                <th class="col-samples">{{ t('perfInsights.colSamples') }}</th>
                <th class="col-metric">{{ t('perfInsights.colAvgViews') }}</th>
                <th class="col-metric">{{ t('perfInsights.colAvgLikes') }}</th>
                <th class="col-metric">{{ t('perfInsights.colAvgComments') }}</th>
                <th class="col-metric">{{ t('perfInsights.colAvgFavorites') }}</th>
                <th class="col-score">
                  <el-tooltip :content="t('perfInsights.scoreFormula')" placement="top">
                    <span class="score-head">{{ t('perfInsights.colScore') }}<el-icon class="score-info"><InfoFilled /></el-icon></span>
                  </el-tooltip>
                </th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(r, idx) in rowsFor(dim.key)" :key="r.id || `${r.value}-${r.platform}`">
                <td class="col-rank"><span class="pi-rank" :class="{ 'is-top': idx === 0 }">{{ idx + 1 }}</span></td>
                <td class="col-value">
                  <span class="pi-value">{{ dimValueLabel(dim.key, r.value) }}</span>
                  <span v-if="r.platform" class="pi-platform-tag">{{ platformLabel(r.platform) }}</span>
                </td>
                <td class="col-samples">
                  <el-tooltip v-if="r.sample_count < LOW_SAMPLE_MIN" :content="t('perfInsights.lowSampleTip', { min: LOW_SAMPLE_MIN })" placement="top">
                    <span class="pi-low-badge" data-testid="pi-low-sample-badge">
                      <el-icon><WarningFilled /></el-icon>{{ r.sample_count }}
                    </span>
                  </el-tooltip>
                  <span v-else class="pi-samples">{{ r.sample_count }}</span>
                </td>
                <td class="col-metric">{{ formatNum(r.avg_views) }}</td>
                <td class="col-metric">{{ formatNum(r.avg_likes) }}</td>
                <td class="col-metric">{{ formatNum(r.avg_comments) }}</td>
                <td class="col-metric">{{ formatNum(r.avg_favorites) }}</td>
                <td class="col-score">
                  <div class="pi-score-cell">
                    <el-progress :percentage="scorePct(r)" :stroke-width="6" :show-text="false" class="pi-score-bar" />
                    <span class="pi-score-num">{{ formatNum(r.engagement_score) }}</span>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>

          <div v-else-if="!loading" class="pi-dim-empty" data-testid="pi-dim-empty">
            <p class="pi-dim-empty-title">{{ t('perfInsights.dimEmptyTitle') }}</p>
            <p class="pi-dim-empty-hint">{{ t('perfInsights.emptyHint') }}</p>
          </div>
        </section>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ElMessage } from 'element-plus'
import { DocumentCopy, InfoFilled, WarningFilled } from '@element-plus/icons-vue'
import { listPatternPerformance, recomputeAttribution } from '@/api/knowledge-library'
import { PLATFORM_NAMES } from '@multi-publish/shared-utils/src/platform-definitions'

const { t } = useI18n()
const rows = ref([])
const loading = ref(false)
const loadError = ref(false)
const recomputing = ref(false)
const platform = ref('')

// 样本低于该阈值的模式行标警告（与后端归因口径一致）
const LOW_SAMPLE_MIN = 3

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
  const prefix = VALUE_KEY_PREFIX[dim]
  if (!prefix || !value) return value || '—'
  const key = prefix + value
  // 已知枚举走 i18n；未知值原样展示（数据兼容，不吞异常值）
  return te(key) ? t(key) : value
}
function te(key) { try { return t(key) !== key } catch { return false } }

// 平台标签：复用 shared-utils 统一口径（douyin → 抖音），未知值原样展示
function platformLabel(p) {
  if (!p) return t('perfInsights.allPlatforms')
  return PLATFORM_NAMES[p] || p
}

// 平台下拉选项：从当前数据派生（platform 为空的聚合行不产生选项）
const platformOptions = computed(() => {
  const set = new Set()
  for (const r of rows.value) { if (r && r.platform) set.add(String(r.platform)) }
  return [...set].sort()
})

function rowsFor(dim) {
  // 前端显式按互动得分降序排行（不依赖后端 ORDER BY 口径，降序稳定排序保持同分原序）
  return rows.value
    .filter(r => r.dimension === dim)
    .slice()
    .sort((a, b) => (Number(b.engagement_score) || 0) - (Number(a.engagement_score) || 0))
}

function dimSamples(dim) {
  return rowsFor(dim).reduce((sum, r) => sum + (Number(r.sample_count) || 0), 0)
}

// 最优模式 = 该维度互动得分最高行（已按得分降序，取首行）
function bestRow(dim) {
  const list = rowsFor(dim)
  return list.length ? list[0] : null
}

function fmtTime(iso) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function dimUpdated(dim) {
  const times = rowsFor(dim).map(r => r.computed_at).filter(Boolean)
  if (!times.length) return '—'
  return fmtTime(times.reduce((a, b) => (a > b ? a : b)))
}

const totalSamples = computed(() => rows.value.reduce((sum, r) => sum + (Number(r.sample_count) || 0), 0))

const latestUpdatedText = computed(() => {
  const times = rows.value.map(r => r.computed_at).filter(Boolean)
  if (!times.length) return '—'
  return fmtTime(times.reduce((a, b) => (a > b ? a : b)))
})

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
  loadError.value = false
  try {
    const params = platform.value ? { platform: platform.value } : {}
    const res = await listPatternPerformance(params)
    rows.value = (res && res.code === 0 && res.data && res.data.items) || []
  } catch {
    loadError.value = true
    rows.value = []
  } finally {
    loading.value = false
  }
}

async function recompute() {
  // 进行中守卫：防重复触发全量重算（幂等但开销大）
  if (recomputing.value) return
  recomputing.value = true
  try {
    const res = await recomputeAttribution()
    if (res && res.code === 0) {
      ElMessage.success(t('perfInsights.recomputeDone'))
      await loadData()
    } else {
      ElMessage.error((res && res.message) || t('perfInsights.recomputeFailed'))
    }
  } catch {
    ElMessage.error(t('perfInsights.recomputeFailed'))
  } finally {
    recomputing.value = false
  }
}

watch(platform, loadData)

onMounted(loadData)
</script>

<style scoped>
/* ── 头部操作区 ─────────────────────────────── */
.performance-insights .page-actions {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
}
.platform-filter { width: 140px; flex: 0 0 auto; }

/* ── 错误横幅 ───────────────────────────────── */
.pi-error {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  padding: var(--space-sm) var(--space-md);
  margin-bottom: var(--space-lg);
  border: 1px solid var(--color-danger);
  border-radius: var(--radius-sm);
  background: var(--color-bg-inset);
  color: var(--color-danger);
  font-size: var(--font-size-sm);
}

/* ── 概览条 ─────────────────────────────────── */
.pi-overview {
  display: flex;
  gap: var(--space-xl);
  padding: var(--space-md) var(--space-lg);
  margin-bottom: var(--space-lg);
  background: var(--color-bg-card);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
}
.pi-stat { display: flex; flex-direction: column; gap: 2px; }
.pi-stat-label { font-size: var(--font-size-xs); color: var(--color-text-muted); }
.pi-stat-value { font-size: var(--font-size-md); font-weight: 600; color: var(--color-text-strong); }

/* ── 全空态 ─────────────────────────────────── */
.pi-empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-sm);
  padding: 64px var(--space-xl);
  text-align: center;
  background: var(--color-bg-card);
  border: 1px dashed var(--color-border-strong);
  border-radius: var(--radius-md);
  margin-bottom: var(--space-lg);
}
.pi-empty-icon { font-size: var(--font-size-xxl); color: var(--color-text-muted); opacity: .5; }
.pi-empty-title { margin: 0; font-size: var(--font-size-base); font-weight: 600; color: var(--color-text-primary); }
.pi-empty-hint { margin: 0; font-size: var(--font-size-sm); color: var(--color-text-muted); max-width: 420px; line-height: 1.6; }

/* ── 维度卡片网格 ───────────────────────────── */
.pi-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--space-lg);
  align-items: start;
}
@media (max-width: 1200px) {
  .pi-grid { grid-template-columns: 1fr; }
}

.pi-card {
  background: var(--color-bg-card);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  padding: var(--space-lg);
  display: flex;
  flex-direction: column;
  gap: var(--space-md);
}
.pi-card-head { display: flex; flex-direction: column; gap: var(--space-xs); }
.pi-card-head-main { display: flex; align-items: center; gap: var(--space-sm); min-width: 0; }
.pi-card-title { margin: 0; font-size: var(--font-size-base); font-weight: 600; color: var(--color-text-strong); }
.pi-best-chip {
  display: inline-flex;
  align-items: center;
  padding: 2px 10px;
  border-radius: var(--radius-pill);
  background: var(--color-primary-light);
  color: var(--color-primary);
  font-size: var(--font-size-xs);
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.pi-card-meta {
  display: flex;
  gap: var(--space-md);
  font-size: var(--font-size-xs);
  color: var(--color-text-muted);
}

/* ── 排行表 ─────────────────────────────────── */
.pi-table { width: 100%; border-collapse: collapse; font-size: var(--font-size-xs); }
.pi-table th {
  text-align: left;
  padding: 6px 8px;
  color: var(--color-text-muted);
  font-weight: 500;
  border-bottom: 1px solid var(--color-border);
  white-space: nowrap;
}
.pi-table td {
  padding: 8px;
  border-bottom: 1px solid var(--color-border);
  color: var(--color-text-primary);
  white-space: nowrap;
}
.pi-table tbody tr:last-child td { border-bottom: 0; }
.pi-table tbody tr:hover td { background: var(--color-bg-inset); }
.col-rank { width: 28px; }
.col-value { min-width: 96px; }
.col-samples { width: 56px; }
.col-metric { width: 64px; text-align: right; }
.pi-table th.col-metric { text-align: right; }
.col-score { width: 120px; }
.score-head { display: inline-flex; align-items: center; gap: 3px; cursor: default; }
.score-info { font-size: var(--font-size-xs); color: var(--color-text-muted); }

.pi-rank {
  display: inline-grid;
  place-items: center;
  width: 20px;
  height: 20px;
  border-radius: var(--radius-full);
  background: var(--color-bg-inset);
  color: var(--color-text-secondary);
  font-size: var(--font-size-xs);
}
.pi-rank.is-top { background: var(--color-primary); color: var(--color-bg-card); font-weight: 600; }

.pi-value { font-weight: 500; }
.pi-platform-tag {
  margin-left: 6px;
  padding: 1px 6px;
  border-radius: var(--radius-xs);
  background: var(--color-bg-inset);
  color: var(--color-text-secondary);
  font-size: var(--font-size-xs);
}

.pi-samples { color: var(--color-text-primary); }
.pi-low-badge {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 1px 8px;
  border-radius: var(--radius-pill);
  background: var(--color-bg-inset);
  color: var(--color-warning);
  font-weight: 600;
  cursor: help;
}
.pi-low-badge .el-icon { font-size: var(--font-size-xs); }

.pi-score-cell { display: flex; align-items: center; gap: var(--space-sm); }
.pi-score-bar { flex: 1; min-width: 40px; }
.pi-score-num { font-variant-numeric: tabular-nums; color: var(--color-text-secondary); }

/* ── 维度内空态 ─────────────────────────────── */
.pi-dim-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: var(--space-xl) var(--space-md);
  text-align: center;
  border: 1px dashed var(--color-border-strong);
  border-radius: var(--radius-sm);
}
.pi-dim-empty-title { margin: 0; font-size: var(--font-size-sm); color: var(--color-text-secondary); }
.pi-dim-empty-hint { margin: 0; font-size: var(--font-size-xs); color: var(--color-text-muted); line-height: 1.6; }
</style>
