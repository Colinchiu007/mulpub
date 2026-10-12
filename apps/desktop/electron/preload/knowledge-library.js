// @ts-check
/**
 * Knowledge Library preload API
 *
 * 暴露给渲染进程的知识库相关 IPC 调用（扁平方法名，兼容 electron-bridge invokeWithFallback）。
 * 含飞书 API 配置读写与连接测试。
 */

/**
 * @param {import('electron').IpcRenderer} ipcRenderer
 */
function createKnowledgeLibraryApi(ipcRenderer) {
  return {
    // 爆款库
    addViralToLibrary: (item) => ipcRenderer.invoke('knowledge-library:add-viral', item),
    addViralBatchToLibrary: (items) => ipcRenderer.invoke('knowledge-library:add-viral-batch', items),
    listViralItems: (params) => ipcRenderer.invoke('knowledge-library:list-viral', params),
    getViralItem: (id) => ipcRenderer.invoke('knowledge-library:get-viral', id),
    updateViralItem: (id, updates) => ipcRenderer.invoke('knowledge-library:update-viral', id, updates),
    deleteViralItem: (id) => ipcRenderer.invoke('knowledge-library:delete-viral', id),
    searchViralItems: (query, limit) => ipcRenderer.invoke('knowledge-library:search-viral', query, limit),
    // 模式卡片（P1）
    listPatternCards: (params) => ipcRenderer.invoke('knowledge-library:list-pattern-cards', params),
    reextractPattern: (viralItemId) => ipcRenderer.invoke('knowledge-library:reextract-pattern', viralItemId),
    getPatternQueueStats: () => ipcRenderer.invoke('knowledge-library:pattern-queue-stats'),
    // 效果闭环（P2）
    listTrackedContent: (params) => ipcRenderer.invoke('performance:list-tracked', params),
    addManualSnapshot: (trackedContentId, metrics) => ipcRenderer.invoke('performance:add-manual-snapshot', trackedContentId, metrics),
    recomputeAttribution: () => ipcRenderer.invoke('performance:recompute-attribution'),
    listPatternPerformance: (params) => ipcRenderer.invoke('performance:list-pattern-performance', params),
    performanceOverview: (params) => ipcRenderer.invoke('performance:overview', params),
    triggerPerformanceRecrawl: (opts) => ipcRenderer.invoke('performance:trigger-recrawl', opts),
    // 发布记录页指标读口 + 账号级采集（PRD-PUBLISH-HISTORY-ENGAGEMENT-2026-10-12）：
    // 前者是发布记录页唯一的指标来源（主进程内完成 taskId→tracked→最新快照 的 join），
    // 后者是低频采集的手动触发入口。两者都默认 authenticated 档，无需登记 license 白名单，
    // 但都必须带 withSenderCheck（Gate 17 的显式守卫比例棘轮）。
    historyMetrics: (params) => ipcRenderer.invoke('performance:history-metrics', params),
    metricsSync: (opts) => ipcRenderer.invoke('metrics:sync', opts),
    metricsSyncStatus: () => ipcRenderer.invoke('metrics:sync-status'),
    // 个人知识库
    addPersonalToLibrary: (item) => ipcRenderer.invoke('knowledge-library:add-personal', item),
    addPersonalBatchToLibrary: (items) => ipcRenderer.invoke('knowledge-library:add-personal-batch', items),
    listPersonalItems: (params) => ipcRenderer.invoke('knowledge-library:list-personal', params),
    getPersonalItem: (id) => ipcRenderer.invoke('knowledge-library:get-personal', id),
    updatePersonalItem: (id, updates) => ipcRenderer.invoke('knowledge-library:update-personal', id, updates),
    deletePersonalItem: (id) => ipcRenderer.invoke('knowledge-library:delete-personal', id),
    searchPersonalItems: (query, limit) => ipcRenderer.invoke('knowledge-library:search-personal', query, limit),
    // 飞书 API 配置
    feishuGetConfig: () => ipcRenderer.invoke('feishu:get-config'),
    feishuSaveConfig: (appId, appSecret) => ipcRenderer.invoke('feishu:save-config', appId, appSecret),
    feishuTestConnection: (appId, appSecret) => ipcRenderer.invoke('feishu:test-connection', appId, appSecret),
    // 文件批量导入
    importFiles: (files, categoryPerFile) => ipcRenderer.invoke('knowledge-library:import-files', files, categoryPerFile),
    // 飞书导出
    exportViralToFeishu: (title) => ipcRenderer.invoke('knowledge-library:export-viral-to-feishu', title),
    exportPersonalToFeishu: (title) => ipcRenderer.invoke('knowledge-library:export-personal-to-feishu', title),
    // P2 反馈闭环：用户采纳/拒绝驱动知识置信度
    applyKnowledgeFeedback: (action, refs) => ipcRenderer.invoke('knowledge-library:apply-feedback', action, refs),
  }
}

module.exports = { createKnowledgeLibraryApi }
