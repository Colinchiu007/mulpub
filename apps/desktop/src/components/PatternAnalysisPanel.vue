<template>
  <div class="pattern-panel" data-testid="pattern-analysis-panel">
    <div class="pattern-toolbar">
      <el-select v-model="statusFilter" size="small" style="width:160px" @change="loadData">
        <el-option :label="t('knowledgeBase.patternFilterAll')" value="" />
        <el-option :label="t('knowledgeBase.patternStatusPending')" value="pending" />
        <el-option :label="t('knowledgeBase.patternStatusDone')" value="done" />
        <el-option :label="t('knowledgeBase.patternStatusFailed')" value="failed" />
      </el-select>
      <el-button size="small" @click="loadData">{{ t('knowledgeBase.patternRefresh') }}</el-button>
    </div>

    <el-table :data="cards" v-loading="loading" size="small" style="width:100%">
      <el-table-column prop="viral_item_id" :label="t('knowledgeBase.patternColId')" width="110" show-overflow-tooltip />
      <el-table-column :label="t('knowledgeBase.patternColStatus')" width="90">
        <template #default="{ row }">
          <el-tag v-if="row.status === 'done'" type="success" size="small">{{ t('knowledgeBase.patternStatusDone') }}</el-tag>
          <el-tag v-else-if="row.status === 'pending'" type="warning" size="small">{{ t('knowledgeBase.patternStatusPending') }}</el-tag>
          <el-tag v-else-if="row.status === 'failed'" type="danger" size="small">{{ t('knowledgeBase.patternStatusFailed') }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column :label="t('knowledgeBase.patternColHook')" width="100">
        <template #default="{ row }">{{ hookLabel(row.hook_type) }}</template>
      </el-table-column>
      <el-table-column :label="t('knowledgeBase.patternColCurve')" width="110">
        <template #default="{ row }">{{ curveLabel(row.emotion_curve) }}</template>
      </el-table-column>
      <el-table-column :label="t('knowledgeBase.patternColFormula')" min-width="200" show-overflow-tooltip>
        <template #default="{ row }">{{ row.title_formula || '—' }}</template>
      </el-table-column>
      <el-table-column :label="t('knowledgeBase.patternColAttempts')" width="70" prop="attempts" />
      <el-table-column :label="t('knowledgeBase.patternColActions')" width="150">
        <template #default="{ row }">
          <el-button size="small" text type="primary" @click="showDetail(row)">{{ t('knowledgeBase.patternDetail') }}</el-button>
          <el-button size="small" text @click="reextract(row)">{{ t('knowledgeBase.patternReextract') }}</el-button>
        </template>
      </el-table-column>
    </el-table>

    <el-pagination
      v-if="total > pageSize"
      layout="prev, pager, next"
      :total="total"
      :page-size="pageSize"
      :current-page="page"
      @current-change="onPageChange"
      style="margin-top:12px;justify-content:flex-end"
    />

    <el-drawer v-model="detailVisible" :title="t('knowledgeBase.patternDetailTitle')" size="40%">
      <div v-if="detailCard" class="pattern-detail">
        <div class="detail-row"><span class="detail-label">{{ t('knowledgeBase.patternColStatus') }}:</span>{{ statusLabel(detailCard.status) }}</div>
        <div class="detail-row"><span class="detail-label">{{ t('knowledgeBase.patternColHook') }}:</span>{{ hookLabel(detailCard.hook_type) }}</div>
        <div class="detail-row" v-if="detailCard.hook_analysis"><span class="detail-label">{{ t('knowledgeBase.patternHookAnalysis') }}:</span>{{ detailCard.hook_analysis }}</div>
        <div class="detail-row"><span class="detail-label">{{ t('knowledgeBase.patternColCurve') }}:</span>{{ curveLabel(detailCard.emotion_curve) }}</div>
        <div class="detail-row"><span class="detail-label">{{ t('knowledgeBase.patternColNarrative') }}:</span>{{ narrativeLabel(detailCard.narrative_structure) }}</div>
        <div class="detail-row"><span class="detail-label">{{ t('knowledgeBase.patternColCta') }}:</span>{{ ctaLabel(detailCard.cta_style) }}</div>
        <div class="detail-row"><span class="detail-label">{{ t('knowledgeBase.patternColFormula') }}:</span>{{ detailCard.title_formula || '—' }}</div>
        <div v-if="detailCard.golden_quotes && detailCard.golden_quotes.length" class="detail-row">
          <span class="detail-label">{{ t('knowledgeBase.patternGoldenQuotes') }}:</span>
          <ul class="quote-list"><li v-for="(q, i) in detailCard.golden_quotes" :key="i">{{ q }}</li></ul>
        </div>
        <div class="detail-row" v-if="detailCard.last_error"><span class="detail-label">{{ t('knowledgeBase.patternLastError') }}:</span>{{ detailCard.last_error }}</div>
      </div>
    </el-drawer>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { userFacingErrorMessage } from '@/utils/user-facing-error'
import { useI18n } from 'vue-i18n'
import { ElMessage } from 'element-plus'
import { listPatternCards, reextractPattern } from '@/api/knowledge-library'

const { t } = useI18n()
const cards = ref([])
const total = ref(0)
const page = ref(1)
const pageSize = 20
const loading = ref(false)
const statusFilter = ref('')
const detailVisible = ref(false)
const detailCard = ref(null)

// 枚举标签走 i18n（显式 key 映射，静态扫描可识别；禁止硬编码中文——CI Gate 7 CJK 门禁）
const HOOK_KEYS = { suspense: 'knowledgeBase.patternHook_suspense', conflict: 'knowledgeBase.patternHook_conflict', counterintuitive: 'knowledgeBase.patternHook_counterintuitive', question: 'knowledgeBase.patternHook_question', story: 'knowledgeBase.patternHook_story', data: 'knowledgeBase.patternHook_data', empathy: 'knowledgeBase.patternHook_empathy', other: 'knowledgeBase.patternHook_other' }
const CURVE_KEYS = { rise: 'knowledgeBase.patternCurve_rise', fall: 'knowledgeBase.patternCurve_fall', rise_fall: 'knowledgeBase.patternCurve_rise_fall', fall_rise: 'knowledgeBase.patternCurve_fall_rise', wave: 'knowledgeBase.patternCurve_wave', flat: 'knowledgeBase.patternCurve_flat' }
const NARRATIVE_KEYS = { total_subtotal: 'knowledgeBase.patternNarrative_total_subtotal', problem_solution: 'knowledgeBase.patternNarrative_problem_solution', chronological: 'knowledgeBase.patternNarrative_chronological', contrast: 'knowledgeBase.patternNarrative_contrast', list: 'knowledgeBase.patternNarrative_list', story_lesson: 'knowledgeBase.patternNarrative_story_lesson' }
const CTA_KEYS = { question: 'knowledgeBase.patternCta_question', challenge: 'knowledgeBase.patternCta_challenge', resource: 'knowledgeBase.patternCta_resource', follow: 'knowledgeBase.patternCta_follow', comment: 'knowledgeBase.patternCta_comment', none: 'knowledgeBase.patternCta_none' }

function hookLabel(v) { return v && HOOK_KEYS[v] ? t(HOOK_KEYS[v]) : (v || '—') }
function curveLabel(v) { return v && CURVE_KEYS[v] ? t(CURVE_KEYS[v]) : (v || '—') }
function narrativeLabel(v) { return v && NARRATIVE_KEYS[v] ? t(NARRATIVE_KEYS[v]) : (v || '—') }
function ctaLabel(v) { return v && CTA_KEYS[v] ? t(CTA_KEYS[v]) : (v || '—') }
function statusLabel(v) { return v === 'done' ? t('knowledgeBase.patternStatusDone') : v === 'pending' ? t('knowledgeBase.patternStatusPending') : t('knowledgeBase.patternStatusFailed') }

async function loadData() {
  loading.value = true
  try {
    const params = { page: page.value, pageSize }
    if (statusFilter.value) params.status = statusFilter.value
    const res = await listPatternCards(params)
    if (res && res.code === 0 && res.data) {
      cards.value = res.data.items || []
      total.value = res.data.total || 0
    } else {
      cards.value = []
      total.value = 0
    }
  } catch {
    cards.value = []
    total.value = 0
  } finally {
    loading.value = false
  }
}

function onPageChange(p) {
  page.value = p
  loadData()
}

function showDetail(row) {
  detailCard.value = row
  detailVisible.value = true
}

async function reextract(row) {
  try {
    const res = await reextractPattern(row.viral_item_id)
    if (res && res.code === 0) {
      ElMessage.success(t('knowledgeBase.patternReextractQueued'))
      loadData()
    } else {
      ElMessage.error(userFacingErrorMessage(res, () => t('knowledgeBase.patternReextractFailed')))
    }
  } catch {
    ElMessage.error(t('knowledgeBase.patternReextractFailed'))
  }
}

onMounted(loadData)
defineExpose({ loadData })
</script>

<style scoped>
.pattern-panel { padding: 0; }
.pattern-toolbar { display: flex; gap: 8px; margin-bottom: 12px; }
.pattern-detail { padding: 0 8px; }
.detail-row { margin-bottom: 10px; line-height: 1.6; }
.detail-label { color: var(--el-text-color-secondary); font-weight: 500; }
.quote-list { margin: 4px 0 0 18px; padding: 0; }
.quote-list li { margin-bottom: 4px; }
</style>
