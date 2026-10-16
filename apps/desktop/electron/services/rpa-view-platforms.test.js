// @ts-check
/**
 * RpaViewManager 平台 mixin 结构回归测试
 */
const fs = require('fs')
const platformsMixin = require('./rpa-view-platforms')

// 2026-09-29：rpa-view-platforms.js 两次拆分（rpa-publish-id-extract.js / rpa-view-navigation-helpers.js），
// 2026-10 三次拆分（upload-waiter.js：视频上传等待循环 v4）——
// 结构锁需读「主文件 + 拆分文件」的合并文本，否则被拆走的方法会断锁。
// 2026-10-01：artifact 族再拆出 rpa-view-artifacts.js，同样并入。
function readPlatformsSource () {
  const main = fs.readFileSync(require.resolve('./rpa-view-platforms'), 'utf-8')
  const parts = [main]
  for (const rel of ['./rpa-publish-id-extract', './rpa-view-navigation-helpers', './upload-waiter', './rpa-view-artifacts']) {
    try { parts.push(fs.readFileSync(require.resolve(rel), 'utf-8')) } catch (_) { /* 拆分文件可缺省 */ }
  }
  return parts.join('\n')
}


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
    // 2026-10-12 正文注入契约：可信通道 + 回退通道（`wechat-mp-article` 依赖）
    _insertTextTrusted: vi.fn().mockResolvedValue(true),
    _setElementContentSafe: vi.fn().mockResolvedValue(true),
    _setFileInput: vi.fn().mockResolvedValue(true),
  }
}

/**
 * 按 `wechat-mp-article.js` 的脚本标记分派返回值。
 * 不传 plan 时保持「什么都没找到」的中性默认，使不关心这两段的旧用例行为不变。
 */
function scriptedWechatJavaScript (plan = {}) {
  const coverStates = Array.isArray(plan.coverState) ? plan.coverState.slice() : null
  return vi.fn(async (script) => {
    const s = String(script)
    if (s.includes('/*mpwc-clear*/')) return plan.clear === undefined ? null : plan.clear
    if (s.includes('/*mpwc-read*/')) return plan.read === undefined ? 0 : plan.read
    if (s.includes('/*mpwc-jsapi*/')) return plan.jsapi === undefined ? { ok: false, detail: 'no-jsapi' } : plan.jsapi
    if (s.includes('/*mpwc-paste*/')) return plan.paste === undefined ? { ok: false, detail: 'no-editor' } : plan.paste
    if (s.includes('/*mpwc-cover-state*/')) {
      if (coverStates && coverStates.length) return coverStates.shift()
      return plan.state === undefined ? { preview: false, hasCdn: false, bgUsable: false, imgCount: 0 } : plan.state
    }
    if (s.includes('/*mpwc-cover-inject*/')) return plan.inject === undefined ? true : plan.inject
    if (s.includes('/*mpwc-cover-entry*/')) return { ok: false, detail: 'no-entry' }
    if (s.includes('/*mpwc-cover-menu*/')) return { ok: false, detail: 'no-menu-item' }
    if (s.includes('/*mpwc-cover-inputs*/')) return plan.inputs === undefined ? 1 : plan.inputs
    if (s.includes('/*mpwc-cover-next*/')) return plan.next === undefined ? { ok: false } : plan.next
    if (s.includes('.title-editor__input')) return plan.titleEditor === undefined ? false : plan.titleEditor
    return true
  })
}

