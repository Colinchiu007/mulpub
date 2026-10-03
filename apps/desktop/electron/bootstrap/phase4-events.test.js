// @vitest-environment node
const { RiskSuspendedError } = require('../services/risk-suspender-store')

const { EventEmitter } = require('events')
const { wireTaskQueueEvents } = require('./phase4-events')

describe('phase4-events', () => {
  it('把任务固化的 owner_subject 写入发布历史', () => {
    const taskQueue = new EventEmitter()
    const history = { addRecord: vi.fn() }
    wireTaskQueueEvents({
      taskQueue,
      history,
      publishMonitor: { createMonitorTask: vi.fn() },
      publishImpactTracker: { scheduleImpactTracking: vi.fn() },
      getMainWin: () => null,
    })

    taskQueue.emit('task:success', {
      id: 'task-a',
      owner_subject: 'user-a',
      platform: 'wechat_mp',
      article: { title: '隔离发布' },
      result: {},
    })

    expect(history.addRecord).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: 'task-a', title: '隔离发布' }),
      'user-a',
    )
  })

  it('定时派发任务的 publishMode 写入发布历史（历史页「定时发布」过滤器不再恒空）', () => {
    const taskQueue = new EventEmitter()
    const history = { addRecord: vi.fn() }
    wireTaskQueueEvents({
      taskQueue,
      history,
      publishMonitor: { createMonitorTask: vi.fn() },
      publishImpactTracker: { scheduleImpactTracking: vi.fn() },
      getMainWin: () => null,
    })

    taskQueue.emit('task:success', {
      id: 'task-sched',
      platform: 'wechat_mp',
      article: { title: '定时发布文章' },
      result: {},
      publishMode: 'scheduled',
    })

    expect(history.addRecord).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: 'task-sched', publishMode: 'scheduled' }),
      undefined,
    )

    taskQueue.emit('task:failed', {
      id: 'task-sched-fail',
      platform: 'zhihu',
      article: { title: '定时失败文章' },
      error: '平台拒绝',
      publishMode: 'scheduled',
    })

    expect(history.addRecord).toHaveBeenLastCalledWith(
      expect.objectContaining({ taskId: 'task-sched-fail', publishMode: 'scheduled', status: 'failed' }),
      undefined,
    )
  })

  it('立即发布任务不写 publishMode 字段（保持历史记录原样）', () => {
    const taskQueue = new EventEmitter()
    const history = { addRecord: vi.fn() }
    wireTaskQueueEvents({
      taskQueue,
      history,
      publishMonitor: { createMonitorTask: vi.fn() },
      publishImpactTracker: { scheduleImpactTracking: vi.fn() },
      getMainWin: () => null,
    })

    taskQueue.emit('task:success', {
      id: 'task-immediate',
      platform: 'wechat_mp',
      article: { title: '立即发布文章' },
      result: {},
    })

    const record = history.addRecord.mock.calls[0][0]
    expect(record.publishMode).toBeUndefined()
  })

  it('发布成功调用 tracker 真实方法 scheduleImpactTracking（含 platform）', () => {
    // 根因（2026-09-28 活体残余②）：调用方调 addTracking——真实类只有
    // scheduleImpactTracking（publish-impact-tracker.js），旧测试 mock 了
    // 不存在的方法名，mock-现实漂移让 TypeError 逃逸到产线。
    const taskQueue = new EventEmitter()
    const scheduleImpactTracking = vi.fn()
    wireTaskQueueEvents({
      taskQueue,
      history: { addRecord: vi.fn() },
      publishMonitor: { createMonitorTask: vi.fn() },
      publishImpactTracker: { scheduleImpactTracking },
      getMainWin: () => null,
    })

    taskQueue.emit('task:success', {
      id: 'task-impact',
      platform: 'kuaishou',
      article: { title: '影响力追踪标题', keywords: ['kw1'] },
      result: {},
    })

    expect(scheduleImpactTracking).toHaveBeenCalledTimes(1)
    expect(scheduleImpactTracking).toHaveBeenCalledWith({
      articleId: 'task-impact',
      title: '影响力追踪标题',
      keywords: ['kw1'],
      platform: 'kuaishou',
    })
  })

  it('风控命中的发布失败额外发 publish:risk-hold IPC', () => {
    const taskQueue = new EventEmitter()
    const send = vi.fn()
    const win = { isDestroyed: () => false, webContents: { send } }
    wireTaskQueueEvents({
      taskQueue,
      history: { addRecord: vi.fn() },
      publishMonitor: { createMonitorTask: vi.fn() },
      publishImpactTracker: { scheduleImpactTracking: vi.fn() },
      getMainWin: () => win,
    })
    taskQueue.emit('task:failed', { id: 't-risk', platform: 'baijiahao', article: { accountId: 'acc-9' }, error: '触发风控，请稍后再试' })
    const hold = send.mock.calls.find((c) => c[0] === 'publish:risk-hold')
    expect(hold).toBeTruthy()
    expect(hold[1]).toEqual(expect.objectContaining({ platform: 'baijiahao', accountId: 'acc-9', taskId: 't-risk' }))
  })

  it('普通发布失败不发 publish:risk-hold', () => {
    const taskQueue = new EventEmitter()
    const send = vi.fn()
    const win = { isDestroyed: () => false, webContents: { send } }
    wireTaskQueueEvents({
      taskQueue,
      history: { addRecord: vi.fn() },
      publishMonitor: { createMonitorTask: vi.fn() },
      publishImpactTracker: { scheduleImpactTracking: vi.fn() },
      getMainWin: () => win,
    })
    taskQueue.emit('task:failed', { id: 't-plain', platform: 'zhihu', article: {}, error: '平台 Cookie 缺失（账号未登录）' })
    expect(send.mock.calls.some((c) => c[0] === 'publish:risk-hold')).toBe(false)
    expect(send.mock.calls.some((c) => c[0] === 'publish:progress')).toBe(true)
  })

  it('风控命中时登记挂起并广播 publish:risk-suspended', () => {
    const taskQueue = new EventEmitter()
    const send = vi.fn()
    const win = { isDestroyed: () => false, webContents: { send } }
    const riskSuspender = { suspend: vi.fn(), listSuspended: vi.fn(() => [{ platform: 'baijiahao', accountId: 'acc-9' }]) }
    wireTaskQueueEvents({
      taskQueue,
      history: { addRecord: vi.fn() },
      publishMonitor: { createMonitorTask: vi.fn() },
      publishImpactTracker: { scheduleImpactTracking: vi.fn() },
      getMainWin: () => win,
      riskSuspender,
    })
    taskQueue.emit('task:failed', { id: 't-s', platform: 'baijiahao', article: { accountId: 'acc-9' }, error: '触发风控，请稍后再试' })
    expect(riskSuspender.suspend).toHaveBeenCalledWith('baijiahao', 'acc-9', expect.objectContaining({ reason: 'risk_blocked' }))
    const bc = send.mock.calls.find((c) => c[0] === 'publish:risk-suspended')
    expect(bc).toBeTruthy()
    expect(bc[1].suspended).toEqual([{ platform: 'baijiahao', accountId: 'acc-9' }])
    expect(send.mock.calls.some((c) => c[0] === 'publish:risk-hold')).toBe(true)
  })

  it('executor 拦截产生的 risk_suspended 失败不再次挂起（避免自触发）', () => {
    const taskQueue = new EventEmitter()
    const send = vi.fn()
    const win = { isDestroyed: () => false, webContents: { send } }
    const riskSuspender = { suspend: vi.fn(), listSuspended: vi.fn(() => []) }
    wireTaskQueueEvents({
      taskQueue,
      history: { addRecord: vi.fn() },
      publishMonitor: { createMonitorTask: vi.fn() },
      publishImpactTracker: { scheduleImpactTracking: vi.fn() },
      getMainWin: () => win,
      riskSuspender,
    })
    taskQueue.emit('task:failed', { id: 't-blk', platform: 'weixin', article: {}, error: new RiskSuspendedError('weixin', 'acc1').message })
    expect(riskSuspender.suspend).not.toHaveBeenCalled()
    expect(send.mock.calls.some((c) => c[0] === 'publish:risk-hold')).toBe(false)
    expect(send.mock.calls.some((c) => c[0] === 'publish:risk-suspended')).toBe(false)
  })

  it('未接线 riskSuspender 时退回纯通知（向后兼容）', () => {
    const taskQueue = new EventEmitter()
    const send = vi.fn()
    const win = { isDestroyed: () => false, webContents: { send } }
    wireTaskQueueEvents({
      taskQueue,
      history: { addRecord: vi.fn() },
      publishMonitor: { createMonitorTask: vi.fn() },
      publishImpactTracker: { scheduleImpactTracking: vi.fn() },
      getMainWin: () => win,
    })
    taskQueue.emit('task:failed', { id: 't-na', platform: 'toutiao', article: {}, error: '触发风控' })
    expect(send.mock.calls.some((c) => c[0] === 'publish:risk-hold')).toBe(true)
    expect(send.mock.calls.some((c) => c[0] === 'publish:risk-suspended')).toBe(false)
  })
})

