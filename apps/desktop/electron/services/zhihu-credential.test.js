// @ts-check
/**
 * zhihu-credential.test.js — 知乎 Access Secret 凭据服务回归锁（单一真源）
 *
 * 为什么单独锁一层：这条链上有两个**跨模块**不变量，写错任何一个都是「用户以为配好了、
 * 实际没生效」的静默失败，而它们在 IPC 层看不出来：
 *   ① 落盘必须是密文（safeStorage），明文只在内存与请求头里出现；
 *   ② 读取优先级必须是「本用户加密配置 > 旧版全局明文」，且旧明文只在保存/清除时被销账
 *      —— 一上来就删会让存量用户在升级瞬间丢配置（反向也坏：永不销账则明文长留盘上）。
 *
 * 覆盖：校验规则、加密落盘、读回形状（绝不回明文）、优先级、旧版销账、写失效检测、
 * 解密失败的可观测性、store 抛错时 fail-safe。
 *
 * 断言用**内存假 store + 内存假 crypto**（不触 electron），因为要断言的正是
 * 「密钥以什么形状落到哪里」——用真 safeStorage 就看不到密文，用真 DB 就跑不动。
 */

import { describe, it, expect, beforeEach } from 'vitest'

function createFakeCrypto ({ available = true, breakDecrypt = false } = {}) {
  const vault = new Map()
  let counter = 0
  return {
    isAvailable: () => available,
    encrypt: (plain) => {
      if (!available) throw new Error('safeStorage not available — cannot encrypt API Key (refusing plaintext fallback)')
      const key = `enc:${counter++}`
      vault.set(key, plain)
      return Buffer.from(key, 'utf-8')
    },
    decrypt: (buf) => {
      if (!available || breakDecrypt) return ''
      const key = Buffer.isBuffer(buf) ? buf.toString('utf-8') : String(buf)
      return vault.get(key) || ''
    },
    mask: (s) => (s && s.length >= 8 ? s.slice(0, 4) + '****' + s.slice(-4) : '****'),
  }
}

/**
 * 假 store：区分「用户域」（get/setUserSetting）与「全局域」（get/setSetting），
 * 与 settings-store.js 的两个作用域一一对应，才能断言「写进用户域」而不是「随便写了」。
 */
function createFakeStore ({ failUserWrite = false } = {}) {
  const user = {}
  const global = {}
  return {
    getUserSetting: (key, def = null) => (key in user ? user[key] : def),
    setUserSetting: (key, value) => { if (!failUserWrite) user[key] = value },
    getSetting: (key, def = null) => (key in global ? global[key] : def),
    setSetting: (key, value) => { global[key] = value },
    _user: () => user,
    _global: () => global,
  }
}

let credential

beforeEach(async () => {
  const mod = require('./zhihu-credential')
  credential = mod.default || mod
})

const SECRET = 'zhihu-secret-abcdefgh-1234567890'

describe('zhihu-credential / validateSecret', () => {
  it('空值与非字符串一律拒绝', () => {
    for (const bad of ['', '   ', null, undefined, 12345, {}, []]) {
      const r = credential.validateSecret(bad)
      expect(r.ok, JSON.stringify(bad)).toBe(false)
      expect(r.error).toMatch(/不能为空/)
    }
  })

  it('过短与过长拒绝（给出可执行区间）', () => {
    const short = credential.validateSecret('abc')
    expect(short.ok).toBe(false)
    expect(short.error).toMatch(/8/)

    const long = credential.validateSecret('a'.repeat(513))
    expect(long.ok).toBe(false)
    expect(long.error).toMatch(/512/)
  })

  it('含换行/控制字符拒绝（防把多行粘贴当合法密钥）', () => {
    const r = credential.validateSecret('abcdefgh\nijklmnop')
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/换行|控制字符/)
  })

  it('前后空白被裁剪，合法值原样返回', () => {
    const r = credential.validateSecret('  ' + SECRET + '  ')
    expect(r.ok).toBe(true)
    expect(r.value).toBe(SECRET)
  })
})

