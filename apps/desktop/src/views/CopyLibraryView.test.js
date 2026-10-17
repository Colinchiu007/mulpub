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

  it('正文取不到：浮层一次都不挂载，预览也一次都不发', async () => {
    channelState.activeChannelId.value = 'ch_a'
    const w = await mountView()
    await w.find('[data-testid="podcast-script-entry-draft:d-empty"]').trigger('click')
    await flushPromises()
    expect(w.findComponent(PodcastScriptEntry).exists()).toBe(false)
    expect(api.episodePlanPreview).not.toHaveBeenCalled()
    expect(mockPush).not.toHaveBeenCalled()
  })
})
