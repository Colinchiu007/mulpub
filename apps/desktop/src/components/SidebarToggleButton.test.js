import { afterEach, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import SidebarToggleButton from './SidebarToggleButton.vue'
import i18n from '@/i18n'

// 全局「左侧菜单收起/展开」按钮 —— 组件契约（TDD，先于实现编写）。
//
// 设计要点（PRD-SIDEBAR-COLLAPSE-TOGGLE-2026-10-18 §六）：
//   1) 原生 <button type="button">，不依赖任何 UI 框架组件（TabBar 高频路径，避免全量引入）；
//   2) aria-pressed = 当前是否已收起；aria-label/title = **下一次点击会做什么**；
//   3) 图标是内联 SVG 双 chevron（形似「<>」），aria-hidden，不允许 emoji/裸字形；
//   4) 文案 zh/en 成对来自 locales（`tabBar.collapseSidebar` / `tabBar.expandSidebar`）。
function mountButton (props = {}, locale = 'zh') {
  i18n.global.locale.value = locale
  return mount(SidebarToggleButton, {
    props,
    global: { plugins: [i18n] },
  })
}

afterEach(() => {
  i18n.global.locale.value = 'zh'
})

describe('SidebarToggleButton 交互与可访问性契约', () => {
  it('展开态：按钮提示「收起左侧菜单」，aria-pressed=false', () => {
    const w = mountButton({ collapsed: false })
    const button = w.get('[data-testid="sidebar-toggle"]')

    expect(button.attributes('type')).toBe('button')
    expect(button.attributes('aria-label')).toBe('收起左侧菜单')
    expect(button.attributes('title')).toBe('收起左侧菜单')
    expect(button.attributes('aria-pressed')).toBe('false')
    expect(button.attributes('disabled')).toBeUndefined()
  })

  it('收起态：按钮提示「展开左侧菜单」，aria-pressed=true', () => {
    const w = mountButton({ collapsed: true })
    const button = w.get('[data-testid="sidebar-toggle"]')

    expect(button.attributes('aria-label')).toBe('展开左侧菜单')
    expect(button.attributes('title')).toBe('展开左侧菜单')
    expect(button.attributes('aria-pressed')).toBe('true')
  })

  it('点击只触发 toggle 事件（不自行改状态，状态归全局 store）', async () => {
    const w = mountButton({ collapsed: false })
    await w.get('[data-testid="sidebar-toggle"]').trigger('click')

    expect(w.emitted('toggle')).toHaveLength(1)
  })

  it('图标是内联 SVG 双 chevron（形似 <>），无文本、对辅助技术隐藏', () => {
    const w = mountButton({ collapsed: false })
    const svg = w.get('[data-testid="sidebar-toggle"] svg')

    expect(svg.attributes('aria-hidden')).toBe('true')
    expect(svg.attributes('focusable')).toBe('false')
    expect(svg.findAll('path')).toHaveLength(2)
    expect(w.get('[data-testid="sidebar-toggle"]').text()).toBe('')
  })

  it('英文界面：标签成对切换（Expand / Collapse sidebar）', () => {
    let w = mountButton({ collapsed: true }, 'en')
    expect(w.get('[data-testid="sidebar-toggle"]').attributes('aria-label')).toBe('Expand sidebar')

    w = mountButton({ collapsed: false }, 'en')
    expect(w.get('[data-testid="sidebar-toggle"]').attributes('aria-label')).toBe('Collapse sidebar')
  })
})
