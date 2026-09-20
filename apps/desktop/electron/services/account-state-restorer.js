// @ts-check
/**
 * AccountStateRestorer — 账号登录状态恢复
 * 
 * 基于参考产品逆向分析的账号状态索引方案。
 * 此文件只保存账号公开元数据；Cookie 和浏览器存储由 credential-store 加密保存。
 * 
 * 文件路径: {userData}/accounts/state.jsonl
 */
const fs = require('fs')
const path = require('path')
const os = require('os')
const log = require('./logger')

const STATE_FILE = 'accounts/state.jsonl'
const LEGACY_OWNER_SUBJECT = '__legacy__'
const SENSITIVE_FIELDS = new Set(['cookies', 'localStorage', 'indexedDB', 'authData', 'auth_data'])
const TRANSIENT_WINDOWS_RENAME_ERRORS = new Set(['EPERM', 'EACCES', 'EBUSY'])
const ATOMIC_RENAME_RETRY_DELAYS_MS = [20, 40, 80, 160, 320, 640]
const ATOMIC_RENAME_WAIT_BUFFER = new Int32Array(new SharedArrayBuffer(4))
const PUBLIC_ACCOUNT_INFO_FIELDS = new Set([
  'id',
  'nickName',
  'nickname',
  'name',
  'avatar',
  'platformAccountId',
  'username',
  'displayName'
])

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

      // 杀毒软件和索引器可能短暂占用目标文件；保持同步 API 并做有界退避。
      Atomics.wait(ATOMIC_RENAME_WAIT_BUFFER, 0, 0, delayMs)
    }
  }
}

function sanitizeAccountInfo (accountInfo) {
  if (!accountInfo || typeof accountInfo !== 'object' || Array.isArray(accountInfo)) return {}
  return Object.fromEntries(
    Object.entries(accountInfo).filter(([key, value]) => (
      PUBLIC_ACCOUNT_INFO_FIELDS.has(key) && ['string', 'number', 'boolean'].includes(typeof value)
    ))
  )
}

function sanitizeRecord (record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) return record
  const sanitized = Object.fromEntries(
    Object.entries(record).filter(([key]) => !SENSITIVE_FIELDS.has(key))
  )
  if (Object.prototype.hasOwnProperty.call(sanitized, 'accountInfo')) {
    sanitized.accountInfo = sanitizeAccountInfo(sanitized.accountInfo)
  }
  return sanitized
}

function sanitizeLegacyRecords (userDataDir) {
  const filePath = getStateFilePath(userDataDir)
  if (!fs.existsSync(filePath)) return 0
  const content = fs.readFileSync(filePath, 'utf8')
  const lines = content.split('\n').filter(line => line.trim())
  let redacted = 0
  const sanitized = lines.map(line => {
    try {
      const record = JSON.parse(line)
      const clean = sanitizeRecord(record)
      if (Object.keys(record).some(key => SENSITIVE_FIELDS.has(key))) redacted += 1
      return JSON.stringify(clean)
    } catch (_) {
      return line
    }
  })
  if (redacted > 0) {
    const tmpPath = filePath + '.tmp.' + process.pid
    fs.writeFileSync(tmpPath, sanitized.join('\n') + (sanitized.length ? '\n' : ''), 'utf8')
    atomicRenameSync(tmpPath, filePath)
  }
  return redacted
}

/**
 * 获取状态文件路径
 */
function getStateFilePath (userDataDir) {
  return path.join(userDataDir, STATE_FILE)
}

function normalizeOwnerSubject (ownerSubject) {
  if (ownerSubject === undefined) return undefined
  if (typeof ownerSubject !== 'string' || !ownerSubject.trim()) {
    throw new TypeError('ownerSubject must be a non-empty string')
  }
  return ownerSubject.trim()
}

function ownerMatches (record, ownerSubject) {
  if (ownerSubject === undefined) {
    // 早期迁移曾把 legacy 状态显式标为 __legacy__，而旧 JSONL 没有该字段。
    // 两种形态都属于未启用身份服务时的同一命名空间。
    return record.owner_subject === undefined || record.owner_subject === null ||
      record.owner_subject === LEGACY_OWNER_SUBJECT
  }
  return record.owner_subject === ownerSubject
}

