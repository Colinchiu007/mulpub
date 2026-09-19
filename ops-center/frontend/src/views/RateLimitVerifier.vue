<template>
  <div class="page">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
      <h1>限流与调度验证</h1>
    </div>
    <el-alert type="info" :closable="false" show-icon style="margin-bottom:16px">
      验证「每分钟连接次数 / 5小时限额次数」配置下的并发与排队机制（与桌面端 ApiUsageGovernor 同契约）。
      <b>模拟结果 ≠ 真实 provider 限流</b>；桌面端真实自检以 P2「上报自检」记录为准。
    </el-alert>

    <el-tabs v-model="tab">
      <!-- ==================== 模拟验证 ==================== -->
      <el-tab-pane label="模拟验证" name="sim">
        <el-card shadow="never">
          <el-form :inline="true" label-width="150px">
            <el-form-item label="模型预设">
              <el-select v-model="form.preset_id" filterable clearable placeholder="选预设自动带出限流" style="width:260px" @change="applyPreset">
                <el-option v-for="p in presets" :key="p.id" :label="`${p.name} (${p.id})`" :value="p.id" />
              </el-select>
            </el-form-item>
            <el-form-item label="每分钟连接次数 rpm">
              <el-input-number v-model="form.rpm" :min="1" :max="100000" style="width:150px" />
            </el-form-item>
            <el-form-item label="并发上限 maxConcurrent">
              <el-input-number v-model="form.max_concurrent" :min="1" :max="8" style="width:120px" />
              <span class="hint">未配置按 clamp(rpm/10,1,4)</span>
            </el-form-item>
            <el-form-item label="5小时限额次数">
              <el-input-number v-model="form.limit_per_5h" :min="1" :max="10000000" placeholder="留空=无5h窗口" style="width:150px" />
            </el-form-item>
            <el-form-item label="请求数">
              <el-input-number v-model="form.request_count" :min="1" :max="1000" style="width:120px" />
            </el-form-item>
            <el-form-item label="单请求耗时(ms)">
              <el-input-number v-model="form.request_duration_ms" :min="0" :max="60000" style="width:120px" />
            </el-form-item>
            <el-form-item label="到达间隔(ms)">
              <el-input-number v-model="form.arrival_interval_ms" :min="0" :max="60000" style="width:120px" />
            </el-form-item>
            <el-form-item label="注入 429（第 N 个）">
              <el-input-number v-model="form.inject_429_at" :min="1" :max="1000" placeholder="留空=不注入" style="width:140px" />
            </el-form-item>
            <el-form-item label="模拟 5h 额度超限">
              <el-switch v-model="form.exceed_5h" />
            </el-form-item>
            <el-form-item>
              <el-button type="primary" :loading="running" @click="runVerify">运行验证</el-button>
            </el-form-item>
          </el-form>
          <div class="hint" style="margin-top:-8px;margin-bottom:12px">
            默认并发 = clamp(round(rpm/10),1,4)；排队预算：并发队列 30s / RPM 时间槽 180s / 冷却 45s；429 自适应 ×0.75（下限 0.2）、成功 +0.05。
          </div>

          <template v-if="result">
            <el-divider content-position="left">指标</el-divider>
            <el-row :gutter="12" class="metric-row">
              <el-col :span="4" v-for="m in metricCards" :key="m.label">
                <el-card shadow="hover" class="metric-card">
                  <div class="metric-label">{{ m.label }}</div>
                  <div class="metric-value">{{ m.value }}</div>
                </el-card>
              </el-col>
            </el-row>

            <el-divider content-position="left">断言</el-divider>
            <el-table :data="result.assertions" border size="small" style="margin-bottom:16px">
              <el-table-column prop="name" label="断言" min-width="160" />
              <el-table-column label="结果" width="90" align="center">
                <template #default="{ row }">
                  <el-tag :type="row.pass ? 'success' : 'danger'" size="small">{{ row.pass ? 'PASS' : 'FAIL' }}</el-tag>
                </template>
              </el-table-column>
              <el-table-column prop="actual" label="实际" min-width="100" />
              <el-table-column prop="expected" label="期望" min-width="120" />
              <el-table-column prop="message" label="说明" min-width="200" show-overflow-tooltip />
            </el-table>

            <el-divider content-position="left">请求时间线（{{ result.timeline.length }} 个请求）</el-divider>
            <el-table :data="result.timeline" border size="small" max-height="360">
              <el-table-column prop="req" label="#" width="50" align="center" />
              <el-table-column prop="arrived_at" label="到达" width="80" align="right" />
              <el-table-column prop="queued_at" label="排队完成" width="90" align="right" />
              <el-table-column prop="started_at" label="开始" width="80" align="right" />
              <el-table-column prop="finished_at" label="完成" width="80" align="right" />
              <el-table-column label="状态" width="120" align="center">
                <template #default="{ row }">
                  <el-tag :type="stateTag(row.state)" size="small">{{ stateLabel(row.state) }}</el-tag>
                </template>
              </el-table-column>
              <el-table-column prop="queue_wait_ms" label="排队ms" width="90" align="right" />
              <el-table-column prop="cooldown_wait_ms" label="冷却ms" width="90" align="right" />
            </el-table>

            <div v-if="result.metrics.rate_factor_curve && result.metrics.rate_factor_curve.length" style="margin-top:12px">
              <div class="hint">rateFactor 曲线：{{ result.metrics.rate_factor_curve.map(p => p.factor).join(' → ') }}</div>
            </div>
            <div class="hint" style="margin-top:6px">验证记录 #{{ result.run_id }}（simulated=true，已落库可审计）</div>
          </template>
        </el-card>
      </el-tab-pane>

      <!-- ==================== 契约校验 ==================== -->
      <el-tab-pane label="契约校验" name="contract">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
          <span class="hint">对全部可见预设校验限流配置范围、default∈models、并发换算（clamp(round(rpm/10),1,4)）</span>
          <el-button type="primary" :loading="contractLoading" @click="loadContract">刷新校验</el-button>
        </div>
        <el-table :data="contractItems" border stripe v-loading="contractLoading">
          <el-table-column prop="preset_id" label="预设 ID" min-width="180" />
          <el-table-column prop="category" label="类别" width="120" />
          <el-table-column prop="rpm" label="rpm" width="80" align="center" />
          <el-table-column prop="limit_per_5h" label="5h 限额" width="90" align="center">
            <template #default="{ row }">{{ row.limit_per_5h ?? '—' }}</template>
          </el-table-column>
          <el-table-column prop="max_concurrent" label="换算并发" width="100" align="center">
            <template #default="{ row }">{{ row.max_concurrent ?? '—' }}</template>
          </el-table-column>
          <el-table-column label="校验规则" min-width="320">
            <template #default="{ row }">
              <div v-for="rule in row.rules" :key="rule.rule" style="display:flex;gap:8px;align-items:center;padding:2px 0">
                <el-tag :type="rule.pass ? 'success' : 'danger'" size="small">{{ rule.pass ? 'PASS' : 'FAIL' }}</el-tag>
                <span style="font-size:12px">{{ rule.rule }}</span>
                <span v-if="!rule.pass" style="color:#f56c6c;font-size:12px">实际={{ rule.actual }}（期望 {{ rule.expected }}）</span>
              </div>
            </template>
          </el-table-column>
        </el-table>
      </el-tab-pane>

      <!-- ==================== 验证记录 ==================== -->
      <el-tab-pane label="验证记录" name="history">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
          <span class="hint">模拟（simulated=true）与桌面端自检上报（simulated=false + client_id）的历史记录</span>
          <el-button type="primary" :loading="historyLoading" @click="loadHistory">刷新</el-button>
        </div>
        <el-table :data="historyItems" border stripe v-loading="historyLoading" @row-click="openRunDetail">
          <el-table-column prop="id" label="#" width="60" align="center" />
          <el-table-column label="来源" width="140">
            <template #default="{ row }">
              <el-tag :type="row.simulated ? 'info' : 'warning'" size="small">{{ row.simulated ? '模拟' : '真实自检' }}</el-tag>
              <span v-if="row.client_id" class="hint"> {{ row.client_id }}</span>
            </template>
          </el-table-column>
          <el-table-column prop="preset_id" label="预设" min-width="160">
            <template #default="{ row }">{{ row.preset_id || '—' }}</template>
          </el-table-column>
          <el-table-column prop="rpm" label="rpm" width="70" align="center" />
          <el-table-column label="maxConcurrent" width="110" align="center">
            <template #default="{ row }">{{ row.max_concurrent }}</template>
          </el-table-column>
          <el-table-column label="指标" min-width="200">
            <template #default="{ row }">
              <span class="hint">并发={{ row.metrics.max_concurrent_observed }} · 限流={{ row.metrics.rate_limited_count }} · 冷却={{ row.metrics.cooldown_count }} · 最长排队={{ row.metrics.max_queue_wait_ms }}ms</span>
            </template>
          </el-table-column>
          <el-table-column prop="created_at" label="时间" width="180" />
        </el-table>
        <el-pagination
          v-if="historyTotal > historyItems.length"
          layout="prev, pager, next" :total="historyTotal" :page-size="20"
          @current-change="(p) => { historyOffset = (p - 1) * 20; loadHistory() }"
          style="margin-top:12px;justify-content:flex-end"
        />

        <el-drawer v-model="detailVisible" title="验证记录详情" size="60%">
          <template v-if="detail">
            <el-descriptions :column="3" border size="small" style="margin-bottom:16px">
              <el-descriptions-item label="预设">{{ detail.preset_id || '—' }}</el-descriptions-item>
              <el-descriptions-item label="rpm">{{ detail.rpm }}</el-descriptions-item>
              <el-descriptions-item label="maxConcurrent">{{ detail.max_concurrent }}</el-descriptions-item>
              <el-descriptions-item label="请求数">{{ detail.request_count }}</el-descriptions-item>
              <el-descriptions-item label="5h 限额">{{ detail.limit_per_5h ?? '—' }}</el-descriptions-item>
              <el-descriptions-item label="来源">{{ detail.simulated ? '模拟' : '真实自检' }} / {{ detail.engine }}</el-descriptions-item>
            </el-descriptions>
            <el-divider content-position="left">指标</el-divider>
            <pre class="json-pre">{{ JSON.stringify(detail.metrics, null, 2) }}</pre>
            <el-divider content-position="left">断言</el-divider>
            <el-table :data="detail.assertions" border size="small">
              <el-table-column prop="name" label="断言" min-width="140" />
              <el-table-column label="结果" width="80" align="center">
                <template #default="{ row }">
                  <el-tag :type="row.pass ? 'success' : 'danger'" size="small">{{ row.pass ? 'PASS' : 'FAIL' }}</el-tag>
                </template>
              </el-table-column>
              <el-table-column prop="message" label="说明" min-width="200" />
            </el-table>
            <el-divider content-position="left">时间线</el-divider>
            <el-table :data="detail.timeline" border size="small" max-height="300">
              <el-table-column prop="req" label="#" width="50" align="center" />
              <el-table-column prop="state" label="状态" width="120" />
              <el-table-column prop="queue_wait_ms" label="排队ms" width="90" align="right" />
              <el-table-column prop="cooldown_wait_ms" label="冷却ms" width="90" align="right" />
              <el-table-column prop="started_at" label="开始" width="80" align="right" />
              <el-table-column prop="finished_at" label="完成" width="80" align="right" />
            </el-table>
          </template>
        </el-drawer>
      </el-tab-pane>
    </el-tabs>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import axios from 'axios'

