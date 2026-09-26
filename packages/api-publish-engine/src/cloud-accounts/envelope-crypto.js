'use strict'
/**
 * envelope-crypto.js — 云端凭证的信封加密（PRD §8、docs/adr/0003）。
 *
 * 契约（逐条对应 PRD §8）：
 *   1. 每条凭证一份随机数据密钥 DK = randomBytes(32)，AES-256-GCM，IV = randomBytes(12)。
 *   2. AAD = `${userId}|${platform}|${platformUid}`，把密文钉死在「归属身份 + 合并键」三元组上；
 *      换掉任一元组必须解不开（PRD 验收标准 8）。这是防跨账号/跨用户串解的唯一硬约束，
 *      因为 DK 与主密钥的组合本身不区分账号。
 *   3. `encryptedDataKey = KMS.wrap(dk, keyId)`，keyId = `user:${userId}`；DK 明文用完即 fill(0)。
 *   4. **KMS 缺失、形状不合规、wrap/unwrap 抛错或返回非 Buffer，一律 KMS_UNAVAILABLE 抛出**：
 *      绝不允许降级成「不加密」「明文入库」或「用固定密钥」（PRD §8.3）。
 *
 * 关于密文里存的是**原始凭证**而不是规范化凭证：`credential_digest` 才走规范化（PRD §8.6，
 * 用于判变更），密文必须无损——否则下行恢复会把 cookie 的 expirationDate 丢掉，
 * 把持久 cookie 变成会话 cookie，恢复出来的账号直接失效。
 *
 * KMS 抽象层：`{ wrap(dk, keyId) → Promise<Buffer>, unwrap(cipherDk, keyId) → Promise<Buffer> }`。
 * 本文件提供的 `createLocalKms` **只用于开发/测试**（主密钥从环境变量 32 字节 hex 读取）。
 * 生产必须替换为云 KMS（KMS 服务 / 硬件根密钥 + 轮转），并在部署文档登记未执行项；
 * 主密钥一旦丢失，全部云端凭证不可恢复，且无法通过重加密救回。
 */

const crypto = require('crypto')

const { credentialDigest, normalizedByteSize, stableStringify } = require('./credential-digest')
const {
  AUTH_TAG_BYTES,
  ENVELOPE_ALG,
  ENVELOPE_VERSION,
  IV_BYTES,
  MAX_CREDENTIAL_BYTES,
  MAX_UID_LENGTH,
  CONTROL_CHARS,
  SUPPORTED_PLATFORMS,
  accountError,
  asBytes,
  isPlainObject,
} = require('./validate-account')

const LOCAL_KMS_KEY_ENV = 'MP_CLOUD_KMS_LOCAL_KEY'
const LOCAL_KMS_KEY_PATTERN = /^[0-9a-fA-F]{64}$/
const DATA_KEY_BYTES = 32
/** 线上形态（JSON）里需要 base64 的四个二进制字段。 */
const ENVELOPE_BINARY_FIELDS = Object.freeze(['iv', 'ciphertext', 'tag', 'encryptedDataKey'])

function kmsUnavailable(cause) {
  const error = accountError('KMS_UNAVAILABLE', 503)
  // 原始 KMS 报错常含下游 URL / 密钥句柄，只作为不可枚举的 cause 保留给日志，不外泄给调用方。
  if (cause) Object.defineProperty(error, 'cause', { value: cause, enumerable: false })
  return error
}

function requireKms(kms) {
  if (!isPlainObject(kms) || typeof kms.wrap !== 'function' || typeof kms.unwrap !== 'function') {
    throw kmsUnavailable(new Error('KMS abstraction not configured'))
  }
  return kms
}

function keyIdFor(userId) {
  return `user:${userId}`
}

function buildAad(userId, platform, platformUid) {
  return Buffer.from(`${userId}|${platform}|${platformUid}`, 'utf8')
}

