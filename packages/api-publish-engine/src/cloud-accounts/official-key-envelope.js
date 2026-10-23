'use strict'
/**
 * official-key-envelope.js — 官方 Key 的信封加密（change: compute-key-envelope-migration）。
 *
 * 与云端凭证信封（`envelope-crypto.js`）的关系：**同一套密码学参数，不同的归属语义**。
 *
 *   1. 每条官方 Key 一份随机数据密钥 DK = randomBytes(32)，AES-256-GCM，IV = randomBytes(12)。
 *   2. **两层归属，职责不同**：
 *      - KMS 包裹上下文 `keyId = official:<provider>`：只回答"这把 DK 属于哪个供应商"，
 *        **不提供行级绑定**（同一 provider 下换行仍可能解开 DK）；
 *      - 外层 AES-GCM AAD = `official|<provider>|<keyRowId>`：**行级绑定**，
 *        密文钉死在这一行上。**换 provider 或换行 ⇒ GCM 认证失败。**
 *      （同一 provider 下的行级隔离**完全由 AAD 承担**，不能靠 DK 兜底。）
 *   3. `encryptedDataKey = KMS.wrap(dk, keyId)`，DK 明文用完即 fill(0)。
 *   4. **KMS 缺失、形状不合规、wrap/unwrap 抛错或返回非 Buffer，一律 KMS_UNAVAILABLE 抛出**：
 *      绝不允许降级成「不加密」「明文入库」或「用固定密钥」。
 *
 * **格式族 `v` 独立于云端凭证的 `ENVELOPE_VERSION`**（D2）：`v` 描述的是格式族（决定 AAD 材料
 * 与解包路径），同 `v` 而 AAD 构造不同就无法判别格式。解码时**先校验 `v` 再解**，`v` 不匹配
 * 一律拒绝，不做「猜格式」。算法名 `alg` 与算法原语常量（`IV_BYTES` / `AUTH_TAG_BYTES` /
 * `ENVELOPE_ALG`）与云端凭证**同源共用**（D1）。
 *
 * 未来若 AAD 需要承载套餐/池维度，**必须新开格式族 `official-key/2`，不得就地改 v1 的 AAD
 * 材料**（D10）：AAD 是密文的自证材料，改它等于让已入库密文全部解不开。
 *
 * **明文处置**：本模块的解封入口返回明文 Buffer，调用方**必须**在用完后 `fill(0)`；
 * 模块内部对 KMS 直接交回的 DK 副本当场清零。对外服务层只暴露回调式入口
 * （`withKey(keyRowId, cb)`），见 change tasks 4.10。
 */

const crypto = require('crypto')

const {
  AUTH_TAG_BYTES,
  ENVELOPE_ALG,
  IV_BYTES,
  accountError,
  asBytes,
  isPlainObject,
} = require('./validate-account')

/** 官方 Key 信封的格式族标识。**与云端凭证的 ENVELOPE_VERSION 必须是不同取值**（D2）。 */
const OFFICIAL_KEY_ENVELOPE_VERSION = 'official-key/1'

/**
 * 数据密钥长度。AES-256-GCM 的密钥长度，原语常量本应与 `envelope-crypto.js` 同源，
 * 但 `validate-account.js` 未导出该常量（见本 change 规格偏差登记 SD-1），
 * 故此处本地声明，并在结构锁中断言两者取值相同（32）。
 */
const DATA_KEY_BYTES = 32

/** 官方 Key 归属材料的合法形态。provider 与行 id 都会进 AAD，任一为空都会让密文脱钩。 */
const PROVIDER_PATTERN = /^[A-Za-z0-9._-]{1,64}$/
const KEY_ROW_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/

function envelopeError (code, status, detail) {
  return accountError(code, status, detail)
}

function kmsUnavailable (cause) {
  const error = accountError('KMS_UNAVAILABLE', 503)
  // 底层 KMS 报错常含路径 / 密钥句柄，只作不可枚举 cause 留给日志，不外泄给调用方。
  if (cause) Object.defineProperty(error, 'cause', { value: cause, enumerable: false })
  return error
}

function requireKms (kms) {
  if (!isPlainObject(kms) || typeof kms.wrap !== 'function' || typeof kms.unwrap !== 'function') {
    throw kmsUnavailable(new Error('KMS abstraction not configured'))
  }
  return kms
}

function normalizeRandomBytes (randomBytes) {
  if (randomBytes === undefined || randomBytes === null) return crypto.randomBytes
  if (typeof randomBytes !== 'function') throw envelopeError('CRYPTO_RANDOM_INVALID', 503)
  return randomBytes
}

