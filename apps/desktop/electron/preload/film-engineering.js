// @ts-check
/**
 * 影视工程 preload API
 * window.electronAPI.filmEngineering.{ status, listScenes, listShots, getShot, doctrine,
 *   copyText, copyTexts, adaptScript, exportPrompts, generateSelected, uploadReference, retryShot,
 *   downloadRecycled, productionPlan, productionRunBatch, productionStatus,
 *   onProductionUpdate }（production-update 事件返回 unsubscribe 函数）
 * 所有方法返回主进程统一信封 { code, data?, message? }（code === 0 为成功）。
 */
const { ipcRenderer } = require('electron')

function createFilmEngineeringApi (ipcRendererRef = ipcRenderer) {
  return {
    filmEngineering: {
      status: () => ipcRendererRef.invoke('film-engineering:status'),
      listScenes: () => ipcRendererRef.invoke('film-engineering:list-scenes'),
      listShots: (sceneId) => ipcRendererRef.invoke('film-engineering:list-shots', sceneId),
      getShot: (shotId) => ipcRendererRef.invoke('film-engineering:get-shot', shotId),
      doctrine: () => ipcRendererRef.invoke('film-engineering:doctrine'),
      copyText: (shotId, mode) => ipcRendererRef.invoke('film-engineering:copy-text', shotId, mode),
      copyTexts: (shotIds, mode) => ipcRendererRef.invoke('film-engineering:copy-texts', shotIds, mode),
      adaptScript: (payload) => ipcRendererRef.invoke('film-engineering:adapt-script', payload),
      exportPrompts: (selectedShots, format) => ipcRendererRef.invoke('film-engineering:export', selectedShots, format),
      generateSelected: (selectedShots, opts) => ipcRendererRef.invoke('film-engineering:generate-selected', selectedShots, opts),
      uploadReference: (payload) => ipcRendererRef.invoke('film-engineering:upload-reference', payload),
      retryShot: (payload) => ipcRendererRef.invoke('film-engineering:retry-shot', payload),
      downloadRecycled: (payload) => ipcRendererRef.invoke('film-engineering:download-recycled', payload),
      productionPlan: (payload) => ipcRendererRef.invoke('film-engineering:production-plan', payload),
      productionRunBatch: (payload) => ipcRendererRef.invoke('film-engineering:production-run-batch', payload),
      productionStatus: (payload) => ipcRendererRef.invoke('film-engineering:production-status', payload),
      onProductionUpdate: (callback) => { const h = (_e, p) => callback(p); ipcRendererRef.on('film-engineering:production-update', h); return () => ipcRendererRef.removeListener('film-engineering:production-update', h) },
    },
  }
}

module.exports = { createFilmEngineeringApi }
