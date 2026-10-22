// @ts-check
/**
 * Phase 2: Python Bridges 启动与清理
 *
 * 从 bootstrap.js runWhenReady 拆出：
 * - pythonBridge.startPythonBackend()
 * - splitterBridge.start() / promptBridge.start()（Promise.allSettled 并行）
 * - 返回显式、幂等、可等待的 stop 清理函数
 *
 * 验收标准 BUGFIX-PLAN Bug-1: phase 文件 <= 80 行
 */
const log = require('../services/logger')

/**
 * SplitterBridge 启动失败的用户可见提示（2026-09-12 bug 反思 P1 打包契约）。
 * 背景：splitter 依赖用户机器 pip 安装 smart-sentence-splitter；缺失时此前仅写日志，
 * 用户无感知地使用降级分句。此通知让「语义分句引擎不可用」显性化（不阻断启动）。
 * 仅打包形态提示（开发环境降级属已知调试状态，避免噪音）。
 */
function notifySplitterUnavailable(reason) {
  try {
    const { app, Notification, isPackaged } = require('electron')
    if (!isPackaged()) return
    if (typeof Notification !== 'function' || !Notification.isSupported()) return
    const notification = new Notification({
      title: '语义分句引擎不可用',
      body: '视频字幕将使用本地基础分句（质量可能下降）。请安装 Python 及 smart-sentence-splitter 包后重启应用。诊断: ' + String(reason || '').slice(0, 180),
    })
    notification.show()
  } catch (_) { /* 通知失败不影响启动 */ }
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function errorMessage(value) {
  return value instanceof Error ? value.message : String(value)
}

/**
 * 解析「显式跳过」的可选 bridge 名单（MP_SKIP_BRIDGES=SplitterBridge,PromptBridge）。
 *
 * 动机（2026-10-18 真机）：这两个 bridge 的可选依赖先天缺位时——
 * SplitterBridge 需 pip 包 smart-sentence-splitter、PromptBridge 需独立仓库的 prompt-engine——
 * 每次启动都会跑满 MAX_RESTARTS(3) × HEALTH_CHECK_TIMEOUT(10s) 的重启退避，
 * 表现为「窗口迟迟不出现」的 10–30s 白屏，而这些功能本来就不可用。
 * 默认返回空集合 ⇒ 不配置时行为与之前完全一致（既有单测锁死该默认）。
 *
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {Set<string>} 统一小写，便于与 'SplitterBridge' / 'PromptBridge' 比对
 */
function resolveSkippedBridges(env = process.env) {
  const raw = typeof env.MP_SKIP_BRIDGES === 'string' ? env.MP_SKIP_BRIDGES : ''
  return new Set(raw.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean))
}

/**
 * 启动所有 Python bridges 并注册退出清理
 * @param {object} deps
 * @param {object} deps.app - Electron app 实例
 * @param {object} deps.pythonBridge - Python 后端桥接
 * @param {object} deps.splitterBridge - 分句器桥接
 * @param {object} deps.promptBridge - 提示词引擎桥接
 * @returns {Promise<() => Promise<void>>} 幂等的异步清理函数
 */
async function startBridges({ app, pythonBridge, splitterBridge, promptBridge }) {
  // 1. Python 后端（容错：失败不阻断启动）
  try {
    await pythonBridge.startPythonBackend()
  } catch (e) {
    log.notify('App', 'python-backend-start-failed', { level: 'ERROR', error: errorMessage(e) })
  }

  // 2. SplitterBridge / PromptBridge 并行启动（allSettled 容错）
  // 被 MP_SKIP_BRIDGES 点名的直接跳过并留痕，不参与重试退避（见 resolveSkippedBridges）。
  const skipped = resolveSkippedBridges()
  /** @type {Array<[string, { start: () => Promise<unknown> }]>} */
  const targets = []
  for (const [name, bridge] of /** @type {const} */ ([
    ['SplitterBridge', splitterBridge],
    ['PromptBridge', promptBridge],
  ])) {
    if (skipped.has(name.toLowerCase())) {
      log.notify('App', 'bridge-skipped', { level: 'INFO', params: { bridge: name } })
      continue
    }
    targets.push([name, bridge])
  }
  const results = await Promise.allSettled(targets.map(([, bridge]) => bridge.start()))
  const names = targets.map(([name]) => name)
  results.forEach((r, i) => {
    if (r.status === 'rejected') {
      const reason = r.reason instanceof Error ? r.reason.message : String(r.reason)
      log.notify('App', 'bridge-start-failed', { level: 'WARN', params: { bridge: names[i] }, error: String(reason) })
      if (names[i] === 'SplitterBridge') notifySplitterUnavailable(reason)
    } else {
      log.notify('App', 'bridge-started', { params: { bridge: names[i] } })
    }
  })

  // 3. 清理由 shutdown 统一等待，避免 Electron 忽略异步事件监听器返回值。
  let stopPromise = null
  function stopBridges() {
    if (stopPromise) return stopPromise
    /** @type {Array<[string, () => unknown]>} */
    const bridges = [
      ['Python backend', () => pythonBridge.stopPythonBackend()],
      ['SplitterBridge', () => splitterBridge.stop()],
      ['PromptBridge', () => promptBridge.stop()],
    ]
    stopPromise = Promise.allSettled(
      bridges.map(([, stop]) => Promise.resolve().then(() => stop())),
    )
      .then((stopResults) => {
        stopResults.forEach((result, index) => {
          if (result.status === 'rejected') {
            const reason = result.reason instanceof Error ? result.reason.message : String(result.reason)
            log.notify('App', 'bridge-stop-failed', { level: 'WARN', params: { bridge: bridges[index][0] }, error: String(reason) })
          }
        })
      })
    return stopPromise
  }

  return stopBridges
}

module.exports = { startBridges, resolveSkippedBridges }
