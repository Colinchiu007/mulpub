// @vitest-environment node
/**
 * creator-schema-upgrade.test.js — viral_library 的「查询列 ↔ 建表列」同源锁（QM-5 回归保护）
 *
 * ⛔ 上面那行 `@vitest-environment node` 不是装饰：本文件顶层 `import { DatabaseSync } from 'node:sqlite'`，
 *   而 Desktop Shards 的 **client 腿**会用浏览器环境做 import-analysis ⇒
 *   `Error: Cannot bundle built-in module "node:sqlite"`，整个套件在加载期就 FAIL（本机 node 腿复现不出）。
 *   同目录三个用 node:sqlite 的兄弟文件（activate-viral-schema.upgrade / diagnostics-reporter /
 *   pattern-attribution-service）第一行都是这条声明 —— 新增同族文件必须照抄。
 *
 * 现场（2026-10-18 打包态启动两次复现）：
 *   [ERROR] sqlite-wrapper all() error: no such column: external_id | SQL: SELECT platform, external_id, COUNT(*) AS n FROM viral_library
 *
 * 根因形状：`findViralLibraryConflicts` 是**迁移前的冲突预检**，它查的 `external_id` 由它自己所在的那次
 * 迁移的 ALTER 才加上去；而全新库的建表 DDL（store-schema.js）里根本没有这两列。于是每次新库首次启动
 * 都要发一条**结构上注定失败**的查询，再由 `catch (_) { return [] }` 把它吞掉 —— 而吞的位置在
 * sqlite-wrapper 里，它会先 `log.error` 再返回，所以日志里就留下一条 ERROR。
 *
 * ⛔ 本文件必须用**真实 sqlite 文件库**，不得只用内存库/假对象：
 *   - 既有 `creator-schema.test.js` 的夹具 `makeDb()` 对任何 SQL 的 `prepare().all()` 都返回同一份
 *     预置数组，于是「列不存在 ⇒ 查询抛错」这一整类事实在该夹具里**根本无法表示**（四层测试全绿而
 *     打包启动每次报 ERROR 的同型原因）。这里换真库，让"抛错"这件事真的发生一次再证明它不发生。
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { readFileSync, rmSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { findViralLibraryConflicts, migrateCreatorLinkageSchema } from './creator-schema'

const HERE = dirname(fileURLToPath(import.meta.url))
const OWNED = []
const logs = []

function makeTempDb () {
  const file = join(tmpdir(), `mp-creator-upgrade-${process.pid}-${Math.random().toString(36).slice(2)}.db`)
  OWNED.push(file)
  return { db: new DatabaseSync(file), file }
}

afterEach(() => {
  for (const f of OWNED.splice(0)) {
    try { rmSync(f, { force: true }) } catch (_) { /* 残留由 os.tmpdir 回收 */ }
  }
  logs.length = 0
})

/** 存量库形态：viral_library 存在但没有 external_id / creator_id */
function createOldTable (db) {
  db.exec(`CREATE TABLE viral_library (
    id TEXT PRIMARY KEY, platform TEXT DEFAULT '', content TEXT NOT NULL,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`)
}

function columnsOf (db, table) {
  return db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name)
}

function execSchemaSql (db, sql) { db.exec(sql) }

describe('creator-schema · 存量库升级形态（真 sqlite 文件库）', () => {
  it('预检在缺列的旧库上不得抛错——它查的列正是本次迁移要加的', () => {
    const { db } = makeTempDb()
    createOldTable(db)
    expect(columnsOf(db, 'viral_library')).not.toContain('external_id')
    // 修复前的真实形状：这一句在真 sqlite 上必然 no such column（夹具里读不出来）
    expect(() => findViralLibraryConflicts(db)).not.toThrow()
    expect(findViralLibraryConflicts(db)).toEqual([])
    db.close()
  })

  it('旧库经一次迁移后两列齐备、partial 唯一索引在位，且全程不抛', () => {
    const { db } = makeTempDb()
    createOldTable(db)
    expect(() => migrateCreatorLinkageSchema(db, execSchemaSql)).not.toThrow()
    const cols = columnsOf(db, 'viral_library')
    expect(cols).toContain('external_id')
    expect(cols).toContain('creator_id')
    const idx = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='viral_library'").all().map((r) => r.name)
    expect(idx).toContain('idx_viral_library_external')
    db.close()
  })

  it('列已存在且有真重复时，预检必须照样查出来（不得被"缺列即跳过"顺手关掉）', () => {
    const { db } = makeTempDb()
    // 造"列在位 + 无唯一索引"的库：真重复只能在这种库里存下来
    // （迁移后的库带 partial UNIQUE 索引，INSERT 第二条当场就被拒，测不到预检）
    db.exec(`CREATE TABLE viral_library (
      id TEXT PRIMARY KEY, platform TEXT DEFAULT '', content TEXT NOT NULL,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      external_id TEXT DEFAULT '', creator_id TEXT DEFAULT '')`)
    db.prepare(`INSERT INTO viral_library (id, platform, content, created_at, updated_at, external_id)
      VALUES ('a','douyin','x','t','t','VID-1'), ('b','douyin','y','t','t','VID-1')`).run()
    const rows = findViralLibraryConflicts(db)
    expect(rows.length).toBe(1)
    expect(rows[0].n).toBe(2)
    // 迁移的既有语义：有重复即中止，不静默去重
    expect(() => migrateCreatorLinkageSchema(db, execSchemaSql)).toThrow(/重复/)
    db.close()
  })

  it('PRAGMA 读不到列（表还不存在）时预检返回空，且不得去查 external_id', () => {
    const { db } = makeTempDb()   // 不建表
    expect(findViralLibraryConflicts(db)).toEqual([])
    db.close()
  })
})