const api = axios.create({ baseURL: '/api/v1' })
api.interceptors.request.use(c => {
  const s = localStorage.getItem('ops_token')
  if (s) {
    try {
      const token = JSON.parse(s).token
      if (token) c.headers.Authorization = `Bearer ${token}`
    } catch {}
  }
  return c
})

const tab = ref('sim')
const presets = ref([])
const running = ref(false)
const result = ref(null)

const form = ref({
  preset_id: '',
  rpm: 20,
  max_concurrent: null,
  limit_per_5h: null,
  request_count: 10,
  request_duration_ms: 100,
  arrival_interval_ms: 0,
  inject_429_at: null,
  exceed_5h: false,
})

async function loadPresets () {
  try {
    const res = await api.get('/model-presets')
    // 运营后台返回 { presets: [...], count }；防御性解析（兼容 items / 裸数组）
    const raw = res.data?.presets ?? res.data?.items ?? res.data
    presets.value = Array.isArray(raw) ? raw.filter(p => !p.hidden) : []
  } catch (e) {
    ElMessage.error('加载模型预设失败: ' + (e.response?.data?.detail || e.message))
  }
}

function applyPreset (id) {
  const p = presets.value.find(x => x.id === id)
  if (!p) return
  form.value.rpm = p.rate_per_minute ?? 20
  form.value.limit_per_5h = p.limit_per_5h ?? null
  form.value.max_concurrent = null
  form.value.request_count = 10
  form.value.request_duration_ms = 100
}

