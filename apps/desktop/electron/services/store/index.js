// @ts-check
/**
 * Store — 统一数据存储 facade
 *
 * 物理拆分（Phase 3 Task 9）：
 *   - 基础设施（db 连接/生命周期/JSONL 迁移）→ BaseStore
 *   - 8 个功能域方法 → store/<domain>-store.js mixin
 *
 * 通过 Object.assign 把所有 mixin 方法注入 Store.prototype，
 * 保证 require('./store') 返回的接口与拆分前完全一致。
 *
 *   ┌──────────────┐
 *   │  BaseStore   │  init / _createTables / close / _safeJson / migrateFromJsonl
 *   └──────┬───────┘
 *          ▲
 *          │ extends
 *          │
 *   ┌──────┴───────┐  Object.assign(Store.prototype, ...)
 *   │    Store     │  ← account / history / scheduler / settings / callback
 *   └──────────────┘    batch / rate-limit / model-log
 */

const BaseStore = require('./base-store')
const accountMethods = require('./account-store')
const historyMethods = require('./history-store')
const schedulerMethods = require('./scheduler-store')
const settingsMethods = require('./settings-store')
const callbackMethods = require('./callback-store')
const batchMethods = require('./batch-store')
const rateLimitMethods = require('./rate-limit-store')
const publishDailyMethods = require('./publish-daily-store')
const modelLogMethods = require('./model-log-store')
const knowledgeLibraryMethods = require('./knowledge-library-store')
const viralPatternMethods = require('./viral-pattern-store')
const performanceLoopMethods = require('./performance-loop-store')
// 账号级作品数据回流（PRD-PUBLISH-HISTORY-ENGAGEMENT-2026-10-12）：
// 与 performance-loop-store 分开成两个 mixin，因为两条链的语义不同
// （一个按作品抓公开页、一个按账号调创作者后台），共用一张表但不共用状态字段。
const accountMetricsMethods = require('./account-metrics-store')

class Store extends BaseStore {}

// 把 8 个功能域的方法 mixin 到 Store.prototype
Object.assign(
  Store.prototype,
  accountMethods,
  historyMethods,
  schedulerMethods,
  settingsMethods,
  callbackMethods,
  batchMethods,
  rateLimitMethods,
  publishDailyMethods,
  modelLogMethods,
  knowledgeLibraryMethods,
  viralPatternMethods,
  performanceLoopMethods,
  accountMetricsMethods,
)

module.exports = Store
