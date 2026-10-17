// @ts-check
/**
 * LicenseManager — 许可证管理器
 *
 * 管理：免费/试用/Pro 许可证状态
 * 存储：userData/license.json（加密存储防篡改）
 * Pro 功能门控依赖此模块
 */

const fs = require("fs")
const path = require("path")
const crypto = require("crypto")
const { app } = require("electron")
const log = require("./logger")

let _instance = null

const FREE_FEATURES = [
  "single-publish",
  "platform-basic",
]

const PRO_FEATURES = [
  "single-publish",
  "batch-publish",
  "scheduled-publish",
  "platform-all",
  "templates",
  "analytics",
  "content-intelligence",
  "api-access",
]

const TRIAL_DAYS = 7

// 2026-10-17 remove-buyout-license：原 `LICENSE_KEY_PATTERN`（本地激活码 4-4-4 格式守卫）
// 已随 `activate()` 一并移除 —— 本地不再有写入 pro 授权的路径，兑换码核销只发生在
// 服务端（POST /api/v1/redeem，权威格式见 subscription-service.js 的 REDEEM_CODE_PATTERN）。

function getDataPath(dataPath) {
  return dataPath || path.join(app.getPath("userData"), "license.json")
}

// AES-256-GCM 加密：密钥从机器 userData 路径 + 随机盐派生（每台机器不同 + 每次加密不同盐），防伪造 Pro 许可证
// 安全修复（2026-07-16）：静态盐 "license-salt" → 随机盐（16 字节），v2 格式带 salt 前缀
const ALGORITHM = "aes-256-gcm"
const IV_LENGTH = 16
const TAG_LENGTH = 16
const SALT_LENGTH = 16
const V2_PREFIX = "v2:"

function _deriveKey(salt) {
  // keyMaterial 机器特定（userData 路径包含用户名 + 应用名），salt 每次随机
  return crypto.scryptSync(app.getPath("userData"), salt, 32)
}

function encrypt(str) {
  if (!str) return ""
  const salt = crypto.randomBytes(SALT_LENGTH)
  const key = _deriveKey(salt)
  const iv = crypto.randomBytes(IV_LENGTH)
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv)
  const encrypted = Buffer.concat([cipher.update(str, "utf-8"), cipher.final()])
  const tag = cipher.getAuthTag()
  // v2 格式：v2: 前缀 + salt + iv + tag + encrypted
  return V2_PREFIX + Buffer.concat([salt, iv, tag, encrypted]).toString("base64")
}

function decrypt(encoded) {
  if (!encoded) return null
  try {
    // v2 格式：带随机盐
    if (encoded.startsWith(V2_PREFIX)) {
      const buf = Buffer.from(encoded.slice(V2_PREFIX.length), "base64")
      const salt = buf.subarray(0, SALT_LENGTH)
      const iv = buf.subarray(SALT_LENGTH, SALT_LENGTH + IV_LENGTH)
      const tag = buf.subarray(SALT_LENGTH + IV_LENGTH, SALT_LENGTH + IV_LENGTH + TAG_LENGTH)
      const encrypted = buf.subarray(SALT_LENGTH + IV_LENGTH + TAG_LENGTH)
      const key = _deriveKey(salt)
      const decipher = crypto.createDecipheriv(ALGORITHM, key, iv)
      decipher.setAuthTag(tag)
      const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()])
      return decrypted.toString("utf-8")
    }
    // 旧格式（v1）：静态盐向后兼容，解密成功后 save() 会自动升级为 v2
    const buf = Buffer.from(encoded, "base64")
    const iv = buf.subarray(0, IV_LENGTH)
    const tag = buf.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH)
    const encrypted = buf.subarray(IV_LENGTH + TAG_LENGTH)
    const legacyKey = crypto.scryptSync(app.getPath("userData"), "license-salt", 32)
    const decipher = crypto.createDecipheriv(ALGORITHM, legacyKey, iv)
    decipher.setAuthTag(tag)
    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()])
    return decrypted.toString("utf-8")
  // eslint-disable-next-line no-unused-vars
  } catch (e) {
    return null
  }
}

class LicenseManager {
  constructor(dataPath) {
    this._dataPath = getDataPath(dataPath)
    this._data = this._defaultData()
  }

  _defaultData() {
    return { type: "free", licenseKey: "", activatedAt: null, expiresAt: null, features: [] }
  }

  load() {
    try {
      if (fs.existsSync(this._dataPath)) {
        const raw = fs.readFileSync(this._dataPath, "utf-8").trim()
        if (!raw) return
        const decoded = decrypt(raw)
        if (decoded) {
          const parsed = JSON.parse(decoded)
          if (parsed && parsed.type) {
            this._data = parsed
            this._migrateLegacyLicenseType()
            log.info("LicenseManager", "License loaded: " + this._data.type)
            return
          }
        }
        // decrypt 返回 null 或 JSON 解析失败 → 主文件损坏，抛异常触发 .bak 恢复
        throw new Error("Primary license file corrupted or undecryptable")
      }
    } catch (e) {
      log.warn("LicenseManager", "Failed to load primary: " + e.message)
      // 修复 P6：损坏时先尝试 .bak 备份，避免静默降级为 free 丢失 Pro 许可
      try {
        const bakPath = this._dataPath + ".bak"
        if (fs.existsSync(bakPath)) {
          const rawBak = fs.readFileSync(bakPath, "utf-8").trim()
          const decodedBak = decrypt(rawBak)
          if (decodedBak) {
            const parsedBak = JSON.parse(decodedBak)
            if (parsedBak && parsedBak.type) {
              this._data = parsedBak
              this._migrateLegacyLicenseType()
              log.info("LicenseManager", "License restored from backup: " + this._data.type)
              return
            }
          }
        }
      } catch (e2) {
        log.warn("LicenseManager", "Backup also failed: " + e2.message)
      }
      this._data = this._defaultData()
      log.warn("LicenseManager", "License corrupted, fell back to free. Please re-activate if you had Pro.")
    }
  }

