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
  vi.spyOn(log, 'warn').mockImplementation(function () {})
  vi.spyOn(log, 'info').mockImplementation(function () {})
  mod = require('./login-network-diagnostics')
})

// 构造 mock session：webRequest 注册记录 + resolveProxy Promise
function createSession (proxyResult) {
  return {
    webRequest: {
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

    expect(log.info).toHaveBeenCalledWith('LoginNetDiag', expect.stringContaining('proxy for open.weixin.qq.com → PROXY 127.0.0.1:7892'))

    const failSes = createSession()
    failSes.resolveProxy.mockRejectedValue(new Error('boom'))
    mod.attachLoginNetworkDiagnostics(failSes, { platform: 'wechat_mp', accountId: 'acc1' })
    await flush()

    expect(log.warn).toHaveBeenCalledWith('LoginNetDiag', expect.stringContaining('resolveProxy failed: boom'))
  })

  it('缺省 ctx 时 tag 使用 unknown', () => {
    const ses = createSession()
    mod.attachLoginNetworkDiagnostics(ses)
    const handler = ses.webRequest.onErrorOccurred.mock.calls[0][1]
    handler({ url: 'https://mp.weixin.qq.com/x', error: 'ERR_CONNECTION_RESET' })

    expect(log.warn).toHaveBeenCalledWith('LoginNetDiag', expect.stringContaining('[unknown/unknown]'))
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

    expect(log.warn).toHaveBeenCalledTimes(1)
    const msg = log.warn.mock.calls[0][1]
    expect(msg).toContain('[wechat_mp/acc1] request failed: https://open.weixin.qq.com/cgi-bin/mpqrconnect')
    expect(msg).toContain('error=ERR_TUNNEL_CONNECTION_FAILED')
    expect(msg).toContain('ip=1.2.3.4')
    expect(msg).toContain('代理不可达或认证失败')
  })

  it('ERR_ABORTED 不打日志（正常导航取消，降噪）', () => {
    const ses = createSession()
    mod.attachLoginNetworkDiagnostics(ses, { platform: 'wechat_mp', accountId: 'acc1' })
    getErrorHandler(ses)({ url: 'https://res.wx.qq.com/a.js', error: 'ERR_ABORTED' })

    expect(log.warn).not.toHaveBeenCalled()
    expect(log.info).not.toHaveBeenCalled()
  })

  it('details.ip 缺省时不追加 ip 字段', () => {
    const ses = createSession()
    mod.attachLoginNetworkDiagnostics(ses, { platform: 'wechat_mp', accountId: 'acc1' })
    getErrorHandler(ses)({ url: 'https://mp.weixin.qq.com/', error: 'ERR_CONNECTION_RESET' })

    const msg = log.warn.mock.calls[0][1]
    expect(msg).not.toContain('ip=')
    expect(msg).toContain('连接失败：检查防火墙/代理节点可用性')
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

    expect(log.warn).toHaveBeenCalledTimes(1)
    expect(log.warn.mock.calls[0][1]).toContain('HTTP 502 https://open.weixin.qq.com/cgi-bin/mpqrconnect')
    expect(log.info).not.toHaveBeenCalled()
  })

  it('其他 URL HTTP 404 → info', () => {
    const ses = createSession()
    mod.attachLoginNetworkDiagnostics(ses, { platform: 'wechat_mp', accountId: 'acc1' })
    getCompletedHandler(ses)({ url: 'https://res.wx.qq.com/missing.js', statusCode: 404 })

    expect(log.info).toHaveBeenCalledTimes(1)
    expect(log.info.mock.calls[0][1]).toContain('HTTP 404 https://res.wx.qq.com/missing.js')
    expect(log.warn).not.toHaveBeenCalled()
  })

  it('HTTP 200 → 无日志', () => {
    const ses = createSession()
    mod.attachLoginNetworkDiagnostics(ses, { platform: 'wechat_mp', accountId: 'acc1' })
    getCompletedHandler(ses)({ url: 'https://long.open.weixin.qq.com/connect', statusCode: 200 })

    expect(log.warn).not.toHaveBeenCalled()
    expect(log.info).not.toHaveBeenCalled()
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

    expect(log.info).toHaveBeenCalledTimes(1)
    expect(log.info.mock.calls[0][0]).toBe('LoginNetDiag')
    expect(log.info.mock.calls[0][1]).toMatch(
      /^\[wechat_mp\/auth-1\] qr response #1 after \d+ms status=200 contentLength=7632$/)
  })

  it('HTTP 200 + content-length 0（微信静默拒绝特征）→ 如实记录 contentLength=0', () => {
    const ses = attach()
    getCompletedHandler(ses)({
      url: QR_URL,
      statusCode: 200,
      responseHeaders: { headers: [{ name: 'content-length', value: '0' }] }
    })

    expect(log.info.mock.calls[0][1]).toMatch(
      /^\[wechat_mp\/auth-1\] qr response #1 after \d+ms status=200 contentLength=0$/)
  })

  it('响应头缺失 → 不追加 contentLength 字段，耗时仍被记录（边界）', () => {
    const ses = attach()
    getCompletedHandler(ses)({ url: QR_URL, statusCode: 200 })

    expect(log.info.mock.calls[0][1]).toMatch(
      /^\[wechat_mp\/auth-1\] qr response #1 after \d+ms status=200$/)
  })

  it('出码尝试逐次编号，超过上限后不再记录（防反复刷新刷屏）', () => {
    const ses = attach()
    const handler = getCompletedHandler(ses)

    for (let i = 0; i < 8; i++) handler({ url: QR_URL, statusCode: 200 })

    const seq = log.info.mock.calls
      .map(function (c) { return String(c[1]) })
      .filter(function (m) { return m.indexOf('qr response #') !== -1 })
      .map(function (m) { return m.replace(/after \d+ms/, 'after Xms') })
    expect(seq).toEqual([
      '[wechat_mp/auth-1] qr response #1 after Xms status=200',
      '[wechat_mp/auth-1] qr response #2 after Xms status=200',
      '[wechat_mp/auth-1] qr response #3 after Xms status=200',
      '[wechat_mp/auth-1] qr response #4 after Xms status=200',
      '[wechat_mp/auth-1] qr response #5 after Xms status=200',
      '[wechat_mp/auth-1] qr response #6 after Xms status=200'
    ])
  })

  it('长轮询 l/qrconnect 的 200 不计入出码日志（回归：既有"200→无日志"契约不被破坏）', () => {
    const ses = attach()
    getCompletedHandler(ses)({ url: 'https://long.open.weixin.qq.com/connect/l/qrconnect?uuid=x', statusCode: 200 })

    expect(log.info).not.toHaveBeenCalled()
    expect(log.warn).not.toHaveBeenCalled()
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

    expect(mod.attachAuthResponseDiagnostics(dbg, { platform: 'wechat_mp', accountId: 'a1' })).toBe(false)
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
    expect(log.warn).not.toHaveBeenCalled()
  })
})

describe('login-network-diagnostics — attachAuthResponseDiagnostics 响应判定', () => {
  it('知乎 200 + error 体（风控拒绝的典型形态）→ warn 记 code 与 message', async () => {
    const dbg = createDebugger(JSON.stringify({ error: { code: 10001, message: '请求参数异常，请升级客户端后重试' } }))
    mod.attachAuthResponseDiagnostics(dbg, { platform: 'zhihu', accountId: 'auth-zhihu-1' })

    await messageHandler(dbg)({}, 'Network.responseReceived', {
      requestId: 'r1', response: { url: ZHIHU_SMS_URL, status: 200 },
    })

    expect(log.warn).toHaveBeenCalledTimes(1)
    expect(log.warn.mock.calls[0][0]).toBe('LoginRespDiag')
    // 精确结构断言（QM-3）：整条摘要逐字符锁定，防止字段顺序/分隔符漂移
    expect(log.warn.mock.calls[0][1]).toBe(
      '[zhihu/auth-zhihu-1] 关键端点被拒 url=' + ZHIHU_SMS_URL + ' http=200 code=10001 message=请求参数异常，请升级客户端后重试',
    )
    expect(log.info).not.toHaveBeenCalled()
  })

  it('成功体（无 error）→ 不记任何日志，但确实查过响应体', async () => {
    const dbg = createDebugger(JSON.stringify({ success: true }))
    mod.attachAuthResponseDiagnostics(dbg, { platform: 'zhihu', accountId: 'a1' })

    await messageHandler(dbg)({}, 'Network.responseReceived', {
      requestId: 'r1', response: { url: ZHIHU_SMS_URL, status: 200 },
    })

    expect(log.warn).not.toHaveBeenCalled()
    expect(log.info).not.toHaveBeenCalled()
    expect(dbg.sendCommand).toHaveBeenCalledWith('Network.getResponseBody', { requestId: 'r1' })
  })

  it('HTTP >= 400 且响应体不可解析 → 仍记一条含状态码的 warn（降级不丢信号）', async () => {
    const dbg = createDebugger('not-json-at-all')
    mod.attachAuthResponseDiagnostics(dbg, { platform: 'zhihu', accountId: 'a1' })

    await messageHandler(dbg)({}, 'Network.responseReceived', {
      requestId: 'r1', response: { url: ZHIHU_SMS_URL, status: 403 },
    })

    expect(log.warn).toHaveBeenCalledTimes(1)
    expect(log.warn.mock.calls[0][1]).toBe(
      '[zhihu/a1] 关键端点被拒 url=' + ZHIHU_SMS_URL + ' http=403 code=<none> message=<unparsable>',
    )
  })

  it('响应体已被网络栈回收（getResponseBody 抛错）→ 记 HTTP 状态且不产生未处理拒绝', async () => {
    const dbg = createDebugger('', { rejectBody: true })
    mod.attachAuthResponseDiagnostics(dbg, { platform: 'zhihu', accountId: 'a1' })

    await expect(messageHandler(dbg)({}, 'Network.responseReceived', {
      requestId: 'missing', response: { url: ZHIHU_SMS_URL, status: 500 },
    })).resolves.toBeUndefined()

    expect(log.warn).toHaveBeenCalledTimes(1)
    expect(log.warn.mock.calls[0][1]).toContain('http=500')
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
    expect(log.warn).not.toHaveBeenCalled()
  })

  it('无关 CDP 事件（Fetch.requestPaused 等）→ 完全忽略', async () => {
    const dbg = createDebugger('{}')
    mod.attachAuthResponseDiagnostics(dbg, { platform: 'zhihu', accountId: 'a1' })

    await messageHandler(dbg)({}, 'Fetch.requestPaused', { requestId: 'r1' })

    expect(log.warn).not.toHaveBeenCalled()
    expect(log.info).not.toHaveBeenCalled()
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

    expect(log.warn).toHaveBeenCalledTimes(1)
    expect(log.warn.mock.calls[0][1]).toBe(
      '[zhihu/a1] 关键端点请求失败 url=' + ZHIHU_SMS_URL + ' netError=ERR_PROXY_CONNECTION_FAILED → 代理不可达或认证失败：检查系统代理与账号代理设置',
    )
  })

  it('requestWillBeSent 对非关键端点不登记、不记日志', async () => {
    const dbg = createDebugger('{}')
    mod.attachAuthResponseDiagnostics(dbg, { platform: 'zhihu', accountId: 'a1' })
    const handler = messageHandler(dbg)

    await handler({}, 'Network.requestWillBeSent', {
      requestId: 'r10', request: { url: 'https://static.zhihu.com/zse-asset/v4/main.js' }, type: 'Script',
    })
    await handler({}, 'Network.loadingFailed', { requestId: 'r10', errorText: 'ERR_ABORTED' })

    expect(log.warn).not.toHaveBeenCalled()
  })
})

describe('login-network-diagnostics — attachAuthResponseDiagnostics 日志脱敏（安全锁）', () => {
  // 日志只允许「端点 + 状态码 + error.code + error.message」四类诊断字段，
  // 绝不整体转储响应体，也绝不记录 URL 的 query/hash —— 知乎短信请求的 query/body
  // 会带手机号，部分接口响应会带 token。
  const SECRET_PHONE = '13800001111'
  const SECRET_TOKEN = 'Bearer.zhihu.session.token'

  const allLoggedText = () => [log.warn, log.info]
    .flatMap((fn) => fn.mock.calls.map((c) => c.join(' ')))
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

    expect(log.warn).toHaveBeenCalledTimes(1)
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
    expect(log.warn.mock.calls[0][1]).toBe(
      '[zhihu/a1] 关键端点被拒 url=' + ZHIHU_SMS_URL + ' http=200 code=100 message=客户端异常',
    )
  })

  it('超长 message 截断，不整段回显', async () => {
    const long = '详细风控说明'.repeat(60)
    const dbg = createDebugger(JSON.stringify({ error: { code: 100, message: long } }))
    mod.attachAuthResponseDiagnostics(dbg, { platform: 'zhihu', accountId: 'a1' })

    await messageHandler(dbg)({}, 'Network.responseReceived', {
      requestId: 'r1', response: { url: ZHIHU_SMS_URL, status: 200 },
    })

    const msg = log.warn.mock.calls[0][1]
    expect(msg.length).toBeLessThanOrEqual(300)
    expect(msg).toMatch(/\.\.\.$/)
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
