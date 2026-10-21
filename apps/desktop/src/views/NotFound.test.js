// @ts-check
/**
 * 未知路由兜底页（UX 审计 1.9）
 *
 * 这里锁的是**用户可见的三条事实**，而不是组件内部写法：
 *  ① 匹配不到任何记录的地址，必须渲染一个看得见、读得懂的页面，并回显用户输入的那条路径；
 *  ② 用户必须能离开 —— 「回到主页」恒在；「返回上一页」只在**确实可后退**时出现；
 *  ③ 页面不泄漏内部实现（视图文件名 / chunk 名 / 异常文本）。
 *
 * 第 ② 条特别锁一条反模式：**用 `window.history.length` 判断能否后退**。
 * 本应用是 hash 模式 SPA，`history.length` 含应用外条目与浏览器会话残留，
 * 会把「栈首、无处可退」读成「能后退」，于是给出一个点了没反应的按钮。
 * 唯一实现是 `composables/useSpaNavHistory`（读 vue-router 写入的 `history.state.position`）。
 *
 * ⚠️ 夹具必须用 `createWebHashHistory`：`useSpaNavHistory` 读的是真实 `window.history.state`，
 * `createMemoryHistory` 不写它 —— 用内存历史会让「能否后退」这一整类判定在测试里恒为假，
 * 表现恰好与「按钮不出现」的用例期望相同，从而把错实现也测成绿。
 * 另：jsdom 的 `history.back()` 是 no-op（同 `useSpaNavHistory.test.js` 的既有结论），
 * 因此「点击返回上一页」只能断言它**发起了后退**，真实回退语义由 composable 自己那份测试覆盖。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createRouter, createMemoryHistory, createWebHashHistory } from 'vue-router'

import NotFound from './NotFound.vue'
import { routes } from '@/router'
import i18n from '@/i18n'

const STUB = { template: '<div />' }
const UNKNOWABLE = '/no-such-page?from=audit'
const wrappers = []

/** 只含三条路由的最小表：避免在单测里懒加载 Collection/Publish 等重视图 */
function minimalRouter () {
  const router = createRouter({
    history: createWebHashHistory(),
    routes: [
      { path: '/', name: 'Home', component: STUB },
      { path: '/collection', name: 'Collection', component: STUB },
      { path: '/:pathMatch(.*)*', name: 'NotFound', component: NotFound },
    ],
  })
  return router
}

/** 全新会话：归零 vue-router 的 position 游标（同 useSpaNavHistory.test.js 的做法） */
function resetSession () {
  window.history.replaceState(null, '', '#/')
}

async function mountAt (path, { pushFirst } = {}) {
  resetSession()
  const router = minimalRouter()
  if (pushFirst) await router.push(pushFirst)
  await router.push(path)
  await flushPromises()
  const wrapper = mount(NotFound, { global: { plugins: [i18n, router] } })
  wrappers.push(wrapper)
  await flushPromises()
  return { wrapper, router }
}

beforeEach(() => {
  while (wrappers.length > 0) wrappers.pop().unmount()
  i18n.global.locale.value = 'zh'
  resetSession()
})

describe('真实路由表能接住未知地址（消费 router/index.js 的 routes）', () => {
  it('未登记的地址解析到 NotFound，而不是「匹配不到任何记录」', async () => {
    const router = createRouter({ history: createMemoryHistory(), routes })
    await router.push('/clearly/not/a/route')
    await router.isReady()
    expect(router.currentRoute.value.name).toBe('NotFound')
  })

  it('具体已登记路由不被兜底路由抢走', () => {
    const router = createRouter({ history: createMemoryHistory(), routes })
    // resolve 不触发组件加载，只问「这条地址归谁」——避免把整页依赖拖进单测
    expect(router.resolve('/collection').name).toBe('Collection')
    expect(router.resolve('/board/p-1').name).toBe('ProductionBoard')
  })
})

describe('兜底页可见内容', () => {
  it('回显用户试图访问的路径原样文本（含 query）', async () => {
    const { wrapper } = await mountAt(UNKNOWABLE)
    const shown = wrapper.get('[data-testid="not-found-path"]').text()
    expect(shown).toContain('/no-such-page')
    expect(shown).toContain('from=audit')
  })

  it('不是空白内容区：至少有一个标题、一段说明和可点击出口', async () => {
    const { wrapper } = await mountAt(UNKNOWABLE)
    expect(wrapper.find('h1').exists()).toBe(true)
    expect(wrapper.find('[data-testid="not-found-go-home"]').exists()).toBe(true)
    expect(wrapper.text().trim().length).toBeGreaterThan(10)
  })

  it('不泄漏内部实现细节（视图文件名、chunk 名、异常栈字样）', async () => {
    const { wrapper } = await mountAt(UNKNOWABLE)
    const text = wrapper.text()
    for (const leak of ['NotFound.vue', '.js', 'chunk', 'Error:']) {
      expect(text, `兜底页不得出现「${leak}」`).not.toContain(leak)
    }
  })
})

