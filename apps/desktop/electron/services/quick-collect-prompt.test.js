/**
 * quick-collect-prompt — 提示词组装与无素材声明行
 */
import { describe, it, expect } from 'vitest'

const command = {
  id: 'qc-x',
  title: 'AI 领域动向',
  prompt: '请检索过去48小时内AI与新技术领域的真实动态，覆盖三类：1) 版本发布；2) 新项目；3) 重大事件。',
  keywords: ['LLM'],
  windowHours: 48,
  sources: ['hackernews'],
  builtin: false,
}

const material = {
  url: 'https://example.com/news',
  title: 'vLLM 发布新版本',
  source: 'hackernews',
  snippet: '官方发布说明',
  engagement: 12,
  createdUtc: Math.floor(Date.parse('2026-10-11T02:30:00.000Z') / 1000),
}

async function mod () {
  return import('../services/quick-collect-prompt')
}

describe('quick-collect-prompt/buildMessages', () => {
  it('指令正文逐字透传（不得被模板改写）', async () => {
    const { buildMessages } = await mod()
    const { messages } = buildMessages(command, [material])
    expect(messages[1].content).toContain(command.prompt)
  })

  it('system 含三条硬约束（不得编造 / 链接只用素材 / 不足要说）', async () => {
    const { buildMessages, SYSTEM_PROMPT } = await mod()
    const { messages } = buildMessages(command, [material])
    expect(messages[0].role).toBe('system')
    expect(messages[0].content).toBe(SYSTEM_PROMPT)
    expect(SYSTEM_PROMPT).toContain('不得编造')
    expect(SYSTEM_PROMPT).toContain('只能使用素材清单里给出的链接')
    expect(SYSTEM_PROMPT).toContain('必须明确说明缺什么')
  })

  it('素材清单逐条带链接与 UTC+8 时间；无素材时写「本次未获得素材」', async () => {
    const { buildMessages } = await mod()
    const withMaterial = buildMessages(command, [material]).messages[1].content
    expect(withMaterial).toContain('链接=https://example.com/news')
    expect(withMaterial).toContain('时间=2026-10-11 10:30')
    expect(withMaterial).toContain('素材时间范围：最近 48 小时')
    const empty = buildMessages(command, []).messages[1].content
    expect(empty).toContain('（本次未获得素材）')
    expect(empty).toContain('不要输出任何具体事件/版本/时间')
  })

  it('窗口为 0 时文案为「不限时间」；temperature/max_tokens 固定', async () => {
    const { buildMessages } = await mod()
    const out = buildMessages({ ...command, windowHours: 0 }, [])
    expect(out.messages[1].content).toContain('素材时间范围：不限时间')
    expect(out.temperature).toBe(0.3)
    expect(out.max_tokens).toBe(1600)
  })
})

describe('quick-collect-prompt/formatUtc8', () => {
  it('epoch 秒 → UTC+8 的可读时间；非法输入返回空串', async () => {
    const { formatUtc8 } = await mod()
    expect(formatUtc8(Math.floor(Date.parse('2026-10-11T02:30:00.000Z') / 1000))).toBe('2026-10-11 10:30')
    expect(formatUtc8(0)).toBe('')
    expect(formatUtc8('x')).toBe('')
  })
})

describe('quick-collect-prompt/声明行', () => {
  it('empty / skipped 有声明行，ok / partial 没有', async () => {
    const { buildDisclaimerLine } = await mod()
    expect(buildDisclaimerLine(command, 'empty')).toContain('未检索到最近 48 小时')
    expect(buildDisclaimerLine({ ...command, windowHours: 0 }, 'empty')).toContain('未检索到可核对的素材')
    expect(buildDisclaimerLine(command, 'skipped')).toContain('未配置检索关键词')
    expect(buildDisclaimerLine(command, 'ok')).toBe('')
    expect(buildDisclaimerLine(command, 'partial')).toBe('')
  })

  it('模型已自述"没检索到/未联网"时不重复插入', async () => {
    const { shouldPrependDisclaimer } = await mod()
    expect(shouldPrependDisclaimer('本次未检索到任何可靠信息。')).toBe(false)
    expect(shouldPrependDisclaimer('本回答未联网检索。')).toBe(false)
    expect(shouldPrependDisclaimer('以下是三条建议关注。')).toBe(true)
  })
})
