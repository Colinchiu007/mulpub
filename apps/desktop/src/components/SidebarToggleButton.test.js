import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import SidebarToggleButton from './SidebarToggleButton.vue'
import i18n from '@/i18n'

// 全局「左侧菜单收起/展开」按钮 —— 组件契约（TDD）。
//
// 设计要点：
//   1) 原生 <button type="button">，不依赖任何 UI 框架组件（TabBar 高频路径，避免全量引入）；
//   2) aria-pressed = 当前是否已收起；aria-label/title = **下一次点击会做什么**；
//   3) 图标是内联 SVG「侧栏面板 + 方向箭头」，aria-hidden，不允许 emoji/裸字形；
//   4) 文案 zh/en 成对来自 locales（`tabBar.collapseSidebar` / `tabBar.expandSidebar`）。
//   5) **可发现性**（sidebar-toggle-ux）：常态边界/底色/图标色达标；收起态加品牌色锚点。
//
// ⚠ 关于样式断言为何读源码而不是读计算样式：
//   jsdom 不解析 Vue SFC 的 `<style scoped>`，也不支持 `::before` 伪元素与 `color-mix()` 的
//   计算值。在 jsdom 里断言样式只能得到「什么都没算出来」，会写成假绿。
//   因此样式判据落成**源级契约锁**（与本仓 `main.bundle-contract.test.js` 同模式）：
//   逐字检查 `.vue` 里是否声明了规格要求的那几条 CSS 属性。
//   真实观感由视觉基线把关（visual-testing），两者分工明确、互不冒充。

const HERE = dirname(fileURLToPath(import.meta.url))
const BUTTON_SRC = readFileSync(resolve(HERE, 'SidebarToggleButton.vue'), 'utf8')

function mountButton (props = {}, locale = 'zh') {
  i18n.global.locale.value = locale
  return mount(SidebarToggleButton, {
    props,
    global: { plugins: [i18n] },
  })
}

// 只取**几何**属性，刻意排除 fill / stroke-* 等样式属性 —— 否则
// 「几何完全一致、只换 fill」这种退化会让签名依然不等，断言假绿。
// 详见 SidebarToggleIcon.test.js 同名函数的注释与执行记录 QM-6 段。
function shapeSignature (wrapper) {
  const svg = wrapper.get('svg')
  return svg
    .findAll('rect, path, line, polyline, circle')
    .map((el) => {
      const tag = el.element.tagName.toLowerCase()
      const attrs = ['d', 'x', 'y', 'width', 'height', 'rx']
        .map((a) => `${a}=${el.attributes(a) ?? ''}`)
        .join(' ')
      return `${tag}(${attrs})`
    })
    .join('|')
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

  it('图标是内联 SVG「侧栏面板 + 方向箭头」，无文本、对辅助技术隐藏', () => {
    const w = mountButton({ collapsed: false })
    const svg = w.get('[data-testid="sidebar-toggle"] svg')

    expect(svg.attributes('aria-hidden')).toBe('true')
    expect(svg.attributes('focusable')).toBe('false')
    // 不再是双 chevron（原断言 path === 2 已按 sidebar-toggle-ux 规格作废）：
    // 面板是 rect，箭头是 path/polyline
    expect(svg.findAll('rect').length).toBeGreaterThanOrEqual(1)
    expect(w.get('[data-testid="sidebar-toggle"]').text()).toBe('')
  })

  it('英文界面：标签成对切换（Expand / Collapse sidebar）', () => {
    let w = mountButton({ collapsed: true }, 'en')
    expect(w.get('[data-testid="sidebar-toggle"]').attributes('aria-label')).toBe('Expand sidebar')

    w = mountButton({ collapsed: false }, 'en')
    expect(w.get('[data-testid="sidebar-toggle"]').attributes('aria-label')).toBe('Collapse sidebar')
  })
})

