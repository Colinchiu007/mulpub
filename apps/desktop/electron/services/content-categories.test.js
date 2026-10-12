/**
 * content-categories.test.js — 统一内容类别归一化（主进程 CJS 版）
 *
 * 判据口径必须与渲染层 src/features/content/content-categories.js 完全一致
 * （同一运营下发，主进程与渲染层必须看到同一套类别）。改任一侧须同步改另一侧。
 */
const {
  DEFAULT_CATEGORY_KEYS,
  defaultItems,
  normalizeContentCategories,
  resolveCategoryLabel,
} = require('./content-categories')

// 抓取侧分类器的 CATEGORY_KEYS（electron/services/hot-topics/classifier.js）
const CLASSIFIER_KEYS = [
  'general', 'society', 'finance', 'tech', 'ai', 'entertainment',
  'sports', 'emotion', 'education', 'health', 'international',
]

describe('统一内容类别（主进程）· 内置目录', () => {
  it('内置 11 类与 classifier.js CATEGORY_KEYS 一致', () => {
    expect([...DEFAULT_CATEGORY_KEYS]).toEqual(CLASSIFIER_KEYS)
  })

  it('defaultItems 带 0..n-1 sort_order', () => {
    expect(defaultItems().map((i) => i.sort_order)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
  })
})

describe('统一内容类别（主进程）· fail-open 回退', () => {
  it('未下发 / 空 / 结构非法 → 内置 11 类', () => {
    expect(normalizeContentCategories(null).usingDefault).toBe(true)
    expect(normalizeContentCategories(undefined).usingDefault).toBe(true)
    expect(normalizeContentCategories({ items: [] }).usingDefault).toBe(true)
    expect(normalizeContentCategories('oops').usingDefault).toBe(true)
    expect(normalizeContentCategories({ items: 'oops' }).usingDefault).toBe(true)
  })

  it('全部条目非法 → 回退内置 + 逐条 dropped', () => {
    const r = normalizeContentCategories({ items: [{ category_key: 'Bad Key' }, null] })
    expect(r.usingDefault).toBe(true)
    expect(r.dropped.length).toBeGreaterThan(0)
  })
})

describe('统一内容类别（主进程）· 归一化', () => {
  it('按 sort_order 排序并归一化 0..n-1', () => {
    const r = normalizeContentCategories({
      items: [
        { category_key: 'tech', name: '科技前沿', sort_order: 5 },
        { category_key: 'finance', name: '财经', sort_order: 1 },
      ],
    })
    expect(r.items.map((i) => i.category_key)).toEqual(['finance', 'tech'])
    expect(r.items.map((i) => i.sort_order)).toEqual([0, 1])
    expect(r.items[1].name).toBe('科技前沿')
  })

  it('重复 key 去重并记 duplicate', () => {
    const r = normalizeContentCategories({
      items: [{ category_key: 'tech', name: 'A' }, { category_key: 'tech', name: 'B' }],
    })
    expect(r.items).toHaveLength(1)
    expect(r.dropped.some((d) => d.reason === 'duplicate')).toBe(true)
  })

  it('超 50 条截断并记 limit', () => {
    const items = Array.from({ length: 55 }, (_, i) => ({ category_key: `k${i}`, name: `n${i}` }))
    expect(normalizeContentCategories({ items }).items).toHaveLength(50)
  })
})

describe('统一内容类别（主进程）· 显示名', () => {
  it('resolveCategoryLabel 三级回退', () => {
    const items = [{ category_key: 'tech', name: '科学技术' }]
    expect(resolveCategoryLabel('tech', items)).toBe('科学技术')
    expect(resolveCategoryLabel('emotion', items)).toBe('情感')
    expect(resolveCategoryLabel('unknown_key', items)).toBe('unknown_key')
  })
})
