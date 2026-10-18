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

  // 引导退出确认（阶段 1.4）：完成标记只有这一条写入路径。
  // 写盘失败必须如实回错误码——若吞掉并返回成功，下次启动依旧不进向导，
  // 而渲染层会以为"用户已看过引导"，等于把标记写入的失败伪装成用户主动跳过。
  ipcMain.handle('first-run:complete', async () => {
    try {
      const res = firstRun.markDone()
      if (!res || res.done !== true) {
        return { code: EC.REQUEST_ERROR, message: (res && res.error) || 'MARKER_WRITE_FAILED' }
      }
      return { code: 0, data: { setupDone: true } }
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
