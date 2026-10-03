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
}
