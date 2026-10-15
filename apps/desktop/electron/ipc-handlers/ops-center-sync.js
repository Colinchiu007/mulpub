// @ts-check
/**
 * ops-center-sync IPC handlers — 运营后台下发的运行时策略通道
 *
 * 2026-10-15 收敛：`get` / `save` / `now` 三条通道已删除。原因是「运营中心同步配置」
 * 表单自 #3543 起从界面撤下（零配置化：地址走部署层 identity-public.json + Logto JWT），
 * 渲染端对这三个封装的调用数经 `git grep` 盘点为 **0**（只剩 api/ 封装自身），
 * 而它们携带的 `getConfig().url` 别名与 `saveConfig` 固化护栏在应用内已无触发路径。
 * 保留的三条（runtime / pipelineOptions / appMenu）是运营下发的运行时策略，
 * 渲染端分别有 18 / 4 / 5 处真实调用。
 *
 * 删除前取证（`git grep <api> origin/main -- apps/desktop/src`，排除 src/api/ 自身）：
 *   opsCenterSyncGet 0、opsCenterSyncSave 0、opsCenterSyncNow 0
 *   opsCenterSyncRuntime 18、opsCenterSyncPipelineOptions 4、opsCenterSyncAppMenu 5
 */

function registerHandlers (ipcMain, deps) {
  const { opsCenterSync, log } = deps
  if (!opsCenterSync) {
    log && log.warn('OpsCenterSync', 'opsCenterSync service not provided')
    return
  }

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