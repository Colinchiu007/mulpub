/**
 * 发布 API 封装 — 调用 Electron IPC
 * 所有 Vue 组件通过此文件访问 Electron IPC，不直接调用 window.electronAPI
 */
import { invoke, invokeWithFallback, on as bridgeOn } from "./electron-bridge";

// ─── 发布 API ─────────────────────────────
export async function publishWechat(article) { return invoke("publishWechat", article) }

export async function publishBatch(platforms, article) { return invokeWithFallback("publishBatch", {  code: -1, message: 'electronAPI not available'  }, platforms, article) }

export function onProgress(callback) { return bridgeOn("Progress", callback) }

// ─── AI 写作 API ──────────────────────────
export async function modelProviderIsConfigured(category) { return invokeWithFallback("modelProviderIsConfigured", { code: -1, data: false }, category) }
export async function modelProviderGetDefault(category) { return invokeWithFallback("modelProviderGetDefault", { code: -1, data: null }, category) }

export async function aiIsConfigured() { return invokeWithFallback("aiIsConfigured", { code: -1, data: false }) }

export async function aiGenerateTitles(topic) { return invokeWithFallback("aiGenerateTitles", { code: -1, data: [] }, topic) }

export async function aiGenerateSummary(content) { return invokeWithFallback("aiGenerateSummary", { code: -1, data: "" }, content) }
export async function aiEnhanceContent(content, style) { return invokeWithFallback("aiEnhanceContent", { code: -1, data: "" }, content, style) }

export async function aiGenerate(type, provider, params) { return invokeWithFallback("aiGenerate", { code: -1, message: 'electronAPI not available' }, type, provider, params) }

// ─── 改写引擎 API（rewrite-engine）────────────────────
export async function aiRewrite(params) { return invokeWithFallback("aiRewrite", { code: -1, data: null }, params) }

export async function aiListRewriteStrategies() { return invokeWithFallback("aiListRewriteStrategies", { code: -1, data: [] }) }

export async function aiGetRecommendedStrategies(userSettings) { return invokeWithFallback("aiGetRecommendedStrategies", { code: -1, data: [] }, userSettings) }

// ─── 队列 API ─────────────────────────────
export async function getQueueStatus () {
  return invokeWithFallback("getQueueStatus", {})
}

export async function getQueueHistory() { return invokeWithFallback("getQueueHistory", {  code: 0, data: []  }) }

export async function cancelTask(taskId) { return invokeWithFallback("cancelTask", {  code: -1  }, taskId) }

export async function retryTask(taskId) { return invokeWithFallback("retryTask", { code: -1 }, taskId) }

// ─── 发布历史 API ─────────────────────────
export async function historyList (opts) {
  return invokeWithFallback("historyList", { code: 0, data: { total: 0, records: [] } }, opts)
}

export async function historyGet(id) { return invokeWithFallback("historyGet", {  code: -1, message: 'electronAPI not available'  }, id) }

export async function historyDelete (ids) {
  const normalizedIds = Array.isArray(ids) ? ids : [ids]
  return invokeWithFallback("historyDelete", { code: -1, message: 'electronAPI not available' }, normalizedIds)
}

// ─── 发布统计 API ──────────────────────────
export async function dashboardStats () {
  return invokeWithFallback("dashboardStats", { code: 0, data: { total: 0, success: 0, failed: 0, byPlatform: {}, daily: [] } })
}

// ─── 定时发布 API ─────────────────────────
export async function schedulerCreate(schedule) { return invokeWithFallback("schedulerCreate", {  code: -1  }, schedule) }

export async function schedulerList() { return invokeWithFallback("schedulerList", {  code: 0, data: []  }) }

export async function schedulerCancel(id) { return invokeWithFallback("schedulerCancel", {  code: -1  }, id) }

// ─── 账号管理 API ─────────────────────────
export async function listAccounts() { return invokeWithFallback("listAccounts", {  code: 0, data: []  }) }

export async function accountAdd(platform) { return invokeWithFallback("accountAdd", {  code: -1, message: 'electronAPI not available'  }, platform) }

