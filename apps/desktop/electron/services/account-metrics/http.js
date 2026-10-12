// @ts-check
/**
 * account-metrics/http — 采集侧的最小 HTTP 传输层
 *
 * 为什么不复用别的封装：本仓主进程里有四种发请求的方式（axios / fetch / 原生 http / 各自的
 * 局部封装），没有一个带「把响应体当 JSON 解析并把失败**如实返回**」的契约。
 * 采集侧需要的契约只有三条，越窄越好：
 *   ① 超时必须有（平台侧偶发挂连接时不能把整轮采集拖死）；
 *   ② 失败返回 `{statusCode, json: null}` 而**不抛错**，由编排层按状态码判失败并出声
 *      （抛错会让「HTTP 500」与「socket 断开」在日志里长得一样，排障时无法区分）；
 *   ③ **绝不打印 Cookie / 请求头**（凭证只经 headers 传递，日志里只出现 host 与状态码）。
 *
 * `fetch` 在 Electron 主进程（Node 22）原生可用，因此不引入依赖。
 */
'use strict'

const log = require('../logger')

/**
 * 只取 host 用于日志（完整 URL 里可能带签名参数 / 会话 token，落日志等于泄露凭证）。
 * @param {string} url
 */
function safeHost (url) {
  try { return new URL(String(url)).host } catch (_) { return '' }
}

/**
 * 发一次请求并把响应体解析成 JSON。
 *
 * @param {object} req
 * @param {string} req.url
 * @param {string} [req.method]
 * @param {object} [req.headers]
 * @param {object} [req.body] POST 时的 JSON body
 * @param {number} [req.timeoutMs]
 * @returns {Promise<{statusCode: number, json: any}>}
 */
async function httpRequest (req) {
  const r = req || {}
  const url = String(r.url || '')
  const method = String(r.method || 'GET').toUpperCase()
  const timeoutMs = Number.isFinite(r.timeoutMs) ? r.timeoutMs : 10000
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const init = { method, headers: { ...(r.headers || {}) }, signal: controller.signal }
    if (r.body !== undefined && r.body !== null && method !== 'GET' && method !== 'HEAD') {
      init.body = typeof r.body === 'string' ? r.body : JSON.stringify(r.body)
    }
    const res = await fetch(url, init)
    const status = Number(res && res.status) || 0
    let json = null
    try {
      const text = await res.text()
      json = text ? JSON.parse(text) : null
    } catch (_) {
      // 非 JSON 响应（登录页 HTML / WAF 拦截页）保持 json=null，由编排层按 invalid_json 判失败。
      // 这里不把 HTML 片段写进日志：它可能含账号名等页面元素。
      json = null
    }
    if (status < 200 || status >= 300) {
      log.warn('AccountMetrics', 'http ' + status + ' host=' + safeHost(url))
    }
    return { statusCode: status, json }
  } catch (e) {
    // 网络级失败：状态码 0，编排层据此记 request_error 并进入失败计数
    log.warn('AccountMetrics', 'http failed host=' + safeHost(url) + ' err=' + ((e && e.message) || e))
    return { statusCode: 0, json: null }
  } finally {
    clearTimeout(timer)
  }
}

module.exports = { httpRequest, safeHost }
