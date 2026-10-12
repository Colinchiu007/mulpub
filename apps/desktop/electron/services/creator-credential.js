'use strict'

/**
 * creator-credential.js — 博主监控的 YouTube Data API v3 凭证存储
 *
 * 契约真源：`01-docs/PRD-CREATOR-MONITOR-COLLECT-2026-10-07.md` §7.4。
 * 那份 PRD 把凭证的存储、读取方向、四种状态都写死了，本模块是它的实现。
 *
 * ## 为什么单独成模块（而不是塞进 creator-collector-runtime）
 *
 * 凭证是**唯一**一处「安全敏感」逻辑：加密落点、读取方向的明文禁令、
 * safeStorage 不可用时的 fail-closed，三条都必须能单独被测。
 * 混进采集器里，测试就得同时构造 httpGet / pythonBridge，安全断言会被淹没。
 *
 * ## 四条不可破的规则
 *
 * | 规则 | 落点 |
 * | --- | --- |
 * | 密钥明文**永不落盘** | 只写 `safeStorage:v1:<base64>`；读到不符格式的值一律**拒用**（不静默吃明文） |
 * | 读取方向**永不回传明文** | `status()` 只给 `{ status, fingerprint }`；明文只经 `getApiKey()` 留在主进程 |
 * | safeStorage 不可用 → **fail-closed** | `setApiKey` 拒绝保存（不降级明文）；`getApiKey` 返回 null |
 * | 不写日志 | 日志里只出现 status / fingerprint，绝不出现 key 本身或它的前缀 |
 *
 * ## 四种状态（PRD §7.4 表）
 *
 * - `not_configured`：settings 无该键
 * - `unavailable`：safeStorage 不可用（Linux 无 keyring / DPAPI 异常）
 * - `decrypt_failed`：有键但解不开（换机 / 换用户账户 / 密文被改）
 * - `ok`：解开了，附 `fingerprint`（sha256 末 4 位，用于「配的是不是那一把」）
 *
 * ⚠ 历史遗留的 `{command}` 空串事故（2026-10-12）与本模块的关系：
 * 旧渲染层在「IPC 服务不可用」时也去渲染「缺少采集依赖……请执行：」，
 * 于是命令位恒为空。真正的凭证缺失有**自己的**状态与文案，不该混进那句话里。
 */

const nodeCrypto = require('crypto')

/** settings 键名（PRD §7.4 写死，改动等于迁移，需同步 PRD） */
const SETTING_KEY = 'credential_youtube_api_key_enc'

/** 与 credential-store / browser-data 同族的密文前缀，便于一眼看出「这不是明文」 */
const SAFE_STORAGE_PREFIX = 'safeStorage:v1:'

const CREDENTIAL_STATUS = Object.freeze({
  OK: 'ok',
  NOT_CONFIGURED: 'not_configured',
  UNAVAILABLE: 'unavailable',
  DECRYPT_FAILED: 'decrypt_failed',
  // QM-6 后端评审 W1：settings **读取失败**（DB 锁/损坏）与「密文解不开」是两回事——
  // 前者重填无效（存储都读不出来），后者重填有效。合并会让用户对着不可操作的提示反复重填。
  // PRD §7.4 的「三态必须可区分」按此扩成四态：not_configured / read_failed / decrypt_failed / unavailable。
  READ_FAILED: 'read_failed',
})

/** 输入校验边界：API Key 是单个 token（无空白、可打印 ASCII） */
const KEY_MIN_LENGTH = 20
const KEY_MAX_LENGTH = 200
const PRINTABLE_TOKEN_RE = /^[!-~]+$/
/** Google API Key 的现行形态（`AIza` + 35 字符）。只用于**提示**，不作为拒绝理由 */
const GOOGLE_KEY_RE = /^AIza[0-9A-Za-z_-]{35}$/

/**
 * 解析 safeStorage：显式注入 > electron 自动解析（纯 Node 环境返回 null）。
 * 不缓存解析结果——测试会在同一进程里切换注入值。
 */
function resolveSafeStorage (injected) {
  if (injected !== undefined) return injected
  try {
    // eslint-disable-next-line global-require
    const { safeStorage } = require('electron')
    return safeStorage
  } catch (_) {
    return null
  }
}

function canUseSafeStorage (ss) {
  return !!(
    ss &&
    typeof ss.isEncryptionAvailable === 'function' && ss.isEncryptionAvailable() &&
    typeof ss.encryptString === 'function' &&
    typeof ss.decryptString === 'function'
  )
}

