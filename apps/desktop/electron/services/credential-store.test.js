import { afterEach, describe, expect, it } from 'vitest'
import lockHelper from '../../../../test-helpers/windows-file-lock.js'

const { holdExclusiveWindowsFileLock } = lockHelper
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

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
  it.skipIf(process.platform !== 'win32')('Windows 主密钥短暂锁释放后仍能完成格式迁移', { timeout: 60000 }, async () => {
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

  it.skipIf(process.platform !== 'win32')('Windows 主密钥备份短暂锁释放后仍能完成格式迁移', { timeout: 60000 }, async () => {
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

  it.skipIf(process.platform !== 'win32')('Windows 凭据文件短暂锁释放后原子保存成功', { timeout: 60000 }, async () => {
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
