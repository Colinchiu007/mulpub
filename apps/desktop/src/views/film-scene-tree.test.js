// @ts-check
/**
 * film-scene-tree.test.js — 场景树组装的回归锁
 *
 * 被锁的三类行为：
 *   ① **只有「恰好一个根 + 无孤儿」时**才由界面用 locale 文案（「影视项目案例 / Film Project Case」）
 *      显示根节点 —— 多根或含孤儿时必须保持各自的 `name`，否则不同场景会折叠成同一个标签。
 *   ② **只有名字确实需要中性化时**才替换：空名 / 中性占位名 `Film Project Case` / 命中历史旧名。
 *      用户自制 kit 的根场景名（本来不含被禁词）必须原样保留（CCG 深度审查第三轮 i6：
 *      原先「唯一根就一律替换」属于过度覆盖，等于去掉所有片名）。
 *   ③ 脏数据形态不能把树搞坏：重复 id 不得重复入树、自引用与多节点环不得让子树消失、
 *      id 缺失的条目不得变成根。
 *
 * 为什么值得单独上锁：这些分支的触发条件是**数据形态**，随包 kit 恰好「唯一根 + 零孤儿 +
 * 中性根名」，正常路径永远碰不到；而全量导入（6558 镜 / 162 场景）与用户自制 kit 会走到。
 * 没有这组用例，改动组树逻辑的人不会知道这里存在前提。
 */
import { describe, expect, it } from 'vitest'
import { buildSceneTree, shouldLocalizeRoot } from './film-scene-tree'

/** 随包 kit 根场景的中性占位名 */
const NEUTRAL = 'Film Project Case'

const scene = (id, parentId, extra = {}) => ({ id, name: `name-${id}`, parentId, ...extra })
/** 带中性根名的根场景（随包 kit 的形态） */
const neutralRoot = (id = 'root') => ({ id, name: NEUTRAL, parentId: null, level: 0 })

describe('shouldLocalizeRoot', () => {
  it('中性占位名 / 空名 → 需要本地化', () => {
    expect(shouldLocalizeRoot(NEUTRAL)).toBe(true)
    expect(shouldLocalizeRoot('  film project case  ')).toBe(true)
    expect(shouldLocalizeRoot('')).toBe(true)
    expect(shouldLocalizeRoot(null)).toBe(true)
    expect(shouldLocalizeRoot(undefined)).toBe(true)
  })

  it('命中历史旧作品名 → 需要本地化（老 kit 数据必须被盖掉）', () => {
    expect(shouldLocalizeRoot(['Hell', 'Grind'].join(' '))).toBe(true)
    expect(shouldLocalizeRoot(['hell', 'grind'].join('-'))).toBe(true)
    expect(shouldLocalizeRoot(['HELL', 'GRIND'].join('_'))).toBe(true)
  })

  it('用户自己的片名 → 保留原名，不本地化（不能把去品牌做成去掉所有片名）', () => {
    expect(shouldLocalizeRoot('我的第一部短片')).toBe(false)
    expect(shouldLocalizeRoot('My Short Film')).toBe(false)
  })
})

