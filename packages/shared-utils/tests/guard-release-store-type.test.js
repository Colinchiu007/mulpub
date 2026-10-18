/**
 * Test: guard-release 的「窗口归属」判据必须跨存储类型成立
 * （fix-release-window-taken-type-mismatch）
 *
 * 背景（用户现场）：一次视频发布里，其他平台正常发布或排队 1–2 分钟，
 * 视频号却显示「等待 59 分钟后重试（本账号间隔）」——而该视频号账号
 * 短期内并未发布过任何内容。
 *
 * 根因：`release()` 的乐观并发判据是 `store.get(key) === hold.at`（严格相等）。
 * 桌面生产的 store 是 SQLite（`publish_timeline.last_publish_at` 列声明为 **TEXT**，
 * 见 store-schema.js），sqlite-wrapper 的 `statement.get()` 对该列返回 **string**
 * （活库实测读数形如 `"1792241248768.0"`），而 `recordPublish()` 落库的是 **number**
 * ⇒ 严格相等恒为 false ⇒ 每次「未提交失败」都判 `window_taken` ⇒ 窗口永不被回滚
 * ⇒ 60 分钟的账号档把下一次提交挡成「等待 59 分钟后重试」。
 * 单元测试之所以全绿：夹具用的是内存 Map，写进去的是什么类型、读出来就是什么类型
 * （number === number）——测试环境与生产环境的**存储类型**不同，判据只在其中一侧成立。
 *
 * 判据（learnings pitfall:release-window-taken-strict-eq-across-store-type）：
 * 任何「写入值 ≡ 读回值」的乐观并发判据，必须显式跨**存储类型漂移**测试
 * （number 写入 / string 读回 / 带小数尾缀），且必须覆盖两侧的 fail-closed 语义
 * （不是只测「相等时能回滚」这一侧）。
 */

const PublishIntervalGuard = require('../src/publish-interval-guard')

const MIN_INTERVAL = 60 * 60 * 1000 // 视频号 60 分钟（v5 逐平台表）
const T0 = 1_700_000_000_000

/** 桌面生产同形 store：列是 TEXT ⇒ 读回字符串（含 sqlite 的 '.0' 尾缀）
 *  ⚠️ 夹具必须**连 NULL 语义一起对齐**：TEXT 列存 NULL 时 sqlite 读回的是 `null`，
 *  不是 `'null'`。早一版夹具写成 `String(map.get(k))`，回滚写入 null 后被读成字符串
 *  `'null'` ⇒ Number('null')=NaN ⇒ 被判成时钟异常 ⇒ 用例假红。
 *  这类「夹具与生产语义不一致」正是本文件要防的同族问题，故在此显式登记。 */
function makeTextStore () {
  const map = new Map()
  return {
    _map: map,
    get: (k) => {
      if (!map.has(k)) return null
      const v = map.get(k)
      return v === null || v === undefined ? null : String(v)
    },
    set: (k, v) => { map.set(k, v) },
  }
}

function makeGuard ({ store, now = () => T0, warn, ...rest } = {}) {
  return new PublishIntervalGuard({
    minInterval: MIN_INTERVAL,
    jitterRatio: 0,
    store: store || (() => {
      const map = new Map()
      return { get: (k) => (map.has(k) ? map.get(k) : null), set: (k, v) => { map.set(k, v) } }
    })(),
    now,
    warn: warn || (() => {}),
    ...rest,
  })
}

