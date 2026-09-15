// @ts-check
/**
 * account-manager-extract-info.test.js — extractAccountInfo 回归
 *
 * 回归（2026-09-14，no-undef）：函数体引用了未导入的 `PLATFORM_ACCOUNT_INFO_SELECTORS`
 * （实际定义并导出于 @multi-publish/shared-utils/src/platform-definitions），
 * 导致该函数每次调用都在 try 内抛 ReferenceError、被 catch 吞成 `{}`——
 * 「账号信息提取」功能自引入以来从未生效，调用方（saveCapturedAccount）拿到的
 * accountInfo 恒为 undefined。
 */
import { describe, it, expect, vi } from 'vitest'

const { extractAccountInfo } = require('../publishers/account-manager')
const {
  PLATFORM_ACCOUNT_INFO_SELECTORS,
} = require('@multi-publish/shared-utils/src/platform-definitions')

describe('extractAccountInfo', () => {
  it('带平台标识时把平台专用选择器传给 page.evaluate（修复前此处抛 no-undef）', async () => {
    const info = { nickName: '张三', followers: '1.2万', platformAccountId: 'uid-1' }
    const evaluate = vi.fn(async () => info)
    const page = { evaluate }

    const result = await extractAccountInfo(page, 'zhihu')

    expect(evaluate).toHaveBeenCalledTimes(1)
    const evalArg = evaluate.mock.calls[0][1]
    expect(evalArg.platformSelectors).toBe(PLATFORM_ACCOUNT_INFO_SELECTORS.zhihu)
    expect(result).toEqual(info)
  })

  it('无平台标识时 platformSelectors 为 null（走通用选择器回退）', async () => {
    const evaluate = vi.fn(async () => ({ nickName: '' }))
    const page = { evaluate }

    await extractAccountInfo(page, '')

    const evalArg = evaluate.mock.calls[0][1]
    expect(evalArg.platformSelectors).toBeNull()
  })

  it('page.evaluate 抛异常时静默回退为空对象（原有降级语义不变）', async () => {
    const page = { evaluate: vi.fn(async () => { throw new Error('nav failed') }) }
    const result = await extractAccountInfo(page, 'zhihu')
    expect(result).toEqual({})
  })
})