describe('buildSceneTree', () => {
  it('唯一根（中性根名）+ 无孤儿 ⇒ 该根标 isRoot', () => {
    const roots = buildSceneTree([
      neutralRoot(),
      scene('a', 'root', { level: 1 }),
      scene('b', 'root', { level: 1 }),
      scene('a1', 'a', { level: 2 }),
    ])
    expect(roots).toHaveLength(1)
    expect(roots[0].id).toBe('root')
    expect(roots[0].isRoot).toBe(true)
    expect(roots[0].children.map((c) => c.id)).toEqual(['a', 'b'])
    expect(roots[0].children[0].children.map((c) => c.id)).toEqual(['a1'])
  })

  it('唯一根但根名是用户自己的片名 ⇒ 不本地化，保留原名（i6）', () => {
    const roots = buildSceneTree([scene('root', null, { name: '我的第一部短片' }), scene('a', 'root')])
    expect(roots).toHaveLength(1)
    expect(roots[0].isRoot).toBe(false)
    expect(roots[0].name).toBe('我的第一部短片')
  })

  it('多个根 ⇒ 一律不标 isRoot（否则两个不同场景会同名折叠）', () => {
    const roots = buildSceneTree([
      { id: 'root1', name: NEUTRAL, parentId: null, level: 0 },
      { id: 'root2', name: NEUTRAL, parentId: null, level: 0 },
    ])
    expect(roots.map((r) => r.id)).toEqual(['root1', 'root2'])
    expect(roots.every((r) => r.isRoot === false)).toBe(true)
  })

  it('含孤儿（parentId 指向不存在的 id）⇒ 不标 isRoot', () => {
    const roots = buildSceneTree([
      neutralRoot(),
      scene('orphan', 'missing-parent', { level: 2 }),
    ])
    expect(roots).toHaveLength(2)
    expect(roots.every((r) => r.isRoot === false)).toBe(true)
  })

  it('自引用（parentId === id）按无父节点处理，不得挂到自己下面', () => {
    const roots = buildSceneTree([{ id: 'self', name: NEUTRAL, parentId: 'self' }])
    expect(roots).toHaveLength(1)
    expect(roots[0].children).toEqual([])
    // 自引用属孤儿形态 ⇒ 不本地化
    expect(roots[0].isRoot).toBe(false)
  })

  // CCG 深度审查第三轮 i1：两节点互相为父（A→B→A）时，两者都进不了 roots ⇒ 整棵树消失。
  it('两节点成环（A→B→A）⇒ 两个节点都要可见，不得整棵树静默消失', () => {
    const roots = buildSceneTree([
      neutralRoot(),
      scene('a', 'b'),
      scene('b', 'a'),
    ])
    // 环上两节点被按孤儿兜底归入 roots（连同真正的根），至少不会消失
    const ids = roots.map((r) => r.id).sort()
    expect(ids).toContain('a')
    expect(ids).toContain('b')
    expect(ids).toContain('root')
    // 有孤儿形态 ⇒ 不本地化
    expect(roots.every((r) => r.isRoot === false)).toBe(true)
  })

  it('三节点环（A→B→C→A）同样不得让整棵子树消失', () => {
    const roots = buildSceneTree([
      scene('a', 'c'),
      scene('b', 'a'),
      scene('c', 'b'),
    ])
    expect(roots.map((r) => r.id).sort()).toEqual(['a', 'b', 'c'])
  })

  it('空输入 / 非数组 ⇒ 返回空数组（不抛）', () => {
    expect(buildSceneTree([])).toEqual([])
    expect(buildSceneTree(null)).toEqual([])
    expect(buildSceneTree(undefined)).toEqual([])
  })

  it('跳过 id 缺失的脏条目，不让它变成根', () => {
    const roots = buildSceneTree([
      neutralRoot(),
      { name: 'no-id', parentId: null },
      null,
    ])
    expect(roots).toHaveLength(1)
    expect(roots[0].id).toBe('root')
    expect(roots[0].isRoot).toBe(true)
  })

  // CCG 深度审查第二轮 i1：重复 id 会让同一个节点被 push 两次。
  it('重复 id：同一 id 只出现一次，不得把同一节点 push 两次', () => {
    const roots = buildSceneTree([
      neutralRoot(),
      scene('dup', 'root', { level: 1 }),
      scene('dup', 'root', { level: 1 }),
    ])
    expect(roots).toHaveLength(1)
    expect(roots[0].children.map((c) => c.id)).toEqual(['dup'])
    expect(roots[0].isRoot).toBe(true)
  })

  it('重复的根 id：不得因重复条目把 roots 撑成 2 个而错失本地化', () => {
    const roots = buildSceneTree([neutralRoot(), neutralRoot()])
    expect(roots).toHaveLength(1)
    expect(roots[0].isRoot).toBe(true)
  })
})
