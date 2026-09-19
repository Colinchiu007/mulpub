import { describe, expect, it, vi, beforeEach } from 'vitest'
import { buildUnifiedCopyLibraryItems, ORIGIN_DRAFT, ORIGIN_VIDEO, SOURCE_PREVIEW_LIMIT } from './useCopyLibrarySources'
import { ORIGIN_COLLECT, ORIGIN_REWRITE } from './useCopyLibrary'

// mock API 层（composable 测试不依赖真实 IPC）
vi.mock('@/api/publisher', () => ({
  storeGetSetting: vi.fn(),
  draftList: vi.fn(),
  story2videoListProjects: vi.fn(),
}))

describe('buildUnifiedCopyLibraryItems', () => {
  it('聚合 4 个来源为统一形状并按时间倒序', () => {
    const items = buildUnifiedCopyLibraryItems({
      collectedItems: [{ id: 'c1', title: '采集文案', content: '正文A', createdAt: '2026-09-01T00:00:00Z' }],
      rewrites: [{ id: 'r1', title: '改写文案', content: '正文B', createdAt: '2026-09-03T00:00:00Z' }],
      drafts: [{ id: 'd1', title: '草稿文案', content: '正文C', createdAt: '2026-09-02T00:00:00Z' }],
      videoProjects: [{ projectId: 'p1', title: '视频文案', sourceText: '正文D', updatedAt: '2026-09-04T00:00:00Z' }],
    })
    expect(items).toHaveLength(4)
    expect(items.map((it) => it.origin)).toEqual([ORIGIN_VIDEO, ORIGIN_REWRITE, ORIGIN_DRAFT, ORIGIN_COLLECT])
    expect(items[0].id).toBe('video:p1')
    expect(items[0].metadata.videoProjectId).toBe('p1')
  })

  it('视频文案超长时截断预览并标记 truncated', () => {
    const longText = 'x'.repeat(SOURCE_PREVIEW_LIMIT + 100)
    const items = buildUnifiedCopyLibraryItems({
      videoProjects: [{ projectId: 'p2', title: 't', sourceText: longText }],
    })
    expect(items[0].content).toHaveLength(SOURCE_PREVIEW_LIMIT)
    expect(items[0].wordCount).toBe(longText.length)
    expect(items[0].metadata.truncated).toBe(true)
  })

  it('无 id / 无正文的条目被过滤（fail-safe）', () => {
    const items = buildUnifiedCopyLibraryItems({
      collectedItems: [{ content: '无id' }, null, { id: 'ok', content: '有效' }],
      rewrites: [{ id: 'x', content: '' }],
      drafts: [{ title: '无id草稿' }],
      videoProjects: [{ title: '无projectId' }],
    })
    expect(items).toHaveLength(1)
    expect(items[0].id).toBe('collect:ok')
  })

  it('空入参返回空数组', () => {
    expect(buildUnifiedCopyLibraryItems()).toEqual([])
    expect(buildUnifiedCopyLibraryItems({})).toEqual([])
  })
})

describe('useCopyLibrarySources composable', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
  })

  it('单源失败不阻塞其余来源', async () => {
    const { storeGetSetting, draftList, story2videoListProjects } = await import('@/api/publisher')
    storeGetSetting.mockImplementation((key) => {
      if (key === 'collected_items') return Promise.resolve(JSON.stringify([{ id: 'c1', content: 'A', createdAt: '2026-09-01' }]))
      if (key === 'copy_library_rewrites') return Promise.resolve(JSON.stringify([{ id: 'r1', content: 'B', createdAt: '2026-09-02' }]))
      return Promise.resolve(null)
    })
    draftList.mockResolvedValue({ code: 0, data: [{ id: 'd1', content: 'C', createdAt: '2026-09-03' }] })
    story2videoListProjects.mockRejectedValue(new Error('IPC down'))

    const { useCopyLibrarySources } = await import('./useCopyLibrarySources')
    const { items, loadAll } = useCopyLibrarySources()
    await loadAll()
    // 视频源失败，其余 3 源正常
    expect(items.value.map((it) => it.origin).sort()).toEqual(['collect', 'draft', 'rewrite'])
  })
})
