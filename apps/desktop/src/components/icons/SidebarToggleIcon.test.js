import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import SidebarToggleIcon from './SidebarToggleIcon.vue'

// 折叠按钮图标 —— 语义化契约（TDD，先于实现编写）。
//
// 设计要点（openspec/changes/sidebar-toggle-ux/spec.md）：
//   1) 图标必须由「左侧面板矩形 + 方向箭头」构成，不再是双向 chevron（「<>」）；
//   2) 两态**图形**必须不同（不只是换颜色）—— 颜色是单通道，对色觉障碍用户失效；
//   3) collapsed=false ⇒ 实心面板 + 朝左箭头；collapsed=true ⇒ 虚线面板 + 朝右箭头；
//   4) 对辅助技术隐藏：aria-hidden="true" + focusable="false"（状态语义由按钮承担）。
//
// 这里用「图形签名」比较而不是逐条断言 path 的 d 字面量：
// 后者会把测试绑死在具体坐标上，改一像素就要改测试，是过拟合。
// 签名 = 所有图元标签名 + 关键几何属性，两态签名不相等即证明图形确实变了。
// ⚠ 只取**几何**属性（d / x / y / width / height / rx），**刻意排除 fill、stroke-* 等样式属性**。
//
// 为什么排除：本条用例要防的退化是「同一图形只换颜色」。若把 fill 也算进签名，
// 那么「两态几何完全一致、只有 fill 不同」这种典型退化会让签名**依然不等**，
// 断言照样通过 ⇒ **假绿**。这个假绿路径有反证实验确认过（见
// openspec/records/sidebar-toggle-ux.md 的 QM-6 段「自扮演对抗评审」）。
// 排除样式属性后，几何签名相等 ⇔ 形状真的没变，断言才咬得住。
// 「面板实心 vs 虚线」这类样式差异由下面独立的用例负责，不混进这一条。
function shapeSignature (wrapper) {
  const svg = wrapper.get('svg')
  const primitives = svg.findAll('rect, path, line, polyline, circle')
  return primitives
    .map((el) => {
      const tag = el.element.tagName.toLowerCase()
      const attrs = ['d', 'x', 'y', 'width', 'height', 'rx']
        .map((a) => `${a}=${el.attributes(a) ?? ''}`)
        .join(' ')
      return `${tag}(${attrs})`
    })
    .join('|')
}

describe('SidebarToggleIcon 语义化图形契约', () => {
  it('两态图形签名不相等（防止退化成「同一图形换颜色」）', () => {
    const expanded = shapeSignature(mount(SidebarToggleIcon, { props: { collapsed: false } }))
    const collapsed = shapeSignature(mount(SidebarToggleIcon, { props: { collapsed: true } }))

    expect(expanded.length).toBeGreaterThan(0)
    expect(collapsed.length).toBeGreaterThan(0)
    expect(expanded).not.toBe(collapsed)
  })

  it('collapsed 默认 false ⇒ 渲染展开态图形', () => {
    const withDefault = shapeSignature(mount(SidebarToggleIcon))
    const explicitExpanded = shapeSignature(mount(SidebarToggleIcon, { props: { collapsed: false } }))

    expect(withDefault).toBe(explicitExpanded)
  })

  it('包含「侧栏面板」矩形与「方向箭头」两类图元（不是纯 chevron）', () => {
    const expanded = mount(SidebarToggleIcon, { props: { collapsed: false } })

    // 面板：矩形图元存在
    expect(expanded.findAll('rect').length).toBeGreaterThanOrEqual(1)
    // 箭头：至少一条 path 或 polyline 承载箭头
    expect(
      expanded.findAll('path').length + expanded.findAll('polyline').length,
    ).toBeGreaterThanOrEqual(1)
  })

  it('展开态面板实心、收起态面板虚线（状态差异进图形，不只进颜色）', () => {
    const expandedRect = mount(SidebarToggleIcon, { props: { collapsed: false } }).get('rect')
    const collapsedRect = mount(SidebarToggleIcon, { props: { collapsed: true } }).get('rect')

    // 展开态：有 fill（或 fill 不是 none）且无 stroke-dasharray
    const expandedFill = expandedRect.attributes('fill')
    expect(expandedFill).toBeTruthy()
    expect(expandedFill).not.toBe('none')
    expect(expandedRect.attributes('stroke-dasharray')).toBeUndefined()

    // 收起态：虚线（stroke-dasharray 存在）或明确 fill=none
    const dashedOrHollow =
      Boolean(collapsedRect.attributes('stroke-dasharray')) ||
      collapsedRect.attributes('fill') === 'none'
    expect(dashedOrHollow).toBe(true)
  })

  it('对辅助技术隐藏：aria-hidden + focusable=false', () => {
    const svg = mount(SidebarToggleIcon).get('svg')

    expect(svg.attributes('aria-hidden')).toBe('true')
    expect(svg.attributes('focusable')).toBe('false')
  })

  it('使用 currentColor 跟随主题，不硬编码颜色字面量', () => {
    const w = mount(SidebarToggleIcon, { props: { collapsed: false } })
    const markup = w.html()

    // 允许 currentColor / none；不允许 #rrggbb、rgb()、rgba() 之类写死色值
    expect(markup).not.toMatch(/#[0-9a-fA-F]{3,8}["'\s]/)
    expect(markup).not.toMatch(/\brgba?\(/)
    expect(markup).toMatch(/currentColor/)
  })
})
