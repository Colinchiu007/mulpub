/**
 * content-categories.test.js — 统一内容类别归一化（渲染层）
 *
 * 主线三条：① fail-open 回退内置 ② 逐条归类出声 ③ 内置 key 与 classifier 一致
 */
import { describe, it, expect } from 'vitest'
import {
  DEFAULT_CATEGORY_KEYS,
  defaultItems,
  normalizeContentCategories,
  resolveCategoryLabel,
  isValidCategoryKey,
  resolveDefaultCategoryName,
} from '@/features/content/content-categories'
// 真实 import 抓取侧分类器（CJS），不再手抄字面量副本——手抄副本会让
// 「renderer / electron / classifier」三方中的两方漂移时三份测试同时保持绿色。
import classifier from '../../../electron/services/hot-topics/classifier.js'

describe('统一内容类别 · 内置目录', () => {
  it('内置 11 类与抓取分类器 CATEGORY_KEYS 键名顺序一致（真实 import 比对）', () => {
    expect([...DEFAULT_CATEGORY_KEYS]).toEqual([...classifier.CATEGORY_KEYS])
  })

  it('defaultItems 带 0..n-1 的 sort_order', () => {
    expect(defaultItems().map((i) => i.sort_order)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
  })
})

describe('统一内容类别 · fail-open 回退', () => {
  it('未下发（null）→ 内置 11 类 + invalidShape', () => {
    const r = normalizeContentCategories(null)
    expect(r.items).toHaveLength(11)
    expect(r.usingDefault).toBe(true)
    expect(r.invalidShape).toBe(true)
  })

  it('下发空数组 → 内置 11 类（不让界面变零分类）', () => {
    const r = normalizeContentCategories({ items: [] })
    expect(r.items).toHaveLength(11)
    expect(r.usingDefault).toBe(true)
    expect(r.invalidShape).toBe(false)
  })

  it('结构非法（字符串 / items 非数组）→ 内置 11 类', () => {
    expect(normalizeContentCategories('oops').usingDefault).toBe(true)
    expect(normalizeContentCategories({ items: 'oops' }).usingDefault).toBe(true)
    expect(normalizeContentCategories(42).usingDefault).toBe(true)
  })

  it('全部条目非法 → 回退内置，且逐条记录原因', () => {
    const r = normalizeContentCategories({ items: [{ category_key: 'Bad Key' }, null, 7] })
    expect(r.usingDefault).toBe(true)
    expect(r.dropped.length).toBeGreaterThan(0)
    expect(r.dropped.some((d) => d.reason === 'key')).toBe(true)
  })
})

describe('统一内容类别 · 归一化与校验', () => {
  it('合法下发：保留 name、按 sort_order 排序并归一化 0..n-1', () => {
    const r = normalizeContentCategories({
      items: [
        { category_key: 'tech', name: '科技前沿', sort_order: 5 },
        { category_key: 'finance', name: '财经', sort_order: 1 },
      ],
    })
    expect(r.usingDefault).toBe(false)
    expect(r.items.map((i) => i.category_key)).toEqual(['finance', 'tech'])
    expect(r.items.map((i) => i.sort_order)).toEqual([0, 1])
    expect(r.items[1].name).toBe('科技前沿')
  })

  it('缺 name 时回退内置键（本地化由 resolveDefaultCategoryName 解析），未知 key 回退自身', () => {
    const r = normalizeContentCategories({ items: [{ category_key: 'tech' }, { category_key: 'zzz' }] })
    // 内置回退名的 name 现在是 key（不再写死中文），本地化在展示层经 i18n 解析
    expect(r.items.find((i) => i.category_key === 'tech').name).toBe('tech')
    expect(r.items.find((i) => i.category_key === 'zzz').name).toBe('zzz')
  })

  it('重复 key 去重并记 dropped', () => {
    const r = normalizeContentCategories({
      items: [{ category_key: 'tech', name: 'A' }, { category_key: 'tech', name: 'B' }],
    })
    expect(r.items).toHaveLength(1)
    expect(r.dropped.some((d) => d.reason === 'duplicate')).toBe(true)
  })

  it('超过 50 条截断并记 limit', () => {
    const items = Array.from({ length: 55 }, (_, i) => ({ category_key: `k${i}`, name: `n${i}` }))
    const r = normalizeContentCategories({ items })
    expect(r.items).toHaveLength(50)
    expect(r.dropped.some((d) => d.reason === 'limit')).toBe(true)
  })

  it('name 超过 20 字截断', () => {
    const r = normalizeContentCategories({ items: [{ category_key: 'tech', name: 'a'.repeat(30) }] })
    expect(r.items[0].name).toHaveLength(20)
  })
})

describe('统一内容类别 · 显示名与 key 校验', () => {
  it('resolveCategoryLabel：下发值优先 → 内置键 → key', () => {
    const items = [{ category_key: 'tech', name: '科学技术' }]
    expect(resolveCategoryLabel('tech', items)).toBe('科学技术')
    // 内置回退名的 name 现在是 key 本身（本地化由 resolveDefaultCategoryName 经 i18n 解析），
    // 因此「下发里没有」时 resolveCategoryLabel 返回 key，再由上层用 t 解析。
    expect(resolveCategoryLabel('emotion', items)).toBe('emotion')
    expect(resolveCategoryLabel('brand_new', items)).toBe('brand_new')
    expect(resolveCategoryLabel('tech', null)).toBe('tech')
  })

  it('resolveDefaultCategoryName 经 t 解析出本地化名', () => {
    const t = (k) => ({ 'contentCategories.tech': '科技', 'contentCategories.emotion': '情感' })[k] || k
    expect(resolveDefaultCategoryName('tech', t)).toBe('科技')
    expect(resolveDefaultCategoryName('emotion', t)).toBe('情感')
    // i18n 缺失（t 回显键名）时退回 key，不让界面显示 "contentCategories.xxx"
    const raw = (k) => k
    expect(resolveDefaultCategoryName('tech', raw)).toBe('tech')
  })

  it('isValidCategoryKey 拒绝非法形态', () => {
    expect(isValidCategoryKey('tech')).toBe(true)
    expect(isValidCategoryKey('a')).toBe(false) // 长度 < 2
    expect(isValidCategoryKey('1abc')).toBe(false) // 数字开头
    expect(isValidCategoryKey('Bad')).toBe(false) // 大写
    expect(isValidCategoryKey('has space')).toBe(false)
    expect(isValidCategoryKey('')).toBe(false)
    expect(isValidCategoryKey(null)).toBe(false)
  })
})
