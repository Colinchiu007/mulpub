<template>
  <div class="prompt-eval-workbench">
    <h2>🧪 提示词评测工作台</h2>
    <p class="muted">输入整篇文案按桌面端分句机制拆场景层，逐场景比对「场景文字 | 字幕二次分句 | 场景上下文 | 中英提示词 | 生成物 | 评估结果」。</p>

    <el-tabs v-model="tab">
      <!-- ============ 新建评测 ============ -->
      <el-tab-pane label="新建评测" name="create">
        <el-radio-group v-model="mode" style="margin-bottom: 12px">
          <el-radio-button value="manual">整 case 手动</el-radio-button>
          <el-radio-button value="scene">场景模式（整篇文案→场景层）</el-radio-button>
        </el-radio-group>

        <el-form v-if="mode === 'manual'" label-width="160px" style="max-width: 860px">
          <el-form-item label="媒体类型">
            <el-radio-group v-model="form.media_type" @change="onMediaTypeChange">
              <el-radio-button value="image">图片评测</el-radio-button>
              <el-radio-button value="video">视频评测</el-radio-button>
            </el-radio-group>
            <span class="muted" style="margin-left: 8px">视频：约 5 秒，抽首/中/尾 3 帧评估</span>
          </el-form-item>
          <el-form-item label="标题"><el-input v-model="form.title" placeholder="如：唐代老妇做饭评测" /></el-form-item>
          <el-form-item label="原文文本" required><el-input v-model="form.source_text" type="textarea" :rows="3" /></el-form-item>
          <el-form-item label="文案上下文（可选）"><el-input v-model="form.context" type="textarea" :rows="2" /></el-form-item>
          <el-form-item label="优化后提示词（中文）" required><el-input v-model="form.prompt_zh" type="textarea" :rows="4" /></el-form-item>
          <el-form-item v-if="form.prompt_en" label="英文对照">
            <div class="en-prompt"><el-tag size="small" type="info">机器翻译</el-tag><span>{{ form.prompt_en }}</span></div>
          </el-form-item>
          <el-form-item label="生成模型">
            <el-select v-model="form.provider" style="width: 220px"><el-option v-for="p in providerOptions" :key="p.provider+'/'+p.model" :label="`${p.provider} / ${p.model}`" :value="p.provider" /></el-select>
            <el-input v-model="form.model" style="width: 200px; margin-left: 8px" />
          </el-form-item>
          <el-form-item v-if="form.media_type !== 'video'" label="图片数"><el-input-number v-model="form.image_count" :min="1" :max="20" /></el-form-item>
          <el-form-item v-if="form.media_type !== 'video'" label="画幅"><el-select v-model="form.aspect_ratio" style="width: 160px"><el-option v-for="r in ['1:1','16:9','9:16','3:4','4:3']" :key="r" :label="r" :value="r" /></el-select></el-form-item>
          <el-form-item label="对比模式">
            <el-radio-group v-model="form.compare_mode">
              <el-radio-button value="single">单路（人工提示词）</el-radio-button>
              <el-radio-button value="dual" :disabled="form.media_type === 'video'">双路对比（人工 vs 引擎优化）</el-radio-button>
            </el-radio-group>
            <span class="muted" style="margin-left: 8px">双路：同 case 并行评估人工与提示词引擎优化两版，自动算提升率</span>
            <span v-if="form.media_type === 'video'" class="warn-text">视频评测暂不支持双路对比</span>
          </el-form-item>
          <el-form-item v-if="form.compare_mode === 'dual'" label="引擎参数">
            <el-collapse style="width: 100%">
              <el-collapse-item title="提示词优化引擎参数">
                <div class="engine-params">
                  <span class="muted">创意等级</span>
                  <el-input-number v-model="form.engine_creative_level" :min="1" :max="10" />
                  <span class="muted" style="margin-left: 12px">候选数</span>
                  <el-input-number v-model="form.engine_num_candidates" :min="1" :max="5" />
                </div>
              </el-collapse-item>
            </el-collapse>
          </el-form-item>
          <el-form-item>
            <el-button type="primary" :loading="translating" @click="doTranslate">生成英文对照</el-button>
            <el-button type="success" :loading="running" @click="doCreateRun">{{ form.media_type === 'video' ? '生成视频并评估' : '生成并评估' }}</el-button>
            <span v-if="!providerConfigured" class="warn-text">{{ form.media_type === 'video' ? '未配置可用的视频生成模型，请先在「模型密钥」中配置' : '未配置可用的图片生成模型，请先在「模型密钥」中配置' }}</span>
          </el-form-item>
        </el-form>

        <!-- 场景模式 -->
        <el-form v-else label-width="160px" style="max-width: 1000px">
          <el-form-item label="标题"><el-input v-model="sceneForm.title" placeholder="如：唐代老妇做饭·整篇评测" /></el-form-item>
          <el-form-item label="整篇文案原文" required>
            <el-input v-model="sceneForm.source_text" type="textarea" :rows="6" placeholder="输入整篇文案（≤20000 字），后台按桌面端分句机制拆成场景层" />
          </el-form-item>
          <el-form-item label="分句配置">
            <el-collapse style="width: 100%">
              <el-collapse-item title="高级（默认与桌面端一致）">
                <el-form label-width="160px">
                  <el-form-item label="场景字数"><el-input-number v-model="sceneForm.target_chars_per_scene" :min="1" :max="200" /></el-form-item>
                  <el-form-item label="字幕最小字数"><el-input-number v-model="sceneForm.subtitle_min_chars" :min="1" :max="50" /></el-form-item>
                  <el-form-item label="字幕最大字数"><el-input-number v-model="sceneForm.subtitle_max_chars" :min="2" :max="200" /></el-form-item>
                  <el-form-item label="时间算法">
                    <el-select v-model="sceneForm.subtitle_timing" style="width: 160px"><el-option label="proportional" value="proportional" /><el-option label="equal" value="equal" /></el-select>
                  </el-form-item>
                </el-form>
              </el-collapse-item>
            </el-collapse>
          </el-form-item>
          <el-form-item label="生成模型">
            <el-select v-model="sceneForm.provider" style="width: 220px"><el-option v-for="p in providerOptions" :key="p.provider+'/'+p.model" :label="`${p.provider} / ${p.model}`" :value="p.provider" /></el-select>
            <el-input v-model="sceneForm.model" style="width: 200px; margin-left: 8px" />
          </el-form-item>
          <el-form-item label="图片数 / 画幅">
            <el-input-number v-model="sceneForm.image_count" :min="1" :max="20" />
            <el-select v-model="sceneForm.aspect_ratio" style="width: 140px; margin-left: 8px"><el-option v-for="r in ['1:1','16:9','9:16','3:4','4:3']" :key="r" :label="r" :value="r" /></el-select>
          </el-form-item>
          <el-form-item>
            <el-button type="primary" :loading="sceneSplitting" @click="doSplitScenes">分句并生成场景</el-button>
            <span v-if="!providerConfigured" class="warn-text">未配置可用的图片生成模型，请先在「模型密钥」中配置</span>
          </el-form-item>
        </el-form>

        <!-- 场景层列表 -->
        <div v-if="mode === 'scene' && scenes.length" class="scenes-list">
          <div class="scenes-head">
            <h3>场景层（{{ scenes.length }}）</h3>
            <el-button size="small" type="warning" :loading="batchTranslating" @click="batchTranslateAll">
              {{ batchTranslating ? `批量生成中（${batchDone}/${scenes.length}）` : '批量生成中英对照' }}
            </el-button>
            <span v-if="batchTranslating" class="muted">逐个调用 LLM 生成优化提示词与英文翻译，请稍候</span>
          </div>
          <div v-for="s in scenes" :key="s.id" class="scene-card">
            <div class="scene-head">
              <span class="scene-no">场景 {{ s.index + 1 }}</span>
              <span v-if="sceneRunMap[s.id]" class="run-badge">{{ runStatusText(sceneRunMap[s.id]) }} {{ sceneRunMap[s.id].overall_score ?? '' }}</span>
            </div>
            <div class="scene-grid">
              <div class="scene-col">
                <h4>场景文字</h4><pre>{{ s.scene_text }}</pre>
              </div>
              <div class="scene-col">
                <h4>字幕二次分句</h4>
                <ul class="subs"><li v-for="(b, i) in s.subtitle_blocks" :key="i">{{ b.text }}<span class="dur"> {{ b.duration }}s</span></li></ul>
              </div>
              <div class="scene-col">
                <h4>场景上下文</h4>
                <div class="ctx"><span v-for="(v, k) in s.scene_context" :key="k" class="ctx-item">{{ k }}: {{ Array.isArray(v) ? v.join('、') : v }}</span></div>
              </div>
              <div class="scene-col">
                <h4>优化后提示词（中英对照）</h4>
                <pre class="zh">{{ s.prompt_zh || '（未生成）' }}</pre>
                <div v-if="s.prompt_en" class="en-prompt"><el-tag size="small" type="info">机器翻译</el-tag><pre class="en">{{ s.prompt_en }}</pre></div>
                <el-button size="small" :loading="translatingSceneId === s.id" @click="doSceneTranslate(s)">{{ s.prompt_zh ? '重新生成中英对照' : '生成中英对照' }}</el-button>
              </div>
            </div>
            <div class="scene-actions">
              <el-button size="small" type="success" :loading="runningSceneId === s.id" :disabled="!s.prompt_zh" :title="s.prompt_zh ? '' : '请先生成中英对照'" @click="doSceneRun(s)">生成图片并评估</el-button>
              <template v-if="sceneRunMap[s.id]">
                <span class="run-meta">run #{{ sceneRunMap[s.id].id }}</span>
                <template v-if="sceneRunMap[s.id].eval_status === 'succeeded'">
                  <span class="score">总分 {{ sceneRunMap[s.id].overall_score }}（{{ gradeLabel(sceneRunMap[s.id].grade) }}）</span>
                  <div v-for="d in sceneRunMap[s.id].dimensions || []" :key="d.id" class="dim-row"><span class="dim-label">{{ d.id }}</span><el-progress :percentage="d.score" :stroke-width="8" style="width: 100px" /></div>
                  <div v-for="(p, i) in (sceneRunMap[s.id].problems || []).slice(0, 3)" :key="'p'+i" class="problem">[{{ p.severity }}] {{ p.category }}</div>
                </template>
                <el-alert v-else-if="sceneRunMap[s.id].status === 'failed'" :title="'生成失败：' + (sceneRunMap[s.id].error || '')" type="error" :closable="false" />
                <el-alert v-else-if="sceneRunMap[s.id].eval_status === 'failed'" :title="'评估失败：' + (sceneRunMap[s.id].error || '')" type="warning" :closable="false" />
              </template>
              <el-button v-if="sceneRunMap[s.id] && (sceneRunMap[s.id].status === 'queued' || sceneRunMap[s.id].status === 'processing' || sceneRunMap[s.id].eval_status === 'evaluating')" size="small" :loading="scenePolling" @click="loadSceneRuns()">刷新状态</el-button>
            </div>
          </div>
        </div>

        <el-alert v-if="errorMsg" :title="errorMsg" type="error" show-icon closable @close="errorMsg=''" />
      </el-tab-pane>

      <!-- ============ 评测列表/详情 ============ -->
      <el-tab-pane label="评测列表" name="list">
        <el-button size="small" @click="loadCases">刷新</el-button>
        <el-table :data="cases" stripe style="margin-top: 8px">
          <el-table-column prop="id" label="ID" width="70" />
          <el-table-column prop="title" label="标题" min-width="160" />
          <el-table-column prop="source_mode" label="模式" width="90" />
          <el-table-column prop="provider" label="Provider" width="120" />
          <el-table-column prop="model" label="模型" width="120" />
          <el-table-column prop="created_by" label="创建人" width="100" />
          <el-table-column prop="created_at" label="时间" width="180" />
          <el-table-column label="操作" width="160">
            <template #default="{ row }">
              <el-button size="small" @click="openCase(row.id)">详情</el-button>
              <el-button size="small" type="danger" @click="doDelete(row.id)">删除</el-button>
            </template>
          </el-table-column>
        </el-table>

        <el-drawer v-model="drawerVisible" size="70%" :title="`评测详情 #${detail?.case?.id}`">
          <div v-if="detail" class="case-detail">
            <div class="four-col">
              <div class="col"><h4>原文</h4><pre>{{ detail.case.source_text }}</pre></div>
              <div class="col"><h4>中英提示词{{ currentRun ? '（' + variantLabel(currentRun.prompt_variant) + '）' : '' }}</h4><pre>{{ currentRun?.prompt_zh || currentRun?.prompt_source_zh || detail.case.prompt_zh }}</pre><pre v-if="currentRun?.prompt_en || detail.case.prompt_en">{{ currentRun?.prompt_en || detail.case.prompt_en }}</pre></div>
              <div class="col">
                <h4>生成物</h4>
                <video v-if="currentRun?.video_path" controls :src="mediaUrl(currentRun.video_path)" class="video-preview" />
                <div v-if="currentRun?.video_frames?.length" class="frame-row">
                  <span v-for="(f, i) in currentRun.video_frames" :key="i" class="thumb frame-thumb"><img :src="mediaUrl(f)" :alt="'帧'+i" /></span>
                </div>
                <div v-for="(img, i) in currentRun?.image_paths || []" :key="i" class="thumb"><img :src="mediaUrl(img)" :alt="'图片'+i" /></div>
              </div>
              <div class="col"><h4>评估结果</h4><div v-if="currentRun && currentRun.eval_status === 'succeeded'"><div class="score-big">{{ currentRun.overall_score }}</div><div class="grade">{{ gradeLabel(currentRun.grade) }}</div></div><div v-else>{{ currentRun ? statusText(currentRun) : '（无 run）' }}</div></div>
            </div>
            <div class="runs-bar">
              <h4>多次生成对比</h4>
              <el-button v-for="r in detail.runs" :key="r.id" size="small" :type="currentRunId === r.id ? 'primary' : 'default'" @click="selectRun(r.id)">run #{{ r.id }}（{{ variantLabel(r.prompt_variant) }} {{ r.overall_score ?? '-' }}）</el-button>
            </div>
            <div v-if="dualPairs.length" class="dual-compare">
              <h4>双路并排对比（{{ dualPairs.length }} 对）</h4>
              <div v-for="pair in dualPairs" :key="pair.pair_id" class="pair-card">
                <div class="pair-head">配对 #{{ pair.pair_id.slice(0, 8) }}</div>
                <div class="pair-grid">
                  <div v-for="v in pair.runs" :key="v.id" class="pair-col" :class="v.prompt_variant">
                    <div class="pair-title">{{ variantLabel(v.prompt_variant) }}（{{ v.overall_score ?? '-' }} / {{ gradeLabel(v.grade) }}）</div>
                    <pre>{{ v.prompt_zh || detail.case.prompt_zh }}</pre>
                    <div v-if="v.prompt_en" class="en-prompt"><el-tag size="small" type="info">机器翻译</el-tag><pre>{{ v.prompt_en }}</pre></div>
                    <div v-for="d in v.dimensions || []" :key="d.id" class="dim-row"><span class="dim-label">{{ d.id }}</span><el-progress :percentage="d.score" :stroke-width="8" style="width: 100px" /></div>
                    <div v-for="(prob, i) in (v.problems || []).slice(0, 3)" :key="'p'+i" class="problem">[{{ prob.severity }}] {{ prob.category }}</div>
                  </div>
                </div>
              </div>
            </div>
            <div v-if="detail.scenes" class="scenes-detail">
              <h4>场景层</h4>
              <div v-for="s in detail.scenes" :key="s.id" class="scene-mini">#{{ s.index + 1 }} {{ s.scene_text.slice(0, 30) }}</div>
            </div>
          </div>
        </el-drawer>
      </el-tab-pane>

      <!-- ============ 聚合分析 ============ -->
      <el-tab-pane label="聚合分析" name="summary">
        <div style="margin-bottom: 8px">
          <el-button size="small" @click="loadSummary">刷新</el-button>
          <el-button size="small" :loading="engineChecking" @click="checkEngineStatus">引擎连通性</el-button>
          <span v-if="engineStatus" class="muted" style="margin-left: 8px">{{ engineStatus }}</span>
        </div>
        <template v-if="stats">
          <div class="stat-cards">
            <el-card shadow="never" class="stat-card"><div class="stat-num">{{ stats.recordCount }}</div><div class="muted">评估记录</div></el-card>
            <el-card shadow="never" class="stat-card"><div class="stat-num">{{ stats.averageOverall }}</div><div class="muted">平均分</div></el-card>
          </div>
          <h4>等级分布</h4><pre>{{ JSON.stringify(stats.gradeDistribution, null, 2) }}</pre>
          <h4>维度均值</h4><div v-for="d in stats.dimensionAverages" :key="d.id" class="dim-row"><span class="dim-label">{{ d.id }}</span><el-progress :percentage="d.average" :stroke-width="10" style="width: 200px" /></div>
          <h4>问题类别分布</h4><div v-for="c in stats.problemCategories" :key="c.category" class="cat-line">{{ c.category }}：{{ c.count }} 次</div>
          <h4>优化点汇总</h4><div v-for="pt in stats.optimizationPoints" :key="pt.type" class="cat-line">{{ pt.type }}：{{ pt.count }} 次</div>
          <h4>按 Provider/模型 对比</h4><div v-for="p in stats.providerComparison" :key="p.provider" class="cat-line">{{ p.provider }}：平均 {{ p.average }}（{{ p.count }} 条）</div>
          <template v-if="stats.dual && stats.dual.pairCount > 0">
            <h4>双路对比（人工 vs 引擎优化）</h4>
            <div class="stat-cards">
              <el-card shadow="never" class="stat-card"><div class="stat-num">{{ stats.dual.pairCount }}</div><div class="muted">成对评测</div></el-card>
              <el-card shadow="never" class="stat-card"><div class="stat-num">{{ stats.dual.manualAverage }}</div><div class="muted">人工平均分</div></el-card>
              <el-card shadow="never" class="stat-card"><div class="stat-num" :class="{ 'up': stats.dual.averageDiff > 0 }">{{ stats.dual.engineAverage }}</div><div class="muted">引擎平均分</div></el-card>
              <el-card shadow="never" class="stat-card"><div class="stat-num" :class="{ 'up': stats.dual.averageDiff > 0 }">{{ stats.dual.averageDiff > 0 ? '+' : '' }}{{ stats.dual.averageDiff }}</div><div class="muted">平均分差</div></el-card>
            </div>
            <div class="cat-line">提升率：{{ stats.dual.improvementRate === null ? '—' : stats.dual.improvementRate + '%' }}</div>
            <h4>维度均值差</h4>
            <div v-for="d in stats.dual.dimensionDiffs" :key="d.id" class="cat-line">{{ d.id }}：人工 {{ d.manualAverage }} → 引擎 {{ d.engineAverage }}（{{ d.diff > 0 ? '+' : '' }}{{ d.diff }}）</div>
            <h4>等级分布差异</h4><pre>{{ JSON.stringify(stats.dual.gradeDistributionDiff, null, 2) }}</pre>
          </template>
        </template>
      </el-tab-pane>
    </el-tabs>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import {
  createPromptEvalCase, updatePromptEvalCase, translatePromptEvalCase, createPromptEvalRun,
  listPromptEvalCases, getPromptEvalCase, deletePromptEvalCase, getPromptEvalSummary,
  listPromptEvalProviders, getPromptEvalRun, mediaUrl,
  createPromptEvalSceneCase, translatePromptEvalScene, createPromptEvalSceneRun,
  listPromptEvalCaseRuns, getPromptEvalEngineStatus,
} from '../api/promptEval'
import { apiErrorMessage } from '../api/http'

