// @ts-check
/**
 * P1-c 模式卡片队列保护契约测试（viral-library-integration PR-2，TDD）
 * U-211：pending>上限入队直标 deferred（非终态）；pending<回落线批量转回；
 * deferred 不进待提取队列；列表查询不可见。真库（sqlite-wrapper）驱动。
 */
var Database = require('../electron/services/sqlite-wrapper')

var SCHEMA = `
CREATE TABLE viral_library (
  id TEXT PRIMARY KEY, title TEXT DEFAULT '', cover_url TEXT DEFAULT '', author TEXT DEFAULT '',
  url TEXT DEFAULT '', content TEXT NOT NULL, tags TEXT DEFAULT '[]',
  likes INTEGER DEFAULT 0, collections INTEGER DEFAULT 0, comments INTEGER DEFAULT 0,
  like_collect_ratio REAL DEFAULT 0, published_at TEXT DEFAULT '', platform TEXT DEFAULT '',
  source TEXT DEFAULT 'manual', created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  confidence REAL DEFAULT 0.5, status TEXT DEFAULT 'active',
  access_count INTEGER DEFAULT 0, last_accessed TEXT
);
CREATE TABLE viral_pattern_cards (
  viral_item_id TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  hook_type TEXT DEFAULT '',
  hook_analysis TEXT DEFAULT '',
  emotion_curve TEXT DEFAULT '',
  narrative_structure TEXT DEFAULT '',
  cta_style TEXT DEFAULT '',
  golden_quotes TEXT DEFAULT '[]',
  title_formula TEXT DEFAULT '',
  schema_version INTEGER NOT NULL DEFAULT 1,
  extracted_at TEXT,
  last_error TEXT DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`

describe('模式卡片队列保护（U-211）', function () {
  var store

  beforeAll(async function () {
    var db = new Database(null)
    await Database.ready
    if (!db._db) db._init()
    db.exec(SCHEMA)
    var patternMixin = require('../electron/services/store/viral-pattern-store')
    store = Object.assign({}, patternMixin)
    store.db = db
    store._ready = true
  })

  function addViral (id) {
    var now = new Date().toISOString()
    store.db.prepare('INSERT INTO viral_library (id, content, created_at, updated_at) VALUES (?, ?, ?, ?)').run(id, '内容' + id, now, now)
  }

  it('U-211a: pending 未超上限 → 入队照常 pending；countPendingPatternCards 计数正确', function () {
    var saved = store.PENDING_BACKLOG_LIMIT
    store.PENDING_BACKLOG_LIMIT = 3
    addViral('q1'); store.ensurePatternCard('q1')
    addViral('q2'); store.ensurePatternCard('q2')
    store.PENDING_BACKLOG_LIMIT = saved
    expect(store.getPatternCard('q1').status).toBe('pending')
    expect(store.getPatternCard('q2').status).toBe('pending')
    expect(store.countPendingPatternCards()).toBe(2)
  })

  it('U-211b: pending 超上限 → 新卡片直标 deferred（幂等重入不新建不翻状态）', function () {
    var saved = store.PENDING_BACKLOG_LIMIT
    store.PENDING_BACKLOG_LIMIT = 2
    addViral('q3')
    expect(store.ensurePatternCard('q3')).toBe(true)
    store.ensurePatternCard('q3')
    store.PENDING_BACKLOG_LIMIT = saved
    expect(store.getPatternCard('q3').status).toBe('deferred')
    expect(store.countPendingPatternCards()).toBe(2)
  })

  it('U-211c: deferred 不进待提取队列', function () {
    var ids = store.listPendingPatternCards(50).map(function (c) { return c.viral_item_id })
    expect(ids).not.toContain('q3')
  })

  it('U-211d: pending >= below → 零迁移（回落线以上不 promote）', function () {
    // 此刻 pending=q1,q2（2）、deferred=q3；below=2 → pending 不低於回落线，不迁移
    expect(store.promoteDeferredPatternCards({ below: 2 })).toBe(0)
    expect(store.getPatternCard('q3').status).toBe('deferred')
  })

  it('U-211e: pending 回落 < below → deferred 转回 pending（老卡优先）；max 限流', function () {
    // q9 显式更老 created_at → 老卡优先确定性断言（q3 保持 deferred 供 U-211f 使用）
    store.updatePatternCard('q1', { status: 'done' })
    store.updatePatternCard('q2', { status: 'done' })
    var old = new Date(Date.now() - 60000).toISOString()
    store.db.prepare("INSERT INTO viral_pattern_cards (viral_item_id, status, created_at, updated_at) VALUES ('q9', 'deferred', ?, ?)").run(old, old)
    expect(store.promoteDeferredPatternCards({ below: 3, max: 1 })).toBe(1)
    expect(store.getPatternCard('q9').status).toBe('pending')
    expect(store.getPatternCard('q3').status).toBe('deferred')
    // quota 上限：below=3、pending=1 → 即使 max=100 也最多转 2 条（q3 + q4? q4 不存在，转 q3 后 pending=2）
    expect(store.promoteDeferredPatternCards({ below: 3, max: 100 })).toBe(1)
    expect(store.getPatternCard('q3').status).toBe('pending')
    expect(store.countPendingPatternCards()).toBe(2)
  })

  it('U-211f: PATTERN_STATUS 含 deferred（非终态，updatePatternCard 可写）', function () {
    expect(store.PATTERN_STATUS.has('deferred')).toBe(true)
    expect(store.updatePatternCard('q3', { status: 'deferred' })).toBe(true)
    expect(store.getPatternCard('q3').status).toBe('deferred')
    expect(store.updatePatternCard('q3', { status: 'pending' })).toBe(true)
  })
})