describe('guard-release 窗口归属判据跨存储类型（fix-release-window-taken-type-mismatch）', () => {
  test('R1 TEXT 列 store：number 写入 / string 读回 ⇒ release 必须真的回滚', () => {
    const store = makeTextStore()
    const guard = makeGuard({ store })
    const hold = guard.recordPublish('tencent_video', 'b1e05ac2')

    // 先证明夹具确实复现了生产的类型漂移（否则本用例是空转）
    expect(typeof store.get('tencent_video:b1e05ac2')).toBe('string')
    expect(store.get('tencent_video:b1e05ac2')).not.toBe(hold.at)

    const res = guard.release('tencent_video', 'b1e05ac2', hold)
    expect(res.released).toBe(true)
    expect(guard.check('tencent_video', 'b1e05ac2').remainingMs).toBe(0)
  })

  test('R2 sqlite 的 ".0" 小数尾缀同样必须回滚（活库实测读数形态）', () => {
    const store = makeTextStore()
    const guard = makeGuard({ store })
    const hold = guard.recordPublish('tencent_video', 'acc1')
    // 真实读数形态：TEXT 列经 sqlite-wrapper 读回带尾缀（见 shared-user-data 活库取证）
    store.set('tencent_video:acc1', String(hold.at) + '.0')

    const res = guard.release('tencent_video', 'acc1', hold)
    expect(res.released).toBe(true)
    expect(guard.check('tencent_video', 'acc1').remainingMs).toBe(0)
  })

  test('R3 内存 store（number 读回）行为不回退', () => {
    const guard = makeGuard()
    const hold = guard.recordPublish('tencent_video', 'acc1')
    const res = guard.release('tencent_video', 'acc1', hold)
    expect(res.released).toBe(true)
  })

  test('R4 账号键确被他人覆盖时该键必须 fail-closed（不得回滚他人窗口）', () => {
    const store = makeTextStore()
    const guard = makeGuard({ store })
    const hold = guard.recordPublish('tencent_video', 'acc1')
    // 后续一次真实提交覆盖了**账号键**（时间戳不同）
    const later = hold.at + 10 * 60 * 1000
    store.set('tencent_video:acc1', String(later))

    const res = guard.release('tencent_video', 'acc1', hold)
    // 账号键不是我的 ⇒ 不回滚；平台键仍是我的 ⇒ 平台键正常回滚 ⇒ released 为真
    expect(res.released).toBe(true)
    expect(store.get('tencent_video:acc1')).toBe(String(later)) // 覆盖者窗口不得被吞
    expect(store.get('tencent_video:*')).toBe(null) // 平台键已被回滚
  })

  test('R4b 账号键与平台键都被他人覆盖 ⇒ window_taken（整体 no-op）', () => {
    const store = makeTextStore()
    const guard = makeGuard({ store })
    const hold = guard.recordPublish('tencent_video', 'acc1')
    const later = hold.at + 10 * 60 * 1000
    store.set('tencent_video:acc1', String(later))
    store.set('tencent_video:*', String(later))

    const res = guard.release('tencent_video', 'acc1', hold)
    expect(res.released).toBe(false)
    expect(res.reason).toBe('window_taken')
    // 覆盖者窗口一个都不得被回滚掉
    expect(store.get('tencent_video:acc1')).toBe(String(later))
    expect(store.get('tencent_video:*')).toBe(String(later))
  })

  test('R5 账号键与平台键分别判定：只覆盖平台键时账号键仍回滚', () => {
    const store = makeTextStore()
    const guard = makeGuard({ store })
    const hold = guard.recordPublish('tencent_video', 'acc1')
    store.set('tencent_video:*', String(hold.at + 5000))

    const res = guard.release('tencent_video', 'acc1', hold)
    expect(res.released).toBe(true)
    expect(store.get('tencent_video:acc1')).toBe(null)
    expect(store.get('tencent_video:*')).toBe(String(hold.at + 5000))
  })

  test('R6 回滚后账号键还原为占位前值（而非 null），不吞掉更早的窗口', () => {
    const store = makeTextStore()
    const guard = makeGuard({ store })
    // 先有一次更早的发布（占住账号键）
    const earlier = T0 - MIN_INTERVAL - 60_000
    guard.recordPublish('tencent_video', 'acc1', earlier)
    const hold = guard.recordPublish('tencent_video', 'acc1', T0)

    const res = guard.release('tencent_video', 'acc1', hold)
    expect(res.released).toBe(true)
    expect(Number(store.get('tencent_video:acc1'))).toBe(earlier)
  })

  test('R7 日配额回补与回滚计数仍生效（不被类型判据吞掉）', () => {
    const store = makeTextStore()
    const daily = new Map()
    const dailyStore = {
      getDay: (k, d) => daily.get(k + '|' + d) || { count: 0, rollback_count: 0 },
      incrDay: (k, d, field, delta) => {
        const row = daily.get(k + '|' + d) || { count: 0, rollback_count: 0 }
        const name = field === 'rollback_count' ? 'rollback_count' : 'count'
        row[name] = Math.max(0, row[name] + delta)
        daily.set(k + '|' + d, row)
        return row[name]
      },
      decrDay: (k, d, field) => dailyStore.incrDay(k, d, field, -1),
    }
    const guard = makeGuard({ store, dailyStore })
    guard.recordPublish('tencent_video', 'acc1')
    expect(dailyStore.getDay('tencent_video:acc1', guard.today()).count).toBe(1)

    // 再 record 一次（模拟重试轮），hold 取第二次的返回（生产里 hold 恒来自 recordPublish）
    const fresh = guard.recordPublish('tencent_video', 'acc1', T0)
    expect(dailyStore.getDay('tencent_video:acc1', guard.today()).count).toBe(2)
    const res = guard.release('tencent_video', 'acc1', fresh)
    expect(res.released).toBe(true)
    // 配额幂等回补一次（2 → 1），回滚计数只增
    expect(dailyStore.getDay('tencent_video:acc1', guard.today()).count).toBe(1)
    expect(dailyStore.getDay('tencent_video:acc1', guard.today()).rollback_count).toBe(1)
  })

  test('R8 缺少 hold 仍 fail-closed（prev_missing），不因类型判据放宽', () => {
    const store = makeTextStore()
    const guard = makeGuard({ store })
    guard.recordPublish('tencent_video', 'acc1')
    const res = guard.release('tencent_video', 'acc1', null)
    expect(res.released).toBe(false)
    expect(res.reason).toBe('prev_missing')
  })
})