async function runVerify () {
  running.value = true
  try {
    const payload = {
      preset_id: form.value.preset_id || null,
      rpm: form.value.rpm,
      max_concurrent: form.value.max_concurrent,
      limit_per_5h: form.value.limit_per_5h,
      request_count: form.value.request_count,
      request_duration_ms: form.value.request_duration_ms,
      arrival_interval_ms: form.value.arrival_interval_ms,
      inject_429_at: form.value.inject_429_at,
      exceed_5h: form.value.exceed_5h,
      simulated: true,
    }
    const res = await api.post('/scheduler/verify', payload)
    result.value = res.data
    ElMessage.success(`验证完成 #${res.data.run_id}：断言 ${res.data.assertions.filter(a => a.pass).length}/${res.data.assertions.length} 通过`)
  } catch (e) {
    ElMessage.error('验证失败: ' + (e.response?.data?.detail || e.message))
  } finally {
    running.value = false
  }
}

const metricCards = computed(() => {
  if (!result.value) return []
  const m = result.value.metrics
  return [
    { label: '总耗时(ms)', value: m.total_duration_ms },
    { label: '吞吐(60s 窗口)', value: m.throughput_per_min },
    { label: '最大并发', value: m.max_concurrent_observed },
    { label: '最长排队(ms)', value: m.max_queue_wait_ms },
    { label: '限流次数', value: m.rate_limited_count },
    { label: '冷却次数', value: m.cooldown_count },
    { label: '额度拒绝', value: m.quota_exceeded_count },
  ]
})

