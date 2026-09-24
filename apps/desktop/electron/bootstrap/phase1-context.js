// @ts-check
/**
 * Phase 1: DI 容器实例提取 + 模块单例初始化
 *
 * 从 bootstrap.js createAppContext 拆出：
 * - 所有 container.get(...) 调用
 * - 模块单例 + 副作用（seedDefaults / startMonitoring / registerIpcHandlers）
 * - scheduler / BatchManager / offlineManager 的 setTaskQueue 接线
 * - ModelProviderManager 接线
 * - 平台配置 / 敏感词 / 横切服务加载
 *
 * 红线：不包含 taskQueue.setExecutor 闭包（依赖 getMainWin + publisherRouter，高风险，保留在 createAppContext）
 * 红线：不包含 wireTaskQueueEvents 调用（依赖 getMainWin，保留在 createAppContext）
 *
 * 验收标准 BUGFIX-PLAN Bug-1: phase 文件 <= 80 行（注释/空行不计）
 */
const log = require('../services/logger')
const { getConfigPath } = require('../services/config-resolver')
const pythonBridge = require('../services/python-bridge')
const AccountManager = require('../publishers/account-manager')
const scheduler = require('../services/scheduler')
const history = require('../services/publish-history')
const autoUpdater = require('../services/auto-updater')
const firstRun = require('../services/first-run')
const BatchManager = require('../services/batch-manager')
/** @typedef {new (options: {orchestratorUrl: string, store: object}) => {registerIpcHandlers(): void}} CloudPublisherConstructor */
// CJS/ESM interop：兼容真实模块与 vitest mock
/** @type {CloudPublisherConstructor | {default: CloudPublisherConstructor}} */
const _CloudPublisherModule = require('../services/cloud-publisher')
const CloudPublisher = 'default' in _CloudPublisherModule
  ? _CloudPublisherModule.default
  : _CloudPublisherModule
const CONTEXT_GROUP_KEYS = ['infra', 'services', 'windows', 'pipelines']

/**
 * @param {unknown} value
 * @returns {string}
 */
function errorMessage(value) {
  return value instanceof Error ? value.message : String(value)
}

function getContextGroups(target) {
  return CONTEXT_GROUP_KEYS.map((key) => target[key])
}

/**
 * 为分组 context 对象包装过渡期兼容 Proxy。
 *
 * 旧代码：context.store 仍可用（Proxy 转发到 context.infra.store）
 * 新代码：context.infra.store / context.services.scheduler / context.windows.webviewManager / context.pipelines.viralEngine
 *
 * 行为：
 * - get：先查顶层（组名/松散属性），再查各子组（向后兼容 context.store → context.infra.store）
 * - set：若属性已是某子组自有属性则更新该子组，否则落到顶层（如 keywordPersistTimer）
 * - has：顶层或任一子组含该属性即 true
 * - ownKeys / getOwnPropertyDescriptor：返回 4 个组名 + 全部字段名（兼容 Object.keys 遍历与 hasOwnProperty 检查）
 *
 * @param {object} grouped - { infra, services, windows, pipelines }
 * @returns {object} Proxy 包装后的 context
 */
function createGroupedContextProxy(grouped) {
  return new Proxy(grouped, {
    get(target, prop) {
      if (prop in target) return target[prop]
      for (const g of getContextGroups(target)) {
        if (prop in g) return g[prop]
      }
      return undefined
    },
    set(target, prop, value) {
      for (const g of getContextGroups(target)) {
        if (Object.prototype.hasOwnProperty.call(g, prop)) { g[prop] = value; return true }
      }
      target[prop] = value
      return true
    },
    has(target, prop) {
      if (prop in target) return true
      for (const g of getContextGroups(target)) {
        if (prop in g) return true
      }
      return false
    },
    ownKeys(target) {
      const keys = new Set(Object.keys(target))
      for (const g of getContextGroups(target)) {
        Object.keys(g).forEach((k) => keys.add(k))
      }
      return Array.from(keys)
    },
    getOwnPropertyDescriptor(target, prop) {
      if (Object.prototype.hasOwnProperty.call(target, prop)) {
        return Object.getOwnPropertyDescriptor(target, prop)
      }
      for (const g of getContextGroups(target)) {
        if (Object.prototype.hasOwnProperty.call(g, prop)) {
          return { configurable: true, enumerable: true, writable: true, value: g[prop] }
        }
      }
      return undefined
    },
  })
}

