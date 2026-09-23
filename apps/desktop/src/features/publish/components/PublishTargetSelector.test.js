import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import PublishTargetSelector from './PublishTargetSelector.vue'

describe('PublishTargetSelector', () => {
  it('搜索框具有可访问名称', () => {
    const wrapper = mount(PublishTargetSelector, { props: { groups: [] } })
    expect(wrapper.get('input[type="search"]').attributes('aria-label')).toBe('搜索发布平台或账号')
    expect(wrapper.get('.target-selector__list').attributes('role')).toBe('list')
  })
  const groups = [{
    label: '国内平台',
    items: [
      { id: 'wechat_mp', label: '微信公众号', accounts: [{ id: 'wx-1', name: '主账号' }] },
      { id: 'zhihu', label: '知乎', accounts: [] },
    ],
  }]

  it('渲染平台及多账号选择状态', () => {
    const wrapper = mount(PublishTargetSelector, {
      props: {
        groups,
        selectedPlatforms: ['wechat_mp'],
        selectedAccounts: { wechat_mp: ['wx-1'] },
      },
    })

    expect(wrapper.get('[data-testid="platform-wechat_mp"]').element.checked).toBe(true)
    expect(wrapper.get('[data-testid="account-wechat_mp-wx-1"]').element.checked).toBe(true)
  })

  it('平台和账号操作只通过事件上报', async () => {
    const wrapper = mount(PublishTargetSelector, {
      props: {
        groups,
        selectedPlatforms: [],
        selectedAccounts: {},
      },
    })

    await wrapper.get('[data-testid="platform-wechat_mp"]').setValue(true)
    expect(wrapper.emitted('toggle-platform')[0]).toEqual(['wechat_mp'])

    await wrapper.setProps({ selectedPlatforms: ['wechat_mp'] })
    await wrapper.get('[data-testid="account-wechat_mp-wx-1"]').setValue(true)
    expect(wrapper.emitted('toggle-account')[0]).toEqual(['wechat_mp', 'wx-1'])
  })

  it('已选但无账号的平台显示阻断提示', () => {
    const wrapper = mount(PublishTargetSelector, {
      props: {
        groups,
        selectedPlatforms: ['zhihu'],
        selectedAccounts: {},
      },
    })

    expect(wrapper.text()).toContain('请先添加账号')
  })

  it('停用账号显示「已停用」标记且复选框禁用', () => {
    const disabledGroups = [{
      label: '国内平台',
      items: [{
        id: 'wechat_mp',
        label: '微信公众号',
        accounts: [
          { id: 'wx-1', name: '主账号', disabled: true },
          { id: 'wx-2', name: '副账号', disabled: false },
        ],
      }],
    }]
    const wrapper = mount(PublishTargetSelector, {
      props: { groups: disabledGroups, selectedPlatforms: ['wechat_mp'], selectedAccounts: {} },
    })

    expect(wrapper.get('[data-testid="account-wechat_mp-wx-1"]').element.disabled).toBe(true)
    expect(wrapper.get('[data-testid="account-wechat_mp-wx-2"]').element.disabled).toBe(false)
    expect(wrapper.get('[data-testid="target-account-disabled-flag"]').text()).toBe('已停用')
  })
})
