// @ts-check
/**
 * Python 后端子进程管理
 * Electron 主进程启动/停止 Python FastAPI 服务
 * 
 * P0: 进程守护 — 崩溃自动重启 + 端口冲突处理
 */
const { spawn, spawnSync } = require('child_process')
const log = require('./logger')
const http = require('http')
const path = require('path')
const { config } = require('../config/app-config')
const { loadIdentityRuntimeEnv } = require('./identity/identity-runtime-config')

const BACKEND_PORT = config.pythonBridge.port
const BACKEND_HOST = config.pythonBridge.host
const HEALTH_CHECK_INTERVAL = 500   // 启动时健康检查间隔 (ms)
const HEALTH_CHECK_TIMEOUT = 30000  // 冷启动最长等待 (ms；覆盖依赖加载与 FastAPI 初始化)
const WATCHDOG_INTERVAL = 30000     // 守护检查间隔 30s
const MAX_RESTARTS = 3              // 最大重启次数
const PORT_FALLBACK_COUNT = 5       // 端口冲突时尝试后续端口的次数

/** @type {import('child_process').ChildProcess | null} */
let pythonProcess = null
let isRunning = false
let currentPort = BACKEND_PORT
let restartCount = 0
/** @type {NodeJS.Timeout | null} */
let watchdogTimer = null
/** @type {NodeJS.Timeout | null} */
let _restartTimer = null
/** @type {Promise<void> | null} */
let _startingPromise = null
// 主动停止时不应由 exit 事件触发自动重启；下一次显式 start 会清除此标记。
let _intentionalStop = false
/** @type {WeakSet<import('child_process').ChildProcess>} */
const _intentionallyStoppedProcesses = new WeakSet()
/** @type {{ getAccessToken?: Function } | null} */
let authService = null

/**
 * 获取 Python 后端工作目录（委托 path-utils 统一解析）
 */
function getBackendDir () {
  const { getPythonBackendDir } = require('./path-utils');
  return getPythonBackendDir();
}

/**
 * 获取用户 profile 目录（用于将后端数据目录绑定到用户数据，跨 worktree 持久化）
 */
function resolveUserDataDir () {
  if (process.env.ELECTRON_USER_DATA_DIR) return process.env.ELECTRON_USER_DATA_DIR
  try {
    const electron = require('electron')
    if (electron?.app && typeof electron.app.getPath === 'function') return electron.app.getPath('userData')
  } catch (_) { /* 非 Electron 环境不使用 profile 绑定 */ }
  return null
}

/**
 * 解析身份运行时配置并映射为 Python 后端需要的环境变量。
 *
 * 账号归属校验（list_accounts 的 owner_subject 过滤）依赖 Python 后端启用身份认证，
 * 否则 request.state.auth 不会被设置、所有账号被判定为不属于当前用户而返回空列表。
 * 身份配置由主进程从 config/identity-public.json 加载（loadIdentityRuntimeEnv），
 * 但 Python 后端子进程无法继承（配置不在 process.env 里），因此这里显式注入。
 *
 * @returns {Record<string, string>} 注入 Python 后端子进程的身份环境变量
 */
function resolveIdentityEnvForBackend () {
  try {
    const identityEnv = loadIdentityRuntimeEnv({ env: process.env })
    const result = {}
    for (const key of [
      'IDENTITY_AUTH_ENABLED',
      'IDENTITY_AUTH_REQUIRED',
      'LOGTO_ENDPOINT',
      'LOGTO_API_RESOURCE',
    ]) {
      if (identityEnv[key] !== undefined) result[key] = identityEnv[key]
    }
    return result
  } catch (e) {
    log.warn('PythonBridge', 'Identity runtime config unavailable, backend identity disabled: ' +
      (e instanceof Error ? e.message : String(e)))
    return {}
  }
}

/**
 * 启动 Python 后端子进程（含自动重试 + 端口回退）
 * @param {number} port
 * @returns {Promise<import('child_process').ChildProcess>}
 */
