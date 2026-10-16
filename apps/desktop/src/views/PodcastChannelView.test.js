/**
 * PodcastChannelView / usePodcastChannel 回归测试
 *
 * 覆盖硬约束（AGENTS.md QM-3 + 本 PR 交付要求）：
 * 1. composable 导出完整性（模板用到的每个状态/动作 toHaveProperty）；
 * 2. 「IPC 返回非空 → 状态真的转发」的数据路径用例（禁止只 mock 空数组）；
 * 3. 校验码 → locales 文案映射（含未知码兜底，未知码必须可见）；
 * 4. 分发端指引渲染（https 出锚点 / 非法协议不出锚点但保留文本，safeHttpUrl 单一判据）；
 * 5. 空态如实 + IPC 失败用户可见提示；
 * 6. IPC 传参纯 JSON 脱壳（reactive proxy 不得进 electronAPI）。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { reactive, nextTick } from 'vue'
import { mount, flushPromises } from '@vue/test-utils'
import i18n from '@/i18n'
import zh from '@/locales/zh'
import en from '@/locales/en'
import PodcastChannelView from '@/views/PodcastChannelView.vue'

import {
  usePodcastChannel,
  CHANNEL_CATEGORIES,
  EXPLICIT_OPTIONS,
  EPISODE_TYPE_OPTIONS,
  CHANNEL_EPISODE_TYPE_OPTIONS,
  subCategoriesOf,
  toPlain,
  issueText,
  IPC_UNAVAILABLE,
  IPC_EXCEPTION,
} from '@/composables/usePodcastChannel'

const mockNotifySuccess = vi.fn()
const mockNotifyError = vi.fn()
const mockNotifyWarning = vi.fn()
vi.mock('@/composables/useNotify', () => ({
  useNotify: () => ({
    notify: vi.fn(),
    notifySuccess: (...a) => mockNotifySuccess(...a),
    notifyError: (...a) => mockNotifyError(...a),
    notifyWarning: (...a) => mockNotifyWarning(...a),
    notifyInfo: vi.fn(),
  }),
}))

const mockWriteClipboard = vi.fn(async () => {})
vi.mock('@/utils/clipboard', () => ({
  writeClipboard: (...a) => mockWriteClipboard(...a),
}))

/** 每个测试文件独立构造 podcast IPC 夹具 */
function makePodcastApi (overrides = {}) {
  return {
    channelList: vi.fn(async () => ({
      ok: true,
      channels: [{ id: 'ch_test0001', name: '测试频道', cap: 1000, count: 0 }],
      defaultChannelId: 'ch_test0001',
      empty: false,
      migrationStatus: '',
      migrationConflicts: [],
      hostingConfigured: false,
    })),
    channelCreate: vi.fn(async () => ({ ok: true })),
    channelRename: vi.fn(async () => ({ ok: true })),
    channelSetDefault: vi.fn(async () => ({ ok: true })),
    channelMigrateResolve: vi.fn(async () => ({ ok: true })),
    channelGet: vi.fn(async () => ({ ok: true, channel: null })),
    channelSave: vi.fn(async (channel) => ({ ok: true, channel })),
    episodeList: vi.fn(async () => ({ ok: true, episodes: [] })),
    episodeSave: vi.fn(async (episode) => ({ ok: true, episode })),
    episodeRemove: vi.fn(async () => ({ ok: true })),
    feedBuild: vi.fn(async () => ({ ok: true, xml: '<rss/>', path: 'C:/tmp/feed.xml', itemCount: 1 })),
    feedVerify: vi.fn(async () => ({ ok: true, issues: [], checks: [], itemCount: 1 })),
    endpointList: vi.fn(async () => ({ endpoints: [] })),
    ...overrides,
  }
}

let podcastApi
beforeEach(() => {
  vi.clearAllMocks()
  podcastApi = makePodcastApi()
  Object.defineProperty(window, 'electronAPI', {
    value: { podcast: podcastApi },
    configurable: true,
    writable: true,
  })
})
afterEach(() => {
  delete window.electronAPI
})

const SAMPLE_CHANNEL = {
  title: '午间电台',
  link: 'https://example.com/radio',
  description: '每天十分钟的科技闲聊',
  language: 'zh-CN',
  author: '老王',
  ownerName: '老王',
  ownerEmail: 'oldwang@example.com',
  explicit: 'no',
  feedType: 'episodic',
  coverUrl: 'https://example.com/cover.png',
  coverSize: '3000x3000',
  categoryId: 'Technology/Podcasting',
  audioSource: 'url',
}

const SAMPLE_EPISODES = [
  { id: 'ep-1', title: '第一期：开场白', description: '自我介绍', audioUrl: 'https://cdn.example.com/e1.mp3', durationSec: 1830, sizeBytes: 44000000, pubDate: '2026-10-01T08:00:00.000Z', episodeType: 'full', guid: 'guid-1' },
  { id: 'ep-2', title: '第二期：访谈', description: '', audioUrl: 'https://cdn.example.com/e2.mp3', durationSec: 3661, sizeBytes: 50000000, pubDate: '2026-10-08T08:00:00.000Z', episodeType: 'full', guid: 'guid-2' },
]

