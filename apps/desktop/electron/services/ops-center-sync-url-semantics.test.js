// @ts-check
/**
 * ops-center-sync-url-semantics.test.js — `getConfig().url` 的「手填 / 自动发现 / 生效值」三口径
 *
 * 为什么需要这个文件（事故背景，非推测）：
 * `getConfig().url` 历史上把「用户手填的地址」与「部署层自动发现的地址」并入同一字段，于是：
 *   ① 零配置态下 `!cfg.url` 恒为 false ⇒ 会被读成「已手填」；
 *   ② `_fetchJson` 内部重读该混装字段当请求 base，而 `_fetchCatalog` / `_fetchRuntime` **早已接收
 *      `baseUrl` 参数却从没用过**（死参数）⇒ 自动发现地址被当成手填地址消费；
 *   ③ `saveConfig` 若被喂入混装值，会把自动地址**固化成手填**，该终端此后不再跟随部署层（不可逆）。
 * 本文件把三口径的形状、别名关系、结构不复现、以及固化护栏全部钉住。
 *
 * 被测模块是主进程 CJS：必须经 createRequire 载入（同 ops-center-sync.test.js 的既有先例，
 * 用 ESM import 会拿到另一个模块实例）。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createRequire } from 'module'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const require$ = createRequire(import.meta.url)
const HERE = dirname(fileURLToPath(import.meta.url))
const SRC_PATH = join(HERE, 'ops-center-sync.js')
const URL_MODULE_PATH = join(HERE, 'ops-center-sync-url.js')

__registerMock('./crypto', {
  isAvailable: () => true,
  encrypt: (key) => (key ? Buffer.from('enc_' + key) : null),
  decrypt: (value) => (value ? Buffer.from(value).toString('utf8').replace(/^enc_/, '') : ''),
  mask: (key) => (key ? key.slice(0, 4) + '****' + key.slice(-4) : '****'),
  setSafeStorage: () => {},
})

const { OpsCenterSync } = require$('./ops-center-sync')
const { resolveSyncUrls, shouldRefusePin } = require$('./ops-center-sync-url')

const SYNC_KEY = 'opsCenterSync'
const LOG = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), notify: vi.fn() }

/** 与真实 settings-store 同形的多键夹具：值按键分槽落文本，读回解析后的值 */
function makeStore(storedUrl = '') {
  const rows = {}
  rows[SYNC_KEY] = JSON.stringify({ url: storedUrl, apiKeyEnc: '', autoSync: true, runtimePublicKey: '' })
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
    _row: (k) => (k in rows ? rows[k] : ''),
  }
}

const makeManager = () => ({ applyCatalog: vi.fn(() => ({ code: 0, updated: 0, inserted: 0 })) })

/** 造一个「自动发现可用」的实例：有 token 回调 + 有自动地址 */
function makeAutoService (storedUrl = '', autoUrl = 'https://auto.example.com') {
  const svc = new OpsCenterSync({ store: makeStore(storedUrl), modelProviderManager: makeManager(), log: LOG })
  svc.setGetAccessToken(() => 'token-abc')
  svc.setOpsCenterUrl(autoUrl)
  return svc
}

describe('ops-center-sync-url：三口径纯函数', () => {
  it('零配置态（未手填 + 有自动）⇒ manualUrl 空、effectiveUrl=autoUrl、autoConnected=true', () => {
    const u = resolveSyncUrls({ storedUrl: '', autoUrl: 'https://auto.example.com', autoAvailable: true })
    expect(u.manualUrl).toBe('')
    expect(u.autoUrl).toBe('https://auto.example.com')
    expect(u.effectiveUrl).toBe('https://auto.example.com')
    expect(u.autoConnected).toBe(true)
  })

  it('手填态 ⇒ effectiveUrl=手填、autoConnected=false（即使自动地址也存在）', () => {
    const u = resolveSyncUrls({ storedUrl: 'https://manual.example.com', autoUrl: 'https://auto.example.com', autoAvailable: true })
    expect(u.manualUrl).toBe('https://manual.example.com')
    expect(u.effectiveUrl).toBe('https://manual.example.com')
    expect(u.autoConnected).toBe(false)
  })

  it('两态皆无 ⇒ 三者皆空、autoConnected=false', () => {
    const u = resolveSyncUrls({ storedUrl: '', autoUrl: '', autoAvailable: false })
    expect(u.manualUrl).toBe('')
    expect(u.autoUrl).toBe('')
    expect(u.effectiveUrl).toBe('')
    expect(u.autoConnected).toBe(false)
  })

  it('有自动地址但没有 token 回调 ⇒ 不算自动连上（autoAvailable=false）', () => {
    const u = resolveSyncUrls({ storedUrl: '', autoUrl: 'https://auto.example.com', autoAvailable: false })
    expect(u.effectiveUrl).toBe('https://auto.example.com')
    expect(u.autoConnected).toBe(false)
  })
})

