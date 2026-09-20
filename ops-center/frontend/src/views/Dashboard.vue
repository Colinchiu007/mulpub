<template>
  <div>
    <h1 style="margin-bottom:24px">配置概览</h1>
    <el-row :gutter="20">
      <el-col :span="6" v-for="stat in stats" :key="stat.label">
        <el-card shadow="hover">
          <div style="text-align:center">
            <div style="font-size:32px;font-weight:700;color:#409EFF">{{ stat.value }}</div>
            <div style="color:#999;margin-top:8px">{{ stat.label }}</div>
          </div>
        </el-card>
      </el-col>
    </el-row>

    <el-card style="margin-top:24px" shadow="hover">
      <template #header><strong>同步状态</strong></template>
      <el-table :data="syncData" stripe v-loading="syncLoading">
        <el-table-column prop="project" label="项目" />
        <el-table-column prop="items_in_db" label="DB 配置数" width="120" />
        <el-table-column label="配置文件" width="100">
          <template #default="{ row }">
            <el-tag :type="row.file_exists ? 'success' : 'danger'" size="small">
              {{ row.file_exists ? '存在' : '缺失' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="config_file" label="路径" />
      </el-table>
    </el-card>

    <el-card style="margin-top:24px" shadow="hover">
      <template #header><strong>最近变更</strong></template>
      <el-table :data="recentLogs" stripe v-loading="logLoading" max-height="400">
        <el-table-column prop="config_id" label="配置项" />
        <el-table-column prop="change_type" label="操作" width="80">
          <template #default="{ row }">
            <el-tag :type="row.change_type === 'create' ? 'success' : 'warning'" size="small">
              {{ row.change_type }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="changed_by" label="操作人" width="100" />
        <el-table-column prop="changed_at" label="时间" width="180" />
      </el-table>
    </el-card>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { getProjects, getSyncStatus, getAuditLog } from '../api/config'

const stats = ref([
  { label: '项目数', value: 0 },
  { label: '功能开关', value: 0 },
  { label: 'AI Key', value: 0 },
  { label: '平台凭证', value: 0 },
])
const syncData = ref([])
const syncLoading = ref(false)
const recentLogs = ref([])
const logLoading = ref(false)

onMounted(async () => {
  try {
    const projectsRes = await getProjects()
    stats.value[0].value = projectsRes.projects?.length || 0
  } catch {}

  try {
    syncLoading.value = true
    const s = await getSyncStatus()
    syncData.value = s.projects || []
  } catch {} finally { syncLoading.value = false }

  try {
    logLoading.value = true
    const l = await getAuditLog({ limit: 20 })
    recentLogs.value = l.logs || []
  } catch {} finally { logLoading.value = false }
})
</script>
