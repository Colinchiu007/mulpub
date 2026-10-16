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
const storePruneCalls = []
const GUARD_TODAY = '2026-10-16'
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
      // 启动期裁剪的日键真源是守卫的 today()（与写入方同源），夹具如实给形状
      if (key === 'publishIntervalGuard') return { today: () => GUARD_TODAY }
      // store 需要是 truthy；顺带提供「启动期裁剪日计数」探针
      // （change: publish-frequency-unwired-surfaces —— cleanup 必须有生产调用点，
      //   否则 publish_daily_count 只增不减，实现得再对也是死代码）
      if (key === 'store') {
        return {
          getSetting: vi.fn(),
          setSetting: vi.fn(),
          prunePublishDailyCountAllOwners: (todayKey) => {
            storePruneCalls.push(todayKey)
            // 夹具必须与**真实存储的返回形状**逐字同形（`publish-daily-store.js` 的三个出口
            // 都带 basis）。原先这里不返 basis，等于把 'unproven' 兜底当成主路径来测，
            // 而真实运行时永远走的是 'measured' —— 契约夹具替被测方漏字段的一类落点。
            return { owners: 2, removed: 5, basis: 'measured' }
          },
        }
      }
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

  it('启动期裁剪日计数表：必须调用一次且日键取自守卫的 today()（cleanup 没有生产调用点＝死代码）', () => {
    storePruneCalls.length = 0
    extractContext(makeMockContainer())
    expect(storePruneCalls.length, 'prunePublishDailyCountAllOwners 的调用次数').toBe(1)
    expect(storePruneCalls[0], '必须给当天运营日键').toMatch(/^\d{4}-\d{2}-\d{2}$/)
    // 日键必须来自**守卫**（写入方就是它）；启动侧另算一次本地日期就是第二套口径，
    // 差一天的表现是"昨天的行今天被删"或"该删的没删"，且两处都不报错。
    expect(storePruneCalls[0]).toBe(GUARD_TODAY)
  })

  it('裁剪读数必须进 notify 的 meta.params —— 顶层自造字段会被 logger 静默丢掉', () => {
    // 实测形态：`notify(m,'k',{level:'WARN',hasStore:false})` 落盘成 `m k {}`，
    // logger.notify 只抬 errorCategory / level / params / error 四个顶层键，
    // 其余一律丢弃。所以"出声"的判据不能停在"打了这个键"，必须核对值真的随行落下去。
    const notify = require('../services/logger').notify
    notify.mockClear()
    storePruneCalls.length = 0
    extractContext(makeMockContainer())
    const hit = notify.mock.calls.find((c) => String(c[1] || '') === 'startup-prune')
    expect(hit, `成功路径必须打 startup-prune，实际 notify: ${JSON.stringify(notify.mock.calls)}`).toBeTruthy()
    expect(hit[0]).toBe('PublishDailyCount')
    expect(hit[2], '读数必须挂在 params 下，否则一行里一个数都看不见').toEqual({
      params: { owners: 2, removed: 5, basis: 'measured' },
    })
  })

  it('接不上时必须出声（不得静默跳过 —— 否则重构把这条维护摘掉也没人知道）', () => {
    storePruneCalls.length = 0
    const notify = require('../services/logger').notify
    notify.mockClear()
    const inner = makeMockContainer()
    const innerGet = inner.get
    // store 缺该方法（例如 mixin 未挂载）⇒ 必须打 startup-prune-skipped
    inner.get = vi.fn((key) => (key === 'store'
      ? { getSetting: vi.fn(), setSetting: vi.fn() }
      : innerGet(key)))
    const ctx = extractContext(inner)
    expect(ctx).toBeDefined()
    expect(storePruneCalls.length).toBe(0)
    const hit = notify.mock.calls.find((c) => String(c[1] || '') === 'startup-prune-skipped')
    expect(hit, `接不上必须出声，实际 notify: ${JSON.stringify(notify.mock.calls)}`).toBeTruthy()
    // 缺的那一侧必须是**可归因的**（是 store 没挂，还是守卫没有 today）
    expect(hit[2].params, '跳过原因必须落在 params 里').toEqual({ hasStore: false, hasGuardToday: true })
    expect(hit[2].level).toBe('WARN')
  })

  it('裁剪抛错不得打断启动（旁路维护，方向是"留着旧行"而不是"起不来"）', () => {
    storePruneCalls.length = 0
    const notify = require('../services/logger').notify
    notify.mockClear()
    const inner = makeMockContainer()
    const innerGet = inner.get
    inner.get = vi.fn((key) => (key === 'store'
      ? {
          getSetting: vi.fn(),
          setSetting: vi.fn(),
          prunePublishDailyCountAllOwners: () => { throw new Error('DB_BUSY') },
        }
      : innerGet(key)))
    const ctx = extractContext(inner)
    expect(ctx).toBeDefined()
    expect(notify.mock.calls.some((c) => String(c[1] || '').includes('prune')),
      `启动期裁剪失败必须留痕，实际 notify: ${JSON.stringify(notify.mock.calls)}`).toBe(true)
  })

  it('本文件的 notify 调用一律不得自带顶层 meta 字段（logger 只抬四个白名单键）', () => {
    // 结构锁的动机是**自己踩的**：`{level:'WARN', hasStore, hasGuardToday}` 读起来完全像
    // 会把两个布尔落盘，实际 logger.notify 只抬 errorCategory/level/params/error，
    // 其余静默丢弃 ⇒ 落盘 `PublishDailyCount startup-prune-skipped {}`。
    // 行为锁测当前两处调用点；这条测"以后再加第三个调用点时别再犯"。
    const fs = require('node:fs')
    const path = require('node:path')
    const src = fs.readFileSync(path.join(__dirname, 'phase1-context.js'), 'utf8')
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
    const re = /\.notify\(\s*['"][^'"]+['"]\s*,\s*['"]([^'"]+)['"]\s*,/g
    let m
    while ((m = re.exec(src)) !== null) {
      const literal = extractObjectLiteral(src, m.index + m[0].length)
      if (literal === null) { offenders.push(`${m[1]} -> meta 字面量解析失败`); continue }
      const extra = topLevelMetaKeys(literal).filter((k) => !ALLOWED.has(k))
      if (extra.length) offenders.push(`${m[1]} -> ${extra.join(', ')}`)
    }
    // 反失明：扫描退化（一个调用点都没抓到）不得读成"合规"
    const callSites = [...src.matchAll(/\.notify\(\s*['"]/g)].length
    expect(callSites, '本文件应有 notify 调用点（扫描退化即红）').toBeGreaterThan(0)
    // 如实记录这把锁**抓不到什么**：它只认 `key:` 形态的顶层键。
    // `{ level:'WARN', hasStore }` 这种**简写属性**在 depth 0 上是裸标识符，判据看不见
    // ——要把它也判出来，就得区分"裸标识符是键还是值"（`error: String(e && e.message)` 里
    // 的 `e` 也是裸标识符），那是另一类解析。当前两调用点都写成 `key: value`，
    // 所以射程覆盖实际形态；新增简写属性时本条不会红，需靠上面的行为锁兜。
    expect(offenders, `notify 的 meta 里出现非白名单顶层键：${offenders.join('; ')}`).toEqual([])
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