describe('rpa-view-platforms — 结构约束', () => {
  it('wechat_mp 发布方法只定义一次，避免 pending stub 覆盖风险', () => {
    const source = readPlatformsSource()
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
    const { win } = createWindow('https://mp.weixin.qq.com/cgi-bin/appmsg?appmsgid=12345&token=123456')
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
    const { win } = createWindow('https://mp.weixin.qq.com/cgi-bin/appmsg?t=media/appmsg_edit&token=123456')
    const context = createWechatContext()

    const result = await platformsMixin._publish_wechat_mp.call(context, win, {})

    expect(result).toEqual(expect.objectContaining({
      success: false,
      platform: 'wechat_mp',
    }))
    expect(result.error).toContain('媒体 ID')
  })

  it('正常保存草稿时返回成功且不进入群发流程', async () => {
    const { win } = createWindow('https://mp.weixin.qq.com/cgi-bin/appmsg?appmsgid=12345&token=123456')
    const context = createWechatContext()

    const result = await platformsMixin._publish_wechat_mp.call(context, win, {})

    expect(result).toEqual(expect.objectContaining({
      success: true,
      platform: 'wechat_mp',
    }))
    // 2026-09-29 起导航两次：首页（token 提取）→ v2 编辑器
    expect(context._navigateAndWait).toHaveBeenCalledTimes(2)
    expect(context._click).toHaveBeenCalledTimes(1)
  })

  it('把保存后 URL 中的媒体 ID 传给群发选择器并成功群发', async () => {
    const { win, executeJavaScript } = createWindow('https://mp.weixin.qq.com/cgi-bin/appmsg?appmsgid=12345&token=123456')
    const context = createWechatContext()

    const result = await platformsMixin._publish_wechat_mp.call(context, win, { massSend: true })

    expect(result.success).toBe(true)
    // 首页 + v2 编辑器 + 群发页 = 3 次导航
    expect(context._navigateAndWait).toHaveBeenCalledTimes(3)
    const massSendScript = executeJavaScript.mock.calls
      .map(([script]) => script)
      .find((script) => script.includes('appmsgid'))
    expect(massSendScript).toContain('[appmsgid=\\"12345\\"]')
    expect(context._click).toHaveBeenCalledWith(win, 'a.btn_masssend, a[data-action="masssend"]')
    expect(context._click).toHaveBeenCalledWith(win, '.dialog_bd_btn a:has-text("确定"), .weui-desktop-btn:has-text("确定")')
  })

  it('群发列表找不到已保存草稿时返回失败', async () => {
    const { win, executeJavaScript } = createWindow('https://mp.weixin.qq.com/cgi-bin/appmsg?appmsgid=12345&token=123456')
    // 调用顺序：群发保护预检（2026-10-12 新增，只在 massSend 时发）→ 登录态检测 → 同意勾选 → 群发列表草稿选择
    executeJavaScript
      .mockResolvedValueOnce('') // 预检：无 wx.cgiData ⇒ 未开启群发保护，放行
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
    const { win } = createWindow('https://mp.weixin.qq.com/cgi-bin/appmsg?appmsgid=12345&token=123456')
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
    const { win } = createWindow('https://mp.weixin.qq.com/cgi-bin/appmsg?appmsgid=12345&token=123456')
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
    expect(result.error).toContain('确认失败')
  })

  // ── 2026-10-12 补强（wechat-mp-api-publish-track）：群发保护预检 + 原文链接尽力透传 ──

  it('群发保护开启时拦在进入编辑器之前，并给出安全中心指引', async () => {
    const { win, executeJavaScript } = createWindow('https://mp.weixin.qq.com/cgi-bin/appmsg?appmsgid=12345&token=123456')
    executeJavaScript.mockImplementation(async (script) => (
      String(script).includes('safecenterstatus') ? 'var wx = {}; wx.cgiData = {"protect_status":1};' : true
    ))
    const context = createWechatContext()

    const result = await platformsMixin._publish_wechat_mp.call(context, win, { massSend: true })

    expect(result).toEqual(expect.objectContaining({ success: false, platform: 'wechat_mp' }))
    expect(String(result.error)).toContain('安全中心')
    expect(String(result.error)).toContain('群发')
    // 只导航了首页，不得进入编辑器（拦在源头，省一次无意义往返）
    expect(context._navigateAndWait).toHaveBeenCalledTimes(1)
    expect(context._click).not.toHaveBeenCalledWith(win, 'a.btn_masssend, a[data-action="masssend"]')
  })

  it('只存草稿（未开群发）时不发群发保护预检请求', async () => {
    const { win, executeJavaScript } = createWindow('https://mp.weixin.qq.com/cgi-bin/appmsg?appmsgid=12345&token=123456')
    const context = createWechatContext()

    await platformsMixin._publish_wechat_mp.call(context, win, {})

    const scripts = executeJavaScript.mock.calls.map(([s]) => String(s))
    expect(scripts.some((s) => s.includes('safecenterstatus'))).toBe(false)
  })

  it('带原文链接时尽力填入（内容脚本含该 URL 且派发事件）', async () => {
    const { win, executeJavaScript } = createWindow('https://mp.weixin.qq.com/cgi-bin/appmsg?appmsgid=12345&token=123456')
    executeJavaScript.mockImplementation(async (script) => (
      String(script).includes('sourceurl') ? 'input#js_source_url' : true
    ))
    const context = createWechatContext()

    await platformsMixin._publish_wechat_mp.call(context, win, { content_source_url: 'https://example.com/src' })

    const hit = executeJavaScript.mock.calls.map(([s]) => String(s)).find((s) => s.includes('https://example.com/src'))
    expect(hit).toBeTruthy()
    expect(hit).toContain('dispatchEvent')
  })

  // ── 2026-09-29 图文发布修复：token 提取 + appmsg_edit_v2（实测旧 URL 无 token 被重定向回首页） ──
  it('先访问首页提取 token，再用 appmsg_edit_v2 带 token 导航编辑器', async () => {
    const executeJavaScript = vi.fn().mockResolvedValue({ hasTimeout: false, hasLoginPrompt: false })
    const win = {
      webContents: {
        getURL: vi.fn()
          .mockReturnValueOnce('https://mp.weixin.qq.com/cgi-bin/home?t=home/index&lang=zh_CN&token=1919993708')
          .mockReturnValue('https://mp.weixin.qq.com/cgi-bin/appmsg?appmsgid=12345&token=1919993708'),
        getTitle: vi.fn().mockReturnValue(''),
        executeJavaScript,
      },
    }
    const context = createWechatContext()

    const result = await platformsMixin._publish_wechat_mp.call(context, win, {})

    expect(result.success).toBe(true)
    // 第一次导航：首页（token 来源）
    expect(context._navigateAndWait).toHaveBeenNthCalledWith(1, win, 'https://mp.weixin.qq.com/', 5000)
    // 第二次导航：v2 编辑器，URL 必须带 token 且用 appmsg_edit_v2
    const secondNav = context._navigateAndWait.mock.calls[1]
    expect(secondNav[0]).toBe(win)
    expect(secondNav[1]).toContain('appmsg_edit_v2')
    expect(secondNav[1]).toContain('token=1919993708')
    expect(secondNav[1]).not.toContain('appmsg_edit&')
  })

  it('首页 URL 无 token 时 fail fast，不盲走旧编辑器 URL', async () => {
    const { win } = createWindow('https://mp.weixin.qq.com/cgi-bin/home?t=home/index&lang=zh_CN')
    const context = createWechatContext()

    const result = await platformsMixin._publish_wechat_mp.call(context, win, {})

    expect(result).toEqual(expect.objectContaining({
      success: false,
      platform: 'wechat_mp',
    }))
    expect(result.error).toContain('token')
    // 只导航了首页一次，没有第二次导航
    expect(context._navigateAndWait).toHaveBeenCalledTimes(1)
  })

  // ── 2026-10-12：正文可信注入 + 封面必传（用户报障「同文案发公众号只有标题」） ──

  const SAVE_BTN_HINT = 'js_sync_save'

  it('正文注入未生效时 fail-closed，且不点保存草稿', async () => {
    const { win } = createWindow('https://mp.weixin.qq.com/cgi-bin/appmsg?appmsgid=12345&token=123456')
    win.webContents.executeJavaScript = scriptedWechatJavaScript({ clear: { found: true, before: 0, cleared: 0 }, read: 0 })
    const context = createWechatContext()

    const result = await platformsMixin._publish_wechat_mp.call(context, win, { title: 'T', content: '正文内容' })

    expect(result).toEqual(expect.objectContaining({ success: false, platform: 'wechat_mp' }))
    expect(result.error).toContain('正文未写入编辑器')
    const saveClicks = context._click.mock.calls.filter(([, sel]) => String(sel).includes(SAVE_BTN_HINT))
    expect(saveClicks).toHaveLength(0)
  })

  it('正文注入生效时走可信通道（_insertTextTrusted），不退回 innerHTML 直写', async () => {
    const { win } = createWindow('https://mp.weixin.qq.com/cgi-bin/appmsg?appmsgid=12345&token=123456')
    win.webContents.executeJavaScript = scriptedWechatJavaScript({ clear: { found: true, before: 0, cleared: 0 }, read: 9 })
    const context = createWechatContext()

    const result = await platformsMixin._publish_wechat_mp.call(context, win, { title: 'T', content: '正文内容' })

    expect(result.success).toBe(true)
    expect(context._insertTextTrusted).toHaveBeenCalledTimes(1)
    expect(context._setElementContentSafe).not.toHaveBeenCalled()
  })

  it('有本地封面时：先上传封面、再点保存草稿（顺序锁）；生效判据是封面 CDN 证据', async () => {
    const fs = require('fs')
    const os = require('os')
    const path = require('path')
    const coverPath = path.join(os.tmpdir(), 'mp-wechat-mixin-cover.png')
    fs.mkdirSync(path.dirname(coverPath), { recursive: true })
    fs.writeFileSync(coverPath, Buffer.from([0x89, 0x50, 0x4e, 0x47]))

    const { win } = createWindow('https://mp.weixin.qq.com/cgi-bin/appmsg?appmsgid=12345&token=123456')
    win.webContents.executeJavaScript = scriptedWechatJavaScript({
      coverState: [
        { preview: false, hasCdn: false, bgUsable: false, imgCount: 0 },
        { preview: true, hasCdn: true, bgUsable: true, imgCount: 0 },
      ],
      next: { ok: true, label: '确认' },
    })
    const clicked = []
    const context = createWechatContext()
    context._click.mockImplementation(async (_w, sel) => { clicked.push(String(sel)); return true })

    const result = await platformsMixin._publish_wechat_mp.call(context, win, { cover_path: coverPath })

    expect(result.success).toBe(true)
    const coverIdx = clicked.findIndex(sel => sel.includes('cover'))
    const saveIdx = clicked.findIndex(sel => sel.includes(SAVE_BTN_HINT))
    expect(coverIdx).toBeGreaterThanOrEqual(0)
    expect(saveIdx).toBeGreaterThan(coverIdx)
  })

  it('有本地封面但拿不到生效证据时 fail-closed，且不点保存草稿', async () => {
    const fs = require('fs')
    const os = require('os')
    const path = require('path')
    const coverPath = path.join(os.tmpdir(), 'mp-wechat-mixin-cover-fail.png')
    fs.mkdirSync(path.dirname(coverPath), { recursive: true })
    fs.writeFileSync(coverPath, Buffer.from([0x89, 0x50, 0x4e, 0x47]))

    const { win } = createWindow('https://mp.weixin.qq.com/cgi-bin/appmsg?appmsgid=12345&token=123456')
    // 恒无证据：封面 CDN / 预览背景图 / img 数三条判据全不成立
    win.webContents.executeJavaScript = scriptedWechatJavaScript({
      state: { preview: false, hasCdn: false, bgUsable: false, imgCount: 0 },
    })
    const context = createWechatContext()

    const result = await platformsMixin._publish_wechat_mp.call(context, win, { cover_path: coverPath })

    expect(result).toEqual(expect.objectContaining({ success: false, platform: 'wechat_mp' }))
    expect(result.error).toContain('封面图上传未取得生效证据')
    const saveClicks = context._click.mock.calls.filter(([, sel]) => String(sel).includes(SAVE_BTN_HINT))
    expect(saveClicks).toHaveLength(0)
  })

  it('封面是网络地址时给出可操作原因（DOM 轨只能注入本地文件）', async () => {
    const { win } = createWindow('https://mp.weixin.qq.com/cgi-bin/appmsg?appmsgid=12345&token=123456')
    win.webContents.executeJavaScript = scriptedWechatJavaScript()
    const context = createWechatContext()

    const result = await platformsMixin._publish_wechat_mp.call(context, win, { cover_path: 'https://example.com/c.png' })

    expect(result).toEqual(expect.objectContaining({ success: false, platform: 'wechat_mp' }))
    expect(result.error).toContain('本地图片文件')
  })

  it('无封面时行为与改造前一致：不点封面入口、不额外调用 JS（既有断言不得破）', async () => {
    const { win } = createWindow('https://mp.weixin.qq.com/cgi-bin/appmsg?appmsgid=12345&token=123456')
    const context = createWechatContext()

    const result = await platformsMixin._publish_wechat_mp.call(context, win, {})

    expect(result.success).toBe(true)
    // 只有一次点击（保存草稿），没有封面入口点击
    expect(context._click).toHaveBeenCalledTimes(1)
    const coverClicks = context._click.mock.calls.filter(([, sel]) => String(sel).includes('cover'))
    expect(coverClicks).toHaveLength(0)
  })

  it('快手图文模式显式关闭封面通道（自动封面同时落 cover_path 后不得重复插图）', () => {
    const source = fs.readFileSync(require.resolve('./rpa-view-platforms'), 'utf-8')
    const start = source.indexOf('async _publish_kuaishou')
    expect(start).toBeGreaterThan(-1)
    const body = source.slice(start, source.indexOf('async _publish_toutiao', start))
    expect(body).toContain('cover_input: []')
    // 必须是图文模式那支；视频模式不得被顺手关掉
    expect(body).toMatch(/isImageMode[\s\S]*cover_input: \[\]/)
  })
})

