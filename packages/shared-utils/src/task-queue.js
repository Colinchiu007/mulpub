/**
 * 任务队列 — 顺序执行 + 重试 + 超时
 *
 * 支持：
 * - 先进先出顺序执行
 * - 每个任务独立超时控制
 * - 失败自动重试 (可配置次数)
 * - 进度事件通知
 */
const EventEmitter = require('events')
// 紧急放行需要与守卫**同一份** accountId 归一判据（否则「设置页传 abc」与「任务里存 abc 」
// 在归一后不等，会找不到等待中的任务却报 no_waiting_window）。守卫只用 publish-frequency-policy，
// 不反向依赖本模块，无循环依赖。
const PublishIntervalGuard = require('./publish-interval-guard')
// R14：持久化快照（待派发 / running / delayed）的字段取舍统一到一处，
// 见 task-projection.js 头注释（publishTime 曾在三份手抄白名单里全部缺席）。
const { projectTask } = require('./task-projection')

function normalizeOwnerSubject (ownerSubject) {
  if (typeof ownerSubject !== 'string' || !ownerSubject.trim()) {
    throw new Error('任务队列无法识别当前用户')
  }
  return ownerSubject.trim()
}

/**
 * MP_QUEUE_MAX_CONCURRENT 环境变量解析（publish-throughput-optimization B 方案）。
 * 合法域 [1,10]，默认 3；非法/越界回落默认并出声告警（对齐 publish-frequency-policy 的覆盖纪律）。
 * @returns {number}
 */
function resolveQueueMaxConcurrent () {
  const DEFAULT = 3
  const raw = process.env.MP_QUEUE_MAX_CONCURRENT
  if (raw === undefined || raw === '') return DEFAULT
  const n = Number(raw)
  if (!Number.isInteger(n) || n < 1 || n > 10) {
    console.warn('[task-queue] MP_QUEUE_MAX_CONCURRENT 非法值 ' + JSON.stringify(raw) + '，回落默认 ' + DEFAULT + '（合法域 [1,10]）')
    return DEFAULT
  }
  return n
}

class TaskQueue extends EventEmitter {
  constructor (options = {}) {
    super()
    this.maxConcurrent = options.maxConcurrent || 1
    this.defaultRetry = options.defaultRetry ?? 2
    this.defaultTimeout = options.defaultTimeout ?? 180000  // 3 min
    this._publishIntervalGuard = options.publishIntervalGuard || null
    this._queue = []          // 等待队列
    this._running = new Map() // 正在执行的任务 { id -> task }
    this._history = []        // 已完成的任务历史
    this._pendingTimers = new Set()  // R28/R37：跟踪频率控制重排定时器，shutdown 时清理
    this._delayed = new Map() // 频控等待任务 { id -> { task, timer } }
    // ── publish-frequency-policy-v2 ──────────────────────────────────────────
    // 日配额被拒的任务单独成集：它们不是「等一会儿」而是「今天到此为止」，
    // _processNext 必须跳过，否则会立刻重新取到同一任务形成紧循环。
    this._quotaBlocked = new Set()
    // 已证明「会调用 markSubmitted」的平台（由成功且 submittedAt 非空的发布累积）。
    // 用于失败路径的接线矛盾检测：若某平台既能证明会打点、又持续出现
    // 「从未发起提交尝试」的失败，则判为接线矛盾 ⇒ 对该平台停用回滚（fail-closed）。
    this._platformsProvenSubmit = new Set()
    this._rollbackDisabledPlatforms = new Set()
    this._missingWiringCounts = new Map()
    // 探针计数（供设置页/诊断读取）
    // v3：inflightUnknown = 「请求可能仍在飞时失败」的次数（缺陷 D1 的现场计数），
    // 与 rollbackDisabled/inflightUnknown 一起构成"这套 fail-closed 判据到底拦了多少次"的唯一现场。
    this._probeCounts = { successWithoutSubmittedAt: 0, releaseFailed: 0, rollbackDisabled: 0, inflightUnknown: 0 }
    this._abortControllers = new Map() // 运行中任务的协作式取消信号
    this._runningByChannel = new Map() // 通道键 -> 在跑计数（B 方案：同通道串行，跨通道并行）
    this._paused = false
    this._shutdown = false
    this._idCounter = 0
    this._ownerSubjectProvider = null
  }

