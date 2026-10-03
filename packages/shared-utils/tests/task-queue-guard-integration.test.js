/**
 * Integration test: task-queue + publish-interval-guard
 * 测试: 任务队列集成发布频率控制
 */
const TaskQueue = require('../src/task-queue')
const PublishIntervalGuard = require('../src/publish-interval-guard')

const MIN_INTERVAL = 5 * 60 * 1000

describe('TaskQueue + PublishIntervalGuard 集成', () => {
  test('无 guard 时行为不变（向后兼容）', async () => {
    const queue = new TaskQueue({ defaultRetry: 0 })
    queue.setExecutor(async () => ({ success: true }))
    const taskId = queue.add({ platform: 'wechat_mp', article: { title: 'T' } })
    expect(taskId).toMatch(/^task_\d+_\d+$/)
    await new Promise(r => setTimeout(r, 100))
    const history = queue.getHistory()
    expect(history.length).toBe(1)
    expect(history[0].status).toBe('success')
  })

  test('传入 guard 后成功记录发布时间', async () => {
    const guard = new PublishIntervalGuard({ minInterval: MIN_INTERVAL })
    const queue = new TaskQueue({ defaultRetry: 0, publishIntervalGuard: guard })

    const events = []
    queue.on('task:success', (t) => events.push('success:' + t.platform))

    queue.setExecutor(async () => ({ success: true }))
    queue.add({ platform: 'wechat_mp', article: { title: 'T', accountId: 'acc_001' } })

    await new Promise(r => setTimeout(r, 100))

    // 发布后，guard 应记录发布时间
    expect(guard.canPublish('wechat_mp', 'acc_001')).toBe(false)
    expect(events).toContain('success:wechat_mp')
  })

  test('同一账号连续发布被拦截并触发 publish:blocked 事件', async () => {
    const guard = new PublishIntervalGuard({ minInterval: 50000 }) // 50 秒间隔
    const queue = new TaskQueue({ defaultRetry: 0, publishIntervalGuard: guard })

    const blockedEvents = []
    queue.on('publish:blocked', (data) => {
      blockedEvents.push(data)
    })

    queue.setExecutor(async () => ({ success: true }))

    // 第一次发布 — 模拟 1 分钟前已发布
    guard.recordPublish('wechat_mp', 'acc_001', Date.now() - 30000)

    // 尝试第二次发布（同一账号）
    queue.add({ platform: 'wechat_mp', article: { title: 'T2', accountId: 'acc_001' } })

    await new Promise(r => setTimeout(r, 200))

    // 应触发 publish:blocked 事件
    expect(blockedEvents.length).toBeGreaterThanOrEqual(1)
    expect(blockedEvents[0].task.platform).toBe('wechat_mp')
    expect(blockedEvents[0].remainingWait).toBeGreaterThan(0)
  })

  test('频控等待中的任务仍可取消，等待结束后不会重新发布', async () => {
    const guard = new PublishIntervalGuard({ minInterval: 1000 })
    const queue = new TaskQueue({ defaultRetry: 0, publishIntervalGuard: guard })
    let executeCount = 0
    queue.setExecutor(async () => { executeCount++; return { success: true } })
    guard.recordPublish('wechat_mp', 'acc_001', Date.now())

    const taskId = queue.add({ platform: 'wechat_mp', article: { title: 'T', accountId: 'acc_001' } })

    expect(queue.cancel(taskId)).toBe(true)
    expect(queue.getHistory().find(task => task.id === taskId)?.status).toBe('cancelled')
    await new Promise(r => setTimeout(r, 1100))
    expect(executeCount).toBe(0)
    queue.shutdown()
  })

  test('同平台换号被平台档拦截，换平台不拦截', async () => {
    // 2026-10-02 D2 决策：同平台任意两次发布（跨账号）也要错开。
    // 旧用例把「不同账号在同一平台不被拦截」当成产品规则钉住，那是单档模型的副作用。
    const guard = new PublishIntervalGuard({ minInterval: 5000 })
    const queue = new TaskQueue({ defaultRetry: 0, publishIntervalGuard: guard })
    const executed = []
    queue.setExecutor(async (task) => {
      executed.push(`${task.platform}:${task.article.accountId}`)
      return { success: true }
    })
    guard.recordPublish('wechat_mp', 'acc_001', Date.now())

    queue.add({ platform: 'wechat_mp', article: { title: 'T2', accountId: 'acc_002' } })
    queue.add({ platform: 'zhihu', article: { title: 'T3', accountId: 'acc_002' } })

    await new Promise(r => setTimeout(r, 200))

    expect(executed).toEqual(['zhihu:acc_002'])
    queue.shutdown()
  })

  test('无 accountId 的任务仍受平台档约束（缺席不等于放行）', async () => {
    // 旧用例把「无 accountId 不被拦截」标为"向后兼容"，实为绕过口：
    // publish:wechat 固定传 accountId:null、publish:batch 字符串目标归一化为 null，
    // 于是这两条主路径完全不受频率控制。
    const guard = new PublishIntervalGuard({ minInterval: MIN_INTERVAL })
    const queue = new TaskQueue({ defaultRetry: 0, publishIntervalGuard: guard })

    const executed = []
    const blockedEvents = []
    queue.on('publish:blocked', (p) => blockedEvents.push(p))

    queue.setExecutor(async (t) => { executed.push(t.platform); return { success: true } })

    // 无任何历史 → 缺席账号的任务照常执行（不得过度拦截）
    queue.add({ platform: 'weibo', article: { title: 'T0' } })
    await new Promise(r => setTimeout(r, 100))
    expect(executed).toEqual(['weibo'])
    expect(blockedEvents).toEqual([])

    // 同平台刚发布过 → 平台档窗口未满，缺席账号必须被挡并报告 bucket=platform
    guard.recordPublish('wechat_mp', 'acc_001', Date.now())
    queue.add({ platform: 'wechat_mp', article: { title: 'T' } })

    await new Promise(r => setTimeout(r, 100))

    expect(executed).toEqual(['weibo'])
    expect(blockedEvents).toHaveLength(1)
    expect(blockedEvents[0].bucket).toBe('platform')
    expect(blockedEvents[0].remainingWait).toBeGreaterThan(0)
    queue.shutdown()
  })

  test('任务失败/超时仍占用间隔窗口（记账必须在提交之前）', async () => {
    // 平台侧限流窗口按「请求已发生」计时，不按「应用是否解析到成功」计时。
    // 若只在 task:success 记账，则内容已发到平台但应用判超时/报错的三类形态都不占窗口，
    // 下一次提交不受限、重试还会重复发布。
    const guard = new PublishIntervalGuard({ minInterval: MIN_INTERVAL })
    const queue = new TaskQueue({ defaultRetry: 0, publishIntervalGuard: guard })

    let attempts = 0
    queue.setExecutor(async () => {
      attempts += 1
      throw new Error('视频上传超时')
    })

    queue.add({ platform: 'douyin', article: { title: 'T', accountId: 'acc_1' } })
    await new Promise(r => setTimeout(r, 100))

    expect(attempts).toBe(1)
    // 失败之后，同账号必须已经处在间隔窗口内
    expect(guard.canPublish('douyin', 'acc_1')).toBe(false)
    expect(guard.check('douyin', 'acc_1').bucket).toBe('account')

    const later = []
    queue.on('publish:blocked', (p) => later.push(p))
    queue.add({ platform: 'douyin', article: { title: 'T2', accountId: 'acc_1' } })
    await new Promise(r => setTimeout(r, 100))
    expect(attempts).toBe(1)
    expect(later).toHaveLength(1)
    expect(later[0].bucket).toBe('account')
    queue.shutdown()
  })

  test('失败重试必须等满间隔窗口（等待不消耗 retriesLeft）', async () => {
    const MIN = 200
    const guard = new PublishIntervalGuard({ minInterval: MIN })
    const queue = new TaskQueue({ defaultRetry: 1, publishIntervalGuard: guard })

    const starts = []
    queue.setExecutor(async (task) => {
      starts.push({ at: Date.now(), retriesLeft: task.retriesLeft })
      throw new Error('boom')
    })

    queue.add({ platform: 'kuaishou', article: { title: 'T', accountId: 'acc_9' } })
    await new Promise(r => setTimeout(r, 900))

    // 重试确实发生了，但不是在第一次之后立即发生
    expect(starts.length).toBe(2)
    expect(starts[1].at - starts[0].at).toBeGreaterThanOrEqual(MIN - 50)
    const failed = queue.getHistory().find(t => t.article && t.article.accountId === 'acc_9')
    expect(failed.status).toBe('failed')
    queue.shutdown()
  })

  test('带 guard 的任务失败不阻止后续任务', async () => {
    const guard = new PublishIntervalGuard({ minInterval: MIN_INTERVAL })
    const queue = new TaskQueue({ defaultRetry: 0, publishIntervalGuard: guard })

    const results = []
    queue.on('task:failed', (t) => results.push('failed:' + t.platform))
    queue.on('task:success', (t) => results.push('success:' + t.platform))

    queue.setExecutor(async (task) => {
      if (task.platform === 'fail_me') throw new Error('intentional fail')
      return { success: true }
    })

    queue.add({ platform: 'fail_me', article: { title: 'T', accountId: 'acc_001' } })
    queue.add({ platform: 'wechat_mp', article: { title: 'T2', accountId: 'acc_001' } })

    await new Promise(r => setTimeout(r, 300))

    expect(results).toContain('failed:fail_me')
    expect(results).toContain('success:wechat_mp')
  })

  test('accountId 只在任务级（article 不带）时账号档仍生效——守卫必须读归一后的 task.accountId', async () => {
    // 现场构造「平台档窗口已过、账号档仍在窗口内」：只有真正读到 task.accountId 才会被拦。
    // 取错源（只读 task.article.accountId）时账号档被整条跳过 ⇒ 任务立即发出且无 blocked 事件。
    const data = new Map()
    const store = {
      get: (k) => (data.has(k) ? data.get(k) : null),
      set: (k, v) => { data.set(k, v) },
    }
    const guard = new PublishIntervalGuard({
      policy: () => ({ accountMinMs: 60000, platformMinMs: 60000 }),
      store,
    })
    guard.recordPublish('douyin', 'acc_top')
    data.delete(guard._key('douyin', PublishIntervalGuard.PLATFORM_BUCKET_ACCOUNT_ID))

    const queue = new TaskQueue({ defaultRetry: 0, publishIntervalGuard: guard })
    const blockedEvents = []
    queue.on('publish:blocked', (d) => blockedEvents.push(d))
    const executed = []
    queue.setExecutor(async (task) => { executed.push(task.id); return { success: true } })

    queue.add({ platform: 'douyin', accountId: 'acc_top', article: { title: '仅在任务级带账号' } })
    await new Promise(r => setTimeout(r, 200))

    expect(executed).toHaveLength(0)
    expect(blockedEvents).toHaveLength(1)
    expect(blockedEvents[0].bucket).toBe('account')
    expect(blockedEvents[0].remainingWait).toBeGreaterThan(30000)
    queue.shutdown()
  })
})
