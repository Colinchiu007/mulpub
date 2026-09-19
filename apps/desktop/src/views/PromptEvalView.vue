<template>
  <div class="prompt-eval-page">
    <div class="page-header">
      <h1>🧪 提示词优化效果评估</h1>
      <p class="text-muted">对提示词优化引擎的输出（生成图片）打分、归因并产出可优化提示的点；视频评估预留（v2）</p>
    </div>

    <!-- 视图切换 -->
    <div class="view-tabs">
      <button :class="['view-tab', { active: tab === 'run' }]" @click="tab = 'run'">运行评估</button>
      <button :class="['view-tab', { active: tab === 'history' }]" @click="switchHistory">历史记录</button>
      <button :class="['view-tab', { active: tab === 'analyze' }]" @click="switchAnalyze">聚合分析</button>
    </div>

    <div v-if="errorBanner" class="error-banner" role="alert">⚠️ {{ errorBanner }}</div>

    <!-- ==================== 运行评估 ==================== -->
    <div v-if="tab === 'run'" class="eval-run">
      <div class="eval-form card">
        <div class="form-row">
          <label>生成图片（支持多选，同文案连续图放同一批）</label>
          <input ref="fileInput" type="file" multiple accept="image/*" @change="onPickImages" />
          <div v-if="selectedImages.length" class="thumb-list">
            <div v-for="(img, i) in selectedImages" :key="i" class="thumb-item">
              <img :src="img.url" :alt="img.name" />
              <span class="thumb-name">{{ img.name }}</span>
              <button class="btn-remove" @click="removeImage(i)">✕</button>
            </div>
          </div>
        </div>
        <div class="form-row">
          <label>原始文案（sourceText）</label>
          <textarea v-model="form.sourceText" rows="3" placeholder="该文案对应的原始输入文字（可多行）"></textarea>
        </div>
        <div class="form-row">
          <label>文案上下文（context，可选）</label>
          <textarea v-model="form.context" rows="3" placeholder="整个文案上下文；留空时只使用原始文案"></textarea>
        </div>
        <div class="form-row">
          <label>优化后的提示词（optimizedPrompt，必填）</label>
          <textarea v-model="form.optimizedPrompt" rows="4" placeholder="prompt-engine 输出的优化后图片提示词"></textarea>
        </div>
        <div class="form-row">
          <label>负向提示（negativePrompt，可选）</label>
          <textarea v-model="form.negativePrompt" rows="2" placeholder="如：现代电器, 英文文字"></textarea>
        </div>
        <div class="form-actions">
          <button class="btn-primary" :disabled="running" @click="startEval">
            {{ running ? '评估中（' + progressText + '）...' : '开始评估' }}
          </button>
          <span v-if="hasEvaluatorHint" class="hint">需要先在「模型服务商」配置并启用视觉评估模型</span>
        </div>
      </div>

      <div v-if="report" class="eval-result card">
        <div class="result-head">
          <span class="score-big" :class="'grade-' + report.grade">{{ report.overallScore }}</span>
          <div>
            <div class="grade-badge">{{ gradeLabel(report.grade) }}</div>
            <div class="result-meta">记录 {{ report.id }} · {{ report.evaluatedAt }}</div>
            <div v-if="report.overallMismatch" class="warn-text">⚠️ LLM 总体分与加权分偏差超过 10 分</div>
          </div>
        </div>
        <div class="dim-list">
          <div v-for="d in report.dimensions" :key="d.id" class="dim-row">
            <span class="dim-label">{{ dimLabel(d.id) }}</span>
            <div class="dim-bar"><div class="dim-fill" :style="{ width: d.score + '%' }"></div></div>
            <span class="dim-score">{{ d.score }}</span>
            <span class="dim-evidence">{{ d.evidence }}</span>
          </div>
        </div>
        <div v-if="report.problems && report.problems.length" class="section">
          <h3>问题清单（按严重度）</h3>
          <div v-for="(p, i) in report.problems" :key="i" class="problem-item" :class="'sev-' + p.severity">
            <span class="sev-tag">{{ sevLabel(p.severity) }}</span>
            <span class="cat-tag">{{ p.category }}</span>
            <span class="problem-desc">{{ p.description }}</span>
            <span class="problem-part">归因：{{ partLabel(p.promptPart) }}</span>
            <span v-if="p.suggestion" class="problem-suggestion">建议：{{ p.suggestion }}</span>
          </div>
        </div>
        <div v-if="report.promptOptimizationPoints && report.promptOptimizationPoints.length" class="section">
          <h3>提示词优化点（可回馈提示词优化引擎）</h3>
          <div v-for="(pt, i) in report.promptOptimizationPoints" :key="i" class="point-item">
            <span class="point-type">{{ pt.type }}</span>
            <span class="point-suggestion">{{ pt.suggestion }}</span>
            <button class="btn-copy" @click="copyText(pt.suggestion)">复制</button>
          </div>
        </div>
        <div class="section">
          <h3>操作</h3>
          <button class="btn-ghost" @click="copyText(JSON.stringify(report, null, 2))">复制 JSON</button>
          <button class="btn-ghost" @click="reloadRecords">查看历史</button>
        </div>
      </div>
    </div>

    <!-- ==================== 历史记录 ==================== -->
    <div v-if="tab === 'history'" class="eval-history card">
      <EmptyState v-if="!records.length" :title="$t('emptyStates.promptEvalRecords.title')" />
      <table v-else class="record-table">
        <thead><tr><th>时间</th><th>ID</th><th>总分</th><th>等级</th><th>图片数</th><th>操作</th></tr></thead>
        <tbody>
          <tr v-for="r in records" :key="r.id">
            <td>{{ r.evaluatedAt }}</td>
            <td class="mono">{{ r.id }}</td>
            <td><strong>{{ r.overallScore }}</strong></td>
            <td>{{ gradeLabel(r.grade) }}</td>
            <td>{{ r.imageCount || '-' }}</td>
            <td>
              <button class="btn-ghost" @click="openDetail(r.id)">详情</button>
              <button class="btn-danger" @click="removeRecord(r.id)">删除</button>
            </td>
          </tr>
        </tbody>
      </table>
      <div v-if="detail" class="detail-panel">
        <button class="back-btn" @click="detail = null">← 返回列表</button>
        <pre class="detail-json">{{ JSON.stringify(detail, null, 2) }}</pre>
      </div>
    </div>

    <!-- ==================== 聚合分析 ==================== -->
    <div v-if="tab === 'analyze'" class="eval-analyze card">
      <EmptyState v-if="!stats" :title="$t('emptyStates.promptEvalStats.title')" />
      <template v-else>
        <div class="stat-cards">
          <div class="stat-card"><span class="stat-num">{{ stats.recordCount }}</span>评估记录</div>
          <div class="stat-card"><span class="stat-num">{{ stats.averageOverall }}</span>平均分</div>
        </div>
        <div class="section">
          <h3>等级分布</h3>
          <pre>{{ JSON.stringify(stats.gradeDistribution, null, 2) }}</pre>
        </div>
        <div class="section">
          <h3>维度均值</h3>
          <div v-for="d in stats.dimensionAverages" :key="d.id" class="dim-row">
            <span class="dim-label">{{ dimLabel(d.id) }}</span>
            <div class="dim-bar"><div class="dim-fill" :style="{ width: (d.average || 0) + '%' }"></div></div>
            <span class="dim-score">{{ d.average }}</span>
          </div>
        </div>
        <div class="section">
          <h3>问题类别分布</h3>
          <div v-for="c in stats.problemCategories" :key="c.category" class="cat-line">
            {{ c.category }}：{{ c.count }} 次（{{ JSON.stringify(c.severity) }}）
          </div>
        </div>
        <div class="section">
          <h3>优化点汇总</h3>
          <div v-for="pt in stats.optimizationPoints" :key="pt.type" class="point-item">
            <span class="point-type">{{ pt.type }}</span>
            <span class="point-suggestion">{{ (pt.examples && pt.examples[0]) || '' }}</span>
            <span class="point-count">×{{ pt.count }}</span>
          </div>
        </div>
        <div class="section">
          <h3>推荐动作</h3>
          <ul><li v-for="(r, i) in stats.recommendations" :key="i">{{ r }}</li></ul>
        </div>
      </template>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, computed } from 'vue'
