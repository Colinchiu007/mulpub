import { describe, it, expect } from 'vitest'
import { classifyInputShape, deriveDefaultMode, deriveWordCountRange } from '@/utils/rewrite-defaults'

// rewrite-default-strategy-fix（2026-10-19）
// 锁住「默认参数按输入形态推导」这条契约，防止退回写死的 create + 800-2000。

const TECH_LONG_FORM = [
  '7月15日，前OpenAI CTO Mira Murati在旧金山发布了Thinking Machines Lab的首个模型Inkling。',
  '20亿美元融资，975B参数，100人精英团队——硅谷最受关注的AI创业公司，终于亮牌了。',
  '几乎同一天，强化学习之父Richard Sutton，2024年图灵奖得主，年近七十，宣布创办Oak Lab。',
  'Macaron-V1分两个版本：旗舰版Venti，748B参数，由744B的GLM-5.2基座加四个1B的LoRA组成。',
  'SWE-bench Verified 评测中，Macaron-V1-Venti 以 85.6 分登顶第一，甩开第二名3分。',
].join('\n')

describe('rewrite-defaults — 输入形态判定', () => {
  it('成稿（含句号）判定为 draft', () => {
    expect(classifyInputShape('这是一篇完整的文章。里面有句号。')).toBe('draft')
  })

  it('短选题种子（无句号、短、单行）判定为 topic', () => {
    expect(classifyInputShape('AI大模型最新突破进展')).toBe('topic')
  })

  it('长文本即使无标点也判为 draft', () => {
    expect(classifyInputShape('a'.repeat(100))).toBe('draft')
  })

  it('多行文本判为 draft', () => {
    expect(classifyInputShape('第一行\n第二行')).toBe('draft')
  })

  it('空/空白输入回退 topic（不得抛错）', () => {
    expect(classifyInputShape('')).toBe('topic')
    expect(classifyInputShape('   ')).toBe('topic')
    expect(classifyInputShape(undefined)).toBe('topic')
  })
})

describe('rewrite-defaults — 默认模式推导', () => {
  it('R2：成稿默认 imitate（曾写死 create，导致事实密度全丢）', () => {
    expect(deriveDefaultMode(TECH_LONG_FORM)).toBe('imitate')
  })

  it('短选题默认 create', () => {
    expect(deriveDefaultMode('AI大模型最新突破进展')).toBe('create')
  })

  it('R2 回归锚点：单句成稿也走 imitate', () => {
    expect(deriveDefaultMode('这是一个完整的句子。')).toBe('imitate')
  })
})

describe('rewrite-defaults — 字数区间自适应', () => {
  it('短文沿用既有 800-2000 手感', () => {
    expect(deriveWordCountRange('短文本')).toEqual({ min: 800, max: 2000 })
  })

  it('R3：5000 字长文的默认上限显著大于 2000（不再被硬压 60%）', () => {
    const r = deriveWordCountRange('x'.repeat(5000))
    expect(r.max).toBeGreaterThan(2000)
    // 上限必须 >= 原文长度，否则必然触发硬截断
    expect(r.max).toBeGreaterThanOrEqual(5000)
  })

  it('R3：自适应区间夹在引擎合法域内（max<=6000，min<=max）', () => {
    for (const len of [2000, 3000, 5000, 6000, 12000]) {
      const r = deriveWordCountRange('x'.repeat(len))
      expect(r.max).toBeLessThanOrEqual(6000)
      expect(r.min).toBeGreaterThanOrEqual(200)
      expect(r.min).toBeLessThanOrEqual(r.max)
    }
  })

  it('R3：真实科技长稿的区间能容纳原文', () => {
    const r = deriveWordCountRange(TECH_LONG_FORM)
    expect(r.max).toBeGreaterThanOrEqual([...TECH_LONG_FORM].length)
  })

  it('非字符串输入不抛错且回退默认', () => {
    expect(deriveWordCountRange(undefined)).toEqual({ min: 800, max: 2000 })
    expect(deriveWordCountRange(null)).toEqual({ min: 800, max: 2000 })
  })
})
