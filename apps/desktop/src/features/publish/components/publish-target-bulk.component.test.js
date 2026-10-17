/**
 * usePublishTargetBulk.js 的组件层测试（publish-target-select-all）
 *
 * 锁三类事：
 * A. **空 profile 视觉中性**：没有可发布平台时全选/清空整行不渲染 —— section 的直接子节点
 *    必须仍恰为 [input, div]（搜索框 + 列表）。这是构造性中性手段（CI 空 profile 下
 *    accountGroups 恒空、可发布平台集合恒空），不是可以事后补基线的漂移。
 *    断言的是**改前就存在的形态**，不是"改前 html == 改后 html"（后者两次挂载跑同一份
 *    新代码，恒真）。
 * B. **哑组件**：组件不持有选中集、不碰 store，全选/清空只 emit 事件。
 * C. **禁用态**：disabled（发布中）与"没有选中可清空"两条路径分别处理。
 */
import { describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import PublishTargetSelector from './PublishTargetSelector.vue'
import i18n from '@/i18n'

const bulkGroups = [{
  label: '国内平台',
  items: [
    { id: 'wechat_mp', label: '微信公众号', accounts: [{ id: 'wx-1', name: '主账号' }] },
    { id: 'zhihu', label: '知乎', accounts: [] },
  ],
}]

// 可发布平台集合由上层算好注入（组件保持哑组件，不自己数 accounts）。
function mountBulk (props = {}) {
  return mount(PublishTargetSelector, {
    props: {
      groups: bulkGroups,
      selectedPlatforms: [],
      selectedAccounts: {},
      ...props,
    },
  })
}

describe('PublishTargetSelector — 全选 / 清空（publish-target-select-all）', () => {
  it('空 profile 下 section 直接子节点仍恰为 [input, div]：全选行与分组行都不渲染（L8 视觉中性）', () => {
    // canSelectAll=false + accountGroups=[] ⇒ 两个新增块都必须缺席。
    const wrapper = mountBulk({ canSelectAll: false, accountGroups: [] })

    expect(wrapper.find('[data-testid="target-bulk-toolbar"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="target-select-all"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="target-clear-all"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="publish-group-picker"]').exists()).toBe(false)

    const children = wrapper.get('section.target-selector').element.children
    expect([...children].map(el => el.tagName.toLowerCase())).toEqual(['input', 'div'])
    expect(children[1].className).toBe('target-selector__list')
  })

  it('canSelectAll=true 时渲染全选/清空一行，且只 emit 事件（组件不持有选中集，L9）', async () => {
    // selectedPlatforms 非空：清空按钮在"没有选中可清空"时是 disabled 的，
    // 这里要测的是 emit 合同，必须让它可点。
    const wrapper = mountBulk({
      canSelectAll: true,
      publishableCount: 3,
      selectedPlatforms: ['wechat_mp'],
      selectAllAriaLabel: '选中所有可发布的平台（3 个）',
    })

    const selectAll = wrapper.get('[data-testid="target-select-all"]')
    const clearAll = wrapper.get('[data-testid="target-clear-all"]')
    expect(selectAll.text()).toBe(i18n.global.t('publishPage.targetBulk.selectAll'))
    expect(clearAll.text()).toBe(i18n.global.t('publishPage.targetBulk.clearAll'))
    expect(selectAll.attributes('aria-label')).toBe('选中所有可发布的平台（3 个）')

    await selectAll.trigger('click')
    await clearAll.trigger('click')
    expect(wrapper.emitted('select-all')).toEqual([[]])
    expect(wrapper.emitted('clear-all')).toEqual([[]])
  })

  it('没有选中平台时「清空」disabled（点了无效果，禁用以示无可清空，L10）', () => {
    const wrapper = mountBulk({ canSelectAll: true, publishableCount: 3, selectedPlatforms: [] })
    expect(wrapper.get('[data-testid="target-clear-all"]').element.disabled).toBe(true)

    const withSelection = mountBulk({ canSelectAll: true, publishableCount: 3, selectedPlatforms: ['wechat_mp'] })
    expect(withSelection.get('[data-testid="target-clear-all"]').element.disabled).toBe(false)
  })

  it('disabled（发布中）时全选与清空均禁用且不产出事件（L10）', async () => {
    const wrapper = mountBulk({
      canSelectAll: true,
      publishableCount: 3,
      selectedPlatforms: ['wechat_mp'],
      disabled: true,
    })

    expect(wrapper.get('[data-testid="target-select-all"]').element.disabled).toBe(true)
    expect(wrapper.get('[data-testid="target-clear-all"]').element.disabled).toBe(true)
    await wrapper.get('[data-testid="target-select-all"]').trigger('click')
    expect(wrapper.emitted('select-all')).toBeUndefined()
  })

  it('v-bind 合同：驼峰 on* 键名必须命中 kebab 事件名（Publish.vue 用 v-bind 绑定，L11）', async () => {
    const onSelectAll = vi.fn()
    const onClearAll = vi.fn()
    const wrapper = mount(PublishTargetSelector, {
      props: {
        groups: bulkGroups,
        selectedPlatforms: ['wechat_mp'],
        selectedAccounts: {},
        canSelectAll: true,
        publishableCount: 3,
        onSelectAll,
        onClearAll,
      },
    })

    await wrapper.get('[data-testid="target-select-all"]').trigger('click')
    await wrapper.get('[data-testid="target-clear-all"]').trigger('click')
    expect(onSelectAll).toHaveBeenCalledTimes(1)
    expect(onClearAll).toHaveBeenCalledTimes(1)
  })

  it('分组 chip 的 tooltip 带「已选/成员」，供点击前预告（§2.3）', () => {
    const wrapper = mountBulk({
      accountGroups: [{ id: 'g1', name: '主力号', applicable: 2, total: 3, selected: 1 }],
    })

    const chip = wrapper.get('[data-testid="group-apply-g1"]')
    expect(chip.attributes('title')).toContain('1/3')
    expect(chip.attributes('title')).toContain(i18n.global.t('publishPage.groupPicker.selectedCount', { selected: 1, total: 3 }))
  })

  it('accountGroups 缺省为空数组时不渲染分组行（零回归：P2-8b 既有约定）', () => {
    const wrapper = mountBulk({ canSelectAll: true, publishableCount: 3 })
    expect(wrapper.find('[data-testid="publish-group-picker"]').exists()).toBe(false)
  })
})
