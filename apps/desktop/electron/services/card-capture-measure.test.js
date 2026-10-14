import { describe, it, expect } from 'vitest'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const {
  buildMeasureFragment,
  assertMeasuredHeight,
} = require('./card-capture.js')

/**
 * measureTextWithDom 的**纯函数部分**合同测试（P2-1 × P2-3 缝合点）
 *
 * ★ 分层纪律（与同目录 card-capture.test.js 一致）：
 *   本文件只测**不依赖 Electron** 的决策 —— 转义、margin-top 语义、高度合法性。
 *   真实 offscreen 窗口交互留给 QM-1 打包后的集成测试
 *   （与 P2-3 判据④⑤ 同型：无 GUI 的 runner 里跑不出可信结果）。
 */
describe('buildMeasureFragment：转义', () => {
  it('HTML 特殊字符必须转义（正文里的 < > & 不得当标签）', () => {
    const f = buildMeasureFragment('a < b & c > d')
    expect(f).toContain('&lt;')
    expect(f).toContain('&gt;')
    expect(f).toContain('&amp;')
    // 不得出现未转义的裸 <（那会被当成标签，改变量到的高度）
    expect(f).not.toMatch(/< b/)
  })

  it('★ 反例：#include <stdio.h> 这类技术正文不得被吃掉', () => {
    const f = buildMeasureFragment('#include <stdio.h>')
    expect(f).toContain('&lt;stdio.h&gt;')
  })

  it('普通文本原样保留', () => {
    expect(buildMeasureFragment('你好世界')).toBe('<div>你好世界</div>')
  })

  it('text 非字符串 => TypeError（fail-closed）', () => {
    expect(() => buildMeasureFragment(null)).toThrow(TypeError)
    expect(() => buildMeasureFragment(42)).toThrow(TypeError)
    expect(() => buildMeasureFragment(undefined)).toThrow(TypeError)
  })
})

describe('buildMeasureFragment：noMarginTop 语义', () => {
  it('item.noMarginTop === true => 容器带 margin-top:0', () => {
    expect(buildMeasureFragment('x', { noMarginTop: true })).toContain('margin-top:0')
  })

  it('未传 / false => 不带 margin-top:0', () => {
    expect(buildMeasureFragment('x', {})).not.toContain('margin-top:0')
    expect(buildMeasureFragment('x', { noMarginTop: false })).not.toContain('margin-top:0')
    expect(buildMeasureFragment('x')).not.toContain('margin-top:0')
  })
})

describe('assertMeasuredHeight：绝不返回 0', () => {
  it('0 => 抛错（0 会让分页器把无数段塞进一页）', () => {
    expect(() => assertMeasuredHeight(0, 10)).toThrow(/非法高度/)
  })

  it('负数 / NaN / Infinity / 非数字 => 抛错', () => {
    expect(() => assertMeasuredHeight(-5, 10)).toThrow(/非法高度/)
    expect(() => assertMeasuredHeight(NaN, 10)).toThrow(/非法高度/)
    expect(() => assertMeasuredHeight(Infinity, 10)).toThrow(/非法高度/)
    expect(() => assertMeasuredHeight('120', 10)).toThrow(/非法高度/)
    expect(() => assertMeasuredHeight(null, 10)).toThrow(/非法高度/)
    expect(() => assertMeasuredHeight(undefined, 10)).toThrow(/非法高度/)
  })

  it('合法高度原样返回', () => {
    expect(assertMeasuredHeight(120, 10)).toBe(120)
    expect(assertMeasuredHeight(0.5, 1)).toBe(0.5)
  })

  it('★ 报错带 text 长度（定位用）', () => {
    expect(() => assertMeasuredHeight(0, 42)).toThrow(/长度 42/)
  })
})