describe('OpsCenterSync.getConfig()：字段形状与别名关系', () => {
  it('零配置态：manualUrl 为空、autoConnected=true、url 与 effectiveUrl 同值', () => {
    const svc = makeAutoService('')
    const cfg = svc.getConfig()
    expect(cfg.manualUrl).toBe('')
    expect(cfg.autoUrl).toBe('https://auto.example.com')
    expect(cfg.effectiveUrl).toBe('https://auto.example.com')
    expect(cfg.autoConnected).toBe(true)
    // 别名关系：url 是历史混装名，必须与 effectiveUrl 严格同值（防止日后只改一个）
    expect(cfg.url).toBe(cfg.effectiveUrl)
  })

  it('手填态：manualUrl 非空、autoConnected=false、effectiveUrl=手填', () => {
    const svc = makeAutoService('https://manual.example.com')
    const cfg = svc.getConfig()
    expect(cfg.manualUrl).toBe('https://manual.example.com')
    expect(cfg.effectiveUrl).toBe('https://manual.example.com')
    expect(cfg.autoConnected).toBe(false)
    expect(cfg.url).toBe(cfg.effectiveUrl)
  })

  it('两态皆无：三者皆空、autoConnected=false', () => {
    const svc = new OpsCenterSync({ store: makeStore(''), modelProviderManager: makeManager(), log: LOG })
    const cfg = svc.getConfig()
    expect(cfg.manualUrl).toBe('')
    expect(cfg.autoUrl).toBe('')
    expect(cfg.effectiveUrl).toBe('')
    expect(cfg.autoConnected).toBe(false)
    expect(cfg.url).toBe('')
  })

  it('手填优先：手填与自动都存在时 effectiveUrl 取手填', () => {
    const svc = makeAutoService('https://manual.example.com')
    expect(svc.getConfig().effectiveUrl).toBe('https://manual.example.com')
    expect(svc.getConfig().url).toBe('https://manual.example.com')
  })
})

describe('saveConfig：自动地址固化护栏', () => {
  it('零配置态下把自动发现地址原样写回手填 ⇒ 拒绝（否则该终端不再跟随部署层且不可逆）', () => {
    const svc = makeAutoService('')
    const res = svc.saveConfig({ url: 'https://auto.example.com', apiKey: '', autoSync: true })
    expect(res.code).toBe(-1)
    expect(res.message).toContain('自动发现')
    // 没有落盘：手填仍为空
    expect(svc.getConfig().manualUrl).toBe('')
  })

  it('零配置态下传空 url ⇒ 正常（不误拒）', () => {
    const svc = makeAutoService('')
    const res = svc.saveConfig({ url: '', apiKey: '', autoSync: true })
    expect(res.code).toBe(0)
    expect(svc.getConfig().manualUrl).toBe('')
  })

  it('零配置态下写一个与自动地址不同的地址 ⇒ 正常（那是真的手填）', () => {
    const svc = makeAutoService('')
    const res = svc.saveConfig({ url: 'https://manual.example.com', apiKey: '', autoSync: true })
    expect(res.code).toBe(0)
    expect(svc.getConfig().manualUrl).toBe('https://manual.example.com')
  })

  it('已有手填时再写同一个地址 ⇒ 正常（护栏只管「从无到有的固化」）', () => {
    const svc = makeAutoService('https://manual.example.com')
    const res = svc.saveConfig({ url: 'https://manual.example.com', apiKey: '', autoSync: true })
    expect(res.code).toBe(0)
  })

  it('纯函数判据：shouldRefusePin 的四种输入', () => {
    const auto = 'https://auto.example.com'
    expect(shouldRefusePin({ storedUrl: '', autoUrl: auto, candidate: auto })).toBe(true)
    expect(shouldRefusePin({ storedUrl: '', autoUrl: auto, candidate: '' })).toBe(false)
    expect(shouldRefusePin({ storedUrl: '', autoUrl: auto, candidate: 'https://other.example.com' })).toBe(false)
    // 已有手填 ⇒ 不是「固化」，允许改写
    expect(shouldRefusePin({ storedUrl: 'https://manual.example.com', autoUrl: auto, candidate: auto })).toBe(false)
  })
})

describe('结构锁：混装值不得再被「重读」消费', () => {
  let src
  beforeEach(() => { src = readFileSync(SRC_PATH, 'utf8') })
  afterEach(() => { vi.restoreAllMocks() })

  it('主文件不再出现 getConfig().url 形式的取用（唯一混装消费点已改为调用方传 base）', () => {
    const hits = src.split('\n')
      .map((l, i) => ({ l, n: i + 1 }))
      .filter(({ l }) => /getConfig\(\)\s*\.\s*url/.test(l) && !/^\s*(\*|\/\/)/.test(l))
    expect(hits.map((h) => `L${h.n}: ${h.l.trim()}`)).toEqual([])
  })

  it('_fetchJson 的 base 来自第三个参数而非内部重读', () => {
    expect(src).toMatch(/async _fetchJson\(path, auth, base\)/)
    expect(src).toMatch(/String\(base \|\| process\.env\.OPS_CENTER_URL \|\| ''\)/)
  })

  it('_fetchCatalog / _fetchRuntime 把已接收的 baseUrl 真正传给 _fetchJson（死参数已消除）', () => {
    expect(src).toMatch(/this\._fetchJson\('\/api\/v1\/model-presets\/catalog', auth, baseUrl\)/)
    expect(src).toMatch(/this\._fetchJson\('\/api\/v1\/runtime\/bootstrap', auth, baseUrl\)/)
  })

  it('getConfig 通过 resolveSyncUrls 产出三口径（单一实现，不在本文件重抄判据）', () => {
    expect(src).toMatch(/resolveSyncUrls\(\{ storedUrl: cfg\.url/)
    expect(src).toMatch(/manualUrl: u\.manualUrl/)
    expect(src).toMatch(/effectiveUrl: u\.effectiveUrl/)
  })

  it('ops-center-sync-url.js 只导出两个纯函数，且不 require 任何运行时依赖', () => {
    const mod = readFileSync(URL_MODULE_PATH, 'utf8')
    expect(mod).toMatch(/module\.exports = \{ resolveSyncUrls, shouldRefusePin \}/)
    expect(mod).not.toMatch(/require\(/)
    expect(mod).not.toMatch(/this\./)
  })
})
