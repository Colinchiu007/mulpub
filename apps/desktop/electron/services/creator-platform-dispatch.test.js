/**
 * creator-platform-dispatch.test.js — 平台分发锁（PRD §9 锁 1/5）
 *
 * 分发按 canonical ID 形态：UC… → youtube，MS4wLjABAAAA… → douyin，
 * 24hex → xiaohongshu。形态互斥由各平台解析器 fail-closed 保证；
 * 识别不出 = 可见失败（unsupported_platform），绝不猜平台。
 */
const { createPlatformDispatchCollector, classifyCreatorId } = require('./creator-platform-dispatch')

const YOUTUBE_ID = 'UC' + 'a'.repeat(22)
const DOUYIN_ID = 'MS4wLjABAAAA' + 'A'.repeat(28)
const XHS_ID = 'c'.repeat(24)

function makeCollectors (over = {}) {
  const calls = { youtube: [], multi: [] }
  const youtube = {
    listPosts: async (id) => { calls.youtube.push(id); return over.youtubePosts || [{ externalId: 'yt1' }] },
    collectBody: async (id) => ({ content: 'yt-body', contentQuality: 'full' }),
    resolveChannelId: async (input) => 'UC_resolve',
  }
  const multiPlatform = {
    listPosts: async (platform, id) => { calls.multi.push({ platform, id }); return { items: over.multiPosts || [{ externalId: 'mp1' }] } },
    collectBody: async () => ({ content: '', contentQuality: 'stub' }),
    hasSession: async (platform) => over.hasSession !== undefined ? over.hasSession : true,
  }
  return { collectors: { youtube, multiPlatform }, calls }
}

describe('creator-platform-dispatch · classifyCreatorId', () => {
  it('三平台形态互斥判定', () => {
    expect(classifyCreatorId(YOUTUBE_ID)).toBe('youtube')
    expect(classifyCreatorId(DOUYIN_ID)).toBe('douyin')
    expect(classifyCreatorId(XHS_ID)).toBe('xiaohongshu')
    expect(classifyCreatorId('随便一串')).toBeNull()
    expect(classifyCreatorId('')).toBeNull()
  })

  it('大小写敏感：uc 前缀不是 YouTube（YouTube 解析器已明文禁止 toLowerCase）', () => {
    expect(classifyCreatorId('uc' + 'a'.repeat(22))).toBeNull()
  })
})

describe('creator-platform-dispatch · listPosts 分发', () => {
  it('YouTube ID → youtube 采集器，多平台腿零调用', async () => {
    const { collectors, calls } = makeCollectors()
    const d = createPlatformDispatchCollector(collectors)
    const items = await d.listPosts(YOUTUBE_ID)
    expect(items[0].externalId).toBe('yt1')
    expect(calls.youtube).toEqual([YOUTUBE_ID])
    expect(calls.multi).toHaveLength(0)
  })

  it('抖音 / 小红书 ID → 多平台采集器（带平台参数）', async () => {
    const { collectors, calls } = makeCollectors()
    const d = createPlatformDispatchCollector(collectors)
    await d.listPosts(DOUYIN_ID)
    await d.listPosts(XHS_ID)
    expect(calls.multi).toEqual([
      { platform: 'douyin', id: DOUYIN_ID },
      { platform: 'xiaohongshu', id: XHS_ID },
    ])
    expect(calls.youtube).toHaveLength(0)
  })

  it('识别不出的 ID → unsupported_platform（可见失败）', async () => {
    const { collectors } = makeCollectors()
    const d = createPlatformDispatchCollector(collectors)
    await expect(d.listPosts('not-an-id')).rejects.toMatchObject({ code: 'creator:unsupported_platform' })
  })

  it('多平台腿缺失时，抖音/小红书 ID → unsupported_platform（YouTube 不受影响）', async () => {
    const { collectors, calls } = makeCollectors()
    const d = createPlatformDispatchCollector({ youtube: collectors.youtube })
    await expect(d.listPosts(DOUYIN_ID)).rejects.toMatchObject({ code: 'creator:unsupported_platform' })
    expect(await d.listPosts(YOUTUBE_ID)).toHaveLength(1)
    expect(calls.youtube).toHaveLength(1)
  })
})

describe('creator-platform-dispatch · collectBody / resolveChannelId', () => {
  it('collectBody 按平台分发', async () => {
    const { collectors } = makeCollectors()
    const d = createPlatformDispatchCollector(collectors)
    expect((await d.collectBody(YOUTUBE_ID)).contentQuality).toBe('full')
    expect((await d.collectBody(DOUYIN_ID)).contentQuality).toBe('stub')
  })

  it('resolveChannelId 对非 YouTube 链接 → wrong_platform（拒绝「顺带解析」）', async () => {
    const { collectors } = makeCollectors()
    const d = createPlatformDispatchCollector(collectors)
    await expect(d.resolveChannelId('https://www.douyin.com/user/' + DOUYIN_ID))
      .rejects.toMatchObject({ code: 'creator:wrong_platform' })
    await expect(d.resolveChannelId('https://www.youtube.com/@x')).resolves.toBe('UC_resolve')
  })
})

describe('creator-platform-dispatch · 平台状态', () => {
  it('platformStatus 汇报三平台支持与会话状态', async () => {
    const { collectors } = makeCollectors({ hasSession: false })
    const d = createPlatformDispatchCollector(collectors)
    const s = await d.platformStatus()
    expect(s.youtube.ready).toBe(true)
    expect(s.douyin).toMatchObject({ supported: true, hasSession: false })
    expect(s.xiaohongshu.supported).toBe(true)
  })
})
