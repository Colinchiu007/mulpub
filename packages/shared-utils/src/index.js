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
const { createScheduler } = require('./scheduler')
const publishHistory = require('./publish-history')

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
  createScheduler,
  // P1-10: 发布历史此前未从入口导出，导致调用方各自 require 内部路径、依赖治理无从下手
  publishHistory,
}
