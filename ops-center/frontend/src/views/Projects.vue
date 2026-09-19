<template>
  <div>
    <h1 style="margin-bottom:16px">项目配置</h1>
    <p style="color:#888;margin-bottom:16px;font-size:13px">
      查看各项目已登记的配置项（只读）。配置编辑需管理员权限。
    </p>

    <el-card v-if="!selectedProject" shadow="never">
      <template #header><strong>项目列表（{{ projects.length }}）</strong></template>
      <el-table :data="projects" stripe v-loading="loading" style="width:100%">
        <el-table-column prop="code" label="项目代码" min-width="180" />
        <el-table-column prop="name" label="名称" min-width="140" />
        <el-table-column prop="description" label="描述" min-width="220" />
        <el-table-column label="配置格式" width="100">
          <template #default="{ row }"><el-tag size="small">{{ row.config_format }}</el-tag></template>
        </el-table-column>
        <el-table-column label="状态" width="90">
          <template #default="{ row }">
            <el-tag :type="row.enabled ? 'success' : 'info'" size="small">{{ row.enabled ? '启用' : '停用' }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="120" align="center">
          <template #default="{ row }">
            <el-button link type="primary" size="small" @click="openProject(row)">查看配置</el-button>
          </template>
        </el-table-column>
      </el-table>
      <el-empty v-if="!loading && projects.length === 0" description="暂无项目" />
    </el-card>

    <el-card v-else shadow="never">
      <template #header>
        <div style="display:flex;justify-content:space-between;align-items:center">
          <strong>{{ selectedProject.name }}（{{ selectedProject.code }}）— 配置项（{{ items.length }}）</strong>
          <el-button size="small" @click="selectedProject = null">← 返回项目列表</el-button>
        </div>
      </template>
      <el-table :data="items" stripe v-loading="itemsLoading" style="width:100%">
        <el-table-column prop="key" label="Key" min-width="160" />
        <el-table-column prop="category" label="类别" width="140" />
        <el-table-column label="值" min-width="200">
          <template #default="{ row }">
            <span v-if="row.is_secret && row.is_masked">{{ row.value }}</span>
            <span v-else-if="row.is_secret">***</span>
            <span v-else>{{ row.value }}</span>
          </template>
        </el-table-column>
        <el-table-column label="类型" width="90">
          <template #default="{ row }"><el-tag size="small">{{ row.value_type }}</el-tag></template>
        </el-table-column>
        <el-table-column prop="description" label="描述" min-width="200" />
        <el-table-column prop="updated_by" label="更新人" width="110" />
        <el-table-column prop="updated_at" label="更新时间" width="180" />
      </el-table>
      <el-empty v-if="!itemsLoading && items.length === 0" description="该项目暂无配置项" />
    </el-card>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { getProjects, getProjectConfig } from '../api/config'

const projects = ref([])
const loading = ref(false)
const selectedProject = ref(null)
const items = ref([])
const itemsLoading = ref(false)

onMounted(load)

async function load() {
  loading.value = true
  try {
    const data = await getProjects()
    projects.value = data.projects || []
  } catch {
    ElMessage.error('加载项目列表失败')
  } finally {
    loading.value = false
  }
}

async function openProject(row) {
  selectedProject.value = row
  itemsLoading.value = true
  items.value = []
  try {
    const data = await getProjectConfig(row.code)
    items.value = data.items || []
  } catch {
    ElMessage.error('加载项目配置失败')
    selectedProject.value = null
  } finally {
    itemsLoading.value = false
  }
}
</script>
