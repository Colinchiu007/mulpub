// @ts-check
/**
 * wechat-mp-dom-guard.test.js — 微信公众号 DOM 轨补强契约（回归锁）
 *
 * 锁两条判据：
 *  ① 群发保护预检「只在要群发时请求」且「预检失败必须放行」（fail-open）；
 *  ② 原文链接是尽力字段：找不到候选不得抛、不得阻断发布。
 *
 * 真机边界（如实声明）：本机无可用公众号账号会话，真实后台的「原文链接」输入框
 * 选择器未取证，因此本文件测的是**行为契约**（发不发请求、抛不抛、返回什么），
 * 不是"选择器在真机上命不命中"。后者写在 PRD §8.1 的真机门槛里。
 */
const {
  MASS_SEND_PROTECTED_MESSAGE,
  parseProtectionHtml,
  pickTokenFromUrl,
  checkMassSendProtection,
  fillSourceUrl,
  readEditorToast,
  mapSaveFailureMessage,
} = require('./wechat-mp-dom-guard')

function makeWin ({ url = 'https://mp.weixin.qq.com/cgi-bin/appmsg?t=media/appmsg_edit_v2&action=edit&isNew=1&type=77&createType=0&token=1234567890&lang=zh_CN', scriptResult = '', throws = false } = {}) {
  const calls = []
  return {
    calls,
    webContents: {
      getURL: () => url,
      executeJavaScript: async (script) => {
        calls.push(script)
        if (throws) throw new Error('executeJavaScript exploded')
        return typeof scriptResult === 'function' ? scriptResult(script) : scriptResult
      },
    },
  }
}

describe('pickTokenFromUrl / parseProtectionHtml', () => {
  it('从页面 URL 提取 token', () => {
    expect(pickTokenFromUrl('https://mp.weixin.qq.com/cgi-bin/appmsg?token=98765&x=1')).toBe('98765')
    expect(pickTokenFromUrl('https://mp.weixin.qq.com/')).toBe('')
    expect(pickTokenFromUrl('')).toBe('')
  })

  it('未开通安全中心（无 wx.cgiData）⇒ 未保护', () => {
    expect(parseProtectionHtml('<html>未开通</html>')).toBe(false)
  })

  it('protect_status:1 ⇒ 已保护；protect_status:0 ⇒ 未保护', () => {
    expect(parseProtectionHtml('wx.cgiData = {"protect_status":1}')).toBe(true)
    expect(parseProtectionHtml('wx.cgiData = {"protect_status":0}')).toBe(false)
  })
})

describe('群发保护预检（T1/T2）', () => {
  it('未开群发 ⇒ 一次请求都不发', async () => {
    const win = makeWin()
    const r = await checkMassSendProtection(win, { massSend: false })
    expect(r).toMatchObject({ ok: true, skipped: true })
    expect(win.calls.length).toBe(0)
  })

  it('缺 article 也视为不群发（不误拦）', async () => {
    const win = makeWin()
    const r = await checkMassSendProtection(win, undefined)
    expect(r.ok).toBe(true)
    expect(win.calls.length).toBe(0)
  })

  it('群发 + 保护开启 ⇒ 拦下并给可操作文案', async () => {
    const win = makeWin({ scriptResult: 'var wx={}; wx.cgiData = {"protect_status":1};' })
    const r = await checkMassSendProtection(win, { massSend: true })
    expect(r.ok).toBe(false)
    expect(r.code).toBe('mass-send-protected')
    expect(r.error).toBe(MASS_SEND_PROTECTED_MESSAGE)
    expect(r.error).toContain('安全中心')
    expect(r.error).toContain('群发')
    // 同源 fetch 且带 credentials（cookie 由渲染上下文携带）
    expect(win.calls[0]).toContain('credentials:"include"')
    expect(win.calls[0]).toContain('safecenterstatus')
  })

  it('群发 + 未开通安全中心 ⇒ 放行', async () => {
    const win = makeWin({ scriptResult: '<html>no cgiData</html>' })
    const r = await checkMassSendProtection(win, { massSend: true })
    expect(r.ok).toBe(true)
  })

  it('群发 + 探针抛错 ⇒ 放行（fail-open，且标记 degraded）', async () => {
    const win = makeWin({ throws: true })
    const r = await checkMassSendProtection(win, { massSend: true })
    expect(r.ok).toBe(true)
    expect(r.degraded).toBe(true)
  })

  it('页面 URL 无 token ⇒ 放行且不出声（不阻断）', async () => {
    const win = makeWin({ url: 'https://mp.weixin.qq.com/' })
    const r = await checkMassSendProtection(win, { massSend: true })
    expect(r.ok).toBe(true)
    expect(r.reason).toBe('no-token')
    expect(win.calls.length).toBe(0)
  })
})

