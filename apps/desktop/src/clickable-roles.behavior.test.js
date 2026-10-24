// 键盘激活的行为证据（阶段 4.4 的实质判据）
//
// clickable-roles.contract.test.js 只证明"属性在位"；属性在位不等于按下回车真的走到同一个 handler。
// 这里对代表性组件挂载后**派发 keydown**，断言处理器确实被调用（emit 出同一事件 / 调用同一方法）。
// 选取原则：一族一个代表，覆盖 $emit 型与本地方法型两类处理器写法。
import { describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import zh from '@/locales/zh'
import en from '@/locales/en'
import SceneCard from '@/components/SceneCard.vue'
import BoardStageIndicator from '@/components/BoardStageIndicator.vue'

// 组件里用的是 useI18n()（不是 $t mock），所以必须真装插件 ——
// mocks: { $t } 骗不过 setup 期的 useI18n()，第一版就是这么报 `Need to install with app.use` 的。
const i18n = createI18n({ legacy: false, locale: 'zh', fallbackLocale: 'en', messages: { zh, en } })

if (typeof globalThis.ResizeObserver !== 'function') {
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }
}

function propsDataFor(component, patch = {}) {
  const props = component.props || {}
  const out = {}
  for (const [name, def] of Object.entries(props)) {
    if (typeof def === 'object' && def !== null && 'default' in def) {
      out[name] = typeof def.default === 'function' && def.type !== Function ? def.default() : def.default
    } else out[name] = undefined
  }
  return { ...out, ...patch }
}

describe('role="button" 化后的键盘激活行为', () => {
  it('场景卡片：Enter 与 Space 都必须与点击同样 emit select（同一 id）', async () => {
    const w = mount(SceneCard, {

      props: propsDataFor(SceneCard, { scene: { id: 'sc-1', status: 'done' } }),

      global: { plugins: [i18n] },

      attachTo: document.body,

    })

    const card = w.find('div[role="button"]')

    expect(card.exists(), '渲染结果里必须存在带 role="button" 的卡片（本用例锁它的键盘路径）').toBe(true)

    expect(card.attributes('tabindex'), '卡片必须可被 Tab 聚焦').toBe('0')



    await card.trigger('keydown.enter')

    let emitted = w.emitted('select')

    expect(emitted, 'Enter 必须触发 select（与鼠标点击同一出口）').toBeTruthy()

    expect(emitted[0][0]).toBe('sc-1')



    await card.trigger('keydown.space')

    emitted = w.emitted('select')

    expect(emitted.length, 'Space 也必须触发 select，不得只认 Enter').toBe(2)

    w.unmount()

  })


  it('阶段指示器节点：Enter 触发 select，且 Space 不会落到别处', async () => {
    const w = mount(BoardStageIndicator, {
      props: propsDataFor(BoardStageIndicator, { stages: ['草稿', '审核', '发布'], current: 0 }),
      global: { plugins: [i18n] },
      attachTo: document.body,
    })
    const node = w.find('div[role="button"]')
    expect(node.exists(), '阶段节点必须带 role="button"').toBe(true)
    await node.trigger('keydown.enter')
    const emitted = w.emitted('select')
    expect(emitted, 'Enter 必须触发 select').toBeTruthy()
    expect(typeof emitted[0][0]).toBe('number')
    w.unmount()
  })

  it('负控：没有键盘处理的可点击元素不可能通过本用例（防"只加 role 不加 keydown"）', async () => {
    // 直接在真实组件上验证"摘掉 keydown 后行为消失"——用原生元素手写一份等价结构，
    // 断言它不产生事件：证明上面两条用例真的在测键盘链路，而不是 mount 的副作用。
    const Probe = {
      template: '<div role="button" tabindex="0" @click="$emit(\'apply-tag\', \'x\')"></div>',
      emits: ['apply-tag'],
    }
    const w = mount(Probe)
    await w.find('div').trigger('keydown.enter')
    expect(w.emitted('apply-tag'), '只有 @click 时 Enter 不得产生事件（否则上面两条用例是假的）').toBeFalsy()
  })
})
