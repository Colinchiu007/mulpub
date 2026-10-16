// @ts-check
/**
 * Publish IPC handlers 合同测试
 *
 * 验证所有发布、队列和历史入口的 sender 来源校验（withSenderCheck）。
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
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

// 本地封面兜底：cover:generate-ai 的两例通过 **依赖注入** 传 localCoverGenerator 替身
// （见 handler 的 deps.localCoverGenerator），因此测试完全不加载 sharp 原生模块。
// 动机（2026-09-30 CI 实证）：真实 sharp 首载在高负载 runner 上 >30s，即使显式 30s 超时仍被打穿
// （Run 36599422044 / 36610213345 Shards 2/2），且 vi.mock('sharp') 在分片模式下不生效。
// 本地渲染的真实性（PNG 尺寸/比例/折行/边界）由 local-cover-generator.test.js 覆盖。

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
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), notify: vi.fn() },
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

    // 依赖注入 localCoverGenerator 替身：两例毫秒级完成，不触碰 sharp
    it('assetGenerator 未注入时回退本地封面生成（2026-09-29 图文发布兜底）', async () => {
      const generateLocalCover = vi.fn(async () => ({ code: 0, data: { path: 'C:/tmp/multi-publish-cover-local/cover-probe.png' } }))
      const deps = createMockDeps({ localCoverGenerator: { generateLocalCover } })
      const ipcMain = createMockIpcMain()
      registerHandlers(ipcMain, deps)
      const handler = ipcMain._get('cover:generate-ai')

      const result = await handler(TRUSTED_EVENT, { prompt: 'city night', ratio: '3:4' })

      // 无 AI 生图 provider 时不再报「服务不可用」，而是本地标题卡兜底成功
      expect(result.code).toBe(0)
      expect(result.data.coverPath).toBe('C:/tmp/multi-publish-cover-local/cover-probe.png')
      // 兜底被真实调用且带上标题与比例（ratio 白名单内原样透传）
      expect(generateLocalCover).toHaveBeenCalledWith('city night', expect.objectContaining({ ratio: '3:4' }))
    })

    it('assetGenerator 生成失败时也回退本地封面（不因 AI 失败阻断发布链路）', async () => {
      const generateLocalCover = vi.fn(async () => ({ code: 0, data: { path: 'C:/tmp/multi-publish-cover-local/cover-probe2.png' } }))
      const assetGenerator = {
        generateImage: vi.fn(async () => ({ code: -1, message: '上游生图失败' })),
      }
      const deps = createMockDeps({ assetGenerator, localCoverGenerator: { generateLocalCover } })
      const ipcMain = createMockIpcMain()
      registerHandlers(ipcMain, deps)
      const handler = ipcMain._get('cover:generate-ai')

      const result = await handler(TRUSTED_EVENT, { prompt: 'city night' })

      expect(result.code).toBe(0)
      expect(result.data.coverPath).toBe('C:/tmp/multi-publish-cover-local/cover-probe2.png')
      expect(assetGenerator.generateImage).toHaveBeenCalled()
      expect(generateLocalCover).toHaveBeenCalled()
    })

    // 2026-10-09 快手图文 tofu 修复：ffmpeg drawtext 占位图（degraded:true）在 Windows 打包环境
    // 无 CJK 字形，中文字符全部渲染为方块（实锤证据 D:\Temp\story2video\assets\default\img_9400.png，
    // 标题「白应苍临刑前称随口1个资金盘就20亿」仅 ASCII「1」「20」可读）。占位图绝不能作为
    // 「AI 封面」成功返回——必须视为 AI 生成失败，走本地标题卡兜底（sharp/Pango 正确渲染 CJK）。
    it('degraded 占位图（ffmpeg-placeholder）不得当成功返回，必须回退本地封面', async () => {
      const generateLocalCover = vi.fn(async () => ({ code: 0, data: { path: 'C:/tmp/multi-publish-cover-local/cover-degraded-probe.png' } }))
      const assetGenerator = {
        generateImage: vi.fn(async () => ({
          code: 0,
          data: { path: 'C:/tmp/story2video/assets/default/img_9400.png', source: 'ffmpeg-placeholder', degraded: true },
        })),
      }
      const deps = createMockDeps({ assetGenerator, localCoverGenerator: { generateLocalCover } })
      const ipcMain = createMockIpcMain()
      registerHandlers(ipcMain, deps)
      const handler = ipcMain._get('cover:generate-ai')

      const result = await handler(TRUSTED_EVENT, { prompt: '白应苍临刑前称随口1个资金盘就20亿', ratio: '3:4' })

      // 不再把 tofu 占位图当 AI 封面返回
      expect(result.code).toBe(0)
      expect(result.data.coverPath).toBe('C:/tmp/multi-publish-cover-local/cover-degraded-probe.png')
      expect(result.data.coverPath).not.toContain('img_9400')
      expect(result.data.source).toBe('local-fallback')
      // 占位图判定为失败后真实走了兜底
      expect(assetGenerator.generateImage).toHaveBeenCalled()
      expect(generateLocalCover).toHaveBeenCalled()
    })

    // 2026-10-06 内容感知封面：兜底必须拿到文章标题与正文，否则封面与内容无关
    it('兜底分支把文章标题与正文透传给本地封面生成器', async () => {
      const generateLocalCover = vi.fn(async () => ({
        code: 0,
        data: {
          path: 'C:/tmp/multi-publish-cover-local/cover-probe3.png',
          theme: 'tech',
          themeLabel: '科技',
          keywords: ['AI', '大模型'],
        },
      }))
      const ipcMain = createMockIpcMain()
      registerHandlers(ipcMain, createMockDeps({ localCoverGenerator: { generateLocalCover } }))
      const handler = ipcMain._get('cover:generate-ai')

      const result = await handler(TRUSTED_EVENT, {
        prompt: '科技感封面',
        title: '大模型推理成本暴跌',
        content: '人工智能算力降价',
      })

      expect(result.code).toBe(0)
      // 标题优先取文章标题（内容本身），而不是用户手输的 prompt
      expect(generateLocalCover).toHaveBeenCalledWith(
        '大模型推理成本暴跌',
        expect.objectContaining({ content: '人工智能算力降价' })
      )
      // 回传来源与主题，渲染端据此给差异化提示
      expect(result.data.source).toBe('local-fallback')
      expect(result.data.theme).toBe('tech')
      expect(result.data.themeLabel).toBe('科技')
      expect(result.data.keywords).toEqual(['AI', '大模型'])
    })

    it('未传文章标题时退回用 prompt 作封面标题（向后兼容）', async () => {
      const generateLocalCover = vi.fn(async () => ({ code: 0, data: { path: 'C:/tmp/x.png' } }))
      const ipcMain = createMockIpcMain()
      registerHandlers(ipcMain, createMockDeps({ localCoverGenerator: { generateLocalCover } }))
      const handler = ipcMain._get('cover:generate-ai')

      await handler(TRUSTED_EVENT, { prompt: 'city night' })

      expect(generateLocalCover).toHaveBeenCalledWith('city night', expect.objectContaining({ content: '' }))
    })

    it('AI 生图成功时回传 source=ai（渲染端据此区分提示文案）', async () => {
      const assetGenerator = {
        generateImage: vi.fn(async () => ({ code: 0, data: { path: 'C:/tmp/multi-publish-cover-ai/img_1.png' } })),
      }
      const ipcMain = createMockIpcMain()
      registerHandlers(ipcMain, createMockDeps({ assetGenerator }))
      const handler = ipcMain._get('cover:generate-ai')

      const result = await handler(TRUSTED_EVENT, { prompt: 'city night' })

      expect(result.code).toBe(0)
      expect(result.data.source).toBe('ai')
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
    expect(deps.taskQueue.add).toHaveBeenCalledWith(expect.objectContaining({
      platform: 'douyin',
      article: { title: '视频标题', accountId: 'dy-1' },
      accountId: 'dy-1',
    }))
    // 2026-10-15：一次 publish:batch 的 N 个任务必须共享同一个非空 batchId
    // （历史记录按平台各写一行，「同批 N 个平台」的关联只能靠它）
    const batchId = deps.taskQueue.add.mock.calls[0][0].batchId
    expect(typeof batchId).toBe('string')
    expect(batchId.length).toBeGreaterThan(0)
  })

  it('publish:batch 多目标共享同一 batchId（同批关联键），且逐次调用不重复', async () => {
    const deps = createMockDeps()
    const ipcMain = createMockIpcMain()
    registerHandlers(ipcMain, deps)
    const handler = ipcMain._get('publish:batch')

    await handler(TRUSTED_EVENT, {
      platforms: [{ platform: 'douyin', accountId: 'dy-1' }, { platform: 'zhihu', accountId: 'zh-1' }],
      article: { title: '多平台标题' },
    })

    const calls = deps.taskQueue.add.mock.calls.map(call => call[0])
    expect(calls).toHaveLength(2)
    expect(calls[0].batchId).toBe(calls[1].batchId)
    expect(calls[0].batchId).toMatch(/^batch_/)

    deps.taskQueue.add.mockClear()
    await handler(TRUSTED_EVENT, {
      platforms: [{ platform: 'douyin', accountId: 'dy-1' }],
      article: { title: '第二次发布' },
    })
    expect(deps.taskQueue.add.mock.calls[0][0].batchId).not.toBe(calls[0].batchId)
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

// ── publish-frequency-policy-v2：策略读取 / 覆盖写入 / 紧急放行 ────────────────
describe('publishFreq IPC（策略与紧急放行）', () => {

  // publish-frequency-policy-v2：publishFreq:* handler 已按行数门禁要求外移到独立模块，
  // 故本组用例必须同时注册两个模块 —— 只注册 publish.js 会得到「handler 不存在」的假红。
  const registerFreq = (ipcMain, deps) => {
    registerHandlers(ipcMain, deps)
    require('./publish-frequency')(ipcMain, deps)
  }
  const EC = require('../core/error-codes').ERROR

  function policyGuard (overrides = {}) {
    return {
      _intervals: vi.fn((p) => ({ accountMinMs: 1000, platformMinMs: 500, accountDailyMax: 3, tier: 'clip' })),
      jitterRatio: 0.4,
      releaseGraceMs: 60000,
      setJitterRatio: vi.fn(() => true),
      setReleaseGraceMs: vi.fn(() => true),
      ...overrides,
    }
  }

  function makeDeps (overrides = {}) {
    return createMockDeps({
      publishIntervalGuard: policyGuard(),
      publishEmergencyRelease: {
        check: vi.fn(() => ({ allowed: true, code: null, used: 0, max: 1, dayKey: '2026-10-10' })),
        record: vi.fn(() => ({ at: 1, operator: 'unknown', audited: true })),
        getStatus: vi.fn(() => ({ dayKey: '2026-10-10', max: 1, cooldownMs: 600000, retryAfterMs: 0, perAccount: {} })),
      },
      store: { getSettingObject: vi.fn(() => null), setSetting: vi.fn() },
      ...overrides,
    })
  }

  it('emergencyRelease 拒绝外部网页调用（与其余写通道同闸）', async () => {
    const ipcMain = createMockIpcMain()
    registerFreq(ipcMain, makeDeps())
    const result = await ipcMain._get('publishFreq:emergencyRelease')(UNTRUSTED_EVENT, { platform: 'douyin', accountId: 'a' })
    expect(result).toEqual({ code: -3, message: '未授权的调用来源' })
  })

  it('emergencyRelease 校验 platform / accountId 格式（防注入进 key 与审计）', async () => {
    const ipcMain = createMockIpcMain()
    const deps = makeDeps()
    registerFreq(ipcMain, deps)
    const handler = ipcMain._get('publishFreq:emergencyRelease')

    expect(await handler(TRUSTED_EVENT, { platform: 'dou/../yin', accountId: 'a' }))
      .toMatchObject({ code: EC.VALIDATION_ERROR })
    expect(await handler(TRUSTED_EVENT, { platform: 'douyin', accountId: 'a b' }))
      .toMatchObject({ code: EC.VALIDATION_ERROR })
    expect(deps.publishEmergencyRelease.check).not.toHaveBeenCalled()
  })

  it('emergencyRelease：服务未初始化时如实回报，不静默成功', async () => {
    const ipcMain = createMockIpcMain()
    registerFreq(ipcMain, makeDeps({ publishEmergencyRelease: null }))
    const result = await ipcMain._get('publishFreq:emergencyRelease')(TRUSTED_EVENT, { platform: 'douyin' })
    expect(result).toMatchObject({ code: EC.REQUEST_ERROR })
  })

  it('emergencyRelease：策略闸未过 ⇒ 四态如实回报（released:false + 原因），不是错误码', async () => {
    const ipcMain = createMockIpcMain()
    const deps = makeDeps()
    deps.publishEmergencyRelease.check = vi.fn(() => ({
      allowed: false, code: 'exhausted', used: 1, max: 1, dayKey: '2026-10-10',
    }))
    registerFreq(ipcMain, deps)

    const result = await ipcMain._get('publishFreq:emergencyRelease')(TRUSTED_EVENT, { platform: 'douyin', accountId: 'a' })
    expect(result).toEqual({
      code: 0,
      data: { released: false, reason: 'exhausted', used: 1, max: 1, retryAfterMs: 0 },
    })
    // 未过闸时**不得**调用机制层，也不得记账
    expect(deps.taskQueue.emergencyRelease).toBeUndefined()
    expect(deps.publishEmergencyRelease.record).not.toHaveBeenCalled()
  })

  it('emergencyRelease：冷却中回报 retryAfterMs', async () => {
    const ipcMain = createMockIpcMain()
    const deps = makeDeps()
    deps.publishEmergencyRelease.check = vi.fn(() => ({
      allowed: false, code: 'cooldown', used: 0, max: 1, retryAfterMs: 12345, dayKey: '2026-10-10',
    }))
    registerFreq(ipcMain, deps)
    const result = await ipcMain._get('publishFreq:emergencyRelease')(TRUSTED_EVENT, { platform: 'douyin' })
    expect(result.data).toMatchObject({ released: false, reason: 'cooldown', retryAfterMs: 12345 })
  })

  it('emergencyRelease：没有等待中的窗口 ⇒ released:false + no_waiting_window（不得谎报成功）', async () => {
    const ipcMain = createMockIpcMain()
    const deps = makeDeps()
    deps.taskQueue.emergencyRelease = vi.fn(() => ({ ok: false, code: 'no_waiting_window' }))
    registerFreq(ipcMain, deps)

    const result = await ipcMain._get('publishFreq:emergencyRelease')(TRUSTED_EVENT, { platform: 'douyin', accountId: 'a' })
    expect(result.data).toMatchObject({ released: false, reason: 'no_waiting_window' })
    expect(deps.publishEmergencyRelease.record).not.toHaveBeenCalled()
  })

  it('emergencyRelease 成功：记账 + 广播 + 回报已用次数', async () => {
    const ipcMain = createMockIpcMain()
    const sent = []
    const deps = makeDeps({
      BrowserWindow: { getAllWindows: () => [{ isDestroyed: () => false, webContents: { send: (ch, p) => sent.push({ ch, p }) } }] },
    })
    deps.taskQueue.emergencyRelease = vi.fn(() => ({ ok: true, taskId: 't-9', clearedKeys: ['douyin:*', 'douyin:a'] }))
    registerFreq(ipcMain, deps)

    const result = await ipcMain._get('publishFreq:emergencyRelease')(TRUSTED_EVENT, { platform: 'douyin', accountId: 'a', reason: '客户催稿' })
    expect(result.code).toBe(0)
    expect(result.data).toMatchObject({ released: true, taskId: 't-9', used: 1, max: 1 })
    expect(deps.publishEmergencyRelease.record).toHaveBeenCalledWith('douyin', 'a', expect.objectContaining({ result: 'ok', reason: '客户催稿' }))
    expect(sent).toHaveLength(1)
    expect(sent[0].ch).toBe('publish:emergencyReleased')
    // 渲染层自报的 operator 不得被采用（operator 由主进程解析）
    expect(deps.taskQueue.emergencyRelease.mock.calls[0][2]).not.toHaveProperty('operator')
  })

  it('setPolicy：非法配置整体拒绝且**不写库**（半生效态不可解释）', async () => {
    const ipcMain = createMockIpcMain()
    const deps = makeDeps()
    registerFreq(ipcMain, deps)

    const result = await ipcMain._get('publishFreq:setPolicy')(TRUSTED_EVENT, { policy: { accountMinMs: -5 } })
    expect(result).toMatchObject({ code: EC.VALIDATION_ERROR })
    expect(deps.store.setSetting).not.toHaveBeenCalled()
    expect(deps.publishIntervalGuard.setJitterRatio).not.toHaveBeenCalled()
  })

  it('setPolicy：合法配置写库并下发抖动/退避（间隔与日配额是每次现取，无需下发）', async () => {
    const ipcMain = createMockIpcMain()
    const deps = makeDeps()
    registerFreq(ipcMain, deps)

    const policy = { accountMinMs: 30000, jitterRatio: 0.2, releaseGraceMs: 30000 }
    const result = await ipcMain._get('publishFreq:setPolicy')(TRUSTED_EVENT, { policy })
    expect(result.code).toBe(0)
    expect(result.data.saved).toBe(true)
    expect(deps.store.setSetting).toHaveBeenCalledWith('publishFrequencyPolicy', expect.objectContaining({ accountMinMs: 30000 }))
    expect(deps.publishIntervalGuard.setJitterRatio).toHaveBeenCalledWith(0.2)
    expect(deps.publishIntervalGuard.setReleaseGraceMs).toHaveBeenCalledWith(30000)
  })

  it('setPolicy：null ⇒ 清空覆盖（写库为 null），不是校验错误', async () => {
    const ipcMain = createMockIpcMain()
    const deps = makeDeps()
    registerFreq(ipcMain, deps)
    const result = await ipcMain._get('publishFreq:setPolicy')(TRUSTED_EVENT, { policy: null })
    expect(result.code).toBe(0)
    expect(deps.store.setSetting).toHaveBeenCalledWith('publishFrequencyPolicy', null)
  })

  it('getPolicy：逐平台回报档位 + 抖动/退避 + 覆盖原文', async () => {
    const ipcMain = createMockIpcMain()
    const deps = makeDeps()
    registerFreq(ipcMain, deps)
    const result = await ipcMain._get('publishFreq:getPolicy')(TRUSTED_EVENT)
    expect(result.code).toBe(0)
    expect(Object.keys(result.data.platforms).length).toBeGreaterThanOrEqual(15)
    expect(result.data.jitterRatio).toBe(0.4)
    expect(result.data.releaseGraceMs).toBe(60000)
  })

  it('getPolicy 必须把**合法域上界**一并下发（渲染层不得自己抄一份数字）', async () => {
    // 此前设置页把 `:max="999"`（日配额）与 `:max="10080"`（分钟）硬编码在模板里，
    // 而主进程侧 env 与设置页覆盖**没有**对应上界 ⇒ UI 与真实合法域各说各话：
    // 用户从 UI 填不进去的值可以用 env 填进去，env 填错也没人告诉他界在哪。
    // 上界的唯一真源是策略模块（change: publish-frequency-unwired-surfaces），
    // 这里断言的是"下发值 == 真源值"，不是某个具体数字（数字改了这条不该跟着改）。
    const policyModule = require('@multi-publish/shared-utils/src/publish-frequency-policy')
    const ipcMain = createMockIpcMain()
    registerFreq(ipcMain, makeDeps({}))
    const result = await ipcMain._get('publishFreq:getPolicy')(TRUSTED_EVENT)
    expect(result.code).toBe(0)
    expect(result.data.dailyMaxUpperBound).toBe(policyModule.MAX_DAILY_QUOTA)
    expect(result.data.intervalMaxMinutes).toBe(policyModule.MAX_INTERVAL_MS / 60000)
    // 下发值必须是**可用**的界（否则输入框永远填不进合法值）
    expect(result.data.dailyMaxUpperBound).toBeGreaterThan(500)
    expect(result.data.intervalMaxMinutes).toBeGreaterThan(1000)
  })

  it('守卫未初始化时 getPolicy/setPolicy 如实回报，不抛', async () => {
    const ipcMain = createMockIpcMain()
    registerFreq(ipcMain, makeDeps({ publishIntervalGuard: null }))
    expect(await ipcMain._get('publishFreq:getPolicy')(TRUSTED_EVENT)).toMatchObject({ code: EC.REQUEST_ERROR })
    expect(await ipcMain._get('publishFreq:setPolicy')(TRUSTED_EVENT, { policy: {} })).toMatchObject({ code: EC.REQUEST_ERROR })
  })
})