function readRandom (randomBytes, size, label) {
  const value = randomBytes(size)
  if (!Buffer.isBuffer(value) || value.length !== size) {
    throw envelopeError('CRYPTO_RANDOM_INVALID', 503, label)
  }
  return value
}

/** 归属元组是 AAD 的全部材料，任一不合法都会让密文与这一行脱钩，因此先于任何加密动作校验。 */
function assertOwnership ({ provider, keyRowId } = {}) {
  if (typeof provider !== 'string' || !PROVIDER_PATTERN.test(provider)) {
    throw envelopeError('OFFICIAL_KEY_PROVIDER_INVALID', 400)
  }
  if (typeof keyRowId !== 'string' || !KEY_ROW_ID_PATTERN.test(keyRowId)) {
    throw envelopeError('OFFICIAL_KEY_ROW_ID_INVALID', 400)
  }
  return { provider, keyRowId }
}

/** KMS 包裹上下文：只承载供应商维度，不承载行维度（行级绑定由外层 AAD 承担，见文件头第 2 条）。 */
function keyIdFor (provider) {
  return `official:${provider}`
}

function buildAad (provider, keyRowId) {
  return Buffer.from(`official|${provider}|${keyRowId}`, 'utf8')
}

/** 解出的 DK 一律先复制再清零：不能 fill(0) 掉调用方 Buffer 的视图，否则会抹掉已入库的加密 DK。 */
async function unwrapDataKey (kms, encryptedDataKey, keyId) {
  let raw
  try {
    raw = await kms.unwrap(encryptedDataKey, keyId)
  } catch (error) {
    throw kmsUnavailable(error)
  }
  if (!Buffer.isBuffer(raw) || raw.length === 0) throw kmsUnavailable(new Error('KMS returned no data key'))
  const dataKey = Buffer.from(raw)
  let handedOver = false
  try {
    if (dataKey.length !== DATA_KEY_BYTES) {
      throw kmsUnavailable(new Error('KMS returned a wrong-length data key'))
    }
    handedOver = true
    return dataKey
  } finally {
    // 复制出来的那份只有交回调用方才不清（调用方负责 fill(0)）；失败路径两份都要清。
    // KMS 直接交给我们的这份**必须当场清**，否则同一把明文 DK 在内存里多存一份副本直到 GC。
    raw.fill(0)
    if (!handedOver) dataKey.fill(0)
  }
}

