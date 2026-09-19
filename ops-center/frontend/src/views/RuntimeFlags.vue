<template>
  <div>
    <h1 style="margin-bottom:16px">桌面端功能开关</h1>
    <p style="color:#888;margin-bottom:16px;font-size:13px">
      运营人员维护下发到桌面端的功能开关（key → typed value），随运行时 bootstrap 在桌面端同步时生效；
      未配置同步的桌面端使用本地默认值。已内置：<code>videoCreation.maxOutputResolution</code>（输出分辨率能力开关，
      <code>1080p</code> 默认禁止 4K / <code>4k</code> 开启，桌面端引擎 fail-closed 拒绝越界分辨率）。
    </p>

    <el-card shadow="never">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
        <el-radio-group v-model="filterEnabled" @change="load">
          <el-radio-button value="">全部</el-radio-button>
          <el-radio-button value="enabled">已启用</el-radio-button>
          <el-radio-button value="disabled">已停用</el-radio-button>
        </el-radio-group>
        <el-button type="primary" @click="openCreate">新增开关</el-button>
      </div>

      <el-table :data="filteredItems" stripe v-loading="loading" style="width:100%">
        <el-table-column prop="key" label="开关 Key" min-width="240" />
        <el-table-column label="类型" width="100">
          <template #default="{ row }">
            <el-tag size="small">{{ TYPE_LABELS[row.value_type] || row.value_type }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="当前值" min-width="140">
          <template #default="{ row }">
            <span>{{ formatValue(row) }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="description" label="描述" min-width="240" show-overflow-tooltip />
        <el-table-column label="状态" width="90" align="center">
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

    <el-dialog v-model="showDialog" :title="editing ? `编辑开关：${form.key}` : '新增开关'" width="560px">
      <el-form label-width="110px" label-position="left">
        <el-form-item label="开关 Key" required>
          <el-input v-model="form.key" :disabled="editing" placeholder="如 videoCreation.maxOutputResolution" />
        </el-form-item>
        <el-form-item label="值类型" required>
          <el-select v-model="form.value_type" style="width:100%">
            <el-option v-for="t in TYPE_OPTIONS" :key="t.value" :label="t.label" :value="t.value" />
          </el-select>
        </el-form-item>
        <el-form-item :label="form.value_type === 'boolean' ? '值（true/false）' : form.value_type === 'number' ? '值（数字）' : '值（字符串）'" required>
          <el-input v-model="form.value" :placeholder="valuePlaceholder" />
        </el-form-item>
        <el-form-item label="描述">
          <el-input v-model="form.description" type="textarea" :rows="2" placeholder="用途说明（最多 200 字）" />
        </el-form-item>
        <el-form-item label="启用下发">
          <el-switch v-model="form.enabled" />
          <span style="margin-left:8px;color:#888;font-size:12px">关闭后桌面端不再下发该开关</span>
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
import { listRuntimeFlags, createRuntimeFlag, updateRuntimeFlag, deleteRuntimeFlag } from '../api/runtimeFlags'

const TYPE_OPTIONS = [
  { value: 'string', label: '字符串' },
  { value: 'boolean', label: '布尔' },
  { value: 'number', label: '数字' },
]
const TYPE_LABELS = Object.fromEntries(TYPE_OPTIONS.map(t => [t.value, t.label]))
const KEY_RE = /^[A-Za-z0-9_.-]{1,128}$/
const DECIMAL_RE = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/

const items = ref([])
const loading = ref(false)
const saving = ref(false)
const showDialog = ref(false)
const editing = ref(false)
const filterEnabled = ref('')

const form = reactive({ key: '', value_type: 'string', value: '', description: '', enabled: true })

const valuePlaceholder = computed(() => {
  if (form.value_type === 'boolean') return 'true 或 false'
  if (form.value_type === 'number') return '数字，如 12 或 3.5'
  return '字符串值，如 1080p / 4k'
})

const filteredItems = computed(() => {
  if (!filterEnabled.value) return items.value
  return items.value.filter(i => (filterEnabled.value === 'enabled') === !!i.enabled)
})

function formatValue(row) {
  const v = row.typed_value
  if (v === true) return 'true'
  if (v === false) return 'false'
  if (v === null || v === undefined || v === '') return '（空）'
  return String(v)
}

onMounted(load)

async function load() {
  loading.value = true
  try {
    const data = await listRuntimeFlags()
    items.value = data.items || []
  } catch (e) {
    ElMessage.error(e.response?.data?.detail || '加载功能开关失败')
  } finally {
    loading.value = false
  }
}

function resetForm() {
  Object.assign(form, { key: '', value_type: 'string', value: '', description: '', enabled: true })
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
  showDialog.value = true
}

async function save() {
  if (!form.key.trim()) {
    ElMessage.warning('请填写开关 Key')
    return
  }
  if (!KEY_RE.test(form.key.trim())) {
    ElMessage.warning('开关 Key 只能包含字母/数字/点/下划线/短横线（1-128 位）')
    return
  }
  if (form.value_type === 'boolean' && !['true', 'false', '1', '0'].includes(String(form.value).trim().toLowerCase())) {
    ElMessage.warning('布尔开关的值必须是 true/false/1/0')
    return
  }
  if (form.value_type === 'number' && String(form.value).trim() !== '') {
    const t = String(form.value).trim()
    if (!DECIMAL_RE.test(t)) {
      ElMessage.warning('数字开关的值必须是十进制数字（如 12 / 3.5 / 1e3）')
      return
    }
    if (!isFinite(Number(t))) {
      ElMessage.warning('数字开关的值超出可表示范围')
      return
    }
  }
  const payload = JSON.parse(JSON.stringify(form))
  payload.key = payload.key.trim()
  payload.value = payload.value == null ? '' : String(payload.value).trim()
  saving.value = true
  try {
    if (editing.value) {
      await updateRuntimeFlag(payload.key, payload)
      ElMessage.success('已保存')
    } else {
      await createRuntimeFlag(payload)
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
    await updateRuntimeFlag(row.key, { enabled: value })
    row.enabled = value
    ElMessage.success(value ? '已启用，将随下次同步下发给桌面端' : '已停用，桌面端将不再下发该开关')
  } catch (e) {
    ElMessage.error(e.response?.data?.detail || '操作失败')
    await load()
  }
}

async function remove(row) {
  try {
    await ElMessageBox.confirm(`确定删除开关 ${row.key} 吗？`, '确认删除', { type: 'warning' })
  } catch {
    return
  }
  try {
    await deleteRuntimeFlag(row.key)
    ElMessage.success('已删除')
    await load()
  } catch (e) {
    ElMessage.error(e.response?.data?.detail || '删除失败')
  }
}
</script>
