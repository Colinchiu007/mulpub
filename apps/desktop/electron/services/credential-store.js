// @ts-check
/**
 * CredentialStore — 凭证双层存储
 * 
 * 基于参考产品逆向分析的 CookieContainer 双层架构：
 * 
 * 第一层：Session Cookie（Electron session.fromPartition）
 *   - 每个账号独立 session 分区 persist:auth-{accountId}
 *   - Cookie 自动持久化到 Electron 磁盘
 * 
 * 第二层：应用层凭证（localStorage + accountInfo）
 *   - 从 webview 中提取 localStorage 键值对
 *   - 保存账号信息（昵称、头像等）
 *   - 使用 AES-256-GCM 加密存储
 * 
 * 文件路径:
 *   legacy: {userData}/credentials/{accountId}.json.enc
 *   Logto:  {userData}/credentials/owners/{sha256(sub)}/{accountId}.json.enc
 */
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const log = require('./logger')

const ALGORITHM = 'aes-256-gcm'
const KEY_LENGTH = 32
const IV_LENGTH = 16
const TAG_LENGTH = 16
const SALT_LENGTH = 32
const SAFE_STORAGE_PREFIX = 'safeStorage:v1:'
const PLAINTEXT_PREFIX = 'plaintext:v1:'
const MASTER_KEY_PATTERN = /^[0-9a-f]{64}$/i
const TRANSIENT_WINDOWS_RENAME_ERRORS = new Set(['EPERM', 'EACCES', 'EBUSY'])
const ATOMIC_RENAME_RETRY_DELAYS_MS = [20, 40, 80, 160, 320, 640]
const ATOMIC_RENAME_WAIT_BUFFER = new Int32Array(new SharedArrayBuffer(4))

function atomicRenameSync (sourcePath, targetPath) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      fs.renameSync(sourcePath, targetPath)
      return
    } catch (error) {
      const delayMs = ATOMIC_RENAME_RETRY_DELAYS_MS[attempt]
      const isTransientWindowsLock = process.platform === 'win32' &&
        TRANSIENT_WINDOWS_RENAME_ERRORS.has(error?.code)
      if (!isTransientWindowsLock || delayMs === undefined) throw error

      Atomics.wait(ATOMIC_RENAME_WAIT_BUFFER, 0, 0, delayMs)
    }
  }
}

function validateMasterKey (masterKey) {
  if (typeof masterKey !== 'string' || !MASTER_KEY_PATTERN.test(masterKey)) {
    throw new Error('主密钥格式无效')
  }
  return masterKey
}

function resolveSafeStorage (options = {}) {
  if (Object.prototype.hasOwnProperty.call(options, 'safeStorage')) return options.safeStorage
  try {
    const electron = require('electron')
    return electron && electron.safeStorage
  } catch (_) {
    return null
  }
}

function canUseSafeStorage (safeStorage) {
  try {
    return Boolean(
      safeStorage &&
      typeof safeStorage.isEncryptionAvailable === 'function' &&
      safeStorage.isEncryptionAvailable() &&
      typeof safeStorage.encryptString === 'function' &&
      typeof safeStorage.decryptString === 'function'
    )
  } catch (_) {
    return false
  }
}

function encodeMasterKey (masterKey, safeStorage) {
  if (canUseSafeStorage(safeStorage)) {
    return SAFE_STORAGE_PREFIX + safeStorage.encryptString(masterKey).toString('base64')
  }
  throw new Error('系统凭据保护不可用，拒绝创建明文主密钥')
}

function decodeMasterKey (serialized, safeStorage) {
  const value = String(serialized || '').trim()
  if (value.startsWith(SAFE_STORAGE_PREFIX)) {
    if (!canUseSafeStorage(safeStorage)) throw new Error('系统凭据保护不可用，无法解密主密钥')
    return validateMasterKey(safeStorage.decryptString(Buffer.from(value.slice(SAFE_STORAGE_PREFIX.length), 'base64')))
  }
  if (value.startsWith(PLAINTEXT_PREFIX)) return validateMasterKey(value.slice(PLAINTEXT_PREFIX.length))
  return validateMasterKey(value)
}

