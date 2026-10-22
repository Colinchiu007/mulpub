// @ts-check
/**
 * publishProgressStall.js —— 发布进度「无更新」派生层的单一实现（UX 审计 1.8 / audit-15）
 *
 * 为什么单独成文件：判据（阈值、时钟域、tick 生命周期）必须只有一份，而宿主 store
 * `publishProgress.js` 在 496 行、贴着 `check-debt-budget.js` 的 ≥500 行熔断基线。
 * 先例：同目录 `publishProgressSessionMerge.js` 就是为同一道门禁外置的。
 * **正解是把代码搬出去，不是把阈值调大**（AGENTS「计数/比例型门禁」条）。
 *
 * 三条契约（spec 已钉，改动必须同跑 `src/stores/publishProgress.stale.test.js`）：
 *  1. **只读派生**：不改 `phase`、不写持久化、不触发取消/重试。
 *     「没有新事件」不是失败的证据 —— 映射成 `failed` 会让一次 IPC 抖动变成用户可见红态，
 *     并污染发布历史（与本仓「状态只被正/负证据改写」同一条口径）。
 *  2. **时钟同域**：两条边都取渲染端 `Date.now()`（`lastEventAt` 本来就是它写的）；
 *     不读事件里带来的主进程 `timestamp` —— 跨时钟域比较是本仓抓过的引信形态。
 *  3. **tick 惰性、单实例、会自泊**：只有「有非终态任务」期间活着；
 *     看到全部终态就自己停；`begin()` 幂等；宿主卸载必须 `end()`。
 *
 * ⚠️ 为什么不用 `watch` 驱动启停（本批实测出来的坑，别改回去）：
 * 宿主 store 的会话对象是 `push` 进 `ref([])` 之后**按原始引用**继续改的
 * （`_createSession` 返回 raw session，`_ensureTask` / 事件处理都直接改 raw），
 * Vue 的响应式追踪看不见这些写入 ⇒ watch 的 getter 一次都不触发。
 * 我先写的就是 `{ immediate:true, flush:'sync' }` 的 watch，
 * 表现是「有 running 时恰好 1 个 tick」读出 **0 个** —— 一条看起来接了、实际恒不执行的装饰性接线。
 */
import { computed, reactive, ref } from 'vue'
// 终态集合的单一真源在宿主 store（从它的 PHASE_ENUM 派生）。这里 import 而不是另抄一份，
// 因为「什么算终态」决定「还有没有在动的任务」，两份必然漂移 —— 与 AGENTS「不得并列维护」同条。
import { TERMINAL_PHASES } from './publishProgress'

/** 距上次事件多久算「无更新」（判据与文案共用这一个数） */
export const STALL_AFTER_MS = 3 * 60 * 1000
/** 心跳周期：比阈值细一个量级，用户看到的分钟数不会一次跳 2 */
export const STALL_TICK_MS = 15 * 1000
const MINUTE_MS = 60 * 1000

/**
 * @param {object} deps
 * @param {{ value: Array<any> }} deps.sessions 宿主 store 的会话列表 ref
 * @param {Set<string>} deps.terminalPhases 终态相位集合（由宿主 PHASE_ENUM 派生，此处不复制）
 */
