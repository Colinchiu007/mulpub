// @vitest-environment jsdom
/**
 * CollectionVideoProgressModal.contract.test.js — 进度浮层对 `StageProgress` 的
 * **props 契约锁**（fix-collection-rewrite-publish-flow，2026-10-21）。
 *
 * 动因（QM-6 深审 i7）：本浮层直接复用视频创作页的 `StageProgress`
 * （`@/views/video-creation`），但**从未锁过**两者之间的 props 契约。
 * `StageProgress` 是 Options API 组件，props 改名/删除**不会**让本浮层在编译期或
 * 挂载期报错——Vue 只是把未知 prop 落到 attrs 里，**静默不生效**：
 * 于是「阶段列表不显示」「进度条不动」这类缺陷要等到**真机点一次**才看得见。
 *
 * 判据：**本浮层传给 `<StageProgress>` 的每一个 prop 名，都必须存在于
 * `StageProgress.props` 的声明里**。用「静态解析浮层模板 + 运行时取组件声明」
 * 而不是「手抄一份名单」——手抄的名单锁不住**模板真传了什么**。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import StageProgress from '@/views/video-creation/StageProgress.vue'

const here = dirname(fileURLToPath(import.meta.url))
const MODAL_SRC = readFileSync(resolve(here, 'CollectionVideoProgressModal.vue'), 'utf8')

/**
 * 从浮层模板里取出 `<StageProgress …>` 标签上的全部**prop 名**（kebab-case → camelCase）。
 *
 * 只取「传给子组件的属性」，**排除 Vue 指令**：`v-if` / `v-for` / `v-show` 等以 `v-` 开头，
 * `@event` 是事件监听，`#slot` 是插槽 —— 它们都不是 prop（指令不进 props 声明表）。
 */
function stageProgressAttrs (source) {
  const tag = source.match(/<StageProgress\b([^>]*?)\/?>/)
  if (!tag) return null
  const attrs = []
  const re = /([:@#]?)([A-Za-z][\w-]*)(?==|\s|$)/g
  let m
  while ((m = re.exec(tag[1])) !== null) {
    const prefix = m[1]
    const name = m[2]
    if (prefix === '@' || prefix === '#') continue // 事件监听 / 插槽
    if (name.startsWith('v-')) continue // 指令（v-if / v-for / v-show …）
    attrs.push(name.replace(/-([a-z])/g, (_, c) => c.toUpperCase()))
  }
  return [...new Set(attrs)]
}

describe('CollectionVideoProgressModal → StageProgress 的 props 契约', () => {
  it('浮层模板里确实有 <StageProgress> 标签（否则下面的锁会空跑）', () => {
    expect(MODAL_SRC).toContain('<StageProgress')
  })

  it('传给 StageProgress 的每个 prop 都必须是它声明过的（改名/删除即红）', () => {
    const declared = Object.keys(StageProgress.props || {})
    expect(declared.length).toBeGreaterThan(0)
    const passed = stageProgressAttrs(MODAL_SRC) || []
    expect(passed.length).toBeGreaterThan(0)
    const unknown = passed.filter((name) => !declared.includes(name))
    expect(
      unknown,
      `浮层传了 StageProgress 未声明的 prop：${unknown.join(', ')}（会被 Vue 静默丢弃，界面不生效）`
    ).toEqual([])
  })

  it('关键 props 逐个在位（改名会让「阶段列表 / 进度 / 耗时」整体失效）', () => {
    const passed = stageProgressAttrs(MODAL_SRC) || []
    for (const required of ['stages', 'progressPercent', 'elapsedMs', 'testidPrefix']) {
      expect(passed, `浮层没有传 ${required} 给 StageProgress`).toContain(required)
      expect(Object.keys(StageProgress.props || {})).toContain(required)
    }
  })

  it('浮层自身不消费 StageProgress 的私有实现（只经 props 传入）', () => {
    // StageProgress 内部用 `testidPrefix` 生成 testid；浮层必须显式传自己的前缀，
    // 否则采集页会与创作页产出**同名 testid**（两处 DOM 撞名 ⇒ 自动化取错节点）。
    const passed = stageProgressAttrs(MODAL_SRC) || []
    expect(passed).toContain('testidPrefix')
    expect(MODAL_SRC).toContain('collection-video')
  })
})
