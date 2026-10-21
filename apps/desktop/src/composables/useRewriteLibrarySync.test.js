/**
 * useRewriteLibrarySync 单测（rewrite-view-decompose，2026-10-21）。
 *
 * 为什么要有这个文件：改写结果回写文案库有**两条互斥写入路径**：
 *   · 交接场景（from=collection 带 fromKey）⇒ 按 fromKey 覆盖原记录；
 *   · 普通场景 ⇒ 按「正文哈希」稳定 key 写入（同一正文连续改写 = 覆盖，不同正文 = 追加）。
 * 两条都走会在文案库里落双份记录（双模型评审 MAJOR-2/3 记录过这个形态）。
 * 拆成 composable 后，「互斥」这件事必须由**调用方**保证（选择走哪条），
 * 而「每条路径自身写什么 key、写什么字段」由本文件锁住。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ref } from 'vue'
import { useRewriteLibrarySync } from './useRewriteLibrarySync'

const upsertRewrite = vi.fn()

vi.mock('@/composables/useCopyLibrary', () => ({
  useCopyLibrary: () => ({ upsertRewrite }),
}))

function setup (overrides = {}) {
  const deps = {
    rewriteResult: ref(overrides.rewriteResult ?? '这是改写后的文案内容。'),
    rewriteTitle: ref(overrides.rewriteTitle ?? '改写标题'),
    platform: ref(overrides.platform ?? 'douyin'),
  }
  return { deps, ...useRewriteLibrarySync(deps) }
}

beforeEach(() => {
  vi.clearAllMocks()
  upsertRewrite.mockResolvedValue({ code: 0 })
})

describe('useRewriteLibrarySync — 交接场景（按 fromKey 覆盖原记录）', () => {
  it('写入 fromKey / fromTitle / title / content / platform / sourceUrl 六个字段', async () => {
    const { syncHandoffToLibrary } = setup()
    await syncHandoffToLibrary({
      fromKey: 'collect:rec_1',
      fromTitle: '原文标题',
      title: '交接标题',
      platform: 'wechat_mp',
      sourceUrl: 'https://example.com/a',
    })
    expect(upsertRewrite).toHaveBeenCalledTimes(1)
    expect(upsertRewrite).toHaveBeenCalledWith({
      fromKey: 'collect:rec_1',
      fromTitle: '原文标题',
      title: '改写标题',
      content: '这是改写后的文案内容。',
      platform: 'wechat_mp',
      sourceUrl: 'https://example.com/a',
    })
  })

  it('无 fromKey ⇒ 不写（交接载荷不完整时不得落一条无主记录）', async () => {
    const { syncHandoffToLibrary } = setup()
    await syncHandoffToLibrary({ title: '没有 fromKey' })
    expect(upsertRewrite).not.toHaveBeenCalled()
  })

  it('载荷为 null ⇒ 不写', async () => {
    const { syncHandoffToLibrary } = setup()
    await syncHandoffToLibrary(null)
    expect(upsertRewrite).not.toHaveBeenCalled()
  })
})

describe('useRewriteLibrarySync — 普通场景（按正文哈希稳定 key）', () => {
  it('fromKey 形如 rewrite:<正文哈希>，同一正文连续改写落在同一条记录上', async () => {
    const { syncResultToLibrary } = setup()
    await syncResultToLibrary()
    const arg = upsertRewrite.mock.calls[0][0]
    expect(arg.fromKey).toMatch(/^rewrite:[0-9a-z]+$/)
    // 同一正文再写一次 ⇒ key 必须相同（否则文案库被重复改写刷屏）
    upsertRewrite.mockClear()
    await syncResultToLibrary()
    expect(upsertRewrite.mock.calls[0][0].fromKey).toBe(arg.fromKey)
  })

  it('不同正文 ⇒ key 不同（追加而非覆盖）', async () => {
    const { deps, syncResultToLibrary } = setup()
    await syncResultToLibrary()
    const first = upsertRewrite.mock.calls[0][0].fromKey
    upsertRewrite.mockClear()
    deps.rewriteResult.value = '另一段完全不同的改写结果内容。'
    await syncResultToLibrary()
    expect(upsertRewrite.mock.calls[0][0].fromKey).not.toBe(first)
  })

  it('写入当前平台与改写标题', async () => {
    const { syncResultToLibrary } = setup()
    await syncResultToLibrary()
    expect(upsertRewrite.mock.calls[0][0]).toMatchObject({
      title: '改写标题',
      content: '这是改写后的文案内容。',
      platform: 'douyin',
      sourceUrl: '',
      fromTitle: '',
    })
  })
})

describe('useRewriteLibrarySync — 边界与失败处理', () => {
  it('改写结果为空白 ⇒ 不写（不得把空串写进文案库）', async () => {
    const { syncResultToLibrary, syncHandoffToLibrary } = setup({ rewriteResult: '   ' })
    await syncResultToLibrary()
    await syncHandoffToLibrary({ fromKey: 'collect:rec_1' })
    expect(upsertRewrite).not.toHaveBeenCalled()
  })

  it('写入失败 ⇒ 静默吞掉（不得把异常抛给改写主流程：改写已经成功了）', async () => {
    upsertRewrite.mockRejectedValueOnce(new Error('settings write failed'))
    const { syncResultToLibrary } = setup()
    await expect(syncResultToLibrary()).resolves.toBeUndefined()
  })
})
