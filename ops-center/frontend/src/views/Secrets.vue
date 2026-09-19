<template>
  <div>
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:24px">
      <h1>官方 Key 管理</h1>
      <el-button type="primary" @click="openCreate">
        <el-icon><Plus /></el-icon> 添加 Key
      </el-button>
    </div>

    <div v-if="summary" class="stat-grid">
      <div class="stat-card"><div class="stat-value">{{ summary.total }}</div><div class="stat-label">Key 总数</div></div>
      <div class="stat-card"><div class="stat-value">{{ summary.active }}</div><div class="stat-label">活跃</div></div>
      <div class="stat-card"><div class="stat-value">{{ summary.expiring_30d }}</div><div class="stat-label">30 天内到期</div></div>
      <div class="stat-card"><div class="stat-value">{{ summary.expired }}</div><div class="stat-label">已过期</div></div>
      <div class="stat-card"><div class="stat-value">¥{{ summary.cost_total }}</div><div class="stat-label">近 30 天成本</div></div>
      <div class="stat-card"><div class="stat-value">{{ summary.threshold_hit_keys.length }}</div><div class="stat-label">达告警阈值</div></div>
    </div>

    <el-card shadow="never" style="margin-top:16px">
      <div style="margin-bottom:16px;display:flex;gap:12px">
        <el-select v-model="providerFilter" placeholder="Provider 筛选" clearable @change="loadKeys" style="width:180px">
          <el-option v-for="p in providers" :key="p" :label="p" :value="p" />
        </el-select>
      </div>

      <el-table :data="keys" stripe v-loading="loading">
        <el-table-column prop="id" label="ID" min-width="160" />
        <el-table-column prop="provider" label="Provider" width="120" />
        <el-table-column prop="name" label="名称" min-width="160" />
        <el-table-column label="API Key" min-width="200">
          <template #default="{ row }">
            <code style="background:#f5f5f5;padding:2px 8px;border-radius:4px;font-size:13px">
              {{ row.api_key }}
            </code>
            <el-button link size="small" @click="revealKey(row)" style="margin-left:8px">
              <el-icon><View /></el-icon>
            </el-button>
          </template>
        </el-table-column>
        <el-table-column label="可用 Tier" width="120" align="center">
          <template #default="{ row }">
            <el-tag :type="tierTagType(row.tier_access)" size="small">
              {{ tierLabel(row.tier_access) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="100" align="center">
          <template #default="{ row }">
            <el-tag :type="row.is_active ? 'success' : 'danger'" size="small">
              {{ row.is_active ? '启用' : '禁用' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="优先级" width="80" align="center" prop="priority" />
        <el-table-column label="配额/上限" width="140">
          <template #default="{ row }">{{ row.rate_per_minute || '-' }}/min · {{ row.daily_limit || '-' }}/day</template>
        </el-table-column>
        <el-table-column label="成本单价" width="100" align="center">
          <template #default="{ row }">{{ row.cost_per_1k_tokens || 0 }}</template>
        </el-table-column>
        <el-table-column label="操作" width="140" align="center">
          <template #default="{ row }">
            <el-button link type="primary" size="small" @click="openEdit(row)">编辑</el-button>
            <el-popconfirm title="确定删除此 Key？" @confirm="deleteKey(row.id)">
              <template #reference>
                <el-button link type="danger" size="small">删除</el-button>
              </template>
            </el-popconfirm>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <!-- Create/Edit Dialog -->
    <el-dialog v-model="dialogVisible" :title="isEdit ? '编辑 Key' : '添加 Key'" width="560px" @closed="resetForm">
      <el-form :model="form" label-width="120px">
        <el-form-item label="ID" required>
          <el-input v-model="form.id" placeholder="openai-gpt4o" :disabled="isEdit" />
        </el-form-item>
        <el-form-item label="Provider" required>
          <el-select v-model="form.provider" placeholder="选择 Provider" style="width:100%" filterable allow-create>
            <el-option v-for="p in providers" :key="p" :label="p" :value="p" />
          </el-select>
        </el-form-item>
        <el-form-item label="名称" required>
          <el-input v-model="form.name" placeholder="OpenAI GPT-4o" />
        </el-form-item>
        <el-form-item label="API Key" required>
          <el-input v-model="form.api_key" type="password" show-password placeholder="sk-..." />
        </el-form-item>
        <el-form-item label="Base URL">
          <el-input v-model="form.base_url" placeholder="https://api.openai.com/v1（留空用默认）" />
        </el-form-item>
        <el-form-item label="Models">
          <el-select v-model="form.models" multiple filterable allow-create
            placeholder="输入模型名回车添加" style="width:100%"
            default-first-option />
        </el-form-item>
        <el-form-item label="可用 Tier">
          <el-select v-model="form.tier_access" style="width:100%">
            <el-option :value="1" label="全部用户可用（Tier 1+）" />
            <el-option :value="2" label="标准版及以上（Tier 2+）" />
            <el-option :value="3" label="专业版专属（Tier 3）" />
          </el-select>
        </el-form-item>
        <el-form-item label="优先级">
          <el-input-number v-model="form.priority" :min="1" :max="10" />
          <span style="margin-left:8px;color:#999;font-size:12px">越小越优先</span>
        </el-form-item>
        <el-form-item label="成本/1K tokens">
          <el-input-number v-model="form.cost_per_1k_tokens" :min="0" :precision="4" :step="0.1" style="width:200px" />
        </el-form-item>
        <el-form-item label="过期日期">
          <el-date-picker v-model="form.expires_at" type="date" placeholder="选填"
            value-format="YYYY-MM-DD" style="width:200px" />
        </el-form-item>
        <el-form-item label="状态">
          <el-switch v-model="form.is_active" active-text="启用" inactive-text="禁用" />
        </el-form-item>
        <el-form-item label="每分钟配额">
          <el-input-number v-model="form.rate_per_minute" :min="1" :controls="false" placeholder="留空=不限" style="width:160px" />
        </el-form-item>
        <el-form-item label="每日上限">
          <el-input-number v-model="form.daily_limit" :min="1" :controls="false" placeholder="留空=不限" style="width:160px" />
        </el-form-item>
        <el-form-item label="告警阈值(¥)">
          <el-input-number v-model="form.alert_threshold_cost" :min="0" :controls="false" placeholder="留空=不告警" style="width:160px" />
          <div class="hint">该 provider 近 30 天成本达到阈值后在概览高亮</div>
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="form.note" maxlength="200" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" @click="saveKey" :loading="saving">
          {{ isEdit ? '更新' : '创建' }}
        </el-button>
      </template>
    </el-dialog>

    <!-- Reveal Dialog -->
    <el-dialog v-model="revealVisible" title="查看 Key 明文" width="500px">
      <p style="color:#e6a23c;margin-bottom:16px">
        <el-icon><WarningFilled /></el-icon>
        此 Key 将在 30 秒后自动隐藏
      </p>
      <div style="background:#1e1e1e;color:#4ec9b0;padding:12px;border-radius:8px;font-family:monospace;word-break:break-all">
        {{ revealedKey }}
      </div>
      <template #footer>
        <el-button @click="revealVisible = false">关闭</el-button>
        <el-button type="primary" @click="copyKey">
          <el-icon><CopyDocument /></el-icon> 复制
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import axios from 'axios'

const api = axios.create({ baseURL: '/api/v1' })
api.interceptors.request.use(c => {
  const s = localStorage.getItem('ops_token')
  if (s) { try { c.headers.Authorization = `Bearer ${JSON.parse(s).token}` } catch {} }
  return c
})

const providers = ['openai', 'doubao', 'minimax', 'deepseek', 'sensenova', 'tianyiyun', 'tongyi', 'kling', 'jimeng']
const keys = ref([])
const loading = ref(false)
const providerFilter = ref('')
const summary = ref(null)

const dialogVisible = ref(false)
const isEdit = ref(false)
const saving = ref(false)
const form = ref({})

const revealVisible = ref(false)
const revealedKey = ref('')
let revealTimer = null

onMounted(() => { loadKeys(); loadSummary() })

async function loadSummary() {
  try {
    const res = await api.get('/secrets/summary')
    summary.value = res.data
  } catch { summary.value = null }
}

async function loadKeys() {
  loading.value = true
  try {
    const params = providerFilter.value ? { provider: providerFilter.value } : {}
    const res = await api.get('/secrets', { params })
    keys.value = res.data.keys || []
  } catch { ElMessage.error('加载失败') }
  finally { loading.value = false }
}

function openCreate() {
  isEdit.value = false
  form.value = { id: '', provider: '', name: '', api_key: '', base_url: '',
    models: [], tier_access: 1, priority: 1, cost_per_1k_tokens: 0, expires_at: '', is_active: true,
    rate_per_minute: null, daily_limit: null, alert_threshold_cost: null, note: '' }
  dialogVisible.value = true
}

function openEdit(row) {
  isEdit.value = true
  form.value = { ...row }
  dialogVisible.value = true
}

function resetForm() {
  form.value = {}
}

async function saveKey() {
  saving.value = true
  try {
    await api.put(`/secrets/${form.value.id}`, form.value)
    ElMessage.success(isEdit.value ? '更新成功' : '创建成功')
    dialogVisible.value = false
    await loadKeys()
  } catch (e) {
    ElMessage.error(e.response?.data?.detail || '操作失败')
  } finally { saving.value = false }
}

async function deleteKey(id) {
  try {
    await api.delete(`/secrets/${id}`)
    ElMessage.success('已删除')
    await loadKeys()
  } catch { ElMessage.error('删除失败') }
}

async function revealKey(row) {
  try {
    const res = await api.post(`/secrets/${row.id}/reveal`)
    revealedKey.value = res.data.api_key
    revealVisible.value = true
    clearTimeout(revealTimer)
    revealTimer = setTimeout(() => { revealVisible.value = false }, 30000)
  } catch { ElMessage.error('无权查看') }
}

function copyKey() {
  navigator.clipboard.writeText(revealedKey.value)
  ElMessage.success('已复制')
}

function tierLabel(tier) {
  return { 1: '全部', 2: '标准+', 3: '专业' }[tier] || 'Tier ' + tier
}
function tierTagType(tier) {
  return { 1: '', 2: 'warning', 3: 'danger' }[tier] || ''
}
</script>

<style scoped>
.stat-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 12px; margin-bottom: 4px; }
.stat-card { border: 1px solid #e4e7ed; border-radius: 8px; padding: 14px; text-align: center; background: #fff; }
.stat-value { font-size: 20px; font-weight: 700; color: #303133; }
.stat-label { font-size: 12px; color: #909399; margin-top: 4px; }
.hint { font-size: 12px; color: #999; margin-left: 8px; }
</style>
