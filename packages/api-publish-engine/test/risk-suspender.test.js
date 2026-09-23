'use strict'
/**
 * risk-suspender.test.js — W1 §5.4 风控挂起器 + 与 §5.2 执行包装的联动
 * 纯内存/注入，零外发。
 */
const { createRiskSuspender } = require('../src/publish/core/risk-suspender')
const { createPublishWithMode } = require('../src/publish/core/publish-mode-runner')

function capLogger () {
  const logs = []
  return {
    logs,
    info: (m, msg, d) => logs.push({ lvl: 'info', msg, d }),
    warn: (m, msg, d) => logs.push({ lvl: 'warn', msg, d }),
    error: (m, msg, d) => logs.push({ lvl: 'error', msg, d }),
  }
}

describe('risk-suspender (§5.4)', function () {
  test('suspend 平台级：命中该平台、不影响其他平台', function () {
    const rs = createRiskSuspender({ clock: () => 555 })
    expect(rs.isSuspended('bilibili')).toBe(false)
    rs.suspend('bilibili', undefined, { reason: 'risk_blocked' })
    expect(rs.isSuspended('bilibili')).toBe(true)
    expect(rs.isSuspended('kuaishou')).toBe(false)
    expect(rs.size()).toBe(1)
  })

  test('平台级挂起覆盖该平台所有账号', function () {
    const rs = createRiskSuspender()
    rs.suspend('bilibili')
    expect(rs.isSuspended('bilibili', 'acc1')).toBe(true)
    expect(rs.isSuspended('bilibili', 'acc2')).toBe(true)
  })

  test('账号级挂起只命中对应账号', function () {
    const rs = createRiskSuspender()
    rs.suspend('bilibili', 'acc1')
    expect(rs.isSuspended('bilibili', 'acc1')).toBe(true)
    expect(rs.isSuspended('bilibili', 'acc2')).toBe(false)
    expect(rs.isSuspended('bilibili')).toBe(false) // 无账号查询不命中细粒度挂起
  })

  test('suspend 幂等：重复挂起只通知一次、更新记录', function () {
    const notes = []
    let t = 100
    const rs = createRiskSuspender({ notify: (e) => notes.push(e), clock: () => t })
    rs.suspend('bilibili', undefined, { reason: 'risk_blocked' })
    t = 200
    rs.suspend('bilibili', undefined, { reason: 'risk_blocked_again' })
    expect(notes.length).toBe(1)
    expect(notes[0].type).toBe('suspend')
    expect(notes[0].platform).toBe('bilibili')
    expect(rs.getSuspension('bilibili').at).toBe(200)
  })

  test('resume 命中发一次通知、未命中返回 false', function () {
    const notes = []
    const rs = createRiskSuspender({ notify: (e) => notes.push(e) })
    rs.suspend('bilibili')
    expect(rs.resume('bilibili')).toBe(true)
    expect(rs.isSuspended('bilibili')).toBe(false)
    expect(rs.resume('bilibili')).toBe(false)
    expect(notes.map((n) => n.type)).toEqual(['suspend', 'resume'])
  })

  test('clear 清空全部并逐条 resume 通知（reason=cleared）', function () {
    const notes = []
    const rs = createRiskSuspender({ notify: (e) => notes.push(e) })
    rs.suspend('bilibili'); rs.suspend('baijiahao')
    const n = rs.clear()
    expect(n).toBe(2)
    expect(rs.size()).toBe(0)
    expect(notes.filter((x) => x.type === 'resume').length).toBe(2)
    expect(notes.filter((x) => x.type === 'resume').every((x) => x.reason === 'cleared')).toBe(true)
  })

  test('suspend 缺 platform 抛错（fail-closed）', function () {
    const rs = createRiskSuspender()
    expect(() => rs.suspend(undefined)).toThrow(/requires platform/)
  })

  test('notify 抛错被吞、走 logger.error、不炸主流程', function () {
    const logger = capLogger()
    const rs = createRiskSuspender({
      notify: () => { throw new Error('boom') },
      logger,
    })
    expect(() => rs.suspend('bilibili')).not.toThrow()
    expect(logger.logs.some((l) => l.lvl === 'error' && /notify failed/.test(l.msg))).toBe(true)
  })

  test('多平台互不干扰', function () {
    const rs = createRiskSuspender()
    rs.suspend('bilibili')
    expect(rs.isSuspended('bilibili')).toBe(true)
    expect(rs.isSuspended('douyin')).toBe(false)
    expect(rs.isSuspended('baijiahao')).toBe(false)
    expect(rs.listSuspended().length).toBe(1)
  })
})

