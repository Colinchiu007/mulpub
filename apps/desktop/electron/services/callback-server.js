// @ts-check
/**
 * CallbackServer — 实时回调服务器
 *
 * 参考产品逆向分析 P1 功能：
 * - 轻量 HTTP 服务器，接收外部服务回调
 * - 心跳 59s 保活
 * - 回调数据通过 IPC 转发到渲染进程
 *
 * 端口：16521（避免常见端口冲突）
 *
 * 端点:
 *   GET  /health     — 健康检查
 *   POST /callback   — 接收回调 JSON（发布状态/评论通知/数据采集等）
 */
const http = require('http')
const crypto = require('crypto')
const log = require('./logger')
const { config } = require('../config/app-config')

const DEFAULT_PORT = config.callbackServer.port
const HEARTBEAT_MS = 59000  // 59s
const MAX_BODY_BYTES = 1024 * 1024  // 1MB body 上限，防止 DoS

class CallbackServer {
  constructor () {
    this.server = null
    this.port = DEFAULT_PORT
    this._heartbeatTimer = null
    this._onCallback = null
    this._requestCount = 0
    this._startTime = 0
    // 安全：回调鉴权 token，启动时随机生成（仅本应用进程知道）
    this._authToken = crypto.randomBytes(24).toString('hex')
  }

  /**
   * 获取鉴权 token（供主进程通过 IPC 注入到渲染进程，再由渲染进程发起回调时携带）
   * @returns {string}
   */
  getAuthToken () {
    return this._authToken
  }

  /**
   * 启动服务器
   * @param {function} onCallback - (data: object) => void 收到回调时触发
   * @param {number} [port] - 监听端口，默认 16521
   * @returns {Promise<number>} 实际端口
   */
  start (onCallback, port) {
    this.port = port || DEFAULT_PORT
    this._onCallback = onCallback
    this._startTime = Date.now()

    this.server = http.createServer((req, res) => this._handleRequest(req, res))

    return new Promise((resolve, reject) => {
      this.server.listen(this.port, config.callbackServer.host, () => {
        log.info('CallbackServer', `Listening on http://${config.callbackServer.host}:${this.port} (auth token enabled)`)
        this._startHeartbeat()
        resolve(this.port)
      })
      this.server.on('error', (err) => {
        log.error('CallbackServer', `Failed to start: ${err.message}`)
        reject(err)
      })
    })
  }

  _handleRequest (req, res) {
    this._requestCount++

    // 安全：CORS 限制为空（不允许跨域），仅本机进程通过 token 访问
    // 不再设置 Access-Control-Allow-Origin: *
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Callback-Token')

    if (req.method === 'OPTIONS') {
      res.writeHead(204)
      res.end()
      return
    }

    // ── GET /health — 健康检查（无需鉴权） ──────────────
    if (req.url === '/health' || req.url === '/') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({
        status: 'ok',
        uptime: Math.round((Date.now() - this._startTime) / 1000),
        requests: this._requestCount,
        timestamp: Date.now(),
      }))
      return
    }

    // ── POST /callback — 接收外部回调（需鉴权） ────────
    if (req.method === 'POST' && req.url.split('?')[0] === '/callback') {
      // 安全：校验 token（header 或 query）
      const queryToken = (req.url.split('?')[1] || '').split('&').map(kv => kv.split('=')).find(p => p[0] === 'token')
      const token = req.headers['x-callback-token'] || (queryToken && queryToken[1])
      if (!token || token !== this._authToken) {
        log.warn('CallbackServer', 'Callback rejected: invalid or missing auth token')
        res.writeHead(401, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ code: -1, message: 'Unauthorized: invalid callback token' }))
        return
      }

      // 安全：body 大小限制，防止 DoS
      let body = ''
      let bodyBytes = 0
      let tooLarge = false
      req.on('data', (chunk) => {
        if (tooLarge) return
        bodyBytes += chunk.length
        if (bodyBytes > MAX_BODY_BYTES) {
          tooLarge = true
          res.writeHead(413, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ code: -1, message: 'Body too large' }))
          return
        }
        body += chunk
      })
      req.on('end', () => {
        if (tooLarge) return
        let data
        try {
          data = JSON.parse(body)
        } catch (e) {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ code: -1, message: `Invalid JSON: ${e.message}` }))
          return
        }

        log.debug('CallbackServer', `Callback received: ${JSON.stringify(data).slice(0, 300)}`)

        if (this._onCallback) {
          this._onCallback(data)
        }

        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ code: 0, message: 'ok', timestamp: Date.now() }))
      })
      return
    }

    // ── 404 ─────────────────────────────────
    res.writeHead(404)
    res.end('Not Found')
  }

  _startHeartbeat () {
    this._stopHeartbeat()
    this._heartbeatTimer = setInterval(() => {
      log.debug('CallbackServer', `♥ ${this._requestCount} requests since start`)
    }, HEARTBEAT_MS)
    this._heartbeatTimer.unref()  // 不阻止进程退出
  }

  _stopHeartbeat () {
    if (this._heartbeatTimer) {
      clearInterval(this._heartbeatTimer)
      this._heartbeatTimer = null
    }
  }

  /** 停止服务器 */
  stop () {
    this._stopHeartbeat()
    if (this.server) {
      this.server.close()
      this.server = null
      log.info('CallbackServer', 'Stopped')
    }
  }
}

module.exports = CallbackServer