function writeMasterKeyFiles (keyFile, masterKey, safeStorage) {
  const serialized = encodeMasterKey(masterKey, safeStorage)
  const tmpPath = keyFile + '.tmp.' + process.pid
  fs.writeFileSync(tmpPath, serialized, 'utf8')
  atomicRenameSync(tmpPath, keyFile)
  try { fs.chmodSync(keyFile, 0o600) } catch (_) { /* Windows 由 safeStorage 保护 */ }

  const backupPath = keyFile + '.bak'
  const backupTmpPath = backupPath + '.tmp.' + process.pid
  fs.writeFileSync(backupTmpPath, serialized, 'utf8')
  atomicRenameSync(backupTmpPath, backupPath)
  try { fs.chmodSync(backupPath, 0o600) } catch (_) { /* Windows 由 safeStorage 保护 */ }
}

/**
 * 派生 AES-256 密钥
 */
function deriveKey (masterKey, salt) {
  return crypto.pbkdf2Sync(masterKey, salt, 100000, KEY_LENGTH, 'sha512')
}

/**
 * 获取或创建主密钥
 */
function getMasterKey (credDir, options = {}) {
  const keyFile = path.join(credDir, '.masterkey')
  const backupFile = keyFile + '.bak'
  const safeStorage = resolveSafeStorage(options)
  fs.mkdirSync(credDir, { recursive: true })

  const candidates = [keyFile, backupFile].filter(file => fs.existsSync(file))
  let sourceFile = null
  let serialized = null
  let loadedMasterKey = null
  let lastError = null
  for (const candidate of candidates) {
    try {
      const candidateSerialized = fs.readFileSync(candidate, 'utf8').trim()
      const candidateMasterKey = decodeMasterKey(candidateSerialized, safeStorage)
      sourceFile = candidate
      serialized = candidateSerialized
      loadedMasterKey = candidateMasterKey
      break
    } catch (error) {
      lastError = error
    }
  }
  if (sourceFile) {
    const protectedStorageAvailable = canUseSafeStorage(safeStorage)
    const needsMigration = sourceFile !== keyFile || !serialized.startsWith(SAFE_STORAGE_PREFIX)
    if (needsMigration && protectedStorageAvailable) {
      writeMasterKeyFiles(keyFile, loadedMasterKey, safeStorage)
    } else if (!serialized.startsWith(SAFE_STORAGE_PREFIX) && !protectedStorageAvailable) {
      log.warn('CredentialStore', '系统凭据保护不可用，继续使用已校验的历史主密钥')
    }
    return loadedMasterKey
  }
  if (lastError) {
    if (hasAnyCredentialFiles(credDir) || !canUseSafeStorage(safeStorage)) {
      // 库中存在既有凭证：主密钥不可恢复时 fail-closed，防止静默破坏已加密数据。
      // 系统凭据保护不可用：延续拒绝明文主密钥的安全姿态，同样 fail-closed。
      throw lastError
    }
    // 主密钥无法解密（如系统凭据状态变化、用户目录迁移）且库中无任何凭证：
    // 旧主密钥未加密任何数据，重建不会造成丢失，自动恢复账号添加能力。
    log.error('CredentialStore', `主密钥无法解密且凭证库为空，自动重建主密钥: ${lastError.message}`)
    const masterKey = crypto.randomBytes(32).toString('hex')
    writeMasterKeyFiles(keyFile, masterKey, safeStorage)
    return masterKey
  }

  const masterKey = crypto.randomBytes(32).toString('hex')
  writeMasterKeyFiles(keyFile, masterKey, safeStorage)
  return masterKey
}

/**
 * 递归检查凭证库中是否存在任何已加密的账号凭证文件（含 owners/ 命名空间）。
 * @param {string} credDir
 * @returns {boolean}
 */
function hasAnyCredentialFiles (credDir) {
  if (!fs.existsSync(credDir)) return false
  const pending = [credDir]
  while (pending.length > 0) {
    const dir = pending.pop()
    let entries
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch (_) {
      continue
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        pending.push(path.join(dir, entry.name))
      } else if (entry.isFile() && entry.name.endsWith('.json.enc')) {
        return true
      }
    }
  }
  return false
}

/**
 * 加密
 */