describe('phase4-events — 进度事件富化契约（publish-progress-ux）', () => {
  function wire(send) {
    const taskQueue = new EventEmitter()
    const history = { addRecord: vi.fn() }
    wireTaskQueueEvents({
      taskQueue,
      history,
      publishMonitor: { createMonitorTask: vi.fn() },
      publishImpactTracker: { scheduleImpactTracking: vi.fn() },
      getMainWin: () => ({ isDestroyed: () => false, webContents: { send } }),
    })
    return { taskQueue, history }
  }

  function progressPayloads(send) {
    return send.mock.calls.filter((c) => c[0] === 'publish:progress').map((c) => c[1])
  }

  it('task:success → publish:progress 富化：phase=success、stageKey=done、percent=100、timestamp', () => {
    const send = vi.fn()
    const { taskQueue } = wire(send)
    taskQueue.emit('task:success', {
      id: 't-s1', platform: 'bilibili', article: { title: '富化' }, result: { url: 'https://b' }, batchId: 'batch-1',
    })
    const payload = progressPayloads(send).at(-1)
    expect(payload).toEqual(expect.objectContaining({
      platform: 'bilibili', taskId: 't-s1', stage: '✓ 发布成功',
      phase: 'success', stageKey: 'done', percent: 100, batchId: 'batch-1',
      result: { url: 'https://b' },
    }))
    expect(typeof payload.timestamp).toBe('number')
  })

  it('task:failed → 富化 phase=failed + 落发布历史（status=failed 含 error）', () => {
    const send = vi.fn()
    const { taskQueue, history } = wire(send)
    taskQueue.emit('task:failed', {
      id: 't-f1', platform: 'zhihu', owner_subject: 'user-f', article: { title: '失败标题' }, error: '平台 Cookie 缺失',
    })
    const payload = progressPayloads(send).at(-1)
    expect(payload).toEqual(expect.objectContaining({
      platform: 'zhihu', taskId: 't-f1', phase: 'failed', stageKey: 'failed', percent: 100, error: '平台 Cookie 缺失',
    }))
    // G8 修复：失败必须落历史（此前 task:failed 不调 addRecord，失败在任何页面不可查）
    expect(history.addRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        platform: 'zhihu', taskId: 't-f1', title: '失败标题', status: 'failed', error: '平台 Cookie 缺失',
      }),
      'user-f',
    )
  })

  it('publish:blocked → 富化 phase=blocked、stageKey=waiting、remainingWait 与 bucket 归因均须跨边界转发', () => {
    const send = vi.fn()
    const { taskQueue } = wire(send)
    taskQueue.emit('publish:blocked', {
      task: { id: 't-b1', platform: 'douyin' }, remainingWait: 240000, bucket: 'platform',
    })
    const payload = progressPayloads(send).at(-1)
    expect(payload).toEqual(expect.objectContaining({
      platform: 'douyin', taskId: 't-b1', phase: 'blocked', stageKey: 'waiting', remainingWait: 240000,
    }))
    // 归因是运营判「被自己账号卡住」还是「被同平台别的号卡住」的唯一现场证据，不得在这一站被吃掉
    expect(payload.bucket).toBe('platform')

    // 生产者未给归因时如实为 null，不得猜成某一档
    taskQueue.emit('publish:blocked', { task: { id: 't-b2', platform: 'weibo' }, remainingWait: 60000 })
    expect(progressPayloads(send).at(-1).bucket).toBe(null)
  })

  it('task:retry → 富化 phase=retry、retriesLeft 结构化透传', () => {
    const send = vi.fn()
    const { taskQueue } = wire(send)
    taskQueue.emit('task:retry', { id: 't-r1', platform: 'weibo', retriesLeft: 2 })
    const payload = progressPayloads(send).at(-1)
    expect(payload).toEqual(expect.objectContaining({
      platform: 'weibo', taskId: 't-r1', phase: 'retry', stageKey: 'waiting', retriesLeft: 2,
    }))
  })

  it('task:cancelled → 富化 phase=cancelled（取消终态经发射层单一来源转发，publish-progress-panel-refine）', () => {
    const send = vi.fn()
    const { taskQueue, history } = wire(send)
    taskQueue.emit('task:cancelled', { id: 't-c1', platform: 'douyin', batchId: 'batch-1' })
    const payload = progressPayloads(send).at(-1)
    expect(payload).toEqual(expect.objectContaining({
      platform: 'douyin', taskId: 't-c1', phase: 'cancelled', batchId: 'batch-1',
    }))
    // 取消不是失败：不得落发布历史（历史只记 success/failed，取消不入库）
    history.addRecord.mockClear()
    taskQueue.emit('task:cancelled', { id: 't-c2', platform: 'weibo' })
    expect(history.addRecord).not.toHaveBeenCalled()
  })

  // P0-1 审核状态（2026-10-09）：监控结论**回写原记录**，不再追加第二条；
  // 无定论（error/timeout/skipped/pending）保持原记录不变。
  // 第二切片：建监控任务前先过「凭证解析 + 能力分级」门（异步）；测试注入策略替身。
  describe('P0-1 审核状态回写', () => {
    const flush = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve() }

    function wireWithMonitor (overrides = {}) {
      const taskQueue = new EventEmitter()
      const history = { addRecord: vi.fn(() => ({ id: 'h-1' })), updateRecordAudit: vi.fn(() => ({ updated: true })) }
      const monitorCalls = []
      const resolveCookies = overrides.resolveCookies || (async () => ({ cookies: 'c=1', source: 'provided' }))
      const decide = overrides.decide || (() => ({ start: true, reason: 'candidate' }))
      wireTaskQueueEvents({
        taskQueue,
        history,
        publishMonitor: {
          createMonitorTask: vi.fn((opts) => { monitorCalls.push(opts); return { stop: vi.fn() } }),
        },
        publishImpactTracker: { scheduleImpactTracking: vi.fn() },
        getMainWin: () => null,
        auditRequery: { resolveCookies, decide },
      })
      return { taskQueue, history, monitorCalls }
    }

    async function emitSuccess (taskQueue) {
      taskQueue.emit('task:success', {
        id: 'task-audit-1', owner_subject: 'user-a', platform: 'douyin',
        article: { title: '审核跟踪' }, result: { postId: 'aweme-42' },
      })
      await flush()
    }

    it('明确结论（rejected）回写原记录，不追加重复行', async () => {
      const { taskQueue, history, monitorCalls } = wireWithMonitor()
      await emitSuccess(taskQueue)
      expect(history.addRecord).toHaveBeenCalledTimes(1) // 仅成功那条
      expect(monitorCalls).toHaveLength(1)

      monitorCalls[0].callback({ status: 'rejected', postId: 'aweme-42' })

      expect(history.updateRecordAudit).toHaveBeenCalledTimes(1)
      const [id, patch, owner] = history.updateRecordAudit.mock.calls[0]
      expect(id).toBe('task-audit-1')
      expect(owner).toBe('user-a')
      expect(patch).toEqual(expect.objectContaining({
        auditStatus: 'deny', monitorStatus: 'rejected', platformWorkId: 'aweme-42',
      }))
      expect(typeof patch.auditedAt).toBe('string')
      // 关键：不新增第二条记录（旧形态 addRecord 追加导致同一次发布两行）
      expect(history.addRecord).toHaveBeenCalledTimes(1)
    })

    it('inAudit / published / prePublish 各自映射正确', async () => {
      for (const [monitorStatus, expected] of [['reviewed', 'inAudit'], ['published', 'published'], ['draft', 'prePublish']]) {
        const { taskQueue, history, monitorCalls } = wireWithMonitor()
        await emitSuccess(taskQueue)
        monitorCalls[0].callback({ status: monitorStatus, postId: 'p1' })
        expect(history.updateRecordAudit.mock.calls[0][1].auditStatus, monitorStatus).toBe(expected)
      }
    })

    it('无定论状态（error/timeout/skipped/pending）一律不改写原记录', async () => {
      for (const inconclusive of ['error', 'timeout', 'skipped', 'pending', 'unknown', 'failed']) {
        const { taskQueue, history, monitorCalls } = wireWithMonitor()
        await emitSuccess(taskQueue)
        monitorCalls[0].callback({ status: inconclusive, postId: 'p1' })
        expect(history.updateRecordAudit, inconclusive + ' 不得回写').not.toHaveBeenCalled()
        expect(history.addRecord, inconclusive + ' 不得追加').toHaveBeenCalledTimes(1)
      }
    })

    it('updateRecordAudit 抛错不冒泡（监控旁路不得影响发布主流程）', async () => {
      const { taskQueue, monitorCalls } = wireWithMonitor({
        resolveCookies: async () => ({ cookies: 'c=1', source: 'provided' }),
      })
      monitorCalls.length = 0
      const taskQueue2 = taskQueue
      const history = {
        addRecord: vi.fn(),
        updateRecordAudit: vi.fn(() => { throw new Error('disk full') }),
      }
      // 重新接线以替换 history（上面 wireWithMonitor 的 history 不回写抛错）
      const monitorCalls2 = []
      wireTaskQueueEvents({
        taskQueue: taskQueue2, history,
        publishMonitor: { createMonitorTask: vi.fn((opts) => { monitorCalls2.push(opts); return { stop: vi.fn() } }) },
        publishImpactTracker: { scheduleImpactTracking: vi.fn() },
        getMainWin: () => null,
        auditRequery: { resolveCookies: async () => ({ cookies: 'c=1', source: 'provided' }), decide: () => ({ start: true, reason: 'candidate' }) },
      })
      taskQueue2.emit('task:success', {
        id: 'task-audit-boom', owner_subject: 'user-a', platform: 'douyin',
        article: { title: '抛错' }, result: { postId: 'p1' },
      })
      await flush()
      expect(() => monitorCalls2[0].callback({ status: 'rejected', postId: 'p1' })).not.toThrow()
    })

    it('无 postId 时不建监控任务（无可查锚点）', async () => {
      const { taskQueue, monitorCalls } = wireWithMonitor()
      taskQueue.emit('task:success', {
        id: 'task-no-postid', platform: 'weibo', article: { title: 'T' }, result: {},
      })
      await flush()
      expect(monitorCalls).toHaveLength(0)
    })

    // P0-1 第二切片：凭证/能力门——不通过就不建监控任务（消灭「必然失败的重试风暴」）
    it('凭证拿不到（no-cookies）不建监控任务', async () => {
      const { taskQueue, monitorCalls } = wireWithMonitor({
        resolveCookies: async () => ({ cookies: '', source: 'none' }),
        decide: () => ({ start: false, reason: 'no-cookies' }),
      })
      await emitSuccess(taskQueue)
      expect(monitorCalls).toHaveLength(0)
    })

    it('端点未验证/探索开关关闭（unsupported/candidates-disabled）不建监控任务', async () => {
      for (const reason of ['unsupported-platform', 'candidates-disabled']) {
        const { taskQueue, monitorCalls } = wireWithMonitor({
          decide: () => ({ start: false, reason }),
        })
        await emitSuccess(taskQueue)
        expect(monitorCalls, reason).toHaveLength(0)
      }
    })

    it('凭证解析结果透传给监控任务（含 accountId 定位 auth 分区）', async () => {
      let seenParams = null
      const { taskQueue, monitorCalls } = wireWithMonitor({
        resolveCookies: async (params) => { seenParams = params; return { cookies: 'z_c0=tok', source: 'auth-partition' } },
      })
      taskQueue.emit('task:success', {
        id: 'task-cookie', owner_subject: 'user-a', platform: 'zhihu',
        article: { title: '凭证', accountId: 'acc-9' }, result: { postId: 'p-1' },
      })
      await flush()
      expect(seenParams).toEqual(expect.objectContaining({ platform: 'zhihu', accountId: 'acc-9' }))
      expect(monitorCalls).toHaveLength(1)
      expect(monitorCalls[0].cookies).toBe('z_c0=tok')
    })

    it('凭证解析抛错不冒泡且不建任务（旁路不得影响发布主流程）', async () => {
      const { taskQueue, monitorCalls } = wireWithMonitor({
        resolveCookies: async () => { throw new Error('session gone') },
      })
      await emitSuccess(taskQueue)
      expect(monitorCalls).toHaveLength(0)
    })
  })
})


