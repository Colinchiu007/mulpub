// @ts-check
/**
 * 「一键检测」汇总文案的精确结构断言（AGENTS.md QM-3 文本结构断言 MUST）。
 *
 * 为什么单独立一个文件而不是只靠组件测试：文案是函数拼接（含条件段），组件测试里
 * 只用 toContain 级别的存在性断言对「段落丢失 / 段序错乱 / 空段」完全免疫。
 * 本文件对 zh / en 各自断言整句字面量，覆盖 unconfirmed 为 0 与 >0 两种形态。
 *
 * 2026-10-22 fix-batch-check-toast-unify：汇总句从「只报数」扩为「报数 + 下一步 + 固化失败」。
 * 原先这三段是三条独立 toast（汇总 / 后续操作建议 / 固化失败），用户一次点击看到 4 条
 * 且互相冲突（「0 个失效」与「5 个账号需要重新登录」同时出现）。现在合并为**一条**汇总句，
 * 所以这里必须逐段锁定拼接形状：任一段缺失、段序错乱、空段（悬空分隔符）都要当场红。
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

/**
 * 「下一步」段（原独立 toast `checkHintsSummary`，2026-10-22 并入汇总句）。
 *
 * 锁定三件事：① 只给 relogin / 只给 retry / 两者都有 三种形态各自正确；
 * ② 两者都没有时返回空串（调用方据此决定不追加分隔符，不得出现「；」空挂）；
 * ③ 分隔符用「；」而不是「，」—— 与前三段的「，」分层，让用户看出这是"补充动作"而非"又一个计数"。
 */
describe('accountsPage.checkHintsSummaryInline 下一步段文案', () => {
  it('中文：只有 relogin', () => {
    expect(render(zh.accountsPage.checkHintsSummaryInline, { relogin: 5, retry: 0 }))
      .toBe('其中 5 个建议重新登录')
  })

  it('中文：只有 retry', () => {
    expect(render(zh.accountsPage.checkHintsSummaryInline, { relogin: 0, retry: 1 }))
      .toBe('其中 1 个建议稍后重试')
  })

  it('中文：两者都有时用「；」分层', () => {
    expect(render(zh.accountsPage.checkHintsSummaryInline, { relogin: 5, retry: 1 }))
      .toBe('其中 5 个建议重新登录；1 个建议稍后重试')
  })

  it('中文：两者都为 0 时返回空串（调用方据此不追加分隔符）', () => {
    expect(render(zh.accountsPage.checkHintsSummaryInline, { relogin: 0, retry: 0 })).toBe('')
  })

  it('英文：三种形态与中文同构，都为 0 时同样空串', () => {
    expect(render(en.accountsPage.checkHintsSummaryInline, { relogin: 5, retry: 0 }))
      .toBe('of which 5 should log in again')
    expect(render(en.accountsPage.checkHintsSummaryInline, { relogin: 0, retry: 1 }))
      .toBe('of which 1 should be retried later')
    expect(render(en.accountsPage.checkHintsSummaryInline, { relogin: 5, retry: 1 }))
      .toBe('of which 5 should log in again; 1 should be retried later')
    expect(render(en.accountsPage.checkHintsSummaryInline, { relogin: 0, retry: 0 })).toBe('')
  })

  it('「其中」前缀让用户看出这一段在说前面那几个未取到定论的账号', () => {
    // 回归保护：原独立 toast 的文案是「5 个账号需要重新登录」，读不出它与汇总句的关系，
    // 正是用户报「0 个失效」与「5 个要重登」矛盾的直接原因。
    expect(zh.accountsPage.checkHintsSummaryInline({ named: (k) => ({ relogin: 3, retry: 0 })[k] }))
      .toContain('其中')
  })
})

/**
 * 固化失败段（原独立红色 toast `batchCheckAllPersistFailed`，2026-10-22 并入汇总句尾部）。
 *
 * 降级理由：它是「部分账号的结论没落库」，不是「整个检测失败」。原来用 error 级红色弹窗，
 * 用户会以为一键检测功能坏了。现在拼在汇总句尾部，与汇总同级（warning）。
 */
describe('accountsPage.checkHintsPersistFailedInline 固化失败段文案', () => {
  it('中文：措辞明确「未能保存」+ 可执行下一步', () => {
    expect(render(zh.accountsPage.checkHintsPersistFailedInline, { count: 1 }))
      .toBe('另有 1 个账号的检测结论未能保存到服务端，请重试或检查后端服务')
  })

  it('中文：多个账号时复数表述仍通顺', () => {
    expect(render(zh.accountsPage.checkHintsPersistFailedInline, { count: 3 }))
      .toBe('另有 3 个账号的检测结论未能保存到服务端，请重试或检查后端服务')
  })

  it('英文：与中文同结构，含 could not be saved 与 retry/backend', () => {
    expect(render(en.accountsPage.checkHintsPersistFailedInline, { count: 1 }))
      .toBe('login status of 1 account(s) could not be saved to the server. Retry or check the backend service')
    expect(render(en.accountsPage.checkHintsPersistFailedInline, { count: 3 }))
      .toBe('login status of 3 account(s) could not be saved to the server. Retry or check the backend service')
  })

  it('不得复用户级红色错误措辞（降级为汇总尾部段的形状）', () => {
    // 原独立 toast 文案以「检测完成，但…」开头，读起来像整个操作失败。
    const zhText = render(zh.accountsPage.checkHintsPersistFailedInline, { count: 1 })
    expect(zhText.startsWith('检测完成')).toBe(false)
    expect(zhText).toContain('未能保存')
  })
})