function stateLabel (s) {
  return { queued: '排队中', running: '执行中', completed: '已完成', rate_limited: '限流', quota_exceeded: '额度超限' }[s] || s
}
function stateTag (s) {
  return { completed: 'success', queued: 'info', running: 'warning', rate_limited: 'danger', quota_exceeded: 'danger' }[s] || 'info'
}

// 契约校验
const contractItems = ref([])
const contractLoading = ref(false)
async function loadContract () {
  contractLoading.value = true
  try {
    const res = await api.get('/scheduler/contract')
    contractItems.value = res.data.items || []
  } catch (e) {
    ElMessage.error('契约校验失败: ' + (e.response?.data?.detail || e.message))
  } finally {
    contractLoading.value = false
  }
}

// 验证记录
const historyItems = ref([])
const historyLoading = ref(false)
const historyTotal = ref(0)
const historyOffset = ref(0)
const detailVisible = ref(false)
const detail = ref(null)

async function loadHistory () {
  historyLoading.value = true
  try {
    const res = await api.get(`/scheduler/verify?limit=20&offset=${historyOffset.value}`)
    historyItems.value = res.data.items || []
    historyTotal.value = historyItems.value.length >= 20 ? historyOffset.value + 21 : historyOffset.value + historyItems.value.length
  } catch (e) {
    ElMessage.error('加载验证记录失败: ' + (e.response?.data?.detail || e.message))
  } finally {
    historyLoading.value = false
  }
}

async function openRunDetail (row) {
  try {
    const res = await api.get(`/scheduler/verify/${row.id}`)
    detail.value = res.data
    detailVisible.value = true
  } catch (e) {
    ElMessage.error('加载详情失败: ' + (e.response?.data?.detail || e.message))
  }
}

onMounted(() => {
  loadPresets()
  loadContract()
  loadHistory()
})
</script>

<style scoped>
.hint { color: #909399; font-size: 12px; }
.metric-row { margin-bottom: 8px; }
.metric-card { text-align: center; }
.metric-label { font-size: 12px; color: #909399; }
.metric-value { font-size: 22px; font-weight: 600; margin-top: 4px; }
.json-pre { background: #f6f8fa; padding: 12px; border-radius: 6px; font-size: 12px; max-height: 240px; overflow: auto; }
</style>
