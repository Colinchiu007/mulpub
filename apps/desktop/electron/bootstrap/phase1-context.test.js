// phase1-context.test.js — 不 require('vitest')，使用 test-setup.js 注入的全局 describe/it/expect/vi
// Mock logger 以避免副作用
__registerMock('../services/logger', {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  notify: vi.fn(),
})
const log = require('../services/logger')

// Mock 所有 require 的模块单例（避免触发真实 side effects）
__registerMock('../services/config-resolver', { getConfigPath: vi.fn(() => '/fake/path/platforms.yaml') })
__registerMock('../services/python-bridge', { startPythonBackend: vi.fn() })
__registerMock('../publishers/account-manager', { getInstance: vi.fn() })
__registerMock('../services/scheduler', { setTaskQueue: vi.fn(), restore: vi.fn() })
__registerMock('../services/publish-history', { addRecord: vi.fn() })
__registerMock('../services/auto-updater', {})
__registerMock('../services/first-run', {})
__registerMock('../services/batch-manager', { setTaskQueue: vi.fn() })
__registerMock('../services/cloud-publisher', function CloudPublisher() {})

// Mock 模块单例 with side effects
__registerMock('../services/license-manager', { getInstance: vi.fn(() => ({ isPro: () => false })) })
__registerMock('../services/publish-alert', {})
__registerMock('../services/offline-manager', { startMonitoring: vi.fn(), setTaskQueue: vi.fn() })
__registerMock('../services/publish-monitor', {})
__registerMock('../services/system-tray', { registerIpcHandlers: vi.fn() })
__registerMock('../services/hotkeys', {})
const modelProviderManagerInit = vi.fn()
__registerMock('../services/model-provider-manager', {
  ModelProviderManager: class {
    constructor() { this.init = modelProviderManagerInit }
  },
})

// Mock platform-config / sensitive-filter（外部包）
__registerMock('@multi-publish/shared-utils/src/platform-config', class PlatformConfig { constructor() {} })
__registerMock('@multi-publish/shared-utils/src/sensitive-filter', { createWithBuiltin: vi.fn(() => ({})) })

const { extractContext } = require('./phase1-context')

// 构建 mock container，container.get(key) 返回带 key 标记的对象
function makeMockContainer() {
  const calls = []
  return {
    calls,
    get: vi.fn((key) => {
      calls.push(key)
      // 特殊处理：templateManager 需要 seedDefaults 方法
      if (key === 'templateManager') return { seedDefaults: vi.fn() }
      // aiGenerator 需要 setModelProviderManager 方法（用于测试条件调用）
      if (key === 'aiGenerator') return { setModelProviderManager: vi.fn() }
      // store 需要是 truthy（启动期日计数裁剪不在本阶段 —— 见下方禁令锁与 phase3-services.test.js）
      if (key === 'store') return { getSetting: vi.fn(), setSetting: vi.fn() }
      // taskQueue 需要 setExecutor 方法（虽然 extractContext 不调用，但 createAppContext 会用）
      if (key === 'taskQueue') return { setExecutor: vi.fn(), on: vi.fn() }
      // 默认返回一个标记对象
      return { __mockKey: key }
    }),
    has: vi.fn(() => false),
    register: vi.fn(),
  }
}

