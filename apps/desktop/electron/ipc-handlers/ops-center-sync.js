// @ts-check
/**
 * ops-center-sync IPC handlers — 运营后台同步配置与手动同步
 */

function registerHandlers (ipcMain, deps) {
  const { opsCenterSync, log } = deps
  if (!opsCenterSync) {
    log && log.warn('OpsCenterSync', 'opsCenterSync service not provided')
    return
  }

  ipcMain.handle('ops-center-sync:get', () => {
    try { return { code: 0, config: opsCenterSync.getConfig() } }
    catch (e) { log.warn('[ipc:ops-center-sync]', ((e && e.message) || String(e))); return { code: -1, message: e.message } }
  })

  ipcMain.handle('ops-center-sync:save', (_event, payload) => {
    try {
      const data = (payload && typeof payload === 'object') ? payload : {}
      return opsCenterSync.saveConfig({
        url: data.url,
        apiKey: data.apiKey,
        autoSync: data.autoSync !== false,
        runtimePublicKey: data.runtimePublicKey,
      })
    } catch (e) { log.warn('[ipc:ops-center-sync]', ((e && e.message) || String(e))); return { code: -1, message: e.message } }
  })

  ipcMain.handle('ops-center-sync:now', async () => {
    try { return await opsCenterSync.syncNow() }
    catch (e) { log.warn('[ipc:ops-center-sync]', ((e && e.message) || String(e))); return { code: -1, message: e.message } }
  })

  ipcMain.handle('ops-center-sync:runtime', () => {
    try {
      if (typeof opsCenterSync.getRuntimeState !== 'function') return { code: -1, message: '运行时策略服务未就绪' }
      return { code: 0, data: opsCenterSync.getRuntimeState() }
    } catch (e) { log.warn('[ipc:ops-center-sync]', ((e && e.message) || String(e))); return { code: -1, message: e.message } }
  })

  ipcMain.handle('ops-center-sync:pipelineOptions', () => {
    try {
      if (typeof opsCenterSync.getPipelineOptions !== 'function') return { code: -1, message: '运行时策略服务未就绪' }
      return { code: 0, data: opsCenterSync.getPipelineOptions() }
    } catch (e) { log.warn('[ipc:ops-center-sync]', ((e && e.message) || String(e))); return { code: -1, message: e.message } }
  })

  // 应用端左侧边栏菜单配置（2026-09-15）：运营中心「应用菜单」下发的显示/隐藏与排序。
  // data 为 null 表示本轮无有效配置，渲染端据此 fail-open 回退本地默认菜单。
  ipcMain.handle('ops-center-sync:appMenu', () => {
    try {
      if (typeof opsCenterSync.getAppMenu !== 'function') return { code: -1, message: '运行时策略服务未就绪' }
      return { code: 0, data: opsCenterSync.getAppMenu() }
    } catch (e) { log.warn('[ipc:ops-center-sync]', ((e && e.message) || String(e))); return { code: -1, message: e.message } }
  })
}

module.exports = { registerHandlers }