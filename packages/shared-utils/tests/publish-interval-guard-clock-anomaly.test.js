/**
 * Test: publish-interval-guard 时钟倒挂守卫（fix-account-interval-ghost-wait）
 *
 * 背景：_remaining() 原实现无条件信任 store 里的时间戳。本机时钟快进/回拨后，
 * publish_timeline 里会留下「未来时间戳」⇒ now − lastTime < 0 ⇒
 * remaining = minInterval + |倒挂差|，表现为远超正常间隔的幽灵等待
 * （现场：微信公众号账号 10+ 小时未发布仍被「（本账号间隔）」阻塞）。
 *
 * 判据（learnings pitfall:future-timestamp-in-interval-store-becomes-ghost-wait）：
 * 任何「时间差判定」的测试必须含 elapsed<0（未来时间戳）反向样本。
 */

const PublishIntervalGuard = require('../src/publish-interval-guard')

const MIN_INTERVAL = 5 * 60 * 1000
const T0 = 1_700_000_000_000
const FUTURE = T0 + 10 * 60 * 60 * 1000 // 未来 10 小时（现场量级）

/** 可注入 store + 时钟 + warn 的守卫工厂 */
function makeGuard ({ store, now = () => T0, warn, ...rest } = {}) {
  return new PublishIntervalGuard({
    minInterval: MIN_INTERVAL,
    jitterRatio: 0,
    store: store || (() => {
      const map = new Map()
      return {
        get: (k) => (map.has(k) ? map.get(k) : null),
        set: (k, v) => { map.set(k, v) },
      }
    })(),
    now,
    warn: warn || (() => {}),
    ...rest,
  })
}

describe('时钟倒挂守卫（future timestamp in interval store）', () => {
  test('C1 时间戳在未来 ⇒ remaining 钳位到 accountMinMs，不随倒挂时长放大', () => {
    const guard = makeGuard({ now: () => T0 })
    guard._store.set('wechat_mp:acc1', FUTURE) // 模拟时钟快进期间写入的记录
    const v = guard.check('wechat_mp', 'acc1')
    expect(v.allowed).toBe(false)
    expect(v.bucket).toBe('account')
    expect(v.remainingMs).toBe(MIN_INTERVAL) // 钳位 = 恰一个间隔（jitter=0）
  })

  test('C2 同场景必须出声告警，且同键只告警一次（去重防日志风暴）', () => {
    const warns = []
    const guard = makeGuard({ now: () => T0, warn: (m) => warns.push(m) })
    guard._store.set('wechat_mp:acc1', FUTURE)
    guard.check('wechat_mp', 'acc1')
    guard.check('wechat_mp', 'acc1') // 第二次不重复告警
    expect(warns.filter((m) => m.includes('未来') && m.includes('wechat_mp:acc1'))).toHaveLength(1)
  })

  test('C3 注入时钟越过未来时间戳后窗口自然过期（无粘滞）', () => {
    let now = T0
    const guard = makeGuard({ now: () => now })
    guard._store.set('wechat_mp:acc1', FUTURE)
    expect(guard.check('wechat_mp', 'acc1').allowed).toBe(false)
    now = FUTURE + MIN_INTERVAL + 1
    expect(guard.check('wechat_mp', 'acc1').allowed).toBe(true)
  })

  test('C4 check 返回结构附加 clockAnomaly=true；正常路径不带该标记', () => {
    const guard = makeGuard({ now: () => T0 })
    guard._store.set('wechat_mp:acc1', FUTURE)
    expect(guard.check('wechat_mp', 'acc1').clockAnomaly).toBe(true)
    // 正常过去时间戳
    guard._store.set('wechat_mp:acc1', T0 - 60_000)
    expect(guard.check('wechat_mp', 'acc1').clockAnomaly).toBe(false)
    // 从未发布
    const fresh = makeGuard()
    expect(fresh.check('wechat_mp', 'acc_new').clockAnomaly).toBe(false)
  })

  test('C5 jitter 对钳位值同样生效（上限 1.4×）', () => {
    const guard = makeGuard({ now: () => T0, jitterRatio: 0.4, random: () => 0 })
    guard._store.set('wechat_mp:acc1', FUTURE)
    expect(guard.check('wechat_mp', 'acc1').remainingMs).toBe(MIN_INTERVAL) // random=0 ⇒ 无增量
    const guardMax = makeGuard({ now: () => T0, jitterRatio: 0.4, random: () => 0.999 })
    guardMax._store.set('wechat_mp:acc1', FUTURE)
    const ms = guardMax.check('wechat_mp', 'acc1').remainingMs
    expect(ms).toBeGreaterThan(MIN_INTERVAL)
    expect(ms).toBeLessThanOrEqual(Math.round(MIN_INTERVAL * 1.4))
  })

  test('C6 正常历史时间戳（elapsed>0）不得进入钳位分支', () => {
    const warns = []
    const guard = makeGuard({ now: () => T0, warn: (m) => warns.push(m) })
    guard._store.set('wechat_mp:acc1', T0 - 60_000)
    const v = guard.check('wechat_mp', 'acc1')
    expect(v.allowed).toBe(false)
    expect(v.remainingMs).toBe(MIN_INTERVAL - 60_000)
    expect(guard.futureTimestampKeys).toHaveLength(0)
    expect(warns).toHaveLength(0)
  })

  test('C7 futureTimestampKeys getter 暴露命中键（诊断用）', () => {
    const guard = makeGuard({ now: () => T0 })
    guard._store.set('wechat_mp:acc1', FUTURE)
    guard.check('wechat_mp', 'acc1')
    expect(guard.futureTimestampKeys).toEqual(['wechat_mp:acc1'])
  })

  test('C8 recordPublish 以注入时钟（可能异常的）now 落盘不抛错——写入侧闸由 store 层负责', () => {
    const guard = makeGuard({ now: () => FUTURE }) // 模拟时钟已快进的进程
    const hold = guard.recordPublish('wechat_mp', 'acc1')
    expect(hold.at).toBe(FUTURE)
  })
})
