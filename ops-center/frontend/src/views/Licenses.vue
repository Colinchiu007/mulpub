<template>
  <div class="page">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
      <h1>许可证管理</h1>
      <el-button type="primary" @click="openCreate">＋ 签发许可证</el-button>
    </div>

    <el-table :data="items" border stripe v-loading="loading">
      <el-table-column prop="id" label="ID" width="60" />
      <el-table-column label="许可证 Key" min-width="220">
        <template #default="{ row }">
          <code style="background:#f5f5f5;padding:2px 8px;border-radius:4px;font-size:13px">{{ row.license_key }}</code>
          <el-button link type="primary" size="small" @click="reveal(row)" style="margin-left:6px">查看</el-button>
        </template>
      </el-table-column>
      <el-table-column prop="plan" label="套餐" width="90" />
      <el-table-column prop="device_limit" label="设备数" width="80" align="center" />
      <el-table-column prop="expires_at" label="到期" width="180" />
      <el-table-column label="状态" width="100" align="center">
        <template #default="{ row }">
          <el-tag :type="statusTag(row.status)" size="small">{{ statusLabel(row.status) }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="note" label="备注" min-width="160" show-overflow-tooltip />
      <el-table-column label="操作" width="160" align="center">
        <template #default="{ row }">
          <el-button v-if="row.status === 'active'" link type="warning" size="small" @click="disable(row)">禁用</el-button>
          <el-button v-else link type="success" size="small" @click="enable(row)">启用</el-button>
          <el-popconfirm title="确定删除此许可证？" @confirm="remove(row)">
            <template #reference>
              <el-button link type="danger" size="small">删除</el-button>
            </template>
          </el-popconfirm>
        </template>
      </el-table-column>
    </el-table>

    <el-dialog v-model="dialogVisible" title="签发许可证" width="520px" @closed="resetForm">
      <el-form label-width="100px">
        <el-form-item label="套餐" required>
          <el-select v-model="form.plan" style="width:200px">
            <el-option label="free" value="free" />
            <el-option label="trial" value="trial" />
            <el-option label="pro" value="pro" />
          </el-select>
        </el-form-item>
        <el-form-item label="设备数">
          <el-input-number v-model="form.device_limit" :min="1" />
        </el-form-item>
        <el-form-item label="到期时间">
          <el-input v-model="form.expires_at" placeholder="ISO 时间，留空=永久（如 2099-12-31T00:00:00Z）" />
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="form.note" maxlength="200" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="save">签发</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="showNewKey" title="签发成功" width="480px">
      <p>请复制许可证 Key 并安全交付（仅显示一次）：</p>
      <el-input :model-value="newKey" readonly>
        <template #append>
          <el-button @click="copyKey">复制</el-button>
        </template>
      </el-input>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import axios from 'axios'

const api = axios.create({ baseURL: '/api/v1' })
api.interceptors.request.use(c => {
  const s = localStorage.getItem('ops_token')
  if (s) { try { c.headers.Authorization = `Bearer ${JSON.parse(s).token}` } catch {} }
  return c
})

const items = ref([])
const loading = ref(false)
const saving = ref(false)
const dialogVisible = ref(false)
const showNewKey = ref(false)
const newKey = ref('')
const form = ref({ plan: 'pro', device_limit: 1, expires_at: '', note: '' })

function statusLabel (s) { return { active: '启用', disabled: '已禁用', expired: '已过期' }[s] || s }
function statusTag (s) { return { active: 'success', disabled: 'danger', expired: 'info' }[s] || 'info' }

onMounted(load)

async function load () {
  loading.value = true
  try {
    const res = await api.get('/licenses')
    items.value = res.data.items || []
  } catch { ElMessage.error('加载失败') } finally { loading.value = false }
}

function openCreate () {
  form.value = { plan: 'pro', device_limit: 1, expires_at: '', note: '' }
  dialogVisible.value = true
}

function resetForm () { form.value = {} }

async function save () {
  saving.value = true
  try {
    const res = await api.post('/licenses', form.value)
    newKey.value = res.data.license_key
    dialogVisible.value = false
    showNewKey.value = true
    ElMessage.success('签发成功')
    await load()
  } catch (e) {
    ElMessage.error(e.response?.data?.detail || '签发失败')
  } finally { saving.value = false }
}

function reveal (row) {
  ElMessageBox.confirm(`确认查看许可证 ${row.license_key} 的明文？`, '查看明文', { type: 'warning' }).then(async () => {
    try {
      const res = await api.post(`/licenses/${row.id}/reveal`)
      newKey.value = res.data.license_key
      showNewKey.value = true
    } catch (e) { ElMessage.error(e.response?.data?.detail || '查看失败') }
  }).catch(() => {})
}

function copyKey () {
  if (navigator.clipboard) navigator.clipboard.writeText(newKey.value)
  ElMessage.success('已复制')
}

async function disable (row) {
  try {
    await api.put(`/licenses/${row.id}`, { ...row, status: 'disabled' })
    ElMessage.success('已禁用')
    await load()
  } catch (e) { ElMessage.error(e.response?.data?.detail || '操作失败') }
}

async function enable (row) {
  let expiresAt = row.expires_at || ''
  if (row.status === 'expired') {
    const { value } = await ElMessageBox.prompt('该许可证已过期，请输入新的到期时间（ISO，如 2099-12-31T00:00:00Z）', '启用过期许可证', {
      inputValue: expiresAt || '2099-12-31T00:00:00Z', confirmButtonText: '启用', cancelButtonText: '取消',
    }).catch(() => ({ value: null }))
    if (value === null) return
    expiresAt = value
  }
  try {
    await api.put(`/licenses/${row.id}`, { plan: row.plan, device_limit: row.device_limit, expires_at: expiresAt, status: 'active', note: row.note })
    ElMessage.success('已启用')
    await load()
  } catch (e) { ElMessage.error(e.response?.data?.detail || '操作失败') }
}

async function remove (row) {
  try {
    await api.delete(`/licenses/${row.id}`)
    ElMessage.success('已删除')
    await load()
  } catch (e) { ElMessage.error(e.response?.data?.detail || '删除失败') }
}
</script>