async function wrapDataKey (kms, dataKey, keyId) {
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
 * 归一化一份待解的信封：字段形状校验 + **先校验 `v` 再解**（D2）。
 * `v` 不匹配一律拒绝，绝不「猜格式」。
 */
function assertEnvelopeShape (envelope) {
  if (!isPlainObject(envelope)) throw envelopeError('OFFICIAL_KEY_ENVELOPE_INVALID', 400)
  if (envelope.v !== OFFICIAL_KEY_ENVELOPE_VERSION) {
    throw envelopeError('OFFICIAL_KEY_ENVELOPE_VERSION_MISMATCH', 400)
  }
  if (envelope.alg !== ENVELOPE_ALG) {
    throw envelopeError('OFFICIAL_KEY_ENVELOPE_ALG_MISMATCH', 400)
  }
  const iv = asBytes(envelope.iv)
  const ciphertext = asBytes(envelope.ciphertext)
  const tag = asBytes(envelope.tag)
  const encryptedDataKey = asBytes(envelope.encryptedDataKey)
  if (iv.length !== IV_BYTES) throw envelopeError('OFFICIAL_KEY_ENVELOPE_INVALID', 400)
  if (tag.length !== AUTH_TAG_BYTES) throw envelopeError('OFFICIAL_KEY_ENVELOPE_INVALID', 400)
  if (ciphertext.length === 0) throw envelopeError('OFFICIAL_KEY_ENVELOPE_INVALID', 400)
  if (encryptedDataKey.length === 0) throw envelopeError('OFFICIAL_KEY_ENVELOPE_INVALID', 400)
  return { iv, ciphertext, tag, encryptedDataKey }
}

/**
 * createOfficialKeyEnvelopeCrypto({ kms, randomBytes })
 *   → { sealOfficialKey, openOfficialKey, verifyOfficialKeyEnvelope }
 *
 * `randomBytes` 仅供测试注入确定性密钥，生产不传。
 * `openOfficialKey` 返回**明文 Buffer**，调用方必须用完 `fill(0)`。
 */
function createOfficialKeyEnvelopeCrypto (options = {}) {
  const kms = options.kms
  const randomBytes = normalizeRandomBytes(options.randomBytes)

  /**
   * 封印一条官方 Key。
   * @param {object} args
   * @param {string} args.provider 供应商维度（如 'kling'）
   * @param {string} args.keyRowId 行 id（`official_keys.id`）
   * @param {string|Buffer} args.plaintext 明文 Key
   * @returns {Promise<object>} 信封（可直接落 `official_key_envelopes` 表）
   */
  async function sealOfficialKey ({ provider, keyRowId, plaintext } = {}) {
    const owner = assertOwnership({ provider, keyRowId })
    if (plaintext === undefined || plaintext === null) {
      throw envelopeError('OFFICIAL_KEY_PLAINTEXT_REQUIRED', 400)
    }
    const body = Buffer.isBuffer(plaintext) ? Buffer.from(plaintext) : Buffer.from(String(plaintext), 'utf8')
    if (body.length === 0) throw envelopeError('OFFICIAL_KEY_PLAINTEXT_REQUIRED', 400)
    requireKms(kms)

    const dataKey = readRandom(randomBytes, DATA_KEY_BYTES, 'dataKey')
    const iv = readRandom(randomBytes, IV_BYTES, 'iv')
    let bodyCopy = null
    try {
      bodyCopy = Buffer.from(body)
      const cipher = crypto.createCipheriv('aes-256-gcm', dataKey, iv)
      cipher.setAAD(buildAad(owner.provider, owner.keyRowId))
      const ciphertext = Buffer.concat([cipher.update(bodyCopy), cipher.final()])
      const tag = cipher.getAuthTag()
      const encryptedDataKey = await wrapDataKey(kms, dataKey, keyIdFor(owner.provider))
      return {
        v: OFFICIAL_KEY_ENVELOPE_VERSION,
        alg: ENVELOPE_ALG,
        iv,
        ciphertext,
        tag,
        encryptedDataKey,
      }
    } finally {
      // 明文副本用完即清；调用方传入的 Buffer 不动（那是调用方的所有权）。
      bodyCopy.fill(0)
      dataKey.fill(0)
    }
  }

  /**
   * 解封一条官方 Key。**返回的明文由调用方负责 `fill(0)`。**
   * 换 provider 或换行 ⇒ GCM 认证失败 ⇒ 抛 OFFICIAL_KEY_ENVELOPE_UNSEAL_FAILED。
   */
  async function openOfficialKey ({ provider, keyRowId, envelope } = {}) {
    const owner = assertOwnership({ provider, keyRowId })
    const shape = assertEnvelopeShape(envelope)
    requireKms(kms)

    const dataKey = await unwrapDataKey(kms, shape.encryptedDataKey, keyIdFor(owner.provider))
    try {
      const decipher = crypto.createDecipheriv('aes-256-gcm', dataKey, shape.iv)
      decipher.setAAD(buildAad(owner.provider, owner.keyRowId))
      decipher.setAuthTag(shape.tag)
      return Buffer.concat([decipher.update(shape.ciphertext), decipher.final()])
    } catch (error) {
      throw envelopeError('OFFICIAL_KEY_ENVELOPE_UNSEAL_FAILED', 400)
    } finally {
      dataKey.fill(0)
    }
  }

  /**
   * 只读校验：确认「这一行 + 这个 provider 的信封能被解开」，**不解正文**。
   * 用于巡检与「这把 DK 当前能被主密钥解出来」的体检，不产出明文。
   */
  async function verifyOfficialKeyEnvelope ({ provider, keyRowId, envelope } = {}) {
    const owner = assertOwnership({ provider, keyRowId })
    const shape = assertEnvelopeShape(envelope)
    requireKms(kms)
    const dataKey = await unwrapDataKey(kms, shape.encryptedDataKey, keyIdFor(owner.provider))
    try {
      const decipher = crypto.createDecipheriv('aes-256-gcm', dataKey, shape.iv)
      decipher.setAAD(buildAad(owner.provider, owner.keyRowId))
      decipher.setAuthTag(shape.tag)
      decipher.update(shape.ciphertext)
      decipher.final()
      return true
    } catch (error) {
      throw envelopeError('OFFICIAL_KEY_ENVELOPE_UNSEAL_FAILED', 400)
    } finally {
      dataKey.fill(0)
    }
  }

  return { sealOfficialKey, openOfficialKey, verifyOfficialKeyEnvelope }
}

module.exports = {
  OFFICIAL_KEY_ENVELOPE_VERSION,
  DATA_KEY_BYTES,
  createOfficialKeyEnvelopeCrypto,
  // 以下为结构锁与巡检脚本的复用面，非业务调用面。
  buildAad,
  keyIdFor,
}
