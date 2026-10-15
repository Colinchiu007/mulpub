// @ts-check
/**
 * zhihu-credential — 知乎开放平台 Access Secret 凭据的**唯一真源**
 *
 * 为什么要有这一层（而不是继续在 handler 里 `store.getSetting('zhihu_access_secret')`）：
 *
 *   1. **两份消费者**：设置页（读写配置）与采集链（读密钥出站）都要解析同一份密钥。
 *      解析规则一旦分叉，就会出现「设置页说已配置、采集说未配置」这类无解争议——
 *      所以解析优先级只能有一个实现。
 *   2. **按用户隔离**：配置落在**用户域**（`get/setUserSetting`，按登录身份 sub 做命名空间），
 *      不再是一台机器一份的全局值。未登录/身份服务未配置时回落 legacy 档（与
 *      settings-store 既有口径一致），此时等价于设备级。
 *   3. **盘上不留明文**：密文经 `services/crypto`（safeStorage / DPAPI）加密后 base64 落盘；
 *      safeStorage 不可用时**拒绝保存**，不降级明文（与 model-provider / 飞书同一姿态）。
 *   4. **旧版明文可迁移**：历史版本把用户输入直接写进全局 `zhihu_access_secret`（明文）。
 *      本模块保留**只读兼容**（优先加密配置，其次旧明文），并在保存/清除时销账旧明文，
 *      使存量用户升级后不丢配置、同时逐步消灭盘上明文。
 *
 * 返回形状约定（消费方无需 try/catch）：
 *   - 读路径永不抛错，失败一律回落安全默认；
 *   - 写路径返回 `{ ok, error? }`，绝不谎报成功（写入后用读回校验兜住静默丢弃）。
 *
 * 三态语义（UI 直接消费，不要在别处再算一遍）：
 *   - `configured=true, readable=true`  → 可用（显示遮罩 + 验证时间）
 *   - `configured=true, readable=false` → 已保存但当前解不开（安全存储不可用/换机），需重新保存
 *   - `configured=false, legacyDetected=true` → 只有旧版明文，提示「重新保存以加密迁移」
 */

const CONFIG_KEY = 'zhihu_api_config'
const LEGACY_KEY = 'zhihu_access_secret'
const MIN_SECRET_LENGTH = 8
const MAX_SECRET_LENGTH = 512
// 控制字符判定不用正则：`/[\u0000-\u001f\u007f]/` 会被 ESLint `no-control-regex` 判红
// （QG Static 实测抓到），而码点比较既等价又不引 lint 例外。
function _hasControlChar (text) {
  for (const ch of text) {
    const code = ch.codePointAt(0)
    if (code < 0x20 || code === 0x7f) return true
  }
  return false
}

/**
 * 校验 Access Secret。
 * @param {unknown} value
 * @returns {{ok: true, value: string} | {ok: false, error: string}}
 */
function validateSecret (value) {
  if (typeof value !== 'string' || !value.trim()) {
    return { ok: false, error: 'Access Secret 不能为空' }
  }
  const trimmed = value.trim()
  if (_hasControlChar(trimmed)) {
    return { ok: false, error: 'Access Secret 不能包含换行或控制字符' }
  }
  if (trimmed.length < MIN_SECRET_LENGTH) {
    return { ok: false, error: `Access Secret 长度不足（至少 ${MIN_SECRET_LENGTH} 位）` }
  }
  if (trimmed.length > MAX_SECRET_LENGTH) {
    return { ok: false, error: `Access Secret 过长（最多 ${MAX_SECRET_LENGTH} 位）` }
  }
  return { ok: true, value: trimmed }
}

/**
 * 遮罩：只暴露首 4 位与末 4 位；短于 8 位一律 `****`（防「遮罩」本身泄露短密钥）。
 * @param {string} secret
 * @returns {string}
 */
function maskSecret (secret) {
  if (typeof secret !== 'string' || secret.length < 8) return '****'
  return secret.slice(0, 4) + '****' + secret.slice(-4)
}

function _crypto (opts) {
  if (opts && opts.crypto) return opts.crypto
  return require('./crypto')
}

function _hasUserScope (store) {
  return Boolean(store &&
    typeof store.getUserSetting === 'function' &&
    typeof store.setUserSetting === 'function')
}

/** 读全局域（旧版明文）容器；失败按「没有」处理。 */
function _readLegacy (store) {
  try {
    if (!store || typeof store.getSetting !== 'function') return ''
    const v = store.getSetting(LEGACY_KEY)
    return typeof v === 'string' ? v.trim() : ''
  } catch {
    return ''
  }
}

/** 读用户域配置行；失败按「没有」处理。 */
function _readRow (store) {
  try {
    if (!_hasUserScope(store)) return null
    const row = store.getUserSetting(CONFIG_KEY, null)
    return row && typeof row === 'object' ? row : null
  } catch {
    return null
  }
}

