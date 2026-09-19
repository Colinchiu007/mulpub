<template>
  <div>
    <h1 style="margin-bottom:24px">发布平台凭证</h1>
    <el-card shadow="never">
      <el-table :data="platforms" stripe v-loading="loading">
        <el-table-column prop="key" label="平台" min-width="140" />
        <el-table-column prop="description" label="描述" min-width="200" show-overflow-tooltip />
        <el-table-column label="Cookie/Token" min-width="180">
          <template #default="{ row }">
            <code style="background:#f5f5f5;padding:2px 8px;border-radius:4px;font-size:12px" v-if="row.value">
              {{ row.value.length > 30 ? row.value.slice(0,30)+'...' : row.value }}
            </code>
            <span v-else style="color:#999">未配置</span>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="140" align="center">
          <template #default="{ row }">
            <el-button link type="primary" size="small" @click="openEdit(row)">编辑</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <el-dialog v-model="dialogVisible" title="编辑平台凭证" width="500px">
      <el-form :model="form" label-width="100px">
        <el-form-item label="平台">{{ form.key }}</el-form-item>
        <el-form-item label="凭证内容">
          <el-input v-model="form.credentials" type="textarea" :rows="6" placeholder="JSON 格式凭证，如 {&quot;cookie&quot;:&quot;...&quot;,&quot;token&quot;:&quot;...&quot;}" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible=false">取消</el-button>
        <el-button type="primary" @click="saveCredential" :loading="saving">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { getProjectConfig, updateConfigItem } from '../api/config'
import axios from 'axios'

const api = axios.create({ baseURL: '/api/v1' })
api.interceptors.request.use(c => {
  const s = localStorage.getItem('ops_token')
  if (s) { try { c.headers.Authorization = `Bearer ${JSON.parse(s).token}` } catch {} }
  return c
})

const platforms = ref([])
const loading = ref(false)
const dialogVisible = ref(false)
const saving = ref(false)
const form = ref({})

onMounted(loadPlatforms)

async function loadPlatforms() {
  loading.value = true
  try {
    const data = await getProjectConfig('multi-publish', 'platform_credential')
    platforms.value = data.items || []
  } catch {
    // No platforms configured yet — show defaults
    const defaults = ['bilibili','douyin','xiaohongshu','shipinhao','youtube','kuaishou','weibo','zhihu','toutiao']
    platforms.value = defaults.map(k => ({ id: `multi-publish.platform_credential.${k}`, project_code:'multi-publish', category:'platform_credential', key:k, value:'', description:'' }))
  } finally { loading.value = false }
}

function openEdit(row) {
  form.value = { ...row, credentials: row.value || '{}' }
  dialogVisible.value = true
}

async function saveCredential() {
  saving.value = true
  try {
    await updateConfigItem('multi-publish', 'platform_credential', form.value.key, {
      value: form.value.credentials, value_type: 'json', description: form.value.description || `Credential for ${form.value.key}`
    })
    ElMessage.success('已保存')
    dialogVisible.value = false
    await loadPlatforms()
  } catch (e) {
    ElMessage.error('保存失败: ' + (e.response?.data?.detail || e.message))
  } finally { saving.value = false }
}
</script>
