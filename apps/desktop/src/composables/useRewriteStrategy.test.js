/**
 * useRewriteStrategy 单测（rewrite-view-decompose，2026-10-21）。
 *
 * 为什么要有这个文件：策略选择从 RewriteView.vue 拆成独立 composable 后，
 * 两条**只有拆出来才看得见**的契约失去了视图内的邻居：
 *   ① 竞态守卫（previewSeq）—— 快速切换平台时，过期响应不得覆盖新结果；
 *   ② 正文防抖（300ms）—— 逐字输入不得变成逐字请求。
 * 两条在视图里都只是「一个 watch + 一个计数器」，拆出来后必须由本文件独立锁住，
 * 否则「重构」会变成「把两个竞态一起放跑」。
 *
 * 另有一条是**跨文件**的：预览必须与 startRewrite 下发同一套 userSettings。
 * 它的另一半在 RewriteView.vue 侧（那里有 rewrite-lineage / CopyLibraryView 的结构锁），
 * 本文件锁住「预览请求确实带上了平台/行业/目的/语气 + 原文」这一半。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ref, nextTick } from 'vue'
import { aiListRewriteStrategies, aiGetRecommendedStrategies } from '@/api/publisher'
import { useRewriteStrategy } from './useRewriteStrategy'

vi.mock('@/api/publisher', () => ({
  aiListRewriteStrategies: vi.fn(),
  aiGetRecommendedStrategies: vi.fn(),
}))

function setup (overrides = {}) {
  const deps = {
    platform: ref(overrides.platform ?? ''),
    industry: ref(overrides.industry ?? ''),
    purpose: ref(overrides.purpose ?? ''),
    tone: ref(overrides.tone ?? ''),
    content: ref(overrides.content ?? ''),
    rewriting: ref(false),
  }
  const api = useRewriteStrategy(deps)
  return { deps, ...api }
}

beforeEach(() => {
  vi.clearAllMocks()
  aiListRewriteStrategies.mockResolvedValue({
    code: 0,
    data: [{ id: 's1', name: '爆款故事化策略', enabled: true }],
  })
  aiGetRecommendedStrategies.mockResolvedValue({
    code: 0,
    data: [{ id: 's1', name: '爆款故事化策略' }],
  })
})

describe('useRewriteStrategy — 默认态与列表加载', () => {
  it('默认手动模式、预览占位 --、策略列表为空', () => {
    const { strategyMode, rewriteStrategyId, rewriteStrategies, previewStrategyName } = setup()
    expect(strategyMode.value).toBe('manual')
    expect(rewriteStrategyId.value).toBe('')
    expect(rewriteStrategies.value).toEqual([])
    expect(previewStrategyName.value).toBe('--')
  })

  it('列表加载成功 ⇒ 写入启用策略', async () => {
    const { rewriteStrategies, loadRewriteStrategies } = setup()
    await loadRewriteStrategies()
    expect(rewriteStrategies.value).toHaveLength(1)
    expect(rewriteStrategies.value[0].name).toBe('爆款故事化策略')
  })

  it('列表加载失败 ⇒ 静默降级为空列表（不得把异常抛给改写主流程）', async () => {
    aiListRewriteStrategies.mockRejectedValueOnce(new Error('ipc down'))
    const { rewriteStrategies, loadRewriteStrategies } = setup()
    await expect(loadRewriteStrategies()).resolves.toBeUndefined()
    expect(rewriteStrategies.value).toEqual([])
  })
})

describe('useRewriteStrategy — 预览刷新与降级', () => {
  it('刷新预览 ⇒ 取推荐列表第一名的名字', async () => {
    const { previewStrategyName, refreshStrategyPreview } = setup()
    await refreshStrategyPreview()
    expect(previewStrategyName.value).toBe('爆款故事化策略')
  })

  it('推荐 IPC 失败 ⇒ 预览降级为 --（不阻塞改写）', async () => {
    aiGetRecommendedStrategies.mockRejectedValueOnce(new Error('ipc down'))
    const { previewStrategyName, refreshStrategyPreview } = setup()
    await refreshStrategyPreview()
    expect(previewStrategyName.value).toBe('--')
  })

  it('推荐返回空列表 ⇒ 预览降级为 --', async () => {
    aiGetRecommendedStrategies.mockResolvedValueOnce({ code: 0, data: [] })
    const { previewStrategyName, refreshStrategyPreview } = setup()
    await refreshStrategyPreview()
    expect(previewStrategyName.value).toBe('--')
  })

  it('改写进行中不刷新预览（避免与改写请求抢 IPC）', async () => {
    const { deps, previewStrategyName, refreshStrategyPreview } = setup()
    deps.rewriting.value = true
    await refreshStrategyPreview()
    expect(aiGetRecommendedStrategies).not.toHaveBeenCalled()
    expect(previewStrategyName.value).toBe('--')
  })

  it('预览请求带上平台/行业/目的/语气 + 原文（与 startRewrite 下发口径必须同源）', async () => {
    const { deps, refreshStrategyPreview } = setup({
      platform: 'douyin',
      industry: 'technology',
      purpose: 'engagement',
      tone: 'casual',
    })
    deps.content.value = '  这是一段用于校验预览口径的正文。  '
    await refreshStrategyPreview()
    const [settings, text] = aiGetRecommendedStrategies.mock.calls[0]
    expect(settings).toEqual({
      platform: 'douyin',
      industry: 'technology',
      purpose: 'engagement',
      tone: 'casual',
    })
    // 原文必须 trim 后下发
    expect(text).toBe('这是一段用于校验预览口径的正文。')
  })

  it('未选任何维度时下发 undefined（不得下发空串——空串不是「未指定」的同义词）', async () => {
    const { refreshStrategyPreview } = setup()
    await refreshStrategyPreview()
    const [settings] = aiGetRecommendedStrategies.mock.calls[0]
    expect(settings.platform).toBeUndefined()
    expect(settings.industry).toBeUndefined()
    expect(settings.purpose).toBeUndefined()
    expect(settings.tone).toBeUndefined()
  })
})

describe('useRewriteStrategy — 竞态守卫与防抖', () => {
  it('平台快速切换时，过期响应不得覆盖新结果', async () => {
    let resolveFirst
    aiGetRecommendedStrategies.mockImplementation(async (us) => {
      if (!us?.platform) {
        await new Promise((r) => { resolveFirst = r })
        return { code: 0, data: [{ id: 's-slow', name: '通用慢策略' }] }
      }
      return { code: 0, data: [{ id: 's-douyin', name: '抖音爆款策略' }] }
    })
    const { deps, previewStrategyName, refreshStrategyPreview } = setup()
    const first = refreshStrategyPreview()          // 慢请求（无平台）
    deps.platform.value = 'douyin'
    await refreshStrategyPreview()                   // 快请求（抖音）
    expect(previewStrategyName.value).toBe('抖音爆款策略')
    resolveFirst()                                   // 慢请求此刻才回来
    await first
    expect(previewStrategyName.value).toBe('抖音爆款策略')
    expect(previewStrategyName.value).not.toContain('通用慢策略')
  })

  it('正文连续键入 300ms 内合并为一次请求（逐字输入不得变成逐字请求）', async () => {
    vi.useFakeTimers()
    try {
      const { deps } = setup()
      deps.content.value = '第一段。'
      await nextTick()
      deps.content.value = '第一段。第二段。'
      await nextTick()
      deps.content.value = '这是一段足够长的成稿内容。'
      await nextTick()
      expect(aiGetRecommendedStrategies).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(300)
      expect(aiGetRecommendedStrategies).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('设置项变化立即刷新（不防抖：下拉选择是离散低频动作）', async () => {
    const { deps } = setup()
    deps.platform.value = 'douyin'
    await nextTick()
    expect(aiGetRecommendedStrategies).toHaveBeenCalledTimes(1)
  })
})
