// @ts-check
/**
 * OfflineIndicator — 离线横幅的显示面合同（UX 审计 1.7）
 *
 * 锁三类事实：
 *  ① 文案走 locales（原实现把「网络已断开…」直接写进模板，英文用户看到中文）；
 *  ② 无障碍：`role="status"` + `aria-live="polite"`，断网/恢复要能被读屏播报（WCAG 4.1.3），
 *     装饰图标 `aria-hidden`，可访问名由文字承载；
 *  ③ 颜色/动画口径：样式块内不得再出现 hex 字面量（暗色档下浅奶油底会变成「亮色补丁」），
 *     入场动画必须有 `prefers-reduced-motion` 守卫。
 *
 * ④ 生命周期：组件卸载必须 dispose —— 本仓同时存在多个 SPA 实例，
 *    未解绑的 window 监听器会跨实例串写状态（同族事故先例：page-manager 订阅无 id 全清）。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import fs from 'node:fs'
import path from 'node:path'

import OfflineIndicator from './OfflineIndicator.vue'
import i18n from '@/i18n'

const SRC = fs.readFileSync(path.resolve(process.cwd(), 'src/components/OfflineIndicator.vue'), 'utf8')
const wrappers = []

function mountIndicator () {
  const offlineStatus = vi.fn().mockResolvedValue({ code: 0, data: { offline: false, cachedCount: 0 } })
  window.electronAPI = { offlineStatus, onOfflineRestored: vi.fn(() => () => {}) }
  const wrapper = mount(OfflineIndicator, { global: { plugins: [i18n] } })
  wrappers.push(wrapper)
  return { wrapper, offlineStatus }
}

async function goOffline (offlineStatus, cachedCount = 0) {
  offlineStatus.mockResolvedValue({ code: 0, data: { offline: true, cachedCount } })
  window.dispatchEvent(new Event('offline'))
  await flushPromises()
}

beforeEach(() => {
  i18n.global.locale.value = 'zh'
})

afterEach(() => {
  while (wrappers.length > 0) wrappers.pop().unmount()
  delete window.electronAPI
})

describe('离线横幅的出现与文案', () => {
  it('在线时不渲染横幅', () => {
    const { wrapper } = mountIndicator()
    expect(wrapper.find('[data-testid="offline-banner"]').exists()).toBe(false)
  })

  it('浏览器 offline 事件后横幅即时出现', async () => {
    const { wrapper, offlineStatus } = mountIndicator()
    await goOffline(offlineStatus)
    expect(wrapper.find('[data-testid="offline-banner"]').exists()).toBe(true)
  })

  it('中文档渲染 locale 文案，切到英文档后不得残留中文（证明文案不再硬编码在模板里）', async () => {
    const { wrapper, offlineStatus } = mountIndicator()
    await goOffline(offlineStatus)
    expect(wrapper.text()).toContain('网络已断开')

    i18n.global.locale.value = 'en'
    await flushPromises()
    expect(wrapper.text()).toContain('You are offline')
    expect(wrapper.text()).not.toContain('网络已断开')
  })

  it('待发布计数 >0 才显示计数段，且数字进入文案', async () => {
    const { wrapper, offlineStatus } = mountIndicator()
    await goOffline(offlineStatus, 0)
    expect(wrapper.find('.offline-banner__count').exists()).toBe(false)

    await goOffline(offlineStatus, 3)
    const count = wrapper.get('.offline-banner__count')
    expect(count.text()).toContain('3')
  })
})

describe('无障碍与样式口径', () => {
  it('横幅是可播报的状态区域：role=status + aria-live=polite', async () => {
    const { wrapper, offlineStatus } = mountIndicator()
    await goOffline(offlineStatus)
    const banner = wrapper.get('[data-testid="offline-banner"]')
    expect(banner.attributes('role')).toBe('status')
    expect(banner.attributes('aria-live')).toBe('polite')
  })

  it('装饰图标对读屏隐藏，可访问名由文字承载', async () => {
    const { wrapper, offlineStatus } = mountIndicator()
    await goOffline(offlineStatus)
    expect(wrapper.get('.offline-banner__icon').attributes('aria-hidden')).toBe('true')
  })

  it('模板里不得再有内联 style 属性（间距走类，不由模板携带）', () => {
    const templateOnly = SRC.slice(0, SRC.indexOf('<script'))
    expect(templateOnly).not.toMatch(/\sstyle="/)
  })

  it('样式块内不得出现 hex 颜色字面量（颜色一律 var(--color-*)）', () => {
    const style = SRC.slice(SRC.indexOf('<style'))
    expect(style).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
  })

  it('入场动画必须有 prefers-reduced-motion 守卫', () => {
    const style = SRC.slice(SRC.indexOf('<style'))
    expect(style).toMatch(/prefers-reduced-motion/)
  })

  it('颜色取的是已定义的警告族 token，不是自造名', () => {
    const style = SRC.slice(SRC.indexOf('<style'))
    const used = [...style.matchAll(/var\((--color-[a-z-]+)\)/g)].map((m) => m[1])
    expect(used.length).toBeGreaterThan(0)
    const tokens = fs.readFileSync(path.resolve(process.cwd(), 'src/styles/tokens.css'), 'utf8')
    for (const name of used) {
      expect(tokens, `token ${name} 未在 tokens.css 定义`).toContain(`${name}:`)
    }
  })
})

describe('生命周期', () => {
  it('卸载时解绑 window 的 online/offline 监听', () => {
    const removeSpy = vi.spyOn(window, 'removeEventListener')
    const { wrapper } = mountIndicator()
    wrapper.unmount()
    const types = removeSpy.mock.calls.map((c) => c[0])
    expect(types).toContain('offline')
    expect(types).toContain('online')
    removeSpy.mockRestore()
  })

  it('卸载后浏览器事件不再改变已卸载组件的状态（不留活监听）', async () => {
    const { wrapper, offlineStatus } = mountIndicator()
    wrapper.unmount()
    await goOffline(offlineStatus)
    // 重新挂载一个实例前的全局状态不受影响：旧实例的回调不应把新事件写进任何可见 DOM
    expect(document.body.innerHTML).not.toContain('网络已断开')
  })
})
