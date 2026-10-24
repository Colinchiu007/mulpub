// @ts-check
'use strict'
/**
 * kit-import-lock 契约测试（PR-3b 资产导入 · 锁与租约）
 *
 * 覆盖：独占建锁 / 租约判定（mtime 心跳，不靠 PID）/ nonce 认领删锁 / 锁内容损坏不清锁。
 */

const fs = require('fs')
const os = require('os')
const path = require('path')

const {
  createLock,
  readLockState,
  clearLock,
  heartbeat,
  makeNonce,
  lockPathOf,
  LEASE_MS,
  REASON,
} = require('./kit-import-lock')

function tmpDir () {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'kit-lock-'))
}

describe('kit-import-lock: 建锁', () => {
  it('独占建锁成功，内容含 pid/nonce/startedAt/senderUrl', () => {
    const dir = tmpDir()
    const res = createLock({ userDataDir: dir, senderUrl: 'app://localhost/#/film-engineering' })
    expect(res.ok).toBe(true)
    const raw = JSON.parse(fs.readFileSync(lockPathOf(dir), 'utf8'))
    expect(typeof raw.pid).toBe('number')
    expect(typeof raw.nonce).toBe('string')
    expect(typeof raw.startedAt).toBe('string')
    expect(raw.senderUrl).toBe('app://localhost/#/film-engineering')
  })

  it('锁已存在 ⇒ LOCK_CREATE_FAILED（不覆盖别人的锁）', () => {
    const dir = tmpDir()
    createLock({ userDataDir: dir })
    const again = createLock({ userDataDir: dir })
    expect(again.ok).toBe(false)
    expect(again.reason).toBe(REASON.LOCK_CREATE_FAILED)
  })

  it('makeNonce 每次不同（32 位随机）', () => {
    const a = makeNonce()
    const b = makeNonce()
    expect(a).not.toBe(b)
    expect(a.length).toBe(32)
  })
})

describe('kit-import-lock: 租约判定（不靠 PID）', () => {
  it('锁不存在 ⇒ exists=false', () => {
    const state = readLockState({ userDataDir: tmpDir() })
    expect(state.exists).toBe(false)
    expect(state.leaseValid).toBe(false)
  })

  it('刚建的锁 ⇒ 租约有效', () => {
    const dir = tmpDir()
    createLock({ userDataDir: dir })
    const state = readLockState({ userDataDir: dir })
    expect(state.exists).toBe(true)
    expect(state.leaseValid).toBe(true)
    expect(state.ageMs).toBeLessThanOrEqual(LEASE_MS)
  })

  it('mtime 超过租约期 ⇒ 租约过期（即使 PID 还在）', () => {
    const dir = tmpDir()
    const res = createLock({ userDataDir: dir })
    const old = new Date(Date.now() - (LEASE_MS + 5000))
    fs.utimesSync(lockPathOf(dir), old, old)
    const state = readLockState({ userDataDir: dir })
    expect(state.leaseValid).toBe(false)
    expect(state.nonce).toBe(res.nonce)
  })

  it('heartbeat 刷新 mtime（租约恢复有效）', () => {
    const dir = tmpDir()
    const res = createLock({ userDataDir: dir })
    const old = new Date(Date.now() - (LEASE_MS + 5000))
    fs.utimesSync(lockPathOf(dir), old, old)
    expect(readLockState({ userDataDir: dir }).leaseValid).toBe(false)
    const ok = heartbeat({ userDataDir: dir, nonce: res.nonce })
    expect(ok).toBe(true)
    expect(readLockState({ userDataDir: dir }).leaseValid).toBe(true)
  })

  it('heartbeat 的 nonce 不匹配 ⇒ 不刷新（不碰别人的锁）', () => {
    const dir = tmpDir()
    createLock({ userDataDir: dir })
    const ok = heartbeat({ userDataDir: dir, nonce: 'deadbeef' })
    expect(ok).toBe(false)
  })
})

describe('kit-import-lock: 删锁的认领规则', () => {
  it('锁内容不可解析 ⇒ 不清锁（可能仍有导入在跑）', () => {
    const dir = tmpDir()
    createLock({ userDataDir: dir })
    fs.writeFileSync(lockPathOf(dir), 'not-json', 'utf8')
    const res = clearLock({ userDataDir: dir })
    expect(res.ok).toBe(false)
    expect(res.reason).toBe(REASON.LOCK_HELD)
    expect(fs.existsSync(lockPathOf(dir))).toBe(true)
  })

  it('租约有效且 nonce 不匹配 ⇒ 不删（那是别人的锁）', () => {
    const dir = tmpDir()
    createLock({ userDataDir: dir })
    const res = clearLock({ userDataDir: dir, expectNonce: 'other-nonce' })
    expect(res.ok).toBe(false)
    expect(fs.existsSync(lockPathOf(dir))).toBe(true)
  })

  it('租约有效且 nonce 匹配 ⇒ 删（认领自己的锁）', () => {
    const dir = tmpDir()
    const res = createLock({ userDataDir: dir })
    const cleared = clearLock({ userDataDir: dir, expectNonce: res.nonce })
    expect(cleared.ok).toBe(true)
    expect(cleared.deleted).toBe(true)
    expect(fs.existsSync(lockPathOf(dir))).toBe(false)
  })

  it('租约已过期 ⇒ 允许清锁（不会永久卡在 LOCK_HELD）', () => {
    const dir = tmpDir()
    createLock({ userDataDir: dir })
    const old = new Date(Date.now() - (LEASE_MS + 5000))
    fs.utimesSync(lockPathOf(dir), old, old)
    const cleared = clearLock({ userDataDir: dir })
    expect(cleared.ok).toBe(true)
    expect(cleared.deleted).toBe(true)
  })
})