describe('两个出口的可见性由「是否真的做得到」决定', () => {
  /**
   * 把 vue-router 的栈游标钉到指定值并按真实 popstate 语义通知（同 useSpaNavHistory.test.js 的手法）。
   * 为什么必须自己建立前提：jsdom 的 window.history **跨用例共享且不可收缩**，
   * 「本用例是不是栈首」取决于前面跑过几个 push —— 第一版把它当夹具默认值，结果同一断言
   * 在文件首条用例绿、在末条用例红（测的是夹具的位置，不是组件的判据）。
   */
  async function forcePosition (position) {
    const state = { ...(window.history.state || {}), position }
    window.history.replaceState(state, '', window.location.href)
    window.dispatchEvent(new PopStateEvent('popstate', { state }))
    await flushPromises()
  }

  it('可后退（position > 0）时渲染「返回上一页」', async () => {
    const { wrapper } = await mountAt(UNKNOWABLE, { pushFirst: '/collection' })
    expect(window.history.state?.position ?? 0).toBeGreaterThan(0)
    expect(wrapper.find('[data-testid="not-found-go-back"]').exists()).toBe(true)
  })

  it('无处可退（position = 0，即便 history.length 仍大于 1）时不渲染「返回上一页」', async () => {
    const { wrapper } = await mountAt(UNKNOWABLE, { pushFirst: '/collection' })
    await forcePosition(0)
    // 前提自证：位置确实是 0，而 length 依然 >1 —— 用 history.length 判的实现会在这里漏出按钮
    expect(window.history.state?.position).toBe(0)
    expect(window.history.length).toBeGreaterThan(1)
    expect(wrapper.find('[data-testid="not-found-go-back"]').exists()).toBe(false)
  })

  it('点击「返回上一页」发起后退动作（jsdom 不真回退，真实语义由 useSpaNavHistory.test.js 覆盖）', async () => {
    const { wrapper, router } = await mountAt(UNKNOWABLE, { pushFirst: '/collection' })
    const backSpy = vi.spyOn(router, 'back').mockImplementation(() => {})
    await wrapper.get('[data-testid="not-found-go-back"]').trigger('click')
    expect(backSpy).toHaveBeenCalledTimes(1)
    backSpy.mockRestore()
  })

  it('点击「回到主页」真的离开兜底页并落在主页', async () => {
    const { wrapper, router } = await mountAt(UNKNOWABLE)
    await wrapper.get('[data-testid="not-found-go-home"]').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/')
    expect(router.currentRoute.value.name).not.toBe('NotFound')
  })
})

describe('文案与可访问名', () => {
  it('zh/en 两档文案齐备且不是同一段文字', async () => {
    const zh = (await import('@/locales/zh.js')).default
    const en = (await import('@/locales/en.js')).default
    const keys = ['notFoundTitle', 'notFoundMessage', 'notFoundPathLabel', 'notFoundHint', 'notFoundBackHome', 'notFoundGoBack']
    for (const [lang, mod] of [['zh', zh], ['en', en]]) {
      for (const k of keys) {
        expect(mod.common, `${lang} 缺 common.${k}`).toHaveProperty(k)
        expect(String(mod.common[k]).trim().length).toBeGreaterThan(1)
      }
    }
    expect(zh.common.notFoundTitle).not.toBe(en.common.notFoundTitle)
  })

  it('语言切到 en 后页面文案随之变化（不残留中文）', async () => {
    i18n.global.locale.value = 'en'
    const { wrapper } = await mountAt(UNKNOWABLE)
    expect(wrapper.text()).toContain('Page not found')
  })

  it('出口是真实 button 且自带可见文字作可访问名', async () => {
    const { wrapper } = await mountAt(UNKNOWABLE, { pushFirst: '/collection' })
    const buttons = wrapper.findAll('button')
    expect(buttons.length).toBe(2)
    for (const b of buttons) {
      expect(b.attributes('type')).toBe('button')
      expect(b.text().trim().length).toBeGreaterThan(1)
    }
  })

  it('不新增可聚焦变体（沿用既有焦点环合同，避免扩大 tabindex 基线）', async () => {
    const { wrapper } = await mountAt(UNKNOWABLE, { pushFirst: '/collection' })
    expect(wrapper.html()).not.toContain('tabindex')
  })
})
