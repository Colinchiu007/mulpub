// @vitest-environment node
/**
 * useArticlePagination 合同测试（P2-6 上游一环）
 *
 * 锁文件头里那三个「看起来只是 split 其实会影响分页」的决定：
 *   ① 空段必须丢（否则每页条数虚高、item-exceeds-page 出现高度 0 噪声）
 *   ② 段必须 trim（否则 minTailChars / minSplitChars 按字符数判据被空白污染）
 *   ③ id 用下标（不能用内容哈希 —— 相同内容的段会共享 measuredHeights 缓存）
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { useArticlePagination } = await import('./useArticlePagination')

/** 确定性假 measure：每字 10px（契约是 (text, item) => Promise<number>） */
const measure = vi.fn(async (text) => String(text == null ? '' : text).length * 10)

function setup () { return useArticlePagination() }

beforeEach(() => { measure.mockClear() })

describe('buildItems：正文 → 分页器 items', () => {
  it('① 空段被丢（连续换行不产生空 item）', () => {
    const { buildItems } = setup()
    const items = buildItems('a\n\n\nb\n\nc')
    expect(items.map(i => i.value)).toEqual(['a', 'b', 'c'])
  })

  it('② 每段 trim（首尾空白不污染按字符数的判据）', () => {
    const { buildItems } = setup()
    const items = buildItems('  a  \n\t b \t')
    expect(items.map(i => i.value)).toEqual(['a', 'b'])
  })

  it('③ id 是下标，且同批内唯一', () => {
    const { buildItems } = setup()
    const items = buildItems('x\nx\nx')
    expect(items.map(i => i.id)).toEqual(['p0', 'p1', 'p2'])
    expect(new Set(items.map(i => i.id)).size).toBe(3)
  })

  it('非字符串入参不当崩（按空串处理）', () => {
    const { buildItems } = setup()
    expect(buildItems(undefined)).toEqual([])
    expect(buildItems(null)).toEqual([])
    expect(buildItems(123)).toEqual([])
  })
})

describe('paginate：与 P2-1 的契约对接', () => {
  it('2000 字 / 20 段 ⇒ pageCount >= 2 且每页非空', async () => {
    const c = setup()
    const text = Array.from({ length: 20 }, () => '字'.repeat(100)).join('\n')
    const ok = await c.paginate({ text, measure, availableHeightPx: 1440 })
    expect(ok).toBe(true)
    expect(c.pageCount.value).toBeGreaterThanOrEqual(2)
    expect(c.pages.value.every(p => p.length > 0)).toBe(true)
  })

  it('★ warnings 非空必须透出（不得静默丢弃）', async () => {
    const c = setup()
    // 单段就超一页 ⇒ 分页器给 item-exceeds-page
    const text = '字'.repeat(500)
    await c.paginate({ text, measure, availableHeightPx: 100 })
    expect(c.warnings.value.length).toBeGreaterThan(0)
  })

  it('空正文 ⇒ failure.key = empty，不调分页器', async () => {
    const c = setup()
    const ok = await c.paginate({ text: '  \n\n  ', measure })
    expect(ok).toBe(false)
    expect(c.failure.value.key).toBe('empty')
    expect(measure).not.toHaveBeenCalled()
  })

  it('★ measure 非函数 ⇒ 分页器 fail-closed，被接住成 failure（不变成 unhandled rejection）', async () => {
    const c = setup()
    const ok = await c.paginate({ text: 'abc', measure: undefined })
    expect(ok).toBe(false)
    expect(c.failure.value.key).toBe('failed')
    expect(c.failure.value.message).toContain('measure')
    expect(c.paginating.value).toBe(false)
  })

  it('availableHeightPx 非法（0/负数）⇒ fail-closed 被接住', async () => {
    const c = setup()
    const ok = await c.paginate({ text: 'abc', measure, availableHeightPx: 0 })
    expect(ok).toBe(false)
    expect(c.failure.value.key).toBe('failed')
  })

  it('跨调用不残留（上次的 pages/warnings 不得带到下次）', async () => {
    const c = setup()
    await c.paginate({ text: '字'.repeat(500), measure, availableHeightPx: 100 })
    expect(c.warnings.value.length).toBeGreaterThan(0)
    await c.paginate({ text: '短', measure, availableHeightPx: 1440 })
    expect(c.warnings.value).toEqual([])
  })
})
