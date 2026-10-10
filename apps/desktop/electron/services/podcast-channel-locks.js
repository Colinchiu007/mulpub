'use strict'

/**
 * podcast-channel-locks.js — 播客频道的并发写串行与发布防重入
 *
 * 为什么要有这个模块（PRD §11）：episodes.json 与 index.json 的每一次变更都是
 * 「读整份 → 改 → 写整份」，两个写者交错时后写者会静默覆盖先写者。本仓在登录态真源上
 * 已经付过一次这笔学费（account-state-lock 的七条口径），这里沿用同一套语义，
 * 但按播客的实际形态拆成三件事，缺一不可：
 *   1) 一把按 index 键的串行锁（跨频道全局态）+ 一个进程内共享、按 channelId 键的发布忙标记；
 *   2) 唯一的加锁顺序与「两个持有期不得重叠」；
 *   3) 发布防重入用进程内标记，而不是把锁改成分钟级长持 —— 长持会把用户手工编辑
 *      一起挡在门外，且崩溃后留下无人清理的锁。
 */

const DEFAULT_WAIT_TIMEOUT_MS = 250
const LOCK_WAIT_ERROR = 'PODCAST_LOCK_WAIT_TIMEOUT'
const CHANNEL_BUSY_ERROR = 'PODCAST_CHANNEL_BUSY'
const INDEX_BUSY_ERROR = 'PODCAST_INDEX_BUSY'

function normalizeWaitTimeout (raw) {
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_WAIT_TIMEOUT_MS
}

function sleep (ms) {
  // 必须让出宏任务：纯微任务自旋对基于 setTimeout 的超时机制免疫
  return new Promise((resolve) => { setTimeout(resolve, ms) })
}

/**
 * 按记录键的串行队列。四条不可破：
 * - 键必须是具体记录 id（退化成全局单键会把跨频道并行吃掉）；缺键当场抛，不静默降级；
 * - 前一个临界区抛错必须放行后来者；
 * - 等待必须有上限，且**超时的等待者不得执行其临界区**（迟到的排队者补写一份过期结论，
 *   正是这把锁要消灭的形态）；放弃等待时仍要在真正轮到它的那一刻释放闸门，
 *   否则后序等待者会等一个永不解除的锁——串行序位不能因为某人放弃而被压乱。
 */
function createKeyedLocks (options = {}) {
  const waitTimeoutMs = normalizeWaitTimeout(options.waitTimeoutMs)
  const queues = new Map()

  async function withKey (key, section, task) {
    const id = String(key == null ? '' : key).trim()
    if (!id) throw new Error('PODCAST_LOCK_KEY_REQUIRED: 缺 channelId 不得静默降级成不串行')
    if (typeof task !== 'function') throw new Error('PODCAST_LOCK_TASK_REQUIRED')

    const prev = queues.get(id) || Promise.resolve()
    const settledPrev = prev.catch(() => undefined)
    let release
    const myTurn = new Promise((resolve) => { release = resolve })
    const tail = settledPrev.then(() => myTurn)
    queues.set(id, tail)

    const deadline = Date.now() + waitTimeoutMs
    let acquired = false
    for (;;) {
      const won = await Promise.race([
        settledPrev.then(() => 'acquired'),
        sleep(5).then(() => 'tick')
      ])
      if (won === 'acquired') { acquired = true; break }
      if (Date.now() >= deadline) break
    }

    if (!acquired) {
      // 放弃执行，但保留序位：轮到即释放，后序等待者不会被我卡死
      settledPrev.then(() => release())
      const e = new Error(LOCK_WAIT_ERROR + '（' + section + ' 等待超时 >' + waitTimeoutMs + 'ms）')
      e.code = LOCK_WAIT_ERROR
      e.section = section
      throw e
    }

    try {
      return await task()
    } finally {
      release()
      if (queues.get(id) === tail) queues.delete(id)
    }
  }

  return {
    withKey,
    waitTimeoutMs,
    pendingKeys: () => Array.from(queues.keys()),
  }
}

/**
 * 发布防重入标记：try-acquire、已被占立即 false；finally 必清；崩溃随进程消失，
 * 残留由启动对账接管（只提示不自动修复）。它不是锁的替代品。
 */
/**
 * 发布「通行证」：与忙标记同键、同步作用域。
 *
 * 为什么需要它：忙标记把「手工写者」挡在发布窗口外，但发布编排自己也要写 `feedSync` 与
 * 重建 feed —— 没有这个通行证，发布会在自己的临界区里把自己挡住（实测过一次自锁）。
 * ⛔ 通行证只在**同步作用域**内有效（fn 返回即收回），不得做成异步持有的布尔开关：
 *    布尔会跨 await 泄漏，把「发布自己写自己的状态」扩大成「发布期间任何人都能写」。
 */
function createPublishPassSet () {
  const passes = new Set()
  return {
    run (channelId, fn) {
      const id = String(channelId == null ? '' : channelId).trim()
      if (!id) throw new Error('PODCAST_GATE_KEY_REQUIRED')
      passes.add(id)
      try { return fn() } finally { passes.delete(id) }
    },
    isPassed (channelId) {
      const id = String(channelId == null ? '' : channelId).trim()
      return Boolean(id) && passes.has(id)
    },
    size: () => passes.size,
  }
}

const channelPublishPass = createPublishPassSet()

function createPublishGate () {
  const inFlight = new Map()
  return {
    tryBegin (channelId, meta = {}) {
      const id = String(channelId == null ? '' : channelId).trim()
      if (!id) throw new Error('PODCAST_GATE_KEY_REQUIRED')
      if (inFlight.has(id)) return false
      inFlight.set(id, Object.assign({ startedAt: Date.now() }, meta))
      return true
    },
    end (channelId) {
      const id = String(channelId == null ? '' : channelId).trim()
      return id ? inFlight.delete(id) : false
    },
    isBusy (channelId) {
      const id = String(channelId == null ? '' : channelId).trim()
      return Boolean(id) && inFlight.has(id)
    },
    snapshot () {
      return Array.from(inFlight.entries()).map(([channelId, info]) => ({ channelId, ...info }))
    },
  }
}

/**
 * 进程内共享的「该频道有发布在飞」标记 —— registry 与 service 必须读同一个实例。
 * Why: 手工单集增删是**同步**的读-改-写，同一事件循环内不可能互相交错，需要防的是它落进
 * 一键发布那条跨 await 的长临界区；判据本来只需要一问（此刻有没有发布在飞），
 * 用异步锁去串行同步写只会把 IPC 拖进等待队列。键空间与 registry 的 channelId 同源。
 */
const channelBusyGate = createPublishGate()

module.exports = {
  createKeyedLocks,
  createPublishGate,
  channelBusyGate,
  channelPublishPass,
  createPublishPassSet,
  LOCK_WAIT_ERROR,
  CHANNEL_BUSY_ERROR,
  INDEX_BUSY_ERROR,
  DEFAULT_WAIT_TIMEOUT_MS,
  normalizeWaitTimeout,
}
