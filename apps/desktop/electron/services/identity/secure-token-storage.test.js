const fs = require('fs')
const os = require('os')
const path = require('path')

describe('SecureTokenStorage', () => {
  let safeStorage
  let SecureTokenStorage
  let tempDirectory

  beforeEach(() => {
    safeStorage = {
      isEncryptionAvailable: () => true,
      encryptString: (value) => Buffer.from(`encrypted:${value}`),
      decryptString: (value) => Buffer.from(value).toString().replace(/^encrypted:/, ''),
    }
    SecureTokenStorage = require('./secure-token-storage')
  })

  afterEach(async () => {
    if (tempDirectory) {
      await fs.promises.rm(tempDirectory, { force: true, recursive: true })
      tempDirectory = null
    }
  })

  it('以 safeStorage 保存和读取会话，不暴露明文文件格式', async () => {
    const writes = []
    const storage = new SecureTokenStorage({
      safeStorage,
      read: async () => writes.at(-1) || null,
      write: async (value) => writes.push(value),
    })

    await storage.save({ refreshToken: 'refresh-secret', subject: 'sub-1' })

    expect(writes).toHaveLength(1)
    expect(writes[0]).not.toContain('refresh-secret')
    expect(await storage.load()).toEqual({ refreshToken: 'refresh-secret', subject: 'sub-1' })
  })

  it('safeStorage 不可用时明文存储（v2 回退）', async () => {
    let written = null
    const storage = new SecureTokenStorage({
      safeStorage: { isEncryptionAvailable: () => false },
      read: async () => null,
      write: async (value) => { written = value },
    })

    await expect(storage.save({ refreshToken: 'secret' })).resolves.toBeUndefined()
    expect(written).not.toBeNull()
    expect(JSON.parse(written).encrypted).toBe(false)
  })

  it.each([null, [], 'session'])('拒绝非对象会话：%p', async (session) => {
    const storage = new SecureTokenStorage({
      safeStorage,
      read: async () => null,
      write: async () => { throw new Error('不应写入非法会话') },
    })

    await expect(storage.save(session)).rejects.toMatchObject({ code: 'IDENTITY_SESSION_INVALID' })
  })

  it('使用真实文件完成原子写入、读取和清理', async () => {
    tempDirectory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'multi-publish-token-'))
    const filePath = path.join(tempDirectory, 'identity-session.json')
    const storage = new SecureTokenStorage({ safeStorage, filePath })

    await storage.save({ refreshToken: 'real-file-secret' })
    const envelope = await fs.promises.readFile(filePath, 'utf8')
    expect(envelope).not.toContain('real-file-secret')
    await expect(storage.load()).resolves.toEqual({ refreshToken: 'real-file-secret' })
    await storage.clear()
    await expect(fs.promises.stat(filePath)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('损坏密文返回空会话并触发清理', async () => {
    let removed = false
    const storage = new SecureTokenStorage({
      safeStorage: {
        isEncryptionAvailable: () => true,
        decryptString: () => { throw new Error('bad ciphertext') },
      },
      read: async () => 'not-valid',
      remove: async () => { removed = true },
    })

    await expect(storage.load()).resolves.toBeNull()
    expect(removed).toBe(true)
  })

  it.each([
    [JSON.stringify({ version: 2, ciphertext: 'encrypted-session' }), 'not-valid-json'],
    [JSON.stringify({ version: 1, ciphertext: 42 }), '{}'],
    [JSON.stringify({ version: 1, ciphertext: 'encrypted-session' }), '[]'],
  ])('无效 envelope 或会话结构会清理：%s', async (envelope, plaintext) => {
    let removed = false
    const storage = new SecureTokenStorage({
      safeStorage: {
        isEncryptionAvailable: () => true,
        decryptString: () => plaintext,
      },
      read: async () => envelope,
      remove: async () => { removed = true },
    })

    await expect(storage.load()).resolves.toBeNull()
    expect(removed).toBe(true)
  })

  it('安全存储暂时不可用时保留密文以便下次重试', async () => {
    let removed = false
    const storage = new SecureTokenStorage({
      safeStorage: { isEncryptionAvailable: () => false },
      read: async () => JSON.stringify({ version: 1, ciphertext: 'encrypted-session' }),
      remove: async () => { removed = true },
    })

    await expect(storage.load()).rejects.toMatchObject({ code: 'IDENTITY_SECURE_STORAGE_UNAVAILABLE' })
    expect(removed).toBe(false)
  })

  it('实现 Logto Adapter 的 getItem/setItem/removeItem 契约', async () => {
    let persisted = null
    const storage = new SecureTokenStorage({
      safeStorage,
      read: async () => persisted,
      write: async (value) => { persisted = value },
      remove: async () => { persisted = null },
    })

    await storage.setItem('refreshToken', 'refresh-1')
    await storage.setItem('idToken', 'id-1')
    expect(await storage.getItem('refreshToken')).toBe('refresh-1')
    await storage.removeItem('refreshToken')
    expect(await storage.getItem('refreshToken')).toBeNull()
    expect(await storage.getItem('idToken')).toBe('id-1')
  })

  it('并发写入多个 Logto Token 不丢字段', async () => {
    let persisted = null
    const storage = new SecureTokenStorage({
      safeStorage,
      read: async () => persisted,
      write: async (value) => { await new Promise((resolve) => setTimeout(resolve, 2)); persisted = value },
      remove: async () => { persisted = null },
    })
    await Promise.all([storage.setItem('refreshToken', 'refresh-2'), storage.setItem('idToken', 'id-2')])
    await expect(storage.getItem('refreshToken')).resolves.toBe('refresh-2')
    await expect(storage.getItem('idToken')).resolves.toBe('id-2')
  })

  it('清理与正在进行的 Token 写入串行，清理完成后不会写回旧会话', async () => {
    let persisted = null
    let releaseWrite
    const writeStarted = new Promise((resolve) => { releaseWrite = resolve })
    const storage = new SecureTokenStorage({
      safeStorage,
      read: async () => persisted,
      write: async (value) => {
        await writeStarted
        persisted = value
      },
      remove: async () => { persisted = null },
    })

    const writePromise = storage.setItem('refreshToken', 'old-token')
    await Promise.resolve()
    const clearPromise = storage.clear()
    releaseWrite()
    await Promise.all([writePromise, clearPromise])

    expect(persisted).toBeNull()
  })

  // —— 2026-09-14 缺陷回归：删除被系统拒绝时不得让「清空会话」整体失败 ——

  it('删除被拒绝（宿主安全删除 shim fail-closed）时降级为覆写「已清空」信封', async () => {
    let persisted = JSON.stringify({ version: 2, ciphertext: 'c2VjcmV0', encrypted: false })
    let removeCalls = 0
    const storage = new SecureTokenStorage({
      safeStorage,
      filePath: path.join(os.tmpdir(), 'multi-publish-token-cleared', 'identity-session.json'),
      read: async () => persisted,
      write: async (value) => { persisted = value },
      remove: async () => {
        removeCalls += 1
        // 复刻真实错误形态：宿主 shim 的 fail-closed 错误**不带 .code**
        throw new Error('[safe-delete][SAFE_DELETE_BULK_CONFIRM_REQUIRED] {"count":500,"threshold":500}')
      },
    })

    await expect(storage.clear()).resolves.toBeUndefined()
    expect(removeCalls).toBe(1)
    expect(JSON.parse(persisted).cleared).toBe(true)
    await expect(storage.load()).resolves.toBeNull()
  })

  it('删除遇到瞬时错误（EBUSY）时有界重试，成功后不降级覆写', async () => {
    tempDirectory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'multi-publish-token-retry-'))
    const filePath = path.join(tempDirectory, 'identity-session.json')
    await fs.promises.writeFile(filePath, JSON.stringify({ version: 2, ciphertext: 'c2VjcmV0', encrypted: false }))
    const realFs = fs.promises
    let unlinkAttempts = 0
    const storage = new SecureTokenStorage({
      safeStorage,
      filePath,
      retryDelaysMs: [1, 1],
      fs: {
        mkdir: realFs.mkdir.bind(realFs),
        writeFile: realFs.writeFile.bind(realFs),
        readdir: realFs.readdir.bind(realFs),
        stat: realFs.stat.bind(realFs),
        rename: realFs.rename.bind(realFs),
        unlink: async (target) => {
          unlinkAttempts += 1
          if (unlinkAttempts < 3) throw Object.assign(new Error('file locked'), { code: 'EBUSY' })
          return realFs.unlink(target)
        },
      },
    })

    await expect(storage.clear()).resolves.toBeUndefined()
    expect(unlinkAttempts).toBe(3)
    await expect(fs.promises.stat(filePath)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('删除与覆写都失败时报 IDENTITY_SESSION_CLEAR_FAILED，并保留原始 cause 便于诊断', async () => {
    const storage = new SecureTokenStorage({
      safeStorage,
      filePath: path.join(os.tmpdir(), 'multi-publish-token-failed', 'identity-session.json'),
      read: async () => '{}',
      write: async () => { throw new Error('write denied') },
      remove: async () => { throw new Error('unlink denied') },
    })

    const error = await storage.clear().catch((thrown) => thrown)
    expect(error).toMatchObject({ code: 'IDENTITY_SESSION_CLEAR_FAILED' })
    expect(error.cause).toBeInstanceOf(Error)
    expect(error.cause.message).toBe('write denied')
  })

  it('原子写入 rename 瞬时失败时重试，成功且不残留临时文件', async () => {
    tempDirectory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'multi-publish-token-rename-'))
    const filePath = path.join(tempDirectory, 'identity-session.json')
    const realFs = fs.promises
    let renameAttempts = 0
    const storage = new SecureTokenStorage({
      safeStorage,
      filePath,
      retryDelaysMs: [1, 1],
      fs: {
        mkdir: realFs.mkdir.bind(realFs),
        writeFile: realFs.writeFile.bind(realFs),
        readdir: realFs.readdir.bind(realFs),
        stat: realFs.stat.bind(realFs),
        unlink: realFs.unlink.bind(realFs),
        rename: async (from, to) => {
          renameAttempts += 1
          if (renameAttempts === 1) throw Object.assign(new Error('file locked'), { code: 'EPERM' })
          return realFs.rename(from, to)
        },
      },
    })

    await storage.save({ refreshToken: 'secret' })
    expect(renameAttempts).toBe(2)
    await expect(storage.load()).resolves.toEqual({ refreshToken: 'secret' })
    const leftovers = (await realFs.readdir(tempDirectory)).filter((name) => name.endsWith('.tmp'))
    expect(leftovers).toEqual([])
  })

  it('保存时回收超过保留时间的遗留临时文件（残留自愈）', async () => {
    tempDirectory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'multi-publish-token-sweep-'))
    const filePath = path.join(tempDirectory, 'identity-session.json')
    const staleTemp = `${filePath}.9999.tmp`
    await fs.promises.writeFile(staleTemp, 'stale')
    const oldMtime = new Date(Date.now() - 10 * 60 * 1000)
    await fs.promises.utimes(staleTemp, oldMtime, oldMtime)
    const freshTemp = `${filePath}.8888.tmp`
    await fs.promises.writeFile(freshTemp, 'in-flight')
    const storage = new SecureTokenStorage({ safeStorage, filePath })

    await storage.save({ refreshToken: 'fresh' })

    await expect(fs.promises.stat(staleTemp)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(fs.promises.stat(freshTemp)).resolves.toBeDefined()
    await expect(storage.load()).resolves.toEqual({ refreshToken: 'fresh' })
  })
})
