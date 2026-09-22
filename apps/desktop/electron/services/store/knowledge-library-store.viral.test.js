// @ts-check
/**
 * knowledge-library-store 爆款库 P0 契约测试（viral-library-integration）
 *
 * 直接以 fake db 驱动 mixin 方法（不依赖 Electron/真实 sql.js）：
 * - normalizeViralItem 经 addViralItem 落库参数断言 NULL/0 语义（U-105/106）
 * - searchViralItems SQL 含 IFNULL（U-107，NULL 参与排序口径锁定）
 */
const mixin = require('./knowledge-library-store')

function makeFake () {
  const captured = { sqls: [], args: [] }
  const db = {
    prepare (sql) {
      captured.sqls.push(sql)
      return {
        run (...a) { captured.args.push(a); return { changes: 1 } },
        get () { return null },
        all () { return [] },
      }
    },
  }
  return { mixin, db, captured, self: { _ready: true, db, getViralItem: () => null } }
}

function addArgs (item) {
  const f = makeFake()
  mixin.addViralItem.call(f.self, item)
  return f.captured.args[0] || []
}

describe('viral_library P0 NULL 语义（normalizeViralItem）', () => {
  const base = { id: 'v1', content: '正文内容', title: '标题' }

  it('U-105a: 字段缺失/undefined → 存 NULL（不是 0）', () => {
    const a = addArgs(base)
    const likes = a[7]; const collections = a[8]; const comments = a[9]; const ratio = a[10]
    expect(likes).toBeNull()
    expect(collections).toBeNull()
    expect(comments).toBeNull()
    expect(ratio).toBeNull()
  })

  it('U-105b: 真 0 如实保留 0', () => {
    const a = addArgs({ ...base, likes: 0, comments: 0, collections: 0 })
    expect(a[7]).toBe(0)
    expect(a[9]).toBe(0)
  })

  it('U-105c: 负数/NaN/字符串数字/超 MAX_SAFE 的处置', () => {
    expect(addArgs({ ...base, likes: -5 })[7]).toBeNull()
    expect(addArgs({ ...base, likes: NaN })[7]).toBeNull()
    expect(addArgs({ ...base, likes: '1234' })[7]).toBe(1234)
    expect(addArgs({ ...base, likes: Number.MAX_SAFE_INTEGER + 10 })[7]).toBeNull()
  })

  it('U-105d: collections 未知时 ratio 为 NULL（含 likes 已知）', () => {
    const a = addArgs({ ...base, likes: 500 })
    expect(a[7]).toBe(500)
    expect(a[10]).toBeNull()
  })

  it('U-106: published_at 透传（采集页发布时间进库）', () => {
    const a = addArgs({ ...base, published_at: '2026-09-20T10:00:00.000Z' })
    expect(a[11]).toBe('2026-09-20T10:00:00.000Z')
  })

  it('U-107: searchViralItems 排序使用 IFNULL（NULL 与 0 同沉底）', () => {
    const f = makeFake()
    mixin.searchViralItems.call(f.self, ['AI工具'], 10)
    const sql = f.captured.sqls.find(s => s.includes('ORDER BY') && s.includes('viral_library')) || ''
    expect(sql).toContain('IFNULL(likes, 0)')
    expect(sql).toContain('IFNULL(comments, 0)')
  })

  it('U-107b: listViralItems 默认序不受影响（created_at DESC 保持）', () => {
    const f = makeFake()
    mixin.listViralItems.call(f.self, { page: 1, pageSize: 10 })
    const sql = f.captured.sqls.find(s => s.includes('ORDER BY')) || ''
    expect(sql).toContain('created_at DESC')
  })
})
