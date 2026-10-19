import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  REWRITE_ENGINE_MAX_INPUT_CHARS,
  countRewriteChars,
  prepareRewriteInput,
} from './rewrite-engine-limits'

const HERE = dirname(fileURLToPath(import.meta.url))
const ENGINE_CORE = resolve(HERE, '../../../../packages/rewrite-engine/src/rewrite-engine-core.js')

describe('rewrite-engine-limits — 与引擎上限的结构锁', () => {
  it('渲染层常量 === 引擎 MAX_INPUT_CHARS，且判据消费该常量（防两处漂移）', () => {
    const source = readFileSync(ENGINE_CORE, 'utf8')
    const match = source.match(/const MAX_INPUT_CHARS = (\d+)/)
    expect(match, '引擎 rewrite-engine-core.js 缺少 MAX_INPUT_CHARS 常量').toBeTruthy()
    expect(Number(match[1])).toBe(REWRITE_ENGINE_MAX_INPUT_CHARS)
    // 防止「常量定义了但 _validate 仍写死另一个数」：判据必须引用常量
    expect(source).toContain('len > MAX_INPUT_CHARS')
    expect(source).not.toContain('len > 6000')
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

describe('prepareRewriteInput — 超长截断边界', () => {
  it('恰好 6000 码点：不截断、文本原样', () => {
    const content = '字'.repeat(6000)
    const prepared = prepareRewriteInput(content)
    expect(prepared.truncated).toBe(false)
    expect(prepared.originalLength).toBe(6000)
    expect(prepared.text).toBe(content)
  })

  it('5999 码点：不截断（不误杀）', () => {
    const prepared = prepareRewriteInput('字'.repeat(5999))
    expect(prepared.truncated).toBe(false)
    expect(prepared.originalLength).toBe(5999)
  })

  it('6001 码点：截到 6000，originalLength 保留真实长度', () => {
    const content = '字'.repeat(6001)
    const prepared = prepareRewriteInput(content)
    expect(prepared.truncated).toBe(true)
    expect(prepared.originalLength).toBe(6001)
    expect([...prepared.text].length).toBe(REWRITE_ENGINE_MAX_INPUT_CHARS)
    expect(prepared.text).toBe('字'.repeat(6000))
  })

  it('截断不得劈开代理对（emoji 边界完整）', () => {
    const prepared = prepareRewriteInput('😀'.repeat(6001))
    expect(prepared.truncated).toBe(true)
    expect([...prepared.text].length).toBe(6000)
    expect(prepared.text).toBe('😀'.repeat(6000))
  })

  it('null → 空串（空正文由漏斗的判空守卫处理，不归本函数）', () => {
    expect(prepareRewriteInput(null)).toEqual({ text: '', originalLength: 0, truncated: false })
  })
})