  /**
   * R28/R37：清理所有待执行的频率控制重排定时器（应用退出时调用）
   */
  shutdown () {
    if (this._shutdown) return
    this._shutdown = true
    this._paused = true
    for (const t of this._pendingTimers) {
      clearTimeout(t)
    }
    this._pendingTimers.clear()
    for (const { task } of this._delayed.values()) this._markCancelled(task, true)
    this._delayed.clear()
    this._quotaBlocked.clear()
    for (const task of this._queue.splice(0)) this._markCancelled(task, true)
    for (const [taskId, task] of this._running) {
      this._markCancelled(task, false)
      const controller = this._abortControllers.get(taskId)
      if (controller && !controller.signal.aborted) controller.abort(new Error('任务队列已关闭'))
    }
  }

  /**
   * 注入登录用户解析器。身份模式下任务只能由当前用户创建、查看和执行；
   * 未注入时保留旧版单用户行为。
   */
  setOwnerSubjectProvider (provider) {
    if (provider !== null && provider !== undefined && typeof provider !== 'function') {
      throw new TypeError('owner subject provider must be a function or null')
    }
    this._ownerSubjectProvider = provider || null

    // 登录用户切换时停止正在执行的其他用户任务，避免旧凭据在新会话中继续发布。
    if (this._ownerSubjectProvider) {
      for (const [taskId, task] of this._running) {
        if (this._isTaskOwnedByCurrentUser(task)) continue
        this._markCancelled(task, false)
        const controller = this._abortControllers.get(taskId)
        if (controller && !controller.signal.aborted) controller.abort(new Error('登录用户已切换'))
      }
    }
    this._processNext()
  }

  _getCurrentOwnerSubject () {
    if (!this._ownerSubjectProvider) return undefined
    try {
      return normalizeOwnerSubject(this._ownerSubjectProvider())
    } catch (_) {
      // 登录态正在初始化、登出或失效时，查询接口不能把异常抛回渲染层；
      // 以 null 表示身份模式下暂时没有可用 owner，并由调用方 fail-closed。
      return null
    }
  }

  _isTaskOwnedByCurrentUser (task) {
    const ownerSubject = this._getCurrentOwnerSubject()
    if (ownerSubject === undefined) return true
    return Boolean(ownerSubject && task && task.owner_subject === ownerSubject)
  }

  _visibleTasks (tasks) {
    return tasks.filter(task => this._isTaskOwnedByCurrentUser(task))
  }

  /**
   * 添加发布任务
   * @param {object} task
   * @param {string} task.platform - 平台标识
   * @param {object} task.article - 文章数据
   * @param {number} [task.retry] - 重试次数
   * @param {number} [task.timeout] - 超时 (ms)
   * @returns {string} taskId
   */
  add (task) {
    const ownerSubject = this._getCurrentOwnerSubject()
    if (ownerSubject === null) throw new Error('任务队列无法识别当前用户')
    return this._add(task, ownerSubject)
  }

  /**
   * 供已完成身份校验的主进程异步服务使用。显式 owner 仍必须等于当前用户，
   * 从而阻止定时器、离线缓存和重试在用户切换后跨租户发布。
   */
  addForOwner (task, ownerSubject) {
    const normalizedOwner = normalizeOwnerSubject(ownerSubject)
    const currentOwner = this._getCurrentOwnerSubject()
    if (currentOwner === null) throw new Error('任务队列无法识别当前用户')
    if (currentOwner !== undefined && currentOwner !== normalizedOwner) {
      throw new Error('当前登录用户不匹配')
    }
    return this._add(task, normalizedOwner)
  }

