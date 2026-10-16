import { beforeAll, beforeEach, afterEach, describe, expect, it } from 'vitest'
import initSqlJs from 'sql.js'
import EventEmitter from 'events'

__enableElectronMock()

let SQL
let Store
let schema
let BatchManager
let rawDb
let store
let ProjectService

class SqlJsAdapter {
  constructor (db) {
    this._db = db
    this._runFailureSqlFragment = null
  }

  exec (sql) {
    this._db.exec(sql)
  }

  execOrThrow (sql) {
    this._db.exec(sql)
  }

  prepare (sql) {
    const db = this._db
    const runFailureSqlFragment = this._runFailureSqlFragment
    return {
      run (...params) {
        if (runFailureSqlFragment && sql.includes(runFailureSqlFragment)) {
          return { changes: 0, error: '测试注入的数据库写入失败' }
        }
        db.run(sql, params)
        return { changes: db.getRowsModified() }
      },
      get (...params) {
        const stmt = db.prepare(sql)
        try {
          stmt.bind(params)
          return stmt.step() ? stmt.getAsObject() : undefined
        } finally {
          stmt.free()
        }
      },
      all (...params) {
        const stmt = db.prepare(sql)
        const rows = []
        try {
          stmt.bind(params)
          while (stmt.step()) rows.push(stmt.getAsObject())
          return rows
        } finally {
          stmt.free()
        }
      },
    }
  }

  transaction (fn) {
    return () => {
      this._db.exec('BEGIN')
      try {
        const result = fn()
        this._db.exec('COMMIT')
        return result
      } catch (error) {
        this._db.exec('ROLLBACK')
        throw error
      }
    }
  }

  persist () {
    return true
  }
}

function executeSchema () {
  for (const sql of schema.SCHEMA_SQL) rawDb.exec(sql)
}

function tableInfo (table) {
  const result = rawDb.exec(`PRAGMA table_info(${table})`)
  if (result.length === 0) return []
  return result[0].values.map((values) => Object.fromEntries(
    result[0].columns.map((column, index) => [column, values[index]]),
  ))
}

function queryRows (sql, params = []) {
  const stmt = rawDb.prepare(sql)
  const rows = []
  try {
    stmt.bind(params)
    while (stmt.step()) rows.push(stmt.getAsObject())
    return rows
  } finally {
    stmt.free()
  }
}

beforeAll(async () => {
  SQL = await initSqlJs()
  Store = require('./store')
  schema = require('./store-schema')
  BatchManager = require('./batch-manager')
  ProjectService = require('./story2video-project-service').Story2VideoProjectService
})

beforeEach(() => {
  rawDb = new SQL.Database()
  executeSchema()
  store = new Store()
  store.db = new SqlJsAdapter(rawDb)
  store._ready = true
})

afterEach(() => {
  BatchManager.setTaskQueue(null)
  if (rawDb) rawDb.close()
})

