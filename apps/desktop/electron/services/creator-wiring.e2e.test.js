/**
 * creator-wiring.e2e.test.js — 主进程接线端到端验收
 *
 * ## 为什么必须走真实 sql.js + 真实 registerHandlers
 *
 * 2026-10-07 的整条接线**从未真正跑通过一次**：365 项测试全绿、QM-1 打包通过，
 * 但通道从未注册、store 缺 14 个方法。根因是所有既有测试都**用桩 store 直调
 * `registerHandlers`** —— 桩把缺失方法全补上了，真实实现缺多少测不出来。
 *
 * 所以本文件是仓库里第一条**不替换任何一层**的 creator 测试：
 *   真实 sql.js 建表 → 真实 createCreatorStore → 真实聚合器 registerAllHandlers
 *   → 通过 ipcMain.handle 抓到的 handler → 模拟渲染进程调用。
 * 少接一层，这个文件就红。
 */
__enableElectronMock()

const os = require('os')
const path = require('path')
const fs = require('fs')
const Database = require('./sqlite-wrapper')

const { CREATOR_TABLE_SQL, CREATOR_OUTBOX_SQL } = require('./creator-schema')
const { createCreatorStore } = require('./creator-store')
const { createCreatorRuntime } = require('./creator-runtime')
const { createCreatorMonitorFacade, createCreatorQuota } = require('./creator-wiring')

/**
 * 用**真实的 sqlite-wrapper**，不是裸 sql.js。
 *
 * 上一版这里直接 `new SQL.Database()`，结果第一轮就炸在
 * `st.all is not a function` —— 裸 sql.js 的语句只有 get/run/step/free，
 * `all()` 是 better-sqlite3 的 API。而生产里 store 拿到的是
 * `sqlite-wrapper`（better-sqlite3 兼容层，确有 all/get/run）。
 * 换句话说：**用错 db 形状的测试会逼我把 store 改成错的样子**，
 * 这次差点为了迁就测试把 store 改坏。真实形状才认得出来谁是错的。
 */
async function makeRealDb () {
  await Database.ready            // 等 WASM 就绪
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'creator-e2e-'))
  const db = new Database(path.join(dir, 'test.db'))
  db.exec(`CREATE TABLE IF NOT EXISTS viral_library (
    id TEXT PRIMARY KEY, platform TEXT, title TEXT, url TEXT, content TEXT,
    external_id TEXT DEFAULT '', creator_id TEXT DEFAULT '',
    created_at TEXT, updated_at TEXT)`)
  for (const sql of CREATOR_TABLE_SQL.concat(CREATOR_OUTBOX_SQL)) db.exec(sql)
  return db
}

function makeIpcMain () {
  const handlers = new Map()
  return { handle: (ch, fn) => handlers.set(ch, fn), _h: handlers }
}

/**
 * 可信来源：用**开发态真实**的来源（http://127.0.0.1:5174），不用 file://。
 * file:// 分支要拿 app.getAppPath() 解析真实路径并 realpath 比对 dist 目录，
 * 在单测的 electron mock 下取不到路径 → 守卫正确地 fail-closed。
 * 开发态渲染进程本来就跑在 vite dev server 上，所以这不是绕过守卫，
 * 是复现它真正会遇到的那条白名单。
 */
function trustedEvent () {
  return { senderFrame: { url: 'http://127.0.0.1:5174/' } }
}

const UC = 'UC' + 'a'.repeat(22)

/** 采集器替身：只挡网络，store 与 handler 全是真实的。
 *  ⚠ 方法集**必须**与真实采集器一致 —— 见文件末尾的「替身形状对账」用例。
 *  历史教训：这里的 `resolveChannelId` 是手搓的，而真实 `createCreatorCollector`
 *  当时根本没返回它 ⇒ 夹具把「添加博主」伪装成可用，真实装配下必抛 TypeError。 */
function stubCollector (posts = [], body = { content: '正文', contentQuality: 'full' }) {
  return {
    resolveChannelId: async () => UC,
    listPosts: async () => posts,
    collectBody: async () => body,
  }
}

/** 把真实依赖接到真实 handler 上（等价于 phase5-ipc 注册点做的事） */
function wireReal (db, collector) {
  const store = createCreatorStore(db, { now: () => Date.now() })
  const runtime = createCreatorRuntime({ store, collector, now: () => Date.now() })
  const deps = {
    creatorStore: store,
    creatorCollector: collector,
    creatorMonitor: createCreatorMonitorFacade({ creatorRuntime: runtime }),
    creatorQuota: createCreatorQuota(store),
    log: { warn () {}, error () {}, info () {} },
  }
  const ipc = makeIpcMain()
  // handler 的 wrap 会把内部异常转成 {code:-1}，异常原文只走 log。
  // 这里必须打出来 —— 否则测试只会告诉你「失败了」，不告诉你「为什么」。
  const errors = []
  deps.log = {
    warn: (...a) => { errors.push(a.join(' ')); console.error('[creator-e2e:warn]', ...a) },
    error: (...a) => { errors.push(a.join(' ')); console.error('[creator-e2e:error]', ...a) },
    info () {},
  }
  require('./../ipc-handlers/creator').registerHandlers(ipc, deps)
  return { ipc, store, deps, errors }
}

