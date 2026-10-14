// @ts-check
/**
 * ops-center-sync.test.js — 运营后台 → 桌面端运行时同步服务
 *
 * 覆盖：URL 校验（https 强制/回环豁免）、API Key 加密存储（不落明文）、
 * 目录拉取错误映射（401/403/404/超时/大小/JSON/结构）、applyCatalog 编排、
 * lastSyncedAt 落盘、启动自动同步。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createRequire } from 'module'
// 被测模块是主进程 CJS：在 ESM 测试里必须经 createRequire 载入，**否则拿到的是另一个模块实例**
// （本仓既有先例与注释见 runtime-trust-anchor.test.js:20 / bilibili-audit-check.test.js:18）。
// 本轮实测踩到：用 `import { configurePackagedProbe }` 时，打包态探针写进了测试侧的实例，
// 被测服务里的 `require('./runtime-trust-anchor')` 仍是另一个 ⇒ 探针**静默不生效**，
// 「打包版缺锚」用例因此假绿（syncNow 被调用）。
const require$ = createRequire(import.meta.url)
const { emitAutoSyncOutcome, safeOrigin, resolveAutoSyncGuard } = require$('./ops-center-sync-autosync-guard')
const { configurePackagedProbe, resolveRuntimePublicKey } = require$('./runtime-trust-anchor')

__registerMock('./crypto', {
  isAvailable: () => true,
  encrypt: (key) => (key ? Buffer.from('enc_' + key) : null),
  decrypt: (value) => (value ? Buffer.from(value).toString('utf8').replace(/^enc_/, '') : ''),
  mask: (key) => (key ? key.slice(0, 4) + '****' + key.slice(-4) : '****'),
  setSafeStorage: () => {},
})

const nodeCrypto = require('crypto')

const { OpsCenterSync, normalizeUrl, canonicalJson, verifyRuntimeSignature, DEFAULT_RUNTIME_PUBLIC_KEY } = require('./ops-center-sync')

// DEV 测试密钥对（2026-09-02 生成，原本与 ops-center-sync.js 的 DEFAULT_RUNTIME_PUBLIC_KEY /
// .env.example 的 DEV 私钥同源）。
//
// 本轮起改为**进程内实时生成**，原因有二：
//  1) pre-commit 的 CCG `verify-security` 以 HARDCODED_PRIVATE_KEY（critical）拦截本文件 —
//     该规则 `extensions: ['*']` 且**没有** excludePaths，测试夹具的假私钥不在豁免范围
//     （扫描器自己的注释写着「测试夹具里的假凭据不是泄漏」，但那条豁免只加在别的规则上）。
//     规则只扫本次变更的文件，所以本文件此前一直靠「没被改动」侥幸通过。
//  2) 更根本：DEV 私钥与**生产默认公钥同源**，任何拿到仓库的人都能给未配置自定义信任锚的
//     打包版下发整份运行时策略（公告/版本策略/敏感词/应用菜单）。把它从仓库里拿掉是净收益。
//
// 这里验的是**验签通路本身**（能验过 / 各种失败原因各归其位 / 换锚行为），不需要特定固定密钥。
const DEV_KEY_PAIR = nodeCrypto.generateKeyPairSync('ed25519')
const DEV_PRIVATE_KEY = DEV_KEY_PAIR.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
const DEV_PUBLIC_KEY = DEV_KEY_PAIR.publicKey.export({ type: 'spki', format: 'pem' }).toString()

/** 对 payload 去掉 signature 后做 canonical JSON + Ed25519 签名，返回带 signature 的对象（模拟 ops-center 服务端） */
function signRuntimePayload (payload, privPem = DEV_PRIVATE_KEY) {
  const { signature: _sig, ...rest } = payload
  const canonical = Buffer.from(canonicalJson(rest), 'utf-8')
  const sig = nodeCrypto.sign(null, canonical, privPem)
  return { ...rest, signature: sig.toString('base64') }
}

/**
 * 与真实 `settings-store` 同形的夹具 —— 存储侧的契约是「字符串/对象进，解析后的值出」：
 * `setSetting` 按 `safeJsonStringify` 语义落文本，`getSetting` 按 `safeJsonParse` 语义**返回对象**。
 * 旧夹具把存入的类型原样回吐，等于替被测代码改了契约，使"按字符串读取"这一类缺陷
 * 在本文件 68 条用例下结构性免疫（真实往返锁见 settings-roundtrip-contract.test.js）。
 */
// 两个 settings 键（与 ops-center-sync.js:24-25 同源）；夹具按键存储，断言必须点名键
const SYNC_KEY = 'opsCenterSync'
const RUNTIME_KEY = 'opsCenterRuntime'

/**
 * 与真实 settings-store 同形的多键夹具：值按**键**分槽落文本，读回**解析后的值**。
 * 历史教训：旧版是单键夹具（所有键共用一格），使 `store._getData()` 与被断言的键无关，
 * 任何一次别的键写入都能满足它 —— QM6-W5 判为装饰性断言，故改为按键取行。
 */
