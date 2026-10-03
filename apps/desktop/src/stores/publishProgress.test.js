import { describe, expect, it, vi, beforeEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

const mockOnProgress = vi.hoisted(() => vi.fn())
const mockOnBatchProgress = vi.hoisted(() => vi.fn())
const mockGetQueueStatus = vi.hoisted(() => vi.fn())
const mockRetryTask = vi.hoisted(() => vi.fn())
const mockCancelTask = vi.hoisted(() => vi.fn())

vi.mock('@/api/publisher', () => ({
  onProgress: (...args) => mockOnProgress(...args),
  onBatchProgress: (...args) => mockOnBatchProgress(...args),
  getQueueStatus: (...args) => mockGetQueueStatus(...args),
  retryTask: (...args) => mockRetryTask(...args),
  cancelTask: (...args) => mockCancelTask(...args),
}))

const STORAGE_KEY = 'mp-publish-first-hide-toast-shown'

function progressEvent(overrides = {}) {
  return {
    platform: 'douyin',
    taskId: 'task-1',
    stage: 'uploading video...',
    phase: 'progress',
    stageKey: 'upload',
    percent: 20,
    batchId: null,
    timestamp: Date.now(),
    ...overrides,
  }
}

describe('publishProgress store — 全局承载（publish-progress-ux）', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    mockOnProgress.mockReset()
    mockOnBatchProgress.mockReset()
    mockGetQueueStatus.mockReset()
    mockRetryTask.mockReset()
    mockCancelTask.mockReset()
    mockOnProgress.mockReturnValue(() => {})
    mockOnBatchProgress.mockReturnValue(() => {})
    mockGetQueueStatus.mockResolvedValue({ code: 0, data: { running: [], queue: [] } })
    mockCancelTask.mockResolvedValue({ code: 0, data: true })
    window.localStorage.clear()
  })

  async function makeStore() {
    const { usePublishProgressStore } = await import('./publishProgress')
    return usePublishProgressStore()
  }

  it('init() 绑定全局订阅一次（幂等），不随组件卸载注销', async () => {
    const store = await makeStore()
    store.init()
    store.init()
    expect(mockOnProgress).toHaveBeenCalledTimes(1)
    expect(mockOnBatchProgress).toHaveBeenCalledTimes(1)
  })

  it('registerSession(taskIds) 创建排队任务并自动展开面板', async () => {
    const store = await makeStore()
    store.registerSession({ taskIds: ['t-a', 't-b'], title: '测试文章' })
    expect(store.sessions).toHaveLength(1)
    expect(store.sessions[0].tasks['t-a'].phase).toBe('queued')
    expect(store.sessions[0].tasks['t-b'].phase).toBe('queued')
    expect(store.panelVisible).toBe(true)
    expect(store.panelMinimized).toBe(false)
    expect(store.hasRunning).toBe(true)
  })

  it('空 taskIds 且无 batchId → 不创建会话', async () => {
    const store = await makeStore()
    store.registerSession({ taskIds: [], title: 'x' })
    store.registerSession({ title: 'x' })
    expect(store.sessions).toHaveLength(0)
  })

  it('handleProgressEvent 按 taskId 路由并更新相位/阶段/百分比', async () => {
    const store = await makeStore()
    store.registerSession({ taskIds: ['t-1'], title: 'x' })
    store.handleProgressEvent(progressEvent({ taskId: 't-1', phase: 'start', stage: '准备发布...', stageKey: 'prepare', percent: 0 }))
    store.handleProgressEvent(progressEvent({ taskId: 't-1', phase: 'progress', stage: 'uploading video...', stageKey: 'upload', percent: 20 }))
    const task = store.sessions[0].tasks['t-1']
    expect(task.phase).toBe('progress')
    expect(task.stageKey).toBe('upload')
    expect(task.percent).toBe(20)
    expect(task.startedAt).toBeGreaterThan(0)
  })

  it('blocked 事件的 remainingWait 与 bucket 归因落到被渲染的那份状态（字段缺席不得猜档）', async () => {
    const store = await makeStore()
    store.registerSession({ taskIds: ['t-1'], title: 'x' })
    store.handleProgressEvent(progressEvent({
      taskId: 't-1', phase: 'blocked', stageKey: 'waiting', stage: '⏳ 发布间隔限制', percent: null, remainingWait: 180000, bucket: 'platform',
    }))
    const task = store.sessions[0].tasks['t-1']
    expect(task.phase).toBe('blocked')
    expect(task.remainingWait).toBe(180000)
    expect(task.bucket).toBe('platform')

    // 账号档与平台档必须在界面上可区分；归因缺席时如实为 null
    store.handleProgressEvent(progressEvent({ taskId: 't-1', phase: 'blocked', stageKey: 'waiting', remainingWait: 60000, bucket: 'account' }))
    expect(task.bucket).toBe('account')
    // 归因缺席 → null（未知 taskId 会自成孤儿会话，故按 taskId 跨会话定位）
    store.handleProgressEvent(progressEvent({ taskId: 't-2', phase: 'blocked', stageKey: 'waiting', remainingWait: 60000 }))
    const t2 = store.sessions.flatMap((s) => Object.values(s.tasks)).find((x) => x.taskId === 't-2')
    expect(t2).toBeTruthy()
    expect(t2.bucket).toBe(null)
  })

  it('终态吸收：success 后迟到的 progress 不回退状态', async () => {
    const store = await makeStore()
    store.registerSession({ taskIds: ['t-1'], title: 'x' })
    store.handleProgressEvent(progressEvent({ taskId: 't-1', phase: 'success', stage: '✓ 发布成功', stageKey: 'done', percent: 100, result: { url: 'u' } }))
    store.handleProgressEvent(progressEvent({ taskId: 't-1', phase: 'progress', stage: 'verifying...', stageKey: 'verify', percent: 95 }))
    const task = store.sessions[0].tasks['t-1']
    expect(task.phase).toBe('success')
    expect(task.endedAt).toBeGreaterThan(0)
  })

  it('会话内全部任务终态 → session done + aggregate 汇总', async () => {
    const store = await makeStore()
    store.registerSession({ taskIds: ['t-1', 't-2'], title: 'x' })
    store.handleProgressEvent(progressEvent({ taskId: 't-1', platform: 'weibo', phase: 'success', stage: '✓ 发布成功', stageKey: 'done' }))
    expect(store.sessions[0].status).toBe('running')
    store.handleProgressEvent(progressEvent({ taskId: 't-2', platform: 'zhihu', phase: 'failed', stage: '✗ 发布失败: 超时', stageKey: 'failed', error: '超时' }))
    expect(store.sessions[0].status).toBe('done')
    expect(store.aggregate).toMatchObject({ total: 2, done: 2, succeeded: 1, failed: 1 })
  })

  it('未知 taskId + 已登记 batchId → 事件归入批量会话并动态建任务', async () => {
    const store = await makeStore()
    store.registerSession({ batchId: 'batch-1', title: '批量' })
    store.handleProgressEvent(progressEvent({ taskId: 'bt-9', batchId: 'batch-1', platform: 'kuaishou' }))
    expect(store.sessions[0].tasks['bt-9']).toBeTruthy()
    expect(store.sessions[0].tasks['bt-9'].platform).toBe('kuaishou')
  })

  it('未知 taskId 且无归属 → 自动创建孤儿会话收纳（R3）', async () => {
    const store = await makeStore()
    store.handleProgressEvent(progressEvent({ taskId: 'orphan-1', platform: 'weibo' }))
    expect(store.sessions).toHaveLength(1)
    expect(store.sessions[0].tasks['orphan-1']).toBeTruthy()
    expect(store.sessions[0].batchId).toBe(null)
  })

  it('非法事件（缺 taskId/platform）丢弃不建会话（R9）', async () => {
    const store = await makeStore()
    store.handleProgressEvent({ platform: 'weibo', stage: 'x' })
    store.handleProgressEvent({ taskId: 't', stage: 'x' })
    store.handleProgressEvent(null)
    expect(store.sessions).toHaveLength(0)
  })

  it('非法 phase/stageKey 归一（progress/detail），非法 percent 归 null', async () => {
    const store = await makeStore()
    store.registerSession({ taskIds: ['t-1'], title: 'x' })
    store.handleProgressEvent(progressEvent({ taskId: 't-1', phase: 'bogus', stageKey: 'bogus', percent: 999 }))
    const task = store.sessions[0].tasks['t-1']
    expect(task.phase).toBe('progress')
    expect(task.stageKey).toBe('detail')
    expect(task.percent).toBe(null)
  })

  it('retryFailed：逐任务调 queue:retry 并以新 taskId 替换、会话回 running', async () => {
    const store = await makeStore()
    store.registerSession({ taskIds: ['t-1', 't-2'], title: 'x' })
    store.handleProgressEvent(progressEvent({ taskId: 't-1', phase: 'success', stageKey: 'done' }))
    store.handleProgressEvent(progressEvent({ taskId: 't-2', platform: 'zhihu', phase: 'failed', stageKey: 'failed', error: 'x' }))
    expect(store.sessions[0].status).toBe('done')

    mockRetryTask.mockResolvedValueOnce({ code: 0, data: { taskId: 't-2-new', retryOf: 't-2' } })
    const result = await store.retryFailed(store.sessions[0].id)

    expect(mockRetryTask).toHaveBeenCalledWith('t-2')
    expect(result).toMatchObject({ ok: 1, fail: 0 })
    const session = store.sessions[0]
    expect(session.status).toBe('running')
    expect(session.tasks['t-2']).toBeUndefined()
    expect(session.tasks['t-2-new'].phase).toBe('queued')
  })

  it('retryFailed：IPC 失败的任务保持 failed 并计入 fail', async () => {
    const store = await makeStore()
    store.registerSession({ taskIds: ['t-1'], title: 'x' })
    store.handleProgressEvent(progressEvent({ taskId: 't-1', phase: 'failed', stageKey: 'failed', error: 'x' }))
    mockRetryTask.mockResolvedValueOnce({ code: -1, message: '任务不存在或状态不可重试' })
    const result = await store.retryFailed(store.sessions[0].id)
    expect(result).toMatchObject({ ok: 0, fail: 1 })
    expect(store.sessions[0].tasks['t-1'].phase).toBe('failed')
  })

  it('minimize/expand 切换；consumeFirstHideToast 首次 true 并持久化（仅一次）', async () => {
    const store = await makeStore()
    store.registerSession({ taskIds: ['t-1'], title: 'x' })
    store.minimizePanel()
    expect(store.panelMinimized).toBe(true)
    expect(store.panelVisible).toBe(false)
    expect(store.consumeFirstHideToast()).toBe(true)
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe('1')
    expect(store.consumeFirstHideToast()).toBe(false)

    store.expandPanel()
    expect(store.panelVisible).toBe(true)
    expect(store.panelMinimized).toBe(false)
  })

  it('init() 从 localStorage 恢复首次提示标志', async () => {
    window.localStorage.setItem(STORAGE_KEY, '1')
    const store = await makeStore()
    store.init()
    expect(store.consumeFirstHideToast()).toBe(false)
  })

  it('init() 经 queue:status 领养孤儿任务建恢复会话（R2，状态级映射）', async () => {
    mockGetQueueStatus.mockResolvedValueOnce({
      code: 0,
      data: {
        running: [{ id: 'q-1', platform: 'douyin', status: 'running' }],
        queue: [{ id: 'q-2', platform: 'weibo', status: 'pending' }],
      },
    })
    const store = await makeStore()
    await store.init()
    expect(store.sessions).toHaveLength(1)
    expect(store.sessions[0].tasks['q-1'].phase).toBe('progress')
    expect(store.sessions[0].tasks['q-2'].phase).toBe('queued')
  })

  it('queue:status IPC 失败 → 领养降级跳过，订阅不受影响（R7）', async () => {
    mockGetQueueStatus.mockRejectedValueOnce(new Error('ipc down'))
    const store = await makeStore()
    await expect(store.init()).resolves.toBeUndefined()
    expect(mockOnProgress).toHaveBeenCalledTimes(1)
    expect(store.sessions).toHaveLength(0)
  })

  it('会话上限 5：超出裁剪最旧已完成会话；全 running 不裁剪（R12）', async () => {
    const store = await makeStore()
    for (let i = 0; i < 6; i++) {
      store.registerSession({ taskIds: ['t-' + i], title: 's' + i })
      store.handleProgressEvent(progressEvent({ taskId: 't-' + i, phase: 'success', stageKey: 'done' }))
    }
    expect(store.sessions).toHaveLength(5)
    expect(store.sessions[0].title).toBe('s1') // s0 被裁剪
    // 全 running：不裁剪
    for (let i = 0; i < 7; i++) {
      store.registerSession({ taskIds: ['r-' + i], title: 'run' + i })
    }
    expect(store.sessions.length).toBeGreaterThan(5)
  })

  it('handleBatchEvent(batch-complete) 对应会话兜底终态（不覆盖已有任务终态）', async () => {
    const store = await makeStore()
    store.registerSession({ batchId: 'b-1', title: 'x' })
    store.handleProgressEvent(progressEvent({ taskId: 'bt-1', batchId: 'b-1', phase: 'success', stageKey: 'done' }))
    store.handleBatchEvent({ batchId: 'b-1', kind: 'batch-complete', total: 2, succeeded: 1, failed: 1 })
    expect(store.sessions[0].status).toBe('done')
    expect(store.sessions[0].tasks['bt-1'].phase).toBe('success')
  })

  it('dismissSession 移除会话；clearFinished 清除全部已完成', async () => {
    const store = await makeStore()
    store.registerSession({ taskIds: ['t-1'], title: 'a' })
    store.registerSession({ taskIds: ['t-2'], title: 'b' })
    store.handleProgressEvent(progressEvent({ taskId: 't-1', phase: 'success', stageKey: 'done' }))
    store.clearFinished()
    expect(store.sessions).toHaveLength(1)
    expect(store.sessions[0].title).toBe('b')
    store.dismissSession(store.sessions[0].id)
    expect(store.sessions).toHaveLength(0)
  })
})