import { getApi } from '@/api/electron-bridge'
import { useI18n } from 'vue-i18n'
import { ElMessage } from 'element-plus'
import { usePromptEval } from '@/composables/prompt-eval'
import { confirmDanger } from '@/utils/confirm-danger'

const tab = ref('run')
const { t } = useI18n()
const fileInput = ref(null)
const selectedImages = ref([])
const form = ref({ sourceText: '', context: '', optimizedPrompt: '', negativePrompt: '' })
const running = ref(false)
const progressText = ref('')
const report = ref(null)
const errorBanner = ref('')
const records = ref([])
const detail = ref(null)
const stats = ref(null)
const dimensionsMeta = ref(null)
const hasEvaluatorHint = ref(false)

const { run, list, get, remove, loadAnalyze, loadDimensions } = usePromptEval()

const DIM_LABELS = {
  relevance: '提示-输出关联度',
  content_accuracy: '内容准确性',
  aesthetic_quality: '视觉审美质量',
  cross_image_consistency: '跨图上下文一致性',
}
const GRADE_LABELS = { excellent: '优秀', good: '良好', fair: '一般', poor: '差' }
const SEV_LABELS = { critical: '🔴 Critical', major: '🟠 Major', minor: '🟡 Minor' }
const PART_LABELS = { source_text: '原文', context: '上下文', optimized_prompt: '优化后提示词', negative_prompt: '负向提示', unknown: '未知' }

