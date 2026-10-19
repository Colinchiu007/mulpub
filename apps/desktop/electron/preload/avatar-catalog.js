'use strict'

/**
 * 数字人形象/音色目录 preload API。
 * 聚合入口通过展开返回值接入 `window.electronAPI`；这里只暴露固定通道，
 * 不提供通用 invoke。
 */
function createAvatarCatalogApi (ipcRenderer) {
  return {
    avatarCatalog: {
      avatars: (input) => ipcRenderer.invoke('avatar-catalog:avatars', input),
      voices: (input) => ipcRenderer.invoke('avatar-catalog:voices', input),
      invalidate: (input) => ipcRenderer.invoke('avatar-catalog:invalidate', input),
    },
  }
}

module.exports = { createAvatarCatalogApi }
