// @ts-check
/**
 * P1-a 回采写回爆款库契约测试（viral-library-integration PR-2，TDD）
 * U-201 _normUrlForMatch 表驱动；U-202 updateViralEngagementByNormUrl 单调不减。
 */
const mixin = require('./knowledge-library-store')

describe('_normUrlForMatch（U-201）', () => {
  it('U-201a: 协议/大小写/尾斜杠/utm 参/fragment → 同一 norm 键', () => {
    const variants = [
      'https://Example.com/a/b?utm_source=x&y=1#frag',
      'http://example.com/a/b?y=1',
      'https://example.com/a/b/?y=1',
      'https://example.com/a/b?utm_medium=feed&y=1',
    ]
    const keys = variants.map((v) => mixin._normUrlForMatch(v))
    for (const k of keys) expect(k).toBe(keys[0])
  })
  it('U-201b: 不同路径不误合；非字符串/空 → 空串', () => {
    expect(mixin._normUrlForMatch('https://example.com/a')).not.toBe(mixin._normUrlForMatch('https://example.com/b'))
    expect(mixin._normUrlForMatch(null)).toBe('')
    expect(mixin._normUrlForMatch('')).toBe('')
    expect(mixin._normUrlForMatch(123)).toBe('')
  })
  it('U-201c: 仅 host 小写，path 大小写保留（平台路径区分大小写不误合）', () => {
    expect(mixin._normUrlForMatch('https://EXAMPLE.com/AbC')).toBe(mixin._normUrlForMatch('https://example.com/AbC'))
    expect(mixin._normUrlForMatch('https://example.com/abc')).not.toBe(mixin._normUrlForMatch('https://example.com/AbC'))
  })
})

function makeFake (rows) {
  const captured = { updates: [] }
  const db = {
    prepare (sql) {
      if (/^\s*SELECT/i.test(sql)) {
        return { all: () => rows.map((r) => Object.assign({}, r)), get: () => null }
      }
      const rec = { sql, args: null }
      captured.updates.push(rec)
      return { run (...a) { rec.args = a; return { changes: 1 } } }
    },
  }
  return { db, captured, self: { _ready: true, db } }
}

describe('updateViralEngagementByNormUrl（U-202）', () => {
  const url = 'https://example.com/note/123'

  it('U-202a: 目标列 NULL → 回补写（likes/comments + id 收尾参数）', () => {
    const f = makeFake([{ id: 'v1', url, likes: null, comments: null, collections: null }])
    const r = mixin.updateViralEngagementByNormUrl.call(f.self, url, { likes: 6000, comments: 30 })
    expect(r).toEqual({ matched: 1, updated: 1 })
    const a = f.captured.updates[0].args
    expect(a).toContain(6000)
    expect(a).toContain(30)
    expect(a[a.length - 1]).toBe('v1')
  })

  it('U-202b: 变大更新；变小拒绝——UPDATE 参数不出现更小值', () => {
    const f = makeFake([{ id: 'v2', url, likes: 6000, comments: 10, collections: null }])
    const r = mixin.updateViralEngagementByNormUrl.call(f.self, url, { likes: 5000, comments: 25 })
    expect(r.updated).toBe(1)
    const a = f.captured.updates[0].args
    expect(a).not.toContain(5000)
    expect(a).toContain(25)
  })

  it('U-202c: 相等 → no-op（零 UPDATE 发出）', () => {
    const f = makeFake([{ id: 'v3', url, likes: 100, comments: 5, collections: null }])
    const r = mixin.updateViralEngagementByNormUrl.call(f.self, url, { likes: 100, comments: 5 })
    expect(r).toEqual({ matched: 1, updated: 0 })
    expect(f.captured.updates.length).toBe(0)
  })

  it('U-202d: URL 变体命中同一条目（http/https、utm、大小写差异）', () => {
    const f = makeFake([{ id: 'v4', url: 'https://Example.com/note/123?utm_source=x', likes: null, comments: null, collections: null }])
    const r = mixin.updateViralEngagementByNormUrl.call(f.self, 'http://example.com/note/123/', { likes: 7, comments: 2 })
    expect(r).toEqual({ matched: 1, updated: 1 })
  })

  it('U-202e: 更新 likes 且 collections 已知 → ratio 重算（P0-c 口径）', () => {
    const f = makeFake([{ id: 'v5', url, likes: null, comments: null, collections: 100 }])
    mixin.updateViralEngagementByNormUrl.call(f.self, url, { likes: 1234, comments: null })
    const a = f.captured.updates[0].args
    expect(a).toContain(1234)
    expect(a).toContain(12.34)
  })

  it('U-202f: 回采字段未知（null）不动旧值；全无更新 → updated=0', () => {
    const f = makeFake([{ id: 'v6', url, likes: 50, comments: 5, collections: null }])
    const r = mixin.updateViralEngagementByNormUrl.call(f.self, url, { likes: null, comments: undefined })
    expect(r).toEqual({ matched: 1, updated: 0 })
    expect(f.captured.updates.length).toBe(0)
  })

  it('U-202g: 无匹配条目 → matched=0 且零 UPDATE', () => {
    const f = makeFake([{ id: 'v7', url: 'https://other.com/z', likes: null, comments: null, collections: null }])
    const r = mixin.updateViralEngagementByNormUrl.call(f.self, url, { likes: 1, comments: 1 })
    expect(r).toEqual({ matched: 0, updated: 0 })
    expect(f.captured.updates.length).toBe(0)
  })

  it('U-202h: 入参非法 URL（空串）→ 直接 0/0，不发 SELECT', () => {
    const f = makeFake([])
    const r = mixin.updateViralEngagementByNormUrl.call(f.self, '', { likes: 1 })
    expect(r).toEqual({ matched: 0, updated: 0 })
    expect(f.captured.updates.length).toBe(0)
  })
})