export async function accountDelete(accountId) { return invokeWithFallback("accountDelete", {  code: -1, message: 'electronAPI not available'  }, accountId) }

export async function accountCheckLogin(platform, accountId) { return invokeWithFallback("accountCheckLogin", {  code: -1, message: 'electronAPI not available'  }, platform, accountId) }

export async function accountBatchCheckLogin(accountIds) { return invokeWithFallback("accountBatchCheckLogin", { code: -1, message: 'electronAPI not available' }, accountIds) }

export async function accountBatchOpenLogin(accountIds) { return invokeWithFallback("accountBatchOpenLogin", { code: -1, message: 'electronAPI not available' }, accountIds) }

export async function accountList() { return invokeWithFallback("accountList", {  code: 0, data: []  }) }

export async function accountSetDefault(platform, accountId) { return invoke("accountSetDefault", platform, accountId) }

export async function accountUpdate (id, fields) {
  return invoke("accountUpdate", id, fields)
}

export async function accountSetProxy (accountId, platform, proxy) {
  return invokeWithFallback('accountSetProxy', { code: -1, message: 'electronAPI not available' }, accountId, platform, proxy)
}

// 启用态写通道：主进程 AccountManager.setAccountActive → 后端 PATCH is_active（唯一真源）。
// 不得改回 accountUpdate：那条通道写 Electron SQLite，而账号列表根本不从那里读，写了也不显示。
export async function accountSetActive (accountId, platform, isActive) {
  return invokeWithFallback('accountSetActive', { code: -1, message: 'electronAPI not available' }, accountId, platform, isActive)
}

// ─── 内嵌浏览器登录 API ──────────────────
export async function authOpenLogin(platform, accountId) { return invokeWithFallback("authOpenLogin", { code: -1 }, platform, accountId) }

export async function authCompleteLogin() { return invokeWithFallback("authCompleteLogin", { code: -1, message: 'electronAPI not available' }) }

export async function authClose () {
  return invoke("authClose")
}

export function onAuthViewOpened(callback) { return bridgeOn("AuthViewOpened", callback) }

export function onAuthCompleted(callback) { return bridgeOn("AuthCompleted", callback) }

export function onAuthViewClosed(callback) { return bridgeOn("AuthViewClosed", callback) }

// ─── 扫码登录与账号状态事件 ────────────────
export async function authOpenQrCodeLogin(platform) { return invokeWithFallback("authOpenQrCodeLogin", { code: -1 }, platform) }

export async function authQrCodeClose() { return invokeWithFallback("authQrCodeClose", { code: -1 }) }

export function onQrCodeOpened(callback) { return bridgeOn("QrCodeOpened", callback) }

export function onQrCodeDetected(callback) { return bridgeOn("QrCodeDetected", callback) }

export function onQrCodeCompleted(callback) { return bridgeOn("QrCodeCompleted", callback) }

export function onQrCodeClosed(callback) { return bridgeOn("QrCodeClosed", callback) }

export function onAccountStatusChanged(callback) { return bridgeOn("AccountStatusChanged", callback) }

// ─── 渲染 API ────────────────────────────
export async function renderStart(data) { return invoke("renderStart", data) }
// 快速渲染 text 模式：调用 AI 视频生成模型（主进程提交+轮询+下载），返回本地视频路径
export async function renderStartAiVideo(data) { return invoke("renderStartAiVideo", data) }
export async function renderCancel () {
  return invokeWithFallback("renderCancel", {})
}

export async function renderGetStatus () {
  return invokeWithFallback("renderGetStatus", {})
}

export async function renderInstallDeps() { return invokeWithFallback("renderInstallDeps", {  code: -1, message: 'electronAPI not available'  }) }

export function onRenderProgress(callback) { return bridgeOn("RenderProgress", callback) }

// 流水线阶段进度实时推送（openspec pipeline-progress-real-time-push）
export function onPipelineUpdate(callback) { return bridgeOn("PipelineUpdate", callback) }

export function onRenderComplete(callback) { return bridgeOn("RenderComplete", callback) }

export function onRenderError(callback) { return bridgeOn("RenderError", callback) }

export function onRenderInstallProgress(callback) { return bridgeOn("RenderInstallProgress", callback) }

