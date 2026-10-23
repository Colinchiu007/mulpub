// @ts-check
'use strict'
/**
 * FilmEngineeringService · 资产导入相关能力契约测试（PR-3b · F-J）
 *
 * 覆盖：
 *   - `invalidateKitCache()` **同时重置四个字段**（含 `_loadError` 失败缓存 —— 漏重置会让旧失败永久存活）；
 *   - 「导入中」标记 ⇒ `_ensureKit()` 抛**可识别**错误（不静默回落到随包 kit）；
 *   - 构造时读到落盘锁 ⇒ **按锁重建内存标记**（重启不丢标记）；
 *   - 锁租约已过期且目标 kit 在位 ⇒ 自动清锁（不永久卡在「导入中」）。
 */

const fs = require('fs')
const os = require('os')
const path = require('path')

const { FilmEngineeringService } = require('./film-engineering-service')
const { createLock, lockPathOf } = require('./kit-import-lock')
const { LEASE_MS } = require('./kit-import-lock')

const log = { info () {}, warn () {}, error () {}, notify () {} }

function tmpUserData () {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'film-svc-import-'))
  fs.mkdirSync(path.join(dir, 'film-kit'), { recursive: true })
  return dir
}

describe('FilmEngineeringService · 导入标记与缓存失效', () => {
  it('invalidateKitCache 重置四个字段（含 _loadError 失败缓存）', () => {
    const ud = tmpUserData()
    const svc = new FilmEngineeringService({ kitDir: ud, userDataKitDir: path.join(ud, 'film-kit'), log })
    // 造一次失败（kit 目录是空的 ⇒ 读盘失败 ⇒ _loadError 被缓存）
    expect(() => svc._ensureKit()).toThrow()
    expect(svc._loadError).toBeTruthy()
    svc.invalidateKitCache()
    expect(svc._kit).toBe(null)
    expect(svc._loadError).toBe(null)
    expect(svc._shotLibrary).toBe(null)
    expect(svc._scriptAdapter).toBe(null)
  })

  it('导入中 ⇒ _ensureKit 抛可识别错误（不静默回落随包 kit）', () => {
    const ud = tmpUserData()
    const svc = new FilmEngineeringService({ kitDir: ud, userDataKitDir: path.join(ud, 'film-kit'), log })
    svc.setImportInProgress(true)
    expect(svc.getImportState().inProgress).toBe(true)
    let caught = null
    try {
      svc._ensureKit()
    } catch (e) {
      caught = e
    }
    expect(caught).toBeTruthy()
    expect(caught.code).toBe('FILM_KIT_IMPORT_IN_PROGRESS')
    svc.setImportInProgress(false)
    expect(svc.getImportState().inProgress).toBe(false)
  })

  it('构造时读到落盘锁 ⇒ 按锁重建内存标记（重启不丢标记）', () => {
    const ud = tmpUserData()
    createLock({ userDataDir: ud })
    const svc = new FilmEngineeringService({ kitDir: ud, userDataKitDir: path.join(ud, 'film-kit'), log })
    expect(svc.getImportState().inProgress).toBe(true)
    expect(() => svc._ensureKit()).toThrow(/IMPORT_IN_PROGRESS/)
  })

  it('锁租约已过期且目标 kit 在位 ⇒ 自动清锁（不永久卡在导入中）', () => {
    const ud = tmpUserData()
    createLock({ userDataDir: ud })
    const old = new Date(Date.now() - (LEASE_MS + 5000))
    fs.utimesSync(lockPathOf(ud), old, old)
    const svc = new FilmEngineeringService({ kitDir: ud, userDataKitDir: path.join(ud, 'film-kit'), log })
    expect(svc.getImportState().inProgress).toBe(false)
    expect(fs.existsSync(lockPathOf(ud))).toBe(false)
  })

  it('锁租约仍有效 ⇒ 不清锁（可能还有导入在跑）', () => {
    const ud = tmpUserData()
    createLock({ userDataDir: ud })
    const svc = new FilmEngineeringService({ kitDir: ud, userDataKitDir: path.join(ud, 'film-kit'), log })
    expect(svc.getImportState().inProgress).toBe(true)
    expect(fs.existsSync(lockPathOf(ud))).toBe(true)
  })
})
