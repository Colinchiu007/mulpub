'use strict'
/**
 * risk-suspender.js — 风控挂起器（W1 §5.4）
 *
 * 当某平台触发 risk_blocked（风控命中），挂起该平台并通知；不影响其他平台继续发布。
 * 挂起粒度：默认平台级（accountId 省略）；传入 accountId 则细粒度只挂该账号。
 * 纯内存状态、无外部依赖，通知回调 notify 与 clock、logger 全注入，测试零副作用。
 *
 * 合规红线：风控即停、绝不自动换号绕过。resume 只由显式调用触发
 * （人工确认已处理 / 冷却到期），本模块不含任何自动恢复计时器。
 */
function createRiskSuspender (deps = {}) {
  const clock = typeof deps.clock === 'function' ? deps.clock : () => Date.now()
  const notify = typeof deps.notify === 'function' ? deps.notify : () => {}
  const logger = deps.logger || null
  const suspended = new Map() // key -> {platform, accountId, reason, at}

  const keyOf = (platform, accountId) => platform + '::' + (accountId == null ? '*' : accountId)

  function emit (type, rec) {
    try {
      notify(Object.assign({ type: type }, rec))
    } catch (e) {
      if (logger && typeof logger.error === 'function') {
        logger.error('risk-suspender', 'notify failed: ' + e.message)
      }
    }
  }

  /** 挂起某平台/账号（幂等：重复挂起只更新记录，不重复通知）。*/
  function suspend (platform, accountId, info = {}) {
    if (!platform) throw new Error('risk-suspender: suspend requires platform')
    const key = keyOf(platform, accountId)
    const rec = {
      platform: platform,
      accountId: accountId == null ? null : accountId,
      reason: info.reason || 'risk_blocked',
      at: info.at != null ? info.at : clock(),
    }
    const already = suspended.has(key)
    suspended.set(key, rec)
    if (!already) emit('suspend', rec)
    return rec
  }

  /** 是否处于挂起：平台级挂起覆盖该平台所有账号；细粒度挂起仅命中对应账号。*/
  function isSuspended (platform, accountId) {
    if (suspended.has(keyOf(platform, undefined))) return true
    if (accountId != null && suspended.has(keyOf(platform, accountId))) return true
    return false
  }

  function getSuspension (platform, accountId) {
    return suspended.get(keyOf(platform, accountId != null ? accountId : undefined)) || null
  }

  /** 显式恢复：仅命中时通知一次，返回是否有记录被移除。*/
  function resume (platform, accountId) {
    const key = keyOf(platform, accountId == null ? undefined : accountId)
    const rec = suspended.get(key)
    if (rec) {
      suspended.delete(key)
      emit('resume', rec)
      return true
    }
    return false
  }

  function listSuspended () {
    return Array.from(suspended.values())
  }

  /** 清空全部挂起（每条各发一次 resume，reason 标 cleared）。*/
  function clear () {
    const arr = Array.from(suspended.entries())
    arr.forEach(function (e) {
      suspended.delete(e[0])
      emit('resume', Object.assign({}, e[1], { reason: 'cleared' }))
    })
    return arr.length
  }

  return {
    suspend: suspend,
    isSuspended: isSuspended,
    getSuspension: getSuspension,
    resume: resume,
    listSuspended: listSuspended,
    clear: clear,
    size: function () { return suspended.size },
  }
}

module.exports = { createRiskSuspender }
