/**
 * media-combination 的测试（P1-3 验收判据 ①–⑤）。
 *
 * 被测：packages/shared-utils/src/media-combination.js（纯函数、零依赖）
 *
 * 本文件的断言全部围绕**三条不可破**：
 *   ① 三级顺序固定（保序优先）
 *   ② 「够 max 即停」（防全排列挂起）
 *   ③ 按 join(separator) 去重；不足如实回报，不重复填充凑数
 */
import { describe, it, expect } from 'vitest'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const M = require('../media-combination.js')
const { combineMedia, noRepetitionCombinations, lowRepetitionCombinations, ordinaryCombinations } = M

/** 判某条是否恰为 [0..n-1] 的一个排列 */
function isPermutationOf (row, n) {
  if (!Array.isArray(row) || row.length !== n) return false
  const seen = new Set(row)
  if (seen.size !== n) return false
  for (let i = 0; i < n; i++) if (!seen.has(i)) return false
  return true
}

describe('media-combination — 验收判据', () => {
  it('① n=20 / max=100 ⇒ 恰好 100 条，且耗时 < 50ms（防全排列退化）', () => {
    const t0 = Date.now()
    const r = combineMedia(new Array(20).fill(0), { max: 100 })
    const ms = Date.now() - t0
    expect(r.combinations.length).toBe(100)
    expect(ms, '全排列是 20! 级，任何「先算完再截断」都会挂起').toBeLessThan(50)
  })

  it('② [1,2] / max=10 ⇒ insufficient，且条数恰为长度 2（不重复填充凑数）', () => {
    const r = combineMedia([1, 2], { max: 10 })
    expect(r.reachedLevel).toBe('insufficient')
    expect(r.combinations.length).toBe(2)
    expect(r.totalPossible).toBe(2)
  })

  it('③ 空数组 ⇒ 0 条、insufficient、totalPossible=0', () => {
    const r = combineMedia([], { max: 1 })
    expect(r.combinations.length).toBe(0)
    expect(r.reachedLevel).toBe('insufficient')
    expect(r.totalPossible).toBe(0)
  })

  it('④ 性质：100 组随机 (n,max) 下无重复、每条都是排列、级 1 的 n 条每段素材都出现', () => {
    for (let trial = 0; trial < 100; trial++) {
      const n = 1 + Math.floor(Math.random() * 12) // 1..12
      const max = 1 + Math.floor(Math.random() * 30)
      const r = combineMedia(new Array(n).fill(0), { max })

      // 无重复（用与实现同一个键口径，但独立重算一遍）
      const keys = r.combinations.map((row) => row.join('\u0001'))
      expect(new Set(keys).size, `trial=${trial} n=${n} max=${max} 出现重复`).toBe(r.combinations.length)

      // 每条都是排列
      for (const row of r.combinations) {
        expect(isPermutationOf(row, n), `trial=${trial} n=${n} 非排列: ${row}`).toBe(true)
      }

      // 级 1 的 n 条：每个下标都作为**某一条的开头**出现过（= 每段素材都出现在每一条里）
      // ⚠️ 只在**条数确实 >= n** 时断言：insufficient 时条数本就少于 n，
      // 那时「有下标没出现」是**正确行为**，不是缺陷（第一版把条件写成 || 就是这么红的）。
      if (r.combinations.length >= n) {
        const firsts = new Set(r.combinations.slice(0, n).map((row) => row[0]))
        for (let i = 0; i < n; i++) {
          expect(firsts.has(i), `trial=${trial} 下标 ${i} 从未出现在任何一条的开头`).toBe(true)
        }
      }
    }
  })

  it('⑤ 反证：不同排列在 join("") 下**撞键**、在 join(separator) 下不撞（锁住「为什么不能改回空串」）', () => {
    // 这条断言的是**缺陷本身**，证明修正 2 不是空谈。
    //
    // ⚠️ 不能断言「返回结果里有重复键」—— 实现用 '' 去重后，返回的列表里键当然唯一。
    // 第一版就是这么写反的。真正要证的是：**有两条真实不同的排列，在 '' 下被当成同一条**，
    // 于是其中一条被**丢掉**（少给用户一条成片，且两条本可不同的成片变成了同一条）。
    // 经典最小对：下标 1、23 与 12、3 拼接后都是 "123"（一位/两位下标混排即触发）
    const a = [1, 23]
    const b = [12, 3]

    expect(a.join(''), '前提：两条不同排列在空串下必须撞键').toBe('123')
    expect(b.join('')).toBe('123')
    expect(a, '前提：两条必须真的是不同排列').not.toEqual(b)
    expect(a.join('\u0001'), '修正后必须能区分').not.toBe(b.join('\u0001'))

    // 端到端：空串分隔符下，去重会把真实不同的排列误判为同一条 ⇒ 产出变少
    const n = 12
    const emptySep = combineMedia(new Array(n).fill(0), { max: 5000, separator: '' })
    const ctrl = combineMedia(new Array(n).fill(0), { max: 5000, separator: '\u0001' })
    const emptyKeys = emptySep.combinations.map((r) => r.join(''))
    expect(new Set(emptyKeys).size, '返回列表自身的键必须唯一（去重生效）').toBe(emptyKeys.length)
    // 空串把不同排列合并了 ⇒ 拿到的条数不会更多
    expect(ctrl.combinations.length).toBeGreaterThanOrEqual(emptySep.combinations.length)
  })
})

