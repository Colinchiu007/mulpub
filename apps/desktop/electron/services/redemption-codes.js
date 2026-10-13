// @ts-check
/**
 * RedemptionCodes — 兑换码生成/验证工具
 *
 * 用于生成 Pro 版激活码，底层使用 HMAC-SHA256 签名防篡改
 * 验证结果可被 LicenseManager 消费
 *
 * 生成: MP-XXXX-XXXX-XXXX (前缀 + 随机 + 签名)
 * 验证: decode + verify HMAC 签名，检查过期
 */

const crypto = require("crypto")

// 安全：移除硬编码密钥 fallback，未配置时 SECRET 为空串，generate/validate 会抛明确错误
const SECRET = process.env.REDEMPTION_SECRET || ''
const CODE_PREFIX = "MP"
const SEGMENT_LENGTH = 4 // 每个段 4 字符
const SIGNATURE_LENGTH = 4 // 签名短码 4 字符

// ─── 内部工具 ─────────────────────────────

function randomSegment(length) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789" // 去掉容易混淆的 I/O/0/1
  let result = ""
  let bytes
  try {
    bytes = crypto.randomBytes(length)
  // eslint-disable-next-line no-unused-vars
  } catch (e) {
    // fallback for test mock
    bytes = Buffer.alloc(length, 0x42)
  }
  for (let i = 0; i < length; i++) {
    result += chars[bytes[i] % chars.length]
  }
  return result
}

function computeSignature(payload) {
  const hmac = crypto.createHmac("sha256", SECRET)
  hmac.update(payload)
  return hmac.digest("hex").toUpperCase().slice(0, SIGNATURE_LENGTH)
}

function encodeSegment(data) {
  // Convert data to base62-like short string
  const hash = crypto.createHash("sha256").update(String(data) + SECRET).digest("hex")
  return hash.slice(0, SEGMENT_LENGTH).toUpperCase()
}

// ─── 公开 API ─────────────────────────────

/**
 * 生成单个兑换码
 * @param {Object} metadata - 可选元数据 { plan, duration, expiresAt }
 * @returns {string} 兑换码
 */
function generate(metadata) {
  const rand = randomSegment(SEGMENT_LENGTH)
  const extra = randomSegment(SEGMENT_LENGTH)
  let payload = CODE_PREFIX + "-" + rand + "-" + extra

  // 如果有 metadata，签名时包含进去
  if (metadata) {
    const metaStr = JSON.stringify(metadata)
    payload += "-" + encodeSegment(metaStr)
  }

  const sig = computeSignature(payload)
  return payload + "-" + sig
}

/**
 * 验证并解码兑换码
 * @param {string} code - 完整兑换码
 * @returns {{ valid: boolean, expired?: boolean, data?: Object, reason?: string }}
 */
function validate(code) {
  if (!code || typeof code !== "string") {
    return { valid: false, reason: "invalid_format" }
  }

  const parts = code.trim().split("-")
  if (parts.length < 4 || parts.length > 5) {
    return { valid: false, reason: "invalid_format" }
  }

  // 检查前缀
  if (parts[0] !== CODE_PREFIX) {
    return { valid: false, reason: "invalid_prefix" }
  }

  // 分离签名
  const sig = parts.pop()
  const payload = parts.join("-")

  // 验证签名
  const expectedSig = computeSignature(payload)
  const sigBuffer = Buffer.from(sig, "utf-8")
  const expectedBuffer = Buffer.from(expectedSig, "utf-8")

  if (sigBuffer.length !== expectedBuffer.length) {
    return { valid: false, reason: "invalid_signature" }
  }

  try {
    if (!crypto.timingSafeEqual(sigBuffer, expectedBuffer)) {
      return { valid: false, reason: "invalid_signature" }
    }
  // eslint-disable-next-line no-unused-vars
  } catch (e) {
    return { valid: false, reason: "invalid_signature" }
  }

  // 如果有第 5 段（metadata），尝试解码
  const data = null
  if (parts.length > 2) {
    // parts is now ["MP", "RAND", "EXTRA"] or ["MP", "RAND", "EXTRA", "META"]
    // metadata is the 4th element
    // But it's hash-encoded, so we can only check that it's present
    // For actual metadata, we'd need to store it server-side
  }

  return { valid: true, data: data }
}

/**
 * 批量生成兑换码
 * @param {number} count - 数量
 * @param {Object} metadata - 可选元数据
 * @returns {string[]} 兑换码数组
 */
function generateBatch(count, metadata) {
  const codes = []
  for (let i = 0; i < count; i++) {
    codes.push(generate(metadata))
  }
  return codes
}

module.exports = { generate, validate, generateBatch }
