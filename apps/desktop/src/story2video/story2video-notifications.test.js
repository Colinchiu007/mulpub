import { describe, expect, it } from 'vitest'

import {
  STORY2VIDEO_NOTIFICATION_KEYS,
  countUnicodeCodePoints,
  formatStory2VideoNotification,
  getStory2VideoNotificationUiText,
  resolveStory2VideoNotification,
} from './story2video-notifications'

describe('Story2Video notification messages', () => {
  it('exposes stable message keys for renderer notifications', () => {
    expect(STORY2VIDEO_NOTIFICATION_KEYS).toMatchObject({
      MODEL_CONFIGURATION_REQUIRED: 'story2video.model_configuration_required',
      MODEL_API_KEY_REQUIRED: 'story2video.model_api_key_required',
      ACCESS_DENIED: 'story2video.access_denied',
      ORCHESTRATION_FAILED: 'story2video.orchestration_failed',
      TEXT_INPUT_ONLY: 'story2video.text_input_only',
      NEEDS_USER_INPUT: 'story2video.needs_user_input',
      EMPTY_RESULT: 'story2video.empty_result',
      COMPOSE_TIMEOUT: 'story2video.compose_timeout',
      COMPOSE_DURATION_EXCEEDED: 'story2video.compose_duration_exceeded',
      COMPOSE_SEGMENT_DURATION_EXCEEDED: 'story2video.compose_segment_duration_exceeded',
      UNKNOWN_ERROR: 'story2video.unknown_error',
    })

    expect(new Set(Object.values(STORY2VIDEO_NOTIFICATION_KEYS)).size)
      .toBe(Object.values(STORY2VIDEO_NOTIFICATION_KEYS).length)
  })

  it('defaults known notifications to Chinese and exposes their code point count', () => {
    const notification = formatStory2VideoNotification({
      messageKey: STORY2VIDEO_NOTIFICATION_KEYS.MODEL_CONFIGURATION_REQUIRED,
    })

    expect(notification).toEqual({
      messageKey: STORY2VIDEO_NOTIFICATION_KEYS.MODEL_CONFIGURATION_REQUIRED,
      message: '未找到需要的相关模型，请在设置中添加模型',
      codePointCount: countUnicodeCodePoints('未找到需要的相关模型，请在设置中添加模型'),
    })
  })

  it('uses a friendly Chinese message without rendering technical failure details', () => {
    const notification = formatStory2VideoNotification({
      messageKey: STORY2VIDEO_NOTIFICATION_KEYS.ORCHESTRATION_FAILED,
      messageParams: { reason: 'FetchError: token=secret' },
    })

    expect(notification).toEqual({
      messageKey: STORY2VIDEO_NOTIFICATION_KEYS.ORCHESTRATION_FAILED,
      message: '暂时无法完成生成，请稍后再试。',
      codePointCount: countUnicodeCodePoints('暂时无法完成生成，请稍后再试。'),
    })
    expect(notification.message).not.toContain('secret')
  })

  it.each(['en', 'en-US'])('renders English for the %s locale', locale => {
    const notification = formatStory2VideoNotification({
      messageKey: STORY2VIDEO_NOTIFICATION_KEYS.ORCHESTRATION_FAILED,
      messageParams: { reason: 'Audio generation failed' },
    }, locale)

    expect(notification).toEqual({
      messageKey: STORY2VIDEO_NOTIFICATION_KEYS.ORCHESTRATION_FAILED,
      message: 'Could not finish generation right now. Please try again shortly.',
      codePointCount: countUnicodeCodePoints('Could not finish generation right now. Please try again shortly.'),
    })
  })

  it('replaces an unknown technical error instead of exposing it verbatim', () => {
    const rawError = 'FetchError: POST http://127.0.0.1:9123/internal failed (token=secret)'
    const notification = formatStory2VideoNotification({ message: rawError }, 'en-US')

    expect(notification).toEqual({
      messageKey: STORY2VIDEO_NOTIFICATION_KEYS.UNKNOWN_ERROR,
      message: 'Could not complete the request. Please try again.',
      codePointCount: countUnicodeCodePoints('Could not complete the request. Please try again.'),
    })
    expect(notification.message).not.toContain(rawError)
    expect(notification.message).not.toContain('127.0.0.1')
    expect(notification.message).not.toContain('secret')
  })

  it.each([
    ['成片总时长不能超过 50 分钟', 'zh', '50 分钟', '缩短文案'],
    ['旁白音频总时长不能超过 40 分钟', 'zh', '40 分钟', '减少场景'],
    ['Requested video duration exceeds the allowed limit of 50 minutes', 'en-US', '50-minute', 'shorten'],
    ['Composed video duration exceeds the allowed limit of 50 minutes', 'en', '50-minute', 'fewer scenes'],
  ])('将总时长错误映射为专用通知：%s', (error, locale, limitText, actionText) => {
    const notification = formatStory2VideoNotification({ error }, locale)
    expect(notification.messageKey).toBe(STORY2VIDEO_NOTIFICATION_KEYS.COMPOSE_DURATION_EXCEEDED)
    expect(notification.message).toContain(limitText)
    expect(notification.message.toLowerCase()).toContain(actionText.toLowerCase())
    expect(notification.message).not.toContain(error)
  })

  it('将单段旁白时长超限映射为拆分文案', () => {
    const notification = formatStory2VideoNotification({ error: '单段旁白时长不能超过 3 分钟' })
    expect(notification.messageKey).toBe(STORY2VIDEO_NOTIFICATION_KEYS.COMPOSE_SEGMENT_DURATION_EXCEEDED)
    expect(notification.message).toContain('拆分')
  })

  it('renders the segment-duration action in English', () => {
    const notification = formatStory2VideoNotification({
      error: 'Single narration segment duration exceeds the limit',
    }, 'en-US')
    expect(notification.messageKey).toBe(STORY2VIDEO_NOTIFICATION_KEYS.COMPOSE_SEGMENT_DURATION_EXCEEDED)
    expect(notification.message).toContain('Split')
  })

  it.each([
    'WebM transcode failed: Command timed out after 180000ms',
    'Narration concat failed: ffmpeg timeout',
    'BGM mix failed: spawn ffmpeg ETIMEDOUT',
    'Output validation failed: output validation ffmpeg stage timed out',
    'Output validation failed: 视频校验超时 C:/private/video.mp4 token=secret',
  ])('将合成阶段超时映射为可重试通知且不泄漏技术细节：%s', error => {
    const notification = formatStory2VideoNotification({ error })
    expect(notification.messageKey).toBe(STORY2VIDEO_NOTIFICATION_KEYS.COMPOSE_TIMEOUT)
    expect(notification.message).toContain('断点')
    expect(notification.message).toContain('磁盘')
    expect(notification.message).not.toContain(error)
    expect(notification.message).not.toContain('private')
    expect(notification.message).not.toContain('secret')
  })

  it('renders a safe English compose-timeout action', () => {
    const rawError = 'WebM transcode failed: webm transcode ffmpeg stage timed out at C:/private token=secret'
    const notification = formatStory2VideoNotification({ error: rawError }, 'en-US')
    expect(notification.messageKey).toBe(STORY2VIDEO_NOTIFICATION_KEYS.COMPOSE_TIMEOUT)
    expect(notification.message).toContain('resume from the breakpoint')
    expect(notification.message).toContain('disk space')
    expect(notification.message).not.toContain('private')
    expect(notification.message).not.toContain('secret')
  })

  it('prioritizes duration-limit guidance over a timeout token in the same error', () => {
    const notification = formatStory2VideoNotification({
      error: 'Composed video duration exceeds the allowed limit of 50 minutes after timeout'
    }, 'en-US')
    expect(notification.messageKey).toBe(STORY2VIDEO_NOTIFICATION_KEYS.COMPOSE_DURATION_EXCEEDED)
  })

  it('maps an authenticated IPC denial to a clear sign-in/access message', () => {
    const notification = formatStory2VideoNotification({
      code: -3,
      message: '当前许可证无权访问 pipeline:startOrchestrated',
    })

    expect(notification).toEqual({
      messageKey: STORY2VIDEO_NOTIFICATION_KEYS.ACCESS_DENIED,
      message: '当前登录状态无法启动故事讲述，请先登录并确认当前账号有对应权益。',
      codePointCount: countUnicodeCodePoints('当前登录状态无法启动故事讲述，请先登录并确认当前账号有对应权益。'),
    })
  })

  it('多次空结果（empty_result）映射为独立类别，带场景号且不误标内容安全审查（2026-08-16 复审补强）', () => {
    const zh = formatStory2VideoNotification({
      error: 'Image generation repeatedly returned no result (service fluctuation or account issue); adjust the scene prompt and retry, or check the provider account (scene 3)',
    })
    expect(zh.messageKey).toBe(STORY2VIDEO_NOTIFICATION_KEYS.EMPTY_RESULT)
    expect(zh.message).toContain('多次未返回结果')
    expect(zh.message).toContain('（场景 3）')
    expect(zh.message).not.toContain('内容安全审查')

    const en = formatStory2VideoNotification({
      error: '图片生成多次未返回结果（scene 2），请调整该场景提示词后重试',
    }, 'en-US')
    expect(en.messageKey).toBe(STORY2VIDEO_NOTIFICATION_KEYS.EMPTY_RESULT)
    expect(en.message).toContain('repeatedly returned no result')
    expect(en.message).toContain('(scene 2)')
  })

  it('弹窗标题统一为「提示」/「Notice」，不携带流水线名词前缀', () => {
    // UX 规范（2026-08-08）：{流水线名} 提示 → 提示；无论是否传入流水线名
    expect(getStory2VideoNotificationUiText('zh', '故事讲述').dialogTitle).toBe('提示')
    expect(getStory2VideoNotificationUiText('zh', 'Story2Video').dialogTitle).toBe('提示')
    expect(getStory2VideoNotificationUiText('zh', '').dialogTitle).toBe('提示')
    expect(getStory2VideoNotificationUiText('en', 'Story Telling').dialogTitle).toBe('Notice')
    expect(getStory2VideoNotificationUiText('en', '').dialogTitle).toBe('Notice')
  })

  it('删除进行中的 dialog 按钮文案（zh/en 成对）', () => {
    expect(getStory2VideoNotificationUiText('zh').deleting).toBe('删除中…')
    expect(getStory2VideoNotificationUiText('en').deleting).toBe('Deleting…')
  })

  it('媒体文件细分提示：格式不支持/大小超限/不可读，参数可插值', () => {
    const zhFormat = formatStory2VideoNotification({
      messageKey: STORY2VIDEO_NOTIFICATION_KEYS.MEDIA_FORMAT_INVALID,
      messageParams: { extension: '.MP3', kindLabel: '背景音乐', extensions: ['.wav', '.m4a', '.mp3'] },
    })
    expect(zhFormat.message).toContain('.MP3')
    expect(zhFormat.message).toContain('背景音乐')
    expect(zhFormat.message).toContain('.wav / .m4a / .mp3')

    const zhSize = formatStory2VideoNotification({
      messageKey: STORY2VIDEO_NOTIFICATION_KEYS.MEDIA_SIZE_EXCEEDED,
      messageParams: { kindLabel: '背景音乐', maxMb: 15, actualMb: 20 },
    })
    expect(zhSize.message).toContain('15MB')
    expect(zhSize.message).toContain('20MB')

    const enUnreadable = formatStory2VideoNotification({
      messageKey: STORY2VIDEO_NOTIFICATION_KEYS.MEDIA_UNREADABLE,
      messageParams: { kindLabel: 'background music' },
    }, 'en')
    expect(enUnreadable.message).toContain('background music')

    const zhPath = formatStory2VideoNotification({
      messageKey: STORY2VIDEO_NOTIFICATION_KEYS.MEDIA_PATH_UNRESOLVED,
      messageParams: { kindLabel: '背景音乐' },
    })
    expect(zhPath.message).toContain('背景音乐')
    expect(zhPath.message).toContain('本地路径')
    expect(zhPath.message).toContain('重新选择文件')

    const enPath = formatStory2VideoNotification({
      messageKey: STORY2VIDEO_NOTIFICATION_KEYS.MEDIA_PATH_UNRESOLVED,
      messageParams: { kindLabel: 'background music' },
    }, 'en')
    expect(enPath.message).toContain('background music')
    expect(enPath.message).toContain('local path')
  })

  it('服务商返回音色无效错误时映射为具体模型账号提示', () => {
    const notification = formatStory2VideoNotification({
      error: 'TTS provider "minimax-tts" failed: invalid params, voice id wrong',
    })
    expect(notification.messageKey).toBe(STORY2VIDEO_NOTIFICATION_KEYS.VOICE_INVALID)
    expect(notification.message).toContain('MiniMax TTS模型账号')
    expect(notification.message).toContain('音色不可用')
    expect(notification.message).not.toContain('voice id wrong')

    const en = formatStory2VideoNotification({
      error: 'TTS provider "minimax-tts" failed: invalid params, voice id wrong',
    }, 'en')
    expect(en.messageKey).toBe(STORY2VIDEO_NOTIFICATION_KEYS.VOICE_INVALID)
    expect(en.message).toContain('MiniMax TTS model account')
    expect(en.message).not.toContain('voice id wrong')
  })

  it('场景重新生成失败错误映射为对应 failed 通知', () => {
    expect(formatStory2VideoNotification({ error: '无法重新生成字幕：服务暂时不可用' }).messageKey)
      .toBe(STORY2VIDEO_NOTIFICATION_KEYS.SCENE_SUBTITLE_REGENERATE_FAILED)
    expect(formatStory2VideoNotification({ error: '无法生成语音：TTS 服务不可用' }).messageKey)
      .toBe(STORY2VIDEO_NOTIFICATION_KEYS.SCENE_AUDIO_REGENERATE_FAILED)
    expect(formatStory2VideoNotification({ error: '无法重新生成优化词：提示词优化服务不可用' }).messageKey)
      .toBe(STORY2VIDEO_NOTIFICATION_KEYS.SCENE_PROMPT_REGENERATE_FAILED)
    expect(formatStory2VideoNotification({ error: '优化词类型无效：video' }).messageKey)
      .toBe(STORY2VIDEO_NOTIFICATION_KEYS.SCENE_PROMPT_REGENERATE_FAILED)
    expect(formatStory2VideoNotification({ error: '未配置可用的视频供应商，请在模型设置中启用视频生成能力' }).messageKey)
      .toBe(STORY2VIDEO_NOTIFICATION_KEYS.SCENE_AI_VIDEO_GENERATE_FAILED)
    expect(formatStory2VideoNotification({ error: '视频生成调用失败（provider: kling）' }).messageKey)
      .toBe(STORY2VIDEO_NOTIFICATION_KEYS.SCENE_AI_VIDEO_GENERATE_FAILED)
    expect(formatStory2VideoNotification({ error: '视频下载超过大小上限' }).messageKey)
      .toBe(STORY2VIDEO_NOTIFICATION_KEYS.SCENE_AI_VIDEO_GENERATE_FAILED)
    expect(formatStory2VideoNotification({ error: '视频文件无法解码（ffprobe: invalid data）' }).messageKey)
      .toBe(STORY2VIDEO_NOTIFICATION_KEYS.SCENE_AI_VIDEO_GENERATE_FAILED)
    expect(formatStory2VideoNotification({ error: '视频下载结果为空或不可用' }).messageKey)
      .toBe(STORY2VIDEO_NOTIFICATION_KEYS.SCENE_AI_VIDEO_GENERATE_FAILED)
    expect(formatStory2VideoNotification({ error: 'AI 视频生成失败' }).messageKey)
      .toBe(STORY2VIDEO_NOTIFICATION_KEYS.SCENE_AI_VIDEO_GENERATE_FAILED)
  })

  it('场景重新生成失败英文错误同样归一化', () => {
    expect(formatStory2VideoNotification({ error: 'subtitle regeneration failed: provider unavailable' }, 'en').messageKey)
      .toBe(STORY2VIDEO_NOTIFICATION_KEYS.SCENE_SUBTITLE_REGENERATE_FAILED)
    expect(formatStory2VideoNotification({ error: 'tts unavailable for voice synthesis' }, 'en').messageKey)
      .toBe(STORY2VIDEO_NOTIFICATION_KEYS.SCENE_AUDIO_REGENERATE_FAILED)
    expect(formatStory2VideoNotification({ error: 'prompt regeneration returned invalid result' }, 'en').messageKey)
      .toBe(STORY2VIDEO_NOTIFICATION_KEYS.SCENE_PROMPT_REGENERATE_FAILED)
    expect(formatStory2VideoNotification({ error: 'ai video generation failed: provider unavailable' }, 'en').messageKey)
      .toBe(STORY2VIDEO_NOTIFICATION_KEYS.SCENE_AI_VIDEO_GENERATE_FAILED)
  })

  it('再次合成时素材缺失错误归一化为具体提示（2026-09-18 已取消项目修复）', () => {
    // _scenesForCompose 对选中视频素材缺失抛的中文错误
    expect(formatStory2VideoNotification({ error: '第 2 个场景的视频素材不存在、不可读或超出限制' }).messageKey)
      .toBe(STORY2VIDEO_NOTIFICATION_KEYS.SCENE_VIDEO_MISSING)
    expect(formatStory2VideoNotification({ error: '第 2 个场景的视频素材不存在、不可读或超出限制' }).message)
      .toBe('该场景的视频素材不存在或不可读，请重新生成视频素材后再合成。')
    // compose 引擎对图片/音频缺失返回的英文错误归一化
    expect(formatStory2VideoNotification({ error: 'Scene media path is not allowed or unreadable at index 0' }).messageKey)
      .toBe(STORY2VIDEO_NOTIFICATION_KEYS.SCENE_IMAGE_MISSING)
    expect(formatStory2VideoNotification({ error: 'Scene audio path is not allowed or unreadable at index 1' }).messageKey)
      .toBe(STORY2VIDEO_NOTIFICATION_KEYS.SCENE_AUDIO_MISSING)
  })

  it('counts Unicode code points rather than UTF-16 code units or grapheme clusters', () => {
    expect('A😀中'.length).toBe(4)
    expect(countUnicodeCodePoints('A😀中')).toBe(3)
    expect(countUnicodeCodePoints('👩🏽‍💻')).toBe(4)
  })

  it('cloned voice across accounts maps to VOICE_INVALID not QUOTA_EXCEEDED (run_1786 bug)', () => {
    const result = formatStory2VideoNotification({ error: 'TTS provider failed: voice does not exist' })
    expect(result.messageKey).toBe(STORY2VIDEO_NOTIFICATION_KEYS.VOICE_INVALID)
  })

  it('cloned voice Chinese error also correctly classified', () => {
    const result = formatStory2VideoNotification({ error: 'TTS provider failed: 当前账号无权访问该音色' })
    expect(result.messageKey).toBe(STORY2VIDEO_NOTIFICATION_KEYS.VOICE_INVALID)
  })

  it('QUOTA_EXCEEDED only triggers when errorCode is explicit or no other signal', () => {
    const result = formatStory2VideoNotification({
      error: 'API Key 额度已用完，请升级套餐',
      errorCode: 'AUTH_FAILED',
    })
    expect(result.messageKey).not.toBe(STORY2VIDEO_NOTIFICATION_KEYS.QUOTA_EXCEEDED)
  })

  it('auth error text with quota keywords classified as API_KEY_INVALID not QUOTA_EXCEEDED', () => {
    const result = formatStory2VideoNotification({
      error: 'TTS provider failed: API Key 无效，额度已用完',
    })
    expect(result.messageKey).toBe(STORY2VIDEO_NOTIFICATION_KEYS.API_KEY_INVALID)
  })

  it('quota keywords without auth signal still trigger QUOTA_EXCEEDED (backward compat)', () => {
    const result = formatStory2VideoNotification({
      error: '模型 API 的额度或余额已用完',
    })
    expect(result.messageKey).toBe(STORY2VIDEO_NOTIFICATION_KEYS.QUOTA_EXCEEDED)
  })

  it('SenseNova 429 rpm exhausted classified as RATE_LIMITED not QUOTA_EXCEEDED', () => {
    const result = formatStory2VideoNotification({
      error: "Story2Video optimize failed: Story2Video 场景 2 prompt-engine 优化失败: Error code: 429 - {'error': {'message': 'rpm exhausted', 'type': 'quota_exceeded_error', 'code': '8'}}"
    })
    expect(result.messageKey).toBe(STORY2VIDEO_NOTIFICATION_KEYS.RATE_LIMITED)
  })

  it.each([
    'Error code: 429 - GoUsageLimitError: 5-hour usage limit reached. Resets in 1hr 32min.',
    'The model usage limit has been reached. Please try again later.',
  ])('供应商明确表示用量窗口耗尽时优先映射为额度提示：%s', error => {
    const result = formatStory2VideoNotification({ error })
    expect(result.messageKey).toBe(STORY2VIDEO_NOTIFICATION_KEYS.QUOTA_EXCEEDED)
    expect(result.message).toContain('额度')
  })

  it('普通 429 仍然映射为限流提示', () => {
    const result = formatStory2VideoNotification({
      error: 'Error code: 429 - Too Many Requests',
    })
    expect(result.messageKey).toBe(STORY2VIDEO_NOTIFICATION_KEYS.RATE_LIMITED)
  })

  it('提示词重生成使用 fallbackKey 时保留额度分类', () => {
    const result = resolveStory2VideoNotification({
      fallbackKey: STORY2VIDEO_NOTIFICATION_KEYS.SCENE_PROMPT_REGENERATE_FAILED,
      error: 'Error code: 429 - GoUsageLimitError: 5-hour usage limit reached',
    })
    expect(result.key).toBe(STORY2VIDEO_NOTIFICATION_KEYS.QUOTA_EXCEEDED)
  })

  it('显式非额度错误码不会被用量文本覆盖', () => {
    const result = formatStory2VideoNotification({
      errorCode: 'AUTH_FAILED',
      error: 'GoUsageLimitError: 5-hour usage limit reached',
    })
    expect(result.messageKey).not.toBe(STORY2VIDEO_NOTIFICATION_KEYS.QUOTA_EXCEEDED)
  })
})

