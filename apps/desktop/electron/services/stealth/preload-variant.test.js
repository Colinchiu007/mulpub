// @ts-check
/**
 * stealth-preload-variant.test.js — RPA 窗口 preload 变体选择契约（PRD §3.1 kill-switch）
 *
 * 契约：
 * 1. 高风控平台（douyin/xiaohongshu/shipinhao）→ enhanced 变体（主世界注入）
 * 2. 其他平台/未知平台 → baseline 变体（现状）
 * 3. 映射表不可用（require 失败）→ **fail-closed 回落 baseline** 且 warn 出声（禁静默升级）
 * 4. 映射表改配置即切换（kill-switch = 改 JSON 一行，无需回滚代码）
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

__enableElectronMock()

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
  it('高风控平台 → enhanced', () => {
    const host = makeHost()
    expect(host._resolvePreloadPath('douyin')).toMatch(/stealth-preload-enhanced\.js$/)
    expect(host._resolvePreloadPath('xiaohongshu')).toMatch(/stealth-preload-enhanced\.js$/)
    expect(host._resolvePreloadPath('shipinhao')).toMatch(/stealth-preload-enhanced\.js$/)
  })

  it('其他平台与未知平台 → baseline（现状路径）', () => {
    const host = makeHost()
    expect(host._resolvePreloadPath('bilibili')).toMatch(/stealth-preload\.js$/)
    expect(host._resolvePreloadPath('weibo')).toMatch(/stealth-preload\.js$/)
    expect(host._resolvePreloadPath('no-such-platform')).toMatch(/stealth-preload\.js$/)
    expect(host._resolvePreloadPath(undefined)).toMatch(/stealth-preload\.js$/)
  })

  it('kill-switch：改 JSON 映射即切换（无需改代码）', () => {
    // 直接改注册表数据后重新 require（vi.resetModules 已清缓存）
    const pc = require('@multi-publish/shared-utils/src/publish-capabilities.json')
    pc.riskControl.preloadVariant.bilibili = 'enhanced'
    vi.resetModules()
    sessionMixin = require('../rpa-view-session')
    const host = makeHost()
    expect(host._resolvePreloadPath('bilibili')).toMatch(/stealth-preload-enhanced\.js$/)
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
    expect(resolved[0]).toMatch(/stealth-preload-enhanced\.js$/)
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

})
