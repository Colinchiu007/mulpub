import { describe, it, expect, vi, beforeEach } from 'vitest'

const storeGetSetting = vi.fn()
const storeSetSetting = vi.fn()

vi.mock('@/api/publisher', () => ({
  storeGetSetting: (...args) => storeGetSetting(...args),
  storeSetSetting: (...args) => storeSetSetting(...args),
}))

import {
  useCopyLibrary,
  buildCopyLibraryItems,
  parseCopyRewriteRaw,
  collectFromKey,
  COPY_REWRITES_KEY,
  MAX_COPY_REWRITES,
  ORIGIN_COLLECT,
  ORIGIN_REWRITE,
} from './useCopyLibrary'

describe('parseCopyRewriteRaw', () => {
  it('null 表示读取不可用', () => {
    expect(parseCopyRewriteRaw(null)).toBeNull()
    expect(parseCopyRewriteRaw(undefined)).toBeNull()
  })

  it('解析 JSON 字符串与数组', () => {
    expect(parseCopyRewriteRaw('[{"id":"a"}]')).toEqual([{ id: 'a' }])
    expect(parseCopyRewriteRaw([{ id: 'b' }])).toEqual([{ id: 'b' }])
  })

  it('非法内容回落为空数组', () => {
    expect(parseCopyRewriteRaw('not-json{{{')).toEqual([])
    expect(parseCopyRewriteRaw('{"a":1}')).toEqual([])
  })
})

describe('buildCopyLibraryItems', () => {
  it('合并采集正文与改写文案，并标注性质', () => {
    const items = buildCopyLibraryItems(
      [{ id: 'c1', title: '采集标题', content: '采集正文', wordCount: 12, sourceUrl: 'https://a.com' }],
      [{ id: 'r1', fromKey: 'collect:c1', fromTitle: '采集标题', title: '采集标题', content: '改写正文', createdAt: '2026-09-14T10:00:00.000Z', platform: 'douyin' }]
    )
    expect(items).toHaveLength(2)
    expect(items[0]).toMatchObject({
      id: 'rewrite:r1',
      origin: ORIGIN_REWRITE,
      content: '改写正文',
      fromTitle: '采集标题',
      platform: 'douyin',
    })
    expect(items[1]).toMatchObject({
      id: 'collect:c1',
      origin: ORIGIN_COLLECT,
      title: '采集标题',
      content: '采集正文',
      sourceUrl: 'https://a.com',
    })
  })

  it('无正文的采集记录不进入文案库', () => {
    const items = buildCopyLibraryItems(
      [
        { id: 'c1', title: '空', content: '', description: '' },
        { id: 'c2', title: '仅有描述', description: '描述即正文' },
        { id: 'c3', content: '有正文' },
      ],
      []
    )
    expect(items.map((i) => i.id)).toEqual(['collect:c2', 'collect:c3'])
    expect(items[0].content).toBe('描述即正文')
  })

  it('缺少 id 的条目被丢弃（避免 key 冲突）', () => {
    const items = buildCopyLibraryItems([{ title: 'no id', content: 'x' }], [{ content: 'y' }])
    expect(items).toEqual([])
  })

  it('按时间倒序：有时间在前，无时间保持原顺序在后', () => {
    const items = buildCopyLibraryItems(
      [{ id: 'c1', content: 'no time' }],
      [
        { id: 'r1', content: 'older', createdAt: '2026-09-14T01:00:00.000Z' },
        { id: 'r2', content: 'newer', createdAt: '2026-09-14T09:00:00.000Z' },
      ]
    )
    expect(items.map((i) => i.id)).toEqual(['rewrite:r2', 'rewrite:r1', 'collect:c1'])
  })

  it('容错：非数组入参返回空列表', () => {
    expect(buildCopyLibraryItems(null, undefined)).toEqual([])
  })
})

describe('collectFromKey', () => {
  it('生成采集来源键（与文案库面板 item.id 一致）', () => {
    expect(collectFromKey('abc')).toBe('collect:abc')
    expect(collectFromKey()).toBe('collect:')
  })
})

