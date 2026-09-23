// @ts-check
/**
 * RpaViewManager 平台 mixin 结构回归测试
 */
const fs = require('fs')
const platformsMixin = require('./rpa-view-platforms')

function createVerifyContext (executeJavaScript, options = {}) {
  return {
    _emitProgress: vi.fn(),
    _sleep: vi.fn().mockResolvedValue(undefined),
    _waitForCondition: vi.fn().mockResolvedValue(options.conditionResult ?? false),
    _waitForElement: vi.fn().mockResolvedValue(options.elementResult ?? false),
    _findPublishedArtifact: vi.fn().mockResolvedValue(options.artifact ?? null),
  }
}

function createWechatContext() {
  return {
    _emitProgress: vi.fn(),
    _navigateAndWait: vi.fn().mockResolvedValue(undefined),
    _waitForElement: vi.fn().mockResolvedValue(true),
    _fillInput: vi.fn().mockResolvedValue(undefined),
    _fillInFrame: vi.fn().mockResolvedValue(undefined),
    _click: vi.fn().mockResolvedValue(true),
    _sleep: vi.fn().mockResolvedValue(undefined),
    _waitForResponse: vi.fn().mockResolvedValue(null),
    _waitForCondition: vi.fn().mockResolvedValue(true),
  }
}

describe('rpa-view-platforms — 结构约束', () => {
  it('wechat_mp 发布方法只定义一次，避免 pending stub 覆盖风险', () => {
    const source = fs.readFileSync(require.resolve('./rpa-view-platforms'), 'utf-8')
    const definitions = source.match(/async\s+_publish_wechat_mp\s*\(/g) || []

    expect(definitions).toHaveLength(1)
    expect(source).not.toContain('wechat_mp RPA pending')
  })
})

describe('rpa-view-platforms — 微信公众号发布', () => {
  function createWindow(url) {
    const executeJavaScript = vi.fn().mockResolvedValue(true)
    const win = {
      webContents: {
        getURL: vi.fn().mockReturnValue(url),
        getTitle: vi.fn().mockReturnValue(''),
        executeJavaScript,
      },
    }

    return { win, executeJavaScript }
  }

  it('保存按钮点击失败时返回失败', async () => {
    const { win } = createWindow('https://mp.weixin.qq.com/cgi-bin/appmsg?appmsgid=12345')
    const context = createWechatContext()
    context._click.mockResolvedValueOnce(false)

    const result = await platformsMixin._publish_wechat_mp.call(context, win, {})

    expect(result).toEqual(expect.objectContaining({
      success: false,
      platform: 'wechat_mp',
    }))
    expect(result.error).toContain('保存')
  })

  it('保存后 URL 没有媒体 ID 时返回失败', async () => {
    const { win } = createWindow('https://mp.weixin.qq.com/cgi-bin/appmsg?t=media/appmsg_edit')
    const context = createWechatContext()

    const result = await platformsMixin._publish_wechat_mp.call(context, win, {})

    expect(result).toEqual(expect.objectContaining({
      success: false,
      platform: 'wechat_mp',
    }))
    expect(result.error).toContain('媒体 ID')
  })

  it('正常保存草稿时返回成功且不进入群发流程', async () => {
    const { win } = createWindow('https://mp.weixin.qq.com/cgi-bin/appmsg?appmsgid=12345')
    const context = createWechatContext()

    const result = await platformsMixin._publish_wechat_mp.call(context, win, {})

    expect(result).toEqual(expect.objectContaining({
      success: true,
      platform: 'wechat_mp',
    }))
    expect(context._navigateAndWait).toHaveBeenCalledTimes(1)
    expect(context._click).toHaveBeenCalledTimes(1)
  })

  it('把保存后 URL 中的媒体 ID 传给群发选择器并成功群发', async () => {
    const { win, executeJavaScript } = createWindow('https://mp.weixin.qq.com/cgi-bin/appmsg?appmsgid=12345')
    const context = createWechatContext()

    const result = await platformsMixin._publish_wechat_mp.call(context, win, { massSend: true })

    expect(result.success).toBe(true)
    expect(context._navigateAndWait).toHaveBeenCalledTimes(2)
    const massSendScript = executeJavaScript.mock.calls
      .map(([script]) => script)
      .find((script) => script.includes('appmsgid'))
    expect(massSendScript).toContain('[appmsgid=\\"12345\\"]')
    expect(context._click).toHaveBeenCalledWith(win, 'a.btn_masssend, a[data-action="masssend"]')
    expect(context._click).toHaveBeenCalledWith(win, '.dialog_bd_btn a:has-text("确定"), .weui-desktop-btn:has-text("确定")')
  })

  it('群发列表找不到已保存草稿时返回失败', async () => {
    const { win, executeJavaScript } = createWindow('https://mp.weixin.qq.com/cgi-bin/appmsg?appmsgid=12345')
    // 调用顺序：登录态检测（新）→ 同意勾选 → 群发列表草稿选择
    executeJavaScript
      .mockResolvedValueOnce({ hasTimeout: false, hasLoginPrompt: false })
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(false)
    const context = createWechatContext()

    const result = await platformsMixin._publish_wechat_mp.call(context, win, { massSend: true })

    expect(result).toEqual(expect.objectContaining({
      success: false,
      platform: 'wechat_mp',
    }))
    expect(result.error).toContain('草稿')
    expect(context._click).not.toHaveBeenCalledWith(win, 'a.btn_masssend, a[data-action="masssend"]')
  })

  it('群发按钮点击失败时返回失败', async () => {
    const { win } = createWindow('https://mp.weixin.qq.com/cgi-bin/appmsg?appmsgid=12345')
    const context = createWechatContext()
    context._click
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false)

    const result = await platformsMixin._publish_wechat_mp.call(context, win, { massSend: true })

    expect(result).toEqual(expect.objectContaining({
      success: false,
      platform: 'wechat_mp',
    }))
    expect(result.error).toContain('群发按钮')
  })

  it('群发确认按钮点击失败时返回失败', async () => {
    const { win } = createWindow('https://mp.weixin.qq.com/cgi-bin/appmsg?appmsgid=12345')
    const context = createWechatContext()
    context._click
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false)

    const result = await platformsMixin._publish_wechat_mp.call(context, win, { massSend: true })

    expect(result).toEqual(expect.objectContaining({
      success: false,
      platform: 'wechat_mp',
    }))
    expect(result.error).toContain('群发确认')
  })
})

