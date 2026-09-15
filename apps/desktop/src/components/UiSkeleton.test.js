import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import UiSkeleton from './UiSkeleton.vue'

describe('UiSkeleton', () => {
  it('renders a single bar for the text variant', () => {
    const w = mount(UiSkeleton, { props: { variant: 'text' } })
    expect(w.findAll('.mp-skeleton__bar')).toHaveLength(1)
    expect(w.find('.mp-skeleton-surface').exists()).toBe(true)
  })

  it('applies numeric width/height as px', () => {
    const w = mount(UiSkeleton, { props: { variant: 'text', width: 120, height: 20 } })
    const bar = w.find('.mp-skeleton__bar')
    expect(bar.attributes('style')).toContain('width: 120px')
    expect(bar.attributes('style')).toContain('height: 20px')
  })

  it('renders `rows` bars for paragraph and closes the last line', () => {
    const w = mount(UiSkeleton, { props: { variant: 'paragraph', rows: 4 } })
    const bars = w.findAll('.mp-skeleton__bar')
    expect(bars).toHaveLength(4)
    expect(bars[3].attributes('style')).toContain('62%')
    expect(bars[0].attributes('style')).toContain('100%')
  })

  it('renders a single block for rect and a round block for circle', () => {
    expect(mount(UiSkeleton, { props: { variant: 'rect' } }).findAll('.mp-skeleton__block')).toHaveLength(1)
    const circle = mount(UiSkeleton, { props: { variant: 'circle' } })
    expect(circle.find('.mp-skeleton--circle').exists()).toBe(true)
  })

  it('renders media + 2 lines for the card variant', () => {
    const w = mount(UiSkeleton, { props: { variant: 'card' } })
    expect(w.find('.mp-skeleton__media').exists()).toBe(true)
    expect(w.findAll('.mp-skeleton__bar')).toHaveLength(2)
  })

  it('renders `count` rows for the list variant, each with avatar and action slot', () => {
    const w = mount(UiSkeleton, { props: { variant: 'list', count: 3 } })
    const rows = w.findAll('.mp-skeleton__row')
    expect(rows).toHaveLength(3)
    expect(w.findAll('.mp-skeleton__avatar')).toHaveLength(3)
    expect(w.findAll('.mp-skeleton__action')).toHaveLength(3)
    // 每行 3 条文本骨块
    expect(w.findAll('.mp-skeleton__bar')).toHaveLength(9)
  })

  it('renders header + count rows × columns bars for the table variant', () => {
    const w = mount(UiSkeleton, { props: { variant: 'table', count: 2, columns: 5 } })
    expect(w.findAll('.mp-skeleton__table-row')).toHaveLength(3)
    expect(w.findAll('.mp-skeleton__bar')).toHaveLength(15)
  })

  it('renders 8 columns for the chart variant', () => {
    const w = mount(UiSkeleton, { props: { variant: 'chart' } })
    expect(w.findAll('.mp-skeleton__column')).toHaveLength(8)
  })

  it('marks the root as a polite status region', () => {
    const w = mount(UiSkeleton)
    expect(w.attributes('role')).toBe('status')
    expect(w.attributes('aria-busy')).toBe('true')
    expect(w.attributes('data-testid')).toBe('ui-skeleton')
  })

  it('disables the shimmer class when animated=false', () => {
    const animated = mount(UiSkeleton)
    expect(animated.classes()).not.toContain('mp-skeleton--static')
    const still = mount(UiSkeleton, { props: { animated: false } })
    expect(still.classes()).toContain('mp-skeleton--static')
  })

  it('renders a visually hidden label for screen readers', () => {
    const w = mount(UiSkeleton, { props: { label: '加载中...' } })
    expect(w.find('.mp-skeleton__sr').text()).toBe('加载中...')
    expect(w.text()).toContain('加载中...')
  })

  it('falls back to the i18n loading label so the status region is readable', () => {
    // test-setup.js 固定 navigator.language = zh-CN，因此这里断言中文兜底文案
    expect(mount(UiSkeleton).find('.mp-skeleton__sr').text()).toBe('加载中...')
  })

  it('supports a custom root tag (table row usage)', () => {
    const w = mount(UiSkeleton, { props: { tag: 'tr' } })
    expect(w.element.tagName.toLowerCase()).toBe('tr')
  })

  it('forwards the custom variant to the default slot', () => {
    const w = mount(UiSkeleton, {
      props: { variant: 'custom' },
      slots: { default: '<span class="my-own-bone mp-skeleton-surface"></span>' }
    })
    expect(w.find('.my-own-bone').exists()).toBe(true)
  })
})