describe('rpa-view-platforms — 知乎发布（2026-09-29 图文修复）', () => {
  function createZhihuContext () {
    return {
      _emitProgress: vi.fn(),
      _navigateAndWait: vi.fn().mockResolvedValue(undefined),
      _waitForElement: vi.fn().mockResolvedValue(true),
      _click: vi.fn().mockResolvedValue(true),
      _sleep: vi.fn().mockResolvedValue(undefined),
      _setElementContentSafe: vi.fn().mockResolvedValue(undefined),
      _insertTextTrusted: vi.fn().mockResolvedValue(true),
    }
  }

  function createZhihuWindow (url, executeJavaScriptImpl) {
    const executeJavaScript = executeJavaScriptImpl || vi.fn().mockResolvedValue(true)
    return {
      win: {
        webContents: {
          getURL: vi.fn().mockReturnValue(url),
          getTitle: vi.fn().mockReturnValue(''),
          executeJavaScript,
        },
      },
      executeJavaScript,
    }
  }

  it('导航到 zhuanlan.zhihu.com/write（实测 www.zhihu.com/creator/write 选择器失配）', async () => {
    const { win } = createZhihuWindow('https://zhuanlan.zhihu.com/write')
    const context = createZhihuContext()

    await platformsMixin._publish_zhihu.call(context, win, { title: '测试标题', content: '测试正文' })

    expect(context._navigateAndWait).toHaveBeenCalledWith(win, 'https://zhuanlan.zhihu.com/write')
    expect(context._navigateAndWait).toHaveBeenCalledTimes(1)
  })

  it('标题填充写入 wrapper 内部 textarea 的 value（原生 setter），不是 label textContent', async () => {
    const { win, executeJavaScript } = createZhihuWindow('https://zhuanlan.zhihu.com/write')
    const context = createZhihuContext()

    await platformsMixin._publish_zhihu.call(context, win, { title: '知乎标题测试', content: '正文' })

    // 标题填充脚本必须：① 定位 wrapper 内部 textarea/input ② 用原生 value setter ③ 派发 input 事件
    const titleScript = executeJavaScript.mock.calls
      .map(([script]) => script)
      .find(script => script.includes('知乎标题测试') && script.includes('textarea'))
    expect(titleScript).toBeTruthy()
    expect(titleScript).toContain('getOwnPropertyDescriptor')
    expect(titleScript).toContain("new Event('input'")
  })

  it('编辑器等待选择器含 public-DraftEditor-content（实测命中）', async () => {
    const { win } = createZhihuWindow('https://zhuanlan.zhihu.com/write')
    const context = createZhihuContext()

    await platformsMixin._publish_zhihu.call(context, win, { title: 'T', content: 'C' })

    const editorWait = context._waitForElement.mock.calls
      .map(([, sel]) => String(sel))
      .find(sel => sel.includes('public-DraftEditor-content'))
    expect(editorWait).toBeTruthy()
  })

  it('正文填充走 CDP 可信注入（_insertTextTrusted），不用 innerHTML 直写容器', async () => {
    const { win, executeJavaScript } = createZhihuWindow('https://zhuanlan.zhihu.com/write')
    const context = createZhihuContext()
    // HTML→纯文本转换脚本（含 DOMParser）返回转换后文本；其余调用（focus 等）返回 true
    executeJavaScript.mockImplementation((script) => {
      if (String(script).includes('DOMParser')) return Promise.resolve('HTML转换后的纯文本')
      return Promise.resolve(true)
    })

    await platformsMixin._publish_zhihu.call(context, win, { title: 'T', content: '<p>正文内容测试</p>' })

    // 主路径：可信注入被调用且收到 HTML 转换后的纯文本（不把 <p> 标签注入纯文本编辑器）
    expect(context._insertTextTrusted).toHaveBeenCalledWith(win, 'HTML转换后的纯文本')
    // innerHTML 直写不再走主路径（Draft.js 不接受，实测发布空文）
    expect(context._setElementContentSafe).not.toHaveBeenCalled()
  })

  it('可信注入失败时回退 innerHTML（不静默丢内容）', async () => {
    const { win, executeJavaScript } = createZhihuWindow('https://zhuanlan.zhihu.com/write')
    const context = createZhihuContext()
    context._insertTextTrusted.mockResolvedValueOnce(false)
    executeJavaScript.mockImplementation((script) => {
      if (String(script).includes('DOMParser')) return Promise.resolve('回退纯文本')
      return Promise.resolve(true)
    })

    await platformsMixin._publish_zhihu.call(context, win, { title: 'T', content: '回退内容' })

    expect(context._insertTextTrusted).toHaveBeenCalled()
    expect(context._setElementContentSafe).toHaveBeenCalled()
  })

  it('★ 草稿编辑页 URL 不得判成功（2026-10-15 假发布修复：/p/<id>/edit 是草稿页）', async () => {
    // 旧测试用同一形态的 URL 断言 success=true —— 那是把缺陷锁成契约（见 BUGFIX 文档逃逸链）。
    const { win } = createZhihuWindow('https://zhuanlan.zhihu.com/p/2094165753981309631/edit')
    const context = createZhihuContext()

    const result = await platformsMixin._publish_zhihu.call(context, win, { title: 'T', content: 'C' })

    expect(result.success).toBe(false)
    expect(String(result.error)).toContain('not confirmed')
    expect(result.url).toContain('/edit')
  })
})

