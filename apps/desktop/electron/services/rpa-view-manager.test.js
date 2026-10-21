import { beforeEach, describe, expect, it, vi } from 'vitest'

__enableElectronMock()

// logger mock：用 __registerMock 拦截 require('./logger')，resetModules 后仍生效
const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), notify: vi.fn() }
__registerMock('./logger', log)

const supportsApi = vi.fn()
const shouldUseApi = vi.fn()
const publishViaApi = vi.fn()
const bindSignerCookieMock = vi.fn()

__registerMock('@multi-publish/api-publish-engine', {
  supportsApi,
  publishViaApi,
  apiRouter: { shouldUseApi },
})

__registerMock('../signer/provider', {
  bindSignerCookie: bindSignerCookieMock,
  setupSignerAssembly: vi.fn(),
  __resetSignerAssemblyForTest: vi.fn(),
})

let RpaViewManager

beforeEach(async () => {
  vi.clearAllMocks()
  vi.resetModules()
  const module = await import('./rpa-view-manager.js')
  RpaViewManager = module.default || module
})

describe('RpaViewManager API 路由', () => {
  it('平台配置与适配器同时允许时优先走 API', async () => {
    shouldUseApi.mockReturnValue(true)
    supportsApi.mockReturnValue(true)
    publishViaApi.mockResolvedValue({ success: true, publishId: 'api-1' })
    const manager = new RpaViewManager()

    await expect(manager.publish(
      'weibo',
      { title: '标题' },
      { cookies: [{ name: 'session', value: 'secret' }] },
      1000,
    )).resolves.toEqual({ success: true, publishId: 'api-1' })

    expect(shouldUseApi).toHaveBeenCalledWith('weibo')
    expect(publishViaApi).toHaveBeenCalledTimes(1)
  })

  it('API-first 分支把 article 翻译为适配器契约的 taskData（video_path → video.path）', async () => {
    // 根因（2026-09-28 活体）：裸 article 直传导致 kuaishou 适配器
    // fail-closed（taskData.video.path required）→ 回退 DOM 轨。
    shouldUseApi.mockReturnValue(true)
    supportsApi.mockReturnValue(true)
    publishViaApi.mockResolvedValue({ success: true, publishId: 'api-v' })
    const manager = new RpaViewManager()

    await manager.publish(
      'kuaishou',
      {
        title: '视频标题', content: '描述', tags: ['tag1'],
        video_path: 'D:\\v\\01.mp4', cover_path: 'D:\\v\\cover.png',
        draft: false, aiGenerated: true,
      },
      { cookies: [{ name: 'k', value: 'v' }] },
      1000,
    )

    expect(publishViaApi).toHaveBeenCalledTimes(1)
    const sentTaskData = publishViaApi.mock.calls[0][1]
    expect(sentTaskData.video).toEqual({ path: 'D:\\v\\01.mp4', duration: 0, width: 0, height: 0 })
    expect(sentTaskData.title).toBe('视频标题')
    expect(sentTaskData.cover).toBe('D:\\v\\cover.png')
    expect(sentTaskData.tags).toEqual(['tag1'])
    // 裸 article 的扁平字段不得泄漏进 taskData
    expect(sentTaskData.video_path).toBeUndefined()
  })

  it('API-first 分支随 opts 下传 accountId（签名页 sessionKey）并预绑账号 cookie', async () => {
    // 根因（2026-09-28 活体 6.3 第六层）：签名页多账号隔离 fail-closed——
    // sessionKey=accountId 必须随 opts 下传（链 payload.accountId → 装配 ctx.sessionKey），
    // 且求签前 bindSignerCookie 绑定账号 cookie（in-proc，不经 renderer）。
    shouldUseApi.mockReturnValue(true)
    supportsApi.mockReturnValue(true)
    publishViaApi.mockResolvedValue({ success: true, publishId: 'api-acc' })
    const manager = new RpaViewManager()

    await manager.publish(
      'kuaishou',
      {
        title: 't', video_path: 'D:\\v\\01.mp4',
        accountId: 'acc-77',
      },
      { cookies: [{ name: 'kuaishou.web.cp.api_st', value: 'sess' }] },
      1000,
    )

    expect(publishViaApi).toHaveBeenCalledTimes(1)
    const sentOpts = publishViaApi.mock.calls[0][3]
    expect(sentOpts.accountId).toBe('acc-77')
    expect(bindSignerCookieMock).toHaveBeenCalledWith('kuaishou', 'acc-77', 'kuaishou.web.cp.api_st=sess')
  })

  it('has_api 关闭时即使存在适配器也直接走 RPA', async () => {
    shouldUseApi.mockReturnValue(false)
    supportsApi.mockReturnValue(true)
    const manager = new RpaViewManager()
    const win = { destroy: vi.fn() }
    vi.spyOn(manager, '_createWindow').mockReturnValue(win)
    vi.spyOn(manager, '_publish_wechat_mp').mockResolvedValue({ success: true, platform: 'wechat_mp' })

    await expect(manager.publish('wechat_mp', { accountId: 'acc-1' }, {}, 1000))
      .resolves.toEqual({ success: true, platform: 'wechat_mp', track: 'dom' })

    expect(publishViaApi).not.toHaveBeenCalled()
    expect(manager._createWindow).toHaveBeenCalledTimes(1)
  })

  it('账号绑定代理时跳过 API，并在恢复凭证前设置 Electron 代理', async () => {
    shouldUseApi.mockReturnValue(true)
    supportsApi.mockReturnValue(true)
    const manager = new RpaViewManager()
    const events = []
    const win = {
      destroy: vi.fn(),
      webContents: {
        session: { setProxy: vi.fn(async () => { events.push('proxy') }) },
      },
    }
    vi.spyOn(manager, '_createWindow').mockReturnValue(win)
    vi.spyOn(manager, '_restoreCookies').mockImplementation(async () => { events.push('cookies') })
    vi.spyOn(manager, '_publish_wechat_mp').mockImplementation(async () => {
      events.push('publish')
      return { success: true, platform: 'wechat_mp' }
    })

    await expect(manager.publish(
      'wechat_mp',
      { accountId: 'acc-proxy' },
      {
        cookies: [{ name: 'sid', value: 'secret', domain: '.mp.weixin.qq.com' }],
        proxy: { host: '127.0.0.1', port: 8080, type: 'http' },
      },
      1000,
    )).resolves.toEqual({ success: true, platform: 'wechat_mp', track: 'dom' })

    expect(publishViaApi).not.toHaveBeenCalled()
    expect(win.webContents.session.setProxy).toHaveBeenCalledWith({ proxyRules: 'http://127.0.0.1:8080' })
    expect(events).toEqual(['proxy', 'cookies', 'publish'])
  })

  it('在平台认证来源加载完成后恢复 localStorage 和 IndexedDB', async () => {
    shouldUseApi.mockReturnValue(false)
    supportsApi.mockReturnValue(false)
    const events = []
    const handlers = []
    const win = {
      destroy: vi.fn(),
      webContents: {
        session: { cookies: { set: vi.fn() } },
        once: vi.fn((_event, handler) => handlers.push(handler)),
        loadURL: vi.fn(async (url) => {
          events.push('load:' + url)
          await Promise.all(handlers.splice(0).map(handler => handler()))
        }),
        executeJavaScript: vi.fn(async (script) => {
          events.push(script.includes('localStorage.setItem') ? 'local-storage' : 'indexed-db')
        }),
      },
    }
    const manager = new RpaViewManager()
    vi.spyOn(manager, '_createWindow').mockReturnValue(win)
    vi.spyOn(manager, '_publish_wechat_mp').mockImplementation(async () => {
      events.push('publish')
      return { success: true, platform: 'wechat_mp' }
    })

    await expect(manager.publish(
      'wechat_mp',
      { accountId: 'acc-storage' },
      { localStorage: { token: 'private' }, indexedDB: { auth: { tokens: [] } } },
      1000,
    )).resolves.toEqual({ success: true, platform: 'wechat_mp', track: 'dom' })

    expect(events).toEqual([
      'load:https://mp.weixin.qq.com/',
      'local-storage',
      'indexed-db',
      'publish',
    ])
  })

  it('代理设置失败时中止发布，不能回退为直连', async () => {
    shouldUseApi.mockReturnValue(true)
    supportsApi.mockReturnValue(true)
    const manager = new RpaViewManager()
    const win = {
      destroy: vi.fn(),
      webContents: { session: { setProxy: vi.fn(async () => { throw new Error('代理不可用') }) } },
    }
    vi.spyOn(manager, '_createWindow').mockReturnValue(win)
    const publishSpy = vi.spyOn(manager, '_publish_wechat_mp')

    await expect(manager.publish(
      'wechat_mp',
      { accountId: 'acc-proxy' },
      { proxy: { host: '127.0.0.1', port: 8080, type: 'http' } },
      1000,
    )).resolves.toMatchObject({ success: false, error: '代理不可用' })

    expect(publishViaApi).not.toHaveBeenCalled()
    expect(publishSpy).not.toHaveBeenCalled()
  })

  describe('logging-coverage-audit：失败分支日志合同', () => {
    it('RPA publish 返回 success:false 时必须记 warn 日志（此前完全无日志）', async () => {
      shouldUseApi.mockReturnValue(false)
      const manager = new RpaViewManager()
      const win = { destroy: vi.fn() }
      vi.spyOn(manager, '_createWindow').mockReturnValue(win)
      vi.spyOn(manager, '_publish_wechat_mp').mockResolvedValue({
        success: false,
        error: '微信公众号登录超时，请重新登录',
        platform: 'wechat_mp',
      })

      const result = await manager.publish('wechat_mp', { accountId: 'acc-log' }, {}, 1000)

      expect(result).toMatchObject({ success: false, platform: 'wechat_mp' })
      const warnCalls = log.warn.mock.calls.filter(args => String(args[1]).includes('publish failed'))
      expect(warnCalls.length).toBeGreaterThanOrEqual(1)
      expect(warnCalls[0][1]).toContain('platform=wechat_mp')
      expect(warnCalls[0][1]).toContain('登录超时')
    })

    it('API publish 返回 success:false 时也必须记日志（降级到 RPA 前）', async () => {
      shouldUseApi.mockReturnValue(true)
      supportsApi.mockReturnValue(true)
      publishViaApi.mockResolvedValue({ success: false, error: 'API cookie 过期' })
      const manager = new RpaViewManager()
      const win = { destroy: vi.fn() }
      vi.spyOn(manager, '_createWindow').mockReturnValue(win)
      vi.spyOn(manager, '_publish_wechat_mp').mockResolvedValue({ success: true, platform: 'wechat_mp' })

      await manager.publish('wechat_mp', {}, {}, 1000)

      const warnCalls = log.warn.mock.calls.filter(args => String(args[1]).includes('API publish returned failure'))
      expect(warnCalls.length).toBeGreaterThanOrEqual(1)
    })
  })
})
