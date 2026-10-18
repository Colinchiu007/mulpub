/**
 * guard-release — PublishIntervalGuard 的「释放域」mixin（fix-account-interval-ghost-wait 拆分）
 *
 * 从 publish-interval-guard.js 外移而来：该文件在时钟倒挂守卫追加后越过逐文件行数门禁的
 * 500 行新代码红线（496 → 523），按 task-queue-frequency.js 的既有 mixin 范式拆分，
 * 不是抬高登记值。挂载与导出见 publish-interval-guard.js 末尾的 Object.assign。
 *
 * 含三个方法：release（回滚未提交尝试）/ clearWindow（紧急放行清窗）/ _rollbackCap（回滚许可上限）。
 * 这些方法依赖实例字段（_store/_dailyStore/_key/_readDaily/_incrDaily/_intervals/_warn/today），
 * 故只能挂在 PublishIntervalGuard 原型上使用。
 */
const MAX_ROLLBACK_PER_DAY = 5
/** accountId 归一：模块加载后由 publish-interval-guard 回填（避免 require 环），运行期必然已就绪 */
let normalizeAccountId = null

/**
 * 窗口归属判据：**跨存储类型**的数值等价比较（唯一实现，禁止调用点各写一份）。
 *
 * 为什么不能用 `===`：桌面生产的 store 是 SQLite，`publish_timeline.last_publish_at`
 * 列声明为 TEXT（store-schema.js），sqlite-wrapper 的 `get()` 对该列读回的是**字符串**
 * （活库实测形如 `"1792241248768.0"`），而 `recordPublish()` 写入的是 **number**。
 * `"1792241248768.0" === 1792241248768` 恒为 false ⇒ `release()` 每次都判 `window_taken`
 * ⇒ P0-1「可确证未送出就回滚窗口」在生产里**从未生效过**。
 * 现场表现：一次视频发布里其他平台正常发布或排队 1–2 分钟，视频号（账号档 60 分钟）
 * 却显示「等待 59 分钟后重试（本账号间隔）」——而该视频号账号根本没发出过内容，
 * 那个 59 分钟来自 60 分钟前**一次登录失效的尝试**。
 *
 * 单测为什么全绿：夹具用内存 Map，写进去什么类型、读出来就是什么类型（number === number）。
 * 判据只在测试那一侧成立 —— 这是本仓反复登记过的「假夹具/夹具不对齐生产」同族逃逸。
 *
 * 归一方向必须**收窄**而不是放宽：只有能解析成有限数、且数值与 hold.at 相等，才算「是我的窗口」；
 * null / undefined / 非数字 / NaN / Infinity 一律 false（fail-closed），
 * 绝不把「读不懂」当成「可以回滚」——回滚错方向的代价是**早于窗口的重复发布**。
 *
 * @param {unknown} stored - store 读回值（生产是 string，内存夹具是 number，可能是 null）
 * @param {number} expected - `recordPublish()` 返回的 `hold.at`
 * @returns {boolean}
 */
function isSameWindow (stored, expected) {
  if (stored === null || stored === undefined) return false
  if (typeof expected !== 'number' || !Number.isFinite(expected)) return false
  const actual = Number(stored)
  return Number.isFinite(actual) && actual === expected
}

/** @param {(v: unknown) => string|null} fn 仅供宿主模块装载期回填，测试与业务不得调用 */
function __setNormalizeAccountId (fn) {
  normalizeAccountId = fn
}