const SAMPLE_ENDPOINTS = [
  {
    id: 'xiaoyuzhou',
    name: '小宇宙',
    submitChannel: 'rss-directory',
    submitUrl: 'https://xyz.example.com/submit',
    requiresManualFirstSubmit: true,
    timing: '收录周期约 1~3 天',
    docUrl: 'https://xyz.example.com/docs',
    steps: ['生成并托管 Feed', '打开提交页填入 Feed 地址'],
  },
  {
    id: 'sneaky',
    name: '恶意目录',
    submitChannel: 'rss-directory',
    submitUrl: 'javascript:alert(1)',
    requiresManualFirstSubmit: false,
    timing: '未知',
    docUrl: null,
    steps: ['不要点'],
  },
]

describe('usePodcastChannel 导出完整性（模板消费的每个键都必须存在）', () => {
  it('返回的合同状态与动作逐项齐全', () => {
    const api = usePodcastChannel()
    for (const key of [
      'channel', 'channelLoaded', 'savingChannel', 'channelError',
      'episodes', 'episodesLoaded', 'savingEpisode', 'episodesError', 'stockSummary',
      'feedResult', 'buildingFeed',
      'verifyResult', 'verifying',
      'endpoints', 'endpointsError', 'channelIssues',
      'loadChannel', 'loadEpisodes', 'loadEndpoints',
      'saveChannel', 'saveEpisode', 'removeEpisode',
      'buildFeed', 'verifyFeed',
      'makeEpisodeDraft', 'makeChannelDraft',
      'durationText', 'errorText', 'issueText',
    ]) {
      expect(api).toHaveProperty(key)
    }
  })

  it('模块级导出（枚举/目录/工具/错误码）齐全且来自引擎单一真源', () => {
    expect(CHANNEL_CATEGORIES).toContain('Technology')
    expect(subCategoriesOf('Technology')).toContain('Podcasting')
    expect(subCategoriesOf('不存在的分类')).toEqual([])
    expect(EXPLICIT_OPTIONS).toEqual(['yes', 'no', 'clean'])
    expect(EPISODE_TYPE_OPTIONS).toEqual(['full', 'trailer', 'bonus'])
    expect(CHANNEL_EPISODE_TYPE_OPTIONS).toEqual(['episodic', 'serial'])
    expect(IPC_UNAVAILABLE).toBe('PODCAST_IPC_UNAVAILABLE')
    expect(IPC_EXCEPTION).toBe('PODCAST_IPC_EXCEPTION')
  })
})

describe('toPlain：IPC 传参纯 JSON 脱壳纪律', () => {
  it('reactive proxy 脱壳后是普通对象且值一致', () => {
    const proxied = reactive({ title: 'x', sub: { n: 1 } })
    const plain = toPlain(proxied)
    expect(plain).toEqual({ title: 'x', sub: { n: 1 } })
    expect(Object.isExtensible(plain)).toBe(true)
    // 脱壳结果必须可被 structuredClone 语义序列化（不再持有 reactive 内部标记）
    expect(JSON.stringify(plain)).toBe('{"title":"x","sub":{"n":1}}')
  })

  it('循环引用返回 null（调用方必须报错而非静默传 proxy）', () => {
    const cyc = { a: 1 }
    cyc.self = cyc
    expect(toPlain(cyc)).toBeNull()
  })
})

