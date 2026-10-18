import { describe, expect, it } from 'vitest'
import {
  MAX_STORY2VIDEO_TEXT_CHARACTERS,
  STORY2VIDEO_NOTIFICATION_KEYS,
  bgmSkippedReasonText,
  countStory2VideoTextCharacters,
  formatBgmSkippedNotification,
  formatStory2VideoNotification,
  historyLoadFailureDetail,
  resolveStory2VideoNotification,
} from './notifications'

describe('Story2Video 通知模型', () => {
  it('每个通知键在 locales（zh/en）中均有非空文案，并默认显示中文（i18n-content-sync 单源收敛）', () => {
    for (const key of Object.values(STORY2VIDEO_NOTIFICATION_KEYS)) {
      const zh = resolveStory2VideoNotification({ messageKey: key }, { locale: 'zh' })
      const en = resolveStory2VideoNotification({ messageKey: key }, { locale: 'en' })
      expect(zh.message.length, `zh ${key} 文案为空`).toBeGreaterThan(0)
      expect(en.message.length, `en ${key} 文案为空`).toBeGreaterThan(0)
    }

    expect(resolveStory2VideoNotification({ messageKey: STORY2VIDEO_NOTIFICATION_KEYS.MODEL_CONFIGURATION_REQUIRED })).toEqual({
      key: STORY2VIDEO_NOTIFICATION_KEYS.MODEL_CONFIGURATION_REQUIRED,
      params: {},
      message: '未找到需要的相关模型，请在设置中添加模型',
    })
  })

  it('使用稳定消息键翻译中文和英文，并忽略未知技术错误文本', () => {
    expect(resolveStory2VideoNotification({
      messageKey: STORY2VIDEO_NOTIFICATION_KEYS.TEXT_TOO_LONG,
      messageParams: { max: 10000 },
    }, { locale: 'en-US' })).toMatchObject({
      key: STORY2VIDEO_NOTIFICATION_KEYS.TEXT_TOO_LONG,
      message: 'Your script can contain up to 10,000 characters. Please shorten it and try again.',
    })

    // 历史默认值 6000 的格式化仍然正确（运营可把上限调回任意合法值）
    expect(resolveStory2VideoNotification({
      messageKey: STORY2VIDEO_NOTIFICATION_KEYS.TEXT_TOO_LONG,
      messageParams: { max: 6000 },
    }, { locale: 'en-US' }).message).toContain('6,000')

    expect(resolveStory2VideoNotification({
      error: 'Story2Video optimize scene count exceeds the allowed limit: 60',
    })).toMatchObject({
      key: STORY2VIDEO_NOTIFICATION_KEYS.OPERATION_FAILED,
      message: '当前操作未能完成，请稍后再试。',
    })
  })

  it('resolve 路径将时长超限和合成超时映射到专用 key', () => {
    expect(resolveStory2VideoNotification({ error: '成片总时长不能超过 50 分钟' })).toMatchObject({
      key: STORY2VIDEO_NOTIFICATION_KEYS.COMPOSE_DURATION_EXCEEDED,
      params: { limitMinutes: 50 },
    })
    expect(resolveStory2VideoNotification({ error: '单段旁白时长不能超过 3 分钟' })).toMatchObject({
      key: STORY2VIDEO_NOTIFICATION_KEYS.COMPOSE_SEGMENT_DURATION_EXCEEDED,
    })
    expect(resolveStory2VideoNotification({ error: 'WebM transcode failed: ffmpeg timed out' }, { locale: 'en-US' })).toMatchObject({
      key: STORY2VIDEO_NOTIFICATION_KEYS.COMPOSE_TIMEOUT,
    })
  })

  it('识别生成限流错误，展示带场景号的友好文案，且技术细节不泄漏', () => {
    const resolved = resolveStory2VideoNotification({
      error: 'Story2Video optimize failed: Story2Video optimize scene 22 failed: You\'ve reached the API rate limit for free users. (request id: 202608060521497814857554AuUFtW2)',
    })
    expect(resolved).toMatchObject({
      key: STORY2VIDEO_NOTIFICATION_KEYS.RATE_LIMITED,
      params: { context: '（场景 22）', provider: '当前' },
    })
    expect(resolved.message).toContain('（场景 22）')
    expect(resolved.message).toContain('请稍等片刻后重试')
    expect(resolved.message).not.toContain('request id')

    expect(resolveStory2VideoNotification({
      error: 'provider 429 rate limit',
    }, { locale: 'en-US' })).toMatchObject({
      key: STORY2VIDEO_NOTIFICATION_KEYS.RATE_LIMITED,
      message: 'Generation is rate limited. Wait a moment and try again, or check the current model account plan quota.',
    })

    // 对话框二次格式化路径：messageParams 中的 context 需透传
    const dialogMessage = formatStory2VideoNotification({ messageKey: resolved.key, messageParams: resolved.params })
    expect(dialogMessage.message).toContain('（场景 22）')
  })

  it('识别额度耗尽错误并给出明确的本地化提示（不重试类）', () => {
    const resolved = resolveStory2VideoNotification({
      error: 'Insufficient balance: your token plan quota for this 5-hour window has been exhausted (scene 3)',
    })
    expect(resolved).toMatchObject({
      key: STORY2VIDEO_NOTIFICATION_KEYS.QUOTA_EXCEEDED,
      params: { context: '（场景 3）', provider: '当前' },
    })
    expect(resolved.message).toContain('额度或余额已用完')
    expect(resolved.message).toContain('（场景 3）')

    expect(resolveStory2VideoNotification({
      error: 'Your account balance is insufficient',
    }, { locale: 'en-US' })).toMatchObject({
      key: STORY2VIDEO_NOTIFICATION_KEYS.QUOTA_EXCEEDED,
      message: 'The current model account quota or balance is exhausted. Check the current model account plan, or switch models and resume from the breakpoint.',
    })
  })

  it('将「API Key 未配置/缺失/解密失败」解析为独立提示，而非「未找到模型」', () => {
    const zh = resolveStory2VideoNotification({
      error: '尚未配置 API Key，请先在“模型设置”中填写 MiniMax Image 的 API Key 后重试（API Key not configured）',
    })
    expect(zh.key).toBe(STORY2VIDEO_NOTIFICATION_KEYS.MODEL_API_KEY_REQUIRED)
    expect(zh.message).toContain('API Key')
    expect(zh.message).not.toContain('未找到需要的相关模型')

    // api-key 上下文内的解密失败
    const decrypt = resolveStory2VideoNotification({
      error: 'Provider API Key decrypt failed: safeStorage could not decrypt the api_key ciphertext.',
    })
    expect(decrypt.key).toBe(STORY2VIDEO_NOTIFICATION_KEYS.MODEL_API_KEY_REQUIRED)

    const en = resolveStory2VideoNotification({ error: 'API Key not configured' }, { locale: 'en-US' })
    expect(en.key).toBe(STORY2VIDEO_NOTIFICATION_KEYS.MODEL_API_KEY_REQUIRED)
    expect(en.message).toContain('API key')

    // 常见英文缺失表述
    expect(resolveStory2VideoNotification({ error: 'Missing API key for provider openai' }).key)
      .toBe(STORY2VIDEO_NOTIFICATION_KEYS.MODEL_API_KEY_REQUIRED)
    expect(resolveStory2VideoNotification({ error: 'api key required' }).key)
      .toBe(STORY2VIDEO_NOTIFICATION_KEYS.MODEL_API_KEY_REQUIRED)
    expect(resolveStory2VideoNotification({ error: 'No API key found in config' }).key)
      .toBe(STORY2VIDEO_NOTIFICATION_KEYS.MODEL_API_KEY_REQUIRED)
  })

  it('内容安全审查（content-policy）错误归一化为具体提示，而非通用文案', () => {
    const zh = resolveStory2VideoNotification({
      error: 'Image generation requires user input after content-policy review',
    })
    expect(zh.key).toBe(STORY2VIDEO_NOTIFICATION_KEYS.NEEDS_USER_INPUT)
    expect(zh.message).toContain('内容安全审核')

    const en = resolveStory2VideoNotification({
      error: 'Image generation requires user input after content-policy review',
    }, { locale: 'en-US' })
    expect(en.key).toBe(STORY2VIDEO_NOTIFICATION_KEYS.NEEDS_USER_INPUT)
    expect(en.message).toContain('content safety review')
  })

  it('MiniMax 真实额度文案（已达到 Token Plan 用量上限）归一化为额度类别（2026-08-16 审查补强）', () => {
    const zh = resolveStory2VideoNotification({
      error: 'Image provider "minimax-multimodal" failed: 已达到 Token Plan 用量上限',
    })
    expect(zh.key).toBe(STORY2VIDEO_NOTIFICATION_KEYS.QUOTA_EXCEEDED)
    expect(zh.message).toContain('额度')

    const en = resolveStory2VideoNotification({
      error: 'Image generation failed: Token Plan usage limit reached',
    }, { locale: 'en-US' })
    expect(en.key).toBe(STORY2VIDEO_NOTIFICATION_KEYS.QUOTA_EXCEEDED)
  })

  it('失败提示指出具体模型账号，且不把 provider account 当作服务商', () => {
    const resolved = resolveStory2VideoNotification({
      error: 'Image provider "minimax-multimodal" failed: quota exhausted',
    })
    expect(resolved.params.provider).toBe('MiniMax')
    expect(resolved.message).toContain('MiniMax模型账号')
    expect(resolved.message).not.toContain('对应模型账号')

    const generic = resolveStory2VideoNotification({
      error: 'Image generation repeatedly returned no result; check the provider account',
    })
    expect(generic.params.provider).toBe('当前')
    expect(generic.message).not.toContain('provider account')
  })

  it('多次空结果消息（empty_result）映射为独立类别，而非通用失败或内容安全审查（2026-08-16 审查补强）', () => {
    const zh = resolveStory2VideoNotification({
      error: 'Image generation repeatedly returned no result (service fluctuation or account issue); adjust the scene prompt and retry, or check the provider account',
    })
    expect(zh.key).toBe(STORY2VIDEO_NOTIFICATION_KEYS.EMPTY_RESULT)
    expect(zh.message).toContain('多次未返回结果')
    expect(zh.message).not.toContain('内容安全审查')
    expect(zh.key).not.toBe(STORY2VIDEO_NOTIFICATION_KEYS.NEEDS_USER_INPUT)

    const en = resolveStory2VideoNotification({
      error: '图片生成多次未返回结果，请调整该场景提示词后重试',
    }, { locale: 'en-US' })
    expect(en.key).toBe(STORY2VIDEO_NOTIFICATION_KEYS.EMPTY_RESULT)
    expect(en.message).toContain('repeatedly returned no result')
  })

  it('API Key 无效/已过期错误归一化为具体提示（api_key_invalid），而非通用文案', () => {
    const zh = resolveStory2VideoNotification({ error: 'Invalid api key' })
    expect(zh.key).toBe(STORY2VIDEO_NOTIFICATION_KEYS.API_KEY_INVALID)
    expect(zh.message).toContain('当前模型账号')
    expect(zh.message).toContain('API Key')

    const en = resolveStory2VideoNotification({
      error: 'Image provider "minimax-multimodal" failed: 鉴权失败',
    }, { locale: 'en-US' })
    expect(en.key).toBe(STORY2VIDEO_NOTIFICATION_KEYS.API_KEY_INVALID)
    expect(en.message).toContain('MiniMax model account')
    expect(en.message).toContain('API key')
  })

  it('无 api-key 上下文的解密失败不误归类为「API Key 未配置」', () => {
    const resolved = resolveStory2VideoNotification({
      error: 'Project file Decrypt failed: Error while decrypting the ciphertext provided to safeStorage.decryptString.',
    })
    expect(resolved.key).not.toBe(STORY2VIDEO_NOTIFICATION_KEYS.MODEL_API_KEY_REQUIRED)
  })

  it('真正的模型缺失仍解析为「未找到需要的相关模型」', () => {
    const resolved = resolveStory2VideoNotification({ error: '未找到需要的相关模型，请在设置中添加模型' })
    expect(resolved.key).toBe(STORY2VIDEO_NOTIFICATION_KEYS.MODEL_CONFIGURATION_REQUIRED)
    expect(resolved.message).toBe('未找到需要的相关模型，请在设置中添加模型')
  })

  it('BGM_SKIPPED 按原因本地化（zh/en，未知 code 回退）', () => {
    expect(bgmSkippedReasonText('size_exceeded')).toBe('文件超过大小上限')
    expect(bgmSkippedReasonText('format_unsupported', 'en-US')).toBe('format not supported')
    expect(bgmSkippedReasonText('not_allowed')).toBe('文件不在允许的读取范围')
    expect(bgmSkippedReasonText('unknown-code')).toBe('文件不存在或不可读')

    const zh = formatBgmSkippedNotification('size_exceeded')
    expect(zh.messageKey).toBe(STORY2VIDEO_NOTIFICATION_KEYS.BGM_SKIPPED)
    expect(zh.message).toContain('背景音乐已跳过')
    expect(zh.message).toContain('超过大小上限')

    const en = formatBgmSkippedNotification('format_unsupported', 'en-US')
    expect(en.message).toContain('Background music was skipped')
    expect(en.message).toContain('format not supported')
  })

  it('按 Unicode code point 计算 6000 / 10000 两档中文、英文和 emoji 字符', () => {
    // 内置默认值 10000（story-text-limit-control）；6000 是历史默认值，计数口径两档都必须正确
    expect(MAX_STORY2VIDEO_TEXT_CHARACTERS).toBe(10000)
    for (const size of [6000, 10000]) {
      expect(countStory2VideoTextCharacters('中'.repeat(size))).toBe(size)
      expect(countStory2VideoTextCharacters('a'.repeat(size))).toBe(size)
      expect(countStory2VideoTextCharacters('😀'.repeat(size))).toBe(size)
    }
  })
  it('localizes approved notification parameters and drops unapproved technical fields', () => {
    expect(resolveStory2VideoNotification({
      messageKey: STORY2VIDEO_NOTIFICATION_KEYS.DEGRADED_ASSETS_WARNING,
      messageParams: {
        assetKinds: ['placeholder_image', 'silent_narration'],
        reason: 'C:/private/path token=secret',
      },
    })).toMatchObject({
      key: STORY2VIDEO_NOTIFICATION_KEYS.DEGRADED_ASSETS_WARNING,
      params: { kinds: '占位图片、静音旁白' },
      message: '此成片包含离线降级素材（占位图片、静音旁白），请在发布前预览确认。',
    })

    expect(resolveStory2VideoNotification({
      messageKey: STORY2VIDEO_NOTIFICATION_KEYS.DEGRADED_ASSETS_WARNING,
      messageParams: { assetKinds: ['placeholder_image', 'silent_narration'] },
    }, { locale: 'en-US' })).toMatchObject({
      params: { kinds: 'placeholder images, silent narration' },
      message: 'This video contains offline fallback assets (placeholder images, silent narration). Preview it before publishing.',
    })
  })

  // 回归锁（2026-10）：ResultView/CreateView 弹窗走「resolve 入态 → format 渲染」双次归一化。
  // normalizeParams 曾只认原始 assetKinds 数组，第二次进入时已解析的 kinds 字符串未被保留，
  // {kinds} 插值为空串，用户看到「此成片包含离线降级素材（），请在发布前预览确认。」。
  it('归一化幂等：已解析的 kinds 再次归一化不丢失（双次归一化回归锁）', () => {
    const resolved = resolveStory2VideoNotification({
      messageKey: STORY2VIDEO_NOTIFICATION_KEYS.DEGRADED_ASSETS_WARNING,
      messageParams: { assetKinds: ['placeholder_image', 'silent_narration'] },
    })
    expect(resolved.params).toEqual({ kinds: '占位图片、静音旁白' })

    // 模拟 ResultView.vue story2videoNotificationDialogMessage / CreateView.vue story2videoErrorDialogMessage
    // 的第二次 format：输入已是第一次归一化的产物
    const reformatted = formatStory2VideoNotification({
      messageKey: STORY2VIDEO_NOTIFICATION_KEYS.DEGRADED_ASSETS_WARNING,
      messageParams: resolved.params,
    })
    expect(reformatted.message).toBe('此成片包含离线降级素材（占位图片、静音旁白），请在发布前预览确认。')
    expect(reformatted.message).not.toContain('（）')
  })

  it('归一化幂等：assetKinds 为空或全未知时显示通用降级素材文案，而不是空括号', () => {
    const zh = resolveStory2VideoNotification({
      messageKey: STORY2VIDEO_NOTIFICATION_KEYS.DEGRADED_ASSETS_WARNING,
      messageParams: { assetKinds: ['unknown_kind'] },
    })
    expect(zh.params).toEqual({ kinds: '降级素材' })
    expect(zh.message).toBe('此成片包含离线降级素材（降级素材），请在发布前预览确认。')
  })

  // 同族防御：CreateView 的 MODELS_REQUIRED 弹窗同样是「resolve 入态 → format 渲染」双次归一化，
  // missingLabels 已解析字符串在第二次归一化中必须保留。
  it('归一化幂等：已解析的 missingLabels 再次归一化不丢失', () => {
    const resolved = resolveStory2VideoNotification({
      messageKey: STORY2VIDEO_NOTIFICATION_KEYS.MODELS_REQUIRED,
      messageParams: { missing: ['video'] },
    })
    expect(resolved.params).toEqual({ missingLabels: '视频模型' })

    const reformatted = formatStory2VideoNotification({
      messageKey: STORY2VIDEO_NOTIFICATION_KEYS.MODELS_REQUIRED,
      messageParams: resolved.params,
    })
    expect(reformatted.message).toBe('启动前置校验未通过：缺少视频模型。请到「模型设置」中添加对应模型后重试。')
    expect(reformatted.message).not.toContain('缺少。')
  })

})

