/**
 * useUnsavedLeaveGuard 的回归锁（UX-AUDIT-2026-10-17 阶段 0.5）
 *
 * 四条各测一格：
 *  G1 isDirty 缺席当场抛错（不得静默降级成"不拦"）
 *  G2 有脏数据 ⇒ 导航被拦，用户确认后才放行；取消 ⇒ 绝不放行
 *  G3 无脏数据 ⇒ 不弹确认、直接放行（恒打扰与恒不拦同样是缺陷）
 *  G4 beforeunload 监听注册与**注销成对**（全局监听器泄漏是 AGENTS.md 的已知同族缺陷）
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { defineComponent, h } from 'vue'
import { mount } from '@vue/test-utils'

const guards = vi.hoisted(() => ({ list: [] }))
vi.mock('vue-router', () => ({
  onBeforeRouteLeave: (g) => { guards.list.push(g) },
}))

const confirmDanger = vi.hoisted(() => vi.fn(async () => true))
vi.mock('@/utils/confirm-danger', () => ({ confirmDanger }))

const t = vi.hoisted(() => vi.fn((key, params) => (params ? `${key}:${JSON.stringify(params)}` : key)))
vi.mock('@/i18n', () => ({ default: { global: { t } } }))

import { useUnsavedLeaveGuard } from './useUnsavedLeaveGuard'

function mountWith (options) {
  const Comp = defineComponent({
    setup () {
      useUnsavedLeaveGuard(options)
      return () => h('div', 'child')
    },
  })
  return mount(Comp)
}

describe('useUnsavedLeaveGuard', () => {
  beforeEach(() => {
    guards.list.length = 0
    confirmDanger.mockReset()
    confirmDanger.mockImplementation(async () => true)
    t.mockClear()
  })

  it('G1 isDirty 不是函数时当场抛错，不静默不拦', () => {
    expect(() => mountWith({})).toThrow(/isDirty/)
    expect(() => mountWith({ isDirty: true })).toThrow(/isDirty/)
  })

  it('G2 有脏数据时导航先弹确认；确认后放行、取消则拦住', async () => {
    let dirty = true
    mountWith({ isDirty: () => dirty, subject: () => '半成品正文' })
    expect(guards.list.length).toBe(1)
    const guard = guards.list[0]

    confirmDanger.mockImplementation(async () => false)
    expect(await guard()).toBe(false)
    expect(t).toHaveBeenCalledWith('common.unsavedLeaveMessageWithSubject', { subject: '半成品正文' })

    confirmDanger.mockImplementation(async () => true)
    expect(await guard()).toBe(true)
  })

  it('G3 无脏数据时不弹确认直接放行（摘掉 isDirty 短路必红）', async () => {
    mountWith({ isDirty: () => false })
    expect(await guards.list[0]()).toBe(true)
    expect(confirmDanger).not.toHaveBeenCalled()
  })

  it('G4 beforeunload 只在脏时拦截，且卸载后监听器被摘掉', () => {
    const addSpy = vi.spyOn(window, 'addEventListener')
    const removeSpy = vi.spyOn(window, 'removeEventListener')
    let dirty = true
    const w = mountWith({ isDirty: () => dirty })

    const added = addSpy.mock.calls.filter(c => c[0] === 'beforeunload')
    expect(added.length).toBe(1)
    const handler = added[0][1]
    const event = { preventDefault: vi.fn(), returnValue: false }
    handler(event)
    expect(event.preventDefault).toHaveBeenCalled()

    dirty = false
    const clean = { preventDefault: vi.fn() }
    handler(clean)
    expect(clean.preventDefault).not.toHaveBeenCalled()

    w.unmount()
    const removed = removeSpy.mock.calls.filter(c => c[0] === 'beforeunload')
    expect(removed.length).toBe(1)
    expect(removed[0][1]).toBe(handler)
    addSpy.mockRestore()
    removeSpy.mockRestore()
  })
})