/** 三元组是 AAD 的全部材料，任一为空都会让密文与账号脱钩，因此先于任何加密动作校验。 */
function assertTriple({ userId, platform, platformUid } = {}) {
  if (typeof userId !== 'string' || !userId.trim() || CONTROL_CHARS.test(userId)) {
    throw accountError('BUSINESS_USER_REQUIRED', 503)
  }
  if (typeof platform !== 'string' || !SUPPORTED_PLATFORMS.includes(platform)) {
    throw accountError('ACCOUNT_PLATFORM_UNSUPPORTED', 400)
  }
  if (typeof platformUid !== 'string' || !platformUid.trim() || platformUid.trim().length > MAX_UID_LENGTH
    || CONTROL_CHARS.test(platformUid)) {
    throw accountError('ACCOUNT_UID_INVALID', 400)
  }
  return { userId: userId.trim(), platform, platformUid: platformUid.trim() }
}

function normalizeRandomBytes(randomBytes) {
  if (randomBytes === undefined || randomBytes === null) return crypto.randomBytes
  if (typeof randomBytes !== 'function') throw accountError('CRYPTO_RANDOM_INVALID', 503)
  return randomBytes
}

function readRandom(randomBytes, size, label) {
  const value = randomBytes(size)
  if (!Buffer.isBuffer(value) || value.length !== size) {
    throw Object.assign(accountError('CRYPTO_RANDOM_INVALID', 503), { label })
  }
  return value
}

/** 解出的 DK 一律先复制再清零：不能 fill(0) 掉调用方 Buffer 的视图，否则会抹掉已入库的加密 DK。 */
async function unwrapDataKey(kms, encryptedDataKey, keyId) {
  let raw
  try {
    raw = await kms.unwrap(encryptedDataKey, keyId)
  } catch (error) {
    throw kmsUnavailable(error)
  }
  if (!Buffer.isBuffer(raw) || raw.length === 0) throw kmsUnavailable(new Error('KMS returned no data key'))
  const dataKey = Buffer.from(raw)
  if (dataKey.length !== DATA_KEY_BYTES) {
    dataKey.fill(0)
    throw kmsUnavailable(new Error('KMS returned a wrong-length data key'))
  }
  return dataKey
}

async function wrapDataKey(kms, dataKey, keyId) {
  let wrapped
  try {
    wrapped = await kms.wrap(dataKey, keyId)
  } catch (error) {
    throw kmsUnavailable(error)
  }
  if (!Buffer.isBuffer(wrapped) || wrapped.length === 0) throw kmsUnavailable(new Error('KMS returned no wrapped key'))
  return wrapped
}

/**
 * createEnvelopeCrypto({ kms, randomBytes }) → { encryptCredential, decryptCredential, verifyDataKey }
 * `randomBytes` 仅供测试注入确定性密钥（并据此断言 DK 被清零），生产不传。
 */
