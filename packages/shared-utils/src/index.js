/**
 * @multi-publish/shared-utils — 入口
 */
const TaskQueue = require('./task-queue')
const AggregatorBridge = require('./aggregator-bridge')

const formatAdapter = require('./format-adapter/index')
const coverProcessor = require('./cover-processor/index')

const PlatformConfig = require('./platform-config')
const SensitiveFilter = require('./sensitive-filter')
const mdConverter = require('./md-converter')

const ChunkedUploader = require('./chunked-uploader')
const ProxyPool = require('./proxy-pool')
const AnalyticsService = require('./analytics-service')

const DataSyncService = require('./data-sync')
const ContentQualityGate = require('./content-quality-gate')
const PublishIntervalGuard = require('./publish-interval-guard')
// 发布最小间隔策略单一真源（两档：账号档 + 同平台跨账号平台档）
const publishFrequencyPolicy = require('./publish-frequency-policy')
const { createScheduler } = require('./scheduler')
const publishHistory = require('./publish-history')
// 发布能力注册表（openspec/changes/publish-capability-registry）：15 平台发布
// 提交内容项单一真源（titleMode/内容限制/差异化字段/语义分类）。
const publishCapabilities = require('./publish-capabilities')

// 平台分类对照表读取层（P0-2，ARCH-REUSE-INTEGRATION R-1）：
// 回答「这个平台的分类 ID 是什么」，与 publishCapabilities 的「能不能设标题/描述」是不同问题。
const platformTaxonomy = require('./platform-taxonomy')
// 素材组合三级降级（P1-3，ARCH-REUSE-INTEGRATION R-3）：纯函数、零依赖。
// 返回**下标排列**而非素材克隆；三级顺序与「够 max 即停」是硬约束，详见模块头注。
const mediaCombination = require('./media-combination')

// 平台指标矩阵读取层（P1-1，ARCH-REUSE-INTEGRATION §4.2/§4.3）：
// 回答「这个平台能拿到哪些指标」——**参考数据，不是运行时真源**（真源是 account-metrics/adapters.js）。
// ⚠️ 只用于 UI 文案与测试交叉校验，**不得用于请求门控**：厂商矩阵是厂商的能力边界，
// 本仓实测能拿到的即使厂商未声明也应采信实测（见 reconcileObservation 的 undeclared-but-present）。
const platformMetricMatrix = require('./platform-metric-matrix')

module.exports = {
  TaskQueue,
  AggregatorBridge,
  formatAdapter,
  coverProcessor,
  PlatformConfig,
  SensitiveFilter,
  mdConverter,
  ChunkedUploader,
  ProxyPool,
  AnalyticsService,
  DataSyncService,
  ContentQualityGate,
  PublishIntervalGuard,
  publishFrequencyPolicy,
  createScheduler,
  // P1-10: 发布历史此前未从入口导出，导致调用方各自 require 内部路径、依赖治理无从下手
  publishHistory,
  publishCapabilities,
  platformTaxonomy,
  // 冲突解决：两侧都保留（P1-1 的矩阵 + P1-3 的组合），二者是独立新增的导出，无重叠
  platformMetricMatrix,
  mediaCombination,
}
