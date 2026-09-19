<template>
  <div>
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:24px">
      <h1>功能开关管理</h1>
      <div style="display:flex;gap:12px">
        <el-select v-model="tierFilter" placeholder="Tier 筛选" clearable style="width:140px" @change="loadFlags">
          <el-option label="Tier 1" value="1" />
          <el-option label="Tier 2" value="2" />
          <el-option label="Tier 3" value="3" />
        </el-select>
        <el-button type="primary" @click="handleSync" :loading="syncing">
          <el-icon><Refresh /></el-icon> 同步到文件
        </el-button>
      </div>
    </div>

    <el-card shadow="never">
      <el-table :data="flags" stripe v-loading="loading" @selection-change="handleSelectionChange">
        <el-table-column type="selection" width="50" />
        <el-table-column prop="key" label="开关名称" min-width="200">
          <template #default="{ row }">
            <div style="font-weight:600">{{ row.key }}</div>
          </template>
        </el-table-column>
        <el-table-column prop="description" label="描述" min-width="300" show-overflow-tooltip />
        <el-table-column label="状态" width="120" align="center">
          <template #default="{ row }">
            <el-switch
              :model-value="flagEnabled(row)"
              @change="(val) => handleToggle(row, val)"
              :loading="row._toggling"
              active-color="#13ce66"
            />
          </template>
        </el-table-column>
        <el-table-column label="状态标签" width="100" align="center">
          <template #default="{ row }">
            <el-tag :type="flagEnabled(row) ? 'success' : 'info'" size="small">
              {{ flagEnabled(row) ? '启用' : '禁用' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="updated_at" label="最后更新" width="180" />
        <el-table-column prop="updated_by" label="操作人" width="100" />
      </el-table>

      <div v-if="selectedFlags.length > 0" style="margin-top:16px;display:flex;gap:12px;align-items:center">
        <span>{{ selectedFlags.length }} 项已选</span>
        <el-button size="small" type="success" @click="batchToggle(true)">批量启用</el-button>
        <el-button size="small" type="danger" @click="batchToggle(false)">批量禁用</el-button>
      </div>
    </el-card>

    <!-- Confirm dialog -->
    <el-dialog v-model="confirmVisible" title="确认变更" width="450px">
      <div style="margin-bottom:12px">
        <el-tag :type="confirmEnabled ? 'success' : 'danger'" size="large">
          {{ confirmEnabled ? '启用' : '禁用' }}
        </el-tag>
        <strong style="margin-left:8px">{{ confirmKey }}</strong>
      </div>
      <p v-if="confirmDesc" style="color:#666;margin-top:8px">{{ confirmDesc }}</p>
      <p style="color:#e6a23c;margin-top:12px;font-size:13px">
        <el-icon><WarningFilled /></el-icon>
        变更后请点击「同步到文件」使配置生效
      </p>
      <template #footer>
        <el-button @click="confirmVisible = false">取消</el-button>
        <el-button :type="confirmEnabled ? 'success' : 'danger'" @click="confirmToggle" :loading="confirmLoading">
          确认{{ confirmEnabled ? '启用' : '禁用' }}
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { getProjectConfig, updateConfigItem, batchUpdateConfig, syncFeatureGates } from '../api/config'

const flags = ref([])
const loading = ref(false)
const syncing = ref(false)
const tierFilter = ref('')

// Toggle confirm
const confirmVisible = ref(false)
const confirmKey = ref('')
const confirmDesc = ref('')
const confirmEnabled = ref(false)
const confirmLoading = ref(false)
const pendingRow = ref(null)

// Batch selection
const selectedFlags = ref([])

function handleSelectionChange(rows) {
  selectedFlags.value = rows
}

async function loadFlags() {
  loading.value = true
  try {
    const data = await getProjectConfig('platform-orchestrator', 'feature_flag')
    flags.value = (data.items || []).map(it => ({
      ...it,
      _toggling: false,
    }))
  } catch (e) {
    ElMessage.error('加载功能开关失败')
  } finally {
    loading.value = false
  }
}

// 兼容两种 value 存储：JSON 结构（种子/同步产物）与裸 boolean 字符串（旧 toggle）
function parseFlagValue(value) {
  if (typeof value === 'string' && value.trim().startsWith('{')) {
    try { return JSON.parse(value) } catch { return null }
  }
  return null
}

function flagEnabled(row) {
  const parsed = parseFlagValue(row.value)
  if (parsed) return parsed.enabled === true
  return row.value === 'true'
}

// toggle 时保留 JSON 结构（tier/description 不丢）；裸值走原 boolean 格式
function buildFlagValue(row, enabled) {
  const parsed = parseFlagValue(row.value)
  if (parsed) {
    parsed.enabled = enabled
    return { value: JSON.stringify(parsed), value_type: row.value_type || 'json' }
  }
  return { value: String(enabled), value_type: 'boolean' }
}
function handleToggle(row, val) {
  confirmKey.value = row.key
  confirmDesc.value = row.description
  confirmEnabled.value = val
  pendingRow.value = row
  confirmVisible.value = true
}

async function confirmToggle() {
  confirmLoading.value = true
  const row = pendingRow.value
  const next = buildFlagValue(row, confirmEnabled.value)
  try {
    await updateConfigItem(
      row.project_code,
      row.category,
      row.key,
      next
    )
    row.value = next.value
    row.value_type = next.value_type
    row.updated_at = new Date().toISOString()
    ElMessage.success(`${confirmEnabled.value ? '启用' : '禁用'} ${row.key} 成功`)
    confirmVisible.value = false
  } catch (e) {
    ElMessage.error('操作失败: ' + (e.response?.data?.detail || e.message))
  } finally {
    confirmLoading.value = false
    pendingRow.value = null
  }
}

async function batchToggle(enabled) {
  const items = selectedFlags.value.map(row => {
    const next = buildFlagValue(row, enabled)
    return { project_code: row.project_code, category: row.category, key: row.key, value: next.value, value_type: next.value_type }
  })
  try {
    await batchUpdateConfig(items)
    ElMessage.success(`批量${enabled ? '启用' : '禁用'} ${items.length} 项成功`)
    await loadFlags()
  } catch (e) {
    ElMessage.error('批量操作失败')
  }
}

async function handleSync() {
  syncing.value = true
  try {
    const result = await syncFeatureGates()
    ElMessage.success(`已同步 ${result.gates} 个开关到 ${result.path}`)
  } catch (e) {
    ElMessage.error('同步失败: ' + (e.response?.data?.detail || e.message))
  } finally {
    syncing.value = false
  }
}

onMounted(loadFlags)
</script>
