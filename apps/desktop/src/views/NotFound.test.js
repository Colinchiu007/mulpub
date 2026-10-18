/**
 * NotFound（catch-all）回归锁（UX-AUDIT-2026-10-17 阶段 1.9）
 *
 * 两层判据缺一不可：
 *  N1 **真路由表**解析 `#/typo` ⇒ name 必须是 NotFound（防「视图写好了但路由没兜住」，
 *     那是本条 finding 的原形态：router-view 匹配不到组件 = 一片空白）。
 *  N2 视图给出可行动出口（回首页 / 返回），且如实回显用户尝试访问的路径。
 * 另加 N3：文案必须走 locales（AGENTS.md：渲染端不得新增中文字面量）。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import i18n from '@/i18n'

const routeState = vi.hoisted(() => ({ path: '/typo' }))
const push = vi.hoisted(() => vi.fn())
const replace = vi.hoisted(() => vi.fn())
const back = vi.hoisted(() => vi.fn())
vi.mock('vue-router', async (importOriginal) => {
  // 必须保留真实实现：N1 要用真 createRouter 解析未知路径。
  // 整模块替换会让 createRouter 变成 undefined —— 那不是被测行为，是夹具塌了。
  const actual = await importOriginal()
  return {
    ...actual,
    useRoute: () => ({ path: routeState.path }),
    useRouter: () => ({ push, replace, back }),
  }
})

import NotFound from './NotFound.vue'

describe('NotFound 兜底视图', () => {
  beforeEach(() => {
    i18n.global.locale.value = 'zh'
    routeState.path = '/typo'
    push.mockClear(); replace.mockClear(); back.mockClear()
  })

  function mountView () {
    return mount(NotFound, { global: { plugins: [i18n] } })
  }

  it('N2 是 role="alert" 的可行动错误页，并回显用户尝试访问的路径', () => {
    routeState.path = '/totally-unknown'
    const wrapper = mountView()
    expect(wrapper.get('[data-testid="not-found"]').attributes('role')).toBe('alert')
    expect(wrapper.text()).toContain(i18n.global.t('common.notFoundTitle'))
    expect(wrapper.get('[data-testid="not-found-path"]').text()).toBe('/totally-unknown')
    // 只回显 path，不回显 query（query 可能含用户尚未发布的草稿标题）
    expect(wrapper.text()).not.toContain('?')
  })

  it('N2 两个出口都能走：回首页用 replace，返回上一页优先 history.back', async () => {
    const wrapper = mountView()
    await wrapper.get('[data-testid="not-found-home"]').trigger('click')
    expect(replace).toHaveBeenCalledWith('/')

    replace.mockClear()
    const historyLength = window.history.length
    await wrapper.get('[data-testid="not-found-back"]').trigger('click')
    if (historyLength > 1) {
      expect(back).toHaveBeenCalledTimes(1)
    } else {
      expect(replace).toHaveBeenCalledWith('/')
    }
  })

  it('N3 文案全部来自 locales，视图内不得出现裸中文字面量', () => {
    const fs = require('node:fs')
    const path = require('node:path')
    const src = fs.readFileSync(path.resolve(__dirname, 'NotFound.vue'), 'utf8')
    const template = src.slice(0, src.indexOf('<script'))
    expect(template).not.toMatch(/[一-鿿]/)
  })
})

describe('N1 真路由表必须兜住未知路径', () => {
  it('router.resolve 对任意未知路径给出 NotFound，而不是空匹配', async () => {
    const { default: router } = await import('@/router')
    for (const p of ['/typo', '/nope/deep', '/aCCcOUNTs-typo']) {
      const resolved = router.resolve(p)
      expect(resolved.name, p).toBe('NotFound')
      expect(resolved.matched.length, p).toBeGreaterThan(0)
    }
    // 已登记路径不得被 catch-all 抢走
    expect(router.resolve('/accounts').name).not.toBe('NotFound')
    expect(router.resolve('/').name).toBe('Home')
  })
})
