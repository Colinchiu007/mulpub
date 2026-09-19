<template>
  <div>
    <h1 style="margin-bottom:16px">官方内容模板库</h1>
    <p style="color:#888;margin-bottom:16px;font-size:13px">
      运营人员维护下发到桌面端的内容模板库（Markdown 正文/适用平台/标签），随运行时 bootstrap 在桌面端同步时生效；
      官方模板在桌面端标记为内置（builtin），用户自建模板不受影响。内置种子对齐桌面端 TemplateManager.getPresets()（5 个）。
    </p>

    <el-card shadow="never">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
        <el-radio-group v-model="filterCategory" @change="load">
          <el-radio-button value="">全部</el-radio-button>
          <el-radio-button v-for="c in CATEGORY_OPTIONS" :key="c" :value="c">{{ c }}</el-radio-button>
        </el-radio-group>
        <el-button type="primary" @click="openCreate">新增模板</el-button>
      </div>

      <el-table :data="filteredItems" stripe v-loading="loading" style="width:100%">
        <el-table-column prop="id" label="ID" min-width="150" />
        <el-table-column prop="name" label="名称" min-width="120" />
        <el-table-column label="分类" width="100">
          <template #default="{ row }">
            <el-tag size="small">{{ row.category }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="title" label="标题" min-width="140" show-overflow-tooltip />
        <el-table-column label="平台" min-width="140">
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

    <el-dialog v-model="showDialog" :title="editing ? `编辑模板：${form.id}` : '新增模板'" width="640px">
      <el-form label-width="110px" label-position="left">
        <el-form-item label="模板 ID" required>
          <el-input v-model="form.id" :disabled="editing" placeholder="如 preset-weekly" />
        </el-form-item>
        <el-form-item label="名称" required>
          <el-input v-model="form.name" placeholder="模板名称（≤100 字）" />
        </el-form-item>
        <el-form-item label="分类">
          <el-select v-model="form.category" style="width:100%">
            <el-option v-for="c in CATEGORY_OPTIONS" :key="c" :label="c" :value="c" />
          </el-select>
        </el-form-item>
        <el-form-item label="标题">
          <el-input v-model="form.title" placeholder="模板标题（≤200 字）" />
        </el-form-item>
        <el-form-item label="正文（Markdown）">
          <el-input v-model="form.content" type="textarea" :rows="6" placeholder="Markdown 正文（≤20000 字）" />
        </el-form-item>
        <el-form-item label="适用平台">
          <el-input v-model="platformsText" placeholder="wechat_mp, weibo（逗号分隔）" />
        </el-form-item>
        <el-form-item label="标签">
          <el-input v-model="tagsText" placeholder="report, product（逗号分隔）" />
        </el-form-item>
        <el-form-item label="排序">
          <el-input-number v-model="form.sort_order" :min="0" :controls="false" style="width:100%" />
        </el-form-item>
        <el-form-item label="启用下发">
          <el-switch v-model="form.enabled" />
          <span style="margin-left:8px;color:#888;font-size:12px">关闭后桌面端不再下发该模板</span>
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
import { listContentTemplates, createContentTemplate, updateContentTemplate, deleteContentTemplate } from '../api/contentTemplates'

const CATEGORY_OPTIONS = ['report', 'marketing', 'tutorial', 'event', 'daily']
const ID_RE = /^[a-z0-9_-]{1,64}$/

const items = ref([])
const loading = ref(false)
const saving = ref(false)
const showDialog = ref(false)
const editing = ref(false)
const filterCategory = ref('')
const platformsText = ref('')
const tagsText = ref('')

const form = reactive({
  id: '', name: '', category: 'marketing', title: '', content: '',
  platforms: [], tags: [], sort_order: 0, enabled: true,
})

const filteredItems = computed(() => {
  if (!filterCategory.value) return items.value
  return items.value.filter(i => i.category === filterCategory.value)
})

onMounted(load)

async function load() {
  loading.value = true
  try {
    const data = await listContentTemplates()
    items.value = data.items || []
  } catch (e) {
    ElMessage.error(e.response?.data?.detail || '加载模板库失败')
  } finally {
    loading.value = false
  }
}

function resetForm() {
  Object.assign(form, { id: '', name: '', category: 'marketing', title: '', content: '', platforms: [], tags: [], sort_order: 0, enabled: true })
  platformsText.value = ''
  tagsText.value = ''
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
  platformsText.value = (form.platforms || []).join(', ')
  tagsText.value = (form.tags || []).join(', ')
  showDialog.value = true
}

async function save() {
  if (!form.id.trim() || !form.name.trim()) {
    ElMessage.warning('请填写模板 ID 与名称')
    return
  }
  if (!ID_RE.test(form.id.trim())) {
    ElMessage.warning('模板 ID 只能包含小写字母/数字/下划线/短横线（1-64 位）')
    return
  }
  const payload = JSON.parse(JSON.stringify(form))
  payload.id = payload.id.trim()
  payload.name = payload.name.trim()
  payload.platforms = platformsText.value.split(',').map(s => s.trim()).filter(Boolean)
  payload.tags = tagsText.value.split(',').map(s => s.trim()).filter(Boolean)
  payload.sort_order = Number(payload.sort_order) || 0
  saving.value = true
  try {
    if (editing.value) {
      await updateContentTemplate(payload.id, payload)
      ElMessage.success('已保存')
    } else {
      await createContentTemplate(payload)
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
    await updateContentTemplate(row.id, { enabled: value })
    row.enabled = value
    ElMessage.success(value ? '已启用，将随下次同步下发给桌面端' : '已停用，桌面端将不再下发该模板')
  } catch (e) {
    ElMessage.error(e.response?.data?.detail || '操作失败')
    await load()
  }
}

async function remove(row) {
  try {
    await ElMessageBox.confirm(`确定删除模板 ${row.name}（${row.id}）吗？`, '确认删除', { type: 'warning' })
  } catch {
    return
  }
  try {
    await deleteContentTemplate(row.id)
    ElMessage.success('已删除')
    await load()
  } catch (e) {
    ElMessage.error(e.response?.data?.detail || '删除失败')
  }
}
</script>
