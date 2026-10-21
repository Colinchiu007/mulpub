/**
 * 小红书 RPA 发布回归测试。
 *
 * 小红书使用专用入口选择发布类型，再复用通用字段填充与发布验证。
 */
__enableElectronMock()

const publishConfig = {
  publish_url: 'https://creator.xiaohongshu.com/publish/publish?from=menu',
  type: 'mixed',
  has_api: false,
  selectors: {
    title_input: ['input[placeholder*="标题"]'],
    editor: ['[contenteditable="true"]'],
    tag_input: ['input[placeholder*="标签"]'],
    publish_btn: ['button:has-text("发布")'],
  },
  success_patterns: [],
  success_mode: 'url',
}

__registerMock('@multi-publish/shared-utils/src/platform-config', vi.fn().mockImplementation(function () {
  return { getPlatform: vi.fn().mockReturnValue(publishConfig) }
}))

__registerMock('@multi-publish/rpa-engine', {
  platformSelectors: {
    PLATFORM_PUBLISH_SELECTORS: { xiaohongshu: publishConfig.selectors },
  },
})

__registerMock('@multi-publish/api-publish-engine', {
  supportsApi: vi.fn().mockReturnValue(false),
  publishViaApi: vi.fn(),
})

const RpaViewManager = require('../electron/services/rpa-view-manager')

describe('RpaViewManager 小红书发布', () => {
  let rpa

  beforeEach(() => {
    vi.clearAllMocks()
    RpaViewManager.prototype._emitProgress = vi.fn()
    RpaViewManager.prototype._createWindow = vi.fn().mockReturnValue({
      webContents: {
        getURL: vi.fn().mockReturnValue(publishConfig.publish_url),
        executeJavaScript: vi.fn().mockResolvedValue(null),
        send: vi.fn(),
        on: vi.fn(),
      },
      destroy: vi.fn(),
      on: vi.fn(),
    })
    RpaViewManager.prototype._restoreCookies = vi.fn().mockResolvedValue()
    RpaViewManager.prototype._windowKey = vi.fn().mockReturnValue('xiaohongshu_test')
    rpa = new RpaViewManager()
  })

  test('空内容不会进入发布页', async () => {
    const result = await rpa.publish('xiaohongshu', {}, null, 5000)

    expect(result).toEqual({
      success: false,
      error: '小红书发布至少需要标题、正文或视频',
      platform: 'xiaohongshu',
      track: 'dom', // 2026-10-21 track-diag-full：分轨诊断字段（未走 API 轨 ⇒ dom）
    })
  })

  test('图文内容通过通用引擎发布，而不是返回 pending', async () => {
    rpa._getPlatformConfig = vi.fn().mockReturnValue(publishConfig)
    rpa._publish_generic = vi.fn().mockResolvedValue({
      success: true,
      url: 'https://creator.xiaohongshu.com/publish/success',
      platform: 'xiaohongshu',
    })
    const article = { title: '标题', content: '正文', tags: ['话题'] }

    const result = await rpa.publish('xiaohongshu', article, null, 5000)

    expect(rpa._publish_generic).toHaveBeenCalledWith(
      expect.any(Object),
      article,
      'xiaohongshu',
      // 2026-09-29 图文链路：无 video_path 时进入图文模式，config 额外携带
      // preFill='switchImageTab'（publish/publish?from=menu 默认落视频 tab，
      // 必须先点「上传图文」；实测 file input accept 才从视频格式变为图片格式）
      expect.objectContaining({
        preFill: 'switchImageTab',
        publish_url: publishConfig.publish_url,
      }),
    )
    expect(result).toMatchObject({ success: true, platform: 'xiaohongshu' })
  })

  // 2026-10-10 硬约束收紧（用户要求「小红书不得真实发布」）：视频形态不再进入通用上传流程
  // （那条链路的终点是点平台「发布」按钮），改为 fail-closed。本条锁住「视频绝不落到发布链路」。
  test('视频内容被拒绝：不得进入通用上传流程（小红书仅存草稿）', async () => {
    rpa._getPlatformConfig = vi.fn().mockReturnValue(publishConfig)
    rpa._publish_generic = vi.fn().mockResolvedValue({ success: true, platform: 'xiaohongshu' })

    const result = await rpa.publish('xiaohongshu', { video_path: 'D:/media/demo.mp4' }, null, 5000)

    expect(rpa._publish_generic).not.toHaveBeenCalled()
    expect(result).toMatchObject({ success: false, platform: 'xiaohongshu', errorCode: 'XHS_VIDEO_DRAFT_UNSUPPORTED' })
  })
})
