<template>
  <div>
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:24px">
      <h1>配置快照</h1>
      <div style="display:flex;gap:12px">
        <el-input v-model="snapLabel" placeholder="快照标签（可选）" style="width:200px" />
        <el-button type="primary" @click="createSnap" :loading="creating">
          <el-icon><Camera /></el-icon> 创建快照
        </el-button>
      </div>
    </div>

    <el-card shadow="never">
      <el-table :data="snapList" stripe v-loading="loading" @selection-change="onSelect">
        <el-table-column type="selection" width="50" />
        <el-table-column prop="label" label="标签" min-width="200">
          <template #default="{ row }"><span v-if="row.label">{{ row.label }}</span><span v-else style="color:#999">无标签</span></template>
        </el-table-column>
        <el-table-column prop="item_count" label="配置数" width="100" align="center" />
        <el-table-column prop="created_at" label="创建时间" width="200" />
        <el-table-column prop="created_by" label="创建人" width="100" />
        <el-table-column label="操作" width="200" align="center">
          <template #default="{ row }">
            <el-button link type="primary" size="small" @click="viewSnap(row)">查看</el-button>
            <el-popconfirm title="确认恢复到此快照？当前全部配置将被覆盖" @confirm="restoreSnap(row.id)">
              <template #reference>
                <el-button link type="warning" size="small">恢复</el-button>
              </template>
            </el-popconfirm>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <el-card v-if="selectedSnaps.length === 2" shadow="never" style="margin-top:16px">
      <template #header><strong>差异对比</strong></template>
      <el-button type="primary" size="small" @click="doDiff" :loading="diffing">对比 {{ selectedSnaps[0].id.slice(0,20) }} ↔ {{ selectedSnaps[1].id.slice(0,20) }}</el-button>
      <div v-if="diffResult" style="margin-top:16px">
        <el-row :gutter="16">
          <el-col :span="8"><el-statistic title="新增" :value="diffResult.added" /></el-col>
          <el-col :span="8"><el-statistic title="删除" :value="diffResult.removed" /></el-col>
          <el-col :span="8"><el-statistic title="变更" :value="diffResult.changed" /></el-col>
        </el-row>
        <el-table v-if="diffResult.changed_items?.length" :data="diffResult.changed_items" stripe style="margin-top:12px" max-height="400">
          <el-table-column prop="id" label="配置项" min-width="250" />
          <el-table-column prop="old_value" label="旧值" min-width="200">
            <template #default="{row}"><code>{{ row.old_value?.slice(0,60) }}</code></template>
          </el-table-column>
          <el-table-column prop="new_value" label="新值" min-width="200">
            <template #default="{row}"><code>{{ row.new_value?.slice(0,60) }}</code></template>
          </el-table-column>
        </el-table>
      </div>
    </el-card>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { ElMessage } from 'element-plus'
import axios from 'axios'

const api = axios.create({ baseURL: '/api/v1' })
api.interceptors.request.use(c => {
  const s = localStorage.getItem('ops_token')
  if (s) { try { c.headers.Authorization = `Bearer ${JSON.parse(s).token}` } catch {} }
  return c
})

const snapList = ref([])
const snapLabel = ref('')
const loading = ref(false)
const creating = ref(false)
const diffing = ref(false)
const selectedSnaps = ref([])
const diffResult = ref(null)

async function loadSnaps() {
  loading.value = true
  try { snapList.value = (await api.get('/snapshots')).data.snapshots || [] }
  catch {} finally { loading.value = false }
}
loadSnaps()

function onSelect(rows) { selectedSnaps.value = rows }

async function createSnap() {
  creating.value = true
  try {
    await api.post('/snapshots', { label: snapLabel.value })
    ElMessage.success('快照已创建')
    snapLabel.value = ''
    await loadSnaps()
  } catch (e) { ElMessage.error('创建失败') }
  finally { creating.value = false }
}

async function viewSnap(row) {
  try {
    const res = await api.get(`/snapshots/${row.id}`)
    const items = res.data.items || {}
    const count = Object.keys(items).length
    const preview = Object.entries(items).slice(0, 10).map(([k,v]) => `${k}: ${v.value}`).join('\n')
    ElMessage({ message: `${count} 配置项\n${preview}`, type: 'info', duration: 10000, showClose: true })
  } catch {}
}

async function restoreSnap(id) {
  try {
    const res = await api.post(`/snapshots/${id}/restore`)
    ElMessage.success(`已恢复 ${res.data.restored} 项配置`)
    await loadSnaps()
  } catch (e) { ElMessage.error('恢复失败') }
}

async function doDiff() {
  diffing.value = true
  try {
    const res = await api.get('/snapshots/diff', { params: { id_a: selectedSnaps.value[0].id, id_b: selectedSnaps.value[1].id } })
    diffResult.value = res.data
  } catch {} finally { diffing.value = false }
}
</script>
