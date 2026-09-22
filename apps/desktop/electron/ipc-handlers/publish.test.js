// @ts-check
/**
 * Publish IPC handlers 合同测试
 *
 * 验证所有发布、队列和历史入口的 sender 来源校验（withSenderCheck）。
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createAccessControlledIpcMain } from './license-access-control'

// Mock logger 防止真实日志污染
vi.mock('../services/logger', () => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}))

// Mock offline-manager 避免 publish:wechat 拉起额外依赖
vi.mock('../services/offline-manager', () => ({
  isOffline: vi.fn(() => false),
  addToCache: vi.fn(),
}))

// 启用 electron mock，withSenderCheck 通过 require('electron').app 读取 isPackaged
__enableElectronMock()

let registerHandlers
let originalNodeEnv
let originalIsPackaged

beforeEach(async () => {
  vi.resetModules()
  // 信任 dev localhost:5174 — 模拟未打包开发模式
  originalNodeEnv = process.env.NODE_ENV
  originalIsPackaged = __electronMock.app.isPackaged
  delete process.env.NODE_ENV
  __electronMock.app.isPackaged = false
  const mod = await import('./publish')
  registerHandlers = mod.default || mod
})

afterEach(() => {
  if (originalNodeEnv === undefined) delete process.env.NODE_ENV
  else process.env.NODE_ENV = originalNodeEnv
  __electronMock.app.isPackaged = originalIsPackaged
})

function createMockIpcMain() {
  const handlers = {}
  return {
    handle: vi.fn((channel, fn) => { handlers[channel] = fn }),
    on: vi.fn(),
    _get: (channel) => handlers[channel],
  }
}

function createMockDeps(overrides = {}) {
  return {
    taskQueue: {
      add: vi.fn(() => 'task-1'),
      cancel: vi.fn(() => true),
      retry: vi.fn(() => 'task-retry-1'),
      getStatus: vi.fn(() => ({})),
      getHistory: vi.fn(() => []),
    },
    history: {
      listRecords: vi.fn(() => ({ total: 0, records: [] })),
      getRecord: vi.fn(() => null),
      deleteRecords: vi.fn(() => ({ deleted: 0 })),
      getStats: vi.fn(() => ({})),
    },
    BrowserWindow: { getAllWindows: vi.fn(() => []) },
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    ...overrides,
  }
}

// 不可信来源（外部网页）
const UNTRUSTED_EVENT = { senderFrame: { url: 'https://evil.example/' } }
// 可信来源（dev localhost）
const TRUSTED_EVENT = { senderFrame: { url: 'http://localhost:5174/' } }

describe('publish IPC 写操作 sender 校验', () => {
  it('publish:wechat 拒绝外部网页调用', async () => {
    const ipcMain = createMockIpcMain()
    registerHandlers(ipcMain, createMockDeps())
    const handler = ipcMain._get('publish:wechat')

    const result = await handler(UNTRUSTED_EVENT, { title: 'test' })

    expect(result).toEqual({ code: -3, message: '未授权的调用来源' })
  })

  it('publish:batch 拒绝外部网页调用', async () => {
    const ipcMain = createMockIpcMain()
    registerHandlers(ipcMain, createMockDeps())
    const handler = ipcMain._get('publish:batch')

    const result = await handler(UNTRUSTED_EVENT, { platforms: ['wechat'], article: {} })

    expect(result).toEqual({ code: -3, message: '未授权的调用来源' })
  })

  it('queue:cancel 拒绝外部网页调用', async () => {
    const ipcMain = createMockIpcMain()
    registerHandlers(ipcMain, createMockDeps())
    const handler = ipcMain._get('queue:cancel')

    const result = await handler(UNTRUSTED_EVENT, 'task-1')

    expect(result).toEqual({ code: -3, message: '未授权的调用来源' })
  })

  it('queue:retry 拒绝外部网页调用', async () => {
    const ipcMain = createMockIpcMain()
    registerHandlers(ipcMain, createMockDeps())
    const handler = ipcMain._get('queue:retry')

    const result = await handler(UNTRUSTED_EVENT, 'task-1')

    expect(result).toEqual({ code: -3, message: '未授权的调用来源' })
  })

  it.each([
    ['queue:status', undefined],
    ['queue:history', undefined],
    ['history:list', {}],
    ['history:get', 'history-1'],
    ['history:delete', ['history-1']],
    ['dashboard:stats', undefined],
  ])('%s 拒绝外部网页读取私有发布数据', async (channel, arg) => {
    const deps = createMockDeps()
    const ipcMain = createMockIpcMain()
    registerHandlers(ipcMain, deps)

    const result = await ipcMain._get(channel)(UNTRUSTED_EVENT, arg)

    expect(result).toEqual({ code: -3, message: '未授权的调用来源' })
  })
})

describe('publish IPC 可信来源正常工作', () => {
  it('publish:wechat 可信来源正常入队', async () => {
    const deps = createMockDeps()
    const ipcMain = createMockIpcMain()
    registerHandlers(ipcMain, deps)
    const handler = ipcMain._get('publish:wechat')

    const result = await handler(TRUSTED_EVENT, { title: 'hello' })

    expect(result.code).toBe(0)
    expect(result.data).toEqual({ taskId: 'task-1' })
    expect(deps.taskQueue.add).toHaveBeenCalled()
  })

  // P2-2：AI 封面生成（cover:generate-ai）— 复用 asset-generator 生图引擎
  describe('cover:generate-ai', () => {
    it('拒绝外部网页调用', async () => {
      const ipcMain = createMockIpcMain()
      registerHandlers(ipcMain, createMockDeps())
      const handler = ipcMain._get('cover:generate-ai')

      const result = await handler(UNTRUSTED_EVENT, { prompt: 'city night' })

      expect(result).toEqual({ code: -3, message: '未授权的调用来源' })
    })

    it('可信来源：合法 prompt 调用 assetGenerator 并返回 coverPath', async () => {
      const assetGenerator = {
        generateImage: vi.fn(async () => ({ code: 0, data: { path: 'C:/tmp/multi-publish-cover-ai/img_1.png' } })),
      }
      const deps = createMockDeps({ assetGenerator })
      const ipcMain = createMockIpcMain()
      registerHandlers(ipcMain, deps)
      const handler = ipcMain._get('cover:generate-ai')

      const result = await handler(TRUSTED_EVENT, { prompt: '科技感城市夜景', style: 'cyberpunk', ratio: '9:16' })

      expect(result.code).toBe(0)
      expect(result.data.coverPath).toBe('C:/tmp/multi-publish-cover-ai/img_1.png')
      expect(assetGenerator.generateImage).toHaveBeenCalledWith(
        '科技感城市夜景',
        expect.objectContaining({ style: 'cyberpunk', aspect_ratio: '9:16' }),
      )
    })

    it('空 prompt 与超长 prompt 被校验拒绝', async () => {
      const deps = createMockDeps()
      const ipcMain = createMockIpcMain()
      registerHandlers(ipcMain, deps)
      const handler = ipcMain._get('cover:generate-ai')

      const r1 = await handler(TRUSTED_EVENT, { prompt: '' })
      expect(r1.code).toBe(-2)
      expect(r1.message).toContain('至少')

      const r2 = await handler(TRUSTED_EVENT, { prompt: 'x'.repeat(501) })
      expect(r2.code).toBe(-2)
      expect(r2.message).toContain('500')
    })

    it('assetGenerator 未注入时返回服务不可用', async () => {
      const deps = createMockDeps()
      const ipcMain = createMockIpcMain()
      registerHandlers(ipcMain, deps)
      const handler = ipcMain._get('cover:generate-ai')

      const result = await handler(TRUSTED_EVENT, { prompt: 'city night' })

      expect(result.code).toBe(-1)
      expect(result.message).toContain('不可用')
    })
  })

  // P3-7：合集列表拉取（collection:list）
  describe('collection:list', () => {
    it('拒绝外部网页调用', async () => {
      const ipcMain = createMockIpcMain()
      registerHandlers(ipcMain, createMockDeps())
      const handler = ipcMain._get('collection:list')

      const result = await handler(UNTRUSTED_EVENT, { platform: 'bilibili' })

      expect(result).toEqual({ code: -3, message: '未授权的调用来源' })
    })

    it('非法平台被校验拒绝', async () => {
      const ipcMain = createMockIpcMain()
      registerHandlers(ipcMain, createMockDeps())
      const handler = ipcMain._get('collection:list')

      const r1 = await handler(TRUSTED_EVENT, { platform: 'wechat_mp' })
      expect(r1.code).toBe(-2)
      expect(r1.message).toContain('bilibili')

      const r2 = await handler(TRUSTED_EVENT, {})
      expect(r2.code).toBe(-2)
    })

    it('Cookie 缺失时返回错误', async () => {
      const deps = createMockDeps()
      deps.accountManager = { loadSavedCredentials: vi.fn(() => null) }
      const ipcMain = createMockIpcMain()
      registerHandlers(ipcMain, deps)
      const handler = ipcMain._get('collection:list')

      const result = await handler(TRUSTED_EVENT, { platform: 'bilibili' })

      expect(result.code).toBe(-1)
      expect(result.message).toContain('Cookie')
    })
  })

  it('publish:batch 可信来源正常批量入队', async () => {
    const deps = createMockDeps()
    const ipcMain = createMockIpcMain()
    registerHandlers(ipcMain, deps)
    const handler = ipcMain._get('publish:batch')

    const result = await handler(TRUSTED_EVENT, { platforms: ['wechat', 'douyin'], article: { title: 'x' } })

    expect(result.code).toBe(0)
    expect(deps.taskQueue.add).toHaveBeenCalledTimes(2)
  })

  it('publish:batch 将对象目标的账号写入任务和文章', async () => {
    const deps = createMockDeps()
    const ipcMain = createMockIpcMain()
    registerHandlers(ipcMain, deps)
    const handler = ipcMain._get('publish:batch')

    const result = await handler(TRUSTED_EVENT, {
      platforms: [{ platform: 'douyin', accountId: 'dy-1' }],
      article: { title: '视频标题' },
    })

    expect(result.code).toBe(0)
    expect(deps.taskQueue.add).toHaveBeenCalledWith({
      platform: 'douyin',
      article: { title: '视频标题', accountId: 'dy-1' },
      accountId: 'dy-1',
    })
  })

  // smoke5（2026-09-23）实锤：视频发布要等上传完成（强判定≤7min），队列默认 180s
  // 超时会在上传中途杀任务（"Task timed out after 180000ms"），视频任务需 15min 预算
  it('publish:batch 视频任务传入 30 分钟超时，纯图文任务不传超时', async () => {
    const deps = createMockDeps()
    const ipcMain = createMockIpcMain()
    registerHandlers(ipcMain, deps)
    const handler = ipcMain._get('publish:batch')

    await handler(TRUSTED_EVENT, {
      platforms: [{ platform: 'kuaishou', accountId: 'ks-1' }],
      article: { title: '视频标题', video_path: 'D:/v.mp4' },
    })
    expect(deps.taskQueue.add).toHaveBeenLastCalledWith(expect.objectContaining({ timeout: 1800000 }))

    await handler(TRUSTED_EVENT, {
      platforms: [{ platform: 'zhihu', accountId: 'zh-1' }],
      article: { title: '图文标题' },
    })
    const textCall = deps.taskQueue.add.mock.calls[deps.taskQueue.add.mock.calls.length - 1][0]
    expect(textCall.timeout).toBeUndefined()
  })

  it('publish:batch 拒绝缺少平台或账号的对象目标', async () => {
    const deps = createMockDeps()
    const ipcMain = createMockIpcMain()
    registerHandlers(ipcMain, deps)
    const handler = ipcMain._get('publish:batch')

    expect(await handler(TRUSTED_EVENT, {
      platforms: [{ platform: '', accountId: 'a' }],
      article: {},
    })).toMatchObject({ code: -2 })
    expect(await handler(TRUSTED_EVENT, {
      platforms: [{ platform: 'wechat_mp', accountId: null }],
      article: {},
    })).toMatchObject({ code: -2 })
    expect(deps.taskQueue.add).not.toHaveBeenCalled()
  })

  it('publish:batch 拒绝可能操纵路径的平台和账号标识', async () => {
    const deps = createMockDeps()
    const ipcMain = createMockIpcMain()
    registerHandlers(ipcMain, deps)
    const handler = ipcMain._get('publish:batch')

    expect(await handler(TRUSTED_EVENT, {
      platforms: ['../wechat_mp'],
      article: {},
    })).toMatchObject({ code: -2 })
    expect(await handler(TRUSTED_EVENT, {
      platforms: [{ platform: 'wechat_mp', accountId: 'acc/1' }],
      article: {},
    })).toMatchObject({ code: -2 })
    expect(deps.taskQueue.add).not.toHaveBeenCalled()
  })

  it('queue:cancel 可信来源正常取消', async () => {
    const deps = createMockDeps()
    const ipcMain = createMockIpcMain()
    registerHandlers(ipcMain, deps)
    const handler = ipcMain._get('queue:cancel')

    const result = await handler(TRUSTED_EVENT, 'task-1')

    expect(result).toEqual({ code: 0, data: true, message: '任务已取消' })
    expect(deps.taskQueue.cancel).toHaveBeenCalledWith('task-1')
  })

  it('queue:retry 可信来源返回新任务 ID', async () => {
    const deps = createMockDeps()
    const ipcMain = createMockIpcMain()
    registerHandlers(ipcMain, deps)
    const handler = ipcMain._get('queue:retry')

    const result = await handler(TRUSTED_EVENT, 'task-1')

    expect(result).toEqual({
      code: 0,
      data: { taskId: 'task-retry-1', retryOf: 'task-1' },
      message: '任务已重新加入队列',
    })
    expect(deps.taskQueue.retry).toHaveBeenCalledWith('task-1')
  })

  it('queue:status 可信来源可读取队列状态', async () => {
    const deps = createMockDeps()
    const ipcMain = createMockIpcMain()
    registerHandlers(ipcMain, deps)
    const handler = ipcMain._get('queue:status')

    const result = await handler(TRUSTED_EVENT)

    expect(result.code).toBe(0)
  })
})

describe('publish IPC 历史归属隔离', () => {
  it('身份模式读取历史时只把可信当前 owner 交给历史服务', async () => {
    const history = {
      listRecords: vi.fn(() => ({ total: 1, records: [{ id: 'a-1', owner_subject: 'user-a' }] })),
      getRecord: vi.fn(() => ({ id: 'a-1', owner_subject: 'user-a' })),
      getStats: vi.fn(() => ({ total: 1 })),
    }
    const identityService = { getState: vi.fn(() => ({ status: 'authenticated', user: { sub: 'user-a' } })) }
    const deps = createMockDeps({ history, identityService })
    const ipcMain = createMockIpcMain()
    registerHandlers(ipcMain, deps)

    await expect(ipcMain._get('history:list')(TRUSTED_EVENT, { owner_subject: 'forged-user' }))
      .resolves.toMatchObject({ code: 0 })
    await expect(ipcMain._get('history:get')(TRUSTED_EVENT, 'a-1')).resolves.toMatchObject({ code: 0 })
    await expect(ipcMain._get('dashboard:stats')(TRUSTED_EVENT)).resolves.toMatchObject({ code: 0 })

    expect(history.listRecords).toHaveBeenCalledWith({ owner_subject: 'forged-user' }, 'user-a')
    expect(history.getRecord).toHaveBeenCalledWith('a-1', 'user-a')
    expect(history.getStats).toHaveBeenCalledWith('user-a')
  })

  it('身份服务存在但缺少用户标识时历史读取 fail-closed', async () => {
    const history = createMockDeps().history
    const deps = createMockDeps({
      history,
      identityService: { getState: vi.fn(() => ({ status: 'signed_out', user: null })) },
    })
    const ipcMain = createMockIpcMain()
    registerHandlers(ipcMain, deps)

    await expect(ipcMain._get('history:list')(TRUSTED_EVENT, {})).resolves.toMatchObject({ code: -3 })
    await expect(ipcMain._get('history:get')(TRUSTED_EVENT, 'a-1')).resolves.toMatchObject({ code: -3 })
    await expect(ipcMain._get('dashboard:stats')(TRUSTED_EVENT)).resolves.toMatchObject({ code: -3 })
    expect(history.listRecords).not.toHaveBeenCalled()
    expect(history.getRecord).not.toHaveBeenCalled()
    expect(history.getStats).not.toHaveBeenCalled()
  })

  it('批量删除历史记录使用可信 owner，忽略伪造 owner', async () => {
    const history = createMockDeps().history
    history.deleteRecords.mockReturnValue({ deleted: 1 })
    const identityService = { getState: vi.fn(() => ({ status: 'authenticated', user: { sub: 'user-a' } })) }
    const deps = createMockDeps({ history, identityService })
    const ipcMain = createMockIpcMain()
    registerHandlers(ipcMain, deps)

    const result = await ipcMain._get('history:delete')(TRUSTED_EVENT, {
      ids: ['record-1'],
      owner_subject: 'forged-user',
    })

    expect(result).toMatchObject({ code: 0, data: { deleted: 1 } })
    expect(history.deleteRecords).toHaveBeenCalledWith(['record-1'], 'user-a')
  })

  it('未认证时拒绝删除历史记录', async () => {
    const history = createMockDeps().history
    const deps = createMockDeps({
      history,
      identityService: { getState: vi.fn(() => ({ status: 'signed_out', user: null })) },
    })
    const ipcMain = createMockIpcMain()
    registerHandlers(ipcMain, deps)

    await expect(ipcMain._get('history:delete')(TRUSTED_EVENT, ['record-1']))
      .resolves.toMatchObject({ code: -3 })
    expect(history.deleteRecords).not.toHaveBeenCalled()
  })
})

describe('publish IPC Logto 权益门禁', () => {
  it.each([
    ['publish:wechat', { title: '无权益' }],
    ['publish:batch', { platforms: ['wechat', 'douyin'], article: { title: '无权益' } }],
  ])('%s 无权益时不向队列写入任何任务', async (channel, payload) => {
    __electronMock.app.isPackaged = true
    try {
      const deps = createMockDeps()
      const rawIpcMain = createMockIpcMain()
      const identityService = {
        getState: () => ({ status: 'authenticated' }),
        requireEntitlement: vi.fn(async () => { throw new Error('ENTITLEMENT_REQUIRED') }),
      }
      const controlledIpcMain = createAccessControlledIpcMain(
        rawIpcMain,
        { isPro: () => true },
        { NODE_ENV: 'production' },
        __electronMock.app,
        identityService,
      )
      registerHandlers(controlledIpcMain, deps)

      const result = await rawIpcMain._get(channel)(TRUSTED_EVENT, payload)

      expect(result).toMatchObject({ code: -3 })
      expect(deps.taskQueue.add).not.toHaveBeenCalled()
    } finally { __electronMock.app.isPackaged = false }
  })
})
