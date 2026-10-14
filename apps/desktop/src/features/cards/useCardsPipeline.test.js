// @vitest-environment node
/**
 * useCardsPipeline 合同测试（P2-5/P2-6 合流）
 *
 * 锁四件「直接在前端依次调两个 composable 会丢掉」的东西：
 *   1. 两处 warnings **合并去重**（分开展示漏看、直接拼会重复）
 *   2. **失败归属**到阶段（分页失败 vs 渲染失败，文案与后续动作不同）
 *   3. **阶段可观测**（用户要知道「正在分页」而不只是「正在渲染」）
 *   4. **可取消重入**（旧流水线的结果不得写回）
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockCardsRender = vi.fn()
vi.mock('@/api/cards', () => ({ cardsRender: (...a) => mockCardsRender(...a) }))

const { useCardsPipeline, STAGE } = await import('./useCardsPipeline')

/** 确定性假 measure：每字 10px */
const measure = vi.fn(async (text) => String(text == null ? '' : text).length * 10)

function setup () { return useCardsPipeline() }

beforeEach(() => { mockCardsRender.mockReset(); measure.mockClear() })

describe('阶段可观测', () => {
  it('跑完后 stage 依次经过 paginating → rendering → done', async () => {
    mockCardsRender.mockResolvedValue({ code: 0, data: ['/a.png'] })
    const c = setup()
    const seen = []
    const p = c.run({ text: '短文本', measure, availableHeightPx: 1440 })
    seen.push(c.stage.value)
    await p
    seen.push(c.stage.value)
    expect(seen[0]).toBe(STAGE.PAGINATING)
    expect(seen[1]).toBe(STAGE.DONE)
    expect(c.running.value).toBe(false)
  })
})

describe('失败归属到阶段', () => {
  it('分页失败 ⇒ failure.stage = paginate，不调渲染', async () => {
    const c = setup()
    // measure 非函数 ⇒ 分页器 fail-closed
    const ok = await c.run({ text: 'abc', measure: undefined })
    expect(ok).toBe(false)
    expect(c.failure.value.stage).toBe('paginate')
    expect(mockCardsRender).not.toHaveBeenCalled()
  })

  it('渲染失败 ⇒ failure.stage = render，且带上渲染侧的 vars', async () => {
    mockCardsRender.mockResolvedValue({ code: -2, message: 'data.pages[0][0] 必须是字符串' })
    const c = setup()
    const ok = await c.run({ text: '短文本', measure, availableHeightPx: 1440 })
    expect(ok).toBe(false)
    expect(c.failure.value.stage).toBe('render')
    expect(c.failure.value.key).toBe('failedValidation')
  })
})

describe('warnings 合并去重', () => {
  it('★ 分页与渲染两侧的同名 warning 只出现一次', async () => {
    // 分页器给 item-exceeds-page（单段超一页）；渲染侧也报同名
    mockCardsRender.mockResolvedValue({
      code: 0,
      data: ['/a.png'],
      warnings: ['item-exceeds-page', 'render-only-warning'],
    })
    const c = setup()
    const ok = await c.run({ text: '字'.repeat(500), measure, availableHeightPx: 100 })
    expect(ok).toBe(true)
    // 分页侧必有 item-exceeds-page；渲染侧也给了 ⇒ 合并后只能有一个
    const occurrences = c.warnings.value.filter(w => w === 'item-exceeds-page')
    expect(occurrences).toHaveLength(1)
    // 渲染侧独有的也要在
    expect(c.warnings.value).toContain('render-only-warning')
    expect(c.hasWarnings.value).toBe(true)
  })

  it('两侧都无 warning ⇒ warnings 为空', async () => {
    mockCardsRender.mockResolvedValue({ code: 0, data: ['/a.png'] })
    const c = setup()
    await c.run({ text: '短', measure, availableHeightPx: 1440 })
    expect(c.warnings.value).toEqual([])
  })
})

describe('可取消重入', () => {
  it('★ 旧流水线的迟到结果不得写回（用户改字重跑后看到的是新结果）', async () => {
    // 第一次：渲染 hang 住（不 resolve）；第二次：立即成功。
    // 第二次完成后第一次才「迟到」返回 —— 它的结果必须被丢弃。
    let resolveFirst
    mockCardsRender
      .mockImplementationOnce(() => new Promise((r) => { resolveFirst = r }))
      .mockResolvedValue({ code: 0, data: ['/new.png'] })

    const c = setup()
    const first = c.run({ text: '第一次', measure, availableHeightPx: 1440 })
    // 等第一个真正进入渲染阶段（它的 cardsRender 已被调用）再启动第二个 ——
    // 这也是真实用户时序：前一次还在渲染时用户又改了一次。
    await vi.waitFor(() => expect(resolveFirst).toBeTypeOf('function'))
    await c.run({ text: '第二次', measure, availableHeightPx: 1440 })

    resolveFirst({ code: 0, data: ['/old.png'] })
    await first

    expect(c.resultFiles.value).toEqual(['/new.png'])
    expect(c.resultFiles.value).not.toContain('/old.png')
  }, 20000)
})

describe('reset', () => {
  it('清空阶段/失败/warnings 与两侧状态', async () => {
    mockCardsRender.mockResolvedValue({ code: 0, data: ['/a.png'], warnings: ['item-exceeds-page'] })
    const c = setup()
    await c.run({ text: '字'.repeat(500), measure, availableHeightPx: 100 })
    expect(c.hasWarnings.value).toBe(true)
    c.reset()
    expect(c.stage.value).toBe(STAGE.IDLE)
    expect(c.failure.value).toBe(null)
    expect(c.warnings.value).toEqual([])
    expect(c.resultFiles.value).toEqual([])
    expect(c.pages.value).toEqual([])
  })
})
