/**
 * 系统/工具相关 preload API（Phase 3.3 拆分自原 preload.js）
 *
 * 工厂函数：createSystemApi(ipcRenderer)
 *   - ipcRenderer 由调用方（preload/index.js）注入，便于测试 mock
 *   - 不在此处 require('electron')，保持子模块独立可测
 *
 * 涵盖方法（与原 preload.js 完全一致，不改变方法名/IPC 通道/参数顺序）：
 *   - 系统：getVersion / getPlatform
 *   - 自动更新：updateCheck / updateDownload / updateInstall / updateInstallNow / onUpdateStatus
 *   - 首次运行引导：firstRunCheck / onFirstRunStatus
 *   - 平台配置：platformList / platformGet / getPlatformDefinitions
 *   - 敏感词预检：sensitiveCheck / sensitiveReplace
 *   - 数据同步：syncAll / syncPlatform / syncCached
 *   - 通知：showNotification / onNotification
 *   - 回调服务器：onCallbackReceived
 *   - 离线模式：offlineStatus / offlineIsOffline / offlineCachedTasks / offlineAddToCache
 *               offlineClearCache / onOfflineRestored
 *   - 引导：onboardingComplete / onboardingGetSteps / onboardingStatus
 *   - 支付：paymentCreateOrder / paymentListOrders / paymentGetOrder / paymentComplete
 *           paymentSimulate / paymentCancel
 *   - 全局导航：onNavigate
 *   - 数据分析：analyticsOverview / analyticsPlatform / analyticsPlatforms
 *   - 快捷键：hotkeysList
 *   - 关键词监控：keywordStart / keywordStop / keywordStatus / keywordHistory / keywordStopAll
 *   - 代理：proxyAdd / proxyAddBatch / proxyList / proxyRemove / proxyTest / proxyTestAll
 *           proxyStatus / proxyGetNext / proxyReset / proxyRemoveDead
 *   - 上传：uploadChunked / uploadCancel
 *   - 模板：templateList / templateGet / templateAdd / templateUpdate / templateDelete
 *           templateListByCategory / templateGetPresets
 *   - 许可证：licenseInfo / licenseActivate / licenseDeactivate / licenseActivateTrial
 *             licenseHasFeature / licenseFeatures
 *   - Provider：providerList / providerCreate / providerUpdate / providerDelete / providerTest
 *               providerListUser / providerGetUser / providerSetUserKey / providerDeleteUserKey
 *   - AI 写作：aiListProviders / aiGetConfig / aiListModels / aiGenerate / aiTestConnection
 *              aiSaveConfig / onAIProgress / onAIComplete / onAIError
 *   - 视频处理：videoStatus / videoListProcessTypes / videoListAnalyzeTypes / videoListStockSources
 *               videoProcess / videoAnalyze / videoMixAudio / videoSearchStock / videoGenerateSubtitle
 *               onVideoProgress / onVideoComplete / onVideoError
 *   - 批量管理：batchCreate / batchExecute / batchSchedule / batchList / batchGet / batchDelete
 *               batchDuplicateArticle / onBatchProgress
 *   - 模型服务商：modelProviderList / modelProviderGet / modelProviderCreate / modelProviderUpdate
 *                 modelProviderDelete / modelProviderSetDefault / modelProviderGetDefault
 *                 modelProviderTest / modelProviderPresets / modelProviderIsConfigured
 *                 modelProviderLogs / modelProviderCleanLogs
 */

/**
 * 创建系统/工具相关 API 对象
 * @param {Electron.IpcRenderer} ipcRenderer - 由 index.js 注入
 * @returns {Object} 系统/工具相关方法集合
 */