/**
 * 读配置状态（**不含明文**，可直接回渲染端）。
 * @param {object} store
 * @param {{crypto?: object}} [opts]
 */
function readConfig (store, opts) {
  const out = {
    configured: false,
    readable: false,
    maskedSecret: '',
    updatedAt: null,
    verifiedAt: null,
    favlistCount: null,
    legacyDetected: false,
    source: 'none',
  }
  try {
    const cryptoMod = _crypto(opts)
    const row = _readRow(store)
    const cipher = row && typeof row.accessSecret === 'string' ? row.accessSecret : ''
    if (cipher) {
      out.configured = true
      out.updatedAt = typeof row.updatedAt === 'string' ? row.updatedAt : null
      out.verifiedAt = typeof row.verifiedAt === 'string' ? row.verifiedAt : null
      out.favlistCount = Number.isFinite(row.favlistCount) ? Number(row.favlistCount) : null
      let plain = ''
      try {
        plain = cryptoMod.decrypt(Buffer.from(cipher, 'base64')) || ''
        plain = typeof plain === 'string' ? plain.trim() : ''
      } catch {
        plain = ''
      }
      if (plain) {
        out.readable = true
        out.maskedSecret = maskSecret(plain)
        out.source = 'config'
        return out
      }
      // 密文在但解不开：不冒充「未配置」（否则用户会重复粘贴，而旧配置其实还在）
    }
    const legacy = _readLegacy(store)
    if (legacy) {
      out.legacyDetected = true
      out.source = 'legacy'
      out.maskedSecret = maskSecret(legacy)
    }
    return out
  } catch {
    return out
  }
}

/**
 * 密文 → 明文。解不开一律返回空串（由调用方按「读不出」处理），本函数绝不抛。
 * 抽出来是为了让 resolveSecret 与 saveConfig 的「重存同一把密钥」判定共用同一份解密语义。
 * @param {string} cipher
 * @param {object} cryptoMod
 * @returns {string}
 */
function _decryptCipher (cipher, cryptoMod) {
  try {
    const plain = cryptoMod.decrypt(Buffer.from(String(cipher), 'base64')) || ''
    return typeof plain === 'string' ? plain.trim() : ''
  } catch {
    return ''
  }
}

/**
 * 解析出可出站的明文密钥。
 * 优先级：本用户加密配置 > 旧版全局明文 > 无。
 * @param {object} store
 * @param {{crypto?: object}} [opts]
 * @returns {{secret: string, source: 'config'|'legacy'|'none'}}
 */
function resolveSecret (store, opts) {
  try {
    const cryptoMod = _crypto(opts)
    const row = _readRow(store)
    const cipher = row && typeof row.accessSecret === 'string' ? row.accessSecret : ''
    if (cipher) {
      const plain = _decryptCipher(cipher, cryptoMod)
      if (plain) return { secret: plain, source: 'config' }
    }
    const legacy = _readLegacy(store)
    if (legacy) return { secret: legacy, source: 'legacy' }
    return { secret: '', source: 'none' }
  } catch {
    return { secret: '', source: 'none' }
  }
}

/**
 * 保存配置：校验 → 加密 → 写用户域 → 读回校验 → 销账旧版明文。
 * @param {object} store
 * @param {unknown} secret
 * @param {{crypto?: object}} [opts]
 * @returns {{ok: boolean, error?: string, data?: {maskedSecret: string, updatedAt: string}}}
 */