describe('校验码 → 文案映射', () => {
  it('已知引擎校验码返回 locales 文案（zh），不再泄漏裸码', () => {
    expect(issueText({ code: 'CHANNEL_COVER_REQUIRED' })).toBe(zh.podcast.errors.CHANNEL_COVER_REQUIRED)
    expect(issueText({ code: 'EPISODE_AUDIO_REQUIRED' })).toBe(zh.podcast.errors.EPISODE_AUDIO_REQUIRED)
    expect(issueText({ code: 'EPISODE_HOSTING_NOT_CONFIGURED' })).toBe(zh.podcast.errors.EPISODE_HOSTING_NOT_CONFIGURED)
    expect(issueText({ code: 'ENCLOSURE_UNREACHABLE' })).toBe(zh.podcast.errors.ENCLOSURE_UNREACHABLE)
  })

  it('未知码走带 code 的兜底文案（禁止静默吞掉）', () => {
    const text = issueText({ code: 'BRAND_NEW_CODE' })
    expect(text).toContain('BRAND_NEW_CODE')
  })

  it('每个引擎校验码在 zh 与 en 都成对存在（locale 成对纪律的本地前哨）', () => {
    const codes = [
      'CHANNEL_MISSING', 'CHANNEL_TITLE_REQUIRED', 'CHANNEL_TITLE_TOO_LONG', 'CHANNEL_DESC_REQUIRED',
      'CHANNEL_DESC_TOO_LONG', 'CHANNEL_SUBTITLE_TOO_LONG', 'CHANNEL_LANGUAGE_INVALID', 'CHANNEL_COVER_REQUIRED',
      'CHANNEL_COVER_NOT_HTTPS', 'CHANNEL_COVER_SIZE_UNKNOWN', 'CHANNEL_COVER_NOT_SQUARE', 'CHANNEL_COVER_SIZE_OUT_OF_RANGE',
      'CHANNEL_LINK_NOT_HTTPS', 'CHANNEL_AUTHOR_REQUIRED', 'CHANNEL_OWNER_EMAIL_INVALID', 'CHANNEL_EXPLICIT_INVALID',
      'CHANNEL_FEED_TYPE_INVALID', 'CHANNEL_CATEGORY_REQUIRED', 'CHANNEL_CATEGORY_UNKNOWN', 'CHANNEL_SUBCATEGORY_UNKNOWN',
      'CHANNEL_CATEGORY_TOO_DEEP', 'EPISODE_MISSING', 'EPISODE_TITLE_REQUIRED', 'EPISODE_TITLE_TOO_LONG',
      'EPISODE_DESC_TOO_LONG', 'EPISODE_SUBTITLE_TOO_LONG', 'EPISODE_AUDIO_REQUIRED', 'EPISODE_AUDIO_NOT_HTTPS',
      'EPISODE_HOSTING_NOT_CONFIGURED', 'EPISODE_DURATION_INVALID', 'EPISODE_SIZE_INVALID', 'EPISODE_SIZE_REQUIRED',
      'EPISODE_EXPLICIT_INVALID', 'EPISODE_TYPE_INVALID', 'EPISODE_PUBDATE_INVALID', 'EPISODE_COVER_NOT_HTTPS',
      'EPISODE_MIME_INVALID', 'EPISODE_GUID_TOO_LONG', 'EPISODE_NUMBER_INVALID', 'EPISODE_SEASON_INVALID',
      'EPISODES_EMPTY', 'EPISODES_TOO_MANY', 'EPISODE_DUPLICATE', 'FEED_NO_ITEMS', 'FEED_MISSING_ITUNES_NS',
      'FEED_MISSING_XML_DECL', 'ENCLOSURE_MISSING', 'ENCLOSURE_NOT_HTTPS', 'ENCLOSURE_UNREACHABLE',
      'ENCLOSURE_TYPE_MISMATCH', 'ENCLOSURE_LENGTH_MISMATCH', 'DURATION_MISSING', 'PODCAST_FEED_INVALID',
      'PODCAST_IPC_UNAVAILABLE', 'PODCAST_IPC_EXCEPTION', 'PODCAST_PAYLOAD_NOT_SERIALIZABLE',
    ]
    for (const code of codes) {
      expect(typeof zh.podcast.errors[code], `zh 缺 ${code}`).toBe('string')
      expect(String(zh.podcast.errors[code]).length, `zh 空 ${code}`).toBeGreaterThan(0)
      expect(typeof en.podcast.errors[code], `en 缺 ${code}`).toBe('string')
      expect(String(en.podcast.errors[code]).length, `en 空 ${code}`).toBeGreaterThan(0)
    }
  })
})

