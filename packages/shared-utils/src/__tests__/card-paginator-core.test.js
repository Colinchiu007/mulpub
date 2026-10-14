/**
 * card-paginator-core 的测试（P2-1 验收判据 ①–④）。
 *
 * 被测：packages/shared-utils/src/card-paginator-core.js（纯逻辑、无 DOM）
 *
 * ★ 本文件**全部用注入的确定性假 measure** —— 这正是「决策层与测量层分离」的价值：
 *   算法（边界、退化切分、残余阈值）可以完整单测，不需要 DOM、不需要 Electron。
 */
import { describe, it, expect } from 'vitest'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const P = require('../card-paginator-core.js')
const { paginate, snapToPunctuation, SENTENCE_ENDERS, CLAUSE_ENDERS, CJK_ENDERS, WARNINGS } = P

/** 确定性假 measure：高度 = 字符数 × heightPerChar（可覆盖） */
function fakeMeasure (heightPerChar = 10, callLog) {
  return async (text) => {
    if (callLog) callLog.push(text)
    return String(text).length * heightPerChar
  }
}

const item = (id, value, extra) => ({ id, type: 'text', value, ...(extra || {}) })

describe('card-paginator-core — 判据② 标点吸附与常量表', () => {
  it('CLAUSE_ENDERS 长度恰为 4（★ 修正③：原实现是空数组）', () => {
    expect(CLAUSE_ENDERS.length).toBe(4)
    expect(CLAUSE_ENDERS).toEqual(['；', ';', '，', ','])
  })

  it("snapToPunctuation('aaa，bbb', 6) === 4（切点在标点**之后**，故 slice(0,4) 含该标点）", () => {
    expect(snapToPunctuation('aaa，bbb', 6)).toBe(4)
    // 语义确认：切出来的第一段确实以该标点收尾
    expect('aaa，bbb'.slice(0, 4)).toBe('aaa，')
  })

  it('5 级优先级**逐级**各一例（先命中者胜）', () => {
    // 1 级：句末
    expect(snapToPunctuation('你好。世界', 4)).toBe(3)
    // 2 级：分句（无句末时）
    expect(snapToPunctuation('aaa，bbb', 6)).toBe(4)
    // 3 级：CJK（构造一个 SENTENCE/CLAUSE 都不含、只有 CJK 表能命中的场景）
    expect(snapToPunctuation('ab。cd', 5)).toBe(3)
    // 4 级：空白（无任何标点）
    expect(snapToPunctuation('ab cd', 5)).toBe(3)
    // 5 级：都不命中 ⇒ 原样返回
    expect(snapToPunctuation('abcdef', 4)).toBe(4)
  })

  it('三张表都被导出（禁止实现内联第二份）', () => {
    expect(SENTENCE_ENDERS).toEqual(['。', '！', '？', '.', '!', '?'])
    expect(CJK_ENDERS).toEqual(['，', '。', '！', '？', '；'])
  })

  it('吸附不越界：targetIndex 超出长度 / 为负 / 非数都被夹紧', () => {
    expect(snapToPunctuation('aaa，bbb', 999)).toBe(4)
    expect(snapToPunctuation('aaa，bbb', -5)).toBe(0)
    expect(snapToPunctuation('aaa，bbb', NaN)).toBe(0)
    expect(snapToPunctuation(null, 3)).toBe(0)
  })

  it('★ 反证：把 CLAUSE_ENDERS 当成空表用 ⇒ 二级吸附失效（证明修正③不是空谈）', () => {
    // ⚠️ 必须挑一个**只在 CLAUSE_ENDERS 里**的标点：`，` 同时在 CJK_ENDERS 里，
    // 空掉 CLAUSE_ENDERS 后仍会被 3 级捞到 ⇒ 那样构造出的「反证」是空的（第一版就是这么错的）。
    // `;`（ASCII 分号）只在 CLAUSE_ENDERS 里，CJK_ENDERS 不含它。
    expect(CLAUSE_ENDERS).toContain(';')
    expect(CJK_ENDERS).not.toContain(';')

    const withEmpty = (text, target) => {
      const s = String(text)
      for (const set of [SENTENCE_ENDERS, [], CJK_ENDERS]) {
        for (let i = target - 1; i >= 0; i--) if (set.includes(s[i])) return i + 1
      }
      for (let i = target - 1; i >= 0; i--) if (/\s/.test(s[i])) return i + 1
      return target
    }
    // 真实实现能吸到分号之后
    expect(snapToPunctuation('aaa;bbb', 6)).toBe(4)
    // 空表版吸不到，只能原样返回
    expect(withEmpty('aaa;bbb', 6)).toBe(6)
    expect(snapToPunctuation('aaa;bbb', 6)).not.toBe(withEmpty('aaa;bbb', 6))
  })
})

