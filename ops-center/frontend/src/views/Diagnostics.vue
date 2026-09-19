<template>
  <div class="page">
    <h1 style="margin-bottom: 16px">视频创作诊断</h1>
    <div style="margin-bottom: 16px">
      <el-radio-group v-model="days" @change="load">
        <el-radio-button :value="7">近 7 天</el-radio-button>
        <el-radio-button :value="30">近 30 天</el-radio-button>
        <el-radio-button :value="90">近 90 天</el-radio-button>
      </el-radio-group>
      <el-button style="margin-left: 12px" :loading="loading" @click="load">刷新</el-button>
      <span style="margin-left: 12px; color: #999; font-size: 12px">数据来源：桌面端失败诊断脱敏上报（每 30 分钟）</span>
    </div>

    <div v-if="loading" style="padding: 40px; text-align: center; color: #999">加载中...</div>
    <el-empty v-else-if="!summary || !summary.totals || summary.totals.runs === 0" description="尚未收到诊断上报（桌面端配置运营后台同步后每 30 分钟上报一次）" />

    <template v-else>
      <!-- 汇总卡片 -->
      <div class="stat-grid">
        <div class="stat-card"><div class="stat-value">{{ fmt(summary.totals.runs) }}</div><div class="stat-label">创作 run 总数</div></div>
        <div class="stat-card"><div class="stat-value">{{ summary.totals.failure_rate }}%</div><div class="stat-label">失败率</div></div>
        <div class="stat-card"><div class="stat-value">{{ fmt(summary.totals.failed) }}</div><div class="stat-label">失败 run</div></div>
        <div class="stat-card"><div class="stat-value">{{ summary.totals.affected_clients }}</div><div class="stat-label">受影响设备</div></div>
        <div class="stat-card"><div class="stat-value">{{ summary.totals.avg_failed_duration_ms }}ms</div><div class="stat-label">失败平均耗时</div></div>
      </div>

      <!-- 告警面板 -->
      <el-card v-if="summary.alerts && summary.alerts.length" shadow="never" style="margin-top: 16px">
        <template #header>阈值告警</template>
        <el-alert
          v-for="(a, i) in summary.alerts"
          :key="i"
          style="margin-bottom: 8px"
          :type="alertType(a.level)"
          :title="a.message"
          show-icon
          :closable="false"
        />
      </el-card>

      <!-- 每日趋势 -->
      <el-card shadow="never" style="margin-top: 16px">
        <template #header>每日失败趋势（失败红色段 / 成功绿色段）</template>
        <div class="trend-chart">
          <div v-for="d in trendData" :key="d.date" class="trend-col" :title="`${d.date}: 总 ${d.runs}，失败 ${d.failed}，成功 ${d.success}`">
            <div class="trend-bars">
              <div class="trend-bar fail" :style="{ height: barHeight(d.failed) }"></div>
              <div class="trend-bar ok" :style="{ height: barHeight(d.success) }"></div>
            </div>
            <div class="trend-label">{{ d.date.slice(5) }}</div>
          </div>
        </div>
      </el-card>

      <!-- 分布 -->
      <el-row :gutter="16" style="margin-top: 16px">
        <el-col :span="12">
          <el-card shadow="never">
            <template #header>按阶段失败分布</template>
            <el-table :data="summary.by_stage" border stripe size="small">
              <el-table-column prop="stage" label="阶段" />
              <el-table-column prop="count" label="失败样本" width="110" />
            </el-table>
          </el-card>
        </el-col>
        <el-col :span="12">
          <el-card shadow="never">
            <template #header>按失败类型分布</template>
            <el-table :data="summary.by_failure_type" border stripe size="small">
              <el-table-column prop="failure_type" label="失败类型" />
              <el-table-column prop="count" label="失败样本" width="110" />
            </el-table>
          </el-card>
        </el-col>
      </el-row>

      <!-- Top 根因 + 处置建议 -->
      <el-card shadow="never" style="margin-top: 16px">
        <template #header>Top 根因与处置建议</template>
        <el-empty v-if="!summary.by_cause.length" description="暂无根因样本" />
        <el-table v-else :data="summary.by_cause" border stripe size="small">
          <el-table-column prop="cause_id" label="根因" width="220">
            <template #default="{ row }">{{ causeMeta(row.cause_id).label }}</template>
          </el-table-column>
          <el-table-column prop="count" label="样本数" width="90" />
          <el-table-column label="处置建议">
            <template #default="{ row }">
              <div style="white-space: pre-line">{{ causeMeta(row.cause_id).advice }}</div>
              <router-link
                v-if="causeMeta(row.cause_id).flagKey"
                :to="{ path: '/feature-flags', query: { key: causeMeta(row.cause_id).flagKey } }"
                style="font-size: 12px"
              >
                前往功能开关设置 {{ causeMeta(row.cause_id).flagKey }}
              </router-link>
            </template>
          </el-table-column>
        </el-table>
      </el-card>

      <!-- 环境维度 -->
      <el-card shadow="never" style="margin-top: 16px">
        <template #header>环境维度</template>
        <el-descriptions :column="3" border size="small">
          <el-descriptions-item label="磁盘不足样本">{{ summary.env.disk_low_count }}（占比 {{ (summary.env.disk_low_ratio * 100).toFixed(2) }}%）</el-descriptions-item>
          <el-descriptions-item label="sidecar 异常样本">{{ summary.env.sidecar_down_count }}</el-descriptions-item>
        </el-descriptions>
      </el-card>

      <!-- 失败样本明细 -->
      <el-card shadow="never" style="margin-top: 16px">
        <template #header>
          <div style="display: flex; justify-content: space-between; align-items: center">
            <span>失败样本明细（近 {{ days }} 天，共 {{ samples.total }} 条）</span>
            <div>
              <el-select v-model="filters.failure_type" placeholder="失败类型" clearable style="width: 150px; margin-right: 8px" @change="loadSamples">
                <el-option v-for="t in failureTypes" :key="t" :label="t" :value="t" />
              </el-select>
              <el-select v-model="filters.cause_id" placeholder="根因" clearable style="width: 180px" @change="loadSamples">
                <el-option v-for="c in summary.by_cause" :key="c.cause_id" :label="causeMeta(c.cause_id).label" :value="c.cause_id" />
              </el-select>
            </div>
          </div>
        </template>
        <el-table :data="samples.items" border stripe size="small" @row-click="openDetail">
          <el-table-column prop="diag_date" label="日期" width="100" />
          <el-table-column prop="client_id" label="设备" width="100" />
          <el-table-column prop="pipeline" label="流水线" min-width="150" />
          <el-table-column prop="stage" label="阶段" width="110" />
          <el-table-column prop="failure_type" label="失败类型" width="110" />
          <el-table-column prop="severity" label="严重度" width="90" />
          <el-table-column label="根因" min-width="160">
            <template #default="{ row }">{{ causeMeta(row.cause_id).label }}</template>
          </el-table-column>
          <el-table-column prop="duration_ms" label="耗时(ms)" width="100" />
        </el-table>
      </el-card>
    </template>

    <!-- 样本详情抽屉 -->
    <el-drawer v-model="detailVisible" title="失败样本详情" size="55%">
      <template v-if="current">
        <el-descriptions :column="2" border size="small">
          <el-descriptions-item label="run_id">{{ current.run_id }}</el-descriptions-item>
          <el-descriptions-item label="日期">{{ current.diag_date }}</el-descriptions-item>
          <el-descriptions-item label="流水线">{{ current.pipeline }}</el-descriptions-item>
          <el-descriptions-item label="状态">{{ current.status }}</el-descriptions-item>
          <el-descriptions-item label="阶段">{{ current.stage }}</el-descriptions-item>
          <el-descriptions-item label="失败类型">{{ current.failure_type }}</el-descriptions-item>
          <el-descriptions-item label="严重度">{{ current.severity }}</el-descriptions-item>
          <el-descriptions-item label="可恢复性">{{ current.recoverability }}</el-descriptions-item>
          <el-descriptions-item label="根因">{{ causeMeta(current.cause_id).label }}</el-descriptions-item>
          <el-descriptions-item label="耗时(ms)">{{ current.duration_ms }}</el-descriptions-item>
        </el-descriptions>
        <el-card shadow="never" style="margin-top: 12px">
          <template #header>处置建议（checks / advice）</template>
          <div style="white-space: pre-line">{{ causeMeta(current.cause_id).checksAndAdvice }}</div>
        </el-card>
        <el-card shadow="never" style="margin-top: 12px">
          <template #header>
            <div style="display: flex; justify-content: space-between; align-items: center">
              <span>环境白名单</span>
              <el-button size="small" @click="copyDiagnostics">复制诊断信息</el-button>
            </div>
          </template>
          <pre style="font-size: 12px; margin: 0">{{ current.envJson }}</pre>
        </el-card>
      </template>
    </el-drawer>
  </div>
