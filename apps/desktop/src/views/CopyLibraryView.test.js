import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ref } from 'vue'
import { mount, flushPromises } from '@vue/test-utils'
import i18n from '@/i18n'

const mockPush = vi.fn()
vi.mock('vue-router', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, useRouter: () => ({ push: mockPush }), useRoute: () => ({ query: {} }) }
})

const mockNotifyWarning = vi.fn()
vi.mock('@/composables/useNotify', () => ({
  useNotify: () => ({ notifyWarning: mockNotifyWarning, notifyError: vi.fn(), notifySuccess: vi.fn(), notifyInfo: vi.fn() }),
}))

const story2videoGetProject = vi.fn()
vi.mock('@/api/publisher', () => ({
  storeGetSetting: vi.fn(async () => '[]'),
  story2videoGetProject: (...args) => story2videoGetProject(...args),
}))

const api = vi.hoisted(() => ({
  episodePlanPreview: vi.fn(),
  episodePublishFromScript: vi.fn(),
  onEpisodePublishProgress: vi.fn(),
}))
vi.mock('@/api/podcast-channel', async (importOriginal) => Object.assign({}, await importOriginal(), api))

const suspension = vi.hoisted(() => ({ suspend: vi.fn(), release: vi.fn() }))
vi.mock('@/composables/useEmbeddedViewSuspension', () => ({
  suspendEmbeddedViewsForOverlay: suspension.suspend,
  releaseEmbeddedViewsForOverlay: suspension.release,
}))

// 频道解析必须能从用例里拨值：真实 usePodcastChannel 会拉全量频道列表，
// 而下面要锁的正是「有没有默认频道」这一渲染条件的两个分支。
const channelState = vi.hoisted(() => ({}))
vi.mock('@/composables/usePodcastChannel', async (importOriginal) => {
  const { ref } = await import('vue')
  const original = await importOriginal()
  const activeChannelId = ref('')
  const ensureChannel = vi.fn(async () => activeChannelId.value)
  channelState.activeChannelId = activeChannelId
  channelState.ensureChannel = ensureChannel
  return { ...original, usePodcastChannel: () => ({ activeChannelId, ensureChannel }) }
})

vi.mock('@/composables/useCopyLibrarySources', async (importOriginal) => {
  const original = await importOriginal()
  return {
    ...original,
    useCopyLibrarySources: () => ({
      items: ref([
        { id: 'collect:c1', origin: 'collect', title: '采集标题', content: '采集正文内容', wordCount: 6, platform: 'xiaohongshu', sourceUrl: 'https://example.com/a', createdAt: '2026-10-01T00:00:00Z', metadata: {} },
        { id: 'rewrite:r1', origin: 'rewrite', title: '改写标题', content: '改写正文内容', wordCount: 6, platform: '', sourceUrl: '', createdAt: '2026-10-02T00:00:00Z', metadata: {} },
        { id: 'draft:d1', origin: 'draft', title: '草稿标题', content: '草稿正文内容', wordCount: 6, platform: '', sourceUrl: '', createdAt: '2026-10-03T00:00:00Z', metadata: {} },
        { id: 'video:v1', origin: 'video', title: '视频标题', content: '截断预览', wordCount: 800, platform: '', sourceUrl: '', createdAt: '2026-10-04T00:00:00Z', metadata: { videoProjectId: 'v1', truncated: true } },
        { id: 'draft:d-empty', origin: 'draft', title: '空正文草稿', content: '', wordCount: 0, platform: '', sourceUrl: '', createdAt: '2026-10-05T00:00:00Z', metadata: {} },
        // 分档判据的两支现场：改写档空正文（该藏）与视频档「列表态空、回源有全文」（该留）。
        // 少了后者，"按 content 收"看起来是修 bug，实际把可用入口一起藏掉。
        { id: 'rewrite:r-empty', origin: 'rewrite', title: '空正文改写', content: '   \n ', wordCount: 0, platform: '', sourceUrl: '', createdAt: '2026-10-06T00:00:00Z', metadata: {} },
        { id: 'video:v2', origin: 'video', title: '只有标题的视频', content: '', wordCount: 812, platform: '', sourceUrl: '', createdAt: '2026-10-07T00:00:00Z', metadata: { videoProjectId: 'v2', truncated: true } },
        { id: 'video:v0', origin: 'video', title: '零字数视频', content: '', wordCount: 0, platform: '', sourceUrl: '', createdAt: '2026-10-08T00:00:00Z', metadata: { videoProjectId: 'v0' } },
      ]),
      loading: ref(false),
      loadAll: vi.fn(async () => []),
    }),
  }
})

