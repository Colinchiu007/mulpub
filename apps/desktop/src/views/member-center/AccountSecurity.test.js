import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { ref } from 'vue'

vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key) => key }) }))

// audit-13（major）：会员中心「退出登录」与「退出其他设备」此前一点即执行，
// 后者撤销的远程会话无法找回。两条都必须先过统一确认原语。
const confirmDanger = vi.hoisted(() => vi.fn(async () => true))
vi.mock('@/utils/confirm-danger', () => ({ confirmDanger }))

const identity = vi.hoisted(() => ({
  status: ref('authenticated'),
  user: ref({ sub: 'sub-1', name: '用户甲', username: 'user-a' }),
  displayName: ref('用户甲'),
  loading: ref(false),
  switchAccount: vi.fn(async () => true),
  signOut: vi.fn(async () => true),
}))
vi.mock('@/composables/useIdentity', () => ({ useIdentity: () => identity }))

const memberStore = vi.hoisted(() => ({
  loading: ref(false),
  sessions: ref([{ id: 's1', deviceId: 'dev-2', lastSeenAt: '2026-10-01T00:00:00Z' }]),
  revokeOtherSessions: vi.fn(async () => true),
}))
vi.mock('@/stores/member', () => ({ useMemberStore: () => memberStore }))

import AccountSecurity from './AccountSecurity.vue'

async function flush (wrapper) {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await wrapper.vm.$nextTick()
  return wrapper
}

function mountView () {
  return mount(AccountSecurity, { attachTo: document.body })
}

describe('AccountSecurity 破坏性操作的确认守卫', () => {
  beforeEach(() => {
    confirmDanger.mockReset()
    confirmDanger.mockImplementation(async () => true)
    identity.signOut.mockClear()
    identity.switchAccount.mockClear()
    memberStore.revokeOtherSessions.mockClear()
  })

  it('确认通过后将退出登录，确认文案走 locales 键（不得硬编码中文）', async () => {
    const wrapper = await flush(mountView())

    await wrapper.get('[data-testid="member-center-signout"]').trigger('click')
    await flush(wrapper)

    expect(confirmDanger).toHaveBeenCalledTimes(1)
    expect(confirmDanger.mock.calls[0][0].message).toBe('memberCenter.signOutConfirmMessage')
    expect(identity.signOut).toHaveBeenCalledTimes(1)
  })

  it('用户取消退出登录时不得调用 signOut', async () => {
    confirmDanger.mockImplementation(async () => false)
    const wrapper = await flush(mountView())

    await wrapper.get('[data-testid="member-center-signout"]').trigger('click')
    await flush(wrapper)

    expect(confirmDanger).toHaveBeenCalledTimes(1)
    expect(identity.signOut).not.toHaveBeenCalled()
  })

  it('撤销其他会话先弹确认，文案说明不可撤销', async () => {
    const wrapper = await flush(mountView())

    await wrapper.get('[data-testid="member-center-revoke-others"]').trigger('click')
    await flush(wrapper)

    expect(confirmDanger).toHaveBeenCalledTimes(1)
    expect(confirmDanger.mock.calls[0][0].message).toBe('memberCenter.revokeOthersConfirmMessage')
    expect(memberStore.revokeOtherSessions).toHaveBeenCalledTimes(1)
  })

  it('用户取消撤销时不得调用 revokeOtherSessions', async () => {
    confirmDanger.mockImplementation(async () => false)
    const wrapper = await flush(mountView())

    await wrapper.get('[data-testid="member-center-revoke-others"]').trigger('click')
    await flush(wrapper)

    expect(memberStore.revokeOtherSessions).not.toHaveBeenCalled()
  })

  it('接线守卫：视图内不得直接消费 ElMessageBox，也不得自造确认弹窗', async () => {
    const fs = require('fs')
    const path = require('path')
    const src = fs.readFileSync(path.resolve(__dirname, 'AccountSecurity.vue'), 'utf8')
    expect(src).toContain("from '@/utils/confirm-danger'")
    expect(src).not.toMatch(/ElMessageBox/)
  })
})