describe('Story2Video batch-delete notification interpolation (BATCH_DELETE_SUCCESS regression)', () => {
  // Regression guard: story2video-notifications.js normalizeParams once omitted
  // BATCH_DELETE_SUCCESS from the {count}/{success}/{failed} interpolation branch, so the
  // success toast rendered with an empty count. Fixed in commit 492a2246c. This suite
  // locks the interpolation so the bug cannot resurface.
  it('BATCH_DELETE_SUCCESS interpolates count into the success toast (no empty placeholder)', () => {
    const result = formatStory2VideoNotification({
      messageKey: STORY2VIDEO_NOTIFICATION_KEYS.BATCH_DELETE_SUCCESS,
      messageParams: { count: 3, success: 3, failed: 0 },
    })
    expect(result.messageKey).toBe(STORY2VIDEO_NOTIFICATION_KEYS.BATCH_DELETE_SUCCESS)
    expect(result.message).toContain('3')
    // Empty interpolation would leave a double space where the count should be.
    expect(result.message).not.toContain('  ')
    expect(result.message).not.toMatch(/\d\s{2,}/)
  })

  it('BATCH_DELETE_SUCCESS interpolates count under both zh and en', () => {
    const zh = formatStory2VideoNotification({
      messageKey: STORY2VIDEO_NOTIFICATION_KEYS.BATCH_DELETE_SUCCESS,
      messageParams: { count: 5, success: 5, failed: 0 },
    }, 'zh')
    const en = formatStory2VideoNotification({
      messageKey: STORY2VIDEO_NOTIFICATION_KEYS.BATCH_DELETE_SUCCESS,
      messageParams: { count: 5, success: 5, failed: 0 },
    }, 'en')
    expect(zh.message).toContain('5')
    expect(en.message).toContain('5')
  })

  it('BATCH_DELETE_PARTIAL interpolates both success and failed', () => {
    const result = formatStory2VideoNotification({
      messageKey: STORY2VIDEO_NOTIFICATION_KEYS.BATCH_DELETE_PARTIAL,
      messageParams: { count: 3, success: 2, failed: 1 },
    })
    expect(result.message).toContain('2')
    expect(result.message).toContain('1')
  })

  it('BATCH_DELETE_CONFIRM interpolates count', () => {
    const result = formatStory2VideoNotification({
      messageKey: STORY2VIDEO_NOTIFICATION_KEYS.BATCH_DELETE_CONFIRM,
      messageParams: { count: 4 },
    })
    expect(result.message).toContain('4')
  })
})

