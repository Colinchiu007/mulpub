// @ts-check
/**
 * stealth-preload-variant.test.js — RPA 窗口 preload 变体选择契约（PRD §3.1 kill-switch）
 *
 * 契约：
 * 1. 高风控平台（douyin/xiaohongshu/shipinhao）→ enhanced 变体（主世界注入）
 * 2. 其他平台/未知平台 → baseline 变体（现状）
 * 3. 映射表不可用（require 失败）→ **fail-closed 回落 baseline** 且 warn 出声（禁静默升级）
 * 4. 映射表改配置即切换（kill-switch = 改 JSON 一行，无需回滚代码）
 * 5. enhanced 路径必须**真实存在且为 esbuild bundle**（QM-6 Critical：路径字符串对 ≠
 *    文件存在——Electron 遇到不存在的 preload 不报错、只是不加载，静默连 baseline 一起丢）
 * 6. enhanced bundle 缺失 → fail-closed 回落 baseline + warn 出声（禁静默返回不存在的路径）
 * 7. bundle 契约：evasions 必须已内联（sandbox preload 的 require 是受限 polyfill、
 *    不支持相对文件——残留相对 require = evasions 全跳仍标 INJ_DONE 的三态假成功，
 *    QM-6 Warning-2）
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

__enableElectronMock()

// 模块作用域注册一次（warnSpy 身份跨用例稳定——AGENTS「日志类锁」条：beforeEach 只 clearAllMocks 清计数）
const warnSpy = vi.fn()
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

/** 构造带 _resolvePreloadPath 的最小宿主（复用 mixin 原型方法） */
function makeHost () {
  return Object.assign(Object.create(sessionMixin), {})
}