describe('usePodcastChannel 数据路径（IPC 非空 → 状态真的转发）', () => {
  it('channelGet 返回频道对象 → channel 状态等于该对象', async () => {
    podcastApi.channelGet.mockResolvedValue({ ok: true, channel: SAMPLE_CHANNEL })
    const api = usePodcastChannel()
    await api.loadChannel()
    expect(api.channel.value).toEqual(SAMPLE_CHANNEL)
    expect(api.channelError.value).toBe('')
  })

  it('episodeList 返回两条 → episodes 长度为 2（不得退化为空数组）', async () => {
    podcastApi.episodeList.mockResolvedValue({ ok: true, episodes: SAMPLE_EPISODES })
    const api = usePodcastChannel()
    await api.loadEpisodes()
    expect(api.episodes.value).toHaveLength(2)
    expect(api.episodes.value[1].title).toBe('第二期：访谈')
  })

  it('episodeList 的 stock：成功带出 → 失败清空 → 无凭据清空（同一实例，残留才会现形）', async () => {
    const api = usePodcastChannel()

    podcastApi.episodeList.mockResolvedValue({ ok: true, episodes: SAMPLE_EPISODES, stock: { scanned: 3, filled: 1, unresolved: 2, skippedChannels: 0 } })
    await api.loadEpisodes()
    expect(api.stockSummary.value).toEqual({ scanned: 3, filled: 1, unresolved: 2, skippedChannels: 0 })

    // 换频道/重载失败：上一轮的摘要必须消失。留着就是拿旧频道的数字给新频道记账。
    podcastApi.episodeList.mockResolvedValue({ ok: false, code: 'PODCAST_IPC_EXCEPTION' })
    await api.loadEpisodes()
    expect(api.stockSummary.value).toBeNull()

    // 成功但主进程不带 stock（没有 stockStamp 是常态）：同样必须是 null，不得沿用
    podcastApi.episodeList.mockResolvedValue({ ok: true, episodes: SAMPLE_EPISODES })
    await api.loadEpisodes()
    expect(api.stockSummary.value).toBeNull()
  })

  it('episodeSave 按 id 原地更新而非追加副本', async () => {
    podcastApi.episodeList.mockResolvedValue({ ok: true, episodes: SAMPLE_EPISODES })
    const api = usePodcastChannel()
    await api.loadEpisodes()
    const updated = { ...SAMPLE_EPISODES[0], title: '改过标题' }
    podcastApi.episodeSave.mockResolvedValue({ ok: true, episode: updated })
    const res = await api.saveEpisode(updated)
    expect(res.ok).toBe(true)
    expect(api.episodes.value).toHaveLength(2)
    expect(api.episodes.value[0].title).toBe('改过标题')
  })

  it('episodeSave 传参必须已脱壳（主进程收到的不能是 proxy）', async () => {
    const api = usePodcastChannel()
    const draft = api.makeEpisodeDraft()
    draft.title = '标题'
    const proxied = reactive(draft)
    await api.saveEpisode(proxied)
    const sent = podcastApi.episodeSave.mock.calls[0][0]
    expect(sent.title).toBe('标题')
    // 断言里显式写出 channelId：这是刀 1 的核心不变量（写动作必须绑定频道上下文）
    expect(JSON.parse(JSON.stringify(sent))).toEqual(JSON.parse(JSON.stringify(Object.assign({}, draft, { channelId: 'ch_test0001' }))))
  })

  it('removeEpisode 成功后本地列表移除该项', async () => {
    podcastApi.episodeList.mockResolvedValue({ ok: true, episodes: SAMPLE_EPISODES })
    const api = usePodcastChannel()
    await api.loadEpisodes()
    await api.removeEpisode('ep-1')
    expect(api.episodes.value.map((e) => e.id)).toEqual(['ep-2'])
    expect(podcastApi.episodeRemove).toHaveBeenCalledWith({ channelId: 'ch_test0001', id: 'ep-1' })
  })

  it('结构锁：切频道的清理清单必须把 stockSummary 一起清掉', () => {
    // onChannelActivated 是"切换频道要清哪几样"的唯一清单（picker 的头注释就是这么写的）。
    // 这个瞬时窗口在行为测试里要靠挂起 promise 才可表示，成本不成比例，所以锁清单本身；
    // 判据先剥行注释——本文件注释里就写着 stockSummary 的名字，不剥会把注释当代码命中。
    const fsrc = fs.readFileSync(path.join(__dirname, '..', 'composables', 'usePodcastChannel.js'), 'utf8')
    const lines = fsrc.split('\n').map((l) => l.replace(/\r$/, ''))
    const start = lines.findIndex((l) => l.indexOf('onChannelActivated: async () => {') >= 0)
    expect(start).toBeGreaterThan(-1)
    let end = start
    while (end < lines.length && lines[end].trim() !== '},') end++
    expect(end).toBeLessThan(lines.length)
    const body = lines.slice(start, end).filter((l) => !l.trimStart().startsWith('//')).join('\n')
    expect(body).toContain('stockSummary.value = null')
    // 必须是**赋值**：只出现名字不算清理（同仓"注释写了解放、代码没写"那条反向坑）
    expect(body).toContain('episodes.value = []')
  })

  it('feedBuild 成功 → feedResult 转发 path 与 itemCount', async () => {
    podcastApi.feedBuild.mockResolvedValue({ ok: true, xml: '<rss/>', path: '/data/feed.xml', itemCount: 7 })
    const api = usePodcastChannel()
    await api.buildFeed()
    expect(api.feedResult.value).toEqual({ ok: true, path: '/data/feed.xml', itemCount: 7 })
  })

  it('feedVerify 转发 issues/checks/itemCount', async () => {
    const issues = [{ code: 'ENCLOSURE_UNREACHABLE', field: 'feed', message: 'x' }]
    const checks = [{ url: 'https://a/b.mp3', ok: false, reason: 'ENCLOSURE_UNREACHABLE', status: 404 }]
    podcastApi.feedVerify.mockResolvedValue({ ok: false, issues, checks, itemCount: 3 })
    const api = usePodcastChannel()
    await api.verifyFeed()
    expect(api.verifyResult.value.ok).toBe(false)
    expect(api.verifyResult.value.itemCount).toBe(3)
    expect(api.issueText(api.verifyResult.value.issues[0])).toBe(zh.podcast.errors.ENCLOSURE_UNREACHABLE)
    // channelIssues 只筛 CHANNEL_ 前缀，本例应为空
    expect(api.channelIssues.value).toEqual([])
  })

  it('endpointList IPC 非空 → 使用 IPC 目录；IPC 空数组 → 降级本地 ESM 孪生目录', async () => {
    podcastApi.endpointList.mockResolvedValue({ endpoints: SAMPLE_ENDPOINTS })
    const api = usePodcastChannel()
    await api.loadEndpoints()
    expect(api.endpoints.value).toHaveLength(2)
    expect(api.endpoints.value[0].id).toBe('xiaoyuzhou')

    podcastApi.endpointList.mockResolvedValue({ endpoints: [] })
    const api2 = usePodcastChannel()
    const res = await api2.loadEndpoints()
    expect(res.source).toBe('local')
    expect(api2.endpoints.value.length).toBeGreaterThan(0)
    expect(api2.endpoints.value.every((e) => e && e.id)).toBe(true)
  })

  it('IPC 命名空间缺失 → ok:false + PODCAST_IPC_UNAVAILABLE，且状态如实报错', async () => {
    delete window.electronAPI
    const api = usePodcastChannel()
    const res = await api.loadChannel()
    expect(res).toMatchObject({ ok: false, code: IPC_UNAVAILABLE })
    expect(api.channelError.value).toBe(IPC_UNAVAILABLE)
    expect(api.errorText(IPC_UNAVAILABLE)).toBe(zh.podcast.errors.PODCAST_IPC_UNAVAILABLE)
  })

  it('IPC 调用抛异常 → 归一为 IPC_EXCEPTION 而不是让调用方裸奔', async () => {
    podcastApi.channelGet.mockRejectedValue(new Error('boom'))
    const api = usePodcastChannel()
    const res = await api.loadChannel()
    expect(res.ok).toBe(false)
    expect(res.code).toBe(IPC_EXCEPTION)
  })
})

