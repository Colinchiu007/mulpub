// @ts-check
'use strict'
/**
 * kit-import-lock — 导入锁（落盘真源）、租约心跳与残留判定
 *
 * 归属：PR-3b（F-J 资产导入写路径）· 方案 `pr3b-import-design.md` §二 ⓪/§三 S11/S12/S18
 *
 * 设计要点（全部来自方案，逐条对应）：
 *   - **真源 = 落盘文件** `userData/.import-lock`（内存标记只是加速判据）；
 *   - **内容 = 一行 JSON**：`{ pid, nonce, startedAt, senderUrl }`
 *     （`pid` 仅审计线索；`nonce` 用于「删锁前认领自己的锁」）；
 *   - **存活判定 = 租约**，不是 PID（PID 会被复用 ⇒ 误判）：
 *     导入期间每 5 秒刷新 mtime（心跳），**mtime 年龄 ≤ 60 秒 ⇒ 租约有效**；
 *   - **nonce 比对只在租约有效时阻止清锁**（那时 owner 可能还活着）；
 *     **租约已过期 ⇒ 允许清锁**（owner 已被判定死亡 ⇒ 不会永久卡在 LOCK_HELD）；
 *   - **锁内容 JSON 解析失败 ⇒ 视为「残留且不可信」⇒ 不清锁**（可能仍有导入在跑）。
 *
 * 本模块提供 `readLockState()` —— **service 初始化与导入入口共用同一套实现**
 *（方案 §二 ⓪a 的要求：不能出现「service 判得清、导入判不清」的两套口径）。
 */

const nodeFs = require('fs')
const nodePath = require('path')
const nodeCrypto = require('crypto')

/** 锁文件名（与目标 kit 同父目录） */
const LOCK_FILE = '.import-lock'
/** 租约心跳间隔（毫秒） */
const HEARTBEAT_MS = 5 * 1000
/** 租约有效期（毫秒）：mtime 年龄 ≤ 此值 ⇒ 租约有效 */
const LEASE_MS = 60 * 1000

/** 失败原因（闭集见方案 §五） */
const REASON = Object.freeze({
  LOCK_CREATE_FAILED: 'LOCK_CREATE_FAILED',
  LOCK_HELD: 'LOCK_HELD',
})

/** 生成 32 位随机 nonce（十六进制） */
function makeNonce () {
  return nodeCrypto.randomBytes(16).toString('hex')
}

/** 锁文件路径 */
function lockPathOf (userDataDir) {
  return nodePath.join(userDataDir, LOCK_FILE)
}

/**
 * 创建锁（**独占**：`wx` ⇒ 已存在即失败）。
 * @returns {{ok:boolean, reason?:string, message?:string, nonce?:string, path?:string}}
 */
function createLock (opts) {
  const o = opts || {}
  const fsImpl = o.fs || nodeFs
  const userDataDir = o.userDataDir
  const nonce = o.nonce || makeNonce()
  const payload = {
    pid: o.pid == null ? process.pid : o.pid,
    nonce,
    startedAt: o.now ? new Date(o.now).toISOString() : new Date().toISOString(),
    senderUrl: o.senderUrl || null,
  }
  const p = lockPathOf(userDataDir)
  try {
    fsImpl.writeFileSync(p, JSON.stringify(payload), { flag: 'wx', encoding: 'utf8' })
  } catch (e) {
    const code = e && e.code
    if (code === 'EEXIST') {
      return { ok: false, reason: REASON.LOCK_CREATE_FAILED, message: '锁已存在' }
    }
    return { ok: false, reason: REASON.LOCK_CREATE_FAILED, message: '建锁失败: ' + String(e && e.message) }
  }
  return { ok: true, nonce, path: p, payload }
}

/**
 * 读锁状态（**service 初始化与导入入口共用**）。
 * @returns {{exists:boolean, parseError:boolean, leaseValid:boolean, ageMs:number, nonce:string|null, pid:number|null, startedAt:string|null, path:string}}
 */