describe('zhihu-credential / saveConfig + readConfig', () => {
  it('落盘为密文，且读回形状绝不包含明文', () => {
    const store = createFakeStore()
    const cryptoMod = createFakeCrypto()
    const r = credential.saveConfig(store, SECRET, { crypto: cryptoMod })
    expect(r.ok).toBe(true)

    const row = store._user()[credential.CONFIG_KEY]
    expect(row).toBeTruthy()
    expect(typeof row.accessSecret).toBe('string')
    expect(row.accessSecret).not.toContain(SECRET)
    expect(row.enabled).toBe(true)
    expect(row.updatedAt).toBeTruthy()
    expect(row.verifiedAt).toBeNull()

    const cfg = credential.readConfig(store, { crypto: cryptoMod })
    expect(cfg.configured).toBe(true)
    expect(cfg.readable).toBe(true)
    expect(cfg.maskedSecret).toBe('zhih****7890')
    expect(cfg.maskedSecret).not.toContain(SECRET)
    expect(cfg.source).toBe('config')
    expect(cfg.legacyDetected).toBe(false)
    expect(JSON.stringify(cfg)).not.toContain(SECRET)
  })

  it('未配置时返回全 false 形状（UI 据此渲染空态，不需要 try/catch）', () => {
    const store = createFakeStore()
    const cfg = credential.readConfig(store, { crypto: createFakeCrypto() })
    expect(cfg).toMatchObject({
      configured: false,
      readable: false,
      maskedSecret: '',
      verifiedAt: null,
      favlistCount: null,
      legacyDetected: false,
      source: 'none',
    })
  })

  it('safeStorage 不可用时拒绝保存（不落明文兜底）', () => {
    const store = createFakeStore()
    const r = credential.saveConfig(store, SECRET, { crypto: createFakeCrypto({ available: false }) })
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/凭据保护不可用/)
    expect(store._user()[credential.CONFIG_KEY]).toBeUndefined()
  })

  it('写入未生效（用户设置存储静默丢弃）时 fail closed，不谎报成功', () => {
    const store = createFakeStore({ failUserWrite: true })
    const r = credential.saveConfig(store, SECRET, { crypto: createFakeCrypto() })
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/未生效|不可用/)
  })

  it('保存的是**同一份**旧版明文时销账（迁移收口）', () => {
    const store = createFakeStore()
    store.setSetting(credential.LEGACY_KEY, SECRET)
    const r = credential.saveConfig(store, SECRET, { crypto: createFakeCrypto() })
    expect(r.ok).toBe(true)
    expect(store._global()[credential.LEGACY_KEY]).toBeNull()
  })

  it('保存的是**另一份**凭据时不得动设备级明文（否则误删他人兼容档）', () => {
    // 根因（QM-6 跨家族评审 MAJOR #1）：legacy 键是无前缀的**设备级**键。
    // 无条件清掉 ⇒ 仍依赖兼容档的另一个用户 / 未登录档静默失去凭据。
    const store = createFakeStore()
    store.setSetting(credential.LEGACY_KEY, 'legacy-plain-secret')
    const r = credential.saveConfig(store, SECRET, { crypto: createFakeCrypto() })
    expect(r.ok).toBe(true)
    expect(store._global()[credential.LEGACY_KEY]).toBe('legacy-plain-secret')
  })

  it('重存**同一把**密钥保留「最近验证」证据（不把已验证打回未验证）', () => {
    const store = createFakeStore()
    const cryptoMod = createFakeCrypto()
    credential.saveConfig(store, SECRET, { crypto: cryptoMod })
    credential.markVerified(store, { favlistCount: 7 })
    const before = credential.readConfig(store, { crypto: cryptoMod })
    expect(before.verifiedAt).toBeTruthy()

    const again = credential.saveConfig(store, SECRET, { crypto: cryptoMod })
    expect(again.ok).toBe(true)
    const after = credential.readConfig(store, { crypto: cryptoMod })
    expect(after.verifiedAt).toBe(before.verifiedAt)
    expect(after.favlistCount).toBe(7)
  })

  it('重存**不同**密钥必须重置验证证据（旧结论对新密钥不成立）', () => {
    const store = createFakeStore()
    const cryptoMod = createFakeCrypto()
    credential.saveConfig(store, SECRET, { crypto: cryptoMod })
    credential.markVerified(store, { favlistCount: 7 })

    credential.saveConfig(store, 'another-secret-1234567890', { crypto: cryptoMod })
    const after = credential.readConfig(store, { crypto: cryptoMod })
    expect(after.verifiedAt).toBeNull()
    expect(after.favlistCount).toBeNull()
  })

  it('密文存在但解不开 → configured=true 且 readable=false（可观测，不冒充未配置）', () => {
    const store = createFakeStore()
    const cryptoMod = createFakeCrypto()
    credential.saveConfig(store, SECRET, { crypto: cryptoMod })
    const broken = createFakeCrypto({ breakDecrypt: true })
    const cfg = credential.readConfig(store, { crypto: broken })
    expect(cfg.configured).toBe(true)
    expect(cfg.readable).toBe(false)
    expect(cfg.maskedSecret).toBe('')
    expect(cfg.source).toBe('none')
  })
})

