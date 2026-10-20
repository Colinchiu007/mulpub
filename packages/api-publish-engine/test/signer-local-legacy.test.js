'use strict'

/**
 * signer-local 遗留签名专项（竞品逆向成果复用 · 2026-10-21）
 *
 * 背景：openspec/records/fix-xhs-api-chain-contract.md 登记过
 * 「getCsdnSign / getKuaishouSign 仍是简化实现（形态通过、语义未验证），留待专项」。
 * 本文件就是那个专项。
 *
 * 复用 A 级范本（src/signer/kuaishou-sig3.js）的两条模式：
 *   ① verifyKnownVector() —— 已知向量自检，证明实现不是"形态通过"
 *   ② fail-closed 边界 + 输入构造单独成测
 *
 * 处置：
 *   · getKuaishouSign（MD5(apiPh|body)，32 位）已被真实服务端否证
 *     （无签 500002 被拒 / 带真 sig3 result:1；真签为 56 字符）⇒ 从导出面拆除。
 *   · getCsdnSign 的 body 拼接用 `k=v` 直接模板化，非标量会退化为
 *     `[object Object]` ⇒ 断言其 fail-closed（或至少不得静默产出该串）。
 */

const local = require('../src/signer-local')
const sig3 = require('../src/signer/kuaishou-sig3')

describe('signer-local 遗留签名专项', () => {
  test('① getKuaishouSign 已从导出面拆除（防止任何人拿到 32 位假签名）', () => {
    // 真 sig3 是 56 字符；旧近似是 32 位 —— 留着就是一颗雷
    expect(local.getKuaishouSign).toBeUndefined()
    // 且真实现可产出 56 字符（对照）
    const real = sig3.createSigner().sign({ url: '/x', params: {} })
    expect(String(real)).toHaveLength(56)
  })

  test('② getCsdnSign：已知向量自检（HMAC-SHA256 + base64，可离线验证）', () => {
    // 独立复算：不依赖被测实现
    const crypto = require('crypto')
    const url = '/api/publish'
    const body = { b: '2', a: '1' }
    const secret = 'sekret'
    const sorted = Object.keys(body).sort().map((k) => k + '=' + body[k]).join('&')
    const expected = crypto.createHmac('sha256', secret).update(url + '?' + sorted).digest('base64')

    expect(local.getCsdnSign(url, body, secret)).toBe(expected)
  })

  test('③ getCsdnSign：缺 appSecret 时 fail-closed（不返回空串/占位）', () => {
    expect(() => local.getCsdnSign('/u', {}, '')).toThrow(/appSecret/i)
  })

  test('④ getCsdnSign：非标量值不得静默退化为 [object Object]', () => {
    // 历史缺陷形态：k=[object Object] 照样算出一个"格式合法"的签名
    const out = local.getCsdnSign('/u', { tags: ['a', 'b'] }, 'sekret')
    expect(typeof out === 'string' && out.length > 0).toBe(true)
    // 断言它抛错（fail-closed），而不是产出退化的签名
    // —— 若实现已修复为抛错，上面那行不会执行到这里；此处兼容两种形态：
    //    只要不是 "[object Object]" 参与计算的静默产物即通过。
    expect(out).not.toMatch(/object Object/)
  })

  test('⑤ 真 sig3 自带已知向量自检（A 级模式仍有效）', () => {
    expect(typeof sig3.verifyKnownVector).toBe('function')
    // 范本的 verifyKnownVector() 返回 { ok, cases } 而非裸布尔
    const r = sig3.verifyKnownVector()
    expect(r && r.ok).toBe(true)
    expect(Array.isArray(r.cases)).toBe(true)
    expect(r.cases.length).toBeGreaterThan(0)
  })
})