import CopyLibraryView from './CopyLibraryView.vue'
import PodcastScriptEntry from '@/components/PodcastScriptEntry.vue'
import { takeCopyDetailHandoff, clearCopyDetailHandoff } from '@/utils/copy-detail-handoff'

async function mountView() {
  const w = mount(CopyLibraryView, { global: { plugins: [i18n] } })
  await flushPromises()
  return w
}

describe('CopyLibraryView — 文案库卡片点击进入文案详情（发布页）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clearCopyDetailHandoff()
  })

  it('卡片带 role=button 与 tabindex=0（可键盘访问）', async () => {
    const w = await mountView()
    const card = w.find('[data-testid="copy-library-item-collect:c1"]')
    expect(card.exists()).toBe(true)
    expect(card.attributes('role')).toBe('button')
    expect(card.attributes('tabindex')).toBe('0')
  })

  it('点击采集卡片 → 写入交接载荷并跳转发布页', async () => {
    const w = await mountView()
    await w.find('[data-testid="copy-library-item-collect:c1"]').trigger('click')
    const payload = takeCopyDetailHandoff()
    expect(payload).toMatchObject({ content: '采集正文内容', title: '采集标题', origin: 'collect', sourceId: 'c1', platform: 'xiaohongshu', sourceUrl: 'https://example.com/a' })
    expect(mockPush).toHaveBeenCalledWith(expect.objectContaining({ path: '/publish', query: expect.objectContaining({ from: 'copy-library' }) }))
  })

  it('点击改写卡片 → 载荷 origin=rewrite sourceId=r1', async () => {
    const w = await mountView()
    await w.find('[data-testid="copy-library-item-rewrite:r1"]').trigger('click')
    expect(takeCopyDetailHandoff()).toMatchObject({ origin: 'rewrite', sourceId: 'r1', content: '改写正文内容' })
    expect(mockPush).toHaveBeenCalledTimes(1)
  })

  it('点击草稿卡片 → 载荷 origin=draft sourceId=d1', async () => {
    const w = await mountView()
    await w.find('[data-testid="copy-library-item-draft:d1"]').trigger('click')
    expect(takeCopyDetailHandoff()).toMatchObject({ origin: 'draft', sourceId: 'd1' })
  })

  it('点击视频卡片 → 先拉全文（成功时载荷含全文）', async () => {
    story2videoGetProject.mockResolvedValue({ code: 0, data: { projectId: 'v1', sourceText: '字'.repeat(2000), title: '视频标题' } })
    const w = await mountView()
    await w.find('[data-testid="copy-library-item-video:v1"]').trigger('click')
    await flushPromises()
    const payload = takeCopyDetailHandoff()
    expect(payload.content).toHaveLength(2000)
    expect(payload.origin).toBe('video')
    expect(story2videoGetProject).toHaveBeenCalledWith('v1')
    expect(mockNotifyWarning).not.toHaveBeenCalled()
  })

  it('视频全文拉取失败 → 降级截断预览 + warning + 照常跳转', async () => {
    story2videoGetProject.mockResolvedValue({ code: -1, message: 'ipc down' })
    const w = await mountView()
    await w.find('[data-testid="copy-library-item-video:v1"]').trigger('click')
    await flushPromises()
    expect(takeCopyDetailHandoff()).toMatchObject({ content: '截断预览', origin: 'video', sourceId: 'v1' })
    expect(mockNotifyWarning).toHaveBeenCalledTimes(1)
    expect(mockPush).toHaveBeenCalledTimes(1)
  })

  it('视频全文拉取抛异常 → 同样降级不阻塞', async () => {
    story2videoGetProject.mockRejectedValue(new Error('boom'))
    const w = await mountView()
    await w.find('[data-testid="copy-library-item-video:v1"]').trigger('click')
    await flushPromises()
    expect(takeCopyDetailHandoff()).toMatchObject({ content: '截断预览' })
    expect(mockPush).toHaveBeenCalledTimes(1)
  })

  it('键盘 Enter 触发与点击一致', async () => {
    const w = await mountView()
    await w.find('[data-testid="copy-library-item-draft:d1"]').trigger('keydown', { key: 'Enter' })
    expect(takeCopyDetailHandoff()).toMatchObject({ origin: 'draft' })
    expect(mockPush).toHaveBeenCalledTimes(1)
  })

  it('键盘空格触发与点击一致', async () => {
    const w = await mountView()
    await w.find('[data-testid="copy-library-item-draft:d1"]').trigger('keydown', { key: ' ' })
    expect(mockPush).toHaveBeenCalledTimes(1)
  })
})

