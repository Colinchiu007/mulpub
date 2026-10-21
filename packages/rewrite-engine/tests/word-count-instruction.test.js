/**
 * word-count-instruction 模块单测（collect-rewrite-wordcount，2026-10-20）。
 *
 * 这个模块承载「字数区间 → 注入 prompt 的一句字数要求」的措辞。核心文件里只留区间**校验**
 * （渲染层结构锁要求 `range.max <= MAX_OUTPUT_CHARS` 逐字留在 rewrite-engine-core.js）。
 *
 * 为什么单独立文件测：措辞是**用户可见效果**的直接来源——同一句「0 到 6000 字之间」会把改写
 * 做成摘要（实测 3515 字原文 → 1229 字），而「不得超过 6000 字 + 目标篇幅约 3515 字」不会。
 * 这条差异必须被字面锁住，不能靠"跑一遍看看"。
 */
var { buildWordCountInstruction, computeWordCountTarget } = require('../src/word-count-instruction')

describe('word-count-instruction — 字数区间指令的措辞', function () {
  test('有下限（min>0）：形态是「控制在 {min} 到 {max} 字之间」（既有契约不变）', function () {
    var text = buildWordCountInstruction({ min: 800, max: 2000 }, 3515)
    expect(text).toContain('【字数要求】')
    expect(text).toContain('800 到 2000 字之间')
    expect(text).not.toContain('不得超过')
  })

  test('无下限（min=0）：只给上限 + 目标篇幅 + 反摘要约束（不得出现「0 到 N」）', function () {
    var text = buildWordCountInstruction({ min: 0, max: 6000 }, 3515)
    expect(text).toContain('【字数要求】')
    expect(text).toContain('不得超过 6000 字')
    expect(text).toContain('目标篇幅约 3515 字')
    expect(text).toContain('不要把原文压缩成摘要')
    expect(text).not.toContain('0 到 6000')
  })

  test('目标篇幅 = min(原文长度, 上限)：上限低于原文时取上限（不与硬上限自相矛盾）', function () {
    expect(computeWordCountTarget({ min: 0, max: 2000 }, 3000)).toBe(2000)
    expect(computeWordCountTarget({ min: 0, max: 6000 }, 3515)).toBe(3515)
    // 原文长度未知（非数字 / 0 / 负数）⇒ 目标取上限
    expect(computeWordCountTarget({ min: 0, max: 6000 }, undefined)).toBe(6000)
    expect(computeWordCountTarget({ min: 0, max: 6000 }, 0)).toBe(6000)
    expect(computeWordCountTarget({ min: 0, max: 6000 }, -5)).toBe(6000)
  })

  test('上限低于原文时，指令里不得出现原文长度（否则模型会写出超限稿）', function () {
    var text = buildWordCountInstruction({ min: 0, max: 2000 }, 3000)
    expect(text).toContain('目标篇幅约 2000 字')
    expect(text).not.toContain('3000')
  })
})