function createEnvelopeCrypto(options = {}) {
  const kms = options.kms
  const randomBytes = normalizeRandomBytes(options.randomBytes)

  /** 只保证「这把加密 DK 当前能被本服务的主密钥解出来」，不解凭证正文。 */
  async function verifyDataKey(encryptedDataKey, { userId } = {}) {
    requireKms(kms)
    if (typeof userId !== 'string' || !userId.trim() || CONTROL_CHARS.test(userId)) {
      throw accountError('BUSINESS_USER_REQUIRED', 503)
    }
    const dataKey = await unwrapDataKey(kms, encryptedDataKey, keyIdFor(userId))
    try {
      const rewrapped = await wrapDataKey(kms, dataKey, keyIdFor(userId))
      void rewrapped
      return true
    } finally {
      dataKey.fill(0)
    }
  }

  async function encryptCredential({ userId, platform, platformUid, credential } = {}) {
    const triple = assertTriple({ userId, platform, platformUid })
    // 体积门禁必须在调用 KMS 之前：过大即整条拒收，不得先花一次主密钥运算再丢弃（PRD §6.2）。
    if (normalizedByteSize(credential) > MAX_CREDENTIAL_BYTES) throw accountError('CREDENTIAL_TOO_LARGE', 413)
    requireKms(kms)

    const dataKey = readRandom(randomBytes, DATA_KEY_BYTES, 'dataKey')
    const iv = readRandom(randomBytes, IV_BYTES, 'iv')
    let plaintext = null
    try {
      // 明文形态无损：密文里存原始凭证，摘要才走规范化（见文件头说明）。
      plaintext = Buffer.from(stableStringify(credential === undefined ? null : credential), 'utf8')
      const cipher = crypto.createCipheriv('aes-256-gcm', dataKey, iv)
      cipher.setAAD(buildAad(triple.userId, triple.platform, triple.platformUid))
      const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()])
      const tag = cipher.getAuthTag()
      const encryptedDataKey = await wrapDataKey(kms, dataKey, keyIdFor(triple.userId))
      return {
        v: ENVELOPE_VERSION,
        alg: ENVELOPE_ALG,
        iv,
        ciphertext,
        tag,
        encryptedDataKey,
        digest: credentialDigest(credential),
      }
    } finally {
      if (plaintext) plaintext.fill(0)
      dataKey.fill(0)
    }
  }

  async function decryptCredential(envelope, { userId, platform, platformUid } = {}) {
    const triple = assertTriple({ userId, platform, platformUid })
    if (!isPlainObject(envelope)) throw accountError('CREDENTIAL_SHAPE_INVALID', 400)
    if (envelope.v !== undefined && envelope.v !== ENVELOPE_VERSION) throw accountError('CREDENTIAL_SHAPE_INVALID', 400)
    if (envelope.alg !== undefined && envelope.alg !== ENVELOPE_ALG) throw accountError('CREDENTIAL_SHAPE_INVALID', 400)
    requireKms(kms)

    const iv = asBytes(envelope.iv, 'CREDENTIAL_SHAPE_INVALID')
    const ciphertext = asBytes(envelope.ciphertext, 'CREDENTIAL_SHAPE_INVALID')
    const tag = asBytes(envelope.tag, 'CREDENTIAL_SHAPE_INVALID')
    const encryptedDataKey = asBytes(envelope.encryptedDataKey, 'CREDENTIAL_SHAPE_INVALID')
    if (iv.length !== IV_BYTES) throw accountError('CREDENTIAL_SHAPE_INVALID', 400)
    if (tag.length !== AUTH_TAG_BYTES) throw accountError('CREDENTIAL_SHAPE_INVALID', 400)

    const dataKey = await unwrapDataKey(kms, encryptedDataKey, keyIdFor(triple.userId))
    try {
      const decipher = crypto.createDecipheriv('aes-256-gcm', dataKey, iv)
      decipher.setAAD(buildAad(triple.userId, triple.platform, triple.platformUid))
      decipher.setAuthTag(tag)
      const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()])
      try {
        return JSON.parse(plaintext.toString('utf8'))
      } catch (error) {
        throw accountError('CREDENTIAL_DECRYPT_FAILED', 500)
      } finally {
        plaintext.fill(0)
      }
    } catch (error) {
      if (error && error.code) throw error
      // GCM 认证失败 = AAD 三元组不匹配 / 密文被改 / 密钥不匹配，一律不降级、不返回半成品。
      throw accountError('CREDENTIAL_DECRYPT_FAILED', 500)
    } finally {
      dataKey.fill(0)
    }
  }

  return { encryptCredential, decryptCredential, verifyDataKey }
}

/**
 * 开发/测试用本地 KMS：主密钥是 32 字节 hex，来自 `createLocalKms({ key })` 或环境变量
 * `MP_CLOUD_KMS_LOCAL_KEY`。**生产不得启用**——主密钥必须托管在云 KMS 之后并支持轮转。
 * 包裹形态：iv(12) | authTag(16) | AES-256-GCM(dk)，AAD 绑 keyId，因此换 keyId 解不开。
 */