describe('rpa-view-platforms — 发布结果验证', () => {
  it('不会把发布按钮禁用误判为成功', async () => {
    const executeJavaScript = vi.fn().mockResolvedValue({
      url: 'https://baijiahao.baidu.com/builder/rc/edit?type=videoV2',
      text: '视频已上传',
      storage: {},
      links: [],
      buttons: [{ text: '发布', disabled: true, visible: true }],
    })
    const context = createVerifyContext(executeJavaScript)
    const result = await platformsMixin._verifyPublishSuccess.call(context, {
      webContents: { getURL: vi.fn().mockReturnValue('https://baijiahao.baidu.com/builder/rc/edit?type=videoV2'), executeJavaScript },
    }, 'baijiahao', { success_mode: 'url', publish_url: 'https://baijiahao.baidu.com/builder/rc/edit?type=videoV2' }, null, null)

    expect(result).toEqual(expect.objectContaining({ success: false }))
    expect(result.error).toContain('timeout')
  })

  it('从真实发布响应体提取 mediaId 并拒绝内部 task ID', async () => {
    const executeJavaScript = vi.fn().mockResolvedValue({
      url: 'https://baijiahao.baidu.com/builder/rc/clue?from=videoV2',
      text: '发布成功',
      storage: {},
      links: [],
      buttons: [],
    })
    const context = createVerifyContext(executeJavaScript, { conditionResult: true })
    const networkCapture = {
      evidence: [{ publishIds: ['media-1234'] }],
      stop: vi.fn().mockResolvedValue([{ endpoint: 'https://baijiahao.baidu.com/api/publish', status: 200, mimeType: 'application/json' }]),
    }
    const result = await platformsMixin._verifyPublishSuccess.call(context, {
      webContents: { getURL: vi.fn().mockReturnValue('https://baijiahao.baidu.com/builder/rc/clue?from=videoV2'), executeJavaScript },
    }, 'baijiahao', { success_mode: 'dom', success_selector: '.success' }, null, networkCapture)

    expect(result).toMatchObject({ success: true, postId: 'media-1234' })
    expect(result.postId).not.toMatch(/^task_/)
  })

  it('严格平台忽略历史 localStorage、旧链接和当前 URL 中的作品 ID', async () => {
    const executeJavaScript = vi.fn().mockResolvedValue({
      url: 'https://baijiahao.baidu.com/builder/rc/clue?mediaId=stale-media-999',
      storage: { mediaId: 'stale-media-999' },
      links: [{ href: 'https://baijiahao.baidu.com/s?articleId=stale-media-999' }],
    })
    const context = createVerifyContext(executeJavaScript, { conditionResult: true })
    const networkCapture = {
      evidence: [],
      stop: vi.fn().mockResolvedValue([]),
    }
    const result = await platformsMixin._verifyPublishSuccess.call(context, {
      webContents: { getURL: vi.fn().mockReturnValue('https://baijiahao.baidu.com/builder/rc/clue?mediaId=stale-media-999'), executeJavaScript },
    }, 'baijiahao', { success_mode: 'dom' }, null, networkCapture, { title: '当前视频标题', publishedAt: Date.now() })

    expect(result).toMatchObject({ success: false, error: '发布结果缺少平台作品 ID' })
    expect(context._findPublishedArtifact).toHaveBeenCalled()
    expect(executeJavaScript).not.toHaveBeenCalled()
  })

  it('严格平台拒绝伪装成大小写变体的内部 task ID', async () => {
    const context = createVerifyContext(vi.fn(), { conditionResult: true })
    const networkCapture = {
      evidence: [{ publishIds: ['TASK_internal-1'] }],
      stop: vi.fn().mockResolvedValue([]),
    }
    const result = await platformsMixin._verifyPublishSuccess.call(context, {
      webContents: { getURL: vi.fn().mockReturnValue('https://cp.kuaishou.com/article/publish/video'), executeJavaScript: vi.fn() },
    }, 'kuaishou', { success_mode: 'dom' }, null, networkCapture, { title: '当前视频标题', publishedAt: Date.now() })

    expect(result).toMatchObject({ success: false, error: '发布结果缺少平台作品 ID' })
  })

  it('严格平台失败结果也不返回敏感 URL query', async () => {
    const context = createVerifyContext(vi.fn(), { conditionResult: true })
    const networkCapture = { evidence: [], stop: vi.fn().mockResolvedValue([]) }
    const result = await platformsMixin._verifyPublishSuccess.call(context, {
      webContents: { getURL: vi.fn().mockReturnValue('https://cp.kuaishou.com/article/publish/video?access_token=secret-token'), executeJavaScript: vi.fn() },
    }, 'kuaishou', { success_mode: 'dom' }, null, networkCapture, { title: '当前视频标题', publishedAt: Date.now() })

    expect(result).toMatchObject({ success: false, url: 'https://cp.kuaishou.com/article/publish/video' })
  })

  it('发布诊断只包含脱敏网络摘要', async () => {
    const executeJavaScript = vi.fn()
    const context = createVerifyContext(executeJavaScript, { conditionResult: true })
    const networkCapture = {
      evidence: [{ publishIds: ['media-5678'] }],
      stop: vi.fn().mockResolvedValue([{
        endpoint: 'https://baijiahao.baidu.com/api/publish',
        status: 201,
        mimeType: 'application/json',
      }]),
    }
    const result = await platformsMixin._verifyPublishSuccess.call(context, {
      webContents: { getURL: vi.fn().mockReturnValue('https://baijiahao.baidu.com/builder/rc/clue?access_token=secret-token'), executeJavaScript },
    }, 'baijiahao', { success_mode: 'dom' }, null, networkCapture)
    const serialized = JSON.stringify(result.diagnostics)

    expect(result).toMatchObject({ success: true, postId: 'media-5678' })
    expect(result.diagnostics).toEqual({
      responseCount: 1,
      responses: [{ endpoint: 'https://baijiahao.baidu.com/api/publish', status: 201, mimeType: 'application/json' }],
      artifactFound: false,
    })
    expect(result.url).toBe('https://baijiahao.baidu.com/builder/rc/clue')
    expect(serialized).not.toContain('access_token')
    expect(serialized).not.toContain('secret-token')
  })

  it('发布点击失败时每次都释放当前网络抓包', async () => {
    const captures = []
    const context = {
      _emitProgress: vi.fn(),
      _navigateAndWait: vi.fn().mockResolvedValue(undefined),
      _waitForElement: vi.fn().mockResolvedValue(true),
      _dismissPostNavDialogs: vi.fn().mockResolvedValue(''),
      _startPublishNetworkCapture: vi.fn(() => {
        const capture = { stop: vi.fn().mockResolvedValue([]) }
        captures.push(capture)
        return capture
      }),
      _click: vi.fn().mockRejectedValue(new Error('publish click failed')),
      _sleep: vi.fn().mockResolvedValue(undefined),
    }
    const win = {
      webContents: {
        getURL: vi.fn().mockReturnValue('https://cp.kuaishou.com/article/publish/video'),
        executeJavaScript: vi.fn().mockResolvedValue({ hasLoginPrompt: false, hasForm: true }),
      },
    }
    const result = await platformsMixin._publish_generic.call(context, win, {}, 'kuaishou', {
      publish_url: 'https://cp.kuaishou.com/article/publish/video',
      selectors: { publish_btn: ['button.publish'] },
      has_api: false,
      success_patterns: [],
    })

    expect(result).toMatchObject({ success: false, platform: 'kuaishou' })
    expect(captures.length).toBeGreaterThan(0)
    captures.forEach(capture => expect(capture.stop).toHaveBeenCalledTimes(1))
    const parseResponseBody = context._startPublishNetworkCapture.mock.calls[0][1].parseResponseBody
    expect(parseResponseBody(JSON.stringify({ data: { mediaId: 'media-rejected-1' } }), {
      endpoint: 'https://cp.kuaishou.com/rest/cp/video/publish',
      status: 500,
    })).toBeNull()
    expect(parseResponseBody(JSON.stringify({ data: { mediaId: 'media-accepted-1' } }), {
      endpoint: 'https://cp.kuaishou.com/rest/cp/video/publish',
      status: 201,
    })).toEqual({ publishIds: ['media-accepted-1'] })
  })

  it('无响应 ID 时通过百家号作品列表回查真实 article_id', async () => {
    const executeJavaScript = vi.fn().mockResolvedValue({
      url: 'https://baijiahao.baidu.com/builder/rc/clue?from=videoV2',
      text: '发布成功',
      storage: {},
      links: [],
      buttons: [],
    })
    const context = createVerifyContext(executeJavaScript, {
      conditionResult: true,
      artifact: { postId: 'article-9001', url: 'https://baijiahao.baidu.com/s?id=9001', title: '视频标题' },
    })
    const result = await platformsMixin._verifyPublishSuccess.call(context, {
      webContents: { getURL: vi.fn().mockReturnValue('https://baijiahao.baidu.com/builder/rc/clue?from=videoV2'), executeJavaScript },
    }, 'baijiahao', { success_mode: 'dom' }, null, null, { title: '视频标题', publishedAt: Date.now() })

    expect(result).toMatchObject({ success: true, postId: 'article-9001' })
    expect(context._findPublishedArtifact).toHaveBeenCalled()
  })

  it('从快手作品列表响应体提取 workId 作为真实作品 ID', () => {
    const startedAt = Date.now()
    const result = platformsMixin._parseKuaishouArtifact.call({}, [
      { kuaishouArtifacts: [{ postId: 'ks-work-88', title: '快手视频标题', publishedAt: startedAt, url: 'https://m.gifshow.com/fw/photo/ks-work-88' }] },
    ], { title: '快手视频标题', publishedAt: startedAt })

    expect(result).toMatchObject({ postId: 'ks-work-88' })
  })

  it('快手作品回查拒绝无时间戳或标题不匹配的历史作品', () => {
    const startedAt = Date.now()
    const result = platformsMixin._parseKuaishouArtifact.call({}, [
      { kuaishouArtifacts: [
        { postId: 'ks-history-1', title: '当前视频标题', publishedAt: 0 },
        { postId: 'ks-history-2', title: '旧视频标题', publishedAt: startedAt },
      ] },
    ], { title: '当前视频标题', publishedAt: startedAt })

    expect(result).toBeNull()
  })

  it('无响应 ID 时通过快手作品回查匹配真实照片 ID', async () => {
    const executeJavaScript = vi.fn().mockResolvedValue({
      url: 'https://cp.kuaishou.com/article/manage/video?status=1',
      text: '发布成功',
      storage: {},
      links: [{ href: 'https://m.gifshow.com/fw/photo/ks-photo-66', text: '快手视频标题' }],
      buttons: [],
    })
    const context = createVerifyContext(executeJavaScript, {
      conditionResult: true,
      artifact: { postId: 'ks-photo-66', url: 'https://m.gifshow.com/fw/photo/ks-photo-66' },
    })
    const result = await platformsMixin._verifyPublishSuccess.call(context, {
      webContents: { getURL: vi.fn().mockReturnValue('https://cp.kuaishou.com/article/manage/video?status=1'), executeJavaScript },
    }, 'kuaishou', { success_mode: 'dom' }, null, null, { title: '快手视频标题', publishedAt: Date.now() })

    expect(result).toMatchObject({ success: true, postId: 'ks-photo-66' })
    expect(context._findPublishedArtifact).toHaveBeenCalled()
  })
})