const PLAN_OK = { ok: true, plan: { totalBlocks: 7, totalCodepoints: 12345 }, voice: { providerId: 'prov_x', model: 'mdl_y', voiceId: 'voice_z', origin: 'preference', resolvedBy: 'capability' } }
const avail = (result) => ({ available: true, result })

// 入口的两条渲染合同。缺了它们，这段代码可以整块坏掉而上面 9 条照绿：
// 「无频道不出现动作」在现有夹具里恒为真（activeChannelId 从未被置值，动作从未渲染），
// 「取到正文才挂浮层」也从未被观察过（没有任何用例断言过浮层挂载与否）。
describe('CopyLibraryView — 文本出期入口的渲染合同（§7.10.3.2 / §7.10.4.1）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clearCopyDetailHandoff()
    channelState.activeChannelId.value = ''
    api.episodePlanPreview.mockResolvedValue(avail(PLAN_OK))
  })

  it('有默认频道：动作出现，点击只挂浮层（正控，别让下面的负断言空转）', async () => {
    channelState.activeChannelId.value = 'ch_a'
    const w = await mountView()
    const btn = w.find('[data-testid="podcast-script-entry-draft:d1"]')
    expect(btn.exists()).toBe(true)

    await btn.trigger('click')
    await flushPromises()
    expect(w.findComponent(PodcastScriptEntry).exists()).toBe(true)
    expect(api.episodePlanPreview).toHaveBeenCalledTimes(1)
    // 卡本身是 role=button + @click=openDetail；次级动作必须 .stop，否则一点就走进发布页交接
    expect(mockPush).not.toHaveBeenCalled()
    expect(takeCopyDetailHandoff()).toBeNull()
  })

  it('无默认频道：动作根本不出现（而不是弹一个必被宿主拒的框）', async () => {
    channelState.activeChannelId.value = ''
    const w = await mountView()
    expect(w.findAll('[data-testid^="podcast-script-entry-"]').length).toBe(0)
    expect(w.findComponent(PodcastScriptEntry).exists()).toBe(false)
  })

  it('draft 档正文为空 ⇒ 动作根本不出现（原先「点了没反应的死按钮」收口在渲染期）', async () => {
    channelState.activeChannelId.value = 'ch_a'
    const w = await mountView()
    // 这条原先是「点开它、然后断言什么都没发生」——那等于把一个坏按钮合法化。
    // 现在判据前移：空的 draft 条目不该有按钮，也就没有"点了没反应"这回事。
    expect(w.find('[data-testid="podcast-script-entry-draft:d-empty"]').exists(), '空正文 draft 仍留着死按钮').toBe(false)
    expect(w.findComponent(PodcastScriptEntry).exists()).toBe(false)
    expect(api.episodePlanPreview).not.toHaveBeenCalled()
  })

  it('rewrite 档按 content.trim() 判：只有空白正文的不出现，有正文的出现（负向必配正控）', async () => {
    channelState.activeChannelId.value = 'ch_a'
    const w = await mountView()
    expect(w.find('[data-testid="podcast-script-entry-rewrite:r-empty"]').exists(), 'rewrite 档空白正文应藏掉动作').toBe(false)
    expect(w.find('[data-testid="podcast-script-entry-rewrite:r1"]').exists(), '同档有正文时动作必须在（否则上一条是选择器写错在空转）').toBe(true)
  })

  it('video 档按 wordCount 判，不按列表态 content：空预览 + 回源有全文 ⇒ 动作在，浮层拿回源全文', async () => {
    channelState.activeChannelId.value = 'ch_a'
    story2videoGetProject.mockImplementation(async (id) => (id === 'v2' ? { code: 0, data: { sourceText: '回源拿到的完整视频文案，列表态没带出来' } } : { code: 0, data: { sourceText: '截断预览之外的视频全文内容' } }))
    const w = await mountView()
    const btn = w.find('[data-testid="podcast-script-entry-video:v2"]')
    // 这一支是"分档"的全部理由：把 video 也按 entry.content 收，就会把可用入口一起藏掉。
    expect(btn.exists(), 'video 档被按 content 判掉了 ⇒ 可用入口被藏').toBe(true)
    await btn.trigger('click')
    await flushPromises()
    expect(w.findComponent(PodcastScriptEntry).exists(), '回源成功却没挂浮层').toBe(true)
    const call = api.episodePlanPreview.mock.calls[0]
    expect(call, '浮层挂了却没调预览 ⇒ 显示项无从而来').toBeTruthy()
    expect(call[0].script, '送预览的必须是回源全文，不是列表态那份空串').toBe('回源拿到的完整视频文案，列表态没带出来')
  })

  it('video 档 wordCount 为 0 ⇒ 动作不出现（分档不等于"视频一律显示"）', async () => {
    channelState.activeChannelId.value = 'ch_a'
    const w = await mountView()
    expect(w.find('[data-testid="podcast-script-entry-video:v0"]').exists(), '零字数视频项不该有动作').toBe(false)
    // 同档正向那一格必须同时成立，否则上一条只是"video 全被藏"的假绿
    expect(w.find('[data-testid="podcast-script-entry-video:v1"]').exists(), '有字数的视频项动作必须在').toBe(true)
  })
})

