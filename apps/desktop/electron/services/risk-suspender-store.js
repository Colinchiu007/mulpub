'use strict'
/**
 * risk-suspender-store.js — 桌面风控挂起守卫（W1 §5 enforcement，PRD §12.15）
 *
 * 复用引擎 `@multi-publish/api-publish-engine` 的 createRiskSuspender 纯逻辑（内存态 + 键语义），
 * 外包「懒水合 + 态变更后回写 store」的持久化壳，使挂起态重启存活；作为 DI 单例，
 * 供 executor 派发前置守卫、phase4-events 生产端、publishRisk IPC 三处读写同一真源。
 *
 * 键语义（与引擎完全一致）：
 *   - suspend(platform, accountId)：accountId 存在 → 只挂该账号（不牵连同平台其它号，决策账：风控即停不换号）；
 *     accountId 为 null/undefined → 平台级挂起，覆盖该平台所有账号（宁可多拦不可漏放）。
 *   - isSuspended(platform, accountId)：平台级挂起命中该平台所有账号；细粒度挂起仅命中对应账号。
 *
 * 合规红线：无自动恢复计时器、无自动换号；resume 仅由显式调用（IPC / 人工确认）触发。
 */

// 深路径复用引擎纯逻辑（该 workspace 包已是 apps/desktop 直接依赖，深路径 require 系既有先例，见 publish.js listCollections）。
const { createRiskSuspender } = require('@multi-publish/api-publish-engine/src/publish/core/risk-suspender')

const SETTING_KEY = 'publish.riskSuspended'

/** 派发前置守卫命中挂起时抛出的可识别错误：noRetry 让 taskQueue 立即标 failed 不重试（风控即停）。 */
class RiskSuspendedError extends Error {
  /**
   * @param {string} platform
   * @param {string|null} [accountId]
   */
  constructor (platform, accountId) {
    super('publish blocked: risk_suspended for ' + platform + (accountId ? '/' + accountId : ''))
    this.name = 'RiskSuspendedError'
    this.code = 'risk_suspended'
    this.blocked = true
    this.noRetry = true
    this.platform = platform
    this.accountId = accountId == null ? null : accountId
  }
}

/**
 * 判断一段错误文本是否为「本守卫拦截导致」（避免 phase4-events 对被拦截任务再次挂起 / 误报风控命中）。
 * @param {unknown} errorMessage
 * @returns {boolean}
 */
function isRiskSuspendedMessage (errorMessage) {
  return typeof errorMessage === 'string' && errorMessage.indexOf('risk_suspended') !== -1
}

/**
 * 创建桌面风控挂起守卫（懒水合 + store 持久化）。
 * @param {object} [deps]
 * @param {{getSetting:Function,setSetting:Function}} [deps.store] - 持久化后端（缺省仅内存态）
 * @param {() => number} [deps.clock] - 时间戳来源（测试注入）
 * @param {{warn?:Function,error?:Function}} [deps.log] - 日志（写失败仅告警不抛）
 */
function createDesktopRiskSuspender (deps = {}) {
  const store = deps.store || null
  const log = deps.log || null
  let hydrated = false

  const inner = createRiskSuspender({ clock: deps.clock, logger: log })

  function persist () {
    if (!store || typeof store.setSetting !== 'function') return
    try {
      store.setSetting(SETTING_KEY, inner.listSuspended())
    } catch (e) {
      // 写失败仅告警，不影响内存态与发布流程（fail-soft）
      if (log && typeof log.warn === 'function') log.warn('RiskSuspender', 'persist failed: ' + (e && e.message))
    }
  }

  /** 懒水合：首次读取 store 回填内存态（读失败按空集，不阻断正常发布，fail-open on read）。幂等。 */
  function hydrate () {
    if (hydrated) return
    hydrated = true
    if (!store || typeof store.getSetting !== 'function') return
    let raw
    try {
      raw = store.getSetting(SETTING_KEY)
    } catch (e) {
      if (log && typeof log.warn === 'function') log.warn('RiskSuspender', 'hydrate read failed: ' + (e && e.message))
      return
    }
    if (!Array.isArray(raw)) return
    raw.forEach(function (rec) {
      if (!rec || typeof rec.platform !== 'string' || !rec.platform) return
      try {
        // 直接回填内层（不经包装方法，避免水合过程反向触发持久化）
        inner.suspend(rec.platform, rec.accountId, {
          reason: typeof rec.reason === 'string' ? rec.reason : 'risk_blocked',
          at: rec.at,
        })
      } catch (_) { /* 单条非法记录跳过 */ }
    })
  }

  function suspend (platform, accountId, info) {
    hydrate()
    const rec = inner.suspend(platform, accountId, info)
    persist()
    return rec
  }

  function isSuspended (platform, accountId) {
    hydrate()
    return inner.isSuspended(platform, accountId)
  }

  function resume (platform, accountId) {
    hydrate()
    const changed = inner.resume(platform, accountId)
    if (changed) persist()
    return changed
  }

  function listSuspended () {
    hydrate()
    return inner.listSuspended()
  }

  function getSuspension (platform, accountId) {
    hydrate()
    return inner.getSuspension(platform, accountId)
  }

  function clear () {
    hydrate()
    const n = inner.clear()
    persist()
    return n
  }

  function size () {
    hydrate()
    return inner.size()
  }

  return {
    suspend,
    isSuspended,
    getSuspension,
    resume,
    listSuspended,
    clear,
    size,
    hydrate,
  }
}

module.exports = {
  createDesktopRiskSuspender,
  RiskSuspendedError,
  isRiskSuspendedMessage,
  SETTING_KEY,
}