function launchProcess (port) {
  return new Promise((resolve, reject) => {
    const backendDir = getBackendDir()
    // 仅 MP_PYTHON 作为解释器覆盖；PYTHON_PATH 是 Python 模块搜索路径（目录），绝不可当作可执行文件。
    const pythonCmd = process.env.MP_PYTHON || (process.platform === 'win32' ? 'python' : 'python3')
    // 后端数据目录绑定到用户 profile（而非代码 checkout），保证账号等元数据跨 worktree 持久化
    const userDataDir = resolveUserDataDir()
    const backendDataDir = userDataDir ? path.join(userDataDir, 'backend-data') : undefined
    const identityEnv = resolveIdentityEnvForBackend()

    log.info('PythonBridge', `Starting Python backend: ${pythonCmd} server.py on port ${port}`)

    const proc = spawn(pythonCmd, ['server.py'], {
      cwd: backendDir,
      env: {
        ...process.env,
        BACKEND_PORT: String(port),
        PYTHONUNBUFFERED: '1',
        ...identityEnv,
        ...(backendDataDir ? { MULTI_PUBLISH_DATA_DIR: backendDataDir } : {})
      },
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true
    })
    let settled = false
    let spawned = false
    /** @type {NodeJS.Timeout | null} */
    let spawnTimeout = null

    function settleResolve () {
      if (settled) return
      settled = true
      if (spawnTimeout) clearTimeout(spawnTimeout)
      resolve(proc)
    }

    function settleReject (error) {
      if (settled) return
      settled = true
      if (spawnTimeout) clearTimeout(spawnTimeout)
      reject(error)
    }

    proc.stdout.on('data', (data) => {
      log.info('PythonBackend', data.toString().trim())
    })

    proc.stderr.on('data', (data) => {
      log.warn('PythonBackend', data.toString().trim())
    })

    proc.on('error', (err) => {
      log.error('PythonBridge', `Failed to start: ${err.message}`)
      if (err.message.includes('EADDRINUSE') || err.message.includes('port')) {
        // 端口冲突，不要 resolve/reject，上层会尝试下一个端口
        settleReject(new Error('PORT_IN_USE'))
      } else {
        settleReject(err)
      }
    })

    proc.on('exit', (code, signal) => {
      log.info('PythonBridge', `Process exited (code=${code}, signal=${signal})`)
      // 延迟退出的旧进程不能清空已经接管的新进程句柄。
      const isCurrentProcess = pythonProcess === proc
      const wasRunning = isRunning
      const wasIntentionallyStopped = _intentionallyStoppedProcesses.has(proc)
      if (isCurrentProcess) {
        isRunning = false
        pythonProcess = null
      }
      if (!spawned) {
        settleReject(new Error('Python process exited before spawn'))
        return
      }
      // 非正常退出时自动重启
      if (isCurrentProcess && wasRunning && !wasIntentionallyStopped && !_intentionalStop && !_startingPromise && code !== 0 && code !== null && restartCount < MAX_RESTARTS) {
        scheduleRestart()
      }
    })

    // 监听 'spawn' 事件再 resolve（修复竞态：原同步 resolve 后 'error' 事件的 reject 变空操作）
    // 加不小于健康检查预算的超时保护，防止 spawn 事件永不触发导致 Promise 永久泄漏
    spawnTimeout = setTimeout(() => {
      // 超时后必须 kill 子进程，否则进程泄漏（spawn 未触发但子进程可能已启动）
      settleReject(new Error('Python process spawn timeout'))
      forceTerminateProcess(proc)
    }, 30000)
    // R28 修复：unref 让定时器不阻止进程退出
    if (spawnTimeout && spawnTimeout.unref) spawnTimeout.unref()
    proc.once('spawn', () => {
      spawned = true
      settleResolve()
    })
  })
}

/**
 * 启动 Python 后端子进程（带端口重试）
 */
async function startPythonBackend () {
  if (isRunning) return

  // 启动过程可能跨越多个调用方；共享同一个 Promise，避免重复 spawn。
  if (_startingPromise) return _startingPromise

  _intentionalStop = false
  const startPromise = startPythonBackendInternal()
  _startingPromise = startPromise
  try {
    return await startPromise
  } finally {
    if (_startingPromise === startPromise) {
      _startingPromise = null
      _intentionalStop = false
    }
  }
}