const tab = ref('create')
const mode = ref('manual')
const form = ref({ title: '', source_text: '', context: '', prompt_zh: '', prompt_en: '', media_type: 'image', provider: 'minimax-image', model: 'image-01', image_count: 1, aspect_ratio: '1:1', compare_mode: 'single', engine_creative_level: 8, engine_num_candidates: 3 })
const sceneForm = ref({ title: '', source_text: '', target_chars_per_scene: 20, subtitle_min_chars: 8, subtitle_max_chars: 15, subtitle_timing: 'proportional', provider: 'minimax-image', model: 'image-01', image_count: 1, aspect_ratio: '1:1' })
const providerOptions = ref([])
const providerConfigured = computed(() => providerOptions.value.length > 0)
const translating = ref(false)
const running = ref(false)
const errorMsg = ref('')
const cases = ref([])
const detail = ref(null)
const drawerVisible = ref(false)
const currentRunId = ref(null)
const currentRun = computed(() => detail.value?.runs?.find(r => r.id === currentRunId.value) || detail.value?.runs?.[0])
const stats = ref(null)
const engineChecking = ref(false)
const engineStatus = ref('')

// 场景模式状态
const scenes = ref([])
const sceneCaseId = ref(null)
const sceneSplitting = ref(false)
const translatingSceneId = ref(null)
const runningSceneId = ref(null)
const batchTranslating = ref(false)
const batchDone = ref(0)
const sceneRunMap = ref({})
const scenePolling = ref(false)
let scenePollTimer = null

