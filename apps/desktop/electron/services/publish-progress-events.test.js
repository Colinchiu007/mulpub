// @vitest-environment node
/**
 * publish-progress-events.test.js — 发布进度事件富化层（emitter + 任务归属路由）
 *
 * 契约（PRD-PUBLISH-PROGRESS-UX-2026-09-28 §5.1/§6.1）：
 * - emit 组装完整 payload：既有字段（platform/taskId/stage）保留 + 新增
 *   phase/stageKey/percent/batchId/timestamp；stageKey 由映射表计算。
 * - 守卫：win 空/已销毁跳过；taskId/platform 非法跳过不抛错；percent 非法归 null。
 * - createTaskProgressRouter：platform→taskId 登记/注销（stale 注销不误删新映射）、
 *   last-write-wins、未知平台返回 undefined。
 * - P0-2 可观测性：关键相位（start/success/failed/cancelled）落
 *   logger.notify('PublishProgress','phase-<x>',{...})；progress/retry/blocked 心跳不落 notify。
 */
const {
  createPublishProgressEmitter,
  createTaskProgressRouter,
} = require('./publish-progress-events')

// 录制真实 logger.notify（repo 约定：不 mock logger，使用真实模块 + spyOn）。
const realLogger = require('../services/logger')
let notifySpy

function findPhaseNotify(phase) {
  return notifySpy.mock.calls.find((c) => c[0] === 'PublishProgress' && c[1] === 'phase-' + phase)
}
function allPhaseKeys() {
  return notifySpy.mock.calls.filter((c) => c[0] === 'PublishProgress').map((c) => c[1])
}

function makeWin() {
  return { isDestroyed: () => false, webContents: { send: vi.fn() } }
}

describe('createPublishProgressEmitter — payload 契约', () => {
  it('progress 事件：既有字段保留 + 富化字段齐全，stageKey 由映射表计算', () => {
    const win = makeWin()
    const emitter = createPublishProgressEmitter({ getMainWin: () => win })
    emitter.emit('task-1', 'douyin', 'progress', { stage: 'uploading video...', percent: 20, batchId: 'batch-9' })
    expect(win.webContents.send).toHaveBeenCalledTimes(1)
    const [channel, payload] = win.webContents.send.mock.calls[0]
    expect(channel).toBe('publish:progress')
    expect(payload).toEqual(expect.objectContaining({
      platform: 'douyin',
      taskId: 'task-1',
      stage: 'uploading video...',
      phase: 'progress',
      stageKey: 'upload',
      percent: 20,
      batchId: 'batch-9',
    }))
    expect(typeof payload.timestamp).toBe('number')
    expect(payload.timestamp).toBeGreaterThan(0)
  })

  it('start 事件：准备发布映射 prepare、percent 0', () => {
    const win = makeWin()
    const emitter = createPublishProgressEmitter({ getMainWin: () => win })
    emitter.emit('task-2', 'zhihu', 'start', { stage: '准备发布...' })
    const payload = win.webContents.send.mock.calls[0][1]
    expect(payload).toEqual(expect.objectContaining({
      phase: 'start', stageKey: 'prepare', percent: 0, stage: '准备发布...',
    }))
  })

  it('success 事件透传 result 且 percent 100、stageKey done', () => {
    const win = makeWin()
    const emitter = createPublishProgressEmitter({ getMainWin: () => win })
    emitter.emit('task-3', 'bilibili', 'success', { stage: '✓ 发布成功', result: { url: 'https://x' } })
    const payload = win.webContents.send.mock.calls[0][1]
    expect(payload).toEqual(expect.objectContaining({
      phase: 'success', stageKey: 'done', percent: 100, result: { url: 'https://x' },
    }))
  })

  it('failed 事件透传 error；blocked 透传 remainingWait；retry 透传 retriesLeft', () => {
    const win = makeWin()
    const emitter = createPublishProgressEmitter({ getMainWin: () => win })
    emitter.emit('t-f', 'toutiao', 'failed', { stage: '✗ 发布失败: 超时', error: '超时' })
    emitter.emit('t-b', 'toutiao', 'blocked', { stage: '⏳ 发布间隔限制，等待 3 分钟后重试', remainingWait: 180000 })
    emitter.emit('t-r', 'toutiao', 'retry', { stage: '⟳ 重试中... (剩余 1 次)', retriesLeft: 1 })
    const [pF, pB, pR] = win.webContents.send.mock.calls.map((c) => c[1])
    expect(pF).toEqual(expect.objectContaining({ phase: 'failed', stageKey: 'failed', percent: 100, error: '超时' }))
    expect(pB).toEqual(expect.objectContaining({ phase: 'blocked', stageKey: 'waiting', remainingWait: 180000 }))
    expect(pR).toEqual(expect.objectContaining({ phase: 'retry', stageKey: 'waiting', retriesLeft: 1 }))
  })

  it('batchId 缺省为 null；percent 非法（NaN/越界）归 null', () => {
    const win = makeWin()
    const emitter = createPublishProgressEmitter({ getMainWin: () => win })
    emitter.emit('t-n', 'weibo', 'progress', { stage: 'navigating...' })
    expect(win.webContents.send.mock.calls[0][1].batchId).toBe(null)
    emitter.emit('t-x', 'weibo', 'progress', { stage: 'navigating...', percent: NaN })
    expect(win.webContents.send.mock.calls[1][1].percent).toBe(null)
    emitter.emit('t-y', 'weibo', 'progress', { stage: 'navigating...', percent: 150 })
    expect(win.webContents.send.mock.calls[2][1].percent).toBe(null)
    emitter.emit('t-z', 'weibo', 'progress', { stage: 'navigating...', percent: -5 })
    expect(win.webContents.send.mock.calls[3][1].percent).toBe(null)
  })

  it('cancelled 事件：相位原样透传（不被归一为 progress），percent 缺省 null（publish-progress-panel-refine）', () => {
    const win = makeWin()
    const emitter = createPublishProgressEmitter({ getMainWin: () => win })
    emitter.emit('t-c', 'weibo', 'cancelled', { stage: '⊘ 已取消' })
    const payload = win.webContents.send.mock.calls[0][1]
    expect(payload).toEqual(expect.objectContaining({
      phase: 'cancelled', stage: '⊘ 已取消', percent: null,
    }))
  })

  it('非法 phase 归一为 progress（防御纵深）', () => {
    const win = makeWin()
    const emitter = createPublishProgressEmitter({ getMainWin: () => win })
    emitter.emit('t-p', 'weibo', 'bogus-phase', { stage: 'navigating...' })
    expect(win.webContents.send.mock.calls[0][1].phase).toBe('progress')
  })
})