describe('Story2Video 启动前置校验（models_required）', () => {
  it('errorCode=PIPELINE_MODEL_REQUIREMENTS_MISSING 直连 models_required 并渲染缺失能力标签', () => {
    const notification = formatStory2VideoNotification({
      errorCode: 'PIPELINE_MODEL_REQUIREMENTS_MISSING',
      errorParams: { missing: ['llm', 'video'], providers: {} },
      error: '启动被拦截：缺少模型能力 推理模型、视频模型。请到「模型设置」中添加对应模型后重试。',
    })
    expect(notification.messageKey).toBe(STORY2VIDEO_NOTIFICATION_KEYS.MODELS_REQUIRED)
    expect(notification.message).toContain('推理模型')
    expect(notification.message).toContain('视频模型')
  })

  it('显式 provider 缺失时标签附 provider 标识（中文括号）', () => {
    const notification = formatStory2VideoNotification({
      errorCode: 'PIPELINE_MODEL_REQUIREMENTS_MISSING',
      errorParams: { missing: ['video'], providers: { video: 'kling' } },
    })
    expect(notification.message).toContain('视频模型（kling）')
  })

  it('英文界面渲染英文能力标签与引导文案', () => {
    const notification = formatStory2VideoNotification({
      errorCode: 'PIPELINE_MODEL_REQUIREMENTS_MISSING',
      errorParams: { missing: ['llm', 'video'], providers: {} },
    }, 'en')
    expect(notification.messageKey).toBe(STORY2VIDEO_NOTIFICATION_KEYS.MODELS_REQUIRED)
    expect(notification.message).toContain('Reasoning model')
    expect(notification.message).toContain('Video model')
    expect(notification.message).toContain('Model Settings')
  })

  it('dialog UI 文本提供 goToModelSettings 按钮文案（zh/en 成对）', () => {
    expect(getStory2VideoNotificationUiText('zh').goToModelSettings).toBe('去模型设置')
    expect(getStory2VideoNotificationUiText('en').goToModelSettings).toBe('Go to Model Settings')
  })
})