const GRADE_LABELS = { excellent: '优秀', good: '良好', fair: '一般', poor: '差' }
const gradeLabel = g => GRADE_LABELS[g] || g
const VARIANT_LABELS = { manual: '人工', engine: '引擎' }
const variantLabel = v => VARIANT_LABELS[v] || v
const dualPairs = computed(() => {
  const runs = detail.value?.runs || []
  const byPair = {}
  for (const r of runs) {
    const pid = r.engine_meta?.pair_id
    if (!pid) continue
    ;(byPair[pid] = byPair[pid] || []).push(r)
  }
  return Object.entries(byPair)
    .filter(([, rs]) => rs.some(x => x.prompt_variant === 'manual') && rs.some(x => x.prompt_variant === 'engine'))
    .map(([pair_id, rs]) => ({ pair_id, runs: rs }))
    .sort((a, b) => b.pair_id.localeCompare(a.pair_id))
})
const statusText = r => (r.eval_status === 'succeeded' ? '评估完成' : r.status === 'processing' ? '生成中' : r.eval_status === 'evaluating' ? '评估中' : r.status)
const runStatusText = r => {
  if (!r) return '-'
  if (r.eval_status === 'succeeded') return '✅ 已评估'
  if (r.status === 'failed') return '生成失败'
  if (r.eval_status === 'failed') return '评估失败'
  if (r.status === 'queued' || r.status === 'processing') return '⏳ 生成中'
  if (r.eval_status === 'evaluating') return '🔍 评估中'
  return r.status || '-'
}
const isTerminalRun = r => !!r && (r.status === 'failed' || r.eval_status === 'succeeded' || r.eval_status === 'failed')
const allSceneRunsTerminal = () => {
  const runs = Object.values(sceneRunMap.value)
  return runs.length > 0 && runs.every(isTerminalRun)
}

