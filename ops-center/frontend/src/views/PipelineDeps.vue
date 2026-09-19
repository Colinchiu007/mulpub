<template>
  <div>
    <h1 style="margin-bottom:16px">流水线所需依赖</h1>
    <p style="color:#888;margin-bottom:16px;font-size:13px">
      列出所有视频创作流水线运行所需的模型类型（图片 / 视频 / TTS / 推理 / 语音识别 / 音频）与候选供应商，
      数据种子对齐代码事实（pipeline-engine.js 流水线 + model-provider-seeds.js 供应商目录）。
      运营可维护；「必选」表示该流水线运行前必须配置此类模型，「可选」表示缺省时该能力降级。
    </p>

    <el-card shadow="never">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
        <div style="display:flex;gap:8px">
          <el-input v-model="filterPipeline" placeholder="按流水线 ID 筛选" clearable style="width:200px" />
          <el-select v-model="filterType" placeholder="模型类型" clearable style="width:140px">
            <el-option v-for="t in TYPE_OPTIONS" :key="t.value" :label="t.label" :value="t.value" />
          </el-select>
        </div>
        <el-button type="primary" @click="openCreate">新增依赖</el-button>
      </div>

      <el-table :data="filteredItems" stripe v-loading="loading" style="width:100%">
        <el-table-column prop="pipeline_id" label="流水线 ID" min-width="170" />
        <el-table-column prop="pipeline_name" label="流水线名称" min-width="150" show-overflow-tooltip />
        <el-table-column label="模型类型" width="110">
          <template #default="{ row }">
            <el-tag :type="TYPE_TAG[row.model_type] || 'info'" size="small">{{ TYPE_LABELS[row.model_type] || row.model_type }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="必选" width="70" align="center">
          <template #default="{ row }">
            <el-tag :type="row.required ? 'danger' : 'info'" size="small">{{ row.required ? '必选' : '可选' }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="默认供应商" width="120">
          <template #default="{ row }">
            <span>{{ row.default_provider || '-' }}</span>
          </template>
        </el-table-column>
        <el-table-column label="候选供应商" min-width="220">
          <template #default="{ row }">
            <el-tag v-for="p in (row.provider_candidates || [])" :key="p" size="small" style="margin-right:4px">{{ p }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="description" label="说明" min-width="160" show-overflow-tooltip />
        <el-table-column label="启用" width="80" align="center">
          <template #default="{ row }">
            <el-switch :model-value="row.enabled" @change="(v) => toggleEnabled(row, v)" />
          </template>
        </el-table-column>
        <el-table-column label="操作" width="140" align="center">
          <template #default="{ row }">
            <el-button link type="primary" size="small" @click="openEdit(row)">编辑</el-button>
            <el-button link type="danger" size="small" @click="remove(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <el-dialog v-model="showDialog" :title="editing ? `编辑依赖：${form.pipeline_id} / ${form.model_type}` : '新增流水线依赖'" width="600px">
      <el-form label-width="120px" label-position="left">
        <el-form-item label="流水线 ID" required>
          <el-input v-model="form.pipeline_id" :disabled="editing" placeholder="如 story2video-compose" />
        </el-form-item>
        <el-form-item label="流水线名称">
          <el-input v-model="form.pipeline_name" placeholder="展示名称（≤100 字）" />
        </el-form-item>
        <el-form-item label="模型类型" required>
          <el-select v-model="form.model_type" :disabled="editing" style="width:100%">
            <el-option v-for="t in TYPE_OPTIONS" :key="t.value" :label="t.label" :value="t.value" />
          </el-select>
        </el-form-item>
        <el-form-item label="必选">
          <el-switch v-model="form.required" />
          <span style="margin-left:8px;color:#888;font-size:12px">关闭=可选（缺省时该能力降级）</span>
        </el-form-item>
        <el-form-item label="候选供应商">
          <el-input v-model="candidatesText" placeholder="anthropic, openai（逗号分隔，≤50）" />
          <span style="color:#888;font-size:12px">建议从预设目录选择：{{ typeProvidersHint }}</span>
        </el-form-item>
        <el-form-item label="默认供应商">
          <el-select v-model="form.default_provider" filterable allow-clear style="width:100%" placeholder="从候选中选择（可选）">
            <el-option v-for="p in parsedCandidates" :key="p" :label="p" :value="p" />
          </el-select>
        </el-form-item>
        <el-form-item label="说明">
          <el-input v-model="form.description" type="textarea" :rows="2" placeholder="用途说明（≤200 字）" />
        </el-form-item>
        <el-form-item label="启用">
          <el-switch v-model="form.enabled" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showDialog = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="save">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>


<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { listPipelineDeps, createPipelineDep, updatePipelineDep, deletePipelineDep } from '../api/pipelineDeps'

const TYPE_OPTIONS = [
  { value: 'llm', label: '推理模型' },
  { value: 'tts', label: 'TTS语音' },
  { value: 'speech_recognition', label: '语音识别' },
  { value: 'image', label: '图片生成' },
  { value: 'video', label: '视频模型' },
  { value: 'audio', label: '音频生成' },
  { value: 'multimodal', label: '多模态模型' },
]
const TYPE_LABELS = Object.fromEntries(TYPE_OPTIONS.map(t => [t.value, t.label]))
const TYPE_TAG = { llm: 'primary', tts: 'warning', speech_recognition: 'info', image: 'success', video: 'danger', audio: 'warning', multimodal: 'primary' }
const ID_RE = /^[a-z0-9_-]{1,64}$/

const items = ref([])
const loading = ref(false)
const saving = ref(false)
const showDialog = ref(false)
const editing = ref(false)
const filterPipeline = ref('')
const filterType = ref('')
const candidatesText = ref('')

const form = reactive({
  id: null, pipeline_id: '', pipeline_name: '', model_type: 'llm', required: true,
  provider_candidates: [], default_provider: '', description: '', enabled: true,
})

const parsedCandidates = computed(() => candidatesText.value.split(',').map(s => s.trim()).filter(Boolean))
const typeProvidersHint = computed(() => {
  const hint = {
    llm: 'anthropic, openai, gemini, deepseek…', image: 'flux, dall-e, minimax-image…',
    video: 'minimax, kling, runway, veo…', tts: 'minimax-tts, elevenlabs…',
    speech_recognition: 'whisper, doubao-stt…', audio: 'suno, musicgen…', multimodal: 'gemini, gpt-4o…',
  }
  return hint[form.model_type] || ''
})

const filteredItems = computed(() => {
  let list = items.value
  if (filterPipeline.value) list = list.filter(i => i.pipeline_id.includes(filterPipeline.value.trim()))
  if (filterType.value) list = list.filter(i => i.model_type === filterType.value)
  return list
})

onMounted(load)

async function load() {
  loading.value = true
  try {
    const data = await listPipelineDeps()
    items.value = data.items || []
  } catch (e) {
    ElMessage.error(e.response?.data?.detail || '加载流水线依赖失败')
  } finally {
    loading.value = false
  }
}

function resetForm() {
  Object.assign(form, { id: null, pipeline_id: '', pipeline_name: '', model_type: 'llm', required: true, provider_candidates: [], default_provider: '', description: '', enabled: true })
  candidatesText.value = ''
}

function openCreate() {
  editing.value = false
  resetForm()
  showDialog.value = true
}

function openEdit(row) {
  editing.value = true
  Object.assign(form, JSON.parse(JSON.stringify(row)))
  if (form.enabled == null) form.enabled = true
  if (form.required == null) form.required = true
  candidatesText.value = (form.provider_candidates || []).join(', ')
  showDialog.value = true
}

async function save() {
  if (!ID_RE.test(form.pipeline_id.trim())) {
    ElMessage.warning('流水线 ID 只能包含小写字母/数字/下划线/短横线（1-64 位）')
    return
  }
  if (!TYPE_OPTIONS.some(t => t.value === form.model_type)) {
    ElMessage.warning('请选择有效的模型类型')
    return
  }
  const payload = JSON.parse(JSON.stringify(form))
  payload.pipeline_id = payload.pipeline_id.trim()
  payload.provider_candidates = parsedCandidates.value
  if (payload.default_provider && !payload.provider_candidates.includes(payload.default_provider)) {
    ElMessage.warning('默认供应商必须在候选供应商列表中')
    return
  }
  saving.value = true
  try {
    if (editing.value) {
      await updatePipelineDep(payload.id, payload)
      ElMessage.success('已保存')
    } else {
      await createPipelineDep(payload)
      ElMessage.success('已创建')
    }
    showDialog.value = false
    await load()
  } catch (e) {
    ElMessage.error(e.response?.data?.detail || '保存失败')
  } finally {
    saving.value = false
  }
}

async function toggleEnabled(row, value) {
  try {
    await updatePipelineDep(row.id, { enabled: value })
    row.enabled = value
    ElMessage.success(value ? '已启用' : '已停用')
  } catch (e) {
    ElMessage.error(e.response?.data?.detail || '操作失败')
    await load()
  }
}

async function remove(row) {
  try {
    await ElMessageBox.confirm(`确定删除依赖 ${row.pipeline_id} / ${TYPE_LABELS[row.model_type]} 吗？`, '确认删除', { type: 'warning' })
  } catch { return }
  try {
    await deletePipelineDep(row.id)
    ElMessage.success('已删除')
    await load()
  } catch (e) {
    ElMessage.error(e.response?.data?.detail || '删除失败')
  }
}
</script>
