import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createOpenSourceHandler, PLATFORM_SOURCE_URLS } from './useSourceEntry'
import { PLATFORM_DASHBOARD_URLS } from '@multi-publish/shared-utils/src/platform-definitions'

function makeDeps (overrides = {}) {
  return {
    createTab: vi.fn().mockResolvedValue('tab-1'),
    notifyWarning: vi.fn(),
    notifySuccess: vi.fn(),
    t: (key, params) => key + ':' + ((params && params.platform) || ''),
    ...overrides,
  }
}

describe('useSourceEntry（采集页素材来源快捷入口）', () => {
  beforeEach(() => { vi.clearAllMocks() })

  // 语义独立锁：这三个按钮是「去哪找素材」，不是「去哪发内容」。
  // 若有人把它们改回 PLATFORM_DASHBOARD_URLS（创作者后台），头条那条会重新
  // 指向头条号后台 —— 2026-10-12 实测 mp.toutiao.com 200 → profile_v4，
  // 是明确的发布目的地。本锁让这种退化当场变红。
  it('素材来源表与创作者后台表不得混用：头条不得指向头条号后台', () => {
    expect(PLATFORM_SOURCE_URLS.toutiao).not.toBe(PLATFORM_DASHBOARD_URLS.toutiao)
    expect(PLATFORM_SOURCE_URLS.toutiao).not.toContain('mp.toutiao.com')
  })

  it('微博指向热搜榜而非消费端首页', () => {
    expect(PLATFORM_SOURCE_URLS.weibo).not.toBe(PLATFORM_DASHBOARD_URLS.weibo)
    expect(PLATFORM_SOURCE_URLS.weibo).toContain('s.weibo.com')
  })

  it('知乎指向热榜而非消费端首页 / 创作中心', () => {
    expect(PLATFORM_SOURCE_URLS.zhihu).not.toBe(PLATFORM_DASHBOARD_URLS.zhihu)
    expect(PLATFORM_SOURCE_URLS.zhihu).toContain('zhihu.com/hot')
    // /creator 已确证强制登录（302 → /signin），不能当素材来源
    expect(PLATFORM_SOURCE_URLS.zhihu).not.toContain('/creator')
  })

  it('头条热榜 URL 必须带 origin 参数（缺参返回 parameter err）', () => {
    expect(PLATFORM_SOURCE_URLS.toutiao).toContain('origin=')
  })

  it('三个快捷入口都在表内（缺一个按钮就是死按钮）', () => {
    for (const p of ['weibo', 'zhihu', 'toutiao']) {
      expect(PLATFORM_SOURCE_URLS[p]).toBeTruthy()
    }
  })

  it('打开已配置平台 → createTab 带素材来源 URL', async () => {
    const deps = makeDeps()
    const open = createOpenSourceHandler(deps)
    await open('zhihu')
    expect(deps.createTab).toHaveBeenCalledWith(expect.objectContaining({
      url: PLATFORM_SOURCE_URLS.zhihu,
      platform: 'zhihu',
    }))
    expect(deps.notifySuccess).toHaveBeenCalled()
  })

  // 无 URL 的平台必须告警，不得静默什么都不做（此前 openCollection 的行为）
  it('未配置平台 → 告警且不调 createTab', async () => {
    const deps = makeDeps()
    const open = createOpenSourceHandler(deps)
    await open('unknown_platform')
    expect(deps.createTab).not.toHaveBeenCalled()
    expect(deps.notifyWarning).toHaveBeenCalledWith('collection.platformUnsupported')
  })

  // createTab 返回 falsy（建页失败）时不得报成功 —— 假成功比不提示更糟
  it('createTab 未返回 tabId → 不报成功', async () => {
    const deps = makeDeps({ createTab: vi.fn().mockResolvedValue(null) })
    const open = createOpenSourceHandler(deps)
    await open('weibo')
    expect(deps.createTab).toHaveBeenCalled()
    expect(deps.notifySuccess).not.toHaveBeenCalled()
  })
})
