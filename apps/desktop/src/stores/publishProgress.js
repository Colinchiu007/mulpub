// @ts-check
/**
 * publishProgress.js — 发布进度全局承载 store（publish-progress-ux）
 *
 * 契约（01-docs/PRD-PUBLISH-PROGRESS-UX-2026-09-28 §5.2）：
 * - `publish:progress` / `batch:progress` 订阅在 App 级绑定一次（init 幂等），
 *   不随任何页面组件卸载注销——修复单篇/批量监听器「毫秒级死亡」bug 的承载面。
 * - 多并发会话（单篇按 taskIds、批量按 batchId、孤儿按事件自动收纳）；
 *   渲染层重载经 `queue:status` 快照领养孤儿任务（恢复会话，状态级如实呈现）。
 * - 终态吸收：success/failed 后迟到的 progress/start 不回退状态（PRD §4.3）。
 * - 面板形态：panelVisible（展开浮卡）/ panelMinimized（常驻胶囊）互斥；
 *   首次隐藏教育 toast 标志持久化 localStorage（仅一次）。
 */
import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import {
  onProgress,
  onBatchProgress,
  getQueueStatus,
  retryTask,
  cancelTask,
} from '@/api/publisher'
// 会话收养/合并纯逻辑（2026-10 publish-progress-dup-upload：主文件超行数门禁后外置）
import { findAdoptableSessions, mergeSessionInto } from './publishProgressSessionMerge'

/** 会话列表上限：超出裁剪最旧已完成会话；全 running 不裁剪（宁多勿丢） */
export const MAX_SESSIONS = 5
/**
 * 无更新阈值与心跳周期（UX 审计 1.8）。
 * 阈值放在模块级并由 store 导出：判据与文案共用一个数，测试也从这里取（不得各写一份 180000）。
 */
export const STALL_AFTER_MS = 3 * 60 * 1000
export const STALL_TICK_MS = 15 * 1000
/** 首次隐藏教育 toast 的 localStorage 键 */
export const FIRST_HIDE_TOAST_STORAGE_KEY = 'mp-publish-first-hide-toast-shown'

/** cancelled（publish-progress-panel-refine）：取消终态——主进程 phase4-events
 * 转发 TaskQueue 的 task:cancelled；中性态（非失败红态），计入终态与 aggregate。 */
// PRD-OSS-RPA-HARDENING（2026-10-14）：新增 captcha 相位（验证码旁路，F4）。
// 枚举是唯一真源：TERMINAL_PHASES 从本集合派生（评审 FE2：禁并列维护两份）。
const PHASE_ENUM = new Set(['start', 'progress', 'success', 'failed', 'retry', 'blocked', 'released', 'cancelled', 'captcha'])
// 派生而非并列：新增相位只需改 PHASE_ENUM 一处（测试锁 emitter/store 双侧一致）
const TERMINAL_PHASES = new Set(Array.from(PHASE_ENUM).filter((p) => ['success', 'failed', 'cancelled'].includes(p)))
const STAGE_KEY_ENUM = new Set([
  'prepare', 'upload', 'fill', 'submit', 'verify', 'waiting', 'released', 'done', 'failed', 'detail',
])

let _sessionCounter = 0

function newSessionId() {
  _sessionCounter += 1
  return 's_' + _sessionCounter + '_' + Date.now()
}

function normalizePercent(value) {
  if (value === null || value === undefined) return null
  const num = Number(value)
  if (!Number.isFinite(num) || num < 0 || num > 100) return null
  return num
}