/**
 * 执行一次带端口回退的启动流程。
 * @returns {Promise<void>}
 */
async function startPythonBackendInternal () {
  if (isRunning) return

  let lastErr = null
  for (let i = 0; i < PORT_FALLBACK_COUNT; i++) {
    const port = BACKEND_PORT + i
    /** @type {import('child_process').ChildProcess | null} */
    let proc = null
    try {
      proc = await launchProcess(port)
      if (_intentionalStop) throw new Error('Python backend start cancelled')
      pythonProcess = proc
      currentPort = port
      // 轮询健康检查
      await waitForHealthy(proc)
      if (pythonProcess !== proc || _intentionalStop) {
        throw new Error('Python backend stopped during startup')
      }
      isRunning = true
      restartCount = 0
      startWatchdog()
      log.info('PythonBridge', `Backend ready on port ${port}`)
      return
    } catch (e) {
      if (pythonProcess === proc) {
        pythonProcess = null
        isRunning = false
      }
      // 启动失败或健康检查超时都必须回收子进程，避免留下孤儿占用端口。
      if (proc && !hasProcessExited(proc)) forceTerminateProcess(proc)
      if (e instanceof Error && e.message === 'PORT_IN_USE') {
        log.warn('PythonBridge', `Port ${port} in use, trying ${port + 1}`)
        lastErr = e
        continue
      }
      lastErr = e
      break
    }
  }
  throw lastErr || new Error('Failed to start Python backend')
}

/**
 * 等待后端就绪
 * @returns {Promise<void>}
 */
function waitForHealthy (proc) {
  /** @type {Promise<void>} */
  const p = new Promise((resolve, reject) => {
    let settled = false
    let checking = false
    const interval = setInterval(async () => {
      if (settled || checking) return
      checking = true
      try {
        if (await _healthCheck()) finish()
      } finally {
        checking = false
      }
    }, HEALTH_CHECK_INTERVAL)
    const timeout = setTimeout(() => finish(new Error('Python backend health check timed out')), HEALTH_CHECK_TIMEOUT)
    const onExit = () => finish(new Error('Python backend process exited before becoming healthy'))
    if (proc && typeof proc.once === 'function') proc.once('exit', onExit)

    function finish (error) {
      if (settled) return
      settled = true
      clearInterval(interval)
      clearTimeout(timeout)
      if (proc && typeof proc.removeListener === 'function') proc.removeListener('exit', onExit)
      if (error) reject(error)
      else resolve()
    }

    // R28 修复：unref 让定时器不阻止进程退出
    if (interval && interval.unref) interval.unref()
    if (timeout && timeout.unref) timeout.unref()
  })
  return p
}

/**
 * 强制回收启动失败或健康检查超时的子进程。
 * @param {import('child_process').ChildProcess | null} proc
 */
function forceTerminateProcess (proc) {
  if (!proc) return
  _intentionallyStoppedProcesses.add(proc)
  if (process.platform === 'win32') {
    try {
      spawnSync('taskkill', ['/PID', String(proc.pid), '/F', '/T'], { timeout: 5000 })
    } catch (e) {
      log.warn('PythonBridge', 'taskkill failed: ' + (e instanceof Error ? e.message : String(e)))
    }
    return
  }
  try { proc.kill('SIGKILL') } catch (_) { /* already exited */ }
}

/**
 * ChildProcess 在 exit 事件之后会填充 exitCode/signalCode；已结束的进程不应再次 kill。
 * @param {import('child_process').ChildProcess} proc
 * @returns {boolean}
 */
function hasProcessExited (proc) {
  return (proc.exitCode !== null && proc.exitCode !== undefined) ||
    (proc.signalCode !== null && proc.signalCode !== undefined)
}

/**
 * 守护定时器 — 每 30s 检查一次后端健康状态
 */
