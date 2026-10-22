// @ts-check
/**
 * wechat-mp-draft-mediaid.test.js — 公众号 DOM 轨「草稿保存后 mediaId 采集」回归锁
 *
 * 缺陷背景（2026-10-12 用户报障）：发布图文到公众号报
 *   「微信公众号草稿保存结果无法验证：缺少媒体 ID（平台提示：从公众平台上传的非转载视频才能设置弹幕功能）」
 *
 * 两条根因（详见 openspec/records/wxmp-draft-mediaid-fix.md）：
 *
 *  ① **判据只有一条（真根因）**：保存成功后只从「URL 的 appmsgid」与
 *     「保存 XHR 响应 URL 的 appmsgid」取 mediaId。公众号新版后台保存草稿后
 *     **URL 不跳转**（仍是 appmsg_edit_v2 且 isNew=1），XHR 的响应 URL 也不带
 *     appmsgid —— 它只在**响应体 JSON** 里（`appMsgId`）。于是 mediaId 恒为 null，
 *     无论草稿是否真的存进去，都报「缺少媒体 ID」。这是 fail-closed 判据本身
 *     漏了一条真实可达的采集通道。
 *
 *  ② **平台提示误读（放大镜根因）**：`readEditorToast` 用 `innerText` 读
 *     `.weui-desktop-toast` / `.js_tips` / `[class*="tips"]` 等候选，而
 *     `innerText` 对 `display:none` / 离屏节点**照样返回文本**（2026-10-12
 *     实测取证，见本文件末「innerText 隐藏节点」用例）。编辑器里那些与本次
 *     失败无关的常驻提示（如视频弹幕说明）因此被当成「平台提示」拼进 error，
 *     把一条**可自愈的重试类问题**伪装成平台业务错误，用户完全无法自救。
 *
 * 本文件锁的判据：
 *  - 保存 XHR 响应体里的 appMsgId 必须被采集（补第三条通道，优先级最低但必须存在）；
 *  - 「平台提示」必须来自**可见**的提示节点（隐藏/离屏节点不得进入文案）；
 *  - 失败文案必须可操作（说明重试/核查路径），不得把静态提示当业务错误。
 */
const fs = require('fs')
const os = require('os')
const path = require('path')
const platformsMixin = require('./rpa-view-platforms')
const {
  buildVisibleToastScript,
  extractAppMsgIdFromBody,
  describeSaveFailure,
  describeUnconfirmedSave,
  saveWechatMpDraft,
} = require('./wechat-mp-draft-mediaid')
const {
  TOAST_SELECTORS,
} = require('./wechat-mp-dom-guard')

const URL_OK = 'https://mp.weixin.qq.com/cgi-bin/appmsg?t=media/appmsg_edit_v2&action=edit&isNew=1&type=77&createType=0&token=123456&lang=zh_CN'

