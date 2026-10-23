// @vitest-environment node
/**
 * auth-view-saved-account — 「打开已保存账号」的特征测试
 *
 * 为什么是**特征测试**（`openspec/specs/desktop/spec.md` 的「纯平移重构必须先有特征测试并有反证」）：
 * 本实现从 `auth-view-manager.js` 平移出来（该文件已超行数门禁的容差，本仓要求拆分），
 * 平移的正当性**只**来自「行为逐字不变」——所以先把当前真实行为钉住（成功路径 + 两条降级分支），
 * 平移前后同一套用例必须都绿。
 *
 * 覆盖：
 *  ① 平台不支持 ⇒ 直接返回，不建视图、不发事件（降级分支一）；
 *  ② 没有主窗口 ⇒ 直接返回（降级分支二）；
 *  ③ 成功路径：建一次性分区（`auth-saved-<platform>-<ts>`，**不进登录槽位**）、
 *     只注入该平台域的 Cookie、恢复 localStorage / IndexedDB、导航到登录页、发 `auth:view-opened`；
 *  ④ Escape ⇒ 取消并关闭（先 resolve 再 close，避免 Promise 泄漏）。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

__enableElectronMock()

let openSavedAccount
let AuthViewManager
let createdViews
let createdSessions
let mainWindow

beforeEach(async () => {
  vi.useFakeTimers()
  vi.resetModules()
  __resetElectronMock()
  createdViews = []
  createdSessions = []
  mainWindow = {
    getBounds: () => ({ x: 0, y: 0, width: 1440, height: 900 }),
    getContentBounds: () => ({ x: 8, y: 39, width: 1424, height: 861 }),
    isDestroyed: () => false,
    webContents: { send: vi.fn() },
    contentView: { addChildView: vi.fn(), removeChildView: vi.fn() },
  }
  __electronMock.session.fromPartition = vi.fn(function (partition) {
    const ses = {
      partition,
      cookies: { get: vi.fn().mockResolvedValue([]), set: vi.fn().mockResolvedValue(undefined) },
      clearStorageData: vi.fn().mockResolvedValue(undefined),
      clearCache: vi.fn().mockResolvedValue(undefined),
    }
    createdSessions.push(ses)
    return ses
  })
  __electronMock.WebContentsView = vi.fn(function () {
    const view = {
      setBounds: vi.fn(),
      setVisible: vi.fn(),
      webContents: {
        session: createdSessions[createdSessions.length - 1],
        executeJavaScript: vi.fn().mockResolvedValue('测试账号'),
        loadURL: vi.fn().mockResolvedValue(undefined),
        close: vi.fn(),
        on: vi.fn(),
      },
    }
    createdViews.push(view)
    return view
  })
  const mod = await import('./auth-view-saved-account.js')
  openSavedAccount = mod.openSavedAccount
  const mgrMod = await import('./auth-view-manager.js')
  AuthViewManager = mgrMod.default || mgrMod
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

function makeCtx (overrides = {}) {
  const manager = new AuthViewManager()
  manager.setMainWindow(mainWindow)
  return Object.assign(manager, overrides)
}

describe('openSavedAccount — 特征测试（平移前后行为必须逐字一致）', () => {
  it('平台不支持 ⇒ 直接返回，不建视图也不发事件（降级分支一）', async () => {
    const ctx = makeCtx()
    const result = await openSavedAccount(ctx, 'not-a-platform', [], {}, {})
    expect(result).toBeUndefined()
    expect(createdViews.length).toBe(0)
    expect(mainWindow.webContents.send).not.toHaveBeenCalled()
  })

  it('没有主窗口 ⇒ 直接返回（降级分支二）', async () => {
    const ctx = makeCtx()
    ctx.mainWindow = null
    const result = await openSavedAccount(ctx, 'wechat_mp', [], {}, {})
    expect(result).toBeUndefined()
    expect(createdViews.length).toBe(0)
  })

  it('成功路径：用一次性分区（不进登录槽位）、只注入该平台域 Cookie、恢复存储并导航', async () => {
    const ctx = makeCtx()
    const cookies = [
      { name: 'ok', value: '1', domain: '.mp.weixin.qq.com' },
      { name: 'other', value: '2', domain: '.someone-else.example' },
    ]
    await openSavedAccount(ctx, 'wechat_mp', cookies, { k: 'v' }, { db: { store: { r: 1 } } })

    // 分区名：一次性（带时间戳），**不是**按平台复用的登录槽位
    expect(createdSessions.length).toBe(1)
    expect(createdSessions[0].partition).toMatch(/^persist:auth-auth-saved-wechat_mp-\d+$/)
    // 只注入该平台域的 Cookie
    expect(createdSessions[0].cookies.set).toHaveBeenCalledTimes(1)
    expect(createdSessions[0].cookies.set.mock.calls[0][0]).toEqual([
      { name: 'ok', value: '1', domain: '.mp.weixin.qq.com' },
    ])
    // 建视图并导航
    expect(createdViews.length).toBe(1)
    expect(createdViews[0].webContents.loadURL).toHaveBeenCalledWith('https://mp.weixin.qq.com/')
    // 渲染端收到打开事件
    expect(mainWindow.webContents.send).toHaveBeenCalledWith(
      'auth:view-opened',
      expect.objectContaining({ platform: 'wechat_mp' })
    )
    // 视图挂到主窗口
    expect(mainWindow.contentView.addChildView).toHaveBeenCalledWith(createdViews[0])
  })

  it('Escape ⇒ 取消并关闭（先 resolve 再 close，避免 Promise 泄漏）', async () => {
    const ctx = makeCtx()
    await openSavedAccount(ctx, 'wechat_mp', [], {}, {})
    const handlers = {}
    createdViews[0].webContents.on = vi.fn(function (evt, cb) { handlers[evt] = cb })
    // 重新挂一次监听（视图工厂里的 on 已被平移实现占用）
    const escHandler = ctx._escHandler
    expect(typeof escHandler).toBe('function')
    const resolveLogin = vi.fn()
    ctx._resolveLogin = resolveLogin
    const closeSpy = vi.spyOn(ctx, 'close').mockImplementation(function () { /* close 副作用由被测方法驱动 */ })
    escHandler({}, { type: 'keyDown', key: 'Escape' })
    expect(resolveLogin).toHaveBeenCalledWith({ cancelled: true })
    expect(closeSpy).toHaveBeenCalled()
  })
})