describe('Store 多用户隔离', () => {
  it('owner provider 抛错被 base-store 折叠为 null，story2video 历史回退 legacy 可用', () => {
    const path = require('path')
    const os = require('os')
    const projectsDir = path.join(os.tmpdir(), 's2v-provider-throw-' + Date.now())
    store.setOwnerSubjectProvider(() => { throw new Error('provider boom') })
    // base-store 内部 catch：provider 异常折叠为 null，不向上抛
    expect(store._resolveOwnerSubject()).toBeNull()
    const service = new ProjectService({ store, projectsDir })
    expect(() => service.listProjects()).not.toThrow()
    // 回退 legacy 命名空间：可写入并在同空间读回
    service._writeProjects([{ projectId: 'legacy-throw-1', status: 'completed', segments: [] }])
    expect(service.listProjects().map(item => item.projectId)).toEqual(['legacy-throw-1'])
  })


  it('新库为三张用户数据表创建 owner_subject 复合主键', () => {
    for (const table of ['accounts', 'publish_history', 'scheduled_tasks']) {
      const info = tableInfo(table)
      const primaryKey = info
        .filter((column) => column.pk > 0)
        .sort((left, right) => left.pk - right.pk)
        .map((column) => column.name)

      expect(info.map((column) => column.name)).toContain('owner_subject')
      expect(primaryKey).toEqual(['owner_subject', 'id'])
    }

    const historyColumns = tableInfo('publish_history').map((column) => column.name)
    expect(historyColumns).toEqual(expect.arrayContaining(['task_id', 'error']))
  })

  it('旧库迁移为租户表并把无归属数据标记为 legacy', () => {
    rawDb.close()
    rawDb = new SQL.Database()
    rawDb.exec(`
      CREATE TABLE accounts (id INTEGER PRIMARY KEY, platform TEXT NOT NULL, account_name TEXT);
      CREATE TABLE publish_history (id INTEGER PRIMARY KEY, platform TEXT NOT NULL, status TEXT);
      CREATE TABLE scheduled_tasks (id TEXT PRIMARY KEY, platform TEXT NOT NULL, status TEXT);
      INSERT INTO accounts VALUES (1, 'douyin', 'old-account');
      INSERT INTO publish_history VALUES (2, 'douyin', 'success');
      INSERT INTO scheduled_tasks VALUES ('task-1', 'douyin', 'pending');
    `)
    const adapter = new SqlJsAdapter(rawDb)

    schema.migrateOwnerIsolationSchema(adapter)
    schema.migrateOwnerIsolationSchema(adapter)

    for (const table of ['accounts', 'publish_history', 'scheduled_tasks']) {
      const rows = queryRows(`SELECT owner_subject FROM ${table}`)
      expect(rows).toEqual([{ owner_subject: schema.LEGACY_OWNER_SUBJECT }])
    }
  })

  it('相同账号 ID 可以分别属于两个用户且不会互相覆盖', () => {
    store.addAccount({ id: 'shared-account', platform: 'douyin', name: '用户 A' }, 'user-a')
    store.addAccount({ id: 'shared-account', platform: 'douyin', name: '用户 B' }, 'user-b')

    expect(store.getAccount('shared-account', 'user-a').name).toBe('用户 A')
    expect(store.getAccount('shared-account', 'user-b').name).toBe('用户 B')
    expect(store.listAccounts('douyin', 'user-a')).toHaveLength(1)
    expect(store.listAccounts('douyin', 'user-b')).toHaveLength(1)
  })

  it('发布历史列表和统计只包含当前用户的数据', () => {
    store.addPublishRecord({ id: 'record-a', platform: 'douyin', status: 'success' }, 'user-a')
    store.addPublishRecord({ id: 'record-b', platform: 'douyin', status: 'failed' }, 'user-b')

    expect(store.listPublishHistory({}, 'user-a')).toMatchObject({
      total: 1,
      records: [{ id: 'record-a', owner_subject: 'user-a' }],
    })
    expect(store.getPublishStats('user-a')).toMatchObject({ total: 1, success: 1, failed: 0 })
    expect(store.getPublishStats('user-b')).toMatchObject({ total: 1, success: 0, failed: 1 })
  })

  it('定时任务的查询、更新和删除必须同时匹配 owner_subject', () => {
    store.addScheduledTask({ id: 'shared-task', platform: 'douyin', status: 'pending' }, 'user-a')
    store.addScheduledTask({ id: 'shared-task', platform: 'douyin', status: 'pending' }, 'user-b')

    store.updateTaskStatus('shared-task', 'success', 'user-a')
    expect(store.listScheduledTasks('user-a')[0].status).toBe('success')
    expect(store.listScheduledTasks('user-b')[0].status).toBe('pending')

    store.deleteTask('shared-task', 'user-a')
    expect(store.listScheduledTasks('user-a')).toEqual([])
    expect(store.listScheduledTasks('user-b')).toHaveLength(1)
  })

  it('删除账号只级联清理同一 owner 的任务和历史', () => {
    for (const owner of ['user-a', 'user-b']) {
      store.addAccount({ id: 'shared-account', platform: 'douyin' }, owner)
      store.addScheduledTask({
        id: `task-${owner}`,
        platform: 'douyin',
        article: { accountId: 'shared-account' },
      }, owner)
      store.addPublishRecord({
        id: `record-${owner}`,
        platform: 'douyin',
        result: { accountId: 'shared-account' },
      }, owner)
    }

    store.deleteAccount('shared-account', 'user-a')

    expect(store.getAccount('shared-account', 'user-a')).toBeNull()
    expect(store.getAccount('shared-account', 'user-b')).not.toBeNull()
    expect(store.listScheduledTasks('user-a')).toEqual([])
    expect(store.listScheduledTasks('user-b')).toHaveLength(1)
    expect(store.listPublishHistory({}, 'user-a').records).toEqual([])
    expect(store.listPublishHistory({}, 'user-b').records).toHaveLength(1)
  })

  it('账号 ID 含 LIKE 通配符时只删除精确关联的任务和历史', () => {
    const targetId = 'account_%_target'
    const siblingId = 'account_any_target'
    for (const accountId of [targetId, siblingId]) {
      store.addAccount({ id: accountId, platform: 'douyin' }, 'user-a')
      store.addScheduledTask({
        id: `task-${accountId}`,
        platform: 'douyin',
        article: { accountId },
      }, 'user-a')
      store.addPublishRecord({
        id: `record-${accountId}`,
        platform: 'douyin',
        result: { accountId },
      }, 'user-a')
    }

    store.deleteAccount(targetId, 'user-a')

    expect(store.listScheduledTasks('user-a').map(task => task.id)).toEqual([`task-${siblingId}`])
    expect(store.listPublishHistory({}, 'user-a').records.map(record => record.id))
      .toEqual([`record-${siblingId}`])
  })

  it('级联删除任一写入失败时回滚全部账号数据并返回 false', () => {
    store.addAccount({ id: 'rollback-account', platform: 'douyin' }, 'user-a')
    store.addScheduledTask({
      id: 'rollback-task',
      platform: 'douyin',
      article: { accountId: 'rollback-account' },
    }, 'user-a')
    store.addPublishRecord({
      id: 'rollback-record',
      platform: 'douyin',
      result: { accountId: 'rollback-account' },
    }, 'user-a')
    store.db._runFailureSqlFragment = 'DELETE FROM scheduled_tasks'

    expect(store.deleteAccount('rollback-account', 'user-a')).toBe(false)
    expect(store.getAccount('rollback-account', 'user-a')).not.toBeNull()
    expect(store.listScheduledTasks('user-a').map(task => task.id)).toContain('rollback-task')
    expect(store.listPublishHistory({}, 'user-a').records.map(record => record.id))
      .toContain('rollback-record')
  })

  it('批量任务按 owner 隔离，允许不同用户使用相同 batch id', () => {
    store.addBatchJob({ id: 'shared-batch', name: 'A', articles: [{ title: 'A' }], total: 1 }, 'user-a')
    store.addBatchJob({ id: 'shared-batch', name: 'B', articles: [{ title: 'B' }], total: 1 }, 'user-b')

    expect(store.getBatchJob('shared-batch', 'user-a').name).toBe('A')
    expect(store.getBatchJob('shared-batch', 'user-b').name).toBe('B')
    expect(store.listBatchJobs('user-a').map(job => job.name)).toEqual(['A'])

    store.deleteBatchJob('shared-batch', 'user-a')
    expect(store.getBatchJob('shared-batch', 'user-a')).toBeNull()
    expect(store.getBatchJob('shared-batch', 'user-b')).not.toBeNull()
  })

  it('批量任务更新和删除跨 owner 或不存在记录时返回 false', () => {
    store.addBatchJob({ id: 'batch-a', name: 'A', articles: [], total: 0 }, 'user-a')

    expect(store.updateBatchJob('batch-a', { name: 'B' }, 'user-b')).toBe(false)
    expect(store.deleteBatchJob('batch-a', 'user-b')).toBe(false)
    expect(store.getBatchJob('batch-a', 'user-a').name).toBe('A')
  })

  it('批量任务执行期间切换当前用户也必须持续更新创建者的记录', async () => {
    let currentOwner = 'user-a'
    store.setOwnerSubjectProvider(() => currentOwner)
    store.addBatchJob({
      id: 'shared-batch',
      name: 'A',
      articles: [{ title: 'A', content: '正文', platforms: ['douyin'] }],
      total: 1,
      status: 'pending',
    }, 'user-a')
    store.addBatchJob({
      id: 'shared-batch',
      name: 'B',
      articles: [{ title: 'B', content: '正文', platforms: ['douyin'] }],
      total: 1,
      status: 'pending',
    }, 'user-b')

    const queue = new EventEmitter()
    let queuedTask
    queue.addForOwner = (task, ownerSubject) => {
      queuedTask = task
      expect(ownerSubject).toBe('user-a')
      return 'task-a'
    }
    BatchManager.setTaskQueue(queue)
    const manager = new BatchManager(store)

    await manager.executeBatch('shared-batch')
    expect(queuedTask).toMatchObject({
      owner_subject: 'user-a',
      batchId: 'shared-batch',
      accountId: null,
    })
    currentOwner = 'user-b'
    queue.emit('task:success', { id: 'task-a', status: 'success', result: {} })

    expect(store.getBatchJob('shared-batch', 'user-a')).toMatchObject({
      completed: 1,
      failed: 0,
      status: 'done',
    })
    expect(store.getBatchJob('shared-batch', 'user-b')).toMatchObject({
      completed: 0,
      failed: 0,
      status: 'pending',
    })
  })

  it('草稿设置和发布频率时间线按 owner 隔离', () => {
    store.setUserSetting('drafts', [{ id: 'draft-a', title: 'A' }], 'user-a')
    store.setUserSetting('drafts', [{ id: 'draft-b', title: 'B' }], 'user-b')
    store.setPublishTimeline('douyin:shared-account', 100, 'user-a')
    store.setPublishTimeline('douyin:shared-account', 200, 'user-b')

    expect(store.getUserSetting('drafts', [], 'user-a')).toEqual([{ id: 'draft-a', title: 'A' }])
    expect(store.getUserSetting('drafts', [], 'user-b')).toEqual([{ id: 'draft-b', title: 'B' }])
    expect(store.getPublishTimeline('douyin:shared-account', 'user-a')).toBe('100')
    expect(store.getPublishTimeline('douyin:shared-account', 'user-b')).toBe('200')
  })

  // ── publish-frequency-policy-v2：日配额计数（新表 publish_daily_count）──────────
  describe('publish_daily_count（日配额计数）', () => {
    const DAY = '2026-10-10'

    it('无行时返回 null（不是 0 —— 缺席与「0 次」语义不同）', () => {
      expect(store.getPublishDailyCount('douyin:acc_1', DAY, 'user-a')).toBe(null)
    })

    it('upsert 累加两个计数器，且读回为数值', () => {
      store.incrPublishDailyCount('douyin:acc_1', DAY, 'count', 1, 'user-a')
      store.incrPublishDailyCount('douyin:acc_1', DAY, 'count', 1, 'user-a')
      store.incrPublishDailyCount('douyin:acc_1', DAY, 'rollback_count', 1, 'user-a')

      const row = store.getPublishDailyCount('douyin:acc_1', DAY, 'user-a')
      expect(Number(row.count)).toBe(2)
      expect(Number(row.rollback_count)).toBe(1)
    })

    it('递减到 0 即止（不得为负 —— 配额的「回补」可能多于已提交次数）', () => {
      store.incrPublishDailyCount('douyin:acc_1', DAY, 'count', 1, 'user-a')
      expect(Number(store.decrPublishDailyCount('douyin:acc_1', DAY, 'count', 'user-a'))).toBe(0)
      expect(Number(store.decrPublishDailyCount('douyin:acc_1', DAY, 'count', 'user-a'))).toBe(0)
      expect(Number(store.getPublishDailyCount('douyin:acc_1', DAY, 'user-a').count)).toBe(0)
    })

    it('按 owner 隔离：A 的计数不影响 B', () => {
      store.incrPublishDailyCount('douyin:shared-account', DAY, 'count', 3, 'user-a')
      store.incrPublishDailyCount('douyin:shared-account', DAY, 'count', 1, 'user-b')

      expect(Number(store.getPublishDailyCount('douyin:shared-account', DAY, 'user-a').count)).toBe(3)
      expect(Number(store.getPublishDailyCount('douyin:shared-account', DAY, 'user-b').count)).toBe(1)
    })

    it('按 day_key 隔离：跨日各自独立计数', () => {
      store.incrPublishDailyCount('douyin:acc_1', '2026-10-10', 'count', 2, 'user-a')
      store.incrPublishDailyCount('douyin:acc_1', '2026-10-11', 'count', 1, 'user-a')

      expect(Number(store.getPublishDailyCount('douyin:acc_1', '2026-10-10', 'user-a').count)).toBe(2)
      expect(Number(store.getPublishDailyCount('douyin:acc_1', '2026-10-11', 'user-a').count)).toBe(1)
    })

    it('未知字段被拒绝且出声（列名走白名单，防 SQL 注入）', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      expect(store.incrPublishDailyCount('douyin:acc_1', DAY, 'count; DROP TABLE settings', 1, 'user-a')).toBe(0)
      expect(warn).toHaveBeenCalled()
      expect(store.getPublishDailyCount('douyin:acc_1', DAY, 'user-a')).toBe(null)
      warn.mockRestore()
    })

    it('无 owner 时一律 no-op（不落库、不抛）', () => {
      const saved = store._resolveOwnerSubject
      store._resolveOwnerSubject = () => null
      try {
        expect(store.getPublishDailyCount('k', DAY)).toBe(null)
        expect(store.incrPublishDailyCount('k', DAY, 'count', 1)).toBe(0)
      } finally {
        store._resolveOwnerSubject = saved
      }
    })

    it('prune 只裁剪保留窗口之外的行，且只删本 owner 的', () => {
      store.incrPublishDailyCount('douyin:acc_1', '2026-10-01', 'count', 5, 'user-a')
      store.incrPublishDailyCount('douyin:acc_1', '2026-10-09', 'count', 1, 'user-a')
      store.incrPublishDailyCount('douyin:acc_1', '2026-10-01', 'count', 5, 'user-b')

      const removed = store.prunePublishDailyCount('2026-10-10', 'user-a')
      expect(removed).toBe(1)
      expect(store.getPublishDailyCount('douyin:acc_1', '2026-10-01', 'user-a')).toBe(null)
      // 保留窗口内（10-09，窗口 7 天 ⇒ cutoff 10-04）仍在
      expect(store.getPublishDailyCount('douyin:acc_1', '2026-10-09', 'user-a')).not.toBe(null)
      // 别的 owner 不受影响
      expect(store.getPublishDailyCount('douyin:acc_1', '2026-10-01', 'user-b')).not.toBe(null)
    })

    it('全 owner 裁剪：逐个 owner 删（不得跨 owner 一把删），并如实回报 owners/removed', () => {
      // change: publish-frequency-unwired-surfaces —— prunePublishDailyCount 此前**没有生产调用点**，
      // 于是 publish_daily_count 只增不减。启动期要按 owner 逐个裁剪：
      // AGENTS 的 owner 隔离不变量是「查询、更新和删除必须同时匹配 owner_subject」，
      // 所以这里不得写成 `DELETE ... WHERE day_key < ?`（那会跨 owner 删）。
      store.incrPublishDailyCount('douyin:acc_1', '2026-09-20', 'count', 5, 'user-a')
      store.incrPublishDailyCount('douyin:acc_1', '2026-10-09', 'count', 1, 'user-a')
      store.incrPublishDailyCount('weibo:acc_9', '2026-09-21', 'count', 2, 'user-b')
      store.incrPublishDailyCount('weibo:acc_9', '2026-09-25', 'count', 2, 'user-c')

      const res = store.prunePublishDailyCountAllOwners('2026-10-10')
      expect(res).toEqual({ owners: 3, removed: 3, basis: 'measured' })
      expect(store.getPublishDailyCount('douyin:acc_1', '2026-09-20', 'user-a')).toBe(null)
      expect(store.getPublishDailyCount('weibo:acc_9', '2026-09-21', 'user-b')).toBe(null)
      expect(store.getPublishDailyCount('weibo:acc_9', '2026-09-25', 'user-c')).toBe(null)
      // 窗口内的行一律保留
      expect(store.getPublishDailyCount('douyin:acc_1', '2026-10-09', 'user-a')).not.toBe(null)
    })

    it('全 owner 裁剪对非法 todayKey 不动任何行（不得把 NaN/undefined 拼进 SQL）', () => {
      store.incrPublishDailyCount('douyin:acc_1', '2026-09-20', 'count', 5, 'user-a')
      for (const bad of [undefined, null, '', '2026-10-1', '2026-13-40', 123]) {
        expect(store.prunePublishDailyCountAllOwners(bad), JSON.stringify(bad))
          .toEqual({ owners: 0, removed: 0, basis: 'invalid_input' })
      }
      expect(store.getPublishDailyCount('douyin:acc_1', '2026-09-20', 'user-a')).not.toBe(null)
    })

    it('未就绪的 store 不得把「没测到」印成 0：basis=not_ready', () => {
      // 构造性零是本仓反复登记的形态（#3639 的 exit 10 / n/a(not measured) 同源）。
      // 启动日志里"owners=0 removed=0"如果是查询没成功的产物，运维就会以为表是干净的。
      const saved = store._ready
      store._ready = false
      try {
        expect(store.prunePublishDailyCountAllOwners('2026-10-10'))
          .toEqual({ owners: 0, removed: 0, basis: 'not_ready' })
      } finally {
        store._ready = saved
      }
    })

    it('裁剪期间每条 DELETE 都必须带 owner_subject 谓词与 owner 实参（结果同形不等于做法相同）', () => {
      // 上一条只断言"删了哪些行"，而"逐 owner 删"与"一条不带 owner 的 DELETE"
      // 在**结果**上完全同形 ⇒ 那种写法既能通过上一条，又违反本文件的隔离不变量。
      // 所以这里锁语句本身：谓词 + 实参 + 每个 owner 各一条。
      store.incrPublishDailyCount('douyin:acc_1', '2026-09-20', 'count', 5, 'user-a')
      store.incrPublishDailyCount('weibo:acc_9', '2026-09-21', 'count', 2, 'user-b')
      store.incrPublishDailyCount('weibo:acc_9', '2026-09-19', 'count', 2, 'user-c')

      const deletes = []
      const realPrepare = store.db.prepare.bind(store.db)
      store.db.prepare = function (sql) {
        const stmt = realPrepare(sql)
        if (!/DELETE/i.test(sql)) return stmt
        return {
          run: (...args) => {
            deletes.push({ sql, args })
            return stmt.run(...args)
          },
          all: (...args) => stmt.all(...args),
          get: (...args) => stmt.get(...args),
        }
      }
      try {
        const res = store.prunePublishDailyCountAllOwners('2026-10-10')
        expect(res.basis).toBe('measured')
      } finally {
        store.db.prepare = realPrepare
      }

      expect(deletes.length, `实际 DELETE: ${JSON.stringify(deletes.map((d) => d.sql))}`).toBe(3)
      for (const d of deletes) {
        expect(d.sql).toMatch(/owner_subject\s*=\s*\?/)
        expect(typeof d.args[0], '首参必须是具体 owner，不得靠"少写谓词"覆盖全表').toBe('string')
        expect(d.args[0].length).toBeGreaterThan(0)
      }
      expect(deletes.map((d) => d.args[0]).sort()).toEqual(['user-a', 'user-b', 'user-c'])
    })

    it('形状对但日历不存在的日期必须拒绝（2026-13-40 会滚成 2027-02 ⇒ 一把删光全部历史行）', () => {
      // 既有 `prunePublishDailyCount` 只做了 /^\d{4}-\d{2}-\d{2}$/ 形状校验。
      // 形状过、日历不过的串经 Date.UTC 归一化会**滚到未来**（2026-13-40 → 2027-02-10），
      // 于是 cutoff 落在所有行之后 ⇒ DELETE 命中全部行。这不是理论：调用方一旦把
      // 用户输入或格式错的日期传进来，日配额历史就整表蒸发（表现为"所有人今天都能重发"）。
      // 正解＝round-trip 校验（解析后重新格式化必须等于输入），两个 prune 共用同一个谓词。
      store.incrPublishDailyCount('douyin:acc_1', '2026-09-20', 'count', 5, 'user-a')
      store.incrPublishDailyCount('douyin:acc_1', '2026-10-09', 'count', 1, 'user-a')

      expect(store.prunePublishDailyCount('2026-13-40', 'user-a')).toBe(0)
      expect(store.prunePublishDailyCount('2026-02-30', 'user-a')).toBe(0)
      expect(store.getPublishDailyCount('douyin:acc_1', '2026-09-20', 'user-a')).not.toBe(null)
      expect(store.getPublishDailyCount('douyin:acc_1', '2026-10-09', 'user-a')).not.toBe(null)

      // 对照：合法日期确实会裁掉窗口外的行（否则上面两条"拒绝"可能只是函数坏了）
      expect(store.prunePublishDailyCount('2026-10-10', 'user-a')).toBe(1)
      expect(store.getPublishDailyCount('douyin:acc_1', '2026-09-20', 'user-a')).toBe(null)
    })
  })
})