module.exports = {
  __setNormalizeAccountId,

  /**
   * 回滚一次**未提交**尝试所占的窗口与配额（P0-1）。三条纪律任一不成立即 no-op，方向恒为「多等」：
   *   ① 乐观并发：仅当 store 读回的窗口**就是本次占位的那个**（见 `isSameWindow`，
   *      跨存储类型比较）才回滚该键 —— 绝不回滚他人窗口；
   *   ② hold 必须由 recordPublish() 返回并回传；缺失/错配 ⇒ no-op + 出声；
   *   ③ 防风上限：当日回滚次数 >= `_rollbackCap()` 时拒绝（该上限带硬顶，不随日配额放大）。
   * 副作用：配额计数幂等回补（下限 0）；回滚计数只增不减。
   * @returns {{released: boolean, reason: (null|'prev_missing'|'window_taken'|'rollback_cap')}}
   */
  release (platform, accountId, hold) {
    const dayKey = this.today()
    const normalizedAccount = normalizeAccountId(accountId)
    const accountKey = normalizedAccount ? this._key(platform, normalizedAccount) : null
    const platformKey = this._key(platform, null)

    if (!hold || typeof hold.at !== 'number') {
      this._warn('[PublishFrequency] release 缺少 recordPublish 返回的 hold，已忽略（窗口保持占用）')
      return { released: false, reason: 'prev_missing' }
    }

    // ③ 防风上限（回滚计数只增不减）
    if (accountKey && this._dailyStore) {
      const cap = this._rollbackCap(platform)
      const row = this._readDaily(accountKey, dayKey)
      if (cap > 0 && row.rollbackCount >= cap) {
        this._warn(
          `[PublishFrequency] 账号 ${accountKey} 当日回滚已达上限 ${cap}，本次不回滚（窗口保持占用）`
        )
        return { released: false, reason: 'rollback_cap' }
      }
    }

    let released = false

    // ① 账号键（类型归一：生产 store 读回字符串，see isSameWindow）
    if (accountKey && hold.accountKey === accountKey) {
      if (isSameWindow(this._store.get(accountKey), hold.at)) {
        this._store.set(accountKey, hold.accountPrev ?? null)
        released = true
      }
    }

    // ① 平台键（独立判定：可能已被后续提交覆盖）
    if (isSameWindow(this._store.get(platformKey), hold.at)) {
      this._store.set(platformKey, hold.platformPrev ?? null)
      released = true
    }

    if (!released) {
      return { released: false, reason: 'window_taken' }
    }

    // ② 配额回补（幂等：只在真正回滚后执行）+ 回滚计数只增
    if (accountKey && this._dailyStore) {
      this._incrDaily(accountKey, dayKey, 'count', -1)
      this._incrDaily(accountKey, dayKey, 'rollback_count', 1)
    }

    return { released: true, reason: null }
  },

  /**
   * 人为清空某平台当前占用的间隔窗口（**紧急放行专用**，唯一调用方是 task-queue 的
   * emergencyRelease，且必须已经过每日上限 + 冷却 + 审计三道闸）。
   *
   * ⚠️ 副作用范围：会同时清掉**平台键**（`platform:*`），即该平台**其他账号**的跨账号
   * 保护也会随之失效一次。这是刻意的：只清账号键的话，平台键仍会把本次紧急放行挡住，
   * 功能等于没实现。代价由「每账号每日 1 次 + 冷却 + 追加式审计」共同约束。
   *
   * @param {string} platform
   * @param {string} [accountId]
   * @returns {{cleared: boolean, clearedKeys: string[]}}
   */
  clearWindow (platform, accountId) {
    const normalizedAccount = normalizeAccountId(accountId)
    const accountKey = normalizedAccount ? this._key(platform, normalizedAccount) : null
    const platformKey = this._key(platform, null)
    const clearedKeys = []

    if (accountKey && this._store.get(accountKey) != null) {
      this._store.set(accountKey, null)
      clearedKeys.push(accountKey)
    }
    if (this._store.get(platformKey) != null) {
      this._store.set(platformKey, null)
      clearedKeys.push(platformKey)
    }

    return { cleared: clearedKeys.length > 0, clearedKeys }
  },

  /** 回滚许可上限：`max(2, …)` 让低配额平台至少纠错两次，`min(…, 硬顶)` 让日配额被放大时
   *  许可数不跟着放大（方向恒为"多等"）；`dailyMax=0` 时结果仍是 2。 */
  _rollbackCap (platform) {
    const { accountDailyMax } = this._intervals(platform)
    return Math.min(Math.max(2, accountDailyMax), MAX_ROLLBACK_PER_DAY)
  },
}
