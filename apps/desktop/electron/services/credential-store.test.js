import { afterEach, describe, expect, it, vi } from 'vitest'
import lockHelper from '../../../../test-helpers/windows-file-lock.js'

const { holdExclusiveWindowsFileLock, LOCK_CASE_TIMEOUT_MS } = lockHelper
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'

import * as credentialStore from './credential-store.js'

const tempDirs = []

afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

function createTempDir () {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'multi-publish-credentials-'))
  tempDirs.push(dir)
  return dir
}

function createSafeStorage () {
  return {
    isEncryptionAvailable: () => true,
    encryptString: value => Buffer.from(`protected:${value}`, 'utf8'),
    decryptString: value => Buffer.from(value).toString('utf8').replace(/^protected:/, ''),
  }
}

// 模拟「DPAPI 状态变化」：历史密文无法解密，但新写入的密文可正常解密
function createLegacyCiphertextFailingSafeStorage () {
  const secrets = new Map()
  return {
    isEncryptionAvailable: () => true,
    encryptString: value => {
      const ciphertext = `protected:${value}:${secrets.size}`
      secrets.set(ciphertext, String(value))
      return Buffer.from(ciphertext, 'utf8')
    },
    decryptString: value => {
      const ciphertext = Buffer.from(value).toString('utf8')
      const plaintext = secrets.get(ciphertext)
      if (plaintext === undefined) {
        throw new Error('Error while decrypting the ciphertext provided to safeStorage.decryptString.')
      }
      return plaintext
    },
  }
}

