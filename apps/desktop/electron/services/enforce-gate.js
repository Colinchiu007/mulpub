'use strict'
/**
 * 强制升级门（forced-update-gate，2026-10-19）—— 主进程劝导层。
 *
 * 职责：消费 ops-center 下发的 update_policy.enforce_*，判定当前客户端是否被
 * 阻断（低于 enforce_min_version）；被阻断时创建独立置顶弹窗（仅"立即升级"，
 * 不可关闭），复用 auto-updater 的 installNow 完成下载安装。
 *
 * 双层架构中的位置：客户端判定是"劝导层"（破解者可 patch），服务端版本门
 * （ops-center services/version_gate.py，426）是"执法层"。威胁模型见
 * 01-docs/PRD-FORCED-UPDATE-GATE-2026-10-19.md §1/§9。
 *
 * 实现约束（QM-2 / 可测试性）：
 * - 状态机核心（evaluate / onSyncOutcome / applyDecision / dispose）**不直接
 *   require('electron')**，全部依赖经 deps 注入——单测用纯 Node 跑；
 * - 本模块维护单例内部状态（_win/_state），所有对外入口都先取 deps；
 * - 宽限期 72h；阻断态永不因断网缓解（缓存 policy 判定 blocking 优先于宽限）。
 */
const { readGateText } = require('./enforce-gate-text')

const GRACE_PERIOD_MS = 72 * 3600 * 1000 // 72h 离线宽限（grilling Q1）
const CLOCK_ROLLBACK_TOLERANCE_MS = 24 * 3600 * 1000 // 回拨超过 24h 判时钟异常（PRD R4）
const POLL_INTERVAL_MS = 6 * 3600 * 1000 // 运行中轮询间隔（grilling Q5）
const STATE_VERSION = 1

// ── 单例内部状态 ──
let _win = null // 当前 gate BrowserWindow（或注入的窗口对象）
let _timer = null // 6h 轮询句柄
let _deps = null
let _lastDecision = null // 供窗口刷新视图（幂等重建时携带）
let _mainWindowFacade = null // window.js 注入的主窗访问器（依赖层在 phase1 之外）

/** window.js 创建主窗口后注入：`() => mainWindow | null`。 */
function setMainWindowFacade (fn) {
  _mainWindowFacade = typeof fn === 'function' ? fn : null
}

/** phase1 装配层读取主窗访问器（未注入时返回 null，动作安全降级）。 */
function getMainWindowFacade () {
  return _mainWindowFacade
}

// ── 版本比较（与 auto-updater._compareVersions 同语义：分段整数、短段补零）──
function parseVersion (v) {
  const out = []
  for (const seg of String(v || '').trim().split('.')) {
    if (!/^\d+$/.test(seg)) return null // 坏版本串
    out.push(parseInt(seg, 10))
  }
  return out.length ? out : null
}

function compareVersions (a, b) {
  const pa = parseVersion(a)
  const pb = parseVersion(b)
  if (!pa || !pb) return null // 任一非法 → 调用方 fail-open
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] || 0
    const y = pb[i] || 0
    if (x !== y) return x < y ? -1 : 1
  }
  return 0
}

function isBadPolicyVersion (v) {
  return !String(v || '').trim() || parseVersion(v) === null
}

// ── 持久化（userData/enforce-gate-state.json，tmp+rename 原子写）──
function loadState (deps) {
  try {
    const raw = deps.readStateFile(deps.stateFile)
    const state = JSON.parse(raw)
    if (!state || state.version !== STATE_VERSION) return null
    return state
  } catch (e) {
    return null // 读失败视为无缓存（fail-open 到宽限逻辑）
  }
}

function saveState (deps, policy) {
  try {
    const state = {
      version: STATE_VERSION,
      policy: policy && typeof policy === 'object' ? policy : null,
      fetchedAt: new Date(deps.now()).toISOString(),
      monotonicRefMs: deps.monotonicMs(),
    }
    deps.writeStateFileAtomic(deps.stateFile, state)
  } catch (e) {
    deps.log.warn('enforce-gate: persist state failed', { error: String((e && e.message) || e) })
  }
}

function clearState (deps) {
  try { deps.removeStateFile(deps.stateFile) } catch (e) { /* 忽略清理失败 */ }
}

// ── 判定核心（纯语义，经 deps 注入）──

/**
 * evaluate：给定 policy 与当前版本，返回判定（**纯函数**：不做文件 IO，
 * 缓存的保存/清理统一在 onSyncOutcome——否则"关闭策略"会删掉刚落盘的缓存）。
 * @returns {{status:'pass'|'blocking', target?:string, current?:string}}
 */
