import { describe, expect, it } from 'vitest'
import { formatPipelineError, RULES } from './pipeline-error-formatter'

describe('formatPipelineError', () => {
  it('returns empty for empty input', () => {
    const r = formatPipelineError('')
    expect(r).toEqual({ message: '', key: '', params: {} })
  })

  it('matches 402 insufficient balance', () => {
    const r = formatPipelineError('Story2Video optimize failed: Error code: 402 - insufficient_balance_error')
    expect(r.key).toBe('story2video.quota_exceeded')
  })

  it('extracts scene number from 402 error', () => {
    const r = formatPipelineError('Story2Video optimize scene 3 failed: Error code: 402')
    expect(r.key).toBe('story2video.quota_exceeded')
    expect(r.params.context).toContain('场景')
  })

  it('extracts the concrete provider without treating provider account as a provider', () => {
    const r = formatPipelineError('Image provider "minimax-multimodal" failed: Error code: 402', { locale: 'en-US' })
    expect(r.params.provider).toBe('MiniMax')
    expect(r.params.context).toBe('')
  })

  it('matches content policy review', () => {
    const r = formatPipelineError('Image generation requires user input after content-policy review')
    expect(r.key).toBe('story2video.needs_user_input')
  })

  it('matches compose timeout', () => {
    const r = formatPipelineError('视频合成超时')
    expect(r.key).toBe('story2video.compose_timeout')
  })

  it('matches compose timeout English', () => {
    const r = formatPipelineError('Video composition timed out. Check disk space.')
    expect(r.key).toBe('story2video.compose_timeout')
  })

  it('matches rate limit', () => {
    const r = formatPipelineError('rate limit exceeded, too many requests (429)')
    expect(r.key).toBe('story2video.rate_limited')
    expect(r.params.provider).toBe('当前')
  })

  it('matches explicit Go usage limit before generic 429 rate limiting', () => {
    const r = formatPipelineError('Story2Video optimize failed: Error code: 429 - GoUsageLimitError: 5-hour usage limit reached. Resets in 1hr 32min.')
    expect(r.key).toBe('story2video.quota_exceeded')
    expect(r.params.provider).toBe('当前')
  })

  it('matches usage limit reached without a provider-specific error name', () => {
    const r = formatPipelineError('The model usage limit has been reached; try again later.')
    expect(r.key).toBe('story2video.quota_exceeded')
  })

  it('uses a concrete provider for a rate-limit error when it is present', () => {
    const r = formatPipelineError('Image provider: kling rate limit exceeded (429)')
    expect(r.params.provider).toBe('Kling')
  })

  it('normalizes repeated empty results without exposing the raw failure text', () => {
    const r = formatPipelineError('Image provider "minimax-multimodal" scene 4 repeatedly returned no result', { locale: 'en-US' })
    expect(r.key).toBe('story2video.empty_result')
    expect(r.params.provider).toBe('MiniMax')
    expect(r.params.context).toBe(' (scene 4)')
  })

  it('matches prompt-engine service unavailable', () => {
    const r = formatPipelineError('prompt-engine 未运行或不可达，请检查 PROMPT_DIR 与端口 8013')
    expect(r.key).toBe('story2video.optimize_service_unavailable')
    expect(r.params.context).toBe('')
  })

  it('matches UnsupportedParamsError with provider and param', () => {
    const r = formatPipelineError('Image provider agnes-image failed: UnsupportedParamsError: Setting response_format')
    expect(r.key).toBe('story2video.provider_params_unsupported')
    expect(r.params.provider).toBe('Agnes Image')
    expect(r.params.provider).not.toBe('agnes-image')
  })

  it('falls back to a natural model-account label for an unknown provider', () => {
    const r = formatPipelineError('Image provider mystery-provider failed: UnsupportedParamsError: Setting response_format')
    expect(r.params.provider).toBe('当前')
    expect(r.params.provider).not.toContain('mystery-provider')
  })

  it('matches asset generation failure with ratio', () => {
    const r = formatPipelineError('Asset scene generation failed: 0/51 scenes have both image and audio. Image #1: some error')
    expect(r.key).toBe('story2video.asset_generation_failed')
    expect(r.params.context).toContain('场景')
    expect(r.params.context).toContain('图片生成')
  })

  it('matches generic optimize failure', () => {
    const r = formatPipelineError('Story2Video optimize scene 5 failed: network error')
    expect(r.key).toBe('story2video.optimize_failed')
  })

  it('matches compose failure', () => {
    const r = formatPipelineError('视频合成失败')
    expect(r.key).toBe('story2video.compose_failed')
  })

  it('matches API error without exposing its status code in renderer params', () => {
    const r = formatPipelineError('Image provider "kling" failed: Error code: 500 from model')
    expect(r.key).toBe('story2video.api_error')
    expect(r.params.provider).toBe('Kling')
    expect(r.params.statusCode).toBeUndefined()
  })

  it('passes through short natural language errors', () => {
    const r = formatPipelineError('候选图片落盘失败')
    expect(r.key).toBe('')
    expect(r.message).toBe('候选图片落盘失败')
  })

  it('uses fallback for long technical errors', () => {
    const r = formatPipelineError('a'.repeat(200))
    expect(r.key).toBe('story2video.operation_failed')
  })

  it('uses fallback for errors with technical markers', () => {
    const r = formatPipelineError('Error at line 42 in module X')
    expect(r.key).toBe('story2video.operation_failed')
  })

  it('has locale-consistent rule count', () => {
    expect(RULES.length).toBeGreaterThanOrEqual(10)
  })

  it('matches SenseNova 429 rpm exhausted as rate_limited not quota_exceeded', () => {
    const raw = "Story2Video optimize failed: Story2Video 场景 2 prompt-engine 优化失败: Error code: 429 - {'error': {'message': 'rpm exhausted', 'type': 'quota_exceeded_error', 'code': '8'}}"
    const result = formatPipelineError(raw)
    expect(result.key).toBe('story2video.rate_limited')
  })

  it('matches the VOICE_CLONE_UNAVAILABLE backend prefix (history page error chain)', () => {
    const r = formatPipelineError('VOICE_CLONE_UNAVAILABLE: 供应商已不再受理该音色，且本地克隆样本缺失')
    expect(r.key).toBe('story2video.voice_clone_unavailable')
    expect(r.params).toEqual({ context: '' })
    expect(r.message).toBe('')
  })

  it("matches the provider access-denial wording you don't have access to this voice_id", () => {
    const raw = "Asset scene generation failed: 0/9 scenes have both image and audio. TTS #1: TTS provider failed: you don't have access to this voice_id"
    const r = formatPipelineError(raw)
    expect(r.key).toBe('story2video.voice_clone_unavailable')
  })

  it('keeps plain voice_id errors on the existing voice path (no regression)', () => {
    const r = formatPipelineError('TTS provider "minimax-tts" failed: invalid params, voice id wrong')
    expect(r.key).not.toBe('story2video.voice_clone_unavailable')
  })
})

