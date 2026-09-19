<template>
  <div class="page">
    <h1 style="margin-bottom: 16px">模型用量</h1>
    <div style="margin-bottom: 16px">
      <el-radio-group v-model="days" @change="load">
        <el-radio-button :value="7">近 7 天</el-radio-button>
        <el-radio-button :value="30">近 30 天</el-radio-button>
        <el-radio-button :value="90">近 90 天</el-radio-button>
      </el-radio-group>
      <el-button style="margin-left: 12px" :loading="loading" @click="load">刷新</el-button>
    </div>

    <div v-if="loading" style="padding: 40px; text-align: center; color: #999">加载中...</div>
    <el-empty v-else-if="!summary || !summary.totals || summary.totals.calls === 0" description="尚未收到用量上报（桌面端配置运营后台同步后每 30 分钟上报一次）" />

    <template v-else>
      <!-- 汇总卡片 -->
      <div class="stat-grid">
        <div class="stat-card"><div class="stat-value">{{ fmt(summary.totals.calls) }}</div><div class="stat-label">总调用</div></div>
        <div class="stat-card"><div class="stat-value">{{ summary.totals.success_rate }}%</div><div class="stat-label">成功率</div></div>
        <div class="stat-card"><div class="stat-value">{{ fmt(summary.totals.ratelimit) }}</div><div class="stat-label">限流(429)次数</div></div>
        <div class="stat-card"><div class="stat-value">{{ summary.totals.avg_latency_ms }}ms</div><div class="stat-label">平均耗时</div></div>
        <div class="stat-card"><div class="stat-value">¥{{ summary.totals.cost }}</div><div class="stat-label">估算成本</div></div>
        <div class="stat-card"><div class="stat-value">{{ summary.totals.active_providers }}</div><div class="stat-label">活跃服务商</div></div>
      </div>

      <!-- 每日趋势（CSS 柱状图） -->
      <el-card shadow="never" style="margin-top: 16px">
        <template #header>每日调用趋势（失败红色段）</template>
        <div class="trend-chart">
          <div v-for="d in trendData" :key="d.date" class="trend-col" :title="`${d.date}: ${d.calls} 次，失败 ${d.fail}`">
            <div class="trend-bars">
              <div class="trend-bar ok" :style="{ height: barHeight(d.calls) }"></div>
              <div class="trend-bar fail" :style="{ height: barHeight(d.fail) }"></div>
            </div>
            <div class="trend-label">{{ d.date.slice(5) }}</div>
          </div>
        </div>
      </el-card>

      <!-- 按服务商 -->
      <el-card shadow="never" style="margin-top: 16px">
        <template #header>按服务商</template>
        <el-table :data="summary.by_provider" border stripe size="small">
          <el-table-column prop="provider_id" label="服务商" min-width="180" />
          <el-table-column prop="calls" label="调用" width="90" />
          <el-table-column prop="fail" label="失败" width="80" />
          <el-table-column prop="ratelimit" label="限流" width="80" />
          <el-table-column label="失败率" width="90">
            <template #default="{ row }">{{ row.calls ? ((row.fail / row.calls) * 100).toFixed(1) + '%' : '-' }}</template>
          </el-table-column>
          <el-table-column prop="avg_latency_ms" label="平均耗时(ms)" width="110" />
          <el-table-column prop="cost" label="成本(¥)" width="100" />
          <!-- P1 调度健康度 -->
          <el-table-column label="429率" width="80" align="center">
            <template #default="{ row }">
              <el-tag :type="row.ratelimit_rate > 10 ? 'warning' : 'success'" size="small">{{ row.ratelimit_rate }}%</el-tag>
            </template>
          </el-table-column>
          <el-table-column prop="queued_count" label="排队次数" width="90" align="center" />
          <el-table-column prop="cooldown_count" label="冷却次数" width="90" align="center" />
          <el-table-column label="平均排队ms" width="110" align="center">
            <template #default="{ row }">{{ row.queued_count ? row.avg_queue_wait_ms : '-' }}</template>
          </el-table-column>
          <el-table-column label="预算利用率" width="110" align="center">
            <template #default="{ row }">
              <el-tag v-if="row.utilization != null" :type="row.utilization > 90 ? 'warning' : 'success'" size="small">{{ row.utilization }}%</el-tag>
              <span v-else class="muted">未配置</span>
            </template>
          </el-table-column>
        </el-table>
      </el-card>

      <!-- 按动作 -->
      <el-card shadow="never" style="margin-top: 16px">
        <template #header>按动作</template>
        <el-table :data="summary.by_action" border stripe size="small">
          <el-table-column prop="action" label="动作" min-width="160" />
          <el-table-column prop="calls" label="调用" width="90" />
          <el-table-column prop="ok" label="成功" width="80" />
          <el-table-column prop="fail" label="失败" width="80" />
        </el-table>
      </el-card>
    </template>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { getUsageSummary } from '../api/usage'

const days = ref(30)
const summary = ref(null)
const loading = ref(false)

const trendData = computed(() => {
  const rows = summary.value?.by_date || []
  const max = Math.max(1, ...rows.map(r => r.calls))
  return rows.map(r => ({ ...r, _max: max }))
})

function barHeight (v) {
  if (!v) return '2px'
  const max = trendData.value.length ? trendData.value[0]._max : 1
  return Math.max(4, Math.round((v / max) * 120)) + 'px'
}

function fmt (n) {
  return n >= 10000 ? (n / 10000).toFixed(1) + 'w' : String(n)
}

async function load () {
  loading.value = true
  try {
    summary.value = await getUsageSummary(days.value)
  } catch (e) {
    ElMessage.error(e.response?.data?.detail || e.message || '加载失败')
  } finally {
    loading.value = false
  }
}

onMounted(load)
</script>

<style scoped>
.stat-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 12px; }
.stat-card { border: 1px solid #e4e7ed; border-radius: 8px; padding: 16px; text-align: center; background: #fff; }
.stat-value { font-size: 22px; font-weight: 700; color: #303133; }
.stat-label { font-size: 12px; color: #909399; margin-top: 4px; }
.trend-chart { display: flex; align-items: flex-end; gap: 6px; height: 150px; overflow-x: auto; }
.trend-col { display: flex; flex-direction: column; align-items: center; justify-content: flex-end; height: 100%; min-width: 36px; }
.trend-bars { display: flex; align-items: flex-end; gap: 2px; height: 100%; }
.trend-bar.ok { width: 10px; background: #409eff; border-radius: 2px 2px 0 0; }
.trend-bar.fail { width: 10px; background: #f56c6c; border-radius: 2px 2px 0 0; }
.trend-label { font-size: 10px; color: #909399; margin-top: 4px; white-space: nowrap; }
</style>
