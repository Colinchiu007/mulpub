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
  // CCG 深度审查 i5：短选题种子常带感叹号/句号（「震惊！AI重大突破」），
  // 首版把标点放最高优先级 ⇒ 被误判成稿 ⇒ 走 imitate，反向误判。
  it('i5：带感叹号的短选题种子仍判为 topic（标点不得压过长度）', () => {
    expect(classifyInputShape('震惊！AI重大突破')).toBe('topic')
    expect(deriveDefaultMode('震惊！AI重大突破')).toBe('create')
  })

  it('i5：带句号的短选题种子仍判为 topic', () => {
    expect(classifyInputShape('GPT-5 发布了。')).toBe('topic')
    expect(deriveDefaultMode('GPT-5 发布了。')).toBe('create')
  })

  it('i5：长文成稿不受影响（长度优先于标点）', () => {
    expect(classifyInputShape(TECH_LONG_FORM)).toBe('draft')
    expect(deriveDefaultMode(TECH_LONG_FORM)).toBe('imitate')
  })

  it('i5：中间长度靠结构判定（多段/陈述句⇒draft）', () => {
    expect(classifyInputShape('第一段内容。\n第二段内容。')).toBe('draft')
  })

  // i5 后判据改为「长度优先」：≤30 字的短句即便带句号也归 topic（选题种子常态）。
  // 这不是放宽——短句本来就不是成稿，「这是一个完整的句子。」不是一篇待改写的文章。
  it('成稿（中间长度 + 多句）判定为 draft', () => {
    expect(classifyInputShape('这是一篇完整的文章。里面有句号。还有第三句。')).toBe('draft')
  })

  it('短选题种子（无句号、短、单行）判定为 topic', () => {
    expect(classifyInputShape('AI大模型最新突破进展')).toBe('topic')
  })

  it('长文本即使无标点也判为 draft', () => {
    expect(classifyInputShape('a'.repeat(100))).toBe('draft')
  })

  // 7 字 ≤ TOPIC_MAX_LENGTH(12) ⇒ 直接落 topic，长度档优先于结构档。
  // 两行短文本不是成稿；真正成稿由「≥80 字」或「灰色带内多句」承担。
  it('短的多行文本仍判 topic（长度档优先于结构档）', () => {
    expect(classifyInputShape('第一行\n第二行')).toBe('topic')
  })

  it('灰色带内的多行文本判 draft', () => {
    expect(classifyInputShape('这是一段中等长度的正文内容。\n这是第二段的正文内容。')).toBe('draft')
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

  // i5 后：单句短句（≤30 字）归 topic ⇒ create。这是**正确**行为——
  // 一句话不是一篇待改写成稿；真正的成稿判定由长度/多段/多句承担（见上方 draft 用例）。
  it('R2 回归锚点：单句短句走 create（不是成稿）', () => {
    expect(deriveDefaultMode('这是一个完整的句子。')).toBe('create')
  })

  it('R2 回归锚点：多句成稿走 imitate（真正的成稿形态）', () => {
    expect(deriveDefaultMode('第一句说完。第二句继续。第三句收尾。')).toBe('imitate')
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
