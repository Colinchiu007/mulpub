import { beforeEach, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import TabBar from './TabBar.vue'
import { useTabStore } from '@/stores/tab'
import { sidebarCollapsed } from '@/stores/sidebar-collapse'
import i18n from '@/i18n'

// TabBar 接入全局侧边栏折叠按钮 —— 行为契约（TDD，先于实现编写）。
//
// 放置决策（PRD §四）：按钮在 TabBar 最左侧、**标签滚动区之外**，因此
//   · 与 TabBar 同高（36px），不新增行高 ⇒ WebContentsView TOP=76px 契约不变；
//   · 标签很多时横向滚动也不会把它滚出视野；
//   · ARIA：根节点不再是 tablist（它同时含折叠按钮与「+」按钮），
//     tablist 语义收窄到 `.tab-bar-tabs`。
function seedTabs () {
  const store = useTabStore()
  store.tabs = [
    { tabId: 'home', url: '', title: '首页', isHome: true, loading: false },
    { tabId: 't1', url: 'https://creator.douyin.com/', title: '抖音', isHome: false, loading: false },
  ]
  store.activeTabId = 'home'
  return store
}

function mountBar () {
  seedTabs()
  return mount(TabBar, { global: { plugins: [i18n] } })
}

beforeEach(() => {
  setActivePinia(createPinia())
  i18n.global.locale.value = 'zh'
  sidebarCollapsed.value = false
  window.localStorage.clear()
})

describe('TabBar 全局侧边栏折叠按钮', () => {
  it('按钮位于标签滚动区之前（固定在最左侧，不随标签滚动）', () => {
    const w = mountBar()
    const rootChildren = Array.from(w.get('.tab-bar').element.children)
    const toggleIndex = rootChildren.findIndex(
      (el) => el.getAttribute('data-testid') === 'sidebar-toggle',
    )
    const tabsIndex = rootChildren.findIndex(
      (el) => el.classList.contains('tab-bar-tabs'),
    )

    expect(toggleIndex).toBe(0)
    expect(tabsIndex).toBeGreaterThan(toggleIndex)
    expect(w.get('.tab-bar-tabs').find('[data-testid="sidebar-toggle"]').exists()).toBe(false)
  })

  it('点击按钮切换全局折叠状态：图标标签与 aria-pressed 跟随变化', async () => {
    const w = mountBar()
    expect(w.get('[data-testid="sidebar-toggle"]').attributes('aria-pressed')).toBe('false')

    await w.get('[data-testid="sidebar-toggle"]').trigger('click')
    expect(sidebarCollapsed.value).toBe(true)
    expect(window.localStorage.getItem('mulpub.ui.sidebarCollapsed')).toBe('1')
    expect(w.get('[data-testid="sidebar-toggle"]').attributes('aria-pressed')).toBe('true')
    expect(w.get('[data-testid="sidebar-toggle"]').attributes('aria-label')).toBe('展开左侧菜单')

    await w.get('[data-testid="sidebar-toggle"]').trigger('click')
    expect(sidebarCollapsed.value).toBe(false)
    expect(w.get('[data-testid="sidebar-toggle"]').attributes('aria-pressed')).toBe('false')
    expect(w.get('[data-testid="sidebar-toggle"]').attributes('aria-label')).toBe('收起左侧菜单')
  })

  it('折叠按钮不参与标签语义：tablist 只包住真正的标签', () => {
    const w = mountBar()
    const tabs = w.get('.tab-bar-tabs')

    expect(w.get('.tab-bar').attributes('role')).toBeUndefined()
    expect(tabs.attributes('role')).toBe('tablist')
    expect(tabs.attributes('aria-label')).toBe('标签页')
    expect(tabs.findAll('[role="tablist"]')).toHaveLength(0)
    expect(tabs.get('[data-testid="tab-home"]').attributes('role')).toBe('tab')
  })

  it('折叠按钮不吞掉既有标签交互（切换/新建/关闭仍走原事件）', async () => {
    const w = mountBar()

    await w.get('[data-testid="sidebar-toggle"]').trigger('click')
    await w.get('[data-testid="tab-t1"]').trigger('click')
    await w.get('[data-testid="tab-add"]').trigger('click')
    await w.get('[data-testid="tab-close-t1"]').trigger('click')

    expect(w.emitted('switch-tab')).toEqual([['t1']])
    expect(w.emitted('create-tab')).toHaveLength(1)
    expect(w.emitted('close-tab')).toEqual([['t1']])
    // 折叠按钮不进 tab 事件
    expect(w.emitted('switch-tab')).toHaveLength(1)
  })
})
