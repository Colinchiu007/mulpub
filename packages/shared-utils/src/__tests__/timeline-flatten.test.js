/**
 * timeline-flatten 的测试（P1-4 验收判据 ①–⑥）。
 *
 * 被测：packages/shared-utils/src/timeline-flatten.js（纯函数、零依赖）
 *
 * 本文件的断言围绕两条硬约束：
 *   · **单位**：内部一切时间字段是秒；毫秒只出现在边界，且只经两个函数转换
 *   · **半开区间** `[start, end)`：`entryAt(t = 某条 end)` 必须返回**后一条**
 */
import { describe, it, expect } from 'vitest'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const T = require('../timeline-flatten.js')
const { flattenTimeline, entryAt, locate, toMilliseconds, fromMilliseconds, validateTimeline } = T

const items = (...durations) => durations.map((d, i) => ({ id: 'i' + i, durationSeconds: d }))

describe('timeline-flatten — 验收判据', () => {
  it('① 两条各 5s、重叠 0.5s ⇒ entries[1].startSeconds === 4.5 且 totalSeconds === 9.5', () => {
    const tl = flattenTimeline(
      [{ id: 'a', durationSeconds: 5 }, { id: 'b', durationSeconds: 5 }],
      { transitionOverlapSeconds: 0.5 }
    )
    expect(tl.entries[1].startSeconds).toBe(4.5)
    expect(tl.totalSeconds).toBe(9.5)
    expect(tl.entries[0].startSeconds).toBe(0)
    expect(tl.entries[0].endSeconds).toBe(5)
    expect(tl.entries[1].endSeconds).toBe(9.5)
  })

  it('② validateTimeline 对正常结果返回 []', () => {
    const tl = flattenTimeline(items(5, 5, 5), { transitionOverlapSeconds: 0.5 })
    expect(validateTimeline(tl)).toEqual([])
  })

  it('③ toMilliseconds / fromMilliseconds 往返**精确相等**（1000 组，用 toBe 不用 toBeCloseTo）', () => {
    // 这是「唯一转换地」的核心价值：只要边界都走这两个函数，往返就不该有误差。
    const bad = []
    for (let i = 0; i < 1000; i++) {
      // 现实取值范围：0 ~ 3600 秒，含小数（帧对齐常见的 1/30 精度也覆盖）
      const x = Math.round(Math.random() * 3600000) / 1000
      if (fromMilliseconds(toMilliseconds(x)) !== x) bad.push({ x, back: fromMilliseconds(toMilliseconds(x)) })
    }
    expect(bad, `有 ${bad.length} 组往返不精确，例如 ${JSON.stringify(bad[0])}`).toEqual([])
  })

  it('③b 已知的分母是 30 / 60 / 1000 的时间值也必须精确往返', () => {
    for (const d of [1 / 30, 1 / 60, 0.001, 0.1, 1.5, 4.5, 9.5, 1234.567]) {
      expect(fromMilliseconds(toMilliseconds(d)), `d=${d}`).toBe(d)
    }
  })

  it('④ entryAt(t = 某条 endSeconds) 返回**后一条**（半开区间的直接后果）', () => {
    const tl = flattenTimeline(items(5, 5, 5), { transitionOverlapSeconds: 0.5 })
    // entries[0].endSeconds === 5，而 entries[1] 覆盖 [4.5, 9.5) ⇒ 5 落在第 1 条
    expect(tl.entries[0].endSeconds).toBe(5)
    const hit = entryAt(tl, 5)
    expect(hit).toBe(tl.entries[1])
    expect(entryAt(tl, 4.999)).toBe(tl.entries[0])
  })

  it('④b 重叠区返回**先开始的那条**（播放语义：那一刻刚结束的是它）', () => {
    const tl = flattenTimeline(items(5, 5), { transitionOverlapSeconds: 0.5 })
    // 4.5 ~ 5 同时落在 entries[0] [0,5) 与 entries[1] [4.5,9.5)
    expect(entryAt(tl, 4.7)).toBe(tl.entries[0])
    expect(entryAt(tl, 4.5)).toBe(tl.entries[0])
  })

  it('④c 早于首条起点 / 晚于等于末尾 ⇒ null', () => {
    const tl = flattenTimeline(items(5, 5), { transitionOverlapSeconds: 0.5 })
    expect(entryAt(tl, -0.001)).toBeNull()
    expect(entryAt(tl, 9.5)).toBeNull() // 末尾是开区间
    expect(entryAt(tl, 100)).toBeNull()
    expect(entryAt(tl, NaN)).toBeNull()
  })

  it('⑤ durationSeconds 为 0 / 负数 / 非数 ⇒ 抛 TypeError（不跳过、不补默认）', () => {
    for (const bad of [0, -1, NaN, Infinity, null, undefined, '5']) {
      expect(() => flattenTimeline([{ id: 'a', durationSeconds: bad }]), `bad=${String(bad)} 未抛`).toThrow(TypeError)
    }
  })

  it('⑤b items 非数组 ⇒ 抛 TypeError', () => {
    for (const bad of [null, undefined, 42, 'abc', {}]) {
      expect(() => flattenTimeline(bad), `bad=${String(bad)} 未抛`).toThrow(TypeError)
    }
  })

  it('⑥ 跨语言契约锁：与 scene-builder 的重叠公式同参数逐值对齐（除末尾 +1 秒）', () => {
    // scene-builder.ts 的公式（秒制）：
    //   in_seconds  = i * (secondsPerScene - overlap)
    //   out_seconds = (i + 1) * secondsPerScene - i * overlap
    //   durationInFrames = ceil((lastOut + 1) * FPS)   ← 末尾多加 1 秒
    const SPS = 5
    const OVERLAP = 0.5
    const FPS = 30
    const N = 4

    const reference = []
    for (let i = 0; i < N; i++) {
      reference.push({
        in_seconds: i * (SPS - OVERLAP),
        out_seconds: (i + 1) * SPS - i * OVERLAP,
      })
    }

    const tl = flattenTimeline(
      Array.from({ length: N }, (_, i) => ({ id: 's' + i, durationSeconds: SPS })),
      { transitionOverlapSeconds: OVERLAP, fps: FPS }
    )

    for (let i = 0; i < N; i++) {
      expect(tl.entries[i].startSeconds, `第 ${i} 条 start 与 scene-builder 的 in_seconds 不一致`).toBe(reference[i].in_seconds)
      expect(tl.entries[i].endSeconds, `第 ${i} 条 end 与 scene-builder 的 out_seconds 不一致`).toBe(reference[i].out_seconds)
    }

    // ★ 帧数：本模块**不加**那 1 秒；scene-builder 加。这是刻意的既有行为差异。
    // 手算：N=4 条各 5s、两两重叠 0.5s ⇒ lastOut = 4*5 - 3*0.5 = 18.5
    //   · 本模块      : ceil(18.5 * 30) = ceil(555)   = 555
    //   · scene-builder: ceil((18.5 + 1) * 30) = ceil(585) = 585
    // ⚠️ 数字一律由表达式给出，不写死 —— 本测试第一版把 18.5 口算成 19、19.5 口算成 20，连错两次。
    const lastOut = reference[N - 1].out_seconds
    expect(lastOut).toBe(18.5)
    expect(tl.totalSeconds).toBe(18.5)
    expect(tl.durationInFrames).toBe(Math.ceil(tl.totalSeconds * FPS))
    expect(Math.ceil((lastOut + 1) * FPS)).toBe(585) // scene-builder 的口径
    expect(tl.durationInFrames, '本模块不得擅自加上 scene-builder 的收尾 1 秒').not.toBe(Math.ceil((lastOut + 1) * FPS))
  })
})

