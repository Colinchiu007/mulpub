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

  // ⚠ 2026-10-23 验证层外部评审后自查发现（与 claude i3 / codex i6 同族的**档位误导**）：
  //   走到这一步时**锁已经被自动清掉了**、目标 kit 在位 ⇒ **没有任何残留要用户动手**。
  //   初版审计行写 `FAIL_WITH_RECOVERY` + `LOCK_LEFT`（「手动删除锁文件」）
  //   ⇒ 指引指向一个**已经不存在**的文件。
  it('过期锁自愈的审计行：postCheck=PASS、**无**残留档位（锁已被清掉）', () => {
    const ud = tmpUserData()
    createLock({ userDataDir: ud })
    const old = new Date(Date.now() - (LEASE_MS + 5000))
    fs.utimesSync(lockPathOf(ud), old, old)
    const svc = new FilmEngineeringService({ kitDir: ud, userDataKitDir: path.join(ud, 'film-kit'), log })
    expect(svc.getImportState().inProgress).toBe(false)
    const auditFile = path.join(ud, 'film-kit-import.log')
    expect(fs.existsSync(auditFile)).toBe(true)
    const row = fs.readFileSync(auditFile, 'utf8').split('\n').filter(Boolean).pop()
    const cols = row.split('\t')
    expect(cols.length).toBe(10)
    expect(cols[8]).toBe('-') // recovery_state 为空（无残留）
    expect(cols[9]).toBe('-') // 恢复路径为空
    expect(cols[7]).toBe('PASS') // post_check
  })

  // ⚠ 2026-10-23 验证层外部评审（claude i2）命中：崩在 ④ 后 ⑤ 前
  //   （`film-kit` 缺失、`.bak` = 旧 kit）时，初版**直接返回** ⇒ 既没有审计痕迹、
  //   也没有恢复路径 ⇒ 用户只看到「导入进行中」。
  it('崩溃残留且目标 kit 缺失 ⇒ 留一行 MISSING_KIT 审计（含 .bak 路径），且**保持阻塞**', () => {
    const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'film-svc-miss-'))
    fs.mkdirSync(path.join(ud, 'film-kit.bak-old'), { recursive: true })
    // 目标 kit 缺失（崩在 ④ 后 ⑤ 前）
    const svc = new FilmEngineeringService({ kitDir: ud, userDataKitDir: path.join(ud, 'film-kit'), log })
    createLock({ userDataDir: ud })
    const old = new Date(Date.now() - (LEASE_MS + 5000))
    fs.utimesSync(lockPathOf(ud), old, old)
    const svc2 = new FilmEngineeringService({ kitDir: ud, userDataKitDir: path.join(ud, 'film-kit'), log })
    // 仍然阻塞（不静默回落到随包 min 版）
    expect(svc2.getImportState().inProgress).toBe(true)
    const auditFile = path.join(ud, 'film-kit-import.log')
    expect(fs.existsSync(auditFile)).toBe(true)
    const row = fs.readFileSync(auditFile, 'utf8').split('\n').filter(Boolean).pop()
    const cols = row.split('\t')
    expect(cols[8]).toBe('MISSING_KIT')
    expect(cols[9]).toContain('film-kit.bak-old')
    expect(svc).toBeTruthy()
  })
})
