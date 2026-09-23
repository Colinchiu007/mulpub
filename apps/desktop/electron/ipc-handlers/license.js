// @ts-check
/**
 * License IPC handlers
 * License/Pro features management
 *
 * 安全：activate/deactivate/activate-trial 为敏感操作，通过 withSenderCheck 校验来源
 *
 * Bug-2 三级分离：注册 auth:get-access-level 同步 IPC，供 preload/index.js 查询访问级别
 */
function registerHandlers(ipcMain, deps) {
  const EC = require('../core/error-codes').ERROR
  const log = require('../services/logger')
  const { withSenderCheck } = require('./helpers')
  const { isTrustedSender } = require('../core/ipc-security')
  const { getAccessLevel } = require('./license-access-control')
  const { ACCESS_LEVEL_CHANNEL } = require('../core/access-level')
  const { emitAccessLevelInvalidated } = require('../services/access-level-bus')
  const { licenseManager } = deps

  ipcMain.handle("license:info", async () => {
    try {
      return { code: 0, data: licenseManager.getInfo() }
    } catch (e) { log.warn('[ipc:license]', ((e && e.message) || String(e))); return { code: EC.REQUEST_ERROR, message: e.message } }
  })

  ipcMain.handle("license:activate", withSenderCheck(async (event, licenseKey) => {
    try {
      const ok = licenseManager.activate(licenseKey)
      // 审计 P2·性能税：preload 的级别缓存必须在此失效，否则升级最长要等一个 TTL 才生效
      if (ok) emitAccessLevelInvalidated('license-activate')
      return ok ? { code: 0, data: true, message: "激活成功" } : { code: EC.REQUEST_ERROR, data: false, message: "激活失败，许可证可能已被使用" }
    } catch (e) { log.warn('[ipc:license]', ((e && e.message) || String(e))); return { code: EC.REQUEST_ERROR, message: e.message } }
  }))

  ipcMain.handle("license:deactivate", withSenderCheck(async (event) => {
    try {
      licenseManager.deactivate()
      emitAccessLevelInvalidated('license-deactivate')
      return { code: 0, data: true, message: "已注销" }
    } catch (e) { log.warn('[ipc:license]', ((e && e.message) || String(e))); return { code: EC.REQUEST_ERROR, message: e.message } }
  }))

  ipcMain.handle("license:activate-trial", withSenderCheck(async (event) => {
    try {
      const ok = licenseManager.activateTrial()
      if (ok) emitAccessLevelInvalidated('license-activate-trial')
      return ok ? { code: 0, data: true, message: "试用已激活，有效期 7 天" } : { code: EC.REQUEST_ERROR, data: false, message: "无法激活试用" }
    } catch (e) { log.warn('[ipc:license]', ((e && e.message) || String(e))); return { code: EC.REQUEST_ERROR, message: e.message } }
  }))

  ipcMain.handle("license:has-feature", async (event, featureName) => {
    try {
      return { code: 0, data: licenseManager.hasFeature(featureName) }
    } catch (e) { log.warn('[ipc:license]', ((e && e.message) || String(e))); return { code: EC.REQUEST_ERROR, message: e.message } }
  })

  ipcMain.handle("license:features", async () => {
    try {
      return { code: 0, data: licenseManager.getFeatures() }
    } catch (e) { log.warn('[ipc:license]', ((e && e.message) || String(e))); return { code: EC.REQUEST_ERROR, message: e.message, data: [] } }
  })

  // Bug-2 三级分离：同步 IPC 供 preload 查询访问级别
  // 返回 'public' | 'authenticated' | 'admin'
  // 安全：同步 IPC 不走 controlledIpcMain Proxy，需手动校验 sender 来源
  //
  // Bug fix (QM-5): 开发模式 admin 短路必须与异步 IPC (license-access-control.js getAccessLevel) 保持一致。
  // 之前同步 IPC 直接调用 isTrustedSender，未走 dev 短路，导致开发环境下 preload sendSync 拿到 'public'，
  // 所有 authenticated 级别方法（storeGetPublishStats / onRenderProgress 等）被错误拦截。
  // 根因：同步 IPC 与异步 IPC 的权限校验路径不一致。
  ipcMain.on(ACCESS_LEVEL_CHANNEL, (event) => {
    // Bug fix (QM-5 v2): dev 短路判断必须与项目其他模块一致！
    // window.js:216 用 `!app.isPackaged` 作为 dev 判断，license-access-control.js 和本文件
    // 之前用 `NODE_ENV === 'development'`，但 npm script 没有设置该变量，导致 dev 短路不生效。
    // 修复：直接用 `!app.isPackaged` 作为 dev 判断，与项目保持一致。
    const app = deps && deps.app
    const isDevMode = app && app.isPackaged === false
    if (isDevMode) {
      event.returnValue = 'admin'
      return
    }
    if (!isTrustedSender(event, app)) {
      // 不可信来源返回最低权限，防止外部页面探测许可证状态
      event.returnValue = 'public'
      return
    }
    try {
      event.returnValue = getAccessLevel(licenseManager, process.env, app, deps && deps.identityService)
    } catch (e) {
      event.returnValue = 'public'
    }
  })
}

module.exports = registerHandlers
