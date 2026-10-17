// @ts-check
/**
 * publish-capabilities 的 F3 通道路由契约（PR-2 §7.3 / §7.4）
 *
 * 判据来源：tasks 7.3（rpa-view-manager channel:'stealth' 路由 + 映射表配置化）
 *           tasks 7.4（RED：路由映射 / 缺省 / sidecar 不可用回落 Electron 通道 + warn，禁静默）
 *           design.md D6（映射表配置化而非硬编码）与 PRD §3.4 评审 FE3
 *           （降级语义：stealthChannelFallback reason 留痕）
 *
 * 契约：
 *  1. 未登记平台 → electron，且 registered=false、fallbackReason=null（缺省 fail-closed）
 *  2. 已登记 + sidecar 可用 → stealth，registered=true、fallbackReason=null
 *  3. 已登记 + sidecar 不可用 → electron，registered=true，
 *     **fallbackReason 非空**（禁静默：调用方必须拿它 warn 并写入发布结果）
 *  4. hostIsUsable 缺省视为可用（不因调用方漏传而误降级）
 *  5. parity：CJS 与 browser 孪生版导出同名同构（AGENTS.md locale 成对同款纪律）
 */
import { describe, it, expect } from 'vitest'
import * as browserModule from '../publish-capabilities.browser.js'

const cjs = require('../publish-capabilities')
const browser = browserModule

const REGISTERED = ['douyin', 'xiaohongshu', 'shipinhao'] // 现 JSON 白名单
const UNREGISTERED = ['weibo', 'bilibili', 'zhihu', 'unknown-platform', '']

describe('resolvePublishChannel — tasks 7.4 路由三态', () => {
  it('① 未登记平台 → electron，registered=false，无 fallbackReason（缺省 fail-closed）', () => {
    for (const p of [...UNREGISTERED, null, undefined]) {
      const r = cjs.resolvePublishChannel(p)
      expect(r.channel, String(p)).toBe('electron')
      expect(r.registered, String(p)).toBe(false)
      expect(r.fallbackReason).toBeNull()
    }
  })

  it('② 已登记 + sidecar 可用 → stealth', () => {
    for (const p of REGISTERED) {
      const r = cjs.resolvePublishChannel(p, { hostIsUsable: true })
      expect(r.channel, p).toBe('stealth')
      expect(r.registered, p).toBe(true)
      expect(r.fallbackReason).toBeNull()
    }
  })

  it('③ 已登记 + sidecar 不可用 → electron 且 fallbackReason 非空（禁静默）', () => {
    for (const p of REGISTERED) {
      const r = cjs.resolvePublishChannel(p, { hostIsUsable: false })
      expect(r.channel, p).toBe('electron')
      expect(r.registered, p).toBe(true)
      // 禁静默：必须给出 reason 供调用方 warn 并写入发布结果
      expect(r.fallbackReason, p).toBe('stealth-channel-unavailable')
    }
  })

  it('④ hostIsUsable 缺省视为可用（不因调用方漏传而误降级）', () => {
    for (const p of REGISTERED) {
      expect(cjs.resolvePublishChannel(p).channel, p).toBe('stealth')
      expect(cjs.resolvePublishChannel(p, {}).channel, p).toBe('stealth')
    }
  })

  it('isStealthChannelPlatform 与 resolvePublishChannel 的 registered 一致', () => {
    for (const p of [...REGISTERED, ...UNREGISTERED]) {
      expect(cjs.resolvePublishChannel(p).registered, p).toBe(cjs.isStealthChannelPlatform(p))
    }
  })
})

describe('parity — CJS 与 browser 孪生同构（AGENTS.md 孪生纪律）', () => {
  it('两个版本导出同名同构', () => {
    const cjsKeys = Object.keys(cjs).sort()
    const bKeys = Object.keys(browser).sort()
    expect(cjsKeys).toEqual(bKeys)
  })

  it('resolvePublishChannel 两侧逐场景同值', () => {
    const cases = [
      ['douyin', undefined],
      ['douyin', { hostIsUsable: true }],
      ['douyin', { hostIsUsable: false }],
      ['weibo', undefined],
      ['weibo', { hostIsUsable: false }],
      [null, undefined],
    ]
    for (const [p, o] of cases) {
      expect(browser.resolvePublishChannel(p, o), p + JSON.stringify(o))
        .toEqual(cjs.resolvePublishChannel(p, o))
    }
  })

  it('isStealthChannelPlatform 两侧逐平台同值', () => {
    for (const p of [...REGISTERED, ...UNREGISTERED, null, undefined]) {
      expect(browser.isStealthChannelPlatform(p), String(p)).toBe(cjs.isStealthChannelPlatform(p))
    }
  })
})