describe('rpa-view-platforms — 视频发布页字段填充时序（2026-09 E2E 取证）', () => {
  // 实证背景：kuaishou/bilibili 的 publish_url 是上传落地页，标题/简介字段
  // 只有在视频上传完成并进入编辑器后才渲染；旧顺序先填字段后上传，
  // 导致 title/desc 选择器必然 3×10s timeout（smoke3 日志实锤）。
  function getGenericBody () {
    const source = fs.readFileSync(require.resolve('./rpa-view-platforms'), 'utf-8')
    const start = source.indexOf('async _publish_generic')
    const end = source.indexOf('\n  // ========== ', start + 10)
    return source.slice(start, end > 0 ? end : undefined)
  }

  it('_publish_generic：视频上传发生在标题填充之前', () => {
    const body = getGenericBody()
    const uploadIdx = body.indexOf('_setFileInput(win, article.video_path')
    const titleIdx = body.indexOf("'filling title...'")
    expect(uploadIdx).toBeGreaterThan(-1)
    expect(titleIdx).toBeGreaterThan(-1)
    expect(uploadIdx).toBeLessThan(titleIdx)
  })

  it('_publish_generic：导航后调用弹窗清理（草稿恢复/引导遮罩）', () => {
    const body = getGenericBody()
    expect(body).toContain('_dismissPostNavDialogs')
    // 清理必须发生在填字段之前
    expect(body.indexOf('_dismissPostNavDialogs')).toBeLessThan(body.indexOf("'filling title...'"))
    const source = fs.readFileSync(require.resolve('./rpa-view-platforms'), 'utf-8')
    expect(source).toMatch(/_dismissPostNavDialogs\s*\(/)
    // 快手草稿弹窗两按钮（放弃/继续编辑）与通用引导按钮（我知道了/知道了）都在处理范围内
    expect(source).toContain('放弃')
    expect(source).toContain('我知道了')
  })

  it('_publish_generic：上传后有编辑器表单就绪等待（而非直接填字段）', () => {
    const body = getGenericBody()
    const uploadIdx = body.indexOf('_setFileInput(win, article.video_path')
    const titleIdx = body.indexOf("'filling title...'")
    const formWait = body.slice(uploadIdx, titleIdx)
    expect(formWait).toContain('_waitForCondition')
  })

  // smoke4（2026-09-23）实锤：旧上传完成判定 !p||s 在快手/B站立即为真（页面根本
  // 不用 progress class），导致还在上传落地页就点发布→全部失败。统一改为
  // 共享的强判定：进度元素不可见 且（可见 video 预览 或 已跳转编辑页 URL）。
  it('视频上传完成强判定存在于 generic 与 douyin 两条链路', () => {
    const source = fs.readFileSync(require.resolve('./rpa-view-platforms'), 'utf-8')
    expect(source).toMatch(/async\s+_waitForVideoUploadComplete\s*\(/)
    const genericStart = source.indexOf('async _publish_generic')
    const genericEnd = source.indexOf('\n  // ========== ', genericStart + 10)
    const genericBody = source.slice(genericStart, genericEnd > 0 ? genericEnd : undefined)
    expect(genericBody).toContain('this._waitForVideoUploadComplete(')
    const douyinStart = source.indexOf('async _publish_douyin')
    const douyinEnd = source.indexOf('\n  async _', douyinStart + 10)
    const douyinBody = source.slice(douyinStart, douyinEnd > 0 ? douyinEnd : undefined)
    expect(douyinBody).toContain('this._waitForVideoUploadComplete(')
    // blob 本地预览在注入瞬间就存在，判定必须要求 https 服务端预览源（smoke5 实锤）
    expect(source).toMatch(/currentSrc/)
    expect(source).toMatch(/indexOf\("https:"\)===0/)
  })
})

// 2026-09-23 live DOM 取证（01-docs/evidence/rpa-dom-2026-09-23/d3-1-kuaishou.json、d4-1-kuaishou.json、
// d5-bilibili.json、d5-douyin.json）：
// ① 快手编辑页根本没有 input[placeholder*="标题"]，作品标题/描述是同一个
//    contenteditable：div#work-description-edit[placeholder="作品描述不会写？试试智能文案"]，
//    旧代码只试 title_input[0] 且无兜底 → 必然 3×10s timeout；
// ② 上传中的负向信号（“上传中/剩余时间/百分比未满”）平台通用，必须参与判定，
//    否则 kuaishou 25s 就误判完成（smoke6 实锤）；
// ③ 多候选选择器只取 [0] 是结构性缺陷（页面改版即全链失败）。
describe('rpa-view-platforms — 选择器候选回退与标题写编辑器（live DOM 取证）', () => {
  function getGenericBody () {
    const source = fs.readFileSync(require.resolve('./rpa-view-platforms'), 'utf-8')
    const start = source.indexOf('async _publish_generic')
    const end = source.indexOf('\n  // ========== ', start + 10)
    return source.slice(start, end > 0 ? end : undefined)
  }

  function createGenericContext (matchSels) {
    const allowed = Array.isArray(matchSels) ? matchSels : [matchSels]
    const ctx = {
      _emitProgress: vi.fn(),
      _navigateAndWait: vi.fn().mockResolvedValue(undefined),
      _waitForElement: vi.fn(async (win, sel) => allowed.includes(sel)),
      _fillInput: vi.fn().mockResolvedValue(true),
      _click: vi.fn().mockResolvedValue(true),
      _sleep: vi.fn().mockResolvedValue(undefined),
      _dismissPostNavDialogs: vi.fn().mockResolvedValue(''),
      _waitForVideoUploadComplete: vi.fn().mockResolvedValue(true),
      _waitForCondition: vi.fn().mockResolvedValue(true),
      _waitForResponse: vi.fn().mockResolvedValue(null),
      _startPublishNetworkCapture: vi.fn(() => ({ stop: vi.fn().mockResolvedValue([]) })),
      _verifyPublishSuccess: vi.fn().mockResolvedValue({ success: true, platform: 'kuaishou' }),
      _prepKuaishou: vi.fn().mockResolvedValue(undefined),
      _prepBilibili: vi.fn().mockResolvedValue(undefined),
      _getPlatformConfig: vi.fn(() => ({ publish_url: 'x', selectors: {}, has_api: false, success_patterns: [] })),
    }
    // 候选回退与标题拼接走真实实现，只有底层 _waitForElement/_fillInput 被 mock，
    // 这样测试才真的能验证「首个候选不存在时回退到下一个」这条取证结论
    ctx._resolveSelector = (...args) => platformsMixin._resolveSelector.call(ctx, ...args)
    ctx._composeEditorCaption = (...args) => platformsMixin._composeEditorCaption.call(ctx, ...args)
    return ctx
  }

  const win = {
    webContents: {
      getURL: vi.fn().mockReturnValue('https://cp.kuaishou.com/article/publish/video?tabType=1'),
      executeJavaScript: vi.fn().mockResolvedValue({ hasLoginPrompt: false, hasForm: true }),
    },
  }

  const ksConfig = {
    publish_url: 'https://cp.kuaishou.com/article/publish/video?tabType=1',
    has_api: false,
    success_patterns: [],
    selectors: {
      title_input: ['input[placeholder*="标题"]', '[class*="title"] input'],
      editor: ['#work-description-edit', '[contenteditable="true"]'],
      desc_textarea: ['#work-description-edit'],
      publish_btn: ['button:has-text("发布")'],
    },
  }

  it('generic：标题/文件/简介不再硬取候选首个，改走 _resolveSelector 回退', () => {
    const body = getGenericBody()
    expect(body).toContain('this._resolveSelector(')
    expect(body).not.toMatch(/_waitForElement\(\s*win,\s*sel\.title_input\[0\]/)
    expect(body).not.toMatch(/_waitForElement\(\s*win,\s*sel\.file_input\[0\]/)
    expect(body).not.toMatch(/_waitForElement\(\s*win,\s*cs\[0\]/)
  })

  it('generic：_resolveSelector 定义存在且遍历全部候选', () => {
    const source = fs.readFileSync(require.resolve('./rpa-view-platforms'), 'utf-8')
    const start = source.indexOf('async _resolveSelector')
    expect(start).toBeGreaterThan(-1)
    const body = source.slice(start, start + 1200)
    expect(body).toMatch(/for\s*\(/)
    expect(body).toContain('_waitForElement(')
  })

  it('快手：无独立标题字段时标题写进作品描述编辑器，并与正文合并（不被正文覆写）', async () => {
    const context = createGenericContext(['#work-description-edit'])
    await platformsMixin._publish_generic.call(context, win, { title: '标题A', content: '正文B' }, 'kuaishou', ksConfig)

    const editorCalls = context._fillInput.mock.calls.filter(([, sel]) => sel === '#work-description-edit')
    expect(editorCalls.length).toBeGreaterThan(0)
    const written = editorCalls[0][2]
    expect(String(written)).toContain('标题A')
    expect(String(written)).toContain('正文B')
    // 正文步骤不得再把同一编辑器覆写为纯正文（否则标题丢失）
    expect(context._fillInput.mock.calls.some(([, , v]) => String(v) === '正文B')).toBe(false)
    // 候选回退确实试过标题候选
    expect(context._waitForElement.mock.calls.map((c) => c[1])).toContain('input[placeholder*="标题"]')
  })

  it('有独立标题字段时：标题进标题框、正文进编辑器，互不合并', async () => {
    const context = createGenericContext(['input[placeholder*="标题"]', '[contenteditable="true"]'])
    const cfg = {
      publish_url: 'https://member.bilibili.com/platform/upload/video/frame',
      has_api: false,
      success_patterns: [],
      selectors: {
        title_input: ['input[placeholder*="标题"]'],
        editor: ['[contenteditable="true"]'],
        publish_btn: ['button:has-text("立即投稿")'],
      },
    }
    await platformsMixin._publish_generic.call(context, win, { title: '标题A', content: '正文B' }, 'bilibili', cfg)
    expect(context._fillInput).toHaveBeenCalledWith(win, 'input[placeholder*="标题"]', '标题A')
    const descCall = context._fillInput.mock.calls.find(([, sel]) => sel === '[contenteditable="true"]')
    expect(descCall).toBeTruthy()
    expect(String(descCall[2])).toContain('正文B')
  })

  it('上传完成判定：含“上传中/剩余时间/百分比未满”负向信号，默认预算 ≥15 分钟', () => {
    const source = fs.readFileSync(require.resolve('./rpa-view-platforms'), 'utf-8')
    const start = source.indexOf('async _waitForVideoUploadComplete')
    const body = source.slice(start, source.indexOf('\n  // ========== ', start + 10))
    expect(body).toMatch(/上传中/)
    expect(body).toMatch(/剩余时间|转码中/)
    expect(body).toMatch(/100/)
    expect(Number((body.match(/timeoutMs \|\| (\d+)/) || [])[1])).toBeGreaterThanOrEqual(900000)
  })

  it('douyin 专用链路也先清理引导遮罩（实测页面带“我知道了”）', () => {
    const source = fs.readFileSync(require.resolve('./rpa-view-platforms'), 'utf-8')
    const start = source.indexOf('async _publish_douyin')
    const body = source.slice(start, source.indexOf('\n  // ========== ', start + 10))
    expect(body).toContain('_dismissPostNavDialogs')
  })

  // B站 live DOM（d5-bilibili.json）：`input.bcc-select-input-inner`
  // 占位「请选择符合您视频内容的创作声明」是带 * 的必填项，不选会被服务端拒；
  // 同时风控短信弹窗会盖住投稿区。两条都必须处理才能把 RPA 兜底链路跑完。
  it('_prepBilibili：先选创作声明并清理短信验证弹窗', () => {
    const source = fs.readFileSync(require.resolve('./rpa-view-platforms'), 'utf-8')
    const start = source.indexOf('async _prepBilibili')
    const body = source.slice(start, source.indexOf('\n  async _', start + 10))
    expect(body).toContain('_selectContentDeclaration')
    expect(body).toMatch(/短信验证|安全验证/)
    expect(source).toMatch(/async\s+_selectContentDeclaration\s*\(/)
  })
})

// 创作声明是 B站必填项，选不上就是服务端拒稿；这里锁住状态机行为，
// 避免以后重构时把“没点到选项”当成成功返回
describe('rpa-view-platforms — _selectContentDeclaration 状态机', () => {
  function makeCtx (script) {
    const exec = vi.fn()
    for (const r of script) {
      if (r instanceof Error) exec.mockRejectedValueOnce(r); else exec.mockResolvedValueOnce(r)
    }
    return {
      win: { webContents: { executeJavaScript: exec } },
      ctx: { _sleep: vi.fn().mockResolvedValue(undefined) },
      exec,
    }
  }

  it('点开下拉 → 精确文本选中 AI生成内容 → 点确定，state=done', async () => {
    const { win, ctx, exec } = makeCtx(['OPENED', { ok: true, option: 'AI生成内容' }, true])
    const res = await platformsMixin._selectContentDeclaration.call(ctx, win, 'bilibili', { aiGenerated: true }, {
      inputKeyword: '创作声明',
      optionRoots: ['.bcc-select-panel li'],
      confirmRoots: ['.bcc-button'],
    })
    expect(res.state).toBe('done')
    expect(res.option).toBe('AI生成内容')
    expect(exec).toHaveBeenCalledTimes(3)
    expect(String(exec.mock.calls[0][0])).toContain('创作声明')
    expect(String(exec.mock.calls[1][0])).toContain('AI生成内容')
    expect(String(exec.mock.calls[1][0])).toContain('.bcc-select-panel li')
  })

  it('已填过（ALREADY）时不再点选，state=already', async () => {
    const { win, ctx, exec } = makeCtx(['ALREADY'])
    const res = await platformsMixin._selectContentDeclaration.call(ctx, win, 'bilibili', {}, {})
    expect(res.state).toBe('already')
    expect(exec).toHaveBeenCalledTimes(1)
  })

  it('页面无该输入框时 state=no-input，不得抛异常打断发布', async () => {
    const { win, ctx } = makeCtx(['NO_INPUT'])
    await expect(platformsMixin._selectContentDeclaration.call(ctx, win, 'bilibili', {}, {})).resolves.toMatchObject({ state: 'no-input' })
  })

  it('选项缺失时 state=option-missing（不能误报 done）', async () => {
    const { win, ctx, exec } = makeCtx(['OPENED', { ok: false }])
    const res = await platformsMixin._selectContentDeclaration.call(ctx, win, 'bilibili', { aiGenerated: true }, {})
    expect(res.state).toBe('option-missing')
    expect(exec).toHaveBeenCalledTimes(2)
  })

  it('选中但未点到确定时 state=option-selected-no-confirm', async () => {
    const { win, ctx } = makeCtx(['OPENED', { ok: true, option: 'AI生成内容' }, false])
    const res = await platformsMixin._selectContentDeclaration.call(ctx, win, 'bilibili', {}, {})
    expect(res.state).toBe('option-selected-no-confirm')
  })

  it('渲染进程报错时降级为 state=error，不向上抛', async () => {
    const { win, ctx } = makeCtx([new Error('Execution was rejected')])
    const res = await platformsMixin._selectContentDeclaration.call(ctx, win, 'bilibili', {}, {})
    expect(res.state).toBe('error')
  })

  it('aiGenerated=false 时目标选项切到非 AI 声明', async () => {
    const { win, ctx, exec } = makeCtx(['OPENED', { ok: true, option: '无需声明' }, true])
    const res = await platformsMixin._selectContentDeclaration.call(ctx, win, 'bilibili', { aiGenerated: false }, {})
    expect(res.state).toBe('done')
    const optCode = String(exec.mock.calls[1][0])
    expect(optCode).toContain('无需声明')
    expect(optCode).not.toContain('AI生成内容')
  })
})

// 选择器候选顺序的数据契约：首候选都是 2026-09 live DOM 实测命中的那个，
// 改动前先拿取证文件对，不得凭直觉重排
describe('rpa-view-platforms — 快手/B站 发布选择器数据契约', () => {
  const { platformSelectors } = require('@multi-publish/rpa-engine')
  const S = platformSelectors.PLATFORM_PUBLISH_SELECTORS

  it('kuaishou：标题与描述共用 #work-description-edit，editor 首候选即它', () => {
    expect(S.kuaishou.editor[0]).toBe('#work-description-edit')
    expect(S.kuaishou.desc_textarea[0]).toBe('#work-description-edit')
  })

  it('kuaishou：publish_btn 首候选必须带 button 标签限定（防提示文案抢中）', () => {
    expect(S.kuaishou.publish_btn[0]).toMatch(/^button:has-text\("发(布|表)"\)$/)
    expect(S.kuaishou.publish_btn[0]).not.toMatch(/^span:/)
  })

  it('bilibili：title_input 含实测命中的 placeholder 约束候选', () => {
    expect(S.bilibili.title_input).toContain('input[placeholder*="标题"]')
    expect(S.bilibili.publish_btn[0]).toContain('立即投稿')
  })

  it('douyin：title_input 末候选兼容 semi-input 的 placeholder 命中', () => {
    expect(S.douyin.title_input).toContain('input[placeholder*="标题"]')
  })
})