describe('formatPipelineError — compose 预检失败（error-message-user-friendly-audit，2026-10-20 事故）', () => {
  // 事故原文：历史记录失败卡片显示 "Input media exceeds the total size limit"。
  // 该文本短（<120）且不含技术标记，走的是 formatter 的「短自然语言直出」分支。
  it('输入媒体总大小超限映射到 compose_input_size_exceeded，不再直出英文', () => {
    const r = formatPipelineError('Input media exceeds the total size limit')
    expect(r.key).toBe('story2video.compose_input_size_exceeded')
    expect(r.message).toBe('')
    expect(r.params.context).toBe('')
  })

  it('体积数字可提取为可插值参数（limitMb / actualMb）', () => {
    const r = formatPipelineError('Input media exceeds the total size limit: 780MB > 512MB')
    expect(r.key).toBe('story2video.compose_input_size_exceeded')
    expect(r.params.actualMb).toBe('780MB')
    expect(r.params.limitMb).toBe('512MB')
  })

  it('中文形态同样归一化（存量 run.error）', () => {
    const r = formatPipelineError('输入媒体总大小超过上限')
    expect(r.key).toBe('story2video.compose_input_size_exceeded')
  })

  it('英文界面 key 稳定，参数可插值', () => {
    const r = formatPipelineError('Input media exceeds the total size limit: 780MB > 512MB', { locale: 'en-US' })
    expect(r.key).toBe('story2video.compose_input_size_exceeded')
    expect(r.params.actualMb).toBe('780MB')
  })

  // ⛔ 排序契约（CCG 外部评审 i6，2026-10-20）：具体规则必须早于泛化的 compose_failed。
  // 动因：注释曾声称「必须早于 compose_failed」而实际插在它之后；两条规则目前文本互斥
  // （纯英文原文不含 "compose"/"fail"），但 compose_failed 的 pattern 一旦放宽
  // （例如加上 `compose.*` 前缀匹配），具体规则就会被静默吞掉、细节参数全部丢失，
  // 而这**不会**让任何现有用例变红。故此条把顺序本身锁成断言。
  it('compose_input_size_exceeded 必须排在 compose_failed 之前（具体先于泛化）', () => {
    const idxSize = RULES.findIndex((r) => r.key === 'compose_input_size_exceeded')
    const idxFailed = RULES.findIndex((r) => r.key === 'compose_failed')
    expect(idxSize).toBeGreaterThanOrEqual(0)
    expect(idxFailed).toBeGreaterThanOrEqual(0)
    expect(idxSize).toBeLessThan(idxFailed)
  })

  it('同时命中两条规则的文本落到具体规则（顺序契约的行为面）', () => {
    // 构造一条文案上同时含 "compose ... fail" 与体积超限原文的输入。
    // 顺序若被改回「泛化在前」，本用例会退化成 compose_failed 且 params 丢失。
    const r = formatPipelineError('compose failed: Input media exceeds the total size limit: 780MB > 512MB')
    expect(r.key).toBe('story2video.compose_input_size_exceeded')
    expect(r.params.actualMb).toBe('780MB')
    expect(r.params.limitMb).toBe('512MB')
  })

  // ⛔ 上下限不得对调（CCG 外部评审 i8，2026-10-20）：上一版纯按出现顺序取
  // 「首个=actual、第二个=limit」，遇到 limit 在前、actual 在后的语序就会把两者互换，
  // 用户读到「实际 512MB 超过 780MB 上限」这类相反结论。
  it('语序为「limit 在前、actual 在后」时不得对调上下限', () => {
    const r = formatPipelineError('Input media exceeds the allowed limit 512MB (actual 780MB)')
    expect(r.key).toBe('story2video.compose_input_size_exceeded')
    expect(r.params.limitMb).toBe('512MB')
    expect(r.params.actualMb).toBe('780MB')
  })

  it('中文语序「上限 512MB，当前 780MB」同样按锚点定上下限', () => {
    const r = formatPipelineError('输入媒体总大小超过限制：上限 512MB，当前 780MB')
    expect(r.key).toBe('story2video.compose_input_size_exceeded')
    expect(r.params.limitMb).toBe('512MB')
    expect(r.params.actualMb).toBe('780MB')
  })

  it('两个数字都不带上限锚点时退回出现顺序（actual 在前）', () => {
    const r = formatPipelineError('Input media exceeds the total size limit: 780MB > 512MB')
    expect(r.params.actualMb).toBe('780MB')
    expect(r.params.limitMb).toBe('512MB')
  })
})
