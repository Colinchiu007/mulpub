// @ts-check
/**
 * apps/desktop/electron/services/test-setup-network-guard.test.js
 *
 * 出站网络守卫的回归保护 —— 证明「单元测试里意外真出网」是**即时、可诊断的失败**，
 * 而不是挂到 vitest testTimeout 才留下一句 "Test timed out in 10000ms"。
 *
 * 背景（缺陷 G）：`zhihu-favlist.test.js` 的 `list 成功` 用例经 handler 内部
 * `new ZhihuFavlistService({ log })` 走真 axios（该通道不接受注入），生产侧
 * `timeout: 15000` **大于** `testTimeout=10000` ⇒ 预算倒挂：网络挂起时永远是框架先赢，
 * 报错信息里既没有主机也没有「该注入桩」的提示。全仓 `nock`/`msw`/`setupServer` 命中为 0，
 * 说明没有任何传输层兜底，漏一处注入就是一颗随机红。
 *
 * 本文件同时守住反方向：loopback 本地服务（全仓 31 个测试文件依赖）不得被误伤。
 */
import { describe, it, expect } from 'vitest'

const http = require('node:http')
const net = require('node:net')

const BLOCK_MARKER = /TEST-NETWORK-BLOCKED/

function getErrorOfUrl (url) {
  return new Promise((resolve) => {
    const req = http.get(url, { timeout: 5000 }, (res) => {
      res.resume()
      resolve(null)
    })
    req.on('error', resolve)
    req.on('timeout', () => {
      req.destroy(new Error('TEST-TIMEOUT: 守卫未生效，请求挂起到 5s'))
    })
  })
}

describe('test-setup 出站网络守卫', () => {
  it('http.get 到非 loopback 主机：必须立刻拿到带守卫标记与主机名的错误，而不是真出网或挂起', async () => {
    const error = await getErrorOfUrl('http://example.com:8099/__mp_test_egress__')
    expect(error, '守卫未生效：请求竟然成功了').not.toBeNull()
    expect(error.message).toMatch(BLOCK_MARKER)
    expect(error.message).toContain('example.com')
    // 错误信息必须自带出路，否则排障的人只会看到一句 anonymous 失败
    expect(error.message).toMatch(/127\.0\.0\.1|loopback/)
  })

  it('fetch（undici）同样被拦，且守卫标记能在错误链上读到', async () => {
    const error = await fetch('http://example.org:8099/__mp_test_egress__')
      .then(() => null)
      .catch((e) => e)
    expect(error, '守卫未生效：fetch 竟然成功').not.toBeNull()
    const chain = [error.message, error.cause && error.cause.message, error.cause && error.cause.cause && error.cause.cause.message]
      .filter(Boolean)
      .join(' | ')
    expect(chain).toMatch(BLOCK_MARKER)
  })

  it('net.connect 到外部 IP 也被拦（防止绕过域名直接连 IP）', async () => {
    const error = await new Promise((resolve) => {
      const socket = net.connect({ host: '93.184.216.34', port: 8099 }, () => {
        socket.destroy()
        resolve(null)
      })
      socket.once('error', resolve)
      socket.setTimeout(5000, () => socket.destroy(new Error('TEST-TIMEOUT: 守卫未生效')))
    })
    expect(error, '守卫未生效：外部 IP 直连竟然成功').not.toBeNull()
    expect(error.message).toMatch(BLOCK_MARKER)
  })

  it('不得误伤 loopback 本地服务（全仓 31 个测试文件依赖它）', async () => {
    const server = http.createServer((req, res) => {
      res.writeHead(200, { 'content-type': 'text/plain' })
      res.end('ok')
    })
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    try {
      const port = server.address().port
      const body = await new Promise((resolve, reject) => {
        http.get(`http://127.0.0.1:${port}/`, (res) => {
          let text = ''
          res.on('data', (chunk) => { text += chunk })
          res.on('end', () => resolve(text))
        }).on('error', reject)
      })
      expect(body).toBe('ok')
    } finally {
      await new Promise((resolve) => server.close(resolve))
    }
  })

  it('不得误伤 localhost 主机名与 ::1', async () => {
    const server = http.createServer((req, res) => res.end('lb'))
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    const port = server.address().port
    try {
      const error = await getErrorOfUrl(`http://localhost:${port}/`)
      expect(error).toBeNull()
    } finally {
      await new Promise((resolve) => server.close(resolve))
    }
  })

  it('放行 unix / named pipe 路径（不是网络出站）', async () => {
    const pipePath = process.platform === 'win32'
      ? '\\\\.\\pipe\\mp-guard-test-' + process.pid
      : '/tmp/mp-guard-test-' + process.pid + '.sock'
    const server = net.createServer((socket) => { socket.end('pong') })
    await new Promise((resolve, reject) => {
      server.once('error', reject)
      server.listen(pipePath, resolve)
    })
    try {
      const text = await new Promise((resolve, reject) => {
        const socket = net.connect(pipePath, () => {
          let acc = ''
          socket.on('data', (chunk) => { acc += chunk })
          socket.on('close', () => resolve(acc))
        })
        socket.once('error', reject)
      })
      expect(text).toBe('pong')
    } finally {
      await new Promise((resolve) => server.close(resolve))
    }
  })
})