async function loadProviders() {
  try {
    const data = await listPromptEvalProviders()
    providerOptions.value = data.items || []
  } catch (e) {
    providerOptions.value = []
  }
}

function onMediaTypeChange() {
  if (form.value.media_type === 'video' && form.value.compare_mode === 'dual') {
    form.value.compare_mode = 'single'
  }
}

async function ensureCase() {
  const payload = {
    title: form.value.title, source_text: form.value.source_text,
    context: form.value.context || undefined, prompt_zh: form.value.prompt_zh,
    media_type: form.value.media_type,
    provider: form.value.provider, model: form.value.model,
    image_count: form.value.image_count, aspect_ratio: form.value.aspect_ratio,
  }
  if (form.value.id) {
    const updated = await updatePromptEvalCase(form.value.id, payload)
    form.value.prompt_en = updated.prompt_en || form.value.prompt_en
    return form.value.id
  }
  const created = await createPromptEvalCase(payload)
  form.value.id = created.id
  return created.id
}

async function doTranslate() {
  errorMsg.value = ''
  translating.value = true
  try {
    const cid = await ensureCase()
    const updated = await translatePromptEvalCase(cid)
    form.value.prompt_en = updated.prompt_en
  } catch (e) {
    errorMsg.value = '翻译失败：' + apiErrorMessage(e)
  } finally {
    translating.value = false
  }
}

