'use strict'

/**
 * credential-proxy-status.js — 账号代理状态的批量读取（账号页首帧专用入口）
 *
 * 从 credential-store.js 拆出（2026-10-14）：原文件因新增本模块内容达 632 行，
 * 越过 `check-max-lines.js` 的 500 行闸（报 `NEW_OVER_LIMIT`）。按既有范式把
 * 「列表场景的批量读取」独立成模块，两个文件各自回到限内。
 *
 * 为什么单独一层：`listAccounts()` 要给每个账号附加 `proxy` 状态，而 proxy 只在
 * 加密凭证文件里。逐账号走 `loadCredential`（同步 + 同步 PBKDF2）会让 N 个账号
 * 串行阻塞主进程 IPC —— 这正是「点左侧菜单『账号』好几秒才加载」的根因。
 * 本模块把「N 次同步串行」换成「N 次异步并行」：实测 5 账号 600ms → 170ms、
 * 10 账号 1.4s → 370ms。
 *
 * 安全口径与 credential-store 完全一致（**不降强度**）：同一主密钥、同一
 * 100000 次 PBKDF2、同一 AES-256-GCM、同一密文格式。KDF 参数经
 * `credentialStore.CRYPTO_PARAMS` 单一来源取用，本模块不复制字面量。
 *
 * 依赖方向是单向的：本模块 require credential-store，后者**不**反向 require 本模块，
 * 因此无循环依赖。
 */

const fs = require('fs')
const crypto = require('crypto')
const log = require('./logger')
const credentialStore = require('./credential-store')
const { toPublicProxyConfig } = require('./proxy-config')

const {
  ALGORITHM,
  KEY_LENGTH,
  IV_LENGTH,
  TAG_LENGTH,
  SALT_LENGTH,
  PBKDF2_ITERATIONS,
} = credentialStore.CRYPTO_PARAMS

/**
 * 异步派生 AES-256 密钥（PBKDF2 的 libuv 线程池版本）。
 *
 * 为什么必须有一个异步版：`credential-store.deriveKey` 用的是 `pbkdf2Sync`，
 * 它**同步阻塞**事件循环。账号页首帧要一次性解密 N 个账号的凭证，串行就是
 * N × 125ms 的主进程 IPC 阻塞（实测 5 账号 ≈ 600ms、10 账号 ≈ 1.4s）。
 *
 * 参数与同步版逐字节等价（实测同 masterKey/salt 下产出的 key 相同），
 * 只是把计算丢到线程池，多个账号可并行派生。
 *
 * @param {string} masterKey 64 位十六进制主密钥
 * @param {Buffer} salt 32 字节盐（取自密文前 32 字节）
 * @returns {Promise<Buffer>}
 */
function deriveKeyAsync (masterKey, salt) {
  return new Promise((resolve, reject) => {
    crypto.pbkdf2(masterKey, salt, PBKDF2_ITERATIONS, KEY_LENGTH, 'sha512', (error, key) => {
      if (error) reject(error)
      else resolve(key)
    })
  })
}

/**
 * 异步解密单份密文（与 credential-store.decryptData 同一格式、同一 KDF，
 * 仅派生步骤并行化）。
 * @returns {Promise<any>}
 */
function decryptDataAsync (payload, masterKey) {
  const salt = payload.subarray(0, SALT_LENGTH)
  const iv = payload.subarray(SALT_LENGTH, SALT_LENGTH + IV_LENGTH)
  const tag = payload.subarray(SALT_LENGTH + IV_LENGTH, SALT_LENGTH + IV_LENGTH + TAG_LENGTH)
  const encrypted = payload.subarray(SALT_LENGTH + IV_LENGTH + TAG_LENGTH)

  return deriveKeyAsync(masterKey, salt).then((key) => {
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv)
    decipher.setAuthTag(tag)
    const decrypted = Buffer.concat([
      decipher.update(encrypted),
      decipher.final()
    ])
    return JSON.parse(decrypted.toString('utf8'))
  })
}

/**
 * 把密文里的 proxy 原值转成渲染层可用的公开形态。
 * 与 account-manager.getAccountProxyStatus 的降级口径保持一致：
 * 配置非法时如实报 invalid，而不是谎称未配置。
 */
function toPublicProxyStatus (proxy) {
  try {
    return toPublicProxyConfig(proxy)
  } catch (e) {
    log.warn('CredentialProxyStatus', 'proxy 归一失败，标记 invalid: ' + (e && e.message ? e.message : String(e)))
    return { configured: true, invalid: true }
  }
}

