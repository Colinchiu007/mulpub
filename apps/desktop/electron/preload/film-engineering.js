// @ts-check
/**
 * 影视工程 preload API
 * window.electronAPI.filmEngineering.{ status, listScenes, listShots, getShot, doctrine,
 *   copyText, copyTexts, adaptScript, exportPrompts, generateSelected, retryShot,
 *   downloadRecycled }
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
      retryShot: (payload) => ipcRendererRef.invoke('film-engineering:retry-shot', payload),
      downloadRecycled: (payload) => ipcRendererRef.invoke('film-engineering:download-recycled', payload),
    },
  }
}

module.exports = { createFilmEngineeringApi }