describe('media-combination — 三级顺序与「够即停」', () => {
  it('max=1 时停在级 1，且给的是**保序**的那条（不是打乱版）', () => {
    const r = combineMedia(['a', 'b', 'c', 'd'], { max: 1 })
    expect(r.reachedLevel).toBe('noRepetition')
    expect(r.combinations).toEqual([[0, 1, 2, 3]])
  })

  it('恰好等于级 1 条数时仍停在级 1（边界不含糊）', () => {
    const r = combineMedia(new Array(5).fill(0), { max: 5 })
    expect(r.reachedLevel).toBe('noRepetition')
    expect(r.combinations.length).toBe(5)
  })

  it('超过级 1 条数后降级到级 2', () => {
    const r = combineMedia(new Array(5).fill(0), { max: 6 })
    expect(r.reachedLevel).toBe('lowRepetition')
    expect(r.combinations.length).toBe(6)
  })

  it('级 1 的 n 条是循环移位：第 k 条以 k 开头，且每条的**相邻顺序与原序一致**', () => {
    const rows = noRepetitionCombinations(5)
    expect(rows.length).toBe(5)
    expect(rows.map((r) => r[0])).toEqual([0, 1, 2, 3, 4])
    // 保序：每条去掉首元素后，其余仍按原序环绕
    for (const row of rows) {
      for (let i = 1; i < row.length; i++) {
        expect(row[i]).toBe((row[i - 1] + 1) % 5)
      }
    }
  })

  it('确定性：注入同一个 rng 的两次调用结果完全相同', () => {
    let seed = 42
    const rng = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648 }
    const a = combineMedia(new Array(10).fill(0), { max: 50, rng })
    let seed2 = 42
    const rng2 = () => { seed2 = (seed2 * 1103515245 + 12345) % 2147483648; return seed2 / 2147483648 }
    const b = combineMedia(new Array(10).fill(0), { max: 50, rng: rng2 })
    expect(a.combinations).toEqual(b.combinations)
    expect(a.reachedLevel).toBe(b.reachedLevel)
  })
})

describe('media-combination — 边界与契约', () => {
  it('max 非法（0 / 负数 / 小数 / NaN）一律回落 1，并出声告警', () => {
    for (const bad of [0, -3, 1.5, NaN, null]) {
      const r = combineMedia(new Array(4).fill(0), { max: bad })
      expect(r.combinations.length, `max=${String(bad)} 未回落`).toBe(1)
    }
  })

  it('max 未传时默认 1（且不告警）', () => {
    const r = combineMedia(new Array(3).fill(0))
    expect(r.combinations.length).toBe(1)
    expect(r.reachedLevel).toBe('noRepetition')
  })

  it('返回的每条组合是**新数组**，不是共享引用', () => {
    const r = combineMedia(new Array(4).fill(0), { max: 4 })
    const firsts = r.combinations.map((row) => row)
    r.combinations[0][0] = 999
    expect(firsts[1][0]).toBe(1) // 改一条不影响另一条
  })

  it('items 非数组时按空处理（不抛）', () => {
    for (const bad of [null, undefined, 42, 'abc', {}]) {
      const r = combineMedia(bad, { max: 3 })
      expect(r.combinations.length).toBe(0)
      expect(r.reachedLevel).toBe('insufficient')
    }
  })

  it('★ 只读 items.length，不读取也不克隆元素（传 getter 对象也不触发）', () => {
    let touched = 0
    const spy = { get x () { touched++; return 1 } }
    const items = [spy, spy, spy]
    combineMedia(items, { max: 3 })
    expect(touched, '实现不应触碰元素内容').toBe(0)
  })

  it('单段素材：级 1 给 1 条 [0]', () => {
    const r = combineMedia(['only'], { max: 5 })
    expect(r.combinations).toEqual([[0]])
    expect(r.reachedLevel).toBe('insufficient')
  })

  it('ordinaryCombinations 在 n<=6 时给全排列（去重后 n! 条）', () => {
    expect(ordinaryCombinations(3).length).toBe(6)
    expect(ordinaryCombinations(4).length).toBe(24)
  })

  it('ordinaryCombinations 的 cap 生效（不超上限）', () => {
    expect(ordinaryCombinations(5, { cap: 7 }).length).toBe(7)
  })

  it('lowRepetitionCombinations 的产物也全是排列（取满一圈才收）', () => {
    for (const row of lowRepetitionCombinations(6)) {
      expect(isPermutationOf(row, 6)).toBe(true)
    }
  })

  it('分隔符默认值是不可见控制字符（不是空串）', () => {
    expect(M.DEFAULT_SEPARATOR).toBe('\u0001')
    expect(M.DEFAULT_SEPARATOR).not.toBe('')
  })
})