async function doCreateRun() {
  errorMsg.value = ''
  running.value = true
  try {
    const cid = await ensureCase()
    const created = await createPromptEvalRun(cid)
    if (created && created.engineError) {
      errorMsg.value = '引擎优化变体失败（人工变体已启动）：' + created.engineError
    }
    tab.value = 'list'
    await loadCases()
  } catch (e) {
    errorMsg.value = '启动失败：' + apiErrorMessage(e)
  } finally {
    running.value = false
  }
}

async function checkEngineStatus() {
  engineChecking.value = true
  engineStatus.value = ''
  try {
    const s = await getPromptEvalEngineStatus()
    engineStatus.value = `引擎正常（${s.latency_ms}ms，${s.base_url}）`
  } catch (e) {
    engineStatus.value = apiErrorMessage(e, '引擎不可达')
  } finally {
    engineChecking.value = false
  }
}

async function loadCases() {
  try {
    const data = await listPromptEvalCases()
    cases.value = data.items || []
  } catch (e) {
    errorMsg.value = '加载评测列表失败：' + apiErrorMessage(e)
  }
}

async function openCase(id) {
  stopScenePolling()
  try {
    detail.value = await getPromptEvalCase(id)
    currentRunId.value = detail.value.runs?.[0]?.id || null
    if (detail.value.case?.source_mode === 'scene') {
      scenes.value = detail.value.scenes || []
      sceneCaseId.value = id
      sceneRunMap.value = indexSceneRuns(detail.value.runs)
    } else {
      // manual case：清空场景模式状态，避免返回「新建评测」残留旧场景列表
      scenes.value = []
      sceneRunMap.value = {}
      sceneCaseId.value = null
    }
    drawerVisible.value = true
  } catch (e) {
    errorMsg.value = '加载评测详情失败：' + apiErrorMessage(e)
  }
}