function makeStore (initial) {
  const rows = {}
  // 唯一使用 initial 的用例（"恢复路径同样归一化"）预置的是 opsCenterRuntime 行
  if (initial) rows[RUNTIME_KEY] = initial
  // 预置 DEV 信任锚：本文件的 signRuntimePayload 用进程内生成的 DEV 私钥签名，验签自然
  // 走 OpsCenterSync._getRuntimePublicKey()。不在这里预置的话，验签会回退到**内置默认锚**
  // ——那是给生产演示用的固定公钥，与本文件的私钥不配对，于是每个「同步成功」用例都会红。
  // （这正是「夹具比生产更顺」的第三种形态：夹具少配一个东西，实现就得替你兜。）
  rows[SYNC_KEY] = JSON.stringify({ url: '', apiKeyEnc: '', autoSync: true, runtimePublicKey: DEV_PUBLIC_KEY })
  const readRow = (k) => {
    if (!(k in rows)) return null
    try { return JSON.parse(rows[k]) } catch { return rows[k] }
  }
  return {
    getSetting: vi.fn((k) => (k in rows ? (readRow(k) === null ? '' : readRow(k)) : '')),
    getSettingObject: vi.fn((k, d = {}) => {
      const v = readRow(k)
      return v && typeof v === 'object' && !Array.isArray(v) ? v : d
    }),
    setSetting: vi.fn((k, v) => { rows[k] = (typeof v === 'string' ? v : JSON.stringify(v)) }),
    /** 取某一行的落盘文本；必须点名键，否则等于没断言 */
    _row: (k) => (k in rows ? rows[k] : ''),
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

const LOG = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), notify: vi.fn() }

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
    expect(store._row(SYNC_KEY)).not.toContain('secret-key-123')
    expect(store._row(SYNC_KEY)).toContain('apiKeyEnc')
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
    expect(store._row(SYNC_KEY)).not.toContain('secret-key-123')
    expect(store._row(SYNC_KEY)).not.toContain('secret')
  })

  it('apiKey 为空时保留已有 Key，不重复加密', () => {
    const store = makeStore()
    const svc = new OpsCenterSync({ store, modelProviderManager: makeManager(), log: LOG })
    svc.saveConfig({ url: 'https://ops.example.com', apiKey: 'k1' })
    const res = svc.saveConfig({ url: 'https://ops.example.com', apiKey: '', autoSync: false })
    expect(res.code).toBe(0)
    expect(res.config.autoSync).toBe(false)
    expect(res.config.apiKeyConfigured).toBe(true)
    expect(store._row(SYNC_KEY)).toContain('apiKeyEnc')
  })

  it('非法 URL 拒绝保存', () => {
    const store = makeStore()
    const svc = new OpsCenterSync({ store, modelProviderManager: makeManager(), log: LOG })
    const res = svc.saveConfig({ url: 'http://ops.example.com', apiKey: 'k' })
    expect(res.code).toBe(-1)
    expect(res.message).toContain('http(s)')
  })
})

