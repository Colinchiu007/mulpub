// @ts-check
/**
 * login-network-diagnostics — 会话级网络诊断模块单测
 *
 * 覆盖：幂等挂接、URL 过滤注册、classifyNetError 分类、
 * ERR_ABORTED 降噪、onCompleted 关键端点分级记录、resolveProxy 探测。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const log = require('./logger')

let mod

beforeEach(async () => {
  vi.clearAllMocks()
  vi.resetModules()
  // logger 为真实模块（无 electron 依赖），直接 spy 拦截输出并断言
  vi.spyOn(log, 'notify').mockImplementation(function () {})

  mod = require('./login-network-diagnostics')
})

// 构造 mock session：webRequest 注册记录 + resolveProxy Promise
function createSession (proxyResult) {
  return {
    webRequest: {
      onBeforeRequest: vi.fn(),
      onErrorOccurred: vi.fn(),
      onCompleted: vi.fn()
    },
    resolveProxy: vi.fn().mockResolvedValue(proxyResult === undefined ? 'DIRECT' : proxyResult)
  }
}

// 预期的 webRequest filter（urls 数组覆盖微信登录全链路域名）
const EXPECTED_URLS = [
  '*://*.weixin.qq.com/*',
  '*://*.wx.qq.com/*',
  '*://weixin.qq.com/*',
  '*://wx.qq.com/*'
]

describe('login-network-diagnostics — attachLoginNetworkDiagnostics', () => {
  it('attach 后 onErrorOccurred/onCompleted 各注册一次，filter 覆盖微信域名，resolveProxy 被探测', () => {
    const ses = createSession()
    mod.attachLoginNetworkDiagnostics(ses, { platform: 'wechat_mp', accountId: 'acc1' })

    expect(ses.webRequest.onErrorOccurred).toHaveBeenCalledTimes(1)
    expect(ses.webRequest.onCompleted).toHaveBeenCalledTimes(1)
    expect(ses.webRequest.onErrorOccurred.mock.calls[0][0]).toEqual({ urls: EXPECTED_URLS })
    expect(ses.webRequest.onCompleted.mock.calls[0][0]).toEqual({ urls: EXPECTED_URLS })
    expect(typeof ses.webRequest.onErrorOccurred.mock.calls[0][1]).toBe('function')
    expect(typeof ses.webRequest.onCompleted.mock.calls[0][1]).toBe('function')
    expect(ses.resolveProxy).toHaveBeenCalledWith('https://open.weixin.qq.com/')
  })

  it('重复 attach 不再注册（幂等，防同 session 复用时监听器翻倍）', () => {
    const ses = createSession()
    mod.attachLoginNetworkDiagnostics(ses, { platform: 'wechat_mp', accountId: 'acc1' })
    mod.attachLoginNetworkDiagnostics(ses, { platform: 'wechat_mp', accountId: 'acc1' })
    mod.attachLoginNetworkDiagnostics(ses, { platform: 'wechat_mp', accountId: 'acc2' })

    expect(ses.webRequest.onErrorOccurred).toHaveBeenCalledTimes(1)
    expect(ses.webRequest.onCompleted).toHaveBeenCalledTimes(1)
    expect(ses.resolveProxy).toHaveBeenCalledTimes(1)
  })

  it('resolveProxy 结果写入 info 日志；失败时写 warn 兜底', async () => {
    // Promise.resolve() 采用外部 Promise 有多层微任务，用宏任务确保彻底 flush
    const flush = function () { return new Promise(function (r) { setTimeout(r, 0) }) }

    const ses = createSession('PROXY 127.0.0.1:7892')
    mod.attachLoginNetworkDiagnostics(ses, { platform: 'wechat_mp', accountId: 'acc1' })
    await flush()

    expect(log.notify).toHaveBeenCalledWith('LoginNetDiag', 'proxy-resolved', expect.objectContaining({ params: expect.objectContaining({ proxy: 'PROXY 127.0.0.1:7892' }) }))

    const failSes = createSession()
    failSes.resolveProxy.mockRejectedValue(new Error('boom'))
    mod.attachLoginNetworkDiagnostics(failSes, { platform: 'wechat_mp', accountId: 'acc1' })
    await flush()

    expect(log.notify).toHaveBeenCalledWith('LoginNetDiag', 'resolve-proxy-failed', expect.objectContaining({ error: 'boom' }))
  })

  it('缺省 ctx 时 tag 使用 unknown', () => {
    const ses = createSession()
    mod.attachLoginNetworkDiagnostics(ses)
    const handler = ses.webRequest.onErrorOccurred.mock.calls[0][1]
    handler({ url: 'https://mp.weixin.qq.com/x', error: 'ERR_CONNECTION_RESET' })

    expect(log.notify).toHaveBeenCalledWith('LoginNetDiag', 'request-failed', expect.objectContaining({ params: expect.objectContaining({ tag: expect.stringContaining('[unknown/unknown]') }) }))
  })
})

describe('login-network-diagnostics — onErrorOccurred handler', () => {
  function getErrorHandler (ses) {
    return ses.webRequest.onErrorOccurred.mock.calls[0][1]
  }

  it('网络失败打 warn，含 URL/错误码/分类提示', () => {
    const ses = createSession()
    mod.attachLoginNetworkDiagnostics(ses, { platform: 'wechat_mp', accountId: 'acc1' })
    getErrorHandler(ses)({ url: 'https://open.weixin.qq.com/cgi-bin/mpqrconnect?x=1', error: 'ERR_TUNNEL_CONNECTION_FAILED', ip: '1.2.3.4' })

    expect(log.notify).toHaveBeenCalledTimes(1)
    const call0 = log.notify.mock.calls[0]; const meta = call0[2] || {}
    expect(meta.params.url).toContain('https://open.weixin.qq.com/cgi-bin/mpqrconnect')
    expect(meta.params.error).toBe('ERR_TUNNEL_CONNECTION_FAILED')
    expect(meta.params.ip).toBe('1.2.3.4')
    expect(meta.params.classify).toContain('代理不可达或认证失败')
  })

  it('ERR_ABORTED 不打日志（正常导航取消，降噪）', () => {
    const ses = createSession()
    mod.attachLoginNetworkDiagnostics(ses, { platform: 'wechat_mp', accountId: 'acc1' })
    getErrorHandler(ses)({ url: 'https://res.wx.qq.com/a.js', error: 'ERR_ABORTED' })

    expect(log.notify).not.toHaveBeenCalled()
    expect(log.notify).not.toHaveBeenCalled()
  })

  it('details.ip 缺省时不追加 ip 字段', () => {
    const ses = createSession()
    mod.attachLoginNetworkDiagnostics(ses, { platform: 'wechat_mp', accountId: 'acc1' })
    getErrorHandler(ses)({ url: 'https://mp.weixin.qq.com/', error: 'ERR_CONNECTION_RESET' })

    const meta = (log.notify.mock.calls[0] || [])[2] || {}
    expect(meta.params.ip).toBeNull()
    expect(meta.params.classify).toContain('连接失败：检查防火墙/代理节点可用性')
  })
})

describe('login-network-diagnostics — classifyNetError', () => {
  it('代理类错误 → 代理提示', () => {
    expect(mod.classifyNetError('ERR_PROXY_CONNECTION_FAILED')).toContain('代理')
    expect(mod.classifyNetError('ERR_TUNNEL_CONNECTION_FAILED')).toContain('代理')
    expect(mod.classifyNetError('ERR_PROXY_AUTH_REQUESTED')).toContain('代理')
  })

  it('ERR_NAME_NOT_RESOLVED → DNS 提示', () => {
    expect(mod.classifyNetError('ERR_NAME_NOT_RESOLVED')).toContain('DNS')
  })

  it('连接类错误 → 连接失败提示', () => {
    expect(mod.classifyNetError('ERR_CONNECTION_TIMED_OUT')).toContain('连接失败')
    expect(mod.classifyNetError('ERR_CONNECTION_RESET')).toContain('连接失败')
    expect(mod.classifyNetError('ERR_CONNECTION_REFUSED')).toContain('连接失败')
  })

  it('未知错误 → 默认文案', () => {
    expect(mod.classifyNetError('ERR_SOMETHING_ELSE')).toContain('网络异常')
    expect(mod.classifyNetError(undefined)).toContain('网络异常')
  })
})

describe('login-network-diagnostics — onCompleted handler', () => {
  function getCompletedHandler (ses) {
    return ses.webRequest.onCompleted.mock.calls[0][1]
  }

  it('mpqrconnect 端点 HTTP 502 → warn', () => {
    const ses = createSession()
    mod.attachLoginNetworkDiagnostics(ses, { platform: 'wechat_mp', accountId: 'acc1' })
    getCompletedHandler(ses)({ url: 'https://open.weixin.qq.com/cgi-bin/mpqrconnect', statusCode: 502 })

    expect(log.notify).toHaveBeenCalledTimes(1)
    expect(log.notify.mock.calls[0][1]).toBe('http-status-warning')
    expect((log.notify.mock.calls[0][2] || {}).params.msg).toContain('HTTP 502 https://open.weixin.qq.com/cgi-bin/mpqrconnect')
  })

  it('其他 URL HTTP 404 → info', () => {
    const ses = createSession()
    mod.attachLoginNetworkDiagnostics(ses, { platform: 'wechat_mp', accountId: 'acc1' })
    getCompletedHandler(ses)({ url: 'https://res.wx.qq.com/missing.js', statusCode: 404 })

    expect(log.notify).toHaveBeenCalledTimes(1)
    expect(log.notify.mock.calls[0][1]).toBe('http-status-info')
    expect((log.notify.mock.calls[0][2] || {}).params.msg).toContain('HTTP 404 https://res.wx.qq.com/missing.js')
  })

  it('HTTP 200 → 无日志', () => {
    const ses = createSession()
    mod.attachLoginNetworkDiagnostics(ses, { platform: 'wechat_mp', accountId: 'acc1' })
    getCompletedHandler(ses)({ url: 'https://long.open.weixin.qq.com/connect', statusCode: 200 })

    expect(log.notify).not.toHaveBeenCalled()
    expect(log.notify).not.toHaveBeenCalled()
  })
})

// 出码计时：persist:auth-* 登录视图此前零日志，二维码"刷很久"无法归因。
// 只跟踪 getqrcode（二维码字节本体），不跟踪 l/qrconnect（15s 长轮询会无限刷屏）。
describe('login-network-diagnostics — 出码计时（getqrcode）', () => {
  const QR_URL = 'https://mp.weixin.qq.com/cgi-bin/scanloginqrcode?action=getqrcode&random=1'

  function getCompletedHandler (ses) {
    return ses.webRequest.onCompleted.mock.calls[0][1]
  }

  function attach () {
    const ses = createSession()
    mod.attachLoginNetworkDiagnostics(ses, { platform: 'wechat_mp', accountId: 'auth-1' })
    return ses
  }

  // 刻意不打桩 Date.now：vitest 自身也会调用 Date.now，mockReturnValueOnce 的取值队列会被
  // 无关消费错位，留下顺序依赖的假红（AGENTS.md 2026-09-17 长期红灯教训）。
  // 耗时数值用结构正则锁格式（负数/NaN 不匹配 \d+，同样能抓），
  // 可确定性断言的部分（序号序列、字段有无）用 toEqual 精确断言 —— 满足 QM-3 结构断言口径。

  it('首个 getqrcode 完成 → 记录 tag/序号/耗时(ms)/状态/体长度', () => {
    const ses = attach()
    getCompletedHandler(ses)({
      url: QR_URL,
      statusCode: 200,
      responseHeaders: { headers: [{ name: 'Content-Length', value: '7632' }] }
    })

    expect(log.notify).toHaveBeenCalledTimes(1)
    expect(log.notify.mock.calls[0][0]).toBe('LoginNetDiag')
    const c0 = log.notify.mock.calls[0]
    expect(c0[1]).toBe('qr-response')
    const p0 = (c0[2] || {}).params || {}
    expect(p0.tag).toBe('[wechat_mp/auth-1] ')
    expect(p0.count).toBe(1)
    expect(p0.afterMs).toBeTypeOf('number')
    expect(p0.status).toBe(200)
    expect(p0.contentLength).toBe('7632')
  })

  it('HTTP 200 + content-length 0（微信静默拒绝特征）→ 如实记录 contentLength=0', () => {
    const ses = attach()
    getCompletedHandler(ses)({
      url: QR_URL,
      statusCode: 200,
      responseHeaders: { headers: [{ name: 'content-length', value: '0' }] }
    })

    const c0 = log.notify.mock.calls[0]
    expect(c0[1]).toBe('qr-response')
    expect((c0[2] || {}).params.contentLength).toBe('0')
  })

  it('响应头缺失 → 显式记 contentLength=redacted，不留隐式缺口（边界）', () => {
    const ses = attach()
    getCompletedHandler(ses)({ url: QR_URL, statusCode: 200 })

    // 跨域 iframe 的 responseHeaders 会被 Chromium 屏蔽，真机实测确实取不到；
    // 若不显式标注，读日志的人会以为"这一行本来就没有该字段"而漏判空体拒绝。
    const c0 = log.notify.mock.calls[0]
    expect(c0[1]).toBe('qr-response')
    expect((c0[2] || {}).params.contentLength).toBe('redacted')
  })

  it('出码尝试逐次编号，超过上限后不再记录（防反复刷新刷屏）', () => {
    const ses = attach()
    const handler = getCompletedHandler(ses)

    for (let i = 0; i < 8; i++) handler({ url: QR_URL, statusCode: 200 })

    const seq = log.notify.mock.calls
      .map(function (c) { return (c[2] || {}).params })
      .filter(function (pp) { return pp && pp.count !== undefined })
      .map(function (pp) { return pp.count + '|' + pp.contentLength })
    expect(seq).toEqual([
      '1|redacted',
      '2|redacted',
      '3|redacted',
      '4|redacted',
      '5|redacted',
      '6|redacted'
    ])
  })

  it('长轮询 l/qrconnect 的 200 不计入出码日志（回归：既有"200→无日志"契约不被破坏）', () => {
    const ses = attach()
    getCompletedHandler(ses)({ url: 'https://long.open.weixin.qq.com/connect/l/qrconnect?uuid=x', statusCode: 200 })

    expect(log.notify).not.toHaveBeenCalled()
    expect(log.notify).not.toHaveBeenCalled()
  })
})
// ─── attachAuthResponseDiagnostics（登录关键端点响应体诊断，CDP 被动读取）───

const ZHIHU_SMS_URL = 'https://www.zhihu.com/api/v4/signin/sms_send'

// 构造 mock debugger：收集 'message' 监听器，sendCommand 可编程返回
function createDebugger (responseBody, opts) {
  const handlers = []
  const dbg = {
    __handlers: handlers,
    sendCommand: vi.fn().mockImplementation(async (method) => {
      if (method === 'Network.getResponseBody') {
        if (opts && opts.rejectBody) throw new Error('No resource with given identifier found')
        return { body: responseBody, base64Encoded: false }
      }
      if (opts && opts.enableThrows) throw new Error('Debugger is not attached')
      return {}
    }),
    on: vi.fn((event, fn) => { if (event === 'message') handlers.push(fn) }),
  }
  return dbg
}

// 取出唯一注册的 message 监听器
function messageHandler (dbg) {
  expect(dbg.__handlers.length).toBe(1)
  return dbg.__handlers[0]
}

describe('login-network-diagnostics — attachAuthResponseDiagnostics 挂接面', () => {
  it('未登记的平台一律不挂：不 enable Network、不注册监听、返回 false', () => {
    const dbg = createDebugger('{}')

    expect(mod.attachAuthResponseDiagnostics(dbg, { platform: 'douyin', accountId: 'a1' })).toBe(false)
    expect(dbg.sendCommand).not.toHaveBeenCalled()
    expect(dbg.on).not.toHaveBeenCalled()
  })

  it('debugger 缺失或形状不对 → 返回 false 且不抛', () => {
    expect(mod.attachAuthResponseDiagnostics(null, { platform: 'zhihu' })).toBe(false)
    expect(mod.attachAuthResponseDiagnostics(undefined, { platform: 'zhihu' })).toBe(false)
    expect(mod.attachAuthResponseDiagnostics({}, { platform: 'zhihu' })).toBe(false)
  })

  it('知乎 → enable Network 一次并注册一个监听，返回 true', () => {
    const dbg = createDebugger('{}')

    expect(mod.attachAuthResponseDiagnostics(dbg, { platform: 'zhihu', accountId: 'a1' })).toBe(true)
    expect(dbg.sendCommand).toHaveBeenCalledTimes(1)
    expect(dbg.sendCommand.mock.calls[0][0]).toBe('Network.enable')
    expect(dbg.on).toHaveBeenCalledTimes(1)
    expect(dbg.on.mock.calls[0][0]).toBe('message')
  })

  it('重复挂接幂等：同一 debugger 不叠加监听（防一次失败刷多行日志）', () => {
    const dbg = createDebugger('{}')
    mod.attachAuthResponseDiagnostics(dbg, { platform: 'zhihu', accountId: 'a1' })
    mod.attachAuthResponseDiagnostics(dbg, { platform: 'zhihu', accountId: 'a2' })

    expect(dbg.sendCommand).toHaveBeenCalledTimes(1)
    expect(dbg.on).toHaveBeenCalledTimes(1)
    expect(dbg.__handlers.length).toBe(1)
  })

  it('Network.enable 被拒（debugger 未 attach / 域不可用）→ 降级不挂监听、不外抛', async () => {
    const dbg = createDebugger('{}', { enableThrows: true })

    const attached = mod.attachAuthResponseDiagnostics(dbg, { platform: 'zhihu', accountId: 'a1' })
    // 诊断不得影响登录热路径：等一轮微任务让 enable 的 rejection 落地
    await Promise.resolve()
    await Promise.resolve()

    expect(attached).toBe(true)
    expect(dbg.__handlers.length).toBe(1)
    expect(log.notify).not.toHaveBeenCalled()
  })
})

describe('login-network-diagnostics — attachAuthResponseDiagnostics 响应判定', () => {
  it('知乎 200 + error 体（风控拒绝的典型形态）→ warn 记 code 与 message', async () => {
    const dbg = createDebugger(JSON.stringify({ error: { code: 10001, message: '请求参数异常，请升级客户端后重试' } }))
    mod.attachAuthResponseDiagnostics(dbg, { platform: 'zhihu', accountId: 'auth-zhihu-1' })

    await messageHandler(dbg)({}, 'Network.responseReceived', {
      requestId: 'r1', response: { url: ZHIHU_SMS_URL, status: 200 },
    })

    expect(log.notify).toHaveBeenCalledTimes(1)
    expect(log.notify.mock.calls[0][0]).toBe('LoginRespDiag')
    // 精确结构断言（QM-3）：整条摘要逐字符锁定，防止字段顺序/分隔符漂移
    const rej = log.notify.mock.calls[0]
    expect(rej[1]).toBe('key-endpoint-rejected')
    expect((rej[2] || {}).params).toEqual({ tag: '[zhihu/auth-zhihu-1] ', url: ZHIHU_SMS_URL, http: 200, code: '10001', message: '请求参数异常，请升级客户端后重试' })
  })

  it('成功体（无 error）→ 不记任何日志，但确实查过响应体', async () => {
    const dbg = createDebugger(JSON.stringify({ success: true }))
    mod.attachAuthResponseDiagnostics(dbg, { platform: 'zhihu', accountId: 'a1' })

    await messageHandler(dbg)({}, 'Network.responseReceived', {
      requestId: 'r1', response: { url: ZHIHU_SMS_URL, status: 200 },
    })

    expect(log.notify).not.toHaveBeenCalled()
    expect(log.notify).not.toHaveBeenCalled()
    expect(dbg.sendCommand).toHaveBeenCalledWith('Network.getResponseBody', { requestId: 'r1' })
  })

  it('HTTP >= 400 且响应体不可解析 → 仍记一条含状态码的 warn（降级不丢信号）', async () => {
    const dbg = createDebugger('not-json-at-all')
    mod.attachAuthResponseDiagnostics(dbg, { platform: 'zhihu', accountId: 'a1' })

    await messageHandler(dbg)({}, 'Network.responseReceived', {
      requestId: 'r1', response: { url: ZHIHU_SMS_URL, status: 403 },
    })

    expect(log.notify).toHaveBeenCalledTimes(1)
    const unp = log.notify.mock.calls[0]
    expect(unp[1]).toBe('key-endpoint-rejected')
    expect((unp[2] || {}).params).toEqual({ tag: '[zhihu/a1] ', url: ZHIHU_SMS_URL, http: 403, code: '<none>', message: '<unparsable>' })
  })

  it('响应体已被网络栈回收（getResponseBody 抛错）→ 记 HTTP 状态且不产生未处理拒绝', async () => {
    const dbg = createDebugger('', { rejectBody: true })
    mod.attachAuthResponseDiagnostics(dbg, { platform: 'zhihu', accountId: 'a1' })

    await expect(messageHandler(dbg)({}, 'Network.responseReceived', {
      requestId: 'missing', response: { url: ZHIHU_SMS_URL, status: 500 },
    })).resolves.toBeUndefined()

    expect(log.notify).toHaveBeenCalledTimes(1)
    expect((log.notify.mock.calls[0][2] || {}).params.http).toBe(500)
  })

  it('非关键端点（静态资源 / 其他域名）→ 不查响应体、不记日志', async () => {
    const dbg = createDebugger(JSON.stringify({ error: { code: 1, message: 'x' } }))
    mod.attachAuthResponseDiagnostics(dbg, { platform: 'zhihu', accountId: 'a1' })
    const before = dbg.sendCommand.mock.calls.length

    await messageHandler(dbg)({}, 'Network.responseReceived', {
      requestId: 'r2', response: { url: 'https://static.zhihu.com/zse-asset/v4/main.js', status: 500 },
    })
    await messageHandler(dbg)({}, 'Network.responseReceived', {
      requestId: 'r3', response: { url: 'https://evil.example.com/api/v4/signin/sms_send', status: 500 },
    })

    expect(dbg.sendCommand.mock.calls.length).toBe(before)
    expect(log.notify).not.toHaveBeenCalled()
  })

  it('无关 CDP 事件（Fetch.requestPaused 等）→ 完全忽略', async () => {
    const dbg = createDebugger('{}')
    mod.attachAuthResponseDiagnostics(dbg, { platform: 'zhihu', accountId: 'a1' })

    await messageHandler(dbg)({}, 'Fetch.requestPaused', { requestId: 'r1' })

    expect(log.notify).not.toHaveBeenCalled()
    expect(log.notify).not.toHaveBeenCalled()
  })

  // 真实 CDP 的 Network.loadingFailed 事件**不带 url**，只有 requestId，
  // 所以 URL 必须在 requestWillBeSent 时按 requestId 登记，失败时回查。
  it('Network.loadingFailed → 回查 requestWillBeSent 登记的 URL，warn 记 net 错误分类', async () => {
    const dbg = createDebugger('{}')
    mod.attachAuthResponseDiagnostics(dbg, { platform: 'zhihu', accountId: 'a1' })
    const handler = messageHandler(dbg)

    await handler({}, 'Network.requestWillBeSent', {
      requestId: 'r9', request: { url: ZHIHU_SMS_URL + '?tel=13800001111' }, type: 'XHR',
    })
    await handler({}, 'Network.loadingFailed', {
      requestId: 'r9', type: 'XHR', errorText: 'ERR_PROXY_CONNECTION_FAILED', canceled: false,
    })

    expect(log.notify).toHaveBeenCalledTimes(1)
    const fail = log.notify.mock.calls[0]
    expect(fail[1]).toBe('key-endpoint-request-failed')
    expect((fail[2] || {}).params).toEqual({ tag: '[zhihu/a1] ', url: ZHIHU_SMS_URL, netError: 'ERR_PROXY_CONNECTION_FAILED', classify: '代理不可达或认证失败：检查系统代理与账号代理设置' })
  })

  it('requestWillBeSent 对非关键端点不登记、不记日志', async () => {
    const dbg = createDebugger('{}')
    mod.attachAuthResponseDiagnostics(dbg, { platform: 'zhihu', accountId: 'a1' })
    const handler = messageHandler(dbg)

    await handler({}, 'Network.requestWillBeSent', {
      requestId: 'r10', request: { url: 'https://static.zhihu.com/zse-asset/v4/main.js' }, type: 'Script',
    })
    await handler({}, 'Network.loadingFailed', { requestId: 'r10', errorText: 'ERR_ABORTED' })

    expect(log.notify).not.toHaveBeenCalled()
  })
})

describe('login-network-diagnostics — attachAuthResponseDiagnostics 日志脱敏（安全锁）', () => {
  // 日志只允许「端点 + 状态码 + error.code + error.message」四类诊断字段，
  // 绝不整体转储响应体，也绝不记录 URL 的 query/hash —— 知乎短信请求的 query/body
  // 会带手机号，部分接口响应会带 token。
  const SECRET_PHONE = '13800001111'
  const SECRET_TOKEN = 'Bearer.zhihu.session.token'

  const allLoggedText = () => [log.notify]
    .flatMap((fn) => fn.mock.calls.map((c) => c[1] + ' ' + JSON.stringify(c[2] || {})))
    .join('\n')

  it('响应体内的手机号 / token 不得出现在任何日志中', async () => {
    const dbg = createDebugger(JSON.stringify({
      error: { code: 100, message: '客户端异常' },
      data: { mobile: SECRET_PHONE, access_token: SECRET_TOKEN, name: '张三' },
    }))
    mod.attachAuthResponseDiagnostics(dbg, { platform: 'zhihu', accountId: 'a1' })

    await messageHandler(dbg)({}, 'Network.responseReceived', {
      requestId: 'r1', response: { url: ZHIHU_SMS_URL, status: 200 },
    })

    expect(log.notify).toHaveBeenCalledTimes(1)
    expect(allLoggedText()).not.toContain(SECRET_PHONE)
    expect(allLoggedText()).not.toContain(SECRET_TOKEN)
    expect(allLoggedText()).not.toContain('张三')
  })

  it('URL 的 query / hash 一律剥离后再落日志', async () => {
    const dbg = createDebugger(JSON.stringify({ error: { code: 100, message: '客户端异常' } }))
    mod.attachAuthResponseDiagnostics(dbg, { platform: 'zhihu', accountId: 'a1' })

    await messageHandler(dbg)({}, 'Network.responseReceived', {
      requestId: 'r1',
      response: { url: ZHIHU_SMS_URL + '?tel=' + SECRET_PHONE + '&token=' + SECRET_TOKEN + '#frag' + SECRET_PHONE, status: 200 },
    })

    expect(allLoggedText()).not.toContain(SECRET_PHONE)
    expect(allLoggedText()).not.toContain(SECRET_TOKEN)
    const stripped = log.notify.mock.calls[0]
    expect(stripped[1]).toBe('key-endpoint-rejected')
    expect((stripped[2] || {}).params).toEqual({ tag: '[zhihu/a1] ', url: ZHIHU_SMS_URL, http: 200, code: '100', message: '客户端异常' })
  })

  it('超长 message 截断，不整段回显', async () => {
    const long = '详细风控说明'.repeat(60)
    const dbg = createDebugger(JSON.stringify({ error: { code: 100, message: long } }))
    mod.attachAuthResponseDiagnostics(dbg, { platform: 'zhihu', accountId: 'a1' })

    await messageHandler(dbg)({}, 'Network.responseReceived', {
      requestId: 'r1', response: { url: ZHIHU_SMS_URL, status: 200 },
    })

    const params = (log.notify.mock.calls[0][2] || {}).params || {}
    expect(String(params.message).length).toBeLessThanOrEqual(300)
    expect(String(params.message)).toMatch(/\.\.\.$/)
  })

  it('非字符串 error.message（数字 / 对象）→ 归一为字符串表示，不注入对象', async () => {
    const dbg = createDebugger(JSON.stringify({ error: { code: 'abc', message: { nested: SECRET_TOKEN } } }))
    mod.attachAuthResponseDiagnostics(dbg, { platform: 'zhihu', accountId: 'a1' })

    await messageHandler(dbg)({}, 'Network.responseReceived', {
      requestId: 'r1', response: { url: ZHIHU_SMS_URL, status: 200 },
    })

    expect(allLoggedText()).not.toContain(SECRET_TOKEN)
    expect(allLoggedText()).not.toContain('[object Object]')
  })
})


// ─── 出码真实字节数：跨域 iframe 的 responseHeaders 被 Chromium 屏蔽，只有 CDP 给得出字节 ───
describe('login-network-diagnostics — 出码真实字节数（CDP Network.loadingFinished）', () => {
  const QR_URL = 'https://mp.weixin.qq.com/cgi-bin/scanloginqrcode?action=getqrcode&t=1'

  function attachWechat () {
    const dbg = createDebugger('{}')
    expect(mod.attachAuthResponseDiagnostics(dbg, { platform: 'wechat_mp', accountId: 'a1' })).toBe(true)
    return messageHandler(dbg)
  }

  it('二维码请求也登记：loadingFinished 报出 encodedDataLength 真字节数', async () => {
    const onMessage = attachWechat()
    await onMessage(null, 'Network.requestWillBeSent', { requestId: 'r1', request: { url: QR_URL } })
    await onMessage(null, 'Network.loadingFinished', { requestId: 'r1', encodedDataLength: 7632 })
    const line = log.notify.mock.calls.filter(c => c[1] === 'qr-bytes')
    expect(line.length).toBe(1)
    expect((line[0][2] || {}).params.encodedDataLength).toBe(7632)
  })

  it('未登记的 requestId 不产出字节数日志（不与 auth 端点混淆）', async () => {
    const onMessage = attachWechat()
    await onMessage(null, 'Network.loadingFinished', { requestId: 'ghost', encodedDataLength: 999 })
    expect(log.notify.mock.calls.filter(c => c[1] === 'qr-bytes').length).toBe(0)
  })

  it('缺 encodedDataLength 时显式记 unknown，不静默省略该列', async () => {
    const onMessage = attachWechat()
    await onMessage(null, 'Network.requestWillBeSent', { requestId: 'r2', request: { url: QR_URL } })
    await onMessage(null, 'Network.loadingFinished', { requestId: 'r2' })
    const line = log.notify.mock.calls.filter(c => c[1] === 'qr-bytes')
    expect((line[0][2] || {}).params.encodedDataLength).toBe('unknown')
  })

  it('非二维码端点即便有字节数也不记（只锁 getqrcode 一条路径）', async () => {
    const onMessage = attachWechat()
    await onMessage(null, 'Network.requestWillBeSent', { requestId: 'r3', request: { url: ZHIHU_SMS_URL } })
    await onMessage(null, 'Network.loadingFinished', { requestId: 'r3', encodedDataLength: 42 })
    expect(log.notify.mock.calls.filter(c => String(c[1]).indexOf('qr bytes #') >= 0).length).toBe(0)
  })
})

describe('login-network-diagnostics — observe-only 档的隐私边界', () => {
  const BIZLOGIN = 'https://mp.weixin.qq.com/cgi-bin/bizlogin?action=login'

  it('observe-only 平台即便有响应事件也永不 getResponseBody（只有 MATCHERS 里的平台读体）', async () => {
    const dbg = createDebugger('{"base_resp":{"ret":14199}}')
    expect(mod.attachAuthResponseDiagnostics(dbg, { platform: 'wechat_mp', accountId: 'a1' })).toBe(true)
    const onMessage = messageHandler(dbg)
    await onMessage(null, 'Network.requestWillBeSent', { requestId: 'b1', request: { url: BIZLOGIN } })
    await onMessage(null, 'Network.responseReceived', { requestId: 'b1', response: { url: BIZLOGIN, status: 200 } })
    const bodyCalls = dbg.sendCommand.mock.calls.filter(c => c[0] === 'Network.getResponseBody')
    expect(bodyCalls.length).toBe(0)
    expect(log.notify.mock.calls.filter(c => String(c[1]).indexOf('被拒') >= 0).length).toBe(0)
  })

  it('两档都不命中的平台不 enable Network（douyin 仍为零监听面）', () => {
    const dbg = createDebugger('{}')
    expect(mod.attachAuthResponseDiagnostics(dbg, { platform: 'douyin' })).toBe(false)
    expect(dbg.sendCommand.mock.calls.filter(c => c[0] === 'Network.enable').length).toBe(0)
  })
})

// ─── 头条号登录期观测（2026-10-21）───
// 动因：头条号登录链路的请求此前一条都不记（过滤面只有微信/腾讯域），
// 「点发送验证码后灰显几秒才弹图形验证码」现场无从归因，只能靠外部抓包倒推。
describe('login-network-diagnostics — 头条号登录期观测', () => {
  const TOUTIAO_SDK_URL = 'https://sf16-secsdk.ibytedtos.com/obj/rc-web-sdk-giso/webmssdk/1.0.0.303/webmssdk.js'
  const TOUTIAO_CAPTCHA_URL = 'https://sf16-scmcdn-va.ibytedtos.com/obj/static-us/secsdk-captcha/@latest/captcha.js'
  const TOUTIAO_BROKEN_URL = 'https://s3a.bytecdn.cn/ta/resource/v0/analytics.js'

  it('头条号用自己的监测域过滤面，不含微信域', () => {
    const ses = createSession()
    mod.attachLoginNetworkDiagnostics(ses, { platform: 'toutiao', accountId: 'acc1' })
    const urls = ses.webRequest.onCompleted.mock.calls[0][0].urls
    expect(urls).toContain('*://*.toutiao.com/*')
    expect(urls).toContain('*://*.ibytedtos.com/*')
    expect(urls).toContain('*://*.bytecdn.cn/*')
    expect(urls.some(u => u.indexOf('weixin.qq.com') !== -1)).toBe(false)
  })

  it('监测域与判定口径由独立模块承载（覆盖面与诊断机制分开）', () => {
    const monitor = require('./login-network-monitor')
    expect(monitor.monitoredHostsOf('toutiao')).toContain('toutiao.com')
    expect(monitor.monitoredHostsOf('douyin')).toBe(null)
    // 未登记平台 ⇒ 沿用默认（微信）过滤面，既有契约锁一字不变
    expect(monitor.urlFiltersFor('douyin', EXPECTED_URLS)).toBe(EXPECTED_URLS)
    expect(monitor.isMonitoredHost('toutiao', 'https://mp.toutiao.com/auth/page/login')).toBe(true)
    expect(monitor.isMonitoredHost('toutiao', 'https://sf16-secsdk.ibytedtos.com/x.js')).toBe(true)
    expect(monitor.isMonitoredHost('toutiao', 'https://example.com/x.js')).toBe(false)
  })

  it('未登记平台的过滤面一字不变（微信四条原样，既有契约锁不被破坏）', () => {
    const ses = createSession()
    mod.attachLoginNetworkDiagnostics(ses, { platform: 'wechat_mp', accountId: 'acc1' })
    expect(ses.webRequest.onCompleted.mock.calls[0][0].urls).toEqual(EXPECTED_URLS)
  })

  it('头条号代理解析探针指向自己的站点（回答「头条请求走哪条线路」）', () => {
    const ses = createSession()
    mod.attachLoginNetworkDiagnostics(ses, { platform: 'toutiao', accountId: 'acc1' })
    expect(ses.resolveProxy).toHaveBeenCalledWith('https://mp.toutiao.com/')
  })

  it('头条号的失败请求会被记录（字节自家 CDN 504 那类问题此前完全无痕）', () => {
    const ses = createSession()
    mod.attachLoginNetworkDiagnostics(ses, { platform: 'toutiao', accountId: 'acc1' })
    const onError = ses.webRequest.onErrorOccurred.mock.calls[0][1]
    onError({ url: TOUTIAO_BROKEN_URL, error: 'net::ERR_CONNECTION_RESET' })
    const line = log.notify.mock.calls.filter(c => c[1] === 'request-failed')
    expect(line.length).toBe(1)
    expect((line[0][2] || {}).params.url).toContain('s3a.bytecdn.cn')
  })

  it('头条号的 HTTP>=400 会被记录（504 这类「边缘节点超时」看得见）', () => {
    const ses = createSession()
    mod.attachLoginNetworkDiagnostics(ses, { platform: 'toutiao', accountId: 'acc1' })
    const onCompleted = ses.webRequest.onCompleted.mock.calls[0][1]
    onCompleted({ url: TOUTIAO_BROKEN_URL, statusCode: 504 })
    const line = log.notify.mock.calls.filter(c => c[1] === 'http-status-info')
    expect(line.length).toBe(1)
    expect((line[0][2] || {}).params.msg).toContain('504')
  })

  function attachToutiao () {
    const dbg = createDebugger('{}')
    expect(mod.attachAuthResponseDiagnostics(dbg, { platform: 'toutiao', accountId: 'a1' })).toBe(true)
    return messageHandler(dbg)
  }

  it('慢请求记一条 slow-request（带耗时与阈值）', async () => {
    const onMessage = attachToutiao()
    await onMessage(null, 'Network.requestWillBeSent', { requestId: 'r1', request: { url: TOUTIAO_BROKEN_URL }, timestamp: 100 })
    await onMessage(null, 'Network.loadingFinished', { requestId: 'r1', timestamp: 103.5, encodedDataLength: 560 })
    const line = log.notify.mock.calls.filter(c => c[1] === 'slow-request')
    expect(line.length).toBe(1)
    const params = (line[0][2] || {}).params
    expect(params.ms).toBe(3500)
    expect(params.thresholdMs).toBe(3000)
  })

  it('未达阈值不记 slow-request（快请求不刷屏）', async () => {
    const onMessage = attachToutiao()
    await onMessage(null, 'Network.requestWillBeSent', { requestId: 'r1', request: { url: TOUTIAO_SDK_URL }, timestamp: 100 })
    await onMessage(null, 'Network.loadingFinished', { requestId: 'r1', timestamp: 100.5, encodedDataLength: 100 })
    expect(log.notify.mock.calls.filter(c => c[1] === 'slow-request').length).toBe(0)
  })

  it('图形验证码组件加载完成记一条 captcha-sdk-loaded（灰显遮罩结束的时刻）', async () => {
    const onMessage = attachToutiao()
    await onMessage(null, 'Network.requestWillBeSent', { requestId: 'c1', request: { url: TOUTIAO_CAPTCHA_URL }, timestamp: 200 })
    await onMessage(null, 'Network.loadingFinished', { requestId: 'c1', timestamp: 201.1, encodedDataLength: 784373 })
    const line = log.notify.mock.calls.filter(c => c[1] === 'captcha-sdk-loaded')
    expect(line.length).toBe(1)
    const params = (line[0][2] || {}).params
    expect(params.ms).toBe(1100)
    expect(params.bytes).toBe(784373)
  })

  it('风控 SDK 主包同样被识别为验证码组件', async () => {
    const onMessage = attachToutiao()
    await onMessage(null, 'Network.requestWillBeSent', { requestId: 'c2', request: { url: TOUTIAO_SDK_URL }, timestamp: 200 })
    await onMessage(null, 'Network.loadingFinished', { requestId: 'c2', timestamp: 201.3, encodedDataLength: 520714 })
    const line = log.notify.mock.calls.filter(c => c[1] === 'captcha-sdk-loaded')
    expect(line.length).toBe(1)
  })

  it('验证码组件判定只认路径：查询串里带同名不算（防误报淹没真信号）', () => {
    const monitor = require('./login-network-monitor')
    expect(monitor.isCaptchaSdkUrl('https://sf16-secsdk.ibytedtos.com/obj/rc-web-sdk-giso/webmssdk/1.0.0.303/webmssdk.js')).toBe(true)
    expect(monitor.isCaptchaSdkUrl('https://sf16-scmcdn-va.ibytedtos.com/obj/static-us/secsdk-captcha/@latest/captcha.js')).toBe(true)
    // 查询串里出现标记名 → 不算
    expect(monitor.isCaptchaSdkUrl('https://sf16-secsdk.ibytedtos.com/collect?tag=webmssdk.js')).toBe(false)
    // 域名里出现标记名 → 不算（只有路径算）
    expect(monitor.isCaptchaSdkUrl('https://webmssdk.js.example.com/a.js')).toBe(false)
    // 同尾路径但不是版本目录 → 不算（2026-10-21 CCG 外部评审 i3）
    expect(monitor.isCaptchaSdkUrl('https://sf16-secsdk.ibytedtos.com/proxy/webmssdk.js')).toBe(false)
    expect(monitor.isCaptchaSdkUrl('not a url')).toBe(false)
  })

  it('监测域外的请求不计时（防把无关请求算进来）', async () => {
    const onMessage = attachToutiao()
    await onMessage(null, 'Network.requestWillBeSent', { requestId: 'x1', request: { url: 'https://example.com/a.js' }, timestamp: 100 })
    await onMessage(null, 'Network.loadingFinished', { requestId: 'x1', timestamp: 120, encodedDataLength: 1 })
    expect(log.notify.mock.calls.filter(c => c[1] === 'slow-request').length).toBe(0)
  })

  it('监测域内请求失败记一条 monitored-request-failed', async () => {
    const onMessage = attachToutiao()
    await onMessage(null, 'Network.requestWillBeSent', { requestId: 'f1', request: { url: TOUTIAO_SDK_URL }, timestamp: 100 })
    await onMessage(null, 'Network.loadingFailed', { requestId: 'f1', timestamp: 101, errorText: 'net::ERR_CONNECTION_RESET' })
    const line = log.notify.mock.calls.filter(c => c[1] === 'monitored-request-failed')
    expect(line.length).toBe(1)
  })

  it('隐私边界：头条号永不 getResponseBody（计时层只读事件，不读响应体）', async () => {
    const dbg = createDebugger('{"secret":"token"}')
    mod.attachAuthResponseDiagnostics(dbg, { platform: 'toutiao', accountId: 'a1' })
    const onMessage = messageHandler(dbg)
    await onMessage(null, 'Network.requestWillBeSent', { requestId: 'p1', request: { url: 'https://sso.toutiao.com/send_code' }, timestamp: 1 })
    await onMessage(null, 'Network.responseReceived', { requestId: 'p1', response: { url: 'https://sso.toutiao.com/send_code', status: 200 } })
    expect(dbg.sendCommand.mock.calls.filter(c => c[0] === 'Network.getResponseBody').length).toBe(0)
  })

  it('隐私闸门按平台判（不是按 URL 判）：计时平台即便收到知乎形状的 URL 也不读体', async () => {
    // 2026-10-21 CCG 外部评审 i2 的落点：闸门是「该平台**登记了**端点匹配器吗」，
    // 与具体 URL 无关 —— 计时平台（头条）即便收到任何响应都不得触发 getResponseBody。
    const dbg = createDebugger('{"secret":"token"}')
    mod.attachAuthResponseDiagnostics(dbg, { platform: 'toutiao', accountId: 'a1' })
    const onMessage = messageHandler(dbg)
    // 故意用知乎那个**已登记匹配器**的路径形状：若闸门被误改成「按 URL 判」，这里就会读体
    await onMessage(null, 'Network.requestWillBeSent', { requestId: 'p2', request: { url: 'https://www.zhihu.com/api/v4/signin/sms_send' }, timestamp: 1 })
    await onMessage(null, 'Network.responseReceived', { requestId: 'p2', response: { url: 'https://www.zhihu.com/api/v4/signin/sms_send', status: 200 } })
    expect(dbg.sendCommand.mock.calls.filter(c => c[0] === 'Network.getResponseBody').length).toBe(0)
  })

  it('微信平台不进入计时层（既有 observe-only 契约不被扩大）', () => {
    const monitor = require('./login-network-monitor')
    const dbg = createDebugger('{}')
    // wechat_mp 仍属 QR_BYTE_OBSERVE 档：挂接为真，但**不是**计时平台
    expect(monitor.TIMING_OBSERVE_PLATFORMS).not.toContain('wechat_mp')
    expect(monitor.TIMING_OBSERVE_PLATFORMS).toContain('toutiao')
    expect(mod.attachAuthResponseDiagnostics(dbg, { platform: 'douyin' })).toBe(false)
  })
})

// ─── 登录页噪音 cancel（MP_LOGIN_NOISE_CANCEL=1 才生效，默认关）───
const HELPER_MP4 = 'https://res.wx.qq.com/t/wx_fed/finder/static-assets/finder-common-assets/res/finder-helper/2560x864_helper.mp4'
const MCN_MP4 = 'https://res.wx.qq.com/t/wx_fed/finder/static-assets/finder-common-assets/res/finder-helper/2560x864_MCN.mp4'

describe('login-network-diagnostics — 登录页噪音 cancel', () => {
  const saved = process.env.MP_LOGIN_NOISE_CANCEL
  afterEach(() => {
    if (saved === undefined) delete process.env.MP_LOGIN_NOISE_CANCEL
    else process.env.MP_LOGIN_NOISE_CANCEL = saved
  })

  it('默认关：不注册 onBeforeRequest、返回 false', () => {
    delete process.env.MP_LOGIN_NOISE_CANCEL
    const ses = createSession()
    expect(mod.attachLoginPageNoiseCancel(ses, { platform: 'wechat_mp' })).toBe(false)
    expect(ses.webRequest.onBeforeRequest).not.toHaveBeenCalled()
  })

  it('开关打开时注册的 filter 必须精确到两个 host（防误伤本机服务）', () => {
    process.env.MP_LOGIN_NOISE_CANCEL = '1'
    const ses = createSession()
    expect(mod.attachLoginPageNoiseCancel(ses, { platform: 'wechat_mp' })).toBe(true)
    expect(ses.webRequest.onBeforeRequest).toHaveBeenCalledTimes(1)
    expect(ses.webRequest.onBeforeRequest.mock.calls[0][0].urls).toEqual([
      'https://res.wx.qq.com/*',
      'https://support.weixin.qq.com/cgi-bin/mmsupportmesh*',
    ])
  })

  it('只认两条完整常量 URL 与 mmsupportmesh 前缀，不按扩展名或 localhost 一刀切', () => {
    expect(mod.isLoginPageNoiseUrl(HELPER_MP4)).toBe(true)
    expect(mod.isLoginPageNoiseUrl(MCN_MP4)).toBe(true)
    expect(mod.isLoginPageNoiseUrl('https://support.weixin.qq.com/cgi-bin/mmsupportmeshnodelogicsvr-bin/cube?biz=3512')).toBe(true)
    expect(mod.isLoginPageNoiseUrl('https://mp.weixin.qq.com/other/bg.mp4')).toBe(false)
    expect(mod.isLoginPageNoiseUrl('https://localhost.weixin.qq.com:13013/api/check-login')).toBe(false)
    expect(mod.isLoginPageNoiseUrl('http://127.0.0.1:8299/api/health')).toBe(false)
  })

  it('命中即 cancel:true，未命中 cancel:false', () => {
    process.env.MP_LOGIN_NOISE_CANCEL = '1'
    const ses = createSession()
    mod.attachLoginPageNoiseCancel(ses, { platform: 'wechat_mp' })
    const handler = ses.webRequest.onBeforeRequest.mock.calls[0][1]
    let res = null
    handler({ url: MCN_MP4 }, r => { res = r })
    expect(res).toEqual({ cancel: true })
    handler({ url: 'https://res.wx.qq.com/a/keep.js' }, r => { res = r })
    expect(res).toEqual({ cancel: false })
  })
})