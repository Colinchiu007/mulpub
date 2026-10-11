// @ts-check
/**
 * usePublishFlow.autocover.test.js — 图文自动封面兜底（触发完备性 + 双通道落值）
 *
 * 缺陷背景（2026-10-12 用户报障）：同一条文案，发快手有正文有封面，发微信公众号
 * 草稿箱只有标题。用户追问「没有封面图片时，系统是不是自动生成一个封面图片，
 * 然后发布时应用这张封面图片？」——答案是**只对了一半**：
 *
 *  - 触发集合 `IMAGE_TEXT_PLATFORMS = ['xiaohongshu','kuaishou','douyin','toutiao']`
 *    **不含 `wechat_mp`** ⇒ 只发公众号时一步都不触发；
 *  - 即便触发了，落值只写 `article.images` / `article.image_files`（图片通道），
 *    **从不写 `cover_path`** ⇒ 消费 `cover_path` 的封面上传链拿不到图。
 *
 * 逃逸原因：这条分支**在此之前没有任何测试**（`usePublishFlow.test.js` 里
 * `@/api/publisher` 的 mock 根本没提供 `generateAiCover`，调用抛 TypeError 被
 * `try/catch` 静默吞掉）——「无测试兜底」+「静默 catch」叠加，使平台清单漏项长期不可见。
 * 本文件同时锁住「触发条件完备」与「失败必须出声」。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { reactive } from 'vue'
import i18n from '@/i18n'

const {
  mockPublishBatch,
  mockGenerateAiCover,
  mockElMessage,
} = vi.hoisted(() => ({
  mockPublishBatch: vi.fn(),
  mockGenerateAiCover: vi.fn(),
  mockElMessage: { success: vi.fn(), warning: vi.fn(), error: vi.fn(), info: vi.fn() },
}))

vi.mock('@/composables/useLoginGate', () => ({
  useLoginGate: () => ({ ensureLogin: vi.fn(async () => true), requireLogin: vi.fn(async (fn) => fn()), openSignIn: vi.fn(async () => true) }),
}))

vi.mock('@/api/publisher', () => ({
  publishBatch: mockPublishBatch,
  onProgress: vi.fn(() => vi.fn()),
  sensitiveCheck: vi.fn(async () => ({ code: 0, data: { words: [] } })),
  offlineStatus: vi.fn(async () => ({ code: 0, data: { offline: false } })),
  offlineAddToCache: vi.fn(async () => ({ code: 0 })),
  schedulerCreate: vi.fn(async () => ({ code: 0, data: { id: 's1' } })),
  schedulerCancel: vi.fn(async () => ({ code: 0, data: true })),
  cancelTask: vi.fn(async () => ({ code: 0, data: true })),
  showNotification: vi.fn(async () => ({ code: 0 })),
  storeGetSetting: vi.fn(async () => false),
  storeSetSetting: vi.fn(async () => ({ code: 0, data: true })),
  batchCreate: vi.fn(),
  generateAiCover: mockGenerateAiCover,
}))

vi.mock('element-plus', () => ({
  ElMessage: mockElMessage,
  ElMessageBox: { confirm: vi.fn(async () => undefined) },
}))

vi.mock('@/stores/publishProgress', async () => {
  const { reactive: r } = await import('vue')
  const store = r({ sessions: [], panelVisible: false, panelMinimized: false, registerSession: vi.fn() })
  return { usePublishProgressStore: () => store }
})

import { usePublishFlow } from '../composables/usePublishFlow'
import { usePublishProgressStore } from '@/stores/publishProgress'

const COVER_PATH = 'D:/tmp/auto-cover.png'

function setup (platforms, overrides = {}, options = {}) {
  const article = reactive({
    title: '图文标题',
    content: '图文正文',
    author: '',
    cover_url: '',
    cover_path: '',
    cover_file: null,
    video_path: '',
    publishTime: '',
    images: [],
    image_files: [],
    ...overrides,
  })
  const selectedPlatforms = { value: platforms }
  const selectedAccounts = { value: Object.fromEntries(platforms.map(p => [p, 'acc1'])) }
  const precheckEnabled = { value: false }
  const flow = usePublishFlow({
    article, selectedPlatforms, selectedAccounts, precheckEnabled,
    ...(options.activeMode ? { activeMode: options.activeMode } : {}),
  })
  return { article, flow }
}

function progressTexts (flow) {
  return flow.progress.value.map(p => String(p.text))
}

describe('usePublishFlow — 图文自动封面兜底', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    i18n.global.locale.value = 'zh'
    usePublishProgressStore().sessions = []
    mockPublishBatch.mockResolvedValue({ code: 0, data: { taskIds: ['t1'] }, message: 'ok' })
    mockGenerateAiCover.mockResolvedValue({ code: 0, data: { coverPath: COVER_PATH } })
  })

  it('只发微信公众号（无图无封面）也会生成封面，并**双通道**落值', async () => {
    const { article, flow } = setup(['wechat_mp'])

    await flow.handlePublish()

    expect(mockGenerateAiCover).toHaveBeenCalledTimes(1)
    // 图片通道（要求至少一张图的平台）
    expect(article.images).toEqual([COVER_PATH])
    expect(article.image_files).toHaveLength(1)
    // 封面通道（封面必填的平台）—— 本次修复的关键：此前只落图片通道
    expect(article.cover_path).toBe(COVER_PATH)
    expect(article.cover_file?.path).toBe(COVER_PATH)
    // 发布载荷必须带上 cover_path，否则主进程的封面上传链拿不到图
    const payload = mockPublishBatch.mock.calls[0][1] ?? mockPublishBatch.mock.calls[0][0]
    expect(JSON.stringify(payload)).toContain(COVER_PATH)
    expect(progressTexts(flow).join('|')).toContain('封面已生成')
  })

  it('只发快手（回归保护）：仍然生成封面且双通道落值', async () => {
    const { article, flow } = setup(['kuaishou'])

    await flow.handlePublish()

    expect(mockGenerateAiCover).toHaveBeenCalledTimes(1)
    expect(article.images).toEqual([COVER_PATH])
    expect(article.cover_path).toBe(COVER_PATH)
  })

  it('🔴 表单已有封面时不得再生成（否则生成封面会盖掉用户选择，且白跑一次生图）', async () => {
    const { article, flow } = setup(['wechat_mp'], { cover_path: 'D:/covers/user-picked.png' })

    await flow.handlePublish()

    expect(mockGenerateAiCover).not.toHaveBeenCalled()
    expect(article.cover_path).toBe('D:/covers/user-picked.png')
    expect(progressTexts(flow).join('|')).toContain('已使用你选择的封面图')
  })

  it('表单只有远程封面 URL 时也不生成', async () => {
    const { flow } = setup(['wechat_mp'], { cover_url: 'https://cdn.example.com/c.png' })

    await flow.handlePublish()

    expect(mockGenerateAiCover).not.toHaveBeenCalled()
  })

  it('表单已有图片时不生成', async () => {
    const { flow } = setup(['wechat_mp'], { images: ['D:/img/a.png'] })

    await flow.handlePublish()

    expect(mockGenerateAiCover).not.toHaveBeenCalled()
  })

  it('未选中任何自动封面平台（如微博）时不生成', async () => {
    const { flow } = setup(['weibo'])

    await flow.handlePublish()

    expect(mockGenerateAiCover).not.toHaveBeenCalled()
  })

  it('视频发布不生成图文封面', async () => {
    // `isVideoMode` 由注入的 `activeMode` ref 决定（不是 article.video_path）
    const { flow } = setup(['wechat_mp'], { video_path: 'D:/v/a.mp4' }, { activeMode: { value: 'video' } })

    await flow.handlePublish()

    expect(mockGenerateAiCover).not.toHaveBeenCalled()
  })

  it('🔴 生成失败必须出声且不阻断发布（此前是静默 catch）', async () => {
    mockGenerateAiCover.mockResolvedValue({ code: -1, message: '生图服务不可用' })
    const { flow } = setup(['wechat_mp'])

    await flow.handlePublish()

    expect(progressTexts(flow).join('|')).toContain('封面图生成失败')
    // 不阻断：发布照常提交
    expect(mockPublishBatch).toHaveBeenCalled()
  })

  it('生成抛错同样出声且不阻断', async () => {
    mockGenerateAiCover.mockRejectedValue(new Error('boom'))
    const { flow } = setup(['wechat_mp'])

    await flow.handlePublish()

    expect(progressTexts(flow).join('|')).toContain('封面图生成失败')
    expect(mockPublishBatch).toHaveBeenCalled()
  })

  it('生成返回缺 coverPath 时按失败处理（不写空路径）', async () => {
    mockGenerateAiCover.mockResolvedValue({ code: 0, data: {} })
    const { article, flow } = setup(['wechat_mp'])

    await flow.handlePublish()

    expect(article.cover_path).toBe('')
    expect(progressTexts(flow).join('|')).toContain('封面图生成失败')
  })
})