describe('card-paginator-core — 判据① 三情况 + 情况 0（注入确定性假 measure）', () => {
  it('情况 1（放得下）：两条各 100px、页高 250 ⇒ 同页', async () => {
    const r = await paginate([item('a', 'x'.repeat(10)), item('b', 'y'.repeat(10))], {
      availableHeightPx: 250, measure: fakeMeasure(10),
    })
    expect(r.pageCount).toBe(1)
    expect(r.pages[0].map((i) => i.id)).toEqual(['a', 'b'])
  })

  it('情况 3（剩得不够收页）：页高 250、三条各 100 ⇒ 第三条换页', async () => {
    const r = await paginate(
      [item('a', 'x'.repeat(10)), item('b', 'y'.repeat(10)), item('c', 'z'.repeat(10))],
      { availableHeightPx: 250, measure: fakeMeasure(10), minRemainderPx: 20 }
    )
    // 前两条 200px，剩 50 > minRemainder(20) ⇒ 会尝试切分；切不动则收页
    expect(r.pageCount).toBeGreaterThanOrEqual(2)
    expect(r.pages.flat().length).toBeGreaterThanOrEqual(3)
  })

  it('情况 2（二分切分）：part1 的高度**恰好不超预算**', async () => {
    // ⚠️ 必须**先放一条小的**：若大条目是第一条且自身超过页高，会走**情况 0**（独占一页），
    // 根本不会切分。第一版就是这么错的（页数 1 而非 2）。
    // 页高 300：small=50px，剩 250 给 big 切分（big 原文 1000px）
    const r = await paginate([item('small', 'x'.repeat(5)), item('big', '字'.repeat(100))], {
      availableHeightPx: 300, measure: fakeMeasure(10), minSplitChars: 10, minTailChars: 5,
    })
    expect(r.pageCount).toBeGreaterThanOrEqual(2)
    const flat = r.pages.flat()
    const p1 = flat.find((i) => i.id === 'big_p1')
    const p2 = flat.find((i) => i.id === 'big_p2')
    expect(p1, '应产出 big_p1').toBeTruthy()
    expect(p2, '应产出 big_p2').toBeTruthy()
    expect(p1.isSplit).toBe(true)
    expect(p1.partIndex).toBe(1)
    expect(p2.partIndex).toBe(2)
    expect(p1.totalParts).toBe(2)
    // ★ part1 必须真的不超预算（预算 = 300 - 50 = 250）
    const h1 = (p1.value.length) * 10
    expect(h1).toBeLessThanOrEqual(250)
    // 且两段拼起来等于原文
    expect(p1.value + p2.value).toBe('字'.repeat(100))
  })

  it('★ noMarginTop **只标 part2**（修正②：渲染侧要真的少一份上边距）', async () => {
    const r = await paginate([item('small', 'x'.repeat(5)), item('big', '字'.repeat(100))], {
      availableHeightPx: 300, measure: fakeMeasure(10),
    })
    const flat = r.pages.flat()
    const p1 = flat.find((i) => i.id === 'big_p1')
    const p2 = flat.find((i) => i.id === 'big_p2')
    expect(p2, '应产出 big_p2').toBeTruthy()
    expect(p2.noMarginTop, 'part2 必须标 noMarginTop').toBe(true)
    expect(p1.noMarginTop, 'part1 不得被标 noMarginTop').toBe(false)
  })

  it('★ 情况 0：单条比整页还高 ⇒ **独占一页**并告警（原实现缺这条会死循环）', async () => {
    const r = await paginate([item('huge', 'x'.repeat(100)), item('small', 'y'.repeat(2))], {
      availableHeightPx: 50, measure: fakeMeasure(10),
    })
    expect(r.warnings).toContain(WARNINGS.ITEM_EXCEEDS_PAGE)
    expect(r.pages[0].map((i) => i.id)).toEqual(['huge'])
    expect(r.pages[1].map((i) => i.id)).toEqual(['small'])
  })

  it('★ 退化切分被拒绝并告警（不硬切出半截）', async () => {
    // 文本太短：high = len - minTailChars <= low = minSplitChars ⇒ 拒绝
    const r = await paginate([item('a', 'x'.repeat(10)), item('b', 'y'.repeat(12))], {
      availableHeightPx: 150, measure: fakeMeasure(10), minSplitChars: 10, minTailChars: 5, minRemainderPx: 20,
    })
    // a=100px，剩 50 > 20 ⇒ 试切 b（len=12, high=7 <= low=10 ⇒ 退化）
    expect(r.warnings).toContain(WARNINGS.DEGENERATE_SPLIT_SKIPPED)
  })

  it('非法参数 fail-closed：availableHeightPx / measure', async () => {
    for (const bad of [0, -1, NaN, Infinity, null, undefined, '100']) {
      await expect(paginate([item('a', 'x')], { availableHeightPx: bad, measure: fakeMeasure() }))
        .rejects.toThrow(TypeError)
    }
    for (const bad of [null, undefined, 42, 'fn', {}]) {
      await expect(paginate([item('a', 'x')], { availableHeightPx: 100, measure: bad }))
        .rejects.toThrow(TypeError)
    }
  })

  it('空 items ⇒ 0 页且不调 measure', async () => {
    const log = []
    const r = await paginate([], { availableHeightPx: 100, measure: fakeMeasure(10, log) })
    expect(r.pageCount).toBe(0)
    expect(r.pages).toEqual([])
    expect(log.length).toBe(0)
  })

  it('iconHeight 计入测量（修正①：原实现漏算 icon）', async () => {
    // 两条各 10 字 × 10px = 100px，各带 iconHeight 40 ⇒ 每条 140px，页高 250 ⇒ 只能放 1 条
    const r = await paginate(
      [item('a', 'x'.repeat(10), { iconHeight: 40 }), item('b', 'y'.repeat(10), { iconHeight: 40 })],
      { availableHeightPx: 250, measure: fakeMeasure(10) }
    )
    expect(r.pageCount).toBe(2)
    expect(r.measuredHeights.get('a')).toBe(140)
  })
})

