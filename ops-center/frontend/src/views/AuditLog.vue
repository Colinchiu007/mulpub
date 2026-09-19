<template>
  <div>
    <h1 style="margin-bottom:16px">审计日志</h1>
    <p style="color:#888;margin-bottom:16px;font-size:13px">
      查看配置项变更的审计记录（只读）。
    </p>

    <el-card shadow="never">
      <template #header>
        <div style="display:flex;justify-content:space-between;align-items:center">
          <strong>变更记录（{{ logs.length }}）</strong>
          <div>
            <el-input v-model="configIdFilter" placeholder="按配置 ID 过滤" clearable style="width:280px;margin-right:12px" @keyup.enter="load" @clear="load" />
            <el-button type="primary" :loading="loading" @click="load">刷新</el-button>
          </div>
        </div>
      </template>
      <el-table :data="logs" stripe v-loading="loading" style="width:100%">
        <el-table-column prop="config_id" label="配置 ID" min-width="220" />
        <el-table-column label="变更类型" width="110">
          <template #default="{ row }">
            <el-tag size="small" :type="row.change_type === 'delete' ? 'danger' : (row.change_type === 'create' ? 'success' : 'info')">
              {{ row.change_type }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="旧值" min-width="160">
          <template #default="{ row }">{{ row.old_value || '-' }}</template>
        </el-table-column>
        <el-table-column label="新值" min-width="160">
          <template #default="{ row }">{{ row.new_value || '-' }}</template>
        </el-table-column>
        <el-table-column prop="changed_by" label="操作人" width="110" />
        <el-table-column prop="changed_at" label="时间" width="180" />
      </el-table>
      <el-empty v-if="!loading && logs.length === 0" description="暂无审计日志" />
    </el-card>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { getAuditLog } from '../api/config'

const logs = ref([])
const loading = ref(false)
const configIdFilter = ref('')

onMounted(load)

async function load() {
  loading.value = true
  try {
    const params = {}
    if (configIdFilter.value.trim()) params.config_id = configIdFilter.value.trim()
    const data = await getAuditLog(params)
    logs.value = data.logs || []
  } catch {
    ElMessage.error('加载审计日志失败')
  } finally {
    loading.value = false
  }
}
</script>