function evaluateForTest (deps, policy, nowMs) {
  void nowMs
  if (!policy || typeof policy !== 'object' || policy.enforce_enabled !== true) {
    return { status: 'pass' }
  }
  const line = policy.enforce_min_version
  if (isBadPolicyVersion(line)) {
    deps.log.warn('enforce-gate: bad enforce_min_version, fail-open', { line: String(line) })
    return { status: 'pass' } // 服务端有 V1-V4 校验，坏值只剩传输损坏场景 → 放行
  }
  const current = deps.appVersion()
  const cmp = compareVersions(current, line)
  if (cmp === null || cmp >= 0) return { status: 'pass' }
  // 目标版本：force_version 更高则用它（升级到 force），否则阻断线本身
  let target = line
  if (policy.force_version && !isBadPolicyVersion(policy.force_version) &&
      compareVersions(policy.force_version, current) > 0) {
    target = policy.force_version
  }
  return { status: 'blocking', current, target }
}

/**
 * onSyncOutcome：bootstrap 拉取结果钩子（成功/失败）。
 * 成功 → 缓存落盘 + 重判；失败 → 宽限逻辑。
 * @returns 判定结果（供接线层断言/日志）
 */
async function onSyncOutcomeForTest (deps, outcome) {
  if (outcome && outcome.ok) {
    if (outcome.policy && typeof outcome.policy === 'object') {
      saveState(deps, outcome.policy) // 成功拉取 → 缓存落盘（宽限期数据源）
    } else {
      clearState(deps) // 策略缺失/关闭 → 清缓存（开关即应急总闸）
    }
    const decision = evaluateForTest(deps, outcome.policy, deps.now())
    applyDecisionForTest(deps, decision)
    return decision
  }
  // 同步失败 → 宽限逻辑
  const state = loadState(deps)
  if (!state || !state.policy) {
    const decision = { status: 'verify-failed' }
    applyDecisionForTest(deps, decision)
    return decision
  }
  // 时钟回拨防线（QM-6 i3 修复）：优先用单调钟差（免疫墙钟回拨），状态文件带
  // monotonicRefMs（saveState 时记录的单调钟读数）才算得出；旧状态文件无该字段
  // 才回落墙钟并 WARN（墙钟差会被 <24h 回拨反复续期——单调钟可用的场景不走这条路）。
  const fetchedAtMs = Date.parse(state.fetchedAt)
  const wallElapsed = deps.now() - (Number.isFinite(fetchedAtMs) ? fetchedAtMs : 0)
  let elapsed
  if (typeof state.monotonicRefMs === 'number' && Number.isFinite(state.monotonicRefMs)) {
    const monoNow = deps.monotonicMs()
    elapsed = Math.max(0, monoNow - state.monotonicRefMs) // 单调钟不会回退，负差夹为 0
    if (wallElapsed < -CLOCK_ROLLBACK_TOLERANCE_MS) {
      deps.log.warn('enforce-gate: clock rollback detected, monotonic clock governs grace', {
        now: new Date(deps.now()).toISOString(),
        fetchedAt: state.fetchedAt,
      })
    }
  } else {
    elapsed = wallElapsed
    if (elapsed < 0) {
      // 无单调参考 + 墙钟倒退：按"刚刚同步过"放行本轮并出声（旧行为，仅限旧状态文件过渡期）
      deps.log.warn('enforce-gate: wall clock moved backwards and no monotonic reference in state, treating as fresh', {})
      elapsed = 0
    }
  }
  if (elapsed > GRACE_PERIOD_MS) {
    const decision = { status: 'verify-failed' }
    applyDecisionForTest(deps, decision)
    return decision
  }
  // 宽限内：沿用缓存 policy 判定（缓存若判 blocking → 仍然阻断，不因断网缓解）
  const decision = evaluateForTest(deps, state.policy, deps.now())
  applyDecisionForTest(deps, decision)
  return decision
}

// ── 窗口管理层 ──

