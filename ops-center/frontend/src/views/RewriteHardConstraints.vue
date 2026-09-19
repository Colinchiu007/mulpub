<template>
  <div>
    <h1 style="margin-bottom:16px">改写硬约束</h1>
    <p style="color:#888;margin-bottom:16px;font-size:13px">
      最高优先级的改写规则：无论桌面端选择什么改写模式和改写策略都强制生效，与策略/模式指令冲突时以硬约束为准。
      支持多版本管理，唯一默认版本随运行时 bootstrap 下发到桌面端并注入引擎 systemPrompt 最前置。
    </p>

    <el-card shadow="never">
      <div style="display:flex;justify-content:flex-end;margin-bottom:12px">
        <el-button type="primary" @click="openCreate">新增硬约束</el-button>
      </div>

      <el-table :data="items" stripe v-loading="loading" style="width:100%">
        <el-table-column prop="id" label="约束 ID" min-width="200" show-overflow-tooltip />
        <el-table-column prop="title" label="标题" min-width="160" />
        <el-table-column label="默认" width="90" align="center">
          <template #default="{ row }">
            <el-tag v-if="row.isDefault" type="success" size="small">默认</el-tag>
            <span v-else>-</span>
          </template>
        </el-table-column>
        <el-table-column label="内置" width="80" align="center">
          <template #default="{ row }">
            <el-tag v-if="row.builtin" type="warning" size="small">内置</el-tag>
            <span v-else>-</span>
          </template>
        </el-table-column>
        <el-table-column label="启用" width="80" align="center">
          <template #default="{ row }">
            <el-switch :model-value="row.enabled" :disabled="row.isDefault" @change="(v) => toggleEnabled(row, v)" />
          </template>
        </el-table-column>
        <el-table-column prop="updatedAt" label="更新时间" min-width="160" show-overflow-tooltip />
        <el-table-column label="操作" width="200" align="center">
          <template #default="{ row }">
            <el-button v-if="!row.isDefault" link type="success" size="small" @click="markDefault(row)">设为默认</el-button>
            <el-button link type="primary" size="small" @click="openEdit(row)">编辑</el-button>
            <el-button v-if="!row.isDefault" link type="danger" size="small" @click="remove(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <el-dialog v-model="showDialog" :title="editing ? `编辑硬约束：${form.id}` : '新增硬约束'" width="640px" top="5vh">
      <el-form label-width="100px" label-position="left">
        <el-form-item label="约束 ID" required>
          <el-input v-model="form.id" :disabled="editing" placeholder="如 hard-constraint-custom-001（a-z0-9_-）" />
        </el-form-item>
        <el-form-item label="标题" required>
          <el-input v-model="form.title" maxlength="200" placeholder="版本标题（≤200 字）" />
        </el-form-item>
        <el-form-item label="约束内容" required>
          <el-input
            v-model="form.content"
            type="textarea"
            :rows="10"
            maxlength="5000"
            show-word-limit
            placeholder="硬约束内容（≤5000 字）。无论改写模式和策略如何选择都强制生效，冲突时以此为准。"
          />
        </el-form-item>
        <el-form-item label="描述">
          <el-input v-model="form.description" type="textarea" :rows="2" maxlength="2000" placeholder="版本说明（可选）" />
        </el-form-item>
        <el-form-item label="启用">
          <el-switch v-model="form.enabled" />
          <span style="margin-left:8px;color:#888;font-size:12px">停用后不参与默认竞选与下发</span>
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
import { ref, reactive, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  listRewriteHardConstraints, createRewriteHardConstraint, updateRewriteHardConstraint,
  deleteRewriteHardConstraint, setDefaultRewriteHardConstraint,
} from '../api/rewriteHardConstraints'

const ID_RE = /^[a-z0-9_-]{1,100}$/

const items = ref([])
const loading = ref(false)
const saving = ref(false)
const showDialog = ref(false)
const editing = ref(false)

const form = reactive({
  id: '', title: '', content: '', description: '', enabled: true,
})

onMounted(load)

async function load() {
  loading.value = true
  try {
    const data = await listRewriteHardConstraints()
    items.value = data.items || []
  } catch (e) {
    ElMessage.error(e.response?.data?.detail || '加载硬约束列表失败')
  } finally {
    loading.value = false
  }
}

function resetForm() {
  Object.assign(form, { id: '', title: '', content: '', description: '', enabled: true })
}

function openCreate() {
  editing.value = false
  resetForm()
  showDialog.value = true
}

function openEdit(row) {
  editing.value = true
  Object.assign(form, {
    id: row.id, title: row.title, content: row.content,
    description: row.description || '', enabled: row.enabled !== false,
  })
  showDialog.value = true
}

async function save() {
  if (!ID_RE.test(form.id)) {
    ElMessage.warning('约束 ID 必须是 1-100 位的 a-z0-9_- 字符串')
    return
  }
  if (!form.title.trim()) {
    ElMessage.warning('标题不能为空')
    return
  }
  if (!form.content.trim()) {
    ElMessage.warning('约束内容不能为空')
    return
  }
  saving.value = true
  try {
    if (editing.value) {
      await updateRewriteHardConstraint(form.id, {
        title: form.title, content: form.content,
        description: form.description, enabled: form.enabled,
      })
      ElMessage.success('硬约束已更新')
    } else {
      await createRewriteHardConstraint({
        id: form.id, title: form.title, content: form.content,
        description: form.description, enabled: form.enabled,
      })
      ElMessage.success('硬约束已创建')
    }
    showDialog.value = false
    await load()
  } catch (e) {
    ElMessage.error(e.response?.data?.detail || '保存失败')
  } finally {
    saving.value = false
  }
}

async function markDefault(row) {
  try {
    await ElMessageBox.confirm(
      `确定将「${row.title}」设为默认硬约束？设置后其他版本将不再是默认，桌面端下次同步时生效。`,
      '设为默认',
      { confirmButtonText: '确定', cancelButtonText: '取消', type: 'info' }
    )
  } catch {
    return
  }
  try {
    await setDefaultRewriteHardConstraint(row.id)
    ElMessage.success('已设为默认')
    await load()
  } catch (e) {
    ElMessage.error(e.response?.data?.detail || '设置默认失败')
  }
}

async function toggleEnabled(row, v) {
  try {
    await updateRewriteHardConstraint(row.id, { enabled: v })
    row.enabled = v
    ElMessage.success(v ? '已启用' : '已停用')
  } catch (e) {
    ElMessage.error(e.response?.data?.detail || '操作失败')
  }
}

async function remove(row) {
  try {
    await ElMessageBox.confirm(
      `确定删除硬约束「${row.title}」？该操作不可恢复。`,
      '删除确认',
      { confirmButtonText: '删除', cancelButtonText: '取消', type: 'warning' }
    )
  } catch {
    return
  }
  try {
    await deleteRewriteHardConstraint(row.id)
    ElMessage.success('已删除')
    await load()
  } catch (e) {
    ElMessage.error(e.response?.data?.detail || '删除失败')
  }
}
</script>
