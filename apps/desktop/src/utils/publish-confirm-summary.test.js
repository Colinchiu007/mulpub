import { describe, it, expect, vi } from 'vitest'
import { summarizePublishTargets, buildPublishSummaryMessage } from './publish-confirm-summary'

describe('summarizePublishTargets — 计数口径', () => {
  it('同一账号发到两个平台算两个目标；同平台两个账号也算两个', () => {
    const s = summarizePublishTargets([
      { platform: 'toutiao', accountId: 'a1' },
      { platform: 'baijiahao', accountId: 'a1' },
      { platform: 'toutiao', accountId: 'a2' },
    ])
    expect(s).toMatchObject({ platformCount: 2, targetCount: 3 })
    // 明细顺序 = 首次出现顺序（渲染稳定，不随 Set 迭代序漂移）
    expect(s.platforms).toEqual([
      { platform: 'toutiao', accounts: 2 },
      { platform: 'baijiahao', accounts: 1 },
    ])
  })

  it('缺 accountId 归入默认目标，不静默丢弃；重复目标去重', () => {
    const s = summarizePublishTargets([
      { platform: 'weibo' },
      { platform: 'weibo' },
      { platform: 'weibo', accountId: 'b1' },
    ])
    expect(s.platformCount).toBe(1)
    expect(s.targetCount).toBe(2)
  })

  it('脏输入不抛：非数组、空 platform、空白 id 一律按不可用处理', () => {
    expect(summarizePublishTargets(null).platformCount).toBe(0)
    expect(summarizePublishTargets([{}, null, { platform: '  ' }])).toMatchObject({ platformCount: 0, targetCount: 0 })
    expect(summarizePublishTargets([{ platform: 'zhihu', accountId: '  ' }]).targetCount).toBe(1)
  })
})

describe('buildPublishSummaryMessage — 只数不说', () => {
  const targets = [
    { platform: 'toutiao', accountId: 'a1' },
    { platform: 'toutiao', accountId: 'a2' },
    { platform: 'zhihu', accountId: 'a3' },
  ]

  it('三段按顺序拼接：摘要 / 明细 / 截断（截断数为 0 时整段不出现）', () => {
    const resolve = vi.fn((key, params) => `${key}|${JSON.stringify(params)}`)
    const withTrunc = buildPublishSummaryMessage({ targets, truncationCount: 2, resolve })
    const lines = withTrunc.text.split('\n')
    expect(lines).toHaveLength(3)
    expect(lines[0]).toContain('confirmSummary')
    expect(lines[0]).toContain('"articles":1')
    expect(lines[0]).toContain('"platforms":2')
    expect(lines[0]).toContain('"targets":3')
    expect(lines[1]).toContain('confirmDetail')
    expect(lines[1]).toContain('toutiao × 2')
    expect(lines[1]).toContain('zhihu × 1')
    expect(lines[2]).toContain('confirmTruncated')
    expect(withTrunc.failed).toBe(false)

    const noTrunc = buildPublishSummaryMessage({ targets, truncationCount: 0, resolve })
    expect(noTrunc.text.split('\n')).toHaveLength(2)
    expect(noTrunc.text).not.toContain('confirmTruncated')
  })

  it('labelFor 决定明细里的平台称谓（内部 id 不得直出到用户可见文案）', () => {
    const r = buildPublishSummaryMessage({
      targets: [{ platform: 'toutiao', accountId: 'a1' }],
      labelFor: (id) => (id === 'toutiao' ? '今日头条' : id),
      resolve: (key, params) => `${key}|${params.detail}`,
    })
    expect(r.text).toContain('今日头条 × 1')
    expect(r.text).not.toContain('|toutiao ×')
  })

  it('摘要行解析不出来 ⇒ text 空 + failed=true（调用方据此跳过闸门，而不是拿空串弹窗）', () => {
    const r = buildPublishSummaryMessage({ targets, resolve: () => '' })
    expect(r).toMatchObject({ text: '', failed: true })
    expect(r.summary.targetCount).toBe(3)

    const onlyHead = buildPublishSummaryMessage({
      targets,
      resolve: (key) => (key.endsWith('confirmSummary') ? '将发布 3 个目标。' : ''),
    })
    expect(onlyHead.failed).toBe(false)
    expect(onlyHead.text).toBe('将发布 3 个目标。')
  })

  it('零目标时不产出明细行（没有平台可列，也不得留一个空 "明细：" 前缀）', () => {
    const r = buildPublishSummaryMessage({
      targets: [],
      resolve: (key) => (key.endsWith('confirmSummary') ? 'head' : 'DETAIL'),
    })
    expect(r.text).toBe('head')
  })
})
