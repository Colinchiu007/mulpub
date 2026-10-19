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
