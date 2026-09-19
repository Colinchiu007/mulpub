<template>
  <div>
    <h1 style="margin-bottom:16px">发布数据看板</h1>
    <p style="color:#888;margin-bottom:16px;font-size:13px">
      桌面端脱敏上报的发布指标（按 发布日期 + 平台 聚合计数，不含标题/正文/账号内容），帮助运营了解各平台产粮与失败情况。
    </p>

    <el-card shadow="never" style="margin-bottom:16px">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <el-radio-group v-model="days" @change="load">
          <el-radio-button :value="7">7 天</el-radio-button>
          <el-radio-button :value="30">30 天</el-radio-button>
          <el-radio-button :value="90">90 天</el-radio-button>
        </el-radio-group>
        <el-button @click="load" :loading="loading">刷新</el-button>
      </div>
      <div v-if="summary" style="display:flex;gap:16px;margin-top:16px;flex-wrap:wrap">
        <div class="stat-card"><div class="stat-num">{{ summary.totals.publish_count }}</div><div class="stat-label">发布总数</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#13ce66">{{ summary.totals.ok_count }}</div><div class="stat-label">成功</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#f56c6c">{{ summary.totals.fail_count }}</div><div class="stat-label">失败</div></div>
        <div class="stat-card"><div class="stat-num">{{ summary.totals.success_rate }}%</div><div class="stat-label">成功率</div></div>
        <div class="stat-card"><div class="stat-num">{{ summary.totals.platforms }}</div><div class="stat-label">平台数</div></div>
        <div class="stat-card"><div class="stat-num">{{ summary.totals.clients }}</div><div class="stat-label">设备数</div></div>
      </div>
    </el-card>

    <el-card shadow="never" style="margin-bottom:16px">
      <template #header>按平台</template>
      <el-table :data="summary ? summary.by_platform : []" stripe v-loading="loading" style="width:100%">
        <el-table-column prop="platform" label="平台" min-width="140" />
        <el-table-column prop="publish_count" label="发布数" width="100" align="center" />
        <el-table-column prop="ok_count" label="成功" width="90" align="center" />
        <el-table-column prop="fail_count" label="失败" width="90" align="center" />
        <el-table-column label="成功率" width="110" align="center">
          <template #default="{ row }">{{ row.success_rate }}%</template>
        </el-table-column>
      </el-table>
    </el-card>

    <el-card shadow="never">
      <template #header>每日趋势</template>
      <div v-if="summary && summary.by_date.length" class="bar-chart">
        <div v-for="d in summary.by_date" :key="d.date" class="bar-col" :title="`${d.date}：发布 ${d.publish_count}（成功 ${d.ok_count} / 失败 ${d.fail_count}）`">
          <div class="bar-stack">
            <div class="bar-ok" :style="{ height: barHeight(d.ok_count) }"></div>
            <div class="bar-fail" :style="{ height: barHeight(d.fail_count) }"></div>
          </div>
          <div class="bar-date">{{ d.date.slice(5) }}</div>
        </div>
      </div>
      <div v-else-if="!loading" style="color:#888;padding:24px 0;text-align:center">尚未收到发布数据上报（桌面端需配置运营后台同步）。</div>
    </el-card>
  </div>
</template>


<script setup>
import { ref, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { getPublishSummary } from '../api/publishMetrics'

const days = ref(30)
const loading = ref(false)
const summary = ref(null)

function barHeight(v) {
  const max = Math.max(1, ...(summary.value ? summary.value.by_date.map(d => d.publish_count) : [1]))
  // ok+fail 共享同一 110px 容器：按占比分配，堆叠不溢出
  return Math.max(2, Math.round((v / max) * 106)) + 'px'
}

onMounted(load)

async function load() {
  loading.value = true
  try {
    summary.value = await getPublishSummary(days.value)
  } catch (e) {
    if (e.response?.status === 403) {
      ElMessage.warning('需要管理员权限查看发布数据')
    } else {
      ElMessage.error(e.response?.data?.detail || '加载发布数据失败')
    }
  } finally {
    loading.value = false
  }
}
</script>

<style scoped>
.stat-card {
  flex: 1 1 140px;
  border: 1px solid #ebeef5;
  border-radius: 8px;
  padding: 14px 18px;
  text-align: center;
  background: #fafafa;
}
.stat-num { font-size: 24px; font-weight: 600; }
.stat-label { color: #888; font-size: 13px; margin-top: 4px; }
.bar-chart { display: flex; gap: 6px; align-items: flex-end; min-height: 140px; overflow-x: auto; }
.bar-col { flex: 0 0 34px; display: flex; flex-direction: column; align-items: center; gap: 4px; }
.bar-stack { width: 24px; display: flex; flex-direction: column; justify-content: flex-end; height: 110px; }
.bar-ok { background: #13ce66; width: 100%; }
.bar-fail { background: #f56c6c; width: 100%; }
.bar-date { font-size: 11px; color: #888; }
</style>