</template>

<script>
import { getDiagnosticsSummary, getDiagnosticsSamples } from '../api/diagnostics'

// causeId → 展示信息与处置建议（与桌面端 root-cause-map 规则对齐的运营侧呈现）
const CAUSE_META = {
  disk_full: { label: '磁盘空间不足', advice: '提示用户清理磁盘空间；必要时调整输出目录到空闲盘', flagKey: 'story2video.outputDirPolicy' },
  sidecar_unavailable: { label: 'Python sidecar 未运行或端口被占用', advice: '检查后端服务（8002/8013）健康与端口占用', flagKey: 'story2video.sidecarHealthCheck' },
  sidecar_stale_instance: { label: 'sidecar 运行的是旧代码（契约漂移）', advice: '重启 sidecar 加载最新代码；本地验收用独立端口', flagKey: 'story2video.sidecarHealthCheck' },
  ffmpeg_media_error: { label: 'ffmpeg 编码/解码失败', advice: '校验媒体资源与 ffmpeg 二进制；确认编码超时按输入规模估算', flagKey: 'story2video.mediaToolsCheck' },
  provider_timeout: { label: '服务商请求超时', advice: '稍后重试；频繁超时建议切换模型或检查服务商状态', flagKey: 'modelProvider.anomalySwitch' },
  provider_rate_limited: { label: '服务商限流或配额不足', advice: '等待限流窗口/额度恢复，或升级套餐', flagKey: 'modelProvider.rateLimitNotice' },
  provider_not_configured: { label: '服务商未配置 API Key 或模型路由错误', advice: '在「模型设置」确认 API Key 与模型路由', flagKey: 'modelProvider.configCheck' },
  network_error: { label: '网络连接失败', advice: '检查本机网络与代理可达性后重试', flagKey: null },
  content_policy: { label: '内容触发审核策略', advice: '按提示改写该场景为更抽象、非露骨的视觉描述后重试', flagKey: null },
  input_limits: { label: '输入超出资源上限', advice: '调整输入参数在允许范围内后重试', flagKey: null },
  validation_failed: { label: '参数校验失败', advice: '修正输入后重试', flagKey: null },
  unknown: { label: '未能确定具体根因', advice: '携带诊断摘要与日志反馈给开发；外部服务异常可稍后重试', flagKey: null },
}

