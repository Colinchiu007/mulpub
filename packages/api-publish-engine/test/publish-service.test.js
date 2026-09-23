'use strict'
/**
 * publish-service.test.js — W1 §5 服务入口装配（publish-service.createPublishService）
 * 用假 apiPublish / rpaPublish 零外发驱动整条服务链；校验四件套（getMode/spacer/decide/risk）联动。
 */
const { createPublishService } = require('../src/publish/publish-service')
const { createPublishSpacer } = require('../src/publish/core/publish-spacer')

function capLogger () {
  const logs = []
  return {
    logs,
    info: (m, msg, d) => logs.push({ lvl: 'info', msg, d }),
    warn: (m, msg, d) => logs.push({ lvl: 'warn', msg, d }),
    error: (m, msg, d) => logs.push({ lvl: 'error', msg, d }),
    debug: () => {},
  }
}
const CK = 'cookie-abcdef0123456789'

describe('publish-service (§5 装配)', function () {
  test('缺 apiPublish 抛错（fail-closed）', function () {
    expect(() => createPublishService({})).toThrow(/apiPublish/)
  })

  test('api-then-dom 成功 → 走 API，仅调一次 apiPublish', async function () {
    let calls = 0
    const svc = createPublishService({ apiPublish: async (p) => { calls++; return { success: true, publishId: 'P-' + p } }, getMode: () => 'api-then-dom' })
    const r = await svc.publishWithMode('bilibili', {}, CK, { accountId: 'a1' })
    expect(r.track).toBe('api')
    expect(r.success).toBe(true)
    expect(calls).toBe(1)
  })

  test('transient 失败 + 提供 rpaPublish → 降级 DOM', async function () {
    const apiPublish = async () => ({ success: false, error: '网络抖动 ECONNRESET' })
    const rpaPublish = async (p) => ({ success: true, publishId: 'DOM-' + p })
    const svc = createPublishService({ apiPublish, getMode: () => 'api-then-dom', rpaPublish: undefined })
    const r = await svc.publishWithMode('bilibili', {}, CK, { accountId: 'a1', rpaPublish })
    expect(r.track).toBe('dom')
    expect(r.degraded).toBe(true)
    expect(r.success).toBe(true)
  })

  test('transient 失败 + 无 rpaPublish → requiresDom（不误判成功）', async function () {
    const apiPublish = async () => ({ success: false, error: 'timeout' })
    const svc = createPublishService({ apiPublish, getMode: () => 'api-then-dom' })
    const r = await svc.publishWithMode('bilibili', {}, CK, { accountId: 'a1' })
    expect(r.requiresDom).toBe(true)
    expect(r.success).toBe(false)
    expect(r.degraded).toBe(true)
  })

  test('risk_blocked → 停报 + 挂起该账号；再次发布 short-circuit 零 apiPublish', async function () {
    let calls = 0
    const apiPublish = async () => { calls++; return { success: false, error: '触发风控 601', code: 'BILI_RISK_601' } }
    const svc = createPublishService({ apiPublish, getMode: () => 'api-then-dom' })
    const r1 = await svc.publishWithMode('bilibili', {}, CK, { accountId: 'a1' })
    expect(r1.stopped).toBe(true)
    expect(svc.risk.isSuspended('bilibili', 'a1')).toBe(true)
    const r2 = await svc.publishWithMode('bilibili', {}, CK, { accountId: 'a1' })
    expect(r2.track).toBe('suspended')
    expect(calls).toBe(1) // 第二次未再调 apiPublish
  })

  test('resume 后同账号可再发布', async function () {
    const apiPublish = async () => ({ success: true, publishId: 'ok' })
    const svc = createPublishService({ apiPublish, getMode: () => 'api-then-dom' })
    svc.risk.suspend('bilibili', 'a1')
    expect(svc.risk.isSuspended('bilibili', 'a1')).toBe(true)
    svc.risk.resume('bilibili', 'a1')
    const r = await svc.publishWithMode('bilibili', {}, CK, { accountId: 'a1' })
    expect(r.track).toBe('api')
    expect(r.success).toBe(true)
  })

  test('getMode 缺省（undefined）→ normalizeMode 默认 api-then-dom', async function () {
    const svc = createPublishService({ apiPublish: async () => ({ success: true }), spacer: { tryAcquire: () => ({ allow: true, waitMs: 0 }) } })
    const r = await svc.publishWithMode('bilibili', {}, CK, { accountId: 'a1' })
    expect(r.mode).toBe('api-then-dom')
  })

  test('spacer 服务级单例跨调用共享：同账号连发第二条被节流、零 apiPublish', async function () {
    let calls = 0
    let t = 0
    const spacer = createPublishSpacer({ clock: () => t })
    const svc = createPublishService({ apiPublish: async () => { calls++; return { success: true } }, getMode: () => 'api-then-dom', spacer })
    const r1 = await svc.publishWithMode('bilibili', {}, CK, { accountId: 'a1' })
    t = 60 * 1000 // +1 分钟（<18 分钟）
    const r2 = await svc.publishWithMode('bilibili', {}, CK, { accountId: 'a1' })
    expect(r1.track).toBe('api')
    expect(r2.track).toBe('throttled')
    expect(r2.success).toBe(false)
    expect(calls).toBe(1)
  })

  test('onRiskEvent 桥接：risk_blocked 挂起时收到 suspend 通知', async function () {
    const events = []
    const apiPublish = async () => ({ success: false, error: '风控 verify', code: 'BILI_RISK_601' })
    const svc = createPublishService({ apiPublish, getMode: () => 'api-then-dom', onRiskEvent: (e) => events.push(e) })
    await svc.publishWithMode('bilibili', {}, CK, { accountId: 'a1' })
    expect(events.length).toBe(1)
    expect(events[0].type).toBe('suspend')
    expect(events[0].platform).toBe('bilibili')
  })

  test('service 暴露 risk / spacer / getMode 句柄供 UI(§6) 接线', function () {
    const svc = createPublishService({ apiPublish: async () => ({ success: true }) })
    expect(typeof svc.risk.suspend).toBe('function')
    expect(typeof svc.risk.listSuspended).toBe('function')
    expect(typeof svc.spacer.tryAcquire).toBe('function')
    expect(typeof svc.getMode).toBe('function')
  })
})