describe('CopyLibraryView / RewriteView — 入口的两条结构合同（QM6-2 死分支 + 分档判据落点唯一）', () => {
  it('不得再保留 `|| await ensureChannel()` 兜底；可见性判据只有一处且真的分档', async () => {
    const { readFileSync } = await import('node:fs')
    const { fileURLToPath } = await import('node:url')
    const sources = {}
    for (const rel of ['./CopyLibraryView.vue', './RewriteView.vue']) {
      const text = readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
      // 读到空串就红：路径写错时「不含禁词」是恒真的假锁
      expect(text.length, rel + ' 没读到内容').toBeGreaterThan(500)
      expect(text, rel + ' 不再读既有解析 ⇒ 可能另有第二套频道口径').toContain('podcast.activeChannelId.value')
      sources[rel] = text
    }
    for (const [rel, text] of Object.entries(sources)) {
      expect(text, rel + ' 又长回了那段不可达兜底（v-if 已保证频道非空，兜底分支永远走不到）').not.toMatch(/activeChannelId\.value\s*\|\|\s*await\s+[\w.]*ensureChannel\s*\(\s*\)/)
    }

    // 分档判据的落点唯一：模板与点击路径都必须走 canShowEpisodeEntry，且函数体里两档判据都在。
    // 定界取该函数自己的顶层闭合括号，不取"下一个函数名"——那种锚点会在别人搬家时静默放大区间。
    const view = sources['./CopyLibraryView.vue']
    expect((view.match(/function canShowEpisodeEntry/g) || []).length, '判据定义必须恰好一处').toBe(1)
    expect(view).toMatch(/v-if="canShowEpisodeEntry\(entry\)"/)
    expect(view, '点击路径绕开判据 ⇒ 分档成了摆设').toContain('if (!canShowEpisodeEntry(entry)) return')
    const start = view.indexOf('function canShowEpisodeEntry')
    expect(start, '判据函数不存在').toBeGreaterThan(-1)
    const after = view.slice(start)
    const close = after.search(/\r?\n\}\r?\n/)
    expect(close, '找不到判据函数的闭合括号（锚点漂移，别把这条读成"分档丢了"）').toBeGreaterThan(-1)
    const body = after.slice(0, close)
    expect(body, 'video 档判据被摘掉 ⇒ 分档退化成"一律按 content 判"').toContain('ORIGIN_VIDEO')
    expect(body, '空白判据被摘掉 ⇒ 死按钮会回来').toContain('.trim()')
  })
})
