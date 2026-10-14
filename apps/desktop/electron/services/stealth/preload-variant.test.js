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

})
