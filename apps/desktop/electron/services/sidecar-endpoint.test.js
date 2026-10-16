// @ts-check
/**
 * sidecar-endpoint.test.js — sidecar-host 暴露 CDP 端点契约（PR-2 §7.3 薄接线）
 *
 * 判据来源：design.md D4「sidecar-host 契约四件套」的实现补全 + PRD §3.4
 * 「CDP/WebSocket 仅绑 127.0.0.1 + 一次性 token」。
 *
 * 为什么需要它：`createCamofoxInput()`（§7.2）需要完整 WS URL 才能建连，而 URL 里
 * 必须带 sidecar-host 在 start() 时生成的一次性 token。role 划分：
 *   sidecar-host = 管进程/端口/token 的宿主（唯一知道 token 的一方）
 *   camofox 驱动 = 只拿到 endpoint 去建连，不该自己拼 token
 *
 * 契约：
 *  1. endpoint() 只在 start() 成功后可用；未 start / 已 stop ⇒ 抛错（fail-closed）
 *  2. URL 形态 = ws://127.0.0.1:<port>/devtools/page/<pageId>?token=<64hex>
 *     —— host 恒为 127.0.0.1（不问 manifest 配什么，防配错）
 *  3. token 每次 start() 重新生成（不跨会话复用）；且 endpoint() 返回的 URL 里的
 *     token 与 start() 返回值里的 token 一致（同一份）
 *  4. endpoint() 可重复调用且返回值稳定（幂等）；但每次调用都重新校验仍在运行
 */
import { describe, it, expect } from 'vitest'
const { createSidecarHost } = require('./sidecar-host')

const TOKEN_A = 'a'.repeat(64)
const TOKEN_B = 'b'.repeat(64)

// 模块级 pid 计数器：两个 sidecar 实例必须拿到不同 pid（pageId 可区分的前提）。
// 放在 makeDeps 内部会被每次调用重置，两个 host 又变回同一个 pid。
let PID_SEQ = 4242

function makeDeps (tokens, over = {}) {
  const spawnCalls = []
  let i = 0
  const fs = require('fs')
  const os = require('os')
  const path = require('path')
  const deps = {
    workDir: fs.mkdtempSync(path.join(os.tmpdir(), 'mp-ep-' + process.pid + '-')),
    logger: { warn () {}, info () {} },
    // 必须真写文件：sidecar-host.start() 随后会 copyFileSync(stage → final)
    fetchFile: async (_url, dest) => { fs.writeFileSync(dest, 'payload') },
    sha256File: async () => 'c'.repeat(64),
    probePort: async () => ({ ok: true }),
    spawn: (command, args, opts) => {
      spawnCalls.push({ command, args, opts })
      const child = { pid: PID_SEQ++, on: () => {}, kill () { this.killed = true } }
      return child
    },
    randomHex: () => tokens[Math.min(i++, tokens.length - 1)],
  }
  return { deps: Object.assign(deps, over.deps || {}), calls: { spawnCalls } }
}

const MANIFEST = {
  id: 'camofox',
  vendor: 'camofox',
  version: '1.18.1',
  license: 'MPL-2.0',
  listen: { host: '127.0.0.1', port: 9222 },
  download: { url: 'https://example.invalid/x', sha256: 'c'.repeat(64) },
  bin: { command: 'camofox', args: [] },
}

describe('sidecar-host.endpoint() — §7.3 CDP 端点暴露', () => {
  it('① 未 start 就调 endpoint() ⇒ 抛错（fail-closed）', () => {
    const { deps } = makeDeps([TOKEN_A])
    const host = createSidecarHost(MANIFEST, deps)
    expect(() => host.endpoint()).toThrow(/未启动|not-running|not started/i)
  })

  it('① stop() 后再调 endpoint() ⇒ 抛错', async () => {
    const { deps } = makeDeps([TOKEN_A])
    const host = createSidecarHost(MANIFEST, deps)
    await host.start()
    await host.stop()
    expect(() => host.endpoint()).toThrow(/未启动|not-running|stopped/i)
  })

  it('② URL 形态 = ws://127.0.0.1:<port>/devtools/page/<pageId>?token=<64hex>', async () => {
    const { deps } = makeDeps([TOKEN_A])
    const host = createSidecarHost(MANIFEST, deps)
    await host.start()
    const url = host.endpoint()
    expect(url).toMatch(/^ws:\/\/127\.0\.0\.1:9222\/devtools\/page\/[A-Za-z0-9_-]+\?token=[0-9a-f]{64}$/)
  })

  it('② host 恒为 127.0.0.1 —— 即使 manifest 配错也纠正（防非回环监听）', async () => {
    const { deps } = makeDeps([TOKEN_A])
    const host = createSidecarHost(Object.assign({}, MANIFEST, {
      listen: { host: '0.0.0.0', port: 9222 },
    }), deps)
    await host.start()
    expect(host.endpoint()).toMatch(/^ws:\/\/127\.0\.0\.1:9222\//)
  })

  it('③ 每次 start() 重新生成 token，不跨会话复用', async () => {
    const { deps } = makeDeps([TOKEN_A, TOKEN_B])
    const host = createSidecarHost(MANIFEST, deps)
    const r1 = await host.start()
    const u1 = host.endpoint()
    await host.stop()
    const r2 = await host.start()
    const u2 = host.endpoint()
    expect(r1.token).not.toBe(r2.token)
    expect(u1).not.toBe(u2)
  })

  it('③ endpoint() 的 token 与 start() 返回值一致（同一份）', async () => {
    const { deps } = makeDeps([TOKEN_A])
    const host = createSidecarHost(MANIFEST, deps)
    const r = await host.start()
    expect(host.endpoint()).toContain('token=' + r.token)
  })

  it('④ endpoint() 幂等：同一会话内重复调用返回同一 URL', async () => {
    const { deps } = makeDeps([TOKEN_A])
    const host = createSidecarHost(MANIFEST, deps)
    await host.start()
    expect(host.endpoint()).toBe(host.endpoint())
  })

  it('④ pageId 带 pid：不同 sidecar 实例的端点必须可区分', async () => {
    // pid 的作用不是"会话内幂等"（那由 token 不变保证），而是两个 sidecar 实例
    // （不同 pid）必须给出不同 pageId —— 否则并行跑两个 sidecar 时调用方无法
    // 判断连的是哪一个。（M4 变异专锁：把 'page-'+pid 改成常量 'page' 必须红。）
    const { deps: d1 } = makeDeps([TOKEN_A])
    const { deps: d2 } = makeDeps([TOKEN_A])
    const h1 = createSidecarHost(MANIFEST, d1)
    const h2 = createSidecarHost(MANIFEST, d2)
    await h1.start()
    await h2.start()
    // 即使 token 相同（测试注入相同），pageId 也必须不同
    expect(h1.endpoint()).not.toBe(h2.endpoint())
    await h1.stop(); await h2.stop()
  })
})
