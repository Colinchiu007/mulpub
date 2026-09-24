/**
 * Test: task-queue.js — 任务队列
 * 测试: 顺序执行、重试、超时、暂停/恢复、进度事件
 */

const TaskQueue = require('../src/task-queue')

// 用 50ms 微任务替代 setTimeout 以便测试
const originalSetTimeout = global.setTimeout
beforeEach(() => {
  global.setTimeout = (fn, ms) => originalSetTimeout(fn, ms || 0)
})
afterEach(() => {
  global.setTimeout = originalSetTimeout
})

describe('TaskQueue', () => {
  test('添加任务后返回 taskId', () => {
    const queue = new TaskQueue()
    const taskId = queue.add({ platform: 'wechat_mp', article: { title: 'Test' } })
    expect(taskId).toMatch(/^task_\d+_\d+$/)
  })

  test('租户和批次上下文会在入队、重试与持久化时保持不变', async () => {
    const snapshotQueue = new TaskQueue()
    snapshotQueue.setOwnerSubjectProvider(() => 'user-a')
    snapshotQueue.pause()
    snapshotQueue.add({
      platform: 'douyin',
      article: { title: '租户文章', accountId: 'account-a' },
      owner_subject: 'user-a',
      batchId: 'batch-a',
      accountId: 'account-a',
    })
    expect(JSON.parse(snapshotQueue.serialize()).queue[0]).toMatchObject({
      owner_subject: 'user-a',
      batchId: 'batch-a',
      accountId: 'account-a',
    })

    const queue = new TaskQueue({ defaultRetry: 0 })
    queue.setOwnerSubjectProvider(() => 'user-a')
    let attempts = 0
    const failed = new Promise(resolve => queue.once('task:failed', resolve))
    const retried = new Promise(resolve => queue.on('task:success', task => {
      if (task.retryOf) resolve(task)
    }))
    queue.setExecutor(async () => {
      attempts += 1
      if (attempts === 1) throw new Error('首次失败')
      return { success: true }
    })

    const originalId = queue.add({
      platform: 'douyin',
      article: { title: '租户文章', accountId: 'account-a' },
      owner_subject: 'user-a',
      batchId: 'batch-a',
      accountId: 'account-a',
    })
    const failedTask = await failed
    expect(failedTask).toMatchObject({ owner_subject: 'user-a', batchId: 'batch-a', accountId: 'account-a' })

    const retryId = queue.retry(originalId)
    expect(retryId).toBeTruthy()
    const retryTask = await retried
    expect(retryTask).toMatchObject({
      owner_subject: 'user-a',
      batchId: 'batch-a',
      accountId: 'account-a',
      retryOf: originalId,
    })
  })

  test('身份模式从可信 provider 固化 owner，不接受调用方伪造的 owner', () => {
    const queue = new TaskQueue()
    let currentOwner = 'user-a'
    queue.setOwnerSubjectProvider(() => currentOwner)
    queue.pause()

    queue.add({
      platform: 'douyin',
      article: { title: '可信归属' },
      owner_subject: 'forged-user',
    })

    expect(queue.getPendingTasks()).toEqual([
      expect.objectContaining({ owner_subject: 'user-a' }),
    ])

    currentOwner = 'user-b'
    expect(queue.getPendingTasks()).toEqual([])
    expect(() => queue.addForOwner({ platform: 'douyin', article: {} }, 'user-a'))
      .toThrow('当前登录用户不匹配')
  })

  test('身份模式只清除当前用户的等待任务', () => {
    const queue = new TaskQueue()
    let currentOwner = 'user-a'
    queue.setOwnerSubjectProvider(() => currentOwner)
    queue.pause()

    queue.add({ platform: 'douyin', article: { title: 'A' } })
    currentOwner = 'user-b'
    queue.add({ platform: 'douyin', article: { title: 'B' } })

    expect(queue.clearPending()).toBe(1)
    expect(queue.getPendingTasks()).toEqual([])
    currentOwner = 'user-a'
    expect(queue.getPendingTasks()).toEqual([
      expect.objectContaining({ article: { title: 'A' }, owner_subject: 'user-a' }),
    ])
  })

  test('身份切换会中止前一用户正在执行的任务', async () => {
    const queue = new TaskQueue({ defaultRetry: 0 })
    let currentOwner = 'user-a'
    let resolveTask
    let signal
    queue.setOwnerSubjectProvider(() => currentOwner)
    queue.setExecutor((task, context) => {
      signal = context.signal
      return new Promise(resolve => { resolveTask = resolve })
    })

    const taskId = queue.add({ platform: 'douyin', article: { title: 'A' } })
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(signal.aborted).toBe(false)

    currentOwner = 'user-b'
    queue.setOwnerSubjectProvider(() => currentOwner)
    expect(signal.aborted).toBe(true)
    resolveTask({ success: true })
    await new Promise(resolve => setTimeout(resolve, 30))

    currentOwner = 'user-a'
    queue.setOwnerSubjectProvider(() => currentOwner)
    expect(queue.getHistory().find(task => task.id === taskId)).toMatchObject({ status: 'cancelled' })
  })

  test('身份模式拒绝恢复无 owner 或其他用户的旧快照', () => {
    const queue = new TaskQueue()
    queue.setOwnerSubjectProvider(() => 'user-b')
    queue.pause()

    expect(queue.deserialize(JSON.stringify({ queue: [
      { id: 'legacy-task', platform: 'douyin', article: { title: 'legacy' } },
      { id: 'task-a', platform: 'douyin', article: { title: 'A' }, owner_subject: 'user-a' },
      { id: 'task-b', platform: 'douyin', article: { title: 'B' }, owner_subject: 'user-b' },
    ] }))).toBe(1)

    expect(queue.getPendingTasks()).toEqual([
      expect.objectContaining({ id: 'task-b', owner_subject: 'user-b' }),
    ])
  })

  test('身份 provider 暂时不可用时查询 fail-closed 且不启动历史任务', () => {
    const queue = new TaskQueue()
    queue.pause()
    queue.add({ platform: 'douyin', article: { title: '等待任务' } })
    queue.setOwnerSubjectProvider(() => null)

    expect(() => queue.getStatus()).not.toThrow()
    expect(queue.getStatus()).toMatchObject({ pending: 0, running: 0, history: 0 })
    expect(queue.getPendingTasks()).toEqual([])
    expect(JSON.parse(queue.serialize())).toEqual({ queue: [], running: [] })
    expect(() => queue.add({ platform: 'douyin', article: {} })).toThrow('任务队列无法识别当前用户')
  })

  test('addBatch 添加多个平台任务', () => {
    const queue = new TaskQueue()
    const ids = queue.addBatch(['wechat_mp', 'zhihu', 'weibo'], { title: 'Test' })
    expect(ids).toHaveLength(3)
  })

  test('executor 成功执行任务', async () => {
    const queue = new TaskQueue({ defaultRetry: 0 })
    const results = []

    queue.setExecutor(async (task) => {
      results.push(task.platform)
      return { success: true }
    })

    queue.add({ platform: 'test', article: { title: 'T' } })

    // 等待任务执行
    await new Promise(r => setTimeout(r, 100))

    expect(results).toContain('test')
  })

  test('失败任务自动重试（默认 2 次）', async () => {
    const queue = new TaskQueue({ defaultRetry: 2 })
    let attempts = 0

    queue.setExecutor(async () => {
      attempts++
      throw new Error('always fail')
    })

    queue.add({ platform: 'test', article: { title: 'T' } })

    await new Promise(r => setTimeout(r, 200))

    expect(attempts).toBe(3) // 1次初始 + 2次重试
  })

  test('失败任务可人工重试且同一失败记录保持幂等', async () => {
    const queue = new TaskQueue({ defaultRetry: 0 })
    let shouldFail = true
    queue.setExecutor(async () => {
      if (shouldFail) throw new Error('首次失败')
      return { success: true }
    })

    const failedId = queue.add({ platform: 'wechat_mp', article: { title: 'T', accountId: 'wx-1' } })
    await new Promise(r => setTimeout(r, 100))
    expect(queue.getHistory().find(task => task.id === failedId)?.status).toBe('failed')

    shouldFail = false
    const retryId = queue.retry(failedId)
    expect(retryId).toMatch(/^task_\d+_\d+$/)
    expect(queue.retry(failedId)).toBe(retryId)

    await new Promise(r => setTimeout(r, 100))
    const retried = queue.getHistory().find(task => task.id === retryId)
    expect(retried).toMatchObject({
      platform: 'wechat_mp',
      article: { title: 'T', accountId: 'wx-1' },
      status: 'success',
      retryOf: failedId,
    })
  })

  test('不存在或未失败的任务不能人工重试', async () => {
    const queue = new TaskQueue({ defaultRetry: 0 })
    queue.setExecutor(async () => ({ success: true }))
    const successId = queue.add({ platform: 'wechat_mp', article: { title: 'T' } })
    await new Promise(r => setTimeout(r, 100))

    expect(queue.retry('missing')).toBeNull()
    expect(queue.retry(successId)).toBeNull()
  })

  test('运行中任务取消后即使执行器成功也保持 cancelled，且向执行器传递中止信号', async () => {
    const queue = new TaskQueue({ defaultRetry: 0 })
    let resolveTask
    let receivedSignal
    let successCount = 0
    queue.on('task:success', () => { successCount++ })
    queue.setExecutor((task, context) => {
      receivedSignal = context.signal
      return new Promise(resolve => { resolveTask = resolve })
    })

    const taskId = queue.add({ platform: 'wechat_mp', article: { title: 'T', accountId: 'acc-1' } })
    await new Promise(r => setTimeout(r, 20))

    expect(queue.cancel(taskId)).toBe(true)
    expect(receivedSignal.aborted).toBe(true)
    resolveTask({ success: true })
    await new Promise(r => setTimeout(r, 30))

    expect(queue.getHistory().find(task => task.id === taskId)?.status).toBe('cancelled')
    expect(successCount).toBe(0)
  })

  test('运行中任务取消后执行器失败也不会自动重试', async () => {
    const queue = new TaskQueue({ defaultRetry: 2 })
    let rejectTask
    let retryCount = 0
    queue.on('task:retry', () => { retryCount++ })
    queue.setExecutor(() => new Promise((resolve, reject) => { rejectTask = reject }))

    const taskId = queue.add({ platform: 'wechat_mp', article: { title: 'T' } })
    await new Promise(r => setTimeout(r, 20))

    expect(queue.cancel(taskId)).toBe(true)
    rejectTask(new Error('发布器稍后失败'))
    await new Promise(r => setTimeout(r, 30))

    expect(queue.getHistory().find(task => task.id === taskId)?.status).toBe('cancelled')
    expect(retryCount).toBe(0)
  })

  test('执行器忽略中止信号时取消仍立即释放并发槽', async () => {
    const queue = new TaskQueue({ maxConcurrent: 1, defaultRetry: 0, defaultTimeout: 60000 })
    const started = []
    queue.setExecutor(task => {
      started.push(task.article.title)
      if (task.article.title === '阻塞任务') return new Promise(() => {})
      return Promise.resolve({ success: true })
    })

    const cancelledId = queue.add({ platform: 'wechat_mp', article: { title: '阻塞任务' } })
    const nextId = queue.add({ platform: 'zhihu', article: { title: '后续任务' } })
    await new Promise(r => setTimeout(r, 20))

    expect(queue.cancel(cancelledId)).toBe(true)
    await new Promise(r => setTimeout(r, 30))

    expect(started).toEqual(['阻塞任务', '后续任务'])
    expect(queue.getHistory().find(task => task.id === cancelledId)?.status).toBe('cancelled')
    expect(queue.getHistory().find(task => task.id === nextId)?.status).toBe('success')
    expect(queue.getStatus()).toMatchObject({ pending: 0, running: 0 })
  })

  test('shutdown 会取消运行中和等待中的任务，且不再启动后续任务', async () => {
    const queue = new TaskQueue({ maxConcurrent: 1, defaultRetry: 2, defaultTimeout: 60000 })
    const started = []
    let resolveRunning
    let runningSignal
    queue.setExecutor((task, context) => {
      started.push(task.article.title)
      runningSignal = context.signal
      return new Promise(resolve => { resolveRunning = resolve })
    })

    const runningId = queue.add({ platform: 'wechat_mp', article: { title: '运行中' } })
    const pendingId = queue.add({ platform: 'zhihu', article: { title: '等待中' } })
    await new Promise(r => setTimeout(r, 20))

    queue.shutdown()
    expect(runningSignal.aborted).toBe(true)
    resolveRunning({ success: true })
    await new Promise(r => setTimeout(r, 30))

    expect(started).toEqual(['运行中'])
    expect(queue.getHistory().find(task => task.id === runningId)?.status).toBe('cancelled')
    expect(queue.getHistory().find(task => task.id === pendingId)?.status).toBe('cancelled')
    expect(queue.getStatus()).toMatchObject({ pending: 0, running: 0, paused: true })
  })

  test('恢复队列时会立即填满 maxConcurrent 并发槽位', async () => {
    const queue = new TaskQueue({ maxConcurrent: 2, defaultRetry: 0 })
    const started = []
    const resolvers = []
    queue.pause()
    queue.setExecutor(task => new Promise(resolve => {
      started.push(task.id)
      resolvers.push(resolve)
    }))
    queue.add({ platform: 'wechat_mp', article: { title: '1' } })
    queue.add({ platform: 'zhihu', article: { title: '2' } })
    queue.add({ platform: 'weibo', article: { title: '3' } })

    queue.resume()
    await new Promise(r => setTimeout(r, 20))

    expect(started).toHaveLength(2)
    resolvers.forEach(resolve => resolve({ success: true }))
  })

  test('超时后标记失败', async () => {
    const queue = new TaskQueue({ defaultTimeout: 50, defaultRetry: 0 })

    queue.setExecutor(async () => {
      await new Promise(r => setTimeout(r, 1000))
      return 'never reached'
    })

    queue.add({ platform: 'test', article: { title: 'T' } })

    // 等待足够长让超时触发并完成
    await new Promise(r => setTimeout(r, 300))

    const history = queue.getHistory()
    expect(history.length).toBeGreaterThan(0)
    expect(history[0].status).toBe('failed')
    expect(history[0].error).toContain('timed out')
  })

  test('暂停后任务不执行', async () => {
    const queue = new TaskQueue()
    let executed = false

    queue.setExecutor(async () => { executed = true })

    // 先暂停，再添加任务
    queue.pause()
    queue.add({ platform: 'test', article: { title: 'T' } })

    await new Promise(r => setTimeout(r, 100))

    expect(executed).toBe(false)
  })

  test('恢复后继续执行', async () => {
    const queue = new TaskQueue()
    let executed = false

    queue.setExecutor(async () => { executed = true })
    queue.add({ platform: 'test', article: { title: 'T' } })
    queue.pause()
    queue.resume()

    await new Promise(r => setTimeout(r, 100))

    expect(executed).toBe(true)
  })

  test('获取队列状态', () => {
    const queue = new TaskQueue()
    const status = queue.getStatus()
    expect(status.pending).toBe(0)
    expect(status.running).toBe(0)
    expect(status.paused).toBe(false)
  })

  test('进度事件', async () => {
    const queue = new TaskQueue()
    const events = []

    queue.on('task:added', () => events.push('added'))
    queue.on('task:start', () => events.push('start'))

    queue.setExecutor(async () => ({ success: true }))
    queue.add({ platform: 'test', article: { title: 'T' } })

    await new Promise(r => setTimeout(r, 100))

    expect(events).toContain('added')
    expect(events).toContain('start')
  })

  test('noRetry 错误（风控即停）跳过重试直接判失败', async () => {
    const queue = new TaskQueue({ defaultRetry: 2 })
    let attempts = 0
    const failed = new Promise(resolve => queue.once('task:failed', resolve))
    let retryCount = 0
    queue.on('task:retry', () => { retryCount++ })
    queue.setExecutor(async () => {
      attempts += 1
      const err = new Error('publish blocked: risk_suspended for weixin/acc1')
      err.noRetry = true
      throw err
    })
    queue.add({ platform: 'weixin', article: { title: '风控即停', accountId: 'acc1' } })
    const task = await failed
    expect(attempts).toBe(1)
    expect(retryCount).toBe(0)
    expect(task.status).toBe('failed')
    expect(task.error).toContain('risk_suspended')
  })
})

