// @ts-check
/**
 * HotTopicsGenVideoPicker — 行内「生成视频 + 下箭头流水线选择器」组件测试
 * （hot-topics-pipeline-picker，2026-10-17）。
 *
 * 交互契约：懒加载/缓存、全部流水线（禁用+原因）、默认徽标、选中即 emit、禁用项无副作用、
 * 外点/Esc/方向键、加载失败回退+重试、空清单、单面板、busy 禁用。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { nextTick } from 'vue'

vi.mock('vue-i18n', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    useI18n: () => ({ t: (key, params) => key + (params ? ':' + JSON.stringify(params) : '') }),
  }
})

vi.mock('@/api/publisher', () => ({
  pipelineList: vi.fn(),
}))

import HotTopicsGenVideoPicker from './HotTopicsGenVideoPicker.vue'
import { pipelineList } from '@/api/publisher'

const PIPELINE_LIST = [
  { name: 'story2video-compose', available: true },
  { name: 'animated-explainer', available: true },
  { name: 'cinematic', available: true },
  { name: 'animation', available: true },
  { name: 'framework-smoke', available: true },
  { name: 'screen-demo', available: false },
  { name: 'film-engineering', available: true },
]

function mountPicker(props = {}) {
  const el = document.createElement('div')
  document.body.appendChild(el)
  const wrapper = mount(HotTopicsGenVideoPicker, {
    attachTo: el,
    props: { topicId: 'zhihu:1', busy: false, favorite: false, ...props },
  })
  return { wrapper, el }
}

const caret = (wrapper, favorite = false, id = 'zhihu:1') => wrapper.find(
  favorite ? `[data-testid="hot-topic-favorite-gen-video-picker-${id}"]` : `[data-testid="hot-topic-gen-video-picker-${id}"]`,
)

describe('HotTopicsGenVideoPicker', () => {
  let mounted = []

  beforeEach(() => {
    vi.clearAllMocks()
    pipelineList.mockResolvedValue({ code: 0, data: PIPELINE_LIST })
    mounted = []
  })

  afterEach(() => {
    for (const item of mounted) {
      try { item.wrapper.unmount() } catch (_) { /* ignore */ }
      item.el.remove()
    }
    // 清理 Teleport 到 body 的菜单/按钮残留，隔离用例（不用 innerHTML：安全扫描按 XSS 高危拦截）
    document.body.replaceChildren()
  })

  function mountTracked(props = {}) {
    const m = mountPicker(props)
    mounted.push(m)
    return m
  }

  it('renders the primary generate button plus a compact caret with menu a11y attributes', () => {
    const { wrapper } = mountTracked()
    const main = wrapper.find('[data-testid="hot-topic-generate-video-zhihu:1"]')
    expect(main.exists()).toBe(true)
    expect(main.text()).toContain('hotTopics.generateVideo')
    expect(main.classes()).toContain('cohere-btn-primary')

    const arrow = caret(wrapper)
    expect(arrow.exists()).toBe(true)
    expect(arrow.attributes('aria-haspopup')).toBe('menu')
    expect(arrow.attributes('aria-expanded')).toBe('false')
    expect(arrow.attributes('aria-label')).toBe('hotTopics.genVideoPipelinePickerAria')
    expect(arrow.classes()).toContain('cohere-btn-primary')
    expect(arrow.text()).toContain('▾')
  })

  it('uses favorite test ids for the favorites tab variant', () => {
    const { wrapper } = mountTracked({ favorite: true, topicId: 'zhihu:1' })
    expect(wrapper.find('[data-testid="hot-topic-favorite-generate-video-zhihu:1"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="hot-topic-favorite-gen-video-picker-zhihu:1"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="hot-topic-gen-video-picker-zhihu:1"]').exists()).toBe(false)
  })

  it('busy disables both buttons and refuses to open the menu', async () => {
    const { wrapper } = mountTracked({ busy: true })
    expect(wrapper.find('[data-testid="hot-topic-generate-video-zhihu:1"]').attributes('disabled')).toBeDefined()
    expect(caret(wrapper).attributes('disabled')).toBeDefined()
    await caret(wrapper).trigger('click')
    await flushPromises()
    expect(pipelineList).not.toHaveBeenCalled()
    expect(wrapper.find('[data-testid="hot-topic-gen-video-pipeline-menu-zhihu:1"]').exists()).toBe(false)
  })

  it('lazily loads the pipeline list on first open, shows loading, then renders all pipelines', async () => {
    let resolveList
    pipelineList.mockImplementation(() => new Promise((resolve) => { resolveList = resolve }))
    const { wrapper } = mountTracked()

    await caret(wrapper).trigger('click')
    await nextTick()
    expect(pipelineList).toHaveBeenCalledTimes(1)
    expect(wrapper.find('[data-testid="hot-topic-gen-video-pipeline-loading-zhihu:1"]').exists()).toBe(true)
    expect(caret(wrapper).attributes('aria-expanded')).toBe('true')

    resolveList({ code: 0, data: PIPELINE_LIST })
    await flushPromises()

    const menu = wrapper.find('[data-testid="hot-topic-gen-video-pipeline-menu-zhihu:1"]')
    expect(menu.exists()).toBe(true)
    expect(menu.attributes('role')).toBe('menu')
    const items = wrapper.findAll('[data-testid^="hot-topic-gen-video-pipeline-option-zhihu:1-"]')
    expect(items).toHaveLength(PIPELINE_LIST.length)
    // 可执行在前（主进程顺序），不可执行在后
    expect(items.map(i => i.attributes('data-testid'))).toEqual([
      'hot-topic-gen-video-pipeline-option-zhihu:1-story2video-compose',
      'hot-topic-gen-video-pipeline-option-zhihu:1-animated-explainer',
      'hot-topic-gen-video-pipeline-option-zhihu:1-animation',
      'hot-topic-gen-video-pipeline-option-zhihu:1-cinematic',
      'hot-topic-gen-video-pipeline-option-zhihu:1-framework-smoke',
      'hot-topic-gen-video-pipeline-option-zhihu:1-screen-demo',
      'hot-topic-gen-video-pipeline-option-zhihu:1-film-engineering',
    ])
    // 默认项徽标只有 story2video-compose
    const defaultBadges = wrapper.findAll('.pipeline-default-badge')
    expect(defaultBadges).toHaveLength(1)
    expect(items[0].text()).toContain('hotTopics.genVideoPipelineDefaultBadge')
    // 禁用项带原因文案且 disabled
    const cinematic = wrapper.find('[data-testid="hot-topic-gen-video-pipeline-option-zhihu:1-cinematic"]')
    expect(cinematic.attributes('disabled')).toBeDefined()
    expect(cinematic.text()).toContain('hotTopics.genVideoPipelineNeedsMedia')
    expect(wrapper.find('[data-testid="hot-topic-gen-video-pipeline-option-zhihu:1-framework-smoke"]').text())
      .toContain('hotTopics.genVideoPipelineInternal')
    expect(wrapper.find('[data-testid="hot-topic-gen-video-pipeline-option-zhihu:1-screen-demo"]').text())
      .toContain('hotTopics.genVideoPipelineUnavailable')
    expect(wrapper.find('[data-testid="hot-topic-gen-video-pipeline-option-zhihu:1-film-engineering"]').text())
      .toContain('hotTopics.genVideoPipelineDedicated')
  })

  it('emits pick with the chosen pipeline and closes the menu', async () => {
    const { wrapper } = mountTracked()
    await caret(wrapper).trigger('click')
    await flushPromises()
    await wrapper.find('[data-testid="hot-topic-gen-video-pipeline-option-zhihu:1-animated-explainer"]').trigger('click')
    await flushPromises()
    expect(wrapper.emitted('pick')).toEqual([['animated-explainer']])
    expect(wrapper.find('[data-testid="hot-topic-gen-video-pipeline-menu-zhihu:1"]').exists()).toBe(false)
    expect(caret(wrapper).attributes('aria-expanded')).toBe('false')
  })

  it('never emits pick from a disabled option (programmatic click included)', async () => {
    const { wrapper } = mountTracked()
    await caret(wrapper).trigger('click')
    await flushPromises()
    await wrapper.find('[data-testid="hot-topic-gen-video-pipeline-option-zhihu:1-cinematic"]').trigger('click')
    await flushPromises()
    expect(wrapper.emitted('pick')).toBeUndefined()
    expect(wrapper.find('[data-testid="hot-topic-gen-video-pipeline-menu-zhihu:1"]').exists()).toBe(true)
  })

  it('caches the loaded list across open/close within the same mount', async () => {
    const { wrapper } = mountTracked()
    await caret(wrapper).trigger('click')
    await flushPromises()
    await caret(wrapper).trigger('click')
    await flushPromises()
    await caret(wrapper).trigger('click')
    await flushPromises()
    expect(pipelineList).toHaveBeenCalledTimes(1)
  })

  it('falls back to the default pipeline when loading fails, and retry reloads', async () => {
    pipelineList.mockResolvedValueOnce({ code: -1, message: 'Backend offline' })
    const { wrapper } = mountTracked()
    await caret(wrapper).trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-testid="hot-topic-gen-video-pipeline-error-zhihu:1"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="hot-topic-gen-video-pipeline-error-zhihu:1"]').text())
      .toContain('hotTopics.genVideoPipelineLoadFailed')
    const fallback = wrapper.find('[data-testid="hot-topic-gen-video-pipeline-option-zhihu:1-story2video-compose"]')
    expect(fallback.exists()).toBe(true)
    expect(fallback.text()).toContain('hotTopics.genVideoPipelineDefaultBadge')

    // 回退项仍可启动（主流程不因清单失败而不可用）
    await fallback.trigger('click')
    expect(wrapper.emitted('pick')).toEqual([['story2video-compose']])

    // 重试：成功后展示完整清单
    pipelineList.mockResolvedValueOnce({ code: 0, data: PIPELINE_LIST })
    await caret(wrapper).trigger('click')
    await flushPromises()
    await wrapper.find('[data-testid="hot-topic-gen-video-pipeline-retry-zhihu:1"]').trigger('click')
    await flushPromises()
    expect(pipelineList).toHaveBeenCalledTimes(2)
    expect(wrapper.findAll('[data-testid^="hot-topic-gen-video-pipeline-option-zhihu:1-"]')).toHaveLength(PIPELINE_LIST.length)
  })

  it('shows an empty hint when the backend returns no pipelines', async () => {
    pipelineList.mockResolvedValue({ code: 0, data: [] })
    const { wrapper } = mountTracked()
    await caret(wrapper).trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-testid="hot-topic-gen-video-pipeline-empty-zhihu:1"]').exists()).toBe(true)
    expect(wrapper.findAll('[data-testid^="hot-topic-gen-video-pipeline-option-zhihu:1-"]')).toHaveLength(0)
  })

  it('closes when clicking outside of the picker', async () => {
    const { wrapper } = mountTracked()
    await caret(wrapper).trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-testid="hot-topic-gen-video-pipeline-menu-zhihu:1"]').exists()).toBe(true)
    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    await flushPromises()
    expect(wrapper.find('[data-testid="hot-topic-gen-video-pipeline-menu-zhihu:1"]').exists()).toBe(false)
  })

  it('closes on Escape and returns focus to the caret', async () => {
    const { wrapper } = mountTracked()
    const arrow = caret(wrapper)
    await arrow.trigger('click')
    await flushPromises()
    await wrapper.find('.gen-video-pipeline-menu').trigger('keydown', { key: 'Escape' })
    await flushPromises()
    expect(wrapper.find('[data-testid="hot-topic-gen-video-pipeline-menu-zhihu:1"]').exists()).toBe(false)
    expect(document.activeElement).toBe(arrow.element)
  })

  it('moves focus through enabled items with ArrowDown/ArrowUp and skips disabled ones', async () => {
    const { wrapper } = mountTracked()
    const arrow = caret(wrapper)
    await arrow.trigger('click')
    await flushPromises()
    const menu = wrapper.find('.gen-video-pipeline-menu')
    // 打开后焦点落在第一个可执行项
    expect(document.activeElement?.getAttribute('data-testid'))
      .toBe('hot-topic-gen-video-pipeline-option-zhihu:1-story2video-compose')
    await menu.trigger('keydown', { key: 'ArrowDown' })
    await nextTick()
    expect(document.activeElement?.getAttribute('data-testid'))
      .toBe('hot-topic-gen-video-pipeline-option-zhihu:1-animated-explainer')
    await menu.trigger('keydown', { key: 'ArrowUp' })
    await nextTick()
    expect(document.activeElement?.getAttribute('data-testid'))
      .toBe('hot-topic-gen-video-pipeline-option-zhihu:1-story2video-compose')
    // End 到最后一个可执行项（不是禁用项）
    await menu.trigger('keydown', { key: 'End' })
    await nextTick()
    expect(document.activeElement?.getAttribute('data-testid'))
      .toBe('hot-topic-gen-video-pipeline-option-zhihu:1-animation')
  })

  it('closes the panel when the page scrolls (avoids detached/clipped panels)', async () => {
    const { wrapper } = mountTracked()
    await caret(wrapper).trigger('click')
    await flushPromises()
    expect(wrapper.find('.gen-video-pipeline-menu').exists()).toBe(true)
    // 捕获阶段监听 window scroll（滚动事件不冒泡，但 capture 能收到容器滚动）
    window.dispatchEvent(new Event('scroll'))
    await flushPromises()
    expect(wrapper.find('.gen-video-pipeline-menu').exists()).toBe(false)
  })

  it('recomputes placement on window resize while open (QM-6 review i2)', async () => {
    const { wrapper } = mountTracked()
    await caret(wrapper).trigger('click')
    await flushPromises()
    expect(wrapper.find('.gen-video-pipeline-menu').exists()).toBe(true)
    // jsdom 下 getBoundingClientRect 全为 0 ⇒ updatePlacement 走几何缺失回退（bottom）；
    // 这里锁的是「resize 会触发重算且不抛错、面板保持打开」这条行为
    window.dispatchEvent(new Event('resize'))
    await flushPromises()
    expect(wrapper.find('.gen-video-pipeline-menu').exists()).toBe(true)
    // 关闭态下 resize 不触发任何副作用（监听器已随 close 移除）
    await caret(wrapper).trigger('click')
    await flushPromises()
    window.dispatchEvent(new Event('resize'))
    await flushPromises()
    expect(wrapper.find('.gen-video-pipeline-menu').exists()).toBe(false)
  })
})