// ─── 内容情报 API ────────────────────────
export async function intelligenceSearch(query, opts) { return invokeWithFallback("intelligenceSearch", {  code: 0, data: []  }, query, opts) }

export async function intelligenceSearchTitles (query, opts) {
  return invokeWithFallback("intelligenceSearchTitles", [], query, opts)
}

export async function intelligenceFetchTrending (opts) {
  const res = await invokeWithFallback("intelligenceFetchTrending", [], opts)
  // 拆 envelope：IPC 返回 { code, data }
  const payload = res?.code === 0 ? res.data : res
  // 归一化：后端 fetchTrending 返回 { total, results, bySource, timestamp }（results 元素字段为 engagement），
  // 前端组件契约为数组且字段为 engagementScore。统一映射，避免字段名/结构不匹配导致互动分永不显示。
  if (Array.isArray(payload)) {
    return payload.map(item => ({ ...item, engagementScore: item.engagementScore != null ? item.engagementScore : item.engagement }))
  }
  if (payload && Array.isArray(payload.results)) {
    return payload.results.map(item => ({ ...item, engagementScore: item.engagementScore != null ? item.engagementScore : item.engagement }))
  }
  return payload
}

export async function intelligenceSuggestTags (content, opts) {
  return invokeWithFallback("intelligenceSuggestTags", null, content, opts)
}

export async function intelligenceFindReferences (url, opts) {
  return invokeWithFallback("intelligenceFindReferences", [], url, opts)
}

export async function intelligenceGetOptimalTime (keyword) {
  return invokeWithFallback("intelligenceGetOptimalTime", null, keyword)
}

export async function intelligenceGetBenchmark (opts) {
  return invokeWithFallback("intelligenceGetBenchmark", null, opts)
}

// ─── 关键词监测 API ──────────────────────
export async function keywordStatus () {
  return invokeWithFallback("keywordStatus", { code: 0, data: {} })
}

export async function keywordStart(keyword, opts) { return invokeWithFallback("keywordStart", {  code: -1  }, keyword, opts) }

export async function keywordStop(keyword) { return invokeWithFallback("keywordStop", {  code: -1  }, keyword) }

export async function keywordHistory(keyword) { return invokeWithFallback("keywordHistory", {  code: 0, data: []  }, keyword) }

// ─── 爆款分析 API ────────────────────────
export async function viralAnalyze(articles, topic) { return invokeWithFallback("viralAnalyze", {  code: -1  }, articles, topic) }
export async function viralGenerate(opts) { return invokeWithFallback("viralGenerate", {  code: -1  }, opts) }
export async function viralTrending(articles) { return invokeWithFallback("viralTrending", {  code: -1  }, articles) }
export async function getRecentImpactSnapshots() { return invokeWithFallback("getRecentImpactSnapshots", {  code: -1, data: []  }) } // PR-2 F8：未登录/无数据 code -1 → 调用方隐藏区块
// ─── 平台配置 API ────────────────────────
export async function platformList() { return invokeWithFallback("platformList", {  code: 0, data: []  }) }

export async function platformGet(id) { return invokeWithFallback("platformGet", {  code: -1  }, id) }

export async function getPlatformDefinitions() { return invokeWithFallback("getPlatformDefinitions", {  code: -1  }) }

// ─── 敏感词 API ──────────────────────────
export async function sensitiveCheck(text) { return invokeWithFallback("sensitiveCheck", {  code: -1  }, text) }

export async function sensitiveReplace(text) { return invokeWithFallback("sensitiveReplace", {  code: -1  }, text) }

// ─── 数据同步 API ────────────────────────
export async function syncAll() { return invokeWithFallback("syncAll", {  code: -1  }) }

export async function syncPlatform(platform) { return invokeWithFallback("syncPlatform", {  code: -1  }, platform) }

// ─── 自动更新 API ──────────────────────────
export async function updateCheck () {
  return invokeWithFallback("updateCheck", {})
}
export async function updateDownload () {
  return invokeWithFallback("updateDownload", {})
}
export async function updateInstall () {
  return invokeWithFallback("updateInstall", {})
}
export async function updateInstallNow () { return invokeWithFallback("updateInstallNow", {}) }
export function onUpdateStatus(callback) { return bridgeOn("UpdateStatus", callback) }

