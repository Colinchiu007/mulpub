'use strict'

/**
 * 数字人形象克隆 preload API。
 * 聚合入口通过展开返回值接入 `window.electronAPI`；这里只暴露固定通道，
 * 不提供通用 invoke。
 */
function createAvatarCloneApi (ipcRenderer) {
  return {
    avatarClone: {
      list: (input) => ipcRenderer.invoke('avatar-clone:list', input),
      chooseMedia: (input) => ipcRenderer.invoke('avatar-clone:choose-media', input),
      add: (input) => ipcRenderer.invoke('avatar-clone:add', input),
      delete: (input) => ipcRenderer.invoke('avatar-clone:delete', input),
      rename: (input) => ipcRenderer.invoke('avatar-clone:rename', input),
    },
  }
}

module.exports = { createAvatarCloneApi }