function resolveStateUserDataDir (userDataDir) {
  if (userDataDir === undefined) return resolveUserDataDir()
  if (typeof userDataDir !== 'string' || !userDataDir.trim()) {
    throw new TypeError('userDataDir must be a non-empty string')
  }
  return userDataDir
}

function resolveUserDataDir () {
  // 同 python-bridge：吞并 cmd set 陷阱引入的尾随空格，避免状态写进带空格目录
  const configured = typeof process.env.ELECTRON_USER_DATA_DIR === 'string' ? process.env.ELECTRON_USER_DATA_DIR.trim() : ''
  if (configured) return configured
  try {
    const electron = require('electron')
    if (electron?.app && typeof electron.app.getPath === 'function') return electron.app.getPath('userData')
  } catch (_) { /* 非 Electron 进程使用稳定的用户目录回退 */ }
  return path.join(os.homedir(), '.multi-publish')
}

/**
 * 初始化状态文件
 */
function init () {
  const userDataDir = resolveUserDataDir()
  const filePath = getStateFilePath(userDataDir)
  const dir = path.dirname(filePath)
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, '')
  }
  sanitizeLegacyRecords(userDataDir)
}

/**
 * 保存账号公开状态
 * 写入一条 JSONL 记录
 * 
 * @param {object} record - {
 *   accountId: string,
 *   platform: string,
 *   platformAccountId: string,
 *   accountInfo: {nickName, avatar, ...},
 *   timestamp: number
 * }
 */
function saveAccountRecord (record, ownerSubject, userDataDir) {
  const owner = normalizeOwnerSubject(ownerSubject)
  try {
    const filePath = getStateFilePath(resolveStateUserDataDir(userDataDir))
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    const line = JSON.stringify({
      ...sanitizeRecord(record),
      ...(owner === undefined ? {} : { owner_subject: owner }),
      timestamp: Date.now()
    })
    fs.appendFileSync(filePath, line + '\n')
    log.info('AccountStateRestorer', `Saved account state for ${record.platform}:${record.accountId}`)
    return true
  } catch (e) {
    log.error('AccountStateRestorer', `Failed to save account record: ${e.message}`)
    return false
  }
}

/**
 * 查询账号记录
 * 
 * @param {string} platform - 平台名
 * @param {string} accountId - 账号ID
 * @returns {object|null} 最近的记录，或 null
 */
function getAccountRecord (platform, accountId, ownerSubject, userDataDir) {
  const owner = normalizeOwnerSubject(ownerSubject)
  try {
    const filePath = getStateFilePath(resolveStateUserDataDir(userDataDir))
    if (!fs.existsSync(filePath)) return null
    
    const content = fs.readFileSync(filePath, 'utf8')
    const lines = content.trim().split('\n').filter(l => l.trim())
    
    // 从后往前找（最近的记录）
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const record = JSON.parse(lines[i])
        if (record.platform === platform && record.accountId === accountId && ownerMatches(record, owner)) {
          return sanitizeRecord(record)
        }
      // eslint-disable-next-line no-unused-vars
      } catch (e) { /* skip corrupt line */ }
    }
    return null
  } catch (e) {
    log.error('AccountStateRestorer', `Failed to query account record: ${e.message}`)
    return null
  }
}

/**
 * 删除账号记录
 * 
 * @param {string} platform 
 * @param {string} accountId 
 */
function deleteAccountRecord (platform, accountId, ownerSubject, userDataDir) {
  const owner = normalizeOwnerSubject(ownerSubject)
  try {
    const filePath = getStateFilePath(resolveStateUserDataDir(userDataDir))
    if (!fs.existsSync(filePath)) return
    
    const content = fs.readFileSync(filePath, 'utf8')
    const lines = content.trim().split('\n').filter(l => l.trim())
    
    // 过滤掉匹配的账号
    const filtered = lines.filter(line => {
      try {
        const record = JSON.parse(line)
        return !(record.platform === platform && record.accountId === accountId && ownerMatches(record, owner))
      } catch {
        return true // keep corrupt lines
      }
    })
    
    // 全文重写必须使用原子替换，避免中断时丢失账号状态。
    const tmpPath = filePath + '.tmp'
    fs.writeFileSync(tmpPath, filtered.join('\n') + (filtered.length ? '\n' : ''))
    atomicRenameSync(tmpPath, filePath)
    log.info('AccountStateRestorer', `Deleted account state for ${platform}:${accountId}`)
  } catch (e) {
    log.error('AccountStateRestorer', `Failed to delete account record: ${e.message}`)
  }
}

