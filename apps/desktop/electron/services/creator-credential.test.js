/**
 * creator-credential.test.js — 博主监控凭证存储（PRD §7.4）
 *
 * 这是本特性唯一一处安全敏感逻辑，测试按**契约**而不是按实现写：
 *   1. 明文**永不落盘**（落点是 `safeStorage:v1:<base64>`；读到非该格式一律拒用）
 *   2. 读取方向**永不**回传明文（`status()` 的序列化结果里不得出现 key）
 *   3. safeStorage 不可用 → **fail-closed**（拒绝保存，不降级明文）
 *   4. 三态可区分：未配置 / 读失败 / 解不开，下一步动作不同
 *   5. 日志里不得出现 key（哪怕前缀）
 *
 * safeStorage 用注入式假实现（真实 DPAPI 只在打包验证里过一遍）：
 * 假实现刻意**不保留明文可逆性以外的东西**，并提供"解密必失败"的档位。
 */
const crypto = require('crypto')
const {
  createCreatorCredentialProvider,
  validateApiKey,
  fingerprintOf,
  canUseSafeStorage,
  SETTING_KEY,
  SAFE_STORAGE_PREFIX,
  CREDENTIAL_STATUS,
} = require('./creator-credential')

/** 可控 safeStorage 假实现：加/解密是 base64 往返，可单独让 decryptString 抛错 */
function createSafeStorage ({ available = true, decryptThrows = false } = {}) {
  return {
    isEncryptionAvailable: () => available,
    encryptString: (s) => Buffer.from('enc:' + s, 'utf8'),
    decryptString: (buf) => {
      if (decryptThrows) throw new Error('Error while decrypting the ciphertext')
      const s = Buffer.from(buf).toString('utf8')
      if (!s.startsWith('enc:')) throw new Error('bad ciphertext')
      return s.slice(4)
    },
  }
}

/** settings 假实现：只认 getSetting/setSetting（与 store 的公开形状一致） */
function createStore (seed = {}) {
  const rows = { ...seed }
  return {
    rows,
    getSetting: (k) => (k in rows ? rows[k] : null),
    setSetting: (k, v) => { rows[k] = v },
  }
}

const VALID_KEY = 'AIzaSyA' + 'x'.repeat(32) // 39 位，形态同 Google API Key

describe('creator-credential · 输入校验', () => {
  it('接受 39 位 Google 形态的 key', () => {
    const r = validateApiKey(VALID_KEY)
    expect(r.ok).toBe(true)
    expect(r.key).toBe(VALID_KEY)
  })

  it('去空白后判定（用户粘贴时常带换行）', () => {
    expect(validateApiKey('  ' + VALID_KEY + '\n').key).toBe(VALID_KEY)
  })

  it.each([
    [null, 'not_a_string'],
    [42, 'not_a_string'],
    ['', 'empty'],
    ['   ', 'empty'],
    ['short', 'too_short'],
    ['x'.repeat(201), 'too_long'],
    ['AIza' + ' '.repeat(10) + 'x'.repeat(20), 'illegal_chars'],
    ['AIza' + '中'.repeat(20), 'illegal_chars'],
    ['AIza\tkey_with_tab_1234567890', 'illegal_chars'],
  ])('非法输入 %p → reason=%s', (input, reason) => {
    const r = validateApiKey(input)
    expect(r.ok).toBe(false)
    expect(r.reason).toBe(reason)
  })
})

