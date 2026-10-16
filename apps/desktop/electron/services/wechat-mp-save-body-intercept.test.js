// @ts-check
/**
 * wechat-mp-save-body-intercept.test.js — 公众号保存 XHR 响应体采集的「真实契约」回归锁
 *
 * 缺陷背景（2026-10-16 用户报障，第二例）：
 *   「微信公众号草稿保存结果无法验证：缺少媒体 ID（平台提示：水印：数字生命丘丘）」
 *
 * 两条根因：
 *
 *  ① **通道③ 从上线起空转（真根因）**：wxmp-draft-mediaid-fix（PR #3445，merge c2b4ea01）
 *     补的第三条采集通道读 `saveResp.body`（wechat-mp-draft-mediaid.js:145），
 *     但 `_waitForResponse` / `_waitForResponseExclusive`（rpa-view-helpers.js）只 resolve
 *     `{url, statusCode, matchedUrls}` —— **真实返回里从来没有 `body` 字段**。
 *     真机上 `saveResp.body` 恒为 undefined ⇒ 通道③静默跳过 ⇒ 三条通道全空 ⇒ 仍报「缺少媒体 ID」。
 *     上一轮测试通过是因为 mock 手写了 `body` 字段——mock 与真实 API 契约脱钩。
 *
 *  ② **「平台提示」读到可见但非错误的文案（放大镜，第二例）**：`[class*="tips"]`
 *     宽选择器会命中编辑器里**可见**的常驻设置文案（本次是「水印：数字生命丘丘」——
 *     公众号图文设置里的水印标签），上轮只加了「可见性」守卫，没加「是否错误内容」守卫。
 *
 * 本文件锁的判据：
 *  - `_waitForResponse`（保存路径消费的形状）的响应体采集必须是**真实实现自带**的能力，
 *    而不是依赖调用方 mock 手写 body；
 *  - 「平台提示」文案里不含错误信号关键词（错误/失败/重试/请/无法 等）时不得进 error 文案；
 *  - 保存段注入的 XHR/fetch 拦截脚本必须先于保存点击挂载（挂载点证据锁）。
 */
const fs = require('fs')
const path = require('path')
const {
  extractAppMsgIdFromBody,
  describeSaveFailure,
  buildVisibleToastScript,
  XHR_INTERCEPT_SCRIPT,
  READ_INTERCEPTED_SCRIPT,
  saveWechatMpDraft,
} = require('./wechat-mp-draft-mediaid')

describe('通道④ 行为级：CDP body 不可用时页面内拦截必须兜底', () => {
  function makeHost () {
    return {
      _click: vi.fn().mockResolvedValue(true),
      _waitForCondition: vi.fn().mockResolvedValue(true),
      _waitForResponse: vi.fn().mockResolvedValue(null), // 真机形态：CDP 降级，无 body
      _sleep: vi.fn().mockResolvedValue(undefined),
    }
  }
  function makeWin () {
    const scripts = []
    return {
      scripts,
      webContents: {
        getURL: () => 'https://mp.weixin.qq.com/cgi-bin/appmsg?t=media/appmsg_edit_v2&isNew=1&token=1',
        executeJavaScript: vi.fn(async (s) => {
          scripts.push(String(s))
          if (String(s).includes('__mpSaveIntercepted')) return 'ok' // 注入
          if (String(s).includes('__mpSaveResponses')) {
            return JSON.stringify([{ url: 'https://mp.weixin.qq.com/cgi-bin/operate_appmsg?t=ajax-response', body: '{"ret":0,"appMsgId":"8899001122"}' }])
          }
          return ''
        }),
      },
    }
  }

  it('🔴 _waitForResponse 无 body（null）时，通道④从拦截结果取出 appMsgId', async () => {
    const host = makeHost()
    const win = makeWin()
    const r = await saveWechatMpDraft(host, win)
    expect(r.ok).toBe(true)
    expect(r.mediaId).toBe('8899001122')
    // 注入必须发生在保存点击之前（脚本队列里注入脚本先出现）
    const injectIdx = win.scripts.findIndex(s => s.includes('__mpSaveIntercepted'))
    expect(injectIdx).toBeGreaterThanOrEqual(0)
  })

  it('拦截结果 URL 不匹配保存端点时不得采用（误抓其它接口的 ID）', async () => {
    const host = makeHost()
    const win = makeWin()
    win.webContents.executeJavaScript = vi.fn(async (s) => {
      if (String(s).includes('__mpSaveIntercepted')) return 'ok'
      if (String(s).includes('__mpSaveResponses')) {
        return JSON.stringify([{ url: 'https://mp.weixin.qq.com/cgi-bin/other', body: '{"appMsgId":"111222333"}' }])
      }
      return ''
    })
    const r = await saveWechatMpDraft(host, win)
    expect(r.ok).toBe(true)
    expect(r.mediaId).toBe('')
  })
})