describe('Story2Video 断点恢复失败（resumeOrchestration errorCode 契约）', () => {
  it('RUN_SNAPSHOT_NOT_FOUND 映射到 resume_snapshot_not_found 具体文案', () => {
    const notification = formatStory2VideoNotification({
      errorCode: 'RUN_SNAPSHOT_NOT_FOUND',
      error: '未找到可恢复的运行快照',
    })
    expect(notification.messageKey).toBe(STORY2VIDEO_NOTIFICATION_KEYS.RESUME_SNAPSHOT_NOT_FOUND)
    expect(notification.message).toContain('未找到可恢复的运行快照')
    expect(notification.message).not.toContain('当前操作未能完成')
  })

  it('RUN_NOT_FAILED 映射到 resume_run_not_failed 具体文案', () => {
    const notification = formatStory2VideoNotification({
      errorCode: 'RUN_NOT_FAILED',
      error: '只有失败或中断状态的运行可以恢复',
    })
    expect(notification.messageKey).toBe(STORY2VIDEO_NOTIFICATION_KEYS.RESUME_RUN_NOT_FAILED)
    expect(notification.message).toContain('只有失败或中断状态的运行可以恢复')
  })

  it('RUN_NOT_ORCHESTRATOR 映射到 resume_run_not_orchestrator 具体文案', () => {
    const notification = formatStory2VideoNotification({
      errorCode: 'RUN_NOT_ORCHESTRATOR',
      error: '该运行不支持断点恢复',
    })
    expect(notification.messageKey).toBe(STORY2VIDEO_NOTIFICATION_KEYS.RESUME_RUN_NOT_ORCHESTRATOR)
    expect(notification.message).toContain('不支持断点恢复')
  })

  it('STAGE_NOT_FOUND 映射到 resume_stage_not_found 具体文案', () => {
    const notification = formatStory2VideoNotification({
      errorCode: 'STAGE_NOT_FOUND',
      error: '未定位到失败阶段',
    })
    expect(notification.messageKey).toBe(STORY2VIDEO_NOTIFICATION_KEYS.RESUME_STAGE_NOT_FOUND)
    expect(notification.message).toContain('未定位到失败阶段')
  })

  it('英文界面渲染英文断点恢复文案', () => {
    const notification = formatStory2VideoNotification({
      errorCode: 'RUN_SNAPSHOT_NOT_FOUND',
      error: 'No recoverable run snapshot was found',
    }, 'en')
    expect(notification.messageKey).toBe(STORY2VIDEO_NOTIFICATION_KEYS.RESUME_SNAPSHOT_NOT_FOUND)
    expect(notification.message).toContain('No recoverable run snapshot was found')
  })

  it('resolveStory2VideoNotification 同样识别断点恢复错误码（供 showStory2VideoErrorDialog 使用）', () => {
    const resolved = resolveStory2VideoNotification({
      errorCode: 'RUN_SNAPSHOT_NOT_FOUND',
      error: '未找到可恢复的运行快照',
    })
    expect(resolved.key).toBe(STORY2VIDEO_NOTIFICATION_KEYS.RESUME_SNAPSHOT_NOT_FOUND)
    expect(resolved.message).toContain('未找到可恢复的运行快照')
  })

  it('PIPELINE_USER_INPUT_REQUIRED 映射到 needs_user_input（内容政策类需改文案后重跑）', () => {
    const notification = formatStory2VideoNotification({
      errorCode: 'PIPELINE_USER_INPUT_REQUIRED',
      error: '内容政策审核未通过，需要修改文案后重新生成',
    })
    expect(notification.messageKey).toBe(STORY2VIDEO_NOTIFICATION_KEYS.NEEDS_USER_INPUT)
    expect(notification.message).not.toContain('当前操作未能完成')
  })

  it('其余断点恢复错误码英文界面渲染对应英文文案', () => {
    const runNotFailed = formatStory2VideoNotification({
      errorCode: 'RUN_NOT_FAILED',
      error: 'Only failed or interrupted runs can be resumed',
    }, 'en')
    expect(runNotFailed.messageKey).toBe(STORY2VIDEO_NOTIFICATION_KEYS.RESUME_RUN_NOT_FAILED)
    expect(runNotFailed.message).toContain('Only failed or interrupted runs can be resumed')

    const notOrchestrator = formatStory2VideoNotification({
      errorCode: 'RUN_NOT_ORCHESTRATOR',
      error: 'This task does not support resuming from the breakpoint',
    }, 'en')
    expect(notOrchestrator.messageKey).toBe(STORY2VIDEO_NOTIFICATION_KEYS.RESUME_RUN_NOT_ORCHESTRATOR)
    expect(notOrchestrator.message).toContain('does not support resuming')

    const stageNotFound = formatStory2VideoNotification({
      errorCode: 'STAGE_NOT_FOUND',
      error: 'The failed stage could not be located',
    }, 'en')
    expect(stageNotFound.messageKey).toBe(STORY2VIDEO_NOTIFICATION_KEYS.RESUME_STAGE_NOT_FOUND)
    expect(stageNotFound.message).toContain('failed stage could not be located')
  })
})
