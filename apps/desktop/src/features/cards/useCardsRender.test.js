// @vitest-environment node
/**
 * useCardsRender 合同测试（P2-5 第二批）
 *
 * 锁三条硬契约：
 *   1. **warnings 非空即必须保留** —— 不得在主进程给了之后丢掉（规格「失败面」条）
 *   2. **失败必须点名原因** —— 「暂不可用」「入参非法」「页数不符」三种必须可区分
 *   3. **不返回部分产物** —— 主进程保证；这里锁「页数不符时 resultFiles 必须为空」
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockCardsRender = vi.fn()
vi.mock('@/api/cards', () => ({ cardsRender: (...a) => mockCardsRender(...a) }))

const { useCardsRender } = await import('./useCardsRender')

function setup () {
  const c = useCardsRender()
  return c
}

beforeEach(() => { mockCardsRender.mockReset() })

describe('成功路径', () => {
  it('成功 ⇒ resultFiles 有值、failure 为空', async () => {
    mockCardsRender.mockResolvedValue({ code: 0, data: ['/tmp/a.png', '/tmp/b.png'] })
    const c = setup()
    const ok = await c.render({ pages: [['a'], ['b']] })
    expect(ok).toBe(true)
    expect(c.resultFiles.value).toEqual(['/tmp/a.png', '/tmp/b.png'])
    expect(c.failed.value).toBe(false)
    expect(c.rendering.value).toBe(false)
  })

  it('★ warnings 非空时必须保留（不得静默丢弃）', async () => {
    mockCardsRender.mockResolvedValue({
      code: 0,
      data: ['/tmp/a.png'],
      warnings: ['item-exceeds-page', 'page-limit-reached'],
    })
    const c = setup()
    await c.render({ pages: [['a']] })
    expect(c.hasWarnings.value).toBe(true)
    expect(c.warnings.value).toEqual(['item-exceeds-page', 'page-limit-reached'])
  })

  it('warnings 缺省时不留脏值（上次的 warnings 不得带到下次）', async () => {
    mockCardsRender.mockResolvedValue({ code: 0, data: ['/x.png'], warnings: ['item-exceeds-page'] })
    const c = setup()
    await c.render({ pages: [['a']] })
    mockCardsRender.mockResolvedValue({ code: 0, data: ['/y.png'] })
    await c.render({ pages: [['b']] })
    expect(c.warnings.value).toEqual([])
    expect(c.hasWarnings.value).toBe(false)
  })
})

describe('失败路径（三种必须可区分）', () => {
  it('CARDS_IPC_UNAVAILABLE ⇒ failedService（暂不可用，非渲染失败）', async () => {
    mockCardsRender.mockResolvedValue({ code: -1, message: 'CARDS_IPC_UNAVAILABLE', data: [], warnings: [] })
    const c = setup()
    const ok = await c.render({ pages: [['a']] })
    expect(ok).toBe(false)
    expect(c.failure.value.key).toBe('failedService')
    expect(c.resultFiles.value).toEqual([])
  })

  it('VALIDATION_ERROR(-2) ⇒ failedValidation 且带上主进程的 message', async () => {
    mockCardsRender.mockResolvedValue({ code: -2, message: 'data.pages[1][0] 必须是字符串' })
    const c = setup()
    await c.render({ pages: [['a'], [1]] })
    expect(c.failure.value.key).toBe('failedValidation')
    expect(c.failure.value.vars.message).toContain('data.pages[1][0]')
  })

  it('★ 页数不符（领域码 RENDER_PAGE_COUNT_MISMATCH）=> failedCount，且 resultFiles 为空', async () => {
    // 主进程按领域码报错，数字在 detail 里（不再靠中文句子匹配）
    mockCardsRender.mockResolvedValue({
      code: -1,
      message: 'RENDER_PAGE_COUNT_MISMATCH',
      detail: '期望 2 页，实得 1',
    })
    const c = setup()
    const ok = await c.render({ pages: [['a'], ['b']] })
    expect(ok).toBe(false)
    expect(c.failure.value.key).toBe('failedCount')
    expect(c.failure.value.vars).toEqual({ expected: '2', actual: '1' })
    expect(c.resultFiles.value).toEqual([])
  })

  it('未知领域码 ⇒ failedUnknown，且原因原文进 vars（不得吞掉）', async () => {
    mockCardsRender.mockResolvedValue({ code: -1, message: '某种新故障' })
    const c = setup()
    await c.render({ pages: [['a']] })
    expect(c.failure.value.key).toBe('failedUnknown')
    expect(c.failure.value.vars.message).toBe('某种新故障')
  })

  it('桥接层抛错（非权限不足）⇒ 被接住并映射，不变成 unhandled rejection', async () => {
    mockCardsRender.mockRejectedValue(new Error('boom'))
    const c = setup()
    const ok = await c.render({ pages: [['a']] })
    expect(ok).toBe(false)
    expect(c.failure.value.key).toBe('failedUnknown')
    expect(c.failure.value.vars.message).toBe('boom')
    expect(c.rendering.value).toBe(false)
  })
})

describe('reset', () => {
  it('清空结果/warnings/失败，rendering 归位', async () => {
    mockCardsRender.mockResolvedValue({ code: 0, data: ['/x.png'], warnings: ['item-exceeds-page'] })
    const c = setup()
    await c.render({ pages: [['a']] })
    c.reset()
    expect(c.resultFiles.value).toEqual([])
    expect(c.warnings.value).toEqual([])
    expect(c.failure.value).toBe(null)
    expect(c.rendering.value).toBe(false)
  })
})