function readLockState (opts) {
  const o = opts || {}
  const fsImpl = o.fs || nodeFs
  const now = o.now == null ? Date.now() : o.now
  const p = lockPathOf(o.userDataDir)
  let st
  try {
    st = fsImpl.statSync(p)
  } catch (_e) {
    return {
      exists: false, parseError: false, leaseValid: false, ageMs: Infinity,
      nonce: null, pid: null, startedAt: null, path: p,
    }
  }
  const ageMs = Math.max(0, now - st.mtimeMs)
  let payload = null
  let parseError = false
  try {
    const raw = fsImpl.readFileSync(p, 'utf8')
    payload = JSON.parse(raw)
  } catch (_e) {
    parseError = true
  }
  return {
    exists: true,
    parseError,
    leaseValid: !parseError && ageMs <= LEASE_MS,
    ageMs,
    nonce: payload && typeof payload.nonce === 'string' ? payload.nonce : null,
    pid: payload && typeof payload.pid === 'number' ? payload.pid : null,
    startedAt: payload && typeof payload.startedAt === 'string' ? payload.startedAt : null,
    path: p,
  }
}

/**
 * 刷新锁的 mtime（心跳）。锁不在或已被别人接管时返回 false。
 * @returns {boolean} 是否刷新成功
 */
function heartbeat (opts) {
  const o = opts || {}
  const fsImpl = o.fs || nodeFs
  const p = lockPathOf(o.userDataDir)
  const now = o.now == null ? new Date() : new Date(o.now)
  try {
    // utimes 不会改内容；先确认锁内容里的 nonce 仍是自己那份（防误刷别人的锁）
    if (o.nonce) {
      const state = readLockState({ fs: fsImpl, userDataDir: o.userDataDir, now: now.getTime() })
      if (!state.exists || state.nonce !== o.nonce) return false
    }
    fsImpl.utimesSync(p, now, now)
    return true
  } catch (_e) {
    return false
  }
}

/**
 * 删锁（**认领**）：
 *   - `expectNonce` 给定时，**只有锁内 nonce 相同才删**（防删别人的锁）；
 *   - `forceExpired` 为真时（租约已过期）允许 nonce 不匹配也删（owner 已死 ⇒ 不会永久卡死）。
 * @returns {{ok:boolean, reason?:string, message?:string, deleted:boolean}}
 */
function clearLock (opts) {
  const o = opts || {}
  const fsImpl = o.fs || nodeFs
  const state = readLockState({
    fs: fsImpl,
    userDataDir: o.userDataDir,
    now: o.now == null ? Date.now() : o.now,
  })
  if (!state.exists) return { ok: true, deleted: false }
  if (state.parseError) {
    // 锁内容不可解析 ⇒ 视为「残留且不可信」⇒ 不清锁（可能仍有导入在跑）
    return { ok: false, reason: REASON.LOCK_HELD, message: '锁内容不可解析，不清锁', deleted: false }
  }
  if (state.leaseValid) {
    if (o.expectNonce && state.nonce !== o.expectNonce) {
      return { ok: false, reason: REASON.LOCK_HELD, message: '锁属于他人（nonce 不匹配），不清', deleted: false }
    }
    if (!o.expectNonce) {
      return { ok: false, reason: REASON.LOCK_HELD, message: '租约仍有效，不清锁', deleted: false }
    }
  }
  try {
    fsImpl.unlinkSync(state.path)
    return { ok: true, deleted: true }
  } catch (e) {
    return { ok: false, reason: REASON.LOCK_HELD, message: '删锁失败: ' + String(e && e.message), deleted: false }
  }
}

module.exports = {
  LOCK_FILE,
  HEARTBEAT_MS,
  LEASE_MS,
  REASON,
  makeNonce,
  lockPathOf,
  createLock,
  readLockState,
  heartbeat,
  clearLock,
}
