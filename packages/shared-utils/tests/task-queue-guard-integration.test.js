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

  test('【已提交】失败/超时仍占用间隔窗口（记账必须在提交之前）', async () => {
    // 平台侧限流窗口按「请求已发生」计时，不按「应用是否解析到成功」计时。
    // 若只在 task:success 记账，则内容已发到平台但应用判超时/报错的三类形态都不占窗口，
    // 下一次提交不受限、重试还会重复发布。
    // v2：本用例模拟**已提交后**的失败（传输层已打点），故窗口必须保持占用。
    const guard = new PublishIntervalGuard({ minInterval: MIN_INTERVAL })
    const queue = new TaskQueue({ defaultRetry: 0, publishIntervalGuard: guard })

    let attempts = 0
    queue.setExecutor(async (task) => {
      attempts += 1
      queue.markSubmitted(task.id) // 模拟：请求已送达平台
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

  test('【未提交】失败回滚窗口：可立即重发，且发 publish:released', async () => {
    // P0-1 的核心收益：登录失效 / 预检不过 / 风控挂起 / 缺文件这类**从未发出平台请求**
    // 的失败不应吃掉整个间隔窗口。
    const guard = new PublishIntervalGuard({ minInterval: MIN_INTERVAL, jitterRatio: 0 })
    const queue = new TaskQueue({ defaultRetry: 0, publishIntervalGuard: guard })

    const released = []
    queue.on('publish:released', (p) => released.push(p))

    let attempts = 0
    queue.setExecutor(async () => {
      attempts += 1
      if (attempts === 1) {
        const err = new Error('登录态失效')
        err.notSubmitted = true
        throw err
      }
      return { success: true }
    })

    queue.add({ platform: 'douyin', article: { title: 'T', accountId: 'acc_1' } })
    await new Promise(r => setTimeout(r, 50))

    expect(attempts).toBe(1)
    // 未提交 ⇒ 窗口已回滚 ⇒ 同账号立即可发布
    expect(guard.canPublish('douyin', 'acc_1')).toBe(true)
    expect(released).toHaveLength(1)
    expect(released[0].reason).toBe('not_submitted')
    expect(released[0].graceMs).toBeGreaterThanOrEqual(10000)

    // 立即再发不再被守卫拦
    queue.add({ platform: 'douyin', article: { title: 'T2', accountId: 'acc_1' } })
    await new Promise(r => setTimeout(r, 50))
    expect(attempts).toBe(2)
    queue.shutdown()
  })

  test('【矛盾】notSubmitted=true 但已发起提交尝试 ⇒ 占窗口（fail-closed）', async () => {
    const guard = new PublishIntervalGuard({ minInterval: MIN_INTERVAL, jitterRatio: 0 })
    const queue = new TaskQueue({ defaultRetry: 0, publishIntervalGuard: guard })

    const released = []
    queue.on('publish:released', (p) => released.push(p))
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    queue.setExecutor(async (task) => {
      queue.markSubmitAttempted(task.id) // 已尝试发出请求
      const err = new Error('响应超时')
      err.notSubmitted = true // 但错误却自称未提交
      throw err
    })

    queue.add({ platform: 'douyin', article: { title: 'T', accountId: 'acc_1' } })
    await new Promise(r => setTimeout(r, 60))

    expect(released).toHaveLength(0)
    expect(guard.canPublish('douyin', 'acc_1')).toBe(false)
    expect(errSpy).toHaveBeenCalled()
    errSpy.mockRestore()
    queue.shutdown()
  })

  test('【紧急放行】跳过等待窗口立即入队；三类结果如实回报；无限窗口时不得谎报成功', async () => {
    const MIN = 10 * 60 * 1000
    const guard = new PublishIntervalGuard({ minInterval: MIN, jitterRatio: 0, now: () => Date.now() })
    const queue = new TaskQueue({ defaultRetry: 0, publishIntervalGuard: guard })

    const executed = []
    queue.setExecutor(async (task) => {
      executed.push(task.article.title)
      return { success: true }
    })

    // 无名额时：没有等待中的窗口 ⇒ 必须如实回报，不得假装成功
    expect(queue.emergencyRelease('douyin', 'acc_e')).toEqual({ ok: false, code: 'no_waiting_window' })

    // 第一条正常发布，占住窗口
    queue.add({ platform: 'douyin', article: { title: 'A', accountId: 'acc_e' } })
    await new Promise(r => setTimeout(r, 60))
    expect(executed).toEqual(['A'])

    // 第二条被间隔挡住，进入等待
    const blocked = []
    queue.on('publish:blocked', (p) => blocked.push(p))
    queue.add({ platform: 'douyin', article: { title: 'B', accountId: 'acc_e' } })
    await new Promise(r => setTimeout(r, 80))
    expect(blocked).toHaveLength(1)
    expect(executed).toEqual(['A'])

    // 紧急放行
    const released = []
    queue.on('publish:emergencyReleased', (d) => released.push(d))
    const r = queue.emergencyRelease('douyin', 'acc_e', { operator: 'tester', reason: '客户催稿' })
    expect(r.ok).toBe(true)
    expect(typeof r.taskId).toBe('string')
    expect(r.clearedKeys.sort()).toEqual(['douyin:*', 'douyin:acc_e'])
    expect(released).toHaveLength(1)
    expect(released[0].operator).toBe('tester')
    expect(released[0].reason).toBe('客户催稿')

    await new Promise(r2 => setTimeout(r2, 80))
    expect(executed).toEqual(['A', 'B'])

    // 关键反证：紧急放行**不是**把门禁关掉 —— B 发布后重新占窗，C 必须再次被拦
    const blockedAgain = []
    queue.on('publish:blocked', (p) => blockedAgain.push(p))
    queue.add({ platform: 'douyin', article: { title: 'C', accountId: 'acc_e' } })
    await new Promise(r3 => setTimeout(r3, 80))
    expect(executed).toEqual(['A', 'B'])
    expect(blockedAgain).toHaveLength(1)
    expect(blockedAgain[0].bucket).toBe('account')

    // 未注入守卫时如实回报
    const bare = new TaskQueue({ defaultRetry: 0 })
    expect(bare.emergencyRelease('douyin', 'acc_e')).toEqual({ ok: false, code: 'no_guard' })
    bare.shutdown()
    queue.shutdown()
  })

  test('【已提交】失败重试必须等满间隔窗口（等待不消耗 retriesLeft）', async () => {
    const MIN = 200
    const guard = new PublishIntervalGuard({ minInterval: MIN, jitterRatio: 0 })
    const queue = new TaskQueue({ defaultRetry: 1, publishIntervalGuard: guard })

    const starts = []
    queue.setExecutor(async (task) => {
      starts.push({ at: Date.now(), retriesLeft: task.retriesLeft })
      queue.markSubmitted(task.id)
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

  test('【探针 I4】成功但传输层未打点 ⇒ 计入接线缺陷并对该平台停用回滚', async () => {
    const guard = new PublishIntervalGuard({ minInterval: MIN_INTERVAL, jitterRatio: 0 })
    const queue = new TaskQueue({ defaultRetry: 0, publishIntervalGuard: guard })
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    queue.setExecutor(async () => ({ success: true })) // 未调用 markSubmitted
    queue.add({ platform: 'douyin', article: { title: 'T', accountId: 'acc_1' } })
    await new Promise(r => setTimeout(r, 60))

    const counts = queue.getProbeCounts()
    expect(counts.successWithoutSubmittedAt).toBe(1)
    expect(counts.rollbackDisabledPlatforms).toContain('douyin')

    // 停用后：即使「未发起尝试」的失败也不再回滚
    queue.setExecutor(async () => {
      const err = new Error('登录态失效')
      err.notSubmitted = true
      throw err
    })
    guard.recordPublish('douyin', 'acc_2', Date.now() - MIN_INTERVAL - 1000)
    queue.add({ platform: 'douyin', article: { title: 'T2', accountId: 'acc_2' } })
    await new Promise(r => setTimeout(r, 60))
    expect(guard.canPublish('douyin', 'acc_2')).toBe(false)

    // 唯一真实出路是**重启进程**：`_rollbackDisabledPlatforms` 是实例态，新实例不继承。
    // change: publish-frequency-unwired-surfaces 据此删掉了 `clearRollbackDisabled()` ——
    // 它的注释与告警文案都承诺「用户在设置页确认后解除」，而设置页**根本没有这个入口**
    // （全仓零调用点，唯一"消费者"是本测试自己）。留着一个能悄悄重新允许回滚的方法，
    // 比留着一句假话更危险：接线未被证实的平台重新获得"未提交即回滚"的权力。
    expect(typeof queue.clearRollbackDisabled).toBe('undefined')
    const restarted = new TaskQueue({ defaultRetry: 0, publishIntervalGuard: guard })
    expect(restarted.getProbeCounts().rollbackDisabledPlatforms).toEqual([])
    // 同一实例内不得被解除（方向恒为"多等"）
    expect(queue.getProbeCounts().rollbackDisabledPlatforms).toContain('douyin')

    const logged = errSpy.mock.calls.map((c) => String(c[0])).join('\n')
    expect(logged).toContain('重启')
    // 文案不得再承诺一个不存在的出口（这条锁防的是"把假承诺改回来也没人发现"）
    expect(logged).not.toMatch(/设置页确认后解除/)
    errSpy.mockRestore()
    restarted.shutdown()
    queue.shutdown()
  })

  test('【日配额】用尽后 bucket=daily、被 _quotaBlocked 跳过（不产生紧循环）', async () => {
    const guard = new PublishIntervalGuard({
      minInterval: 0,
      jitterRatio: 0,
      policy: () => ({ accountMinMs: 0, platformMinMs: 0, accountDailyMax: 1 }),
      dailyStore: new (require('../src/publish-interval-guard').InMemoryDailyStore)(),
    })
    const queue = new TaskQueue({ defaultRetry: 0, publishIntervalGuard: guard })

    let executed = 0
    queue.setExecutor(async () => { executed += 1; return { success: true } })

    const blocked = []
    queue.on('publish:blocked', (p) => blocked.push(p))

    // 第一条：配额 1，直接占满
    queue.add({ platform: 'douyin', article: { title: 'T1', accountId: 'acc_q' } })
    await new Promise(r => setTimeout(r, 60))
    expect(executed).toBe(1)

    // 第二条：被日配额挡住
    queue.add({ platform: 'douyin', article: { title: 'T2', accountId: 'acc_q' } })
    await new Promise(r => setTimeout(r, 80))
    expect(executed).toBe(1)
    expect(blocked).toHaveLength(1)
    expect(blocked[0].bucket).toBe('daily')
    expect(blocked[0].reason).toBe('daily_quota')
    expect(blocked[0].daily).toEqual({ used: 1, max: 1, dayKey: guard.today() })

    // 紧循环探针：连续多轮 _processNext 不得反复重判同一条配额被拒任务
    const before = blocked.length
    for (let i = 0; i < 5; i++) queue._processNext()
    await new Promise(r => setTimeout(r, 20))
    expect(blocked.length).toBe(before)
    expect(executed).toBe(1)
    queue.shutdown()
  })

  test('【日配额】等待中的任务被重新放回队列时仍被 _quotaBlocked 跳过（真正的紧循环锁）', async () => {
    // 为什么需要这条：日配额等待中的任务**不在 _queue 里**（blocked 分支只把它放进 _delayed），
    // 所以上面那条「连续调 _processNext 不出新事件」的断言在**摘掉 _quotaBlocked 跳过之后依然全绿**
    // —— 变异反证 M13 实测为「不成立」，说明它是弱锁。真正会触发的路径是任务被重新放回队列
    // （手动 retry / 状态恢复 / serialize-restore），此时若不跳过，_executeTask 会再次判定日配额、
    // 再次发 publish:blocked 并重新武装定时器 —— 这就是紧循环。
    const guard = new PublishIntervalGuard({
      minInterval: 0,
      jitterRatio: 0,
      policy: () => ({ accountMinMs: 0, platformMinMs: 0, accountDailyMax: 1 }),
      dailyStore: new (require('../src/publish-interval-guard').InMemoryDailyStore)(),
    })
    const queue = new TaskQueue({ defaultRetry: 0, publishIntervalGuard: guard })
    let executed = 0
    queue.setExecutor(async () => { executed += 1; return { success: true } })
    const blocked = []
    queue.on('publish:blocked', (p) => blocked.push(p))

    queue.add({ platform: 'douyin', article: { title: 'Q1', accountId: 'acc_q2' } })
    await new Promise(r => setTimeout(r, 60))
    expect(executed).toBe(1)

    queue.add({ platform: 'douyin', article: { title: 'Q2', accountId: 'acc_q2' } })
    await new Promise(r => setTimeout(r, 80))
    expect(blocked).toHaveLength(1)
    expect(blocked[0].bucket).toBe('daily')

    // 模拟「任务被重新放回队列」（手动 retry / 恢复路径）
    const entry = [...queue._delayed.values()].find(e => e.task.article.title === 'Q2')
    expect(entry).toBeTruthy()
    queue._queue.unshift(entry.task)

    const before = blocked.length
    queue._processNext()
    await new Promise(r => setTimeout(r, 30))
    // 被 _quotaBlocked 跳过 ⇒ 不得产生新的 blocked 事件（紧循环的特征就是反复重判反复出声）
    expect(blocked.length).toBe(before)
    expect(executed).toBe(1)
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
