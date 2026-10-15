// @ts-check
/**
 * zhihu-settings.test.js — 知乎 API 配置 IPC handlers 回归锁
 *
 * 覆盖：4 条通道注册、get-config 不回明文、save-config 校验 + 加密落盘 + 旧版销账、
 * test-connection 两条路径（传入明文 / 已存配置）、失败与异常归一、clear-config。
 *
 * 为什么「传入明文测试不落盘、已存配置测试才落 verifiedAt」要单独锁：
 * 前者是用户还没点保存就点测试，落盘等于把没确认过的值写进配置；后者是唯一能产生
 * 「已验证」证据的路径。两者混淆会让 UI 显示一个并不存在的「已验证」。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../services/logger', () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), notify: vi.fn() }))

function createMockSafeStorage () {
  const store = new Map()
  let counter = 0
  return {
    isEncryptionAvailable: vi.fn(() => true),
    encryptString: vi.fn((str) => {
      const key = `enc_${counter++}_${str}`
      store.set(key, str)
      return Buffer.from(key, 'utf-8')
    }),
    decryptString: vi.fn((buf) => store.get(buf.toString('utf-8')) || ''),
  }
}

let registerHandlers
let crypto
const SECRET = 'zhihu-secret-abcdefgh-1234567890'
const TRUSTED_EVENT = { senderFrame: { url: 'app://localhost/index.html' } }

beforeEach(() => {
  __enableElectronMock()
  crypto = require('../services/crypto')
  const mod = require('./zhihu-settings')
  registerHandlers = mod.default || mod
})

afterEach(() => {
  vi.clearAllMocks()
  crypto.setSafeStorage(null)
})

function createMockIpcMain () {
  const handlers = {}
  return {
    handle: vi.fn((channel, fn) => { handlers[channel] = fn }),
    _getHandler: (channel) => handlers[channel],
    _call: async (channel, ...args) => handlers[channel](TRUSTED_EVENT, ...args),
  }
}

/** 假 store：用户域 + 全局域分开，用于断言「写进用户域」与「旧明文被销账」 */
function createMockStore () {
  const user = {}
  const global = {}
  return {
    getUserSetting: vi.fn((k, def = null) => (k in user ? user[k] : def)),
    setUserSetting: vi.fn((k, v) => { user[k] = v }),
    getSetting: vi.fn((k, def = null) => (k in global ? global[k] : def)),
    setSetting: vi.fn((k, v) => { global[k] = v }),
    _user: () => user,
    _global: () => global,
  }
}

function createFakeService (overrides = {}) {
  return {
    // 连通性测试复用「收藏夹列表」这一条真实鉴权调用（不新造端点），故桩只需实现 testConnection
    testConnection: vi.fn(async () => ({ success: true, favlistCount: 2 })),
    ...overrides,
  }
}

function setup ({ service, store } = {}) {
  const ipcMain = createMockIpcMain()
  const deps = { store: store || createMockStore(), service: service || createFakeService() }
  registerHandlers(ipcMain, deps)
  return { ipcMain, deps }
}

describe('zhihu-settings IPC handlers / 注册与读配置', () => {
  it('注册 4 条通道', () => {
    const { ipcMain } = setup()
    for (const ch of ['zhihu:get-config', 'zhihu:save-config', 'zhihu:test-connection', 'zhihu:clear-config']) {
      expect(ipcMain._getHandler(ch), ch).toBeTypeOf('function')
    }
  })

  it('未配置时 get-config 返回空态形状', async () => {
    const { ipcMain } = setup()
    const r = await ipcMain._call('zhihu:get-config')
    expect(r.code).toBe(0)
    expect(r.data.configured).toBe(false)
    expect(r.data.source).toBe('none')
  })

  it('旧版明文存在时 get-config 如实上报 legacyDetected（供 UI 提示重新保存迁移）', async () => {
    const store = createMockStore()
    store.setSetting('zhihu_access_secret', 'legacy-plain-secret')
    const { ipcMain } = setup({ store })
    const r = await ipcMain._call('zhihu:get-config')
    expect(r.code).toBe(0)
    expect(r.data.configured).toBe(false)
    expect(r.data.legacyDetected).toBe(true)
  })
})