  _add (task, ownerSubject) {
    if (this._shutdown) throw new Error('任务队列已关闭')
    const taskId = `task_${++this._idCounter}_${Date.now()}`
    // R14（2026-10-07 真机 E2E）：此处原先是**第四份**手抄字段清单，
    // publishTime 未在其中 ⇒ 平台侧定时意图在入队瞬间即被丢弃，
    // 下游所有「带定时就 fail-closed」的守卫都判定为「非定时」而永不触发。
    // 这是运行时**完整**条目（不是持久化投影），故显式构造；字段取舍规则
    // 见 task-projection.js —— 新增任务字段必须同时满足「这里」与「那里」。
    const entry = {
      id: taskId,
      platform: task.platform,
      article: task.article,
      owner_subject: ownerSubject,
      batchId: task.batchId || null,
      accountId: task.accountId ?? task.article?.accountId ?? null,
      // 发布模式（'scheduled'）与平台侧排期时间必须成对：
      // 前者只影响历史展示，后者才决定发布器会不会带定时字段。
      // 只保前者 ⇒ UI 显示「定时发布」而内容立即发出（R14 事故形态）。
      publishMode: task.publishMode || null,
      publishTime: task.publishTime ?? null,
      retry: task.retry ?? this.defaultRetry,
      timeout: task.timeout ?? this.defaultTimeout,
      status: 'pending',    // pending | running | success | failed | cancelled
      retriesLeft: task.retry ?? this.defaultRetry,
      createdAt: new Date().toISOString(),
      startedAt: null,
      completedAt: null,
      result: null,
      error: null,
      retryOf: task.retryOf || null,
      cancelRequested: false
    }

    this._queue.push(entry)
    this.emit('task:added', entry)
    this._saveState()
    this._processNext()

    return taskId
  }

  /**
   * 取消等待中的任务
   * @param {string} taskId
   * @returns {boolean} 是否成功取消
   */
  cancel (taskId) {
    const idx = this._queue.findIndex(t => t.id === taskId && this._isTaskOwnedByCurrentUser(t))
    if (idx === -1) {
      const delayed = this._delayed.get(taskId)
      if (delayed && this._isTaskOwnedByCurrentUser(delayed.task)) {
        clearTimeout(delayed.timer)
        this._pendingTimers.delete(delayed.timer)
        this._delayed.delete(taskId)
        this._markCancelled(delayed.task, true)
        return true
      }

      // 可能已经在执行中 — 标记为 cancelled，执行器通过 AbortSignal 协作中止
      const running = this._running.get(taskId)
      if (running && this._isTaskOwnedByCurrentUser(running)) {
        this._markCancelled(running, false)
        const controller = this._abortControllers.get(taskId)
        if (controller && !controller.signal.aborted) controller.abort(new Error('任务已取消'))
        return true
      }
      return false
    }
    const task = this._queue.splice(idx, 1)[0]
    this._markCancelled(task, true)
    return true
  }

  _markCancelled (task, addToHistory) {
    task.cancelRequested = true
    task.status = 'cancelled'
    task.completedAt = new Date().toISOString()
    if (addToHistory && !this._history.some(item => item.id === task.id)) this._history.push(task)
    this.emit('task:cancelled', task)
    this._saveState()
  }

  /**
   * 将失败任务以新任务 ID 重新加入队列。同一失败记录重复调用时返回
   * 第一次创建的任务 ID，避免双击造成重复发布。
   * @param {string} taskId
   * @returns {string | null}
   */
  retry (taskId) {
    const original = this._history.find(task => task.id === taskId && this._isTaskOwnedByCurrentUser(task))
    if (!original || original.status !== 'failed') return null
    if (original.retriedAs) return original.retriedAs

    const task = {
      platform: original.platform,
      article: original.article,
      batchId: original.batchId,
      accountId: original.accountId,
      retry: original.retry,
      timeout: original.timeout,
      retryOf: original.id
    }
    const retryTaskId = original.owner_subject === undefined
      ? this.add(task)
      : this.addForOwner(task, original.owner_subject)
    original.retriedAs = retryTaskId
    original.retriedAt = new Date().toISOString()
    this.emit('task:manual-retry', { original, taskId: retryTaskId })
    this._saveState()
    return retryTaskId
  }

