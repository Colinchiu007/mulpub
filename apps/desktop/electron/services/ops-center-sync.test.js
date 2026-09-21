// @ts-check
/**
 * ops-center-sync.test.js — 运营后台 → 桌面端运行时同步服务
 *
 * 覆盖：URL 校验（https 强制/回环豁免）、API Key 加密存储（不落明文）、
 * 目录拉取错误映射（401/403/404/超时/大小/JSON/结构）、applyCatalog 编排、
 * lastSyncedAt 落盘、启动自动同步。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

__registerMock('./crypto', {
  isAvailable: () => true,
  encrypt: (key) => (key ? Buffer.from('enc_' + key) : null),
  decrypt: (value) => (value ? Buffer.from(value).toString('utf8').replace(/^enc_/, '') : ''),
  mask: (key) => (key ? key.slice(0, 4) + '****' + key.slice(-4) : '****'),
  setSafeStorage: () => {},
})

const nodeCrypto = require('crypto')

const { OpsCenterSync, normalizeUrl, canonicalJson, verifyRuntimeSignature, DEFAULT_RUNTIME_PUBLIC_KEY } = require('./ops-center-sync')

// DEV 测试密钥对：与 ops-center-sync.js 默认公钥 / .env.example DEV 私钥配对（2026-09-02 生成）
const DEV_PRIVATE_KEY = [
  '-----BEGIN PRIVATE KEY-----',
  'MC4CAQAwBQYDK2VwBCIEIMEaqZBFhrl/hpieWHhYoaG6Dn+Juchfx4/2s0dXok0S',
  '-----END PRIVATE KEY-----',
].join('\n')

const DEV_PUBLIC_KEY = [
  '-----BEGIN PUBLIC KEY-----',
  'MCowBQYDK2VwAyEAr6a4g942N23o31XNIcwFGX9VhSu2jlGA9dT1bfJIDpg=',
  '-----END PUBLIC KEY-----',
].join('\n')

/** 对 payload 去掉 signature 后做 canonical JSON + Ed25519 签名，返回带 signature 的对象（模拟 ops-center 服务端） */
function signRuntimePayload (payload, privPem = DEV_PRIVATE_KEY) {
  const { signature: _sig, ...rest } = payload
  const canonical = Buffer.from(canonicalJson(rest), 'utf-8')
  const sig = nodeCrypto.sign(null, canonical, privPem)
  return { ...rest, signature: sig.toString('base64') }
}

function makeStore (initial) {
  let data = initial || ''
  return {
    getSetting: vi.fn(() => data),
    setSetting: vi.fn((_k, v) => { data = v }),
    _getData: () => data,
  }
}

function makeManager () {
  return { applyCatalog: vi.fn((items) => ({ code: 0, updated: items.length, inserted: 0 })) }
}

function jsonResp ({ status = 200, body = null, ok = null, arrayBuffer }) {
  return {
    status,
    ok: ok !== null ? ok : status >= 200 && status < 300,
    arrayBuffer: arrayBuffer || (async () => Buffer.from(JSON.stringify(body))),
  }
}

const LOG = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }

describe('normalizeUrl', () => {
  it('接受 https URL 并去掉尾部斜杠', () => {
    expect(normalizeUrl('https://ops.example.com/')).toBe('https://ops.example.com')
    expect(normalizeUrl('  https://ops.example.com:8443/v1/  ')).toBe('https://ops.example.com:8443/v1')
  })

  it('本机回环地址允许 http', () => {
    expect(normalizeUrl('http://localhost:8000')).toBe('http://localhost:8000')
    expect(normalizeUrl('http://127.0.0.1:8000')).toBe('http://127.0.0.1:8000')
    expect(normalizeUrl('http://127.0.0.2:8000')).toBe('http://127.0.0.2:8000')
    expect(normalizeUrl('http://[::1]:8000')).toBe('http://[::1]:8000')
  })

  it('非本机地址强制 https，拒绝明文 http', () => {
    expect(normalizeUrl('http://ops.example.com')).toBe('')
  })

  it('拒绝携带用户名/密码、非 http(s) 协议与空值', () => {
    expect(normalizeUrl('https://user:pass@ops.example.com')).toBe('')
    expect(normalizeUrl('ftp://ops.example.com')).toBe('')
    expect(normalizeUrl('')).toBe('')
    expect(normalizeUrl(undefined)).toBe('')
    expect(normalizeUrl('not-a-url')).toBe('')
  })
})