describe('rpa-view-helpers — _fillInput 原型选择（2026-09-29 Illegal invocation 修复）', () => {
  it('value setter 按元素 tagName 选原型（TEXTAREA 不得用 HTMLInputElement 的 setter）', async () => {
    // B1 拆分（debt-guard 新代码阻断门禁）：原生 value-set 通道下沉至
    // stealth/rpa-behavior-mixin.js 的 _fillViaDriver；helpers 侧 _fillInput
    // 只留「委托 + 读回判据」。故结构锁分两侧断言。
    const source = fs.readFileSync(require.resolve('./stealth/rpa-behavior-mixin'), 'utf-8')
    const fillBody = source.slice(source.indexOf('async _fillViaDriver'), source.indexOf('async _clickViaDriver'))
    expect(fillBody).not.toBe('')
    // 结构锁：必须先按 tagName 分流原型，再取 descriptor
    expect(fillBody).toMatch(/tagName\s*===\s*['"]TEXTAREA['"]/)
    // 反证旧写法：Input 原型 || Textarea 原型 的短路链不得回归
    expect(fillBody).not.toMatch(/HTMLInputElement\.prototype,\s*["']value["']\)\?\.set\s*\|\|\s*Object\.getOwnPropertyDescriptor\(window\.HTMLTextAreaElement/)
    // helpers 侧仍持有读回判据（拆出去的是取值通道，不是判据）——否则「填充未生效」
    // 会被当成成功，正是 2026-09-30 修掉的那个缺陷
    const helpersSource = fs.readFileSync(require.resolve('./rpa-view-helpers'), 'utf-8')
    const helpersBody = helpersSource.slice(helpersSource.indexOf('async _fillInput'), helpersSource.indexOf('async _click'))
    expect(helpersBody).toContain('_fillViaDriver')
    expect(helpersBody).toContain('readBack')
    expect(helpersBody).toContain('fill not applied')
  })
})

describe('rpa-view-platforms — 图文模式（2026-09-29：双入口 URL + 图片上传）', () => {
  function createImageContext () {
    return {
      _emitProgress: vi.fn(),
      _navigateAndWait: vi.fn().mockResolvedValue(undefined),
      _waitForElement: vi.fn().mockResolvedValue(true),
      _setFileInput: vi.fn().mockResolvedValue(true),
      // 2026-09-30：图片上传通道改为「拖拽区优先，input 回退」；此 context 模拟
      // **无拖拽容器**的平台（除快手外），故返回 false 让流程走 input 注入。
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
      _publish_generic: vi.fn().mockResolvedValue({ success: true, platform: 'test' }),
      _resolveSelector: vi.fn().mockResolvedValue('input[type="file"]'),
    }
  }

  function createWindow (url) {
    const executeJavaScript = vi.fn().mockResolvedValue(true)
    return {
      win: { webContents: { getURL: vi.fn().mockReturnValue(url), getTitle: vi.fn().mockReturnValue(''), executeJavaScript } },
      executeJavaScript,
    }
  }

  it('抖音图文模式：无视频时导航 default-tab=3 并上传首图', async () => {
    const { win } = createWindow('https://creator.douyin.com/creator-micro/content/upload?default-tab=3')
    const context = createImageContext()

    await platformsMixin._publish_douyin.call(context, win, {
      title: '图文标题', content: '内容', images: ['C:/tmp/cover.png'],
    })

    expect(context._navigateAndWait).toHaveBeenCalledWith(win, expect.stringContaining('default-tab=3'))
    expect(context._setFileInput).toHaveBeenCalledWith(win, 'C:/tmp/cover.png')
  })

  it('抖音视频模式：保持原上传页 URL，不上传图片', async () => {
    const { win } = createWindow('https://creator.douyin.com/creator-micro/content/upload')
    const context = createImageContext()

    await platformsMixin._publish_douyin.call(context, win, {
      title: '视频标题', video_path: 'D:/video.mp4', images: ['C:/tmp/cover.png'],
    })

    expect(context._navigateAndWait).toHaveBeenCalledWith(win, 'https://creator.douyin.com/creator-micro/content/upload')
    expect(context._setFileInput).toHaveBeenCalledWith(win, 'D:/video.mp4')
    expect(context._setFileInput).not.toHaveBeenCalledWith(win, 'C:/tmp/cover.png')
  })

  it('快手图文模式：走 tabType=2 URL（getPublishUrl 单一来源）', async () => {
    const { win } = createWindow('https://cp.kuaishou.com/article/publish/video?tabType=2')
    const context = createImageContext()

    await platformsMixin._publish_kuaishou.call(context, win, { title: 'T', content: 'C', images: ['C:/img.png'] })

    // 委托 generic 且传入图文 URL（tabType=2）
    expect(context._publish_generic).toHaveBeenCalledWith(
      win, expect.objectContaining({ images: ['C:/img.png'] }), 'kuaishou',
      expect.objectContaining({ publish_url: expect.stringContaining('tabType=2') }),
    )
  })

  it('小红书图文模式：preFill 挂 switchImageTab（先切图文 tab 再上传）', async () => {
    const { win } = createWindow('https://creator.xiaohongshu.com/publish/publish?from=menu')
    const context = createImageContext()

    await platformsMixin._publish_xiaohongshu.call(context, win, { title: 'T', content: 'C', images: ['C:/img.png'] })

    expect(context._publish_generic).toHaveBeenCalledWith(
      win, expect.anything(), 'xiaohongshu',
      expect.objectContaining({ preFill: 'switchImageTab' }),
    )
  })

  // 2026-09-30 快手取证：快手图文的 input[type=file] 两条注入路径都失效（CDP 静默清空 /
  // DataTransfer 赋值归零），唯一通道是向 dragger-content 派发 DragEvent('drop')。
  it('快手图文模式：给出 drag_area 选择器（拖拽上传通道）', async () => {
    const { win } = createWindow('https://cp.kuaishou.com/article/publish/video?tabType=2')
    const context = createImageContext()

    await platformsMixin._publish_kuaishou.call(context, win, { title: 'T', content: 'C', images: ['C:/img.png'] })

    expect(context._publish_generic).toHaveBeenCalledWith(
      win, expect.anything(), 'kuaishou',
      expect.objectContaining({
        selectors: expect.objectContaining({
          drag_area: expect.stringContaining('dragger-content'),
        }),
      }),
    )
  })

  it('有拖拽容器时优先走拖拽注入（不再调 _setFileInput）', async () => {
    const { win } = createWindow('https://cp.kuaishou.com/article/publish/video?tabType=2')
    const context = createImageContext()
    context._dropFilesToDragArea.mockResolvedValueOnce(true) // 模拟拖拽成功
    // 直接跑 generic 的图片上传分支
    await platformsMixin._publish_generic.call(
      { ...context, ...platformsMixin },
      win,
      { title: 'T', content: 'C', images: ['C:/img.png'] },
      'testplatform',
      { ...context._getPlatformConfig(), selectors: { ...context._getPlatformConfig().selectors, drag_area: 'div[class*="dragger-content"]' } },
    )
    expect(context._dropFilesToDragArea).toHaveBeenCalled()
    expect(context._setFileInput).not.toHaveBeenCalled()
  })

  // 2026-10-10 硬约束收紧：小红书视频不再走通用发布流程（终点是点「发布」），改为 fail-closed。
  // 旧断言（无 preFill + target=video 交给 generic）正是「视频可真实发布」的契约，已被用户要求推翻。
  it('小红书视频模式：fail-closed 拒绝，绝不进入 generic（不得真实发布）', async () => {
    const { win } = createWindow('https://creator.xiaohongshu.com/publish/publish?from=menu&target=video')
    const context = createImageContext()

    const result = await platformsMixin._publish_xiaohongshu.call(context, win, { title: 'T', video_path: 'D:/v.mp4' })

    expect(context._publish_generic).not.toHaveBeenCalled()
    expect(result).toMatchObject({ success: false, platform: 'xiaohongshu', errorCode: 'XHS_VIDEO_DRAFT_UNSUPPORTED' })
  })

  it('generic 图片上传：无视频有图时上传首图（image_upload 字段）', async () => {
    const { win } = createWindow('https://example.com/publish')
    const context = createImageContext()
    // 不 mock _publish_generic——直接跑 generic 验证图片上传分支
    const realGeneric = platformsMixin._publish_generic.bind({ ...context, ...platformsMixin })

    await platformsMixin._publish_generic.call(context, win, {
      title: 'T', content: 'C', images: ['C:/img1.png', 'C:/img2.png'],
    }, 'testplatform', context._getPlatformConfig())

    expect(context._setFileInput).toHaveBeenCalledWith(win, 'C:/img1.png', 'input[type="file"]')
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

  // 2026-10-06 B 站作品标识装配锁（docs/PRD-BILIBILI-PUBLISH-ID-EXTRACT-2026-10-06.md §五 A11）
  // 纯函数级用例只证明「能提出 id」，证明不了它真的变成 finish() 的 postId。
  it('B 站：作品页 URL 承载 bvid 时发布判成功且 postId 为 bvid', async () => {
    const workUrl = 'https://www.bilibili.com/video/BV1xx411c79D/'
    const executeJavaScript = vi.fn().mockResolvedValue({ url: workUrl, text: '', storage: {}, links: [], buttons: [] })
    const context = createVerifyContext(executeJavaScript)
    const networkCapture = { evidence: [], stop: vi.fn().mockResolvedValue([]) }
    const result = await platformsMixin._verifyPublishSuccess.call(context, {
      webContents: { getURL: vi.fn().mockReturnValue(workUrl), executeJavaScript },
    }, 'bilibili', { success_mode: 'url', publish_url: 'https://member.bilibili.com/platform/upload/video/frame' }, null, networkCapture)

    expect(result).toMatchObject({ success: true, postId: 'BV1xx411c79D' })
  })

  it('B 站：投稿页停在 frame 时由提交响应体证据承载 bvid，不得取成 frame', async () => {
    const frameUrl = 'https://member.bilibili.com/platform/upload/video/frame'
    const executeJavaScript = vi.fn().mockResolvedValue({ url: frameUrl, text: '发布成功', storage: {}, links: [], buttons: [] })
    const context = createVerifyContext(executeJavaScript, { conditionResult: true })
    const networkCapture = {
      evidence: [{ publishIds: ['BV1xx411c79D'] }],
      stop: vi.fn().mockResolvedValue([{ endpoint: 'https://member.bilibili.com/x/video/add', status: 200, mimeType: 'application/json' }]),
    }
    const result = await platformsMixin._verifyPublishSuccess.call(context, {
      webContents: { getURL: vi.fn().mockReturnValue(frameUrl), executeJavaScript },
    }, 'bilibili', { success_mode: 'dom', success_selector: '.success', publish_url: frameUrl }, null, networkCapture)

    expect(result).toMatchObject({ success: true, postId: 'BV1xx411c79D' })
    expect(result.postId).not.toBe('frame')
  })

  it('B 站负控：既无证据也无作品页 URL 时仍判失败（不得凭投稿页造 id）', async () => {
    const frameUrl = 'https://member.bilibili.com/platform/upload/video/frame?bvid=&aid='
    const executeJavaScript = vi.fn().mockResolvedValue({ url: frameUrl, text: '发布成功', storage: {}, links: [], buttons: [] })
    const context = createVerifyContext(executeJavaScript, { conditionResult: true })
    const networkCapture = { evidence: [], stop: vi.fn().mockResolvedValue([]) }
    const result = await platformsMixin._verifyPublishSuccess.call(context, {
      webContents: { getURL: vi.fn().mockReturnValue(frameUrl), executeJavaScript },
    }, 'bilibili', { success_mode: 'dom', success_selector: '.success', publish_url: 'https://member.bilibili.com/platform/upload/video/frame' }, null, networkCapture)

    expect(result.success).toBe(false)
    expect(result.error).toContain('平台作品 ID')
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
    const source = readPlatformsSource()
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
    const source = readPlatformsSource()
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
    const source = readPlatformsSource()
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
    const source = readPlatformsSource()
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
    const source = readPlatformsSource()
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
    // 2026-10-08 注册表驱动（publish-capability-registry）：快手是无标题平台，
    // title_input 候选不再被解析（旧隐式回退靠选择器解析失败，白等 10s 超时）；
    // 标题直接经编辑器合并路径写入描述首行。
    expect(context._waitForElement.mock.calls.map((c) => c[1])).not.toContain('input[placeholder*="标题"]')
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

  it('无标题平台（weibo）携带标题时不解析 title_input，标题合并进编辑器描述首行', async () => {
    const context = createGenericContext(['.publisher_text textarea'])
    const weiboConfig = {
      publish_url: 'https://weibo.com/upload',
      has_api: false,
      success_patterns: [],
      selectors: {
        // 选择器表里存在 title_input 候选（历史遗留），但注册表判定 weibo 无标题，
        // 必须被显式跳过——不允许再靠解析失败隐式回退。
        title_input: ['input[placeholder*="标题"]'],
        content_textarea: ['.publisher_text textarea'],
        publish_btn: ['button:has-text("发布")'],
      },
    }
    await platformsMixin._publish_generic.call(context, win, { title: '标题A', content: '正文B' }, 'weibo', weiboConfig)

    expect(context._waitForElement.mock.calls.map((c) => c[1])).not.toContain('input[placeholder*="标题"]')
    const editorCalls = context._fillInput.mock.calls.filter(([, sel]) => sel === '.publisher_text textarea')
    expect(editorCalls.length).toBeGreaterThan(0)
    const written = String(editorCalls[0][2])
    expect(written).toContain('标题A')
    expect(written.indexOf('标题A')).toBeLessThan(written.indexOf('正文B'))
  })

  it('无标题平台（instagram）携带标题时同样跳过 title_input（CCG codex Info3：DOM-only 平台行为锁）', async () => {
    const context = createGenericContext(['[aria-label*="caption"] textarea'])
    const igConfig = {
      publish_url: 'https://www.instagram.com/',
      has_api: false,
      success_patterns: [],
      selectors: {
        title_input: ['input[placeholder*="标题"]'],
        caption_textarea: ['[aria-label*="caption"] textarea'],
        publish_btn: ['button:has-text("分享")'],
      },
    }
    await platformsMixin._publish_generic.call(context, win, { title: '标题A', content: '正文B' }, 'instagram', igConfig)

    expect(context._waitForElement.mock.calls.map((c) => c[1])).not.toContain('input[placeholder*="标题"]')
    const editorCalls = context._fillInput.mock.calls.filter(([, sel]) => sel === '[aria-label*="caption"] textarea')
    expect(editorCalls.length).toBeGreaterThan(0)
    const written = String(editorCalls[0][2])
    expect(written).toContain('标题A')
    expect(written.indexOf('标题A')).toBeLessThan(written.indexOf('正文B'))
  })

  it('结构锁：_publish_generic 以注册表 isNoTitlePlatform 守卫 title_input 解析', () => {
    const body = getGenericBody()
    const guardIdx = body.indexOf('isNoTitlePlatform(platform)')
    const resolveIdx = body.indexOf('await this._resolveSelector(win, sel.title_input')
    expect(guardIdx).toBeGreaterThan(-1)
    expect(resolveIdx).toBeGreaterThan(-1)
    // 守卫必须出现在 title_input 解析之前
    expect(guardIdx).toBeLessThan(resolveIdx)
  })

  it('上传完成判定：含“上传中/剩余时间/百分比未满”负向信号，默认预算 ≥15 分钟', () => {
    const source = readPlatformsSource()
    const start = source.indexOf('async _waitForVideoUploadComplete')
    const body = source.slice(start, source.indexOf('\n  // ========== ', start + 10))
    expect(body).toMatch(/上传中/)
    expect(body).toMatch(/剩余时间|转码中/)
    expect(body).toMatch(/100/)
    expect(Number((body.match(/timeoutMs \|\| (\d+)/) || [])[1])).toBeGreaterThanOrEqual(900000)
  })

  // 2026-10 三次拆分（upload-waiter.js）：等待循环从 rpa-view-navigation-helpers.js
  // 下沉后必须仍由 Object.assign 合回 mixin，否则 this._waitForVideoUploadComplete 为 undefined
  // （抖音/通用链路直接 TypeError）——结构锁只验源码文本，验不到接线，故补此断言。
  it('三次拆分接线：upload-waiter mixin 已合入 platformsMixin', () => {
    expect(typeof platformsMixin._waitForVideoUploadComplete).toBe('function')
    expect(typeof platformsMixin._probeUploadSignal).toBe('function')
    expect(String(platformsMixin._waitForVideoUploadComplete)).toContain('timeoutMs || 900000')
  })

  it('douyin 专用链路也先清理引导遮罩（实测页面带“我知道了”）', () => {
    const source = readPlatformsSource()
    const start = source.indexOf('async _publish_douyin')
    const body = source.slice(start, source.indexOf('\n  // ========== ', start + 10))
    expect(body).toContain('_dismissPostNavDialogs')
  })

  // B站 live DOM（d5-bilibili.json）：`input.bcc-select-input-inner`
  // 占位「请选择符合您视频内容的创作声明」是带 * 的必填项，不选会被服务端拒；
  // 同时风控短信弹窗会盖住投稿区。两条都必须处理才能把 RPA 兜底链路跑完。
  it('_prepBilibili：先选创作声明并清理短信验证弹窗', () => {
    const source = readPlatformsSource()
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

  it('kuaishou：publish_btn 首候选为活体实证的底栏提交钮 div:has-text("发布")（2026-09-28 D2 二轮取证定案）', () => {
    // 二轮活体取证（发布流实测 + 账号标签注入探测）：真提交钮是底栏 <div>发布</div>
    // （裸 div，全页唯一直接文本为「发布」的元素，兄弟 <div>取消</div>）。
    // 一轮锁「span:has-text("立即发布")」误把发布时间单选项当提交钮（活体点击点错对象
    // responses=0）；解析器 exactLeaf 层使 div:has-text("发布") 唯一命中真钮。
    expect(S.kuaishou.publish_btn[0]).toBe('div:has-text("发布")')
    // button 标签限定候选保留在兜底序列（页面改版回退路径）
    expect(S.kuaishou.publish_btn).toContain('button:has-text("发布")')
    // 单选项诱饵必须移除（点击只切换定时模式，不触发发布）
    expect(S.kuaishou.publish_btn).not.toContain('span:has-text("立即发布")')
  })

  it('bilibili：title_input 含实测命中的 placeholder 约束候选', () => {
    expect(S.bilibili.title_input).toContain('input[placeholder*="标题"]')
    expect(S.bilibili.publish_btn[0]).toContain('立即投稿')
  })

  it('douyin：title_input 末候选兼容 semi-input 的 placeholder 命中', () => {
    expect(S.douyin.title_input).toContain('input[placeholder*="标题"]')
  })
})

// 2026-10-04 publish-throughput-optimization A2（01-docs/PRD-PUBLISH-THROUGHPUT-OPTIMIZATION-2026-10-04）：
// 抖音图文链 4 处固定 sleep 是无判据纯叠加（表单就绪轮询已存在），替换为事件驱动等待。
// 同族反模式先例：url-collector-content-ready.test.js 防复发静态锁 + upload-waiter.js v4 视频上传自适应轮询。
describe('rpa-view-platforms — douyin 图文事件驱动等待（A2：去固定 sleep）', () => {
  function getDouyinBody () {
    const source = readPlatformsSource()
    const start = source.indexOf('async _publish_douyin')
    const end = source.indexOf('\n  // ========== ', start + 10)
    return source.slice(start, end > 0 ? end : undefined)
  }

  // 本 describe 内的局部 helper（作用域隔离，与上方 describe 的同名 helper 无关）
  function localWindow (url) {
    return {
      win: { webContents: { getURL: vi.fn().mockReturnValue(url), getTitle: vi.fn().mockReturnValue(''), executeJavaScript: vi.fn().mockResolvedValue(true) } },
    }
  }

  function localImageContext () {
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
      readVideoFileBytes: vi.fn(() => 0),
    }
  }

  it('防复发静态锁：_publish_douyin 图文段不再含固定 sleep（4000 / tag 1000 / 封面 1000+2000 / 兜底 5000）', () => {
    const body = getDouyinBody()
    // 图片上传后的 4s 固定等待（表单就绪轮询已覆盖，纯叠加）
    expect(body).not.toContain('await this._sleep(4000)')
    // tag 循环内的 1s 固定等待（改为 chip 就绪轮询）
    expect(body).not.toContain("await this._sleep(1000)\n        } catch(e) { log.warn('RpaView','douyin tag: '")
    // 封面上传的 1s+2s 固定等待（改为缩略图基线轮询）
    expect(body).not.toContain('await this._sleep(1000);await this._setFileInput(win,article.cover_path);await this._sleep(2000)')
    // 提交兜底的 5s 固定等待（改为 URL 轮询）
    expect(body).not.toContain('await this._sleep(5000)')
  })

  it('tag 注入后就绪信号为 tag chip 出现（_waitForTagChip helper，判据下沉 navigation-helpers）而非固定等待', () => {
    const body = getDouyinBody()
    const tagIdx = body.indexOf("'adding tags...'")
    expect(tagIdx).toBeGreaterThan(-1)
    const tagSection = body.slice(tagIdx, body.indexOf("'publishing...'", tagIdx))
    // 判据实现下沉到 rpa-view-navigation-helpers（行数门禁），调用点锁 helper 名
    expect(tagSection).toContain('_waitForTagChip')
    // helper 本体必须含 chip 文本匹配判据（不能是恒真条件）
    const navSrc = readPlatformsSource()
    expect(navSrc).toMatch(/_waitForTagChip\s*\(/)
    expect(navSrc).toMatch(/innerText/)
  })

  it('封面注入后就绪信号为缩略图基线递增（_waitForThumbnailIncrease helper，头条 _uploadToutiaoCover 同款判据）', () => {
    const body = getDouyinBody()
    const coverIdx = body.indexOf("'uploading cover...'")
    expect(coverIdx).toBeGreaterThan(-1)
    const coverSection = body.slice(coverIdx, body.indexOf("'adding tags...'", coverIdx))
    // 判据实现下沉到 rpa-view-navigation-helpers（行数门禁），调用点锁 helper 名
    expect(coverSection).toContain('_waitForThumbnailIncrease')
    // helper 本体必须含基线计数判据（querySelectorAll("img").length 递增）
    const navSrc = readPlatformsSource()
    expect(navSrc).toMatch(/querySelectorAll\("img"\)\.length/)
  })

  it('提交兜底为 URL 轮询（_waitForSuccessNavigation helper，多次短间隔）而非单次 sleep+单次查询', () => {
    const body = getDouyinBody()
    const publishIdx = body.indexOf("'publishing...'")
    expect(publishIdx).toBeGreaterThan(-1)
    const publishSection = body.slice(publishIdx)
    expect(publishSection).not.toContain('await this._sleep(5000)')
    // 判据实现下沉 navigation-helpers（行数门禁），调用点锁 helper 名 + 短超时参数
    expect(publishSection).toContain('_waitForSuccessNavigation')
    const navSrc = readPlatformsSource()
    expect(navSrc).toMatch(/_waitForSuccessNavigation\s*\(/)
    expect(navSrc).toMatch(/getURL\(\)/)
  })

  // 行为锁：图片上传成功后直接进入表单就绪等待（原 4s sleep 删除后调用序不变）
  it('抖音图文：上传成功后表单就绪等待是下一个等待动作（无中间固定等待）', async () => {
    const { win } = localWindow('https://creator.douyin.com/creator-micro/content/upload?default-tab=3')
    const context = localImageContext()
    const waits = []
    context._waitForCondition.mockImplementation(async (_w, fn, timeout) => {
      waits.push('condition:' + timeout)
      return true
    })
    context._sleep.mockImplementation(async (ms) => {
      waits.push('sleep:' + ms)
    })

    await platformsMixin._publish_douyin.call(context, win, {
      title: '图文标题', content: '内容', images: ['C:/tmp/cover.png'],
    })

    // 上传成功（uploaded=true）到表单就绪之间不得有 sleep
    const uploadIdx = waits.findIndex(w => w.startsWith('condition'))
    expect(uploadIdx).toBeGreaterThanOrEqual(0)
    // 全流程无 4000ms 固定等待
    expect(waits).not.toContain('sleep:4000')
  })

  it('抖音图文：tag 超时不失败，继续提交（降级路径保留）', async () => {
    const { win } = localWindow('https://creator.douyin.com/creator-micro/content/upload?default-tab=3')
    const context = localImageContext()
    // 表单就绪 true，tag chip 就绪 false（超时），提交响应 null → URL 判定
    context._waitForCondition.mockImplementation(async (_w, fn) => {
      const src = String(fn)
      if (src.includes('querySelectorAll') && src.includes('tag')) return false
      return true
    })
    win.webContents.executeJavaScript.mockResolvedValue(null)

    const result = await platformsMixin._publish_douyin.call(context, win, {
      title: '图文标题', content: '内容', images: ['C:/tmp/cover.png'], tags: ['测试标签'],
    })

    // tag 超时不得导致整体失败
    expect(result.success).toBeDefined()
    expect(result.error === undefined || !String(result.error).includes('tag')).toBe(true)
  })

  it('抖音图文：封面超时走降级（warn 后继续提交）', async () => {
    const { win } = localWindow('https://creator.douyin.com/creator-micro/content/upload?default-tab=3')
    const context = localImageContext()
    // 封面缩略图等待始终超时
    context._waitForCondition.mockImplementation(async (_w, fn) => {
      const src = String(fn)
      if (src.includes("querySelectorAll(\"img\")")) return false
      return true
    })
    win.webContents.executeJavaScript.mockResolvedValue(null)

    const result = await platformsMixin._publish_douyin.call(context, win, {
      title: '图文标题', content: '内容', images: ['C:/tmp/cover.png'], cover_path: 'C:/tmp/c.png',
    })

    expect(result.success).toBeDefined()
    expect(result.error === undefined || !String(result.error).includes('cover')).toBe(true)
  })
})
// CCG 第三/四轮 i2（upheld）：本文件曾自写两轴合取，与产品侧 isApiTrack 在 publishMode
// 缺省时给出**相反**结论。现在必须是**直接调用单一来源**。判据埋在 _publish_generic 的
// 真实发布链里，行为级无真实样本 ⇒ 用源码结构锁；假过风险由变异反证兜住（退回本地合取 ⇒ 红）。
// 全平台一致性与接线锁见 packages/api-publish-engine/test/publish-mode-config.test.js，
// 完整理由见 openspec/records/p3-residual-criteria.md。
describe('rpa-view-platforms — API 响应等待的判据来自单一来源（CCG i2 结构锁）', () => {
  const fs = require('node:fs')
  const path = require('node:path')

  it('必须调用产品侧 isApiTrack，且不得本地复写合取', () => {
    const src = fs.readFileSync(path.join(__dirname, 'rpa-view-platforms.js'), 'utf8')
    expect(src, '必须 require 产品侧单一来源')
      .toMatch(/require\(['\"]@multi-publish\/api-publish-engine\/src\/api-router['\"]\)/)
    expect(src, '等 API 响应的判据必须真的调用 isApiTrack(...)').toMatch(/isApiTrack\(config\)/)
    // 不得本地复写合取（能力轴与轨道轴比较在同一句）；正则用拼接，防本文件自指
    const capRe = new RegExp('has' + '_api')
    const trkRe = new RegExp('publish' + 'Mode' + '\\s*(===|!==)')
    const localRewrite = src.split('\n').filter((l) => trkRe.test(l) && capRe.test(l))
    expect(localRewrite.length,
      '不得本地复写两轴合取（请调用 isApiTrack），命中: ' + localRewrite.join(' | ')).toBe(0)
    expect(src, '不得回退成 `const rp = (config.has_api && …)`').not.toMatch(/const rp = \(config\.has_api &&/)
  })
})