  /**
   * 获取所有等待中的任务（用于持久化）
   */
  getPendingTasks () {
    const pending = [
      ...this._queue,
      ...Array.from(this._delayed.values(), entry => entry.task),
    ]
    // 字段清单见 task-projection.js（R14：publishTime 曾因三处手抄白名单而丢失）
    return this._visibleTasks(pending).map(t => projectTask(t))
  }

  /**
   * 序列化队列状态（用于崩溃恢复）
   */
  serialize () {
    return JSON.stringify({
      queue: this.getPendingTasks(),
      running: this._visibleTasks(Array.from(this._running.values())).map(t => projectTask(t, { startedAt: t.startedAt })),
      // 2026-10-06：频控等待中的任务（_delayed）必须进快照。
      // 它们既不在 _queue 也不在 _running，此前完全不在持久化范围内 ——
      // 进程重启/崩溃后这批任务静默消失，用户看到的是「发了一半就没了」。
      // 恢复到 queue 尾部（而非立刻派发）：原状态是「等频控窗口」，
      // 而频控窗口是持久化的（PublishIntervalGuard 走 store），重启后
      // 由 _processNext 的守卫检查重新判定该等还是该发。
      delayed: this._visibleTasks(Array.from(this._delayed.values()).map(d => d.task)).map(t => projectTask(t, { startedAt: t.startedAt }))
    })
  }

  /**
   * 从持久化状态恢复队列
   * @param {string} jsonStr
   * @returns {number} 恢复的任务数
   */
  deserialize (jsonStr) {
    if (!jsonStr) return 0
    try {
      const state = JSON.parse(jsonStr)
      if (!state || typeof state !== 'object' || Array.isArray(state)) return 0
      const currentOwner = this._getCurrentOwnerSubject()
      if (currentOwner === null) return 0
      const restoreEntry = (task, message) => {
        if (!task || typeof task !== 'object' || Array.isArray(task) ||
          typeof task.id !== 'string' || !task.id ||
          typeof task.platform !== 'string' || !task.platform.trim() ||
          !task.article || typeof task.article !== 'object' || Array.isArray(task.article)) {
          return false
        }
        if (this._queue.some(entry => entry.id === task.id) || this._running.has(task.id)) return false

        const persistedOwner = task.owner_subject
        let ownerSubject
        if (currentOwner === undefined) {
          // 未启用身份服务的旧模式只能恢复旧快照，不能接管用户隔离模式写入的任务。
          if (persistedOwner !== undefined && persistedOwner !== null) return false
          ownerSubject = undefined
        } else {
          // 旧版无 owner 快照没有可信归属，不能在任意登录用户下重新发布。
          if (persistedOwner !== currentOwner) return false
          ownerSubject = currentOwner
        }
        this._queue.push({
          ...task,
          owner_subject: ownerSubject,
          batchId: task.batchId || null,
          accountId: task.accountId ?? task.article?.accountId ?? null,
          status: 'pending',
          startedAt: null,
          completedAt: null,
          result: null,
          error: message || null
        })
        return true
      }
      let count = 0
      // 恢复等待中的任务
      if (Array.isArray(state.queue)) {
        for (const t of state.queue) {
          if (restoreEntry(t)) count++
        }
      }
      // 恢复运行中被中断的任务 — 重新加入队列尾部重试
      if (Array.isArray(state.running)) {
        for (const t of state.running) {
          if (restoreEntry({ ...t, retriesLeft: Math.max(t.retriesLeft, 1) }, '进程中断恢复')) count++
        }
      }
      // 2026-10-06：恢复频控等待中的任务。它们的定时器随进程一并消失，
      // 不重排就永远等不到「窗口到期」那一刻 —— 直接回 _queue，由
      // _processNext 的频控检查重新判定：窗口已过则立即发，未到则再次
      // 进 _delayed 重新计时（等价于原语义的跨进程延续，而非丢任务）。
      if (Array.isArray(state.delayed)) {
        for (const t of state.delayed) {
          if (restoreEntry(t, '频控等待恢复')) count++
        }
      }
      if (count > 0) this._processNext()
      return count
    } catch (e) {
      return 0
    }
  }

