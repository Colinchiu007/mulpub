import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  REWRITE_ENGINE_MAX_INPUT_CHARS,
  REWRITE_ENGINE_MAX_OUTPUT_CHARS,
  countRewriteChars,
  prepareRewriteInput,
  shouldSegmentRewrite,
} from './rewrite-engine-limits'

const HERE = dirname(fileURLToPath(import.meta.url))
const ENGINE_CORE = resolve(HERE, '../../../../packages/rewrite-engine/src/rewrite-engine-core.js')

describe('rewrite-engine-limits — 与引擎上限的结构锁', () => {
  it('渲染层常量 === 引擎 MAX_INPUT_CHARS，且分流判据消费该常量（防两处漂移）', () => {
    const source = readFileSync(ENGINE_CORE, 'utf8')
    const match = source.match(/const MAX_INPUT_CHARS = (\d+)/)
    expect(match, '引擎 rewrite-engine-core.js 缺少 MAX_INPUT_CHARS 常量').toBeTruthy()
    expect(Number(match[1])).toBe(REWRITE_ENGINE_MAX_INPUT_CHARS)
    // 第二刀起该常量是「分段阈值」而非硬拒上限：判据必须引用常量做分流
    expect(source).toContain('> MAX_INPUT_CHARS')
    expect(source).not.toContain('> 6000')
    // 长度硬拒分支已移除（>阈值走分段，不返回 TOO_LONG）
    expect(source).not.toContain("errorCode: 'TOO_LONG'")
  })

  it('渲染层输出上限常量 === 引擎 MAX_OUTPUT_CHARS（wordCountRange 合法域真源）', () => {
    const source = readFileSync(ENGINE_CORE, 'utf8')
    const match = source.match(/const MAX_OUTPUT_CHARS = (\d+)/)
    expect(match, '引擎 rewrite-engine-core.js 缺少 MAX_OUTPUT_CHARS 常量').toBeTruthy()
    expect(Number(match[1])).toBe(REWRITE_ENGINE_MAX_OUTPUT_CHARS)
    // 引擎 wordCountRange 防御必须消费该常量，不得写死 6000
    expect(source).toContain('range.max <= MAX_OUTPUT_CHARS')
    expect(source).not.toContain('range.max <= 6000')
  })
})

describe('countRewriteChars — Unicode 码点口径（与引擎 [...content].length 一致）', () => {
  it('BMP 字符按 1 计', () => {
    expect(countRewriteChars('中文abc')).toBe(5)
  })

  it('emoji（代理对）按 1 个码点计，而不是 String.length 的 2', () => {
    expect('😀'.length).toBe(2)
    expect(countRewriteChars('😀')).toBe(1)
  })

  it('null / undefined 归一为空串', () => {
    expect(countRewriteChars(null)).toBe(0)
    expect(countRewriteChars(undefined)).toBe(0)
  })
})

describe('prepareRewriteInput — 不再预截断（rewrite-segment-and-finish-reason 第二刀）', () => {
  // 历史：曾把 >50000 截到 50000（fix-collect-rewrite-too-long）。分段改写落地后，
  // 渲染层预截断会让超长正文永远到不了引擎分段路径（第三轴 M1：死代码），故改为透传。

  it('任意长度都原样透传（50001 不再被截）', () => {
    const content = '字'.repeat(50001)
    const prepared = prepareRewriteInput(content)
    expect(prepared.truncated).toBe(false)
    expect(prepared.originalLength).toBe(50001)
    expect(prepared.text).toBe(content)
    expect([...prepared.text].length).toBe(50001)
  })

  it('超长 emoji 文本同样透传（无截断即无劈开代理对的风险）', () => {
    const content = '😀'.repeat(50001)
    const prepared = prepareRewriteInput(content)
    expect(prepared.truncated).toBe(false)
    expect(prepared.text).toBe(content)
  })

  it('原长文（旧 6000 上限回归）透传', () => {
    const content = '字'.repeat(6001)
    expect(prepareRewriteInput(content).text).toBe(content)
  })

  it('null → 空串（空正文由漏斗的判空守卫处理，不归本函数）', () => {
    expect(prepareRewriteInput(null)).toEqual({ text: '', originalLength: 0, truncated: false })
  })
})

describe('shouldSegmentRewrite — 分段提示判据', () => {
  it('恰好 50000 码点 ⇒ 不分段（阈值是 >，不是 >=）', () => {
    expect(shouldSegmentRewrite('字'.repeat(50000))).toBe(false)
  })

  it('50001 码点 ⇒ 需要分段提示', () => {
    expect(shouldSegmentRewrite('字'.repeat(50001))).toBe(true)
  })

  it('按码点计（emoji 50001 个 ⇒ 分段；不会因 String.length 翻倍误判早）', () => {
    expect(shouldSegmentRewrite('😀'.repeat(50000))).toBe(false)
    expect(shouldSegmentRewrite('😀'.repeat(50001))).toBe(true)
  })

  it('空/短文本 ⇒ 不分段', () => {
    expect(shouldSegmentRewrite('')).toBe(false)
    expect(shouldSegmentRewrite(null)).toBe(false)
    expect(shouldSegmentRewrite('短文')).toBe(false)
  })
})