/** fingerprint = sha256(key) 末 4 位。**不是** key 的任何连续子串，避免泄露末位。 */
function fingerprintOf (key) {
  return nodeCrypto.createHash('sha256').update(String(key)).digest('hex').slice(-4)
}

/**
 * 校验用户输入。返回 `{ ok, reason }`，reason 是**机器可读**的分类
 * （渲染层据此选文案，不靠解析中文消息）。
 */
function validateApiKey (raw) {
  if (typeof raw !== 'string') return { ok: false, reason: 'not_a_string' }
  const key = raw.trim()
  if (!key) return { ok: false, reason: 'empty' }
  if (key.length < KEY_MIN_LENGTH) return { ok: false, reason: 'too_short' }
  if (key.length > KEY_MAX_LENGTH) return { ok: false, reason: 'too_long' }
  if (!PRINTABLE_TOKEN_RE.test(key)) return { ok: false, reason: 'illegal_chars' }
  return { ok: true, key }
}

/**
 * @param {{store?: object, safeStorage?: object|null, log?: object}} deps
 *   store 至少要有 `getSetting` / `setSetting`（缺任一项即视为不可持久化）。
 *   safeStorage 缺省从 electron 解析；显式传 `null` 表示「明确不可用」。
 */
function createCreatorCredentialProvider (deps = {}) {
  const { store, log } = deps
  const injectedSafeStorage = Object.prototype.hasOwnProperty.call(deps, 'safeStorage')
    ? deps.safeStorage
    : undefined

  const warn = (msg) => { if (log && typeof log.warn === 'function') log.warn('[creator-credential] ' + msg) }

  function safeStorage () {
    return resolveSafeStorage(injectedSafeStorage)
  }

  function isAvailable () {
    return canUseSafeStorage(safeStorage())
  }

  function canPersist () {
    return !!(store && typeof store.getSetting === 'function' && typeof store.setSetting === 'function')
  }

  /**
   * 读 settings。三态必须可分（PRD §7.4 i7）：
   *   - 字符串 → 有值
   *   - `null` → 确实没有该键（not_configured）
   *   - `undefined` → **读失败**（DB 锁/异常）。MUST NOT 与「没有该键」合并：
   *     把读失败报成 not_configured 会让用户以为从没配过而反复重填，
   *     而真因是存储不可读——两者的下一步动作不同。
   */
  function readStored () {
    if (!store || typeof store.getSetting !== 'function') return null
    try {
      const v = store.getSetting(SETTING_KEY)
      return typeof v === 'string' && v ? v : null
    } catch (e) {
      warn('settings read failed: ' + ((e && e.message) || String(e)))
      return undefined
    }
  }

  /**
   * 解出明文。**只有**这里能产出明文，调用方不得缓存。
   * @returns {{status: string, apiKey: string|null, fingerprint?: string}}
   */
  function resolveKey () {
    const raw = readStored()
    if (raw === undefined) return { status: CREDENTIAL_STATUS.READ_FAILED, apiKey: null }
    if (!raw) return { status: CREDENTIAL_STATUS.NOT_CONFIGURED, apiKey: null }
    if (!raw.startsWith(SAFE_STORAGE_PREFIX)) {
      // 该键存在但不是我们的密文格式 ⇒ 有人写过明文/旧格式。
      // **拒用**（不读、不返回），并报 decrypt_failed 让用户重填：
      // 静默吃下明文等于把 PRD 的「永不落明文」这条在读取侧废掉。
      warn('stored value is not safeStorage-encrypted — refused')
      return { status: CREDENTIAL_STATUS.DECRYPT_FAILED, apiKey: null }
    }
    const ss = safeStorage()
    if (!canUseSafeStorage(ss)) return { status: CREDENTIAL_STATUS.UNAVAILABLE, apiKey: null }
    try {
      const cipher = Buffer.from(raw.slice(SAFE_STORAGE_PREFIX.length), 'base64')
      const key = ss.decryptString(cipher)
      if (typeof key !== 'string' || !key.trim()) {
        warn('decrypted value is empty')
        return { status: CREDENTIAL_STATUS.DECRYPT_FAILED, apiKey: null }
      }
      return { status: CREDENTIAL_STATUS.OK, apiKey: key.trim(), fingerprint: fingerprintOf(key.trim()) }
    } catch (e) {
      // 只记消息类型，不记密文（密文本身不泄露明文，但没有记录价值）
      warn('decrypt failed: ' + ((e && e.message) || String(e)))
      return { status: CREDENTIAL_STATUS.DECRYPT_FAILED, apiKey: null }
    }
  }

  /** 主进程内部使用：明文只在发起请求时短暂存在，用后即弃。 */
  function getApiKey () {
    if (!canPersist()) return null
    const r = resolveKey()
    return r.status === CREDENTIAL_STATUS.OK ? r.apiKey : null
  }

  return {
    /** 供渲染层展示的状态载荷：**永不**含明文 */
    status () {
      if (!canPersist()) return { status: CREDENTIAL_STATUS.UNAVAILABLE, reason: 'store-unavailable' }
      // safeStorage 不可用是**阻塞态**，优先于"有没有存过"：此时功能整体不可用（PRD §7.4
      // 「safeStorage 不可用时整个博主监控功能禁用」），若报成 not_configured，用户会去填 Key
      // 然后卡在保存失败——先把环境问题摆在最前面。
      if (!isAvailable()) return { status: CREDENTIAL_STATUS.UNAVAILABLE, reason: 'safeStorage-unavailable' }
      const r = resolveKey()
      if (r.status === CREDENTIAL_STATUS.OK) {
        return { status: r.status, fingerprint: r.fingerprint }
      }
      return { status: r.status }
    },

    getApiKey,

    // ⚠ 刻意**不提供** getCredential()（QM-6 后端评审 I2）：
    // 采集器需要的形状是 `{ apiKey, pythonBridge }`，而本模块不知道 pythonBridge——
    // 早期版本在这里放了个只含 apiKey 的 getCredential()，属「形状差半截的死代码」：
    // 一旦有人改接它，字幕增强腿会静默消失（collectBody 的 bridge 变 undefined）且无测试覆盖。
    // 供给形状的唯一实现是 container.setup.creator.js 里的适配闭包（provider + pythonBridge 一起组）。

    /**
     * 保存明文 Key。**唯一**接受明文的入口（写入方向无法避免，PRD §7.4）。
     * @returns {{ok: boolean, status: string, reason?: string, fingerprint?: string, looksLikeGoogleKey?: boolean}}
     */
    setApiKey (raw) {
      const v = validateApiKey(raw)
      if (!v.ok) return { ok: false, status: CREDENTIAL_STATUS.NOT_CONFIGURED, reason: v.reason }
      if (!canPersist()) return { ok: false, status: CREDENTIAL_STATUS.UNAVAILABLE, reason: 'store-unavailable' }
      const ss = safeStorage()
      if (!canUseSafeStorage(ss)) {
        // fail-closed：绝不落明文（PRD §7.4 硬约束）
        warn('safeStorage unavailable — refusing to persist API key')
        return { ok: false, status: CREDENTIAL_STATUS.UNAVAILABLE, reason: 'safeStorage-unavailable' }
      }
      try {
        const cipher = Buffer.from(ss.encryptString(v.key)).toString('base64')
        store.setSetting(SETTING_KEY, SAFE_STORAGE_PREFIX + cipher)
      } catch (e) {
        warn('persist failed: ' + ((e && e.message) || String(e)))
        return { ok: false, status: CREDENTIAL_STATUS.UNAVAILABLE, reason: 'persist-failed' }
      }
      return {
        ok: true,
        status: CREDENTIAL_STATUS.OK,
        fingerprint: fingerprintOf(v.key),
        looksLikeGoogleKey: GOOGLE_KEY_RE.test(v.key),
      }
    },

    clear () {
      if (!canPersist()) return { ok: false, status: CREDENTIAL_STATUS.UNAVAILABLE, reason: 'store-unavailable' }
      try {
        store.setSetting(SETTING_KEY, null)
      } catch (e) {
        warn('clear failed: ' + ((e && e.message) || String(e)))
        return { ok: false, status: CREDENTIAL_STATUS.NOT_CONFIGURED, reason: 'persist-failed' }
      }
      return { ok: true, status: CREDENTIAL_STATUS.NOT_CONFIGURED }
    },
  }
}

module.exports = {
  createCreatorCredentialProvider,
  validateApiKey,
  fingerprintOf,
  canUseSafeStorage,
  resolveSafeStorage,
  SETTING_KEY,
  SAFE_STORAGE_PREFIX,
  CREDENTIAL_STATUS,
  KEY_MIN_LENGTH,
  KEY_MAX_LENGTH,
}
