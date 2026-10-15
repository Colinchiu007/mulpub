import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import PublishTargetSelector from './PublishTargetSelector.vue'

describe('PublishTargetSelector', () => {
  it('搜索框具有可访问名称', () => {
    const wrapper = mount(PublishTargetSelector, { props: { groups: [] } })
    expect(wrapper.get('input[type="search"]').attributes('aria-label')).toBe('搜索发布平台或账号')
    expect(wrapper.get('.target-selector__list').attributes('role')).toBe('list')
  })

  it('没有可操作分组时不渲染「按组添加」，且 section 的直接子节点仍是改前的两个（视觉中性的 DOM 级证据）', () => {
    const without = mount(PublishTargetSelector, { props: { groups, accountGroups: [] } })
    expect(without.find('[data-testid="publish-group-picker"]').exists()).toBe(false)

    // 结构锁断言的是**改前就存在的形态**：section 的直接子节点历来是 [搜索框, 列表]。
    // 空态下仍必须恰好是这两个，多一个节点就是给 CI 空 profile 制造像素漂移。
    // ⚠️ 不要退回成 `without.html() === legacy.html()`：那种写法两次挂载跑的是同一份新代码，
    // 只差"显式传空数组 vs 走默认值"，对本刀声称的"与改前一致"是恒真断言（装饰性门禁）。
    const children = without.get('section.target-selector').element.children
    expect([...children].map(el => el.tagName.toLowerCase())).toEqual(['input', 'div'])
    expect(children[1].className).toBe('target-selector__list')
  })

  it('accountGroups 会转发为 apply-group（组件不持有选中集）', async () => {
    const wrapper = mount(PublishTargetSelector, {
      props: { groups, accountGroups: [{ id: 'g1', name: '主力', applicable: 1, total: 2 }] },
    })
    expect(wrapper.find('[data-testid="publish-group-picker"]').exists()).toBe(true)
    await wrapper.get('[data-testid="group-apply-g1"]').trigger('click')
    expect(wrapper.emitted('apply-group')).toEqual([['g1']])
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

  // publish-add-account-entry（2026-10-15）：空态从「一句灰字」升级为「一句灰字 + 添加按钮
  // + 刷新链接」。契约见 01-docs/PRD-PUBLISH-ADD-ACCOUNT-ENTRY-2026-10-15.md。
  // 组件保持哑组件：两个出口都只 emit 事件，不碰 store、不 import tabStore。
  describe('无账号平台的空态出口（添加 / 刷新）', () => {
    const emptyGroups = [{
      label: '国内平台',
      items: [{ id: 'zhihu', label: '知乎', accounts: [] }],
    }]

    it('空态渲染「添加」按钮与「点击刷新」链接，且带 platformId 上报（L7）', async () => {
      const wrapper = mount(PublishTargetSelector, {
        props: { groups: emptyGroups, selectedPlatforms: ['zhihu'], selectedAccounts: {} },
      })

      const addBtn = wrapper.get('[data-testid="add-account-zhihu"]')
      const refreshLink = wrapper.get('[data-testid="refresh-accounts-zhihu"]')
      expect(addBtn.text()).toBe('添加')
      expect(refreshLink.text()).toContain('已经添加成功？点击刷新')
      expect(addBtn.attributes('aria-label')).toContain('知乎')

      await addBtn.trigger('click')
      await refreshLink.trigger('click')
      expect(wrapper.emitted('add-account')).toEqual([['zhihu']])
      expect(wrapper.emitted('refresh-accounts')).toEqual([['zhihu']])
    })

    it('有账号的平台不渲染这两个出口（L8）', () => {
      // 注意：groups 常量里 zhihu 的 accounts 是空数组（那是空态用例的平台），
      // 本条要断言的是"有账号"那一侧，必须用 wechat_mp（accounts 非空）。
      const wrapper = mount(PublishTargetSelector, {
        props: { groups, selectedPlatforms: ['wechat_mp'], selectedAccounts: {} },
      })

      expect(wrapper.find('[data-testid="add-account-wechat_mp"]').exists()).toBe(false)
      expect(wrapper.find('[data-testid="refresh-accounts-wechat_mp"]').exists()).toBe(false)
      expect(wrapper.find('[data-testid="account-wechat_mp-wx-1"]').exists()).toBe(true)
    })

    it('v-bind 合同：驼峰 on* 键名必须命中 kebab 事件名（Publish.vue 用 v-bind="addAccountBindings"）', async () => {
      // 这是本次重构最脆的一环：Publish.vue 不再逐个写 @add-account/@refresh-accounts，
      // 而是 v-bind 一个 { refreshingAccounts, onAddAccount, onRefreshAccounts } 对象。
      // 该写法只有在 Vue 的 emit 归一化（camelize('add-account') → onAddAccount）成立时才对；
      // 本用例把这个"应该会转"变成实测，避免将来键名漂移后事件静默失效。
      const onAddAccount = vi.fn()
      const onRefreshAccounts = vi.fn()
      const wrapper = mount(PublishTargetSelector, {
        props: {
          groups: emptyGroups,
          selectedPlatforms: ['zhihu'],
          selectedAccounts: {},
          refreshingAccounts: false,
          onAddAccount,
          onRefreshAccounts,
        },
      })

      await wrapper.get('[data-testid="add-account-zhihu"]').trigger('click')
      await wrapper.get('[data-testid="refresh-accounts-zhihu"]').trigger('click')

      expect(onAddAccount).toHaveBeenCalledWith('zhihu')
      expect(onRefreshAccounts).toHaveBeenCalledWith('zhihu')
    })

    it('disabled（发布中）时按钮与链接均禁用（L9）', () => {
      const wrapper = mount(PublishTargetSelector, {
        props: { groups: emptyGroups, selectedPlatforms: ['zhihu'], selectedAccounts: {}, disabled: true },
      })

      expect(wrapper.get('[data-testid="add-account-zhihu"]').element.disabled).toBe(true)
      expect(wrapper.get('[data-testid="refresh-accounts-zhihu"]').element.disabled).toBe(true)
    })

    it('refreshingAccounts=true 时链接禁用、文案切「刷新中...」并带 aria-busy（L10）', () => {
      const wrapper = mount(PublishTargetSelector, {
        props: {
          groups: emptyGroups,
          selectedPlatforms: ['zhihu'],
          selectedAccounts: {},
          refreshingAccounts: true,
        },
      })

      const link = wrapper.get('[data-testid="refresh-accounts-zhihu"]')
      expect(link.element.disabled).toBe(true)
      expect(link.text()).toBe('刷新中...')
      expect(link.attributes('aria-busy')).toBe('true')
      // 刷新中「添加」仍可用：用户可能想同时去加另一个平台
      expect(wrapper.get('[data-testid="add-account-zhihu"]').element.disabled).toBe(false)
    })
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

  // P0-2 风控挂起可见性（发布页优化 roadmap）：挂起账号/平台在选择器上显示徽标 +
  // 行动指引 tooltip（发布前可见，而非发布时被派发前置守卫拦截才知道）。
  // 键语义与 risk-suspender-store 一致：平台级（accountId==null）覆盖全部账号；账号级仅命中对应账号。
  describe('风控挂起徽标（riskSuspended 注入）', () => {
    const riskGroups = [{
      label: '国内平台',
      items: [{
        id: 'zhihu',
        label: '知乎',
        accounts: [{ id: 'zh-1', name: '主账号' }, { id: 'zh-2', name: '副账号' }],
      }],
    }]

    it('账号级挂起：命中账号显示徽标，未命中账号不显示', () => {
      const wrapper = mount(PublishTargetSelector, {
        props: {
          groups: riskGroups,
          selectedPlatforms: ['zhihu'],
          selectedAccounts: {},
          riskSuspended: [{ platform: 'zhihu', accountId: 'zh-1', reason: 'risk_blocked', at: 1 }],
        },
      })

      expect(wrapper.get('[data-testid="target-account-risk-flag-zhihu-zh-1"]').text()).toBe('⚠ 风控挂起')
      expect(wrapper.find('[data-testid="target-account-risk-flag-zhihu-zh-2"]').exists()).toBe(false)
    })

    it('平台级挂起（accountId==null）：该平台全部账号都显示徽标，平台行也显示', () => {
      const wrapper = mount(PublishTargetSelector, {
        props: {
          groups: riskGroups,
          selectedPlatforms: ['zhihu'],
          selectedAccounts: {},
          riskSuspended: [{ platform: 'zhihu', accountId: null, reason: 'risk_blocked', at: 1 }],
        },
      })

      expect(wrapper.get('[data-testid="target-account-risk-flag-zhihu-zh-1"]').exists()).toBe(true)
      expect(wrapper.get('[data-testid="target-account-risk-flag-zhihu-zh-2"]').exists()).toBe(true)
      expect(wrapper.get('[data-testid="target-platform-risk-flag-zhihu"]').text()).toBe('⚠ 风控挂起')
    })

    it('徽标带行动指引 tooltip（参考产品口径：去创作者中心验证）', () => {
      const wrapper = mount(PublishTargetSelector, {
        props: {
          groups: riskGroups,
          selectedPlatforms: ['zhihu'],
          selectedAccounts: {},
          riskSuspended: [{ platform: 'zhihu', accountId: 'zh-1', reason: 'risk_blocked', at: 1 }],
        },
      })

      const title = wrapper.get('[data-testid="target-account-risk-flag-zhihu-zh-1"]').attributes('title')
      expect(title).toContain('创作者中心')
      expect(title).toContain('解除挂起')
    })

    it('无挂起清单时零徽标（零打扰）', () => {
      const wrapper = mount(PublishTargetSelector, {
        props: {
          groups: riskGroups,
          selectedPlatforms: ['zhihu'],
          selectedAccounts: {},
          riskSuspended: [],
        },
      })

      expect(wrapper.findAll('[data-testid^="target-account-risk-flag"]').length).toBe(0)
      expect(wrapper.findAll('[data-testid^="target-platform-risk-flag"]').length).toBe(0)
    })

    it('其它平台的挂起不牵连本平台', () => {
      const wrapper = mount(PublishTargetSelector, {
        props: {
          groups: riskGroups,
          selectedPlatforms: ['zhihu'],
          selectedAccounts: {},
          riskSuspended: [{ platform: 'douyin', accountId: null, reason: 'risk_blocked', at: 1 }],
        },
      })

      expect(wrapper.findAll('[data-testid^="target-account-risk-flag-zhihu"]').length).toBe(0)
    })
  })
})
