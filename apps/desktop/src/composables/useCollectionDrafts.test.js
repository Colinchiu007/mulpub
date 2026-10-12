import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockDraftSave,
  mockDraftList,
  mockDraftDelete,
  mockMessage,
  mockConfirm,
} = vi.hoisted(() => ({
  mockDraftSave: vi.fn(),
  mockDraftList: vi.fn(),
  mockDraftDelete: vi.fn(),
  mockMessage: { success: vi.fn(), warning: vi.fn(), error: vi.fn() },
  mockConfirm: vi.fn(),
}))

vi.mock('@/api/publisher', () => ({
  draftSave: mockDraftSave,
  draftList: mockDraftList,
  draftDelete: mockDraftDelete,
}))

vi.mock('element-plus', () => ({ ElMessage: mockMessage, ElMessageBox: { confirm: mockConfirm } }))

import { useCollectionDrafts } from './useCollectionDrafts'

describe('useCollectionDrafts（采集页草稿箱，统一到 draftSave/draftList 真源）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDraftSave.mockResolvedValue({ code: 0, data: { draftId: 'd1' } })
    mockDraftList.mockResolvedValue({ code: 0, data: [] })
    mockDraftDelete.mockResolvedValue({ code: 0, data: true })
    mockConfirm.mockResolvedValue(undefined) // 确认删除
  })

  it('保存走 draftSave（与发布页同源），不使用 store 设置通道', async () => {
    const { saveDraft } = useCollectionDrafts()
    const res = await saveDraft({ title: 'T', content: 'C', source: 'url' })
    expect(mockDraftSave).toHaveBeenCalledTimes(1)
    expect(res.ok).toBe(true)
    expect(res.draftId).toBe('d1')
  })

  // 与 usePublishDrafts.buildDraftSnapshot 同构：数组字段缺失必须回落 []，
  // 否则发布侧 publish-contract 会以「images 文件引用无效」阻断纯文字草稿
  // （E2E 2026-09-11 发现的同类缺陷）。
  it('数组字段缺失 → 保存 [] 而非空串', async () => {
    const { saveDraft } = useCollectionDrafts()
    await saveDraft({ title: 'T', content: 'C' })
    const snapshot = mockDraftSave.mock.calls[0][0]
    for (const f of ['images', 'image_files', 'tags', 'topics', 'mentions']) {
      expect(Array.isArray(snapshot[f])).toBe(true)
      expect(snapshot[f]).toEqual([])
    }
  })

  it('采集溯源字段 source / sourceUrl 一并落库', async () => {
    const { saveDraft } = useCollectionDrafts()
    await saveDraft({ title: 'T', content: 'C', source: 'rss', sourceUrl: 'https://ex.com/a' })
    expect(mockDraftSave.mock.calls[0][0]).toMatchObject({
      source: 'rss',
      sourceUrl: 'https://ex.com/a',
    })
  })

  it('coverImage 映射到发布侧的 cover_url（两种方言字段名不同，必须归一）', async () => {
    const { saveDraft } = useCollectionDrafts()
    await saveDraft({ title: 'T', content: 'C', coverImage: 'https://img/x.jpg' })
    expect(mockDraftSave.mock.calls[0][0].cover_url).toBe('https://img/x.jpg')
  })

  it('标题正文全空 → 拒绝并告警（默认不留空草稿）', async () => {
    const { saveDraft } = useCollectionDrafts()
    const res = await saveDraft({ title: '  ', content: '' })
    expect(res.ok).toBe(false)
    expect(mockDraftSave).not.toHaveBeenCalled()
    expect(mockMessage.warning).toHaveBeenCalled()
  })

  // allowEmpty 是给「新建空白草稿 → 跳发布页继续写」这一条路径的窄口子。
  // 主进程指纹把全空内容算成同一个 EMPTY_FINGERPRINT，不开口子则永远
  // 只能有一份空白草稿。
  it('allowEmpty 允许空白草稿（新建草稿路径）', async () => {
    const { saveDraft } = useCollectionDrafts()
    const res = await saveDraft({ title: '', content: '', source: 'manual' }, { allowEmpty: true })
    expect(res.ok).toBe(true)
    expect(mockDraftSave).toHaveBeenCalled()
  })

  it('draftSave 返回非 0 → ok=false 且不谎报成功', async () => {
    mockDraftSave.mockResolvedValue({ code: -1, message: '写入失败' })
    const { saveDraft } = useCollectionDrafts()
    const res = await saveDraft({ title: 'T', content: 'C' })
    expect(res).toEqual({ ok: false, draftId: null })
    expect(mockMessage.error).toHaveBeenCalled()
  })

  it('draftSave 抛异常 → 捕获并提示，不向上抛', async () => {
    mockDraftSave.mockRejectedValue(new Error('boom'))
    const { saveDraft } = useCollectionDrafts()
    await expect(saveDraft({ title: 'T', content: 'C' })).resolves.toEqual({ ok: false, draftId: null })
  })

  it('loadDrafts 读取失败 → drafts 清空且暴露错误信息（不得伪装成空列表）', async () => {
    mockDraftList.mockResolvedValue({ code: -1, message: '存储不可用' })
    const { loadDrafts, drafts, loadError } = useCollectionDrafts()
    const result = await loadDrafts()
    expect(result).toEqual([])
    expect(drafts.value).toEqual([])
    expect(loadError.value).toBeTruthy()
    expect(mockMessage.error).toHaveBeenCalled()
  })

  it('loadDrafts 非数组 data → 回落空数组', async () => {
    mockDraftList.mockResolvedValue({ code: 0, data: null })
    const { loadDrafts, drafts } = useCollectionDrafts()
    await loadDrafts()
    expect(drafts.value).toEqual([])
  })

  // 时间戳归一锁：历史采集页草稿写 created_at（本地化字符串），发布页草稿写
  // ISO createdAt。缺任一侧就退化成「另一套草稿时间全空白」。
  it('resolveCreatedAt 同时兼容 createdAt 与历史 created_at', () => {
    const { resolveCreatedAt } = useCollectionDrafts()
    expect(resolveCreatedAt({ createdAt: '2026-07-05T10:00:00.000Z' })).toBe('2026-07-05T10:00:00.000Z')
    expect(resolveCreatedAt({ created_at: '2026/7/5 10:00:00' })).toBe('2026/7/5 10:00:00')
    expect(resolveCreatedAt({})).toBe('')
    expect(resolveCreatedAt(null)).toBe('')
  })

  it('按时间倒序排列，两种时间字段混排也能正确排序', async () => {
    mockDraftList.mockResolvedValue({
      code: 0,
      data: [
        { id: 'old', created_at: '2026-01-01T00:00:00.000Z' },
        { id: 'new', createdAt: '2026-09-01T00:00:00.000Z' },
      ],
    })
    const { loadDrafts, sortedDrafts, draftCount } = useCollectionDrafts()
    await loadDrafts()
    expect(sortedDrafts.value[0].id).toBe('new')
    expect(draftCount.value).toBe(2)
  })

  it('无时间的草稿排在末尾，不因 Date.parse NaN 打乱顺序', async () => {
    mockDraftList.mockResolvedValue({
      code: 0,
      data: [
        { id: 'noTime' },
        { id: 'withTime', createdAt: '2026-09-01T00:00:00.000Z' },
      ],
    })
    const { loadDrafts, sortedDrafts } = useCollectionDrafts()
    await loadDrafts()
    expect(sortedDrafts.value[0].id).toBe('withTime')
    expect(sortedDrafts.value[1].id).toBe('noTime')
  })

  it('删除需确认，取消则不调 draftDelete', async () => {
    mockConfirm.mockRejectedValue(new Error('cancel'))
    const { removeDraft } = useCollectionDrafts()
    const ok = await removeDraft('d1')
    expect(ok).toBe(false)
    expect(mockDraftDelete).not.toHaveBeenCalled()
  })

  it('确认后删除并刷新列表', async () => {
    const { removeDraft } = useCollectionDrafts()
    const ok = await removeDraft('d1')
    expect(ok).toBe(true)
    expect(mockDraftDelete).toHaveBeenCalledWith('d1')
    expect(mockDraftList).toHaveBeenCalled()
  })

  it('删除空 id → 直接返回 false，不发无意义的 IPC', async () => {
    const { removeDraft } = useCollectionDrafts()
    expect(await removeDraft('')).toBe(false)
    expect(mockDraftDelete).not.toHaveBeenCalled()
  })

  it('resolveWordCount / resolveSummary / resolvePlatformCount 边界', () => {
    const { resolveWordCount, resolveSummary, resolvePlatformCount } = useCollectionDrafts()
    expect(resolveWordCount({ content: 'abc' })).toBe(3)
    expect(resolveWordCount({})).toBe(0)
    expect(resolveSummary({ content: '短' })).toBe('短')
    expect(resolveSummary({ content: '' })).toBe('')
    // 长正文截断并带省略号
    expect(resolveSummary({ content: 'x'.repeat(100) }).endsWith('…')).toBe(true)
    expect(resolvePlatformCount({ platforms: ['a', 'b'] })).toBe(2)
    // 采集页产生的草稿无 platforms → 0（卡片据此隐藏标签，不得显示 undefined）
    expect(resolvePlatformCount({})).toBe(0)
  })
})