// ─── 知识库反馈 API（P2 隐式反馈）─────────────────
export async function applyKnowledgeFeedback(action, refs) {
  return invokeWithFallback("applyKnowledgeFeedback", { code: -1, message: 'electronAPI not available' }, action, refs)
}

// ─── 草稿箱 API（参考产品复用）─────────────────
export async function draftSave(draft) { return invokeWithFallback("draftSave", { code: -1, message: 'electronAPI not available' }, draft) }

export async function draftList() { return invokeWithFallback("draftList", { code: 0, data: [] }) }

export async function draftDelete(draftId) { return invokeWithFallback("draftDelete", { code: -1, message: 'electronAPI not available' }, draftId) }

// ─── 全局存储 API ─────────────────────────
export async function storeGetSetting (key) {
  const result = await invokeWithFallback("storeGetSetting", null, key)
  if (result && typeof result === 'object' && typeof result.code === 'number') {
    return result.code === 0 ? result.data : null
  }
  return result
}

export async function storeSetSetting (key, value) {
  return invoke("storeSetSetting", key, value)
}

export async function storeAddPublishRecord (record) {
  return invokeWithFallback("storeAddPublishRecord", null, record)
}

export async function storeListPublishHistory(opts) { return invokeWithFallback("storeListPublishHistory", {  code: 0, data: []  }, opts) }

// ─── OAuth API ────────────────────────────
export async function oauthStart(opts) { return invokeWithFallback("oauthStart", {  code: -1  }, opts) }

export async function oauthClose () {
  return invoke("oauthClose")
}

export function onOAuthCompleted(callback) { return bridgeOn("OAuthCompleted", callback) }

// ─── 批量发布 API ─────────────────────────
export async function batchCreate(batch) { return invokeWithFallback("batchCreate", {  code: -1  }, batch) }

export async function batchExecute(id) { return invokeWithFallback("batchExecute", { code: -1 }, id) }

export async function batchSchedule(id) { return invokeWithFallback("batchSchedule", { code: -1 }, id) }

export async function batchGet(id) { return invokeWithFallback("batchGet", { code: -1 }, id) }

export async function batchList() { return invokeWithFallback("batchList", {  code: 0, data: []  }) }

export async function batchDelete(id) { return invoke("batchDelete", id) }

export function onBatchProgress(callback) { return bridgeOn("BatchProgress", callback) }

// ─── 支付 API ─────────────────────────────
export async function paymentCreateOrder(options) { return invokeWithFallback("paymentCreateOrder", {  code: -1  }, options) }

export async function paymentListOrders() { return invokeWithFallback("paymentListOrders", {  code: 0, data: []  }) }

export async function paymentGetOrder(orderId) { return invokeWithFallback("paymentGetOrder", {  code: -1  }, orderId) }

export async function paymentSimulate(orderId) { return invokeWithFallback("paymentSimulate", {  code: -1  }, orderId) }

export async function paymentCancel(orderId) { return invokeWithFallback("paymentCancel", {  code: -1  }, orderId) }


// ─── 首次运行引导 API ──────────────────────
export async function firstRunCheck() { return invokeWithFallback("firstRunCheck", {  code: 0, data: { setupDone: false }  }) }
export function onFirstRunStatus(callback) { return bridgeOn("FirstRunStatus", callback) }

// ─── 通知 API ────────────────────────────

// ──── Offline API ──────────────────────────────────────────────
export async function offlineStatus () {
  return invokeWithFallback("offlineStatus", { code: -1, data: { offline: false, cachedCount: 0, cachedTasks: [] } })
}

export async function offlineAddToCache(task) { return invokeWithFallback("offlineAddToCache", {  code: -1  }, task) }

export async function offlineClearCache() { return invokeWithFallback("offlineClearCache", {  code: -1  }) }

export function onOfflineRestored(callback) { return bridgeOn("OfflineRestored", callback) }

export function showNotification (data) {
  return invoke("showNotification", data)
}