describe('zhihu-settings IPC handlers / save-config', () => {
  it('参数校验：空/过短/过长/非字符串一律 -2 且不写盘', async () => {
    const store = createMockStore()
    crypto.setSafeStorage(createMockSafeStorage())
    const { ipcMain } = setup({ store })
    for (const bad of ['', '   ', 'abc', 'a'.repeat(513), 123, null, undefined]) {
      const r = await ipcMain._call('zhihu:save-config', bad)
      expect(r.code, String(bad)).toBe(-2)
      expect(r.message).toBeTruthy()
    }
    expect(store.setUserSetting).not.toHaveBeenCalled()
  })

  it('保存成功 → 用户域密文 + 响应不含明文 + 旧明文被销账', async () => {
    const store = createMockStore()
    // 兼容档里放的就是本次要迁移的**同一份**明文 ⇒ 保存成功后应当销账
    store.setSetting('zhihu_access_secret', SECRET)
    crypto.setSafeStorage(createMockSafeStorage())
    const { ipcMain } = setup({ store })

    const saved = await ipcMain._call('zhihu:save-config', SECRET)
    expect(saved.code).toBe(0)
    expect(saved.data.configured).toBe(true)
    expect(saved.data.maskedSecret).toBe('zhih****7890')
    expect(JSON.stringify(saved)).not.toContain(SECRET)

    const row = store._user().zhihu_api_config
    expect(typeof row.accessSecret).toBe('string')
    expect(row.accessSecret).not.toContain(SECRET)
    expect(store._global().zhihu_access_secret).toBeNull()

    const cfg = await ipcMain._call('zhihu:get-config')
    expect(cfg.data.configured).toBe(true)
    expect(cfg.data.legacyDetected).toBe(false)
    expect(JSON.stringify(cfg)).not.toContain(SECRET)
  })

  it('safeStorage 不可用 → 拒绝保存且不落任何行', async () => {
    const store = createMockStore()
    crypto.setSafeStorage({ isEncryptionAvailable: () => false, encryptString: vi.fn(), decryptString: vi.fn() })
    const { ipcMain } = setup({ store })
    const r = await ipcMain._call('zhihu:save-config', SECRET)
    expect(r.code).not.toBe(0)
    expect(r.message).toMatch(/凭据保护不可用/)
    expect(store.setUserSetting).not.toHaveBeenCalled()
  })
})