describe('publishProgress store — cancelled 相位与取消/单任务重试（publish-progress-panel-refine）', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    mockOnProgress.mockReset()
    mockOnBatchProgress.mockReset()
    mockGetQueueStatus.mockReset()
    mockRetryTask.mockReset()
    mockCancelTask.mockReset()
    mockOnProgress.mockReturnValue(() => {})
    mockOnBatchProgress.mockReturnValue(() => {})
    mockGetQueueStatus.mockResolvedValue({ code: 0, data: { running: [], queue: [] } })
    mockCancelTask.mockResolvedValue({ code: 0, data: true })
    mockRetryTask.mockResolvedValue({ code: 0, data: { taskId: 't-new', retryOf: 't-old' } })
    window.localStorage.clear()
  })

  async function makeStore() {
    const { usePublishProgressStore } = await import('./publishProgress')
    return usePublishProgressStore()
  }

  it('cancelled 事件：任务转 cancelled 终态、计入 aggregate.cancelled、会话可 done', async () => {
    const store = await makeStore()
    store.registerSession({ taskIds: ['t-1', 't-2'], title: 'x' })
    store.handleProgressEvent(progressEvent({ taskId: 't-1', phase: 'cancelled', stage: '⊘ 已取消', stageKey: 'detail', percent: null }))
    expect(store.sessions[0].tasks['t-1'].phase).toBe('cancelled')
    expect(store.sessions[0].status).toBe('running')
    store.handleProgressEvent(progressEvent({ taskId: 't-2', phase: 'success', stageKey: 'done' }))
    expect(store.sessions[0].status).toBe('done')
    expect(store.aggregate).toMatchObject({ total: 2, done: 2, succeeded: 1, failed: 0, cancelled: 1 })
    expect(store.hasRunning).toBe(false)
  })

  it('cancelled 是吸收态：迟到 progress 事件不回退（页面级取消后浮窗不再永远进行中）', async () => {
    const store = await makeStore()
    store.registerSession({ taskIds: ['t-1'], title: 'x' })
    // 真实 emitter 对 cancelled 不给默认 percent（defaultPercentForPhase 仅 success/failed=100）
    store.handleProgressEvent(progressEvent({ taskId: 't-1', phase: 'cancelled', stage: '⊘ 已取消', percent: null }))
    store.handleProgressEvent(progressEvent({ taskId: 't-1', phase: 'progress', stage: 'uploading video...', stageKey: 'upload', percent: 60 }))
    const task = store.sessions[0].tasks['t-1']
    expect(task.phase).toBe('cancelled')
    expect(task.percent).toBe(null)
  })

  it('cancelRunning：对全部非终态任务逐个调 queue:cancel，返回 {ok,fail}，终态任务不动', async () => {
    const store = await makeStore()
    store.registerSession({ taskIds: ['t-run', 't-queue', 't-done'], title: 'x' })
    store.handleProgressEvent(progressEvent({ taskId: 't-run', phase: 'progress', stageKey: 'upload' }))
    store.handleProgressEvent(progressEvent({ taskId: 't-done', phase: 'success', stageKey: 'done' }))
    mockCancelTask.mockResolvedValue({ code: 0, data: true })

    const result = await store.cancelRunning()

    expect(mockCancelTask).toHaveBeenCalledTimes(2)
    expect(mockCancelTask).toHaveBeenCalledWith('t-run')
    expect(mockCancelTask).toHaveBeenCalledWith('t-queue')
    expect(result).toMatchObject({ ok: 2, fail: 0 })
  })

  it('cancelRunning：IPC 拒绝的任务计入 fail；无在途任务时 no-op', async () => {
    const store = await makeStore()
    store.registerSession({ taskIds: ['t-1', 't-2'], title: 'x' })
    mockCancelTask.mockImplementation(async (id) => (id === 't-1' ? { code: 0, data: true } : { code: -1, message: 'not found' }))
    const result = await store.cancelRunning()
    expect(result).toMatchObject({ ok: 1, fail: 1 })

    // 全部终态 → no-op
    store.handleProgressEvent(progressEvent({ taskId: 't-1', phase: 'cancelled', stage: '⊘ 已取消' }))
    store.handleProgressEvent(progressEvent({ taskId: 't-2', phase: 'success', stageKey: 'done' }))
    mockCancelTask.mockClear()
    const result2 = await store.cancelRunning()
    expect(mockCancelTask).not.toHaveBeenCalled()
    expect(result2).toMatchObject({ ok: 0, fail: 0 })
  })

  it('cancelRunning 防重入：进行中再次调用直接返回', async () => {
    const store = await makeStore()
    store.registerSession({ taskIds: ['t-1'], title: 'x' })
    let resolveFirst
    mockCancelTask.mockImplementation(() => new Promise((r) => { resolveFirst = r }))
    const first = store.cancelRunning()
    const second = await store.cancelRunning()
    expect(second).toMatchObject({ ok: 0, fail: 0 })
    expect(mockCancelTask).toHaveBeenCalledTimes(1)
    resolveFirst({ code: 0, data: true })
    await expect(first).resolves.toMatchObject({ ok: 1, fail: 0 })
    expect(store.cancelling).toBe(false)
  })

  it('cancelRunning 后任务状态由转发的 cancelled 事件收敛（事件单一来源，不自标记）', async () => {
    const store = await makeStore()
    store.registerSession({ taskIds: ['t-1'], title: 'x' })
    await store.cancelRunning()
    // IPC 返回时任务尚未终态（事件异步到达）——状态更新只认事件
    expect(store.sessions[0].tasks['t-1'].phase).toBe('queued')
    store.handleProgressEvent(progressEvent({ taskId: 't-1', phase: 'cancelled', stage: '⊘ 已取消' }))
    expect(store.sessions[0].tasks['t-1'].phase).toBe('cancelled')
    expect(store.sessions[0].status).toBe('done')
  })

  it('retryOne：单任务重试以新 taskId 替换，其余任务不受影响', async () => {
    const store = await makeStore()
    store.registerSession({ taskIds: ['t-f1', 't-f2'], title: 'x' })
    store.handleProgressEvent(progressEvent({ taskId: 't-f1', phase: 'failed', stageKey: 'failed', error: 'a' }))
    store.handleProgressEvent(progressEvent({ taskId: 't-f2', phase: 'failed', stageKey: 'failed', error: 'b' }))
    mockRetryTask.mockResolvedValueOnce({ code: 0, data: { taskId: 't-f1-new', retryOf: 't-f1' } })

    const result = await store.retryOne(store.sessions[0].id, 't-f1')

    expect(mockRetryTask).toHaveBeenCalledTimes(1)
    expect(mockRetryTask).toHaveBeenCalledWith('t-f1')
    expect(result).toMatchObject({ ok: 1, fail: 0 })
    const session = store.sessions[0]
    expect(session.tasks['t-f1']).toBeUndefined()
    expect(session.tasks['t-f1-new'].phase).toBe('queued')
    expect(session.tasks['t-f2'].phase).toBe('failed') // 未被波及
    expect(session.status).toBe('running')
  })

  it('retryOne：非 failed 任务/不存在会话 no-op；与 retryFailed 共享防重入', async () => {
    const store = await makeStore()
    store.registerSession({ taskIds: ['t-1'], title: 'x' })
    store.handleProgressEvent(progressEvent({ taskId: 't-1', phase: 'success', stageKey: 'done' }))
    const result = await store.retryOne(store.sessions[0].id, 't-1')
    expect(result).toMatchObject({ ok: 0, fail: 0 })
    expect(mockRetryTask).not.toHaveBeenCalled()
    const result2 = await store.retryOne('no-such-session', 't-1')
    expect(result2).toMatchObject({ ok: 0, fail: 0 })
  })
})

