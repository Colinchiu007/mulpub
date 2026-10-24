import { describe, expect, it, vi } from 'vitest'

import registerHiflyExtraHandlers, { CHANNEL_METHODS } from './hifly-extra'

/**
 * 飞影 11 个扩展端点的 IPC 层测试（change: hifly-full-api-ui）。
 *
 * IPC 层只负责三件事，测试也只锁这三件：
 *  1. 11 个通道都注册；
 *  2. 形状不对即在本地拒（不把脏参数送进主进程深处）；
 *  3. 上游 adapter 方法未实现时 fail-closed 回 HIFLY_EXTRA_UNSUPPORTED。
 *
 * 业务范围校验（size ≤ 200、model ∈ {0,5,6} 等）在 adapter 层，已由
 * hifly-extra.test.js / hifly-create-modes.test.js 锁，这里不重复。
 */

function createIpcMain () {
  const handlers = new Map()
  return {
    handle: vi.fn((channel, handler) => handlers.set(channel, handler)),
    handlers,
  }
}

function validEvent () {
  return { sender: { id: 1 }, senderFrame: { url: 'app://localhost/' } }
}

function createManager (overrides = {}) {
  return {
    callAdapter: vi.fn(async () => ({ code: 0, data: { left: 1582 } })),
    supportsAdapterMethod: vi.fn(async () => true),
    ...overrides,
  }
}

function setup (manager = createManager()) {
  const ipcMain = createIpcMain()
  registerHiflyExtraHandlers(ipcMain, { modelProviderManager: manager })
  return { ipcMain, manager }
}

describe('hifly-extra IPC — 11 个飞影扩展通道', () => {
  it('11 个通道全部注册，名字与 adapter 方法一一对应', () => {
    const { ipcMain } = setup()
    const channels = [...ipcMain.handlers.keys()]
    expect(channels).toHaveLength(11)
    for (const channel of Object.keys(CHANNEL_METHODS)) {
      expect(channels).toContain(channel)
    }
  })

  it('credit 通道无参也能调，返回余额', async () => {
    const { ipcMain } = setup()
    const res = await ipcMain.handlers.get('hifly-extra:credit')(validEvent(), {})
    expect(res.code).toBe(0)
    expect(res.data.left).toBe(1582)
  })

  // 关键：上游 adapter 方法只有 hifly-full-api 合并后才存在。
  // 未实现时必须 fail-closed，UI 据此隐藏入口（而不是让用户点到必然失败的按钮）。
  it('adapter 不支持该方法 ⇒ HIFLY_EXTRA_UNSUPPORTED，且不调 callAdapter', async () => {
    const manager = createManager({ supportsAdapterMethod: vi.fn(async () => false) })
    const { ipcMain } = setup(manager)
    const res = await ipcMain.handlers.get('hifly-extra:credit')(validEvent(), {})
    expect(res.message).toBe('HIFLY_EXTRA_UNSUPPORTED')
    expect(manager.callAdapter).not.toHaveBeenCalled()
  })

  it('未知字段 ⇒ 拒绝（不静默丢掉前端拼错的参数）', async () => {
    const { ipcMain, manager } = setup()
    const res = await ipcMain.handlers.get('hifly-extra:lively-templates')(validEvent(), {
      page: 1,
      unexpectedField: 'x',
    })
    expect(res.message).toBe('HIFLY_EXTRA_INVALID_ARGUMENTS')
    expect(manager.callAdapter).not.toHaveBeenCalled()
  })

  it('create-by-audio：audio_url/file_id 二选一缺失 ⇒ 拒绝', async () => {
    const { ipcMain, manager } = setup()
    const res = await ipcMain.handlers.get('hifly-extra:create-by-audio')(validEvent(), {
      avatar: 'av-1',
    })
    expect(res.message).toBe('HIFLY_EXTRA_INVALID_ARGUMENTS')
    expect(manager.callAdapter).not.toHaveBeenCalled()
  })

  it('create-cover：template 必填且 content/slots 至少一项 ⇒ 缺则拒', async () => {
    const { ipcMain, manager } = setup()
    const h = ipcMain.handlers.get('hifly-extra:create-cover')
    expect((await h(validEvent(), { content: 'x' })).message).toBe('HIFLY_EXTRA_INVALID_ARGUMENTS')
    expect((await h(validEvent(), { template: 't' })).message).toBe('HIFLY_EXTRA_INVALID_ARGUMENTS')
    expect(manager.callAdapter).not.toHaveBeenCalled()
  })

  it('text 超 10000 字 ⇒ 拒绝（形状层拦，不进 adapter）', async () => {
    const { ipcMain, manager } = setup()
    const res = await ipcMain.handlers.get('hifly-extra:audio-tts')(validEvent(), {
      voice: 'v',
      text: '一'.repeat(10001),
    })
    expect(res.message).toBe('HIFLY_EXTRA_INVALID_ARGUMENTS')
    expect(manager.callAdapter).not.toHaveBeenCalled()
  })

  it('adapter 业务失败 ⇒ 原文透出服务端 message', async () => {
    const manager = createManager({
      callAdapter: vi.fn(async () => ({ code: 11, message: '该任务不支持删除' })),
    })
    const { ipcMain } = setup(manager)
    const res = await ipcMain.handlers.get('hifly-extra:delete-work')(validEvent(), {
      taskId: 'sing-task',
    })
    expect(res.code).not.toBe(0)
    expect(res.message).toContain('该任务不支持删除')
  })

  it('callAdapter 抛错 ⇒ 统一信封，不让异常穿过 IPC', async () => {
    const manager = createManager({
      callAdapter: vi.fn(async () => { throw new Error('网络断了') }),
    })
    const { ipcMain } = setup(manager)
    const res = await ipcMain.handlers.get('hifly-extra:credit')(validEvent(), {})
    expect(res.code).not.toBe(0)
    expect(res.message).toContain('网络断了')
  })
})
