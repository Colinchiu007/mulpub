import { describe, it, expect } from 'vitest'
import { formatUserError, USER_ERROR_CODES } from './user-facing-error'

describe('formatUserError — errorCode 优先', () => {
  it('AUTH_REQUIRED：中文含原因+建议，不暴露通道名', () => {
    const result = formatUserError(
      { code: -3, errorCode: 'AUTH_REQUIRED', message: '当前许可证无权访问该功能，请先登录并确认账号已开通所需权益后重试。', messageParams: { channel: 'store:list-publish-history' } },
      { locale: 'zh' },
    )
    expect(result.errorCode).toBe('AUTH_REQUIRED')
    expect(result.message).toContain('登录')
    expect(result.message).toContain('重试')
    expect(result.message).not.toContain('store:list-publish-history')
    expect(result.message).not.toContain(':')
  })

  it('AUTH_REQUIRED：英文输出自然语言', () => {
    const result = formatUserError({ code: -3, errorCode: 'AUTH_REQUIRED', message: 'x' }, { locale: 'en' })
    expect(result.message).toContain('sign in')
    expect(result.message).not.toContain('store:')
  })

  it('ENTITLEMENT_REQUIRED / UNTRUSTED_SENDER 映射', () => {
    const entitlement = formatUserError({ code: -3, errorCode: 'ENTITLEMENT_REQUIRED', messageParams: { channel: 'publish:wechat' } }, { locale: 'zh' })
    expect(entitlement.errorCode).toBe('ENTITLEMENT_REQUIRED')
    expect(entitlement.message).toContain('权益')

    const untrusted = formatUserError({ code: -3, errorCode: 'UNTRUSTED_SENDER', message: '未授权的调用来源' }, { locale: 'zh' })
    expect(untrusted.errorCode).toBe('UNTRUSTED_SENDER')
    expect(untrusted.message).toContain('重启')
  })

  it('已知 errorCode 未在 catalog 时降级到 code/pattern/透传/fallback', () => {
    // 非技术文本 → 原样透传（保留具体原因）
    const result = formatUserError({ code: -1, errorCode: 'SOME_FUTURE_CODE', message: 'unknown internal' }, { locale: 'zh', fallback: '自定义兜底' })
    expect(result.errorCode).toBe(USER_ERROR_CODES.OPERATION_FAILED)
    expect(result.message).toBe('unknown internal')
    // 技术文本 → 使用 fallback
    const technical = formatUserError({ code: -1, errorCode: 'SOME_FUTURE_CODE', message: 'store:foo failed' }, { locale: 'zh', fallback: '自定义兜底' })
    expect(technical.message).toBe('自定义兜底')
  })
})

describe('formatUserError — 数值 code 映射', () => {
  it.each([
    [-3, USER_ERROR_CODES.AUTH_REQUIRED],
    [-2, USER_ERROR_CODES.VALIDATION_ERROR],
    [-10, USER_ERROR_CODES.NOT_FOUND],
    [-11, USER_ERROR_CODES.TIMEOUT],
    [-12, USER_ERROR_CODES.NETWORK_ERROR],
    [-13, USER_ERROR_CODES.IO_ERROR],
    [429, USER_ERROR_CODES.RATE_LIMITED],
    [402, USER_ERROR_CODES.QUOTA_EXCEEDED],
  ])('code %s → %s', (code, errorCode) => {
    const result = formatUserError({ code, message: 'raw technical' }, { locale: 'zh' })
    expect(result.errorCode).toBe(errorCode)
    expect(result.matched).toBe('code')
    expect(result.message).toBeTruthy()
  })
})

describe('formatUserError — 遗留 pattern 兜底', () => {
  it('含通道名的旧式 message 不直出（pattern 命中）', () => {
    const result = formatUserError({ code: -3, message: '当前许可证无权访问 store:list-publish-history' }, { locale: 'zh' })
    expect(result.errorCode).toBe(USER_ERROR_CODES.AUTH_REQUIRED)
    expect(result.message).not.toContain('store:list-publish-history')
  })

  it('网络/超时/限流 pattern', () => {
    expect(formatUserError({ message: 'connect ECONNREFUSED 127.0.0.1:8002' }, { locale: 'zh' }).errorCode).toBe(USER_ERROR_CODES.NETWORK_ERROR)
    expect(formatUserError({ message: 'request timed out' }, { locale: 'zh' }).errorCode).toBe(USER_ERROR_CODES.TIMEOUT)
    expect(formatUserError({ message: 'HTTP 429 too many requests' }, { locale: 'zh' }).errorCode).toBe(USER_ERROR_CODES.RATE_LIMITED)
  })
})