describe('Story2Video 后台并发通知', () => {
  it('errorCode=PIPELINE_CONCURRENCY_LIMIT 解析为专用文案并填充 count/max', () => {
    const zh = resolveStory2VideoNotification({ errorCode: 'PIPELINE_CONCURRENCY_LIMIT', errorParams: { count: 2, max: 2 } })
    expect(zh.key).toBe(STORY2VIDEO_NOTIFICATION_KEYS.PIPELINE_CONCURRENCY_LIMIT)
    expect(zh.message).toBe('根据当前设备的内存占用情况，流水线已满负荷运行，请等待其中一条完成后再启动。')

    const en = resolveStory2VideoNotification({ errorCode: 'PIPELINE_CONCURRENCY_LIMIT', errorParams: { count: 1, max: 2 } }, { locale: 'en-US' })
    expect(en.key).toBe(STORY2VIDEO_NOTIFICATION_KEYS.PIPELINE_CONCURRENCY_LIMIT)
    expect(en.message).toContain('running at full capacity')
  })

  it('中文后端并发错误文本也能通过正则映射到并发通知', () => {
    const resolved = resolveStory2VideoNotification({ error: '根据当前设备的内存占用情况，流水线已满负荷运行，请等待其中一条完成后再启动。' })
    expect(resolved.key).toBe(STORY2VIDEO_NOTIFICATION_KEYS.PIPELINE_CONCURRENCY_LIMIT)
  })
})

describe('Story2Video 历史记录加载失败建议', () => {
  it('historyLoadFailureDetail 按原因给出可操作建议（登录/存储/超时/未知）', () => {
    expect(historyLoadFailureDetail('无法识别当前用户', 'zh')).toContain('登录')
    expect(historyLoadFailureDetail('Story2Video 项目存储不可用', 'zh')).toContain('重启')
    expect(historyLoadFailureDetail('历史记录加载超时', 'zh')).toContain('重试')
    expect(historyLoadFailureDetail('', 'zh')).toBe('')
    expect(historyLoadFailureDetail(null, 'zh')).toBe('')
    // 非空但不可识别：不泄漏内部错误文本
    expect(historyLoadFailureDetail('some random internal error', 'zh')).toBe('')
    expect(historyLoadFailureDetail('cannot identify user', 'en-US')).toMatch(/sign in/i)
    expect(historyLoadFailureDetail('store unavailable', 'en-US')).toMatch(/restart/i)
  })
})