describe('zhihu-credential / resolveSecret 优先级', () => {
  it('无任何配置 → source=none', () => {
    const store = createFakeStore()
    expect(credential.resolveSecret(store, { crypto: createFakeCrypto() })).toEqual({ secret: '', source: 'none' })
  })

  it('仅有旧版明文 → source=legacy（存量用户升级后仍可用）', () => {
    const store = createFakeStore()
    store.setSetting(credential.LEGACY_KEY, 'legacy-plain-secret')
    expect(credential.resolveSecret(store, { crypto: createFakeCrypto() }))
      .toEqual({ secret: 'legacy-plain-secret', source: 'legacy' })
  })

  it('加密配置优先于旧版明文（同时存在时取加密）', () => {
    const store = createFakeStore()
    const cryptoMod = createFakeCrypto()
    store.setSetting(credential.LEGACY_KEY, 'legacy-plain-secret')
    credential.saveConfig(store, SECRET, { crypto: cryptoMod })
    // 保存会销账旧行；这里手工写回，模拟「销账失败但两份并存」的边界
    store.setSetting(credential.LEGACY_KEY, 'legacy-plain-secret')
    expect(credential.resolveSecret(store, { crypto: cryptoMod }))
      .toEqual({ secret: SECRET, source: 'config' })
  })

  it('加密配置存在但解不开 → 回落旧版明文而不是直接失效', () => {
    const store = createFakeStore()
    credential.saveConfig(store, SECRET, { crypto: createFakeCrypto() })
    store.setSetting(credential.LEGACY_KEY, 'legacy-plain-secret')
    expect(credential.resolveSecret(store, { crypto: createFakeCrypto({ breakDecrypt: true }) }))
      .toEqual({ secret: 'legacy-plain-secret', source: 'legacy' })
  })

  it('legacyDetected 只在「有旧明文且无可用加密配置」时为真', () => {
    const store = createFakeStore()
    const cryptoMod = createFakeCrypto()
    store.setSetting(credential.LEGACY_KEY, 'legacy-plain-secret')
    expect(credential.readConfig(store, { crypto: cryptoMod }).legacyDetected).toBe(true)
    credential.saveConfig(store, SECRET, { crypto: cryptoMod })
    expect(credential.readConfig(store, { crypto: cryptoMod }).legacyDetected).toBe(false)
  })
})

