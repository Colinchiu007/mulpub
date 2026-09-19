<template>
  <div>
    <h1 style="margin-bottom:16px">平台发布元数据</h1>
    <p style="color:#888;margin-bottom:16px;font-size:13px">
      运营人员维护各发布平台的元数据（标题/内容上限、内容类型分类、是否支持 API 等）；
      <b>启用</b>的平台会随运行时 bootstrap 下发给桌面端，覆盖本地同名平台的对应字段；
      本地独有平台保留、不改写桌面端 yaml。临时下线请关闭「启用」开关。
    </p>

    <el-card shadow="never">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
        <el-radio-group v-model="filterCategory" @change="filtered">
          <el-radio-button value="">全部</el-radio-button>
          <el-radio-button value="中文">中文</el-radio-button>
          <el-radio-button value="海外">海外</el-radio-button>
        </el-radio-group>
        <el-button type="primary" @click="openCreate">新增平台</el-button>
      </div>

      <el-table :data="filteredItems" stripe v-loading="loading" style="width:100%">
        <el-table-column prop="id" label="ID" min-width="140" />
        <el-table-column prop="name" label="名称" min-width="120" />
        <el-table-column label="类别" width="90">
          <template #default="{ row }">
            <el-tag size="small">{{ row.category || '中文' }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="内容类型" width="110">
          <template #default="{ row }">
            <el-tag :type="CC_TAG[row.content_category] || 'info'" size="small">{{ CC_LABELS[row.content_category] || row.content_category }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="标题上限" width="90" align="center">
          <template #default="{ row }">{{ row.max_title ?? '-' }}</template>
        </el-table-column>
        <el-table-column label="内容上限" width="90" align="center">
          <template #default="{ row }">{{ row.max_content ?? '-' }}</template>
        </el-table-column>
        <el-table-column label="支持 API" width="90" align="center">
          <template #default="{ row }">
            <el-tag v-if="row.has_api" type="success" size="small">是</el-tag>
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

    <el-dialog v-model="showDialog" :title="editing ? `编辑平台：${form.id}` : '新增平台'" width="640px">
      <el-form label-width="130px" label-position="left">
        <el-form-item label="平台 ID" required>
          <el-input v-model="form.id" :disabled="editing" placeholder="如 wechat_mp" />
        </el-form-item>
        <el-form-item label="名称" required>
          <el-input v-model="form.name" placeholder="如 微信公众号" />
        </el-form-item>
        <el-form-item label="类别">
          <el-select v-model="form.category" style="width:100%">
            <el-option label="中文" value="中文" />
            <el-option label="海外" value="海外" />
          </el-select>
        </el-form-item>
        <el-form-item label="内容类型" required>
          <el-select v-model="form.content_category" style="width:100%">
            <el-option v-for="c in CC_OPTIONS" :key="c.value" :label="c.label" :value="c.value" />
          </el-select>
        </el-form-item>
        <el-form-item label="类型（兼容）">
          <el-select v-model="form.type" style="width:100%">
            <el-option label="图文文章（article）" value="article" />
            <el-option label="混合（mixed）" value="mixed" />
          </el-select>
        </el-form-item>
        <el-form-item label="标题上限">
          <el-input-number v-model="form.max_title" :min="1" :controls="false" style="width:100%" placeholder="正整数或留空" />
        </el-form-item>
        <el-form-item label="内容上限">
          <el-input-number v-model="form.max_content" :min="1" :controls="false" style="width:100%" placeholder="正整数或留空" />
        </el-form-item>
        <el-form-item label="支持 API">
          <el-switch v-model="form.has_api" />
        </el-form-item>
        <el-form-item label="启用下发">
          <el-switch v-model="form.enabled" />
          <span style="margin-left:8px;color:#888;font-size:12px">关闭后桌面端不再下发该平台</span>
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="form.note" type="textarea" :rows="2" placeholder="运营备注（最多 200 字）" />
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
import { listPlatformDefs, createPlatformDef, updatePlatformDef, deletePlatformDef } from '../api/platformDefs'

const CC_OPTIONS = [
  { value: 'VIDEO', label: '视频' },
  { value: 'IMAGE_TEXT', label: '图文' },
  { value: 'MIXED', label: '混合' },
]
const CC_LABELS = Object.fromEntries(CC_OPTIONS.map(c => [c.value, c.label]))
const CC_TAG = { VIDEO: 'danger', IMAGE_TEXT: 'primary', MIXED: 'warning' }

const items = ref([])
const loading = ref(false)
const saving = ref(false)
const showDialog = ref(false)
const editing = ref(false)
const filterCategory = ref('')

const form = reactive({
  id: '', name: '', category: '中文', content_category: 'MIXED', type: '',
  max_title: null, max_content: null, has_api: false, enabled: true, note: '',
})

const filteredItems = computed(() => {
  if (!filterCategory.value) return items.value
  return items.value.filter(i => (i.category || '中文') === filterCategory.value)
})

onMounted(load)

async function load() {
  loading.value = true
  try {
    const data = await listPlatformDefs()
    items.value = data.items || []
  } catch (e) {
    ElMessage.error(e.response?.data?.detail || '加载平台元数据失败')
  } finally {
    loading.value = false
  }
}

function resetForm() {
  Object.assign(form, {
    id: '', name: '', category: '中文', content_category: 'MIXED', type: '',
    max_title: null, max_content: null, has_api: false, enabled: true, note: '',
  })
}

function openCreate() {
  editing.value = false
  resetForm()
  showDialog.value = true
}

function openEdit(row) {
  editing.value = true
  Object.assign(form, JSON.parse(JSON.stringify(row)))
  if (form.max_title == null || form.max_title === '') form.max_title = null
  if (form.max_content == null || form.max_content === '') form.max_content = null
  if (form.has_api == null) form.has_api = false
  if (form.enabled == null) form.enabled = true
  showDialog.value = true
}

async function save() {
  if (!form.id.trim() || !form.name.trim()) {
    ElMessage.warning('请填写平台 ID 与名称')
    return
  }
  if (!/^[a-z0-9_-]{1,64}$/.test(form.id.trim())) {
    ElMessage.warning('平台 ID 只能包含小写字母/数字/下划线/短横线（1-64 位）')
    return
  }
  if (!CC_OPTIONS.some(c => c.value === form.content_category)) {
    ElMessage.warning('内容类型必须为 VIDEO / IMAGE_TEXT / MIXED 之一')
    return
  }
  const payload = JSON.parse(JSON.stringify(form))
  payload.id = payload.id.trim()
  payload.name = payload.name.trim()
  // 上限清空语义：空串 = 清空；null = 不修改（由后端部分更新契约处理）
  payload.max_title = payload.max_title == null || payload.max_title === '' ? '' : payload.max_title
  payload.max_content = payload.max_content == null || payload.max_content === '' ? '' : payload.max_content
  saving.value = true
  try {
    if (editing.value) {
      await updatePlatformDef(payload.id, payload)
      ElMessage.success('已保存')
    } else {
      await createPlatformDef(payload)
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
    await updatePlatformDef(row.id, { enabled: value })
    row.enabled = value
    ElMessage.success(value ? '已启用，将随下次同步下发给桌面端' : '已停用，桌面端将不再下发该平台')
  } catch (e) {
    ElMessage.error(e.response?.data?.detail || '操作失败')
    await load()
  }
}

async function remove(row) {
  try {
    await ElMessageBox.confirm(`确定删除平台 ${row.name}（${row.id}）吗？`, '确认删除', { type: 'warning' })
  } catch {
    return
  }
  try {
    await deletePlatformDef(row.id)
    ElMessage.success('已删除')
    await load()
  } catch (e) {
    ElMessage.error(e.response?.data?.detail || '删除失败')
  }
}
</script>
