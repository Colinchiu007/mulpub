/**
 * 效果闭环数据层测试 — rewrite_history / tracked_content / performance_snapshot / pattern_performance
 */
var Database = require('../electron/services/sqlite-wrapper')

var SCHEMA = `
CREATE TABLE rewrite_history (
  id TEXT PRIMARY KEY,
  mode TEXT DEFAULT '',
  original_excerpt TEXT DEFAULT '',
  rewritten_content TEXT NOT NULL,
  strategy_id TEXT DEFAULT '',
  knowledge_refs TEXT DEFAULT '[]',
  matched_keywords TEXT DEFAULT '[]',
  owner_subject TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE tracked_content (
  id TEXT PRIMARY KEY,
  platform TEXT NOT NULL,
  post_id TEXT DEFAULT '',
  url TEXT DEFAULT '',
  publish_history_id TEXT,
  rewrite_history_id TEXT,
  recrawl_status TEXT NOT NULL DEFAULT 'pending',
  last_recrawl_at TEXT,
  next_recrawl_at TEXT,
  owner_subject TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE performance_snapshot (
  id TEXT PRIMARY KEY,
  tracked_content_id TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'auto',
  views INTEGER DEFAULT 0,
  likes INTEGER DEFAULT 0,
  comments INTEGER DEFAULT 0,
  favorites INTEGER DEFAULT 0,
  shares INTEGER DEFAULT 0,
  raw TEXT DEFAULT '{}',
  captured_at TEXT NOT NULL
);
CREATE TABLE pattern_performance (
  id TEXT PRIMARY KEY,
  dimension TEXT NOT NULL,
  value TEXT NOT NULL,
  platform TEXT DEFAULT '',
  sample_count INTEGER DEFAULT 0,
  avg_views REAL DEFAULT 0,
  avg_likes REAL DEFAULT 0,
  avg_comments REAL DEFAULT 0,
  avg_favorites REAL DEFAULT 0,
  engagement_score REAL DEFAULT 0,
  computed_at TEXT NOT NULL
);
`

describe('performance-loop-store', function () {
  var store

  beforeAll(async function () {
    var db = new Database(null)
    await Database.ready
    if (!db._db) db._init()
    db.exec(SCHEMA)
    var mixin = require('../electron/services/store/performance-loop-store')
    store = Object.assign({}, mixin)
    store.db = db
    store._ready = true
  })

  test('rewrite_history CRUD + knowledge_refs 解析', function () {
    var id = store.addRewriteHistory({
      mode: 'imitate',
      originalContent: '原文'.repeat(100),
      rewrittenContent: '改写后的内容',
      strategyId: 's1',
      knowledgeRefs: [{ table: 'viral_library', id: 'v1' }],
      matchedKeywords: ['自媒体', '内容质量'],
    })
    expect(id).toBeTruthy()
    var row = store.getRewriteHistory(id)
    expect(row.mode).toBe('imitate')
    expect(row.original_excerpt.length).toBeLessThanOrEqual(500)
    expect(row.knowledge_refs).toEqual([{ table: 'viral_library', id: 'v1' }])
    expect(row.matched_keywords).toEqual(['自媒体', '内容质量'])
    var list = store.listRewriteHistory({ page: 1, pageSize: 10 })
    expect(list.total).toBe(1)
  })

  test('tracked_content 登记 + 过期筛选', function () {
    var now = new Date().toISOString()
    store.addTrackedContent({ id: 't1', platform: 'zhihu', postId: 'p1', url: 'https://zhihu.com/p/1', recrawlStatus: 'pending', nextRecrawlAt: now })
    store.addTrackedContent({ id: 't2', platform: 'unsupported_x', recrawlStatus: 'unsupported' })
    var due = store.listDueForRecrawl(new Date(now).getTime() + 1000)
    expect(due.length).toBe(1)
    expect(due[0].id).toBe('t1')
    var byPlatform = store.getTrackedByPlatform('zhihu')
    expect(byPlatform.length).toBe(1)
  })

  test('performance_snapshot 写入 + 最新值查询', function () {
    store.addPerformanceSnapshot({ trackedContentId: 't1', source: 'auto', views: 100, likes: 10, comments: 5, favorites: 3, shares: 2 })
    store.addPerformanceSnapshot({ trackedContentId: 't1', source: 'manual', views: 200, likes: 20, comments: 8, favorites: 6, shares: 4 })
    var latest = store.getLatestSnapshot('t1')
    expect(latest.views).toBe(200)
    var all = store.listSnapshots('t1')
    expect(all.length).toBe(2)
  })

  test('pattern_performance 聚合写入 + 查询', function () {
    store.replacePatternPerformance([
      { dimension: 'hook_type', value: 'suspense', platform: 'zhihu', sampleCount: 5, avgViews: 1000, avgLikes: 100, avgComments: 20, avgFavorites: 30 },
      { dimension: 'hook_type', value: 'conflict', platform: 'zhihu', sampleCount: 3, avgViews: 800, avgLikes: 60, avgComments: 10, avgFavorites: 15 },
    ])
    var rows = store.listPatternPerformance({ dimension: 'hook_type' })
    expect(rows.length).toBe(2)
    var suspense = rows.find(function (r) { return r.value === 'suspense' })
    expect(suspense.sample_count).toBe(5)
    expect(suspense.engagement_score).toBe(100 + 20 + 30 * 2)
    // 幂等替换
    store.replacePatternPerformance([
      { dimension: 'hook_type', value: 'question', platform: 'zhihu', sampleCount: 1, avgViews: 500, avgLikes: 50, avgComments: 5, avgFavorites: 5 },
    ])
    expect(store.listPatternPerformance({ dimension: 'hook_type' }).length).toBe(1)
  })

  test('7 天窗口过滤：过期内容不进回采队列', function () {
    var old = new Date(Date.now() - 8 * 24 * 3600 * 1000).toISOString()
    store.addTrackedContent({ id: 't-old', platform: 'zhihu', postId: 'p9', recrawlStatus: 'pending', nextRecrawlAt: new Date().toISOString(), createdAt: old })
    var due = store.listDueForRecrawl(Date.now())
    expect(due.find(function (r) { return r.id === 't-old' })).toBeUndefined()
  })
})