describe('creator-schema · 建表与查询同源（新库不再注定失败）', () => {
  it('store-schema 的 viral_library 建表 DDL 必须自带 external_id / creator_id', () => {
    const src = readFileSync(join(HERE, 'store-schema.js'), 'utf8')
    const m = /CREATE TABLE IF NOT EXISTS viral_library \(([\s\S]*?)\n\s*\)`/.exec(src)
    expect(m, '取不到 viral_library 建表体 ⇒ 判据失明，不得当作通过').toBeTruthy()
    expect(m[1]).toMatch(/external_id/)
    expect(m[1]).toMatch(/creator_id/)
  })

  it('按仓内真实 SCHEMA_SQL 建出来的新库，预检一次都不能失败', () => {
    // 走产物（真 DDL）而不是抄一份字符串：建表与查询是否同源，只能由同一份 DDL 说话
    const src = readFileSync(join(HERE, 'store-schema.js'), 'utf8')
    const m = /(CREATE TABLE IF NOT EXISTS viral_library [\s\S]*?)`/.exec(src)
    expect(m, '取不到 viral_library 建表语句').toBeTruthy()
    const { db } = makeTempDb()
    db.exec(m[1])
    expect(columnsOf(db, 'viral_library')).toContain('external_id')
    expect(() => findViralLibraryConflicts(db)).not.toThrow()
    expect(() => migrateCreatorLinkageSchema(db, execSchemaSql)).not.toThrow()
    db.close()
  })
})

describe('creator-schema · 真实失败必须出声（不得退化为静默兜底）', () => {
  it('列在位却查询失败时，必须 warn 并如实返回空，而不是无声吞掉', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const calls = []
    const db = {
      prepare (sql) {
        calls.push(sql)
        return {
          all () {
            if (/PRAGMA table_info/i.test(sql)) return [{ name: 'id' }, { name: 'external_id' }]
            throw new Error('disk I/O error')
          },
        }
      },
    }
    expect(() => findViralLibraryConflicts(db)).not.toThrow()
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('disk I/O error'))
    warn.mockRestore()
  })

  it('缺列时根本不得发出那条注定失败的预检查询（错误在源头就不产生）', () => {
    const calls = []
    const db = {
      prepare (sql) {
        calls.push(sql)
        return { all: () => (/PRAGMA table_info/i.test(sql) ? [{ name: 'id' }] : []) }
      },
    }
    expect(findViralLibraryConflicts(db)).toEqual([])
    const doomed = calls.filter((s) => /GROUP BY platform, external_id/i.test(s))
    expect(doomed, '缺列仍去查 external_id ⇒ sqlite-wrapper 会留下一条假 ERROR').toEqual([])
  })
})

// 本仓 Desktop Shards 有 **client 腿**（浏览器环境做 import-analysis）。静态 `import … from 'node:sqlite'`
// 在那条腿上会在**加载期**抛 `Cannot bundle built-in module "node:sqlite"` ⇒ 整个套件 FAIL，
// 而本机的 node 腿完全复现不出（本案实测：CI 红、本地 8 条全绿）。
// 同目录三个用 node:sqlite 的兄弟文件第一行都有 `// @vitest-environment node`，本锁把这条惯例变成判据。
describe('环境前提：静态 import node:sqlite 的测试必须声明 node 环境', () => {
  const SQLITE_RE = /from\s+['"]node:sqlite['"]/
  const files = readdirSync(HERE).filter((n) => n.endsWith('.test.js'))
  const users = files.filter((n) => SQLITE_RE.test(readFileSync(join(HERE, n), 'utf8')))

  it('扫描域非空（本目录确有 import node:sqlite 的测试，否则本锁看不见任何东西）', () => {
    expect(users.length, '域退化为 0 ⇒ "全部合规"是探针失明不是结论').toBeGreaterThan(0)
    // 正向对偶：这些文件确实是**静态**导入（动态 import/require 不在本锁范围）
    expect(users, '本锁应至少覆盖到它自己').toContain('creator-schema-upgrade.test.js')
  })

  it('每个静态 import node:sqlite 的测试文件，第一行必须是 @vitest-environment node', () => {
    const bad = []
    for (const n of users) {
      const first = readFileSync(join(HERE, n), 'utf8').split(/\r?\n/)[0]
      if (!/^\/\/\s*@vitest-environment\s+node$/.test(first)) bad.push(n + ' 首行=' + JSON.stringify(first.slice(0, 60)))
    }
    expect(bad, '缺声明的文件在 client 腿会在加载期整套件 FAIL：' + bad.join(' | ')).toEqual([])
  })
})
