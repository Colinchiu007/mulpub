/**
 * collected-item.test.js — 采集条目归一化与类别标签
 *
 * 主线：① 所有构造路径产出一致形状 ② tags 校验逐条出声 ③ 未知类别保留
 */
import { describe, it, expect } from 'vitest'
import {
  normalizeCollectedItem,
  normalizeItemTags,
  itemTags,
  MAX_ITEM_CATEGORY_TAGS,
} from '@/features/collection/collected-item'

const CTX = { knownCategoryKeys: ['tech', 'finance', 'emotion'] }

describe('采集条目 · 归一化形状一致', () => {
  it('最不完整的一条（批量轮询）也补齐全部字段', () => {
    const item = normalizeCollectedItem({
      id: 'x1', title: '标题', content: '正文', source: 'batch', sourceUrl: 'https://e.com/a',
    })
    expect(item.id).toBe('x1')
    expect(item.tags).toEqual([])
    expect(item.description).toBe('正文')
    expect(item.wordCount).toBe(2)
    expect(item.platform).toBe('')
    expect(item.createdAt).toBe('')
  })

  it('description 与 wordCount 可从 content 推导', () => {
    const item = normalizeCollectedItem({ content: 'a'.repeat(300) })
    expect(item.description).toHaveLength(120)
    expect(item.wordCount).toBe(300)
  })

  it('兼容 word_count 拼写（历史数据两种拼写都在）', () => {
    expect(normalizeCollectedItem({ content: 'abc', word_count: 3 }).wordCount).toBe(3)
    expect(normalizeCollectedItem({ content: 'abcd', wordCount: 4 }).wordCount).toBe(4)
  })

  it('wordCount 按**码点**计（与改写稿字数同口径，外部评审 i4）', () => {
    // '😀' = 1 码点 / 2 UTF-16 码元：卡片上「原文 N 字 · 改写 M 字」必须同口径
    const item = normalizeCollectedItem({ content: '😀' })
    expect(item.wordCount).toBe(1)
  })

  it('空输入不抛错，产出带 id 的空条目', () => {
    const item = normalizeCollectedItem(null)
    expect(typeof item.id).toBe('string')
    expect(item.tags).toEqual([])
  })
})

describe('采集条目 · 类别标签校验', () => {
  it('合法标签保留并去重', () => {
    const r = normalizeItemTags(['tech', 'finance', 'tech'], CTX)
    expect(r.tags).toEqual(['tech', 'finance'])
    expect(r.dropped).toEqual([])
  })

  it('非法 key 丢弃并记入 dropped', () => {
    const r = normalizeItemTags(['tech', 'Bad Key', '1abc', 42], CTX)
    expect(r.tags).toEqual(['tech'])
    expect(r.dropped).toContain('Bad Key')
    expect(r.dropped).toContain('1abc')
    expect(r.dropped).toContain('42')
  })

  it('超 5 个截断并记入 dropped', () => {
    const tags = ['tech', 'finance', 'emotion', 'k3', 'k4', 'k5', 'k6']
    const r = normalizeItemTags(tags, { knownCategoryKeys: tags })
    expect(r.tags).toHaveLength(MAX_ITEM_CATEGORY_TAGS)
    expect(r.dropped.length).toBe(2)
  })

  it('非数组 → 记 dropped 且标记 invalid（不静默当空）', () => {
    const r = normalizeItemTags('tech')
    expect(r.tags).toEqual([])
    expect(r.invalid).toBe(true)
    expect(r.dropped).toEqual(['tech'])
  })

  it('缺失 / null → 空标签，不记 invalid（历史数据本来就缺字段）', () => {
    expect(normalizeItemTags(undefined).tags).toEqual([])
    expect(normalizeItemTags(undefined).invalid).toBeFalsy()
    expect(normalizeItemTags(null).tags).toEqual([])
  })
})

describe('采集条目 · 未知类别保留（可恢复引用）', () => {
  it('未知 key 保留在 tags 里，但记入 unknown 出声', () => {
    const r = normalizeItemTags(['tech', 'brand_new'], CTX)
    expect(r.tags).toEqual(['tech', 'brand_new'])
    expect(r.unknown).toEqual(['brand_new'])
  })

  it('未传 knownCategoryKeys 时不判未知（不臆断）', () => {
    const r = normalizeItemTags(['tech', 'brand_new'])
    expect(r.unknown).toEqual([])
  })

  it('条目级归一化透传 unknown 判定', () => {
    const item = normalizeCollectedItem({ content: 'x', tags: ['tech', 'deleted_cat'] }, CTX)
    expect(item.tags).toEqual(['tech', 'deleted_cat'])
  })
})

describe('采集条目 · 读取兼容', () => {
  it('itemTags 兼容缺失字段的历史条目', () => {
    expect(itemTags({})).toEqual([])
    expect(itemTags(null)).toEqual([])
    expect(itemTags({ tags: ['tech'] })).toEqual(['tech'])
  })
})