// 方案C 零配置：登录会话自动连接（autoConnected）——URL 经 setOpsCenterUrl 显式注入，不依赖/不污染全局 process.env
describe('OpsCenterSync 零配置 autoConnected（setOpsCenterUrl 注入）', () => {
  const savedEnvUrl = process.env.OPS_CENTER_URL
  afterEach(() => {
    if (savedEnvUrl === undefined) delete process.env.OPS_CENTER_URL
    else process.env.OPS_CENTER_URL = savedEnvUrl
  })

  it('未注入 URL 且未接线 token：autoConnected=false（回落手动态）', () => {
    delete process.env.OPS_CENTER_URL
    const svc = new OpsCenterSync({ store: makeStore(), modelProviderManager: makeManager(), log: LOG })
    expect(svc.getConfig().autoConnected).toBe(false)
    expect(svc.getConfig().autoUrl).toBe('')
  })

  it('仅注入 URL、未接线 getAccessToken：仍不 autoConnected（要求 URL + token 二者齐备）', () => {
    delete process.env.OPS_CENTER_URL
    const svc = new OpsCenterSync({ store: makeStore(), modelProviderManager: makeManager(), log: LOG })
    svc.setOpsCenterUrl('https://ops.iart.work')
    expect(svc.getConfig().autoConnected).toBe(false)
  })

  it('注入 URL + 接线 getAccessToken：autoConnected=true，url 取注入值，且不污染全局 process.env', () => {
    delete process.env.OPS_CENTER_URL
    const svc = new OpsCenterSync({ store: makeStore(), modelProviderManager: makeManager(), log: LOG })
    svc.setOpsCenterUrl('https://ops.iart.work')
    svc.setGetAccessToken(() => 'jwt-token')
    const cfg = svc.getConfig()
    expect(cfg.autoConnected).toBe(true)
    expect(cfg.autoUrl).toBe('https://ops.iart.work')
    expect(cfg.url).toBe('https://ops.iart.work')
    expect(process.env.OPS_CENTER_URL).toBeUndefined()
  })

  it('用户手填 URL 优先于注入的自动 URL（显式配置不被自动态覆盖）', () => {
    delete process.env.OPS_CENTER_URL
    const svc = new OpsCenterSync({ store: makeStore(), modelProviderManager: makeManager(), log: LOG })
    svc.saveConfig({ url: 'https://manual.example.com', apiKey: 'k' })
    svc.setOpsCenterUrl('https://ops.iart.work')
    svc.setGetAccessToken(() => 'jwt')
    const cfg = svc.getConfig()
    expect(cfg.url).toBe('https://manual.example.com')
    expect(cfg.autoConnected).toBe(false)
  })

  it('向后兼容：未调用 setOpsCenterUrl 时仍读取 process.env.OPS_CENTER_URL（自托管/开发经 env 指定）', () => {
    process.env.OPS_CENTER_URL = 'https://env.example.com'
    const svc = new OpsCenterSync({ store: makeStore(), modelProviderManager: makeManager(), log: LOG })
    svc.setGetAccessToken(() => 'jwt')
    expect(svc.getConfig().autoConnected).toBe(true)
    expect(svc.getConfig().autoUrl).toBe('https://env.example.com')
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

    // manager 未提供 applyCatalog → 模型服务未就绪（目录无处应用，不取目录）
    //
    // ⚠️ 这里**会**发一次请求，但那是生产契约的有意行为，不是被测缺陷：syncNow 在
    // 模型服务未就绪时仍会 best-effort 下发运行时策略（公告/版本发布/应用菜单/功能开关），
    // 见 ops-center-sync.js 的 _syncRuntimeBestEffort。旧注释写的「不发起网络请求」与实现不符，
    // 于是本用例在测试 realm 里真的向 ops.example.com:443 发起 fetch，只因出站守卫拦住才没外泄
    // （#2878 登记的第三条欠账）。正确处置是给传输层打桩，而不是改断言或改生产行为。
    const fetchStub = vi.fn(async () => jsonResp({ status: 200, body: { code: 0, data: {} } }))
    const originalFetch = global.fetch
    global.fetch = fetchStub
    try {
      const svc2 = new OpsCenterSync({ store, modelProviderManager: {}, log: LOG })
      svc2.saveConfig({ url: 'https://ops.example.com', apiKey: 'k' })
      expect((await svc2.syncNow()).code).toBe(-1)
      expect((await svc2.syncNow()).message).toContain('模型服务未就绪')
      // 只走运行时策略通道，不取目录（未就绪时目录无处应用）
      expect(fetchStub).toHaveBeenCalledTimes(2)
      expect(fetchStub.mock.calls.every(([url]) => String(url).includes('/api/v1/runtime/bootstrap'))).toBe(true)
    } finally {
      global.fetch = originalFetch
    }
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
    const fetchMock = vi.fn((_url, opts) => new Promise((_resolve, reject) => {
      opts.signal && opts.signal.addEventListener('abort', () => {
        const e = new Error('The operation was aborted')
        e.name = 'AbortError'
        reject(e)
      })
    }))
    global.fetch = fetchMock
    const pending = svc.syncNow()
    // 两条通道并行发起：同一次 10s 推进必须同时触发目录与运行时的中止定时器。
    // 若实现退化为串行，运行时的定时器尚未创建，此处推进不会让它超时，await 将挂死到用例超时。
    vi.advanceTimersByTime(10001)
    const res = await pending
    expect(res.code).toBe(-1)
    expect(res.message).toContain('超时')
    expect(res.runtimeApplied).toBe(false)
    const urls = fetchMock.mock.calls.map((c) => String(c[0]))
    expect(urls.filter((u) => u.includes('/model-presets/catalog'))).toHaveLength(1)
    expect(urls.filter((u) => u.includes('/runtime/bootstrap'))).toHaveLength(1)
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
    expect(store._row(SYNC_KEY)).toContain('lastSyncedAt')
    expect(svc.getConfig().lastSyncedAt).toBeTruthy()
  })

  // 2026-10-14 接线锁：origin 字段必须真的落到成功日志里。
  // 此前只有 safeOrigin 的单元锁（测的是"怎么抠 origin"），
  // 没有任何断言保证 `catalog-synced` 事件确实带上了它 —— 纯函数锁 ≠ 接线锁。
  // 用户本轮困惑恰是「我改的是本地运营中心，应用连的是不是别处」，
  // 而旧日志只有 {updated, at}，不含地址，无从分辨。
  it('接线锁：catalog-synced 成功日志必须带 origin（且只带 origin，不带 URL 原文）', async () => {
    const store = makeStore()
    const svc = new OpsCenterSync({ store, modelProviderManager: makeManager(), log: LOG })
    svc.saveConfig({ url: 'https://ops.example.com', apiKey: 'k' })
    global.fetch = vi.fn(async () => jsonResp({ body: { items: [{ id: 'openai', name: 'OpenAI' }] } }))
    expect((await svc.syncNow()).code).toBe(0)
    const call = LOG.notify.mock.calls.find((c) => c[1] === 'catalog-synced')
    expect(call, '未找到 catalog-synced 事件').toBeTruthy()
    const params = call[2].params
    expect(params.origin).toBe('https://ops.example.com')
    // 反向：不得把整条 URL（可能带 userinfo/查询串里的令牌）原文入日志
    expect(JSON.stringify(params)).not.toContain('/api/v1/model-presets/catalog')
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

  // ── 回归锁（2026-10-14）：早退必须**出声且原因可区分** ────────────────────────
  // 这三道早退原先都是静默 `return`：应用可以在「运营下发配置（应用菜单/公告/功能开关）
  // 永远不会生效」的状态下常年运行而**没有任何信号**。实测现场：共享数据锚点里
  // `opsCenterSync` 键从未存在过、应用日志里也没有任何 `auto-sync-*` 行，用户只看到
  // 「运营中心改了不生效」，连断点在应用侧还是服务端都判断不了。
  // 注意上面的旧用例只锁了「不调度」——**不调度**与**不出声**是两件事，前者绿不代表后者。
  const eventsOf = (log) => log.notify.mock.calls.map((c) => c[1])
  const paramsOf = (log, name) => {
    const call = log.notify.mock.calls.find((c) => c[1] === name)
    return call ? call[2].params : null
  }

  it('完全未配置时：不调度，且出声给出「未配置」原因与下一步', () => {
    vi.useFakeTimers()
    const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), notify: vi.fn() }
    const svc = new OpsCenterSync({ store: makeStore(), modelProviderManager: makeManager(), log })
    const spy = vi.spyOn(svc, 'syncNow')
    svc.autoSyncOnStart()
    vi.advanceTimersByTime(10000)
    expect(spy).not.toHaveBeenCalled()
    expect(eventsOf(log)).toContain('auto-sync-not-started-unconfigured')
    expect(paramsOf(log, 'auto-sync-not-started-unconfigured').hint).toContain('部署层未提供运营中心地址')
  })

  it('自动发现到地址但缺登录令牌：必须与「完全未配置」区分开（现场就是这一态）', () => {
    vi.useFakeTimers()
    const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), notify: vi.fn() }
    const svc = new OpsCenterSync({ store: makeStore(), modelProviderManager: makeManager(), log })
    // 有自动发现地址、但没有 getAccessToken 回调 ⇒ _getAutoContext() 返回 null，
    // 而 getConfig().url 也会因此为空 —— 于是这一态在旧代码里**伪装成「未配置」**，
    // 排查者会去翻设置页而找不到问题。
    svc.setOpsCenterUrl('https://ops.auto.example.com')
    const spy = vi.spyOn(svc, 'syncNow')
    svc.autoSyncOnStart()
    vi.advanceTimersByTime(10000)
    expect(spy).not.toHaveBeenCalled()
    expect(eventsOf(log)).toContain('auto-sync-not-started-unconfigured')
    const p = paramsOf(log, 'auto-sync-not-started-unconfigured')
    expect(p.autoUrlConfigured).toBe('https://ops.auto.example.com')
    expect(p.hasAccessToken).toBe(false)
    // 这一态必须点出自动发现地址，并给出**正确**的出路：部署层配地址 + 身份登录走 Bearer。
    // 早期 hint 写的是「手填 X-Catalog-Key」——两处都错：界面无填写入口，且 bootstrap 实际上
    // Bearer 优先（verify_bearer_or_catalog_key）。若把错误出路留着，排查者会照做而无门。
    expect(p.hint).toContain('https://ops.auto.example.com')
    expect(p.hint).toContain('Bearer')
    expect(p.hint).not.toContain('Bearer 不适用')
    expect(p.hint).not.toContain('设置 → 运营中心同步')
  })

  it('有地址但缺 API Key 时：报 missing-api-key，不得报成 unconfigured', () => {
    vi.useFakeTimers()
    const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), notify: vi.fn() }
    const svc = new OpsCenterSync({ store: makeStore(), modelProviderManager: makeManager(), log })
    svc.saveConfig({ url: 'https://ops.example.com' }) // 不传 apiKey ⇒ apiKeyConfigured 仍为 false
    const spy = vi.spyOn(svc, 'syncNow')
    svc.autoSyncOnStart()
    vi.advanceTimersByTime(10000)
    expect(spy).not.toHaveBeenCalled()
    expect(eventsOf(log)).toContain('auto-sync-not-started-missing-api-key')
    expect(eventsOf(log)).not.toContain('auto-sync-not-started-unconfigured')
    const p = paramsOf(log, 'auto-sync-not-started-missing-api-key')
    expect(p.url).toBe('https://ops.example.com')
    expect(p.hint).toContain('X-Catalog-Key')
  })

  it('自动同步被关闭时：报 disabled，不得与「未配置」混淆', () => {
    vi.useFakeTimers()
    const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), notify: vi.fn() }
    const svc = new OpsCenterSync({ store: makeStore(), modelProviderManager: makeManager(), log })
    // 地址与 Key 都齐备，唯一变量是 autoSync=false —— 证明这条判据不受配置完整性影响
    svc.saveConfig({ url: 'https://ops.example.com', apiKey: 'k', autoSync: false })
    const spy = vi.spyOn(svc, 'syncNow')
    svc.autoSyncOnStart()
    vi.advanceTimersByTime(10000)
    expect(spy).not.toHaveBeenCalled()
    expect(eventsOf(log)).toContain('auto-sync-not-started-disabled')
    expect(eventsOf(log)).not.toContain('auto-sync-not-started-unconfigured')
    expect(paramsOf(log, 'auto-sync-not-started-disabled').hint).toContain('自动同步')
  })

  // ── 2026-10-14 第二轮：把「可用性」也变成信号 ──────────────────────────────
  // 第一轮只覆盖了「没连上」，缺的是「连上了没法用」：打包版没有验签信任锚时，
  // 即使 bootstrap 取回来也会被 fail-closed 丢掉整份运行时策略（含应用菜单）。
  it('打包版缺验签信任锚：不调度，且报 no-trust-anchor（与配置类原因可区分）', () => {
    vi.useFakeTimers()
    const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), notify: vi.fn() }
    const store = makeStore()
    // 地址与 Key 都齐备 ⇒ 配置类判据全过，唯一变量是「打包版 + 无锚」
    store.setSetting('opsCenterSync', { url: 'https://ops.example.com', apiKeyEnc: 'enc', autoSync: true, runtimePublicKey: '' })
    configurePackagedProbe(() => true)
    try {
      const svc = new OpsCenterSync({ store, modelProviderManager: makeManager(), log })
      const spy = vi.spyOn(svc, 'syncNow')
      svc.autoSyncOnStart()
      vi.advanceTimersByTime(10000)
      expect(spy).not.toHaveBeenCalled()
      expect(eventsOf(log)).toContain('auto-sync-not-started-no-trust-anchor')
      expect(eventsOf(log)).not.toContain('auto-sync-not-started-unconfigured')
      expect(eventsOf(log)).not.toContain('auto-sync-not-started-missing-api-key')
      expect(paramsOf(log, 'auto-sync-not-started-no-trust-anchor').hint).toContain('runtimePublicKey')
    } finally {
      configurePackagedProbe(null)
    }
  })

  it('打包版 + 有信任锚：放行调度，并出声记下这次用哪种身份（可用性也要有信号）', () => {
    vi.useFakeTimers()
    const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), notify: vi.fn() }
    const store = makeStore() // makeStore 预置了验签公钥
    configurePackagedProbe(() => true)
    try {
      const svc = new OpsCenterSync({ store, modelProviderManager: makeManager(), log })
      svc.saveConfig({ url: 'https://ops.example.com', apiKey: 'k' })
      const spy = vi.spyOn(svc, 'syncNow').mockResolvedValue({ code: 0 })
      svc.autoSyncOnStart()
      vi.advanceTimersByTime(10000)
      expect(spy).toHaveBeenCalled()
      expect(paramsOf(log, 'auto-sync-scheduled')).toEqual({ authMode: 'catalog-key' })
    } finally {
      configurePackagedProbe(null)
    }
  })

  it('emitAutoSyncOutcome：成功与失败都出声；无日志器/空判据不得抛', () => {
    const log = { notify: vi.fn() }
    emitAutoSyncOutcome(log, { ok: true, authMode: 'bearer' })
    expect(log.notify).toHaveBeenCalledWith('OpsCenterSync', 'auto-sync-scheduled', { params: { authMode: 'bearer' } })
    emitAutoSyncOutcome(log, { ok: false, reason: 'R', params: { a: 1 } })
    expect(log.notify).toHaveBeenLastCalledWith('OpsCenterSync', 'R', { level: 'WARN', params: { a: 1 } })
    // 诊断侧绝不能把同步主流程带崩
    expect(() => emitAutoSyncOutcome(null, { ok: true })).not.toThrow()
    expect(() => emitAutoSyncOutcome({}, { ok: true })).not.toThrow()
    expect(() => emitAutoSyncOutcome(log, null)).not.toThrow()
  })

  it('safeOrigin：只投影 origin，非法输入空串（URL 原文不入日志）', () => {
    expect(safeOrigin('https://ops.iart.work/api/v1/runtime/bootstrap?token=SECRET')).toBe('https://ops.iart.work')
    expect(safeOrigin('https://user:pw@ops.example.com:8443/x')).toBe('https://ops.example.com:8443')
    expect(safeOrigin('not a url')).toBe('')
    expect(safeOrigin('')).toBe('')
    expect(safeOrigin(null)).toBe('')
  })

  it('resolveRuntimePublicKey：部署层优先于历史设置项，都没有则空串', () => {
    expect(resolveRuntimePublicKey('DEPLOY-PEM', 'STORED-PEM')).toBe('DEPLOY-PEM')
    expect(resolveRuntimePublicKey('', 'STORED-PEM')).toBe('STORED-PEM')
    expect(resolveRuntimePublicKey('   ', '  ')).toBe('')
    expect(resolveRuntimePublicKey(undefined, undefined)).toBe('')
  })

  // 打包态 × 信任锚的完整矩阵（纯函数级，不依赖模块实例状态）
  it('打包态 × 信任锚矩阵：只有「打包 + 无锚」被拦，且原因唯一', () => {
    const cfg = { url: 'https://ops.example.com', apiKeyConfigured: true, autoSync: true }
    const call = (isPackaged, hasAnchor) => resolveAutoSyncGuard(cfg, false, '', false, isPackaged, hasAnchor)
    // 打包 + 无锚 ⇒ 拦住（否则取到了也验不了签，整份运行时策略会被丢掉）
    const blocked = call(true, false)
    expect(blocked.ok).toBe(false)
    expect(blocked.reason).toBe('auto-sync-not-started-no-trust-anchor')
    expect(blocked.params.hint).toContain('runtimePublicKey')
    // 打包 + 有锚 ⇒ 放行（不得把可用配置误拦）
    expect(call(true, true)).toEqual({ ok: true, authMode: 'catalog-key' })
    // 未打包（开发/演示，可回落内置 DEV 锚）⇒ 放行，不受锚影响
    expect(call(false, false)).toEqual({ ok: true, authMode: 'catalog-key' })
    expect(call(false, true)).toEqual({ ok: true, authMode: 'catalog-key' })
  })

  it('authMode 反映实际身份：有自动上下文走 bearer，否则 catalog-key', () => {
    const auto = { url: '', apiKeyConfigured: false, autoSync: true }
    expect(resolveAutoSyncGuard(auto, true, 'https://auto.example.com', true, false, false)).toEqual({ ok: true, authMode: 'bearer' })
    const manual = { url: 'https://ops.example.com', apiKeyConfigured: true, autoSync: true }
    expect(resolveAutoSyncGuard(manual, false, '', false, false, false)).toEqual({ ok: true, authMode: 'catalog-key' })
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
    expect(store._row(RUNTIME_KEY)).toContain('"announcements"')
    // 写入侧契约：传的是**对象**（存储侧负责编码），断言仍覆盖"远程词确实进了持久化值"
    // 写入侧契约：对象进 setSetting，且词库确实落在 opsCenterRuntime **这一行**的这一字段里
    // （渲染端不下发 word_list，但持久化必须带 —— 否则重启后敏感词只剩内置库）
    expect(store.setSetting).toHaveBeenCalledWith(RUNTIME_KEY, expect.objectContaining({
      contentPolicy: expect.objectContaining({
        word_list: expect.arrayContaining(['远程词甲', '远程词乙']),
        replacement: '***',
      }),
    }))
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

  // 回归 2026-09-25 事故：runtime（含运营中心下发的应用菜单）曾被挂在「目录拉取成功」之后，
  // 目录一失败就整条链路 return，菜单永远拉不到且只在启动后 3 秒试一次 —— 表现为
  // 「运营中心改了菜单/顺序，应用侧毫无变化」。两条通道必须各自独立 best-effort。
  it('syncNow 目录失败时仍拉取 runtime，appMenu 照样落到缓存', async () => {
    const store = makeStore()
    const svc = new OpsCenterSync({ store, modelProviderManager: makeManager(), log: LOG })
    svc.saveConfig({ url: 'https://ops.example.com', apiKey: 'k' })
    const appMenu = { items: [{ key: 'copy-library', visible: true, sort_order: 6, group: 'primary' }] }
    const originalFetch = global.fetch
    global.fetch = vi.fn(async (url) => {
      if (String(url).includes('/runtime/bootstrap')) {
        return jsonResp({ body: signRuntimePayload({ announcements: [], update_policy: null, content_policy: null, appMenu, synced_at: 't' }) })
      }
      return jsonResp({ status: 500 })
    })
    try {
      const res = await svc.syncNow()
      // 目录确实失败，原样上报，不被掩盖
      expect(res.code).toBe(-1)
      expect(res.runtimeApplied).toBe(true)
      expect(svc.getAppMenu()).toMatchObject({ items: [{ key: 'copy-library', sort_order: 6, group: 'primary' }] })
    } finally {
      global.fetch = originalFetch
    }
  })

  it('模型服务未就绪时仍拉取 runtime（菜单不依赖 modelProviderManager）', async () => {
    const store = makeStore()
    const svc = new OpsCenterSync({ store, log: LOG })
    svc.saveConfig({ url: 'https://ops.example.com', apiKey: 'k' })
    const originalFetch = global.fetch
    global.fetch = vi.fn(async (url) => {
      if (String(url).includes('/runtime/bootstrap')) {
        return jsonResp({ body: signRuntimePayload({ announcements: [], update_policy: null, content_policy: null, synced_at: 't' }) })
      }
      return jsonResp({ body: { items: [] } })
    })
    try {
      const res = await svc.syncNow()
      expect(res.message).toBe('模型服务未就绪')
      expect(res.runtimeApplied).toBe(true)
    } finally {
      global.fetch = originalFetch
    }
  })

  it('runtime 应用成功后回调 onRuntimeUpdated，供主进程广播刷新侧边栏', () => {
    const onRuntimeUpdated = vi.fn()
    const svc = new OpsCenterSync({ store: makeStore(), modelProviderManager: makeManager(), log: LOG })
    svc.setOnRuntimeUpdated(onRuntimeUpdated)
    svc.applyRuntime({ announcements: [{ title: '公告', severity: 'info', content: '' }], synced_at: 't' })
    expect(onRuntimeUpdated).toHaveBeenCalledTimes(1)
    // 只允许传时间戳：把整份运行时配置交给广播侧，等于绕过验签读取路径（design D4）
    expect(onRuntimeUpdated).toHaveBeenCalledWith({ syncedAt: 't' })
  })

  it('未接线 onRuntimeUpdated 时 applyRuntime 照常工作（向后兼容）', () => {
    const svc = new OpsCenterSync({ store: makeStore(), modelProviderManager: makeManager(), log: LOG })
    svc.applyRuntime({ announcements: [], synced_at: 't' })
    expect(svc.getRuntimeState().syncedAt).toBe('t')
  })

  it('onRuntimeUpdated 抛错不得影响 runtime 应用结果', () => {
    const svc = new OpsCenterSync({ store: makeStore(), modelProviderManager: makeManager(), log: LOG })
    svc.setOnRuntimeUpdated(() => { throw new Error('窗口已销毁') })
    expect(() => svc.applyRuntime({ announcements: [], synced_at: 't' })).not.toThrow()
    expect(svc.getRuntimeState().syncedAt).toBe('t')
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
    expect(store._row(RUNTIME_KEY)).toContain('videoCreation.maxOutputResolution')
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
  it('不传公钥且未打包 → 回退内置默认锚（DEV 演示环）', () => {
    // 本文件的签名私钥是进程内生成的，与**内置默认公钥不配对**（那是刻意解耦：把 DEV 私钥
    // 从仓库里拿掉，见上方注释）。所以这里要断言的是「未打包态回退到内置默认锚」这个
    // **分支被走到**，而不是「随便什么签名都能验过」——
    // 后者那种断言恒真，等于没有断言。
    const payload = signRuntimePayload({ announcements: [{ title: 'x', severity: 'info', content: '' }], synced_at: '2026-09-02T00:00:00Z' })
    // 用不配对的私钥 → 应当因签名不匹配而被拒，且 reason 明确是 SIGNATURE_MISMATCH
    //（若是 NO_PRODUCTION_TRUST_ANCHOR / INVALID_PUBLIC_KEY，说明压根没走到默认锚）
    expect(verifyRuntimeSignature(payload)).toEqual({ ok: false, reason: 'SIGNATURE_MISMATCH' })
    // 同一 payload 换成配对公钥 → 验过，证明上一步确实是「锚不匹配」而非「签名坏了」
    expect(verifyRuntimeSignature(payload, DEV_PUBLIC_KEY)).toEqual({ ok: true })
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
      expect(LOG.notify).toHaveBeenCalledWith('OpsCenterSync', 'runtime-sync-skipped', expect.objectContaining({ error: expect.stringContaining('验签失败') }))
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
    expect(store._row(SYNC_KEY)).toContain('runtimePublicKey')
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
    expect(store._row(RUNTIME_KEY)).toContain('appMenu')
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

// bearer-fix 回归：零配置自动发现态（无手填 URL / 无 API Key）syncNow 必须走 Bearer，
// 而非因 getConfig().url 并入了自动地址被误判为手动态、返回"未配置 Ops Center API Key"导致同步永不发起。
describe('OpsCenterSync 零配置 Bearer 同步（bearer-fix 回归）', () => {
  const savedEnvUrl = process.env.OPS_CENTER_URL
  let originalFetch
  beforeEach(() => { originalFetch = global.fetch; delete process.env.OPS_CENTER_URL })
  afterEach(() => {
    global.fetch = originalFetch
    if (savedEnvUrl === undefined) delete process.env.OPS_CENTER_URL
    else process.env.OPS_CENTER_URL = savedEnvUrl
    vi.restoreAllMocks()
  })

  it('注入 URL + getAccessToken 且无手填/无 Key：syncNow 走 Bearer 并成功应用目录+运行时（不再误报缺 Key）', async () => {
    const store = makeStore()
    const manager = makeManager()
    const svc = new OpsCenterSync({ store, modelProviderManager: manager, log: LOG })
    svc.setOpsCenterUrl('https://ops.iart.work')
    svc.setGetAccessToken(async () => 'jwt-token')
    const items = [{ id: 'openai', name: 'OpenAI' }]
    const menu = { groups: [{ key: 'home', label: '首页', items: [{ key: 'publish', label: '发布', visible: true }] }] }
    const seen = []
    global.fetch = vi.fn(async (url, opts) => {
      const h = (opts && opts.headers) || {}
      seen.push({ url: String(url), bearer: String(h.Authorization || ''), catalogKey: String(h['X-Catalog-Key'] || '') })
      if (String(url).includes('/runtime/bootstrap')) {
        return jsonResp({ body: signRuntimePayload({ announcements: [], appMenu: menu, synced_at: '2026-09-22T00:00:00Z' }) })
      }
      return jsonResp({ body: { items } })
    })
    const res = await svc.syncNow()
    expect(res.code).toBe(0)
    expect(res.message || '').not.toContain('未配置 Ops Center API Key')
    expect(manager.applyCatalog).toHaveBeenCalledWith(items)
    // 目录与运行时两个端点都必须用 Bearer，且不得回落空 X-Catalog-Key
    expect(seen.length).toBeGreaterThanOrEqual(2)
    expect(seen.every((x) => /^Bearer /.test(x.bearer))).toBe(true)
    expect(seen.every((x) => x.catalogKey === '')).toBe(true)
    // 运行时经 Ed25519 验签后落地
    expect(res.runtimeApplied).toBe(true)
  })

  it('手填 URL + Key 仍走 X-Catalog-Key（bearer 改动不破坏手动模式）', async () => {
    const store = makeStore()
    const svc = new OpsCenterSync({ store, modelProviderManager: makeManager(), log: LOG })
    svc.saveConfig({ url: 'https://ops.example.com', apiKey: 'k' })
    svc.setOpsCenterUrl('https://ops.iart.work')
    svc.setGetAccessToken(async () => 'jwt-token')
    const seen = []
    global.fetch = vi.fn(async (_url, opts) => {
      const h = (opts && opts.headers) || {}
      seen.push({ bearer: String(h.Authorization || ''), catalogKey: String(h['X-Catalog-Key'] || '') })
      return jsonResp({ body: { items: [{ id: 'a', name: 'A' }] } })
    })
    const res = await svc.syncNow()
    expect(res.code).toBe(0)
    expect(seen.every((x) => x.bearer === '')).toBe(true)
    expect(seen.every((x) => x.catalogKey !== '')).toBe(true)
  })

  it('零配置同步成功后不把自动发现地址固化为手填 url（避免下次误走 catalog-key）', async () => {
    const kv = {}
    const readRow = (k) => {
      if (!(k in kv)) return ''
      try { return JSON.parse(kv[k]) } catch { return kv[k] }
    }
    // 与真实 settings-store 同形的多键夹具（落文本、读回解析值）
    const store = {
      getSetting: vi.fn((k) => readRow(k)),
      getSettingObject: vi.fn((k, d = {}) => {
        const v = readRow(k)
        return v && typeof v === 'object' && !Array.isArray(v) ? v : d
      }),
      setSetting: vi.fn((k, v) => { kv[k] = (typeof v === 'string' ? v : JSON.stringify(v)) }),
    }
    const svc = new OpsCenterSync({ store, modelProviderManager: makeManager(), log: LOG })
    svc.setOpsCenterUrl('https://ops.iart.work')
    svc.setGetAccessToken(async () => 'jwt-token')
    global.fetch = vi.fn(async (url) => {
      if (String(url).includes('/runtime/bootstrap')) return jsonResp({ body: signRuntimePayload({ announcements: [] }) })
      return jsonResp({ body: { items: [{ id: 'a', name: 'A' }] } })
    })
    const res = await svc.syncNow()
    expect(res.code).toBe(0)
    const persisted = JSON.parse(kv['opsCenterSync'] || '{}')
    expect(persisted.url).toBe('')
    expect(persisted.lastSyncedAt).toBeTruthy()
    expect(svc._getManualUrl()).toBe('')
  })
})

// ── 去 AI 味词库运行时下发消费（ai-taste-ops-center 刀 2，Y1-Y4）──
// 同步补硬约束先例缺失的同类消费链用例（applyRemote 调用/缺字段跳过/changed 重注入/抛错隔离）
describe('OpsCenterSync 去 AI 味词库消费（rewrite_ai_taste_map）', () => {
  afterEach(() => { vi.restoreAllMocks() })

  function makeDeps () {
    const store = makeStore()
    const svc = new OpsCenterSync({ store, modelProviderManager: makeManager(), log: LOG })
    const manager = { applyRemote: vi.fn(() => true) }
    svc.setRewriteAiTasteMapManager(manager)
    const engineService = { setAiTasteMapManager: vi.fn() }
    svc.setRewriteEngineService(engineService)
    return { svc, manager, engineService }
  }

  it('Y1 payload.rewrite_ai_taste_map 数组 → 调 applyRemote', () => {
    const { svc, manager } = makeDeps()
    svc.applyRuntime({
      announcements: [],
      rewrite_ai_taste_map: [{ word: '综上所述', replacement: '归根结底', severity: 'S1', enabled: true }],
      synced_at: 't',
    })
    expect(manager.applyRemote).toHaveBeenCalledTimes(1)
    expect(manager.applyRemote).toHaveBeenCalledWith([
      { word: '综上所述', replacement: '归根结底', severity: 'S1', enabled: true },
    ])
  })

  it('Y2 缺字段/非数组 → 不调 applyRemote（保持本地现状）', () => {
    const { svc, manager } = makeDeps()
    svc.applyRuntime({ announcements: [], synced_at: 't' })
    svc.applyRuntime({ announcements: [], rewrite_ai_taste_map: 'bad', synced_at: 't' })
    expect(manager.applyRemote).not.toHaveBeenCalled()
  })

  it('Y3 changed=true → 重注入引擎服务（缓存失效）；unchanged → 不重注入', () => {
    const { svc, manager, engineService } = makeDeps()
    manager.applyRemote = vi.fn(() => true)
    svc.applyRuntime({ announcements: [], rewrite_ai_taste_map: [{ word: 'w', replacement: 'r', severity: 'S2', enabled: true }], synced_at: 't' })
    expect(engineService.setAiTasteMapManager).toHaveBeenCalledTimes(1)
    manager.applyRemote = vi.fn(() => false)
    svc.applyRuntime({ announcements: [], rewrite_ai_taste_map: [{ word: 'w', replacement: 'r', severity: 'S2', enabled: true }], synced_at: 't2' })
    expect(engineService.setAiTasteMapManager).toHaveBeenCalledTimes(1)
  })

  it('Y4 applyRemote 抛错 → 仅 warn 不影响其他 runtime 字段', () => {
    const store = makeStore()
    const svc = new OpsCenterSync({ store, modelProviderManager: makeManager(), log: LOG })
    const manager = { applyRemote: vi.fn(() => { throw new Error('boom') }) }
    svc.setRewriteAiTasteMapManager(manager)
    svc.applyRuntime({
      announcements: [{ title: '公告', severity: 'info', content: '' }],
      rewrite_ai_taste_map: [{ word: 'w', replacement: 'r', severity: 'S2', enabled: true }],
      synced_at: 't',
    })
    expect(svc.getRuntimeState().announcements).toHaveLength(1)
  })
})

describe('OpsCenterSync 存储契约留痕（QM6-C1）', () => {
  it('注入物缺少 getSettingObject 时必须留痕，不许静默变空配置', () => {
    const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), notify: vi.fn() }
    const store = { getSetting: vi.fn(() => ''), setSetting: vi.fn() }
    const svc = new OpsCenterSync({ store, modelProviderManager: makeManager(), log })
    const cfg = svc.getConfig()
    expect(cfg.url).toBe('')
    // getConfig() 会读两次（配置 + 密文），判据是「每次失败读取都留痕」而非恰好一次
    expect(log.notify.mock.calls.length).toBeGreaterThan(0)
    expect(log.notify.mock.calls.some((c) => c[1] === 'get-setting-object-missing')).toBe(true)
  })

  // QM6-C1：本 PR 要消灭的是「把读回失败伪装成用户没配置」。方法存在但抛异常（例如注入的是
  // container 那种窄包装的后续变种、或存储层自身故障）同样必须出声——与三个 reporter 的
  // `catch (e) { this._log.warn(...) }` 保持同一口径，且不得与本文件 JSDoc「必须留痕」自相矛盾。
  it('注入物的 getSettingObject 抛异常时必须留痕，不许静默返回空对象', () => {
    const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), notify: vi.fn() }
    const store = {
      getSetting: vi.fn(() => ''),
      setSetting: vi.fn(),
      getSettingObject: vi.fn(() => { throw new Error('boom-read') })
    }
    const svc = new OpsCenterSync({ store, modelProviderManager: makeManager(), log })
    const cfg = svc.getConfig()
    expect(cfg.url).toBe('')
    expect(log.notify.mock.calls.length).toBeGreaterThan(0)
    expect(log.notify.mock.calls.some((c) => String((c[2] || {}).error).includes('boom-read'))).toBe(true)
  })

  it('未注入 store 时必须留痕，不许静默变空配置', () => {
    const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), notify: vi.fn() }
    const svc = new OpsCenterSync({ store: undefined, modelProviderManager: makeManager(), log })
    const cfg = svc.getConfig()
    expect(cfg.url).toBe('')
    expect(log.notify.mock.calls.length).toBeGreaterThan(0)
    expect(log.notify.mock.calls.some((c) => c[1] === 'store-missing-empty-config')).toBe(true)
  })
})

