import { describe, it, expect } from 'vitest'

const capsPath = new URL('./login-check-capabilities.js', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const { deriveCapabilities, hasActionableCapability, CAPABILITY_IDS, CAPABILITY_DENY_SIGNALS } = await import(capsPath)

describe('login-check-capabilities 能力级授权契约', () => {
  it('无任何证据 ⇒ 两项能力全 unknown（绝不猜 granted/revoked）', () => {
    expect(deriveCapabilities({})).toEqual({ dataRead: 'unknown', commentInteract: 'unknown' })
    expect(deriveCapabilities(null)).toEqual({ dataRead: 'unknown', commentInteract: 'unknown' })
    expect(deriveCapabilities({ code: 'CHECK_LOGIN_SUCCESS' })).toEqual({ dataRead: 'unknown', commentInteract: 'unknown' })
  })

  it('上游明确判定 ⇒ 原样采纳', () => {
    const out = deriveCapabilities({ capabilities: { dataRead: 'granted', commentInteract: 'revoked' } })
    expect(out).toEqual({ dataRead: 'granted', commentInteract: 'revoked' })
  })

  it('上游给了非法值 ⇒ 回落 unknown（不接受 unknown 之外的第四态）', () => {
    const out = deriveCapabilities({ capabilities: { dataRead: 'maybe', commentInteract: 1 } })
    expect(out).toEqual({ dataRead: 'unknown', commentInteract: 'unknown' })
  })

  it('平台明确拒绝的错误码 ⇒ revoked（对齐参考产品B 100437=无法取私密数据）', () => {
    const out = deriveCapabilities({ errorCode: '100437' })
    expect(out.dataRead).toBe('revoked')
    expect(out.commentInteract).toBe('unknown')
  })

  it('错误码为数字也认（平台可能给 number）', () => {
    expect(deriveCapabilities({ errorCode: 100437 }).dataRead).toBe('revoked')
  })

  it('已 granted 的能力不被错误码降级（显式判定优先于推断）', () => {
    const out = deriveCapabilities({ capabilities: { dataRead: 'granted' }, errorCode: '100437' })
    expect(out.dataRead).toBe('granted')
  })

  it('只有 granted/revoked 才值得在 UI 展示（避免满屏 unknown 噪声）', () => {
    expect(hasActionableCapability({ dataRead: 'unknown', commentInteract: 'unknown' })).toBe(false)
    expect(hasActionableCapability({ dataRead: 'granted', commentInteract: 'unknown' })).toBe(true)
    expect(hasActionableCapability({ dataRead: 'unknown', commentInteract: 'revoked' })).toBe(true)
    expect(hasActionableCapability(null)).toBe(false)
  })

  it('能力清单与拒绝信号表必须双向对齐（表里出现清单外 id 即红）', () => {
    for (const id of Object.keys(CAPABILITY_DENY_SIGNALS)) {
      expect(CAPABILITY_IDS).toContain(id)
    }
    for (const id of CAPABILITY_IDS) {
      expect(Array.isArray(CAPABILITY_DENY_SIGNALS[id])).toBe(true)
    }
  })
})
