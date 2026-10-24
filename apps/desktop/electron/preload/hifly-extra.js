'use strict'

/**
 * 飞影 11 个扩展端点的 preload API（change: hifly-full-api-ui）。
 *
 * 聚合入口通过展开返回值接入 `window.electronAPI`；这里只暴露固定通道，
 * 不提供通用 invoke —— 与 avatar-clone 同型，避免渲染层拿到任意通道的调用能力。
 */
function createHiflyExtraApi (ipcRenderer) {
  return {
    hiflyExtra: {
      // 辅助（免费）
      credit: () => ipcRenderer.invoke('hifly-extra:credit', {}),
      livelyTemplates: (input) => ipcRenderer.invoke('hifly-extra:lively-templates', input),
      coverStyles: (input) => ipcRenderer.invoke('hifly-extra:cover-styles', input),
      createCover: (input) => ipcRenderer.invoke('hifly-extra:create-cover', input),
      deleteWork: (input) => ipcRenderer.invoke('hifly-extra:delete-work', input),
      // 6 个收费创作模式
      createByAudio: (input) => ipcRenderer.invoke('hifly-extra:create-by-audio', input),
      createByTemplate: (input) => ipcRenderer.invoke('hifly-extra:create-by-template', input),
      translate: (input) => ipcRenderer.invoke('hifly-extra:translate', input),
      createBySing: (input) => ipcRenderer.invoke('hifly-extra:create-by-sing', input),
      createByImage: (input) => ipcRenderer.invoke('hifly-extra:create-by-image', input),
      audioTts: (input) => ipcRenderer.invoke('hifly-extra:audio-tts', input),
    },
  }
}

module.exports = { createHiflyExtraApi }