describe('publishWithMode × riskSuspender 联动 (§5.2+§5.4)', function () {
  test('API 返回 risk_blocked → 停报 + 挂起该平台', async function () {
    const rs = createRiskSuspender()
    const logger = capLogger()
    const apiPublish = async () => ({ success: false, error: '触发风控，请滑块验证', code: 'BILI_RISK_601' })
    const pub = createPublishWithMode({ apiPublish, getMode: () => 'api-then-dom', logger, riskSuspender: rs })
    const r = await pub('bilibili', {}, 'cookie-abcdef0123456789', { accountId: 'acc1' })
    expect(r.stopped).toBe(true)
    expect(r.reasonCode).toBe('risk_blocked_stop')
    // 风控挂起命中触发风控的账号；不同账号不被牵连（风控即停该号、不误伤他号）
    expect(rs.isSuspended('bilibili', 'acc1')).toBe(true)
    expect(rs.isSuspended('bilibili', 'acc2')).toBe(false)
  })

  test('已挂起平台再次发布 → 直接 short-circuit，零 API 调用', async function () {
    const rs = createRiskSuspender()
    rs.suspend('bilibili')
    let called = 0
    const apiPublish = async () => { called++; return { success: true } }
    const domPublish = async () => { called++; return { success: true } }
    const logger = capLogger()
    const pub = createPublishWithMode({ apiPublish, domPublish, getMode: () => 'api-then-dom', logger, riskSuspender: rs })
    const r = await pub('bilibili', {}, 'cookie-abcdef0123456789')
    expect(called).toBe(0)
    expect(r.track).toBe('suspended')
    expect(r.stopped).toBe(true)
    expect(r.reasonCode).toBe('risk_suspended')
  })

  test('挂起某平台不影响其他平台正常发布', async function () {
    const rs = createRiskSuspender()
    rs.suspend('bilibili')
    const apiPublish = async (p) => ({ success: true, publishId: 'PID-' + p })
    const logger = capLogger()
    const pub = createPublishWithMode({ apiPublish, getMode: () => 'api-then-dom', logger, riskSuspender: rs })
    const r = await pub('baijiahao', {}, 'cookie-xyz0123456789abcd')
    expect(r.success).toBe(true)
    expect(r.track).toBe('api')
  })

  test('login_expired 停报但不挂起（挂起仅针对风控）', async function () {
    const rs = createRiskSuspender()
    const apiPublish = async () => ({ success: false, error: 'cookie 已失效，请登录' })
    const logger = capLogger()
    const pub = createPublishWithMode({ apiPublish, getMode: () => 'api-then-dom', logger, riskSuspender: rs })
    const r = await pub('bilibili', {}, 'cookie-abcdef0123456789')
    expect(r.stopped).toBe(true)
    expect(r.reasonCode).toBe('login_expired_stop')
    expect(rs.isSuspended('bilibili')).toBe(false)
  })

  test('不传 riskSuspender 时行为不变（向后兼容）', async function () {
    const apiPublish = async () => ({ success: false, error: '触发风控 601' })
    const logger = capLogger()
    const pub = createPublishWithMode({ apiPublish, getMode: () => 'api-then-dom', logger })
    const r = await pub('bilibili', {}, 'cookie-abcdef0123456789')
    expect(r.stopped).toBe(true)
    expect(r.track).toBe('api')
  })
})