function selectRun(id) {
  currentRunId.value = id
}

async function pollRun() {
  if (!currentRunId.value) return
  const run = await getPromptEvalRun(currentRunId.value)
  const idx = detail.value.runs.findIndex(r => r.id === run.id)
  if (idx >= 0) detail.value.runs[idx] = run
}

async function doDelete(id) {
  if (!window.confirm('确认删除该评测及其生成物？')) return
  await deletePromptEvalCase(id)
  await loadCases()
}

async function loadSummary() {
  try {
    stats.value = await getPromptEvalSummary()
  } catch (e) {
    errorMsg.value = '加载聚合分析失败：' + apiErrorMessage(e)
  }
}

// ================= 场景模式 =================
function patchScene(id, patch) {
  const idx = scenes.value.findIndex(s => s.id === id)
  if (idx >= 0) scenes.value[idx] = { ...scenes.value[idx], ...patch }
}

function indexSceneRuns(runs) {
  const map = {}
  for (const r of runs || []) {
    if (r.scene_id && (!map[r.scene_id] || r.id > map[r.scene_id].id)) map[r.scene_id] = r
  }
  return map
}

function startScenePolling() {
  stopScenePolling()
  scenePolling.value = true
  scenePollTimer = setInterval(() => { loadSceneRuns() }, 8000)
}

