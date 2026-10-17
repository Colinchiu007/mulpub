// @ts-check
/**
 * Electron IPC/preload 合同测试
 *
 * 覆盖 preload 暴露面、主进程注册、来源校验、参数边界和错误 envelope。
 * 这些测试只验证跨模块合同，不复制业务实现。
 *
 * @vitest-environment node
 */
const fs = require('node:fs')
const path = require('node:path')

const electronRoot = path.resolve(__dirname, '..')
const preloadRoot = path.join(electronRoot, 'preload')
// esbuild 会把聚合 preload 中的 ipcRenderer 重命名为 ipcRenderer2；两种名称都必须受合同检查保护。
const IPC_INVOKE_PATTERN = /ipcRenderer\d*\.invoke\(\s*['"]([^'"]+)['"]/g

function walkJsFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const filePath = path.join(dir, entry.name)
    if (entry.isDirectory()) return walkJsFiles(filePath)
    return entry.name.endsWith('.js') ? [filePath] : []
  })
}

function collectChannels(files, pattern) {
  const channels = new Set()
  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8')
    for (const match of source.matchAll(pattern)) channels.add(match[1])
  }
  return channels
}

function makeManager() {
  return {
    setMainWindow: vi.fn(),
    setGetMainWin: vi.fn(),
    registerIpcHandlers: vi.fn(),
    _onWindowResize: vi.fn(),
    resize: vi.fn(),
  }
}

describe('preload 与主进程 IPC 合同', () => {
  it('每个 preload invoke 通道都应有主进程 handler，代表性参数应可结构化克隆', () => {
    const preloadChannels = collectChannels(
      walkJsFiles(preloadRoot),
      IPC_INVOKE_PATTERN,
    )
    const bundleChannels = collectChannels(
      [path.join(preloadRoot, 'index.bundle.js')],
      IPC_INVOKE_PATTERN,
    )
    const productionFiles = walkJsFiles(electronRoot).filter((file) => !file.endsWith('.test.js'))
    const handlerChannels = collectChannels(
      productionFiles,
      /(?:ipcMain|ipc)\.handle\(\s*['"]([^'"]+)['"]/g,
    )

    expect(preloadChannels.size).toBeGreaterThan(200)
    expect([...preloadChannels].filter((channel) => !handlerChannels.has(channel))).toEqual([])
    expect([...bundleChannels]).toEqual(expect.arrayContaining(['draftSave', 'draftList', 'draftDelete']))

    const ipcRenderer = {
      invoke: vi.fn((_channel, ...args) => structuredClone(args)),
      on: vi.fn(),
      removeListener: vi.fn(),
    }
    const api = {
      ...require('../preload/publish').createPublishApi(ipcRenderer),
      ...require('../preload/account').createAccountApi(ipcRenderer),
      ...require('../preload/system').createSystemApi(ipcRenderer),
    }
    expect(() => api.publishBatch(['wechat'], { title: '合同测试', content: { blocks: [] } })).not.toThrow()
    expect(() => api.accountCheckLogin('wechat', 'account-1')).not.toThrow()
    expect(() => api.modelProviderUpdate('provider-1', { headers: { Authorization: 'test' } })).not.toThrow()
  })

  it('preload 聚合入口和 IPC 注册中心的本地 require 路径都应可解析', () => {
    const entryFiles = [
      path.join(preloadRoot, 'index.js'),
      path.join(electronRoot, 'ipc-handlers', 'index.js'),
    ]

    for (const entryFile of entryFiles) {
      const source = fs.readFileSync(entryFile, 'utf8')
      const requests = [...source.matchAll(/require\(\s*['"](\.\.?\/[^'"]+)['"]\s*\)/g)]
        .map((match) => match[1])
      expect(requests.length).toBeGreaterThan(0)
      for (const request of requests) {
        expect(() => require.resolve(path.resolve(path.dirname(entryFile), request))).not.toThrow()
      }
    }
  })
})

describe('IPC 启动注册合同', () => {
  it('创建主窗口时应一次性注册全部服务型 IPC provider', () => {
    __enableElectronMock()
    __resetElectronMock()
    delete require.cache[require.resolve('../window.js')]
    const { createWindow } = require('../window.js')
    const providerNames = [
      'webviewManager', 'qrCodeLogin', 'oauthManager', 'batchManager',
      'urlCollector', // 回归锁定：35ae6224 误删后 url-collect:fetch 无 handler
      'providerManager', 'viralEngine', 'commentManager', 'contentIntelligence',
      'publishImpactTracker',
    ]
    const context = {
      authViewManager: makeManager(),
      rpaViewManager: makeManager(),
      systemTray: { init: vi.fn() },
      hotkeys: { register: vi.fn() },
      autoUpdater: { init: vi.fn() },
      firstRun: { runSetup: vi.fn() },
    }
    for (const name of providerNames) context[name] = makeManager()

    createWindow(context)

    for (const name of providerNames) {
      expect(context[name].registerIpcHandlers, name).toHaveBeenCalledTimes(1)
    }
  })
})

describe('IPC 来源与错误合同', () => {
  it('生产模式下 withSenderCheck 应拒绝外部网页 sender', async () => {
    const previousNodeEnv = process.env.NODE_ENV
    const previousVitest = process.env.VITEST
    const previousGlobalVitest = global.__VITEST__
    try {
      process.env.NODE_ENV = 'production'
      delete process.env.VITEST
      delete global.__VITEST__
      delete require.cache[require.resolve('../ipc-handlers/helpers')]
      const { withSenderCheck, EC } = require('../ipc-handlers/helpers')
      const inner = vi.fn(() => ({ code: 0 }))
      const result = await withSenderCheck(inner)(
        { senderFrame: { url: 'https://evil.example/' } },
        { id: 'sensitive-operation' },
      )

      expect(result).toEqual({ code: EC.AUTH_ERROR, message: '未授权的调用来源' })
      expect(inner).not.toHaveBeenCalled()
    } finally {
      if (previousNodeEnv === undefined) delete process.env.NODE_ENV
      else process.env.NODE_ENV = previousNodeEnv
      if (previousVitest === undefined) delete process.env.VITEST
      else process.env.VITEST = previousVitest
      global.__VITEST__ = previousGlobalVitest
      delete require.cache[require.resolve('../ipc-handlers/helpers')]
    }
  })

  it('敏感词 handler 对缺失参数和服务异常应返回统一错误 envelope', async () => {
    const handlers = {}
    const filter = {
      check: vi.fn(),
      replace: vi.fn(() => { throw new Error('词库不可用') }),
    }
    require('../ipc-handlers/sensitive')(
      { handle: (channel, handler) => { handlers[channel] = handler } },
      { _sensitiveFilter: filter },
    )

    await expect(handlers['sensitive:check']({}, undefined)).resolves.toEqual({
      code: -2,
      message: '缺少参数对象',
    })
    expect(filter.check).not.toHaveBeenCalled()
    await expect(handlers['sensitive:replace']({}, { text: '测试' })).resolves.toEqual({
      code: -1,
      message: '词库不可用',
    })
  })
})
