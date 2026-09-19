<template>
  <div>
    <h1 style="margin-bottom:24px">环境变量视图（只读）</h1>

    <el-card shadow="never" style="margin-bottom:16px">
      <template #header><strong>一致性检查</strong></template>
      <div v-for="c in checks" :key="c.check" style="margin-bottom:8px">
        <el-tag v-if="c.status === 'unknown'" type="info" size="small">未配置</el-tag>
        <el-tag v-else :type="c.passed ? 'success' : 'danger'" size="small">{{ c.passed ? '✓ 通过' : '✗ 未通过' }}</el-tag>
        <span style="margin-left:8px">{{ c.detail }}</span>
      </div>
    </el-card>

    <el-tabs v-model="activeProject" @tab-change="loadEnv">
      <el-tab-pane v-for="p in ['platform-orchestrator','trendscope','content-aggregator','prompt-engine']" :key="p" :label="p" :name="p" />
    </el-tabs>

    <el-card shadow="never">
      <el-table :data="vars" stripe v-loading="loading">
        <el-table-column prop="name" label="变量名" min-width="220" />
        <el-table-column label="值" min-width="300">
          <template #default="{ row }">
            <code v-if="row.is_set" style="background:#f5f5f5;padding:2px 8px;border-radius:4px;font-size:13px">
              {{ row.value }}
            </code>
            <el-tag v-else type="danger" size="small">未配置</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="敏感" width="80" align="center">
          <template #default="{ row }">
            <el-tag :type="row.is_secret ? 'warning' : 'info'" size="small">
              {{ row.is_secret ? '是' : '否' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="100" align="center">
          <template #default="{ row }">
            <el-tag :type="row.is_set ? 'success' : 'danger'" size="small">
              {{ row.is_set ? '已设置' : '缺失' }}
            </el-tag>
          </template>
        </el-table-column>
      </el-table>
    </el-card>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import axios from 'axios'

const api = axios.create({ baseURL: '/api/v1' })
api.interceptors.request.use(c => {
  const s = localStorage.getItem('ops_token')
  if (s) { try { c.headers.Authorization = `Bearer ${JSON.parse(s).token}` } catch {} }
  return c
})

const activeProject = ref('platform-orchestrator')
const vars = ref([])
const loading = ref(false)
const checks = ref([])

onMounted(async () => {
  try { checks.value = (await api.get('/env')).data.checks || [] } catch {}
  await loadEnv()
})

async function loadEnv() {
  loading.value = true
  try {
    vars.value = (await api.get(`/env/${activeProject.value}`)).data.variables || []
  } catch { vars.value = [] }
  finally { loading.value = false }
}
</script>