function stopScenePolling() {
  scenePolling.value = false
  if (scenePollTimer) {
    clearInterval(scenePollTimer)
    scenePollTimer = null
  }
}

async function doSplitScenes() {
  stopScenePolling()
  errorMsg.value = ''
  sceneSplitting.value = true
  try {
    const resp = await createPromptEvalSceneCase({
      source_mode: 'scene',
      title: sceneForm.value.title,
      source_text: sceneForm.value.source_text,
      provider: sceneForm.value.provider,
      model: sceneForm.value.model,
      image_count: sceneForm.value.image_count,
      aspect_ratio: sceneForm.value.aspect_ratio,
      target_chars_per_scene: sceneForm.value.target_chars_per_scene,
      subtitle_min_chars: sceneForm.value.subtitle_min_chars,
      subtitle_max_chars: sceneForm.value.subtitle_max_chars,
      subtitle_timing: sceneForm.value.subtitle_timing,
    })
    sceneCaseId.value = resp.case.id
    scenes.value = resp.scenes || []
    sceneRunMap.value = {}
    await loadCases()
  } catch (e) {
    errorMsg.value = '分句失败：' + apiErrorMessage(e)
  } finally {
    sceneSplitting.value = false
  }
}

async function doSceneTranslate(s) {
  errorMsg.value = ''
  translatingSceneId.value = s.id
  try {
    const updated = await translatePromptEvalScene(sceneCaseId.value, s.id)
    patchScene(s.id, updated)
  } catch (e) {
    errorMsg.value = '中英对照生成失败：' + apiErrorMessage(e)
  } finally {
    translatingSceneId.value = null
  }
}

async function batchTranslateAll() {
  errorMsg.value = ''
  batchTranslating.value = true
  batchDone.value = 0
  const failed = []
  const failReasons = new Set()
  for (const s of scenes.value) {
    try {
      const updated = await translatePromptEvalScene(sceneCaseId.value, s.id)
      patchScene(s.id, updated)
    } catch (e) {
      failed.push(s.index + 1)
      const detail = e?.response?.data?.detail
      if (detail) failReasons.add(String(detail))
    }
    batchDone.value += 1
  }
  batchTranslating.value = false
  if (failed.length) {
    let msg = '批量生成完成：' + (batchDone.value - failed.length) + ' 个成功，' + failed.length + ' 个失败（场景 ' + failed.join('、') + '）'
    if (failReasons.size) msg += '。原因：' + [...failReasons].join('；')
    errorMsg.value = msg
  }
}

async function doSceneRun(s) {
  errorMsg.value = ''
  runningSceneId.value = s.id
  try {
    const run = await createPromptEvalSceneRun(sceneCaseId.value, s.id)
    sceneRunMap.value = { ...sceneRunMap.value, [s.id]: run }
    startScenePolling()
  } catch (e) {
    errorMsg.value = '启动生成失败：' + apiErrorMessage(e)
  } finally {
    runningSceneId.value = null
  }
}