describe('OpsCenterSync saveConfig/getConfig', () => {
  afterEach(() => { vi.useRealTimers() })

  it('保存时用 safeStorage 加密 Key，getConfig 不暴露明文', () => {
    const store = makeStore()
    const svc = new OpsCenterSync({ store, modelProviderManager: makeManager(), log: LOG })
    const res = svc.saveConfig({ url: 'https://ops.example.com', apiKey: 'secret-key-123', autoSync: true })
    expect(res.code).toBe(0)
    expect(res.config.url).toBe('https://ops.example.com')
    expect(res.config.apiKeyConfigured).toBe(true)
    expect(res.config.autoSync).toBe(true)
    // 明文不出现在任何返回/存储中
    expect(JSON.stringify(res)).not.toContain('secret-key-123')
    expect(store._getData()).not.toContain('secret-key-123')
    expect(store._getData()).toContain('apiKeyEnc')
    expect(svc.getConfig().apiKey).toBeUndefined()
  })

  it('二次保存（apiKey 为空）不把明文写进 settings（密文透传）', () => {
    const store = makeStore()
    const svc = new OpsCenterSync({ store, modelProviderManager: makeManager(), log: LOG })
    svc.saveConfig({ url: 'https://ops.example.com', apiKey: 'secret-key-123', autoSync: true })
    // 第二次保存：切换 autoSync，不填 Key —— 必须透传密文，绝不能解密后回写明文
    const res = svc.saveConfig({ url: 'https://ops.example.com', apiKey: '', autoSync: false })
    expect(res.code).toBe(0)
    expect(res.config.apiKeyConfigured).toBe(true)
    expect(store._getData()).not.toContain('secret-key-123')
    expect(store._getData()).not.toContain('secret')
  })

  it('apiKey 为空时保留已有 Key，不重复加密', () => {
    const store = makeStore()
    const svc = new OpsCenterSync({ store, modelProviderManager: makeManager(), log: LOG })
    svc.saveConfig({ url: 'https://ops.example.com', apiKey: 'k1' })
    const res = svc.saveConfig({ url: 'https://ops.example.com', apiKey: '', autoSync: false })
    expect(res.code).toBe(0)
    expect(res.config.autoSync).toBe(false)
    expect(res.config.apiKeyConfigured).toBe(true)
    expect(store._getData()).toContain('apiKeyEnc')
  })

  it('非法 URL 拒绝保存', () => {
    const store = makeStore()
    const svc = new OpsCenterSync({ store, modelProviderManager: makeManager(), log: LOG })
    const res = svc.saveConfig({ url: 'http://ops.example.com', apiKey: 'k' })
    expect(res.code).toBe(-1)
    expect(res.message).toContain('http(s)')
  })
})