describe('zhihu-settings IPC handlers / test-connection', () => {
  it('传入明文 → 用明文调用服务，成功后**不**写 verifiedAt', async () => {
    const store = createMockStore()
    const service = createFakeService()
    const { ipcMain } = setup({ store, service })
    const r = await ipcMain._call('zhihu:test-connection', SECRET)
    expect(r.code).toBe(0)
    expect(r.data.ok).toBe(true)
    expect(r.data.favlistCount).toBe(2)
    expect(service.testConnection).toHaveBeenCalledWith(SECRET)
    expect(store.setUserSetting).not.toHaveBeenCalled()
  })

  it('传入明文但非法 → -2 且一次都不出站', async () => {
    const service = createFakeService()
    const { ipcMain } = setup({ service })
    const r = await ipcMain._call('zhihu:test-connection', 'abc')
    expect(r.code).toBe(-2)
    expect(service.testConnection).not.toHaveBeenCalled()
  })

  it('无参 → 用已存配置解密后调用，成功写 verifiedAt + favlistCount', async () => {
    const store = createMockStore()
    const service = createFakeService()
    crypto.setSafeStorage(createMockSafeStorage())
    const { ipcMain } = setup({ store, service })
    await ipcMain._call('zhihu:save-config', SECRET)

    const r = await ipcMain._call('zhihu:test-connection')
    expect(r.code).toBe(0)
    expect(r.data.ok).toBe(true)
    expect(service.testConnection).toHaveBeenCalledWith(SECRET)

    const cfg = await ipcMain._call('zhihu:get-config')
    expect(cfg.data.verifiedAt).toBeTruthy()
    expect(cfg.data.favlistCount).toBe(2)
  })

  it('已存配置 + 传入**不同的**新值测试 → 不得污染已存配置的验证证据', async () => {
    // 变异反证 M4 暴露的缺口：只断言「未保存值测试不写 verifiedAt」时，若库里本来没有配置行，
    // markVerified 会因「无行可更新」而 no-op，变异体照样逃逸。真正的伤害场景是
    // 「已有配置 A，用户拿未保存的 B 去测」——此时若写 verifiedAt，就等于给 A 盖上了一个
    // 它从未通过验证的章。本用例专锁这一格。
    const store = createMockStore()
    const service = createFakeService()
    crypto.setSafeStorage(createMockSafeStorage())
    const { ipcMain } = setup({ store, service })
    await ipcMain._call('zhihu:save-config', SECRET)
    const rowBefore = JSON.stringify(store._user().zhihu_api_config)

    const r = await ipcMain._call('zhihu:test-connection', 'another-secret-abcdefgh')
    expect(r.code).toBe(0)
    expect(service.testConnection).toHaveBeenCalledWith('another-secret-abcdefgh')

    expect(JSON.stringify(store._user().zhihu_api_config)).toBe(rowBefore)
    const cfg = await ipcMain._call('zhihu:get-config')
    expect(cfg.data.verifiedAt).toBeNull()
  })

  it('无参且未配置 → 返回错误 + data.ok=false，且一次都不出站', async () => {
    const service = createFakeService()
    const { ipcMain } = setup({ service })
    const r = await ipcMain._call('zhihu:test-connection')
    expect(r.code).not.toBe(0)
    expect(r.data.ok).toBe(false)
    expect(r.message).toMatch(/未配置|请先在设置/)
    expect(service.testConnection).not.toHaveBeenCalled()
  })

  it('服务返回失败 → 透传归一文案、data.ok=false，且不写 verifiedAt', async () => {
    const store = createMockStore()
    const service = createFakeService({
      testConnection: vi.fn(async () => ({ success: false, error: '知乎 API 频率限制，请稍后重试', retryable: true })),
    })
    crypto.setSafeStorage(createMockSafeStorage())
    const { ipcMain } = setup({ store, service })
    await ipcMain._call('zhihu:save-config', SECRET)

    const r = await ipcMain._call('zhihu:test-connection')
    expect(r.code).not.toBe(0)
    expect(r.data.ok).toBe(false)
    expect(r.message).toContain('频率限制')
    expect(r.data.retryable).toBe(true)

    const cfg = await ipcMain._call('zhihu:get-config')
    expect(cfg.data.verifiedAt).toBeNull()
  })

  it('服务抛异常 → -1 归一，不外泄成未捕获异常', async () => {
    const service = createFakeService({ testConnection: vi.fn(async () => { throw new Error('socket hang up') }) })
    const { ipcMain } = setup({ service })
    const r = await ipcMain._call('zhihu:test-connection', SECRET)
    expect(r.code).toBe(-1)
    expect(r.message).toContain('socket hang up')
    expect(r.data.ok).toBe(false)
  })
})

describe('zhihu-settings IPC handlers / clear-config', () => {
  it('清除后 get-config 回到未配置，且旧明文一并清掉（本用户凭据本来就来自兼容档）', async () => {
    const store = createMockStore()
    crypto.setSafeStorage(createMockSafeStorage())
    const { ipcMain } = setup({ store })
    // 场景：本用户没有自己的加密行，用的就是设备级兼容档 ⇒ 清除应把这条也销掉
    store.setSetting('zhihu_access_secret', 'legacy-plain-secret')

    const r = await ipcMain._call('zhihu:clear-config')
    expect(r.code).toBe(0)
    expect(r.data.cleared).toBe(true)

    const cfg = await ipcMain._call('zhihu:get-config')
    expect(cfg.data.configured).toBe(false)
    expect(cfg.data.legacyDetected).toBe(false)
    expect(store._global().zhihu_access_secret).toBeNull()
  })

  it('清除只动本用户的加密行：设备级明文不属于本用户时必须留着', async () => {
    // 根因（QM-6 跨家族评审 MAJOR #1）：无条件清全局 legacy ⇒ 误删他人兼容档
    const store = createMockStore()
    crypto.setSafeStorage(createMockSafeStorage())
    const { ipcMain } = setup({ store })
    await ipcMain._call('zhihu:save-config', SECRET)
    store.setSetting('zhihu_access_secret', 'someone-elses-legacy')

    const r = await ipcMain._call('zhihu:clear-config')
    expect(r.code).toBe(0)
    expect(store._global().zhihu_access_secret).toBe('someone-elses-legacy')

    const cfg = await ipcMain._call('zhihu:get-config')
    expect(cfg.data.configured).toBe(false)
    expect(cfg.data.legacyDetected).toBe(true) // 兼容档仍在 ⇒ 采集链仍可用
  })
})