function startWatchdog () {
  stopWatchdog()
  watchdogTimer = setInterval(async () => {
    if (!isRunning) return
    const healthy = await _healthCheck()
    if (!healthy) {
      log.warn('PythonBridge', 'Backend unhealthy, restarting...')
      if (restartCount < MAX_RESTARTS) {
        // M-3 修复：stopPythonBackend 在进程已退出时 kill() 抛 ESRCH，需 try/catch 否则 unhandledRejection
        try { await stopPythonBackend() } catch (e) { log.warn('PythonBridge', 'stop failed: ' + (e instanceof Error ? e.message : String(e))) }
        try {
          await startPythonBackend()
        } catch (e) {
          log.error('PythonBridge', `Restart failed: ${e instanceof Error ? e.message : String(e)}`)
        }
      } else {
        log.error('PythonBridge', `Max restarts (${MAX_RESTARTS}) reached, giving up`)
        isRunning = false
        stopWatchdog()
      }
    }
  }, WATCHDOG_INTERVAL)
  // R28 修复：unref 让守护定时器不阻止进程退出（后端健康检查不应持有事件循环）
  if (watchdogTimer && watchdogTimer.unref) watchdogTimer.unref()
}

function stopWatchdog () {
  if (watchdogTimer) {
    clearInterval(watchdogTimer)
    watchdogTimer = null
  }
  if (_restartTimer) {
    clearTimeout(_restartTimer)
    _restartTimer = null
  }
}

function scheduleRestart () {
  if (restartCount >= MAX_RESTARTS) {
    log.error('PythonBridge', `Max restarts (${MAX_RESTARTS}) reached`)
    return
  }
  restartCount++
  const delay = Math.min(restartCount * 2000, 10000)  // 递增延迟
  log.info('PythonBridge', `Scheduling restart #${restartCount} in ${delay}ms`)
  _restartTimer = setTimeout(async () => {
    try {
      await startPythonBackend()
    } catch (e) {
      log.error('PythonBridge', `Restart #${restartCount} failed: ${e instanceof Error ? e.message : String(e)}`)
    }
  }, delay)
  // R28 修复：unref 让定时器不阻止进程退出
  if (_restartTimer && _restartTimer.unref) _restartTimer.unref()
}

/**
 * 健康检查 — 调用 GET /api/health
 * @returns {Promise<boolean>}
 */
function _healthCheck () {
  /** @type {Promise<boolean>} */
  const p = new Promise((resolve) => {
    const req = http.get(`http://${BACKEND_HOST}:${currentPort}/api/health`, { timeout: 2000 }, (res) => {
      let data = ''
      res.on('data', chunk => { data += chunk })
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data)
          resolve(parsed.status === 'ok')
        } catch {
          resolve(false)
        }
      })
    })
    req.on('error', () => resolve(false))
    req.on('timeout', () => { req.destroy(); resolve(false) })
  })
  return p
}

/**
 * 停止 Python 后端子进程
 */
async function stopPythonBackend () {
  stopWatchdog()
  _intentionalStop = true
  // 关闭流程可能与冷启动并发：先让当前启动流程收敛，再读取句柄并执行停止。
  // 否则 spawn 尚未返回时会误以为“没有进程”，启动完成后留下孤儿后端。
  const startingPromise = _startingPromise
  if (startingPromise && !pythonProcess) {
    try { await startingPromise } catch (_) { /* 启动失败时下面无需再停止 */ }
  }
  const proc = pythonProcess
  if (!proc) {
    isRunning = false
    return
  }

  log.info('PythonBridge', 'Stopping Python backend...')
  _intentionallyStoppedProcesses.add(proc)

  if (process.platform === 'win32') {
    // R50 修复：spawnSync 增加 timeout 防止 taskkill 挂起阻塞退出
    try { spawnSync('taskkill', ['/PID', String(proc.pid), '/F', '/T'], { timeout: 5000 }) } catch (e) { log.warn('PythonBridge', 'taskkill failed: ' + e.message) }
  } else {
    try { proc.kill('SIGTERM') } catch (e) { log.warn('PythonBridge', 'SIGTERM failed: ' + e.message) }
    await new Promise(r => setTimeout(r, 3000))
    // R50 修复：kill('SIGKILL') 包入 try/catch 处理 ESRCH（进程已退出但 exit 事件尚未触发）
    try { proc.kill('SIGKILL') } catch (_) { /* already exited */ }
  }

  if (pythonProcess === proc) pythonProcess = null
  isRunning = false
  log.info('PythonBridge', 'Backend stopped')
}