function metaOf (causeId) {
  const key = causeId && CAUSE_META[causeId] ? causeId : 'unknown'
  const m = CAUSE_META[key]
  return {
    ...m,
    checksAndAdvice: `${m.label}\n\n检查：\n- 定位出错阶段与错误码\n- 核对环境（磁盘/服务/网络）\n\n建议：${m.advice}`,
  }
}

export default {
  name: 'Diagnostics',
  data () {
    return {
      days: 30,
      loading: false,
      summary: null,
      samples: { total: 0, items: [] },
      filters: { failure_type: '', cause_id: '' },
      detailVisible: false,
      current: null,
    }
  },
  computed: {
    trendData () {
      return this.summary?.by_date || []
    },
    failureTypes () {
      return (this.summary?.by_failure_type || []).map(x => x.failure_type)
    },
    maxTrend () {
      return Math.max(1, ...this.trendData.map(d => d.runs || 0))
    },
  },
  methods: {
    fmt (v) {
      return Number(v || 0).toLocaleString()
    },
    barHeight (v) {
      return Math.max(2, Math.round(((v || 0) / this.maxTrend) * 140)) + 'px'
    },
    alertType (level) {
      return { HIGH: 'error', MEDIUM: 'warning', LOW: 'info' }[level] || 'info'
    },
    causeMeta (id) {
      return metaOf(id)
    },
    async load () {
      this.loading = true
      try {
        this.summary = await getDiagnosticsSummary(this.days)
        await this.loadSamples()
      } catch (e) {
        this.$message?.error?.('加载失败：' + (e?.response?.data?.detail || e.message))
      } finally {
        this.loading = false
      }
    },
    async loadSamples () {
      try {
        const params = { days: this.days, limit: 50 }
        if (this.filters.failure_type) params.failure_type = this.filters.failure_type
        if (this.filters.cause_id) params.cause_id = this.filters.cause_id
        const data = await getDiagnosticsSamples(params)
        this.samples = data
      } catch (e) {
        this.$message?.error?.('样本加载失败：' + (e?.response?.data?.detail || e.message))
      }
    },
    openDetail (row) {
      this.current = {
        ...row,
        envJson: JSON.stringify(row.env || {}, null, 2),
      }
      this.detailVisible = true
    },
    async copyDiagnostics () {
      try {
        await navigator.clipboard.writeText(JSON.stringify({
          run_id: this.current.run_id,
          pipeline: this.current.pipeline,
          stage: this.current.stage,
          failure_type: this.current.failure_type,
          severity: this.current.severity,
          recoverability: this.current.recoverability,
          cause_id: this.current.cause_id,
          duration_ms: this.current.duration_ms,
          env: this.current.env,
        }, null, 2))
        this.$message?.success?.('诊断信息已复制')
      } catch (e) {
        this.$message?.error?.('复制失败')
      }
    },
  },
  mounted () {
    this.load()
  },
}
</script>

<style scoped>
.stat-grid { display: grid; grid-template-columns: repeat(5, 1fr); gap: 12px; }
.stat-card { background: #fff; border: 1px solid #ebeef5; border-radius: 8px; padding: 16px; text-align: center; }
.stat-value { font-size: 24px; font-weight: 600; }
.stat-label { color: #909399; font-size: 12px; margin-top: 4px; }
.trend-chart { display: flex; align-items: flex-end; gap: 4px; height: 160px; overflow-x: auto; }
.trend-col { display: flex; flex-direction: column; align-items: center; min-width: 28px; }
.trend-bars { display: flex; align-items: flex-end; gap: 2px; height: 140px; }
.trend-bar { width: 10px; border-radius: 2px 2px 0 0; }
.trend-bar.ok { background: #67c23a; }
.trend-bar.fail { background: #f56c6c; }
.trend-label { font-size: 10px; color: #909399; margin-top: 4px; }
</style>