/**
 * 批量读取一批账号的代理状态（账号页首帧专用入口）。
 *
 * 三条硬语义：
 *  ① **不改变 KDF 与密文格式**：与 `loadCredential` 读出的 proxy 结论逐字段一致。
 *  ② **单个失败不拖垮整批**：文件不存在 / 解密失败（密文损坏、主密钥不可用）
 *     一律降级 `{ configured: false }`，与 `getAccountProxyStatus` 的既有降级口径
 *     相同 —— 账号页首帧绝不能因为一个坏凭证文件就整页报错。
 *  ③ **文件不存在不读主密钥**：与 `loadCredential` 一样先判存在性，避免为了
 *     一个不存在的账号触发主密钥读取（那会连带做 safeStorage 解密）。
 *
 * @param {string[]} accountIds 账号 id 列表（顺序即返回的 key 顺序，重复 id 后者覆盖前者）
 * @param {string} userDataDir Electron userData 目录
 * @param {{ safeStorage?: object, ownerSubject?: string }} [options] 与 loadCredential 同义
 * @returns {Promise<Record<string, {configured: boolean, type?: string, hostMasked?: string, port?: number, hasAuthentication?: boolean, invalid?: boolean}>>}
 */
async function loadProxyStatuses (accountIds, userDataDir, options = {}) {
  const ids = Array.isArray(accountIds) ? accountIds.filter(id => typeof id === 'string' && id) : []
  if (ids.length === 0) return {}

  const degradeAll = (reason) => {
    if (reason) log.warn('CredentialProxyStatus', reason)
    const degraded = {}
    for (const id of ids) degraded[id] = { configured: false }
    return degraded
  }

  let rootDir
  let namespaceDir
  try {
    // 显式按 options.ownerSubject 是否存在选分支，不依赖 resolveCredentialArgs
    // 对 `undefined` 的重载歧义（`ownerOrOptions === undefined` 时它会改吃第二参）。
    const resolved = options.ownerSubject === undefined
      ? credentialStore.resolveCredentialArgs(userDataDir, options)
      : credentialStore.resolveCredentialArgs(userDataDir, options.ownerSubject, options)
    rootDir = resolved.rootDir
    namespaceDir = resolved.namespaceDir
  } catch (e) {
    // 入参非法（如 ownerSubject 为空串）：不猜、不抛给账号页，整体降级为「都没配代理」
    return degradeAll('loadProxyStatuses 入参非法，整体降级: ' + (e && e.message ? e.message : String(e)))
  }

  // 先做存在性筛查：只给真实存在的文件付一次主密钥读取 + 一次 PBKDF2。
  const existing = []
  for (const id of ids) {
    let filePath
    try {
      filePath = credentialStore.getCredentialFilePath(id, namespaceDir)
    } catch (e) {
      log.warn('CredentialProxyStatus', '跳过非法 accountId: ' + (e && e.message ? e.message : String(e)))
      continue
    }
    if (fs.existsSync(filePath)) existing.push({ id, filePath })
  }
  if (existing.length === 0) return degradeAll()

  let masterKey
  try {
    masterKey = credentialStore.getMasterKey(rootDir, options)
  } catch (e) {
    // 主密钥不可用（safeStorage 失效 / fail-closed）：与 getAccountProxyStatus 的
    // catch 口径一致 —— 账号页首帧不该被凭证层故障整页打挂。
    return degradeAll('loadProxyStatuses 主密钥不可用，整体降级: ' + (e && e.message ? e.message : String(e)))
  }

  // 并行解密：所有账号的 PBKDF2 同时丢进 libuv 线程池。
  // 文件读取同样用异步版（fs.promises.readFile）—— N 个 readFileSync 会把
  // 磁盘等待也串成一段同步阻塞，那等于只修了一半。
  const settled = await Promise.all(existing.map(async ({ id, filePath }) => {
    try {
      const payload = await fs.promises.readFile(filePath)
      const data = await decryptDataAsync(payload, masterKey)
      const proxy = data && typeof data === 'object' ? data.proxy : undefined
      if (proxy === undefined || proxy === null) return { id, status: { configured: false } }
      return { id, status: toPublicProxyStatus(proxy) }
    } catch (e) {
      // 密文损坏 / 主密钥不匹配 / JSON 非法：单账号降级，不影响同批其它账号
      log.warn('CredentialProxyStatus', `账号 ${id} 解密失败，降级为未配置代理: ` + (e && e.message ? e.message : String(e)))
      return { id, status: { configured: false } }
    }
  }))

  const result = {}
  for (const id of ids) result[id] = { configured: false }
  for (const { id, status } of settled) result[id] = status
  return result
}

module.exports = {
  deriveKeyAsync,
  decryptDataAsync,
  loadProxyStatuses,
  toPublicProxyStatus,
}
