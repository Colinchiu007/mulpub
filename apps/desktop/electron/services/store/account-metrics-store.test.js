// @ts-check
/**
 * 账号级回流存储层回归（PRD-PUBLISH-HISTORY-ENGAGEMENT-2026-10-12 §7.1 T15–T18）
 *
 * 用**真 sqlite** 而不是 fake db：这一层的风险全在 SQL 本身 ——
 * 幂等键写错会让同日重复采集堆成多行（把「日增」算成多天）、
 * 回填写成覆盖式会把平台发布回传的更权威 post_id 打掉、
 * 归属过滤写错会串号。fake prepare 只记录 SQL 字符串，这三类错一个都测不出来。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const Database = require('../sqlite-wrapper')
const mixin = require('./account-metrics-store')
const { migratePerformanceLoopSchema } = require('../activate-viral-schema')

let dbPath = ''
let db = null

function makeStore () {
  const self = {
    _ready: true,
    db,
    _settings: {},
    getUserSetting (key) { return Object.prototype.hasOwnProperty.call(this._settings, key) ? this._settings[key] : null },
    setUserSetting (key, value) { this._settings[key] = value; return true },
  }
  for (const key of Object.keys(mixin)) self[key] = mixin[key]
  return self
}

function insertTracked (id, platform, postId, owner, publishHistoryId) {
  db.prepare(`INSERT INTO tracked_content (id, platform, post_id, url, publish_history_id, recrawl_status, owner_subject, created_at)
              VALUES (?, ?, ?, '', ?, 'pending', ?, '2026-10-01T00:00:00.000Z')`)
    .run(id, platform, postId || '', publishHistoryId || null, owner)
}

function readSnapshots (trackedId) {
  return db.prepare('SELECT * FROM performance_snapshot WHERE tracked_content_id = ? ORDER BY id').all(trackedId)
}

beforeAll(async () => {
  await Database.ready
  dbPath = path.join(fs.realpathSync(os.tmpdir()), `acct-metrics-${process.pid}-${Math.random().toString(36).slice(2, 8)}.db`)
  if (fs.existsSync(dbPath)) fs.rmSync(dbPath)
  db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  migratePerformanceLoopSchema(db, (target, sql) => target.execOrThrow(sql))
  const built = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r => r.name)
  for (const need of ['tracked_content', 'performance_snapshot']) {
    if (!built.includes(need)) throw new Error('夹具失效：' + need + ' 表未建成，实得 ' + built.join(','))
  }
})

afterAll(() => {
  if (db && typeof db.close === 'function') db.close()
  for (const suffix of ['', '-wal', '-shm']) {
    const p = dbPath + suffix
    if (p && fs.existsSync(p)) fs.rmSync(p, { force: true })
  }
})

describe('listTrackedForAccountSync', () => {
  it('T18 按归属过滤：身份可解析时只取本人行（不串号）', () => {
    insertTracked('own-1', 'xiaohongshu', '', 'user-A')
    insertTracked('other-1', 'xiaohongshu', '', 'user-B')
    const store = makeStore()
    const mine = store.listTrackedForAccountSync('user-A')
    const ids = mine.rows.map(r => r.id)
    expect(ids).toContain('own-1')
    expect(ids).not.toContain('other-1')
  })

  it('T18b 无身份（legacy 档）取无归属桶，不把已归属账号的数据端出去', () => {
    const store = makeStore()
    const legacy = store.listTrackedForAccountSync(null)
    const ids = legacy.rows.map(r => r.id)
    expect(ids).not.toContain('own-1')
    expect(ids).not.toContain('other-1')
  })

  it('T18c 触顶时如实返回 truncated（不静默截断）', () => {
    for (let i = 0; i < 5; i += 1) insertTracked('bulk-' + i, 'douyin', '', 'user-C')
    const store = makeStore()
    const limited = store.listTrackedForAccountSync('user-C', 2)
    expect(limited.rows).toHaveLength(2)
    expect(limited.truncated).toBe(true)
    expect(limited.total).toBe(5)
  })
})

describe('applyAccountSyncLinks', () => {
  it('T15 同日同源幂等：连写两次只留一行（V13，防「日增」被算成多天）', () => {
    insertTracked('idem-1', 'xiaohongshu', 'note-9', 'user-A')
    const store = makeStore()
    const link = { trackedId: 'idem-1', work: { platform: 'xiaohongshu', postId: 'note-9', metrics: { views: 10, likes: 1, comments: 2, favorites: 3, shares: 4 } } }
    const t0 = Date.parse('2026-10-12T02:00:00.000Z')
    store.applyAccountSyncLinks({ links: [link], ownerSubject: 'user-A', nowMs: t0, source: 'account_sync' })
    store.applyAccountSyncLinks({ links: [{ ...link, work: { ...link.work, metrics: { views: 99, likes: 1, comments: 2, favorites: 3, shares: 4 } } }], ownerSubject: 'user-A', nowMs: t0 + 60 * 1000, source: 'account_sync' })
    const rows = readSnapshots('idem-1')
    expect(rows).toHaveLength(1)
    expect(rows[0].views).toBe(99) // 同日覆盖为最新
  })

  it('T15b 跨 UTC 日则各留一份（日增趋势需要相邻两天的基线）', () => {
    insertTracked('idem-2', 'xiaohongshu', 'note-10', 'user-A')
    const store = makeStore()
    const link = { trackedId: 'idem-2', work: { platform: 'xiaohongshu', postId: 'note-10', metrics: { views: 10 } } }
    const d1 = Date.parse('2026-10-12T02:00:00.000Z')
    const d2 = Date.parse('2026-10-13T02:00:00.000Z')
    store.applyAccountSyncLinks({ links: [link], ownerSubject: 'user-A', nowMs: d1, source: 'account_sync' })
    store.applyAccountSyncLinks({ links: [link], ownerSubject: 'user-A', nowMs: d2, source: 'account_sync' })
    expect(readSnapshots('idem-2')).toHaveLength(2)
  })

  it('T16 回填只补空值：既有 post_id 不得被覆盖（V14）', () => {
    insertTracked('keep-1', 'zhihu', 'existing-real-id', 'user-A')
    const store = makeStore()
    store.applyAccountSyncLinks({
      links: [{ trackedId: 'keep-1', work: { platform: 'zhihu', postId: 'accidental-id', metrics: { views: 1 } } }],
      ownerSubject: 'user-A',
      nowMs: Date.parse('2026-10-12T02:00:00.000Z'),
      source: 'account_sync',
    })
    const row = db.prepare('SELECT post_id FROM tracked_content WHERE id = ?').get('keep-1')
    expect(row.post_id).toBe('existing-real-id')
  })

  it('T16b 空 post_id 才回填（这是 58/68 条记录恢复可点性的唯一路径）', () => {
    insertTracked('fill-1', 'douyin', '', 'user-A')
    const store = makeStore()
    const out = store.applyAccountSyncLinks({
      links: [{ trackedId: 'fill-1', work: { platform: 'douyin', postId: 'aweme-777', metrics: { views: 5 } } }],
      ownerSubject: 'user-A',
      nowMs: Date.parse('2026-10-12T02:00:00.000Z'),
      source: 'account_sync',
    })
    expect(out.backfilled).toBe(1)
    expect(db.prepare('SELECT post_id FROM tracked_content WHERE id = ?').get('fill-1').post_id).toBe('aweme-777')
  })

  // 2026-10-15（用户报障「作品链接一直没生效」的写入侧根因之一）：
  // 快手拿不到真 id 时把**合成成功信号** `published-<时间戳>` 写进 post_id，
  // 它非空但拼不出任何公开页，于是「只补空值」把真 photoId 永久挡在门外。
  it('T16c 合成 post_id（published-*）不占位：真作品 ID 必须能覆盖它', () => {
    // 快手的作品 ID 形态是**纯数字**（published-content-url 的 postIdRe=/^\d{6,}$/），
    // 合成值 `published-<时间戳>` 正是被这条形态闸门拒掉的那一类。
    insertTracked('ks-1', 'kuaishou', 'published-mv4y7b6d', 'user-A')
    const store = makeStore()
    const out = store.applyAccountSyncLinks({
      links: [{ trackedId: 'ks-1', work: { platform: 'kuaishou', postId: '1874289148083371214', metrics: { views: 7 } } }],
      ownerSubject: 'user-A',
      nowMs: Date.parse('2026-10-12T02:00:00.000Z'),
      source: 'account_sync',
    })
    expect(out.backfilled).toBe(1)
    expect(db.prepare('SELECT post_id FROM tracked_content WHERE id = ?').get('ks-1').post_id).toBe('1874289148083371214')
  })

  it('T16d 真作品 ID 仍然不可被覆盖（V14 本意不变）', () => {
    insertTracked('ks-2', 'kuaishou', '1874289148083371214', 'user-A')
    const store = makeStore()
    const out = store.applyAccountSyncLinks({
      links: [{ trackedId: 'ks-2', work: { platform: 'kuaishou', postId: '1875007830173233602', metrics: { views: 7 } } }],
      ownerSubject: 'user-A',
      nowMs: Date.parse('2026-10-12T02:00:00.000Z'),
      source: 'account_sync',
    })
    expect(out.backfilled).toBe(0)
    expect(db.prepare('SELECT post_id FROM tracked_content WHERE id = ?').get('ks-2').post_id).toBe('1874289148083371214')
  })

  it('T16e 新值本身也不可用时不得覆盖（避免把假值换成另一个假值）', () => {
    insertTracked('ks-3', 'kuaishou', 'published-aaa', 'user-A')
    const store = makeStore()
    const out = store.applyAccountSyncLinks({
      links: [{ trackedId: 'ks-3', work: { platform: 'kuaishou', postId: 'published-bbb', metrics: { views: 7 } } }],
      ownerSubject: 'user-A',
      nowMs: Date.parse('2026-10-12T02:00:00.000Z'),
      source: 'account_sync',
    })
    expect(out.backfilled).toBe(0)
    expect(db.prepare('SELECT post_id FROM tracked_content WHERE id = ?').get('ks-3').post_id).toBe('published-aaa')
  })

  it('T18d 归属不符的行一律不写（fail closed：owner 过滤不能只靠上游）', () => {
    insertTracked('foreign-1', 'xiaohongshu', '', 'user-B')
    const store = makeStore()
    const out = store.applyAccountSyncLinks({
      links: [{ trackedId: 'foreign-1', work: { platform: 'xiaohongshu', postId: 'note-x', metrics: { views: 1 } } }],
      ownerSubject: 'user-A',
      nowMs: Date.parse('2026-10-12T02:00:00.000Z'),
      source: 'account_sync',
    })
    expect(out.written).toBe(0)
    expect(out.skipped).toBe(1)
    expect(readSnapshots('foreign-1')).toHaveLength(0)
  })

  it('T15c 缺失指标写 null 而不是 0（V10 的落库侧守门）', () => {
    insertTracked('null-1', 'douyin', 'aweme-null', 'user-A')
    const store = makeStore()
    store.applyAccountSyncLinks({
      links: [{ trackedId: 'null-1', work: { platform: 'douyin', postId: 'aweme-null', metrics: { views: 7, likes: null, comments: null, favorites: null, shares: null } } }],
      ownerSubject: 'user-A',
      nowMs: Date.parse('2026-10-12T02:00:00.000Z'),
      source: 'account_sync',
    })
    const row = readSnapshots('null-1')[0]
    expect(row.views).toBe(7)
    expect(row.favorites).toBeNull()
    expect(row.shares).toBeNull()
  })

  it('raw 字段不含账号凭证（只留通道诊断）', () => {
    insertTracked('raw-1', 'kuaishou', 'ks-1', 'user-A')
    const store = makeStore()
    store.applyAccountSyncLinks({
      links: [{ trackedId: 'raw-1', level: 2, work: { platform: 'kuaishou', postId: 'ks-1', metrics: { views: 1 } } }],
      ownerSubject: 'user-A',
      nowMs: Date.parse('2026-10-12T02:00:00.000Z'),
      source: 'account_sync',
    })
    const raw = readSnapshots('raw-1')[0].raw
    expect(raw).not.toContain('cookie')
    expect(raw).toContain('account_sync')
  })
})

describe('getLatestSnapshotsForTrackedIds', () => {
  it('T17 每行只返回最新一份，且带 captured_at（读侧「数据截至」的依据）', () => {
    insertTracked('latest-1', 'xiaohongshu', 'n1', 'user-A')
    const store = makeStore()
    const old = Date.parse('2026-10-10T02:00:00.000Z')
    const fresh = Date.parse('2026-10-12T02:00:00.000Z')
    store.applyAccountSyncLinks({ links: [{ trackedId: 'latest-1', work: { platform: 'xiaohongshu', postId: 'n1', metrics: { views: 1 } } }], ownerSubject: 'user-A', nowMs: old, source: 'account_sync' })
    store.applyAccountSyncLinks({ links: [{ trackedId: 'latest-1', work: { platform: 'xiaohongshu', postId: 'n1', metrics: { views: 88 } } }], ownerSubject: 'user-A', nowMs: fresh, source: 'account_sync' })

    const out = store.getLatestSnapshotsForTrackedIds(['latest-1'], 'user-A')
    expect(out.rows).toHaveLength(1)
    expect(out.rows[0]).toMatchObject({ trackedContentId: 'latest-1', views: 88, source: 'account_sync' })
    expect(out.rows[0].capturedAt).toBe(new Date(fresh).toISOString())
  })

  it('T17b 归属不符的 id 不返回（JOIN 过滤，不信任调用方传的 id 列表）', () => {
    insertTracked('sec-1', 'xiaohongshu', 'n2', 'user-B')
    const store = makeStore()
    store.applyAccountSyncLinks({ links: [{ trackedId: 'sec-1', work: { platform: 'xiaohongshu', postId: 'n2', metrics: { views: 5 } } }], ownerSubject: 'user-B', nowMs: Date.parse('2026-10-12T02:00:00.000Z'), source: 'account_sync' })
    const out = store.getLatestSnapshotsForTrackedIds(['sec-1'], 'user-A')
    expect(out.rows).toHaveLength(0)
    expect(out.missing).toEqual(['sec-1'])
  })

  it('T17c 无快照的 id 进 missing，不伪造 0 值行', () => {
    insertTracked('no-snap-1', 'toutiao', 't1', 'user-A')
    const store = makeStore()
    const out = store.getLatestSnapshotsForTrackedIds(['no-snap-1'], 'user-A')
    expect(out.rows).toHaveLength(0)
    expect(out.missing).toEqual(['no-snap-1'])
  })

  it('T17d 重复 id 去重、空数组直接返回（不产生 IN () 语法错误）', () => {
    const store = makeStore()
    expect(store.getLatestSnapshotsForTrackedIds([], 'user-A')).toEqual({ rows: [], missing: [] })
    const out = store.getLatestSnapshotsForTrackedIds(['latest-1', 'latest-1', ''], 'user-A')
    expect(out.rows).toHaveLength(1)
  })
})

describe('getHistoryMetricsByTaskIds（发布记录页的唯一指标读口）', () => {
  it('T19 按发布任务 id 一次取回指标 + 快照时刻 + 真实作品 ID（修 D1/D2）', () => {
    insertTracked('hist-1', 'douyin', '', 'user-H', 'task-h1')
    const store = makeStore()
    store.applyAccountSyncLinks({
      links: [{ trackedId: 'hist-1', work: { platform: 'douyin', postId: 'aweme-h1', metrics: { views: 100, likes: 9, comments: 3, favorites: null, shares: 1 } } }],
      ownerSubject: 'user-H',
      nowMs: Date.parse('2026-10-12T05:00:00.000Z'),
      source: 'account_sync',
    })
    const out = store.getHistoryMetricsByTaskIds(['task-h1'], 'user-H')
    expect(Object.keys(out.metrics)).toEqual(['task-h1'])
    expect(out.metrics['task-h1']).toMatchObject({
      views: 100, likes: 9, comments: 3, shares: 1, platform: 'douyin', postId: 'aweme-h1', source: 'account_sync',
    })
    expect(out.metrics['task-h1'].capturedAt).toBe('2026-10-12T05:00:00.000Z')
    expect(out.missing).toEqual([])
  })

  it('T19b 无快照的任务 id 进 missing（界面据此渲染「尚未采集」而不是 0）', () => {
    insertTracked('hist-2', 'toutiao', 'tt-1', 'user-H', 'task-h2')
    const store = makeStore()
    const out = store.getHistoryMetricsByTaskIds(['task-h2', 'task-unknown'], 'user-H')
    expect(out.metrics).toEqual({})
    expect(out.missing.sort()).toEqual(['task-h2', 'task-unknown'])
  })

  it('T19c 归属不符的任务 id 不返回（跨用户取数在 SQL 层就挡住）', () => {
    insertTracked('hist-3', 'douyin', 'a3', 'user-X', 'task-x1')
    const store = makeStore()
    store.applyAccountSyncLinks({
      links: [{ trackedId: 'hist-3', work: { platform: 'douyin', postId: 'a3', metrics: { views: 7 } } }],
      ownerSubject: 'user-X',
      nowMs: Date.parse('2026-10-12T05:00:00.000Z'),
      source: 'account_sync',
    })
    expect(store.getHistoryMetricsByTaskIds(['task-x1'], 'user-H').metrics).toEqual({})
  })

  it('T19d 空入参直接返回，不产生 IN () 语法错误', () => {
    const store = makeStore()
    expect(store.getHistoryMetricsByTaskIds([], 'user-H')).toEqual({ metrics: {}, missing: [], truncated: false })
    expect(store.getHistoryMetricsByTaskIds(null, 'user-H')).toEqual({ metrics: {}, missing: [], truncated: false })
  })

  it('T19e 超出单次上限 ⇒ truncated 为真（不得静默丢弃：调用方要能区分「没采过」与「被上限丢掉」）', () => {
    const store = makeStore()
    const out = store.getHistoryMetricsByTaskIds(['a', 'b', 'c'], 'user-H', 2)
    expect(out.truncated).toBe(true)
    expect(out.missing).toEqual(['a', 'b'])
  })
})

describe('双源快照与采集状态（QM-6 评审修复项）', () => {
  it('T20 双源：账号级采集对平台不返回的列不得把另一条链已确立的值抹成 0（QM-6 CRITICAL 回归锁）', () => {
    insertTracked('dual-1', 'douyin', 'aweme-dual', 'user-A')
    // 手工录入先确立 likes=50 / favorites=30
    db.prepare(`INSERT INTO performance_snapshot (id, tracked_content_id, source, views, likes, comments, favorites, shares, raw, captured_at)
                VALUES ('manual-1', 'dual-1', 'manual', 0, 50, 0, 30, 0, '{}', '2026-10-11T03:00:00.000Z')`).run()
    const store = makeStore()
    // 账号级采集：抖音不返回收藏数 ⇒ favorites 为 null；views 有真值
    store.applyAccountSyncLinks({
      links: [{ trackedId: 'dual-1', work: { platform: 'douyin', postId: 'aweme-dual', metrics: { views: 800, likes: null, comments: null, favorites: null, shares: null } } }],
      ownerSubject: 'user-A',
      nowMs: Date.parse('2026-10-12T10:00:00.000Z'),
      source: 'account_sync',
    })
    const rows = db.prepare("SELECT * FROM performance_snapshot WHERE tracked_content_id = 'dual-1' ORDER BY captured_at").all()
    expect(rows).toHaveLength(2)
    const fresh = rows[rows.length - 1]
    expect(fresh.views).toBe(800)
    // 关键：峰值不回落为 0 —— 继承上一份的非空值
    expect(fresh.likes).toBe(50)
    expect(fresh.favorites).toBe(30)
  })

  it('T20b 无历史快照时缺失列仍为 null（继承不得凭空造数）', () => {
    insertTracked('dual-2', 'douyin', 'aweme-d2', 'user-A')
    const store = makeStore()
    store.applyAccountSyncLinks({
      links: [{ trackedId: 'dual-2', work: { platform: 'douyin', postId: 'aweme-d2', metrics: { views: 5, favorites: null } } }],
      ownerSubject: 'user-A',
      nowMs: Date.parse('2026-10-12T10:00:00.000Z'),
      source: 'account_sync',
    })
    const row = db.prepare("SELECT * FROM performance_snapshot WHERE tracked_content_id = 'dual-2'").get()
    expect(row.views).toBe(5)
    expect(row.favorites).toBeNull()
  })

  it('T20c 平台真给了 0 时不继承（0 是有效值，不得被旧值覆盖）', () => {
    insertTracked('dual-3', 'zhihu', 'z-d3', 'user-A')
    db.prepare(`INSERT INTO performance_snapshot (id, tracked_content_id, source, views, likes, comments, favorites, shares, raw, captured_at)
                VALUES ('manual-3', 'dual-3', 'manual', 0, 50, 0, 0, 0, '{}', '2026-10-11T03:00:00.000Z')`).run()
    const store = makeStore()
    store.applyAccountSyncLinks({
      links: [{ trackedId: 'dual-3', work: { platform: 'zhihu', postId: 'z-d3', metrics: { views: 1, likes: 0 } } }],
      ownerSubject: 'user-A',
      nowMs: Date.parse('2026-10-12T10:00:00.000Z'),
      source: 'account_sync',
    })
    const row = db.prepare("SELECT * FROM performance_snapshot WHERE tracked_content_id = 'dual-3' ORDER BY captured_at DESC LIMIT 1").get()
    expect(row.likes).toBe(0)
  })

  it('T21 采集状态按归属分桶：user-A 写入的状态 user-B 读不到（此前 stub 丢 owner 参数 ⇒ 这条锁缺失）', () => {
    const mk = () => {
      const self = {
        _ready: true,
        db,
        _settings: {},
        getUserSetting (key, _d, owner) {
          const k = String(owner || '') + '|' + key
          return Object.prototype.hasOwnProperty.call(this._settings, k) ? this._settings[k] : null
        },
        setUserSetting (key, value, owner) {
          this._settings[String(owner || '') + '|' + key] = value
          return true
        },
      }
      for (const key of Object.keys(mixin)) self[key] = mixin[key]
      return self
    }
    const a = mk()
    a.setAccountSyncState({ lastRunAt: 'A' }, 'user-A')
    expect(a.getAccountSyncState('user-A')).toMatchObject({ lastRunAt: 'A' })
    expect(a.getAccountSyncState('user-B')).toBeNull()
    expect(a.getAccountSyncState(undefined)).toBeNull()
  })
})

describe('账号级采集状态', () => {
  it('无状态返回 null（「没采过」与「读不到」必须可区分），写入后可读回', () => {
    const store = makeStore()
    expect(store.getAccountSyncState('user-A')).toBeNull()
    expect(store.setAccountSyncState({ lastRunAt: '2026-10-12T00:00:00.000Z', counts: { synced: 2 } }, 'user-A')).toBe(true)
    expect(store.getAccountSyncState('user-A')).toMatchObject({ counts: { synced: 2 } })
  })

  it('状态损坏（非 JSON）时返回 null 而不抛错', () => {
    const store = makeStore()
    store._settings.account_metrics_sync_state = '{坏掉的 JSON'
    expect(store.getAccountSyncState('user-A')).toBeNull()
  })
})