let sceneRunsInFlight = false
async function loadSceneRuns() {
  if (!sceneCaseId.value || sceneRunsInFlight) return
  sceneRunsInFlight = true
  try {
    const d = await listPromptEvalCaseRuns(sceneCaseId.value)
    sceneRunMap.value = indexSceneRuns(d.items || [])
    if (allSceneRunsTerminal()) stopScenePolling()
  } catch (e) {
    errorMsg.value = '刷新场景状态失败：' + apiErrorMessage(e)
  } finally {
    sceneRunsInFlight = false
  }
}

onMounted(async () => {
  await loadProviders()
  await loadCases()
})

onBeforeUnmount(() => {
  stopScenePolling()
})
</script>

<style scoped>
.muted { color: #909399; font-size: 13px; }
.warn-text { color: #e6a23c; font-size: 13px; margin-left: 8px; }
.en-prompt { display: flex; gap: 8px; align-items: flex-start; }
.en-prompt pre { margin: 0; }
.four-col { display: grid; grid-template-columns: 1fr 1fr 1fr 1fr; gap: 16px; }
.col pre { background: #f5f7fa; padding: 8px; border-radius: 6px; white-space: pre-wrap; font-size: 12px; max-height: 220px; overflow: auto; }
.thumb img { width: 100%; border-radius: 6px; border: 1px solid #e4e7ed; margin-bottom: 8px; }
.video-preview { width: 100%; border-radius: 6px; border: 1px solid #e4e7ed; margin-bottom: 8px; background: #000; }
.frame-row { display: flex; gap: 6px; margin-bottom: 8px; }
.frame-thumb { flex: 1; min-width: 0; }
.score-big { font-size: 40px; font-weight: 700; color: #409eff; }
.grade { font-weight: 600; margin-bottom: 8px; }
.dim-row { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
.dim-label { width: 130px; font-size: 12px; }
.problems, .points { margin-top: 10px; }
.problem, .point { font-size: 12px; margin-bottom: 4px; }
.runs-bar { margin-top: 16px; display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.stat-cards { display: flex; gap: 12px; margin-bottom: 12px; }
.stat-card { width: 160px; }
.stat-num { font-size: 28px; font-weight: 700; color: #409eff; }
.cat-line { font-size: 13px; padding: 2px 0; }
.scenes-list { margin-top: 16px; }
.scenes-head { display: flex; align-items: center; gap: 12px; margin-bottom: 8px; }
.scenes-head h3 { margin: 0; }
.scene-card { border: 1px solid #e4e7ed; border-radius: 8px; padding: 12px; margin-bottom: 12px; background: #fff; }
.scene-head { display: flex; align-items: center; gap: 12px; margin-bottom: 8px; }
.scene-no { font-weight: 600; color: #303133; }
.run-badge { font-size: 12px; color: #67c23a; }
.scene-grid { display: grid; grid-template-columns: 1fr 1fr 1fr 1fr; gap: 12px; }
.scene-col h4 { margin: 0 0 6px; font-size: 13px; color: #606266; }
.scene-col pre { background: #f5f7fa; padding: 8px; border-radius: 6px; white-space: pre-wrap; font-size: 12px; max-height: 180px; overflow: auto; margin: 0; }
.scene-col pre.zh { background: #f0f9eb; }
.scene-col pre.en { background: #f5f7fa; }
.subs { margin: 0; padding-left: 16px; font-size: 12px; }
.subs li { margin-bottom: 2px; }
.dur { color: #909399; margin-left: 6px; font-size: 11px; }
.ctx { display: flex; flex-wrap: wrap; gap: 6px; }
.ctx-item { background: #ecf5ff; color: #409eff; font-size: 12px; padding: 2px 8px; border-radius: 4px; }
.scene-actions { margin-top: 10px; display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.run-meta { font-size: 12px; color: #909399; }
.score { font-weight: 600; color: #409eff; }
.engine-params { display: flex; align-items: center; gap: 8px; }
.dual-compare { margin-top: 16px; }
.pair-card { border: 1px solid #e4e7ed; border-radius: 8px; padding: 12px; margin-bottom: 12px; background: #fff; }
.pair-head { font-size: 12px; color: #909399; margin-bottom: 8px; }
.pair-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.pair-col { border: 1px solid #ebeef5; border-radius: 6px; padding: 10px; }
.pair-col.engine { background: #f0f9eb; }
.pair-col pre { background: #f5f7fa; padding: 8px; border-radius: 6px; white-space: pre-wrap; font-size: 12px; max-height: 160px; overflow: auto; margin: 0 0 8px; }
.pair-title { font-weight: 600; margin-bottom: 8px; }
.stat-num.up { color: #67c23a; }
</style>
