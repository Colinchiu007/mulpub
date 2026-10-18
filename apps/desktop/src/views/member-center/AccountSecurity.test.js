import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { ref } from 'vue'

vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key) => key }) }))

// audit-13（major）：会员中心「退出登录」与「退出其他设备」此前一点即执行，
// 后者撤销的远程会话无法找回。两条都必须先过统一确认原语。
const confirmDanger = vi.hoisted(() => vi.fn(async () => true))
vi.mock('@/utils/confirm-danger', () => ({ confirmDanger }))

// ⚠️ `vi.hoisted` 会被提升到本文件所有 import **之前**执行，所以工厂里**不能**引用
// 顶部 import 进来的绑定（`ref` 会命中 TDZ：ReferenceError: Cannot access
// '__vi_import_1__' before initialization ⇒ 整个文件 0 条用例被执行，而它曾长期"全绿"，
// 因为集合失败不贡献任何测试数，只看 `Tests N passed` 完全看不出）。
// 需要宿主导出时走异步形态：在工厂内部自己 import，vitest 会等待它完成。
const identity = await vi.hoisted(async () => {
  const { ref } = await import('vue')
  return {
    status: ref('authenticated'),
    user: ref({ sub: 'sub-1', name: '用户甲', username: 'user-a' }),
    displayName: ref('用户甲'),
    loading: ref(false),
    switchAccount: vi.fn(async () => true),
    signOut: vi.fn(async () => true),
  }
})
vi.mock('@/composables/useIdentity', () => ({ useIdentity: () => identity }))

// 夹具形态必须与被测代码的访问方式同形：组件按 **Pinia store** 的用法读
// `memberStore.loading` / `memberStore.sessions.length`（store 会自动解包 ref）。
// 若这里给的是裸 `{ loading: ref(false), sessions: ref([...]) }`，
// 则 `sessions.length` 取到 undefined ⇒ `!length` 为真 ⇒ 按钮恒禁用，
// 而 confirmDanger「没被调用」看起来像守卫没生效（本案第一次跑出用例时的真实红因）。
const memberStore = await vi.hoisted(async () => {
  const { reactive } = await import('vue')
  return reactive({
    loading: false,
    sessions: [{ id: 's1', deviceId: 'dev-2', lastSeenAt: '2026-10-01T00:00:00Z' }],
    revokeOtherSessions: vi.fn(async () => true),
  })
})
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

  it('空闲态两个按钮必须可点（旧判据 pending !== 动作名 把方向写反 ⇒ 按钮恒灰，用户点不动）', async () => {
    const wrapper = await flush(mountView())

    const switchBtn = wrapper.get('[data-testid="member-center-switch"]')
    const signOutBtn = wrapper.get('[data-testid="member-center-signout"]')
    expect(switchBtn.element.disabled, '切换账号在空闲态不得禁用').toBe(false)
    expect(signOutBtn.element.disabled, '退出登录在空闲态不得禁用').toBe(false)

    identity.loading.value = true
    await flush(wrapper)
    expect(wrapper.get('[data-testid="member-center-switch"]').element.disabled, '加载中必须禁用').toBe(true)
    identity.loading.value = false
    await flush(wrapper)
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