describe('formatUserError — 未知错误安全兜底', () => {
  it('含技术标识的文本不直出，使用 fallback', () => {
    const channelLike = formatUserError({ code: -1, message: 'store:list-publish-history failed' }, { locale: 'zh', fallback: '操作失败，请稍后重试' })
    expect(channelLike.errorCode).toBe(USER_ERROR_CODES.OPERATION_FAILED)
    expect(channelLike.message).toBe('操作失败，请稍后重试')
    expect(channelLike.message).not.toContain('store:')

    const codeLike = formatUserError({ code: -1, message: 'VOICE_CATALOG_UNAVAILABLE' }, { locale: 'zh', fallback: '加载失败' })
    expect(codeLike.message).toBe('加载失败')

    const stackLike = formatUserError({ code: -1, message: 'boom at line 42' }, { locale: 'zh', fallback: '加载失败' })

    // 浏览器模式 / 桥接不可用哨兵文本必须映射为 fallback，禁止直出 electronAPI
    const bridgeLike = formatUserError({ code: -1, message: 'electronAPI not available' }, { locale: 'zh', fallback: '配置保存失败，请稍后重试' })
    expect(bridgeLike.errorCode).toBe(USER_ERROR_CODES.OPERATION_FAILED)
    expect(bridgeLike.message).toBe('配置保存失败，请稍后重试')
    expect(bridgeLike.message).not.toContain('electronAPI')
    expect(stackLike.message).toBe('加载失败')
  })

  it('自然语言原因文本原样透传（保留具体原因，不丢信息）', () => {
    const fromError = formatUserError(new Error('排期失败：任务不存在'), { locale: 'zh', fallback: '加载失败' })
    expect(fromError.message).toBe('排期失败：任务不存在')
    const fromString = formatUserError('网络错误', { locale: 'zh', fallback: '加载失败' })
    expect(fromString.message).toBe('网络错误')
  })

  it('无 fallback 且文本为技术标识时使用通用文案', () => {
    const result = formatUserError({ code: -1, message: 'internal store:foo at line 3' }, { locale: 'en' })
    expect(result.errorCode).toBe(USER_ERROR_CODES.OPERATION_FAILED)
    expect(result.message.length).toBeGreaterThan(0)
    expect(result.message).not.toContain('store:foo')
  })
})

describe('formatUserError — LLM_KEY_MISSING（AI 改写无密钥，2026-09-12 回归）', () => {
  it('稳定 errorCode 优先：渲染 zh 友好文案，不暴露环境变量名', () => {
    // python-bridge 归一化后的形态：{ errorCode: 'LLM_KEY_MISSING', code: -400, message: '...' }
    const result = formatUserError(
      { errorCode: 'LLM_KEY_MISSING', code: -400, message: 'AI 改写服务尚未配置访问密钥' },
      { locale: 'zh' },
    )
    expect(result.errorCode).toBe('LLM_KEY_MISSING')
    expect(result.matched).toBe('errorCode')
    expect(result.message).toContain('模型设置')
    expect(result.message).not.toContain('LLM_API_KEY')
    expect(result.message).not.toContain('PO_OPENAI_API_KEY')
    expect(result.message).not.toContain('环境变量')
  })

  it('稳定 errorCode：en 自然语言文案', () => {
    const result = formatUserError(
      { errorCode: 'LLM_KEY_MISSING', code: -400, message: 'x' },
      { locale: 'en' },
    )
    expect(result.errorCode).toBe('LLM_KEY_MISSING')
    expect(result.message).toContain('Model Settings')
    expect(result.message).not.toContain('LLM_API_KEY')
  })

  it('遗留原始消息 pattern 兜底：旧版「未配置 LLM API Key…」也命中 LLM_KEY_MISSING 而非直出', () => {
    // 兼容旧后端（无 errorCode，仅 message 原文）
    const legacy = formatUserError(
      { code: -400, message: '未配置 LLM API Key，请在环境变量中设置 LLM_API_KEY 或 PO_OPENAI_API_KEY 后再改写' },
      { locale: 'zh' },
    )
    // 注：旧文本同时命中 API_KEY_NOT_CONFIGURED（pattern 顺序更早），其文案同样指向「模型设置」配置路径，
    // 均不泄露环境变量名。断言最终文案与安全属性，而非具体命中哪个 pattern。
    expect(['LLM_KEY_MISSING', 'API_KEY_NOT_CONFIGURED']).toContain(legacy.errorCode)
    expect(legacy.message).toContain('模型设置')
    expect(legacy.message).not.toContain('LLM_API_KEY')
    expect(legacy.message).not.toContain('PO_OPENAI_API_KEY')
  })
})

