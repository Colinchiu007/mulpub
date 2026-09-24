// @vitest-environment node
const { createDesktopRiskSuspender, RiskSuspendedError, isRiskSuspendedMessage, SETTING_KEY } = require('./risk-suspender-store')

/** 简易内存 store 桩，模拟 getSetting/setSetting */
function makeStore (initial = {}) {
  const data = { ...initial }
  return {
    data,
    getSetting (key) { return data[key] },
    setSetting (key, value) { data[key] = value },
  }
}

describe('risk-suspender-store.createDesktopRiskSuspender', () => {
  it('suspend 后 isSuspended 命中，resume 后解除', () => {
    const s = createDesktopRiskSuspender({ store: makeStore() })
    expect(s.isSuspended('weixin', 'acc1')).toBe(false)
    s.suspend('weixin', 'acc1', { reason: 'risk_blocked' })
    expect(s.isSuspended('weixin', 'acc1')).toBe(true)
    expect(s.resume('weixin', 'acc1')).toBe(true)
    expect(s.isSuspended('weixin', 'acc1')).toBe(false)
    expect(s.resume('weixin', 'acc1')).toBe(false)
  })

  it('accountId 缺失的挂起降级为平台级，覆盖该平台所有账号', () => {
    const s = createDesktopRiskSuspender({ store: makeStore() })
    s.suspend('bilibili', null, { reason: 'risk_blocked' })
    expect(s.isSuspended('bilibili', 'accX')).toBe(true)
    expect(s.isSuspended('bilibili')).toBe(true)
    expect(s.isSuspended('baijiahao', 'accX')).toBe(false)
  })

  it('细粒度挂起不误伤同平台其他账号', () => {
    const s = createDesktopRiskSuspender({ store: makeStore() })
    s.suspend('bilibili', 'acc1', { reason: 'risk_blocked' })
    expect(s.isSuspended('bilibili', 'acc2')).toBe(false)
  })

  it('持久化：挂起记录写入 store，新实例可水合恢复', () => {
    const store = makeStore()
    const s1 = createDesktopRiskSuspender({ store })
    s1.suspend('weixin', 'acc1', { reason: 'risk_blocked' })
    s1.suspend('bilibili', null, { reason: 'risk_blocked' })
    expect(Array.isArray(store.data[SETTING_KEY])).toBe(true)
    expect(store.data[SETTING_KEY].length).toBe(2)

    const s2 = createDesktopRiskSuspender({ store })
    expect(s2.isSuspended('weixin', 'acc1')).toBe(true)
    expect(s2.isSuspended('bilibili', 'any')).toBe(true)
    expect(s2.listSuspended().length).toBe(2)
  })

  it('resume 后持久化同步更新；clear 清空并落盘', () => {
    const store = makeStore()
    const s = createDesktopRiskSuspender({ store })
    s.suspend('weixin', 'acc1', { reason: 'risk_blocked' })
    s.resume('weixin', 'acc1')
    expect(store.data[SETTING_KEY].length).toBe(0)
    s.suspend('bilibili', 'acc2', { reason: 'risk_blocked' })
    expect(s.clear()).toBeGreaterThanOrEqual(1)
    expect(s.size()).toBe(0)
    expect(store.data[SETTING_KEY].length).toBe(0)
  })

  it('懒水合幂等：多次调用只从 store 恢复一次', () => {
    const store = makeStore({ [SETTING_KEY]: [{ platform: 'weixin', accountId: 'acc1', reason: 'risk_blocked' }] })
    let reads = 0
    const spy = { getSetting: (k) => { reads++; return store.getSetting(k) }, setSetting: (k, v) => store.setSetting(k, v) }
    const s = createDesktopRiskSuspender({ store: spy })
    s.isSuspended('weixin', 'acc1')
    s.isSuspended('weixin', 'acc1')
    s.listSuspended()
    expect(reads).toBe(1)
  })

  it('store 读取失败 fail-open：不抛错、不误挂起', () => {
    const bad = { getSetting () { throw new Error('db locked') }, setSetting () {} }
    const warns = []
    const s = createDesktopRiskSuspender({ store: bad, log: { warn: (...a) => warns.push(a) } })
    expect(s.isSuspended('weixin', 'acc1')).toBe(false)
    expect(warns.length).toBe(1)
  })

  it('store 写入失败仅告警不抛出，内存态仍可用', () => {
    const bad = { getSetting: () => undefined, setSetting () { throw new Error('disk full') } }
    const warns = []
    const s = createDesktopRiskSuspender({ store: bad, log: { warn: (...a) => warns.push(a) } })
    expect(() => s.suspend('weixin', 'acc1', { reason: 'risk_blocked' })).not.toThrow()
    expect(s.isSuspended('weixin', 'acc1')).toBe(true)
    expect(warns.length).toBe(1)
  })

  it('无 store 时纯内存可用（依赖可空）', () => {
    const s = createDesktopRiskSuspender()
    s.suspend('weixin', 'acc1', { reason: 'risk_blocked' })
    expect(s.isSuspended('weixin', 'acc1')).toBe(true)
  })

  it('脏持久化记录被跳过，合法记录照常恢复', () => {
    const store = makeStore({
      [SETTING_KEY]: [null, { platform: '' }, { platform: 42 }, { platform: 'weixin', accountId: 'ok', reason: 'risk_blocked' }],
    })
    const s = createDesktopRiskSuspender({ store })
    expect(s.listSuspended().length).toBe(1)
    expect(s.isSuspended('weixin', 'ok')).toBe(true)
  })

  it('suspend 幂等：重复挂起只更新不重复计数', () => {
    const s = createDesktopRiskSuspender({ store: makeStore() })
    s.suspend('weixin', 'acc1', { reason: 'risk_blocked' })
    s.suspend('weixin', 'acc1', { reason: 'risk_blocked' })
    expect(s.size()).toBe(1)
  })
})

describe('RiskSuspendedError', () => {
  it('携带 risk_suspended 标记且 noRetry=true', () => {
    const e = new RiskSuspendedError('weixin', 'acc1')
    expect(e).toBeInstanceOf(Error)
    expect(e.code).toBe('risk_suspended')
    expect(e.blocked).toBe(true)
    expect(e.noRetry).toBe(true)
    expect(e.message).toContain('risk_suspended')
    expect(e.message).toContain('weixin/acc1')
    expect(e.platform).toBe('weixin')
    expect(e.accountId).toBe('acc1')
  })

  it('accountId 缺省时消息只含平台', () => {
    const e = new RiskSuspendedError('bilibili')
    expect(e.accountId).toBe(null)
    expect(e.message).toBe('publish blocked: risk_suspended for bilibili')
  })
})

describe('isRiskSuspendedMessage', () => {
  it('识别 risk_suspended 标记消息', () => {
    expect(isRiskSuspendedMessage('publish blocked: risk_suspended for weixin/acc1')).toBe(true)
  })

  it('普通风控消息不误判', () => {
    expect(isRiskSuspendedMessage('触发风控，请稍后再试')).toBe(false)
    expect(isRiskSuspendedMessage('risk control detected')).toBe(false)
  })

  it('非字符串安全返回 false', () => {
    expect(isRiskSuspendedMessage(null)).toBe(false)
    expect(isRiskSuspendedMessage(undefined)).toBe(false)
    expect(isRiskSuspendedMessage(601)).toBe(false)
  })
})