const dimLabel = (id) => DIM_LABELS[id] || id
const gradeLabel = (g) => GRADE_LABELS[g] || g
const sevLabel = (s) => SEV_LABELS[s] || s
const partLabel = (p) => PART_LABELS[p] || p

function onPickImages(event) {
  const files = Array.from(event.target.files || [])
  for (const file of files) {
    const api = getApi()
    let filePath
    try {
      filePath = api && typeof api.getPathForFile === 'function' ? String(api.getPathForFile(file) || '') : ''
    } catch (_) { filePath = '' }
    selectedImages.value.push({
      name: file.name,
      url: URL.createObjectURL(file),
      filePath,
      file,
    })
  }
  if (fileInput.value) fileInput.value.value = ''
}

function removeImage(index) {
  const img = selectedImages.value[index]
  if (img && img.url) URL.revokeObjectURL(img.url)
  selectedImages.value.splice(index, 1)
}

function validateBeforeRun() {
  if (!selectedImages.value.length) return '请先选择至少 1 张图片'
  if (!form.value.optimizedPrompt.trim()) return '请填写优化后的提示词'
  if (!form.value.sourceText.trim() && !form.value.context.trim()) return '请填写原始文案或文案上下文'
  return null
}

async function startEval() {
  const problem = validateBeforeRun()
  if (problem) { errorBanner.value = problem; return }
  errorBanner.value = ''
  const items = selectedImages.value.map((img, i) => ({
    imagePath: img.filePath || img.url,
    sourceText: form.value.sourceText.trim(),
    context: form.value.context.trim() ? { synopsis: form.value.context.trim() } : null,
    optimizedPrompt: form.value.optimizedPrompt.trim(),
    negativePrompt: form.value.negativePrompt.trim() || '',
    imageIndex: i,
  }))
  running.value = true
  progressText.value = '0/' + items.length
  try {
    report.value = await run({ mediaType: 'image', items, options: { language: 'zh', temperature: 0 } })
    progressText.value = items.length + '/' + items.length
    await reloadRecords()
  } catch (e) {
    errorBanner.value = '评估失败：' + (e && e.message ? e.message : String(e))
    if (e && e.code === 'EVAL_LLM_UNAVAILABLE') hasEvaluatorHint.value = true
  } finally {
    running.value = false
  }
}

async function reloadRecords() {
  records.value = await list()
}

async function switchHistory() {
  tab.value = 'history'
  await reloadRecords()
}

async function openDetail(id) {
  detail.value = await get(id)
}

async function removeRecord(id) {
  const confirmed = await confirmDanger({
    title: t('promptEval.deleteConfirmTitle'),
    message: t('promptEval.deleteConfirmMessage', { id }),
    confirmText: t('promptEval.deleteConfirmButton'),
  })
  if (!confirmed) return
  try {
    await remove(id)
    if (detail.value && detail.value.id === id) detail.value = null
  } catch (e) {
    ElMessage.error(t('promptEval.deleteFailed'))
  }
}

async function switchAnalyze() {
  tab.value = 'analyze'
  stats.value = await loadAnalyze()
}

function copyText(text) {
  try { navigator.clipboard.writeText(text) } catch (_) { /* ignore */ }
}

onMounted(async () => {
  dimensionsMeta.value = await loadDimensions()
  await reloadRecords()
})
</script>

