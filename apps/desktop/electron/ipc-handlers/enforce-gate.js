// @ts-check
/**
 * enforce-gate IPC（forced-update-gate 2026-10-19）。
 * 弹窗 preload 只需要四个通道：文案（sendSync，首帧可用）、升级、重试、状态回放。
 *
 * QM-6 Gate 17 修复：四个 on() 同步通道逐个显式 isTrustedSender 校验——
 * upgrade 是"退出并安装"级状态变更通道，来源校验天经地义；get-texts/
 * request-state 只读，但统一守卫保持同一口径（扫描器零豁免登记）。
 * 守卫调用必须写在 handler 体内（扫描器按 handler 文本匹配 isTrustedSender）。
 */
const { isTrustedSender } = require('../core/ipc-security')

function registerHandlers (ipcMain, deps) {
  const { enforceGate } = deps || {}
  if (!enforceGate) return // 测试环境未装配时静默跳过（与 approval-gate 同模式）

  const log = require('../services/logger')
  const app = deps && deps.app
  // QM-6 i5 修复：文案直读主进程字典（编译期常量，不依赖 deps.gateTexts 注入——
  // 此前 phase5 deps 无该键 → get-texts 恒 null → gate 渲染层解构 TypeError 白屏）
  const { readGateText } = require('../services/enforce-gate-text')
  // QM-6 第二轮 i3 修复：locale 从状态机取（assembly 已正确取 app.getLocale()），
  // 删除无注入点的 deps.gateLocale 死键（恒默认 zh-CN → EN 系统显示中文）
  const locale = (typeof enforceGate.getLocale === 'function') ? enforceGate.getLocale() : 'en'

  ipcMain.on('enforce-gate:get-texts', (event) => {
    // 来源校验（QM-6 Gate 17）：gate 窗是唯一合法调用方
    if (!isTrustedSender(event, app)) { event.returnValue = null; return }
    event.returnValue = readGateText(locale)
  })

  ipcMain.on('enforce-gate:upgrade', (event) => {
    if (!isTrustedSender(event, app)) return
    try { enforceGate.upgrade() } catch (e) {
      log.warn('[ipc:enforce-gate]', ((e && e.message) || String(e)))
    }
  })

  ipcMain.on('enforce-gate:retry-verify', (event) => {
    if (!isTrustedSender(event, app)) return
    try { enforceGate.retryVerify() } catch (e) {
      log.warn('[ipc:enforce-gate]', ((e && e.message) || String(e)))
    }
  })

  ipcMain.on('enforce-gate:request-state', (event) => {
    if (!isTrustedSender(event, app)) return
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
