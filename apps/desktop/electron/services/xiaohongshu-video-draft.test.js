// @ts-check
/**
 * 小红书视频「只落草稿箱」契约（video-publish-4，2026-10-18 从 rpa-view-platforms.test.js 拆出）
 *
 * 拆出原因：`rpa-view-platforms.test.js` 已贴 `testLimit=1500` 行数熔断，新增超限测试不得进来。
 * 本文件只锁小红书视频形态的契约，与该大文件里的图文模式用例解耦。
 *
 * 契约（2026-10-18 变更，用户明确要求「小红书发布到草稿箱即可」）：
 *   · 视频形态走 generic 草稿链，`draftOnly: true`，**不点发布**；
 *   · 取配置时必须带 article（按内容类型选选择器的前提）；
 *   · 合并后选择器仍拿不到 file_input ⇒ 上传无从发生 ⇒ fail-closed 拒绝（不静默降级）；
 *   · 图文形态不回归（仍 draftOnly + preFill=switchImageTab）。
 */
const platformsMixin = require('./rpa-view-platforms')
const { PLATFORM_PUBLISH_SELECTORS } = require('@multi-publish/rpa-engine/src/platform-selectors')

function createWindow (url) {
  const executeJavaScript = vi.fn().mockResolvedValue(true)
  return {
    win: {
      webContents: {
        getURL: vi.fn().mockReturnValue(url),
        executeJavaScript,
        isDestroyed: vi.fn().mockReturnValue(false),
        on: vi.fn(),
        session: { webRequest: { onBeforeRequest: vi.fn(), onCompleted: vi.fn() } },
      },
      setBounds: vi.fn(),
      loadURL: vi.fn(),
      close: vi.fn(),
      isDestroyed: vi.fn().mockReturnValue(false),
    },
  }
}

function createContext () {
  return {
    _emitProgress: vi.fn(),
    _navigateAndWait: vi.fn().mockResolvedValue(undefined),
    _waitForElement: vi.fn().mockResolvedValue(true),
    _setFileInput: vi.fn().mockResolvedValue(true),
    _dropFilesToDragArea: vi.fn().mockResolvedValue(false),
    _dismissImageEditModal: vi.fn().mockResolvedValue('NO_EDIT_MODAL'),
    _click: vi.fn().mockResolvedValue(true),
    _sleep: vi.fn().mockResolvedValue(undefined),
    _waitForCondition: vi.fn().mockResolvedValue(true),
    _waitForResponse: vi.fn().mockResolvedValue(null),
    _dismissPostNavDialogs: vi.fn().mockResolvedValue(undefined),
    _waitForVideoUploadComplete: vi.fn().mockResolvedValue(undefined),
    _fillInput: vi.fn().mockResolvedValue(undefined),
    _setElementContentSafe: vi.fn().mockResolvedValue(undefined),
    _getPlatformConfig: vi.fn().mockReturnValue({
      publish_url: 'https://example.com/config-url',
      type: 'mixed',
      has_api: false,
      selectors: { file_input: ['input[type="file"]'], title_input: ['input[placeholder*="标题"]'], publish_btn: ['button:has-text("发布")'] },
      success_patterns: [],
    }),
    _publish_generic: vi.fn().mockResolvedValue({ success: true, platform: 'xiaohongshu' }),
    _resolveSelector: vi.fn().mockResolvedValue('input[type="file"]'),
  }
}

describe('小红书视频「只落草稿箱」契约（video-publish-4）', () => {
  it('视频模式走草稿链：draftOnly=true，且不点发布', async () => {
    const { win } = createWindow('https://creator.xiaohongshu.com/publish/publish?from=menu&target=video')
    const context = createContext()

    await platformsMixin._publish_xiaohongshu.call(context, win, { title: 'T', video_path: 'D:/v.mp4' })

    expect(context._publish_generic).toHaveBeenCalled()
    const passed = context._publish_generic.mock.calls[0][3]
    expect(passed.draftOnly).toBe(true)
    // 视频不需要切图文 tab
    expect(passed.preFill).toBeUndefined()
    // 入口是视频上传页
    expect(passed.publish_url).toContain('target=video')
  })

  it('取配置时带上 article（按内容类型选选择器的前提）', async () => {
    const { win } = createWindow('https://creator.xiaohongshu.com/publish/publish?from=menu&target=video')
    const context = createContext()
    await platformsMixin._publish_xiaohongshu.call(context, win, { title: 'T', video_path: 'D:/v.mp4' })
    expect(context._getPlatformConfig).toHaveBeenCalledWith('xiaohongshu', expect.objectContaining({ video_path: 'D:/v.mp4' }))
  })

  it('真实配置下：视频选择器含 file_input 与 tiptap 编辑器', () => {
    const cfg = platformsMixin._getPlatformConfig.call({}, 'xiaohongshu', { video_path: 'D:/v.mp4' })
    expect(cfg.selectors.file_input).toContain('input.upload-input')
    expect(cfg.selectors.title_input).toContain('input.d-text')
    expect(cfg.selectors.editor).toContain('.tiptap.ProseMirror')
  })

  it('图文模式不回归：仍 draftOnly + preFill=switchImageTab', async () => {
    const { win } = createWindow('https://creator.xiaohongshu.com/publish/publish?from=menu')
    const context = createContext()
    await platformsMixin._publish_xiaohongshu.call(context, win, { title: 'T', images: ['C:/a.png'] })
    const passed = context._publish_generic.mock.calls[0][3]
    expect(passed.draftOnly).toBe(true)
    expect(passed.preFill).toBe('switchImageTab')
  })

  it('真实配置下缺 file_input ⇒ fail-closed 拒绝（不静默降级成草稿）', async () => {
    const { win } = createWindow('https://creator.xiaohongshu.com/publish/publish?from=menu&target=video')
    const context = createContext()
    // 守卫读的必须是**真实合并后**的选择器，故这里不 mock _getPlatformConfig
    context._getPlatformConfig = platformsMixin._getPlatformConfig.bind(context)
    const orig = PLATFORM_PUBLISH_SELECTORS.xiaohongshu_video
    PLATFORM_PUBLISH_SELECTORS.xiaohongshu_video = { ...orig, file_input: [] }
    try {
      const result = await platformsMixin._publish_xiaohongshu.call(context, win, { title: 'T', video_path: 'D:/v.mp4' })
      expect(context._publish_generic).not.toHaveBeenCalled()
      expect(result).toMatchObject({ success: false, platform: 'xiaohongshu', errorCode: 'XHS_VIDEO_DRAFT_UNSUPPORTED' })
    } finally {
      PLATFORM_PUBLISH_SELECTORS.xiaohongshu_video = orig
    }
  })
})
