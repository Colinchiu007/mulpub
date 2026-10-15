// @ts-check
/**
 * preload-variant-failclosed.test.js — 映射表不可用时的 fail-closed 契约
 *
 * 拦截机制：test-setup.js 的 Module._load 拦截 + __registerMock。
 * ⚠️ vi.mock 在此无效——`_resolvePreloadPath` 里的
 * `require('@multi-publish/shared-utils/src/publish-capabilities')` 是
 * CJS 运行时 lazy require，不经过 vitest 的 ESM 模块图；必须用
 * mockRegistry 按原始 request 字符串在 _load 层拦截。
 *
 * 契约（PRD §3.1 / AGENTS「兜底选址 fail-closed」同族纪律）：
 * 1. 注册表在调用时抛错（模拟损坏/版本不兼容）→ 回落 baseline，不抛
 * 2. 高风控平台同样回落 baseline（禁静默升级到 enhanced）
 * 3. warn 必须出声（记录 fallback 事实，禁止吞掉）
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

__enableElectronMock()

// 模块作用域注册一次（对象身份跨用例稳定；beforeEach 只 clearAllMocks 清计数，
// 避免「每轮新建 spy ⇒ require 期冻结的绑定抓不到」的假绿，见 AGENTS「日志类锁」条）
const warnSpy = vi.fn()
__registerMock('@multi-publish/shared-utils/src/publish-capabilities', {
  getPreloadVariant: () => { throw new Error('registry down (simulated)') },
})
__registerMock('./logger', {
  debug: vi.fn(),
  info: vi.fn(),
  warn: warnSpy,
  error: vi.fn(),
})

let sessionMixin

beforeEach(async () => {
  vi.clearAllMocks()
  vi.resetModules()
  sessionMixin = require('../rpa-view-session')
})

describe('preload 变体 fail-closed（注册表不可用）', () => {
  it('高风控平台也回落 baseline 且不抛', () => {
    const host = Object.create(sessionMixin)
    let p
    expect(() => { p = host._resolvePreloadPath('douyin') }).not.toThrow()
    expect(p).toMatch(/stealth-preload\.js$/)
    expect(p).not.toMatch(/enhanced/)
  })

  it('未知平台同样回落 baseline', () => {
    const host = Object.create(sessionMixin)
    expect(host._resolvePreloadPath('???')).toMatch(/stealth-preload\.js$/)
  })

  it('fallback 时 warn 出声（禁止静默吞掉）', () => {
    const host = Object.create(sessionMixin)
    host._resolvePreloadPath('douyin')
    expect(warnSpy).toHaveBeenCalledTimes(1)
    const [tag, msg] = warnSpy.mock.calls[0]
    expect(tag).toBe('RpaView')
    expect(msg).toContain('fallback baseline')
    expect(msg).toContain('douyin')
    expect(msg).toContain('registry down (simulated)')
  })
})