describe('useCopyLibrary', () => {
  beforeEach(() => {
    storeGetSetting.mockReset()
    storeSetSetting.mockReset()
    storeSetSetting.mockResolvedValue(undefined)
  })

  it('load 读取持久化改写文案', async () => {
    storeGetSetting.mockResolvedValue(JSON.stringify([{ id: 'r1', content: 'x' }]))
    const lib = useCopyLibrary()
    await lib.load()
    expect(storeGetSetting).toHaveBeenCalledWith(COPY_REWRITES_KEY)
    expect(lib.rewrites.value).toEqual([{ id: 'r1', content: 'x' }])
    expect(lib.loaded.value).toBe(true)
  })

  it('load 在读取不可用时保持现状', async () => {
    storeGetSetting.mockResolvedValue(null)
    const lib = useCopyLibrary()
    await lib.load()
    expect(lib.rewrites.value).toEqual([])
  })

  it('upsertRewrite 写入并落库', async () => {
    storeGetSetting.mockResolvedValue(null)
    const lib = useCopyLibrary()
    const record = await lib.upsertRewrite({
      fromKey: 'collect:c1',
      fromTitle: '原标题',
      content: '改写后的正文',
      platform: 'douyin',
    })
    expect(record.id).toBeTruthy()
    expect(record.wordCount).toBe('改写后的正文'.length)
    expect(record.createdAt).toBeTruthy()
    const [key, payload] = storeSetSetting.mock.calls[0]
    expect(key).toBe(COPY_REWRITES_KEY)
    expect(JSON.parse(payload)[0]).toMatchObject({ fromKey: 'collect:c1', content: '改写后的正文' })
    expect(lib.rewrites.value).toHaveLength(1)
  })

  it('同一 fromKey 重复改写成覆盖（不追加）', async () => {
    storeGetSetting.mockResolvedValue(JSON.stringify([{ id: 'r1', fromKey: 'collect:c1', content: '第一次' }]))
    const lib = useCopyLibrary()
    await lib.upsertRewrite({ fromKey: 'collect:c1', content: '第二次' })
    const next = JSON.parse(storeSetSetting.mock.calls[0][1])
    expect(next).toHaveLength(1)
    expect(next[0]).toMatchObject({ id: 'r1', content: '第二次' })
    expect(lib.rewrites.value).toHaveLength(1)
  })

  it('不同来源各自保留一条', async () => {
    storeGetSetting.mockResolvedValue(JSON.stringify([{ id: 'r1', fromKey: 'collect:c1', content: 'A' }]))
    const lib = useCopyLibrary()
    await lib.upsertRewrite({ fromKey: 'collect:c2', content: 'B' })
    expect(lib.rewrites.value.map((r) => r.fromKey)).toEqual(['collect:c2', 'collect:c1'])
  })

  it('空内容不入库', async () => {
    storeGetSetting.mockResolvedValue(null)
    const lib = useCopyLibrary()
    expect(await lib.upsertRewrite({ fromKey: 'collect:c1', content: '   ' })).toBeNull()
    expect(await lib.upsertRewrite(null)).toBeNull()
    expect(storeSetSetting).not.toHaveBeenCalled()
  })

  it('超过上限时丢弃最旧记录', async () => {
    const existing = Array.from({ length: MAX_COPY_REWRITES }, (_, i) => ({ id: 'r' + i, fromKey: 'k' + i, content: 'c' + i }))
    storeGetSetting.mockResolvedValue(JSON.stringify(existing))
    const lib = useCopyLibrary()
    await lib.upsertRewrite({ fromKey: 'new', content: 'new' })
    const next = JSON.parse(storeSetSetting.mock.calls[0][1])
    expect(next).toHaveLength(MAX_COPY_REWRITES)
    expect(next[0].fromKey).toBe('new')
    expect(next.some((r) => r.id === 'r' + (MAX_COPY_REWRITES - 1))).toBe(false)
  })

  it('removeRewrite 按 id 删除', async () => {
    storeGetSetting.mockResolvedValue(JSON.stringify([{ id: 'r1', content: 'x' }, { id: 'r2', content: 'y' }]))
    const lib = useCopyLibrary()
    await lib.removeRewrite('r1')
    expect(JSON.parse(storeSetSetting.mock.calls[0][1])).toEqual([{ id: 'r2', content: 'y' }])
  })

  it('reset 清空内存态', async () => {
    storeGetSetting.mockResolvedValue(JSON.stringify([{ id: 'r1', content: 'x' }]))
    const lib = useCopyLibrary()
    await lib.load()
    lib.reset()
    expect(lib.rewrites.value).toEqual([])
    expect(lib.loaded.value).toBe(false)
  })
})
