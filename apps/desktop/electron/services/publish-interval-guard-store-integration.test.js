/**
 * 集成回归锁：真实 SQLite（sql.js）存储下的「未提交失败回滚窗口」
 * （fix-release-window-taken-type-mismatch）
 *
 * 为什么单测（packages/shared-utils/tests/guard-release-store-type.test.js）之外还要一条集成锁：
 * 那条锁证明的是**守卫对任意存储类型都成立**；这条锁证明的是**桌面生产的存储确实是那种类型**。
 * 两者缺一不可 —— 本次缺陷的逃逸原因正是"单测用内存 Map（number 进 / number 出）"，
 * 与生产（SQLite TEXT 列：number 进 / **string** 出）语义不同。若只留单测，
 * 下一个人把生产 store 换成另一种类型时同样的 bug 会再来一次而集成面无声。
 *
 * 判据（learnings pitfall:release-window-taken-strict-eq-across-store-type）：
 * 任何「写入值 ≡ 读回值」的乐观并发判据，必须有一条**穿过真实存储**的回归锁，
 * 且该锁要**先断言存储的类型事实**（本文件 G1），再断言业务结果（G2/G3）。
 */

import { beforeAll, beforeEach, afterEach, describe, expect, it } from 'vitest'
import initSqlJs from 'sql.js'

__enableElectronMock()

let SQL
let Store
let schema
let PublishIntervalGuard
let rawDb
let store
let guard

/** 与生产 sqlite-wrapper 同形的极简适配器：只实现本用例用到的面 */
class SqlJsAdapter {
  constructor (db) {
    this._db = db
  }

  exec (sql) {
    this._db.exec(sql)
  }

  execOrThrow (sql) {
    this._db.exec(sql)
  }

  prepare (sql) {
    const db = this._db
    return {
      run (...params) {
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

/** 与 container.setup.js 的装配**逐字同形**（改装配必须同改这里，否则本锁失效） */
function buildGuard () {
  return new PublishIntervalGuard({
    policy: () => ({ accountMinMs: 60 * 60 * 1000, platformMinMs: 60 * 1000, accountDailyMax: 350 }),
    isKnownPlatform: () => true,
    store: {
      get: (key) => store.getPublishTimeline(key),
      set: (key, value) => store.setPublishTimeline(key, value),
    },
    dailyStore: {
      getDay: (key, dayKey) => store.getPublishDailyCount(key, dayKey) || { count: 0, rollback_count: 0 },
      incrDay: (key, dayKey, field, delta) => store.incrPublishDailyCount(key, dayKey, field, delta),
      decrDay: (key, dayKey, field) => store.decrPublishDailyCount(key, dayKey, field),
    },
    jitterRatio: 0,
    releaseGraceMs: 60000,
    warn: () => {},
  })
}

beforeAll(async () => {
  SQL = await initSqlJs()
  Store = require('./store')
  schema = require('./store-schema')
  PublishIntervalGuard = require('@multi-publish/shared-utils/src/publish-interval-guard')
})

beforeEach(() => {
  rawDb = new SQL.Database()
  for (const sql of schema.SCHEMA_SQL) rawDb.exec(sql)
  store = new Store()
  store.db = new SqlJsAdapter(rawDb)
  store._ready = true
  guard = buildGuard()
})

afterEach(() => {
  if (rawDb) rawDb.close()
})

describe('真实 SQLite 存储下的间隔窗口回滚（fix-release-window-taken-type-mismatch）', () => {
  it('G1 存储类型事实：publish_timeline 写入 number 后读回是 **string**（TEXT 列）', () => {
    store.setPublishTimeline('tencent_video:b1e05ac2', 1792241248768)
    const read = store.getPublishTimeline('tencent_video:b1e05ac2')
    expect(typeof read).toBe('string')
    expect(Number(read)).toBe(1792241248768)
    // 这一行是本次缺陷的"物理原因"：类型不同 ⇒ `read === 1792241248768` 为 false
    expect(read === 1792241248768).toBe(false)
  })

  it('G2「可确证未送出」的失败必须真的释放窗口（现场：视频号被挡 59 分钟）', () => {
    // 现场形态：视频号账号档 60 分钟，一次「登录失效」尝试把它占住
    const hold = guard.recordPublish('tencent_video', 'b1e05ac2')
    const before = guard.check('tencent_video', 'b1e05ac2')
    expect(before.allowed).toBe(false)
    expect(before.bucket).toBe('account')
    // 真实时钟：record 与 check 之间有毫秒级流逝，故按「≈一个满档」断言而不是精确值
    expect(before.remainingMs).toBeGreaterThan(60 * 60 * 1000 - 5000)

    const res = guard.release('tencent_video', 'b1e05ac2', hold)
    expect(res.released).toBe(true)
    expect(res.reason).toBe(null)

    // 回滚后下一次提交必须立即可发（修复前这里是 3600000 ⇒ UI 显示「等待 59 分钟」）
    expect(guard.check('tencent_video', 'b1e05ac2').remainingMs).toBe(0)
    expect(guard.check('tencent_video', 'b1e05ac2').allowed).toBe(true)
  })

  it('G3 回滚同时回补日配额计数并累加回滚计数（两个计数器语义仍分离）', () => {
    const day = guard.today()
    guard.recordPublish('tencent_video', 'b1e05ac2')
    expect(store.getPublishDailyCount('tencent_video:b1e05ac2', day).count).toBe(1)

    const hold = guard.recordPublish('tencent_video', 'b1e05ac2')
    const res = guard.release('tencent_video', 'b1e05ac2', hold)
    expect(res.released).toBe(true)
    const row = store.getPublishDailyCount('tencent_video:b1e05ac2', day)
    expect(row.count).toBe(1) // 2 → 1（只回补本次）
    expect(row.rollback_count).toBe(1) // 只增不减
  })

  it('G4 窗口被后续真实提交覆盖时仍 fail-closed（window_taken，不吞他人窗口）', () => {
    const hold = guard.recordPublish('tencent_video', 'b1e05ac2')
    // 后续一次真实提交覆盖了两个键（模拟"期间又发了一条"）。
    // ⚠️ 覆盖值必须是**不触发未来戳写入闸**的合法值：store 侧拒绝 timestamp > now+60s
    // （fix-account-interval-ghost-wait 的写入闸）。这里取 hold.at+1s，既不同又合法。
    const later = hold.at + 1000
    expect(store.setPublishTimeline).toBeTypeOf('function')
    store.setPublishTimeline('tencent_video:b1e05ac2', later)
    store.setPublishTimeline('tencent_video:*', later)
    expect(Number(store.getPublishTimeline('tencent_video:b1e05ac2'))).toBe(later) // 覆盖确实落库

    const res = guard.release('tencent_video', 'b1e05ac2', hold)
    expect(res.released).toBe(false)
    expect(res.reason).toBe('window_taken')
    expect(Number(store.getPublishTimeline('tencent_video:b1e05ac2'))).toBe(later)
    expect(Number(store.getPublishTimeline('tencent_video:*'))).toBe(later)
  })

  it('G5 图文与视频走同一条判定：账号档键与发布形态无关（同一 key 体系）', () => {
    // 图文（无 video_path）与视频都经 publish:batch → taskQueue → 同一守卫，
    // 键只由 (platform, accountId) 决定 ⇒ 图文同样受影响、同样被本修复覆盖。
    const hold = guard.recordPublish('tencent_video', 'same-account')
    const res = guard.release('tencent_video', 'same-account', hold)
    expect(res.released).toBe(true)
    expect(guard.check('tencent_video', 'same-account').allowed).toBe(true)
  })
})