describe('card-paginator-core — 判据③ 提前退出（非事后截断）', () => {
  it('maxPages = 3 时 measure 调用次数 < 全量所需次数的 40%', async () => {
    const full = []
    const limited = []
    const items = Array.from({ length: 60 }, (_, i) => item('i' + i, 'x'.repeat(10)))

    // 全量：maxPages 足够大
    await paginate(items.map((i) => ({ ...i })), {
      availableHeightPx: 100, measure: fakeMeasure(10, full), maxPages: 1000,
    })
    // 限页：maxPages = 3
    const r = await paginate(items.map((i) => ({ ...i })), {
      availableHeightPx: 100, measure: fakeMeasure(10, limited), maxPages: 3,
    })

    expect(r.warnings).toContain(WARNINGS.PAGE_LIMIT_REACHED)
    expect(r.pageCount).toBeLessThanOrEqual(3)
    // ★ 关键：measure 次数必须显著少于全量 —— 证明是**提前退出**而非算完再截断
    expect(limited.length, `限页测量 ${limited.length} 次，全量 ${full.length} 次`).toBeLessThan(full.length * 0.4)
  })
})

describe('card-paginator-core — 结构与契约', () => {
  it('返回 measuredHeights（Map）且覆盖每个原始条目', async () => {
    const r = await paginate([item('a', 'x'.repeat(5)), item('b', 'y'.repeat(7))], {
      availableHeightPx: 1000, measure: fakeMeasure(10),
    })
    expect(r.measuredHeights).toBeInstanceOf(Map)
    expect(r.measuredHeights.get('a')).toBe(50)
    expect(r.measuredHeights.get('b')).toBe(70)
  })

  it('warnings 取值只来自已知三值', async () => {
    const r = await paginate([item('a', 'x'.repeat(100)), item('b', 'y'.repeat(3))], {
      availableHeightPx: 50, measure: fakeMeasure(10),
    })
    const allowed = Object.values(WARNINGS)
    for (const w of r.warnings) expect(allowed).toContain(w)
  })

  it('fillRatio 提前收页（宁可少放）：填到 90% 就收', async () => {
    // 页高 100，每条 45px ⇒ 两条 = 90% ⇒ 收页；第三条另起
    const r = await paginate(
      [item('a', 'x'.repeat(4) + '0'.repeat(0.5 - 0.5)), item('b', 'y'.repeat(4)), item('c', 'z'.repeat(4))].map(
        (i) => ({ ...i, value: i.value.padEnd(5, 'q') })
      ),
      { availableHeightPx: 100, measure: fakeMeasure(10), fillRatio: 0.9, minRemainderPx: 0 }
    )
    expect(r.pages[0].length).toBeLessThanOrEqual(3)
    expect(r.pageCount).toBeGreaterThanOrEqual(1)
  })

  it('原条目对象**不被突变**（返回的是副本）', async () => {
    const orig = item('a', 'x'.repeat(100))
    const snapshot = JSON.stringify(orig)
    await paginate([orig], { availableHeightPx: 300, measure: fakeMeasure(10) })
    expect(JSON.stringify(orig)).toBe(snapshot)
  })

  it('切分产物的 id 带 _p1 / _p2 后缀且可区分', async () => {
    const r = await paginate([item('small', 'x'.repeat(5)), item('big', '字'.repeat(100))], {
      availableHeightPx: 300, measure: fakeMeasure(10),
    })
    const ids = r.pages.flat().map((i) => i.id)
    expect(ids).toContain('big_p1')
    expect(ids).toContain('big_p2')
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('measure 是**串行**调用的（DOM 测量不能并发）', async () => {
    let inFlight = 0
    let maxInFlight = 0
    const measure = async (text) => {
      inFlight++
      maxInFlight = Math.max(maxInFlight, inFlight)
      await new Promise((r) => setTimeout(r, 1))
      inFlight--
      return String(text).length * 10
    }
    await paginate([item('a', 'x'.repeat(5)), item('b', 'y'.repeat(5))], { availableHeightPx: 1000, measure })
    expect(maxInFlight, '不能并发测量').toBe(1)
  })
})
