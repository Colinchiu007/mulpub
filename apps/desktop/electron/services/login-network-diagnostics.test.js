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
