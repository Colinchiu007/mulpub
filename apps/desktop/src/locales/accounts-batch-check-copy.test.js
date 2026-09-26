// @ts-check
/**
 * 「一键检测」汇总文案的精确结构断言（AGENTS.md QM-3 文本结构断言 MUST）。
 *
 * 为什么单独立一个文件而不是只靠组件测试：文案是函数拼接（含条件段），组件测试里
 * 只用 toContain 级别的存在性断言对「段落丢失 / 段序错乱 / 空段」完全免疫。
 * 本文件对 zh / en 各自断言整句字面量，覆盖 unconfirmed 为 0 与 >0 两种形态。
 */
import { describe, expect, it } from 'vitest'
import zh from './zh.js'
import en from './en.js'

function render (fn, params) {
  const named = (k) => params[k]
  return fn({ named })
}

describe('accountsPage.batchCheckAllDone 文案结构', () => {
  it('中文：含未定论段时整句精确匹配，且措辞明确「保持原状态」', () => {
    expect(render(zh.accountsPage.batchCheckAllDone, { valid: 5, invalid: 1, unconfirmed: 2 }))
      .toBe('检测完成：5 个正常，1 个失效，2 个未取到定论（保持原状态）')
  })

  it('中文：unconfirmed 为 0 时整段不出现（不留悬空逗号）', () => {
    expect(render(zh.accountsPage.batchCheckAllDone, { valid: 6, invalid: 1, unconfirmed: 0 }))
      .toBe('检测完成：6 个正常，1 个失效')
  })

  it('英文：与中文同结构，措辞含 status kept', () => {
    expect(render(en.accountsPage.batchCheckAllDone, { valid: 5, invalid: 1, unconfirmed: 2 }))
      .toBe('Check complete: 5 valid, 1 expired, 2 unresolved (status kept)')
    expect(render(en.accountsPage.batchCheckAllDone, { valid: 6, invalid: 1, unconfirmed: 0 }))
      .toBe('Check complete: 6 valid, 1 expired')
  })

  it('zh / en 条件段必须同时存在或同时缺席（防成对漂移）', () => {
    const withUnresolved = (lang) => render(lang.accountsPage.batchCheckAllDone, { valid: 1, invalid: 0, unconfirmed: 1 })
    const without = (lang) => render(lang.accountsPage.batchCheckAllDone, { valid: 1, invalid: 0, unconfirmed: 0 })
    expect(withUnresolved(zh)).not.toBe(without(zh))
    expect(withUnresolved(en)).not.toBe(without(en))
  })
})
