'use strict'
/**
 * 微信公众号 DOM 轨「群发/发布」正判据（wechat-mp-publish-track）。
 * 独立成文件：rpa-view-platforms.test.js 已在 max-lines 挂账名单（testLimit 1500），
 * 「新增的超限测试不得进来」⇒ 新用例落新文件。mock 口径与既有文件 createWindow/createWechatContext 一致。
 * describe/it/expect/vi 由 vitest 全局注入（与 rpa-view-platforms.test.js 同）。
 */
const platformsMixin = require('./rpa-view-platforms')

const URL_OK = 'https://mp.weixin.qq.com/cgi-bin/appmsg?appmsgid=12345&token=123456'

function createWindow (url) {
  // executeJavaScript 默认实现：群发保护预检放行（''）+ 草稿选择等脚本放行（true）；
  // 各用例按需 mockResolvedValueOnce 覆盖。
  const executeJavaScript = vi.fn().mockImplementation(async (s) => (String(s).includes('appmsgid=') ? true : ''))
  return {
    win: {
      isDestroyed: () => false,
      webContents: { getURL: () => url, executeJavaScript, session: { webRequest: { onCompleted: vi.fn() } } },
    },
    executeJavaScript,
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
    _insertTextTrusted: vi.fn().mockResolvedValue(true),
    _setElementContentSafe: vi.fn().mockResolvedValue(true),
    _setFileInput: vi.fn().mockResolvedValue(true),
  }
}

describe('rpa-view-platforms — 微信公众号群发/发布正判据（wechat-mp-publish-track）', () => {
  it('🔴 双缺失 fail-closed：既无 masssend XHR 200 也无页面成功提示 ⇒ 不得报成功', async () => {
    const { win, executeJavaScript } = createWindow(URL_OK)
    executeJavaScript.mockResolvedValueOnce('') // 群发保护预检放行
      .mockResolvedValueOnce({ hasTimeout: false, hasLoginPrompt: false }) // 登录态
      .mockImplementation(async (s) => (String(s).includes('appmsgid=') ? true : undefined)) // 草稿选择等
    const context = createWechatContext()
    context._waitForResponse.mockResolvedValue(null)
    context._waitForCondition.mockResolvedValue(false)
    const result = await platformsMixin._publish_wechat_mp.call(context, win, { massSend: true })
    expect(result.success).toBe(false)
    expect(result.error).toContain('无法确认')
  })

  it('单证据即可：masssend XHR 200 命中 ⇒ 成功（页面轮询未命中不拦）', async () => {
    const context = createWechatContext()
    context._waitForResponse.mockResolvedValue({ url: 'https://mp.weixin.qq.com/cgi-bin/masssend?t=ajax-response', statusCode: 200 })
    context._waitForCondition.mockResolvedValue(false)
    const result = await platformsMixin._publish_wechat_mp.call(context, createWindow(URL_OK).win, { massSend: true })
    expect(result.success).toBe(true)
  })

  it('freePublish：走「发布」按钮候选（选择器候选表，真机待验证）', async () => {
    const context = createWechatContext()
    context._waitForResponse.mockResolvedValue({ url: 'x', statusCode: 200 })
    const { win } = createWindow(URL_OK)
    const result = await platformsMixin._publish_wechat_mp.call(context, win, { freePublish: true })
    expect(result.success).toBe(true)
    expect(context._click).toHaveBeenCalledWith(win, 'a.btn_freepublish, a[data-action="freepublish"], .weui-desktop-btn:has-text("发表")')
  })
})
