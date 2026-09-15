// @ts-check
/**
 * 服务状态 IPC — 聚合本地常驻/按需服务的运行状态，并提供按需重启
 *
 * 返回结构（每项）：
 *   {
 *     key, name,
 *     status: 'running'|'stopped'|'standby',
 *     port,
 *     reason: 'ok'|'not_started'|'on_demand'|'connection_refused'|'timeout'|'http_error'|'unhealthy'|'unknown',
 *     restartable: boolean,
 *     onDemand: boolean
 *   }
 *
 * - mainBackend / callbackServer / mediaServer：同步状态读取（isRunning / server.listening / origin）
 * - splitterEngine / promptEngine：主动健康检查（GET /health，2s 超时，含失败归因）
 * - alignerEngine：按需懒启动，未激活时返回 standby + reason='on_demand'（不算故障）
 *
 * status 保持三态枚举（running/stopped/standby）以兼容既有消费方；
 * 更细的故障归因与可操作性元数据（reason / restartable / onDemand）属于向后兼容的新增字段。
 */
const { withSenderCheck, EC } = require('./helpers')
const log = require('../services/logger')

/** 允许通过 IPC 重启的服务 key 白名单（避免任意 key 触发副作用） */
const RESTARTABLE_KEYS = new Set(['mainBackend', 'splitterEngine', 'promptEngine', 'callbackServer', 'mediaServer'])

/** 正在重启的 key 集合（防重复点击造成的并发 start） */
const restartingKeys = new Set()

/**
 * 从 bridge 提取统一运行时信息。
 * restartable 由能力探测决定（有 start/ensureRunning 才允许暴露重试入口）。
 * @param {{ isRunning?: boolean, port?: number, start?: Function, ensureRunning?: Function } | null} bridge
 * @param {number} fallbackPort
 */
function bridgeRuntime (bridge, fallbackPort) {
  if (!bridge) return { isRunning: false, port: fallbackPort, restartable: false }
  return {
    isRunning: bridge.isRunning === true,
    port: Number.isFinite(bridge.port) ? bridge.port : fallbackPort,
    restartable: typeof bridge.ensureRunning === 'function' || typeof bridge.start === 'function',
  }
}

/**
 * 健康检查（含归因）— 优先 healthCheckDetail（返回 reason），
 * 回退 healthCheck（仅布尔），保证对既有 mock / 旧 bridge 的兼容。
 * @param {{ healthCheckDetail?: Function, healthCheck?: Function } | null} bridge
 * @returns {Promise<{ ok: boolean, reason: string }>}
 */
async function probeHealth (bridge) {
  if (!bridge) return { ok: false, reason: 'not_started' }
  if (typeof bridge.healthCheckDetail === 'function') {
    try {
      const detail = await Promise.resolve(bridge.healthCheckDetail())
      if (detail && typeof detail === 'object' && typeof detail.ok === 'boolean') {
        return { ok: detail.ok, reason: typeof detail.reason === 'string' ? detail.reason : (detail.ok ? 'ok' : 'unknown') }
      }
    } catch { /* 降级到布尔回退 */ }
  }
  if (typeof bridge.healthCheck === 'function') {
    try {
      const ok = await Promise.resolve(bridge.healthCheck())
      return { ok: ok === true, reason: ok === true ? 'ok' : 'unknown' }
    } catch {
      return { ok: false, reason: 'unknown' }
    }
  }
  return { ok: false, reason: 'not_started' }
}

/**
 * 未运行时的归因：进程标志为 false → 从未启动；
 * 进程标志为 true 但健康检查失败 → 采用健康检查给出的更具体原因（如 timeout/http_error）。
 * @param {{ isRunning: boolean }} runtime
 * @param {{ ok: boolean, reason: string }} health
 */
function stoppedReason (runtime, health) {
  if (!runtime.isRunning) return 'not_started'
  return health.reason && health.reason !== 'ok' ? health.reason : 'unknown'
}

/**
 * 解析某 key 对应的可重启目标对象。
 * @returns {object | null}
 */
function resolveRestartTarget (key, deps) {
  switch (key) {
    case 'mainBackend': return deps.pythonBridge || null
    case 'splitterEngine': return deps.splitterBridge || null
    case 'promptEngine': return deps.promptBridge || null
    case 'callbackServer': return deps.callbackServer || null
    case 'mediaServer': return deps.story2videoMediaServer || null
    default: return null
  }
}

/**
 * 调用目标对象上可用的启动入口（按其可靠性排序）。
 * @param {object} target
 */
async function invokeRestart (target) {
  if (typeof target.ensureRunning === 'function') return target.ensureRunning()
  if (typeof target.start === 'function') return target.start()
  if (typeof target.startPythonBackend === 'function') return target.startPythonBackend()
  throw new Error('no restart entrypoint available')
}

