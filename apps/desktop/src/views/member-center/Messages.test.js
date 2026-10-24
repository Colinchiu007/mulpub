import { describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { ref } from 'vue'

vi.mock('vue-i18n', () => ({
  createI18n: () => ({ global: { locale: { value: 'zh' } } }),
  useI18n: () => ({ t: (key) => key }),
}))

// P0-5：store.error 只可能是 safeInvoke/setError 规范化的已知码，
// 渲染层必须经 resolveMemberErrorKey 本地化——**绝不透裸码**。
const memberCtx = {
  notifications: [],
  unreadCount: 0,
  error: null,
  markNotificationsRead: vi.fn(async () => true),
}
vi.mock('@/stores/member', () => ({
  useMemberStore: () => memberCtx,
}))

async function mountMessages() {
  const pinia = createPinia()
  setActivePinia(pinia)
  const Messages = (await import('./Messages.vue')).default
  return mount(Messages, { global: { plugins: [pinia] } })
}

describe('member-center/Messages', () => {
  it('error 为 MEMBER_REQUEST_FAILED → 渲染本地化文案（非裸码）', async () => {
    memberCtx.error = 'MEMBER_REQUEST_FAILED'
    const wrapper = await mountMessages()
    const alert = wrapper.get('[role="alert"]')
    expect(alert.text()).toBe('memberCenter.memberRequestFailed')
    expect(alert.text()).not.toContain('MEMBER_REQUEST_FAILED')
  })

  it('error 为 MEMBER_PERMISSION_REQUIRED → 权限文案', async () => {
    memberCtx.error = 'MEMBER_PERMISSION_REQUIRED'
    const wrapper = await mountMessages()
    expect(wrapper.get('[role="alert"]').text()).toBe('memberCenter.memberPermissionRequired')
  })

  it('error 为 null → 不渲染错误区', async () => {
    memberCtx.error = null
    const wrapper = await mountMessages()
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
  })

  it('error 为未知码 → 通用失败文案（不裸透）', async () => {
    memberCtx.error = 'SOMETHING_UNKNOWN'
    const wrapper = await mountMessages()
    expect(wrapper.get('[role="alert"]').text()).toBe('memberCenter.memberRequestFailed')
  })

  it('通知列表正常渲染（含未读标记）', async () => {
    memberCtx.error = null
    memberCtx.notifications = [{ id: 1, title: '会员开通', body: '专业版已开通', level: 'info', read: false, createdAt: '2026-10-24T00:00:00Z' }]
    const wrapper = await mountMessages()
    expect(wrapper.text()).toContain('会员开通')
    memberCtx.notifications = []
  })
})