  /**
   * 添加批量任务 (多平台)
   * @param {string[]} platforms
   * @param {object} article
   * @returns {string[]} taskIds
   */
  addBatch (platforms, article) {
    return platforms.map(p => this.add({ platform: p, article }))
  }

  /**
   * 获取队列状态
   *
   * 2026-10-06：pending 必须**含频控等待中的任务（_delayed）**。
   * 频控未到窗口时任务被移出 _queue 放进 _delayed，若这里只数 _queue，
   * 就会出现「pending=0 & running=0 但队列并未排空」的观测盲区 ——
   * 真实 E2E 里 21 个发布任务只有 5 个执行，其余卡在频控等待却被
   * 报告成「队列已空」，排障无从下手。故 pending = _queue + _delayed，
   * 并单列 delayed 便于 UI 区分「排队中」与「等频控窗口中」。
   */
  getStatus () {
    const isVisible = task => this._isTaskOwnedByCurrentUser(task)
    const delayed = Array.from(this._delayed.values()).filter(d => isVisible(d.task))
    return {
      pending: this._queue.filter(isVisible).length + delayed.length,
      running: Array.from(this._running.values()).filter(isVisible).length,
      delayed: delayed.length,
      history: this._history.filter(isVisible).length,
      paused: this._paused
    }
  }

  /**
   * 获取所有历史记录
   */
  getHistory () {
    return this._visibleTasks(this._history)
  }

  /**
   * 暂停队列
   */
  pause () {
    this._paused = true
    this.emit('queue:paused')
  }

  /**
   * 恢复队列
   */
  resume () {
    if (this._shutdown) return
    this._paused = false
    this.emit('queue:resumed')
    this._processNext()
  }

  /**
   * 清空等待队列 (不中断运行中的任务)
   */
  clearPending () {
    const ownerSubject = this._getCurrentOwnerSubject()
    if (ownerSubject === null) return 0
    const isOwned = task => ownerSubject === undefined || Boolean(task && task.owner_subject === ownerSubject)
    const removed = this._queue.filter(isOwned)
    this._queue = this._queue.filter(task => !isOwned(task))
    for (const [taskId, delayed] of this._delayed) {
      if (!isOwned(delayed.task)) continue
      clearTimeout(delayed.timer)
      this._pendingTimers.delete(delayed.timer)
      this._delayed.delete(taskId)
      removed.push(delayed.task)
    }
    if (removed.length > 0) {
      this.emit('queue:cleared', removed)
      this._saveState()
    }
    return removed.length
  }

  // ─── 内部方法 ─────────────────────────────

  /**
   * 持久化当前队列状态（由外部注册存储回调）
   */
  _saveState () {
    if (this._stateSaver) {
      try { this._stateSaver(this.serialize()) } catch (e) { /* ignore */ }
    }
  }

  /**
   * 注册状态持久化回调
   * @param {Function} fn - (jsonStr) => void
   */
  setStateSaver (fn) {
    this._stateSaver = fn
  }

  _processNext () {
    if (this._paused) return
    let inspected = this._queue.length
    while (this._running.size < this.maxConcurrent && this._queue.length > 0 && inspected > 0) {
      const task = this._queue.shift()
      inspected -= 1
      if (!this._isTaskOwnedByCurrentUser(task)) {
        this._queue.push(task)
        continue
      }
      // v2：日配额被拒的任务不参与本轮扫描（否则会被反复取到 ⇒ 紧循环）。
      // 它们由跨日定时器或下一次 _processNext 的显式重新判定放行。
      if (this._quotaBlocked.has(task.id)) {
        this._queue.push(task)
        continue
      }
      // B 方案通道调度：同通道（platform:accountId）已有任务在跑时，本任务留队轮候，
      // 继续扫描后续可启动任务（跨通道不互相阻塞）。轮候计数用 inspected 保证不无限循环。
      if ((this._runningByChannel.get(this._channelKey(task)) || 0) > 0) {
        this._queue.push(task)
        continue
      }
      this._executeTask(task)
    }
  }