<style scoped>
.prompt-eval-page { padding: 20px; max-width: 1100px; }
.view-tabs { display: flex; gap: 8px; margin: 16px 0; }
.view-tab { padding: 8px 16px; border: 1px solid #d9d9d9; background: var(--color-bg-card); border-radius: 6px; cursor: pointer; }
.view-tab.active { background: #1f6feb; color: #fff; border-color: #1f6feb; }
.card { background: var(--color-bg-card); border: 1px solid #e5e7eb; border-radius: 8px; padding: 16px; margin-bottom: 16px; }
.form-row { margin-bottom: 12px; }
.form-row label { display: block; font-weight: 600; margin-bottom: 6px; }
textarea { width: 100%; border: 1px solid #d9d9d9; border-radius: 6px; padding: 8px; font-size: var(--font-size-sm); }
.thumb-list { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 8px; }
.thumb-item { position: relative; width: 96px; }
.thumb-item img { width: 96px; height: 72px; object-fit: cover; border-radius: 6px; border: 1px solid #ddd; }
.thumb-name { display: block; font-size: var(--font-size-xs); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 96px; }
.btn-remove { position: absolute; top: -6px; right: -6px; background: #d64545; color: #fff; border: none; border-radius: 50%; width: 20px; height: 20px; cursor: pointer; }
.btn-primary { background: #1f6feb; color: #fff; border: none; border-radius: 6px; padding: 8px 20px; cursor: pointer; }
.btn-primary:disabled { opacity: 0.6; cursor: not-allowed; }
.btn-ghost { background: var(--color-bg-card); border: 1px solid #d9d9d9; border-radius: 6px; padding: 6px 12px; margin-right: 8px; cursor: pointer; }
.btn-danger { background: var(--color-bg-card); border: 1px solid #d64545; color: #d64545; border-radius: 6px; padding: 6px 12px; cursor: pointer; }
.error-banner { background: #fde8e8; border: 1px solid #f5b5b5; color: #b42318; border-radius: 6px; padding: 10px 14px; margin-bottom: 12px; }
.hint { color: #888; font-size: var(--font-size-xs); margin-left: 10px; }
.result-head { display: flex; gap: 16px; align-items: center; margin-bottom: 12px; }
.score-big { font-size: 44px; font-weight: 700; line-height: 1; }
.grade-excellent { color: #1a7f37; }
.grade-good { color: #1f6feb; }
.grade-fair { color: #d97706; }
.grade-poor { color: #d64545; }
.grade-badge { font-size: var(--font-size-sm); font-weight: 600; }
.result-meta { color: #888; font-size: var(--font-size-xs); }
.warn-text { color: #d97706; font-size: var(--font-size-xs); margin-top: 4px; }
.dim-row { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
.dim-label { width: 150px; font-size: var(--font-size-sm); }
.dim-bar { flex: 1; background: #f0f0f0; border-radius: 4px; height: 12px; }
.dim-fill { height: 12px; background: #1f6feb; border-radius: 4px; }
.dim-score { width: 40px; text-align: right; font-weight: 600; }
.dim-evidence { flex: 1.2; color: #666; font-size: var(--font-size-xs); }
.section { margin-top: 14px; }
.section h3 { font-size: var(--font-size-sm); margin-bottom: 8px; }
.problem-item { border: 1px solid #eee; border-radius: 6px; padding: 8px; margin-bottom: 6px; font-size: var(--font-size-sm); }
.sev-critical { border-left: 4px solid #d64545; }
.sev-major { border-left: 4px solid #d97706; }
.sev-minor { border-left: 4px solid #eab308; }
.sev-tag { font-weight: 700; margin-right: 8px; }
.cat-tag { background: #f3f4f6; border-radius: 4px; padding: 2px 6px; margin-right: 8px; font-size: var(--font-size-xs); }
.problem-part { color: #888; font-size: var(--font-size-xs); margin-left: 8px; }
.problem-suggestion { display: block; color: #555; font-size: var(--font-size-xs); margin-top: 4px; }
.point-item { display: flex; align-items: center; gap: 8px; border: 1px solid #eee; border-radius: 6px; padding: 8px; margin-bottom: 6px; font-size: var(--font-size-sm); }
.point-type { background: #e8f0fe; color: #1f6feb; border-radius: 4px; padding: 2px 6px; font-size: var(--font-size-xs); }
.point-count { color: #888; font-size: var(--font-size-xs); }
.btn-copy { margin-left: auto; background: var(--color-bg-card); border: 1px solid #d9d9d9; border-radius: 4px; padding: 2px 8px; cursor: pointer; font-size: var(--font-size-xs); }
.empty-state { color: #888; padding: 24px 0; text-align: center; }
.record-table { width: 100%; border-collapse: collapse; font-size: var(--font-size-sm); }
.record-table th, .record-table td { border-bottom: 1px solid #eee; padding: 8px; text-align: left; }
.mono { font-family: monospace; font-size: var(--font-size-xs); }
.detail-panel { margin-top: 14px; }
.detail-json { background: #f8f9fa; border-radius: 6px; padding: 12px; font-size: var(--font-size-xs); overflow: auto; max-height: 480px; }
.stat-cards { display: flex; gap: 12px; margin-bottom: 12px; }
.stat-card { border: 1px solid #eee; border-radius: 8px; padding: 12px 20px; text-align: center; }
.stat-num { display: block; font-size: var(--font-size-xl); font-weight: 700; color: #1f6feb; }
.cat-line { font-size: var(--font-size-sm); padding: 4px 0; }
.back-btn { background: none; border: none; color: #1f6feb; cursor: pointer; margin-bottom: 8px; }
</style>