describe('zhihu-credential / markVerified 与 clearConfig', () => {
  it('markVerified 记录验证时间与收藏夹数量（仅已配置时）', () => {
    const store = createFakeStore()
    const cryptoMod = createFakeCrypto()
    credential.saveConfig(store, SECRET, { crypto: cryptoMod })
    const r = credential.markVerified(store, { favlistCount: 7 })
    expect(r.ok).toBe(true)
    const cfg = credential.readConfig(store, { crypto: cryptoMod })
    expect(cfg.verifiedAt).toBeTruthy()
    expect(cfg.favlistCount).toBe(7)
  })

  it('未配置时 markVerified 不写入任何行（防凭空造出一条配置）', () => {
    const store = createFakeStore()
    const r = credential.markVerified(store, { favlistCount: 3 })
    expect(r.ok).toBe(false)
    expect(store._user()[credential.CONFIG_KEY]).toBeUndefined()
  })

  it('clearConfig 清掉本用户的加密配置，但**不**动设备级明文（本用户凭据来自加密行）', () => {
    const store = createFakeStore()
    const cryptoMod = createFakeCrypto()
    credential.saveConfig(store, SECRET, { crypto: cryptoMod })
    store.setSetting(credential.LEGACY_KEY, 'legacy-plain-secret')
    const r = credential.clearConfig(store)
    expect(r.ok).toBe(true)
    expect(credential.readConfig(store, { crypto: cryptoMod }).configured).toBe(false)
    // 那份明文不属于本用户 ⇒ 必须留着（QM-6 评审 MAJOR #1 的另一半）
    expect(store._global()[credential.LEGACY_KEY]).toBe('legacy-plain-secret')
    expect(credential.resolveSecret(store, { crypto: cryptoMod })).toEqual({ secret: 'legacy-plain-secret', source: 'legacy' })
  })

  it('clearConfig 在本用户凭据**就是**那条设备级明文时一并销账', () => {
    const store = createFakeStore()
    const cryptoMod = createFakeCrypto()
    store.setSetting(credential.LEGACY_KEY, SECRET)
    const r = credential.clearConfig(store)
    expect(r.ok).toBe(true)
    expect(credential.resolveSecret(store, { crypto: cryptoMod })).toEqual({ secret: '', source: 'none' })
  })

  it('clearConfig 写后读回：存储静默丢弃时不得谎报「已清除」', () => {
    // QM-6 opencode 侧 MAJOR：saveConfig 有读回校验而 clearConfig 没有 ⇒ 点清除、
    // 界面说成功、密钥其实还在。判据必须与 saveConfig 同口径（模块头契约）。
    const store = createFakeStore({ failUserWrite: true })
    store._user()[credential.CONFIG_KEY] = { accessSecret: 'stale-cipher', enabled: true }
    const r = credential.clearConfig(store)
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/清除未生效/)
  })
})

describe('zhihu-credential / saveConfig 读回解密回环（QM-6 opencode 侧 MINOR）', () => {
  it('密文被写坏（截断）时必须 fail closed，而不是「有非空字符串就算成功」', () => {
    const cryptoMod = createFakeCrypto()
    const store = createFakeStore()
    const original = store.setUserSetting
    store.setUserSetting = (k, v) => {
      if (v && typeof v === 'object' && 'accessSecret' in v) {
        original(k, { ...v, accessSecret: String(v.accessSecret).slice(0, 2) })
      } else {
        original(k, v)
      }
    }
    const r = credential.saveConfig(store, SECRET, { crypto: cryptoMod })
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/读回内容|未生效/)
  })
})

describe('zhihu-credential / fail-safe', () => {
  it('store 抛错时读路径返回安全默认、写路径返回 ok:false（不把异常抛进 IPC）', () => {
    const boom = {
      getUserSetting: () => { throw new Error('db locked') },
      setUserSetting: () => { throw new Error('db locked') },
      getSetting: () => { throw new Error('db locked') },
      setSetting: () => { throw new Error('db locked') },
    }
    const cryptoMod = createFakeCrypto()
    expect(() => credential.readConfig(boom, { crypto: cryptoMod })).not.toThrow()
    expect(credential.readConfig(boom, { crypto: cryptoMod }).configured).toBe(false)
    expect(credential.resolveSecret(boom, { crypto: cryptoMod })).toEqual({ secret: '', source: 'none' })
    expect(credential.saveConfig(boom, SECRET, { crypto: cryptoMod }).ok).toBe(false)
    expect(credential.clearConfig(boom).ok).toBe(false)
  })

  it('用户域能力缺席（旧 store）时保存 fail closed，而不是退回全局明文', () => {
    const legacyStore = {
      getSetting: () => null,
      setSetting: () => {},
    }
    const r = credential.saveConfig(legacyStore, SECRET, { crypto: createFakeCrypto() })
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/用户设置存储不可用/)
  })
})
