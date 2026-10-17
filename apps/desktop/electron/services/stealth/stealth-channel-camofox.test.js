// @ts-check
/**
 * stealth-channel-camofox.test.js — F3 camofox 驱动契约（tasks 7.2）
 *
 * 判据来源：design.md D2（两驱动同接口）+ PRD §3.4（仅绑 127.0.0.1 + 一次性 token）
 *
 * 契约：
 *  A 组（与 cdp-input 同接口同返回语义——D2「传输无关接口先行」）
 *    1. 五方法同名同签名；getBounds 失败返回 null 不抛；dispatch/typeText 失败返回 false
 *    2. CDP 命令序列与 cdp-input 一致：DOM.enable→getDocument→querySelector→getBoxModel；
 *       Input.dispatchMouseEvent（mouseMoved/mousePressed/mouseReleased）；
 *       Input.insertText 逐字符
 *    3. 合成 9 字段事件走 **Runtime.evaluate**（camoufox 无 executeJavaScript）且 returnByValue
 *  B 组（F3 特有安全）
 *    4. 非 127.0.0.1 端点一律 fail-closed 拒绝建连（构造时即抛）
 *    5. 非 ws/wss 协议拒绝
 *    6. 建连后 CDP 消息与日志不得再带 token（一次性消费）
 *    7. close() 幂等；关闭后再调用失败不抛（返回 null/false）
 *    8. CDP error 响应 → reject → 上层降级（不吞成 undefined）
 */
import { describe, it, expect, vi } from 'vitest'
const { createCamofoxInput, createCdpClient, assertLoopbackEndpoint } = require('./stealth-channel-camofox')

/** 假 WebSocket：按方法名自动应答（计数器无关，彻底消除 microtask 时序竞争） */
function makeFakeWs (canned = {}) {
  const sent = []
  const ws = {
    readyState: 1,
    sent,
    closed: false,
    send (s) {
      sent.push(s)
      const req = JSON.parse(s)
      const c = canned[req.method]
      if (c === undefined) return
      const payload = (c instanceof Error)
        ? { id: req.id, error: { code: -32000, message: c.message } }
        : { id: req.id, result: c }
      // 异步回，模拟真实网络往返；但无需测试方数 tick
      queueMicrotask(() => ws.onmessage(JSON.stringify(payload)))
    },
    close () { this.closed = true },
    onmessage: null,
  }
  return ws
}

/** 构建常用罐头响应 */
function boundsCanned () {
  return {
    'DOM.enable': {},
    'DOM.getDocument': { root: { nodeId: 1 } },
    'DOM.querySelector': { nodeId: 7 },
    'DOM.getBoxModel': { model: { content: [10, 20, 110, 20, 110, 120, 10, 120] } },
    'Input.dispatchMouseEvent': {},
    'Input.insertText': {},
    'Runtime.evaluate': { result: { value: true } },
  }
}

const ENDPOINT = 'ws://127.0.0.1:9222/devtools/page/ABC?token=' + 'f'.repeat(64)

