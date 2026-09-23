import { describe, it, expect, vi, beforeAll } from 'vitest'

let registerHandlers
const TRUSTED_EVENT = { senderFrame: { url: 'app://localhost/index.html' } }

beforeAll(async () => {
  const mod = await import('./cache')
  registerHandlers = mod.default || mod
})

function createMockIpcMain () {
  const handlers = {}
  return {
    handle: vi.fn((channel, fn) => { handlers[channel] = fn }),
    _getHandler: (channel) => handlers[channel],
    _callHandler: async (channel, ...args) => {
      if (!handlers[channel]) throw new Error(`No handler for ${channel}`)
      return handlers[channel](TRUSTED_EVENT, ...args)
    },
  }
}

describe('cache IPC handlers', () => {
  let ipcMain
  let mockLog
  let mockCacheService

  beforeEach(() => {
    ipcMain = createMockIpcMain()
    mockLog = { info: vi.fn(), error: vi.fn() }
    // 注入 mock，绝不触碰真实 os.tmpdir() 缓存目录
    mockCacheService = { getCacheStats: vi.fn(), clearCache: vi.fn() }
    registerHandlers(ipcMain, { log: mockLog, cacheService: mockCacheService })
  })

  it('注册 cache:stats 与 cache:clear 通道', () => {
    expect(ipcMain.handle).toHaveBeenCalledWith('cache:stats', expect.any(Function))
    expect(ipcMain.handle).toHaveBeenCalledWith('cache:clear', expect.any(Function))
  })

  it('cache:stats 返回 getCacheStats() 结果', async () => {
    const data = { totalBytes: 100, fileCount: 2, items: [] }
    mockCacheService.getCacheStats.mockReturnValue(data)
    const result = await ipcMain._callHandler('cache:stats')
    expect(result).toEqual({ code: 0, data })
  })

  it('cache:clear 调用 clearCache 并记录日志', async () => {
    const data = { freedBytes: 340, removedFiles: 2, removedDirs: 1, items: [] }
    mockCacheService.clearCache.mockReturnValue(data)
    const result = await ipcMain._callHandler('cache:clear')
    expect(result).toEqual({ code: 0, data })
    expect(mockCacheService.clearCache).toHaveBeenCalledTimes(1)
    expect(mockLog.info).toHaveBeenCalledWith('Cache', '用户手动清理缓存', { freedBytes: 340, removedFiles: 2, removedDirs: 1 })
  })

  it('cache:stats 抛错时返回 REQUEST_ERROR', async () => {
    mockCacheService.getCacheStats.mockImplementation(() => { throw new Error('boom') })
    const result = await ipcMain._callHandler('cache:stats')
    expect(result.code).not.toBe(0)
    expect(result.message).toBe('boom')
  })
})
