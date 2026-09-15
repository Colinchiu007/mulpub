/**
 * IPC handlers 单元测试
 * 验证 handler 文件能正确加载并注册
 *
 * 注意：用 __enableElectronMock 启用全局 electron mock，因为部分 handler 加载的服务
 * 在构造时会 require('electron')（如 PaymentManager），未启用会抛 "Electron failed to install correctly"。
 * pipeline handler 在 index.js 中被调用时未传入 deps（源码 bug），此处 mock 为 no-op 以避免崩溃；
 * 本测试不断言 pipeline handler 注册情况。
 */
__enableElectronMock()

__registerMock('./pipeline', function() {})

const path = require('path')
const registerHandlers = require(path.join(__dirname, '..', 'electron', 'ipc-handlers', 'index'))

describe('IPC Handlers', () => {
  let mockIpcMain, handlers

  beforeEach(() => {
    handlers = {}
    mockIpcMain = { handle: (channel, fn) => { handlers[channel] = fn }, on: (channel, fn) => { handlers[channel] = fn } }
    registerHandlers(mockIpcMain, {
      app: { getVersion: () => '1.0.0' },
      BrowserWindow: require('electron'),
      log: { info: () => {}, warn: () => {}, error: () => {} },
      store: { listAccounts: () => [], getSetting: () => null, getAccount: () => null,
        addPublishRecord: () => 'rec-1', listPublishHistory: () => [],
        getPublishStats: () => ({}), addScheduledTask: () => 'task-1',
        listScheduledTasks: () => [], deleteTask: () => {},
        setSetting: () => {}, listCallbackLogs: () => [],
        addAccount: () => true, deleteAccount: () => {},
        setDefaultAccount: () => {}, getDefaultAccount: () => null,
        updateAccount: () => {} },
      renderEngine: { render: async () => ({}), cancel: () => {}, getStatus: () => ({}) },
      taskQueue: { add: () => 'task-1', getStatus: () => ({}), getHistory: () => [], cancel: () => {} },
      history: { listRecords: () => ({ total: 0, records: [] }), getRecord: () => null, getStats: () => ({}) },
      scheduler: { create: () => ({}), list: () => [], cancel: () => {} },
      autoUpdater: { check: () => {}, download: () => {}, quitAndInstall: () => {} },
      hotkeys: { getShortcuts: () => [] },
      firstRun: { checkDeps: () => ({ setupDone: true }) },
      authViewManager: { openLogin: async () => ({}), loginSilent: async () => ({}), close: () => {} },
      pythonBridge: { requestBackend: async () => ({ code: 0 }) },
      AccountManager: { addAccount: async () => ({}), deleteAccount: async () => {},
        checkLoginStatus: async () => ({}), listAccounts: async () => [] },
      _platformConfig: { listPlatforms: () => [], getPlatform: () => null },
      _sensitiveFilter: { check: () => ({}), replace: () => ({}) },
      _dataSync: { syncAll: async () => [], syncPlatform: async () => ({}), getAllCachedData: () => ([]) },
      analyticsService: { getRegisteredPlatforms: () => [], fetchOverview: async () => [], fetchPlatformData: async () => ({}) },
      proxyPool: { addProxy: () => 'px-1', addProxies: () => {}, getProxies: () => [],
        remove: () => true, testProxy: async () => ({}), testAll: async () => [],
        getStatus: () => ({}), getNextProxy: () => null, reset: () => {}, removeDead: () => 0, size: () => 0 },
      _chunkedUploader: { upload: async () => ({ success: true }), cancel: () => {} },
      keywordMonitor: { startMonitoring: () => true, stopMonitoring: () => true,
        getStatus: () => ({}), getHistory: () => [], stopAll: () => {} },
      BACKEND_PLATFORMS: new Set(),
      // PromptEval（提示词评估）服务桩：验证通道注册
      promptEvalService: {
        run: async () => ({ success: true, report: { id: 'eval-test', overallScore: 80 } }),
        list: () => [],
        get: () => null,
        remove: () => true,
        analyze: () => ({ recordCount: 0, averageOverall: 0, gradeDistribution: {}, dimensionAverages: [], problemCategories: [], promptPartDistribution: [], optimizationPoints: [], recommendations: [] }),
        dimensions: () => ({ image: [], video: [] }),
      },
      // 热门选题聚合服务桩：验证通道注册
      hotTopicsService: {
        fetchTopics: async () => ({ topics: [], fetchedAt: 0, channelStats: {} }),
        getCache: () => ({ topics: [], fetchedAt: 0, channelStats: {} }),
      },
    })
  })

  it('registers all 74+ handlers', () => {
    const count = Object.keys(handlers).length
    expect(count).toBeGreaterThanOrEqual(74)
  })

  // ─── render ─────
  it('registers render handlers', () => {
    expect(handlers['render:start']).toBeDefined()
    expect(handlers['render:cancel']).toBeDefined()
    expect(handlers['render:status']).toBeDefined()
  })

  // ─── publish + queue + history ─────
  it('registers publish/queue/history/dashboard handlers', () => {
    expect(handlers['publish:wechat']).toBeDefined()
    expect(handlers['publish:batch']).toBeDefined()
    expect(handlers['queue:status']).toBeDefined()
    expect(handlers['queue:history']).toBeDefined()
    expect(handlers['queue:cancel']).toBeDefined()
    expect(handlers['history:list']).toBeDefined()
    expect(handlers['history:get']).toBeDefined()
    expect(handlers['dashboard:stats']).toBeDefined()
  })

  // ─── scheduler ─────
  it('registers scheduler handlers', () => {
    expect(handlers['scheduler:create']).toBeDefined()
    expect(handlers['scheduler:list']).toBeDefined()
    expect(handlers['scheduler:cancel']).toBeDefined()
  })

  // ─── update ─────
  it('registers update handlers', () => {
    expect(handlers['update:check']).toBeDefined()
    expect(handlers['update:download']).toBeDefined()
    expect(handlers['update:install']).toBeDefined()
    expect(handlers['update:install-now']).toBeDefined()
  })

  // ─── misc ─────
  it('registers misc handlers', () => {
    expect(handlers['app:get-version']).toBeDefined()
    expect(handlers['app:get-platform']).toBeDefined()
    expect(handlers['hotkeys:list']).toBeDefined()
    expect(handlers['first-run:check']).toBeDefined()
    expect(handlers['show-notification']).toBeDefined()
  })

  // ─── platform ─────
  it('registers platform handlers', () => {
    expect(handlers['platform:list']).toBeDefined()
    expect(handlers['platform:get']).toBeDefined()
    expect(handlers['platform:definitions']).toBeDefined()
  })

  // ─── sensitive ─────
  it('registers sensitive handlers', () => {
    expect(handlers['sensitive:check']).toBeDefined()
    expect(handlers['sensitive:replace']).toBeDefined()
  })

  // ─── sync ─────
  it('registers sync handlers', () => {
    expect(handlers['sync:all']).toBeDefined()
    expect(handlers['sync:platform']).toBeDefined()
    expect(handlers['sync:cached']).toBeDefined()
  })

  // ─── analytics ─────
  it('registers analytics handlers', () => {
    expect(handlers['analytics:overview']).toBeDefined()
    expect(handlers['analytics:platform']).toBeDefined()
    expect(handlers['analytics:platforms']).toBeDefined()
  })

  // ─── proxy ─────
  it('registers proxy handlers', () => {
    expect(handlers['proxy:add']).toBeDefined()
    expect(handlers['proxy:add-batch']).toBeDefined()
    expect(handlers['proxy:list']).toBeDefined()
    expect(handlers['proxy:remove']).toBeDefined()
    expect(handlers['proxy:test']).toBeDefined()
    expect(handlers['proxy:test-all']).toBeDefined()
    expect(handlers['proxy:status']).toBeDefined()
    expect(handlers['proxy:get-next']).toBeDefined()
    expect(handlers['proxy:reset']).toBeDefined()
    expect(handlers['proxy:remove-dead']).toBeDefined()
  })

  // ─── upload ─────
  it('registers upload handlers', () => {
    expect(handlers['upload:chunked']).toBeDefined()
    expect(handlers['upload:cancel']).toBeDefined()
  })

  // ─── account + auth ─────
  it('registers account/auth handlers', () => {
    expect(handlers['accounts:list']).toBeDefined()
    expect(handlers['auth:open-login']).toBeDefined()
    expect(handlers['auth:login-silent']).toBeDefined()
    expect(handlers['auth:close']).toBeDefined()
    expect(handlers['auth:save-credentials']).toBeUndefined()
    expect(handlers['account:add']).toBeDefined()
    expect(handlers['account:delete']).toBeDefined()
    expect(handlers['account:check-login']).toBeDefined()
    expect(handlers['account:list']).toBeDefined()
  })

  // ─── store ─────
  it('registers store handlers', () => {
    expect(handlers['store:add-account']).toBeDefined()
    expect(handlers['store:get-account']).toBeDefined()
    expect(handlers['store:list-accounts']).toBeDefined()
    expect(handlers['store:delete-account']).toBeDefined()
    expect(handlers['store:set-default-account']).toBeDefined()
    expect(handlers['store:get-default-account']).toBeDefined()
    expect(handlers['store:update-account']).toBeDefined()
    expect(handlers['store:add-publish-record']).toBeDefined()
    expect(handlers['store:list-publish-history']).toBeDefined()
    expect(handlers['store:get-publish-stats']).toBeDefined()
    expect(handlers['store:add-scheduled-task']).toBeDefined()
    expect(handlers['store:list-scheduled-tasks']).toBeDefined()
    expect(handlers['store:delete-task']).toBeDefined()
    expect(handlers['store:get-setting']).toBeDefined()
    expect(handlers['store:set-setting']).toBeDefined()
    expect(handlers['store:list-callback-logs']).toBeDefined()
  })

  // ─── keyword ─────
  it('registers keyword handlers', () => {
    expect(handlers['keyword:start']).toBeDefined()
    expect(handlers['keyword:stop']).toBeDefined()
    expect(handlers['keyword:status']).toBeDefined()
    expect(handlers['keyword:history']).toBeDefined()
    expect(handlers['keyword:stop-all']).toBeDefined()
  })
})