/**
 * 发送 HTTP 请求到 Python 后端
 * @param {string} method - HTTP method
 * @param {string} path - URL path
 * @param {object|null} body - Request body
 * @param {number} [timeout] - Request timeout in ms (default 30000, login 180000)
 */
function _identityAuthRequired () {
  return ['1', 'true', 'yes', 'on'].includes(String(process.env.IDENTITY_AUTH_REQUIRED || '').trim().toLowerCase())
}

async function _getBackendAccessToken (forceRefresh = false) {
  if (!authService || typeof authService.getAccessToken !== 'function') return null
  try {
    const token = await authService.getAccessToken(forceRefresh ? { forceRefresh: true } : {})
    return typeof token === 'string' && token ? token : null
  } catch (error) {
    if (_identityAuthRequired()) throw error
    return null
  }
}

function _requestBackendOnce (method, path, body, timeout, accessToken) {
  return new Promise((resolve, reject) => {
    if (!isRunning) {
      reject(new Error('Python backend is not running'))
      return
    }

    const options = {
      hostname: BACKEND_HOST,
      port: currentPort,
      path,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
      timeout
    }

    const req = http.request(options, (res) => {
      let data = ''
      res.on('data', chunk => { data += chunk })
      res.on('end', () => {
        let parsed
        // logging-coverage-audit：非 JSON 响应此前静默降级，原始 body 不进日志
        try { parsed = JSON.parse(data) } catch {
          log.warn('PythonBridge', 'backend response non-JSON (len=' + data.length + '): ' + String(data).slice(0, 300))
          parsed = { code: -1, message: data }
        }
        resolve({ status: res.statusCode || 200, data: parsed })
      })
    })

    req.on('error', e => { log.error('PythonBridge', 'backend request error: ' + e.message); reject(e) })
    req.on('timeout', () => { log.error('PythonBridge', 'backend request timeout'); req.destroy(); reject(new Error('Request timeout')) })

    if (body) req.write(JSON.stringify(body))
    req.end()
  })
}

async function requestBackend (method, path, body = null, timeout = 30000) {
  // Renderer 可能在窗口创建后立刻发起请求；若启动仍在进行，复用同一 Promise
  // 等待健康检查完成，避免把“正在启动”误报为“未运行”。
  if (!isRunning && _startingPromise) await _startingPromise
  if (!isRunning) throw new Error('Python backend is not running')
  let accessToken = await _getBackendAccessToken(false)
  let response = await _requestBackendOnce(method, path, body, timeout, accessToken)
  if (response.status === 401 && authService) {
    accessToken = await _getBackendAccessToken(true)
    if (accessToken) response = await _requestBackendOnce(method, path, body, timeout, accessToken)
  }
  if (response.status >= 400) {
    const payload = response.data && typeof response.data === 'object' ? response.data : {}
    // FastAPI detail 可为对象（如 { error_code, message }）：稳定错误码透传给渲染端 formatUserError
    const detail = payload.detail
    const detailObj = detail && typeof detail === 'object' ? detail : {}
    const hasErrorCode = detailObj.error_code !== undefined
    const normalizedMessage = payload.message
      || (hasErrorCode ? (detailObj.message || '') : '')
      || (typeof detail === 'string' && detail ? detail : '')
      || 'Python backend request failed (' + response.status + ')'
    return {
      ...payload,
      ...(hasErrorCode ? { errorCode: detailObj.error_code } : {}),
      // 插值参数透传（如 {value}/{supported}）：渲染端 formatUserError 用其替换 locale 占位符
      ...(hasErrorCode && detailObj.params && typeof detailObj.params === 'object' ? { params: detailObj.params } : {}),
      status: response.status,
      code: payload.code === undefined ? -response.status : payload.code,
      message: normalizedMessage,
    }
  }
  return response.data
}

function setAuthService (service) {
  authService = service && typeof service === 'object' ? service : null
}

module.exports = {
  startPythonBackend,
  stopPythonBackend,
  requestBackend,
  setAuthService,
  isRunning: () => isRunning,
  currentPort: () => currentPort
}
