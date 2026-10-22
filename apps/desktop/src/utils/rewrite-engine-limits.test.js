import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  REWRITE_ENGINE_MAX_INPUT_CHARS,
  REWRITE_ENGINE_MAX_OUTPUT_CHARS,
  LENGTH_TARGET_CHARS,
  buildRewriteLengthOptions,
  countRewriteChars,
  prepareRewriteInput,
  shouldSegmentRewrite,
} from './rewrite-engine-limits'

const HERE = dirname(fileURLToPath(import.meta.url))
const ENGINE_CORE = resolve(HERE, '../../../../packages/rewrite-engine/src/rewrite-engine-core.js')
// Python 侧长度三档真源（长度三档只在 Python 聚合后端有定义）
const PY_SERVICE = resolve(HERE, '../../../../packages/python-backend/src/multi_publish/aggregation/service.py')

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

describe('countRewriteChars — Unicode 码点口径（与引擎 [...content].length 一致）', () => {  it('BMP 字符按 1 计', () => {
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

describe('LENGTH_TARGET_CHARS — 长度三档目标字数的跨语言结构锁（fix-length-compress-target-800）', () => {
  // 为什么需要这把锁：界面上的「精简（约 N 字）」与后端实际用的 target 是**两处副本**。
  // 只改一边 ⇒ 用户看到的字数与实际产出的字数不符，且没有任何其它判据会发现。
  it('渲染层镜像 === Python _LENGTH_RANGES 的 target（只改一边即红）', () => {
    const source = readFileSync(PY_SERVICE, 'utf8')
    const block = source.match(/_LENGTH_RANGES\s*=\s*\{([\s\S]*?)\n\}/)
    expect(block, 'Python service.py 里找不到 _LENGTH_RANGES 定义').toBeTruthy()
    const targets = {}
    for (const m of block[1].matchAll(/"(\w+)":\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/g)) {
      targets[m[1]] = { min: Number(m[2]), max: Number(m[3]), target: Number(m[4]) }
    }
    // 解析必须真的拿到三档：正则失配时「解析到 0 条」也要红，不能静默通过
    expect(Object.keys(targets).sort()).toEqual(['compress', 'expand', 'keep'])
    for (const [name, v] of Object.entries(targets)) {
      expect(LENGTH_TARGET_CHARS[name], `渲染层缺少 ${name} 档目标字数`).toBe(v.target)
    }
  })

  it('三档 target 的单调关系成立（区分档位语义的唯一依据就是 target）', () => {
    expect(LENGTH_TARGET_CHARS.compress).toBeLessThan(LENGTH_TARGET_CHARS.keep)
    expect(LENGTH_TARGET_CHARS.keep).toBeLessThan(LENGTH_TARGET_CHARS.expand)
  })
})

describe('buildRewriteLengthOptions — 长度下拉文案带目标字数（fix-length-compress-target-800）', () => {
  const resolve = (key, params) => {
    const labels = {
      'collection.rewriteLengthKeep': '保持原文（约 {count} 字）',
      'collection.rewriteLengthCompress': '精简（约 {count} 字）',
      'collection.rewriteLengthExpand': '扩写（约 {count} 字）',
    }
    return String(labels[key] || key).replace('{count}', String(params && params.count))
  }

  it('三个选项都带上了各自的目标字数', () => {
    const options = buildRewriteLengthOptions(resolve)
    expect(options.map(o => o.value)).toEqual(['keep', 'compress', 'expand'])
    expect(options[0].label).toContain('1500')
    expect(options[1].label).toContain('800')
    expect(options[2].label).toContain('2500')
  })

  it('文案里不得残留 {count} 占位符（漏传参数就会露出来）', () => {
    for (const o of buildRewriteLengthOptions(resolve)) {
      expect(o.label).not.toContain('{count}')
    }
  })

  it('精简档的目标字数 === 镜像常量（800）', () => {
    const compress = buildRewriteLengthOptions(resolve).find(o => o.value === 'compress')
    expect(compress.label).toContain(String(LENGTH_TARGET_CHARS.compress))
    expect(LENGTH_TARGET_CHARS.compress).toBe(800)
  })
})
