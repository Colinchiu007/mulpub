import { describe, it, expect } from 'vitest'
import { normalizeChatResult, isTruncatedFinishReason } from '../src/llm-result'

// rewrite-segment-and-finish-reason 第一刀：llmClient.chat 契约兼容归一化。
// 背景：finish_reason 透传需要 chat 能返回 {text, finishReason}，但既有实现
// （主进程 rewrite-engine.js 内置 chatClient、第三方注入的 llmClient）返回 string；
// keyword-extractor.js 的 extractWithLLM 也消费 chat 且对非 string fail-open 静默返回 []。
// 单点归一化保证两处消费点行为一致。

describe('normalizeChatResult — string/object 双形态归一化', () => {
  it('string 旧实现 ⇒ {text: 原串, finishReason: null}（兼容不炸）', () => {
    expect(normalizeChatResult('改写结果')).toEqual({ text: '改写结果', finishReason: null })
  })

  it('object 新实现 ⇒ text/finishReason 透传', () => {
    expect(normalizeChatResult({ text: 'x', finishReason: 'length' }))
      .toEqual({ text: 'x', finishReason: 'length' })
  })

  it('object 缺 finishReason ⇒ null（不臆造）', () => {
    expect(normalizeChatResult({ text: 'x' })).toEqual({ text: 'x', finishReason: null })
  })

  it('object 的 text 非字符串 ⇒ String() 归一（数字/布尔不静默丢失）', () => {
    expect(normalizeChatResult({ text: 123 }).text).toBe('123')
  })

  it('空 text（新旧形态都算）⇒ 判空由调用方负责，本函数不吞', () => {
    expect(normalizeChatResult('')).toEqual({ text: '', finishReason: null })
    expect(normalizeChatResult({ text: '' })).toEqual({ text: '', finishReason: null })
  })

  it('null / undefined / 数字 / 数组 ⇒ {text: ""}（不抛错）', () => {
    expect(normalizeChatResult(null)).toEqual({ text: '', finishReason: null })
    expect(normalizeChatResult(undefined)).toEqual({ text: '', finishReason: null })
    expect(normalizeChatResult(42)).toEqual({ text: '', finishReason: null })
    expect(normalizeChatResult(['a'])).toEqual({ text: '', finishReason: null })
  })
})

describe('isTruncatedFinishReason — provider 截断语义映射', () => {
  it('OpenAI finish_reason=length ⇒ 截断', () => {
    expect(isTruncatedFinishReason('length')).toBe(true)
  })

  it('Anthropic stop_reason=max_tokens ⇒ 截断（adapter 已归一出 finish_reason）', () => {
    expect(isTruncatedFinishReason('max_tokens')).toBe(true)
  })

  it('stop / content_filter / null / undefined ⇒ 非截断', () => {
    expect(isTruncatedFinishReason('stop')).toBe(false)
    expect(isTruncatedFinishReason('content_filter')).toBe(false)
    expect(isTruncatedFinishReason(null)).toBe(false)
    expect(isTruncatedFinishReason(undefined)).toBe(false)
  })

  it('非字符串入参 ⇒ false（不抛错）', () => {
    expect(isTruncatedFinishReason(42)).toBe(false)
    expect(isTruncatedFinishReason({})).toBe(false)
  })
})
