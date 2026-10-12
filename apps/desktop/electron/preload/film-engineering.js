// @ts-check
/**
 * 影视工程 preload API
 * window.electronAPI.filmEngineering.{ status, listScenes, listShots, getShot, doctrine,
 *   copyText, copyTexts, adaptScript, exportPrompts, generateSelected, uploadReference, retryShot,
 *   productionRetryShot,
 *   downloadRecycled, productionPlan, productionRunBatch, productionStatus,
 *   onProductionUpdate }（production-update 事件返回 unsubscribe 函数）
 *
 * 「自动」模式（film-auto-mode）：autoPlan, autoStart, autoStatus, autoUpdateShot,
 *   autoRegenerateShot, autoCompose, onAutoUpdate（film-engineering:auto-update 事件，返回 unsubscribe）。
 * 契约：auto-start **不接受**分镜/参考图负载（服务端以自己落盘的计划重建），只收 { planId, taskId, confirmed, overwrite }；
 * 写入前若需重新确认（编辑晚于确认 / 载荷哈希变化），返回 data.needsReconfirm，渲染端弹确认卡后带 confirmed:true 重试。
 * 所有方法返回主进程统一信封 { code, data?, message?, errorCode? }（code === 0 为成功）。
 */
const { ipcRenderer } = require('electron')

function createFilmEngineeringApi (ipcRendererRef = ipcRenderer) {
  return {
    filmEngineering: {
      status: () => ipcRendererRef.invoke('film-engineering:status'),
      listScenes: () => ipcRendererRef.invoke('film-engineering:list-scenes'),
      listShots: (sceneId, pageOpts) => ipcRendererRef.invoke('film-engineering:list-shots', sceneId, pageOpts),
      getShot: (shotId) => ipcRendererRef.invoke('film-engineering:get-shot', shotId),
      doctrine: () => ipcRendererRef.invoke('film-engineering:doctrine'),
      copyText: (shotId, mode) => ipcRendererRef.invoke('film-engineering:copy-text', shotId, mode),
      copyTexts: (shotIds, mode) => ipcRendererRef.invoke('film-engineering:copy-texts', shotIds, mode),
      adaptScript: (payload) => ipcRendererRef.invoke('film-engineering:adapt-script', payload),
      exportPrompts: (selectedShots, format) => ipcRendererRef.invoke('film-engineering:export', selectedShots, format),
      generateSelected: (selectedShots, opts) => ipcRendererRef.invoke('film-engineering:generate-selected', selectedShots, opts),
      uploadReference: (payload) => ipcRendererRef.invoke('film-engineering:upload-reference', payload),
      retryShot: (payload) => ipcRendererRef.invoke('film-engineering:retry-shot', payload),
      productionRetryShot: (payload) => ipcRendererRef.invoke('film-engineering:production-retry-shot', payload),
      downloadRecycled: (payload) => ipcRendererRef.invoke('film-engineering:download-recycled', payload),
      productionPlan: (payload) => ipcRendererRef.invoke('film-engineering:production-plan', payload),
      productionRunBatch: (payload) => ipcRendererRef.invoke('film-engineering:production-run-batch', payload),
      productionStatus: (payload) => ipcRendererRef.invoke('film-engineering:production-status', payload),
      onProductionUpdate: (callback) => { const h = (_e, p) => callback(p); ipcRendererRef.on('film-engineering:production-update', h); return () => ipcRendererRef.removeListener('film-engineering:production-update', h) },
      // ── 自动模式 ──────────────────────────────────────────────────────
      autoPlan: (payload) => ipcRendererRef.invoke('film-engineering:auto-plan', payload),
      autoStart: (payload) => ipcRendererRef.invoke('film-engineering:auto-start', payload),
      autoStop: (payload) => ipcRendererRef.invoke('film-engineering:auto-stop', payload),
      autoStatus: (payload) => ipcRendererRef.invoke('film-engineering:auto-status', payload),
      autoUpdateShot: (payload) => ipcRendererRef.invoke('film-engineering:auto-update-shot', payload),
      autoRegenerateShot: (payload) => ipcRendererRef.invoke('film-engineering:auto-regenerate-shot', payload),
      autoCompose: (payload) => ipcRendererRef.invoke('film-engineering:auto-compose', payload),
      onAutoUpdate: (callback) => { const h = (_e, p) => callback(p); ipcRendererRef.on('film-engineering:auto-update', h); return () => ipcRendererRef.removeListener('film-engineering:auto-update', h) },
    },
  }
}

module.exports = { createFilmEngineeringApi }
