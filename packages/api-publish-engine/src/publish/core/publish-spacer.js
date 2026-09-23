'use strict'
/**
 * publish-spacer.js — 同账号发布最小间隔闸门（W1 §5.3，合规：降低风控触发面）
 *
 * 决策账：同一 (platform, accountId) 两次发布提交须间隔 ≥18 分钟。
 * 纯时间判定，clock 可注入便于虚拟时钟单测（17:59 拒、18:01 放）。
 * 不持久化——进程内台账；重启后保守放行首条（由上层频控总闸兜底）。
 */
const DEFAULT_MIN_INTERVAL_MS = 18 * 60 * 1000 // 18 分钟

function createPublishSpacer (opts = {}) {
  const minIntervalMs = opts.minIntervalMs === undefined ? DEFAULT_MIN_INTERVAL_MS : opts.minIntervalMs
  const clock = opts.clock || Date.now
  const lastAt = new Map() // key -> timestamp(ms)

  const keyOf = (platform, accountId) => platform + '::' + accountId

  /** 是否允许此刻对 (platform, accountId) 发起发布；不足间隔返回 false + 剩余等待 */
  function allow (platform, accountId) {
    if (!platform || !accountId) {
      throw new Error('publish-spacer: platform and accountId are required')
    }
    const k = keyOf(platform, accountId)
    const prev = lastAt.get(k)
    if (prev === undefined) return { allow: true, waitMs: 0 }
    const elapsed = clock() - prev
    if (elapsed >= minIntervalMs) return { allow: true, waitMs: 0 }
    return { allow: false, waitMs: minIntervalMs - elapsed }
  }

  /** 记录一次成功发起的发布（刷新时间戳） */
  function record (platform, accountId) {
    lastAt.set(keyOf(platform, accountId), clock())
  }

  /** 原子判定 + 记录：允许则刷新并返回 true，否则 false（不刷新） */
  function tryAcquire (platform, accountId) {
    const d = allow(platform, accountId)
    if (d.allow) record(platform, accountId)
    return d
  }

  function reset (platform, accountId) {
    if (platform === undefined) lastAt.clear()
    else lastAt.delete(keyOf(platform, accountId))
  }

  return { allow, record, tryAcquire, reset, minIntervalMs }
}

module.exports = { createPublishSpacer, DEFAULT_MIN_INTERVAL_MS }