function nowTimeString() {
  return new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

export const usePublishProgressStore = defineStore('publishProgress', () => {
  const sessions = ref([])
  const panelVisible = ref(false)
  const panelMinimized = ref(false)
  const firstHideToastShown = ref(false)
  const retrying = ref(false)
  /** 取消全部在途任务进行中（防重入，publish-progress-panel-refine） */
  const cancelling = ref(false)

  let listenersBound = false
  let offProgress = null
  let offBatchProgress = null

  // ─── 内部工具 ────────────────────────────────────────────────

  function _findSessionByTaskId(taskId) {
    return sessions.value.find((s) => Object.prototype.hasOwnProperty.call(s.tasks, taskId))
  }

  function _findSessionByBatchId(batchId) {
    return sessions.value.find((s) => s.batchId === batchId)
  }

  function _ensureTask(session, taskId, platform) {
    if (!session.tasks[taskId]) {
      session.tasks[taskId] = {
        taskId,
        platform: platform || '',
        phase: 'queued',
        stageKey: 'detail',
        stage: '',
        percent: null,
        result: null,
        error: null,
        // 失败码（与 error 同风格：缺席保持 null，不猜）。渲染层据此给出「解法入口」链接。
        code: null,
        remainingWait: null,
        retriesLeft: null,
        bucket: null,
        reason: null,
        daily: null,
        clockAnomaly: false,
        startedAt: null,
        endedAt: null,
        lastEventAt: null,
      }
      session.taskOrder.push(taskId)
    }
    return session.tasks[taskId]
  }

  function _appendLog(session, text, type) {
    session.log.push({ time: nowTimeString(), text, type })
    if (session.log.length > 200) session.log.splice(0, session.log.length - 200)
  }

  function _recomputeSessionStatus(session) {
    // 陈旧 tick 的启停挂在**每一个**状态收敛入口上（而不是各调用点各写一遍判据）：
    // 本函数是 phase 变更后必经的那一个出口，所以这里扫全量会话、一处定夺。
    // 必须排在 `taskIds.length === 0` 的提前 return **之前**：那个 return 只说明"这个会话没任务"，
    // 不代表别的会话没有非终态任务 —— 挂在 return 之后会漏掉"最后一个任务被移除"这一类收口。
    _syncStallTicker()
    const taskIds = Object.keys(session.tasks)
    if (taskIds.length === 0) return
    const allTerminal = taskIds.every((id) => TERMINAL_PHASES.has(session.tasks[id].phase))
    if (allTerminal && session.status !== 'done') {
      session.status = 'done'
      session.finishedAt = Date.now()
    } else if (!allTerminal && session.status === 'done') {
      // 重试失败项后会话回到 running
      session.status = 'running'
      session.finishedAt = null
    }
  }

  function _pruneSessions() {
    if (sessions.value.length <= MAX_SESSIONS) return
    const overflow = sessions.value.length - MAX_SESSIONS
    const finished = sessions.value.filter((s) => s.status === 'done')
    if (finished.length === 0) return // 全 running：不裁剪
    const toRemove = new Set(finished.slice(0, overflow).map((s) => s.id))
    sessions.value = sessions.value.filter((s) => !toRemove.has(s.id))
  }

  // ─── 事件处理 ────────────────────────────────────────────────

  function handleProgressEvent(data) {
    if (!data || typeof data !== 'object') return
    const taskId = typeof data.taskId === 'string' ? data.taskId : ''
    const platform = typeof data.platform === 'string' ? data.platform : ''
    if (!taskId || !platform) {
      // R9：非法事件丢弃（不建会话）
      console.warn('[publishProgress] dropped invalid event (missing taskId/platform)')
      return
    }
    let session = _findSessionByTaskId(taskId)
    if (!session && typeof data.batchId === 'string' && data.batchId) {
      session = _findSessionByBatchId(data.batchId)
    }
    if (!session) {
      // R3：孤儿事件自动收纳
      session = _createSession({ title: null, batchId: null })
      _appendLog(session, platform, 'primary')
    }
    const task = _ensureTask(session, taskId, platform)
    task.platform = platform
    const phase = PHASE_ENUM.has(data.phase) ? data.phase : 'progress'
    const stageKey = STAGE_KEY_ENUM.has(data.stageKey) ? data.stageKey : 'detail'
    const isTerminalNow = TERMINAL_PHASES.has(phase)
    // 终态吸收：终态后迟到的非终态事件不回退状态（PRD §4.3）
    if (TERMINAL_PHASES.has(task.phase) && !isTerminalNow) {
      task.lastEventAt = Date.now()
      return
    }
    task.phase = phase
    task.stageKey = stageKey
    task.stage = typeof data.stage === 'string' ? data.stage : ''
    task.percent = normalizePercent(data.percent)
    task.lastEventAt = Date.now()
    if (data.result !== undefined) task.result = data.result || null
    if (data.error !== undefined) task.error = data.error || null
    // 2026-10-19（publish-gate-help-ui）：失败码要留到渲染层 —— 有些失败（如头条「账号信息未完善」）
    // 唯一有用的信息不是错误文案，而是「去哪里解决」。主进程 phase4-events 已随事件发出 `code`，
    // 这里不落盘就等于把可点击的解法入口丢掉（用户只剩一段看不懂的报错）。
    if (data.code !== undefined) task.code = data.code || null
    if (data.remainingWait !== undefined) task.remainingWait = data.remainingWait || null
    if (data.retriesLeft !== undefined) task.retriesLeft = data.retriesLeft
    if (data.bucket !== undefined) task.bucket = data.bucket || null
    // v2：阻塞原因与当日用量（日配额文案需要 used/max；字段缺席保持 null，不得猜档）
    if (data.reason !== undefined) task.reason = data.reason || null
    if (data.daily !== undefined) task.daily = data.daily || null
    // 时钟异常标记（fix-account-interval-ghost-wait）：缺席/为假一律落 false，UI 据此不渲染
    if (data.clockAnomaly !== undefined) task.clockAnomaly = data.clockAnomaly === true
    if (phase === 'start' && !task.startedAt) task.startedAt = Date.now()
    if (isTerminalNow && !task.endedAt) task.endedAt = Date.now()
    _appendLog(session, platform + ' · ' + (task.stage || phase), isTerminalNow ? (phase === 'success' ? 'success' : 'danger') : 'primary')
    _recomputeSessionStatus(session)
    _pruneSessions()
  }

  function handleBatchEvent(data) {
    if (!data || typeof data !== 'object') return
    if (typeof data.batchId !== 'string' || !data.batchId) return
    const session = _findSessionByBatchId(data.batchId)
    if (!session) return
    if (data.kind === 'batch-complete') {
      // 兜底终态：以事件计数为准，不覆盖已有任务终态
      session.status = 'done'
      session.finishedAt = Date.now()
      _appendLog(session, 'batch-complete', 'success')
      _pruneSessions()
    } else if (data.kind === 'task-complete' && typeof data.taskId === 'string' && data.taskId) {
      const task = _ensureTask(session, data.taskId, typeof data.platform === 'string' ? data.platform : '')
      if (!TERMINAL_PHASES.has(task.phase)) {
        task.phase = data.ok ? 'success' : 'failed'
        task.stageKey = data.ok ? 'done' : 'failed'
        task.percent = 100
        task.endedAt = Date.now()
        task.lastEventAt = Date.now()
        if (data.message && !data.ok) task.error = data.message
      }
      _recomputeSessionStatus(session)
    }
  }

  // ─── 会话登记 ────────────────────────────────────────────────

  function _createSession({ title, batchId }) {
    const session = {
      id: newSessionId(),
      batchId: typeof batchId === 'string' && batchId ? batchId : null,
      title: typeof title === 'string' && title ? title : '',
      createdAt: Date.now(),
      status: 'running',
      finishedAt: null,
      tasks: {},
      taskOrder: [],
      log: [],
    }
    sessions.value.push(session)
    return session
  }

  // 收养/合并纯逻辑外置（主文件超逐文件行数门禁 limit=500，见
  // publishProgressSessionMerge.js 头注释与 Bug A 取证）
  function _findAdoptableSessions(ids, batchId) {
    return findAdoptableSessions(sessions.value, ids, batchId)
  }

  function registerSession({ taskIds, batchId, title } = {}) {
    const ids = Array.isArray(taskIds)
      ? taskIds.filter((id) => typeof id === 'string' && id)
      : []
    const hasBatch = typeof batchId === 'string' && batchId
    if (ids.length === 0 && !hasBatch) return null
    const wantBatchId = hasBatch ? batchId : null
    const hits = _findAdoptableSessions(ids, wantBatchId)
    let session
    if (hits.length > 0) {
      // 收养：事件先到建的孤儿会话（或多个命中会话）收敛为一个，不再新建
      session = hits[0]
      for (let i = 1; i < hits.length; i += 1) mergeSessionInto(session, hits[i])
      if (hits.length > 1) {
        const dropped = new Set(hits.slice(1).map((s) => s.id))
        sessions.value = sessions.value.filter((s) => !dropped.has(s.id))
      }
      // 补齐登记时声明但尚未到达事件的 taskId（_ensureTask 不覆盖已有任务）
      for (const id of ids) _ensureTask(session, id, '')
      if (!session.title && typeof title === 'string' && title) session.title = title // 孤儿无标题则补
      if (wantBatchId && !session.batchId) session.batchId = wantBatchId
      if (session.recovered) delete session.recovered // 恢复会话被本次发布接管
      _recomputeSessionStatus(session)
    } else {
      session = _createSession({ title, batchId })
      for (const id of ids) _ensureTask(session, id, '')
    }
    // 自动展开（用户主动发布才弹；孤儿领养/事件到达不打扰）
    panelVisible.value = true
    panelMinimized.value = false
    _pruneSessions()
    // 新建分支不走 `_recomputeSessionStatus`（adopt 分支才走），所以这里必须自己同步一次；
    // 少了它，"点了发布但一个事件都还没来"的那段时间里没有 tick，看门狗恰好对它失灵。
    _syncStallTicker()
    return session
  }

  function dismissSession(sessionId) {
    sessions.value = sessions.value.filter((s) => s.id !== sessionId)
    _syncStallTicker()
  }

  function clearFinished() {
    sessions.value = sessions.value.filter((s) => s.status !== 'done')
    _syncStallTicker()
  }

  // ─── 重试失败项 ──────────────────────────────────────────────

  /**
   * 单任务重试共享路径（publish-progress-panel-refine 拆出）：
   * 经 `queue:retry` IPC 重发并以新 taskId 替换原条目（phase:'queued'，清 error/result）。
   * @returns {Promise<{ok:number,fail:number}>}
   */
  async function _retryOne(session, taskId) {
    const task = session.tasks[taskId]
    if (!task || task.phase !== 'failed') return { ok: 0, fail: 0 }
    try {
      const res = await retryTask(taskId)
      if (res && res.code === 0 && res.data && typeof res.data.taskId === 'string' && res.data.taskId) {
        const newTaskId = res.data.taskId
        if (!session.tasks[newTaskId]) {
          const platform = task.platform
          delete session.tasks[taskId]
          session.taskOrder = session.taskOrder.filter((x) => x !== taskId)
          _ensureTask(session, newTaskId, platform)
          return { ok: 1, fail: 0 }
        }
        // 重复重试：新 taskId 已存在，跳过
        return { ok: 1, fail: 0 }
      }
      return { ok: 0, fail: 1 }
    } catch {
      return { ok: 0, fail: 1 }
    }
  }

  async function retryFailed(sessionId) {
    const session = sessions.value.find((s) => s.id === sessionId)
    if (!session || retrying.value) return { ok: 0, fail: 0 }
    const failedIds = Object.keys(session.tasks).filter((id) => session.tasks[id].phase === 'failed')
    if (failedIds.length === 0) return { ok: 0, fail: 0 }
    retrying.value = true
    let ok = 0
    let fail = 0
    try {
      for (const id of failedIds) {
        const r = await _retryOne(session, id)
        ok += r.ok
        fail += r.fail
      }
      _recomputeSessionStatus(session)
    } finally {
      retrying.value = false
    }
    return { ok, fail }
  }

  /**
   * 单任务级重试（publish-progress-panel-refine）：失败行内联「重试此任务」入口。
   * 与 retryFailed 共享 retrying 防重入与 _retryOne 路径。
   */
  async function retryOne(sessionId, taskId) {
    const session = sessions.value.find((s) => s.id === sessionId)
    if (!session || retrying.value) return { ok: 0, fail: 0 }
    const task = session.tasks[taskId]
    if (!task || task.phase !== 'failed') return { ok: 0, fail: 0 }
    retrying.value = true
    let result = { ok: 0, fail: 0 }
    try {
      result = await _retryOne(session, taskId)
      _recomputeSessionStatus(session)
    } finally {
      retrying.value = false
    }
    return result
  }

  // ─── 取消全部在途任务（publish-progress-panel-refine） ────────

  /**
   * 对全部会话内非终态任务逐个调用 `queue:cancel`（防重入）。
   * 任务状态更新以主进程转发的 `phase:'cancelled'` 事件为单一来源——
   * 本动作只发取消请求与汇总计数，不自行改写任务相位（不自造第二份真相）。
   * @returns {Promise<{ok:number,fail:number}>}
   */
  async function cancelRunning() {
    if (cancelling.value) return { ok: 0, fail: 0 }
    const ids = []
    for (const s of sessions.value) {
      for (const id of Object.keys(s.tasks)) {
        if (!TERMINAL_PHASES.has(s.tasks[id].phase)) ids.push(id)
      }
    }
    if (ids.length === 0) return { ok: 0, fail: 0 }
    cancelling.value = true
    let ok = 0
    let fail = 0
    try {
      const results = await Promise.allSettled(ids.map((id) => cancelTask(id)))
      for (const r of results) {
        if (r.status === 'fulfilled' && r.value && r.value.code === 0 && r.value.data !== false) ok += 1
        else fail += 1
      }
    } finally {
      cancelling.value = false
    }
    return { ok, fail }
  }

  // ─── 面板形态 ────────────────────────────────────────────────

  function minimizePanel() {
    panelMinimized.value = true
    panelVisible.value = false
  }

  function expandPanel() {
    panelVisible.value = true
    panelMinimized.value = false
  }

  function consumeFirstHideToast() {
    if (firstHideToastShown.value) return false
    firstHideToastShown.value = true
    try {
      window.localStorage.setItem(FIRST_HIDE_TOAST_STORAGE_KEY, '1')
    } catch { /* localStorage 不可用时静默降级（下次再提示一次，可接受） */ }
    return true
  }

  // ─── 初始化（App 级，幂等） ──────────────────────────────────

  async function init() {
    try {
      firstHideToastShown.value = window.localStorage.getItem(FIRST_HIDE_TOAST_STORAGE_KEY) === '1'
    } catch { firstHideToastShown.value = false }
    if (!listenersBound) {
      listenersBound = true
      // 订阅所有权在 App 级：返回的 unsubscribe 故意不保存、不暴露——
      // 面板随 App.vue 常驻，订阅生命周期 == 应用生命周期（监听器死亡 bug 的结构性修复）。
      offProgress = onProgress(handleProgressEvent)
      offBatchProgress = onBatchProgress(handleBatchEvent)
    }
    // R2：渲染层重载恢复——领养不属于任何会话的运行中/排队任务（状态级，无阶段细节，如实呈现）
    try {
      const res = await getQueueStatus()
      const status = res && res.code === 0 ? res.data : null
      const running = Array.isArray(status?.running) ? status.running : []
      const queue = Array.isArray(status?.queue) ? status.queue : []
      const orphans = [...running, ...queue].filter((t) => t && typeof t.id === 'string' && !_findSessionByTaskId(t.id))
      if (orphans.length > 0) {
        const session = _createSession({ title: null, batchId: null })
        session.recovered = true
        for (const t of orphans) {
          const task = _ensureTask(session, t.id, typeof t.platform === 'string' ? t.platform : '')
          task.phase = running.includes(t) ? 'progress' : 'queued'
          task.stageKey = 'detail'
        }
      }
    } catch (e) {
      // R7：领养降级跳过，不影响事件订阅
      console.warn('[publishProgress] queue status adopt skipped:', e && e.message)
    }
  }

  // ─── getters ─────────────────────────────────────────────────

  const hasRunning = computed(() =>
    sessions.value.some((s) => s.status === 'running'),
  )

  const aggregate = computed(() => {
    let total = 0
    let done = 0
    let succeeded = 0
    let failed = 0
    let cancelled = 0
    for (const s of sessions.value) {
      for (const id of Object.keys(s.tasks)) {
        total += 1
        const task = s.tasks[id]
        if (task.phase === 'success') { done += 1; succeeded += 1 } else if (task.phase === 'failed') { done += 1; failed += 1 } else if (task.phase === 'cancelled') { done += 1; cancelled += 1 }
      }
    }
    return { total, done, succeeded, failed, cancelled }
  })

  function sessionFailedCount(sessionId) {
    const session = sessions.value.find((s) => s.id === sessionId)
    if (!session) return 0
    return Object.keys(session.tasks).filter((id) => session.tasks[id].phase === 'failed').length
  }

  // ─── 无更新（陈旧）派生层（UX 审计 1.8 / audit-15）─────────────────
  //
  // 为什么这一层必须存在：`lastEventAt` 早就是写好的（本文件四处赋值），但**全仓零读取**，
  // 于是面板唯一的时间锚没人用；关闭按钮 `:disabled="hasRunning"` 只能被终态事件解除，
  // RPA 窗口挂死时事件永不到来 ⇒ 转圈 + 「勿关应用」+ 按钮永久灰，用户只剩「取消全部」
  // 这条同样可能挂死的路。
  //
  // 三条口径（spec 已钉）：
  //  1. **只读派生**：不改 `phase`、不写持久化、不触发取消/重试。
  //     「没有新事件」不是失败的证据 —— 把它映射成 failed 会让一次 IPC 抖动变成用户可见的
  //     红态并污染发布历史（与本仓「状态只被正/负证据改写」同一条口径）。
  //  2. **时钟同域**：两条边都取 `Date.now()`（`lastEventAt` 本来就是 Date.now() 写的），
  //     不得掺事件里带来的主进程 timestamp —— 跨域比较是本仓抓过的引信形态。
  //  3. **惰性单实例 tick**：陈旧要靠墙钟推进，而事件不会替它推进，所以必须有定时器；
  //     但它只在「还有非终态任务」期间活着，且重复 init() 不得叠加第二个
  //     （同 `autoUpdater` 那条「全局单例监听器」教训）。

  /** 阈值与周期取模块级常量（`STALL_AFTER_MS` / `STALL_TICK_MS`），此处不再各写一份 */

  /**
   * 阈值取模块级常量 `STALL_AFTER_MS` / `STALL_TICK_MS`（判据与文案共用一个数）。
   *
   * ⚠️ tick 句柄与 `nowTs` **刻意放在 setup 内**（每个 store 实例各一份），不是模块级单例：
   * 模块级 `let stallTimer` 在测试里跨用例存活 —— 第一个用例留下的句柄会让第二个用例的
   * `_ensureStallTicker()` 看见"已经有 timer"而永不新建，症状是「一个没跑起来的 timer
   * 伪装成已接线的单例」。生产侧一个渲染进程只有一个 pinia store 实例（多窗口 = 多进程），
   * 所以"实例内单例"既是对的也不会漏 timer；重复 init() 不叠加是因为 tick 由 watch 的
   * 状态变化驱动，与 init() 无关。
   */
  const nowTs = ref(Date.now())
  let stallTimer = null

  function _stallAnchor(task, session) {
    // 非终态任务没有 lastEventAt 的唯一来源是「登记了但从没收到事件」——那正是需要看门狗的那一种，
    // 所以回落链必须一路铺到会话创建时刻，不得因为"没有锚"而永不陈旧。
    if (typeof task.lastEventAt === 'number') return task.lastEventAt
    if (typeof task.startedAt === 'number') return task.startedAt
    return session.createdAt
  }

  /** 遍历所有非终态任务：[taskId, 锚点时刻, session] */
  function _eachLiveTask(visit) {
    for (const session of sessions.value) {
      for (const taskId of Object.keys(session.tasks)) {
        const task = session.tasks[taskId]
        if (TERMINAL_PHASES.has(task.phase)) continue
        visit(taskId, _stallAnchor(task, session), task)
      }
    }
  }

  const stalledTaskIds = computed(() => {
    const out = []
    _eachLiveTask((taskId, anchor) => {
      if (nowTs.value - anchor >= STALL_AFTER_MS) out.push(taskId)
    })
    return out
  })

  /** 存在非终态任务，且**全部**非终态任务都已无更新 ⇒ 允许用户关掉面板 */
  const hasStalledRunning = computed(() => {
    let live = 0
    let stalled = 0
    _eachLiveTask((taskId, anchor) => {
      live += 1
      if (nowTs.value - anchor >= STALL_AFTER_MS) stalled += 1
    })
    return live > 0 && stalled === live
  })

  /** 无更新任务里最长的分钟数（供文案与 title） */
  const maxStallMinutes = computed(() => {
    let worst = 0
    _eachLiveTask((taskId, anchor) => {
      const idle = nowTs.value - anchor
      if (idle >= STALL_AFTER_MS) worst = Math.max(worst, Math.floor(idle / 60000))
    })
    return worst
  })

  function taskStallMinutes(taskId) {
    if (!taskId) return 0
    for (const session of sessions.value) {
      const task = session.tasks[taskId]
      if (!task || TERMINAL_PHASES.has(task.phase)) return 0
      const idle = nowTs.value - _stallAnchor(task, session)
      return idle >= STALL_AFTER_MS ? Math.floor(idle / 60000) : 0
    }
    return 0
  }

  function isTaskStalled(taskId) {
    return stalledTaskIds.value.includes(taskId)
  }

  function _ensureStallTicker() {
    if (stallTimer !== null) return
    stallTimer = setInterval(() => {
      // 同域推进：判据与锚点都是 Date.now()
      nowTs.value = Date.now()
    }, STALL_TICK_MS)
  }

  function _stopStallTicker() {
    if (stallTimer === null) return
    clearInterval(stallTimer)
    stallTimer = null
  }

  /**
   * 按「是否还有非终态任务」决定 tick 的启停 —— 唯一的一处判据。
   *
   * 为什么不用 `watch`：本 store 的会话对象是 **push 进 `ref([])` 后按原始引用继续改的**
   * （`_createSession` 返回 raw session，`_ensureTask`/`handleProgressEvent` 都直接改 raw），
   * 于是 Vue 的响应式追踪看不见这些写入，watch 的 getter 不会触发。
   * 实测形态：`{ immediate:true, flush:'sync' }` 的 watch 全程一次都没回调，
   * 「有 running 时恰好 1 个 tick」的用例读出 0 个 —— 一条**看起来接了、实际恒不执行**的门禁，
   * 正是本仓反复记录的「装饰性接线」。所以显式挂在必经出口 `_recomputeSessionStatus` 上，
   * 并在三条"不经该出口"的路径（新建会话 / dismissSession / clearFinished）各补一次调用。
   */
  function _syncStallTicker() {
    let hasLive = false
    for (const session of sessions.value) {
      for (const taskId of Object.keys(session.tasks)) {
        if (!TERMINAL_PHASES.has(session.tasks[taskId].phase)) { hasLive = true; break }
      }
      if (hasLive) break
    }
    if (hasLive) _ensureStallTicker()
    else _stopStallTicker()
  }

  return {
    sessions,
    panelVisible,
    panelMinimized,
    firstHideToastShown,
    retrying,
    cancelling,
    init,
    registerSession,
    handleProgressEvent,
    handleBatchEvent,
    retryFailed,
    retryOne,
    cancelRunning,
    dismissSession,
    clearFinished,
    minimizePanel,
    expandPanel,
    consumeFirstHideToast,
    sessionFailedCount,
    hasRunning,
    aggregate,
    stalledTaskIds,
    hasStalledRunning,
    maxStallMinutes,
    taskStallMinutes,
    isTaskStalled,
  }
})
