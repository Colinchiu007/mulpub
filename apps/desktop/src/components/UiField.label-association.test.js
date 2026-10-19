/**
 * UiField ↔ UiInput 的 label/控件关联契约（UX 审计阶段 4.3 / audit-29，2026-10-19）
 *
 * 修之前的两种错法（都在源码里看不见）：
 *   ① `UiField` 的 `<label :for="forId">` 里 `forId` 是可选 prop，绝大多数调用点没传
 *      ⇒ 渲染出孤岛标签；
 *   ② `UiInput` 根本没有 `id` prop，调用方写的 `id="x"` 会作为**属性透传落到根 div**，
 *      `<input>` 上没有 id ⇒ 就算传了 forId 也指不到控件。
 * 现在由控件把自己的 id 登记给外层标签，两边用同一个值。
 *
 * 断言规范（QM-3）：结构类一律 toBe / toEqual，不用 toContain。
 */
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { defineComponent, h, nextTick } from 'vue'

import UiField from './UiField.vue'
import UiInput from './UiInput.vue'

/** 在 UiField 的默认槽里放 N 个 UiInput（用真实父子关系，不 mock 组件） */
function mountField (fieldProps = {}, inputCount = 1, inputProps = {}) {
  const Comp = defineComponent({
    render () {
      return h(UiField, fieldProps, {
        default: () =>
          Array.from({ length: inputCount }, (_, i) => h(UiInput, { ...inputProps, key: i })),
      })
    },
  })
  return mount(Comp)
}

/**
 * 挂载后等一帧。
 * 关联是"父先渲染、子在挂载阶段登记"，所以首帧 `for` 缺席、登记触发的重渲染在同一微任务里补上。
 * 这个 helper 不是用来掩盖时序 —— 下面「首帧 for 缺席、下一帧成立」那条用例把两帧分别断言了，
 * 谁以后把登记改成一次性渲染（不再触发重渲染），那条就会红。
 */
async function mountFieldAwait (fieldProps, inputCount, inputProps) {
  const w = mountField(fieldProps, inputCount, inputProps)
  await nextTick()
  return w
}

describe('UiField ↔ UiInput 的 label 关联', () => {
  it('UiInput 自己就会生成 id，并给自己的 label 绑上 for', () => {
    const w = mount(UiInput, { props: { label: '标题', modelValue: '' } })
    const id = w.get('input').attributes('id')
    expect(id, '控件必须有可被 for 指向的 id').toBeTruthy()
    expect(w.get('label').attributes('for')).toBe(id)
  })

  it('textarea 形态同样拿到 id（两个分支共用同一个 id 出口）', () => {
    const w = mount(UiInput, { props: { label: '正文', type: 'textarea', modelValue: '' } })
    const id = w.get('textarea').attributes('id')
    expect(id).toBeTruthy()
    expect(w.get('label').attributes('for')).toBe(id)
  })

  it('首帧 for 缺席、登记后下一帧成立（时序本身就是契约）', async () => {
    const w = mountField({ label: '账号名称' })
    expect(w.get('label.ui-field-label').attributes('for'), '登记前不得输出 for').toBeUndefined()
    await nextTick()
    const labelFor = w.get('label.ui-field-label').attributes('for')
    expect(labelFor, '登记后必须补上 for').toBeTruthy()
    expect(labelFor).toBe(w.get('input').attributes('id'))
  })

  it('外层 UiField 没有 forId 时，标签的 for 等于控件实际使用的 id', async () => {
    const w = await mountFieldAwait({ label: '账号名称' })
    const labelFor = w.get('label.ui-field-label').attributes('for')
    const inputId = w.get('input').attributes('id')
    expect(labelFor).toBeTruthy()
    expect(labelFor).toBe(inputId)
  })

  it('槽里没有控件时，label 的 for 必须整个缺席（不得渲染成 for=""）', () => {
    const w = mount(UiField, { props: { label: '只有标签' }, slots: { default: '<div class="no-control" />' } })
    expect(w.find('.no-control').exists()).toBe(true)
    // :for="undefined" 时 Vue 不输出该属性；写成 `:for="''"` 会输出 for="" —— 后者是坏关联
    expect(w.get('label.ui-field-label').attributes('for'), 'for 必须缺席而不是空串').toBeUndefined()
  })

  it('槽里没有控件时，forId 原样生效（标签指向外部控件是它的正当用途）', async () => {
    const w = mount(UiField, { props: { label: '外部控件', forId: 'outside-1' }, slots: { default: '<span />' } })
    await nextTick()
    expect(w.get('label.ui-field-label').attributes('for')).toBe('outside-1')
  })

  it('槽里真有控件时，登记的 id 优先于 forId（标签不得指向控件没用上的 id）', async () => {
    const w = await mountFieldAwait({ label: '关键词', forId: 'kw-input' })
    const inputId = w.get('input').attributes('id')
    expect(inputId, '控件自己的 id 才是唯一可被关联的目标').toBeTruthy()
    expect(inputId).not.toBe('kw-input')
    expect(w.get('label.ui-field-label').attributes('for')).toBe(inputId)
  })

  it('UiInput 自带显式 id 时，标签登记的就是这个 id（claim 的是控件真正用的值）', async () => {
    const w = await mountFieldAwait({ label: '封面地址' }, 1, { id: 'cover-src' })
    expect(w.get('input').attributes('id')).toBe('cover-src')
    expect(w.get('label.ui-field-label').attributes('for')).toBe('cover-src')
  })

  it('一个 UiField 里放多个控件：只有第一个被标签指向，但两者的 id 必须互不相同', async () => {
    const w = await mountFieldAwait({ label: '多控件' }, 2)
    const ids = w.findAll('input').map((n) => n.attributes('id'))
    expect(new Set(ids).size, '重复 id 会让浏览器只关联到第一个，第二个成为坏关联').toBe(2)
    expect(ids).toContain(w.get('label.ui-field-label').attributes('for'))
  })

  it('多个 UiField 实例各自生成不同 id（防"写死一个常量 id"造成的跨实例重复）', async () => {
    const Host = defineComponent({
      render () {
        return h('div', [
          h(UiField, { label: 'A' }, { default: () => h(UiInput, { modelValue: '' }) }),
          h(UiField, { label: 'B' }, { default: () => h(UiInput, { modelValue: '' }) }),
        ])
      },
    })
    const w = mount(Host)
    await nextTick()
    const ids = w.findAll('input').map((n) => n.attributes('id'))
    expect(new Set(ids).size).toBe(2)
  })

  it('结构锁：关联通道只有一个实现（两个组件都 import 同一个 key，不得各自 Symbol）', async () => {
    const { readFileSync } = await import('node:fs')
    const { fileURLToPath } = await import('node:url')
    const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
    const field = read('./UiField.vue')
    const input = read('./UiInput.vue')
    const key = read('./uiFieldControlId.js')
    expect(field).toContain("import { UI_FIELD_CONTROL_ID } from './uiFieldControlId'")
    expect(input).toContain('import { UI_FIELD_CONTROL_ID } from "./uiFieldControlId"')
    // 第二个 Symbol 出处 = 两份通道定义，provide/inject 会静默对不上（组件各自渲染但关联永不建立）
    expect((key.match(/Symbol\(/g) || []).length).toBe(1)
    expect(field + input).not.toMatch(/inject\(\s*Symbol|provide\(\s*Symbol/)
    // 控件不得回读父级的标签目标 —— 那正是"第二个控件复用第一个 id"的来源
    expect(input).not.toMatch(/channel\??\.target/)
  })
})