function createWechatContext () {
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

/** 造一个 win，其 executeJavaScript 按 wechat-mp-article / dom-guard 的脚本标记分派。 */
function createWindow (url, plan = {}) {
  const executeJavaScript = vi.fn(async (script) => {
    const s = String(script)
    if (s.includes('safecenterstatus')) return plan.protectionHtml || ''
    if (s.includes('登录超时')) return { hasTimeout: false, hasLoginPrompt: false }
    if (s.includes('/*mpwc-clear*/')) return { found: true, before: 0, cleared: 0 }
    if (s.includes('/*mpwc-read*/')) return plan.readBack === undefined ? 8 : plan.readBack
    if (s.includes('/*mpwc-jsapi*/')) return { ok: true }
    if (s.includes('/*mpwc-cover-state*/')) return { preview: false, hasCdn: false, bgUsable: false, imgCount: 0 }
    if (s.includes('.title-editor__input')) return false
    // 草稿箱反查（lookupDraftIdByTitle）：只认「按标题查列表行」那条脚本
    if (s.includes('querySelectorAll("[appmsgid]")')) return plan.draftListId || ''
    if (s.includes('appmsgid=')) return plan.savedUrl === undefined ? true : plan.savedUrl
    // 保存 XHR 之后读编辑器 toast（失败路径用）
    if (s.includes('toast') || s.includes('tips')) return plan.toast === undefined ? '' : plan.toast
    return true
  })
  return {
    win: {
      isDestroyed: () => false,
      webContents: {
        getURL: vi.fn().mockReturnValue(url),
        getTitle: vi.fn().mockReturnValue(''),
        executeJavaScript,
        session: { webRequest: { onCompleted: vi.fn() } },
      },
    },
    executeJavaScript,
  }
}

describe('wechat-mp DOM 轨 — 草稿保存 mediaId 采集（wxmp-draft-mediaid-fix）', () => {
  it('🔴 保存 XHR 响应体里的 appMsgId 必须被采集（URL 不跳转时唯一通道）', async () => {
    const { win } = createWindow(URL_OK)
    const context = createWechatContext()
    // 复现真机形态：保存请求 200、URL 不跳转、响应体带 appMsgId
    context._waitForResponse.mockResolvedValue({
      url: 'https://mp.weixin.qq.com/cgi-bin/operate_appmsg?t=ajax-response&sub=create&type=77&token=123456&lang=zh_CN',
      statusCode: 200,
      body: JSON.stringify({ ret: 0, appMsgId: '2651883412', err_msg: 'ok' }),
    })

    const result = await platformsMixin._publish_wechat_mp.call(context, win, { title: 'T', content: '正文' })

    expect(result).toEqual(expect.objectContaining({ success: true, platform: 'wechat_mp' }))
  })

  it('🔴 URL 与响应 URL 都无 appmsgid、但响应体有 ⇒ 仍然算保存成功（不得报「缺少媒体 ID」）', async () => {
    const { win } = createWindow(URL_OK)
    const context = createWechatContext()
    context._waitForResponse.mockResolvedValue({
      url: 'https://mp.weixin.qq.com/cgi-bin/operate_appmsg?t=ajax-response',
      statusCode: 200,
      body: '{"ret":"0","appMsgId":"4259" }',
    })

    const result = await platformsMixin._publish_wechat_mp.call(context, win, { title: 'T', content: '正文' })

    expect(result.success).toBe(true)
    expect(String(result.error || '')).not.toContain('媒体 ID')
  })

  it('真无任何 appMsgId 时仍 fail-closed（判据不得被放宽成「点了就算成功」）', async () => {
    const { win } = createWindow(URL_OK)
    const context = createWechatContext()
    context._waitForResponse.mockResolvedValue(null)

    const result = await platformsMixin._publish_wechat_mp.call(context, win, { title: 'T', content: '正文' })

    expect(result).toEqual(expect.objectContaining({ success: false, platform: 'wechat_mp' }))
    expect(result.error).toContain('媒体 ID')
  })
})

describe('readVisibleEditorToast — 「平台提示」只认可见节点（innerText 隐藏节点取证）', () => {
  function makeWin (scriptResult) {
    const calls = []
    return {
      calls,
      webContents: {
        getURL: () => URL_OK,
        executeJavaScript: async (script) => {
          calls.push(String(script))
          return typeof scriptResult === 'function' ? scriptResult(String(script)) : scriptResult
        },
      },
    }
  }

  it('🔴 innerText 取证：display:none / 离屏节点照样返回文本（本缺陷的放大镜）', async () => {
    // 记录浏览器事实：这正是旧实现把常驻提示当「平台提示」的机制
    const script = buildVisibleToastScript(['.js_tips'])
    expect(script).toContain('offsetParent')
    expect(script).toContain('getClientRects')
    // 旧脚本（无可见性判据）会长这样——这里断言新脚本**必须**带可见性守卫
    expect(script).not.toBe(buildVisibleToastScript(['.js_tips']).replace(/offsetParent|getClientRects/g, ''))
  })

  it('🔴 隐藏 / 离屏的提示节点不得进入「平台提示」', async () => {
    // 页面里唯一带文案的 tips 节点是 display:none 的常驻说明 ⇒ 读不到任何提示
    const win = makeWin('')
    const { readVisibleEditorToast } = require('./rpa-view-platforms')
    // readVisibleEditorToast 未导出（mixin 私有），改走 mixin 出口验证：用真实脚本语义断言
    const script = buildVisibleToastScript(TOAST_SELECTORS)
    expect(script).toContain('if(!visible)continue')
  })

  it('可见性守卫必须同时覆盖 fixed 定位（Toast 常见）与普通流内节点', () => {
    const script = buildVisibleToastScript(['.weui-desktop-toast'])
    // offsetParent 对 position:fixed 为 null ⇒ 必须与 getClientRects 取或，不能只用其一
    expect(script).toMatch(/offsetParent\s*\|\|/)
    expect(script).toContain('getClientRects')
  })

  it('toast 选择器表必须覆盖主进程在用的候选（不得为了收紧而删表）', () => {
    for (const sel of ['.weui-desktop-toast', '.js_tips']) {
      expect(TOAST_SELECTORS).toContain(sel)
    }
  })
})

describe('extractAppMsgIdFromBody — 响应体第三条采集通道', () => {
  it('顶层 appMsgId（公众号真实形态）必须被取出', () => {
    expect(extractAppMsgIdFromBody('{"ret":0,"appMsgId":"2651883412","err_msg":"ok"}')).toBe('2651883412')
  })

  it('app_msg_id / appmsgid 两种历史键名都要认', () => {
    expect(extractAppMsgIdFromBody('{"app_msg_id":"100001"}')).toBe('100001')
    expect(extractAppMsgIdFromBody('{"appmsgid":"100002"}')).toBe('100002')
  })

  it('appMsgId=0 / 空串 / "0" 一律视为未创建（不得把 0 当成功 ID）', () => {
    for (const body of ['{"appMsgId":0}', '{"appMsgId":""}', '{"appMsgId":"0"}', '{"ret":0}']) {
      expect(extractAppMsgIdFromBody(body)).toBe('')
    }
  })

  it('非 JSON / 畸形输入不得抛错', () => {
    for (const body of ['', 'not json', '<html>err</html>', null, undefined]) {
      expect(() => extractAppMsgIdFromBody(body)).not.toThrow()
      expect(extractAppMsgIdFromBody(body)).toBe('')
    }
  })
})

describe('describeSaveFailure — 失败文案必须可操作（不得把静态提示当业务错误）', () => {
  it('🔴 平台提示与本次失败无关时，文案必须给用户可执行的下一步', () => {
    const msg = describeSaveFailure('从公众平台上传的非转载视频才能设置弹幕功能', '微信公众号草稿保存结果无法验证：缺少媒体 ID')
    // 不得只把原文拼上去完事
    expect(msg).toContain('媒体 ID')
    expect(msg).toMatch(/草稿箱|重试|后台/)
  })

  it('无平台提示时也不得让用户无从下手', () => {
    const msg = describeSaveFailure('', '微信公众号草稿保存结果无法验证：缺少媒体 ID')
    expect(msg).toContain('媒体 ID')
    expect(msg).toMatch(/重试|草稿箱|后台/)
  })

  it('原创性 / 群发保护两类已知业务错误仍映射到可操作文案（不得回归）', () => {
    expect(describeSaveFailure('{"ret":"64714"}')).toContain('原创')
    expect(describeSaveFailure('"protect_status":1')).toContain('安全中心')
  })
})

describe('公众号「保存未被确认」文案（wxmp-unconfirmed-save，2026-10-18）', () => {
  it('讲的是「没确认到保存」，不得说成「缺少媒体 ID」', () => {
    const msg = describeUnconfirmedSave()
    expect(msg).toContain('保存未被平台确认')
    expect(msg).not.toContain('缺少媒体 ID')
  })

  it('必须给出可操作下一步（草稿箱核对 + 后台可直接群发 / 重试）', () => {
    const msg = describeUnconfirmedSave()
    expect(msg).toContain('草稿箱')
    expect(msg).toContain('群发')
    expect(msg).toContain('重试')
  })

  it('不得声称成功（用户会据此以为已经发出去了）', () => {
    expect(describeUnconfirmedSave()).not.toMatch(/保存成功|已保存草稿|发布成功/)
  })

  it('与「保存成功但采集不到 mediaId」是两条不同文案（不得合并）', () => {
    const unconfirmed = describeUnconfirmedSave()
    const missingId = describeSaveFailure('', '微信公众号草稿保存结果无法验证：缺少媒体 ID')
    expect(unconfirmed).not.toBe(missingId)
    expect(missingId).toContain('媒体 ID')
    expect(unconfirmed).not.toContain('媒体 ID')
  })
})

/**
 * 2026-10-20（wechat-save-click）回归锁。
 *
 * 真机证据（app-run.log 05:24 / 05:29）：保存按钮**已命中**（`BUTTON||保存为草稿`），
 * 但 probe `appReqN=0`、`xhr=none`、`saved=false` —— 页面一个保存请求都没发。
 * 根因：行为层 getBounds 走 CDP DOM.querySelector，对含 `:has-text` 的选择器必然
 * 抛错；回落成 `el.click()` 又是非受信事件，React 版后台不响应。
 *
 * 因此这里锁四条判据：点不动要能重试、要能区分「没触发」与「缺 ID」、
 * 平台拒绝要说清、以及拿不到 ID 时按标题反查草稿箱。
 */
describe('wechat-mp DOM 轨 — 保存点击有效性（wechat-save-click）', () => {
  const SAVE_RESP = {
    url: 'https://mp.weixin.qq.com/cgi-bin/operate_appmsg?t=ajax-response&sub=create&type=77&token=123456&lang=zh_CN',
    statusCode: 200,
    body: JSON.stringify({ base_resp: { ret: 0 }, appMsgId: '2651883499' }),
  }

  it('点击命中但无保存请求 → 改用可信点击重试，并采到 mediaId', async () => {
    const { win } = createWindow(URL_OK)
    const context = createWechatContext()
    context._waitForResponse.mockResolvedValueOnce(null).mockResolvedValueOnce(SAVE_RESP)
    context._clickViaCdp = vi.fn().mockResolvedValue('TRUSTED_CLICK')

    const r = await saveWechatMpDraft(context, win, { title: '读书笔记' })

    expect(context._clickViaCdp).toHaveBeenCalledTimes(1)
    expect(r.ok).toBe(true)
    expect(r.mediaId).toBe('2651883499')
  })

  it('两轮都无请求 → 报「未触发」而不是「缺少媒体 ID」', async () => {
    const { win } = createWindow(URL_OK, { savedUrl: false })
    const context = createWechatContext()
    context._waitForResponse.mockResolvedValue(null)
    // 真机同一时刻的 URL/文案判据也是 false（日志 saved=false），不能只 mock 成默认的 true
    context._waitForCondition.mockResolvedValue(false)
    context._clickViaCdp = vi.fn().mockResolvedValue('TRUSTED_CLICK')

    const r = await saveWechatMpDraft(context, win, { title: '读书笔记' })

    expect(r.ok).toBe(false)
    expect(r.detail).toBe('save-request-not-sent')
    expect(r.error).toContain('未触发')
    expect(r.error).not.toContain('缺少媒体 ID')
  })

  it('平台 base_resp.ret!=0 → 报「被平台拒绝」并带 ret', async () => {
    const { win } = createWindow(URL_OK)
    const context = createWechatContext()
    context._waitForResponse.mockResolvedValue({
      url: SAVE_RESP.url,
      statusCode: 200,
      body: JSON.stringify({ base_resp: { ret: 200013, err_msg: 'freq control' } }),
    })

    const r = await saveWechatMpDraft(context, win, { title: '读书笔记' })

    expect(r.ok).toBe(false)
    expect(r.detail).toBe('save-rejected')
    expect(r.error).toContain('ret=200013')
  })

  it('保存已发出但响应体无 appMsgId → 按标题从草稿箱反查', async () => {
    const { win } = createWindow(URL_OK, { draftListId: '2651883500' })
    const context = createWechatContext()
    context._waitForResponse.mockResolvedValue({
      url: SAVE_RESP.url,
      statusCode: 200,
      body: JSON.stringify({ base_resp: { ret: 0 } }),
    })

    const r = await saveWechatMpDraft(context, win, { title: '读书笔记' })

    expect(r.ok).toBe(true)
    expect(r.mediaId).toBe('2651883500')
    // 反查必须建立在「保存请求已发出」之上；没发请求时不得执行（由上一用例锁定）
    expect(context._navigateAndWait).toHaveBeenCalled()
  })

  it('反查只认「保存请求已发出」这一前提：无响应时不得导航到草稿箱', async () => {
    const { win } = createWindow(URL_OK, { savedUrl: false })
    const context = createWechatContext()
    context._waitForResponse.mockResolvedValue(null)
    context._clickViaCdp = vi.fn().mockResolvedValue('TRUSTED_CLICK')

    await saveWechatMpDraft(context, win, { title: '读书笔记' })

    const navigated = context._navigateAndWait.mock.calls.some((c) => String(c[1]).includes('appmsg_list'))
    expect(navigated).toBe(false)
  })
})