describe('SidebarToggleButton 可发现性契约（sidebar-toggle-ux）', () => {
  it('collapsed 透传给图标：两态图形签名不同', () => {
    const expanded = shapeSignature(mountButton({ collapsed: false }))
    const collapsed = shapeSignature(mountButton({ collapsed: true }))

    expect(expanded.length).toBeGreaterThan(0)
    expect(expanded).not.toBe(collapsed)
  })

  it('常态图标色为 --color-text-primary（亮色实测 15.99:1，达 WCAG AA）', () => {
    // 旧实现用 --color-text-secondary（亮色 4.40:1，不达 4.5:1）
    expect(BUTTON_SRC).toMatch(/color:\s*var\(--color-text-primary\)/)
    expect(BUTTON_SRC).not.toMatch(/^\s*color:\s*var\(--color-text-secondary\)/m)
  })

  it('常态具备非透明边框（--color-border 实测 1.04:1 等于没有，不得采用）', () => {
    // ⚠ 必须限定在 `.sidebar-toggle {…}` 基础块内取，不能在全文取第一个 `border: 1px solid`。
    // 全文匹配的脆弱点：将来若在 `:hover`/`::before` 等更靠前的规则里也写 `border: 1px solid`，
    // 断言会悄悄改判到那条规则上（仍是"非 transparent"⇒ 假绿），而基础态其实退回了透明边框。
    // 这个坑由自扮演对抗评审提出，见执行记录 QM-6 段。
    const baseBlock = BUTTON_SRC.match(/\.sidebar-toggle\s*\{([\s\S]*?)\n\}/)
    expect(baseBlock, '未找到 .sidebar-toggle 基础样式块').toBeTruthy()
    const borderDecl = baseBlock[1].match(/border:\s*1px solid ([^;]+);/)
    expect(borderDecl, '.sidebar-toggle 基础块内缺少 border: 1px solid').toBeTruthy()
    expect(borderDecl[1].trim()).not.toBe('transparent')
    // 不得退回用 --color-border 做常态边框（那是现状「看不见」的技术原因）
    expect(borderDecl[1]).not.toMatch(/var\(--color-border\)/)
  })

  it('常态具备非透明底色（不能只靠 hover 才显现）', () => {
    const bgDecl = BUTTON_SRC.match(/\.sidebar-toggle\s*\{[\s\S]*?background:\s*([^;]+);/)
    expect(bgDecl).toBeTruthy()
    expect(bgDecl[1].trim()).not.toBe('transparent')
  })

  it('按钮尺寸 32×28、图标 18px（视觉权重提升，36px 行高不变）', () => {
    expect(BUTTON_SRC).toMatch(/width:\s*32px/)
    expect(BUTTON_SRC).toMatch(/height:\s*28px/)
    expect(BUTTON_SRC).toMatch(/width:\s*18px/)
    expect(BUTTON_SRC).toMatch(/height:\s*18px/)
    // margin 必须保持与 TabBar 既有节奏一致（不得借改 margin 影响行高）
    expect(BUTTON_SRC).toMatch(/margin:\s*4px 2px 0 var\(--spacing-2\)/)
  })

  it('收起态渲染 2px 品牌色竖条作为恢复入口锚点（不占布局）', () => {
    // 竖条必须在 .is-collapsed 作用域内，用伪元素 + absolute 定位
    const collapsedBlock = BUTTON_SRC.match(/\.sidebar-toggle\.is-collapsed::before\s*\{[\s\S]*?\}/)
    expect(collapsedBlock).toBeTruthy()
    const block = collapsedBlock[0]
    expect(block).toMatch(/position:\s*absolute/)
    expect(block).toMatch(/width:\s*2px/)
    expect(block).toMatch(/background:\s*var\(--color-primary\)/)
    // absolute 定位需要相对定位基准
    expect(BUTTON_SRC).toMatch(/position:\s*relative/)
  })

  it('hover / focus-visible / 降级动效三态不回退', () => {
    expect(BUTTON_SRC).toMatch(/\.sidebar-toggle:hover/)
    expect(BUTTON_SRC).toMatch(/\.sidebar-toggle:focus-visible/)
    expect(BUTTON_SRC).toMatch(/outline:\s*2px solid var\(--color-primary\)/)
    expect(BUTTON_SRC).toMatch(/prefers-reduced-motion:\s*reduce/)
  })

  it('收起态同时挂 is-collapsed 类（供样式与测试共同定位）', () => {
    const w = mountButton({ collapsed: true })
    expect(w.get('[data-testid="sidebar-toggle"]').classes()).toContain('is-collapsed')

    const expanded = mountButton({ collapsed: false })
    expect(expanded.get('[data-testid="sidebar-toggle"]').classes()).not.toContain('is-collapsed')
  })
})