function encryptData (plaintext, masterKey) {
  const salt = crypto.randomBytes(SALT_LENGTH)
  const key = deriveKey(masterKey, salt)
  const iv = crypto.randomBytes(IV_LENGTH)
  
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv)
  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final()
  ])
  const tag = cipher.getAuthTag()
  
  return Buffer.concat([salt, iv, tag, encrypted])
}

/**
 * 解密
 */
function decryptData (payload, masterKey) {
  const salt = payload.subarray(0, SALT_LENGTH)
  const iv = payload.subarray(SALT_LENGTH, SALT_LENGTH + IV_LENGTH)
  const tag = payload.subarray(SALT_LENGTH + IV_LENGTH, SALT_LENGTH + IV_LENGTH + TAG_LENGTH)
  const encrypted = payload.subarray(SALT_LENGTH + IV_LENGTH + TAG_LENGTH)
  
  const key = deriveKey(masterKey, salt)
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv)
  decipher.setAuthTag(tag)
  
  const decrypted = Buffer.concat([
    decipher.update(encrypted),
    decipher.final()
  ])
  return JSON.parse(decrypted.toString('utf8'))
}

/**
 * 获取凭证存储目录
 */
function getCredentialDir (userDataDir) {
  if (!userDataDir || typeof userDataDir !== 'string') {
    throw new TypeError('userDataDir must be a non-empty string')
  }
  return path.join(userDataDir, 'credentials')
}

function normalizeOwnerSubject (ownerSubject) {
  if (typeof ownerSubject !== 'string' || !ownerSubject.trim()) {
    throw new TypeError('ownerSubject must be a non-empty string')
  }
  return ownerSubject.trim()
}

function getOwnerCredentialDir (userDataDir, ownerSubject) {
  const namespace = crypto.createHash('sha256')
    .update(normalizeOwnerSubject(ownerSubject), 'utf8')
    .digest('hex')
  return path.join(getCredentialDir(userDataDir), 'owners', namespace)
}

function resolveCredentialArgs (userDataDir, ownerOrOptions, maybeOptions) {
  if (typeof ownerOrOptions === 'string') {
    return {
      rootDir: getCredentialDir(userDataDir),
      namespaceDir: getOwnerCredentialDir(userDataDir, ownerOrOptions),
      options: maybeOptions || {},
    }
  }
  if (ownerOrOptions === null) normalizeOwnerSubject(ownerOrOptions)
  const options = ownerOrOptions || {}
  const ownerSubject = options.ownerSubject
  return {
    rootDir: getCredentialDir(userDataDir),
    namespaceDir: ownerSubject === undefined
      ? getCredentialDir(userDataDir)
      : getOwnerCredentialDir(userDataDir, ownerSubject),
    options,
  }
}

/**
 * 获取凭证文件路径
 * 安全：校验 accountId 不含路径穿越序列（防止 ../../etc/passwd）
 */
function getCredentialFilePath (accountId, credDir) {
  if (!accountId || typeof accountId !== 'string' || accountId.includes('..') || accountId.includes('/') || accountId.includes('\\') || accountId.includes(path.sep)) {
    throw new Error('Invalid accountId: must not contain path separators or traversal sequences')
  }
  return path.join(credDir, `${accountId}.json.enc`)
}

/**
 * 保存账号凭证（localStorage + accountInfo）
 * 
 * @param {string} accountId - 唯一账号标识
 * @param {object} data - {
 *   localStorage: {key: value, ...},
 *   accountInfo: {nickName, avatar, platformAccountId, ...}
 * }
 * @param {string} userDataDir
 */
function saveCredential (accountId, data, userDataDir, ownerOrOptions, maybeOptions) {
  try {
    const { rootDir, namespaceDir, options } = resolveCredentialArgs(
      userDataDir,
      ownerOrOptions,
      maybeOptions,
    )
    const masterKey = getMasterKey(rootDir, options)
    const payload = encryptData(JSON.stringify(data), masterKey)

    const filePath = getCredentialFilePath(accountId, namespaceDir)
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    // 安全：原子写（写临时文件后 rename），防止崩溃中断损坏凭证文件
    const tmpPath = filePath + '.tmp.' + process.pid
    fs.writeFileSync(tmpPath, payload)
    atomicRenameSync(tmpPath, filePath)
    log.info('CredentialStore', `Saved credentials for account: ${accountId}`)
    return true
  } catch (e) {
    log.error('CredentialStore', `Failed to save credentials for ${accountId}: ${e.message}`)
    return false
  }
}

