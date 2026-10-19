// @ts-check
'use strict'

/**
 * avatar-catalog-service.js — 数字人形象/音色目录服务
 *
 * 存在理由（PRD-AVATAR-SPOKESPERSON-HEYGEN-WIRING-2026-10-19）：
 * avatar-spokesperson 流水线此前「名义登记、实际未接通」——用户无法在 UI 上选择
 * 数字人形象与音色，generate 阶段也拿不到 character/voice/script。本服务把
 * HeyGen 的 /v2/avatars 与 /v2/voices 封装成稳定的目录接口，供 renderer 下拉消费。
 *
 * 设计约束：
 *  - 只做「列目录」，不做形象预览图下载/自定义形象上传（PRD §8 不做清单）。
 *  - 缓存 TTL 默认 5 分钟：HeyGen 限流 8 rpm（governor-provider-limits.js），
 *    配置页会频繁开关，不能每次实时拉。refresh=true 可强制跳过缓存。
 *  - adapter 未实现该方法（非 heygen provider）不抛异常，返回结构化
 *    AVATAR_CATALOG_UNSUPPORTED_PROVIDER，让 UI 出「未配置」提示而不是崩溃。
 */

const DEFAULT_TTL_MS = 5 * 60 * 1000

function nonEmptyString (value) {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : ''
}

function isSafeIdentifier (value, maxLength = 128) {
  return typeof value === 'string' && value.length > 0 && value.length <= maxLength &&
    /^[a-zA-Z0-9._-]+$/.test(value)
}

class AvatarCatalogService {
  /**
   * @param {{modelProviderManager?: object, ttlMs?: number}} [options]
   */
  constructor (options = {}) {
    this.modelProviderManager = options.modelProviderManager || null
    this.ttlMs = Number.isFinite(options.ttlMs) && options.ttlMs >= 0
      ? options.ttlMs
      : DEFAULT_TTL_MS
    this._cache = new Map()
  }

  /** 缓存是否仍处于有效期内 */
  _fresh (entry) {
    if (!entry) return false
    if (this.ttlMs === 0) return false
    return Date.now() - entry.at < this.ttlMs
  }

  _readCache (providerId, kind) {
    const entry = this._cache.get(providerId + ':' + kind)
    return this._fresh(entry) ? entry.value : null
  }

  _writeCache (providerId, kind, value) {
    this._cache.set(providerId + ':' + kind, { at: Date.now(), value })
  }

  /** 丢弃某个 provider 的缓存（换 Key / 切 provider 时调用） */
  invalidate (providerId) {
    const id = String(providerId || '')
    if (!id) { this._cache.clear(); return }
    this._cache.delete(id + ':avatars')
    this._cache.delete(id + ':voices')
  }

  /**
   * 统一的 adapter 调用封装。
   * @returns {Promise<{code: number, data?: any, message?: string}>}
   */
  async _call (providerId, method) {
    const manager = this.modelProviderManager
    if (!manager || typeof manager.callAdapter !== 'function') {
      return { code: -1, message: 'AVATAR_CATALOG_UNAVAILABLE' }
    }
    // 能力协商：能拿到 adapter 实例时先确认它实现了该方法，避免把「provider 不支持」
    // 变成一次必然失败的网络往返。取不到实例（getProvider 不可用）时不拦，交 callAdapter。
    if (typeof manager.getProvider === 'function') {
      let adapter = null
      try { adapter = manager.getProvider(providerId) } catch (_) { /* 保持 null 走 UNSUPPORTED */ }
      if (!adapter) return { code: -1, message: 'AVATAR_CATALOG_UNSUPPORTED_PROVIDER' }
      if (typeof adapter[method] !== 'function') {
        return { code: -1, message: 'AVATAR_CATALOG_UNSUPPORTED_PROVIDER' }
      }
    }
    try {
      const result = await manager.callAdapter(providerId, method, {})
      // callAdapter 统一返回 { code, data } / { code, message }
      if (!result || typeof result !== 'object') {
        return { code: -1, message: 'AVATAR_CATALOG_UNAVAILABLE' }
      }
      if (result.code !== 0) {
        return { code: -1, message: String(result.message || 'AVATAR_CATALOG_UNAVAILABLE') }
      }
      const data = result.data
      if (Array.isArray(data)) return { code: 0, data }
      // adapter 抛异常被 callAdapter 包装成 { code:0, data:{ code:-1, message } }
      if (data && typeof data === 'object' && (data.code === -1 || data.code < 0)) {
        return { code: -1, message: String(data.message || data.error || 'AVATAR_CATALOG_UNAVAILABLE') }
      }
      return { code: 0, data: Array.isArray(data) ? data : [] }
    } catch (error) {
      return {
        code: -1,
        message: String(error && error.message ? error.message : error).slice(0, 300),
      }
    }
  }

  /**
   * 列出数字人形象。
   * @param {{providerId: string, refresh?: boolean}} input
   */
  async listAvatars (input) {
    const providerId = nonEmptyString(input && input.providerId)
    if (!isSafeIdentifier(providerId)) {
      return { code: -1, message: 'AVATAR_CATALOG_INVALID_ARGUMENTS' }
    }
    if (input && input.refresh !== true) {
      const cached = this._readCache(providerId, 'avatars')
      if (cached) return { code: 0, data: cached, cached: true }
    }
    const result = await this._call(providerId, 'listAvatars')
    if (result.code === 0) this._writeCache(providerId, 'avatars', result.data)
    return result
  }

  /**
   * 列出可用音色。
   * @param {{providerId: string, refresh?: boolean}} input
   */
  async listVoices (input) {
    const providerId = nonEmptyString(input && input.providerId)
    if (!isSafeIdentifier(providerId)) {
      return { code: -1, message: 'AVATAR_CATALOG_INVALID_ARGUMENTS' }
    }
    if (input && input.refresh !== true) {
      const cached = this._readCache(providerId, 'voices')
      if (cached) return { code: 0, data: cached, cached: true }
    }
    const result = await this._call(providerId, 'listVoices')
    if (result.code === 0) this._writeCache(providerId, 'voices', result.data)
    return result
  }
}

module.exports = { AvatarCatalogService, DEFAULT_TTL_MS }
