'use strict'
/**
 * enforce-gate 弹窗 preload（contextIsolation 桥）。
 * 只暴露四个最小面：文案、升级、重试、状态订阅——不给 Node/IPC 原始句柄。
 */
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('enforceGate', {
  texts: ipcRenderer.sendSync('enforce-gate:get-texts'),
  upgrade: () => ipcRenderer.send('enforce-gate:upgrade'),
  retryVerify: () => ipcRenderer.send('enforce-gate:retry-verify'),
  requestState: () => ipcRenderer.send('enforce-gate:request-state'),
  onState: (cb) => ipcRenderer.on('enforce-gate:state', (_e, payload) => cb(payload)),
  onProgress: (cb) => ipcRenderer.on('enforce-gate:progress', (_e, payload) => cb(payload)),
})
