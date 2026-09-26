'use strict'
/**
 * 签名页主进程装配（W3 task 2.4，桌面侧唯一接线点）
 *
 * bootstrap phase5 调用 registerSignerAssembly 时经本模块取用真实 Electron 依赖：
 * - provider 单例与引擎（@multi-publish/api-publish-engine/src/signer/browser-page-provider）
 *   保持同一模块实例（主进程 require 缓存命中，rpa-view-manager 消费方同源）
 * - BrowserWindow 经闭包注入（避免 electron 顶层 require 污染离线测试）
 * - timeoutMs 对齐 #2363 CDP 挂起超时降级经验（15s）
 */
const log = require('../services/logger')
const { app } = require('electron')
const { isTrustedSender } = require('../core/ipc-security')
const { createSignerPageManager } = require('./signer-page-manager')
const { createSignerAssembly, registerSignerAssembly } = require('./signer-assembly')

let wired = null

/**
 * 在 app ready 后由 bootstrap 调用（controlledIpcMain 已过访问控制咽喉点）。
 * @param {{ ipcMain: object, BrowserWindow: Function }} electronDeps
 */
function setupSignerAssembly (electronDeps) {
  if (wired) return wired
  const { ipcMain, BrowserWindow } = electronDeps
  // 与引擎发布链同一 provider 单例（design §1：装配层注入 bridge）
  const { browserPageProvider } = require('@multi-publish/api-publish-engine/src/signer')
  const manager = createSignerPageManager({ BrowserWindow })
  const assembly = createSignerAssembly({
    BrowserWindow,
    log: { info: (a, m) => log.info(a, m), warn: (a, m) => log.warn(a, m), error: (a, m) => log.error(a, m) },
    timeoutMs: 15000,
  })
  // Gate 17：prewarm 注册点显式 sender 校验（主进程内闭包，app 延迟求值）
  wired = registerSignerAssembly({
    manager, provider: browserPageProvider, ipcMain, assembly, log,
    isTrustedSender: (event) => isTrustedSender(event, app),
  })
  return wired
}

/** 发布链求签前绑定账号登录 cookie（in-proc，cookie 明文绝不经 renderer IPC 往返） */
function bindSignerCookie (platform, accountId, cookieHeader) {
  if (!wired || !wired.assembly) return false
  return wired.assembly.bindCookie(platform, accountId, cookieHeader)
}

/** 测试/热重载复位（生产不调用） */
function __resetSignerAssemblyForTest () {
  try { if (wired && wired.assembly) wired.assembly.dispose() } catch (_e) { /* ignore */ }
  wired = null
}

module.exports = { setupSignerAssembly, bindSignerCookie, __resetSignerAssemblyForTest }
