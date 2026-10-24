// @ts-check
function registerHandlers(ipcMain, deps) {
  const EC = require('../core/error-codes').ERROR
  // eslint-disable-next-line no-unused-vars
  const { app, hotkeys, firstRun, BrowserWindow, log } = deps

  ipcMain.handle('app:get-version', () => {
    try {
      // 直接从 package.json 读取版本号，避免 Electron 开发模式下 app.getVersion() 返回错误值
      const pkg = require('../../package.json')
      return { code: 0, data: pkg.version || app.getVersion() }
    } catch (e) { log.warn('[ipc:misc]', ((e && e.message) || String(e))); return { code: EC.REQUEST_ERROR, message: e.message } }
  })
  ipcMain.handle('app:get-platform', () => {
    try {
      return { code: 0, data: process.platform }
    } catch (e) { log.warn('[ipc:misc]', ((e && e.message) || String(e))); return { code: EC.REQUEST_ERROR, message: e.message } }
  })

  ipcMain.handle('hotkeys:list', async () => {
    try {
      return { code: 0, data: hotkeys.getShortcuts() }
    } catch (e) { log.warn('[ipc:misc]', ((e && e.message) || String(e))); return { code: EC.REQUEST_ERROR, message: e.message, data: [] } }
  })

  ipcMain.handle('first-run:check', async () => {
    try {
      return { code: 0, data: firstRun.checkDeps() }
    } catch (e) { log.warn('[ipc:misc]', ((e && e.message) || String(e))); return { code: EC.REQUEST_ERROR, message: e.message } }
  })

  // 首启完成标记的唯一写入口（向导上的「完成」/「跳过」）。
  // 必须同批登记 license-access-control.js 的 PUBLIC_CHANNELS 与 preload 导出，
  // 少任一处的症状是"点了没反应且没有错误"（由 electron/services/first-run.test.js 锁三处配对）。
  ipcMain.handle('first-run:complete', async () => {
    try {
      const res = firstRun.markDone()
      if (!res || !res.ok) {
        return { code: EC.REQUEST_ERROR, message: (res && res.message) || 'first-run mark failed' }
      }
      return { code: 0, data: { setupDone: true, reused: Boolean(res.reused) } }
    } catch (e) { log.warn('[ipc:misc]', ((e && e.message) || String(e))); return { code: EC.REQUEST_ERROR, message: e.message } }
  })

  ipcMain.handle('show-notification', async (_, data) => {
    try {
      const win = BrowserWindow.getAllWindows()[0]
      if (win && !win.isDestroyed()) {
        win.webContents.send('notification', data)
      }
      return { code: 0, data: true }
    // eslint-disable-next-line no-unused-vars
    } catch (e) { log.warn('[ipc:misc]', ((e && e.message) || String(e))); return { code: EC.REQUEST_ERROR, message: e.message } }
  })
}

module.exports = registerHandlers