function deleteAccountRecordsById (accountId, ownerSubject, userDataDir) {
  const owner = normalizeOwnerSubject(ownerSubject)
  try {
    const filePath = getStateFilePath(resolveStateUserDataDir(userDataDir))
    if (!fs.existsSync(filePath)) return true
    const lines = fs.readFileSync(filePath, 'utf8').trim().split('\n').filter(line => line.trim())
    const filtered = lines.filter(line => {
      try {
        const record = JSON.parse(line)
        return !(record.accountId === accountId && ownerMatches(record, owner))
      } catch (_) { return true }
    })
    const tmpPath = filePath + '.tmp'
    fs.writeFileSync(tmpPath, filtered.join('\n') + (filtered.length ? '\n' : ''))
    atomicRenameSync(tmpPath, filePath)
    log.info('AccountStateRestorer', `Deleted all account state for ${accountId}`)
    return true
  } catch (e) {
    log.error('AccountStateRestorer', `Failed to delete account records for ${accountId}: ${e.message}`)
    return false
  }
}

/**
 * 列出所有已登录账号
 * 
 * @returns {Array<{platform, accountId, accountInfo}>}
 */
function listLoggedInAccounts (ownerSubject, userDataDir) {
  const owner = normalizeOwnerSubject(ownerSubject)
  try {
    const filePath = getStateFilePath(resolveStateUserDataDir(userDataDir))
    if (!fs.existsSync(filePath)) return []
    
    const content = fs.readFileSync(filePath, 'utf8')
    const lines = content.trim().split('\n').filter(l => l.trim())
    
    // 取每个平台最新的记录
    const latestByPlatform = new Map()
    for (const line of lines) {
      try {
        const record = JSON.parse(line)
        if (record.platform && record.accountId && ownerMatches(record, owner)) {
          const key = `${record.platform}:${record.accountId}`
          const existing = latestByPlatform.get(key)
          if (!existing || record.timestamp > existing.timestamp) {
            latestByPlatform.set(key, record)
          }
        }
      } catch { /* skip */ }
    }
    
    return Array.from(latestByPlatform.values()).map(sanitizeRecord)
  } catch (e) {
    log.error('AccountStateRestorer', `Failed to list accounts: ${e.message}`)
    return []
  }
}

/**
 * 清理过期记录（保留最近 N 天）
 * 
 * @param {number} days - 保留天数
 */
function purgeExpired (days = 90) {
  try {
    const filePath = getStateFilePath(resolveUserDataDir())
    if (!fs.existsSync(filePath)) return 0
    
    const content = fs.readFileSync(filePath, 'utf8')
    const lines = content.trim().split('\n').filter(l => l.trim())
    const cutoff = Date.now() - days * 86400000
    
    const valid = lines.filter(line => {
      try {
        const record = JSON.parse(line)
        return record.timestamp >= cutoff
      } catch {
        return true // keep corrupt lines
      }
    })
    
    const purged = lines.length - valid.length
    // 全文重写必须使用原子替换，避免中断时丢失账号状态。
    const tmpPath = filePath + '.tmp'
    fs.writeFileSync(tmpPath, valid.join('\n') + (valid.length ? '\n' : ''))
    atomicRenameSync(tmpPath, filePath)
    
    if (purged > 0) {
      log.info('AccountStateRestorer', `Purged ${purged} expired records (>${days}d)`)
    }
    return purged
  } catch (e) {
    log.error('AccountStateRestorer', `Purge failed: ${e.message}`)
    return 0
  }
}

module.exports = {
  init,
  saveAccountRecord,
  getAccountRecord,
  deleteAccountRecord,
  deleteAccountRecordsById,
  listLoggedInAccounts,
  purgeExpired,
  sanitizeLegacyRecords,
  resolveUserDataDir
}