  /**
   * 通道键：同平台同账号共享一个串行通道（防同账号并发触发平台风控 / 双窗竞争）。
   * accountId 缺失归一为空串——同平台无账号维度仍同通道（共享同一登录面）。
   * @param {object} task
   * @returns {string}
   */
  _channelKey (task) {
    return task.platform + ':' + (task.accountId ?? '')
  }

  async _executeTask (task) {
    if (task.cancelRequested || task.status === 'cancelled') return
    task.status = 'running'
    task.startedAt = new Date().toISOString()
    this._running.set(task.id, task)
    // B 方案：通道占用记账。频控推迟（下文 blocked 分支）与重试回 pending 都走 finally 统一释放。
    this._runningByChannel.set(this._channelKey(task), (this._runningByChannel.get(this._channelKey(task)) || 0) + 1)
    this.emit('task:start', task)
    this._saveState()

    // ── 发布频率控制：两档间隔检查 + 提交前记账 ──
    // 记账必须在提交之前：平台侧限流窗口按「请求已发生」计时，若只在成功路径记账，
    // 「内容已发到平台但应用判超时/报错」就不占窗口，重试会重复发布且下一次不受限。
    // accountId 缺席时守卫仍生效（跳过账号档、保留平台档），故此处不再以 accountId 为前提。
    // 守卫的读写全部落在下方 await 之前的同一同步段内 —— store 要求 owner 快照不得在
    // 回调/定时器中重读，挪到 await 之后就违反该约束。
    // accountId 取任务级归一字段（add() 已按 task.accountId ?? task.article?.accountId ?? null 落一），
    // 不得回退到只读 article：调用方只在任务级带账号时，账号档会被整体跳过。
    if (this._publishIntervalGuard) {
      const accountId = task.accountId
      const verdict = this._publishIntervalGuard.check(task.platform, accountId)
      if (!verdict.allowed) {
        task.status = 'pending'
        task.startedAt = null
        this._running.delete(task.id)
        // B 方案：blocked 路径在 try/finally 之前 return，finally 的通道释放不会执行——
        // 必须在此显式释放（与上行 _running.delete 同理），否则「等间隔」占死通道，
        // 同账号后续任务被堵死，频控从保护变成雪崩（决策 D2）。
        const blockedChannelKey = this._channelKey(task)
        const blockedCount = (this._runningByChannel.get(blockedChannelKey) || 0) - 1
        if (blockedCount <= 0) this._runningByChannel.delete(blockedChannelKey)
        else this._runningByChannel.set(blockedChannelKey, blockedCount)

        const isDailyQuota = verdict.bucket === 'daily' || verdict.reason === 'daily_quota'
        this.emit('publish:blocked', {
          task,
          remainingWait: verdict.remainingMs,
          bucket: verdict.bucket,
          reason: verdict.reason || null,
          daily: verdict.daily || null,
        })
        // 达到等待时间后重新加入队列
        // R28/R37：保存句柄 + unref + 注册到 _pendingTimers 供 shutdown 清理
        // v2：日配额命中的等待是「到次日 00:00:05」（几十万毫秒量级），
        //     且截止时间由守卫的注入时钟推导（与 today() 同源），避免测试注入时钟时漂移。
        const waitMs = isDailyQuota
          ? (typeof this._publishIntervalGuard.msUntilNextDay === 'function'
              ? this._publishIntervalGuard.msUntilNextDay()
              : 24 * 60 * 60 * 1000)
          : verdict.remainingMs
        if (isDailyQuota) this._quotaBlocked.add(task.id)
        const requeueTimer = setTimeout(() => {
          this._pendingTimers.delete(requeueTimer)
          this._delayed.delete(task.id)
          this._quotaBlocked.delete(task.id)
          if (task.cancelRequested || task.status === 'cancelled') return
          this._queue.unshift(task)
          this._processNext()
        }, waitMs)
        if (requeueTimer && requeueTimer.unref) requeueTimer.unref()
        this._pendingTimers.add(requeueTimer)
        this._delayed.set(task.id, { task, timer: requeueTimer })
        this._saveState()
        return
      }
      this._quotaBlocked.delete(task.id)
      // 占位并保存前值：release() 需要它才能精确还原（结构锁断言该返回值被消费）
      task._hold = this._publishIntervalGuard.recordPublish(task.platform, accountId)
      task.submitAttempted = false
      task.submittedAt = null
    }

    // 创建超时 Promise
    // R28/R37：保存句柄，race 结束后立即 clearTimeout，避免任务成功后定时器驻留最长 task.timeout(180s)
    let timeoutHandle = null
    const abortController = new AbortController()
    this._abortControllers.set(task.id, abortController)
    let abortHandler = null
    const abortPromise = new Promise((_, reject) => {
      abortHandler = () => {
        const reason = abortController.signal.reason
        reject(reason instanceof Error ? reason : new Error('任务已取消'))
      }
      if (abortController.signal.aborted) abortHandler()
      else abortController.signal.addEventListener('abort', abortHandler, { once: true })
    })
    const timeoutPromise = new Promise((_, reject) => {
      timeoutHandle = setTimeout(() => reject(new Error(`Task timed out after ${task.timeout}ms`)), task.timeout)
      if (timeoutHandle && timeoutHandle.unref) timeoutHandle.unref()
    })

    // v3/D1：必须知道"race 结束时执行器是否已经收敛"。被**超时**判输时平台请求仍在飞，
    // 此时若按「没打点 = 没发起」去回滚窗口，就是"仍在飞"读成"从未发起"（缺陷 D1）。
    // 声明在 try **之外**：catch 分支要读它（try 内的 let 在 catch 里不可见）。
    let executorSettled = false
    const executorPromise = Promise.resolve(this._runTask(task, abortController.signal))
      .then((value) => { executorSettled = true; return value }, (err) => { executorSettled = true; throw err })

    try {
      // 执行发布 (由外部注册)
      const result = await Promise.race([
        executorPromise,
        timeoutPromise,
        abortPromise,
      ])

      if (task.cancelRequested || task.status === 'cancelled') return
      task.status = 'success'
      task.result = result
      task.completedAt = new Date().toISOString()
      // ── 不变量 I4：成功路径自证 ──
      // 成功的发布必然发生过平台写操作，因此传输层**必须**已置位 submittedAt。
      // 若为空，说明该平台的传输层漏接线 —— 这会把「未提交失败」误判为可回滚（危险侧），
      // 故在这里把它变成第一次成功就暴露的主动告警，而不是等某次失败被误放行。
      if (this._publishIntervalGuard && !task.submittedAt) {
        this._probeCounts.successWithoutSubmittedAt += 1
        console.error(
          `[task-queue] 接线缺陷：平台 ${task.platform} 的发布成功但 submittedAt 为空`
          + '（传输层未调用 markSubmitted）—— 该平台的「未提交失败」判定不可信'
        )
        this._disableRollbackForPlatform(task.platform, 'success_without_submitted_at')
      } else if (this._publishIntervalGuard && task.submittedAt) {
        this._platformsProvenSubmit.add(task.platform)
      }
      this.emit('task:success', task)
      this._saveState()
    } catch (e) {
      if (task.cancelRequested || task.status === 'cancelled') return
      task.error = e.message
      // fix-risk-hold-false-positive（P0-1）：把抛错方携带的**结构化风控信号**落到任务上。
      // 此前只留 task.error 一段文本，下游风控判定被迫做关键词匹配 —— 而关键词匹配正是
      // 误判来源（`status code 601` / `id 6019` / `infrequent` 都会被裸词表命中）。
      // 传输层（publisher-router / 引擎 publishViaApi）已在 Error 上挂好 code 与 riskBlocked。
      task.errorCode = e && e.code !== undefined ? e.code : null
      task.riskBlocked = !!(e && (e.riskBlocked === true || e.risk_blocked === true))
      // loginExpired 也必须落盘（CCG 深度审查 i4）：传输层（attachRiskSignals）已把它挂在 Error 上，
      // 若此处不搬，「结构化信号已贯通」就是半程假完备——字段在 Error 上、到 task 就断。
      task.loginExpired = !!(e && (e.loginExpired === true || e.login_expired === true))

      // ── P0-1：未提交失败回滚窗口 ──
      // 判据是**提交阶段**而非错误类型：从未发起平台写尝试（submitAttempted=false），
      // 或传输层显式声明可确证未送出（definitelyNotSent=true）。其余一律占窗口（I2）。
      // v3/D1 追加前置条件：race 被超时/中止判输而执行器**尚未收敛**时，请求仍在飞，
      // "未打点"不等于"未发起" ⇒ 禁止回滚（inFlightAtFailure 由调用方如实告知）。
      const rolledBack = this._maybeRollback(task, e, { inFlightAtFailure: !executorSettled })

      // 风控即停等不可重试错误（e.noRetry）直接判失败，不进入重试环
      if (!e.noRetry && task.retriesLeft > 0) {
        task.retriesLeft--
        task.status = 'pending'
        task.lastAttemptNotSubmitted = rolledBack
        this.emit('task:retry', task)
        // 放回队列尾部；回滚过的按最小退避延后重排（防「回滚即零等待」的重试风暴）
        if (rolledBack) this._delayRequeue(task, this._releaseGraceMs())
        else this._queue.push(task)
      } else {
        task.status = 'failed'
        task.completedAt = new Date().toISOString()
        this.emit('task:failed', task)
      }
      this._saveState()
    } finally {
      // R28/R37：无论成功/失败/超时，立即清理超时定时器
      if (timeoutHandle) clearTimeout(timeoutHandle)
      if (abortHandler) abortController.signal.removeEventListener('abort', abortHandler)
      this._abortControllers.delete(task.id)
      this._running.delete(task.id)
      // B 方案：释放通道占用。频控推迟分支在置 pending 后 return，同样经过这里——
      // 保证「等间隔」不占通道（决策 D2：否则同账号第二条任务被堵死，频控变雪崩）。
      const channelKey = this._channelKey(task)
      const chCount = (this._runningByChannel.get(channelKey) || 0) - 1
      if (chCount <= 0) this._runningByChannel.delete(channelKey)
      else this._runningByChannel.set(channelKey, chCount)
      // 已完成的任务移入历史
      if ((task.status === 'success' || task.status === 'failed' || task.status === 'cancelled') &&
          !this._history.some(item => item.id === task.id)) {
        this._history.push(task)
      }
      this._processNext()
    }
  }


  /**
   * 实际执行任务的钩子 — 由外部设置
   */
  async _runTask (task, signal) {
    if (!this._executor) {
      throw new Error('No executor registered. Use setExecutor(fn)')
    }
    const result = await this._executor(task, { signal })
    return result
  }

  /**
   * 注册执行器
   * @param {Function} fn - async (task) => result
   */
  setExecutor (fn) {
    this._executor = fn
  }
}

// publish-frequency-policy-v2：频率相关方法（传输层打点 / 探针与降级 / 未提交回滚 / 紧急放行）
// 外移到 mixin —— 本文件被本次变更从 576 行推到 897 行，触到行数门禁的挂账文件膨胀容差
// （growthAllowance=200 ⇒ 上限 776），按门禁给的正解拆分；见 task-queue-frequency.js 头部。
Object.assign(TaskQueue.prototype, require('./task-queue-frequency'))

module.exports = TaskQueue
module.exports.resolveQueueMaxConcurrent = resolveQueueMaxConcurrent
