<template>
  <div>
    <h1 style="margin-bottom:16px">改写策略管理</h1>
    <p style="color:#888;margin-bottom:16px;font-size:13px">
      运营人员维护下发到桌面端的改写策略模板（system prompt / user prompt 模板 / 后处理配置），
      随运行时 bootstrap 同步生效；内置 5 套种子策略（故事化爆款 / 电商转化 / 抖音口播 / 小红书种草 / 干货知识）。
    </p>

    <el-card shadow="never">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
        <el-radio-group v-model="filterCategory" @change="load">
          <el-radio-button value="">全部</el-radio-button>
          <el-radio-button v-for="c in CATEGORY_OPTIONS" :key="c" :value="c">{{ c }}</el-radio-button>
        </el-radio-group>
        <el-button type="primary" @click="openCreate">新增策略</el-button>
      </div>

      <el-table :data="filteredItems" stripe v-loading="loading" style="width:100%">
        <el-table-column prop="id" label="策略 ID" min-width="180" show-overflow-tooltip />
        <el-table-column prop="name" label="名称" min-width="140" />
        <el-table-column label="分类" width="100">
          <template #default="{ row }">
            <el-tag size="small">{{ row.category }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="行业" min-width="120">
          <template #default="{ row }">
            <el-tag v-for="p in (row.industry || [])" :key="p" size="small" style="margin-right:4px">{{ p }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="平台" min-width="120">
          <template #default="{ row }">
            <el-tag v-for="p in (row.platforms || [])" :key="p" size="small" style="margin-right:4px">{{ p }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="内置" width="80" align="center">
          <template #default="{ row }">
            <el-tag v-if="row.builtin" type="warning" size="small">内置</el-tag>
            <span v-else>-</span>
          </template>
        </el-table-column>
        <el-table-column label="下发" width="80" align="center">
          <template #default="{ row }">
            <el-switch :model-value="row.enabled" @change="(v) => toggleEnabled(row, v)" />
          </template>
        </el-table-column>
        <el-table-column label="操作" width="150" align="center">
          <template #default="{ row }">
            <el-button link type="primary" size="small" @click="openEdit(row)">编辑</el-button>
            <el-button link type="danger" size="small" @click="remove(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <el-dialog v-model="showDialog" :title="editing ? `编辑策略：${form.id}` : '新增策略'" width="720px" top="5vh">
      <el-form label-width="130px" label-position="left">
        <el-form-item label="策略 ID" required>
          <el-input v-model="form.id" :disabled="editing" placeholder="如 strategy-custom-001" />
        </el-form-item>
        <el-form-item label="名称" required>
          <el-input v-model="form.name" placeholder="策略名称（≤200 字）" />
        </el-form-item>
        <el-form-item label="描述">
          <el-input v-model="form.description" placeholder="策略描述（≤2000 字）" />
        </el-form-item>
        <el-form-item label="分类">
          <el-select v-model="form.category" style="width:100%">
            <el-option v-for="c in CATEGORY_OPTIONS" :key="c" :label="c" :value="c" />
          </el-select>
        </el-form-item>
        <el-form-item label="适用行业">
          <el-input v-model="industryText" placeholder="general, ecommerce, education（逗号分隔）" />
        </el-form-item>
        <el-form-item label="目的">
          <el-input v-model="purposeText" placeholder="engagement, conversion, sales（逗号分隔）" />
        </el-form-item>
        <el-form-item label="语言风格">
          <el-input v-model="toneText" placeholder="casual, storytelling, formal（逗号分隔）" />
        </el-form-item>
        <el-form-item label="适用平台">
          <el-input v-model="platformsText" placeholder="douyin, wechat_mp（逗号分隔）" />
        </el-form-item>
        <el-form-item label="System Prompt" required>
          <el-input v-model="form.systemPrompt" type="textarea" :rows="3" placeholder="系统提示词（≤5000 字）" />
        </el-form-item>
        <el-form-item label="User Prompt 模板" required>
          <el-input v-model="form.userPromptTemplate" type="textarea" :rows="4" placeholder="用户提示词模板，支持 {content} {knowledgeContext} 占位符（≤10000 字）" />
        </el-form-item>
        <el-form-item label="后处理配置">
          <el-input v-model="form.postProcess" type="textarea" :rows="3" placeholder='JSON 配置，如 {"removeAITaste":true,"sensitiveCheck":true,"maxLength":2000}' />
        </el-form-item>
        <el-form-item label="排序">
          <el-input-number v-model="form.sort_order" :min="0" :controls="false" style="width:100%" />
        </el-form-item>
        <el-form-item label="启用下发">
          <el-switch v-model="form.enabled" />
          <span style="margin-left:8px;color:#888;font-size:12px">关闭后桌面端不再下发该策略</span>
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
import { listRewriteStrategies, createRewriteStrategy, updateRewriteStrategy, deleteRewriteStrategy, toggleRewriteStrategy } from '../api/rewriteStrategies'

const CATEGORY_OPTIONS = ['viral', 'marketing', 'platform', 'style']
const ID_RE = /^[a-z0-9_-]{1,100}$/

const items = ref([])
const loading = ref(false)
const saving = ref(false)
const showDialog = ref(false)
const editing = ref(false)
const filterCategory = ref('')
const industryText = ref('')
const purposeText = ref('')
const toneText = ref('')
const platformsText = ref('')

const form = reactive({
  id: '', name: '', description: '', version: '1.0.0', category: 'viral',
  industry: [], purpose: [], tone: [], platforms: [],
  systemPrompt: '', userPromptTemplate: '', postProcess: '{}',
  metadata: '{}', sort_order: 0, enabled: true,
})

const filteredItems = computed(() => {
  if (!filterCategory.value) return items.value
  return items.value.filter(i => i.category === filterCategory.value)
})

onMounted(load)

async function load() {
  loading.value = true
  try {
    const data = await listRewriteStrategies()
    items.value = data.items || []
  } catch (e) {
    ElMessage.error(e.response?.data?.detail || '加载策略列表失败')
  } finally {
    loading.value = false
  }
}

function resetForm() {
  Object.assign(form, {
    id: '', name: '', description: '', version: '1.0.0', category: 'viral',
    industry: [], purpose: [], tone: [], platforms: [],
    systemPrompt: '', userPromptTemplate: '', postProcess: '{}',
    metadata: '{}', sort_order: 0, enabled: true,
  })
  industryText.value = ''
  purposeText.value = ''
  toneText.value = ''
  platformsText.value = ''
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
  industryText.value = (form.industry || []).join(', ')
  purposeText.value = (form.purpose || []).join(', ')
  toneText.value = (form.tone || []).join(', ')
  platformsText.value = (form.platforms || []).join(', ')
  showDialog.value = true
}

async function save() {
  if (!form.id.trim() || !form.name.trim()) {
    ElMessage.warning('请填写策略 ID 与名称')
    return
  }
  if (!ID_RE.test(form.id.trim())) {
    ElMessage.warning('策略 ID 只能包含小写字母/数字/下划线/短横线（1-100 位）')
    return
  }
  if (!form.systemPrompt.trim()) {
    ElMessage.warning('请填写 System Prompt')
    return
  }
  if (!form.userPromptTemplate.trim()) {
    ElMessage.warning('请填写 User Prompt 模板')
    return
  }
  const payload = JSON.parse(JSON.stringify(form))
  payload.id = payload.id.trim()
  payload.name = payload.name.trim()
  payload.industry = industryText.value.split(",").map(s => s.trim()).filter(Boolean)
  payload.purpose = purposeText.value.split(",").map(s => s.trim()).filter(Boolean)
  payload.tone = toneText.value.split(",").map(s => s.trim()).filter(Boolean)
  payload.platforms = platformsText.value.split(",").map(s => s.trim()).filter(Boolean)
  payload.systemPrompt = payload.systemPrompt.trim()
  payload.userPromptTemplate = payload.userPromptTemplate.trim()
  payload.sort_order = Number(payload.sort_order) || 0
  saving.value = true
  try {
    if (editing.value) {
      await updateRewriteStrategy(payload.id, payload)
      ElMessage.success("已保存")
    } else {
      await createRewriteStrategy(payload)
      ElMessage.success("已创建")
    }
    showDialog.value = false
    await load()
  } catch (e) {
    ElMessage.error(e.response?.data?.detail || "保存失败")
  } finally {
    saving.value = false
  }
}

async function toggleEnabled(row, value) {
  try {
    await toggleRewriteStrategy(row.id, value)
    row.enabled = value
    ElMessage.success(value ? "已启用，将随下次同步下发给桌面端" : "已停用，桌面端将不再下发该策略")
  } catch (e) {
    ElMessage.error(e.response?.data?.detail || "操作失败")
    await load()
  }
}

async function remove(row) {
  try {
    await ElMessageBox.confirm("确定删除策略 " + row.name + "？", "确认删除", { type: "warning" })
  } catch {
    return
  }
  try {
    await deleteRewriteStrategy(row.id)
    ElMessage.success("已删除")
    await load()
  } catch (e) {
    ElMessage.error(e.response?.data?.detail || "删除失败")
  }
}
</script>