/**
 * 加载账号凭证
 * 
 * @param {string} accountId
 * @param {string} userDataDir
 * @returns {object|null} {localStorage, accountInfo} 或 null
 */
function loadCredential (accountId, userDataDir, ownerOrOptions, maybeOptions) {
  try {
    const { rootDir, namespaceDir, options } = resolveCredentialArgs(
      userDataDir,
      ownerOrOptions,
      maybeOptions,
    )
    const filePath = getCredentialFilePath(accountId, namespaceDir)
    
    if (!fs.existsSync(filePath)) return null
    
    const masterKey = getMasterKey(rootDir, options)
    const payload = fs.readFileSync(filePath)
    return decryptData(payload, masterKey)
  } catch (e) {
    log.error('CredentialStore', `Failed to load credentials for ${accountId}: ${e.message}`)
    return null
  }
}

/**
 * 删除账号凭证
 */
function deleteCredential (accountId, userDataDir, ownerSubject) {
  try {
    const credDir = ownerSubject === undefined
      ? getCredentialDir(userDataDir)
      : getOwnerCredentialDir(userDataDir, ownerSubject)
    const filePath = getCredentialFilePath(accountId, credDir)
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath)
      log.info('CredentialStore', `Deleted credentials for account: ${accountId}`)
      return true
    }
    return false
  } catch (e) {
    log.error('CredentialStore', `Failed to delete credentials for ${accountId}: ${e.message}`)
    return false
  }
}

/**
 * 列出所有已保存凭证的账号
 */
function listAccounts (userDataDir, ownerSubject) {
  try {
    const credDir = ownerSubject === undefined
      ? getCredentialDir(userDataDir)
      : getOwnerCredentialDir(userDataDir, ownerSubject)
    if (!fs.existsSync(credDir)) return []
    
    return fs.readdirSync(credDir)
      .filter(f => f.endsWith('.json.enc'))
      .map(f => f.replace('.json.enc', ''))
  } catch (e) {
    log.error('CredentialStore', `Failed to list accounts: ${e.message}`)
    return []
  }
}

/**
 * 检查账号是否有凭证
 */
function hasCredential (accountId, userDataDir, ownerSubject) {
  const credDir = ownerSubject === undefined
    ? getCredentialDir(userDataDir)
    : getOwnerCredentialDir(userDataDir, ownerSubject)
  return fs.existsSync(getCredentialFilePath(accountId, credDir))
}

/**
 * 清理孤儿凭据文件
 * @param {string[]} knownAccountIds
 * @param {string} userDataDir
 * @param {string} [ownerSubject]
 * @returns {{ removed: string[], errors: string[] }}
 */
function cleanOrphanCredentials (knownAccountIds, userDataDir, ownerSubject) {
  const removed = []
  const errors = []
  const idSet = new Set(knownAccountIds)
  const credDir = ownerSubject === undefined
    ? getCredentialDir(userDataDir)
    : getOwnerCredentialDir(userDataDir, ownerSubject)
  if (!fs.existsSync(credDir)) return { removed, errors }
  for (const file of fs.readdirSync(credDir)) {
    if (!file.endsWith('.json.enc')) continue
    const aid = file.replace('.json.enc', '')
    if (idSet.has(aid)) continue
    try {
      fs.unlinkSync(path.join(credDir, file))
      removed.push(aid)
      log.info('CredentialStore', 'clean-orphan ok: ' + aid)
    } catch (e) {
      errors.push(aid)
      log.warn('CredentialStore', 'clean-orphan fail: ' + aid + ' ' + e.message)
    }
  }
  return { removed, errors }
}

module.exports = {
  getMasterKey,
  getCredentialFilePath,
  getCredentialDir,
  getOwnerCredentialDir,
  saveCredential,
  loadCredential,
  deleteCredential,
  listAccounts,
  hasCredential,
  cleanOrphanCredentials,
  encryptData,
  decryptData
}
