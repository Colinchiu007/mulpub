/**
 * creator-schema.test.js — 博主监控数据结构与迁移
 *
 * 本文件锁两件事，都是「错了会出事」而不是「错了不好看」：
 *
 *  1. **partial 唯一索引**：viral_library 的 external_id 是新增列且存量行为空串。
 *     若建成普通 UNIQUE(platform, external_id)，建索引瞬间即因重复键抛错，
 *     schema 初始化失败 → **应用起不来**。partial 把存量行排除在索引外。
 *  2. **迁移原子性**：加列与建索引必须同事务。半迁移状态下
 *     CREATE TABLE/INDEX IF NOT EXISTS 都不会补做，形成需手工干预的死锁。
 */
const {
  CREATOR_TABLE_SQL,
  CREATOR_OUTBOX_SQL,
  findViralLibraryConflicts,
  migrateCreatorLinkageSchema,
} = require('./creator-schema')

/** 极简 sql.js 替身：只需 prepare/all 与 exec，覆盖本迁移用到的语句。 */
function makeDb (rows = {}) {
  const executed = []
  const prepare = (sql) => ({
    all: () => {
      if (/PRAGMA table_info\(viral_library\)/i.test(sql)) {
        return (rows.viralLibraryCols || []).map(name => ({ name }))
      }
      if (/GROUP BY platform, external_id/i.test(sql)) return rows.conflicts || []
      return []
    },
  })
  const exec = (sql) => { executed.push(sql) }
  const db = { prepare, exec, execOrThrow: exec }
  return { db, executed }
}

function execSchemaSql (db, sql) { db.exec(sql) }

describe('creator-schema · 表定义', () => {
  const ddl = CREATOR_TABLE_SQL.join('\n')

  it('三张博主表 + outbox + 配额账本齐备', () => {
    for (const t of ['creator_accounts', 'creator_follows', 'creator_discoveries',
      'collection_outbox', 'collection_quota_ledger']) {
      expect(ddl).toContain(`CREATE TABLE IF NOT EXISTS ${t} `)
    }
  })

  it('creator_accounts 与 creator_discoveries 的 (platform, external_id) 唯一', () => {
    expect(ddl).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS idx_creator_accounts_uniq\s*\n?\s*ON creator_accounts\(platform, external_id\)/)
    expect(ddl).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS idx_creator_discoveries_uniq\s*\n?\s*ON creator_discoveries\(platform, external_id\)/)
  })

  it(' discoveries 带 claim_token（fencing）与租约字段', () => {
    for (const col of ['claim_token', 'claimed_by', 'lease_expires_at', 'retry_after_at', 'attempt_count']) {
      expect(ddl).toContain(col)
    }
  })

  it('配额账本以 (day, kind, request_sig) 为主键——崩溃重发不重复计费', () => {
    expect(ddl).toMatch(/PRIMARY KEY \(day, kind, request_sig\)/)
  })

  it('outbox 单列在 CREATOR_OUTBOX_SQL 中，便于按需评估其表面积', () => {
    expect(CREATOR_OUTBOX_SQL.join('\n')).toContain('collection_outbox')
  })
})