describe('credential-store', () => {
  it('round-trips cookies as part of the encrypted credential record and reports success', () => {
    const userDataDir = createTempDir()
    const data = {
      cookies: [{ name: 'session', value: 'secret' }],
      localStorage: { token: 'private' },
      indexedDB: { secure: { value: 'private' } },
      accountInfo: { platformAccountId: 'acct-1' },
    }

    const options = { safeStorage: createSafeStorage() }
    expect(credentialStore.saveCredential('acct-1', data, userDataDir, options)).toBe(true)
    expect(credentialStore.loadCredential('acct-1', userDataDir, options)).toEqual(data)
  })

  it('uses the OS protected master-key envelope when safeStorage is available', () => {
    const userDataDir = createTempDir()
    const safeStorage = createSafeStorage()

    credentialStore.saveCredential('acct-2', { cookies: [] }, userDataDir, { safeStorage })
    const keyFile = path.join(userDataDir, 'credentials', '.masterkey')
    const key = fs.readFileSync(keyFile, 'utf8')
    expect(key.startsWith('safeStorage:v1:')).toBe(true)
    expect(key).not.toContain('protected:')
    expect(credentialStore.loadCredential('acct-2', userDataDir, { safeStorage })).toEqual({ cookies: [] })
  })

  it('系统凭据保护不可用时拒绝创建可被离线解密的主密钥', () => {
    const userDataDir = createTempDir()

    expect(credentialStore.saveCredential('acct-unsafe', { cookies: [] }, userDataDir, { safeStorage: null })).toBe(false)
    expect(fs.existsSync(path.join(userDataDir, 'credentials', '.masterkey'))).toBe(false)
    expect(fs.existsSync(path.join(userDataDir, 'credentials', 'acct-unsafe.json.enc'))).toBe(false)
  })

  it('相同账号 ID 在不同 owner 下使用独立凭证文件和密钥空间', () => {
    const userDataDir = createTempDir()
    const ownerA = 'user-a'
    const ownerB = 'user-b'

    expect(credentialStore.saveCredential('shared', { owner: ownerA }, userDataDir, {
      ownerSubject: ownerA,
      safeStorage: createSafeStorage(),
    })).toBe(true)
    expect(credentialStore.saveCredential('shared', { owner: ownerB }, userDataDir, {
      ownerSubject: ownerB,
      safeStorage: createSafeStorage(),
    })).toBe(true)
    expect(credentialStore.loadCredential('shared', userDataDir, {
      ownerSubject: ownerA,
      safeStorage: createSafeStorage(),
    })).toEqual({ owner: ownerA })
    expect(credentialStore.loadCredential('shared', userDataDir, {
      ownerSubject: ownerB,
      safeStorage: createSafeStorage(),
    })).toEqual({ owner: ownerB })
    expect(credentialStore.getOwnerCredentialDir(userDataDir, ownerA)).not.toBe(
      credentialStore.getOwnerCredentialDir(userDataDir, ownerB),
    )
    expect(credentialStore.hasCredential('shared', userDataDir, ownerA)).toBe(true)
    expect(credentialStore.deleteCredential('shared', userDataDir, ownerA)).toBe(true)
    expect(credentialStore.loadCredential('shared', userDataDir, {
      ownerSubject: ownerA,
      safeStorage: createSafeStorage(),
    })).toBeNull()
    expect(credentialStore.loadCredential('shared', userDataDir, {
      ownerSubject: ownerB,
      safeStorage: createSafeStorage(),
    })).toEqual({ owner: ownerB })
  })

  it('兼容历史无前缀主密钥并在可用时迁移到系统保护格式', () => {
    const userDataDir = createTempDir()
    const credDir = path.join(userDataDir, 'credentials')
    fs.mkdirSync(credDir, { recursive: true })
    const legacyKey = 'a'.repeat(64)
    fs.writeFileSync(path.join(credDir, '.masterkey'), legacyKey, 'utf8')

    expect(credentialStore.getMasterKey(credDir, { safeStorage: createSafeStorage() })).toBe(legacyKey)
    expect(fs.readFileSync(path.join(credDir, '.masterkey'), 'utf8')).toMatch(/^safeStorage:v1:/)
  })

  it('拒绝格式不合法的无前缀主密钥', () => {
    const userDataDir = createTempDir()
    const credDir = path.join(userDataDir, 'credentials')
    fs.mkdirSync(credDir, { recursive: true })
    fs.writeFileSync(path.join(credDir, '.masterkey'), 'not-a-master-key', 'utf8')

    expect(() => credentialStore.getMasterKey(credDir, { safeStorage: null })).toThrow('主密钥格式无效')
  })

  it('主密钥损坏时从合法备份恢复', () => {
    const userDataDir = createTempDir()
    const credDir = path.join(userDataDir, 'credentials')
    fs.mkdirSync(credDir, { recursive: true })
    const legacyKey = 'b'.repeat(64)
    fs.writeFileSync(path.join(credDir, '.masterkey'), 'corrupted', 'utf8')
    fs.writeFileSync(path.join(credDir, '.masterkey.bak'), legacyKey, 'utf8')

    expect(credentialStore.getMasterKey(credDir, { safeStorage: createSafeStorage() })).toBe(legacyKey)
    expect(fs.readFileSync(path.join(credDir, '.masterkey'), 'utf8')).toMatch(/^safeStorage:v1:/)
  })

  // 显式超时 30s：真实 Windows 文件锁 + 有界重试在 CI 全量单进程负载下可能超过全局 10s 上限（偶发超时）
  it.skipIf(process.platform !== 'win32')('Windows 主密钥短暂锁释放后仍能完成格式迁移', { timeout: LOCK_CASE_TIMEOUT_MS }, async () => {
    const userDataDir = createTempDir()
    const credDir = path.join(userDataDir, 'credentials')
    const keyFile = path.join(credDir, '.masterkey')
    const legacyKey = 'c'.repeat(64)
    fs.mkdirSync(credDir, { recursive: true })
    fs.writeFileSync(keyFile, legacyKey, 'utf8')
    const fileLock = await holdExclusiveWindowsFileLock(keyFile, 180)

    try {
      expect(credentialStore.getMasterKey(credDir, { safeStorage: createSafeStorage() })).toBe(legacyKey)
      await fileLock.release()
      expect(fs.readFileSync(keyFile, 'utf8')).toMatch(/^safeStorage:v1:/)
      expect(fs.existsSync(`${keyFile}.tmp.${process.pid}`)).toBe(false)
    } finally {
      await fileLock.release().catch(() => {})
    }
  })

  it.skipIf(process.platform !== 'win32')('Windows 主密钥备份短暂锁释放后仍能完成格式迁移', { timeout: LOCK_CASE_TIMEOUT_MS }, async () => {
    const userDataDir = createTempDir()
    const credDir = path.join(userDataDir, 'credentials')
    const keyFile = path.join(credDir, '.masterkey')
    const backupFile = `${keyFile}.bak`
    const legacyKey = 'd'.repeat(64)
    fs.mkdirSync(credDir, { recursive: true })
    fs.writeFileSync(keyFile, legacyKey, 'utf8')
    fs.writeFileSync(backupFile, legacyKey, 'utf8')
    const fileLock = await holdExclusiveWindowsFileLock(backupFile, 180)

    try {
      expect(credentialStore.getMasterKey(credDir, { safeStorage: createSafeStorage() })).toBe(legacyKey)
      await fileLock.release()
      expect(fs.readFileSync(backupFile, 'utf8')).toMatch(/^safeStorage:v1:/)
      expect(fs.existsSync(`${backupFile}.tmp.${process.pid}`)).toBe(false)
    } finally {
      await fileLock.release().catch(() => {})
    }
  })

  it('safeStorage 无法解密既有主密钥且库中无凭证时自动重建主密钥', () => {
    const userDataDir = createTempDir()
    const credDir = path.join(userDataDir, 'credentials')
    fs.mkdirSync(credDir, { recursive: true })
    fs.writeFileSync(path.join(credDir, '.masterkey'), 'safeStorage:v1:stale-ciphertext', 'utf8')

    const safeStorage = createLegacyCiphertextFailingSafeStorage()

    const key = credentialStore.getMasterKey(credDir, { safeStorage })
    expect(key).toMatch(/^[0-9a-f]{64}$/)
    expect(fs.readFileSync(path.join(credDir, '.masterkey'), 'utf8')).toMatch(/^safeStorage:v1:/)
    expect(credentialStore.saveCredential('acct-recovered', { cookies: [] }, userDataDir, { safeStorage })).toBe(true)
    expect(credentialStore.loadCredential('acct-recovered', userDataDir, { safeStorage })).toEqual({ cookies: [] })
  })

  it('owners 命名空间为空目录时主密钥可自愈重建（目录迁移后空库场景）', () => {
    const userDataDir = createTempDir()
    const credDir = path.join(userDataDir, 'credentials')
    const ownerDir = path.join(credDir, 'owners', 'f'.repeat(64))
    fs.mkdirSync(ownerDir, { recursive: true })
    fs.writeFileSync(path.join(credDir, '.masterkey'), 'safeStorage:v1:stale-ciphertext', 'utf8')

    const safeStorage = createLegacyCiphertextFailingSafeStorage()

    expect(credentialStore.getMasterKey(credDir, { safeStorage })).toMatch(/^[0-9a-f]{64}$/)
    expect(credentialStore.saveCredential('acct-recovered-owner', { cookies: [] }, userDataDir, {
      ownerSubject: 'user-a',
      safeStorage,
    })).toBe(true)
    expect(credentialStore.loadCredential('acct-recovered-owner', userDataDir, {
      ownerSubject: 'user-a',
      safeStorage,
    })).toEqual({ cookies: [] })
  })

  it('safeStorage 无法解密主密钥且库中根目录存在凭证时保持 fail-closed', () => {
    const userDataDir = createTempDir()
    const credDir = path.join(userDataDir, 'credentials')
    fs.mkdirSync(credDir, { recursive: true })
    fs.writeFileSync(path.join(credDir, '.masterkey'), 'safeStorage:v1:stale-ciphertext', 'utf8')
    fs.writeFileSync(path.join(credDir, 'existing-account.json.enc'), 'opaque', 'utf8')

    const safeStorage = createSafeStorage()
    safeStorage.decryptString = () => {
      throw new Error('Error while decrypting the ciphertext provided to safeStorage.decryptString.')
    }

    expect(() => credentialStore.getMasterKey(credDir, { safeStorage })).toThrow('Error while decrypting')
    expect(fs.readFileSync(path.join(credDir, '.masterkey'), 'utf8')).toBe('safeStorage:v1:stale-ciphertext')
    expect(credentialStore.saveCredential('acct-x', { cookies: [] }, userDataDir, { safeStorage })).toBe(false)
  })

  it('owners 命名空间下存在凭证时主密钥无法解密保持 fail-closed', () => {
    const userDataDir = createTempDir()
    const credDir = path.join(userDataDir, 'credentials')
    const ownerDir = path.join(credDir, 'owners', 'f'.repeat(64))
    fs.mkdirSync(ownerDir, { recursive: true })
    fs.writeFileSync(path.join(credDir, '.masterkey'), 'safeStorage:v1:stale-ciphertext', 'utf8')
    fs.writeFileSync(path.join(ownerDir, 'owner-acct.json.enc'), 'opaque', 'utf8')

    const safeStorage = createSafeStorage()
    safeStorage.decryptString = () => {
      throw new Error('Error while decrypting the ciphertext provided to safeStorage.decryptString.')
    }

    expect(() => credentialStore.getMasterKey(credDir, { safeStorage })).toThrow('Error while decrypting')
    expect(credentialStore.saveCredential('acct-y', { cookies: [] }, userDataDir, { safeStorage })).toBe(false)
    expect(fs.readFileSync(path.join(credDir, '.masterkey'), 'utf8')).toBe('safeStorage:v1:stale-ciphertext')
  })

  it('safeStorage 不可用且主密钥无法解密时保持 fail-closed（拒绝明文主密钥）', () => {
    const userDataDir = createTempDir()
    const credDir = path.join(userDataDir, 'credentials')
    fs.mkdirSync(credDir, { recursive: true })
    fs.writeFileSync(path.join(credDir, '.masterkey'), 'safeStorage:v1:stale-ciphertext', 'utf8')

    expect(() => credentialStore.getMasterKey(credDir, { safeStorage: null })).toThrow('系统凭据保护不可用')
    expect(fs.readFileSync(path.join(credDir, '.masterkey'), 'utf8')).toBe('safeStorage:v1:stale-ciphertext')
    expect(credentialStore.saveCredential('acct-z', { cookies: [] }, userDataDir, { safeStorage: null })).toBe(false)
  })

  it.skipIf(process.platform !== 'win32')('Windows 凭据文件短暂锁释放后原子保存成功', { timeout: LOCK_CASE_TIMEOUT_MS }, async () => {
    const userDataDir = createTempDir()
    const options = { safeStorage: createSafeStorage() }
    const accountId = 'locked-account'
    const filePath = path.join(userDataDir, 'credentials', `${accountId}.json.enc`)
    expect(credentialStore.saveCredential(accountId, { version: 1 }, userDataDir, options)).toBe(true)
    const fileLock = await holdExclusiveWindowsFileLock(filePath, 180)

    try {
      expect(credentialStore.saveCredential(accountId, { version: 2 }, userDataDir, options)).toBe(true)
      await fileLock.release()
      expect(credentialStore.loadCredential(accountId, userDataDir, options)).toEqual({ version: 2 })
      expect(fs.existsSync(`${filePath}.tmp.${process.pid}`)).toBe(false)
    } finally {
      await fileLock.release().catch(() => {})
    }
  })
})