describe('createPublishProgressEmitter — 守卫', () => {
  it('getMainWin 返回 null → 跳过发送不抛错', () => {
    const emitter = createPublishProgressEmitter({ getMainWin: () => null })
    expect(() => emitter.emit('t', 'weibo', 'progress', { stage: 'navigating...' })).not.toThrow()
  })

  it('窗口已销毁 → 跳过发送', () => {
    const win = { isDestroyed: () => true, webContents: { send: vi.fn() } }
    const emitter = createPublishProgressEmitter({ getMainWin: () => win })
    emitter.emit('t', 'weibo', 'progress', { stage: 'navigating...' })
    expect(win.webContents.send).not.toHaveBeenCalled()
  })

  it.each([
    [null, 'weibo'],
    ['', 'weibo'],
    [123, 'weibo'],
    ['t-ok', null],
    ['t-ok', ''],
    ['t-ok', 42],
  ])('taskId=%j platform=%j 非法 → 跳过发送不抛错', (taskId, platform) => {
    const win = makeWin()
    const emitter = createPublishProgressEmitter({ getMainWin: () => win })
    expect(() => emitter.emit(taskId, platform, 'progress', { stage: 'navigating...' })).not.toThrow()
    expect(win.webContents.send).not.toHaveBeenCalled()
  })
})

describe('createTaskProgressRouter — platform→taskId 归属路由', () => {
  it('登记后可解析；未登记平台返回 undefined', () => {
    const router = createTaskProgressRouter()
    router.register('douyin', 'task-a')
    expect(router.resolve('douyin')).toBe('task-a')
    expect(router.resolve('kuaishou')).toBeUndefined()
  })

  it('同平台重登记 last-write-wins（并发近似归属，见 PRD §14）', () => {
    const router = createTaskProgressRouter()
    router.register('douyin', 'task-a')
    router.register('douyin', 'task-b')
    expect(router.resolve('douyin')).toBe('task-b')
  })

  it('stale 注销不误删新映射（旧任务 finally 不清掉接任者）', () => {
    const router = createTaskProgressRouter()
    router.register('douyin', 'task-a')
    router.register('douyin', 'task-b')
    router.unregister('douyin', 'task-a') // 旧任务先结束
    expect(router.resolve('douyin')).toBe('task-b')
    router.unregister('douyin', 'task-b')
    expect(router.resolve('douyin')).toBeUndefined()
  })

  it('未登记平台的注销是 no-op', () => {
    const router = createTaskProgressRouter()
    expect(() => router.unregister('weibo', 't-x')).not.toThrow()
  })
})