// ─── Pipeline 流水线 API ──────────────────────
export async function pipelineList() { return invokeWithFallback("pipelineList", { code: 0, data: [] }) }
export async function pipelineGet(name) { return invokeWithFallback("pipelineGet", null, name) }
export async function pipelineStart(name, params) { return invokeWithFallback("pipelineStart", { code: -1, message: 'electronAPI not available' }, name, params) }
export async function pipelinePause() { return invokeWithFallback("pipelinePause", { code: -1 }) }
export async function pipelineResume() { return invokeWithFallback("pipelineResume", { code: -1 }) }
export async function pipelineCancel() { return invokeWithFallback("pipelineCancel", { code: -1 }) }
export async function pipelineStatus(name) { return invokeWithFallback("pipelineStatus", null, name) }
export async function pipelineAdvance() { return invokeWithFallback("pipelineAdvance", { code: -1 }) }
export async function pipelineHistory() { return invokeWithFallback("pipelineHistory", { code: 0, data: [] }) }
export async function pipelineDeleteRun(runId) { return invokeWithFallback("pipelineDeleteRun", { code: -1, message: 'electronAPI not available' }, runId) }
export async function pipelinePauseRun(runId) { return invokeWithFallback("pipelinePauseRun", { code: -1, message: 'electronAPI not available' }, runId) }
export async function pipelineCancelRun(runId) { return invokeWithFallback("pipelineCancelRun", { code: -1, message: 'electronAPI not available' }, runId) }

// ═══ Pipeline 编排模式 API（story2video-compose 等新流水线使用） ═══
export async function pipelineStartOrchestrated(name, params) { return invokeWithFallback("pipelineStartOrchestrated", { code: -1, message: 'electronAPI not available' }, name, params) }
export async function pipelineResumeOrchestration(runId) { return invokeWithFallback("pipelineResumeOrchestration", { code: -1, message: 'electronAPI not available' }, runId) }
export async function pipelineExecuteStage(runId) { return invokeWithFallback("pipelineExecuteStage", { code: -1 }, runId) }
export async function pipelineAdvanceToNextCheckpoint(runId) { return invokeWithFallback("pipelineAdvanceToNextCheckpoint", { code: -1 }, runId) }
export async function pipelineConfirmSceneAssets(runId, selections) { return invokeWithFallback("pipelineConfirmSceneAssets", { code: -1, message: 'electronAPI not available' }, runId, selections) }
export async function pipelineConfirmStageGate(runId, contextPatch) { return invokeWithFallback("pipelineConfirmStageGate", { code: -1, message: 'electronAPI not available' }, runId, contextPatch) }
export async function filmEngineeringRetryShot(payload) { return invokeWithFallback("filmEngineeringRetryShot", { code: -1, message: 'electronAPI not available' }, payload) }
export async function pipelineGetRunContext(runId) { return invokeWithFallback("pipelineGetRunContext", null, runId) }
export async function pipelinePauseWithCheckpoint() { return invokeWithFallback("pipelinePauseWithCheckpoint", { code: -1 }) }
export async function pipelineResumeFromCheckpoint() { return invokeWithFallback("pipelineResumeFromCheckpoint", { code: -1 }) }
export async function pipelineRegisterPipeline(def) { return invokeWithFallback("pipelineRegisterPipeline", { code: -1 }, def) }