describe('PodcastChannelView 视图行为', () => {
  async function renderView () {
    const w = mount(PodcastChannelView, { global: { plugins: [i18n] } })
    await flushPromises()
    await nextTick()
    return w
  }

  it('固化摘要在位 → 区块二显示扫描/补齐，待人工非 0 时另起一段（§7.9.4）', async () => {
    podcastApi.episodeList.mockResolvedValue({ ok: true, episodes: SAMPLE_EPISODES, stock: { scanned: 11, filled: 4, unresolved: 1, skippedChannels: 0 } })
    const w = await renderView()
    const line = w.find('[data-testid="podcast-stock-summary"]')
    expect(line.exists()).toBe(true)
    expect(line.text()).toContain('扫描 11 期，补齐 4 期')
    expect(w.find('[data-testid="podcast-stock-unresolved"]').text()).toContain('1 期无法判定音频类型')
  })

  it('unresolved 为 0 → 不显示「待人工」那一段（不得制造不存在的待办）', async () => {
    // 夹具里让 skippedChannels 为非 0：这样"待人工段没出现"只可能因为 unresolved=0，
    // 而不是因为整行都不渲染（两件事分格，M12 才有自己的指名红）
    podcastApi.episodeList.mockResolvedValue({ ok: true, episodes: SAMPLE_EPISODES, stock: { scanned: 11, filled: 4, unresolved: 0, skippedChannels: 2 } })
    const w = await renderView()
    expect(w.find('[data-testid="podcast-stock-summary"]').exists()).toBe(true)
    expect(w.find('[data-testid="podcast-stock-unresolved"]').exists()).toBe(false)
  })

  it('skippedChannels 为 0 → 不显示「频道未固化」那一段（与上一条分格：两类待办各自守）', async () => {
    podcastApi.episodeList.mockResolvedValue({ ok: true, episodes: SAMPLE_EPISODES, stock: { scanned: 11, filled: 4, unresolved: 2, skippedChannels: 0 } })
    const w = await renderView()
    expect(w.find('[data-testid="podcast-stock-summary"]').exists()).toBe(true)
    expect(w.find('[data-testid="podcast-stock-skipped"]').exists()).toBe(false)
    expect(w.find('[data-testid="podcast-stock-unresolved"]').exists()).toBe(true)
  })

  it('期数待人工为 0 但整频道被跳过 → 仍必须出声（skippedChannels 是它唯一的可见出口）', async () => {
    podcastApi.episodeList.mockResolvedValue({ ok: true, episodes: SAMPLE_EPISODES, stock: { scanned: 11, filled: 4, unresolved: 0, skippedChannels: 2 } })
    const w = await renderView()
    expect(w.find('[data-testid="podcast-stock-unresolved"]').exists()).toBe(false)
    expect(w.find('[data-testid="podcast-stock-skipped"]').text()).toContain('2 个频道未能固化')
  })

  it('没有 stockStamp → 整行不渲染；两对文案 zh/en 成对且带插值占位', async () => {
    podcastApi.episodeList.mockResolvedValue({ ok: true, episodes: SAMPLE_EPISODES })
    const w = await renderView()
    expect(w.find('[data-testid="podcast-stock-summary"]').exists()).toBe(false)
    expect(zh.podcast.stock.freezeSummary).toContain('{scanned}')
    expect(zh.podcast.stock.unresolved).toContain('{count}')
    expect(en.podcast.stock.freezeSummary).toContain('{scanned}')
    expect(en.podcast.stock.unresolved).toContain('{count}')
    expect(zh.podcast.stock.skippedChannels).toContain('{count}')
    expect(en.podcast.stock.skippedChannels).toContain('{count}')
  })

  // ── PRD §8.2.5 / §8.2.6 锁 7：三态徽标（tasks 4.5 UI 半片）──
  // 夹具口径：第一行带上指定的 compliance，第二行原样带（该键缺席）——
  // 同一次渲染里同时证明「三态各自的表现」与「缺席整块不显示」，不必各建一套挂载。
  const epWithCompliance = (compliance) => {
    const ep = { ...SAMPLE_EPISODES[0] }
    if (compliance !== undefined) ep.compliance = compliance
    return [ep, SAMPLE_EPISODES[1]]
  }

  it('state=stock → 显示「存量沿用（未重新校验）」，不显示原因清单', async () => {
    podcastApi.episodeList.mockResolvedValue({ ok: true, episodes: epWithCompliance({ state: 'stock', reasons: [], checkedAt: '' }) })
    const w = await renderView()
    expect(w.find('[data-testid="podcast-compliance-stock-ep-1"]').text()).toContain('存量沿用')
    expect(w.find('[data-testid="podcast-compliance-reasons-ep-1"]').exists()).toBe(false)
    expect(w.find('[data-testid="podcast-compliance-stock-ep-2"]').exists()).toBe(false)
  })

  it('state=ok → 什么都不显示（「没问题」不需要一条文案去说）', async () => {
    podcastApi.episodeList.mockResolvedValue({ ok: true, episodes: epWithCompliance({ state: 'ok', reasons: [], checkedAt: '2026-10-15T00:00:00+00:00' }) })
    const w = await renderView()
    expect(w.find('[data-testid^="podcast-compliance-"]').exists()).toBe(false)
  })

  it('state=invalid → 计数句 + 逐条原因 + 可播出提示三样都在，且原因走 issueText 单一实现', async () => {
    podcastApi.episodeList.mockResolvedValue({ ok: true, episodes: epWithCompliance({ state: 'invalid', reasons: ['TITLE_REQUIRED', 'ENCLOSURE_UNREACHABLE'], checkedAt: '2026-10-15T00:00:00+00:00' }) })
    const w = await renderView()
    expect(w.find('[data-testid="podcast-compliance-invalid-ep-1"]').text()).toContain('2 项不符合发布要求')
    expect(w.find('[data-testid="podcast-compliance-reasons-title-ep-1"]').text()).toBe('具体原因')
    expect(w.find('[data-testid="podcast-compliance-reasons-ep-1"]').findAll('li')).toHaveLength(2)
    expect(w.find('[data-testid="podcast-compliance-degrade-ep-1"]').text()).toContain('仍可播出')
    const items = w.find('[data-testid="podcast-compliance-reasons-ep-1"]').findAll('li').map(li => li.text())
    expect(items).not.toContain('TITLE_REQUIRED')
    expect(items[0]).toBe(issueText('TITLE_REQUIRED'))
  })

  it('compliance 键缺席 → 整块不显示，且绝不渲染成「0 项不符合」（缺席 ≠ 0）', async () => {
    podcastApi.episodeList.mockResolvedValue({ ok: true, episodes: epWithCompliance(undefined) })
    const w = await renderView()
    expect(w.find('[data-testid^="podcast-compliance-"]').exists()).toBe(false)
    expect(w.text()).not.toContain('0 项不符合发布要求')
  })

  it('四键 zh/en 成对、invalid 带 {count} 占位，且 zh 用「存量」而非「旧数据」（§8.2.5 术语条款）', () => {
    for (const k of ['stock', 'invalid', 'reasonsTitle', 'degradeNotice']) {
      expect(typeof zh.podcast.compliance[k]).toBe('string')
      expect(typeof en.podcast.compliance[k]).toBe('string')
    }
    expect(zh.podcast.compliance.invalid).toContain('{count}')
    expect(en.podcast.compliance.invalid).toContain('{count}')
    expect(zh.podcast.compliance.stock).toContain('存量')
    expect(en.podcast.compliance.stock).toBe('Legacy value kept (not re-validated)')
  })

  it('结构锁：徽标不得在展示层自带第二份码→文案映射（§8.2.6 锁 5）', () => {
    const vsrc = fs.readFileSync(path.join(__dirname, 'PodcastChannelView.vue'), 'utf8')
    const badgeBlock = vsrc.slice(vsrc.indexOf('podcast-compliance-badge'), vsrc.indexOf('podcast-episode-ops'))
    expect(badgeBlock.length).toBeGreaterThan(40)
    expect(badgeBlock).toContain('issueText(')
    expect(badgeBlock).not.toMatch(/PODCAST_[A-Z_]+\s*:/)
  })

  it('频道 IPC 返回非空 → 表单字段被真实填充（数据转发路径）', async () => {
    podcastApi.channelGet.mockResolvedValue({ ok: true, channel: SAMPLE_CHANNEL })
    const w = await renderView()
    expect(w.find('[data-testid="podcast-field-title"]').element.value).toBe('午间电台')
    expect(w.find('[data-testid="podcast-field-owner-email"]').element.value).toBe('oldwang@example.com')
    expect(w.find('[data-testid="podcast-field-explicit"]').element.value).toBe('no')
    expect(w.find('[data-testid="podcast-field-category"]').element.value).toBe('Technology')
  })

  it('单集 IPC 返回两条 → 列表渲染两行；返回空 → 显示如实空态', async () => {
    podcastApi.episodeList.mockResolvedValue({ ok: true, episodes: SAMPLE_EPISODES })
    const w = await renderView()
    expect(w.find('[data-testid="podcast-episode-ep-1"]').exists()).toBe(true)
    expect(w.find('[data-testid="podcast-episode-ep-2"]').exists()).toBe(true)
    expect(w.find('[data-testid="podcast-episodes-empty"]').exists()).toBe(false)
    // 时长走引擎 formatDuration 单一口径（1830s → 30:30）
    expect(w.find('[data-testid="podcast-episode-ep-1"]').text()).toContain('30:30')

    podcastApi.episodeList.mockResolvedValue({ ok: true, episodes: [] })
    const w2 = await renderView()
    expect(w2.find('[data-testid="podcast-episodes-empty"]').text()).toBe(zh.podcast.episodes.empty)
  })

  it('新增单集：表单保存调用 episodeSave 且成功后行出现', async () => {
    const w = await renderView()
    await w.find('[data-testid="podcast-episode-add"]').trigger('click')
    expect(w.find('[data-testid="podcast-episode-form"]').exists()).toBe(true)
    await w.find('[data-testid="podcast-episode-field-title"]').setValue('第一期')
    await w.find('[data-testid="podcast-episode-field-audio-url"]').setValue('https://cdn.example.com/e1.mp3')
    await w.find('[data-testid="podcast-episode-field-duration"]').setValue('60')
    await w.find('[data-testid="podcast-episode-field-size"]').setValue('1000')
    podcastApi.episodeSave.mockImplementation(async (episode) => ({ ok: true, episode }))
    await w.find('[data-testid="podcast-episode-save"]').trigger('click')
    await flushPromises()
    expect(podcastApi.episodeSave).toHaveBeenCalledTimes(1)
    const sent = podcastApi.episodeSave.mock.calls[0][0]
    expect(sent.title).toBe('第一期')
    expect(sent.explicit).toBeUndefined()
    expect(mockNotifySuccess).toHaveBeenCalledWith(zh.podcast.episodes.saved)
    expect(w.find('[data-testid="podcast-episode-form"]').exists()).toBe(false)
  })

  it('删除单集两步确认：先点删除出确认文案，点确认才调 IPC', async () => {
    podcastApi.episodeList.mockResolvedValue({ ok: true, episodes: SAMPLE_EPISODES })
    const w = await renderView()
    await w.find('[data-testid="podcast-episode-delete-ep-1"]').trigger('click')
    expect(w.find('[data-testid="podcast-episode-delete-confirm-text"]').text()).toBe(zh.podcast.episodes.confirmDelete)
    expect(podcastApi.episodeRemove).not.toHaveBeenCalled()
    await w.find('[data-testid="podcast-episode-delete-yes-ep-1"]').trigger('click')
    await flushPromises()
    expect(podcastApi.episodeRemove).toHaveBeenCalledWith({ channelId: 'ch_test0001', id: 'ep-1' })
    expect(w.find('[data-testid="podcast-episode-ep-1"]').exists()).toBe(false)
  })

  it('生成 Feed 成功后展示路径与条数；失败展示校验码文案与问题清单', async () => {
    podcastApi.feedBuild
      .mockResolvedValueOnce({ ok: true, xml: '<rss/>', path: '/u/podcast.xml', itemCount: 2 })
      .mockResolvedValueOnce({ ok: false, code: 'PODCAST_FEED_INVALID', issues: [{ code: 'EPISODES_EMPTY', field: 'episodes' }] })
    const w = await renderView()
    await w.find('[data-testid="podcast-feed-build"]').trigger('click')
    await flushPromises()
    expect(w.find('[data-testid="podcast-feed-result"]').text()).toContain('/u/podcast.xml')
    expect(w.find('[data-testid="podcast-feed-result"]').text()).toContain(String(zh.podcast.publish.feedBuilt).replace('{count}', '2'))

    await w.find('[data-testid="podcast-feed-build"]').trigger('click')
    await flushPromises()
    expect(w.find('[data-testid="podcast-feed-fail"]').text()).toContain(zh.podcast.errors.PODCAST_FEED_INVALID)
    expect(w.find('[data-testid="podcast-feed-fail"]').text()).toContain(zh.podcast.errors.EPISODES_EMPTY)
  })

  it('自检 issues 按码出文案，CHANNEL_ 前缀问题归入频道清单', async () => {
    podcastApi.feedVerify.mockResolvedValue({
      ok: false,
      itemCount: 1,
      issues: [
        { code: 'CHANNEL_COVER_REQUIRED', field: 'coverUrl' },
        { code: 'ENCLOSURE_UNREACHABLE', field: 'feed' },
      ],
      checks: [{ url: 'https://cdn.example.com/e1.mp3', ok: false, reason: 'ENCLOSURE_UNREACHABLE', status: 404 }],
    })
    const w = await renderView()
    await w.find('[data-testid="podcast-feed-verify"]').trigger('click')
    await flushPromises()
    expect(w.find('[data-testid="podcast-verify-channel-issues"]').text()).toContain(zh.podcast.errors.CHANNEL_COVER_REQUIRED)
    expect(w.find('[data-testid="podcast-verify-issues"]').text()).toContain(zh.podcast.errors.ENCLOSURE_UNREACHABLE)
    expect(w.find('[data-testid="podcast-verify-checks"]').text()).toContain('https://cdn.example.com/e1.mp3')
  })

  it('分发端指引：https submitUrl 出锚点（noopener），javascript: 不出锚点但保留文本', async () => {
    podcastApi.endpointList.mockResolvedValue({ endpoints: SAMPLE_ENDPOINTS })
    const w = await renderView()
    const submit = w.find('[data-testid="podcast-endpoint-submit-xiaoyuzhou"]')
    expect(submit.exists()).toBe(true)
    expect(submit.attributes('href')).toBe('https://xyz.example.com/submit')
    expect(submit.attributes('rel')).toContain('noopener')
    expect(submit.attributes('target')).toBe('_blank')
    // 指引步骤与首次人工提交徽标渲染
    expect(w.find('[data-testid="podcast-endpoint-xiaoyuzhou"]').text()).toContain('打开提交页填入 Feed 地址')
    expect(w.find('[data-testid="podcast-endpoint-manual-xiaoyuzhou"]').text()).toBe(zh.podcast.endpoints.manualFirstSubmit)

    // 恶意协议：不成链、如实显示"暂无公开提交地址"，锚点绝不能带 javascript:
    expect(w.find('[data-testid="podcast-endpoint-submit-sneaky"]').exists()).toBe(false)
    expect(w.find('[data-testid="podcast-endpoint-nosubmit-sneaky"]').text()).toBe(zh.podcast.endpoints.noSubmitUrl)
    expect(w.html()).not.toContain('javascript:')
  })

  it('IPC 命名空间缺失：页面不崩，频道区显示不可用提示（用户可见、不静默）', async () => {
    delete window.electronAPI
    const w = await renderView()
    expect(w.find('[data-testid="podcast-page-title"]').text()).toBe(zh.podcast.pageTitle)
    expect(mockNotifyError).toHaveBeenCalledWith(zh.podcast.errors.PODCAST_IPC_UNAVAILABLE)
    // 分发端降级到本地目录，仍渲染卡片
    expect(w.find('[data-testid="podcast-endpoints-section"]').exists()).toBe(true)
    expect(w.findAll('.podcast-endpoint-card').length).toBeGreaterThan(0)
  })

  it('保存频道：载荷按合同键名传主进程且 reactive 已脱壳', async () => {
    podcastApi.channelGet.mockResolvedValue({ ok: true, channel: SAMPLE_CHANNEL })
    const w = await renderView()
    await w.find('[data-testid="podcast-field-title"]').setValue('改后标题')
    await w.find('[data-testid="podcast-channel-save"]').trigger('click')
    await flushPromises()
    expect(podcastApi.channelSave).toHaveBeenCalledTimes(1)
    const sent = podcastApi.channelSave.mock.calls[0][0]
    expect(sent.title).toBe('改后标题')
    expect(sent.categoryId).toBe('Technology/Podcasting')
    expect(sent.feedType).toBe('episodic')
    // 表单键名不得外泄给主进程：引擎只读 categoryId/feedType，多带的键是死数据
    expect(sent.category).toBeUndefined()
    expect(sent.subCategory).toBeUndefined()
    expect(sent.episodeType).toBeUndefined()
    expect(mockNotifySuccess).toHaveBeenCalledWith(zh.podcast.channel.saved)
  })

  it('自检徽标 ok 取自引擎 issues 口径：envelope.ok=true 但 issues 非空时必须显示「自检未通过」（QM-6 W1 回归）', async () => {
    // 主进程成功路径恒回 code=0（preload 剥壳后 envelope.ok 恒为 true），
    // 渲染层若沿用 envelope.ok，FEED_NOT_BUILT 也会显示「自检通过」。
    podcastApi.feedVerify.mockResolvedValue({
      ok: true,
      itemCount: 0,
      issues: [{ code: 'FEED_NO_ITEMS', field: 'feed' }],
      checks: [],
    })
    const w = await renderView()
    await w.find('[data-testid="podcast-feed-verify"]').trigger('click')
    await flushPromises()
    expect(w.find('[data-testid="podcast-verify-fail"]').exists()).toBe(true)
    expect(w.find('[data-testid="podcast-verify-pass"]').exists()).toBe(false)
  })

  it('保存频道校验失败：逐项展示引擎 issues 并定位字段，不得只有通用码（QM-6 W4 / F1 验收）', async () => {
    podcastApi.channelSave.mockResolvedValue({
      ok: false,
      code: 'PODCAST_CHANNEL_INVALID',
      issues: [{ code: 'CHANNEL_TITLE_REQUIRED', field: 'title' }],
    })
    const w = await renderView()
    await w.find('[data-testid="podcast-channel-save"]').trigger('click')
    await flushPromises()
    const list = w.find('[data-testid="podcast-channel-save-issues"]')
    expect(list.exists()).toBe(true)
    expect(list.text()).toContain(zh.podcast.errors.CHANNEL_TITLE_REQUIRED)
    expect(list.text()).toContain('title')
  })

  it('保存单集校验失败：逐项展示引擎 issues；保存成功清单清空（QM-6 W4）', async () => {
    podcastApi.episodeSave.mockResolvedValueOnce({
      ok: false,
      code: 'PODCAST_EPISODE_INVALID',
      issues: [{ code: 'EPISODE_AUDIO_NOT_HTTPS', field: 'episodes[0].audioUrl' }],
    })
    const w = await renderView()
    await w.find('[data-testid="podcast-episode-add"]').trigger('click')
    await w.find('[data-testid="podcast-episode-field-title"]').setValue('第一期')
    await w.find('[data-testid="podcast-episode-field-audio-url"]').setValue('http://cdn.example.com/e1.mp3')
    await w.find('[data-testid="podcast-episode-field-duration"]').setValue('60')
    await w.find('[data-testid="podcast-episode-field-size"]').setValue('1000')
    await w.find('[data-testid="podcast-episode-save"]').trigger('click')
    await flushPromises()
    const list = w.find('[data-testid="podcast-episode-save-issues"]')
    expect(list.exists()).toBe(true)
    expect(list.text()).toContain(zh.podcast.errors.EPISODE_AUDIO_NOT_HTTPS)
    // 二次保存成功 → 清单必须清空（残留旧问题会误导用户）
    podcastApi.episodeSave.mockImplementation(async (episode) => ({ ok: true, episode }))
    await w.find('[data-testid="podcast-episode-save"]').trigger('click')
    await flushPromises()
    expect(w.find('[data-testid="podcast-episode-save-issues"]').exists()).toBe(false)
  })

  it('所有者邮箱字段下必须展示公开提示（PRD §九.A / QM-6 W3），zh/en 成对', async () => {
    const w = await renderView()
    const hint = w.find('[data-testid="podcast-owner-email-privacy-hint"]')
    expect(hint.exists()).toBe(true)
    expect(hint.text()).toBe(zh.podcast.channel.ownerEmailPrivacy)
    expect(en.podcast.channel.ownerEmailPrivacy).toBeTruthy()
  })
})
