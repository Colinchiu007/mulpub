// @ts-check
/**
 * BasePythonBridge — Python 子进程管理基类
 *
 * 提供 Python FastAPI 服务的通用生命周期管理：
 *   - spawn 子进程 + 30s 超时保护
 *   - 轮询健康检查（/health 端点）
 *   - 30s watchdog 守护定时器
 *   - 崩溃自动重启（最多 3 次，递增延迟 2s/4s/6s... 上限 10s）
 *   - Windows taskkill /F /T 强制停止
 *   - attach 模式（附加到外部已运行服务）
 *   - 通用 POST 请求封装
 *
 * 子类需提供：
 *   - constructor 调用 super({ name, pythonModule, port, host, workDir, log, requestTimeout })
 *   - 业务方法（如 split / optimize）
 *
 * @example
 * class MyBridge extends BasePythonBridge {
 *   constructor({ log } = {}) {
 *     super({ name: 'MyBridge', pythonModule: 'my_app.api', port: 8000, host: '127.0.0.1', workDir: '/app', log })
 *   }
 *   fetchData(query) { return this._post('/v1/fetch', JSON.stringify({ query })) }
 * }
 */
'use strict'

const { spawn, spawnSync } = require('child_process')
const http = require('http')

const HEALTH_CHECK_INTERVAL = 500
const HEALTH_CHECK_TIMEOUT = 10000
const WATCHDOG_INTERVAL = 30000
const MAX_RESTARTS = 3

// Stage 1.4 容器守卫：全局实例注册表 + process.exit 清理孤儿 sidecar
const _bridgeInstances = new Set()
let _exitHandlerRegistered = false

function _registerBridge(bridge) {
  _bridgeInstances.add(bridge)
  if (!_exitHandlerRegistered) {
    _exitHandlerRegistered = true
    process.on('exit', () => {
      for (const b of _bridgeInstances) {
        if (b.process && b.process.pid) {
          try {
            if (process.platform === 'win32') {
              spawnSync('taskkill', ['/PID', String(b.process.pid), '/F', '/T'], { timeout: 3000 })
            } else {
              b.process.kill('SIGKILL')
            }
          } catch (_) { /* best-effort cleanup */ }
        }
      }
    })
  }
}

function _unregisterBridge(bridge) {
  _bridgeInstances.delete(bridge)
}

class BasePythonBridge {
  /**
   * @param {object} config
   * @param {string} config.name - 日志标签（如 'SplitterBridge'）
   * @param {string} config.pythonModule - Python 模块路径（如 'splitter.api.rest_api'）
   * @param {number} config.port - 端口
   * @param {string} config.host - 主机
   * @param {string} config.workDir - 工作目录
   * @param {any} [config.log] - 日志模块
   * @param {number} [config.requestTimeout] - 默认请求超时 ms（默认 30000）
   */
  constructor ({ name, pythonModule, port, host, workDir, log, requestTimeout }) {
    this.name = name
    this.pythonModule = pythonModule
    this.port = port
    this.host = host
    this.workDir = workDir
    this.log = log || require('./logger')
    this.requestTimeout = requestTimeout || 30000
    /** @type {import('child_process').ChildProcess | null} */
    this.process = null
    this.isRunning = false
    this.restartCount = 0
    /** @type {NodeJS.Timeout | null} */
    this.watchdogTimer = null
    /** @type {NodeJS.Timeout | null} */
    this.restartTimer = null
    /** @type {Promise<void> | null} */
    this._starting = null
  }

  /**
   * 启动 Python 子进程
   * @returns {Promise<void>}
   */
  async start () {
    if (this.isRunning) return

    if (await this.attach()) {
      this._startWatchdog()
      return
    }

    // 仅 MP_PYTHON 作为解释器覆盖；PYTHON_PATH 是 Python 模块搜索路径（目录），绝不可当作可执行文件。
    // 回退到 python/python3，由 start-desktop.ps1 前置系统 Python 3.12 到 PATH 保证解析正确。
    const pythonCmd = process.env.MP_PYTHON || (process.platform === 'win32' ? 'python' : 'python3')
    this.log.info(this.name, `Starting ${this.pythonModule}: ${pythonCmd} -m ${this.pythonModule} on port ${this.port}`)
    this.process = await this._launchProcess(pythonCmd)
    await this._waitForHealthy()
    this.isRunning = true
    _registerBridge(this)
    this.restartCount = 0
    this._startWatchdog()
    this.log.info(this.name, `${this.name} ready on port ${this.port}`)
  }

