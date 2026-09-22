// @ts-check
/**
 * http-login-checker 黑名单语义回归测试（登录态检测口径统一修复 2026-09-22）
 *
 * 缺陷背景：toutiao / bilibili / tencent_video / wechat_mp 的 check 采用白名单
 * 语义（Boolean(符合预期结构)），任何非预期响应（风控页、接口结构变更、字段
 * 命名差异）都被硬判失效，且短路浏览器检测——用户刚在批量登录标签保存了新
 * 凭证，一键检测仍报"今日头条已失效"（假阳性）。douyin 已按模块头声明的黑名
 * 单语义实现（仅平台明确告知未登录才判失效，其余 undefined 降级），本文件
 * 将其余平台收口到同一契约：
 * - 明确成功特征 → true；
 * - 明确未登录特征（文案/已知失效码）→ false；
 * - 其余一切 → undefined（CHECK_LOGIN_INCONCLUSIVE，降级浏览器检测）。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

describe('http-login-checker — 黑名单语义（不确定响应不判失效）', () => {
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
    vi.unstubAllGlobals()
  })

  function mockJsonResponse (data) {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(data),
      headers: new Map()
    }))
  }

  describe('toutiao', () => {
    it('code 0 且 user.id → valid（正向回归）', async () => {
      mockJsonResponse({ code: 0, data: { user: { id: '456', screen_name: '头条号' } } })
      const result = await checker.checkLoginViaHttpApi('toutiao', [{ name: 'sid_tt', value: 'v' }])
      expect(result).toEqual({ supported: true, valid: true, code: 'CHECK_LOGIN_SUCCESS_HTTP_API' })
    })

    it('code 0 但 user 缺 id（结构变更）→ inconclusive 降级（当前白名单语义误判失效）', async () => {
      mockJsonResponse({ code: 0, data: { user: { name: '无 id 字段的结构变体' } } })
      const result = await checker.checkLoginViaHttpApi('toutiao', [{ name: 'sid_tt', value: 'v' }])
      expect(result).toEqual({ supported: true, valid: undefined, code: 'CHECK_LOGIN_INCONCLUSIVE' })
    })

    it('响应非预期对象（风控页/HTML 转 JSON 失败 data=null）→ inconclusive 降级', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.reject(new Error('invalid json')),
        headers: new Map()
      }))
      const result = await checker.checkLoginViaHttpApi('toutiao', [{ name: 'sid_tt', value: 'v' }])
      expect(result).toEqual({ supported: true, valid: undefined, code: 'CHECK_LOGIN_INCONCLUSIVE' })
    })

    it('message 含「未登录」→ expired（明确未登录特征仍判失效）', async () => {
      mockJsonResponse({ code: 1002, message: '用户未登录，请先登录' })
      const result = await checker.checkLoginViaHttpApi('toutiao', [{ name: 'sid_tt', value: 'v' }])
      expect(result).toEqual({ supported: true, valid: false, code: 'CHECK_LOGIN_COOKIE_EXPIRED' })
    })
  })

  describe('bilibili', () => {
    it('code -101 → expired（明确未登录码）', async () => {
      mockJsonResponse({ code: -101, message: '账号未登录' })
      const result = await checker.checkLoginViaHttpApi('bilibili', [{ name: 'bili_jct', value: 'x' }])
      expect(result).toEqual({ supported: true, valid: false, code: 'CHECK_LOGIN_COOKIE_EXPIRED' })
    })

    it('code 0 且有 mid → valid', async () => {
      mockJsonResponse({ code: 0, data: { mid: 123456, uname: 'UP主' } })
      const result = await checker.checkLoginViaHttpApi('bilibili', [{ name: 'bili_jct', value: 'x' }])
      expect(result).toEqual({ supported: true, valid: true, code: 'CHECK_LOGIN_SUCCESS_HTTP_API' })
    })

    it('其他状态码（风控/临时故障）→ inconclusive 降级（当前误判失效）', async () => {
      mockJsonResponse({ code: -352, message: '风控校验失败' })
      const result = await checker.checkLoginViaHttpApi('bilibili', [{ name: 'bili_jct', value: 'x' }])
      expect(result).toEqual({ supported: true, valid: undefined, code: 'CHECK_LOGIN_INCONCLUSIVE' })
    })
  })

  describe('tencent_video', () => {
    it('errCode 300333/300334 → expired（明确失效码）', async () => {
      for (const errCode of [300333, 300334]) {
        mockJsonResponse({ errCode, errMsg: '登录失效' })
        const result = await checker.checkLoginViaHttpApi('tencent_video', [{ name: 'sessionid', value: 'x' }])
        expect(result).toEqual({ supported: true, valid: false, code: 'CHECK_LOGIN_COOKIE_EXPIRED' })
      }
    })

    it('errCode 0 且 finderUser → valid', async () => {
      mockJsonResponse({ errCode: 0, data: { finderUser: { uniqId: 'wxid_1' } } })
      const result = await checker.checkLoginViaHttpApi('tencent_video', [{ name: 'sessionid', value: 'x' }])
      expect(result).toEqual({ supported: true, valid: true, code: 'CHECK_LOGIN_SUCCESS_HTTP_API' })
    })

    it('未知结构（无 finderUser 也无失效 errCode）→ inconclusive 降级（当前误判失效）', async () => {
      mockJsonResponse({ errCode: 0, data: {} })
      const result = await checker.checkLoginViaHttpApi('tencent_video', [{ name: 'sessionid', value: 'x' }])
      expect(result).toEqual({ supported: true, valid: undefined, code: 'CHECK_LOGIN_INCONCLUSIVE' })
    })
  })

  describe('wechat_mp（HTML 判定）', () => {
    it('token+uin 同时存在 → valid', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true, status: 200, headers: new Map(),
        text: () => Promise.resolve('<html><script>uin: "12345678",</script><a href="/cgi-bin/home?token=abcdef123">go</a></html>')
      }))
      const result = await checker.checkLoginViaHttpApi('wechat_mp', [{ name: 'slave_sid', value: 'v' }])
      expect(result).toEqual({ supported: true, valid: true, code: 'CHECK_LOGIN_SUCCESS_HTTP_API' })
    })

    it('无 token 且含明确登录页特征（扫码登录文案）→ expired', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true, status: 200, headers: new Map(),
        text: () => Promise.resolve('<html><body><div class="login_title">请使用微信扫码登录</div></body></html>')
      }))
      const result = await checker.checkLoginViaHttpApi('wechat_mp', [{ name: 'slave_sid', value: 'x' }])
      expect(result).toEqual({ supported: true, valid: false, code: 'CHECK_LOGIN_COOKIE_EXPIRED' })
    })

    it('无 token 也无登录特征（风控页/结构变更）→ inconclusive 降级（当前误判失效）', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true, status: 200, headers: new Map(),
        text: () => Promise.resolve('<html><body>系统繁忙，请稍后重试</body></html>')
      }))
      const result = await checker.checkLoginViaHttpApi('wechat_mp', [{ name: 'slave_sid', value: 'x' }])
      expect(result).toEqual({ supported: true, valid: undefined, code: 'CHECK_LOGIN_INCONCLUSIVE' })
    })

    it('空响应体 → inconclusive 降级（不判失效）', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true, status: 200, headers: new Map(),
        text: () => Promise.resolve('')
      }))
      const result = await checker.checkLoginViaHttpApi('wechat_mp', [{ name: 'slave_sid', value: 'x' }])
      expect(result).toEqual({ supported: true, valid: undefined, code: 'CHECK_LOGIN_INCONCLUSIVE' })
    })
  })
})
