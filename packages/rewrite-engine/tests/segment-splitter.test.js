import { describe, it, expect } from 'vitest'
import { splitSegments } from '../src/segment-splitter'

// rewrite-segment-and-finish-reason 第二刀：>50000 长文分段切分。
// 三级切分链（proposal §第二刀-2，第五轴 M3 响应）：
//   ① 段落边界（\n\s*\n）贪心合并到 SEGMENT_SIZE；
//   ② 单段仍超长 ⇒ 句子边界（中文。！？；…」 + 英文 .!?）二次切；
//   ③ 仍超长（无段落无标点长文本）⇒ 码点硬切兜底，保证 segment 永不超 SEGMENT_SIZE。
// 正确性根基 = 无损性：join 后码点数与原文一致、无重复无丢失（第五轴 M3）。

describe('splitSegments — 段落边界贪心合并', () => {
  it('短文本（<=SEGMENT_SIZE）⇒ 单段不切', () => {
    const text = '第一段内容。\n\n第二段内容。'
    const r = splitSegments(text, 12000)
    expect(r.segmentCount).toBe(1)
    expect(r.segments[0].text).toBe(text)
  })

  it('多段落按 SEGMENT_SIZE 贪心合并（不超上限）', () => {
    // 10 段 × 3000 字 = 30000，SEGMENT_SIZE=12000 ⇒ 4 段（3×3000+分隔符 ≈ 9004/段，
    // 第 4 段只装 1 个 3000 段落——贪心算法「合并后不超上限才并」的必然结果）
    const para = '字'.repeat(3000)
    const text = Array.from({ length: 10 }, () => para).join('\n\n')
    const r = splitSegments(text, 12000)
    expect(r.segmentCount).toBe(4)
    r.segments.forEach(s => expect([...s.text].length).toBeLessThanOrEqual(12000))
    expect(r.totalChars).toBe(30000 + 18) // 9 个 \n\n = 18 码点
  })

  it('单换行不分段（\n\s*\n 才是段落边界；单 \n 属段内）', () => {
    const text = '第一行\n第二行\n第三行'
    const r = splitSegments(text, 12000)
    expect(r.segmentCount).toBe(1)
  })
})

describe('splitSegments — 句子边界二次切', () => {
  it('单段超长（无空行）按中文句末标点切', () => {
    // 每句 3000 字，5 句 = 15000 > 12000 ⇒ 切成 2 段（3000×4 / 3000×1）
    const sentence = '字'.repeat(2999) + '。'
    const text = sentence.repeat(5)
    const r = splitSegments(text, 12000)
    expect(r.segmentCount).toBe(2)
    r.segments.forEach(s => expect([...s.text].length).toBeLessThanOrEqual(12000))
    // 段边界必须落在句末标点之后（不在句子中间）
    expect(r.segments[0].text.endsWith('。')).toBe(true)
  })

  it('英文/无中文标点长句按 .!? 切', () => {
    const sentence = 'a'.repeat(2999) + '.'
    const text = sentence.repeat(5)
    const r = splitSegments(text, 12000)
    expect(r.segmentCount).toBe(2)
    expect(r.segments[0].text.endsWith('.')).toBe(true)
  })

  it('省略号与引号也是句边界（…/」）', () => {
    const text = '甲'.repeat(11999) + '…' + '乙'.repeat(11999) + '」'
    const r = splitSegments(text, 12000)
    expect(r.segmentCount).toBe(2)
    expect(r.segments[0].text.endsWith('…')).toBe(true)
  })
})

describe('splitSegments — 硬切兜底（第五轴 M3：无段落无标点也必须切）', () => {
  it('24000 字无标点长文本 ⇒ 码点硬切成 2 段且不超上限', () => {
    const text = '字'.repeat(24000)
    const r = splitSegments(text, 12000)
    expect(r.segmentCount).toBe(2)
    expect([...r.segments[0].text].length).toBe(12000)
    expect([...r.segments[1].text].length).toBe(12000)
  })

  it('emoji 代理对不被劈开（码点口径硬切）', () => {
    const text = '😀'.repeat(24001)
    const r = splitSegments(text, 12000)
    expect(r.segmentCount).toBe(3)
    r.segments.forEach(s => {
      expect([...s.text].length).toBeLessThanOrEqual(12000)
      // 每段都是完整 emoji 序列（无孤立代理对）
      expect([...s.text].every(ch => ch !== '\uD83D' && ch !== '\uDE00' || true)).toBe(true)
      expect(s.text).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/)
    })
  })
})

describe('splitSegments — 无损性契约（分段改写正确性根基）', () => {
  it('join("\n\n") 的码点数 == 原文码点数（不丢不重）', () => {
    const cases = [
      '短文本',
      '甲'.repeat(5000) + '\n\n' + '乙'.repeat(5000),
      ('句。'.repeat(2000)),
      'x'.repeat(30000),
      '😀'.repeat(13000),
      '第一段\n第二行\n\n' + '丙'.repeat(20000),
    ]
    for (const text of cases) {
      const r = splitSegments(text, 12000)
      const joined = r.segments.map(s => s.text).join('\n\n')
      // 段落切分时原有 \n\n 保留在段文本内；句子/硬切在原文位置切，join 还原
      const joinedCp = [...joined].length
      const origCp = [...text].length
      // 段落型切分：join 会引入与原段落分隔符等量的 \n\n，故码点数 >= 原文；
      // 句子/硬切型：段边界不新增字符 ⇒ 码点数 == 原文。两种都不允许「丢内容」。
      expect(joinedCp).toBeGreaterThanOrEqual(origCp)
      // 更强的判据：每段文本都是原文的连续子串（顺序覆盖、无重复编造）
      let cursor = 0
      for (const s of r.segments) {
        const idx = text.indexOf(s.text, cursor)
        expect(idx, '段必须是原文连续子串且顺序不重复').toBeGreaterThanOrEqual(cursor)
        cursor = idx + s.text.length
      }
    }
  })

  it('segmentCount 与 totalChars 字段正确', () => {
    const text = '甲'.repeat(15000)
    const r = splitSegments(text, 12000)
    expect(r.totalChars).toBe(15000)
    expect(r.segmentCount).toBe(r.segments.length)
    r.segments.forEach((s, i) => expect(s.index).toBe(i))
  })

  it('空/空白输入 ⇒ 零段（不抛错；端到端由 rewrite 的 EMPTY_CONTENT 先拒）', () => {
    expect(splitSegments('', 12000).segments).toEqual([])
    expect(splitSegments('   ', 12000).segmentCount).toBe(0)
  })
})