function registerServicesHandlers (ipcMain, deps = {}) {
  ipcMain.handle('services:get-status', withSenderCheck(async () => {
    try {
      const { config } = require('../config/app-config')

      const splitterRuntime = bridgeRuntime(deps.splitterBridge, config.splitterBridge.port)
      const promptRuntime = bridgeRuntime(deps.promptBridge, config.promptBridge.port)
      // 并行探测，避免两个串行 2s 超时叠加成 4s（状态面板每 10s 轮询一次）
      const [splitterHealth, promptHealth] = await Promise.all([
        probeHealth(deps.splitterBridge),
        probeHealth(deps.promptBridge),
      ])

      const mainRunning = !!(deps.pythonBridge && typeof deps.pythonBridge.isRunning === 'function' && deps.pythonBridge.isRunning())
      const callbackRunning = !!(deps.callbackServer && deps.callbackServer.server && deps.callbackServer.server.listening)
      const mediaRunning = !!(deps.story2videoMediaServer && deps.story2videoMediaServer.origin)

      const services = [
        {
          key: 'mainBackend',
          name: '主服务',
          status: mainRunning ? 'running' : 'stopped',
          reason: mainRunning ? 'ok' : 'not_started',
          port: deps.pythonBridge && typeof deps.pythonBridge.currentPort === 'function' ? deps.pythonBridge.currentPort() : config.pythonBridge.port,
          restartable: !!(deps.pythonBridge && (
            typeof deps.pythonBridge.startPythonBackend === 'function' ||
            typeof deps.pythonBridge.start === 'function' ||
            typeof deps.pythonBridge.ensureRunning === 'function'
          )),
          onDemand: false,
        },
        {
          key: 'splitterEngine',
          name: '分句引擎',
          status: splitterHealth.ok ? 'running' : 'stopped',
          reason: splitterHealth.ok ? 'ok' : stoppedReason(splitterRuntime, splitterHealth),
          port: splitterRuntime.port,
          restartable: splitterRuntime.restartable,
          onDemand: false,
        },
        {
          key: 'promptEngine',
          name: '提示词优化引擎',
          status: promptHealth.ok ? 'running' : 'stopped',
          reason: promptHealth.ok ? 'ok' : stoppedReason(promptRuntime, promptHealth),
          port: promptRuntime.port,
          restartable: promptRuntime.restartable,
          onDemand: false,
        },
        {
          key: 'callbackServer',
          name: '回调服务',
          status: callbackRunning ? 'running' : 'stopped',
          reason: callbackRunning ? 'ok' : 'not_started',
          port: config.callbackServer.port,
          restartable: !!deps.callbackServer && (
            typeof deps.callbackServer.ensureRunning === 'function' ||
            typeof deps.callbackServer.start === 'function'
          ),
          onDemand: false,
        },
        {
          key: 'mediaServer',
          name: '媒体服务',
          status: mediaRunning ? 'running' : 'stopped',
          reason: mediaRunning ? 'ok' : 'not_started',
          port: mediaRunning ? _portFromOrigin(deps.story2videoMediaServer.origin) : 0,
          restartable: !!deps.story2videoMediaServer && (
            typeof deps.story2videoMediaServer.ensureRunning === 'function' ||
            typeof deps.story2videoMediaServer.start === 'function'
          ),
          onDemand: false,
        },
        {
          key: 'alignerEngine',
          name: '对齐引擎',
          // 对齐引擎由 subtitle-align-service 按需懒启动，无全局实例：
          // 常驻状态恒为 standby（语义「当前未激活」），靠 onDemand 标记避免误导为「随时可用」。
          status: 'standby',
          reason: 'on_demand',
          port: config.alignerBridge.port,
          restartable: false,
          onDemand: true,
        },
      ]

      return { code: 0, data: { services, timestamp: Date.now() } }
    } catch (error) {
      log.warn('IPC:services', '服务状态聚合失败: ' + (error instanceof Error ? error.message : String(error)))
      return { code: EC.UNKNOWN_ERROR, message: 'SERVICES_STATUS_UNAVAILABLE' }
    }
  }))

  ipcMain.handle('services:restart', withSenderCheck(async (_event, payload) => {
    const key = payload && typeof payload === 'object' && typeof payload.key === 'string' ? payload.key : ''
    if (!RESTARTABLE_KEYS.has(key)) {
      return { code: EC.VALIDATION_ERROR, message: 'SERVICES_RESTART_UNSUPPORTED_KEY' }
    }
    if (restartingKeys.has(key)) {
      return { code: EC.VALIDATION_ERROR, message: 'SERVICES_RESTART_IN_PROGRESS' }
    }
    const target = resolveRestartTarget(key, deps)
    const canRestart = target && (
      typeof target.ensureRunning === 'function' ||
      typeof target.start === 'function' ||
      typeof target.startPythonBackend === 'function'
    )
    if (!canRestart) {
      return { code: EC.VALIDATION_ERROR, message: 'SERVICES_RESTART_UNAVAILABLE' }
    }

    restartingKeys.add(key)
    try {
      await invokeRestart(target)
      log.info('IPC:services', '服务重启完成: ' + key)
      return { code: 0, data: { key, restartedAt: Date.now() } }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      log.warn('IPC:services', '服务重启失败: ' + key + ' — ' + msg)
      return { code: EC.REQUEST_ERROR, message: 'SERVICES_RESTART_FAILED', data: { key, error: msg } }
    } finally {
      restartingKeys.delete(key)
    }
  }))
}

function _portFromOrigin (origin) {
  try {
    const port = Number(new URL(origin).port)
    return Number.isFinite(port) ? port : 0
  } catch {
    return 0
  }
}

module.exports = registerServicesHandlers