describe('performance-loop-store listDueForRecrawl force（立即回采调试入口）', function () {
  var s2
  beforeAll(async function () {
    var Database = require('../electron/services/sqlite-wrapper')
    var db = new Database(null)
    await Database.ready
    if (!db._db) db._init()
    db.exec("CREATE TABLE tracked_content (id TEXT PRIMARY KEY, platform TEXT NOT NULL, post_id TEXT DEFAULT '', url TEXT DEFAULT '', publish_history_id TEXT, rewrite_history_id TEXT, recrawl_status TEXT NOT NULL DEFAULT 'pending', last_recrawl_at TEXT, next_recrawl_at TEXT, owner_subject TEXT, created_at TEXT NOT NULL);")
    var mixin = require('../electron/services/store/performance-loop-store')
    s2 = Object.assign({}, mixin)
    s2.db = db
    s2._ready = true
  })
  test('force=true 纳入未到期条目；默认仍按到期过滤', function () {
    var future = new Date(Date.now() + 3600 * 1000).toISOString()
    s2.addTrackedContent({ id: 't-fut', platform: 'bilibili', postId: '', url: 'https://www.bilibili.com/video/BVforce', recrawlStatus: 'pending', nextRecrawlAt: future })
    var normal = s2.listDueForRecrawl(Date.now())
    expect(normal.find(function (r) { return r.id === 't-fut' })).toBeUndefined()
    var forced = s2.listDueForRecrawl(Date.now(), { force: true })
    expect(forced.find(function (r) { return r.id === 't-fut' })).toBeTruthy()
  })
  test('force=true 仍守 7 天窗口（过期条目不纳入）', function () {
    var old = new Date(Date.now() - 8 * 24 * 3600 * 1000).toISOString()
    s2.addTrackedContent({ id: 't-old2', platform: 'bilibili', postId: '', url: 'https://x/old', recrawlStatus: 'pending', nextRecrawlAt: new Date().toISOString(), createdAt: old })
    var forced = s2.listDueForRecrawl(Date.now(), { force: true })
    expect(forced.find(function (r) { return r.id === 't-old2' })).toBeUndefined()
  })
})
