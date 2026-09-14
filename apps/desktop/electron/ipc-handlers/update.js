// @ts-check
function registerHandlers(ipcMain, deps) {
  const EC = require('../core/error-codes').ERROR
  const log = require('../services/logger')
  const { withSenderCheck } = require('./helpers')
  const { autoUpdater } = deps

  ipcMain.handle('update:check', async () => {
    try {
      autoUpdater.check()
      return { code: 0, data: true }
    } catch (e) { log.warn('[ipc:update]', ((e && e.message) || String(e))); return { code: EC.REQUEST_ERROR, message: e.message } }
  })

  ipcMain.handle('update:download', withSenderCheck(async () => {
    try {
      autoUpdater.download()
      return { code: 0, data: true }
    } catch (e) { log.warn('[ipc:update]', ((e && e.message) || String(e))); return { code: EC.REQUEST_ERROR, message: e.message } }
  }))

  ipcMain.handle('update:install', withSenderCheck(async () => {
    try {
      autoUpdater.quitAndInstall()
      return { code: 0, data: true }
    } catch (e) { log.warn('[ipc:update]', ((e && e.message) || String(e))); return { code: EC.REQUEST_ERROR, message: e.message } }
  }))

  // 侧边栏「新版本」按钮：未下载则先下载，下载完成后自动退出并安装
  ipcMain.handle('update:install-now', withSenderCheck(async () => {
    try {
      return { code: 0, data: autoUpdater.installNow() }
    } catch (e) { log.warn('[ipc:update]', ((e && e.message) || String(e))); return { code: EC.REQUEST_ERROR, message: e.message } }
  }))
}

module.exports = registerHandlers
