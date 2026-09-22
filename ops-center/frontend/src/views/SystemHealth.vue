<template>
  <div class="page">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
      <h1>系统健康</h1>
      <el-button type="primary" :loading="running" @click="run">一键巡检</el-button>
    </div>

    <el-alert
      v-if="overall"
      :type="overall === 'ok' && activeCount > 0 ? 'success' : (overall === 'ok' ? 'info' : 'error')"
      :title="overall === 'error' ? '存在异常服务，请查看下方明细' : (activeCount > 0 ? '全部服务正常' : '未配置任何巡检目标')"
      :closable="false"
      style="margin-bottom:16px"
    />
    <div v-if="generatedAt" style="margin-bottom:12px;color:var(--color-text-secondary);font-size: var(--font-size-xs)">巡检时间：{{ generatedAt }}</div>

    <el-table :data="checks" border stripe v-loading="running">
      <el-table-column prop="name" label="服务" min-width="160" />
      <el-table-column label="状态" width="120" align="center">
        <template #default="{ row }">
          <el-tag :type="statusTag(row.status)" size="small">{{ statusLabel(row.status) }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="耗时" width="100" align="center">
        <template #default="{ row }">{{ row.status === 'skipped' ? '-' : row.latency_ms + 'ms' }}</template>
      </el-table-column>
      <el-table-column prop="detail" label="详情" min-width="280" show-overflow-tooltip />
    </el-table>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { createApiClient } from '../api/http'

const api = createApiClient()

const checks = ref([])
const overall = ref('')
const generatedAt = ref('')
const running = ref(false)

const activeCount = computed(() => checks.value.filter(c => c.status !== 'skipped').length)

function statusLabel (s) { return { ok: '正常', error: '异常', skipped: '未配置' }[s] || s }
function statusTag (s) { return { ok: 'success', error: 'danger', skipped: 'info' }[s] || 'info' }

async function run () {
  running.value = true
  try {
    const res = await api.get('/system/health')
    checks.value = res.data.checks || []
    overall.value = res.data.overall || ''
    generatedAt.value = res.data.generated_at || ''
  } catch (e) {
    ElMessage.error(e.response?.data?.detail || '巡检失败')
  } finally {
    running.value = false
  }
}

onMounted(run)
</script>
