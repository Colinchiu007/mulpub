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

/** @param {(v: unknown) => string|null} fn 仅供宿主模块装载期回填，测试与业务不得调用 */
function __setNormalizeAccountId (fn) {
  normalizeAccountId = fn
}

module.exports = {
  __setNormalizeAccountId,

  /**
   * 回滚一次**未提交**尝试所占的窗口与配额（P0-1）。三条纪律任一不成立即 no-op，方向恒为「多等」：
   *   ① 乐观并发：仅当 store.get(key) === hold.at 才回滚该键 —— 绝不回滚他人窗口；
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

    // ① 账号键
    if (accountKey && hold.accountKey === accountKey) {
      if (this._store.get(accountKey) === hold.at) {
        this._store.set(accountKey, hold.accountPrev ?? null)
        released = true
      }
    }

    // ① 平台键（独立判定：可能已被后续提交覆盖）
    if (this._store.get(platformKey) === hold.at) {
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