describe('camofox 驱动 — A 组：与 cdp-input 同接口（D2）', () => {
  it('五方法同名且返回语义一致：getBounds 失败返回 null、dispatch/typeText 失败返回 false', async () => {
    // 每个方法的**第一步**即失败，故三条路径都立刻降级（不会挂等在无人应答的请求上）
    const ws = makeFakeWs({
      'DOM.enable': new Error('no dom'),
      'Input.dispatchMouseEvent': new Error('no input'),
      'Input.insertText': new Error('no insert'),
    })
    const driver = createCamofoxInput({ endpoint: ENDPOINT, wsFactory: () => ws })
    await expect(driver.getBounds('#x')).resolves.toBeNull()
    await expect(driver.dispatch('down', 1, 2)).resolves.toBe(false)
    await expect(driver.typeText('a')).resolves.toBe(false)
    ws.closed = true
  })

  it('getBounds 命令序列 = DOM.enable→getDocument→querySelector→getBoxModel，中心点算对', async () => {
    const ws = makeFakeWs(boundsCanned())
    const driver = createCamofoxInput({ endpoint: ENDPOINT, wsFactory: () => ws })
    const r = await driver.getBounds('#t')
    // content 四点 (10,20)(110,20)(110,120)(10,120) → 中心 (60,70)，宽高 100x100
    expect(r).toMatchObject({ x: 60, y: 70, width: 100, height: 100, nodeId: 7 })
    expect(ws.sent.map((s) => JSON.parse(s).method)).toEqual([
      'DOM.enable', 'DOM.getDocument', 'DOM.querySelector', 'DOM.getBoxModel',
    ])
    ws.closed = true
  })

  it('dispatch: move/down/up → Input.dispatchMouseEvent，clickCount 按 kind 区分', async () => {
    const ws = makeFakeWs(boundsCanned())
    const driver = createCamofoxInput({ endpoint: ENDPOINT, wsFactory: () => ws })
    await expect(driver.dispatch('move', 5, 6)).resolves.toBe(true)
    let m = JSON.parse(ws.sent[0])
    expect(m.method).toBe('Input.dispatchMouseEvent')
    expect(m.params).toMatchObject({ type: 'mouseMoved', x: 5, y: 6, clickCount: 0 })
    await expect(driver.dispatch('down', 5, 6)).resolves.toBe(true)
    m = JSON.parse(ws.sent[1])
    expect(m.params).toMatchObject({ type: 'mousePressed', clickCount: 1 })
    ws.closed = true
  })

  it('非法 kind → 直接 false，不发任何 CDP 命令', async () => {
    const ws = makeFakeWs()
    const driver = createCamofoxInput({ endpoint: ENDPOINT, wsFactory: () => ws })
    await expect(driver.dispatch('hover', 1, 2)).resolves.toBe(false)
    expect(ws.sent).toEqual([])
    ws.closed = true
  })

  it('typeText：Input.insertText 逐字符', async () => {
    const ws = makeFakeWs(boundsCanned())
    const driver = createCamofoxInput({ endpoint: ENDPOINT, wsFactory: () => ws })
    await expect(driver.typeText('ab')).resolves.toBe(true)
    expect(ws.sent.map((s) => JSON.parse(s).params)).toEqual([{ text: 'a' }, { text: 'b' }])
    ws.closed = true
  })

  it('dispatchSynthetic 走 Runtime.evaluate 且 returnByValue=true（camoufox 无 executeJavaScript）', async () => {
    const ws = makeFakeWs(boundsCanned())
    const driver = createCamofoxInput({ endpoint: ENDPOINT, wsFactory: () => ws })
    await expect(driver.dispatchSynthetic([{ kind: 'pointerdown', clientX: 1, clientY: 2, bubbles: true }])).resolves.toBe(true)
    const m = JSON.parse(ws.sent[0])
    expect(m.method).toBe('Runtime.evaluate')
    expect(m.params.returnByValue).toBe(true)
    expect(m.params.expression).toContain('dispatchEvent')
    ws.closed = true
  })

  it('CDP error 响应 → reject → dispatch 降级为 false（不吞成 undefined）', async () => {
    const ws = makeFakeWs({ 'Input.dispatchMouseEvent': new Error('boom') })
    const driver = createCamofoxInput({ endpoint: ENDPOINT, wsFactory: () => ws })
    await expect(driver.dispatch('down', 1, 2)).resolves.toBe(false)
    ws.closed = true
  })
})