// ─── Story2Video 本地交付 API ──────────────────────
export async function story2videoImportMedia(file, kind) {
  return invokeWithFallback("story2videoImportMedia", { code: -1, message: 'electronAPI not available' }, file, kind)
}
export async function story2videoImportMediaPath(filePath, kind) {
  return invokeWithFallback("story2videoImportMediaPath", { code: -1, message: 'electronAPI not available' }, filePath, kind)
}
export async function story2videoExportZip(files, destinationPath) {
  return destinationPath === undefined
    ? invokeWithFallback("story2videoExportZip", { code: -1, message: 'electronAPI not available' }, files)
    : invokeWithFallback("story2videoExportZip", { code: -1, message: 'electronAPI not available' }, files, destinationPath)
}
export async function story2videoCreateShareUrl(filePath, previousUrl) {
  return previousUrl === undefined
    ? invokeWithFallback("story2videoCreateShareUrl", { code: -1, message: 'electronAPI not available' }, filePath)
    : invokeWithFallback("story2videoCreateShareUrl", { code: -1, message: 'electronAPI not available' }, filePath, previousUrl)
}
export async function story2videoCopyPath(filePath) {
  return invokeWithFallback("story2videoCopyPath", { code: -1, message: 'electronAPI not available' }, filePath)
}
export async function story2videoShowInFolder(filePath) {
  return invokeWithFallback("story2videoShowInFolder", { code: -1, message: 'electronAPI not available' }, filePath)
}
export async function story2videoSaveAs(filePath, suggestedName) {
  return invokeWithFallback("story2videoSaveAs", { code: -1, message: 'electronAPI not available' }, filePath, suggestedName)
}
export async function story2videoEnsureProject(payload) {
  return invokeWithFallback("story2videoEnsureProject", { code: -1, message: 'electronAPI not available' }, payload)
}

export async function story2videoListProjects() {
  return invokeWithFallback("story2videoListProjects", { code: -1, message: 'electronAPI not available', data: [] })
}
export async function story2videoGetProject(projectId) {
  return invokeWithFallback("story2videoGetProject", { code: -1, message: 'electronAPI not available' }, projectId)
}
export async function story2videoGetThumbnail(projectId) {
  return invokeWithFallback("story2videoGetThumbnail", { code: -1, message: 'electronAPI not available' }, projectId)
}
export async function story2videoDeleteProject(projectId) {
  return invokeWithFallback("story2videoDeleteProject", { code: -1, message: 'electronAPI not available' }, projectId)
}
export async function story2videoUpdateSegments(projectId, segments) {
  return invokeWithFallback("story2videoUpdateSegments", { code: -1, message: 'electronAPI not available' }, projectId, segments)
}
export async function story2videoReplaceSegmentAudio(projectId, segmentId, filePath) {
  return invokeWithFallback("story2videoReplaceSegmentAudio", { code: -1, message: 'electronAPI not available' }, projectId, segmentId, filePath)
}
export async function story2videoRetrySegment(projectId, segmentId, mode) {
  return invokeWithFallback("story2videoRetrySegment", { code: -1, message: 'electronAPI not available' }, projectId, segmentId, mode)
}
export async function story2videoRecomposeProject(projectId) {
  return invokeWithFallback("story2videoRecomposeProject", { code: -1, message: 'electronAPI not available' }, projectId)
}
export async function story2videoSelectSceneMaterial(projectId, segmentId, kind) {
  return invokeWithFallback("story2videoSelectSceneMaterial", { code: -1, message: 'electronAPI not available' }, projectId, segmentId, kind)
}
export async function story2videoGenerateSceneImage(projectId, segmentId) {
  return invokeWithFallback("story2videoGenerateSceneImage", { code: -1, message: 'electronAPI not available' }, projectId, segmentId)
}
export async function story2videoGenerateSceneVideo(projectId, segmentId) {
  return invokeWithFallback("story2videoGenerateSceneVideo", { code: -1, message: 'electronAPI not available' }, projectId, segmentId)
}
export async function story2videoGenerateSceneAiVideo(projectId, segmentId) {
  return invokeWithFallback("story2videoGenerateSceneAiVideo", { code: -1, message: 'electronAPI not available' }, projectId, segmentId)
}

export async function story2videoRegenerateSceneSubtitle(projectId, segmentId) {
  return invokeWithFallback("story2videoRegenerateSceneSubtitle", { code: -1, message: 'electronAPI not available' }, projectId, segmentId)
}

export async function story2videoRegenerateSceneAudio(projectId, segmentId) {
  return invokeWithFallback("story2videoRegenerateSceneAudio", { code: -1, message: 'electronAPI not available' }, projectId, segmentId)
}

