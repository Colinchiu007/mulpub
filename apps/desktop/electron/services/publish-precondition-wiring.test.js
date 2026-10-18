// @ts-check
/**
 * publish-precondition-gate — 接线锁（2026-10-18）
 *
 * 单元判据在 publish-precondition.test.js；本文件锁的是**它真的接在主流程上**，
 * 且接在**点发布按钮之前**。动因：2026-10-17 批量发布的头条/抖音两条失败，
 * 判据本身可以写得再对，只要没接线就一行都不生效 —— 而「没接线」在只有单元
 * 测试的仓里是看不见的（这正是那两条真因被掩盖一整轮的原因）。
 *
 * 三个现场：
 *   ① 头条：有视频 + 平台无 file_input ⇒ 拦在发布之前，且 `_click` 一次都没被调用
 *   ② 抖音：上传 besteffort 放行 ⇒ 拦，而不是继续点发布
 *   ③ 全绿：不拦（守卫不得变成一刀切）
 */
const platformsMixin = require('./rpa-view-platforms')

/** 最小 win 桩：只有 getURL / executeJavaScript 会被摸到。 */
function makeWin (url = 'https://example.test/publish') {
  return {
    webContents: {
      getURL: () => url,
      executeJavaScript: vi.fn().mockResolvedValue(null),
      capturePage: vi.fn().mockResolvedValue({ isEmpty: () => true }),
      on: vi.fn(),
      removeListener: vi.fn(),
      setWindowOpenHandler: vi.fn(),
      debugger: { isAttached: () => false, attach: vi.fn(), detach: vi.fn(), on: vi.fn(), removeListener: vi.fn(), sendCommand: vi.fn().mockResolvedValue({}) },
    },
  }
}

/**
 * 造一个「页面上什么都没有」的 host —— 正好对应头条视频页的真实观测
 * （`visibleActionCount=12`、标题/正文/发布按钮全部 not found）。
 */
function makeHost (overrides = {}) {
  const host = Object.assign(Object.create(null), platformsMixin, {
    _emitProgress: vi.fn(),
    _navigateAndWait: vi.fn().mockResolvedValue(undefined),
    _sleep: vi.fn().mockResolvedValue(undefined),
    _waitForElement: vi.fn().mockResolvedValue(false),
    _resolveSelector: vi.fn().mockResolvedValue(null),
    _waitForCondition: vi.fn().mockResolvedValue(false),
    _click: vi.fn().mockResolvedValue(true),
    _clickViaCdp: vi.fn().mockResolvedValue(true),
    _clickStable: vi.fn().mockResolvedValue(true),
    _setFileInput: vi.fn().mockResolvedValue(true),
    _fillInput: vi.fn().mockResolvedValue(undefined),
    _startPublishNetworkCapture: vi.fn().mockResolvedValue({ stop: vi.fn().mockResolvedValue([]) }),
    _confirmPublishDialog: vi.fn().mockResolvedValue(undefined),
    _waitForVideoUploadComplete: vi.fn().mockResolvedValue(false),
  }, overrides)
  return host
}

describe('publish-precondition-gate — 接线锁', () => {
  it('① 头条现场：有视频 + 无 file_input ⇒ 拦在发布之前，publish 按钮一次都没点', async () => {
    const host = makeHost()
    const win = makeWin('https://mp.toutiao.com/profile_v4/xigua/upload-video')
    const config = {
      publish_url: 'https://mp.toutiao.com/profile_v4/xigua/upload-video',
      selectors: {
        // 与真实配置一致：图文文章页那套，完全没有 file_input
        title_input: ['textarea[placeholder*="标题"]'],
        editor: ['.ProseMirror'],
        publish_btn: ['button:has-text("预览并发布")'],
      },
      success_patterns: [],
    }
    const result = await host._publish_generic(win, { video_path: 'D:/v.mp4', title: '标题', content: '正文' }, 'toutiao', config)

    expect(result.success).toBe(false)
    expect(result.preSubmitBlocked).toBe(true)
    expect(result.reason).toBe('upload-selector-missing')
    expect(result.definitelyNotSent).toBe(true)
    expect(result.error).toContain('视频发布尚未支持')
    // 关键：发布按钮（及二次确认）一次都没被调用
    expect(host._click).not.toHaveBeenCalled()
    expect(host._clickStable).not.toHaveBeenCalled()
    expect(host._clickViaCdp).not.toHaveBeenCalled()
  })

  it('② 抖音现场：上传 besteffort 放行（返回 false）⇒ 拦下，不继续点发布', async () => {
    const host = makeHost({
      _resolveSelector: vi.fn(async (_win, candidates) => (Array.isArray(candidates) && candidates.length ? candidates[0] : null)),
      _waitForVideoUploadComplete: vi.fn().mockResolvedValue(false), // besteffort：真实现场就是这条
    })
    const win = makeWin('https://creator.douyin.com/creator-micro/content/post/video')
    const config = {
      publish_url: 'https://creator.douyin.com/creator-micro/content/post/video',
      selectors: {
        file_input: ['input[type="file"]'],
        title_input: ['input[placeholder*="标题"]'],
        editor: ['.editor'],
        publish_btn: ['button:has-text("发布")'],
      },
      success_patterns: [],
    }
    const result = await host._publish_generic(win, { video_path: 'D:/v.mp4', title: '标题', content: '正文' }, 'douyin', config)

    expect(result.success).toBe(false)
    expect(result.preSubmitBlocked).toBe(true)
    expect(result.reason).toBe('upload-not-completed')
    expect(result.error).toContain('视频上传未完成')
    expect(host._click).not.toHaveBeenCalled()
  })

  it('③ 全绿时不拦（守卫不得变成一刀切）：上传/标题/正文都确认后放行到发布按钮', async () => {
    const host = makeHost({
      _resolveSelector: vi.fn(async (_win, candidates) => (Array.isArray(candidates) && candidates.length ? candidates[0] : null)),
      _waitForVideoUploadComplete: vi.fn().mockResolvedValue(true),
      _fillInput: vi.fn().mockResolvedValue(undefined),
      // 发布按钮候选可见；验证阶段直接给成功
      _waitForElement: vi.fn().mockResolvedValue(true),
      _waitForCondition: vi.fn().mockResolvedValue(true),
    })
    const win = makeWin('https://creator.douyin.com/creator-micro/content/post/video')
    const config = {
      publish_url: 'https://creator.douyin.com/creator-micro/content/post/video',
      selectors: {
        file_input: ['input[type="file"]'],
        title_input: ['input[placeholder*="标题"]'],
        editor: ['.editor'],
        publish_btn: ['button:has-text("发布")'],
      },
      success_patterns: [],
    }
    const result = await host._publish_generic(win, { video_path: 'D:/v.mp4', title: '标题', content: '正文' }, 'douyin', config)

    // 没有 preSubmitBlocked —— 走到了发布按钮
    expect(result.preSubmitBlocked).toBeUndefined()
    expect(host._click).toHaveBeenCalled()
  })
})