describe('creator-credential · 保存与落点', () => {
  it('落点是 safeStorage 密文前缀，绝不写明文', () => {
    const store = createStore()
    const p = createCreatorCredentialProvider({ store, safeStorage: createSafeStorage(), log: { warn () {} } })
    const r = p.setApiKey(VALID_KEY)
    expect(r.ok).toBe(true)
    expect(r.fingerprint).toBe(fingerprintOf(VALID_KEY))
    const stored = store.rows[SETTING_KEY]
    expect(typeof stored).toBe('string')
    expect(stored.startsWith(SAFE_STORAGE_PREFIX)).toBe(true)
    expect(stored).not.toContain(VALID_KEY)
  })

  it('fingerprint 是 sha256 末 4 位，且不是 key 的子串', () => {
    const fp = fingerprintOf(VALID_KEY)
    expect(fp).toMatch(/^[0-9a-f]{4}$/)
    expect(VALID_KEY.includes(fp)).toBe(false)
    expect(fp).toBe(crypto.createHash('sha256').update(VALID_KEY).digest('hex').slice(-4))
  })

  it('safeStorage 不可用 → fail-closed，且**不落任何盘**', () => {
    const store = createStore()
    const p = createCreatorCredentialProvider({ store, safeStorage: createSafeStorage({ available: false }), log: { warn () {} } })
    const r = p.setApiKey(VALID_KEY)
    expect(r.ok).toBe(false)
    expect(r.status).toBe(CREDENTIAL_STATUS.UNAVAILABLE)
    expect(r.reason).toBe('safeStorage-unavailable')
    expect(SETTING_KEY in store.rows).toBe(false)
  })

  it('safeStorage 为 null（Linux 无 keyring / 纯 Node）同样 fail-closed', () => {
    const store = createStore()
    const p = createCreatorCredentialProvider({ store, safeStorage: null, log: { warn () {} } })
    expect(p.setApiKey(VALID_KEY).ok).toBe(false)
    expect(SETTING_KEY in store.rows).toBe(false)
  })

  it('store 不能持久化 → 明确 unavailable，而不是假装保存成功', () => {
    const p = createCreatorCredentialProvider({ store: { getSetting: () => null }, safeStorage: createSafeStorage(), log: { warn () {} } })
    const r = p.setApiKey(VALID_KEY)
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('store-unavailable')
  })

  it('写盘抛错 → persist-failed（不谎报成功）', () => {
    const store = createStore()
    store.setSetting = () => { throw new Error('disk full') }
    const p = createCreatorCredentialProvider({ store, safeStorage: createSafeStorage(), log: { warn () {} } })
    const r = p.setApiKey(VALID_KEY)
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('persist-failed')
  })

  it('形态不像 Google key 时仍保存，但如实回 looksLikeGoogleKey=false', () => {
    const store = createStore()
    const p = createCreatorCredentialProvider({ store, safeStorage: createSafeStorage(), log: { warn () {} } })
    const r = p.setApiKey('not-google-shaped-key-1234567890')
    expect(r.ok).toBe(true)
    expect(r.looksLikeGoogleKey).toBe(false)
  })
})

describe('creator-credential · 读取与四态', () => {
  const build = (seed, opts) => {
    const store = createStore(seed)
    const p = createCreatorCredentialProvider({ store, safeStorage: createSafeStorage(opts), log: { warn () {} } })
    return { store, p }
  }

  it('未配置 → not_configured', () => {
    const { p } = build()
    expect(p.status()).toEqual({ status: CREDENTIAL_STATUS.NOT_CONFIGURED })
    expect(p.getApiKey()).toBeNull()
  })

  it('密钥库不可用优先于「没配过」：报 unavailable 而不是 not_configured', () => {
    // 报成 not_configured 会把用户送去填 Key，然后卡在保存失败——环境问题必须排在最前
    const { p } = build({}, { available: false })
    expect(p.status()).toEqual({ status: CREDENTIAL_STATUS.UNAVAILABLE, reason: 'safeStorage-unavailable' })
  })

  it('往返：保存后 status=ok + fingerprint，getApiKey 取回原文', () => {
    const { p } = build()
    p.setApiKey(VALID_KEY)
    expect(p.status()).toEqual({ status: CREDENTIAL_STATUS.OK, fingerprint: fingerprintOf(VALID_KEY) })
    expect(p.getApiKey()).toBe(VALID_KEY)
  })

  it('QM-6 I2：刻意不提供 getCredential()——供给形状的唯一实现在容器适配闭包', () => {
    const { p } = build()
    p.setApiKey(VALID_KEY)
    // getCredential 若存在且只含 apiKey，改接它会让字幕腿的 pythonBridge 静默消失。
    // 这里锁「不存在」：谁想加回来，必须同时解释 pythonBridge 从哪来（并接进形状锁）。
    expect(p.getCredential).toBeUndefined()
  })

  it('有密文但 safeStorage 不可用 → unavailable（不是 not_configured）', () => {
    const { p } = build({ [SETTING_KEY]: SAFE_STORAGE_PREFIX + Buffer.from('enc:' + VALID_KEY).toString('base64') }, { available: false })
    expect(p.status()).toEqual({ status: CREDENTIAL_STATUS.UNAVAILABLE, reason: 'safeStorage-unavailable' })
    expect(p.getApiKey()).toBeNull()
  })

  it('解密抛错（换机 / DPAPI 变更）→ decrypt_failed', () => {
    const { p } = build({ [SETTING_KEY]: SAFE_STORAGE_PREFIX + Buffer.from('enc:' + VALID_KEY).toString('base64') }, { decryptThrows: true })
    expect(p.status()).toEqual({ status: CREDENTIAL_STATUS.DECRYPT_FAILED })
    expect(p.getApiKey()).toBeNull()
  })

  it('settings 里是**明文**（非本模块格式）→ 拒用并报 decrypt_failed', () => {
    const { store, p } = build({ [SETTING_KEY]: VALID_KEY })
    expect(p.status()).toEqual({ status: CREDENTIAL_STATUS.DECRYPT_FAILED })
    expect(p.getApiKey()).toBeNull()
    // 拒用的同时**不得**顺手把它"修好"或删掉（改数据的权力不在这里）
    expect(store.rows[SETTING_KEY]).toBe(VALID_KEY)
  })

  it('读取抛错 → read_failed（**不是** decrypt_failed / not_configured）', () => {
    // QM-6 W1：读失败（DB 锁/损坏）时重填无效，与「密文解不开（重填有效）」必须分开
    const store = createStore({ [SETTING_KEY]: SAFE_STORAGE_PREFIX + 'x' })
    store.getSetting = () => { throw new Error('db locked') }
    const p = createCreatorCredentialProvider({ store, safeStorage: createSafeStorage(), log: { warn () {} } })
    expect(p.status()).toEqual({ status: CREDENTIAL_STATUS.READ_FAILED })
    expect(p.getApiKey()).toBeNull()
  })

  it('无该键 + 读取抛错 + 解密失败三者互不合并（QM-6 W1 规格合规）', () => {
    const unavailableStore = { getSetting: () => { throw new Error('db locked') }, setSetting: () => {} }
    const p1 = createCreatorCredentialProvider({ store: unavailableStore, safeStorage: createSafeStorage(), log: { warn () {} } })
    expect(p1.status().status).toBe(CREDENTIAL_STATUS.READ_FAILED)

    const p2 = createCreatorCredentialProvider({ store: createStore(), safeStorage: createSafeStorage(), log: { warn () {} } })
    expect(p2.status().status).toBe(CREDENTIAL_STATUS.NOT_CONFIGURED)

    const p3 = build({ [SETTING_KEY]: SAFE_STORAGE_PREFIX + 'x' }, { decryptThrows: true })
    expect(p3.p.status().status).toBe(CREDENTIAL_STATUS.DECRYPT_FAILED)
    // 三种状态三个值，UI 才能给出三种不同的下一步动作
    expect(new Set([p1.status().status, p2.status().status, p3.p.status().status]).size).toBe(3)
  })

  it('解密结果为空串按 decrypt_failed（不把空 key 当可用凭证）', () => {
    const { p } = build({ [SETTING_KEY]: SAFE_STORAGE_PREFIX + Buffer.from('enc:').toString('base64') })
    expect(p.status()).toEqual({ status: CREDENTIAL_STATUS.DECRYPT_FAILED })
    expect(p.getApiKey()).toBeNull()
  })
})

