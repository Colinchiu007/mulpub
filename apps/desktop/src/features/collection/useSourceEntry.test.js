import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createOpenSourceHandler, PLATFORM_SOURCE_URLS, SOURCE_LABEL_KEYS } from './useSourceEntry'
import { PLATFORM_DASHBOARD_URLS } from '@multi-publish/shared-utils/src/platform-definitions'

/** 卡片显示名（与 locales/collection 的四个键同值）；t 在测试里只负责取值 */
const LABELS = {
  'collection.sourceWeibo': '微博热搜',
  'collection.sourceBaidu': '百度热搜',
  'collection.sourceToutiao': '今日头条',
}

function makeDeps (overrides = {}) {
  return {
    createTab: vi.fn().mockResolvedValue('tab-1'),
    notifyWarning: vi.fn(),
    notifySuccess: vi.fn(),
    t: (key, params) => {
      if (params && params.platform) return '素材来源：' + params.platform
      return LABELS[key] || key
    },
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

  // 2026-10-17 回归锁（本刀主因）：三张卡必须落在「免登录可匿名浏览的渲染页」上。
  // 判据刻意写成黑名单 + 协议白名单两条，而不是只列具体 URL：
  // 只要有人把某个入口改回数据接口（如头条 hot-event/hot-board），黑色正则当场红。
  it('三个入口都是渲染页，不得指向 JSON 数据接口', () => {
    const entries = Object.entries(PLATFORM_SOURCE_URLS)
    expect(entries.length).toBe(3)
    for (const [id, url] of entries) {
      expect(url, id).toMatch(/^https:\/\//)
      expect(url, id).not.toMatch(/hot-event|\.json(\?|$)|^https:\/\/api\./i)
    }
  })

  it('头条入口是渲染页而不是热榜 JSON 接口（本次缺陷原始形态）', () => {
    expect(PLATFORM_SOURCE_URLS.toutiao).not.toContain('hot-event/hot-board')
    expect(PLATFORM_SOURCE_URLS.toutiao).toContain('toutiao.com')
  })

  it('知乎已从素材来源表移除（/hot 强制登录，匿名无法浏览）', () => {
    expect(PLATFORM_SOURCE_URLS.zhihu).toBeUndefined()
    expect(SOURCE_LABEL_KEYS.zhihu).toBeUndefined()
  })

  it('百度热搜以榜单页登记（2026-10-17 实测免登录可浏览）', () => {
    expect(PLATFORM_SOURCE_URLS.baidu).toContain('top.baidu.com/board')
  })

  it('三张卡都在表内且有显示名（缺一个按钮就是死按钮）', () => {
    for (const p of ['weibo', 'baidu', 'toutiao']) {
      expect(PLATFORM_SOURCE_URLS[p]).toBeTruthy()
      expect(SOURCE_LABEL_KEYS[p]).toBeTruthy()
    }
  })

  it('打开已配置来源 → createTab 带素材来源 URL、来源 id 与显示名标题', async () => {
    const deps = makeDeps()
    const open = createOpenSourceHandler(deps)
    await open('baidu')
    expect(deps.createTab).toHaveBeenCalledWith(expect.objectContaining({
      url: PLATFORM_SOURCE_URLS.baidu,
      platform: 'baidu',
      title: '素材来源：百度热搜',
    }))
    expect(deps.notifySuccess).toHaveBeenCalledTimes(1)
    // 提示里的平台名必须是显示名（此前传的是原始 id，用户看到「已打开 zhihu 采集页面」）
    expect(deps.notifySuccess.mock.calls[0][1].params.platform).toBe('百度热搜')
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