describe('creator-schema · viral_library 迁移 · partial 索引（防应用起不来）', () => {
  it('索引带 WHERE external_id <> \'\'，存量空串行不参与唯一约束', () => {
    const { db, executed } = makeDb({ viralLibraryCols: ['id', 'external_id'] })
    migrateCreatorLinkageSchema(db, execSchemaSql)
    const idx = executed.find(s => s.includes('idx_viral_library_external'))
    expect(idx).toBeDefined()
    expect(idx).toContain("WHERE external_id <> ''")
  })

  it('普通 UNIQUE 不被使用（那会让存量空串行冲突）', () => {
    const { db, executed } = makeDb({ viralLibraryCols: ['id', 'external_id'] })
    migrateCreatorLinkageSchema(db, execSchemaSql)
    const idx = executed.find(s => s.includes('idx_viral_library_external'))
    expect(idx).not.toMatch(/CREATE UNIQUE INDEX[^(]*\(platform, external_id\)\s*$/m)
  })

  it('列已存在时不重复 ALTER（幂等）', () => {
    const { db, executed } = makeDb({ viralLibraryCols: ['id', 'external_id', 'creator_id'] })
    migrateCreatorLinkageSchema(db, execSchemaSql)
    expect(executed.filter(s => s.includes('ADD COLUMN'))).toHaveLength(0)
  })

  it('列缺失时补齐两列', () => {
    const { db, executed } = makeDb({ viralLibraryCols: ['id'] })
    migrateCreatorLinkageSchema(db, execSchemaSql)
    const alters = executed.filter(s => s.includes('ADD COLUMN'))
    expect(alters).toHaveLength(2)
    expect(alters.join(' ')).toContain('external_id')
    expect(alters.join(' ')).toContain('creator_id')
  })
})

describe('creator-schema · 迁移原子性', () => {
  it('整段包在 BEGIN/COMMIT 中', () => {
    const { db, executed } = makeDb({ viralLibraryCols: ['id'] })
    migrateCreatorLinkageSchema(db, execSchemaSql)
    expect(executed[0]).toBe('BEGIN')
    expect(executed[executed.length - 1]).toBe('COMMIT')
  })

  it('中途抛错时 ROLLBACK 并把原始错误抛出（不留半迁移状态）', () => {
    const executed = []
    const db = {
      prepare: () => ({ all: () => [] }),
      exec: (sql) => {
        executed.push(sql)
        if (sql.includes('ADD COLUMN external_id')) throw new Error('boom')
      },
      execOrThrow: undefined,
    }
    expect(() => migrateCreatorLinkageSchema(db, execSchemaSql)).toThrow('boom')
    expect(executed).toContain('ROLLBACK')
    expect(executed).not.toContain('COMMIT')
  })

  it('schema 不支持事务时降级为无事务执行（不因 BEGIN 失败而整体中止）', () => {
    const executed = []
    const db = {
      prepare: (sql) => ({ all: () => (PRAGMA_TABLE_INFO.test(sql) ? [{ name: 'id' }] : []) }),
      exec: (sql) => {
        executed.push(sql)
        if (sql === 'BEGIN') throw new Error('cannot start a transaction within a transaction')
      },
    }
    expect(() => migrateCreatorLinkageSchema(db, execSchemaSql)).not.toThrow()
    expect(executed).not.toContain('ROLLBACK')
    expect(executed.some(s => s.includes('ADD COLUMN'))).toBe(true)
  })
})

const PRAGMA_TABLE_INFO = /PRAGMA table_info\(viral_library\)/i

describe('creator-schema · 冲突预检（不静默丢数据）', () => {
  // 夹具自证修正（2026-10-20，分支 ux-viral-external-id）：这三条原来只塞 `conflicts` 而不给
  // `viralLibraryCols`，于是"一个还没有 external_id 的库报了重复"——现实里不可能的输入。
  // 预检现在先看列在不在（真库形态见 creator-schema-upgrade.test.js），缺列即返回空，
  // 所以这几条必须把列声明出来才测得到它们声称的那条路径。断言本身一字未放宽。
  it('检测到重复分组时中止迁移并报出明细', () => {
    const rows = [{ platform: 'youtube', external_id: 'UC_x', n: 3 }]
    const { db, executed } = makeDb({ conflicts: rows, viralLibraryCols: ['id', 'external_id', 'creator_id'] })
    expect(() => migrateCreatorLinkageSchema(db, execSchemaSql))
      .toThrow(/存在 1 组重复/)
    expect(executed.filter(s => s.includes('ADD COLUMN'))).toHaveLength(0)
  })

  it('错误信息含冲突键，便于人工定位', () => {
    const rows = [{ platform: 'youtube', external_id: 'UC_dupe', n: 2 }]
    const { db } = makeDb({ conflicts: rows, viralLibraryCols: ['id', 'external_id', 'creator_id'] })
    expect(() => migrateCreatorLinkageSchema(db, execSchemaSql)).toThrow(/UC_dupe/)
  })

  it('无冲突时预检返回空数组', () => {
    const { db } = makeDb({ conflicts: [], viralLibraryCols: ['id', 'external_id', 'creator_id'] })
    expect(findViralLibraryConflicts(db)).toEqual([])
  })

  it('列尚未添加时预检不抛错（首次升级无存量 external_id）', () => {
    const db = { prepare: () => ({ all: () => { throw new Error('no such column') } }) }
    expect(findViralLibraryConflicts(db)).toEqual([])
  })
})