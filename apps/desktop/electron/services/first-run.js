// @ts-check
/**
 * 首次运行引导（单一真源）
 *
 * P2-E: 移除了 Playwright 浏览器检查逻辑。RpaViewManager 无需额外浏览器资源。
 *
 * UX-AUDIT 阶段 1.4 / audit-4 的两处收敛：
 *  1. 完成标记 **不再由启动流程自动写**。旧实现每次启动无条件
 *     `writeFileSync('first-run-done')`，于是渲染进程问 `first-run:check` 时永远是 true，
 *     `/first-run` 向导因此零入口（"建好了但从未接上电"）。现在只有 `markDone()` 会写，
 *     调用方是用户退出向导（或显式跳过）时的 `first-run:complete` IPC。
 *  2. 删掉 `first-run:status` 推送通道与 `runSetup`。该通道只有"启动时一次性状态"，
 *     而状态本身可由 `first-run:check` 随时读；推送在窗口创建时发出、SPA 挂载前无人监听，
 *     属于"写了没人读"的第二套真相。判定统一走拉取（见 src/composables/useFirstRunGate.js）。
 *
 * 同族收敛：仓内曾有第二个引导服务 `services/onboarding.js`（标记 `onboarding-done`），
 * 其 `completeOnboarding()` 全仓零写点，已一并删除；本模块是引导状态的唯一持有者。
 */
const { app } = require('electron')
const fs = require('fs')
const path = require('path')
const log = require('./logger')

const MARKER_FILE = 'first-run-done'

function markerPath () {
  return path.join(app.getPath('userData'), MARKER_FILE)
}

function isSetupDone () {
  return fs.existsSync(markerPath())
}

function reset () {
  const p = markerPath()
  if (fs.existsSync(p)) fs.unlinkSync(p)
}

/**
 * 写入完成标记（唯一写点，由引导退出动作触发）。
 * @returns {{done: boolean, error?: string}}
 */
function markDone () {
  try {
    fs.writeFileSync(markerPath(), `done:${new Date().toISOString()}`)
    log.info('firstRun', 'Onboarding acknowledged')
    return { done: true }
  } catch (/** @type {any} */ e) {
    log.error('firstRun', 'Failed to write first-run marker:', e.message)
    return { done: false, error: e.message }
  }
}

function checkDeps () {
  return { setupDone: isSetupDone() }
}

module.exports = { isSetupDone, markDone, reset, checkDeps }
