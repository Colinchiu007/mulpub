'use strict'
/**
 * enforce-gate 装配器（forced-update-gate，2026-10-19）。
 *
 * 从 phase1-context.js 抽出（债务熔断 filesOver500：phase1 507 行 + 63 行装配
 * = 570 超出基线，抽出后 phase1 回到基线内）。职责：把 enforce-gate 状态机
 * 与真实 Electron app / ops-center-sync / auto-updater 绑定起来。
 *
 * 单测 mock 环境（app.getPath 缺失）跳过装配并 WARN 出声——断言覆盖由
 * enforce-gate.test.js（deps 注入）+ 契约锁承担。
 */
const { enforceGateStatePaths, createNodeFileFacades } = require('./enforce-gate-fs')
const enforceGate = require('./enforce-gate')

/**
 * 装配 enforce-gate（phase1 调用一次）。
 * @param {object} ctx { app, opsCenterSync, autoUpdater, log }
 */
function assembleEnforceGate ({ app, opsCenterSync, autoUpdater, log }) {
  const enforceGate = require('./enforce-gate') // 延迟 require：单测 mock 环境不触碰单例
  const electronAppReady = !!(app && typeof app.getPath === 'function' && typeof app.getVersion === 'function')
  if (!electronAppReady) {
    log.notify('EnforceGate', 'skip-assembly-no-electron-app', { level: 'WARN', error: 'electron app 不可用（单测 mock 环境），跳过 enforce-gate 装配' })
    return false
  }
  const paths = enforceGateStatePaths(app)
  enforceGate.init({
    appVersion: () => app.getVersion(),
    now: () => Date.now(),
    monotonicMs: () => process.hrtime.bigint() / 1000000,
    stateFile: paths.stateFile,
    // 单测 electron mock 无 getLocale（实测 60 例红）；防御式取值，缺方法回 'en'
    locale: (typeof app.getLocale === 'function' && app.getLocale()) || 'en',
    gatePreloadPath: paths.preloadPath,
    ...createNodeFileFacades(),
    createGateWindow: (opts) => {
      const { BrowserWindow } = require('electron')
      const win = new BrowserWindow({ ...opts, alwaysOnTop: true })
      try { win.setAlwaysOnTop(true, 'screen-saver') } catch (e) { /* 旧版本无级别参数 */ }
      return win
    },
    loadGatePage: (win) => win.loadFile(paths.gateHtmlPath),
    // 主窗 hide/show 由 window.js 在创建主窗口后注入 setMainWindowFacade（getMainWin 依赖层在 phase1 之外）
    hideMainWindow: () => { try { const fn = enforceGate.getMainWindowFacade(); const w = fn && fn(); if (w && !w.isDestroyed()) { w.__enforceGateHidden = true; w.hide() } } catch (e) { log.notify('EnforceGate', 'hide-main-failed', { level: 'WARN', error: String(e && e.message) }) } },
    showMainWindow: () => { try { const fn = enforceGate.getMainWindowFacade(); const w = fn && fn(); if (w && !w.isDestroyed()) { w.__enforceGateHidden = false; w.show() } } catch (e) { log.notify('EnforceGate', 'show-main-failed', { level: 'WARN', error: String(e && e.message) }) } },
    wasMainWindowHidden: () => { try { const fn = enforceGate.getMainWindowFacade(); const w = fn && fn(); return !!(w && !w.isDestroyed() && w.__enforceGateHidden) } catch (e) { return false } },
    log: { warn: (msg, extra) => log.notify('EnforceGate', 'state-persist-failed', { level: 'WARN', error: msg + (extra ? ' ' + JSON.stringify(extra || {}) : '') }) },
    installNow: () => autoUpdater.installNow(),
    syncNow: () => { try { opsCenterSync.syncNow().catch(() => {}) } catch (e) { log.notify('EnforceGate', 'sync-now-failed', { level: 'WARN', error: String(e && e.message) }) } },
    setInterval: (fn, ms) => { const raw = require('timers').setInterval(fn, ms); return { raw, unref: () => raw.unref && raw.unref(), clear: () => clearInterval(raw) } },
  })
  // 策略到达 → enforce 判定（与 autoUpdater.applyPolicy 并行，不动既有链）
  if (opsCenterSync && typeof opsCenterSync.setUpdatePolicyConsumer === 'function') {
    opsCenterSync.setUpdatePolicyConsumer((policy) => {
      autoUpdater.applyPolicy(policy)
      enforceGate.onPolicy(policy)
    })
  }
  // bootstrap 同步结果 → 宽限逻辑。**不改 ops-center-sync**（其文件行数受
  // max-lines 账本 filesOver500 容差顶格约束，一行都加不进）：包装 syncNow，
  // 以返回值 runtimeApplied 判成败（syncNow 内 _applyRuntimeSettled 已区分
  // fulfilled+applyRuntime 未抛 = true）。轮询/登录刷新/手动同步都经此包装，
  // 消费方（enforce-gate.onSyncOutcome）接口不变。
  if (opsCenterSync && typeof opsCenterSync.syncNow === 'function' && typeof opsCenterSync.getUpdatePolicy === 'function') {
    const originalSyncNow = opsCenterSync.syncNow.bind(opsCenterSync)
    opsCenterSync.syncNow = async () => {
      const result = await originalSyncNow()
      const ok = !!(result && result.runtimeApplied)
      enforceGate.onSyncOutcome({ ok, policy: opsCenterSync.getUpdatePolicy() })
      return result
    }
  }
  // 启动即水合：用已持久化缓存先跑一次判定（离线启动也能立即阻断）
  enforceGate.onSyncOutcome({ ok: true, policy: opsCenterSync.getUpdatePolicy ? opsCenterSync.getUpdatePolicy() : null })
  // 运行中每 6h 轮询（unref，不阻塞退出）
  enforceGate.startPolling()
  // 进度透传：auto-updater → gate 窗口
  if (autoUpdater && typeof autoUpdater.onProgress === 'function') {
    autoUpdater.onProgress((payload) => enforceGate.onUpdaterProgress(payload))
  }
  return true
}

module.exports = { assembleEnforceGate }
