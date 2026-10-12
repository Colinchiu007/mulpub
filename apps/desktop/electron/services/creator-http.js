'use strict'

/**
 * creator-http.js — 多平台采集的带 header 网络层（Node 内置 https，零依赖）
 *
 * 与 creator-collector-runtime 的 defaultHttpGet 同族，差异：
 *   - 支持自定义 headers（Cookie / X-S 等签名头）；
 *   - `returnFullResponse: true` 返回 { status, body }——签名失败/风控的判定
 *     需要 **状态码**，而默认实现非 2xx 直接 reject 且只留 message。
 */

const https = require('https')
const http = require('http')

function request (url, { headers = {}, method = 'GET', body = null } = {}) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https://') ? https : http
    let u
    try { u = new URL(url) } catch (e) { reject(e); return }
    const req = mod.request({
      hostname: u.hostname,
      port: u.port || (u.protocol === 'https:' ? 443 : 80),
      path: u.pathname + u.search,
      method,
      headers: Object.assign({
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        Accept: 'application/json, text/plain, */*',
        'Accept-Language': 'zh-CN,zh;q=0.9',
      }, headers),
    }, (res) => {
      let raw = ''
      res.on('data', (d) => { raw += d })
      res.on('end', () => resolve({ status: res.statusCode, body: raw, headers: res.headers }))
    })
    req.on('error', (e) => {
      e.response = null
      reject(e)
    })
    req.setTimeout(20000, () => {
      req.destroy(new Error('creator-http timeout (20s)'))
    })
    if (body) req.write(body)
    req.end()
  })
}

/** 带自定义 header 的 GET。默认（无 returnFullResponse）保持旧实现语义：2xx → JSON，4xx/5xx → reject 带 response.status */
async function httpGetWithHeaders (url, params = {}, opts = {}) {
  const qs = Object.entries(params.params || {})
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&')
  const full = `${url}${url.includes('?') ? '&' : '?'}${qs}`
  const res = await request(full, { headers: params.headers || {} })
  if (opts.returnFullResponse || params.returnFullResponse) return { status: res.status, body: res.body }
  if (res.status >= 400) {
    const err = new Error(`HTTP ${res.status}`)
    err.response = { status: res.status, data: res.body }
    throw err
  }
  let json = null
  try { json = JSON.parse(res.body) } catch (_) { /* 交给上层判定 */ }
  return json
}

module.exports = { request, httpGetWithHeaders }
