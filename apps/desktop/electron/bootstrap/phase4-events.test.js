// @vitest-environment node
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
})
