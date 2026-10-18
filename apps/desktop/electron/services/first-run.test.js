/**
 * first-run 引导标记锁（UX-AUDIT 阶段 1.4 / audit-4）
 *
 * 现场事实（修复前）：`runSetup` 在每次启动**无条件**写 `first-run-done`，
 * 于是渲染进程问 `first-run:check` 时永远是 true，`/first-run` 向导因此零入口
 * ——「全新 userData 首启进向导」这条要求在机械上不可能成立。
 *
 * 本锁锁三件事：
 *   ① 模块**不再暴露 runSetup**（写盘的唯一历史路径已从启动流程移除）；
 *   ② 写盘只有 `markDone()` 一个出口，且失败如实回报而不抛；
 *   ③ 标记、`isSetupDone`、`checkDeps` 三者始终同源。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mp-first-run-'))
const userData = path.join(baseDir, 'profile')

__registerMock('./logger', { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })
__registerMock('electron', {
  app: { getPath: () => userData },
})

const firstRun = require('./first-run')

function markerFile () {
  return path.join(userData, 'first-run-done')
}

describe('first-run 引导标记', () => {
  beforeEach(() => {
    fs.rmSync(baseDir, { recursive: true, force: true })
    fs.mkdirSync(userData, { recursive: true })
    vi.mocked(require('./logger').info).mockClear()
    vi.mocked(require('./logger').error).mockClear()
  })

  afterEach(() => {
    fs.rmSync(baseDir, { recursive: true, force: true })
  })

  it('启动流程不再有写点：runSetup 已随推送通道一起删除', () => {
    // 保留这条墓碑：把它加回来 = 重新制造"每次启动都标记已引导"的那个 Bug
    expect(firstRun.runSetup, 'first-run.js 不得再导出 runSetup').toBeUndefined()
    expect(Object.keys(firstRun).sort()).toEqual(['checkDeps', 'isSetupDone', 'markDone', 'reset'])
  })

  it('全新 userData 上标记不存在，checkDeps 如实报未引导', () => {
    expect(firstRun.isSetupDone()).toBe(false)
    expect(firstRun.checkDeps()).toEqual({ setupDone: false })
    expect(fs.existsSync(markerFile())).toBe(false)
  })

  it('markDone 是唯一写点：写成功后 isSetupDone 与 checkDeps 同步转真', () => {
    expect(firstRun.markDone()).toEqual({ done: true })
    expect(fs.readFileSync(markerFile(), 'utf8')).toMatch(/^done:20\d\d-/)
    expect(firstRun.isSetupDone()).toBe(true)
    expect(firstRun.checkDeps()).toEqual({ setupDone: true })
    expect(require('./logger').info).toHaveBeenCalledWith('firstRun', 'Onboarding acknowledged')
  })

  it('重复确认幂等：第二次写只是刷新时间戳，不产生第二个标记', () => {
    firstRun.markDone()
    const first = fs.readFileSync(markerFile(), 'utf8')
    expect(firstRun.markDone()).toEqual({ done: true })
    expect(fs.existsSync(markerFile())).toBe(true)
    expect(fs.readFileSync(markerFile(), 'utf8').length).toBe(first.length)
  })

  it('写失败如实回报 done:false 且不抛（调用方不得把失败读成"用户已看过引导"）', () => {
    fs.mkdirSync(markerFile()) // 占位目录 ⇒ writeFileSync 抛 EISDIR
    const res = firstRun.markDone()
    expect(res.done).toBe(false)
    expect(typeof res.error).toBe('string')
    expect(res.error.length).toBeGreaterThan(0)
    expect(require('./logger').error).toHaveBeenCalledWith(
      'firstRun',
      expect.stringContaining('Failed to write first-run marker'),
      res.error,
    )
  })

  it('reset 清掉标记后重新回到未引导（排障与测试的回退口）', () => {
    firstRun.markDone()
    firstRun.reset()
    expect(firstRun.isSetupDone()).toBe(false)
    expect(firstRun.checkDeps()).toEqual({ setupDone: false })
    // reset 对不存在的标记不应抛
    expect(() => firstRun.reset()).not.toThrow()
  })
})
