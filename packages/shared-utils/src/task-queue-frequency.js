/**
 * task-queue-frequency — 发布频率相关的队列方法 mixin（publish-frequency-policy-v2 → v3）
 *
 * 从 task-queue.js 外移而来：该文件被本次变更从 576 行推到 897 行，触到逐文件行数门禁的
 * 「挂账文件膨胀超容差」（growthAllowance=200 ⇒ 上限 776）。门禁给的正解是拆分，
 * 故按本仓既有 mixin 范式（store/*-store.js 用 Object.assign 挂到 Store.prototype）
 * 把这些方法挂到 TaskQueue.prototype，**不是**把门禁调宽。
 *
 * 含三组能力：
 *   ① 传输层打点：markSubmitAttempted / markSubmitted（阶段判据的来源）
 *   ② 探针与降级：getProbeCounts / clearRollbackDisabled / _disableRollbackForPlatform
 *   ③ 未提交失败回滚与紧急放行：_maybeRollback / _delayRequeue / emergencyRelease
 *
 * ⚠️ 这些方法依赖 TaskQueue 实例上的字段（_publishIntervalGuard / _running / _probeCounts /
 * _missingWiringCounts / _platformsProvenSubmit / _rollbackDisabledPlatforms / _delayed /
 * _quotaBlocked / _queue / _pendingTimers），故**只能**挂在 TaskQueue 原型上使用。
 */
const PublishIntervalGuard = require('./publish-interval-guard')