describe('formatUserError — aggregation 域错误码 + params 插值（2026-09-12 存量收敛）', () => {
  it('AGGREGATION_CONTENT_EMPTY：zh/en 渲染自然语言', () => {
    const zh = formatUserError({ errorCode: 'AGGREGATION_CONTENT_EMPTY', code: -400 }, { locale: 'zh' })
    expect(zh.errorCode).toBe('AGGREGATION_CONTENT_EMPTY')
    expect(zh.message).toContain('请先输入')
    const en = formatUserError({ errorCode: 'AGGREGATION_CONTENT_EMPTY', code: -400 }, { locale: 'en' })
    expect(en.message).toContain('Please enter')
  })

  it('AGGREGATION_URL_INVALID：zh/en 渲染 + 不泄露内部字段名', () => {
    const zh = formatUserError({ errorCode: 'AGGREGATION_URL_INVALID', code: -400 }, { locale: 'zh' })
    expect(zh.message).toContain('http://')
    expect(zh.message).not.toContain('source_type')
    const en = formatUserError({ errorCode: 'AGGREGATION_URL_INVALID', code: -400 }, { locale: 'en' })
    expect(en.message).toContain('http://')
  })

  it('params 插值：{value}/{supported}/{min}/{max} 占位符替换为实际值', () => {
    const r = formatUserError(
      { errorCode: 'AGGREGATION_STYLE_UNSUPPORTED', code: -400, params: { value: '未知风格', supported: '轻松易懂, 正式严谨' } },
      { locale: 'zh' },
    )
    expect(r.message).toContain('未知风格')
    expect(r.message).toContain('轻松易懂')
    expect(r.message).not.toContain('{value}')
    expect(r.message).not.toContain('{supported}')

    const range = formatUserError(
      { errorCode: 'AGGREGATION_WORD_COUNT_RANGE_INVALID', code: -400, params: { min: '3000', max: '800' } },
      { locale: 'zh' },
    )
    expect(range.message).toContain('3000')
    expect(range.message).toContain('800')
    expect(range.message).not.toContain('{min}')
  })

  it('params 缺失时占位符保留原样（不崩溃不产生 undefined）', () => {
    const r = formatUserError({ errorCode: 'AGGREGATION_STYLE_UNSUPPORTED', code: -400 }, { locale: 'zh' })
    expect(r.message).toContain('{value}')
    expect(r.message).not.toContain('undefined')
  })

  it('AGGREGATION_INTERNAL_ERROR / AGGREGATION_REWRITE_FAILED：500 兜底不再直出异常原文', () => {
    const internal = formatUserError({ errorCode: 'AGGREGATION_INTERNAL_ERROR', code: -500, message: 'ConnectionResetError(10054)' }, { locale: 'zh' })
    expect(internal.message).toContain('内部错误')
    expect(internal.message).not.toContain('ConnectionResetError')
    const rewrite = formatUserError({ errorCode: 'AGGREGATION_REWRITE_FAILED', code: -400 }, { locale: 'en' })
    expect(rewrite.message).toContain('could not be completed')
  })
})
