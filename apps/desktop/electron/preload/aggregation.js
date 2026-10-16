// @ts-check
/**
 * Aggregation preload API — 热文采集模块
 *
 * 暴露给渲染进程的 aggregation 相关 IPC 调用。
 */

/**
 * @param {import('electron').IpcRenderer} ipcRenderer
 */
function createAggregationApi(ipcRenderer) {
  return {
    aggregationCollect: (payload) => ipcRenderer.invoke('aggregation:collect', payload),
    aggregationCollectVideo: (payload) => ipcRenderer.invoke('aggregation:collect-video', payload),
    aggregationCollectBatch: (payload) => ipcRenderer.invoke('aggregation:collect-batch', payload),
    aggregationRewrite: (payload) => ipcRenderer.invoke('aggregation:rewrite', payload),
    aggregationSources: () => ipcRenderer.invoke('aggregation:sources'),
    aggregationTaskStatus: (taskId) => ipcRenderer.invoke('aggregation:task-status', taskId),
    // ASR 依赖安装（-6 引导弹窗触发；进度经 asr-install:progress 事件推送）
    aggregationAsrInstall: () => ipcRenderer.invoke('aggregation:asr-install'),
    onAsrInstallProgress: (callback) => {
      const listener = (_event, progress) => callback(progress)
      ipcRenderer.on('asr-install:progress', listener)
      return () => ipcRenderer.removeListener('asr-install:progress', listener)
    },
    // 知乎收藏夹（官方 API + 批量频率控制）
    zhihuFavlistList: () => ipcRenderer.invoke('zhihu-favlist:list'),
    zhihuFavlistContents: (payload) => ipcRenderer.invoke('zhihu-favlist:contents', payload),
    zhihuFavlistBatchCollect: (payload) => ipcRenderer.invoke('zhihu-favlist:batch-collect', payload),
    zhihuFavlistBatchRewrite: (payload) => ipcRenderer.invoke('zhihu-favlist:batch-rewrite', payload),
    zhihuFavlistCancel: (type) => ipcRenderer.invoke('zhihu-favlist:cancel', { type }),
    // 知乎收藏批量升级（2026-10-03 PRD-ZHIHU-FAV-BATCH）：全部收藏聚合 + 采集并改写编排
    zhihuFavlistUnifiedContents: (payload) => ipcRenderer.invoke('zhihu-favlist:unified-contents', payload),
    zhihuFavBatchRun: (payload) => ipcRenderer.invoke('zhihu-fav-batch:run', payload),
    zhihuFavBatchCancel: () => ipcRenderer.invoke('zhihu-fav-batch:cancel'),
    onZhihuFavBatchProgress: (callback) => {
      const listener = (_event, progress) => callback(progress)
      ipcRenderer.on('zhihu-fav-batch:progress', listener)
      return () => ipcRenderer.removeListener('zhihu-fav-batch:progress', listener)
    },
    // 知乎 API 配置（设置页「设置 → 知乎 API」）：
    //   getConfig 只回遮罩与状态（永不回明文）；saveConfig 明文只在这一次调用里出现；
    //   testConnection 可传未保存的值（不落盘）或留空测已存配置。
    zhihuGetConfig: () => ipcRenderer.invoke('zhihu:get-config'),
    zhihuSaveConfig: (accessSecret) => ipcRenderer.invoke('zhihu:save-config', accessSecret),
    zhihuTestConnection: (accessSecret) => ipcRenderer.invoke('zhihu:test-connection', accessSecret),
    zhihuClearConfig: () => ipcRenderer.invoke('zhihu:clear-config'),
  }
}

module.exports = { createAggregationApi }