  /**
   * 附加到外部已运行的服务（不 spawn 子进程）
   * @returns {Promise<boolean>} 是否成功附加
   */
  async attach () {
    if (this.isRunning) return true
    this.log.info(this.name, `Attaching to external ${this.name} on port ${this.port}...`)
    const healthy = await this.healthCheck()
    if (healthy) {
      this.isRunning = true
      this.log.info(this.name, `Attached to external ${this.name} on port ${this.port}`)
    } else {
      this.log.warn(this.name, `Cannot attach: no ${this.name} responding on port ${this.port}`)
    }
    return healthy
  }

  /**
   * spawn 子进程并监听生命周期事件
   * @param {string} pythonCmd
   * @returns {Promise<import('child_process').ChildProcess>}
   * @protected
   */
  _launchProcess (pythonCmd) {
    return new Promise((resolve, reject) => {
      // 2026-09-12 bug 反思：cwd 不存在时 Windows spawn 报 ENOENT，与「python 缺失」无法区分。
      // spawn 前显式校验 workDir，不存在时给出可诊断错误（而非伪装成 python ENOENT）。
      const fs = require('fs')
      if (!fs.existsSync(this.workDir)) {
        reject(new Error(this.name + ' workDir does not exist: ' + this.workDir + ' (fix workDir resolution; spawn cwd must be a real directory)'))
        return
      }
      const proc = spawn(pythonCmd, ['-m', this.pythonModule], {
        cwd: this.workDir,
        env: { ...process.env, PORT: String(this.port), PYTHONUNBUFFERED: '1' },
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true
      })
      proc.stdout.on('data', (data) => { this.log.info(this.name + 'Backend', data.toString().trim()) })
      proc.stderr.on('data', (data) => { this.log.warn(this.name + 'Backend', data.toString().trim()) })
      proc.on('error', (err) => { this.log.error(this.name, `Failed to start: ${err.message}`); reject(err) })
      proc.on('exit', (code, signal) => {
        this.log.info(this.name, `Process exited (code=${code}, signal=${signal})`)
        this.isRunning = false
        this.process = null
        if (code !== 0 && code !== null && this.restartCount < MAX_RESTARTS) { this._scheduleRestart() }
      })
      const spawnTimeout = setTimeout(() => {
        try { proc.kill('SIGKILL') } catch (_) { /* already exited */ }
        reject(new Error(`${this.name} process spawn timeout`))
      }, 30000)
      if (spawnTimeout && spawnTimeout.unref) spawnTimeout.unref()
      proc.once('spawn', () => { clearTimeout(spawnTimeout); resolve(proc) })
    })
  }

  /**
   * 轮询健康检查直到就绪
   * @returns {Promise<void>}
   * @protected
   */
  _waitForHealthy () {
    return new Promise((resolve, reject) => {
      const startTime = Date.now()
      const interval = setInterval(async () => {
        const healthy = await this.healthCheck()
        if (healthy) { clearInterval(interval); resolve() }
        else if (Date.now() - startTime > HEALTH_CHECK_TIMEOUT) { clearInterval(interval); reject(new Error(`${this.name} health check timed out`)) }
      }, HEALTH_CHECK_INTERVAL)
      if (interval && interval.unref) interval.unref()
    })
  }

  /**
   * 守护定时器 — 每 30s 检查健康状态，不健康时自动重启
   * @protected
   */
  _startWatchdog () {
    this._stopWatchdog()
    this.watchdogTimer = setInterval(async () => {
      if (!this.isRunning) return
      const healthy = await this.healthCheck()
      if (!healthy) {
        this.log.warn(this.name, 'Backend unhealthy, restarting...')
        if (this.restartCount < MAX_RESTARTS) {
          try { await this.stop() } catch (e) { this.log.warn(this.name, 'stop failed: ' + (e instanceof Error ? e.message : String(e))) }
          try { await this.start() } catch (e) { this.log.error(this.name, `Restart failed: ${e instanceof Error ? e.message : String(e)}`) }
        } else {
          this.log.error(this.name, `Max restarts (${MAX_RESTARTS}) reached, giving up`)
          this.isRunning = false
          this._stopWatchdog()
        }
      }
    }, WATCHDOG_INTERVAL)
    if (this.watchdogTimer && this.watchdogTimer.unref) this.watchdogTimer.unref()
  }