describe('camofox 驱动 — B 组：F3 监听安全（PRD §3.4）', () => {
  it('非 127.0.0.1 端点构造时即抛（fail-closed，不等到建连）', () => {
    expect(() => createCamofoxInput({ endpoint: 'ws://0.0.0.0:9222/x?token=' + 'f'.repeat(64), wsFactory: () => makeFakeWs() }))
      .toThrow(/只允许绑 127\.0\.0\.1/)
    expect(() => createCamofoxInput({ endpoint: 'ws://192.168.1.5:9222/x', wsFactory: () => makeFakeWs() }))
      .toThrow(/只允许绑 127\.0\.0\.1/)
    expect(() => createCamofoxInput({ endpoint: 'ws://localhost:9222/x', wsFactory: () => makeFakeWs() }))
      .toThrow(/只允许绑 127\.0\.0\.1/)
  })

  it('非 ws/wss 协议拒绝', () => {
    expect(() => createCamofoxInput({ endpoint: 'http://127.0.0.1:9222/x', wsFactory: () => makeFakeWs() }))
      .toThrow(/必须是 ws:\/\/ 或 wss:\/\//)
  })

  it('token 只出现在建连 URL；建连后的 CDP 消息一律不带它', async () => {
    const token = 'a'.repeat(64)
    const ws = makeFakeWs(boundsCanned())
    const seenEndpoints = []
    const driver = createBareDriver({ endpoint: 'ws://127.0.0.1:9222/x?token=' + token, wsFactory: (ep) => { seenEndpoints.push(ep); return ws } })
    await driver.dispatch('down', 1, 2)
    // 建连 URL 带 token（一次性）
    expect(seenEndpoints[0]).toContain(token)
    // 但发出去的 CDP 消息一条都不带
    expect(ws.sent.join('|')).not.toContain(token)
    ws.closed = true
  })

  it('close() 幂等；关闭后再调用返回 null/false 且不发命令', async () => {
    const ws = makeFakeWs(boundsCanned())
    let closeCalls = 0
    const origClose = ws.close.bind(ws)
    ws.close = function () { closeCalls++; origClose() }
    const driver = createCamofoxInput({ endpoint: ENDPOINT, wsFactory: () => ws })
    // 先真正建一次连，否则 ws 尚未赋值、close() 无从关闭它
    await expect(driver.dispatch('down', 1, 2)).resolves.toBe(true)
    await driver.close()
    await driver.close() // 第二次不得抛
    await driver.close() // 第三次同样
    expect(ws.closed).toBe(true)
    // 幂等的可判据：底层 ws.close 只被调用一次（否则重复 close 会打扰对端/重复触发 onclose）
    expect(closeCalls).toBe(1)
    const before = ws.sent.length
    await expect(driver.dispatch('down', 1, 2)).resolves.toBe(false)
    await expect(driver.typeText('a')).resolves.toBe(false)
    await expect(driver.getBounds('#x')).resolves.toBeNull()
    expect(ws.sent.length).toBe(before)
  })

  it('pendingCount 反映在途请求数；请求归位后归零（M8 反向锁）', async () => {
    // 用一个「 hang 住不回应」的 ws，让在途请求可被观测
    const sent = []
    const ws = {
      readyState: 1,
      closed: false,
      sent,
      send (s) { sent.push(s) },
      close () { this.closed = true },
      onmessage: null,
    }
    const driver = createCamofoxInput({ endpoint: ENDPOINT, wsFactory: () => ws })
    // 触发一次但不等它完成（无罐头 ⇒ 无人应答 ⇒ 永远在途）
    const p = driver.getBounds('#x')
    await Promise.resolve()
    await Promise.resolve()
    expect(driver.pendingCount()).toBe(1)
    // 手动把第一条请求应答掉 → 归零
    const req = JSON.parse(sent[0])
    ws.onmessage(JSON.stringify({ id: req.id, error: { code: -1, message: 'stop' } }))
    await p
    expect(driver.pendingCount()).toBe(0)
  })
})

/** 小工具：直接构造（B 组用例用，避开 A 组里共享的 ENDPOINT 常量） */
function createBareDriver (deps) {
  return createCamofoxInput(deps)
}

describe('assertLoopbackEndpoint — 单元', () => {
  it('接受 127.0.0.1 并解析端口', () => {
    expect(assertLoopbackEndpoint('ws://127.0.0.1:1234/x')).toEqual({ host: '127.0.0.1', port: 1234 })
  })
  it('拒绝 0.0.0.0 / 内网 IP / localhost / ::1', () => {
    for (const bad of ['ws://0.0.0.0:1/x', 'ws://10.0.0.1:1/x', 'ws://localhost:1/x', 'ws://[::1]:1/x']) {
      expect(() => assertLoopbackEndpoint(bad), bad).toThrow()
    }
  })
  it('拒绝非 ws 协议', () => {
    expect(() => assertLoopbackEndpoint('tcp://127.0.0.1:1')).toThrow()
  })
})

describe('createCdpClient — JSON-RPC 归位', () => {
  it('响应按 id 归位；error 响应 reject', async () => {
    const ws = makeFakeWs()
    const c = createCdpClient(ws, console)
    const p = c.sendCommand('Page.enable')
    await Promise.resolve()
    const req = JSON.parse(ws.sent[0])
    expect(req.id).toBe(1)
    ws.onmessage(JSON.stringify({ id: req.id, result: { ok: 1 } }))
    await expect(p).resolves.toEqual({ ok: 1 })

    const p2 = c.sendCommand('Page.navigate')
    await Promise.resolve()
    const req2 = JSON.parse(ws.sent[1])
    expect(req2.id).toBe(2)
    ws.onmessage(JSON.stringify({ id: req2.id, error: { code: -1, message: 'nope' } }))
    await expect(p2).rejects.toThrow(/nope/)
    expect(c.pendingCount()).toBe(0)
  })

  it('非 JSON / 无 id 的消息被忽略，不影响在途请求', async () => {
    const ws = makeFakeWs()
    const c = createCdpClient(ws, console)
    const p = c.sendCommand('A.b')
    await Promise.resolve()
    ws.onmessage('not json')
    ws.onmessage(JSON.stringify({ method: 'Some.event' }))
    const req = JSON.parse(ws.sent[0])
    ws.onmessage(JSON.stringify({ id: req.id, result: {} }))
    await expect(p).resolves.toEqual({})
  })
})