function gateWindowOptions (deps) {
  return {
    width: 420,
    height: 520,
    frame: false, // 无边框（无系统关闭按钮）
    closable: false, // 拦截 close 之外的声明语义（close 事件 handler 是真正兜底）
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    show: false,
    alwaysOnTop: true, // 置顶（实现层用 'screen-saver' 级别）
    skipTaskbar: false,
    webPreferences: {
      preload: deps.gatePreloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  }
}

/**
 * applyDecision：把判定落成窗口动作（幂等）。
 * blocking / verify-failed → 显示弹窗（同一窗口切视图）；pass → 关弹窗恢复主窗。
 */
function applyDecisionForTest (deps, decision) {
  _deps = deps
  _lastDecision = decision
  const needWindow = decision.status === 'blocking' || decision.status === 'verify-failed'
  if (!needWindow) {
    hideGate(deps)
    return
  }
  if (_win && !_win.isDestroyed()) {
    // 幂等：已有窗口 → 仅刷新视图数据
    _win.webContents.send('enforce-gate:state', { decision, text: readGateText(deps.locale) })
    return
  }
  const win = deps.createGateWindow(gateWindowOptions(deps))
  _win = win
  // 不可关闭（QM-6 i1）：拦截用户侧 close；程序化关闭走 destroy()（不发 close 事件）
  // + __closeProgrammatically 标志双保险——hideGate/dispose 不经此 handler。
  let gateClosing = false
  win.on('close', (e) => {
    if (gateClosing) return
    e.preventDefault()
    deps.log.warn('enforce-gate: user attempted to close gate window (blocked)')
  })
  win.__closeProgrammatically = () => {
    gateClosing = true
    try { win.destroy() } catch (e) { deps.log.warn('enforce-gate: destroy failed', { error: String((e && e.message) || e) }) }
  }
  win.on('closed', () => { if (_win === win) _win = null })
  deps.loadGatePage(win)
  win.once('ready-to-show', () => {
    win.show()
    win.focus()
  })
  if (decision.status === 'blocking') {
    deps.hideMainWindow() // 主窗口整体隐藏（防绕过 UI 直达功能）
  }
}

function hideGate (deps) {
  if (_win && !_win.isDestroyed()) {
    // QM-6 i1：程序化关闭走 destroy（close handler 只拦用户侧）
    try { if (_win.__closeProgrammatically) _win.__closeProgrammatically() } catch (e) { deps.log.warn('enforce-gate: close failed', { error: String((e && e.message) || e) }) }
  }
  _win = null
  if (deps.wasMainWindowHidden()) deps.showMainWindow()
}

// ── 对外入口（真实 Electron 环境；内部经 deps 组装）──

/** 配置注入（phase1-context 调用一次）。 */
function init (deps) {
  _deps = deps
}

/** 当前是否处于弹窗状态。 */
function isGateActive () {
  return !!(_win && !_win.isDestroyed())
}

/** 最近一次判定（IPC request-state 回放用；无判定返回 null）。 */
function lastDecision () {
  return _lastDecision
}

/** 策略到达（ops-center-sync setUpdatePolicyConsumer 路径）。 */
function onPolicy (policy) {
  if (!_deps) return
  const decision = evaluateForTest(_deps, policy, _deps.now())
  applyDecisionForTest(_deps, decision)
}

/** bootstrap 同步结果到达（setOnSyncOutcome 路径）。 */
function onSyncOutcome (outcome) {
  if (!_deps) return Promise.resolve(null)
  return onSyncOutcomeForTest(_deps, outcome)
}

/** 用户点击"立即升级"（IPC）。 */
function upgrade () {
  if (_deps) _deps.installNow()
}

/** 用户点击"重试"（verify-failed 视图）。 */
function retryVerify () {
  if (_deps) _deps.syncNow()
}

/** 下载进度透传（auto-updater onProgress 订阅器回调）。 */
function onUpdaterProgress (payload) {
  if (_win && !_win.isDestroyed()) {
    _win.webContents.send('enforce-gate:progress', payload)
  }
}

/** 启动 6h 轮询（syncNow → sync outcome → consumer 路径自然重判）。 */
function startPolling () {
  if (!_deps || _timer) return
  _timer = _deps.setInterval(() => {
    try { _deps.syncNow() } catch (e) {
      _deps.log.warn('enforce-gate: poll syncNow failed', { error: String((e && e.message) || e) })
    }
  }, POLL_INTERVAL_MS)
  if (typeof _timer.unref === 'function') _timer.unref()
}

/** app quit 前清理（phase1 shutdown）。 */
function dispose (deps) {
  const d = deps || _deps
  if (!d) return
  if (_timer) {
    try { _timer.clear() } catch (e) { /* noop */ }
    _timer = null
  }
  if (_win && !_win.isDestroyed()) {
    // QM-6 i1：程序化关闭走 destroy（close handler 只拦用户侧）
    try { if (_win.__closeProgrammatically) _win.__closeProgrammatically() } catch (e) { d.log.warn('enforce-gate: dispose close failed', { error: String((e && e.message) || e) }) }
  }
  _win = null
  if (d.wasMainWindowHidden()) d.showMainWindow()
  _deps = null
}

module.exports = {
  init,
  onPolicy,
  onSyncOutcome,
  upgrade,
  retryVerify,
  onUpdaterProgress,
  startPolling,
  dispose,
  isGateActive,
  lastDecision,
  setMainWindowFacade,
  getMainWindowFacade,
  // 测试口（纯函数注入 deps；生产代码不得调用）
  evaluateForTest,
  onSyncOutcomeForTest,
  applyDecisionForTest,
  disposeForTest: dispose,
  compareVersions,
  GRACE_PERIOD_MS,
  POLL_INTERVAL_MS,
}