describe('RPA preload 变体选择（PRD-OSS-RPA-HARDENING §3.1）', () => {
  it('高风控平台 → enhanced bundle（路径真实存在——QM-6 Critical 回归锁）', () => {
    const host = makeHost()
    const fs = require('fs')
    for (const p of ['douyin', 'xiaohongshu', 'shipinhao']) {
      const resolved = host._resolvePreloadPath(p)
      expect(resolved).toMatch(/stealth-preload-enhanced\.bundle\.js$/)
      // 字符串断言之外必须验存在性：不存在的 preload 被 Electron 静默跳过（不报错）
      expect(fs.existsSync(resolved)).toBe(true)
    }
  })

  it('其他平台与未知平台 → baseline（现状路径，文件真实存在）', () => {
    const host = makeHost()
    const fs = require('fs')
    for (const p of ['bilibili', 'weibo', 'no-such-platform', undefined]) {
      const resolved = host._resolvePreloadPath(p)
      expect(resolved).toMatch(/stealth-preload\.js$/)
      expect(fs.existsSync(resolved)).toBe(true)
    }
  })

  it('kill-switch：改 JSON 映射即切换（无需改代码）', () => {
    // 直接改注册表数据后重新 require（vi.resetModules 已清缓存）
    const pc = require('@multi-publish/shared-utils/src/publish-capabilities.json')
    pc.riskControl.preloadVariant.bilibili = 'enhanced'
    vi.resetModules()
    sessionMixin = require('../rpa-view-session')
    const host = makeHost()
    expect(host._resolvePreloadPath('bilibili')).toMatch(/stealth-preload-enhanced\.bundle\.js$/)
    pc.riskControl.preloadVariant.bilibili = undefined
    delete pc.riskControl.preloadVariant.bilibili
  })

  it('接线断点回归锁：_acquireWindow 必须把 platform 传给 _createWindow（否则 _resolvePreloadPath(undefined) 恒选 baseline，增强 preload 静默永不生效）', () => {
    const host = makeHost()
    const spy = vi.fn(() => ({ webContents: {} }))
    host._createWindow = spy
    const r = host._acquireWindow('douyin', 'acc-1')
    expect(r.reused).toBe(false)
    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy.mock.calls[0][0]).toBe('persist:rpa-douyin-acc-1')
    // 关键断言：platform 必须作为第 2 参传入（修复前缺省 → 恒 baseline）
    expect(spy.mock.calls[0][1]).toBe('douyin')
  })

  it('接线断点回归锁（增强平台端到端）：_acquireWindow 平台为 douyin 时 _resolvePreloadPath 解析为 enhanced', () => {
    const host = makeHost()
    const resolved = []
    const origResolve = host._resolvePreloadPath.bind(host)
    host._createWindow = vi.fn(function (partition, platform) {
      resolved.push(origResolve(platform))
      return { webContents: {} }
    })
    host._acquireWindow('douyin', 'acc-2')
    expect(resolved).toHaveLength(1)
    expect(resolved[0]).toMatch(/stealth-preload-enhanced\.bundle\.js$/)
    expect(require('fs').existsSync(resolved[0])).toBe(true)
  })

  it('任务 2.6：baseline stealth-preload.js 头注如实声明语义并指向增强版（防错误声明回退）', () => {
    const fs = require('fs')
    const path = require('path')
    const src = fs.readFileSync(path.join(__dirname, '../../stealth-preload.js'), 'utf8')
    const head = src.slice(0, src.indexOf('*/') + 2)
    // spike E4b 实证：contextIsolation 下 sandbox preload 的 patch 不达主世界，
    // 旧头注「在页面 JS 执行前注入反检测脚本 / 等价 addInitScript」是错误声明
    expect(head).not.toMatch(/等价于 Playwright 的 context\.addInitScript/)
    expect(head).not.toMatch(/在页面 JS 执行前注入反检测脚本/)
    // 必须如实声明真实语义（patch 落隔离世界、主世界不可见）
    expect(head).toMatch(/隔离世界/)
    expect(head).toMatch(/主世界不可见|不达主世界/)
    // 必须指向增强版（主世界注入的唯一入口）
    expect(head).toMatch(/stealth-preload-enhanced/)
  })

  it('enhanced bundle 契约：evasions 已内联 + 三态 marker 齐全（QM-6 Warning-2 回归锁）', () => {
    const fs = require('fs')
    const path = require('path')
    const host = makeHost()
    const bundlePath = host._resolvePreloadPath('douyin')
    const bundleSrc = fs.readFileSync(bundlePath, 'utf8')
    // 主进程三态读回依赖的 marker（start/done）
    expect(bundleSrc).toContain('__mpStealthInjStart')
    expect(bundleSrc).toContain('__mpStealthInjDone')
    // 2026-10-15 收敛：**不得**再内联 vendored 的任何一条 evasion 代码
    // （真机对照见 01-docs/evidence/zhihu-stealth-mainworld-2026-10-15/）。
    // ⚠️ 判据必须是「evasion 的 code 不在 bundle 里」，不能只查名字：源码里有一份
    // `DISABLED_VENDORED_EVASIONS` 停用清单，它按设计**含有**这些名字字符串——
    // 查名字会把"已停用"误判成"仍启用"（本轮实测踩过，见 20:40 的失败）。
    const vendored = require(require('node:path').join(__dirname, 'evasions-bundle.js'))
    for (const [name, entry] of Object.entries(vendored.evasions)) {
      expect(bundleSrc, `vendored evasion 仍被内联: ${name}`).not.toContain(entry.code)
    }
    // 实测确认不一致的 4 项必须真的被打进 bundle（否则内联失败 ⇒ 运行时静默无补丁）
    expect(bundleSrc).toContain('loadTimes')
    expect(bundleSrc).toContain('Google Chrome')
    // 残留相对 require = sandbox 运行时必失败 → bundle=null → evasions 全跳仍标 INJ_DONE 假成功
    expect(bundleSrc).not.toMatch(/require\(["']\.\/evasions-bundle/)
    expect(bundleSrc, '实测清单的相对 require 也必须已被内联').not.toMatch(/require\(["'][^"']*\bstealth\b["']\)/)
    // 源文件保持单一来源引用（构建期由 esbuild 内联，运行时不经 require）
    const srcPath = path.join(__dirname, 'stealth-preload-enhanced.js')
    expect(fs.readFileSync(srcPath, 'utf8')).toContain("require('../../stealth')")
  })

  it('enhanced bundle 缺失 → fail-closed 回落 baseline + warn 出声（禁静默返回不存在的路径）', () => {
    const fsModule = require('fs')
    const realExists = fsModule.existsSync
    // 按路径分域：只让 enhanced bundle 路径为假，全盘 false 会打断模块加载（AGENTS mock 纪律）
    const spy = vi.spyOn(fsModule, 'existsSync').mockImplementation((p) => {
      if (String(p).endsWith('stealth-preload-enhanced.bundle.js')) return false
      return realExists(p)
    })
    try {
      const host = makeHost()
      const resolved = host._resolvePreloadPath('douyin')
      expect(resolved).toMatch(/stealth-preload\.js$/)
      expect(resolved).not.toMatch(/enhanced/)
      expect(realExists(resolved)).toBe(true)
      expect(warnSpy).toHaveBeenCalledTimes(1)
      const [tag, msg] = warnSpy.mock.calls[0]
      expect(tag).toBe('RpaView')
      expect(msg).toContain('fallback baseline')
      expect(msg).toContain('douyin')
    } finally {
      spy.mockRestore()
    }
  })

})
