import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import PlatformAccountGroup from './PlatformAccountGroup.vue'

const group = {
  platform: 'wechat_mp',
  activeCount: 1,
  inactiveCount: 1,
  accounts: [
    { id: 'a1', platform: 'wechat_mp', name: '主账号', status: 'active', is_default: true },
    { id: 'a2', platform: 'wechat_mp', name: '备用账号', status: 'inactive' },
  ],
}

describe('PlatformAccountGroup', () => {
  it('渲染平台统计、账号状态和默认标记', () => {
    const wrapper = mount(PlatformAccountGroup, {
      props: { group, platformLabel: '微信公众号', platformIcon: '微' },
    })

    expect(wrapper.text()).toContain('微信公众号')
    expect(wrapper.text()).toContain('1 个有效')
    expect(wrapper.text()).toContain('1 个离线')
    expect(wrapper.text()).toContain('默认账号')
  })

  it('将选择、收藏和账号命令作为事件上抛', async () => {
    const wrapper = mount(PlatformAccountGroup, {
      props: {
        group,
        platformLabel: '微信公众号',
        platformIcon: '微',
        selectedIds: new Set(['a1']),
        favoriteIds: new Set(),
      },
    })

    await wrapper.get('[data-testid="select-a2"]').setValue(true)
    await wrapper.get('[data-testid="favorite-a2"]').trigger('click')
    await wrapper.get('[data-testid="check-a2"]').trigger('click')

    expect(wrapper.emitted('toggle-select')?.[0]).toEqual(['a2'])
    expect(wrapper.emitted('toggle-favorite')?.[0]).toEqual(['a2'])
    expect(wrapper.emitted('check')?.[0]).toEqual([group.accounts[1]])
  })

  it('上抛重命名、设为默认、打开和删除命令', async () => {
    const wrapper = mount(PlatformAccountGroup, {
      props: { group, platformLabel: '微信公众号', platformIcon: '微' },
    })
    const secondRow = wrapper.findAll('.account-row')[1]
    const nameInput = secondRow.get('.account-name-input')
    await nameInput.setValue('新名称')
    await nameInput.trigger('blur')
    const setDefault = secondRow.get('[data-testid="set-default-a2"]')
    const open = secondRow.get('[data-testid="open-a2"]')
    const check = secondRow.get('[data-testid="check-a2"]')
    const proxy = secondRow.get('[data-testid="proxy-a2"]')
    const remove = secondRow.get('[data-testid="delete-a2"]')
    await setDefault.trigger('click')
    await open.trigger('click')
    await proxy.trigger('click')
    await remove.trigger('click')

    expect(wrapper.emitted('rename')?.[0]).toEqual([group.accounts[1], '新名称'])
    expect(wrapper.emitted('set-default')?.[0]).toEqual([group.accounts[1]])
    expect(wrapper.emitted('open')?.[0]).toEqual([group.accounts[1]])
    expect(wrapper.emitted('configure-proxy')?.[0]).toEqual([group.accounts[1]])
    expect(wrapper.emitted('remove')?.[0]).toEqual([group.accounts[1]])
    for (const control of [setDefault, open, check, proxy, remove]) {
      expect(control.attributes('data-e2e-scan')).toBe('manual')
    }
  })

  it('平台标题和状态摘要具有可访问名称', () => {
    const wrapper = mount(PlatformAccountGroup, {
      props: { group, platformLabel: '微信公众号', platformIcon: '微' },
    })
    const section = wrapper.get('.account-platform-group')
    const heading = wrapper.get('.platform-heading h2')

    expect(heading.attributes('id')).toBeDefined()
    expect(section.attributes('aria-labelledby')).toBe(heading.attributes('id'))
    expect(heading.attributes('id')).toContain('wechat_mp')
    expect(wrapper.get('.platform-summary').attributes('role')).toBe('status')
    expect(wrapper.get('.platform-summary').attributes('aria-label')).toContain('1 个有效')
  })
})

describe('PlatformAccountGroup 头像失效回落（PRD-ACCOUNT-PROFILE-INFO T10）', () => {
  const avatars = {
    platform: 'wechat_mp',
    activeCount: 2,
    inactiveCount: 0,
    accounts: [
      { id: 'a1', platform: 'wechat_mp', name: '主账号', status: 'active', avatar: 'https://cdn/1.png' },
      { id: 'a2', platform: 'wechat_mp', name: '备用账号', status: 'active', avatar: 'https://cdn/2.png' },
    ],
  }

  function mountGroup () {
    return mount(PlatformAccountGroup, {
      props: { group: avatars, platformLabel: '微信公众号', platformIcon: '微' },
    })
  }

  it('单个账号头像加载失败只回落该账号，不影响同组其他账号', async () => {
    const wrapper = mountGroup()
    expect(wrapper.findAll('.account-row')[0].find('.account-avatar img').exists()).toBe(true)

    await wrapper.findAll('.account-row')[0].get('.account-avatar img').trigger('error')

    expect(wrapper.findAll('.account-row')[0].find('.account-avatar img').exists()).toBe(false)
    expect(wrapper.findAll('.account-row')[0].find('.account-avatar svg').exists()).toBe(true)
    expect(wrapper.findAll('.account-row')[1].find('.account-avatar img').exists()).toBe(true)
  })
})
