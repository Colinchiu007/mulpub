<template>
  <div class="model-keys">
    <h2>🔑 模型密钥（提示词评测）</h2>
    <p class="muted">admin 维护评测生成/翻译/评估所用的 provider 密钥；密钥加密存储，不返回前端。</p>

    <el-form inline style="margin: 12px 0">
      <el-form-item :label="isEdit ? 'Provider（编辑锁定）' : 'Provider'">
        <el-select v-model="form.provider" style="width: 180px" :disabled="isEdit">
          <el-option v-for="p in ['minimax-image','flux','minimax-llm','minimax-vision','opencode-go-vision','hunyuan']" :key="p" :label="p" :value="p" />
        </el-select>
      </el-form-item>
      <el-form-item :label="isEdit ? '模型（编辑锁定）' : '模型'">
        <el-input v-model="form.model" placeholder="如 image-01" style="width: 140px" :disabled="isEdit" />
      </el-form-item>
      <el-form-item label="API Key">
        <el-input v-model="form.api_key" type="password" show-password :placeholder="isEdit ? '留空表示不修改密钥' : ''" style="width: 220px" />
      </el-form-item>
      <el-form-item label="Base URL">
        <el-input v-model="form.base_url" placeholder="https://api.minimaxi.com/v1" style="width: 240px" />
      </el-form-item>
      <el-form-item label="启用">
        <el-switch v-model="form.enabled" />
      </el-form-item>
      <el-form-item>
        <el-button type="primary" :loading="saving" @click="save">{{ isEdit ? '保存修改' : '保存' }}</el-button>
        <el-button v-if="isEdit" @click="cancelEdit">取消编辑</el-button>
        <el-button :loading="testing" @click="testForm">测试连通</el-button>
      </el-form-item>
    </el-form>
    <el-alert v-if="msg" :title="msg" :type="msgType" show-icon closable @close="msg=''" />

    <el-table :data="items" stripe>
      <el-table-column prop="provider" label="Provider" width="140" />
      <el-table-column prop="model" label="模型" width="160" />
      <el-table-column prop="base_url" label="Base URL" min-width="220" />
      <el-table-column prop="enabled" label="启用" width="80">
        <template #default="{ row }">{{ row.enabled ? '是' : '否' }}</template>
      </el-table-column>
      <el-table-column prop="is_default" label="默认" width="90">
        <template #default="{ row }">
          <el-tag v-if="row.is_default" type="success" size="small">默认</el-tag>
          <span v-else>-</span>
        </template>
      </el-table-column>
      <el-table-column prop="updated_at" label="更新时间" width="200" />
      <el-table-column label="操作" width="400">
        <template #default="{ row }">
          <el-button size="small" @click="startEdit(row)">编辑</el-button>
          <el-button size="small" :loading="testingRow === row.provider + '/' + row.model" @click="testRow(row)">测试连通</el-button>
          <el-button v-if="row.id" size="small" type="primary" plain :disabled="!row.enabled || !!row.is_default || !groupedProviders.includes(row.provider)" :loading="defaultingRow === row.id" @click="setDefault(row)">设为默认</el-button>
          <el-button v-if="row.id" size="small" type="danger" :loading="removingRow === row.id" @click="removeRow(row)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { listPromptEvalProviders, upsertPromptEvalProvider, testPromptEvalProvider, deletePromptEvalProvider, setDefaultPromptEvalProvider } from '../api/promptEval'

const form = ref({ provider: 'minimax-image', model: 'image-01', api_key: '', base_url: '', enabled: true })
const groupedProviders = ['minimax-image', 'flux', 'minimax-llm', 'minimax-vision', 'opencode-go-vision', 'hunyuan']
const items = ref([])
const saving = ref(false)
const testing = ref(false)
const testingRow = ref('')
const removingRow = ref(null)
const defaultingRow = ref(null)
const isEdit = ref(false)
const msg = ref('')
const msgType = ref('success')

async function load() {
  const data = await listPromptEvalProviders()
  items.value = data.items || []
}

function startEdit(row) {
  isEdit.value = true
  form.value = {
    provider: row.provider, model: row.model,
    api_key: '', base_url: row.base_url || '', enabled: !!row.enabled,
  }
  msgType.value = 'info'
  msg.value = '编辑模式：可修改 Base URL / 启用状态 / API Key（留空表示不修改密钥）'
}

function cancelEdit() {
  isEdit.value = false
  form.value = { provider: 'minimax-image', model: 'image-01', api_key: '', base_url: '', enabled: true }
  msg.value = ''
}

async function testConnection(payload) {
  try {
    const r = await testPromptEvalProvider(payload)
    msgType.value = 'success'
    msg.value = '✅ 测试成功：' + (r.detail || '连接成功')
  } catch (e) {
    msgType.value = 'error'
    msg.value = '❌ 测试失败：' + (e?.response?.data?.detail || e.message)
  }
}

async function testForm() {
  if (!form.value.api_key) {
    msgType.value = 'error'
    msg.value = '请先填写 API Key 再测试（或保存后对下方列表项测试）'
    return
  }
  testing.value = true
  await testConnection({
    provider: form.value.provider, model: form.value.model,
    api_key: form.value.api_key, base_url: form.value.base_url,
  })
  testing.value = false
}

async function testRow(row) {
  testingRow.value = row.provider + '/' + row.model
  await testConnection({ provider: row.provider, model: row.model })
  testingRow.value = ''
}

async function removeRow(row) {
  try {
    await ElMessageBox.confirm(`确定删除密钥「${row.provider} / ${row.model}」吗？删除后该密钥不可恢复。`, '确认删除', { type: 'warning' })
  } catch {
    return
  }
  removingRow.value = row.id
  try {
    await deletePromptEvalProvider(row.id)
    ElMessage.success('已删除')
    msg.value = ''
  } catch (e) {
    ElMessage.error(e.response?.data?.detail || e.message || '删除失败')
    removingRow.value = null
    return
  }
  try {
    await load()
  } catch (e) {
    ElMessage.warning('已删除，但列表刷新失败：' + (e?.response?.data?.detail || e.message))
  } finally {
    removingRow.value = null
  }
}

async function setDefault(row) {
  defaultingRow.value = row.id
  try {
    await setDefaultPromptEvalProvider(row.id)
    ElMessage.success('已将「' + row.provider + ' / ' + row.model + '」设为默认')
    msg.value = ''
    await load()
  } catch (e) {
    ElMessage.error(e.response?.data?.detail || e.message || '设为默认失败')
  } finally {
    defaultingRow.value = null
  }
}

async function save() {
  saving.value = true
  msg.value = ''
  try {
    await upsertPromptEvalProvider({
      provider: form.value.provider, model: form.value.model,
      api_key: form.value.api_key, base_url: form.value.base_url, enabled: form.value.enabled,
    })
    msgType.value = 'success'
    msg.value = isEdit.value ? '修改已保存' : '密钥已保存'
    if (isEdit.value) {
      cancelEdit()
    } else {
      form.value.api_key = ''
    }
    await load()
  } catch (e) {
    msgType.value = 'error'
    msg.value = '保存失败：' + (e?.response?.data?.detail || e.message)
  } finally {
    saving.value = false
  }
}

onMounted(load)
</script>

<style scoped>
.muted { color: #909399; font-size: 13px; }
</style>