export async function story2videoRegenerateScenePrompt(projectId, segmentId, kind) {
  return invokeWithFallback("story2videoRegenerateScenePrompt", { code: -1, message: 'electronAPI not available' }, projectId, segmentId, kind)
}
export async function story2videoTranscribe(filePath) {
  return invokeWithFallback("story2videoTranscribe", { code: -1, message: 'electronAPI not available' }, filePath)
}
export async function story2videoCapabilities() {
  return invokeWithFallback("story2videoCapabilities", { code: -1, message: 'electronAPI not available' })
}
export async function story2videoBgmLibraryList() {
  return invokeWithFallback("story2videoBgmLibraryList", { code: -1, message: 'electronAPI not available', data: [] })
}
export async function story2videoBgmLibraryAdd(file) {
  return invokeWithFallback("story2videoBgmLibraryAdd", { code: -1, message: 'electronAPI not available' }, file)
}
export async function story2videoBgmLibraryRename(id, name) {
  return invokeWithFallback("story2videoBgmLibraryRename", { code: -1, message: 'electronAPI not available' }, id, name)
}
export async function story2videoBgmLibraryDelete(id) {
  return invokeWithFallback("story2videoBgmLibraryDelete", { code: -1, message: 'electronAPI not available' }, id)
}
// ─── 流水线「保存配置」API（openspec s2v-pipeline-config-profiles） ───
export async function story2videoConfigProfileList() {
  return invokeWithFallback("story2videoConfigProfileList", { code: -1, message: 'electronAPI not available', data: [] })
}
export async function story2videoConfigProfileCreate(request) {
  return invokeWithFallback("story2videoConfigProfileCreate", { code: -1, message: 'electronAPI not available' }, request)
}
export async function story2videoConfigProfileRename(id, name) {
  return invokeWithFallback("story2videoConfigProfileRename", { code: -1, message: 'electronAPI not available' }, id, name)
}
export async function story2videoConfigProfileDelete(id) {
  return invokeWithFallback("story2videoConfigProfileDelete", { code: -1, message: 'electronAPI not available' }, id)
}
// ─── Story2Video 批量创作 API（openspec story2video-batch-create） ───
export async function story2videoBatchCreate(payload) {
  return invokeWithFallback("story2videoBatchCreate", { code: -1, message: 'electronAPI not available' }, payload)
}
export async function story2videoBatchStatus() {
  return invokeWithFallback("story2videoBatchStatus", { code: -1, message: 'electronAPI not available', data: [] })
}
export async function story2videoBatchCancel(batchId, itemIds) {
  return invokeWithFallback("story2videoBatchCancel", { code: -1, message: 'electronAPI not available' }, batchId, itemIds)
}
export async function story2videoPickBatchFiles() {
  return invokeWithFallback("story2videoPickBatchFiles", { code: -1, message: 'electronAPI not available', data: { files: [] } })
}

// ─── 全自动管道 API ─────────────────────────
export async function autoPipelineStart(config) { return invokeWithFallback("autoPipelineStart", { code: -1, message: 'electronAPI not available' }, config) }
export async function autoPipelineGetRun(runId) { return invokeWithFallback("autoPipelineGetRun", null, runId) }
export async function autoPipelineCancel(runId) { return invokeWithFallback("autoPipelineCancel", { code: -1 }, runId) }
export async function autoPipelineListRuns() { return invokeWithFallback("autoPipelineListRuns", { code: 0, data: [] }) }
export async function logsGetInfo() {
  return invokeWithFallback("logsGetInfo", { code: -1, data: { dir: '', totalBytes: 0, fileCount: 0, maxFileBytes: 0, files: [] } })
}
export async function logsClear() { return invokeWithFallback("logsClear", { code: -1 }) }
export async function submitFeedback(payload) {
  return invokeWithFallback("submitFeedback", { code: -1, message: 'electronAPI not available' }, payload)
}

export async function videoProcess(type, params) {
  return invokeWithFallback("videoProcess", { code: -1, message: 'electronAPI not available' }, type, params)
}
/**
 * 提取视频首帧作为封面
 */
export function extractVideoCover(videoPath) {
  return window.electronAPI.extractVideoCover(videoPath)
}

export function generateAiCover(payload) {
  return window.electronAPI.generateAiCover(payload)
}
export function listPlatformCollections(platform, accountId) {
  return window.electronAPI.listPlatformCollections({ platform, accountId })
}
