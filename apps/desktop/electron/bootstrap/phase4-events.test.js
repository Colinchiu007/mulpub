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
      publishImpactTracker: { addTracking: vi.fn() },
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

  it('风控命中的发布失败额外发 publish:risk-hold IPC', () => {
    const taskQueue = new EventEmitter()
    const send = vi.fn()
    const win = { isDestroyed: () => false, webContents: { send } }
    wireTaskQueueEvents({
      taskQueue,
      history: { addRecord: vi.fn() },
      publishMonitor: { createMonitorTask: vi.fn() },
      publishImpactTracker: { addTracking: vi.fn() },
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
      publishImpactTracker: { addTracking: vi.fn() },
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
      publishImpactTracker: { addTracking: vi.fn() },
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
      publishImpactTracker: { addTracking: vi.fn() },
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
      publishImpactTracker: { addTracking: vi.fn() },
      getMainWin: () => win,
    })
    taskQueue.emit('task:failed', { id: 't-na', platform: 'toutiao', article: {}, error: '触发风控' })
    expect(send.mock.calls.some((c) => c[0] === 'publish:risk-hold')).toBe(true)
    expect(send.mock.calls.some((c) => c[0] === 'publish:risk-suspended')).toBe(false)
  })
})