  /**
   * @protected
   */
  _stopWatchdog () {
    if (this.watchdogTimer) { clearInterval(this.watchdogTimer); this.watchdogTimer = null }
    if (this.restartTimer) { clearTimeout(this.restartTimer); this.restartTimer = null }
  }

  /**
   * @protected
   */
  _scheduleRestart () {
    if (this.restartCount >= MAX_RESTARTS) { this.log.error(this.name, `Max restarts (${MAX_RESTARTS}) reached`); return }
    this.restartCount++
    const delay = Math.min(this.restartCount * 2000, 10000)
    this.log.info(this.name, `Scheduling restart #${this.restartCount} in ${delay}ms`)
    this.restartTimer = setTimeout(async () => {
      try { await this.start() } catch (e) { this.log.error(this.name, `Restart #${this.restartCount} failed: ${e instanceof Error ? e.message : String(e)}`) }
    }, delay)
    if (this.restartTimer && this.restartTimer.unref) this.restartTimer.unref()
  }

  /**
   * 健康检查 — GET /health
   * @returns {Promise<boolean>}
   */
  healthCheck () {
    return this.healthCheckDetail().then((detail) => detail.ok)
  }

  /**
   * 健康检查（含失败归因）— GET /health
   *
   * 与 healthCheck() 探测同一端点，额外返回失败原因，供服务状态面板区分
   * 「从未启动」「已启动但无响应」「端口被占用」等故障模式。
   *
   * @returns {Promise<{ ok: boolean, reason: string, statusCode: number|null }>}
   *   reason 取值：
   *     ok                 — 存活（HTTP 200 或 body.status 为 ok/healthy）
   *     connection_refused — 端口无监听（进程未启动 / 已退出）
   *     timeout            — 2s 内无响应（进程存活但卡死）
   *     http_error         — 返回 4xx/5xx
   *     unhealthy          — 返回 2xx 但 body 明确报告不健康
   *     unknown            — 其他网络错误
   */
  healthCheckDetail () {
    return new Promise((resolve) => {
      // Promise 的 resolve 幂等：error 与 timeout 可能先后触发，先到者胜出
      const settle = (ok, reason, statusCode) => resolve({ ok, reason, statusCode: Number.isInteger(statusCode) ? statusCode : null })
      let req
      try {
        req = http.get(`http://${this.host}:${this.port}/health`, { timeout: 2000 }, (res) => {
          let data = ''
          res.on('data', chunk => { data += chunk })
          res.on('end', () => {
            let bodyOk = false
            try {
              const p = JSON.parse(data)
              bodyOk = p.status === 'ok' || p.status === 'healthy'
            } catch { /* 非 JSON body：仅以状态码判定（与原 healthCheck 行为一致） */ }
            if (res.statusCode === 200 || bodyOk) return settle(true, 'ok', res.statusCode)
            if (res.statusCode >= 400) return settle(false, 'http_error', res.statusCode)
            return settle(false, 'unhealthy', res.statusCode)
          })
        })
      } catch {
        return settle(false, 'unknown', null)
      }
      req.on('error', (e) => {
        const code = e && e.code
        if (code === 'ECONNREFUSED' || code === 'ENOTFOUND' || code === 'EADDRNOTAVAIL') {
          return settle(false, 'connection_refused', null)
        }
        settle(false, 'unknown', null)
      })
      req.on('timeout', () => { req.destroy(); settle(false, 'timeout', null) })
    })
  }

