// @ts-check
/**
 * apps/desktop/electron/services/windows-file-lock.test.js
 *
 * Windows 独占文件锁夹具自身的回归保护。
 *
 * 背景（2026-09-26 CI 红，run 36237637566 / job 108392212464）：
 * `credential-store.test.js` 的「Windows 主密钥短暂锁释放后仍能完成格式迁移」
 * 报 `Error: Test timed out in 60000ms`。该用例的超时历史上被抬过两次
 * （71e76a5e: 10s→30s；1e22e68f: 30s→60s），仍然红 —— 因为等待本身是**无界**的，
 * 抬高超时只决定它多久之后才失败。
 *
 * 根因：握手机制按单个 stdout data 事件判定 `includes('LOCKED')`。Node 的 data 事件
 * 不代表对端 write 边界，一次 WriteLine 可能被拆成 'LOC' + 'KED'，于是永远匹配不到。
 * 同一份实现被抄成三份（credential-store / account-state-restorer /
 * api-key-manager-atomic-write），三份同病。
 */
import { describe, it, expect, vi } from 'vitest'
import { EventEmitter } from 'node:events'

import lockHelper from '../../../../test-helpers/windows-file-lock.js'

const { createLockHandshake, holdExclusiveWindowsFileLock, LOCK_MARKER } = lockHelper

/** 造一个可控的假子进程：只暴露 helper 实际使用的接口 */
function fakeChild () {
  const child = new EventEmitter()
  child.stdout = new EventEmitter()
  child.stderr = new EventEmitter()
  child.kill = vi.fn()
  return child
}

describe('createLockHandshake — 按累计缓冲判定，跨 data 事件免疫', () => {
  it('标记被拆成多个 data 事件时仍必须判定为已锁定（本次 CI 超时的根因）', () => {
    const handshake = createLockHandshake()
    expect(handshake.feed('LOC')).toBe(false)
    expect(handshake.isLocked()).toBe(false)
    expect(handshake.feed('KED')).toBe(true)
    expect(handshake.isLocked()).toBe(true)
  })

  it('单个完整块同样判定为已锁定', () => {
    const handshake = createLockHandshake()
    expect(handshake.feed(Buffer.from(LOCK_MARKER + '\r\n'))).toBe(true)
  })

  it('锁定后不得因后续噪声回退，且保留累计原文供诊断', () => {
    const handshake = createLockHandshake()
    handshake.feed('LO')
    handshake.feed('CK')
    expect(handshake.isLocked()).toBe(false)
    expect(handshake.feed('ED ')).toBe(true)
    expect(handshake.feed('noise\r\n')).toBe(true)
    expect(handshake.text()).toContain('LOCKED')
  })

  it('标记大小写敏感：噪声 loc/lock 不得被当成已锁定', () => {
    const handshake = createLockHandshake()
    handshake.feed('loc ')
    handshake.feed('Locked ')
    handshake.feed('lock file held')
    expect(handshake.isLocked()).toBe(false)
  })
})

describe('holdExclusiveWindowsFileLock — 每段等待都要有预算且错误可诊断', () => {
  it('子进程从不输出标记时，必须在握手预算内失败并回收子进程，而不是无限挂起', async () => {
    const child = fakeChild()
    const pending = holdExclusiveWindowsFileLock('D:/tmp/.masterkey', 180, {
      spawnImpl: () => child,
      handshakeTimeoutMs: 120,
    })

    await expect(pending).rejects.toThrow(/did not report[\s\S]*LOCKED[\s\S]*120ms/)
    expect(child.kill).toHaveBeenCalled()
  })

  it('握手需要跨块拼接时也能完成（旧实现在此永久挂起）', async () => {
    const child = fakeChild()
    const pending = holdExclusiveWindowsFileLock('D:/tmp/.masterkey', 180, {
      spawnImpl: () => child,
      handshakeTimeoutMs: 1000,
    })
    child.stdout.emit('data', 'LOC')
    child.stdout.emit('data', 'KED\r\n')

    await expect(Promise.race([
      pending.then(() => 'resolved'),
      new Promise((resolve) => setTimeout(() => resolve('still-pending'), 120)),
    ])).resolves.toBe('resolved')
  })

  it('子进程在锁定前退出时，错误必须带上 stderr 原文', async () => {
    const child = fakeChild()
    const pending = holdExclusiveWindowsFileLock('D:/tmp/.masterkey', 180, {
      spawnImpl: () => child,
      handshakeTimeoutMs: 1000,
    })
    child.stderr.emit('data', 'Open : Cannot find file')
    child.emit('exit', 1)

    await expect(pending).rejects.toThrow(/before locking the file[\s\S]*Cannot find file/)
  })

  it('锁未释放时 release() 必须在预算内失败（不得让用例裸挂）', async () => {
    const child = fakeChild()
    const pending = holdExclusiveWindowsFileLock('D:/tmp/.masterkey', 180, {
      spawnImpl: () => child,
      handshakeTimeoutMs: 1000,
      releaseTimeoutMs: 120,
    })
    child.stdout.emit('data', 'LOCKED')
    const fileLock = await pending

    await expect(fileLock.release()).rejects.toThrow(/was not released within 120ms/)
  })

  it('无人 await exitPromise 时也不得产生 unhandledRejection', async () => {
    const onRejection = vi.fn()
    process.on('unhandledRejection', onRejection)
    try {
      const child = fakeChild()
      const pending = holdExclusiveWindowsFileLock('D:/tmp/.masterkey', 180, {
        spawnImpl: () => child,
        handshakeTimeoutMs: 1000,
      })
      child.stdout.emit('data', 'LOCKED')
      await pending
      // 子进程非零退出，而没有任何调用方 await 过 exitPromise
      child.emit('exit', 3)
      await new Promise((resolve) => setImmediate(resolve))
      await new Promise((resolve) => setTimeout(resolve, 40))
      expect(onRejection).not.toHaveBeenCalled()
    } finally {
      process.off('unhandledRejection', onRejection)
    }
  })

  it('真跑一次（仅 Windows）：握手在预算内完成，holdMs 后句柄释放', async () => {
    if (process.platform !== 'win32') return
    const fs = await import('node:fs')
    const os = await import('node:os')
    const path = await import('node:path')
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mp-win-lock-'))
    const file = path.join(dir, '.masterkey')
    fs.writeFileSync(file, 'legacy', 'utf8')
    try {
      const started = Date.now()
      const fileLock = await holdExclusiveWindowsFileLock(file, 120)
      expect(Date.now() - started).toBeLessThan(15000)
      await fileLock.release()
      expect(Date.now() - started).toBeGreaterThanOrEqual(100)
      // 句柄已 Dispose：文件内容原样可读回
      expect(fs.readFileSync(file, 'utf8')).toBe('legacy')
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  }, 30000)
})