function saveConfig (store, secret, opts) {
  const checked = validateSecret(secret)
  if (!checked.ok) return { ok: false, error: checked.error }
  if (!_hasUserScope(store)) {
    return { ok: false, error: '用户设置存储不可用，无法保存知乎 Access Secret' }
  }
  const cryptoMod = _crypto(opts)
  if (!cryptoMod.isAvailable()) {
    return { ok: false, error: '系统凭据保护不可用，无法加密保存知乎 Access Secret' }
  }
  let cipherText
  try {
    const encrypted = cryptoMod.encrypt(checked.value)
    cipherText = Buffer.isBuffer(encrypted) ? encrypted.toString('base64') : String(encrypted || '')
  } catch (e) {
    return { ok: false, error: '系统凭据保护不可用，无法加密保存知乎 Access Secret' }
  }
  if (!cipherText) {
    return { ok: false, error: '系统凭据保护不可用，无法加密保存知乎 Access Secret' }
  }

  const updatedAt = new Date().toISOString()
  // 重存**同一把**密钥时保留「最近验证」证据：否则用户手滑重存一次，
  // 已验证时间与收藏夹数就被归零，UI 从「最近验证：<时间>」退回「尚未验证」（QM-6 评审 MINOR）。
  const prevRow = _readRow(store)
  const prevCipher = prevRow && typeof prevRow.accessSecret === 'string' ? prevRow.accessSecret : ''
  const sameAsStored = !!prevCipher && _decryptCipher(prevCipher, cryptoMod) === checked.value
  try {
    store.setUserSetting(CONFIG_KEY, {
      accessSecret: cipherText,
      enabled: true,
      updatedAt,
      verifiedAt: sameAsStored && typeof prevRow.verifiedAt === 'string' ? prevRow.verifiedAt : null,
      favlistCount: sameAsStored && Number.isFinite(prevRow.favlistCount) ? prevRow.favlistCount : null,
    })
  } catch (e) {
    return { ok: false, error: '保存失败：' + (e && e.message ? e.message : String(e)) }
  }

  // 读回校验：写入被静默丢弃（身份不可解析 / 存储未就绪）时必须出声，不能报成功。
  // 两层：① 行在不在；② **解回来是不是同一把**——存储把密文写坏时 ① 会放行（QM-6 opencode 侧 MINOR）
  try {
    const back = store.getUserSetting(CONFIG_KEY, null)
    if (!back || typeof back !== 'object' || typeof back.accessSecret !== 'string' || !back.accessSecret) {
      return { ok: false, error: '配置写入未生效（用户设置存储不可用）' }
    }
    if (_decryptCipher(back.accessSecret, cryptoMod) !== checked.value) {
      return { ok: false, error: '配置写入未生效（读回内容与保存值不一致）' }
    }
  } catch (e) {
    return { ok: false, error: '配置写入未生效（用户设置存储不可用）' }
  }

  // 迁移收口：**只销掉「就是本次保存的这一份」**旧版明文（失败不改变「保存成功」的结论）。
  // `zhihu_access_secret` 是**设备级**无前缀键：无条件清掉会把仍依赖兼容档的另一个用户
  // （或未登录档）的凭据一并抹掉，而对方从未在自己的账户下重存过（QM-6 评审 MAJOR #1）。
  try {
    if (typeof store.setSetting === 'function' && _readLegacy(store) === checked.value) {
      store.setSetting(LEGACY_KEY, null)
    }
  } catch { /* 销账失败不影响新配置可用性 */ }

  return { ok: true, data: { maskedSecret: maskSecret(checked.value), updatedAt } }
}

/**
 * 记录一次成功的连通性验证（只对已存配置生效，不会凭空造出一条配置）。
 * @param {object} store
 * @param {{favlistCount?: number}} [info]
 * @returns {{ok: boolean, error?: string}}
 */
function markVerified (store, info) {
  const row = _readRow(store)
  const cipher = row && typeof row.accessSecret === 'string' ? row.accessSecret : ''
  if (!cipher) return { ok: false, error: '未配置知乎 Access Secret' }
  try {
    const favlistCount = Number.isFinite(info && info.favlistCount) ? Number(info.favlistCount) : null
    store.setUserSetting(CONFIG_KEY, { ...row, enabled: true, verifiedAt: new Date().toISOString(), favlistCount })
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e && e.message ? e.message : String(e) }
  }
}

/**
 * 清除配置（本用户的加密行；**仅当**本用户当前解析到的正是那条设备级明文时，才一并销账）。
 *
 * 为什么不是无条件清：`zhihu_access_secret` 是设备级无前缀键，属于「升级前那份明文」。
 * 用户 A 已迁移到自己的加密行后来点「清除」，若顺手把设备级明文也删了，
 * 仍依赖兼容档的用户 B（或未登录档）会静默失去凭据（QM-6 评审 MAJOR #1）。
 * @param {object} store
 * @returns {{ok: boolean, error?: string}}
 */
function clearConfig (store) {
  try {
    // 判据取**结构**（有没有自己的加密行）而不是「解出来是什么」：解密依赖调用方注入的
    // crypto 模块，用解析结果判归属会把「解不开」误判成「本来就用兼容档」。
    const row = _readRow(store)
    const hasOwnConfig = !!(row && typeof row.accessSecret === 'string' && row.accessSecret)
    if (_hasUserScope(store)) store.setUserSetting(CONFIG_KEY, null)
    if (!hasOwnConfig && typeof store.setSetting === 'function') {
      store.setSetting(LEGACY_KEY, null)
    }
    // 写后读回：与 saveConfig 同一口径 —— 存储静默 no-op（身份不可解析 / 未就绪）时
    // 不得谎报「已清除」。少了这条，用户点完清除、界面说成功、实际上密钥还在
    // （QM-6 opencode 侧 MAJOR；模块头契约也要求读写两侧都校验）。
    const after = _readRow(store)
    if (after && typeof after.accessSecret === 'string' && after.accessSecret) {
      return { ok: false, error: '配置清除未生效（用户设置存储不可用）' }
    }
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e && e.message ? e.message : String(e) }
  }
}

module.exports = {
  CONFIG_KEY,
  LEGACY_KEY,
  MIN_SECRET_LENGTH,
  MAX_SECRET_LENGTH,
  validateSecret,
  maskSecret,
  readConfig,
  resolveSecret,
  saveConfig,
  markVerified,
  clearConfig,
}