describe('creator-credential · 安全不变量（回归锁）', () => {
  it('status() 的序列化结果里不得出现 key 明文', () => {
    const store = createStore()
    const p = createCreatorCredentialProvider({ store, safeStorage: createSafeStorage(), log: { warn () {} } })
    p.setApiKey(VALID_KEY)
    expect(JSON.stringify(p.status())).not.toContain(VALID_KEY)
    expect(JSON.stringify(p.status())).not.toContain(VALID_KEY.slice(0, 8))
  })

  it('日志里不得出现 key（含前缀片段）', () => {
    const messages = []
    const log = { warn: (m) => messages.push(String(m)) }
    const store = createStore()
    const p = createCreatorCredentialProvider({ store, safeStorage: createSafeStorage(), log })
    p.setApiKey(VALID_KEY)
    p.status()
    p.getApiKey()
    p.clear()
    for (const m of messages) {
      expect(m).not.toContain(VALID_KEY)
      expect(m).not.toContain(VALID_KEY.slice(0, 12))
      expect(m).not.toContain(VALID_KEY.slice(-8))
    }
  })

  it('clear() 之后回到 not_configured 且取不回 key', () => {
    const store = createStore()
    const p = createCreatorCredentialProvider({ store, safeStorage: createSafeStorage(), log: { warn () {} } })
    p.setApiKey(VALID_KEY)
    const r = p.clear()
    expect(r.ok).toBe(true)
    expect(r.status).toBe(CREDENTIAL_STATUS.NOT_CONFIGURED)
    expect(p.getApiKey()).toBeNull()
    expect(p.status().status).toBe(CREDENTIAL_STATUS.NOT_CONFIGURED)
  })

  it('clear() 写盘失败时如实报失败', () => {
    const store = createStore()
    const p = createCreatorCredentialProvider({ store, safeStorage: createSafeStorage(), log: { warn () {} } })
    store.setSetting = () => { throw new Error('disk full') }
    expect(p.clear()).toEqual({ ok: false, status: CREDENTIAL_STATUS.NOT_CONFIGURED, reason: 'persist-failed' })
  })

  it('canUseSafeStorage 对残缺实现一律 false（缺 decryptString 也算不可用）', () => {
    expect(canUseSafeStorage(null)).toBe(false)
    expect(canUseSafeStorage({ isEncryptionAvailable: () => true })).toBe(false)
    expect(canUseSafeStorage({ isEncryptionAvailable: () => false, encryptString: () => {}, decryptString: () => '' })).toBe(false)
    expect(canUseSafeStorage(createSafeStorage())).toBe(true)
  })
})
