'use strict'
/**
 * fake-http.js — 契约测试假 HTTP 服务器基建（W1 §3.1）
 *
 * 本机 127.0.0.1:0 临时端口，记录逐字请求序列（method/url/headers/body），
 * 提供可编程路由与请求断言器。所有平台契约测试仅对本机假服务器发请求，
 * 杜绝测试外发（配合远程签名通道拆除构成双保险）。
 */
const http = require('http')

/**
 * @param {Array<{method?: string, match: string | RegExp, status?: number,
 *   headers?: object, body: any, raw?: boolean, times?: number}>} routes 按序匹配（times 限定命中次数，
 *   供重试序列编程）；body 为对象时 JSON 应答，raw=true 时原样字符串应答
 * @returns {Promise<{url: string, port: number, requests: Array,
 *   requestsFor(path): Array, reset(): void, close(): Promise<void>}>}
 */
async function startFakeServer (routes = []) {
  const requests = []
  const hits = routes.map(() => 0)
  const server = http.createServer((req, res) => {    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => {
      const rawBody = Buffer.concat(chunks)
      let parsed = null
      const ctype = String(req.headers['content-type'] || '')
      if (rawBody.length > 0) {
        if (ctype.includes('application/json')) {
          try { parsed = JSON.parse(rawBody.toString('utf8')) } catch { parsed = rawBody.toString('utf8') }
        } else if (/^text\/(plain|html)/.test(ctype)) {
          parsed = rawBody.toString('utf8')
        } else {
          parsed = rawBody // Buffer：二进制分片原样保留
        }
      }
      requests.push({
        method: req.method,
        url: req.url,
        headers: req.headers,
        body: parsed,
        rawBody,
        byteLength: rawBody.length,
      })
      const idx = routes.findIndex((r, i) =>
        (r.times === undefined || hits[i] < r.times) &&
        (!r.method || r.method.toUpperCase() === req.method) &&
        (typeof r.match === 'string' ? req.url === r.match : r.match.test(req.url)))
      const route = idx >= 0 ? routes[idx] : null
      if (idx >= 0) hits[idx]++
      if (!route) {
        res.writeHead(404, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ error: 'no route for ' + req.method + ' ' + req.url }))
        return
      }
      const headers = Object.assign({}, route.headers)
      let payload
      if (route.raw) {
        payload = typeof route.body === 'string' ? route.body : route.body.toString('utf8')
        if (!headers['content-type']) headers['content-type'] = 'text/html'
      } else {
        payload = JSON.stringify(route.body)
        if (!headers['content-type']) headers['content-type'] = 'application/json'
      }
      res.writeHead(route.status || 200, headers)
      res.end(payload)
    })
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  return {
    url: 'http://127.0.0.1:' + port,
    port,
    routes,
    requests,
    requestsFor (path) {
      return requests.filter((r) => (typeof path === 'string' ? r.url === path : path.test(r.url)))
    },
    /**
     * 就地替换某条路由的响应体。
     *
     * 为什么需要：有些响应必须回填**服务器自己的** host（如 `UploadHost`），
     * 而 host 要等 `listen(0)` 拿到端口后才存在 ⇒ 只能启动后改。按引用改
     * `routes[i].body` 即可，因为请求处理时是按引用读 `route.body` 的。
     *
     * @param {string|RegExp} match 与路由 `match` 相同的选择器
     * @param {any} body 新的响应体（对象⇒JSON，raw 路由则原样）
     */
    replaceRouteBody (match, body) {
      let n = 0
      for (const r of routes) {
        const same = typeof match === 'string' ? r.match === match : String(r.match) === String(match)
        if (same) { r.body = body; n++ }
      }
      if (n === 0) throw new Error('replaceRouteBody: 未命中任何路由: ' + String(match))
      return n
    },
    reset () { requests.length = 0 },
    close () { return new Promise((resolve) => server.close(resolve)) },
  }
}

/** 请求序列摘要：["POST /a", "PUT /b"]，用于顺序断言 */
function methodPathList (requests) {
  return requests.map((r) => r.method + ' ' + r.url.split('?')[0])
}

module.exports = { startFakeServer, methodPathList }
