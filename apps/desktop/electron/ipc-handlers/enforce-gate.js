// @ts-check
/**
 * enforce-gate IPC（forced-update-gate 2026-10-19）。
 * 弹窗 preload 只需要四个通道：文案（sendSync，首帧可用）、升级、重试、状态回放。
 */
function registerHandlers (ipcMain, deps) {
  const { enforceGate } = deps || {}
  if (!enforceGate) return // 测试环境未装配时静默跳过（与 approval-gate 同模式）

  const log = require('../services/logger')
  // QM-6 i5 修复：文案直读主进程字典（编译期常量，不依赖 deps.gateTexts 注入——
  // 此前 phase5 deps 无该键 → get-texts 恒 null → gate 渲染层解构 TypeError 白屏）
  const { readGateText } = require('../services/enforce-gate-text')
  const locale = (deps.gateLocale != null) ? deps.gateLocale : 'zh-CN'

  ipcMain.on('enforce-gate:get-texts', (event) => {
    event.returnValue = readGateText(locale)
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