// ─── 账号页首帧卡顿修复（2026-10-14）─────────────────────────────────
// 根因：listAccounts() 为给每个账号附加 proxy 状态，逐个同步解密凭证文件；
// 每次解密都要跑一次 PBKDF2（10 万次迭代，实测约 125ms/账号），
// N 个账号 = N × 125ms 串行阻塞主进程 IPC —— 这就是「点左侧菜单『账号』
// 反应特别慢」的直接原因。
//
// 修复：新增异步批量入口 loadProxyStatuses()，用 libuv 线程池并行派生 key
// （crypto.pbkdf2 异步版），把 N 次串行阻塞降为近似 1 次的等待。
//
// 契约（本 describe 逐条钉死）：
//  C1 与 loadCredential 的 proxy 结论逐字段一致（含 configured/invalid/类型/掩码/端口）
//  C2 解密失败（文件损坏/主密钥不可用）时该账号降级 { configured: false }，不抛错
//  C3 凭证文件不存在时同样 { configured: false }，且不触发主密钥读取
//  C4 空输入返回空对象；不含 owner 的输入走 legacy 命名空间
//  C5 **并行不串行**：N 个账号的总 wall-time 必须显著小于 N × 单账号耗时
//     （这是本 Bug 的回归锁——退回串行实现必须变红）
describe('credential-store — loadProxyStatuses 并行批量读取', () => {
  /** 造一个带 proxy 的凭证并落盘，返回其明文 proxy 配置 */
  function seedAccount (userDataDir, accountId, proxy, options) {
    expect(credentialStore.saveCredential(accountId, { cookies: [], proxy }, userDataDir, options)).toBe(true)
    return proxy
  }

  it('C1 与逐账号 loadCredential 的 proxy 结论逐字段一致', async () => {
    const userDataDir = createTempDir()
    const options = { safeStorage: createSafeStorage() }
    const proxy = { host: '10.0.0.7', port: 8080, type: 'socks5', username: 'u', password: 'p' }
    seedAccount(userDataDir, 'acct-parity', proxy, options)

    const viaBatch = await credentialStore.loadProxyStatuses(['acct-parity'], userDataDir, options)
    // 单账号口径：走 loadCredential + toPublicProxyConfig
    const viaSingle = credentialStore.loadCredential('acct-parity', userDataDir, options)
    expect(viaBatch['acct-parity']).toBeDefined()
    expect(viaBatch['acct-parity'].configured).toBe(true)
    expect(viaBatch['acct-parity'].type).toBe('socks5')
    expect(viaBatch['acct-parity'].hostMasked).toBe('10.0.*.*')
    expect(viaBatch['acct-parity'].port).toBe(8080)
    expect(viaBatch['acct-parity'].hasAuthentication).toBe(true)
    // 单账号路径确实也看得到同一份 proxy（证明两侧读的是同一真源）
    expect(viaSingle.proxy).toEqual(proxy)
  })

  it('C2 解密失败（文件损坏）时该账号降级 configured:false 且不抛错', async () => {
    const userDataDir = createTempDir()
    const options = { safeStorage: createSafeStorage() }
    seedAccount(userDataDir, 'acct-ok', { host: '10.0.0.1', port: 3128 }, options)
    const credDir = path.join(userDataDir, 'credentials')
    // 另一个账号：文件存在但内容不是合法密文 → 解密必失败
    fs.writeFileSync(path.join(credDir, 'acct-corrupt.json.enc'), Buffer.from('not-a-valid-ciphertext'))

    const result = await credentialStore.loadProxyStatuses(['acct-ok', 'acct-corrupt'], userDataDir, options)

    expect(result['acct-ok'].configured).toBe(true)
    expect(result['acct-corrupt']).toEqual({ configured: false })
  })

  it('C3 凭证文件不存在时 configured:false 且不触发主密钥读取', async () => {
    const userDataDir = createTempDir()
    const safeStorage = createSafeStorage()
    const getMasterKey = vi.spyOn(credentialStore, 'getMasterKey')

    const result = await credentialStore.loadProxyStatuses(['acct-missing'], userDataDir, { safeStorage })

    expect(result['acct-missing']).toEqual({ configured: false })
    expect(getMasterKey).not.toHaveBeenCalled()
    getMasterKey.mockRestore()
  })

  it('C4 空输入返回空对象；无 owner 时走 legacy 命名空间', async () => {
    const userDataDir = createTempDir()
    const options = { safeStorage: createSafeStorage() }

    expect(await credentialStore.loadProxyStatuses([], userDataDir, options)).toEqual({})

    // legacy 命名空间（不传 ownerSubject）
    seedAccount(userDataDir, 'acct-legacy', { host: '10.0.0.2', port: 7890 }, options)
    const legacy = await credentialStore.loadProxyStatuses(['acct-legacy'], userDataDir, options)
    expect(legacy['acct-legacy'].configured).toBe(true)
    expect(legacy['acct-legacy'].port).toBe(7890)

    // owner 命名空间：同 id 不同 owner 是不同文件
    seedAccount(userDataDir, 'acct-shared', { host: '10.0.0.3', port: 1080 }, {
      safeStorage: createSafeStorage(),
      ownerSubject: 'user-a',
    })
    const scoped = await credentialStore.loadProxyStatuses(['acct-shared'], userDataDir, {
      safeStorage: createSafeStorage(),
      ownerSubject: 'user-a',
    })
    expect(scoped['acct-shared'].configured).toBe(true)
    expect(scoped['acct-shared'].port).toBe(1080)
  })

  // ⚠ 判据形态说明（QM-6 评审 i3，已采纳）：
  // 本用例最初用 wall-time 比值（batchMs/singleMs < N/2）判「并行不串行」。
  // 实测该判据**跨环境不可移植**：UV_THREADPOOL_SIZE=1 时并行版 ratio=5.49
  // （与串行 6 几乎无异）——单线程下并行物理上退化为串行，于是**真实的并行
  // 实现被误判红**，CI 上必成 flaky。
  //
  // 改为**结构性判据**：直接观测 crypto.pbkdf2 的并发调用数。
  // 串行实现（pbkdf2Sync 或 for 循环 await）任意时刻至多 1 个 in-flight；
  // 并行实现（Promise.all）会同时发起 N 个。这个数字与机器核心数、线程池
  // 规模、负载无关，任何环境上都稳定。
  it('C5 并行不串行：N 个账号的 PBKDF2 派生必须并发发起（结构性判据，跨环境稳定）', async () => {
    const userDataDir = createTempDir()
    const options = { safeStorage: createSafeStorage() }
    const N = 6
    const ids = []
    for (let i = 0; i < N; i++) {
      const id = `acct-batch-${i}`
      ids.push(id)
      seedAccount(userDataDir, id, { host: `10.0.0.${i + 1}`, port: 9000 + i }, options)
    }

    // 观测 PBKDF2 的真实并发度：包一层 crypto.pbkdf2，记录最大 in-flight 数
    const realPbkdf2 = crypto.pbkdf2
    let inFlight = 0
    let maxInFlight = 0
    crypto.pbkdf2 = function (...args) {
      inFlight += 1
      if (inFlight > maxInFlight) maxInFlight = inFlight
      const done = () => { inFlight -= 1 }
      const cb = args[args.length - 1]
      args[args.length - 1] = (...cbArgs) => { done(); cb(...cbArgs) }
      return realPbkdf2.apply(crypto, args)
    }

    let result
    try {
      result = await credentialStore.loadProxyStatuses(ids, userDataDir, options)
    } finally {
      crypto.pbkdf2 = realPbkdf2
    }

    // 功能面：全部命中
    for (const id of ids) expect(result[id].configured).toBe(true)

    // 结构面：并行实现必须让多个派生同时在飞。
    // 串行实现（pbkdf2Sync / for-await）maxInFlight 恒为 1 ⇒ 本断言判红，
    // 且该结论不依赖机器核心数、UV_THREADPOOL_SIZE 或当时负载。
    expect(
      maxInFlight,
      `PBKDF2 最大并发数=${maxInFlight}（串行实现应为 1）`,
    ).toBeGreaterThan(1)
  })
})