describe('真实契约：_waitForResponseExclusive 源码必须采集响应体（mock 不得手写 body）', () => {
  const src = fs.readFileSync(path.join(__dirname, 'rpa-view-helpers.js'), 'utf8')

  it('🔴 _waitForResponseExclusive resolve 的对象必须含 body（真实契约 = 测试 mock 的契约）', () => {
    // resolve 点必须带 body 字段；否则通道③在真机上恒空转
    expect(src).toMatch(/resolve\(\{[^}]*body/)
  })

  it('🔴 响应体采集必须经 CDP Network.getResponseBody（Electron webRequest 无 body API）', () => {
    // 采集逻辑在 rpa-view-response-body.js（行数门禁拆分）
    const collectorSrc = fs.readFileSync(path.join(__dirname, 'rpa-view-response-body.js'), 'utf8')
    expect(collectorSrc).toContain('Network.getResponseBody')
  })

  it('getResponseBody 失败时不得让整个等待 reject（降级为 body 空串，两条老通道仍可用）', () => {
    // 采集逻辑在 rpa-view-response-body.js（行数门禁拆分）：catch 兜底 + 返回空串
    const collectorSrc = fs.readFileSync(path.join(__dirname, 'rpa-view-response-body.js'), 'utf8')
    expect(collectorSrc).toMatch(/getResponseBody[\s\S]{0,500}?catch/)
    expect(collectorSrc).toMatch(/catch\(function \(\) \{ return '' \}\)/)
  })

  it('既有字段不得回归：url / statusCode / matchedUrls 仍在', () => {
    expect(src).toMatch(/matchedUrls/)
    expect(src).toMatch(/statusCode/)
  })
})

describe('保存段拦截脚本（XHR_INTERCEPT_SCRIPT）— 不依赖 CDP 的第二保险', () => {
  it('🔴 拦截脚本必须存在且为页面注入形态', () => {
    expect(typeof XHR_INTERCEPT_SCRIPT).toBe('string')
    expect(XHR_INTERCEPT_SCRIPT.length).toBeGreaterThan(100)
  })

  it('🔴 拦截必须包住 XMLHttpRequest 与 fetch 两条通道', () => {
    expect(XHR_INTERCEPT_SCRIPT).toContain('XMLHttpRequest')
    expect(XHR_INTERCEPT_SCRIPT).toContain('fetch')
  })

  it('🔴 拦截必须匹配保存端点特征（operate_appmsg / appmsg/save / oper=save）', () => {
    expect(XHR_INTERCEPT_SCRIPT).toContain('operate_appmsg')
    expect(XHR_INTERCEPT_SCRIPT).toContain('appmsg/save')
    expect(XHR_INTERCEPT_SCRIPT).toContain('oper=save')
  })

  it('拦截结果必须挂在 window.__mpSaveResponses 且带 url+body', () => {
    expect(XHR_INTERCEPT_SCRIPT).toContain('__mpSaveResponses')
    expect(XHR_INTERCEPT_SCRIPT).toMatch(/url[\s\S]{0,80}body|body[\s\S]{0,80}url/)
  })

  it('🔴 保存点击前必须先注入拦截脚本（顺序锁）', () => {
    const src = fs.readFileSync(path.join(__dirname, 'wechat-mp-draft-mediaid.js'), 'utf8')
    const injectIdx = src.indexOf('executeJavaScript(XHR_INTERCEPT_SCRIPT)')
    const clickIdx = src.indexOf('host._click')
    expect(injectIdx).toBeGreaterThan(-1)
    expect(clickIdx).toBeGreaterThan(-1)
    expect(injectIdx).toBeLessThan(clickIdx)
  })

  it('保存后必须从拦截结果提取 appMsgId（extractAppMsgIdFromBody 复用，不另造第二份判据）', () => {
    const src = fs.readFileSync(path.join(__dirname, 'wechat-mp-draft-mediaid.js'), 'utf8')
    const seg = src.slice(src.indexOf('async function saveWechatMpDraft'), src.indexOf('module.exports'))
    expect(seg).toContain('READ_INTERCEPTED_SCRIPT')
    expect(READ_INTERCEPTED_SCRIPT).toContain('__mpSaveResponses')
    expect(seg).toContain('extractAppMsgIdFromBody')
  })
})

describe('extractAppMsgIdFromBody — 既有判据不回归', () => {
  it('顶层 appMsgId / app_msg_id / appmsgid 均可取出', () => {
    expect(extractAppMsgIdFromBody('{"ret":0,"appMsgId":"2651883412"}')).toBe('2651883412')
    expect(extractAppMsgIdFromBody('{"app_msg_id":"100001"}')).toBe('100001')
    expect(extractAppMsgIdFromBody('{"appmsgid":"100002"}')).toBe('100002')
  })

  it('appMsgId=0 / 空串 / "0" / 非 JSON 仍视为未创建', () => {
    for (const body of ['{"appMsgId":0}', '{"appMsgId":""}', '{"appMsgId":"0"}', 'not json', '']) {
      expect(extractAppMsgIdFromBody(body)).toBe('')
    }
  })
})

describe('describeSaveFailure — 「平台提示」必须是错误内容（第二例：水印文案）', () => {
  it('🔴 可见但非错误的常驻设置文案（水印等）不得进 error 文案', () => {
    const msg = describeSaveFailure('水印：数字生命丘丘', '微信公众号草稿保存结果无法验证：缺少媒体 ID')
    expect(msg).not.toContain('水印')
    expect(msg).not.toContain('数字生命丘丘')
    expect(msg).toContain('媒体 ID')
    expect(msg).toMatch(/草稿箱|重试|后台/)
  })

  it('真实错误提示仍原样保留（不得误伤可诊断信息）', () => {
    const msg = describeSaveFailure('保存失败，请稍后重试', 'FB')
    expect(msg).toContain('保存失败')
  })

  it('原创性 / 群发保护两类已知业务错误映射不回归', () => {
    expect(describeSaveFailure('{"ret":"64714"}')).toContain('原创')
    expect(describeSaveFailure('"protect_status":1')).toContain('安全中心')
  })

  it('无平台提示时仍给可操作兜底', () => {
    const msg = describeSaveFailure('', '微信公众号草稿保存结果无法验证：缺少媒体 ID')
    expect(msg).toMatch(/重试|草稿箱|后台/)
  })
})

describe('可见性守卫不回归', () => {
  it('toast 脚本仍带 offsetParent / getClientRects 判据', () => {
    const script = buildVisibleToastScript(['.js_tips'])
    expect(script).toContain('offsetParent')
    expect(script).toContain('getClientRects')
  })
})
