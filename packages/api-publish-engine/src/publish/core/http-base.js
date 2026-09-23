'use strict'
/**
 * http-base.js — $http 等价基座（W1 §3.2）
 *
 * 对齐参考产品 HTTP 层行为：
 * - axios 实例工厂：默认 timeout 60s；可注入 httpAgent/httpsAgent（代理）
 * - 风控重试：响应非 JSON（平台返回 HTML 风控页）视为被拦截信号，
 *   重试至总尝试 maxAttempts（默认 3）封顶；HTTP 状态码错误不属于该重试条件
 * - 重试间隔可配（retryDelayMs），耗尽抛 PublishHttpError(data_error)
 */
const axios = require('axios')
const { errorCode } = require('../../error-codes')

const DEFAULT_TIMEOUT_MS = 60000
const DEFAULT_MAX_ATTEMPTS = 3

/** 业务性 HTTP 错误载体，code 对齐统一错误码体系 */
class PublishHttpError extends Error {
  constructor (message, code, detail) {
    super(message)
    this.name = 'PublishHttpError'
    this.code = code === undefined ? errorCode.request_error : code
    if (detail !== undefined) this.detail = detail
  }
}

/**
 * @param {{baseURL?: string, timeout?: number, headers?: object,
 *   agents?: {httpAgent?: object, httpsAgent?: object}, validateStatus?: function}} [opts]
 */
function createHttpClient (opts = {}) {
  const config = {
    timeout: opts.timeout === undefined ? DEFAULT_TIMEOUT_MS : opts.timeout,
    // 参考产品口径：状态码错误交由调用方判断；!isJson 重试在此层之上实现
    validateStatus: opts.validateStatus || ((s) => s >= 200 && s < 300),
  }
  if (opts.baseURL !== undefined) config.baseURL = opts.baseURL
  if (opts.headers !== undefined) config.headers = opts.headers
  if (opts.agents && opts.agents.httpAgent) config.httpAgent = opts.agents.httpAgent
  if (opts.agents && opts.agents.httpsAgent) config.httpsAgent = opts.agents.httpsAgent
  return axios.create(config)
}

function isJsonResponse (res) {
  if (!res) return false
  const ctype = String((res.headers && (res.headers['content-type'] || res.headers['Content-Type'])) || '')
  if (ctype.includes('json')) return true
  return res.data !== null && typeof res.data === 'object'
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * 带风控重试的请求：retryCondition = 响应非 JSON（风控 HTML），
 * 总尝试（含首次）封顶 maxAttempts；状态码错误直接抛出、不重试。
 * @param {object} client axios 实例（createHttpClient 产物）
 * @param {object} requestConfig axios 请求配置
 * @param {{maxAttempts?: number, retryDelayMs?: number, isJson?: function}} [opts]
 */
async function requestWithRetry (client, requestConfig, opts = {}) {
  const maxAttempts = opts.maxAttempts || DEFAULT_MAX_ATTEMPTS
  const retryDelayMs = opts.retryDelayMs === undefined ? 1000 : opts.retryDelayMs
  const jsonLike = opts.isJson || isJsonResponse
  let lastErr = null
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await client.request(requestConfig)
      if (jsonLike(res)) return res
      lastErr = new PublishHttpError(
        'http-base: risk-control response (non-JSON) at ' + requestConfig.method + ' ' + requestConfig.url,
        errorCode.data_error)
    } catch (e) {
      // axios 状态码/网络错误：不满足 !isJson 重试条件，直接抛（保留原始语义）
      if (e && e.response) throw e
      lastErr = new PublishHttpError('http-base: request failed: ' + e.message, errorCode.request_error)
    }
    if (attempt < maxAttempts && retryDelayMs > 0) await sleep(retryDelayMs)
  }
  throw lastErr
}

module.exports = {
  createHttpClient,
  requestWithRetry,
  isJsonResponse,
  PublishHttpError,
  DEFAULT_TIMEOUT_MS,
  DEFAULT_MAX_ATTEMPTS,
}