describe('createPublishProgressEmitter — 关键相位 notify 可观测性（P0-2）', () => {
  beforeEach(() => {
    notifySpy = vi.spyOn(realLogger, 'notify').mockImplementation(() => {})
  })
  afterEach(() => {
    notifySpy.mockRestore()
  })

  it('start 相位落 phase-start notify（含 platform/taskId/stageKey/percent=0）', () => {
    const win = makeWin()
    const emitter = createPublishProgressEmitter({ getMainWin: () => win })
    emitter.emit('task-2', 'zhihu', 'start', { stage: '准备发布...' })
    const call = findPhaseNotify('start')
    expect(call, 'phase-start 应被记录').toBeTruthy()
    expect(call[2].level).toBe('INFO')
    expect(call[2].params).toMatchObject({ platform: 'zhihu', taskId: 'task-2', stageKey: 'prepare', percent: 0 })
  })

  it('success 相位落 phase-success notify（INFO，含 hasResult）', () => {
    const win = makeWin()
    const emitter = createPublishProgressEmitter({ getMainWin: () => win })
    emitter.emit('task-3', 'bilibili', 'success', { stage: '✓ 发布成功', result: { url: 'https://x' } })
    const call = findPhaseNotify('success')
    expect(call, 'phase-success 应被记录').toBeTruthy()
    expect(call[2].level).toBe('INFO')
    expect(call[2].params).toMatchObject({ platform: 'bilibili', taskId: 'task-3', stageKey: 'done', percent: 100 })
    expect(call[2].params.hasResult).toBe(true)
  })

  it('failed 相位落 phase-failed notify（ERROR，携带归一后的 error）', () => {
    const win = makeWin()
    const emitter = createPublishProgressEmitter({ getMainWin: () => win })
    emitter.emit('t-f', 'toutiao', 'failed', { stage: '✗ 发布失败: 超时', error: '超时' })
    const call = findPhaseNotify('failed')
    expect(call, 'phase-failed 应被记录').toBeTruthy()
    expect(call[2].level).toBe('ERROR')
    expect(call[2].errorCategory).toBe('publish_phase_failed')
    expect(call[2].params).toMatchObject({ platform: 'toutiao', taskId: 't-f', stageKey: 'failed', percent: 100 })
    expect(call[2].params.error).toBe('超时')
  })

  it('cancelled 相位落 phase-cancelled notify（中性 INFO 终态，非 failed）', () => {
    const win = makeWin()
    const emitter = createPublishProgressEmitter({ getMainWin: () => win })
    emitter.emit('t-c', 'weibo', 'cancelled', { stage: '⊘ 已取消' })
    const call = findPhaseNotify('cancelled')
    expect(call, 'phase-cancelled 应被记录').toBeTruthy()
    expect(call[2].level).toBe('INFO')
    expect(call[2].errorCategory).toBeUndefined()
    expect(call[2].params).toMatchObject({ platform: 'weibo', taskId: 't-c', percent: null })
  })

  it('progress 心跳不落 notify（防日志风暴）', () => {
    const win = makeWin()
    const emitter = createPublishProgressEmitter({ getMainWin: () => win })
    emitter.emit('task-1', 'douyin', 'progress', { stage: 'uploading video...', percent: 20, batchId: 'batch-9' })
    expect(allPhaseKeys().filter((k) => k === 'phase-progress')).toHaveLength(0)
  })

  it('retry / blocked 心跳不落 notify', () => {
    const win = makeWin()
    const emitter = createPublishProgressEmitter({ getMainWin: () => win })
    emitter.emit('t-r', 'toutiao', 'retry', { stage: '⟳ 重试中...', retriesLeft: 1 })
    emitter.emit('t-b', 'toutiao', 'blocked', { stage: '⏳ 等待', remainingWait: 180000 })
    expect(allPhaseKeys().filter((k) => k === 'phase-retry' || k === 'phase-blocked')).toHaveLength(0)
  })

  it('getMainWin 返回 null 时不抛错且不落 notify', () => {
    const emitter = createPublishProgressEmitter({ getMainWin: () => null })
    expect(() => emitter.emit('t', 'weibo', 'success', { stage: '✓ 发布成功' })).not.toThrow()
    expect(allPhaseKeys()).toHaveLength(0)
  })

  it('一次成功发布仅落 start+success 两条相位 notify（不重复/不漏）', () => {
    const win = makeWin()
    const emitter = createPublishProgressEmitter({ getMainWin: () => win })
    emitter.emit('task-2', 'zhihu', 'start', { stage: '准备发布...' })
    emitter.emit('task-3', 'bilibili', 'success', { stage: '✓ 发布成功', result: { url: 'https://x' } })
    expect(allPhaseKeys().sort()).toEqual(['phase-start', 'phase-success'])
  })
})
