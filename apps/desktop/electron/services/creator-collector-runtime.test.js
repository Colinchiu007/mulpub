/**
 * creator-collector-runtime.test.js — 真实网络采集器的请求形状与解析契约
 *
 * 为什么这个文件必须存在：`listPosts` 是**唯一**会把作品写进
 * `(platform, external_id)` 去重键与 watch URL 的地方，而它此前零测试。
 * 2026-10-07 的 CCG 外部评审抓到的 CRITICAL 正是从这里逃逸的——
 * 请求只带 `part=snippet`，于是响应里根本没有 `contentDetails`，
 * 代码回退到 `it.id`；而 playlistItems 的 `id` 是**播放列表条目 id**，
 * 不是视频 id。结果 externalId 与 URL 双双写错，且因为返回值"合法"，
 * 监控看起来一切正常，无法自证（详见 01-docs/learnings.md 本轮记录）。
 *
 * 这里的断言全部打在**请求参数**与**解析结果**上，不打网络：
 * 注入假的 httpGet 即可覆盖真实路径，且不依赖 API Key。
 */
const { createCreatorCollector } = require('./creator-collector-runtime')

const CHANNEL_ID = 'UC' + 'a'.repeat(22)

/** 记录请求参数并回放固定响应的假 httpGet */
function fakeHttp (response) {
  const calls = []
  const httpGet = async (url, params) => {
    calls.push({ url, params })
    return typeof response === 'function' ? response(url, params) : response
  }
  return { httpGet, calls }
}

function makeCollector (opts = {}) {
  const { httpGet, calls } = fakeHttp(opts.response || { items: [] })
  const collector = createCreatorCollector({
    credentialProvider: () => ({ apiKey: 'test-key' }),
    httpGet,
    ...opts.overrides,
  })
  return { collector, calls }
}

describe('creator-collector-runtime · listPosts 请求形状', () => {
  it('必须请求 contentDetails：videoId 的唯一来源', async () => {
    const { collector, calls } = makeCollector()
    await collector.listPosts(CHANNEL_ID)
    expect(calls).toHaveLength(1)
    // 只带 snippet 时响应里没有 contentDetails，代码会误把播放列表条目 id 当 videoId
    expect(calls[0].params.part).toContain('contentDetails')
    expect(calls[0].params.part).toContain('snippet')
  })

  it('uploads 播放列表由 UC 前缀确定性推导', async () => {
    const { collector, calls } = makeCollector()
    await collector.listPosts(CHANNEL_ID)
    expect(calls[0].url).toContain('/playlistItems')
    expect(calls[0].params.playlistId).toBe('UU' + 'a'.repeat(22))
  })
})

describe('creator-collector-runtime · videoId 解析', () => {
  const item = (over = {}) => ({
    id: 'UExxxxxxxxxxxx_PLyyyyyyyyyyy', // 播放列表条目 id，**不是**视频 id
    snippet: { title: '标题', description: '描述', publishedAt: '2026-10-01T00:00:00Z' },
    contentDetails: { videoId: 'vid_real_123' },
    ...over,
  })

  it('用 contentDetails.videoId 作 externalId 并拼出可用的 watch URL', async () => {
    const { collector } = makeCollector({ response: { items: [item()] } })
    const [post] = await collector.listPosts(CHANNEL_ID)
    expect(post.externalId).toBe('vid_real_123')
    expect(post.url).toBe('https://www.youtube.com/watch?v=vid_real_123')
  })

  it('取不到 videoId 时丢弃该条，绝不回退到播放列表条目 id', async () => {
    // 无 contentDetails：若回退 it.id，去重键与 URL 会同时写错且无法自证
    const { collector } = makeCollector({
      response: { items: [{ id: 'UExxxxxxxxxxxx_PLyyyyyyyyyyy', snippet: { title: 'x' } }] },
    })
    const posts = await collector.listPosts(CHANNEL_ID)
    expect(posts).toEqual([])
  })

  it('部分条目缺 videoId 时只丢缺的，其余照常返回', async () => {
    const { collector } = makeCollector({
      response: { items: [item(), { id: 'PLzzz', snippet: { title: 'y' } }] },
    })
    const posts = await collector.listPosts(CHANNEL_ID)
    expect(posts).toHaveLength(1)
    expect(posts[0].externalId).toBe('vid_real_123')
  })
})

describe('creator-collector-runtime · 非 UC 输入 fail-closed', () => {
  // YouTube 对不存在的播放列表返回 200 + 空 items：不校验就会表现为
  // 「该博主没有新作品」，监控一切正常但永远采不到东西。
  it.each([
    ['空串', ''],
    ['handle 未解析', '@somehandle'],
    ['URL', 'https://www.youtube.com/@somehandle'],
    ['大小写错误的 UC', 'uc' + 'a'.repeat(22)],
    ['长度不足的 UC', 'UCabc'],
  ])('拒绝 %s，且不发任何请求', async (_label, input) => {
    const { collector, calls } = makeCollector()
    await expect(collector.listPosts(input)).rejects.toMatchObject({
      code: 'creator:not_a_channel',
    })
    expect(calls).toHaveLength(0)
  })
})

// 2026-10-12 新增：`resolveChannelId` 是 creator:follow 的唯一解析入口。
// 真实装配里本工厂**从未返回过它**（handler 却一直在调），
// 也就是「添加博主」必抛 TypeError —— 见 creator-wiring.e2e.test.js 的形状对账锁。
describe('creator-collector-runtime · resolveChannelId（follow 的唯一入口）', () => {
  it('暴露为工厂方法（缺了就等于添加博主整条不可用）', () => {
    const { collector } = makeCollector()
    expect(typeof collector.resolveChannelId).toBe('function')
  })

  it('@handle 走 channels.list 的 forHandle，绝不把 handle 当 channelId 或搜索词', async () => {
    const { collector, calls } = makeCollector({ response: { items: [{ id: CHANNEL_ID }] } })
    const id = await collector.resolveChannelId('@GoogleDevelopers')
    expect(id).toBe(CHANNEL_ID)
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toContain('/channels')
    expect(calls[0].params.forHandle).toBe('GoogleDevelopers')
    // 依赖包曾把 handle 降级成 search_query 并回传"别人的频道"（静默数据事故），
    // 因此这两项**必须**是 undefined：
    expect(calls[0].params.channelId).toBeUndefined()
    expect(calls[0].params.q).toBeUndefined()
  })

  it('UC 形式零请求直接返回（已在 canonical 形态）', async () => {
    const { collector, calls } = makeCollector()
    await expect(collector.resolveChannelId(CHANNEL_ID)).resolves.toBe(CHANNEL_ID)
    expect(calls).toHaveLength(0)
  })

  it('未配置 Key 时抛 credential_missing，不发请求', async () => {
    const { httpGet, calls } = fakeHttp({ items: [] })
    const collector = createCreatorCollector({ credentialProvider: () => null, httpGet })
    await expect(collector.resolveChannelId('@someone')).rejects.toMatchObject({
      code: 'creator:credential_missing',
    })
    expect(calls).toHaveLength(0)
  })

  it('解析不出频道时 fail-closed（不退回把输入当 ID）', async () => {
    const { collector } = makeCollector({ response: { items: [] } })
    await expect(collector.resolveChannelId('@ghost')).rejects.toMatchObject({
      code: 'creator:channel_not_found',
    })
  })
})
