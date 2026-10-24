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
import { RECOVERY_NOTICE_MS } from '@/composables/useOfflineStatus'
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
  // 更正（QM-6 i2）：本条原先断言 role/aria-live 挂在横幅节点上，而那个节点是
  // `v-if="isOffline"` —— live region 随断网/恢复被整块插入/移除。WCAG 4.1.3 的播报语义
  // 定义在「常驻 region 内的文本变化」上，节点被移除时「已恢复」这半边多数读屏不会播报。
  // 所以判据改成：播报锚点是**常驻**容器，横幅只是它的内容。
  it('可播报锚点是常驻容器（不随离线/恢复插入移除），横幅是它的内容', async () => {
    const { wrapper, offlineStatus } = mountIndicator()
    const live = wrapper.get('[data-testid="offline-live"]')
    expect(live.attributes('role')).toBe('status')
    expect(live.attributes('aria-live')).toBe('polite')
    expect(live.text()).toBe('')

    await goOffline(offlineStatus)
    expect(wrapper.find('[data-testid="offline-banner"]').exists()).toBe(true)
    expect(live.text()).toContain('网络已断开')
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

/**
 * 恢复播报（QM-6 i2 采纳后的新增面）：断网有播报、恢复也必须有。
 * 实现口径：常驻 live region + 一条会自己消失的「已恢复连接」提示；
 * 提示不常驻是为了不给用户留一条永久占位的横幅（恢复后它只是"刚才发生了什么"的回执）。
 */
describe('恢复态的播报（i2）', () => {
  async function goOnlineAgain (offlineStatus) {
    offlineStatus.mockResolvedValue({ code: 0, data: { offline: false, cachedCount: 0 } })
    window.dispatchEvent(new Event('online'))
    await flushPromises()
  }

  it('断网→恢复：同一常驻 region 内出现「已恢复连接」，而不是节点被整体移除', async () => {
    const { wrapper, offlineStatus } = mountIndicator()
    const live = wrapper.get('[data-testid="offline-live"]')
    await goOffline(offlineStatus)
    await goOnlineAgain(offlineStatus)
    expect(wrapper.find('[data-testid="offline-banner"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="offline-recovered"]').exists()).toBe(true)
    expect(live.text()).toContain('已恢复连接')
  })

  it('恢复提示在 RECOVERY_NOTICE_MS 后自动消失，region 文本回到空', async () => {
    vi.useFakeTimers()
    const { wrapper, offlineStatus } = mountIndicator()
    const live = wrapper.get('[data-testid="offline-live"]')
    await goOffline(offlineStatus)
    await goOnlineAgain(offlineStatus)
    expect(live.text()).toContain('已恢复连接')
    await vi.advanceTimersByTimeAsync(RECOVERY_NOTICE_MS + 1)
    expect(wrapper.find('[data-testid="offline-recovered"]').exists()).toBe(false)
    expect(live.text()).toBe('')
    vi.useRealTimers()
  })

  it('恢复后又立刻断网：两条文案不得同时出现（离线横幅优先）', async () => {
    const { wrapper, offlineStatus } = mountIndicator()
    await goOffline(offlineStatus)
    await goOnlineAgain(offlineStatus)
    await goOffline(offlineStatus)
    expect(wrapper.find('[data-testid="offline-recovered"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="offline-banner"]').exists()).toBe(true)
  })

  it('卸载必须清掉恢复提示的定时器（不留挂死的计时器）', async () => {
    vi.useFakeTimers()
    const { wrapper, offlineStatus } = mountIndicator()
    await goOffline(offlineStatus)
    await goOnlineAgain(offlineStatus)
    expect(vi.getTimerCount()).toBeGreaterThanOrEqual(1)
    wrapper.unmount()
    wrappers.splice(wrappers.indexOf(wrapper), 1)
    expect(vi.getTimerCount()).toBe(0)
    vi.useRealTimers()
  })

  it('恢复文案走 locales：zh/en 成对，英文档无中文残留', async () => {
    const zh = fs.readFileSync(path.resolve(process.cwd(), 'src/locales/common/zh.js'), 'utf8')
    const en = fs.readFileSync(path.resolve(process.cwd(), 'src/locales/common/en.js'), 'utf8')
    expect(zh).toContain('offlineRecovered')
    expect(en).toContain('offlineRecovered')

    i18n.global.locale.value = 'en'
    const { wrapper, offlineStatus } = mountIndicator()
    await goOffline(offlineStatus)
    await goOnlineAgain(offlineStatus)
    const recovered = wrapper.get('[data-testid="offline-recovered"]').text()
    expect(recovered).toContain('Connection restored')
    expect(recovered.match(/[一-鿿]/g) || []).toEqual([])
  })

  it('结构锁：role=status/aria-live 必须在常驻容器上，不得退回被 v-if 的内容节点', () => {
    // 扫描域排除注释行（本文件的说明注释里会原样写出被禁形态，那是给读者的证据）
    const codeOnly = SRC.split('\n')
      .filter((l) => !/^\s*(\/\/|\*|<!--)/.test(l))
      .join('\n')
    const bannerLine = codeOnly.split('\n').find((l) => /data-testid="offline-banner"/.test(l))
    expect(bannerLine).toBeDefined()
    expect(bannerLine).not.toContain('aria-live')
    expect(bannerLine).not.toContain('role="status"')
    const liveLine = codeOnly.split('\n').find((l) => /data-testid="offline-live"/.test(l))
    expect(liveLine).toContain('aria-live="polite"')
    expect(liveLine).toContain('role="status"')
    expect(liveLine).not.toContain('v-if')
  })
})
