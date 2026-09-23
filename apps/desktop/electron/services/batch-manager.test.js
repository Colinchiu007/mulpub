// @ts-check
const EventEmitter = require('events')

__enableElectronMock()

const mockLog = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}
__registerMock('./logger', mockLog)

const BatchManager = require('./batch-manager')
const EC = require('../core/error-codes').ERROR

function createStore(articles) {
  const batch = {
    id: 'batch-1',
    articles,
    total: articles.length,
    completed: 0,
    failed: 0,
    status: 'pending',
  }

  return {
    batch,
    getBatchJob: vi.fn(function (id) {
      return id === batch.id ? batch : null
    }),
    updateBatchJob: vi.fn(function (id, updates) {
      if (id !== batch.id) return false
      Object.assign(batch, updates)
      return true
    }),
  }
}

function createQueue(addImplementation) {
  const queue = new EventEmitter()
  queue.add = vi.fn(addImplementation)
  return queue
}

function emittedEvents(send) {
  return send.mock.calls
    .filter(function (call) { return call[0] === 'batch:progress' })
    .map(function (call) { return call[1] })
}

describe('BatchManager.executeBatch 入队与终态合同', () => {
  let send

  beforeEach(() => {
    vi.clearAllMocks()
    __resetElectronMock()
    BatchManager.setTaskQueue(null)
    const win = new __electronMock.BrowserWindow()
    send = vi.fn()
    win.webContents.send = send
  })

  afterEach(() => {
    BatchManager.setTaskQueue(null)
  })

  it('任务队列未初始化时为每个任务发送带 batchId/taskId 的失败终态并完成批次', async () => {
    const store = createStore([
      { title: '文章', content: '正文', platforms: ['wechat_mp', 'zhihu'] },
    ])
    const manager = new BatchManager(store)

    const result = await manager.executeBatch('batch-1')

    expect(result).toMatchObject({ batchId: 'batch-1', total: 2, accepted: 0, failed: 2 })
    const events = emittedEvents(send)
    const failures = events.filter(function (event) { return event.kind === 'task-complete' })
    expect(failures).toHaveLength(2)
    expect(failures.every(function (event) {
      return event.batchId === 'batch-1' && Boolean(event.taskId) && event.ok === false
    })).toBe(true)
    expect(events.at(-1)).toMatchObject({
      kind: 'batch-complete',
      batchId: 'batch-1',
      total: 2,
      accepted: 0,
      completed: 2,
      failed: 2,
    })
    expect(store.batch).toMatchObject({ total: 2, completed: 2, failed: 2, status: 'done' })
  })

  it('平台标识无效时不调用队列并发送可追踪的失败终态', async () => {
    const store = createStore([
      { title: '文章', content: '正文', platforms: [{ accountId: 'account-1' }] },
    ])
    const queue = createQueue(function () { return 'should-not-run' })
    BatchManager.setTaskQueue(queue)
    const manager = new BatchManager(store)

    const result = await manager.executeBatch('batch-1')

    expect(queue.add).not.toHaveBeenCalled()
    expect(result).toMatchObject({ total: 1, accepted: 0, failed: 1 })
    expect(emittedEvents(send)[0]).toMatchObject({
      kind: 'task-complete',
      batchId: 'batch-1',
      ok: false,
      message: '无效发布平台',
    })
    expect(emittedEvents(send)[0].taskId).toBeTruthy()
  })

  it.each([
    {
      name: '同步抛错',
      add: function () { throw new Error('队列已关闭') },
    },
    {
      name: '异步拒绝',
      add: function () { return Promise.reject(new Error('队列写入失败')) },
    },
  ])('taskQueue.add $name 时返回失败计数并发送失败终态', async ({ add }) => {
    const store = createStore([
      { title: '文章', content: '正文', platforms: ['wechat_mp'] },
    ])
    const queue = createQueue(add)
    BatchManager.setTaskQueue(queue)
    const manager = new BatchManager(store)

    const result = await manager.executeBatch('batch-1')

    expect(result).toMatchObject({ total: 1, accepted: 0, failed: 1 })
    const failure = emittedEvents(send).find(function (event) { return event.kind === 'task-complete' })
    expect(failure).toMatchObject({ batchId: 'batch-1', platform: 'wechat_mp', ok: false })
    expect(failure.taskId).toBeTruthy()
    expect(store.batch).toMatchObject({ completed: 1, failed: 1, status: 'done' })
  })

  it('部分任务接受、部分入队失败时返回精确计数，并在接受任务结束后发送 batch-complete', async () => {
    const store = createStore([
      { title: '文章', content: '正文', platforms: ['wechat_mp', 'zhihu'] },
    ])
    const queue = createQueue(function (task) {
      if (task.platform === 'zhihu') throw new Error('平台队列不可用')
      return 'task-accepted'
    })
    BatchManager.setTaskQueue(queue)
    const manager = new BatchManager(store)

    const result = await manager.executeBatch('batch-1')

    expect(result).toMatchObject({ total: 2, accepted: 1, failed: 1 })
    expect(emittedEvents(send).some(function (event) { return event.kind === 'batch-complete' })).toBe(false)

    queue.emit('task:success', {
      id: 'task-accepted',
      status: 'success',
      result: { url: 'https://example.test/published' },
    })

    expect(store.batch).toMatchObject({ total: 2, completed: 2, failed: 1, status: 'done' })
    expect(emittedEvents(send).at(-1)).toMatchObject({
      kind: 'batch-complete',
      total: 2,
      accepted: 1,
      completed: 2,
      succeeded: 1,
      failed: 1,
    })
    expect(queue.listenerCount('task:success')).toBe(0)
    expect(queue.listenerCount('task:failed')).toBe(0)
  })

  it('队列在 add 返回前同步发出终态时仍能收口，避免终态事件丢失', async () => {
    const store = createStore([
      { title: '文章', content: '正文', platforms: ['wechat_mp'] },
    ])
    const queue = createQueue(function () {
      queue.emit('task:success', {
        id: 'task-early',
        status: 'success',
        result: {},
      })
      return 'task-early'
    })
    BatchManager.setTaskQueue(queue)
    const manager = new BatchManager(store)

    const result = await manager.executeBatch('batch-1')

    expect(result).toMatchObject({ total: 1, accepted: 1, failed: 0 })
    expect(store.batch).toMatchObject({ completed: 1, failed: 0, status: 'done' })
    expect(emittedEvents(send).at(-1)).toMatchObject({
      kind: 'batch-complete',
      batchId: 'batch-1',
      completed: 1,
      succeeded: 1,
      failed: 0,
    })
  })

  it('batch:execute IPC 响应返回 accepted/failed 明确计数合同', async () => {
    const store = createStore([
      { title: '文章', content: '正文', platforms: ['wechat_mp'] },
    ])
    const manager = new BatchManager(store)
    // P1-14：注入契约收紧后必须显式传入受控 ipcMain（不再回退全局）
    manager.registerIpcHandlers(__electronMock.ipcMain)

    const response = await __electronMock.ipcMain._handlers['batch:execute']({}, 'batch-1')

    expect(response).toEqual({
      code: 0,
      data: {
        batchId: 'batch-1',
        total: 1,
        accepted: 0,
        failed: 1,
      },
    })
  })

  it('身份模式冻结创建者 owner，用户切换后仍只更新原批次并可信入队', async () => {
    let currentOwner = 'user-a'
    const store = createStore([
      { title: '文章', content: '正文', platforms: ['wechat_mp'] },
    ])
    const queue = new EventEmitter()
    queue.addForOwner = vi.fn(() => 'task-a')
    BatchManager.setTaskQueue(queue)
    const manager = new BatchManager(store)
    manager.setOwnerSubjectProvider(() => currentOwner)

    await manager.executeBatch('batch-1')
    expect(store.getBatchJob).toHaveBeenCalledWith('batch-1', 'user-a')
    expect(queue.addForOwner).toHaveBeenCalledWith(
      expect.objectContaining({ owner_subject: 'user-a', batchId: 'batch-1', accountId: null }),
      'user-a',
    )

    currentOwner = 'user-b'
    queue.emit('task:success', { id: 'task-a', status: 'success', result: {} })
    expect(store.updateBatchJob).toHaveBeenLastCalledWith(
      'batch-1',
      expect.objectContaining({ completed: 1, status: 'done' }),
      'user-a',
    )
  })

  it('batch:list 在身份服务缺少 owner 时 fail-closed', async () => {
    const store = { listBatchJobs: vi.fn() }
    const manager = new BatchManager(store)
    manager.setOwnerSubjectProvider(() => null)
    // P1-14：注入契约收紧后必须显式传入受控 ipcMain（不再回退全局）
    manager.registerIpcHandlers(__electronMock.ipcMain)

    const response = await __electronMock.ipcMain._handlers['batch:list']({})

    expect(response).toMatchObject({ code: EC.AUTH_ERROR })
    expect(store.listBatchJobs).not.toHaveBeenCalled()
  })
})