  /**
   * 通用 POST 请求
   * @param {string} path - URL 路径
   * @param {string} body - 请求体（JSON 字符串）
   * @param {number} [timeout] - 超时 ms（默认使用 this.requestTimeout）
   * @param {string} [traceId] - 跨进程 traceId（如 pipeline runId）：存在时写 X-Request-Id 头并记 Bridge 日志，便于桌面↔Python 日志关联
   * @returns {Promise<object>}
   * @protected
   */
  async _post (path, body, timeout, traceId) {
    const reqTimeout = timeout || this.requestTimeout
    if (!this.isRunning) {
      try { await this.ensureRunning() } catch (e) { throw new Error(`${this.name} is not running and lazy-start failed: ${e instanceof Error ? e.message : String(e)}`, { cause: e }) }
    }
    // 仅记录 path + traceId，绝不记录 body（body 为业务数据，无需入日志）。
    // traceId 必须为 header 安全 ASCII（允许字母/数字/._:-，≤64），否则跳过头发送——
    // Node http.request 对非法头字符（如 CJK）会同步抛错，宁可降级不发送也不破坏请求。
    const safeTraceId = typeof traceId === 'string' && /^[A-Za-z0-9._:\-_]{1,64}$/.test(traceId) ? traceId : null
    const headers = { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    if (safeTraceId) {
      headers['X-Request-Id'] = safeTraceId
      this.log.info(this.name, `POST ${path} traceId=${safeTraceId}`)
    } else if (traceId) {
      this.log.warn(this.name, `POST ${path} 跳过非法 traceId（非 header 安全字符）`)
    }
    return new Promise((resolve, reject) => {
      const req = http.request({
        hostname: this.host, port: this.port, path, method: 'POST',
        headers,
        timeout: reqTimeout
      }, (res) => {
        let data = ''
        res.on('data', chunk => { data += chunk })
        res.on('end', () => {
          let parsed
          // logging-coverage-audit：非 JSON 响应此前静默降级，原始 body 不进日志
          try { parsed = JSON.parse(data) } catch {
            this.log.warn(this.name, 'POST ' + path + ' non-JSON response (len=' + data.length + '): ' + String(data).slice(0, 300))
            parsed = { code: -1, message: data }
          }
          if (res.statusCode && res.statusCode >= 400) {
            const detail = (parsed && (parsed.detail || parsed.message)) || data
            this.log.error(this.name, `POST ${path} HTTP ${res.statusCode}: ${typeof detail === 'string' ? detail.slice(0, 300) : JSON.stringify(detail).slice(0, 300)}`)
            reject(new Error(`HTTP ${res.statusCode}: ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`))
          } else {
            resolve(parsed)
          }
        })
      })
      req.on('error', e => { this.log.error(this.name, 'POST ' + path + ' request error: ' + e.message); reject(e) })
      req.on('timeout', () => { this.log.error(this.name, 'POST ' + path + ' timeout after ' + reqTimeout + 'ms'); req.destroy(); reject(new Error(`${this.name} request timeout`)) })
      req.write(body)
      req.end()
    })
  }

  /**
   * 停止子进程
   */
  async stop () {
    this._stopWatchdog()
    _unregisterBridge(this)
    if (!this.process) {
      this.isRunning = false
      return
    }
    this.log.info(this.name, `Stopping ${this.name}...`)
    if (process.platform === 'win32') {
      try { spawnSync('taskkill', ['/PID', String(this.process.pid), '/F', '/T'], { timeout: 5000 }) } catch (e) { this.log.warn(this.name, 'taskkill failed: ' + e.message) }
    } else {
      try { this.process.kill('SIGTERM') } catch (e) { this.log.warn(this.name, 'SIGTERM failed: ' + e.message) }
      await new Promise(r => setTimeout(r, 3000))
      try { if (this.process) this.process.kill('SIGKILL') } catch (_) { /* already exited */ }
    }
    this.process = null
    this.isRunning = false
    this.log.info(this.name, `${this.name} stopped`)
  }

  /**
   * 确保 Bridge 运行中 — 懒启动 / 自愈
   *
   * 当 isRunning=false（启动失败、看门狗放弃、进程崩溃后未恢复）时，
   * 自动尝试重新 start()，避免业务调用方直接收到 "is not running" 错误。
   * 并发调用共享同一个 _starting Promise，避免重复 spawn。
   *
   * @returns {Promise<void>}
   */
  async ensureRunning () {
    if (this.isRunning) return
    if (this._starting) return this._starting

    this.log.info(this.name, `${this.name} is not running, attempting lazy-start...`)
    this.restartCount = 0
    this._starting = this.start().catch((e) => {
      this.log.error(this.name, `Lazy-start failed: ${e instanceof Error ? e.message : String(e)}`)
      throw e
    }).finally(() => { this._starting = null })

    return this._starting
  }
}

module.exports = { BasePythonBridge, MAX_RESTARTS, WATCHDOG_INTERVAL, HEALTH_CHECK_TIMEOUT }
