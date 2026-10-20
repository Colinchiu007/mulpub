/**
 * 采集页「快捷采集 / 草稿箱 / 来源入口」这组可点卡片的键盘可达合同（UX 审计 4.4 第二批）
 *
 * PRD §三 把修法钉成四件套：`role="button"` + `tabindex="0"` + `@keydown.enter.prevent` +
 * `@keydown.space.prevent`，且两个 keydown 的表达式必须与 `@click` **逐字一致**。
 * 本文件锁三件事，缺一不可：
 *   1) 结构：六个卡片标签四件套齐备且表达式相同（近似逻辑就是两套行为）；
 *   2) 行为：Enter 与 Space **各自**真的触发了同一个动作（既有测试只 trigger('click')，
 *      键盘路径在测试里根本不可表示 ⇒ 属性写了 ≠ 通道通畅）；
 *   3) 禁令：补了 `role="button"` 的元素**不得有可见、可聚焦的后代**——`button` 是 leaf 角色，
 *      取到该角色后其子树在无障碍树上变成 presentational，容器里的真按钮会**从 a11y 树消失**，
 *      而视觉、鼠标、单测、构建全都不报错（本仓实测过 3 处，见 PRD §三「硬禁令」）。
 * 外加一条负控：只有 `@click` 的 div 按 Enter **必须不产生事件**，否则第 2 条会退化成"测 mount 副作用"。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

vi.mock('element-plus', () => ({
  ElMessage: { warning: vi.fn(), success: vi.fn(), error: vi.fn(), info: vi.fn() },
  ElMessageBox: { confirm: vi.fn().mockResolvedValue(undefined) },
  ElDialog: { template: '<div class="el-dialog"><slot></slot></div>' },
}))

const pushSpy = vi.fn()
vi.mock('vue-router', () => ({
  useRouter: () => ({ push: pushSpy }),
}))

import CollectionView from './Collection.vue'
import i18n from '@/i18n'

const HERE = dirname(fileURLToPath(import.meta.url))
const SRC = readFileSync(join(HERE, 'Collection.vue'), 'utf8')

/** 取「快捷卡片」这一族的开始标签（源码层判据；渲染层再验后代） */
function cardTags (src) {
  return src
    .split('\n')
    .filter((l) => /class="cohere-stat-card col-stat-card-click"/.test(l))
}

function attr (tag, name) {
  const m = new RegExp(name + '="([^"]*)"').exec(tag)
  return m ? m[1] : null
}

function mountView () {
  return mount(CollectionView, { global: { plugins: [createPinia(), i18n], mocks: { $t: (k) => k } } })
}

describe('Collection.vue · 快捷卡片键盘可达（结构）', () => {
  it('每个可点卡片都是四件套，且 keydown 表达式与 @click 逐字一致', () => {
    const tags = cardTags(SRC)
    expect(tags.length, '扫描域为空 ⇒ 判据失明，不得当作通过').toBeGreaterThanOrEqual(6)
    for (const t of tags) {
      expect(t, '标签必须含 role=button：' + t.slice(0, 60)).toContain('role="button"')
      expect(t).toContain('tabindex="0"')
      const click = attr(t, '@click')
      expect(click, '@click 表达式取不到：' + t.slice(0, 60)).toBeTruthy()
      expect(attr(t, '@keydown.enter.prevent'), 'Enter 表达式必须与 @click 逐字一致：' + click).toBe(click)
      expect(attr(t, '@keydown.space.prevent'), 'Space 表达式必须与 @click 逐字一致：' + click).toBe(click)
    }
  })

  it('补了 role=button 的卡片不得有可聚焦后代（leaf 角色会把子树从 a11y 树上抹掉）', async () => {
    const w = mountView()
    await flushPromises()
    const cards = w.findAll('.col-stat-card-click')
    expect(cards.length).toBeGreaterThanOrEqual(6)
    for (const c of cards) {
      // 用 innerHTML 而不是 html()：html() 含卡片自己的 `tabindex="0"`，
      // 拿它做"不得有可聚焦后代"的判据会把**本次修法的正确形态**判成缺陷（第一版就踩了这条）。
      const inner = c.element.innerHTML
      // 只允许 svg / span / div 这类非交互后代；出现真控件即说明这个卡片不该拿 button 角色
      expect(inner, '可聚焦后代让 a11y 树失去该子树：' + inner.slice(0, 90)).not.toMatch(/<(button|a|input|select|textarea)\b/)
      expect(inner).not.toMatch(/tabindex="(?!-1)/)
    }
  })
})

describe('Collection.vue · 快捷卡片键盘可达（行为）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setActivePinia(createPinia())
    window.electronAPI = {}
  })

  it('Enter 与 Space 各自都触发与点击同一个动作（草稿箱卡片 → 路由跳转）', async () => {
    const w = mountView()
    await flushPromises()
    const box = w.find('[data-testid="quick-drafts-box"]')
    expect(box.exists(), '草稿箱卡片不见了，行为锁无从触发').toBe(true)

    await box.trigger('click')
    expect(pushSpy).toHaveBeenLastCalledWith('/publish?tab=drafts')

    pushSpy.mockClear()
    await box.trigger('keydown.enter')
    expect(pushSpy, '只写 @click 时按 Enter 什么都不发生 —— 这条就是本次要修的形态').toHaveBeenLastCalledWith('/publish?tab=drafts')

    pushSpy.mockClear()
    await box.trigger('keydown.space')
    expect(pushSpy, 'Space 与 Enter 少写一个就是"键盘路径断裂"的另一半').toHaveBeenLastCalledWith('/publish?tab=drafts')
  })

  it('负控：只有 @click 的 div，按 Enter 必须不产生任何调用（否则上面的用例在测 mount 副作用）', async () => {
    const handler = vi.fn()
    const w = mount({
      template: '<div class="only-click" @click="go">x</div>',
      methods: { go: handler },
    })
    await w.find('.only-click').trigger('keydown.enter')
    await w.find('.only-click').trigger('keydown.space')
    expect(handler, '负控本身失效 = 整套键盘断言都不成立').not.toHaveBeenCalled()
    await w.find('.only-click').trigger('click')
    expect(handler).toHaveBeenCalledTimes(1)
  })
})