module.exports = {  /**
   * 传输层打点①：即将发起**首次**平台写尝试。
   *
   * 必须由真正发出平台请求的那一层调用（rpa-view-manager / publisher-router），
   * **不是**由抛出错误的那一层声明 —— 否则「免等重试」的获益方可以自行伪造。
   * @param {string} taskId
   */
  markSubmitAttempted (taskId) {
    const task = this._running.get(taskId)
    if (task) task.submitAttempted = true
  },

  /**
   * 传输层打点②：平台**已确认发出**（收到响应或等价确认）。
   *
   * 与 `markSubmitAttempted` 的区别：前者只证明「我们试过」，后者证明「确实送出去了」。
   * 只有两者都为空时才可能回滚（P0-1）；只调用过①的失败一律占窗口。
   * @param {string} taskId
   */
  markSubmitted (taskId) {
    const task = this._running.get(taskId)
    if (task) {
      task.submitAttempted = true
      task.submittedAt = Date.now()
    }
  },

  /** 探针计数（供设置页 / 诊断读取；不参与判定） */
  getProbeCounts () {
    return {
      ...this._probeCounts,
      missingWiring: Object.fromEntries(this._missingWiringCounts),
      rollbackDisabledPlatforms: [...this._rollbackDisabledPlatforms],
    }
  },

  _releaseGraceMs () {
    const g = this._publishIntervalGuard
    const ms = g && Number.isFinite(g.releaseGraceMs) ? g.releaseGraceMs : 60 * 1000
    return Math.max(10000, ms)
  },

  _disableRollbackForPlatform (platform, reason) {
    if (this._rollbackDisabledPlatforms.has(platform)) return
    this._rollbackDisabledPlatforms.add(platform)
    this._probeCounts.rollbackDisabled += 1
    console.error(
      `[task-queue] 已对平台 ${platform} 停用「未提交失败回滚」（${reason}）：`
      + '宁可多等一个窗口，也不冒早于窗口重复发布的风险。重启或用户在设置页确认后解除'
    )
  },

  /** 用户手动清除「停用回滚」标记（设置页「我确认该平台接线正常」） */
  clearRollbackDisabled (platform) {
    if (platform === undefined) this._rollbackDisabledPlatforms.clear()
    else this._rollbackDisabledPlatforms.delete(platform)
  },

  /**
   * 紧急放行（P2-2）：跳过该 (platform, accountId) 当前的等待窗口，立即重新入队。
   *
   * ⚠️ 本方法**只负责机制**（找等待任务 → 取消防守定时器 → 清窗 → 重新入队 → 广播）。
   * 每日上限、冷却、审计由调用方（IPC 层）在调用**之前**判定并落盘 —— 那些是策略与合规，
   * 混进来会让本方法无法在无 store 的环境（测试 / headless）复用。
   *
   * 三类结果都必须如实回报，不得静默：
   *   { ok:false, code:'no_guard' }          注入缺失
   *   { ok:false, code:'no_waiting_window' } 当前没有等待中的窗口
   *   { ok:true,  taskId, clearedKeys }      成功
   *
   * @param {string} platform
   * @param {string|null} [accountId]
   * @param {{operator?: string, reason?: string}} [opts]
   */
  emergencyRelease (platform, accountId, opts = {}) {
    const guard = this._publishIntervalGuard
    if (!guard) return { ok: false, code: 'no_guard' }
    const normalize = typeof PublishIntervalGuard.normalizeAccountId === 'function'
      ? PublishIntervalGuard.normalizeAccountId
      : (v) => (typeof v === 'string' && v.trim() ? v.trim() : null)
    const normAccount = normalize(accountId)

    // _delayed 同时承载「等间隔」与「等次日配额」两类等待，两者都应可被紧急放行
    let target = null
    for (const entry of this._delayed.values()) {
      if (entry.task.platform === platform && normalize(entry.task.accountId) === normAccount) {
        target = entry
        break
      }
    }
    if (!target) return { ok: false, code: 'no_waiting_window' }

    if (target.timer) {
      clearTimeout(target.timer)
      this._pendingTimers.delete(target.timer)
    }
    this._delayed.delete(target.task.id)
    this._quotaBlocked.delete(target.task.id)

    const cleared = guard.clearWindow(platform, normAccount)
    if (!this._queue.includes(target.task)) this._queue.unshift(target.task)
    this._processNext()

    const detail = {
      task: target.task,
      platform,
      accountId: normAccount,
      clearedKeys: cleared.clearedKeys,
      operator: opts.operator || null,
      reason: opts.reason || null,
      at: Date.now(),
    }
    this.emit('publish:emergencyReleased', detail)
    return { ok: true, taskId: target.task.id, clearedKeys: cleared.clearedKeys }
  },

  /**
   * P0-1 回滚判定与执行。返回是否真正回滚（供重试退避与事件使用）。
   *
   * @param {object} task
   * @param {Error & {notSubmitted?: boolean, definitelyNotSent?: boolean}} e
   * @param {{inFlightAtFailure?: boolean}} [ctx] — 调用方如实告知"失败发生时请求是否仍在飞"
   * @returns {boolean}
   */
  _maybeRollback (task, e, ctx = {}) {
    const guard = this._publishIntervalGuard
    if (!guard || !task._hold) return false

    // ── D1（v3）：在飞未知 ⇒ 终身禁止回滚 ──
    // race 输给超时/中止而执行器尚未收敛：我们**不知道**请求是否已送出，而
    // "未打点"在此刻不构成"未发起"的证据（markSubmitAttempted 按 _running 查任务，
    // 超时后 finally 已删除该键 ⇒ 迟到的打点永久落空）。方向恒为多等。
    // 一旦置位就不再复位：重试轮的 recordPublish 会覆盖 _hold，此时若允许回滚，
    // 还原的是"上一轮仍在飞的那次提交之前"的窗口 —— 比不滚更糟。
    if (ctx.inFlightAtFailure === true) {
      if (!task.submitUncertain) {
        task.submitUncertain = true
        this._probeCounts.inflightUnknown += 1
        console.warn(
          `[task-queue] 平台 ${task.platform} 的任务 ${task.id} 在**请求可能仍在飞**时失败`
          + '（超时/中止竞态输掉）：频控窗口保持占用，本任务此后不再回滚窗口'
        )
      }
      return false
    }
    if (task.submitUncertain === true) return false  // 故意排在所有旧判据**之前**（QM-6 B16）：
    // 终身锁一旦置位，后续轮次即使带 definitelyNotSent 也不回滚 —— 第二轮的 recordPublish 已覆盖
    // _hold，此时回滚还原的是「第一轮仍在飞那次提交之前」的窗口，比不回滚更危险。
    // 调序前请先读 PRD §5.1；两条分支各有锁（M1/M3 各红一条）。

    const platform = task.platform
    const attempted = task.submitAttempted === true
    const definitelyNotSent = e && e.definitelyNotSent === true
    const hinted = e && e.notSubmitted === true

    // 阶段判据：只有「从未发起写尝试」或「传输层确证未送出」才可回滚
    let rollbackable = !attempted || definitelyNotSent

    // 佐证位不得与阶段判据矛盾：说「未提交」但阶段标记说已尝试且未确证 ⇒ fail-closed
    if (hinted && !rollbackable) {
      this._probeCounts.releaseFailed += 1
      console.error(
        `[task-queue] 平台 ${platform} 的错误同时带 notSubmitted=true 与已发起的提交尝试，`
        + '判定为**已提交**（占窗口）：佐证位与阶段判据矛盾时一律取更保守的一侧'
      )
      rollbackable = false
    }

    // 失败路径接线探针：**只统计「既未发起尝试、也不属于词表确认未送出」的失败**。
    // ⚠️ 必须排除 definitelyNotSent（评审 i1 Critical 实测抓出）：发布器在**登录态早退**处
    // 主动打标 definitelyNotSent=true 的失败是**合法的未提交**，不是接线缺陷。若不排除，
    // 平台只要有过一次成功发布（_platformsProvenSubmit 命中），第一次登录失效就会被判成
    // 「接线矛盾」⇒ 永久停用该平台回滚 ⇒ P0-1 对最该生效的场景自毁。
    if (!attempted && !definitelyNotSent) {
      const n = (this._missingWiringCounts.get(platform) || 0) + 1
      this._missingWiringCounts.set(platform, n)
      if (this._platformsProvenSubmit.has(platform)) {
        this._disableRollbackForPlatform(platform, 'failure_without_submit_attempt_on_proven_platform')
        rollbackable = false
      }
    }

    if (this._rollbackDisabledPlatforms.has(platform)) rollbackable = false
    if (!rollbackable) return false

    const res = guard.release(platform, task.accountId, task._hold)
    if (!res || !res.released) {
      this._probeCounts.releaseFailed += 1
      return false
    }

    task._hold = null
    task.lastAttemptNotSubmitted = true
    task.lastAttemptAt = Date.now()
    this.emit('publish:released', {
      task,
      platform,
      accountId: task.accountId ?? null,
      reason: 'not_submitted',
      graceMs: this._releaseGraceMs(),
    })
    return true
  },

  /**
   * 回滚后的最小退避重排（任务重新入队头，但延后 graceMs 执行）。
   *
   * v3：退避期间任务必须**仍登记在 `_delayed`**。此前它只活在 setTimeout 的闭包里，
   * 于是 `getStatus()` / `getPendingTasks()` / `serialize()` 在整个 grace 期（默认 60s）
   * 都看不见这条任务 —— 重启即静默丢失，UI 上"排队中"凭空少一条。
   * `_delayed` 正是 2026-10-06 为"频控等待中的任务"定的承载处，两种等待同源登记。
   */
  _delayRequeue (task, ms) {
    const timer = setTimeout(() => {
      this._pendingTimers.delete(timer)
      this._delayed.delete(task.id)
      if (task.cancelRequested || task.status === 'cancelled') return
      this._queue.unshift(task)
      this._processNext()
    }, ms)
    if (timer && timer.unref) timer.unref()
    this._pendingTimers.add(timer)
    this._delayed.set(task.id, { task, timer })
    this._saveState()
  }
}