function createSystemApi(ipcRenderer) {
  return {
    // 系统 API
    getVersion: () => ipcRenderer.invoke('app:get-version'),
    getPlatform: () => ipcRenderer.invoke('app:get-platform'),

    // 自动更新 API
    updateCheck: () => ipcRenderer.invoke('update:check'),
    updateDownload: () => ipcRenderer.invoke('update:download'),
    updateInstall: () => ipcRenderer.invoke('update:install'),
    // 侧边栏「新版本」入口：未下载则先下载，下载完成后自动退出并安装
    updateInstallNow: () => ipcRenderer.invoke('update:install-now'),
    onUpdateStatus: (callback) => {
      const handler = (_event, payload) => callback(payload)
      ipcRenderer.on('update:status', handler)
      return () => ipcRenderer.removeListener('update:status', handler)
    },

    // 首次运行引导 API
    firstRunCheck: () => ipcRenderer.invoke('first-run:check'),
    onFirstRunStatus: (callback) => {
      const handler = (_event, payload) => callback(payload)
      ipcRenderer.on('first-run:status', handler)
      return () => ipcRenderer.removeListener('first-run:status', handler)
    },

    // 平台配置 API
    platformList: () => ipcRenderer.invoke('platform:list'),
    platformGet: (id) => ipcRenderer.invoke('platform:get', id),
    getPlatformDefinitions: () => ipcRenderer.invoke('platform:definitions'),

    // 敏感词预检 API
    sensitiveCheck: (text) => ipcRenderer.invoke('sensitive:check', { text }),
    sensitiveReplace: (text) => ipcRenderer.invoke('sensitive:replace', { text }),

    // 数据同步 API
    syncAll: () => ipcRenderer.invoke('sync:all'),
    syncPlatform: (platform) => ipcRenderer.invoke('sync:platform', platform),
    syncCached: () => ipcRenderer.invoke('sync:cached'),

    // 通知 API
    showNotification: (data) => ipcRenderer.invoke('show-notification', data),
    onNotification: (cb) => {
      const h = (_, data) => cb(data)
      ipcRenderer.on('notification', h)
      return () => ipcRenderer.removeListener('notification', h)
    },

    // 回调服务器 API
    onCallbackReceived: (cb) => {
      const h = (_, d) => cb(d); ipcRenderer.on('callback:received', h); return () => ipcRenderer.removeListener('callback:received', h)
    },

    // 离线模式 API
    offlineStatus: () => ipcRenderer.invoke('offline:status'),
    offlineIsOffline: () => ipcRenderer.invoke('offline:is-offline'),
    offlineCachedTasks: () => ipcRenderer.invoke('offline:cached-tasks'),
    offlineAddToCache: (task) => ipcRenderer.invoke('offline:add-to-cache', task),
    offlineClearCache: () => ipcRenderer.invoke('offline:clear-cache'),
    onOfflineRestored: (cb) => {
      const h = (_, d) => cb(d); ipcRenderer.on('offline:restored', h); return () => ipcRenderer.removeListener('offline:restored', h)
    },

    // Onboarding API
    onboardingComplete: () => ipcRenderer.invoke('onboarding:complete'),
    onboardingGetSteps: () => ipcRenderer.invoke('onboarding:get-steps'),
    onboardingStatus: () => ipcRenderer.invoke('onboarding:status'),

    // 支付 API
    paymentCreateOrder: (options) => ipcRenderer.invoke('payment:create-order', options),
    paymentListOrders: () => ipcRenderer.invoke('payment:list-orders'),
    paymentGetOrder: (orderId) => ipcRenderer.invoke('payment:get-order', orderId),
    paymentComplete: (orderId, txnId) => ipcRenderer.invoke('payment:complete', { orderId, txnId }),
    paymentSimulate: (orderId) => ipcRenderer.invoke('payment:simulate', { orderId }),
    paymentCancel: (orderId) => ipcRenderer.invoke('payment:cancel', orderId),

    // 全局导航 API（快捷键触发）
    onNavigate: (cb) => {
      const h = (_, route) => cb(route); ipcRenderer.on('app:navigate', h); return () => ipcRenderer.removeListener('app:navigate', h)
    },

    // Analytics API
    analyticsOverview: () => ipcRenderer.invoke('analytics:overview'),
    analyticsPlatform: (platform) => ipcRenderer.invoke('analytics:platform', { platform }),
    analyticsPlatforms: () => ipcRenderer.invoke('analytics:platforms'),

    // Prompt engine evolution API (P0 反馈管道 + P1b 记忆库)
    generationFeedback: (payload) => ipcRenderer.invoke('generation:feedback', payload),
    promptLibraryList: () => ipcRenderer.invoke('prompt-library:list'),
    promptLibraryGet: (id, version) => ipcRenderer.invoke('prompt-library:get', { id, version }),
    promptLibrarySave: (payload) => ipcRenderer.invoke('prompt-library:save', payload),
    promptLibraryActivate: (id, confirmedBy) => ipcRenderer.invoke('prompt-library:activate', { id, confirmedBy }),

    // Hotkeys API
    hotkeysList: () => ipcRenderer.invoke('hotkeys:list'),

    // Keyword API
    keywordStart: (keyword, opts) => ipcRenderer.invoke('keyword:start', { keyword, opts }),
    keywordStop: (keyword) => ipcRenderer.invoke('keyword:stop', { keyword }),
    keywordStatus: () => ipcRenderer.invoke('keyword:status'),
    keywordHistory: (keyword) => ipcRenderer.invoke('keyword:history', { keyword }),
    keywordStopAll: () => ipcRenderer.invoke('keyword:stop-all'),

    // Proxy API
    proxyAdd: (host, port, type) => ipcRenderer.invoke('proxy:add', { host, port, type }),
    proxyAddBatch: (proxies) => ipcRenderer.invoke('proxy:add-batch', { proxies }),
    proxyList: () => ipcRenderer.invoke('proxy:list'),
    proxyRemove: (id) => ipcRenderer.invoke('proxy:remove', { id }),
    proxyTest: (id, timeout) => ipcRenderer.invoke('proxy:test', { id, timeout }),
    proxyTestAll: (timeout) => ipcRenderer.invoke('proxy:test-all', { timeout }),
    proxyStatus: () => ipcRenderer.invoke('proxy:status'),
    proxyGetNext: () => ipcRenderer.invoke('proxy:get-next'),
    proxyReset: () => ipcRenderer.invoke('proxy:reset'),
    proxyRemoveDead: () => ipcRenderer.invoke('proxy:remove-dead'),

    // Upload API
    uploadChunked: (filePath) => ipcRenderer.invoke('upload:chunked', { filePath }),
    uploadCancel: () => ipcRenderer.invoke('upload:cancel'),
    onUploadProgress: (callback) => {
      const h = (_e, payload) => callback(payload)
      ipcRenderer.on('upload:progress', h)
      return () => ipcRenderer.removeListener('upload:progress', h)
    },

    // Template API
    templateList: () => ipcRenderer.invoke('template:list'),
    templateGet: (id) => ipcRenderer.invoke('template:get', id),
    templateAdd: (tpl) => ipcRenderer.invoke('template:add', tpl),
    templateUpdate: (id, updates) => ipcRenderer.invoke('template:update', { id, updates }),
    templateDelete: (id) => ipcRenderer.invoke('template:delete', id),
    templateListByCategory: (category) => ipcRenderer.invoke('template:list-by-category', category),
    templateGetPresets: () => ipcRenderer.invoke('template:get-presets'),

    // 许可证 API
    licenseInfo: () => ipcRenderer.invoke('license:info'),
    licenseActivate: (key) => ipcRenderer.invoke('license:activate', key),
    licenseDeactivate: () => ipcRenderer.invoke('license:deactivate'),
    licenseActivateTrial: () => ipcRenderer.invoke('license:activate-trial'),
    licenseHasFeature: (name) => ipcRenderer.invoke('license:has-feature', name),
    licenseFeatures: () => ipcRenderer.invoke('license:features'),

    // Provider API
    providerList: () => ipcRenderer.invoke('provider:list'),
    providerCreate: (data) => ipcRenderer.invoke('provider:create', data),
    providerUpdate: (name, data) => ipcRenderer.invoke('provider:update', name, data),
    providerDelete: (name) => ipcRenderer.invoke('provider:delete', name),
    providerTest: (name) => ipcRenderer.invoke('provider:test', name),
    providerListUser: () => ipcRenderer.invoke('provider:list-user'),
    providerGetUser: (name) => ipcRenderer.invoke('provider:get-user', name),
    providerSetUserKey: (name, apiKey, baseUrl) => ipcRenderer.invoke('provider:set-user-key', name, apiKey, baseUrl),
    providerDeleteUserKey: (name) => ipcRenderer.invoke('provider:delete-user-key', name),

    // AI 生成 API（Phase 2）
    aiListProviders: (type) => ipcRenderer.invoke('ai:list-providers', type),
    aiGetConfig: (providerId) => ipcRenderer.invoke('ai:get-config', providerId),
    aiListModels: (providerId) => ipcRenderer.invoke('ai:list-models', providerId),
    aiGenerate: (type, provider, params) => ipcRenderer.invoke('ai:generate', { type, provider, params }),
    aiTestConnection: (providerId) => ipcRenderer.invoke('ai:test-connection', providerId),
    aiSaveConfig: (providerId, config) => ipcRenderer.invoke('ai:save-config', providerId, config),
    aiIsConfigured: () => ipcRenderer.invoke('ai:is-configured'),
    aiGenerateTitles: (topic) => ipcRenderer.invoke('ai:generate-titles', topic),
    aiEnhanceContent: (content, style) => ipcRenderer.invoke('ai:enhance-content', content, style),
    aiGenerateSummary: (content) => ipcRenderer.invoke('ai:generate-summary', content),
    aiRewrite: (params) => ipcRenderer.invoke('ai:rewrite', params),
    aiListRewriteStrategies: () => ipcRenderer.invoke('ai:list-rewrite-strategies'),
    aiGetRecommendedStrategies: (userSettings) => ipcRenderer.invoke('ai:get-recommended-strategies', userSettings),
    onAIProgress: (callback) => { const h = (_e, p) => callback(p); ipcRenderer.on('ai:progress', h); return () => ipcRenderer.removeListener('ai:progress', h); },
    onAIComplete: (callback) => { const h = (_e, p) => callback(p); ipcRenderer.on('ai:complete', h); return () => ipcRenderer.removeListener('ai:complete', h); },
    onAIError: (callback) => { const h = (_e, p) => callback(p); ipcRenderer.on('ai:error', h); return () => ipcRenderer.removeListener('ai:error', h); },

    // 视频处理 API（Phase 2）
    videoStatus: () => ipcRenderer.invoke('video:status'),
    videoListProcessTypes: () => ipcRenderer.invoke('video:list-process-types'),
    videoListAnalyzeTypes: () => ipcRenderer.invoke('video:list-analyze-types'),
    videoListStockSources: () => ipcRenderer.invoke('video:list-stock-sources'),
    videoProcess: (type, params) => ipcRenderer.invoke('video:process', { type, params }),
    videoAnalyze: (type, filePath) => ipcRenderer.invoke('video:analyze', type, filePath),
    videoMixAudio: (params) => ipcRenderer.invoke('video:mix-audio', params),
    videoSearchStock: (query, source, limit) => ipcRenderer.invoke('video:search-stock', query, source, limit),
    videoGenerateSubtitle: (audioPath, language) => ipcRenderer.invoke('video:generate-subtitle', audioPath, language),
    onVideoProgress: (callback) => { const h = (_e, p) => callback(p); ipcRenderer.on('video:progress', h); return () => ipcRenderer.removeListener('video:progress', h); },
    onVideoComplete: (callback) => { const h = (_e, p) => callback(p); ipcRenderer.on('video:complete', h); return () => ipcRenderer.removeListener('video:complete', h); },
    onVideoError: (callback) => { const h = (_e, p) => callback(p); ipcRenderer.on('video:error', h); return () => ipcRenderer.removeListener('video:error', h); },

    // 批量发布 API（批量管理工具，不是单次发布）
    batchCreate: (batch) => ipcRenderer.invoke('batch:create', batch),
    batchExecute: (id) => ipcRenderer.invoke('batch:execute', id),
    batchSchedule: (id) => ipcRenderer.invoke('batch:schedule', id),
    batchList: () => ipcRenderer.invoke('batch:list'),
    batchGet: (id) => ipcRenderer.invoke('batch:get', id),
    batchDelete: (id) => ipcRenderer.invoke('batch:delete', id),
    batchDuplicateArticle: (article) => ipcRenderer.invoke('batch:duplicate-article', article),
    onBatchProgress: (cb) => {
      const h = (_, d) => cb(d); ipcRenderer.on('batch:progress', h); return () => ipcRenderer.removeListener('batch:progress', h)
    },

    // 模型服务商管理 API（5 类模型 CRUD + 默认设置 + 调用日志）
    modelProviderList: (category) => ipcRenderer.invoke('model-provider:list', category),
    opsCenterSyncGet: () => ipcRenderer.invoke('ops-center-sync:get'),
    opsCenterSyncSave: (payload) => ipcRenderer.invoke('ops-center-sync:save', payload),
    opsCenterSyncNow: () => ipcRenderer.invoke('ops-center-sync:now'),
    opsCenterSyncRuntime: () => ipcRenderer.invoke('ops-center-sync:runtime'),
    opsCenterSyncPipelineOptions: () => ipcRenderer.invoke('ops-center-sync:pipelineOptions'),
    opsCenterSyncAppMenu: () => ipcRenderer.invoke('ops-center-sync:appMenu'),
    modelProviderGet: (id) => ipcRenderer.invoke('model-provider:get', id),
    modelProviderCreate: (data) => ipcRenderer.invoke('model-provider:create', data),
    modelProviderUpdate: (id, data) => ipcRenderer.invoke('model-provider:update', id, data),
    modelProviderDelete: (id) => ipcRenderer.invoke('model-provider:delete', id),
    modelProviderSetDefault: (category, id) => ipcRenderer.invoke('model-provider:set-default', category, id),
    modelProviderSetCapabilityDefault: (providerId, capability, enabled) => ipcRenderer.invoke('model-provider:set-capability-default', providerId, capability, enabled),
    modelProviderGetDefault: (category) => ipcRenderer.invoke('model-provider:get-default', category),
    modelProviderTest: (id) => ipcRenderer.invoke('model-provider:test', id),
    modelProviderPresets: (category) => ipcRenderer.invoke('model-provider:presets', category),
    modelProviderIsConfigured: (category) => ipcRenderer.invoke('model-provider:is-configured', category),
    modelProviderLogs: (filter) => ipcRenderer.invoke('model-provider:logs', filter),
    modelProviderCleanLogs: (days) => ipcRenderer.invoke('model-provider:clean-logs', days),

    // 应用日志 API（设置-通用设置：查看/清理/渲染进程错误上报）
    logsGetInfo: () => ipcRenderer.invoke('logs:info'),
    logsClear: () => ipcRenderer.invoke('logs:clear'),
    // 缓存清理 API（设置-通用设置：统计/清理临时缓存）
    cacheGetStats: () => ipcRenderer.invoke('cache:stats'),
    cacheClear: () => ipcRenderer.invoke('cache:clear'),
    logError: (message) => ipcRenderer.invoke('logs:error', { message }),
    submitFeedback: (payload) => ipcRenderer.invoke('feedback:submit', payload),

    // 通知日志上报（notify:log）——renderer notify() 通道内部调用，写结构化日志行
    notifyLog: (payload) => ipcRenderer.invoke('notify:log', payload),
  }
}

module.exports = { createSystemApi }
