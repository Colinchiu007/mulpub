import { describe, it, expect } from 'vitest'
import { normalizeRewriteEngineError } from './rewrite-engine-error'
import { formatUserError } from './user-facing-error'

function engineFailure (errorCode, error) {
  return { code: 0, data: { success: false, errorCode, error } }
}

describe('normalizeRewriteEngineError — 引擎业务错误字段位置归一化', () => {
  it('TOO_LONG → REWRITE_CONTENT_TOO_LONG + {max} 插值参数（信封 code 保留）', () => {
    // rewrite-limits-50000：params.max 取渲染层常量 50000（结构锁对齐引擎 MAX_OUTPUT_CHARS）
    const normalized = normalizeRewriteEngineError(engineFailure('TOO_LONG', '内容过长，最多 50000 字'))
    expect(normalized).toEqual({
      code: 0,
      errorCode: 'REWRITE_CONTENT_TOO_LONG',
      message: '内容过长，最多 50000 字',
      params: { max: 50000 },
    })
  })

  it('SENSITIVE_CONTENT → REWRITE_CONTENT_SENSITIVE', () => {
    expect(normalizeRewriteEngineError(engineFailure('SENSITIVE_CONTENT', '内容包含敏感词，无法改写')).errorCode)
      .toBe('REWRITE_CONTENT_SENSITIVE')
  })

  it('EMPTY_RESULT / LLM_ERROR → 既有 AGGREGATION_REWRITE_FAILED（不新造两套说辞）', () => {
    expect(normalizeRewriteEngineError(engineFailure('EMPTY_RESULT', 'LLM 返回空结果')).errorCode)
      .toBe('AGGREGATION_REWRITE_FAILED')
    expect(normalizeRewriteEngineError(engineFailure('LLM_ERROR', 'LLM 调用失败: timeout')).errorCode)
      .toBe('AGGREGATION_REWRITE_FAILED')
  })

  it('NO_LLM_CLIENT / EMPTY_CONTENT → 复用既有稳定码', () => {
    expect(normalizeRewriteEngineError(engineFailure('NO_LLM_CLIENT', 'LLM 客户端未配置')).errorCode)
      .toBe('LLM_NOT_CONFIGURED')
    expect(normalizeRewriteEngineError(engineFailure('EMPTY_CONTENT', '内容不能为空')).errorCode)
      .toBe('AGGREGATION_CONTENT_EMPTY')
  })

  it('未登记码保留原值 + 自然语言 message（formatUserError 可透传，仍优于笼统兜底）', () => {
    const normalized = normalizeRewriteEngineError(engineFailure('NO_STRATEGY', '未找到合适的改写策略'))
    expect(normalized.errorCode).toBe('NO_STRATEGY')
    expect(normalized.message).toBe('未找到合适的改写策略')
    expect(formatUserError(normalized, { locale: 'zh' }).message).toBe('未找到合适的改写策略')
  })

  it('防御：data 缺失时给出稳定形状，不抛错', () => {
    expect(normalizeRewriteEngineError({ code: 0 })).toEqual({
      code: 0, errorCode: '', message: '', params: {},
    })
    expect(normalizeRewriteEngineError(null)).toEqual({
      code: -99, errorCode: '', message: '', params: {},
    })
  })
})

describe('引擎业务错误的最终文案（formatUserError 端到端）', () => {
  it('zh：TOO_LONG 不再回落「AI 改写失败」，给出上限与可操作建议', () => {
    const formatted = formatUserError(
      normalizeRewriteEngineError(engineFailure('TOO_LONG', '内容过长，最多 50000 字')),
      { locale: 'zh', fallback: 'AI 改写失败' },
    )
    expect(formatted.errorCode).toBe('REWRITE_CONTENT_TOO_LONG')
    expect(formatted.matched).toBe('errorCode')
    expect(formatted.message).toContain('50000')
    expect(formatted.message).toContain('改写')
    expect(formatted.message).not.toBe('AI 改写失败')
  })

  it('en：TOO_LONG 输出英文且含上限数字（params 插值生效）', () => {
    const formatted = formatUserError(
      normalizeRewriteEngineError(engineFailure('TOO_LONG', 'x')),
      { locale: 'en', fallback: 'AI rewrite failed' },
    )
    expect(formatted.message).toContain('50000')
    expect(formatted.message).toContain('rewrite')
    expect(formatted.message).not.toBe('AI rewrite failed')
  })
})
