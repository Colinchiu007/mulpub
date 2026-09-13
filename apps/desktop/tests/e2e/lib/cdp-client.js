// @ts-check
/**
 * cdp-client.js — 极简 Chrome DevTools Protocol 客户端（WebSocket 直连）
 *
 * 为什么不用 Playwright 的 connectOverCDP：
 *   本机（Electron 43 / Chrome 150）实测 `chromium.connectOverCDP()` 侧握手会稳定超时
 *   （15s×6 次全部 timeout），而直接对 `http://127.0.0.1:<cdp>/json/list` +
 *   `webSocketDebuggerUrl` 发 `Runtime.evaluate` 则完全正常。E2E 驱动只需要
 *   「执行表达式 + 等待条件」，因此收敛到这个零依赖（仅 ws）的最小实现，
 *   既避开 Playwright 握手不确定性，也避免 UI 覆盖层导致的点击命中问题
 *   （点击一律走 DOM `.click()`，与既有 driver 的处置一致）。
 *
 * 依赖：`ws`（repo 根 node_modules 已具备）。
 */
'use strict'

const http = require('http')
const WebSocket = require(process.env.WS_REQUIRE || 'ws')

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** GET http://127.0.0.1:port/path → JSON */
function getJson (port, path) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port, path, timeout: 10000 }, (res) => {
      let data = ''
      res.on('data', (c) => { data += c })
      res.on('end', () => {
        try { resolve(JSON.parse(data)) } catch (e) { reject(new Error('JSON parse failed: ' + data.slice(0, 200))) }
      })
    })
    req.on('timeout', () => { req.destroy(new Error('http timeout')) })
    req.on('error', reject)
  })
}

class CdpClient {
  constructor (ws, pageTarget, cdpPort) {
    this._ws = ws
    this._id = 0
    this._pending = new Map()
    this.target = pageTarget
    this.cdpPort = cdpPort
    ws.on('message', (buf) => {
      let msg
      try { msg = JSON.parse(buf.toString()) } catch (_) { return }
      if (msg.id && this._pending.has(msg.id)) {
        const { resolve, reject, timer } = this._pending.get(msg.id)
        this._pending.delete(msg.id)
        clearTimeout(timer)
        if (msg.error) reject(new Error('CDP error: ' + JSON.stringify(msg.error)))
        else resolve(msg.result)
      }
    })
    ws.on('close', () => {
      for (const { reject, timer } of this._pending.values()) { clearTimeout(timer); reject(new Error('CDP socket closed')) }
      this._pending.clear()
    })
    ws.on('error', (e) => {
      for (const { reject, timer } of this._pending.values()) { clearTimeout(timer); reject(e) }
      this._pending.clear()
    })
  }

  /** 低层命令 */
  send (method, params = {}, timeoutMs = 120000) {
    const id = ++this._id
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this._pending.delete(id); reject(new Error('CDP send timeout: ' + method)) }, timeoutMs)
      if (timer && timer.unref) timer.unref()
      this._pending.set(id, { resolve, reject, timer })
      try { this._ws.send(JSON.stringify({ id, method, params })) } catch (e) { clearTimeout(timer); reject(e) }
    })
  }

  /**
   * 执行表达式并取回值。
   * @param {string} expression 需为可求值表达式（支持 `await` 需包在 async IIFE 中）
   */
  async evaluate (expression, timeoutMs = 120000) {
    const res = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true,
      timeout: timeoutMs,
    }, timeoutMs + 10000)
    if (res.exceptionDetails) {
      throw new Error('evaluate exception: ' + JSON.stringify(res.exceptionDetails).slice(0, 500))
    }
    return res.result ? res.result.value : undefined
  }

  /** 轮询直到表达式返回 truthy */
  async waitFor (expression, { timeout = 60000, interval = 500, label = 'condition' } = {}) {
    const deadline = Date.now() + timeout
    let last
    while (Date.now() < deadline) {
      try {
        last = await this.evaluate(expression, 30000)
        if (last) return last
      } catch (e) { last = 'EVAL_ERR: ' + e.message }
      await sleep(interval)
    }
    throw new Error('waitFor 超时 (' + timeout + 'ms): ' + label + ' last=' + JSON.stringify(last).slice(0, 300))
  }

  close () { try { this._ws.close() } catch (_) {} }

  /**
   * 连接指定 CDP 端口下的 renderer 页面。
   * @param {number|string} cdpPort
   * @param {string} originPrefix 形如 http://127.0.0.1:6919
   * @param {{ retries?: number, backoffMs?: number }} [opts]
   */
  static async attach (cdpPort, originPrefix, opts = {}) {
    const retries = opts.retries || 10
    const backoffMs = opts.backoffMs || 3000
    let lastErr = null
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        const targets = await getJson(cdpPort, '/json/list')
        const page = (targets || []).find((t) => t.type === 'page' && String(t.url || '').startsWith(originPrefix))
        if (page && page.webSocketDebuggerUrl) {
          const ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false, maxPayload: 256 * 1024 * 1024 })
          await new Promise((resolve, reject) => {
            const t = setTimeout(() => reject(new Error('ws open timeout')), 15000)
            ws.on('open', () => { clearTimeout(t); resolve(true) })
            ws.on('error', (e) => { clearTimeout(t); reject(e) })
          })
          return new CdpClient(ws, page, cdpPort)
        }
        lastErr = new Error('未找到 renderer 页面 (origin=' + originPrefix + ')，targets=' +
          JSON.stringify((targets || []).map((t) => t.type + ':' + String(t.url).slice(0, 60))))
      } catch (e) {
        lastErr = e
      }
      await sleep(backoffMs)
    }
    throw new Error('CDP attach ' + retries + ' 次失败: ' + (lastErr && lastErr.message))
  }
}

module.exports = { CdpClient, sleep, getJson }
