import { mount } from '@vue/test-utils'
import i18n from '@/i18n'
import { nextTick } from 'vue'
import { describe, expect, it } from 'vitest'
import AccountManagementCard from './AccountManagementCard.vue'

const account = {
  id: 'account-1',
  platform: 'zhihu',
  status: 'active',
  account_name: '知乎测试账号',
}

function mountCard (props = {}) {
  return mount(AccountManagementCard, {
    props: {
      account,
      platformLabel: '知乎',
      platformIcon: '知',
      batchMode: true,
      ...props,
    },
    global: {
      plugins: [i18n],
    },
  })
}

describe('AccountManagementCard', () => {
  it('选择框提供账号名称并上抛选择和收藏事件', async () => {
    const wrapper = mountCard()
    const checkbox = wrapper.get('[data-testid="select-account-1"]')

    expect(checkbox.attributes('aria-label')).toBe('选择 知乎测试账号')
    await checkbox.setValue(true)
    await wrapper.get('[data-testid="favorite-account-1"]').trigger('click')

    expect(wrapper.emitted('toggle-select')).toEqual([['account-1']])
    expect(wrapper.emitted('toggle-favorite')).toEqual([['account-1']])
  })

  it('活动账号显示已登录状态徽章和稳定选择器', () => {
    const wrapper = mountCard()
    const status = wrapper.get('[data-testid="account-status-account-1"]')

    expect(wrapper.get('[data-testid="account-card-account-1"]').exists()).toBe(true)
    expect(status.text()).toBe('已登录')
    expect(status.attributes('role')).toBe('status')
    expect(status.attributes('aria-label')).toBe('账号登录状态：已登录')
    expect(status.classes()).toContain('online')
  })

  it('活动账号展示验证、设置和删除命令', async () => {
    const wrapper = mountCard()

    await wrapper.get('[data-testid="verify-account-1"]').trigger('click')
    await wrapper.get('[data-testid="proxy-account-1"]').trigger('click')
    await wrapper.get('[data-testid="delete-account-1"]').trigger('click')

    expect(wrapper.emitted('check-login')).toEqual([[account]])
    expect(wrapper.emitted('configure-proxy')).toEqual([[account]])
    expect(wrapper.emitted('remove')).toEqual([[account]])
    // 活动账号未在 checkedExpiredIds 中，不显示「去登录」按钮（仅失效账号显示）
    expect(wrapper.find('[data-testid="login-account-1"]').exists()).toBe(false)
  })

  it('非批量模式隐藏账号选择框', () => {
    const wrapper = mountCard({ batchMode: false })

    expect(wrapper.find('[data-testid="select-account-1"]').exists()).toBe(false)
  })

  it('失效账号（checkedExpiredIds 命中）展示「已失效」徽章、登录按钮并上抛原始账号对象', async () => {
    const expiredAccount = { ...account, status: 'expired' }
    const checkedExpiredIds = new Set(['account-1'])
    const wrapper = mountCard({ account: expiredAccount, checkedExpiredIds })

    // expired 状态显示「已失效」，不再误显示「已登录」
    const status = wrapper.get('[data-testid="account-status-account-1"]')
    expect(status.text()).toBe('已失效')
    expect(status.classes()).toContain('expired')
    await wrapper.get('[data-testid="login-account-1"]').trigger('click')

    expect(wrapper.emitted('open-login')).toEqual([[expiredAccount]])
  })

  it('历史脏值 inactive / offline 不再谎称「已登录」，统一落到未检查兜底', () => {
    for (const dirty of ['inactive', 'offline']) {
      const wrapper = mountCard({ account: { ...account, status: dirty } })
      const badge = wrapper.get('[data-testid="account-status-account-1"]')

      expect(badge.text()).toBe('暂无检查记录')
      expect(badge.classes()).toContain('unknown')
    }
  })

  it('停用账号显示「已停用」标记并灰化卡片，登录徽章不受影响（正交）', () => {
    const wrapper = mountCard({ account: { ...account, is_active: false } })
    const flag = wrapper.get('[data-testid="account-disabled-flag"]')

    expect(flag.text()).toBe('已停用')
    expect(flag.attributes('role')).toBe('status')
    expect(flag.attributes('aria-label')).toBe('该账号已停用，不可用于发布')
    expect(wrapper.get('[data-testid="account-card-account-1"]').classes()).toContain('is-disabled')
    expect(wrapper.get('[data-testid="account-status-account-1"]').text()).toBe('已登录')
  })

  it('is_active 缺失或为脏值时按启用处理，不显示停用标记', () => {
    for (const candidate of [{}, { is_active: true }, { is_active: 'no' }, { is_active: 0 }]) {
      const wrapper = mountCard({ account: { ...account, ...candidate } })

      expect(wrapper.find('[data-testid="account-disabled-flag"]').exists()).toBe(false)
      expect(wrapper.get('[data-testid="account-card-account-1"]').classes()).not.toContain('is-disabled')
    }
  })

  it('未确认（unverified）显示独立的「未确认」徽章，不冒充已登录也不冒充失效', () => {
    const unverifiedAccount = { ...account, status: 'unverified' }
    const wrapper = mountCard({ account: unverifiedAccount })

    const status = wrapper.get('[data-testid="account-status-account-1"]')
    expect(status.text()).toBe('未确认')
    expect(status.classes()).toContain('unverified')
    // 与「从未检测」的 unknown 徽章区分开：unverified 表示检测发生过但无法判定
    expect(status.classes()).not.toContain('unknown')
    // 未确认不进入失效集合 → 不提供「去登录」按钮
    expect(wrapper.find('[data-testid="login-account-1"]').exists()).toBe(false)
  })

  it('未知状态保持诚实提示，checkedExpiredIds 命中时提供登录动作', async () => {
    const unknownAccount = { ...account, status: 'unknown' }
    const checkedExpiredIds = new Set(['account-1'])
    const wrapper = mountCard({ account: unknownAccount, checkedExpiredIds })
    const status = wrapper.get('[data-testid="account-status-account-1"]')

    expect(status.text()).toBe('暂无检查记录')
    expect(status.classes()).toContain('unknown')
    await wrapper.get('[data-testid="login-account-1"]').trigger('click')
    expect(wrapper.emitted('open-login')).toEqual([[unknownAccount]])
  })

  it('异常状态显示异常徽章并在非法检查时间后回退失败原因', () => {
    const failedAccount = {
      ...account,
      status: 'error',
      checked_at: 'not-a-date',
      status_reason: 'Cookie 已过期',
    }
    const wrapper = mountCard({ account: failedAccount })
    const status = wrapper.get('[data-testid="account-status-account-1"]')

    expect(status.text()).toBe('异常')
    expect(status.classes()).toContain('error')
    expect(wrapper.get('[data-testid="account-check-account-1"]').text()).toBe('异常：Cookie 已过期')
  })

  it('有检查时间时优先展示最近检查时间', () => {
    const wrapper = mountCard({
      account: {
        ...account,
        checked_at: '2026-08-04T08:00:00.000Z',
        login_check_error: 'Cookie 已过期',
      },
    })

    // loginCheckLabel 优先展示最近检查时间（LAST_CHECK_KEYS），再展示失败原因
    expect(wrapper.get('[data-testid="account-check-account-1"]').text()).toContain('最近检查')
  })

  it('按参考产品卡片语义展示粉丝数、负责人、运营人和代理字段', () => {
    const wrapper = mountCard({
      account: {
        ...account,
        followers: 2048,
        owner: '团队甲',
        publisher: '秋叔',
        proxy: '127.0.0.1:7890',
      },
    })

    expect(wrapper.get('[data-testid="account-followers-account-1"]').text()).toContain('粉丝：2048')
    expect(wrapper.get('[data-testid="account-owner-account-1"]').text()).toContain('负责人')
    expect(wrapper.get('[data-testid="account-owner-account-1"]').text()).toContain('团队甲')
    expect(wrapper.get('[data-testid="account-publisher-account-1"]').text()).toContain('运营人')
    expect(wrapper.get('[data-testid="account-publisher-account-1"]').text()).toContain('秋叔')
    expect(wrapper.get('[data-testid="account-proxy-account-1"]').text()).toContain('127.0.0.1:7890')
  })

  it('缺少参考产品归属字段时显示未设置而不是伪造数据', () => {
    const wrapper = mountCard()

    expect(wrapper.get('[data-testid="account-followers-account-1"]').text()).toContain('粉丝：暂无数据')
    expect(wrapper.get('[data-testid="account-owner-account-1"]').text()).toContain('未设置')
    expect(wrapper.get('[data-testid="account-publisher-account-1"]').text()).toContain('未设置')
    expect(wrapper.get('[data-testid="account-proxy-account-1"]').text()).toContain('未设置')
  })

  it('归属徽章按参考产品契约分色：负责人蓝、运营人灰、代理紫', () => {
    const wrapper = mountCard()

    const ownerBadge = wrapper.get('[data-testid="account-owner-account-1"] span')
    const publisherBadge = wrapper.get('[data-testid="account-publisher-account-1"] span')
    const proxyBadge = wrapper.get('[data-testid="account-proxy-account-1"] span')

    expect(ownerBadge.classes()).toContain('assignee-owner')
    expect(publisherBadge.classes()).toContain('assignee-publisher')
    expect(proxyBadge.classes()).toContain('assignee-proxy')
    const kinds = new Set([ownerBadge.classes(), publisherBadge.classes(), proxyBadge.classes()]
      .flat()
      .filter(cls => cls.startsWith('assignee-') && cls !== 'assignee-badge'))
    expect(kinds.size).toBe(3)
  })

  it('只在名称非空且发生变化时上抛重命名', async () => {
    const wrapper = mountCard()
    await wrapper.get('.account-name-button').trigger('click')
    await nextTick()
    await wrapper.get('.account-name-input').setValue('  新名称  ')
    await wrapper.get('.account-name-input').trigger('blur')

    expect(wrapper.emitted('rename')).toEqual([[account, '新名称']])

    await wrapper.get('.account-name-button').trigger('click')
    await nextTick()
    await wrapper.get('.account-name-input').setValue('   ')
    await wrapper.get('.account-name-input').trigger('blur')
    expect(wrapper.emitted('rename')).toHaveLength(1)
  })

  it('非批量模式点击卡片整体打开创作者中心（对齐参考产品全屏标签交互）', async () => {
    const wrapper = mountCard({ batchMode: false })
    await wrapper.get('[data-testid="account-card-account-1"]').trigger('click')

    expect(wrapper.emitted('open-creator')).toEqual([[account]])
    expect(wrapper.emitted('toggle-select')).toBeUndefined()
  })

  it('批量模式点击卡片改为切换选中，不误打开创作者中心', async () => {
    const wrapper = mountCard()
    await wrapper.get('[data-testid="account-card-account-1"]').trigger('click')

    expect(wrapper.emitted('toggle-select')).toEqual([['account-1']])
    expect(wrapper.emitted('open-creator')).toBeUndefined()
  })

  it.skip('卡片内操作按钮点击不冒泡触发打开创作者中心', async () => {
    const wrapper = mountCard({ batchMode: false })
    await wrapper.get('[data-testid="delete-account-1"]').trigger('click')

    expect(wrapper.emitted('remove')).toEqual([[account]])
    expect(wrapper.emitted('open-creator')).toBeUndefined()

    await wrapper.get('[data-testid="login-account-1"]').trigger('click')
    expect(wrapper.emitted('open-login')).toEqual([[account]])
  })

  it('键盘 Enter/Space 激活卡片打开创作者中心（无障碍）', async () => {
    const wrapper = mountCard({ batchMode: false })
    const card = wrapper.get('[data-testid="account-card-account-1"]')

    expect(card.attributes('role')).toBe('button')
    expect(card.attributes('tabindex')).toBe('0')
    await card.trigger('keydown.enter')
    await card.trigger('keydown.space')

    expect(wrapper.emitted('open-creator')).toHaveLength(2)
  })
})