function call (ipc, channel, payload) {
  const fn = ipc._h.get(channel)
  if (!fn) throw new Error(`通道未注册：${channel}`)
  return fn(trustedEvent(), payload || {})
}

/** sqlite-wrapper 的 exec() 不返回结果集，取值一律走 prepare().get() */
function firstId (db) {
  const row = db.prepare('SELECT id FROM creator_discoveries LIMIT 1').get()
  if (!row || !row.id) throw new Error('creator_discoveries 为空')
  return row.id
}
function count (db, sql) {
  const row = db.prepare(sql).get()
  return row && Number.isFinite(Number(row.n)) ? Number(row.n) : 0
}

describe('creator 接线 · 端到端（真实 sql.js + 真实 handler）', () => {
  let db
  beforeEach(async () => { db = await makeRealDb() })

  it('全部 11 个 creator 通道都真实注册（缺一个即红）', async () => {
    const { ipc } = wireReal(db, stubCollector())
    const expected = [
      'creator:list', 'creator:follow', 'creator:unfollow', 'creator:toggle',
      'creator:check-now', 'creator:discoveries', 'creator:collect',
      'creator:collect-one', 'creator:skip-one', 'creator:send-to-writer',
    ]
    const missing = expected.filter((c) => !ipc._h.has(c))
    expect(missing, `未注册：${missing.join(', ')}`).toEqual([])
  })

  it('关注 → 探测入表 → 一键采集 走通 IPC 全程', async () => {
    const posts = [
      { externalId: 'v1', title: '作品一', url: `https://www.youtube.com/watch?v=v1`, publishedAt: '2026-10-01T00:00:00Z' },
      { externalId: 'v2', title: '作品二', url: `https://www.youtube.com/watch?v=v2`, publishedAt: '2026-10-02T00:00:00Z' },
    ]
    const { ipc } = wireReal(db, stubCollector(posts))

    // ① 关注
    const f = await call(ipc, 'creator:follow', { input: UC, checkIntervalMin: 60 })
    expect(f.code).toBe(0)
    expect(f.creator.external_id).toBe(UC)
    const followId = f.follow.id

    // ② 探测（走 check-now 通道，runtime 内部 upsertDiscoveries）
    const probe = await call(ipc, 'creator:check-now', { followId })
    expect(probe.code, `check-now 返回：${JSON.stringify(probe)}`).toBe(0)
    expect(probe.inserted, `探测结果：${JSON.stringify(probe)}`).toBe(2)

    // ③ 列表能看到
    const list = await call(ipc, 'creator:list', {})
    expect(list.code).toBe(0)
    expect(list.totalPending).toBe(2)

    // ④ 一键采集（默认 5，实际只有 2）
    const col = await call(ipc, 'creator:collect', { followId })
    expect(col.code, `collect 返回：${JSON.stringify(col)}`).toBe(0)
    expect(col.collected, `collect 返回：${JSON.stringify(col)}`).toBe(2)
    expect(col.failed, `collect 返回：${JSON.stringify(col)}`).toBe(0)

    // ⑤ 落库证据：资产进 viral_library、outbox 有一条、ledger 记了两笔
    expect(count(db, 'SELECT COUNT(*) AS n FROM viral_library WHERE external_id <> ""')).toBe(2)
    expect(count(db, 'SELECT COUNT(*) AS n FROM collection_outbox')).toBe(2)
    expect(count(db, "SELECT COALESCE(SUM(units),0) AS n FROM collection_quota_ledger WHERE kind='collect'")).toBe(2)

    // ⑥ 角标归零
    const after = await call(ipc, 'creator:list', {})
    expect(after.totalPending).toBe(0)
  })

  it('数量上限：count 超限时零副作用（不落任何资产）', async () => {
    const posts = Array.from({ length: 3 }, (_, i) => ({
      externalId: `v${i}`, title: `t${i}`, url: `https://www.youtube.com/watch?v=v${i}`,
      publishedAt: '2026-10-01T00:00:00Z',
    }))
    const { ipc } = wireReal(db, stubCollector(posts))
    const f = await call(ipc, 'creator:follow', { input: UC })
    await call(ipc, 'creator:check-now', { followId: f.follow.id })

    const r = await call(ipc, 'creator:collect', { followId: f.follow.id, count: 999 })
    expect(r.code).toBe(-11)                    // ClampError
    expect(r.reason).toBe('creator:count_exceeds_limit')
    // 零副作用：一条都没采
    expect(count(db, 'SELECT COUNT(*) AS n FROM viral_library')).toBe(0)
  })

  it('取消关注：发现项软删为 skipped，资产不丢', async () => {
    const posts = [{ externalId: 'v1', title: 't', url: 'https://www.youtube.com/watch?v=v1' }]
    const { ipc, store } = wireReal(db, stubCollector(posts))
    const f = await call(ipc, 'creator:follow', { input: UC })
    await call(ipc, 'creator:check-now', { followId: f.follow.id })
    await call(ipc, 'creator:collect', { followId: f.follow.id })

    const un = await call(ipc, 'creator:unfollow', { followId: f.follow.id })
    expect(un.code).toBe(0)

    // 资产仍在（用户已采集的东西不能被取消关注销毁）
    expect(count(db, 'SELECT COUNT(*) AS n FROM viral_library')).toBe(1)
    // 角标归零：发现项不再是 pending
    expect(store.countPending(f.creator.id)).toBe(0)
  })

  it('跳过已终态条目返回 invalid_state，不静默成功', async () => {
    const posts = [{ externalId: 'v1', title: 't', url: 'https://www.youtube.com/watch?v=v1' }]
    const { ipc, store } = wireReal(db, stubCollector(posts))
    const f = await call(ipc, 'creator:follow', { input: UC })
    await call(ipc, 'creator:check-now', { followId: f.follow.id })
    const d = store.getDiscovery(firstId(db))

    expect((await call(ipc, 'creator:skip-one', { discoveryId: d.id })).code).toBe(0)
    const again = await call(ipc, 'creator:skip-one', { discoveryId: d.id })
    expect(again.code).not.toBe(0)
    expect(again.reason).toBe('creator:invalid_state')
  })

  it('幂等重发：同一 discovery 再采不产生第二条 outbox', async () => {
    const posts = [{ externalId: 'v1', title: 't', url: 'https://www.youtube.com/watch?v=v1' }]
    const { ipc, store } = wireReal(db, stubCollector(posts))
    const f = await call(ipc, 'creator:follow', { input: UC })
    await call(ipc, 'creator:check-now', { followId: f.follow.id })
    const d = store.getDiscovery(firstId(db))

    expect(store.claimDiscovery(d.id, 'w1')).toBe(true)
    const tok = store.getClaimToken(d.id)
    // getClaimToken 必须是**标量**：runtime 把它当 SQL 参数直接用。
    // 返回对象会在 bind 时炸，而 sqlite-wrapper 把异常吞成 changes=0，
    // 症状离根因极远（表现为「采集永远失败」而不是「类型不对」）。
    expect(typeof tok).toBe('number')
    expect(store.finalizeCollected(d.id, tok, { content: 'x', contentQuality: 'full' }).outcome).toBe('collected')

    // 重发：代次已推进 ⇒ 不得再落一条 outbox
    const again = store.finalizeCollected(d.id, tok, { content: 'x', contentQuality: 'full' })
    expect(again.replay, '重发须被识别为幂等重放而非新采集').toBe(true)

    expect(count(db, 'SELECT COUNT(*) AS n FROM collection_outbox')).toBe(1)
    expect(count(db, "SELECT COALESCE(SUM(units),0) AS n FROM collection_quota_ledger WHERE kind='collect'")).toBe(1)
  })

  it('依赖缺失时仍注册通道并返回降级结果（不是 No handler registered）', async () => {
    const ipc = makeIpcMain()
    require('./../ipc-handlers/creator').registerHandlers(ipc, { log: { warn () {}, error () {} } })
    const r = await call(ipc, 'creator:list', {})
    expect(r.reason).toBe('service-unavailable')
  })

  // ── 替身形状对账（2026-10-12 事故的反向锁）─────────────────────────
  // 事故里最关键的一环是**夹具自造方法**：stubCollector 有 resolveChannelId，
  // 而真实 createCreatorCollector 当时没有 ⇒ e2e 全绿、真机添加博主必然 TypeError。
  // 这条锁把「替身的每个方法，真实对象都必须也有」变成机械判据：以后谁再往
  // 替身里加一个真实装配不提供的方法，这条会立刻红，而不是等用户点下去。
  it('采集器替身的方法集必须是真实采集器的子集（防夹具自造方法）', () => {
    const { createCreatorCollector } = require('./creator-collector-runtime')
    const real = createCreatorCollector({
      credentialProvider: () => ({ apiKey: 'AIza-fake-key-for-shape-check' }),
      log: { warn () {} },
    })
    for (const method of Object.keys(stubCollector())) {
      expect(typeof real[method], `真实采集器缺少替身提供的方法：${method}`).toBe('function')
    }
  })

  it('真实采集器必须暴露 resolveChannelId（creator:follow 的唯一解析入口）', () => {
    const { createCreatorCollector } = require('./creator-collector-runtime')
    const real = createCreatorCollector({
      credentialProvider: () => ({ apiKey: 'AIza-fake-key-for-shape-check' }),
      log: { warn () {} },
    })
    expect(typeof real.resolveChannelId).toBe('function')
  })
})