export function createStallTracker ({ sessions, terminalPhases }) {
  const nowTs = ref(Date.now())
  let timer = null

  function isTerminal (phase) {
    return terminalPhases.has(phase)
  }

  function stallAnchor (task, session) {
    // 非终态任务没有 lastEventAt 的唯一来源是「登记了但从没收到事件」——那正是需要看门狗的那一种，
    // 所以回落链必须一路铺到会话创建时刻，不得因为"没有锚"而永不陈旧。
    if (typeof task.lastEventAt === 'number') return task.lastEventAt
    if (typeof task.startedAt === 'number') return task.startedAt
    return session.createdAt
  }

  /**
   * 遍历所有非终态任务，回调 (taskId, 锚点时刻, idleMs)。
   * ⚠ 读数**只准**取 `nowTs.value`，不得改成当场 `Date.now()`：computed 的缓存只在
   * `nowTs` 被写时才失效，读一个"缓存外"的时钟会造出**看起来更准、实际会冻结**的形态 ——
   * 第一次求值后没人再推进它，分钟数就永远停在那一刻（实测把两条用例钉成永久不陈旧）。
   * 墙钟由 `begin()` 起的 tick 推进；没有 tick 就没有读者，这是同一条契约的两面。
   */
  function eachLiveTask (visit) {
    const now = nowTs.value
    for (const session of sessions.value) {
      for (const taskId of Object.keys(session.tasks)) {
        const task = session.tasks[taskId]
        if (isTerminal(task.phase)) continue
        visit(taskId, stallAnchor(task, session), now - stallAnchor(task, session))
      }
    }
  }

  const stalledTaskIds = computed(() => {
    const out = []
    eachLiveTask((taskId, anchor, idle) => {
      if (idle >= STALL_AFTER_MS) out.push(taskId)
    })
    return out
  })

  /** 存在非终态任务，且**全部**非终态任务都已无更新 ⇒ 才允许用户关掉面板 */
  const hasStalledRunning = computed(() => {
    let live = 0
    let stalled = 0
    eachLiveTask((taskId, anchor, idle) => {
      live += 1
      if (idle >= STALL_AFTER_MS) stalled += 1
    })
    return live > 0 && stalled === live
  })

  /** 无更新任务里最长的分钟数（供徽标文案与 title） */
  const maxStallMinutes = computed(() => {
    let worst = 0
    eachLiveTask((taskId, anchor, idle) => {
      if (idle >= STALL_AFTER_MS) worst = Math.max(worst, Math.floor(idle / MINUTE_MS))
    })
    return worst
  })

  function taskStallMinutes (taskId) {
    if (!taskId) return 0
    const now = nowTs.value
    for (const session of sessions.value) {
      const task = session.tasks[taskId]
      if (!task || isTerminal(task.phase)) return 0
      const idle = now - stallAnchor(task, session)
      return idle >= STALL_AFTER_MS ? Math.floor(idle / MINUTE_MS) : 0
    }
    return 0
  }

  function isTaskStalled (taskId) {
    return stalledTaskIds.value.includes(taskId)
  }

  function hasLiveTask () {
    for (const session of sessions.value) {
      for (const taskId of Object.keys(session.tasks)) {
        if (!isTerminal(session.tasks[taskId].phase)) return true
      }
    }
    return false
  }

  /**
   * 幂等启动。已活着就一个字节都不做 —— 重复注册定时器是本仓 `autoUpdater`
   * 那条「窗口重建时重复绑定全局监听器」的同型事故。
   */
  function begin () {
    if (timer !== null) return
    // 起表时先补一次章：面板"卸载→再挂载"后，nowTs 停的是上一次 tick 的时刻，
    // 不补就会让首帧把「已经 4 分钟没动」读成 0 分钟（最长 15s 后自愈，但那是错的）。
    nowTs.value = Date.now()
    timer = setInterval(() => {
      // 同域推进：判据与锚点都来自 Date.now()
      nowTs.value = Date.now()
      // 自泊：全部终态后没有人再需要墙钟推进，留在场上就是每条路由的白唤醒。
      // 下一次 begin()（面板展开/新任务登记）会重新起表。
      if (!hasLiveTask()) {
        clearInterval(timer)
        timer = null
      }
    }, STALL_TICK_MS)
  }

  /** 停机并交还句柄；宿主组件 onBeforeUnmount 必须调它 */
  function end () {
    if (timer === null) return
    clearInterval(timer)
    timer = null
  }

  /**
   * 供消费方直接读的那一面。
   * ⛔ 必须是 `reactive`，不得退回普通对象：模板里 `stall.hasStalledRunning` 只有在
   * reactive 对象上才会**自动解包 ref**。普通对象把 ComputedRef 交出去时，模板拿到的是
   * ref 对象本身 —— 恒为真值，于是"徽标一直显示无更新、转圈永远不停"，而且 setup 里
   * 写成 `stall.x` 的 computed 也不会报错（本批实测踩过，测试直接断出 ComputedRefImpl）。
   */
  const publicApi = reactive({
    stalledTaskIds,
    hasStalledRunning,
    maxStallMinutes,
    taskStallMinutes,
    isTaskStalled,
    beginStallClock: begin,
    endStallClock: end,
  })

  return { publicApi, begin, end }
}

/**
 * tracker 按 **store 实例**缓存，不是模块级单例。
 * 为什么不能用单例：模块级 `setInterval` 会跨 store 实例（多次 setActivePinia、
 * 测试逐个 case、以及未来任何第二个消费方）泄漏定时器，而「重复注册」这一类
 * 事故本仓已由 `autoUpdater` 钉过一次。WeakMap 让 store 实例被回收时 tracker 一起回收。
 * @type {WeakMap<object, ReturnType<typeof createStallTracker>['publicApi']>}
 */
const trackers = new WeakMap()

/**
 * 消费方入口：Panel / Session / 任务行都调它，拿到的是**同一个** tracker（同一份墙钟、
 * 同一个定时器）。宿主 store 不持有这一层 —— 它只为"让面板重新渲染"而存在，
 * 让 496 行的 store 再养一个 UI 时钟既越过 ≥500 行熔断，也是把生命周期交给错误的宿主。
 * @param {any} store usePublishProgressStore() 的实例
 */
export function usePublishProgressStall (store) {
  let api = trackers.get(store)
  if (!api) {
    api = createStallTracker({
      // getter 包装：computed 里读 store.sessions 才会被 pinia 的响应式追踪到
      sessions: { get value () { return store.sessions } },
      terminalPhases: TERMINAL_PHASES,
    }).publicApi
    trackers.set(store, api)
  }
  return api
}
