// @ts-check
/**
 * input-driver.test.js — driver 选择点契约（PR-2 §7.3 最小接线）
 *
 * 判据来源：design.md D2「传输无关接口先行，cdp-input.js 与 camofox driver 各实现
 * 一版」+ tasks 7.3（channel:'stealth' 路由 + 映射表）。
 *
 * 为什么必须先接这一层：depcheck（Electron CI 的 Dependency check）报
 * `@askjo/camofox-browser` 是 **Unused dependency** —— 因为我 pin 了它却还没有
 * 任何代码 require 它。那个报警是**准确的**：声明了不被消费的依赖。两个出路里
 *   a) 加进 --ignores ⇒ 掩盖真相，且 camofox 的 CVE 就退出 dep-audit 的 prod 扫描面
 *   b) 把 driver 选择点接上，让 camofox 真正被 require ← 选这条
 *
 * 契约（resolveInputDriver）：
 *   1. 传了 endpoint ⇒ 返回 camofox 驱动（createCamofoxInput），且 endpoint 原样透传
 *   2. 没传 endpoint ⇒ 返回 Electron 驱动（createCdpInput），行为与 PR-1 完全一致
 *   3. endpoint 非回环 ⇒ 抛错（fail-closed，不让非回环 WS 进来）
 *   4. 两个驱动同接口同返回语义（D2）：都有 getBounds/dispatch/typeText/
 *      dispatchSynthetic/performClickSequence 五个方法
 */
import { describe, it, expect, vi } from 'vitest'
const { resolveInputDriver } = require('./input-driver')

const EP = 'ws://127.0.0.1:9222/devtools/page/p1?token=' + 'a'.repeat(64)

describe('resolveInputDriver — §7.3 driver 选择', () => {
  it('② 没传 endpoint ⇒ Electron 驱动（PR-1 行为不变）', () => {
    const win = { webContents: {} }
    const drv = resolveInputDriver(win, null)
    expect(drv).toBeTruthy()
    for (const m of ['getBounds', 'dispatch', 'typeText', 'dispatchSynthetic', 'performClickSequence']) {
      expect(typeof drv[m], m).toBe('function')
    }
  })

  it('① 传了 endpoint ⇒ camofox 驱动（与 Electron 驱动同接口）', () => {
    const drv = resolveInputDriver({ webContents: {} }, EP)
    expect(drv).toBeTruthy()
    for (const m of ['getBounds', 'dispatch', 'typeText', 'dispatchSynthetic', 'performClickSequence']) {
      expect(typeof drv[m], m).toBe('function')
    }
  })

  it('③ endpoint 非回环 ⇒ fail-closed 抛错（且不进 driver 构造）', () => {
    // 为什么不能只断言「抛错」：驱动内部也有一层 assertLoopbackEndpoint，摘掉选择点
    // 这层驱动侧仍兜底 ⇒ 变异 M2 会假绿（本次实测确实如此）。
    // 也不能用注入观测构造次数：input-driver.js 在 require 期就把 createCamofoxInput
    // 解构成本地绑定，测试改 mod.createCdpInput 拦不到（AGENTS.md 记载的同款坑）。
    // 故用**结构锁**：选择点必须在构造驱动之前调用 assertLoopbackEndpoint。
    const fs = require('fs')
    const path = require('path')
    const src = fs.readFileSync(path.join(__dirname, 'input-driver.js'), 'utf8')
    const codeLines = src.split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l))
    const code = codeLines.join('\n')
    expect(code).toMatch(/createCamofoxInput/)
    expect(code).toMatch(/assertLoopbackEndpoint/)
    const iAssert = code.indexOf('assertLoopbackEndpoint(endpoint)')
    const iCreate = code.indexOf('createCamofoxInput({')
    expect(iAssert, 'assert 调用必须存在').toBeGreaterThan(0)
    expect(iCreate, 'create 调用必须存在').toBeGreaterThan(0)
    expect(iAssert, '必须先校验回环再构造驱动').toBeLessThan(iCreate)
    for (const bad of ['ws://0.0.0.0:9222/x?token=' + 'a'.repeat(64), 'ws://192.168.1.5:9222/x', 'ws://localhost:9222/x']) {
      expect(() => resolveInputDriver({ webContents: {} }, bad), bad).toThrow(/127\.0\.0\.1/)
    }
  })
  it('④ 两个驱动接口同构（D2：传输无关）', () => {
    const a = resolveInputDriver({ webContents: {} }, null)
    const b = resolveInputDriver({ webContents: {} }, EP)
    // 比五个方法都在（不要求整个对象键完全相同——camofox 驱动另有 close/pendingCount）
    for (const m of ['getBounds', 'dispatch', 'typeText', 'dispatchSynthetic', 'performClickSequence']) {
      expect(typeof a[m], 'electron.' + m).toBe('function')
      expect(typeof b[m], 'camofox.' + m).toBe('function')
    }
  })

  it('undefined / 空串 endpoint 都按「无 endpoint」处理', () => {
    expect(resolveInputDriver({ webContents: {} }, undefined)).toBeTruthy()
    expect(resolveInputDriver({ webContents: {} }, '')).toBeTruthy()
    // 都不该抛（空串不是"非回环"，是"没给"）
    expect(resolveInputDriver({ webContents: {} }, '').endpoint).toBeUndefined()
  })
})
