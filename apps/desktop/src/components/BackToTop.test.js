// @ts-check
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createRouter, createMemoryHistory } from 'vue-router'
import BackToTop from './BackToTop.vue'
import i18n from '@/i18n'

const CONTAINER_TESTID = 'yixiaoer-workspace'

function createTestRouter () {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: { template: '<div />' } },
      { path: '/history', component: { template: '<div />' } },
    ],
  })
}

/**
 * 构造滚动容器。jsdom 不实现 Element.scrollTo 且 scrollTop 恒为 0，
 * 因此这里用 defineProperty 让 scrollTop 可写、并用 spy 补上 scrollTo，
 * 以便断言「点击后回滚到哪个容器、用什么 behavior」。
 */
function setupContainer () {
  const el = document.createElement('main')
  el.setAttribute('data-testid', CONTAINER_TESTID)
  Object.defineProperty(el, 'scrollTop', { configurable: true, writable: true, value: 0 })
  el.scrollTo = vi.fn()
  document.body.appendChild(el)
  return el
}

async function mountBackToTop (props = {}) {
  const router = createTestRouter()
  router.push('/')
  await router.isReady()
  const wrapper = mount(BackToTop, { props, global: { plugins: [i18n, router] } })
  await flush()
  return { wrapper, router }
}

function getButton () {
  return document.body.querySelector('[data-testid="back-to-top"]')
}

function getTooltip () {
  return document.body.querySelector('[data-testid="back-to-top-tooltip"]')
}

/** 推进一个微/宏任务周期，等待 Transition + Teleport 渲染完成 */
function flush () {
  return new Promise(resolve => setTimeout(resolve, 0))
}

/** 模拟在指定容器上产生一次滚动 */
async function scrollTo (el, top) {
  el.scrollTop = top
  el.dispatchEvent(new Event('scroll'))
  await flush()
}

describe('BackToTop.vue', () => {
  /** @type {HTMLElement} */
  let container

  beforeEach(() => {
    document.body.innerHTML = ''
    container = setupContainer()
  })

  afterEach(() => {
    document.body.innerHTML = ''
    i18n.global.locale.value = 'zh'
  })

  it('初始不渲染按钮（内容未滚动）', async () => {
    const { wrapper } = await mountBackToTop()
    expect(getButton()).toBeNull()
    wrapper.unmount()
  })

  it('滚动超过阈值时出现，滚回阈值以内后消失', async () => {
    const { wrapper } = await mountBackToTop()

    await scrollTo(container, 319)
    expect(getButton()).toBeNull()

    await scrollTo(container, 321)
    expect(getButton()).toBeTruthy()

    await scrollTo(container, 100)
    expect(getButton()).toBeNull()

    wrapper.unmount()
  })

  it('阈值边界：等于阈值不显示，超过阈值才显示', async () => {
    const { wrapper } = await mountBackToTop({ threshold: 320 })

    await scrollTo(container, 320)
    expect(getButton()).toBeNull()

    await scrollTo(container, 321)
    expect(getButton()).toBeTruthy()

    wrapper.unmount()
  })

  it('支持自定义阈值', async () => {
    const { wrapper } = await mountBackToTop({ threshold: 10 })

    await scrollTo(container, 11)
    expect(getButton()).toBeTruthy()

    wrapper.unmount()
  })

  it('点击后对滚动容器执行平滑回顶', async () => {
    const { wrapper } = await mountBackToTop()
    await scrollTo(container, 800)

    const btn = getButton()
    expect(btn).toBeTruthy()
    btn.click()
    await flush()

    expect(container.scrollTo).toHaveBeenCalledTimes(1)
    expect(container.scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' })

    wrapper.unmount()
  })

  it('系统开启「减少动态效果」时改为瞬时跳转', async () => {
    const original = window.matchMedia
    // @ts-ignore —— jsdom 未实现 matchMedia，这里注入最小可用替身
    window.matchMedia = vi.fn((query) => ({
      matches: String(query).includes('reduce'),
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }))

    try {
      const { wrapper } = await mountBackToTop()
      await scrollTo(container, 800)
      getButton().click()
      await flush()

      expect(container.scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'auto' })
      wrapper.unmount()
    } finally {
      window.matchMedia = original
    }
  })

  it('嵌套滚动容器：内层滚动也可触发，且点击回滚的是内层容器', async () => {
    const inner = document.createElement('div')
    Object.defineProperty(inner, 'scrollTop', { configurable: true, writable: true, value: 0 })
    inner.scrollTo = vi.fn()
    container.appendChild(inner)

    const { wrapper } = await mountBackToTop()

    await scrollTo(inner, 900)
    const btn = getButton()
    expect(btn).toBeTruthy()

    btn.click()
    await flush()

    expect(inner.scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' })
    expect(container.scrollTo).not.toHaveBeenCalled()

    wrapper.unmount()
  })

  it('平滑滚动期间重复点击只触发一次（防重复提交）', async () => {
    const { wrapper } = await mountBackToTop()
    await scrollTo(container, 800)

    const btn = getButton()
    btn.click()
    btn.click()
    btn.click()
    await flush()

    expect(container.scrollTo).toHaveBeenCalledTimes(1)

    wrapper.unmount()
  })

  it('中文环境渲染「回到顶部」提示，英文环境渲染译文', async () => {
    const { wrapper } = await mountBackToTop()
    await scrollTo(container, 800)

    expect(getTooltip()).toBeTruthy()
    expect(getTooltip().textContent).toBe('回到顶部')
    expect(getButton().getAttribute('aria-label')).toBe('回到顶部')

    i18n.global.locale.value = 'en'
    await flush()
    expect(getTooltip().textContent).toBe('Back to top')
    expect(getButton().getAttribute('aria-label')).toBe('Back to top')

    wrapper.unmount()
  })

  it('路由切换后按钮收起，滚动位置不再沿用上一页', async () => {
    const { wrapper, router } = await mountBackToTop()
    await scrollTo(container, 800)
    expect(getButton()).toBeTruthy()

    await router.push('/history')
    await flush()

    expect(getButton()).toBeNull()

    wrapper.unmount()
  })

  it('找不到滚动容器时不崩溃，且保持隐藏', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      document.body.innerHTML = '' // 移除容器
      const { wrapper } = await mountBackToTop()

      expect(getButton()).toBeNull()
      expect(warn).toHaveBeenCalled()

      wrapper.unmount()
    } finally {
      warn.mockRestore()
    }
  })

  it('组件卸载后清理监听，容器再滚动不报错也不复活按钮', async () => {
    const { wrapper } = await mountBackToTop()
    await scrollTo(container, 800)
    expect(getButton()).toBeTruthy()

    wrapper.unmount()

    await scrollTo(container, 900)
    expect(getButton()).toBeNull()
  })
})