describe('OpsCenterSync syncNow', () => {
  let originalFetch
  beforeEach(() => { originalFetch = global.fetch })
  afterEach(() => {
    global.fetch = originalFetch
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('未配置 URL / Key / manager 时 fail-closed', async () => {
    const store = makeStore()
    const svc = new OpsCenterSync({ store, modelProviderManager: makeManager(), log: LOG })
    expect((await svc.syncNow()).code).toBe(-1)
    expect((await svc.syncNow()).message).toContain('地址')

    // manager 未提供 applyCatalog → 模型服务未就绪（不发起网络请求）
    const svc2 = new OpsCenterSync({ store, modelProviderManager: {}, log: LOG })
    svc2.saveConfig({ url: 'https://ops.example.com', apiKey: 'k' })
    expect((await svc2.syncNow()).code).toBe(-1)
    expect((await svc2.syncNow()).message).toContain('模型服务未就绪')
  })

  it('401/403 → API Key 无效；404 → 未启用目录', async () => {
    const store = makeStore()
    const svc = new OpsCenterSync({ store, modelProviderManager: makeManager(), log: LOG })
    svc.saveConfig({ url: 'https://ops.example.com', apiKey: 'k' })
    global.fetch = vi.fn(async () => jsonResp({ status: 401 }))
    expect((await svc.syncNow()).message).toContain('API Key 无效')
    global.fetch = vi.fn(async () => jsonResp({ status: 404 }))
    expect((await svc.syncNow()).message).toContain('端点未启用')
    global.fetch = vi.fn(async () => jsonResp({ status: 500 }))
    expect((await svc.syncNow()).message).toContain('HTTP 500')
  })

  it('超时（10 秒）→ 明确错误', async () => {
    vi.useFakeTimers()
    const store = makeStore()
    const svc = new OpsCenterSync({ store, modelProviderManager: makeManager(), log: LOG })
    svc.saveConfig({ url: 'https://ops.example.com', apiKey: 'k' })
    global.fetch = vi.fn((_url, opts) => new Promise((_resolve, reject) => {
      opts.signal && opts.signal.addEventListener('abort', () => {
        const e = new Error('The operation was aborted')
        e.name = 'AbortError'
        reject(e)
      })
    }))
    const pending = svc.syncNow()
    vi.advanceTimersByTime(10001)
    const res = await pending
    expect(res.code).toBe(-1)
    expect(res.message).toContain('超时')
  })

  it('响应超过 1MB / 非法 JSON / 缺 items → 拒绝', async () => {
    const store = makeStore()
    const svc = new OpsCenterSync({ store, modelProviderManager: makeManager(), log: LOG })
    svc.saveConfig({ url: 'https://ops.example.com', apiKey: 'k' })
    const big = Buffer.alloc(1024 * 1024 + 1, 1)
    global.fetch = vi.fn(async () => jsonResp({ arrayBuffer: async () => big }))
    expect((await svc.syncNow()).message).toContain('1MB')

    global.fetch = vi.fn(async () => jsonResp({ arrayBuffer: async () => Buffer.from('not-json') }))
    expect((await svc.syncNow()).message).toContain('JSON')

    global.fetch = vi.fn(async () => jsonResp({ body: { foo: 1 } }))
    expect((await svc.syncNow()).message).toContain('items')
  })

  it('成功：拉取目录 → applyCatalog → lastSyncedAt 落盘', async () => {
    const store = makeStore()
    const manager = makeManager()
    const svc = new OpsCenterSync({ store, modelProviderManager: manager, log: LOG })
    svc.saveConfig({ url: 'https://ops.example.com', apiKey: 'k' })
    const items = [{ id: 'openai', name: 'OpenAI' }, { id: 'minimax-multimodal', name: 'MiniMax' }]
    global.fetch = vi.fn(async () => jsonResp({ body: { items } }))
    const res = await svc.syncNow()
    expect(res.code).toBe(0)
    expect(res.updated).toBe(2)
    expect(res.syncedAt).toBeTruthy()
    expect(manager.applyCatalog).toHaveBeenCalledWith(items)
    expect(store._getData()).toContain('lastSyncedAt')
    expect(svc.getConfig().lastSyncedAt).toBeTruthy()
  })

  it('连接失败 → 明确错误', async () => {
    const store = makeStore()
    const svc = new OpsCenterSync({ store, modelProviderManager: makeManager(), log: LOG })
    svc.saveConfig({ url: 'https://ops.example.com', apiKey: 'k' })
    global.fetch = vi.fn(async () => { throw new Error('ECONNREFUSED') })
    expect((await svc.syncNow()).message).toContain('无法连接')
  })
})

describe('OpsCenterSync autoSyncOnStart', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('未配置自动同步时不调度', () => {
    vi.useFakeTimers()
    const store = makeStore()
    const svc = new OpsCenterSync({ store, modelProviderManager: makeManager(), log: LOG })
    const spy = vi.spyOn(svc, 'syncNow')
    svc.autoSyncOnStart()
    vi.advanceTimersByTime(10000)
    expect(spy).not.toHaveBeenCalled()
  })

  it('配置后启动 3 秒延迟执行同步，失败仅警告', () => {
    vi.useFakeTimers()
    const store = makeStore()
    const svc = new OpsCenterSync({ store, modelProviderManager: makeManager(), log: LOG })
    svc.saveConfig({ url: 'https://ops.example.com', apiKey: 'k' })
    const spy = vi.spyOn(svc, 'syncNow').mockResolvedValue({ code: -1, message: 'boom' })
    svc.autoSyncOnStart()
    expect(spy).not.toHaveBeenCalled()
    vi.advanceTimersByTime(3001)
    expect(spy).toHaveBeenCalledTimes(1)
  })
})

describe('OpsCenterSync 运行时策略（公告/版本/内容安全）', () => {
  afterEach(() => { vi.restoreAllMocks() })

  it('applyRuntime 缓存公告/策略并重建敏感词过滤器（内置 + 远程词）', () => {
    const store = makeStore()
    const svc = new OpsCenterSync({ store, modelProviderManager: makeManager(), log: LOG })
    svc.applyRuntime({
      announcements: [{ title: '维护', severity: 'maintenance', content: 'x' }],
      update_policy: { min_version: '0.1.0', force_version: '0.1.0', gray_ratio: 50, enabled: true },
      content_policy: { name: '默认', word_list: ['远程词甲', '远程词乙'], replacement: '***', enabled: true },
      synced_at: '2026-08-10T00:00:00Z',
    })
    const state = svc.getRuntimeState()
    expect(state.announcements).toHaveLength(1)
    expect(state.announcements[0].severity).toBe('maintenance')
    expect(state.updatePolicy.force_version).toBe('0.1.0')
    // 渲染端最小权限：词库/替换串不下发
    expect(state.contentPolicy).not.toHaveProperty('word_list')
    expect(state.contentPolicy).not.toHaveProperty('replacement')
    expect(state.contentPolicy.enabled).toBe(true)
    expect(svc.getReplacement()).toBe('***')
    expect(svc.getUpdatePolicy().gray_ratio).toBe(50)

    const filter = svc.getSensitiveFilter()
    expect(filter).toBeTruthy()
    expect(filter.check('这里有远程词甲').hasSensitive).toBe(true)
    expect(filter.replace('远程词乙')).toContain('***')
    // 持久化到 settings（值包含运行时状态 JSON）
    expect(store._getData()).toContain('"announcements"')
    expect(store.setSetting).toHaveBeenCalledWith('opsCenterRuntime', expect.stringContaining('远程词甲'))
  })

  it('内容安全策略未启用或词为空时，敏感词过滤器仅含内置词库', () => {
    const store = makeStore()
    const svc = new OpsCenterSync({ store, modelProviderManager: makeManager(), log: LOG })
    svc.applyRuntime({ announcements: [], content_policy: { enabled: false, word_list: ['远程词'] }, synced_at: 't' })
    const filter = svc.getSensitiveFilter()
    expect(filter.check('远程词').hasSensitive).toBe(false)
  })

  it('setUpdatePolicyConsumer 在 applyRuntime 时收到策略', () => {
    const store = makeStore()
    const svc = new OpsCenterSync({ store, modelProviderManager: makeManager(), log: LOG })
    const consumer = vi.fn()
    svc.setUpdatePolicyConsumer(consumer)
    svc.applyRuntime({ announcements: [], update_policy: { min_version: '0.1.0', enabled: true } })
    expect(consumer).toHaveBeenCalledWith(expect.objectContaining({ min_version: '0.1.0' }))
  })

  it('syncNow 目录成功时 best-effort 拉取 runtime（失败仅 warn，目录结果不受影响）', async () => {
    const store = makeStore()
    const manager = makeManager()
    const svc = new OpsCenterSync({ store, modelProviderManager: manager, log: LOG })
    svc.saveConfig({ url: 'https://ops.example.com', apiKey: 'k' })
    const originalFetch = global.fetch
    global.fetch = vi.fn(async (url) => {
      if (String(url).includes('/runtime/bootstrap')) {
        return jsonResp({ body: signRuntimePayload({ announcements: [{ title: '公告', severity: 'info', content: '' }], update_policy: null, content_policy: null, synced_at: 't' }) })
      }
      return jsonResp({ body: { items: [{ id: 'openai' }] } })
    })
    try {
      const res = await svc.syncNow()
      expect(res.code).toBe(0)
      expect(res.runtimeApplied).toBe(true)
      expect(svc.getRuntimeState().announcements).toHaveLength(1)
    } finally {
      global.fetch = originalFetch
    }
  })
})


describe('OpsCenterSync featureFlags', () => {
  it('applyRuntime 存储并暴露功能开关（typed value）', () => {
    const store = makeStore()
    const svc = new OpsCenterSync({ store, modelProviderManager: makeManager(), log: LOG })
    svc.applyRuntime({
      announcements: [],
      feature_flags: { 'videoCreation.maxOutputResolution': '4k', 'compose.maxSegments': 12, 'allow.flag': true },
      synced_at: 't',
    })
    const state = svc.getRuntimeState()
    expect(state.featureFlags['videoCreation.maxOutputResolution']).toBe('4k')
    expect(state.featureFlags['compose.maxSegments']).toBe(12)
    expect(state.featureFlags['allow.flag']).toBe(true)
    expect(svc.getFeatureFlag('videoCreation.maxOutputResolution')).toBe('4k')
    expect(svc.getFeatureFlag('missing')).toBeUndefined()
    // 持久化到 settings
    expect(store._getData()).toContain('videoCreation.maxOutputResolution')
  })

  it('feature_flags 结构非法（数组/对象嵌套/超限）→ fail-closed 空对象', () => {
    const store = makeStore()
    const svc = new OpsCenterSync({ store, modelProviderManager: makeManager(), log: LOG })
    svc.applyRuntime({ announcements: [], feature_flags: [1, 2], synced_at: 't' })
    expect(svc.getRuntimeState().featureFlags).toEqual({})
    // 嵌套对象值被忽略（仅基本类型）
    svc.applyRuntime({ announcements: [], feature_flags: { a: { nested: 1 }, b: 'ok' }, synced_at: 't' })
    expect(svc.getRuntimeState().featureFlags).toEqual({ b: 'ok' })
    // 超 100 个 key 整批拒绝
    const huge = {}
    for (let i = 0; i < 101; i++) huge['k' + i] = i
    svc.applyRuntime({ announcements: [], feature_flags: huge, synced_at: 't' })
    expect(svc.getRuntimeState().featureFlags).toEqual({})
  })

  it('重启后从 settings 恢复 featureFlags', () => {
    const store = makeStore()
    const svc1 = new OpsCenterSync({ store, modelProviderManager: makeManager(), log: LOG })
    svc1.applyRuntime({ announcements: [], feature_flags: { 'videoCreation.maxOutputResolution': '1080p' }, synced_at: 't' })
    const svc2 = new OpsCenterSync({ store, modelProviderManager: makeManager(), log: LOG })
    expect(svc2.getFeatureFlag('videoCreation.maxOutputResolution')).toBe('1080p')
  })

  it('恢复路径同样归一化：settings 中的非法结构不进入运行时状态', () => {
    const store = makeStore()
    // 直接注入脏 settings（模拟旧版本/手工篡改持久化）
    store.setSetting('opsCenterRuntime', JSON.stringify({
      announcements: [], featureFlags: { a: { nested: 1 }, b: 'ok', c: true }, syncedAt: 't',
    }))
    const svc = new OpsCenterSync({ store, modelProviderManager: makeManager(), log: LOG })
    expect(svc.getRuntimeState().featureFlags).toEqual({ b: 'ok', c: true })
  })

  it('getFeatureFlag 拒绝原型键且仅返回自有属性', () => {
    const store = makeStore()
    const svc = new OpsCenterSync({ store, modelProviderManager: makeManager(), log: LOG })
    svc.applyRuntime({ announcements: [], feature_flags: { normal: 'v', __proto__: 'x', constructor: 1 }, synced_at: 't' })
    expect(svc.getFeatureFlag('__proto__')).toBeUndefined()
    expect(svc.getFeatureFlag('constructor')).toBeUndefined()
    expect(svc.getFeatureFlag('toString')).toBeUndefined() // 不读原型链
    expect(svc.getFeatureFlag('normal')).toBe('v')
    expect(svc.getRuntimeState().featureFlags).toEqual({ normal: 'v' })
  })
})
describe('OpsCenterSync applyRuntime platform_defs', () => {
  it('注入 platformConfig 时应用 platform_defs', () => {
    const store = makeStore()
    const svc = new OpsCenterSync({ store, modelProviderManager: makeManager(), log: LOG })
    const applyRemote = vi.fn(() => 2)
    svc.setPlatformConfig({ applyRemote })
    svc.applyRuntime({ announcements: [], platform_defs: [{ id: 'a' }, { id: 'b' }], synced_at: 't' })
    expect(applyRemote).toHaveBeenCalledWith([{ id: 'a' }, { id: 'b' }])
  })

  it('未注入 platformConfig 时跳过 platform_defs，不影响其他运行时策略', () => {
    const store = makeStore()
    const svc = new OpsCenterSync({ store, modelProviderManager: makeManager(), log: LOG })
    svc.applyRuntime({ announcements: [{ title: 'x', severity: 'info', content: '' }], platform_defs: [{ id: 'a' }], synced_at: 't' })
    expect(svc.getRuntimeState().announcements).toHaveLength(1)
  })

  it('setPlatformConfig 拒绝无 applyRemote 的对象（视为未注入）', () => {
    const store = makeStore()
    const svc = new OpsCenterSync({ store, modelProviderManager: makeManager(), log: LOG })
    svc.setPlatformConfig({})
    svc.applyRuntime({ announcements: [], platform_defs: [{ id: 'a' }], synced_at: 't' })
    expect(svc.getRuntimeState().announcements).toEqual([])

  })

  it('注入 keywordMonitor 时应用 keyword_watchlist；未注入跳过', () => {
    const store = makeStore()
    const svc = new OpsCenterSync({ store, modelProviderManager: makeManager(), log: LOG })
    const applyRemoteWatchlist = vi.fn(() => 2)
    svc.setKeywordMonitor({ applyRemoteWatchlist })
    svc.applyRuntime({ announcements: [], keyword_watchlist: [{ keyword: 'a' }, { keyword: 'b' }], synced_at: 't' })
    expect(applyRemoteWatchlist).toHaveBeenCalledWith([{ keyword: 'a' }, { keyword: 'b' }])

    const svc2 = new OpsCenterSync({ store, modelProviderManager: makeManager(), log: LOG })
    svc2.setKeywordMonitor({})
    svc2.applyRuntime({ announcements: [], keyword_watchlist: [{ keyword: 'a' }], synced_at: 't' })
    expect(svc2.getRuntimeState().announcements).toEqual([])
  })

  it('注入 templateManager 时应用 content_templates；未注入跳过', () => {
    const store = makeStore()
    const svc = new OpsCenterSync({ store, modelProviderManager: makeManager(), log: LOG })
    const applyRemote = vi.fn(() => 2)
    svc.setTemplateManager({ applyRemote })
    svc.applyRuntime({ announcements: [], content_templates: [{ id: 'a' }, { id: 'b' }], synced_at: 't' })
    expect(applyRemote).toHaveBeenCalledWith([{ id: 'a' }, { id: 'b' }])

    const svc2 = new OpsCenterSync({ store, modelProviderManager: makeManager(), log: LOG })
    svc2.setTemplateManager({})
    svc2.applyRuntime({ announcements: [], content_templates: [{ id: 'a' }], synced_at: 't' })
    expect(svc2.getRuntimeState().announcements).toEqual([])
  })
})

describe('canonicalJson 固定向量（与 ops-center json.dumps 双端对齐）', () => {
  it('键字典序排序', () => {
    expect(canonicalJson({ b: 2, a: 1, c: [3] })).toBe('{"a":1,"b":2,"c":[3]}')
  })
  it('中文按 UTF-8 原样输出（ensure_ascii=False 对齐）', () => {
    expect(canonicalJson({ 标题: '维护' })).toBe('{"标题":"维护"}')
  })
  it('字符串转义规则与 JSON.stringify 一致', () => {
    expect(canonicalJson({ s: 'a"b\\c\nd' })).toBe(JSON.stringify({ s: 'a"b\\c\nd' }))
  })
  it('嵌套对象/空数组/布尔/null', () => {
    expect(canonicalJson({ o: { x: false, y: null, z: [] } })).toBe('{"o":{"x":false,"y":null,"z":[]}}')
  })
  it('数字与数组直接序列化', () => {
    expect(canonicalJson([1, 2.5, -3])).toBe('[1,2.5,-3]')
  })
})

describe('verifyRuntimeSignature（Ed25519 验签）', () => {
  it('正确签名 → ok:true（内置默认公钥）', () => {
    const payload = signRuntimePayload({ announcements: [{ title: 'x', severity: 'info', content: '' }], synced_at: '2026-09-02T00:00:00Z' })
    expect(verifyRuntimeSignature(payload)).toEqual({ ok: true })
  })

  it('显式传入配对的自定义公钥 → ok:true', () => {
    const payload = signRuntimePayload({ announcements: [], synced_at: 't' })
    expect(verifyRuntimeSignature(payload, DEV_PUBLIC_KEY)).toEqual({ ok: true })
  })

  it('签名字段缺失/空 → MISSING_SIGNATURE', () => {
    expect(verifyRuntimeSignature({ announcements: [] }, DEV_PUBLIC_KEY)).toEqual({ ok: false, reason: 'MISSING_SIGNATURE' })
  })

  it('签名长度非 64 字节 → INVALID_SIGNATURE_LENGTH', () => {
    const p2 = { announcements: [], signature: Buffer.alloc(32, 1).toString('base64') }
    expect(verifyRuntimeSignature(p2, DEV_PUBLIC_KEY)).toEqual({ ok: false, reason: 'INVALID_SIGNATURE_LENGTH' })
  })

  it('签名 base64 非法 → INVALID_SIGNATURE_ENCODING', () => {
    const p2 = { announcements: [], signature: '!!!not-base64!!!' }
    expect(verifyRuntimeSignature(p2, DEV_PUBLIC_KEY)).toEqual({ ok: false, reason: 'INVALID_SIGNATURE_ENCODING' })
  })

  it('payload 被篡改 → SIGNATURE_MISMATCH（任一字段变更均拒绝）', () => {
    const payload = signRuntimePayload({ announcements: [{ title: 'original', severity: 'info', content: '' }], synced_at: 't' })
    payload.announcements[0].title = 'evil'
    expect(verifyRuntimeSignature(payload, DEV_PUBLIC_KEY)).toEqual({ ok: false, reason: 'SIGNATURE_MISMATCH' })
  })

  it('payload 非对象（数组/空）→ INVALID_PAYLOAD', () => {
    expect(verifyRuntimeSignature([], DEV_PUBLIC_KEY)).toEqual({ ok: false, reason: 'INVALID_PAYLOAD' })
    expect(verifyRuntimeSignature(null, DEV_PUBLIC_KEY)).toEqual({ ok: false, reason: 'INVALID_PAYLOAD' })
  })

  it('传入非法公钥 PEM → INVALID_PUBLIC_KEY', () => {
    const payload = signRuntimePayload({ announcements: [], synced_at: 't' })
    expect(verifyRuntimeSignature(payload, '-----BEGIN PUBLIC KEY-----\nAAAA\n-----END PUBLIC KEY-----')).toEqual({ ok: false, reason: 'INVALID_PUBLIC_KEY' })
  })

  it('签名用另一把私钥签发 → SIGNATURE_MISMATCH（端到端交叉验证）', () => {
    const other = nodeCrypto.generateKeyPairSync('ed25519')
    const payload = signRuntimePayload({ announcements: [], synced_at: 't' }, other.privateKey.export({ type: 'pkcs8', format: 'pem' }))
    expect(verifyRuntimeSignature(payload, DEV_PUBLIC_KEY)).toEqual({ ok: false, reason: 'SIGNATURE_MISMATCH' })
  })
})

describe('OpsCenterSync 运行时验签 fail-closed', () => {
  it('syncNow 拉取的 runtime 未签名/验签失败 → 整体拒绝不应用（目录结果不受影响）', async () => {
    const store = makeStore()
    const manager = makeManager()
    const svc = new OpsCenterSync({ store, modelProviderManager: manager, log: LOG })
    svc.saveConfig({ url: 'https://ops.example.com', apiKey: 'k' })
    const originalFetch = global.fetch
    global.fetch = vi.fn(async (url) => {
      if (String(url).includes('/runtime/bootstrap')) {
        return jsonResp({ body: { announcements: [{ title: '未签名公告', severity: 'info', content: '' }], synced_at: 't' } })
      }
      return jsonResp({ body: { items: [{ id: 'openai' }] } })
    })
    try {
      const res = await svc.syncNow()
      expect(res.code).toBe(0)
      expect(res.runtimeApplied).toBe(false)
      expect(svc.getRuntimeState().announcements).toEqual([])
      expect(LOG.warn).toHaveBeenCalledWith(expect.anything(), expect.stringContaining('验签失败'))
    } finally {
      global.fetch = originalFetch
      LOG.warn.mockClear()
    }
  })

  it('saveConfig 校验 runtimePublicKey 必须为合法 PEM；非法拒绝保存', () => {
    const store = makeStore()
    const svc = new OpsCenterSync({ store, modelProviderManager: makeManager(), log: LOG })
    const bad = svc.saveConfig({ url: 'https://ops.example.com', apiKey: 'k', runtimePublicKey: 'not-a-pem' })
    expect(bad.code).toBe(-1)
    expect(bad.message).toContain('Ed25519')
    const good = svc.saveConfig({ url: 'https://ops.example.com', apiKey: 'k', runtimePublicKey: DEFAULT_RUNTIME_PUBLIC_KEY })
    expect(good.code).toBe(0)
    expect(good.config.runtimePublicKey).toBe(DEFAULT_RUNTIME_PUBLIC_KEY)
    expect(store._getData()).toContain('runtimePublicKey')
  })

  it('自定义公钥保存后 _fetchRuntime 用其验签：配对的公钥通过，错误公钥拒绝', async () => {
    const store = makeStore()
    const manager = makeManager()
    const svc = new OpsCenterSync({ store, modelProviderManager: manager, log: LOG })
    svc.saveConfig({ url: 'https://ops.example.com', apiKey: 'k', runtimePublicKey: DEV_PUBLIC_KEY })

    const originalFetch = global.fetch
    global.fetch = vi.fn(async (url) => {
      if (String(url).includes('/runtime/bootstrap')) {
        return jsonResp({ body: signRuntimePayload({ announcements: [{ title: 'ok', severity: 'info', content: '' }], synced_at: 't' }, DEV_PRIVATE_KEY) })
      }
      return jsonResp({ body: { items: [{ id: 'openai' }] } })
    })
    try {
      const res = await svc.syncNow()
      expect(res.code).toBe(0)
      expect(res.runtimeApplied).toBe(true)
      expect(svc.getRuntimeState().announcements).toHaveLength(1)
    } finally {
      global.fetch = originalFetch
      LOG.warn.mockClear()
    }

    // 换用另一把私钥签名 → 拒绝
    const other = nodeCrypto.generateKeyPairSync('ed25519')
    const otherPriv = other.privateKey.export({ type: 'pkcs8', format: 'pem' })
    const store2 = makeStore()
    const svc2 = new OpsCenterSync({ store: store2, modelProviderManager: manager, log: LOG })
    svc2.saveConfig({ url: 'https://ops.example.com', apiKey: 'k', runtimePublicKey: DEV_PUBLIC_KEY })
    global.fetch = vi.fn(async (url) => {
      if (String(url).includes('/runtime/bootstrap')) {
        return jsonResp({ body: signRuntimePayload({ announcements: [{ title: 'evil', severity: 'info', content: '' }], synced_at: 't' }, otherPriv) })
      }
      return jsonResp({ body: { items: [{ id: 'openai' }] } })
    })
    try {
      const res2 = await svc2.syncNow()
      expect(res2.code).toBe(0)
      expect(res2.runtimeApplied).toBe(false)
      expect(svc2.getRuntimeState().announcements).toEqual([])
    } finally {
      global.fetch = originalFetch
      LOG.warn.mockClear()
    }
  })
})

describe('OpsCenterSync appMenu（应用菜单配置）', () => {
  const payload = (items, extra = {}) => ({
    announcements: [],
    appMenu: { items, ...extra },
    synced_at: 't',
  })

  it('applyRuntime 规范化 appMenu（排序值截断/布尔白名单）并持久化', () => {
    const store = makeStore()
    const svc = new OpsCenterSync({ store, modelProviderManager: makeManager(), log: LOG })
    svc.applyRuntime(payload([
      { key: 'home', visible: false, sort_order: 2 },
      { key: 'publish', visible: 'false', sort_order: 1e12 },
      { key: 'accounts', visible: '1', sort_order: '3' },
    ], { synced_at: '2026-09-15T00:00:00Z' }))

    expect(svc.getAppMenu()).toEqual({
      items: [
        { key: 'home', visible: false, sort_order: 2, group: null },
        // 'false' 不是白名单真值 → false；1e12 被截断到 MAX_SORT_ORDER
        { key: 'publish', visible: false, sort_order: 9999, group: null },
        { key: 'accounts', visible: true, sort_order: 3, group: null },
      ],
      syncedAt: '2026-09-15T00:00:00Z',
    })
    expect(svc.getRuntimeState().appMenu).toBeTruthy()
    expect(store._getData()).toContain('appMenu')
  })

  it('结构非法（缺失/非对象/items 非数组/超限）→ null，且不影响其它策略', () => {
    const store = makeStore()
    const svc = new OpsCenterSync({ store, modelProviderManager: makeManager(), log: LOG })

    const invalid = [
      undefined,
      null,
      'garbage',
      [],
      {},
      { items: 'nope' },
      { items: Array.from({ length: 201 }, (_, i) => ({ key: 'k' + i })) },
    ]
    for (const appMenu of invalid) {
      svc.applyRuntime({ announcements: [{ title: 'ok', severity: 'info', content: '' }], appMenu, synced_at: 't' })
      expect(svc.getAppMenu()).toBeNull()
      // 其它策略不受影响
      expect(svc.getRuntimeState().announcements).toHaveLength(1)
    }
  })

  it('无 appMenu 字段（旧版运营中心）→ null，其余策略照常应用', () => {
    const store = makeStore()
    const svc = new OpsCenterSync({ store, modelProviderManager: makeManager(), log: LOG })
    svc.applyRuntime({ announcements: [{ title: 'x', severity: 'info', content: '' }], synced_at: 't' })
    expect(svc.getAppMenu()).toBeNull()
    expect(svc.getRuntimeState().announcements).toHaveLength(1)
  })

  it('丢弃原型污染 key 与非法条目，保留合法项', () => {
    const store = makeStore()
    const svc = new OpsCenterSync({ store, modelProviderManager: makeManager(), log: LOG })
    svc.applyRuntime(payload([
      { key: '__proto__', visible: true },
      { key: 'constructor', visible: true },
      { key: '   ', visible: true },
      { key: 'prototype', visible: true },
      null,
      'string',
      { key: ' library ', visible: false, sort_order: 4 },
    ]))

    const items = svc.getAppMenu().items
    expect(items).toHaveLength(1)
    expect(items[0]).toEqual({ key: 'library', visible: false, sort_order: 4, group: null })
    expect(Object.prototype.polluted).toBeUndefined()
  })

  it('非法 sort_order（负数/非数字）→ null（渲染端视为未配置）', () => {
    const store = makeStore()
    const svc = new OpsCenterSync({ store, modelProviderManager: makeManager(), log: LOG })
    svc.applyRuntime(payload([
      { key: 'home', visible: true, sort_order: -1, group: null },
      { key: 'monitor', visible: true, sort_order: 'abc' },
      { key: 'library', visible: true },
    ]))
    expect(svc.getAppMenu().items).toEqual([
      { key: 'home', visible: true, sort_order: null, group: null },
      { key: 'monitor', visible: true, sort_order: null, group: null },
      { key: 'library', visible: true, sort_order: null, group: null },
    ])
  })

  it('空 items 是合法配置（不是 null）', () => {
    const store = makeStore()
    const svc = new OpsCenterSync({ store, modelProviderManager: makeManager(), log: LOG })
    svc.applyRuntime(payload([]))
    expect(svc.getAppMenu()).toEqual({ items: [], syncedAt: '' })
  })

  it('重启后从 settings 恢复 appMenu', () => {
    const store = makeStore()
    const svc1 = new OpsCenterSync({ store, modelProviderManager: makeManager(), log: LOG })
    svc1.applyRuntime(payload([{ key: 'home', visible: false, sort_order: 0 }]))
    const svc2 = new OpsCenterSync({ store, modelProviderManager: makeManager(), log: LOG })
    expect(svc2.getAppMenu().items).toEqual([{ key: 'home', visible: false, sort_order: 0, group: null }])
  })

  it('恢复路径同样归一化：settings 中的非法 appMenu 不进入运行时状态', () => {
    const store = makeStore(JSON.stringify({ appMenu: { items: 'broken' } }))
    const svc = new OpsCenterSync({ store, modelProviderManager: makeManager(), log: LOG })
    expect(svc.getAppMenu()).toBeNull()
  })
})