// 2026-10 抖音发布实锤（Bug A）：主进程在 publish:batch 处理器内同步 add() 并立即
// send 进度事件 ⇒ 渲染端 handleProgressEvent 先于 registerSession 到达。旧实现无条件
// _createSession ⇒ 同一 taskId 分属两个会话：孤儿会话吃掉全部事件，登记会话的任务
// 永远 'queued'（幽灵任务）⇒ 面板两个会话、聚合「成功 1/2」、永不结束。
describe('publishProgress store — registerSession 收养/合并（publish-progress-dup-upload）', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    mockOnProgress.mockReset()
    mockOnBatchProgress.mockReset()
    mockGetQueueStatus.mockReset()
    mockRetryTask.mockReset()
    mockCancelTask.mockReset()
    mockOnProgress.mockReturnValue(() => {})
    mockOnBatchProgress.mockReturnValue(() => {})
    mockGetQueueStatus.mockResolvedValue({ code: 0, data: { running: [], queue: [] } })
    mockCancelTask.mockResolvedValue({ code: 0, data: true })
    window.localStorage.clear()
  })

  async function makeStore() {
    const { usePublishProgressStore } = await import('./publishProgress')
    return usePublishProgressStore()
  }

  it('事件先到（孤儿会话）→ registerSession 收养同一会话，不产生第二个会话', async () => {
    const store = await makeStore()
    store.handleProgressEvent(progressEvent({ taskId: 't-1', phase: 'progress', stage: 'uploading video...', stageKey: 'upload', percent: 20 }))
    expect(store.sessions).toHaveLength(1)
    expect(store.sessions[0].title).toBe('')

    const session = store.registerSession({ taskIds: ['t-1'], title: '总有些想不到的' })

    expect(store.sessions).toHaveLength(1)
    expect(session.id).toBe(store.sessions[0].id)
    expect(session.title).toBe('总有些想不到的')
    // 相位保留：不被 _ensureTask 重置为 queued（幽灵任务的直接成因）
    expect(session.tasks['t-1'].phase).toBe('progress')
    expect(session.tasks['t-1'].percent).toBe(20)
    expect(store.aggregate).toMatchObject({ total: 1 })
    expect(store.panelVisible).toBe(true)
    expect(store.panelMinimized).toBe(false)
  })

  it('登记任务多于孤儿任务 → 补齐缺失 taskId，两个任务同属一个会话', async () => {
    const store = await makeStore()
    store.handleProgressEvent(progressEvent({ taskId: 't-1', phase: 'progress', percent: 20 }))

    const session = store.registerSession({ taskIds: ['t-1', 't-2'], title: 'X' })

    expect(store.sessions).toHaveLength(1)
    expect(Object.keys(session.tasks).sort()).toEqual(['t-1', 't-2'])
    expect(session.tasks['t-1'].phase).toBe('progress')
    expect(session.tasks['t-2'].phase).toBe('queued')
    // 后续事件仍路由到同一会话（幽灵任务不再出现）
    store.handleProgressEvent(progressEvent({ taskId: 't-1', phase: 'success', stageKey: 'done' }))
    store.handleProgressEvent(progressEvent({ taskId: 't-2', platform: 'weibo', phase: 'success', stageKey: 'done' }))
    expect(store.sessions).toHaveLength(1)
    expect(store.sessions[0].status).toBe('done')
    expect(store.aggregate).toMatchObject({ total: 2, succeeded: 2 })
  })

  it('同一 ids 两次 registerSession → 仍 1 个会话（不复制）', async () => {
    const store = await makeStore()
    const first = store.registerSession({ taskIds: ['t-1', 't-2'], title: 'A' })
    const second = store.registerSession({ taskIds: ['t-1', 't-2'], title: 'B' })
    expect(store.sessions).toHaveLength(1)
    expect(second.id).toBe(first.id)
    expect(second.id).toBe(store.sessions[0].id)
    // 已有标题不被后来者覆盖
    expect(store.sessions[0].title).toBe('A')
  })

  it('batchId 命中已有会话 → 收养而非新建', async () => {
    const store = await makeStore()
    const first = store.registerSession({ batchId: 'batch-1', title: '批量' })
    const second = store.registerSession({ batchId: 'batch-1', title: '批量2' })
    expect(store.sessions).toHaveLength(1)
    expect(second.id).toBe(first.id)
    expect(store.sessions[0].title).toBe('批量')
  })

  it('taskId 落在多个孤儿会话 → 合并为一个会话', async () => {
    const store = await makeStore()
    store.handleProgressEvent(progressEvent({ taskId: 't-1', platform: 'douyin', phase: 'progress', percent: 10 }))
    store.handleProgressEvent(progressEvent({ taskId: 't-2', platform: 'weibo', phase: 'progress', percent: 30 }))
    expect(store.sessions).toHaveLength(2)

    const session = store.registerSession({ taskIds: ['t-1', 't-2'], title: '合并' })

    expect(store.sessions).toHaveLength(1)
    expect(Object.keys(session.tasks).sort()).toEqual(['t-1', 't-2'])
    expect(session.tasks['t-1'].percent).toBe(10)
    expect(session.tasks['t-2'].percent).toBe(30)
    expect(session.title).toBe('合并')
  })

  it('收养恢复会话（init 领养）→ 清除 recovered 标记并补齐标题', async () => {
    mockGetQueueStatus.mockResolvedValueOnce({
      code: 0,
      data: { running: [{ id: 'q-1', platform: 'douyin', status: 'running' }], queue: [] },
    })
    const store = await makeStore()
    await store.init()
    expect(store.sessions[0].recovered).toBe(true)

    store.registerSession({ taskIds: ['q-1'], title: '恢复后标题' })

    expect(store.sessions).toHaveLength(1)
    expect(store.sessions[0].recovered).toBeUndefined()
    expect(store.sessions[0].title).toBe('恢复后标题')
    expect(store.sessions[0].tasks['q-1'].phase).toBe('progress')
  })

  it('无命中时行为不变：新建会话并保持排队相位', async () => {
    const store = await makeStore()
    const session = store.registerSession({ taskIds: ['t-9'], title: '全新' })
    expect(store.sessions).toHaveLength(1)
    expect(session.tasks['t-9'].phase).toBe('queued')
    expect(session.title).toBe('全新')
  })
})
