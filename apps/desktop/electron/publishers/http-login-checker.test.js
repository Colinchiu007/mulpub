// @ts-check
/**
 * HTTP API 登录检测测试 — 验证参考产品逆向分析的 API 端点调用与判定逻辑
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

describe('http-login-checker', () => {
  let checker

  beforeEach(async () => {
    vi.resetModules()
    global.__enableElectronMock()
    global.__resetElectronMock()
    __registerMock('./logger', { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })
    checker = await import('./http-login-checker.js')
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('isHttpCheckSupported', () => {
    it('douyin 和 toutiao 已注册', () => {
      expect(checker.isHttpCheckSupported('douyin')).toBe(true)
      expect(checker.isHttpCheckSupported('toutiao')).toBe(true)
    })

    it('公众号已注册（登录页与后台同域，需 HTTP 检测兜底）', () => {
      expect(checker.isHttpCheckSupported('wechat_mp')).toBe(true)
    })

    it('视频号已注册（渲染崩溃保护跳过浏览器检测，需 HTTP 检测识别 Cookie 过期）', () => {
      expect(checker.isHttpCheckSupported('tencent_video')).toBe(true)
    })

    it('bilibili 已注册（nav API 会话校验）', () => {
      expect(checker.isHttpCheckSupported('bilibili')).toBe(true)
    })

    it('未注册平台返回 false', () => {
      expect(checker.isHttpCheckSupported('kuaishou')).toBe(false)
    })
  })

  describe('cookiesToHeader', () => {
    it('Cookie 数组转请求头字符串', () => {
      const result = checker.cookiesToHeader([
        { name: 'sid', value: 'abc' },
        { name: 'token', value: 'xyz' }
      ])
      expect(result).toBe('sid=abc; token=xyz')
    })

    it('空数组返回空串', () => {
      expect(checker.cookiesToHeader([])).toBe('')
      expect(checker.cookiesToHeader(null)).toBe('')
    })
  })

  describe('checkLoginViaHttpApi', () => {
    it('未注册平台返回 supported: false', async () => {
      const result = await checker.checkLoginViaHttpApi('unknown_platform', [{ name: 'a', value: 'b' }])
      expect(result).toEqual({ supported: false })
    })

    it('视频号 POST body 的 timestamp 每次请求重新求值（不被模块加载时刻冻结）', async () => {
      const bodies = []
      vi.stubGlobal('fetch', vi.fn(async (url, options) => {
        bodies.push(options.body)
        return {
          ok: true,
          status: 200,
          headers: { get: () => '' },
          json: async () => ({ errCode: 0, data: { finderUser: { finderUsername: 'v1' } } }),
          text: async () => '',
        }
      }))
      const cookies = [{ name: 'sessionid', value: 'abc' }]

      const first = await checker.checkLoginViaHttpApi('tencent_video', cookies)
      await new Promise((resolve) => setTimeout(resolve, 15))
      const second = await checker.checkLoginViaHttpApi('tencent_video', cookies)
      vi.unstubAllGlobals()

      expect(first).toEqual(expect.objectContaining({ supported: true, valid: true }))
      expect(second).toEqual(expect.objectContaining({ supported: true, valid: true }))
      expect(bodies).toHaveLength(2)
      const ts1 = JSON.parse(bodies[0]).timestamp
      const ts2 = JSON.parse(bodies[1]).timestamp
      expect(ts1).not.toBe(ts2)
      // 时间戳必须是当前毫秒（13 位），不是模块 require 时的陈旧值
      expect(Math.abs(Number(ts2) - Date.now())).toBeLessThan(5000)
    })

    it('无 Cookie 时返回 NO_CREDENTIAL', async () => {
      const result = await checker.checkLoginViaHttpApi('douyin', [])
      expect(result).toEqual({ supported: true, valid: false, code: 'CHECK_LOGIN_NO_CREDENTIAL' })
    })

    it('抖音 API 成功响应 → valid', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ status_code: 0, data: { uid: '123', nickname: 'test' } }),
        headers: new Map()
      })
      vi.stubGlobal('fetch', mockFetch)

      const result = await checker.checkLoginViaHttpApi('douyin', [{ name: 'sid', value: 'valid' }])
      expect(result).toEqual({ supported: true, valid: true, code: 'CHECK_LOGIN_SUCCESS_HTTP_API' })
      expect(mockFetch).toHaveBeenCalledWith(
        'https://creator.douyin.com/aweme/v1/creator/pc/user/info/',
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({
            Cookie: 'sid=valid',
            Referer: 'https://creator.douyin.com/creator-micro/home'
          })
        })
      )
    })

    it('抖音 status_code 8（明确未登录）→ expired（对齐参考产品 checkAccountAlive）', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ status_code: 8, status_msg: '未登录' }),
        headers: new Map()
      }))

      const result = await checker.checkLoginViaHttpApi('douyin', [{ name: 'sid', value: 'expired' }])
      expect(result).toEqual({ supported: true, valid: false, code: 'CHECK_LOGIN_COOKIE_EXPIRED' })
    })

    it('抖音 status_msg/msg 含「未登录」→ expired（黑名单语义）', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ status_code: 2, msg: '当前用户未登录，请重新登录' }),
        headers: new Map()
      }))

      const result = await checker.checkLoginViaHttpApi('douyin', [{ name: 'sid', value: 'expired' }])
      expect(result).toEqual({ supported: true, valid: false, code: 'CHECK_LOGIN_COOKIE_EXPIRED' })
    })

    it('抖音 status_code 非 0 且非 8（风控码）→ inconclusive（降级浏览器检测，修复假阳性）', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ status_code: 9, status_msg: '请完成安全验证' }),
        headers: new Map()
      }))

      const result = await checker.checkLoginViaHttpApi('douyin', [{ name: 'sid', value: 'valid' }])
      expect(result).toEqual({ supported: true, valid: undefined, code: 'CHECK_LOGIN_INCONCLUSIVE' })
    })

    it('抖音 200 但响应非 JSON（data=null）→ inconclusive（风控页降级）', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.reject(new Error('invalid json')),
        headers: new Map()
      }))

      const result = await checker.checkLoginViaHttpApi('douyin', [{ name: 'sid', value: 'valid' }])
      expect(result).toEqual({ supported: true, valid: undefined, code: 'CHECK_LOGIN_INCONCLUSIVE' })
    })

    it('头条 code 0 且有 user.id → valid', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ code: 0, data: { user: { id: '456', screen_name: '头条号' } } }),
        headers: new Map()
      }))

      const result = await checker.checkLoginViaHttpApi('toutiao', [{ name: 'session', value: 'valid' }])
      expect(result).toEqual({ supported: true, valid: true, code: 'CHECK_LOGIN_SUCCESS_HTTP_API' })
    })

    it('公众号 loginpage HTML 无 token 但含明确登录页特征 → expired（回归：Cookie 过期但后台骨架仍 200）', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Map(),
        text: () => Promise.resolve('<html><body><div class="login_title">请使用微信扫码登录</div></body></html>')
      }))

      const result = await checker.checkLoginViaHttpApi('wechat_mp', [{ name: 'slave_sid', value: 'expired' }])
      expect(result).toEqual({ supported: true, valid: false, code: 'CHECK_LOGIN_COOKIE_EXPIRED' })
    })

    it('公众号 loginpage HTML 含 token 和 uin → valid（对齐参考产品正则解析）', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Map(),
        text: () => Promise.resolve('<html><script>window.cgiData = {nick_name: "测试号", uin: "12345678"};</script><a href="/cgi-bin/home?t=home/index&token=abcdef123456">首页</a></html>')
      }))

      const result = await checker.checkLoginViaHttpApi('wechat_mp', [{ name: 'slave_sid', value: 'valid' }])
      expect(result).toEqual({ supported: true, valid: true, code: 'CHECK_LOGIN_SUCCESS_HTTP_API' })
    })

    it('视频号 auth_data 返回 errCode 300333 → expired（对齐参考产品失效判定）', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Map(),
        json: () => Promise.resolve({ errCode: 300333, errMsg: '登录失效' })
      }))

      const result = await checker.checkLoginViaHttpApi('tencent_video', [{ name: 'sessionid', value: 'expired' }])
      expect(result).toEqual({ supported: true, valid: false, code: 'CHECK_LOGIN_COOKIE_EXPIRED' })
    })

    it('视频号 auth_data 返回 finderUser → valid', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Map(),
        json: () => Promise.resolve({ errCode: 0, data: { finderUser: { uniqId: 'wxid_123', nickname: '视频号' } } })
      }))

      const result = await checker.checkLoginViaHttpApi('tencent_video', [{ name: 'sessionid', value: 'valid' }])
      expect(result).toEqual({ supported: true, valid: true, code: 'CHECK_LOGIN_SUCCESS_HTTP_API' })
      // 必须 POST auth_data 接口
      expect(fetch).toHaveBeenCalledWith(
        'https://channels.weixin.qq.com/cgi-bin/mmfinderassistant-bin/auth/auth_data',
        expect.objectContaining({ method: 'POST' })
      )
    })

    it('bilibili cookie 缺 bili_jct → expired（对齐参考产品前置校验）', async () => {
      const result = await checker.checkLoginViaHttpApi('bilibili', [{ name: 'SESSDATA', value: 'abc' }])
      expect(result).toEqual({ supported: true, valid: false, code: 'CHECK_LOGIN_COOKIE_EXPIRED' })
    })

    it('bilibili nav 返回 code -101 → expired', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Map(),
        json: () => Promise.resolve({ code: -101, message: '账号未登录' })
      }))

      const result = await checker.checkLoginViaHttpApi('bilibili', [{ name: 'bili_jct', value: 'x' }])
      expect(result).toEqual({ supported: true, valid: false, code: 'CHECK_LOGIN_COOKIE_EXPIRED' })
    })

    it('bilibili nav 返回 code 0 且有 mid → valid', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Map(),
        json: () => Promise.resolve({ code: 0, data: { mid: 123456, uname: 'UP主' } })
      }))

      const result = await checker.checkLoginViaHttpApi('bilibili', [{ name: 'bili_jct', value: 'x' }])
      expect(result).toEqual({ supported: true, valid: true, code: 'CHECK_LOGIN_SUCCESS_HTTP_API' })
    })

    it('302 重定向且 Location 指向登录页 → expired', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: false,
        status: 302,
        headers: new Map([['location', 'https://creator.douyin.com/login']])
      }))

      const result = await checker.checkLoginViaHttpApi('douyin', [{ name: 'sid', value: 'expired' }])
      expect(result).toEqual({ supported: true, valid: false, code: 'CHECK_LOGIN_COOKIE_EXPIRED' })
    })

    it('302 重定向但 Location 无登录特征 → inconclusive（可能是风控跳转，降级）', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: false,
        status: 302,
        headers: new Map([['location', 'https://creator.douyin.com/verify']])
      }))

      const result = await checker.checkLoginViaHttpApi('douyin', [{ name: 'sid', value: 'valid' }])
      expect(result).toEqual({ supported: true, valid: undefined, code: 'CHECK_LOGIN_INCONCLUSIVE' })
    })

    it('302 重定向且拿不到 Location → inconclusive（降级）', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: false,
        status: 302,
        headers: new Map()
      }))

      const result = await checker.checkLoginViaHttpApi('douyin', [{ name: 'sid', value: 'valid' }])
      expect(result).toEqual({ supported: true, valid: undefined, code: 'CHECK_LOGIN_INCONCLUSIVE' })
    })

    it('401/403 → expired（平台明确未授权）', async () => {
      for (const status of [401, 403]) {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
          ok: false,
          status,
          headers: new Map()
        }))
        const result = await checker.checkLoginViaHttpApi('douyin', [{ name: 'sid', value: 'expired' }])
        expect(result).toEqual({ supported: true, valid: false, code: 'CHECK_LOGIN_COOKIE_EXPIRED' })
      }
    })

    it('404/429/500 → inconclusive（可能是风控/临时故障，降级浏览器检测）', async () => {
      for (const status of [404, 429, 500]) {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
          ok: false,
          status,
          headers: new Map()
        }))
        const result = await checker.checkLoginViaHttpApi('douyin', [{ name: 'sid', value: 'valid' }])
        expect(result).toEqual({ supported: true, valid: undefined, code: 'CHECK_LOGIN_INCONCLUSIVE' })
      }
    })

    it('网络错误返回 valid: undefined（降级到浏览器检测）', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')))

      const result = await checker.checkLoginViaHttpApi('douyin', [{ name: 'sid', value: 'x' }])
      expect(result.supported).toBe(true)
      expect(result.valid).toBeUndefined()
      expect(result.code).toBe('CHECK_LOGIN_HTTP_ERROR')
    })
  })
})