describe('phase1-context.extractContext', () => {
  it('返回对象包含所有预期字段（40+ 字段）', () => {
    const container = makeMockContainer()
    const ctx = extractContext(container)
    expect(ctx).toBeDefined()
    expect(typeof ctx).toBe('object')
    // 核心字段
    const expectedFields = [
      'container', 'store', 'taskQueue', 'scheduler', 'callbackServer',
      'keywordMonitor', 'analyticsService', 'usageTracker', 'pythonBridge',
      'AccountManager', 'history', 'autoUpdater', 'hotkeys', 'firstRun',
      'systemTray', 'offlineManager', 'publishMonitor',
      'authViewManager', 'rpaViewManager', 'webviewManager', 'qrCodeLogin',
      'oauthManager', 'batchManager', 'urlCollector', 'providerManager',
      'viralEngine', 'commentManager', 'contentIntelligence', 'publishImpactTracker',
      'proxyPool', 'templateManager', 'licenseManager', 'aiWriter',
      'renderEngine', 'compositionManager', 'aiGenerator', 'assetGenerator', 'videoEngine',
      'pipelineEngine', 'story2videoBatchQueue', 'modelProviderManager', '_chunkedUploader', '_platformConfig',
      '_sensitiveFilter', '_dataSync', 'BACKEND_PLATFORMS',
      'CloudPublisher',
      '_aggregatorBridge', 'publisherRouter', '_PublishAlert',
      'splitterBridge', 'promptBridge', 'serviceBus', 'pluginRegistry',
      'executionRecorder', 'story2videoProjectService', 'promptEvalService', 'signalCollector',
      'promptMemory', 'governance',
      'filmEngineeringService',
      'patternExtractionService',
      'performanceRecrawlService',
      'patternAttributionService',
    ]
    expectedFields.forEach((f) => {
      expect(ctx).toHaveProperty(f)
    })
  })

  it('templateManager.seedDefaults 被调用', () => {
    const container = makeMockContainer()
    const ctx = extractContext(container)
    expect(ctx.templateManager.seedDefaults).toHaveBeenCalled()
  })

  it('phase1 不得有启动期裁剪调用点：存储那时还没 init，调了也删不动（QM-6 自审 C-1）', () => {
    // 与本文件「只构造 ModelProviderManager，等待 Phase 3 的 Store 初始化后再启动」是同一条前提：
    // phase1 只是同步构建上下文，`store.init()` 要到 phase3-services.js 才发生，而
    // `prunePublishDailyCountAllOwners` 对未就绪的存储恒返 basis:'not_ready' 且一行都不删。
    // 挂在 phase1 的第一版有调用点、有单测、CI 全绿，生产上却是永久 no-op ——
    // 因为它的夹具无条件返回 measured，替真实存储声称了就绪。
    // 正向对偶在 phase3-services.test.js 的「启动期日计数裁剪」（夹具按 _ready 决定 basis + 顺序锁）。
    const fs = require('node:fs')
    const path = require('node:path')
    const src = fs.readFileSync(path.join(__dirname, 'phase1-context.js'), 'utf8')
    expect(src.length, '扫描域不得为空').toBeGreaterThan(1000)
    expect(src).not.toMatch(/prunePublishDailyCountAllOwners/)
    expect(src).not.toMatch(/startup-prune/)
    // 禁令必须配正向对偶：否则「删掉被禁物」与「删掉整条需求」在判据上同形
    const p3 = fs.readFileSync(path.join(__dirname, 'phase3-services.js'), 'utf8')
    const callAt = p3.indexOf('prunePublishDailyCountAllOwners(')
    const initAt = p3.indexOf('await store.init()')
    expect(callAt, 'phase3-services.js 必须真的有这个调用点').toBeGreaterThan(-1)
    expect(initAt, 'phase3-services.js 必须真的在等 store.init()').toBeGreaterThan(-1)
    expect(callAt, '调用点必须排在 store.init() 之后').toBeGreaterThan(initAt)
  })

  it('bootstrap 接线文件的 notify 调用一律不得自带顶层 meta 字段（logger 只抬四个白名单键）', () => {
    // 结构锁的动机是**自己踩的**：`{level:'WARN', hasStore, hasGuardToday}` 读起来完全像
    // 会把两个布尔落盘，实际 logger.notify 只抬 errorCategory/level/params/error，
    // 其余静默丢弃 ⇒ 落盘 `PublishDailyCount startup-prune-skipped {}`。
    // 扫描域＝两个 bootstrap 接线文件：日计数裁剪随 C-1 修复从 phase1 搬到 phase3-services.js，
    // 锁跟着调用点走，不是把 phase1 的锁留在原地自我安慰。
    const fs = require('node:fs')
    const path = require('node:path')
    const TARGET_FILES = ['phase1-context.js', 'phase3-services.js']
    /**
     * 从 `notify('Mod','key', {…})` 的 meta 字面量里取**顶层**键名。
     * 必须按花括号深度扫描：用 `[^}]*` 一类的近似会在第一个内层 `}` 截断，
     * 于是 `{ params: { owners: 1 } }` 的 `owners:` 被当成顶层键 ⇒ 假红（本条首跑就是这样）。
     */
    function topLevelMetaKeys (objLiteral) {
      const keys = []
      let depth = 0
      for (let i = 0; i < objLiteral.length; i++) {
        const ch = objLiteral[i]
        if (ch === '{' || ch === '[' || ch === '(') { depth += 1; continue }
        if (ch === '}' || ch === ']' || ch === ')') { depth -= 1; continue }
        if (depth !== 0) continue
        const m = /^([A-Za-z_$][\w$]*)\s*:/.exec(objLiteral.slice(i))
        if (m) { keys.push(m[1]); i += m[0].length - 1 }
      }
      return keys
    }
    function extractObjectLiteral (text, from) {
      const open = text.indexOf('{', from)
      if (open < 0) return null
      let depth = 0
      for (let i = open; i < text.length; i++) {
        if (text[i] === '{') depth += 1
        else if (text[i] === '}') { depth -= 1; if (depth === 0) return text.slice(open + 1, i) }
      }
      return null
    }
    const ALLOWED = new Set(['level', 'error', 'errorCategory', 'params'])
    const offenders = []
    for (const file of TARGET_FILES) {
      const src = fs.readFileSync(path.join(__dirname, file), 'utf8')
      let seen = 0
      const re = /\.notify\(\s*['"][^'"]+['"]\s*,\s*['"]([^'"]+)['"]\s*,/g
      let m
      while ((m = re.exec(src)) !== null) {
        seen += 1
        const literal = extractObjectLiteral(src, m.index + m[0].length)
        if (literal === null) { offenders.push([file, m[1], 'meta 字面量解析失败'].join(': ')); continue }
        const extra = topLevelMetaKeys(literal).filter((k) => !ALLOWED.has(k))
        if (extra.length) offenders.push([file, m[1], extra.join(', ')].join(' -> '))
      }
      // 反失明：某个文件的扫描退化（带 meta 的调用点一个都没抓到）不得读成"合规"
      expect(seen, file + ' 应有带 meta 的 notify 调用点（解析退化即红）').toBeGreaterThan(0)
    }
    // 如实记录这把锁**抓不到什么**：它只认 `key:` 形态的顶层键。
    // `{ level:'WARN', hasStore }` 这种**简写属性**在 depth 0 上是裸标识符，判据看不见
    // ——要把它也判出来，就得区分"裸标识符是键还是值"（`error: String(e && e.message)` 里
    // 的 `e` 也是裸标识符），那是另一类解析。两个文件现存调用点都写成 `key: value`，
    // 所以射程覆盖实际形态；新增简写属性时本条不会红，需靠各自的行为锁兜。
    expect(offenders, 'notify 的 meta 里出现非白名单顶层键：' + offenders.join(' | ')).toEqual([])
  })

  it('offlineManager.startMonitoring 被调用', () => {
    const container = makeMockContainer()
    extractContext(container)
    // offlineManager 是 require 的，mock 模块记录的调用
    const offlineManager = require('../services/offline-manager')
    expect(offlineManager.startMonitoring).toHaveBeenCalled()
  })

  it('systemTray.registerIpcHandlers 被调用', () => {
    const container = makeMockContainer()
    extractContext(container)
    const systemTray = require('../services/system-tray')
    expect(systemTray.registerIpcHandlers).toHaveBeenCalled()
  })

  it('scheduler / BatchManager / offlineManager 的 setTaskQueue 被调用', () => {
    const container = makeMockContainer()
    extractContext(container)
    const scheduler = require('../services/scheduler')
    const BatchManager = require('../services/batch-manager')
    const offlineManager = require('../services/offline-manager')
    expect(scheduler.setTaskQueue).toHaveBeenCalled()
    expect(BatchManager.setTaskQueue).toHaveBeenCalled()
    expect(offlineManager.setTaskQueue).toHaveBeenCalled()
  })

  it('_platformConfig 加载失败时返回 null 不抛错', () => {
    // 重新 mock platform-config 抛错
    __registerMock('@multi-publish/shared-utils/src/platform-config', class { constructor() { throw new Error('load failed') } })
    const container = makeMockContainer()
    expect(() => extractContext(container)).not.toThrow()
    const ctx = extractContext(container)
    expect(ctx._platformConfig).toBeNull()
    expect(log.notify).toHaveBeenCalledWith('App', 'platform-config-load-failed', expect.objectContaining({ level: 'WARN' }))
  })

  it('只构造 ModelProviderManager，等待 Phase 3 的 Store 初始化后再启动', () => {
    modelProviderManagerInit.mockClear()
    const container = makeMockContainer()
    const ctx = extractContext(container)

    expect(ctx.modelProviderManager.init).not.toHaveBeenCalled()
  })

  it('aiGenerator.setModelProviderManager 被调用（方法存在时）', () => {
    const container = makeMockContainer()
    const ctx = extractContext(container)
    expect(ctx.aiGenerator.setModelProviderManager).toHaveBeenCalled()
  })

  it('aiGenerator.setModelProviderManager 不被调用（方法不存在时，不抛错）', () => {
    const container = makeMockContainer()
    // 覆盖 aiGenerator 返回值，无 setModelProviderManager 方法
    container.get.mockImplementation((key) => {
      if (key === 'aiGenerator') return {} // 无 setModelProviderManager
      if (key === 'templateManager') return { seedDefaults: vi.fn() }
      if (key === 'store') return { getSetting: vi.fn(), setSetting: vi.fn() }
      if (key === 'taskQueue') return { setExecutor: vi.fn(), on: vi.fn() }
      return { __mockKey: key }
    })
    expect(() => extractContext(container)).not.toThrow()
  })

  it('contentIntelligence.setAIGenerator 被注入（方法存在时）', () => {
    const container = makeMockContainer()
    const setAIGenerator = vi.fn()
    // 覆盖 contentIntelligence 返回值，含 setAIGenerator 方法
    container.get.mockImplementation((key) => {
      if (key === 'contentIntelligence') return { setAIGenerator }
      if (key === 'aiGenerator') return { setModelProviderManager: vi.fn() }
      if (key === 'templateManager') return { seedDefaults: vi.fn() }
      if (key === 'store') return { getSetting: vi.fn(), setSetting: vi.fn() }
      if (key === 'taskQueue') return { setExecutor: vi.fn(), on: vi.fn() }
      return { __mockKey: key }
    })
    extractContext(container)
    expect(setAIGenerator).toHaveBeenCalled()
  })

  it('contentIntelligence.setAIGenerator 不被调用（方法不存在时，不抛错）', () => {
    const container = makeMockContainer()
    // 默认 mock contentIntelligence 无 setAIGenerator 方法
    expect(() => extractContext(container)).not.toThrow()
  })

 it('BACKEND_PLATFORMS 是 Set 且包含 youtube/tiktok/twitter', () => {
    const container = makeMockContainer()
    const ctx = extractContext(container)
    expect(ctx.BACKEND_PLATFORMS).toBeInstanceOf(Set)
    expect(ctx.BACKEND_PLATFORMS.has('youtube')).toBe(true)
    expect(ctx.BACKEND_PLATFORMS.has('tiktok')).toBe(true)
    expect(ctx.BACKEND_PLATFORMS.has('twitter')).toBe(true)
  })

  it('写入动态生命周期字段后仍可安全读取和枚举 context', () => {
    const context = extractContext(makeMockContainer())
    context.stopBridges = vi.fn()
    context.keywordPersistTimer = 1
    context.loginStatusMonitor = null

    expect(context.unknownLifecycleField).toBeUndefined()
    expect('unknownLifecycleField' in context).toBe(false)
    expect(Object.keys(context)).toEqual(expect.arrayContaining([
      'container', 'stopBridges', 'keywordPersistTimer', 'loginStatusMonitor',
    ]))
  })
})
