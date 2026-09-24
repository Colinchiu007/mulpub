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

function normalizeOwnerSubject (ownerSubject) {
  if (typeof ownerSubject !== 'string' || !ownerSubject.trim()) {
    throw new Error('任务队列无法识别当前用户')
  }
  return ownerSubject.trim()
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
    this._abortControllers = new Map() // 运行中任务的协作式取消信号
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
    const entry = {
      id: taskId,
      platform: task.platform,
      article: task.article,
      owner_subject: ownerSubject,
      batchId: task.batchId || null,
      accountId: task.accountId ?? task.article?.accountId ?? null,
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
    return this._visibleTasks(pending).map(t => ({
      id: t.id,
      platform: t.platform,
      article: t.article,
      owner_subject: t.owner_subject,
      batchId: t.batchId || null,
      accountId: t.accountId || null,
      retry: t.retry,
      timeout: t.timeout,
      retriesLeft: t.retriesLeft,
      retryOf: t.retryOf || null,
      createdAt: t.createdAt
    }))
  }

  /**
   * 序列化队列状态（用于崩溃恢复）
   */
  serialize () {
    return JSON.stringify({
      queue: this.getPendingTasks(),
      running: this._visibleTasks(Array.from(this._running.values())).map(t => ({
        id: t.id,
        platform: t.platform,
        article: t.article,
        owner_subject: t.owner_subject,
        batchId: t.batchId || null,
        accountId: t.accountId || null,
        retry: t.retry,
        timeout: t.timeout,
        retriesLeft: t.retriesLeft,
        retryOf: t.retryOf || null,
        createdAt: t.createdAt,
        startedAt: t.startedAt
      }))
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
   */
  getStatus () {
    const isVisible = task => this._isTaskOwnedByCurrentUser(task)
    return {
      pending: this._queue.filter(isVisible).length,
      running: Array.from(this._running.values()).filter(isVisible).length,
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
      this._executeTask(task)
    }
  }

  async _executeTask (task) {
    if (task.cancelRequested || task.status === 'cancelled') return
    task.status = 'running'
    task.startedAt = new Date().toISOString()
    this._running.set(task.id, task)
    this.emit('task:start', task)
    this._saveState()

    // ── 发布频率控制检查 ──
    if (this._publishIntervalGuard) {
      const accountId = task.article && task.article.accountId
      if (accountId) {
        const wait = this._publishIntervalGuard.getRemainingWait(task.platform, accountId)
        if (wait > 0) {
          task.status = 'pending'
          task.startedAt = null
          this._running.delete(task.id)
          this.emit('publish:blocked', { task, remainingWait: wait })
          // 达到等待时间后重新加入队列
          // R28/R37：保存句柄 + unref + 注册到 _pendingTimers 供 shutdown 清理
          const requeueTimer = setTimeout(() => {
            this._pendingTimers.delete(requeueTimer)
            this._delayed.delete(task.id)
            if (task.cancelRequested || task.status === 'cancelled') return
            this._queue.unshift(task)
            this._processNext()
          }, wait)
          if (requeueTimer && requeueTimer.unref) requeueTimer.unref()
          this._pendingTimers.add(requeueTimer)
          this._delayed.set(task.id, { task, timer: requeueTimer })
          this._saveState()
          return
        }
      }
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

    try {
      // 执行发布 (由外部注册)
      const result = await Promise.race([
        this._runTask(task, abortController.signal),
        timeoutPromise,
        abortPromise,
      ])

      if (task.cancelRequested || task.status === 'cancelled') return
      task.status = 'success'
      task.result = result
      task.completedAt = new Date().toISOString()
      this.emit('task:success', task)
      this._saveState()
      // 记录发布到频率控制器
      if (this._publishIntervalGuard) {
        const accountId = task.article && task.article.accountId
        if (accountId) {
          this._publishIntervalGuard.recordPublish(task.platform, accountId)
        }
      }
    } catch (e) {
      if (task.cancelRequested || task.status === 'cancelled') return
      task.error = e.message

      // 风控即停等不可重试错误（e.noRetry）直接判失败，不进入重试环
      if (!e.noRetry && task.retriesLeft > 0) {
        task.retriesLeft--
        task.status = 'pending'
        this.emit('task:retry', task)
        // 放回队列尾部
        this._queue.push(task)
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

module.exports = TaskQueue