describe('timeline-flatten — 结构与冗余字段', () => {
  it('冗余三字段互相自洽：durationSeconds === end - start', () => {
    const tl = flattenTimeline(items(3, 7, 2), { transitionOverlapSeconds: 0.5 })
    for (const e of tl.entries) {
      expect(e.durationSeconds).toBeCloseTo(e.endSeconds - e.startSeconds, 12)
    }
    expect(validateTimeline(tl)).toEqual([])
  })

  it('★ stopSeconds 是**累计最大值**：重叠让 endSeconds 非严格单调时仍单调不减', () => {
    const tl = flattenTimeline(items(10, 1, 1), { transitionOverlapSeconds: 0.5 })
    // entries[1].end = 11 - 0.5 + 1 = ... 无论如何 end 可能小于前一条的 stop
    const stops = tl.entries.map((e) => e.stopSeconds)
    for (let i = 1; i < stops.length; i++) {
      expect(stops[i], `stopSeconds 在 ${i} 处倒退 —— 二分查找前提被破坏`).toBeGreaterThanOrEqual(stops[i - 1])
    }
    expect(validateTimeline(tl)).toEqual([])
  })

  it('kind 默认 visual，非法 kind 也回落 visual', () => {
    const tl = flattenTimeline([
      { id: 'a', durationSeconds: 1 },
      { id: 'b', durationSeconds: 1, kind: 'text' },
      { id: 'c', durationSeconds: 1, kind: 'nonsense' },
    ])
    expect(tl.entries.map((e) => e.kind)).toEqual(['visual', 'text', 'visual'])
  })

  it('payload 只在提供时透传（undefined 不产生该键）', () => {
    const tl = flattenTimeline([
      { id: 'a', durationSeconds: 1, payload: { x: 1 } },
      { id: 'b', durationSeconds: 1 },
    ])
    expect(tl.entries[0].payload).toEqual({ x: 1 })
    expect('payload' in tl.entries[1]).toBe(false)
  })

  it('order 是原顺序下标', () => {
    const tl = flattenTimeline(items(1, 1, 1))
    expect(tl.entries.map((e) => e.order)).toEqual([0, 1, 2])
  })

  it('空数组 ⇒ 空 entries、totalSeconds 0、durationInFrames 0，且不抛', () => {
    const tl = flattenTimeline([])
    expect(tl.entries).toEqual([])
    expect(tl.totalSeconds).toBe(0)
    expect(tl.durationInFrames).toBe(0)
    expect(validateTimeline(tl)).toEqual([])
  })

  it('单条：start=0、stop=end=duration，无重叠可言', () => {
    const tl = flattenTimeline(items(4), { transitionOverlapSeconds: 2 })
    expect(tl.entries[0].startSeconds).toBe(0)
    expect(tl.entries[0].stopSeconds).toBe(4)
    expect(tl.totalSeconds).toBe(4)
    expect(tl.warnings).toEqual([]) // 只有一条时不触发重叠收敛
  })

  it('★ 重叠超过最短时长 ⇒ clamp 并**出声告警**（不静默）', () => {
    const tl = flattenTimeline(items(1, 1), { transitionOverlapSeconds: 5 })
    expect(tl.warnings.length).toBeGreaterThan(0)
    expect(tl.warnings[0]).toContain('超过最短时长')
    // 收敛后 start 不得倒退
    expect(tl.entries[1].startSeconds).toBeGreaterThanOrEqual(0)
    expect(validateTimeline(tl)).toEqual([])
  })

  it('clampOverlap:false ⇒ 不收敛（留给调用方自己处理）', () => {
    const tl = flattenTimeline(items(1, 1), { transitionOverlapSeconds: 5, clampOverlap: false })
    expect(tl.warnings).toEqual([])
    expect(tl.entries[1].startSeconds).toBe(-4)
  })

  it('fps 非法回落 30，合法则采用', () => {
    expect(flattenTimeline(items(1), { fps: 0 }).fps).toBe(30)
    expect(flattenTimeline(items(1), { fps: NaN }).fps).toBe(30)
    expect(flattenTimeline(items(1), { fps: 60 }).fps).toBe(60)
  })

  it('validateTimeline 对损坏结构给出问题清单而不是抛', () => {
    const broken = {
      entries: [
        { startSeconds: 0, endSeconds: 5, durationSeconds: 5, stopSeconds: 5 },
        { startSeconds: 4, endSeconds: 9, durationSeconds: 9, stopSeconds: 4 }, // duration 不自洽 + stop 倒退
      ],
      totalSeconds: 9,
    }
    const problems = validateTimeline(broken)
    expect(problems.length).toBeGreaterThan(0)
    expect(problems.some((p) => p.includes('不一致'))).toBe(true)
    expect(problems.some((p) => p.includes('倒退') || p.includes('二分前提'))).toBe(true)
  })

  it('locate 返回条目与局部秒数；重叠区局部秒数基于**先开始**那条', () => {
    const tl = flattenTimeline(items(5, 5), { transitionOverlapSeconds: 0.5 })
    const at0 = locate(tl, 2)
    expect(at0.entry.order).toBe(0)
    expect(at0.localSeconds).toBe(2)
    const at1 = locate(tl, 6)
    expect(at1.entry.order).toBe(1)
    expect(at1.localSeconds).toBe(1.5) // 6 - 4.5
    expect(locate(tl, 100)).toBeNull()
  })

  it('二分查找在大量条目下仍正确（抽查覆盖关系，不是「起点必命中自己」）', () => {
    const tl = flattenTimeline(items(...new Array(200).fill(2)), { transitionOverlapSeconds: 0.5 })
    for (let i = 0; i < 200; i++) {
      const e = tl.entries[i]
      // ⚠️ 不能断言「起点必命中自己」：有重叠时 entries[i].start 仍落在前一条的 [start,end) 内，
      // 那时返回**前一条**才是对的（见「重叠区返回先开始的那条」）。第一版就是这么红的。
      // 正确的性质是**覆盖关系**：命中的那条必须真的覆盖该时刻。
      for (const t of [e.startSeconds, (e.startSeconds + e.endSeconds) / 2]) {
        const hit = entryAt(tl, t)
        expect(hit, `t=${t} 命中了 null，但它应在 [0, total) 内`).not.toBeNull()
        expect(hit.startSeconds <= t && t < hit.stopSeconds, `t=${t} 命中的条目 [${hit.startSeconds},${hit.stopSeconds}) 并不覆盖它`).toBe(true)
      }
      // 终点必命中**后**一条（半开区间），最后一条的终点是末尾 ⇒ null
      const atEnd = entryAt(tl, e.endSeconds)
      if (i === 199) expect(atEnd).toBeNull()
      else expect(atEnd.order, `第 ${i} 条终点应命中第 ${i + 1} 条`).toBe(i + 1)
    }
  })
})
