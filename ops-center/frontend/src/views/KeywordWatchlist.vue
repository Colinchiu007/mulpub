<template>
  <div>
    <h1 style="margin-bottom:16px">关键词监测目录</h1>
    <p style="color:#888;margin-bottom:16px;font-size:13px">
      运营人员维护下发到桌面端的关键词监测目录（关键词/飙升阈值/轮询间隔），随运行时 bootstrap 在桌面端同步时生效；
      桌面端按目录监测讨论热度，异常飙升触发通知；用户自建监测词不受影响。
    </p>

    <el-card shadow="never">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
        <div style="display:flex;gap:8px">
          <el-select v-model="filterEnabled" placeholder="状态" clearable style="width:120px">
            <el-option label="已启用" value="enabled" />
            <el-option label="已停用" value="disabled" />
          </el-select>
        </div>
        <el-button type="primary" @click="openCreate">新增关键词</el-button>
      </div>

      <el-table :data="filteredItems" stripe v-loading="loading" style="width:100%">
        <el-table-column prop="keyword" label="关键词" min-width="140" />
        <el-table-column label="分类" width="110">
          <template #default="{ row }">
            <el-tag size="small">{{ row.category }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="飙升阈值" width="100" align="center">
          <template #default="{ row }">{{ row.threshold }}x</template>
        </el-table-column>
        <el-table-column label="轮询间隔" width="110" align="center">
          <template #default="{ row }">{{ row.interval_minutes }} 分钟</template>
        </el-table-column>
        <el-table-column label="启用下发" width="90" align="center">
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

    <el-dialog v-model="showDialog" :title="editing ? `编辑关键词：${form.keyword}` : '新增关键词'" width="480px">
      <el-form label-width="110px" label-position="left">
        <el-form-item label="关键词" required>
          <el-input v-model="form.keyword" :disabled="editing" placeholder="2-100 字" />
        </el-form-item>
        <el-form-item label="分类">
          <el-input v-model="form.category" placeholder="如 topic / product（≤40 字）" />
        </el-form-item>
        <el-form-item label="飙升阈值">
          <el-input-number v-model="form.threshold" :min="1" :step="0.5" :controls="false" style="width:100%" />
          <span style="color:#888;font-size:12px">热度相比上次的倍数，≥1</span>
        </el-form-item>
        <el-form-item label="轮询间隔">
          <el-input-number v-model="form.interval_minutes" :min="10" :max="10080" :controls="false" style="width:100%" />
          <span style="color:#888;font-size:12px">分钟，10-10080</span>
        </el-form-item>
        <el-form-item label="启用下发">
          <el-switch v-model="form.enabled" />
          <span style="margin-left:8px;color:#888;font-size:12px">关闭后桌面端不再监测该词</span>
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
import { listKeywordWatchlist, createKeywordWatchlistEntry, updateKeywordWatchlistEntry, deleteKeywordWatchlistEntry } from '../api/keywordWatchlist'

const items = ref([])
const loading = ref(false)
const saving = ref(false)
const showDialog = ref(false)
const editing = ref(false)
const filterEnabled = ref('')

const form = reactive({ keyword: '', category: 'topic', threshold: 2.0, interval_minutes: 360, enabled: true })

const filteredItems = computed(() => {
  if (!filterEnabled.value) return items.value
  return items.value.filter(i => (filterEnabled.value === 'enabled') === !!i.enabled)
})

onMounted(load)

async function load() {
  loading.value = true
  try {
    const data = await listKeywordWatchlist()
    items.value = data.items || []
  } catch (e) {
    ElMessage.error(e.response?.data?.detail || '加载关键词监测目录失败')
  } finally {
    loading.value = false
  }
}

function resetForm() {
  Object.assign(form, { keyword: '', category: 'topic', threshold: 2.0, interval_minutes: 360, enabled: true })
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
  if (!form.keyword.trim() || form.keyword.trim().length < 2 || form.keyword.trim().length > 100) {
    ElMessage.warning('关键词必须是 2-100 字')
    return
  }
  if (!(form.threshold >= 1) || !Number.isFinite(form.threshold)) {
    ElMessage.warning('飙升阈值必须是 ≥1 的有限数字')
    return
  }
  if (!Number.isInteger(form.interval_minutes) || form.interval_minutes < 10 || form.interval_minutes > 10080) {
    ElMessage.warning('轮询间隔必须是 10-10080 的整数（分钟）')
    return
  }
  const payload = JSON.parse(JSON.stringify(form))
  payload.keyword = payload.keyword.trim()
  saving.value = true
  try {
    if (editing.value) {
      await updateKeywordWatchlistEntry(payload.id, payload)
      ElMessage.success('已保存')
    } else {
      await createKeywordWatchlistEntry(payload)
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
    await updateKeywordWatchlistEntry(row.id, { enabled: value })
    row.enabled = value
    ElMessage.success(value ? '已启用，将随下次同步下发' : '已停用，桌面端将停止监测该词')
  } catch (e) {
    ElMessage.error(e.response?.data?.detail || '操作失败')
    await load()
  }
}

async function remove(row) {
  try {
    await ElMessageBox.confirm(`确定删除关键词 ${row.keyword} 吗？`, '确认删除', { type: 'warning' })
  } catch {
    return
  }
  try {
    await deleteKeywordWatchlistEntry(row.id)
    ElMessage.success('已删除')
    await load()
  } catch (e) {
    ElMessage.error(e.response?.data?.detail || '删除失败')
  }
}
</script>
