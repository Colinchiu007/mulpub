// @ts-check
/**
 * enforce-gate IPC（forced-update-gate 2026-10-19）。
 * 弹窗 preload 只需要四个通道：文案（sendSync，首帧可用）、升级、重试、状态回放。
 */
function registerHandlers (ipcMain, deps) {
  const { enforceGate } = deps || {}
  if (!enforceGate) return // 测试环境未装配时静默跳过（与 approval-gate 同模式）

  const log = require('../services/logger')

  ipcMain.on('enforce-gate:get-texts', (event) => {
    event.returnValue = deps.gateTexts || null
  })

  ipcMain.on('enforce-gate:upgrade', () => {
    try { enforceGate.upgrade() } catch (e) {
      log.warn('[ipc:enforce-gate]', ((e && e.message) || String(e)))
    }
  })

  ipcMain.on('enforce-gate:retry-verify', () => {
    try { enforceGate.retryVerify() } catch (e) {
      log.warn('[ipc:enforce-gate]', ((e && e.message) || String(e)))
    }
  })

  ipcMain.on('enforce-gate:request-state', (event) => {
    try {
      event.sender.send('enforce-gate:state', {
        decision: enforceGate.lastDecision ? enforceGate.lastDecision() : null,
        text: null,
      })
    } catch (e) {
      log.warn('[ipc:enforce-gate]', ((e && e.message) || String(e)))
    }
  })
}

module.exports = registerHandlers
