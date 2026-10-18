import { computed, ref } from 'vue'

/**
 * 发布进度「陈旧看门狗」（UX-AUDIT-2026-10-17 阶段 1.8 / audit-15）
 *
 * 从 `stores/publishProgress.js` 拆出：原判据把 store 推过 500 行的新代码上限，
 * 而这段逻辑本身与 store 的事件路由无耦合（只读 sessions 里每个任务的相位与事件时刻），
 * 拆出来既满足门禁也让"什么时候算停滞"这条判据可被单独测。
 *
 * 判据（三个"不谎报"边界不可省）：
 *  - 取所有 running 任务里**最近一次事件**时刻：任一任务刚动过 ⇒ 不算整体停滞；
 *  - `lastEventAt` 与 `startedAt` 都缺 ⇒ 该任务不提供锚点（无从判断时沉默）；
 *  - 全部终态 ⇒ `runningTasks === 0` ⇒ 不判停滞（那是完成，不是卡住）。
 */
export const STALE_AFTER_MS = 180000
export const STALE_TICK_MS = 15000

function taskAnchorAt (task) {
  if (!task) return null
  if (typeof task.lastEventAt === 'number' && task.lastEventAt > 0) return task.lastEventAt
  if (typeof task.startedAt === 'number' && task.startedAt > 0) return task.startedAt
  return null
}

export function createStallTracker ({ sessions, isTerminalPhase, afterMs = STALE_AFTER_MS, tickMs = STALE_TICK_MS }) {
  const nowTick = ref(Date.now())
  let timer = null

  const stallInfo = computed(() => {
    let anchor = null
    let runningTasks = 0
    for (const session of sessions.value) {
      if (session.status !== 'running') continue
      for (const taskId of session.taskOrder) {
        const task = session.tasks[taskId]
        if (!task || isTerminalPhase(task.phase)) continue
        runningTasks += 1
        const at = taskAnchorAt(task)
        if (at === null) continue
        if (anchor === null || at > anchor) anchor = at
      }
    }
    if (runningTasks === 0 || anchor === null) {
      return { stalled: false, minutes: 0, runningTasks }
    }
    const idleMs = Math.max(0, nowTick.value - anchor)
    return { stalled: idleMs >= afterMs, minutes: Math.floor(idleMs / 60000), runningTasks }
  })

  return {
    stallInfo,
    hasStalledTasks: computed(() => stallInfo.value.stalled),
    // 与订阅同生命周期：调用方必须保证 start 幂等（重复调用不得挂第二个 interval）
    start () {
      if (timer) return
      timer = setInterval(() => { nowTick.value = Date.now() }, tickMs)
      if (typeof timer?.unref === 'function') timer.unref()
    },
    stop () {
      if (!timer) return
      clearInterval(timer)
      timer = null
    },
  }
}
