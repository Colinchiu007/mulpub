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

  // 归属 openspec change add-account-name-source 的「所有展示账号名的界面必须共用同一口径」
  // 需求。此前本组件只读 `account.name`，而主进程写进 `name` 的正是 document.title
  // （auth-view-manager 的 captured.name），于是发布页选择器显示的是「首页 - 知乎」这类
  // 网页标题，且用户改的名在这里永远不可见 —— 选错账号发布无从察觉。
  describe('账号显示名必须与账号卡片同源（resolveAccountDisplayName）', () => {
    const mountWith = (accounts) => mount(PublishTargetSelector, {
      props: {
        groups: [{
          label: '国内平台',
          items: [{ id: 'zhihu', label: '知乎', accounts }],
        }],
        selectedPlatforms: ['zhihu'],
        selectedAccounts: {},
      },
    })
    const nameOf = (wrapper) => wrapper.get('[data-testid="account-display-name"]').text()

    it('auto 来源的统计块脏值与网页标题都被过滤，回落平台名', () => {
      expect(nameOf(mountWith([
        { id: 'zh-1', account_name: '485.9万人看过', name: '首页 - 知乎', name_source: 'auto' },
      ]))).toBe('知乎')
    })

    it('manual 来源原样显示，含被守卫判脏的形态也不过滤', () => {
      expect(nameOf(mountWith([
        { id: 'zh-1', account_name: '阿飞 - 自由职业', name: '首页 - 知乎', name_source: 'manual' },
      ]))).toBe('阿飞 - 自由职业')
    })

    it('非噪声的抓取昵称正常显示，不被平台名覆盖', () => {
      expect(nameOf(mountWith([
        { id: 'zh-1', account_name: '数字生命丘丘', name: '首页 - 知乎', name_source: 'auto' },
      ]))).toBe('数字生命丘丘')
    })

    it('全部字段不合格时回落平台名，平台名也拿不到才用 id 前 8 位', () => {
      expect(nameOf(mountWith([{ id: 'abcdefgh1234', name: '' }]))).toBe('知乎')
      const noLabel = mount(PublishTargetSelector, {
        props: {
          groups: [{ label: '国内平台', items: [{ id: 'x', label: '', accounts: [{ id: 'abcdefgh1234' }] }] }],
          selectedPlatforms: ['x'],
          selectedAccounts: {},
        },
      })
      expect(noLabel.get('[data-testid="account-display-name"]').text()).toBe('abcdefgh')
    })

    it('搜索命中显示名，不再命中被守卫隐藏的网页标题', async () => {
      const wrapper = mountWith([
        { id: 'zh-1', account_name: '数字生命丘丘', name: '首页 - 知乎', name_source: 'auto' },
      ])
      // 命中当前显示值
      await wrapper.get('input[type="search"]').setValue('丘丘')
      expect(wrapper.findAll('[data-testid^="account-zhihu-"]').length).toBe(1)
      // 「首页」只存在于被过滤掉的 name 里；旧实现用 raw account.name 匹配，这一条会命中
      await wrapper.get('input[type="search"]').setValue('首页')
      expect(wrapper.findAll('[data-testid^="account-zhihu-"]').length).toBe(0)
    })
  })
})
