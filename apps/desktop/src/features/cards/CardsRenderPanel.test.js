// @vitest-environment jsdom
/**
 * CardsRenderPanel 合同测试（P2-5 第三批）
 *
 * 锁规格三条判据在**模板层**的落点：
 *   ① 入口可点、进度可见、失败有明确文案
 *   ② warnings 非空时有**可见提示**（不得静默）
 *   ③ 未知 warning 如实回显其标识（不得伪装成已知文案，也不得丢弃）
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'

const mockCardsRender = vi.fn()
vi.mock('@/api/cards', () => ({ cardsRender: (...a) => mockCardsRender(...a) }))

const { default: CardsRenderPanel } = await import('./CardsRenderPanel.vue')
const cardsZh = (await import('@/locales/cards/zh')).default

const i18n = createI18n({
  legacy: false,
  locale: 'zh',
  messages: { zh: { cards: cardsZh } },
})

function mountPanel (props = {}) {
  return mount(CardsRenderPanel, {
    props: { pages: [['a', 'b']], ...props },
    global: { plugins: [i18n] },
  })
}

beforeEach(() => { mockCardsRender.mockReset() })

describe('P2-5 判据①：入口 / 进度 / 失败文案', () => {
  it('入口按钮可点，且 pages 为空时禁用', async () => {
    const w = mountPanel()
    const btn = w.find('[data-testid="cards-render-run"]')
    expect(btn.exists()).toBe(true)
    expect(btn.attributes('disabled')).toBeUndefined()
    await w.setProps({ pages: [] })
    expect(w.find('[data-testid="cards-render-run"]').attributes('disabled')).toBeDefined()
  })

  it('渲染中按钮禁用 + 进度可见（不得让用户重复点击）', async () => {
    let resolveFn
    mockCardsRender.mockReturnValue(new Promise((r) => { resolveFn = r }))
    const w = mountPanel()
    w.find('[data-testid="cards-render-run"]').trigger('click')
    await flushPromises()
    expect(w.find('[data-testid="cards-render-progress"]').exists()).toBe(true)
    expect(w.find('[data-testid="cards-render-run"]').attributes('disabled')).toBeDefined()
    resolveFn({ code: 0, data: ['/a.png'] })
    await flushPromises()
    expect(w.find('[data-testid="cards-render-progress"]').exists()).toBe(false)
  })

  it('失败时有明确文案（点名原因，不是笼统「生成失败」）', async () => {
    mockCardsRender.mockResolvedValue({ code: -2, message: 'data.pages[1][0] 必须是字符串' })
    const w = mountPanel({ pages: [['a'], [1]] })
    await w.find('[data-testid="cards-render-run"]').trigger('click')
    await flushPromises()
    const err = w.find('[data-testid="cards-render-error"]')
    expect(err.exists()).toBe(true)
    // 文案必须含主进程给的具体原因（「哪个下标、什么类型」），而非泛化
    expect(err.text()).toContain('data.pages[1][0]')
  })
})

describe('P2-5 判据②：warnings 非空必须可见', () => {
  it('★ item-exceeds-page / page-limit-reached 必须渲染出来', async () => {
    mockCardsRender.mockResolvedValue({
      code: 0,
      data: ['/a.png'],
      warnings: ['item-exceeds-page', 'page-limit-reached'],
    })
    const w = mountPanel()
    await w.find('[data-testid="cards-render-run"]').trigger('click')
    await flushPromises()
    const box = w.find('[data-testid="cards-render-warnings"]')
    expect(box.exists()).toBe(true)
    expect(w.find('[data-testid="cards-warning-item-exceeds-page"]').exists()).toBe(true)
    expect(w.find('[data-testid="cards-warning-page-limit-reached"]').exists()).toBe(true)
    // 文案来自 locale（中文），不是裸键名
    expect(box.text()).not.toContain('warningItemExceedsPage')
  })

  it('无 warnings 时不渲染警告区（不得出现空标题）', async () => {
    mockCardsRender.mockResolvedValue({ code: 0, data: ['/a.png'] })
    const w = mountPanel()
    await w.find('[data-testid="cards-render-run"]').trigger('click')
    await flushPromises()
    expect(w.find('[data-testid="cards-render-warnings"]').exists()).toBe(false)
  })

  it('★ 未知 warning 如实回显其标识（不伪装、不丢弃）', async () => {
    mockCardsRender.mockResolvedValue({ code: 0, data: ['/a.png'], warnings: ['some-new-warning'] })
    const w = mountPanel()
    await w.find('[data-testid="cards-render-run"]').trigger('click')
    await flushPromises()
    expect(w.find('[data-testid="cards-render-warnings"]').exists()).toBe(true)
    expect(w.find('[data-testid="cards-warning-some-new-warning"]').text()).toBe('some-new-warning')
  })
})

describe('结果区', () => {
  it('成功后展示张数与提示', async () => {
    mockCardsRender.mockResolvedValue({ code: 0, data: ['/a.png', '/b.png'] })
    const w = mountPanel({ pages: [['a'], ['b']] })
    await w.find('[data-testid="cards-render-run"]').trigger('click')
    await flushPromises()
    const box = w.find('[data-testid="cards-render-result"]')
    expect(box.exists()).toBe(true)
    expect(box.text()).toContain('2')
  })

  it('失败时不展示结果区', async () => {
    mockCardsRender.mockResolvedValue({ code: -1, message: 'boom' })
    const w = mountPanel()
    await w.find('[data-testid="cards-render-run"]').trigger('click')
    await flushPromises()
    expect(w.find('[data-testid="cards-render-result"]').exists()).toBe(false)
  })
})