/**
 * 从 DI 容器提取所有实例 + 运行模块单例副作用
 * @param {object} container - DI 容器实例
 * @returns {object} context 对象（含 52 字段，按 infra/services/windows/pipelines 分组 + Proxy 兼容层）
 */
function extractContext(container) {
  const LicenseManager = require('../services/license-manager')

  // ─── 基础设施实例（DI 容器获取）───
  const authViewManager = container.get('authViewManager')
  const rpaViewManager = container.get('rpaViewManager')
  const webviewManager = container.get('webviewManager')
  if (webviewManager && typeof webviewManager.setAccountManager === 'function') {
    webviewManager.setAccountManager(AccountManager)
  }
  const callbackServer = container.get('callbackServer')
  const qrCodeLogin = container.get('qrCodeLogin')
  const store = container.get('store')
  if (qrCodeLogin && typeof qrCodeLogin.setAccountManager === 'function') {
    qrCodeLogin.setAccountManager(AccountManager)
  }
  const contentIntelligence = container.get('contentIntelligence')
  const publishImpactTracker = container.get('publishImpactTracker')
  const keywordMonitor = container.get('keywordMonitor')
  const providerManager = container.get('providerManager')
  const oauthManager = container.get('oauthManager')
  const batchManager = container.get('batchManager')
  const urlCollector = container.get('urlCollector')
  const hotTopicsService = container.get('hotTopicsService')
  const viralEngine = container.get('viralEngine')
  const commentManager = container.get('commentManager')
  const proxyPool = container.get('proxyPool')
  const analyticsService = container.get('analyticsService')
  const usageTracker = container.get('usageTracker')

  // ─── 模块单例 + 副作用 ───
  const _PublishAlert = require('../services/publish-alert') // side effects on require
  const templateManager = container.get('templateManager')
  templateManager.seedDefaults()
  const rewriteStrategyManager = container.get('rewriteStrategyManager')
  const rewriteHardConstraintManager = container.get('rewriteHardConstraintManager')
  const rewriteEngineService = container.get('rewriteEngineService')
  const knowledgeLibraryService = container.get('knowledgeLibraryService')
  const patternExtractionService = container.get('patternExtractionService')
  const performanceRecrawlService = container.get('performanceRecrawlService')
  const patternAttributionService = container.get('patternAttributionService')
  const licenseManager = LicenseManager.getInstance()
  const aiWriter = container.get('aiWriter')
  const offlineManager = require('../services/offline-manager')
  offlineManager.startMonitoring()
  const publishMonitor = require('../services/publish-monitor')
  const systemTray = require('../services/system-tray')
  const hotkeys = require('../services/hotkeys')
  systemTray.registerIpcHandlers()

  // ─── 任务队列接线（不含 setExecutor，保留在 createAppContext）───
  const taskQueue = container.get('taskQueue')
  scheduler.setTaskQueue(taskQueue)
  BatchManager.setTaskQueue(taskQueue)
  offlineManager.setTaskQueue(taskQueue)

  // ─── 其他 DI 实例 ───
  const _aggregatorBridge = container.get('aggregatorBridge')
  const publisherRouter = container.get('publisherRouter')
  const renderEngine = container.get('renderEngine')
  const compositionManager = container.get('compositionManager')
  const aiGenerator = container.get('aiGenerator')
  if (rewriteEngineService && typeof rewriteEngineService.setAiGenerator === 'function') {
    rewriteEngineService.setAiGenerator(aiGenerator)
  }
  const assetGenerator = container.get('assetGenerator')
  const videoEngine = container.get('videoEngine')
  const pipelineEngine = container.get('pipelineEngine')
  const runStateStore = container.get('runStateStore')
  const story2videoBatchQueue = container.get('story2videoBatchQueue')
  const projectService = container.get('projectService')
  const boardService = container.get('boardService')
  const contactSheetService = container.get('contactSheetService')
  const approvalGateService = container.get('approvalGateService')
  const executionRecorder = container.get('executionRecorder')
  const filmEngineeringService = container.get('filmEngineeringService')
  const fullAutoPipeline = container.get('fullAutoPipeline')

  // ─── ModelProviderManager + ProviderRouter 接线 ───
  const { ModelProviderManager } = require('../services/model-provider-manager')
  const { ProviderRouter } = require('../services/adapters/_base/router')
  const modelProviderManager = new ModelProviderManager(store)
  // 注入统一调度网关：provider 配置的每分钟连接次数/5小时限额 → ApiUsageGovernor 预算
  const apiUsageGovernor = container.get('apiUsageGovernor')
  if (modelProviderManager && typeof modelProviderManager.setGovernor === 'function') {
    modelProviderManager.setGovernor(apiUsageGovernor)
  }
  // 运营后台 → 桌面端运行时同步（目录拉取 + applyCatalog + 启动自动同步）
  const { OpsCenterSync } = require('../services/ops-center-sync')
  const opsCenterSync = new OpsCenterSync({ store, modelProviderManager, log })
  // 版本发布策略（强制/灰度/最低版本）→ auto-updater
  if (opsCenterSync && typeof opsCenterSync.setUpdatePolicyConsumer === 'function') {
    opsCenterSync.setUpdatePolicyConsumer((policy) => autoUpdater.applyPolicy(policy))
  }
  // 启动即水合已持久化策略，避免首次 update:check 在同步完成前绕过策略（审查 W）
  if (opsCenterSync && typeof opsCenterSync.getUpdatePolicy === 'function' && autoUpdater.applyPolicy) {
    autoUpdater.applyPolicy(opsCenterSync.getUpdatePolicy())
  }
  // 官方内容模板库运行时下发 → TemplateManager.applyRemote（先注入再启动自动同步）
  if (opsCenterSync && typeof opsCenterSync.setTemplateManager === 'function') {
    opsCenterSync.setTemplateManager(templateManager)
  }
  // 关键词监测目录运行时下发 → KeywordMonitor.applyRemoteWatchlist
  if (opsCenterSync && typeof opsCenterSync.setKeywordMonitor === 'function') {
    opsCenterSync.setKeywordMonitor(keywordMonitor)
  }
  // 改写策略运行时下发 → RewriteStrategyManager.applyRemote（先注入再启动自动同步）
  if (opsCenterSync && typeof opsCenterSync.setRewriteStrategyManager === 'function') {
    opsCenterSync.setRewriteStrategyManager(rewriteStrategyManager)
  }
  // 改写硬约束运行时下发（rewrite-hard-constraints，2026-09-19）→ 默认版本注入引擎
  if (opsCenterSync && typeof opsCenterSync.setRewriteHardConstraintManager === 'function') {
    opsCenterSync.setRewriteHardConstraintManager(rewriteHardConstraintManager)
  }
  // 硬约束运行中更新 → 引擎缓存失效（审查 M2：sync 后新约束立即生效，无需重启）
  if (opsCenterSync && typeof opsCenterSync.setRewriteEngineService === 'function') {
    opsCenterSync.setRewriteEngineService(rewriteEngineService)
  }
  if (opsCenterSync && typeof opsCenterSync.autoSyncOnStart === 'function') {
    opsCenterSync.autoSyncOnStart()
  }
  // 运营功能开关提供者（4K 能力开关等运行时下发 → 引擎惰性读取）
  const { setFeatureFlagProvider } = require('../core/container.setup')
  if (opsCenterSync && typeof opsCenterSync.getFeatureFlag === 'function' && typeof setFeatureFlagProvider === 'function') {
    setFeatureFlagProvider((key) => opsCenterSync.getFeatureFlag(key))
  }
  // 模型调用用量脱敏上报（P0 第二批）：聚合 model_provider_logs → ops-center /usage/ingest
  const { UsageReporter } = require('../services/usage-reporter')
  const usageReporter = new UsageReporter({
    store,
    log,
    getOpsCenterAuth: () => {
      if (!opsCenterSync || typeof opsCenterSync.getConfig !== 'function') return null
      const cfg = opsCenterSync.getConfig()
      if (!cfg.url || !cfg.apiKeyConfigured || typeof opsCenterSync.getCatalogApiKey !== 'function') return null
      return { url: cfg.url, apiKey: opsCenterSync.getCatalogApiKey() }
    },
    getClientId: () => {
      try {
        const crypto = require('crypto')
        const { app: electronApp } = require('electron')
        return crypto.createHash('sha256').update(String(electronApp.getPath('userData') || '')).digest('hex').slice(0, 16)
      } catch (e) {
        log.warn('UsageReporter', 'getClientId failed: ' + e.message)
        return ''
      }
    },
    // P1：调度可观测性（governor 排队/冷却计数，取走即清零）
    getSchedulerMetrics: () => {
      try {
        if (apiUsageGovernor && typeof apiUsageGovernor.takeObservabilitySnapshot === 'function') {
          return apiUsageGovernor.takeObservabilitySnapshot()
        }
      } catch (e) {
        log.warn('UsageReporter', 'getSchedulerMetrics failed: ' + e.message)
      }
      return {}
    },
  })
  usageReporter.start()
  // 发布指标脱敏上报（P1-3）：聚合 publish-history → ops-center /publish/ingest
  const { PublishReporter } = require('../services/publish-reporter')
  const publishReporter = new PublishReporter({
    store,
    log,
    getOpsCenterAuth: () => {
      if (!opsCenterSync || typeof opsCenterSync.getConfig !== 'function') return null
      const cfg = opsCenterSync.getConfig()
      if (!cfg.url || !cfg.apiKeyConfigured || typeof opsCenterSync.getCatalogApiKey !== 'function') return null
      return { url: cfg.url, apiKey: opsCenterSync.getCatalogApiKey() }
    },
    getHistory: () => history,
    getClientId: () => {
      try {
        const crypto = require('crypto')
        const { app: electronApp } = require('electron')
        return crypto.createHash('sha256').update(String(electronApp.getPath('userData') || '')).digest('hex').slice(0, 16)
      } catch (e) { return '' }
    },
  })
  publishReporter.start()
  // 视频创作失败诊断脱敏上报（P0 落地运营后台）：run 终结入队 → 30min 周期上报 /diagnostics/ingest
  const { DiagnosticsReporter } = require('../services/diagnostics-reporter')
  const diagnosticsReporter = new DiagnosticsReporter({
    store,
    log,
    getOpsCenterAuth: () => {
      if (!opsCenterSync || typeof opsCenterSync.getConfig !== 'function') return null
      const cfg = opsCenterSync.getConfig()
      if (!cfg.url || !cfg.apiKeyConfigured || typeof opsCenterSync.getCatalogApiKey !== 'function') return null
      return { url: cfg.url, apiKey: opsCenterSync.getCatalogApiKey() }
    },
    getClientId: () => {
      try {
        const crypto = require('crypto')
        const { app: electronApp } = require('electron')
        return crypto.createHash('sha256').update(String(electronApp.getPath('userData') || '')).digest('hex').slice(0, 16)
      } catch (e) { return '' }
    },
  })
  diagnosticsReporter.start()
  if (pipelineEngine && typeof pipelineEngine.setRunFinalizedHook === 'function') {
    pipelineEngine.setRunFinalizedHook((run) => {
      try { diagnosticsReporter.enqueue(run) } catch (e) { log.warn('DiagnosticsReporter', 'hook error: ' + (e && e.message ? e.message : String(e))) }
    })
  }
  // 由 Phase 3 在 SQLite WASM 与 Store 均就绪后初始化，避免重启时读取到空数据库。
  // 创建 ProviderRouter（不注入 logHandler，避免与 callAdapter 内部日志双写）
  // callAdapter 内部已通过 _writeLog 统一记录到 model_provider_logs 表
  // router 的 logHandler 功能保留为可选扩展（测试中可单独验证）
  const providerRouter = new ProviderRouter(modelProviderManager)
  // 热门选题 LLM 分类兜底（方案C）：general 条目批量分类；未配置模型/调用失败时服务内静默降级
  if (hotTopicsService && typeof hotTopicsService.setLlmClassify === 'function') {
    const { createLlmTopicClassifier } = require('../services/hot-topics/llm-classifier')
    hotTopicsService.setLlmClassify(createLlmTopicClassifier({ modelProviderManager, log }))
  }
  if (aiGenerator && aiGenerator.setModelProviderManager) {
    aiGenerator.setModelProviderManager(modelProviderManager)
  }
  if (aiGenerator && aiGenerator.setRouter) {
    aiGenerator.setRouter(providerRouter)
  }
  if (aiGenerator && aiGenerator.setGovernor) {
    aiGenerator.setGovernor(container.get('apiUsageGovernor'))
  }
  // 注入 AIGenerator 到 ContentIntelligence（智能标签建议 LLM 生成）
  if (contentIntelligence && typeof contentIntelligence.setAIGenerator === 'function') {
    contentIntelligence.setAIGenerator(aiGenerator)
  }
  const story2videoProjectService = container.get('story2videoProjectService')
  story2videoProjectService.modelProviderManager = modelProviderManager
  const ttsVoiceCloneService = container.get('ttsVoiceCloneService')
  ttsVoiceCloneService.modelProviderManager = modelProviderManager
  // 启动前模型能力前置校验（pipeline-model-preflight）：流水线启动按能力映射统一拦截
  pipelineEngine.modelProviderManager = modelProviderManager

  // ─── 提示词评估服务（PromptEval，v1 图片）───
  const { app: electronAppForPromptEval } = require('electron')
  const { createPromptEvalService } = require('../services/prompt-eval')
  const { createModelProviderEvaluator } = require('../services/prompt-eval/evaluator')
  const promptEvalUserDataDir = electronAppForPromptEval && typeof electronAppForPromptEval.getPath === 'function'
    ? electronAppForPromptEval.getPath('userData')
    : require('path').join(require('os').tmpdir(), 'multi-publish-prompt-eval')
  // 评估器依赖真实 ModelProviderManager；缺失时传 null（引擎在调用时 fail closed 返回 EVAL_LLM_UNAVAILABLE）
  const promptEvalEvaluator = modelProviderManager &&
    typeof modelProviderManager.getDefault === 'function' &&
    typeof modelProviderManager.callAdapter === 'function'
    ? createModelProviderEvaluator({ manager: modelProviderManager, log })
    : null
  const promptEvalService = createPromptEvalService({
    userDataDir: promptEvalUserDataDir,
    evaluator: promptEvalEvaluator,
    log,
  })

  // ─── 提示词引擎自进化信号采集器（feature flag 控制，默认关闭）───
  // 设计参考 01-docs/prompt-engine-evolution-design.md（v2，P0 反馈管道）
  const evolutionEnabled = process.env.MP_EVOLUTION_ENABLED === '1'
  let signalCollector = null
  if (evolutionEnabled) {
    const { createSignalCollector } = require('../services/prompt-evolution/signal-collector')
    const evolutionLogDir = electronAppForPromptEval && typeof electronAppForPromptEval.getPath === 'function'
      ? require('path').join(electronAppForPromptEval.getPath('userData'), 'generation-logs')
      : require('path').join(require('os').tmpdir(), 'multi-publish-evolution')
    signalCollector = createSignalCollector({
      logDir: evolutionLogDir,
      config: { collection: 'enabled', userHashSalt: process.env.MP_EVOLUTION_SALT || 'mp-evolution-default-salt' },
      log,
    })
    // 启动时执行一次 30 天清理（C2 修复：cleanup 需要有生产调用点）
    try {
      signalCollector.cleanup()
    } catch (e) {
      log.warn('SignalCollector', '启动清理失败: ' + (e && e.message))
    }
  }

  // ─── 提示词引擎自进化记忆库 + 治理（P1b，feature flag 控制，默认关闭）───
  // 设计参考 openspec/changes/prompt-engine-evolution-p1b-memory
  // 记忆库是检索（fingerprint.findSimilarTemplates）的上游数据源；治理层提供门禁/状态机/回滚/配额。
  let promptMemory = null
  let governance = null
  if (evolutionEnabled) {
    const { createPromptMemory } = require('../services/prompt-evolution/prompt-memory')
    const { createGovernance } = require('../services/prompt-evolution/governance')
    const evolutionLibraryRoot = electronAppForPromptEval && typeof electronAppForPromptEval.getPath === 'function'
      ? require('path').join(electronAppForPromptEval.getPath('userData'), 'prompt-library')
      : require('path').join(require('os').tmpdir(), 'multi-publish-prompt-library')
    promptMemory = createPromptMemory({
      libraryRoot: evolutionLibraryRoot,
      config: {},
      statsProvider: (_templateId) => {
        // V0：按 templateVersion 聚合的生产数据源依赖 P1 recordGeneration 接线 + P1a score-log；
        // 当前以 signalCollector 的 engine 级统计近似（无 score-log 时返回 null，回滚判定不触发）。
        try {
          if (signalCollector && typeof signalCollector.getStats === 'function') {
            return signalCollector.getStats({ engine: 'image' })[0] || null
          }
        } catch (_e) { /* 数据源不可用，回滚判定不触发 */ }
        return null
      },
      log,
    })
    try {
      promptMemory.load()
    } catch (e) {
      log.warn('PromptMemory', '记忆库加载失败: ' + (e && e.message))
    }
    governance = createGovernance({
      config: {},
      memory: promptMemory,
      statsProvider: (_templateId) => null,
      log,
    })
    // CCG 评审修复：接入 governance.runGates 门禁（6 规则），解决 governance↔memory 循环依赖
    if (promptMemory && typeof promptMemory._setGate === 'function') {
      promptMemory._setGate((tpl) => governance.runGates(tpl))
    }
  }

  // ─── 平台配置 + 敏感词 + 横切服务 ───
  const PlatformConfig = require('@multi-publish/shared-utils/src/platform-config')
  const BACKEND_PLATFORMS = new Set(['youtube', 'tiktok', 'twitter'])
  const SensitiveFilter = require('@multi-publish/shared-utils/src/sensitive-filter')
  const _sensitiveFilter = SensitiveFilter.createWithBuiltin()
  const _dataSync = container.get('dataSync')
  const _platformConfig = (() => {
    try {
      return new PlatformConfig(getConfigPath('platforms.yaml'))
    } catch (e) {
      log.warn('App', 'Failed to load platform config: ' + errorMessage(e))
      return null
    }
  })()
  // 平台发布元数据运行时覆盖（运营后台下发 → PlatformConfig.applyRemote）
  if (opsCenterSync && typeof opsCenterSync.setPlatformConfig === 'function') {
    opsCenterSync.setPlatformConfig(_platformConfig)
  }
  const _chunkedUploader = container.get('chunkedUploader')
  const splitterBridge = container.get('splitterBridge')
  const promptBridge = container.get('promptBridge')
  // BYOK：提示词引擎的 LLM 由桌面「模型设置」默认 LLM 注入（引擎不再使用服务端 key 兜底）
  promptBridge.modelProviderManager = modelProviderManager
  const serviceBus = container.get('serviceBus')
  const pluginRegistry = container.get('pluginRegistry')
  const riskSuspender = container.get('riskSuspender')

  // ─── 分组返回 + 过渡期 Proxy 兼容层 ───
  // 旧消费者 context.store 仍可用（Proxy 转发到 context.infra.store）
  // 新代码可用 context.infra.store / context.services.scheduler / context.windows.webviewManager / context.pipelines.viralEngine
  return createGroupedContextProxy({
    infra: {
      container, store, taskQueue, pythonBridge,
      _platformConfig, _sensitiveFilter, _dataSync,
      BACKEND_PLATFORMS, _chunkedUploader,
    },
    services: {
      scheduler, callbackServer, keywordMonitor, analyticsService, usageTracker,
      AccountManager, history, autoUpdater, hotkeys, firstRun,
      systemTray, offlineManager, publishMonitor,
      templateManager, licenseManager, aiWriter,
      rewriteStrategyManager, rewriteHardConstraintManager, rewriteEngineService,
      knowledgeLibraryService, patternExtractionService,
      performanceRecrawlService, patternAttributionService,
      renderEngine, compositionManager, aiGenerator, assetGenerator, videoEngine, pipelineEngine,
      story2videoBatchQueue, runStateStore,
      modelProviderManager, providerRouter, providerManager, opsCenterSync, usageReporter,
      _aggregatorBridge, publisherRouter, _PublishAlert, riskSuspender,
      splitterBridge, promptBridge, serviceBus, pluginRegistry,
      projectService, boardService, contactSheetService, approvalGateService,
      executionRecorder,
      filmEngineeringService,
      fullAutoPipeline,
      story2videoProjectService,
      promptEvalService,
      signalCollector,
      promptMemory,
      governance,
    },
    windows: {
      authViewManager, rpaViewManager, webviewManager, qrCodeLogin,
      oauthManager, batchManager, urlCollector, proxyPool,
      hotTopicsService,
    },
    pipelines: {
      viralEngine, commentManager, contentIntelligence,
      publishImpactTracker, CloudPublisher,
    },
  })
}

module.exports = { extractContext }