describe('原文链接尽力透传（T3/T4）', () => {
  it('非 http(s) 一律不填、不发脚本', async () => {
    const win = makeWin()
    for (const bad of ['', 'javascript:alert(1)', 'ftp://x/y', undefined]) {
      const r = await fillSourceUrl(win, bad)
      expect(r.filled).toBe(false)
      expect(r.reason).toBe('not-http')
    }
    expect(win.calls.length).toBe(0)
  })

  it('命中候选 ⇒ 返回 filled 与命中的选择器，并派发 input/change', async () => {
    const win = makeWin({ scriptResult: 'input#js_source_url' })
    const r = await fillSourceUrl(win, 'https://example.com/src')
    expect(r).toMatchObject({ filled: true, selector: 'input#js_source_url' })
    expect(win.calls[0]).toContain('dispatchEvent(new Event("input"')
    expect(win.calls[0]).toContain('dispatchEvent(new Event("change"')
  })

  it('找不到候选 ⇒ filled:false 且不抛', async () => {
    const win = makeWin({ scriptResult: '' })
    const r = await fillSourceUrl(win, 'https://example.com/src')
    expect(r.filled).toBe(false)
    expect(r.reason).toBe('no-selector')
  })

  it('脚本抛错 ⇒ 吞掉并返回 filled:false（绝不阻断发布）', async () => {
    const win = makeWin({ throws: true })
    await expect(fillSourceUrl(win, 'https://example.com/src')).resolves.toMatchObject({ filled: false })
  })
})

describe('失败文案映射（F7）', () => {
  it('64714 / 原创 ⇒ 原创性文案', () => {
    expect(mapSaveFailureMessage('{"ret":"64714"}')).toContain('原创')
    expect(mapSaveFailureMessage('该文章已被声明原创')).toContain('原创')
  })

  it('群发保护特征 ⇒ 安全中心可操作文案', () => {
    expect(mapSaveFailureMessage('"protect_status":1')).toBe(MASS_SEND_PROTECTED_MESSAGE)
    expect(mapSaveFailureMessage('群发保护已开启')).toBe(MASS_SEND_PROTECTED_MESSAGE)
  })

  it('无法识别但页面有原文 ⇒ 保留平台原文', () => {
    const msg = mapSaveFailureMessage('系统繁忙，请稍后再试', '草稿保存失败')
    expect(msg).toContain('草稿保存失败')
    expect(msg).toContain('系统繁忙')
  })

  it('原文为空 ⇒ 用兜底文案', () => {
    expect(mapSaveFailureMessage('', '草稿保存失败')).toBe('草稿保存失败')
    expect(mapSaveFailureMessage(undefined)).toContain('草稿保存失败')
  })
})

describe('readEditorToast', () => {
  it('读取可见提示', async () => {
    const win = makeWin({ scriptResult: '保存失败：请检查原创性' })
    await expect(readEditorToast(win)).resolves.toContain('原创性')
  })

  it('脚本抛错 ⇒ 返回空串，不抛', async () => {
    const win = makeWin({ throws: true })
    await expect(readEditorToast(win)).resolves.toBe('')
  })
})