  save() {
    try {
      const dir = path.dirname(this._dataPath)
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
      const encoded = encrypt(JSON.stringify(this._data))
      // 修复 P6：原子写（tmp + rename）+ 备份双副本
      const tmpPath = this._dataPath + ".tmp"
      fs.writeFileSync(tmpPath, encoded, "utf-8")
      fs.renameSync(tmpPath, this._dataPath)
      // 同步备份
      try {
        const bakPath = this._dataPath + ".bak"
        fs.writeFileSync(bakPath, encoded, "utf-8")
      } catch { /* best-effort backup：失败不影响主文件已写入 */ }
    } catch (e) {
      log.warn("LicenseManager", "Failed to save: " + e.message)
    }
  }

  activateTrial() {
    if (this._data.type !== "free") return false
    this._data.type = "trial"
    this._data.activatedAt = new Date().toISOString()
    const expires = new Date()
    expires.setDate(expires.getDate() + TRIAL_DAYS)
    this._data.expiresAt = expires.toISOString()
    this._data.features = PRO_FEATURES.slice()
    this.save()
    log.info("LicenseManager", "Trial activated, expires: " + this._data.expiresAt)
    return true
  }

  deactivate() {
    this._data = this._defaultData()
    this.save()
    log.info("LicenseManager", "Deactivated")
  }

  /**
   * 存量类型规范化（remove-buyout-license，2026-10-17）。
   *
   * 买断授权模型已移除，`lifetime` 类型不再产生。但历史版本写过这种数据，
   * 直接删判断会让那批已付费用户静默降级为免费 —— 所以在加载期把它规范化为
   * `pro`（能力不变、仍然是永不过期的存量授权），并立即落盘，使之后的启动
   * 不再依赖迁移逻辑。
   *
   * 注意：这里**只读** legacy 值用于识别，不再对外暴露该类型。
   */
  _migrateLegacyLicenseType() {
    if (this._data.type === "lifetime") {
      this._data.type = "pro"
      this._data.expiresAt = null
      this.save()
      log.info("LicenseManager", "Migrated legacy lifetime license to pro")
    }
  }

  isPro() {
    if (this._data.type === "pro") {
      // 2026-10-17（CCG 深度审查 i2）：`pro` 也要看到期时间。
      //
      // 背景：买断模型移除后本地不再产生新授权，存量 `pro` 都来自终身买断
      // （`expiresAt === null`），所以这条校验对它们恒为真、不会误伤。
      // 但订阅制一旦把**带到期时间的授权**落到本地（服务端下发），没有这层校验
      // 就会「订阅已到期、本地仍当 Pro 用」。故按 fail-safe 口径：
      //   expiresAt 为 null      → 永不过期（存量买断语义）
      //   expiresAt 是有效日期    → 未到期才算 Pro
      //   expiresAt 是无法解析的值 → 视为非 Pro（与 trial 分支的 R29 口径一致）
      if (this._data.expiresAt === null || this._data.expiresAt === undefined) return true
      const proExpires = new Date(this._data.expiresAt)
      if (!Number.isFinite(proExpires.getTime())) return false
      return new Date() < proExpires
    }
    if (this._data.type === "trial") {
      if (!this._data.expiresAt) return false
      const now = new Date()
      const expires = new Date(this._data.expiresAt)
      // R29 修复：Invalid Date 守卫，无效日期视为非 Pro（与 isTrialExpired 返回 true 一致）
      if (!Number.isFinite(expires.getTime())) return false
      return now < expires
    }
    return false
  }

  isTrial() {
    return this._data.type === "trial" && this.isPro()
  }

  isTrialExpired() {
    if (this._data.type !== "trial") return false
    if (!this._data.expiresAt) return false
    const expires = new Date(this._data.expiresAt)
    // R29 修复：Invalid Date 守卫，无效日期视为已过期（与 isPro 返回 false 一致）
    if (!Number.isFinite(expires.getTime())) return true
    return new Date() > expires
  }

  getInfo() {
    return {
      type: this._data.type,
      licenseKey: this._data.licenseKey || "",
      activatedAt: this._data.activatedAt,
      expiresAt: this._data.expiresAt,
      features: this._data.features || [],
      isPro: this.isPro(),
      isTrial: this.isTrial(),
      isTrialExpired: this.isTrialExpired(),
      daysRemaining: this._daysRemaining(),
    }
  }

  getFeatures() {
    if (this.isPro()) return PRO_FEATURES.slice()
    return FREE_FEATURES.slice()
  }

  hasFeature(featureName) {
    return this.getFeatures().indexOf(featureName) >= 0
  }

  _daysRemaining() {
    if (this._data.type !== "trial" || !this._data.expiresAt) return 0
    const now = new Date()
    const expires = new Date(this._data.expiresAt)
    const diff = expires.getTime() - now.getTime()
    // R29 修复：Invalid Date 导致 diff=NaN，Math.max(0,NaN)=NaN，NaN<=0 为 false 试用永不过期
    if (!Number.isFinite(diff)) return 0
    return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)))
  }

  static getInstance(dataPath) {
    if (!_instance) {
      _instance = new LicenseManager(dataPath)
      _instance.load()
    }
    return _instance
  }

  static get FREE_FEATURES() { return FREE_FEATURES.slice() }
  static get PRO_FEATURES() { return PRO_FEATURES.slice() }
  static get TRIAL_DAYS() { return TRIAL_DAYS }
}

module.exports = LicenseManager
