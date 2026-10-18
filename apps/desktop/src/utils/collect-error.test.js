import { describe, expect, it } from 'vitest'
import { classifyCollectError } from './collect-error'

describe('classifyCollectError', () => {
  it('classifies invalid URL from Chinese message', () => {
    const r = classifyCollectError('无效的 URL')
    expect(r).toEqual({ reason: 'invalid_url', retryable: false, detailKey: 'collectErrors.invalid_url' })
  })

  it('classifies invalid URL from URL format message', () => {
    expect(classifyCollectError('URL 格式不正确').reason).toBe('invalid_url')
  })

  it('classifies invalid URL from missing params message', () => {
    expect(classifyCollectError('缺少参数对象').reason).toBe('invalid_url')
  })

  it('classifies internal URL', () => {
    const r = classifyCollectError('不允许采集内网地址')
    expect(r).toEqual({ reason: 'internal_url', retryable: false, detailKey: 'collectErrors.internal_url' })
  })

  it('classifies protocol error', () => {
    const r = classifyCollectError('仅支持 http/https 协议')
    expect(r).toEqual({ reason: 'protocol', retryable: false, detailKey: 'collectErrors.protocol' })
  })

  it('classifies budget exhausted', () => {
    const r = classifyCollectError('已达每日采集预算上限')
    expect(r.reason).toBe('budget_exhausted')
    expect(r.retryable).toBe(true)
  })

  it('classifies cooldown', () => {
    expect(classifyCollectError('该平台处于冷却期，请稍后再试').reason).toBe('cooldown')
  })

  it('classifies circuit open', () => {
    expect(classifyCollectError('该平台请求已熔断，请稍后再试').reason).toBe('circuit_open')
  })

  it('classifies rate limited from Chinese message', () => {
    expect(classifyCollectError('请求频率受限，请稍后再试').reason).toBe('rate_limited')
  })

  it('classifies rate limited from English message', () => {
    expect(classifyCollectError('rate limit exceeded (429)').reason).toBe('rate_limited')
  })

  it('classifies rate limited from message containing 429', () => {
    expect(classifyCollectError('429 Too Many Requests').reason).toBe('rate_limited')
  })

  it('classifies security challenge from Chinese message', () => {
    expect(classifyCollectError('URL 触发安全验证，请尝试在浏览器环境采集').reason).toBe('security_challenge')
  })

  it('classifies security challenge from Baidu security message', () => {
    expect(classifyCollectError('百度安全验证').reason).toBe('security_challenge')
  })

  it('classifies security challenge from captcha', () => {
    expect(classifyCollectError('captcha required').reason).toBe('security_challenge')
  })

  it('classifies security challenge from login + verification', () => {
    expect(classifyCollectError('需要登录并完成验证').reason).toBe('security_challenge')
  })

  it('classifies timeout from Chinese message', () => {
    expect(classifyCollectError('请求超时，请稍后重试').reason).toBe('timeout')
  })

  it('classifies timeout from English message', () => {
    expect(classifyCollectError('request timeout').reason).toBe('timeout')
  })

  it('classifies timeout from code -1', () => {
    expect(classifyCollectError({ code: -1, message: '请求超时' }).reason).toBe('timeout')
  })

  it('classifies unreachable from Chinese message', () => {
    expect(classifyCollectError('URL 无法访问').reason).toBe('unreachable')
  })

  it('classifies unreachable from ENOTFOUND', () => {
    expect(classifyCollectError('getaddrinfo ENOTFOUND example.com').reason).toBe('unreachable')
  })

  it('classifies unreachable from code -2', () => {
    expect(classifyCollectError({ code: -2, message: '源不可达' }).reason).toBe('unreachable')
  })

  it('classifies content unextractable from Chinese message', () => {
    expect(classifyCollectError('URL 采集无结果').reason).toBe('content_unextractable')
  })

  it('classifies content unextractable from code -4', () => {
    expect(classifyCollectError({ code: -4, message: '无法提取内容' }).reason).toBe('content_unextractable')
  })

  it('classifies backend unavailable from Chinese message', () => {
    expect(classifyCollectError('后端服务不可用，请稍后重试').reason).toBe('backend_unavailable')
  })

  it('classifies backend unavailable from code -5', () => {
    expect(classifyCollectError({ code: -5, message: 'backend down' }).reason).toBe('backend_unavailable')
  })

  it('classifies network error from English message', () => {
    expect(classifyCollectError('network error').reason).toBe('network_error')
  })

  it('classifies network error from ECONNRESET', () => {
    expect(classifyCollectError('ECONNRESET socket hang up').reason).toBe('network_error')
  })

  it('classifies network error from fetch failed', () => {
    expect(classifyCollectError('fetch failed').reason).toBe('network_error')
  })

  it('classifies unknown for unmatched message', () => {
    const r = classifyCollectError('No handler registered for channel')
    expect(r).toEqual({ reason: 'unknown', retryable: true, detailKey: 'collectErrors.unknown' })
  })

  it('classifies unknown for empty input', () => {
    expect(classifyCollectError('').reason).toBe('unknown')
  })

  it('classifies unknown for null input', () => {
    expect(classifyCollectError(null).reason).toBe('unknown')
  })

  it('classifies from Error instance message', () => {
    expect(classifyCollectError(new Error('URL 无法访问')).reason).toBe('unreachable')
  })

  it('classifies from object with message and code', () => {
    expect(classifyCollectError({ code: -4, message: 'URL 采集无结果' }).reason).toBe('content_unextractable')
  })

  // ── 视频采集管线错误分类（回归：>10 分钟拒绝等具体提示曾被 unknown 吞掉） ──

  it('classifies video too long (VIDEOCLONE_FILE_TOO_LARGE + 视频过长)', () => {
    expect(classifyCollectError('VIDEOCLONE_FILE_TOO_LARGE: 视频过长（15:32），采集仅支持 10 分钟内的短视频').reason)
      .toBe('video_too_long')
    expect(classifyCollectError('VIDEOCLONE_FILE_TOO_LARGE: 视频过长（15:32）').retryable).toBe(false)
  })

  it('classifies video file too large (文件过大 variant)', () => {
    expect(classifyCollectError('VIDEOCLONE_FILE_TOO_LARGE: 视频文件过大（620MB），上限 500MB').reason)
      .toBe('video_file_too_large')
  })

  it('classifies no audio track (-8 / NO_AUDIO_TRACK)', () => {
    expect(classifyCollectError('-8: 该视频无音轨，无法进行语音转写').reason).toBe('no_audio_track')
    expect(classifyCollectError('NO_AUDIO_TRACK: no audio').reason).toBe('no_audio_track')
  })

  it('classifies ASR engine unavailable (-6, non-retryable)', () => {
    const r = classifyCollectError('-6: 语音转写引擎不可用，请安装 faster-whisper：pip install faster-whisper')
    expect(r.reason).toBe('asr_engine_unavailable')
    expect(r.retryable).toBe(false)
  })

  it('classifies transcribe timeout (-7, retryable)', () => {
    const r = classifyCollectError('-7: 转写超时（300 秒），请尝试较短的短视频')
    expect(r.reason).toBe('video_transcribe_timeout')
    expect(r.retryable).toBe(true)
  })

  it('classifies video download errors (private/membership/region/anti-bot)', () => {
    expect(classifyCollectError('VIDEOCLONE_LINK_PRIVATE: 该视频为私密作品').reason).toBe('video_private')
    expect(classifyCollectError('VIDEOCLONE_LINK_MEMBERSHIP: 会员专属内容').reason).toBe('video_membership')
    expect(classifyCollectError('VIDEOCLONE_LINK_REGION: 地区限制').reason).toBe('video_region')
    expect(classifyCollectError('VIDEOCLONE_LINK_ANTI_BOT: 平台风控').reason).toBe('video_anti_bot')
  })

  it('classifies invalid platform and ASR empty', () => {
    expect(classifyCollectError('VIDEOCLONE_INVALID_PLATFORM: 仅支持抖音/小红书视频链接').reason).toBe('video_invalid_platform')
    expect(classifyCollectError('ASR_EMPTY: 语音转写结果为空').reason).toBe('asr_empty')
  })

  // ── 误吞边界（双模型审查 C2：中文短关键词不得误吞图文链路错误） ──

  it('does NOT misclassify article 私密 as video_private', () => {
    expect(classifyCollectError('该文章为私密内容，无法访问').reason).not.toBe('video_private')
  })

  it('does NOT misclassify regular timeout as video_transcribe_timeout', () => {
    expect(classifyCollectError('请求超时，请稍后重试').reason).toBe('timeout')
  })

  it('does NOT misclassify bare 无音轨 (without VIDEOCLONE code) as no_audio_track', () => {
    expect(classifyCollectError('音频流缺失：无音轨').reason).not.toBe('no_audio_track')
  })

  // ── 重试语义（审查 C1：5 个永久性 reason 补齐 NON_RETRYABLE） ──

  it('video_private/membership/region/invalid_platform/asr_empty are non-retryable', () => {
    expect(classifyCollectError('VIDEOCLONE_LINK_PRIVATE: x').retryable).toBe(false)
    expect(classifyCollectError('VIDEOCLONE_LINK_MEMBERSHIP: x').retryable).toBe(false)
    expect(classifyCollectError('VIDEOCLONE_LINK_REGION: x').retryable).toBe(false)
    expect(classifyCollectError('VIDEOCLONE_INVALID_PLATFORM: x').retryable).toBe(false)
    expect(classifyCollectError('ASR_EMPTY: x').retryable).toBe(false)
  })

  it('classifies ASR model download failure (ASR_DOWNLOAD_FAILED, retryable)', () => {
    const r = classifyCollectError('ASR_DOWNLOAD_FAILED: 模型下载失败：网络无法连接下载源')
    expect(r.reason).toBe('asr_download_failed')
    expect(r.retryable).toBe(true) // 网络类失败重试有意义（换镜像/网络恢复后）
  })

  // ── 六平台扩展（2026-09-29，collect-video-platforms） ──

  it('classifies channels unsupported and no_video (non-retryable, message passthrough)', () => {
    const r1 = classifyCollectError('VIDEOCLONE_CHANNELS_UNSUPPORTED: 视频号视频需要微信登录态，暂不支持自动采集')
    expect(r1.reason).toBe('video_channels_unsupported')
    expect(r1.retryable).toBe(false)
    const r2 = classifyCollectError('VIDEOCLONE_NO_VIDEO: 该链接不含视频')
    expect(r2.reason).toBe('video_no_video')
    expect(r2.retryable).toBe(false)
  })

  // ── 结构化 reason 优先（2026-10-18，fix-collect-antibot-rewrite） ──
  // 主进程 url-collector 已把「百度安全验证页」判为 security_challenge；渲染层不得再靠
  // 文本猜测（文案本地化/改词会让文本判据漂移）。reason 命中白名单时优先采信。
  describe('结构化 reason 优先', () => {
    it('reason=security_challenge 直接采信，即使 message 是无关文案', () => {
      const r = classifyCollectError({ code: -1, reason: 'security_challenge', message: '采集失败' })
      expect(r.reason).toBe('security_challenge')
      expect(r.detailKey).toBe('collectErrors.security_challenge')
      expect(r.retryable).toBe(true)
    })

    it('reason 优先于 message 文本匹配（文本说 timeout，reason 说 security_challenge）', () => {
      const r = classifyCollectError({ code: -1, reason: 'security_challenge', message: '请求超时' })
      expect(r.reason).toBe('security_challenge')
    })

    it('未知 reason 不采信，退回文本匹配（避免无文案的 detailKey 逃逸）', () => {
      const r = classifyCollectError({ code: -1, reason: 'made_up_reason', message: '请求超时' })
      expect(r.reason).toBe('timeout')
    })

    it('reason 为 unknown 时按白名单采信为 unknown', () => {
      const r = classifyCollectError({ code: -1, reason: 'unknown', message: 'whatever technical' })
      expect(r.reason).toBe('unknown')
    })
  })
})
