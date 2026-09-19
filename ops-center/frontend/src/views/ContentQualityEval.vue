<template>
  <div class="page">
    <h1 style="margin-bottom:4px">内容质量评估</h1>
    <p class="subtitle">15维度量化评估改写内容质量 — 单篇评估 + 批量统计</p>

    <el-tabs v-model="activeTab" type="border-card">
      <!-- Tab 1: 单篇评估 -->
      <el-tab-pane label="单篇评估" name="eval">
        <el-row :gutter="16">
          <el-col :xs="24" :md="10">
            <el-card shadow="never">
              <template #header>输入</template>
              <el-form label-position="top">
                <el-form-item label="原文内容（可选，克隆模式用于对比差异度）">
                  <el-input v-model="form.originalContent" type="textarea" :rows="3" placeholder="贴入原始文章内容..." />
                </el-form-item>
                <el-form-item label="改写后内容">
                  <el-input v-model="form.content" type="textarea" :rows="6" placeholder="贴入改写后的内容（至少20字）..." />
                </el-form-item>
                <el-form-item label="标题（可选，用于爆款潜力评估）">
                  <el-input v-model="form.title" placeholder="文章标题" />
                </el-form-item>
                <el-row :gutter="12">
                  <el-col :span="12">
                    <el-form-item label="目标平台">
                      <el-select v-model="form.platform" style="width:100%">
                        <el-option v-for="p in PLATFORMS" :key="p" :label="p" :value="p" />
                      </el-select>
                    </el-form-item>
                  </el-col>
                  <el-col :span="12">
                    <el-form-item label="风格">
                      <el-select v-model="form.style" style="width:100%">
                        <el-option v-for="s in STYLES" :key="s" :label="s" :value="s" />
                      </el-select>
                    </el-form-item>
                  </el-col>
                </el-row>
                <el-form-item>
                  <el-button type="primary" @click="run" :loading="loading">开始评估</el-button>
                  <el-button @click="reset">清空</el-button>
                </el-form-item>
              </el-form>
            </el-card>
          </el-col>

          <el-col :xs="24" :md="14">
            <el-card shadow="never" v-if="result">
              <template #header>
                <div style="display:flex;align-items:center;gap:12px">
                  <span>评估结果</span>
                  <el-tag :type="gradeTag(result.grade)" size="large">{{ result.grade }} - {{ result.grade_label }}</el-tag>
                  <span style="font-size:24px;font-weight:700;color:#409EFF">{{ result.overall_score }}<small style="font-size:14px">/100</small></span>
                </div>
              </template>

              <el-alert :type="result.overall_score >= 80 ? 'success' : result.overall_score >= 60 ? 'warning' : 'error'" :closable="false" style="margin-bottom:12px">
                {{ result.summary }}
              </el-alert>

              <div v-if="result.warnings && result.warnings.length" style="margin-bottom:12px">
                <el-tag v-for="(w,i) in result.warnings" :key="i" type="danger" style="margin-right:6px;margin-bottom:6px">{{ w }}</el-tag>
              </div>

              <div style="margin-bottom:12px">
                <span style="font-size:13px;color:#6b7280">字数: {{ result.word_count }} | 风格: {{ result.style }} | 平台: {{ result.platform }}</span>
              </div>

              <el-divider content-position="left">维度评分</el-divider>
              <div v-for="d in result.dimensions" :key="d.id" style="display:flex;align-items:center;margin-bottom:6px;gap:8px">
                <span style="width:80px;font-size:13px;text-align:right;flex-shrink:0">{{ d.label }}</span>
                <template v-if="isApplicable(d)">
                  <el-progress :percentage="d.score" :color="dimColor(d.score)" style="flex:1" />
                  <span style="width:40px;font-size:13px;text-align:right;flex-shrink:0;font-weight:600">{{ d.score.toFixed(0) }}</span>
                </template>
                <template v-else>
                  <div class="not-applicable-track">不适用</div>
                  <span class="not-applicable-value">N/A</span>
                </template>
              </div>

              <el-divider v-if="result.suggestions && result.suggestions.length" content-position="left">优化建议</el-divider>
              <el-tag v-for="(s,i) in result.suggestions" :key="i" type="info" style="margin-right:6px;margin-bottom:6px">{{ s }}</el-tag>
            </el-card>
            <el-empty v-else description="输入内容后点击「开始评估」" />
          </el-col>
        </el-row>
      </el-tab-pane>

      <!-- Tab 2: 批量统计 -->
      <el-tab-pane label="批量统计" name="stats">
        <el-card shadow="never">
          <template #header>
            <div style="display:flex;align-items:center;justify-content:space-between">
              <span>最新改写质量评估统计</span>
              <el-button @click="loadStats" :loading="statsLoading" size="small">刷新</el-button>
            </div>
          </template>

          <el-row :gutter="16" v-if="stats">
            <el-col :span="6">
              <el-statistic title="评估总数" :value="stats.total" />
            </el-col>
            <el-col :span="6">
              <el-statistic title="平均分" :value="stats.avg_score" :precision="1" />
            </el-col>
            <el-col :span="6">
              <el-statistic title="最高分" :value="stats.max_score" :precision="1" />
            </el-col>
            <el-col :span="6">
              <el-statistic title="最低分" :value="stats.min_score" :precision="1" />
            </el-col>
          </el-row>

          <el-divider content-position="left">等级分布</el-divider>
          <div v-if="stats && stats.grade_distribution" style="display:flex;gap:16px">
            <div v-for="g in GRADE_ORDER" :key="g" style="text-align:center">
              <el-tag :type="gradeTag(g)" size="large">{{ g }}</el-tag>
              <div style="font-size:20px;font-weight:700;margin-top:4px">{{ stats.grade_distribution[g] || 0 }}</div>
            </div>
          </div>

          <el-divider content-position="left">维度平均分</el-divider>
          <div v-if="stats && stats.avg_dimensions">
            <div v-for="d in stats.avg_dimensions" :key="d.id" style="display:flex;align-items:center;margin-bottom:6px;gap:8px">
              <span style="width:80px;font-size:13px;text-align:right;flex-shrink:0">{{ dimLabel(d.id) }}</span>
              <template v-if="d.count > 0">
                <el-progress :percentage="d.avg_score" :color="dimColor(d.avg_score)" style="flex:1" />
                <span style="width:40px;font-size:13px;text-align:right;flex-shrink:0;font-weight:600">{{ d.avg_score.toFixed(0) }}</span>
              </template>
              <template v-else>
                <div class="not-applicable-track">暂无适用样本</div>
                <span class="not-applicable-value">N/A</span>
              </template>
            </div>
          </div>
        </el-card>

        <!-- Recent records -->
        <el-card shadow="never" style="margin-top:16px">
          <template #header>最近评估记录</template>
          <el-table :data="records" stripe size="small" max-height="400">
            <el-table-column prop="id" label="ID" width="60" />
            <el-table-column label="评分" width="80">
              <template #default="{row}">
                <el-tag :type="gradeTag(row.grade)" size="small">{{ row.overall_score }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column label="等级" width="70">
              <template #default="{row}">{{ row.grade }} {{ row.grade_label }}</template>
            </el-table-column>
            <el-table-column prop="word_count" label="字数" width="60" />
            <el-table-column prop="style" label="风格" width="80" />
            <el-table-column prop="platform" label="平台" width="70" />
            <el-table-column prop="summary" label="摘要" min-width="200" show-overflow-tooltip />
            <el-table-column label="内容" min-width="150" show-overflow-tooltip>
              <template #default="{row}">{{ row.rewritten_content }}</template>
            </el-table-column>
            <el-table-column prop="created_at" label="时间" width="160" />
          </el-table>
        </el-card>
      </el-tab-pane>
    </el-tabs>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue'
import axios from 'axios'
import { isApplicable, hasApplicableSamples } from './content-quality-eval-utils'

const activeTab = ref('eval')
const loading = ref(false)
const statsLoading = ref(false)
const result = ref(null)
const stats = ref(null)
const records = ref([])

const PLATFORMS = ['通用', '微信', '抖音', '小红书', '知乎', '微博', 'B站']
const STYLES = ['通用', '轻松易懂', '正式严谨', '吸引眼球', '深度分析', '认知锚点']
const GRADE_ORDER = ['A+', 'A', 'B', 'C', 'D']

const DIM_LABELS = {
  viral_potential: '爆款潜力', logic: '逻辑性', engagement: '趣味性',
  human_likeness: '去AI味', compliance: '违规风险', readability: '易读性',
  clone_divergence: '克隆差异度', information_density: '信息密度',
  emotional_resonance: '情感共鸣', structure: '结构完整性', originality: '原创性',
  platform_fitness: '平台适配', keyword_density: '关键词密度',
  call_to_action: 'CTA', brand_consistency: '品牌一致性',
}

function dimLabel(id) { return DIM_LABELS[id] || id }

const form = reactive({
  originalContent: '',
  content: '',
  title: '',
  platform: '通用',
  style: '通用',
})

function gradeTag(g) {
  if (g === 'A+' || g === 'A') return 'success'
  if (g === 'B') return 'warning'
  if (g === 'C') return 'danger'
  return 'danger'
}

function dimColor(score) {
  if (score >= 80) return '#67C23A'
  if (score >= 60) return '#E6A23C'
  return '#F56C6C'
}

async function run() {
  if (!form.content.trim()) return
  if (form.content.trim().length < 20) {
    ElMessage.warning('内容过短，至少需要20个字符')
    return
  }
  loading.value = true
  result.value = null
  try {
    const res = await axios.post('/api/v1/quality-eval/evaluate', {
      content: form.content.trim(),
      original_content: form.originalContent.trim(),
      title: form.title.trim(),
      platform: form.platform,
      style: form.style,
    })
    result.value = res.data
  } catch (e) {
    ElMessage.error('评估失败: ' + (e.response?.data?.detail || e.message))
  } finally {
    loading.value = false
  }
}

function reset() {
  form.content = ''
  form.originalContent = ''
  form.title = ''
  result.value = null
}

async function loadStats() {
  statsLoading.value = true
  try {
    const [statsRes, recordsRes] = await Promise.all([
      axios.get('/api/v1/quality-eval/stats', { params: { limit: 100 } }),
      axios.get('/api/v1/quality-eval/records', { params: { limit: 100 } }),
    ])
    stats.value = statsRes.data
    records.value = recordsRes.data.items || []
  } catch (e) {
    ElMessage.error('加载统计失败: ' + (e.response?.data?.detail || e.message))
  } finally {
    statsLoading.value = false
  }
}

onMounted(() => {
  if (activeTab.value === 'stats') loadStats()
})
</script>

<style scoped>
.subtitle { color: #6b7280; font-size: 13px; margin-bottom: 16px; }
.not-applicable-track {
  flex: 1;
  min-height: 16px;
  border-radius: 4px;
  background: #f3f4f6;
  color: #9ca3af;
  font-size: 12px;
  line-height: 16px;
  padding-left: 8px;
}
.not-applicable-value {
  width: 40px;
  color: #9ca3af;
  font-size: 13px;
  text-align: right;
  flex-shrink: 0;
  font-weight: 600;
}
</style>