function createLocalKms(options = {}) {
  const env = options.env || process.env
  const configured = typeof options.key === 'string' ? options.key.trim() : String((env && env[LOCAL_KMS_KEY_ENV]) || '').trim()
  if (!LOCAL_KMS_KEY_PATTERN.test(configured)) {
    throw accountError('KMS_CONFIG_INVALID', 503)
  }
  const masterKey = Buffer.from(configured, 'hex')
  const localRandom = normalizeRandomBytes(options.randomBytes)
  return {
    async wrap(dataKey, keyId) {
      if (!Buffer.isBuffer(dataKey) || dataKey.length !== DATA_KEY_BYTES) throw kmsUnavailable(new Error('invalid data key'))
      if (typeof keyId !== 'string' || !keyId) throw kmsUnavailable(new Error('invalid key id'))
      const iv = readRandom(localRandom, IV_BYTES, 'iv')
      const cipher = crypto.createCipheriv('aes-256-gcm', masterKey, iv)
      cipher.setAAD(Buffer.from(keyId, 'utf8'))
      const ciphertext = Buffer.concat([cipher.update(dataKey), cipher.final()])
      return Buffer.concat([iv, cipher.getAuthTag(), ciphertext])
    },
    async unwrap(wrapped, keyId) {
      if (!Buffer.isBuffer(wrapped) || wrapped.length <= IV_BYTES + AUTH_TAG_BYTES) {
        throw kmsUnavailable(new Error('invalid wrapped key'))
      }
      if (typeof keyId !== 'string' || !keyId) throw kmsUnavailable(new Error('invalid key id'))
      const iv = wrapped.subarray(0, IV_BYTES)
      const tag = wrapped.subarray(IV_BYTES, IV_BYTES + AUTH_TAG_BYTES)
      const ciphertext = wrapped.subarray(IV_BYTES + AUTH_TAG_BYTES)
      try {
        const decipher = crypto.createDecipheriv('aes-256-gcm', masterKey, iv)
        decipher.setAAD(Buffer.from(keyId, 'utf8'))
        decipher.setAuthTag(tag)
        return Buffer.concat([decipher.update(ciphertext), decipher.final()])
      } catch (error) {
        throw kmsUnavailable(error)
      }
    },
  }
}

/** Buffer → base64（HTTP 线上形态）。 */
function encodeEnvelope(envelope) {
  if (!isPlainObject(envelope)) throw accountError('CREDENTIAL_SHAPE_INVALID', 400)
  const out = { v: envelope.v, alg: envelope.alg, digest: envelope.digest }
  for (const field of ENVELOPE_BINARY_FIELDS) out[field] = asBytes(envelope[field], 'CREDENTIAL_SHAPE_INVALID').toString('base64')
  return out
}

/** base64（或 Buffer）→ Buffer（入库形态，BYTEA 直接吃 Buffer）。 */
function decodeEnvelope(envelope) {
  if (!isPlainObject(envelope)) throw accountError('CREDENTIAL_SHAPE_INVALID', 400)
  const out = { v: envelope.v, alg: envelope.alg, digest: envelope.digest }
  for (const field of ENVELOPE_BINARY_FIELDS) out[field] = asBytes(envelope[field], 'CREDENTIAL_SHAPE_INVALID')
  return out
}

module.exports = {
  DATA_KEY_BYTES,
  ENVELOPE_ALG,
  ENVELOPE_BINARY_FIELDS,
  ENVELOPE_VERSION,
  IV_BYTES,
  LOCAL_KMS_KEY_ENV,
  buildAad,
  createEnvelopeCrypto,
  createLocalKms,
  decodeEnvelope,
  encodeEnvelope,
  keyIdFor,
  kmsUnavailable,
}
