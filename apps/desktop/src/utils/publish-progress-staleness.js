/**
 * publish-progress-staleness —— 发布进度「无更新」判据（ux-audit-progress-watchdog，阶段 1.8）
 *
 * 单一实现处：阈值解析与陈旧判定只在这里，store 与面板都调用它，不得各抄一份
 * （本仓纪律：判定逻辑按语义特征拆成独立条件，取值口径一处持有）。
 *
 * 动因：`task.lastEventAt` 在 store 三处写入却**没有任何读者**（死观测字段）。任务在主进程
 * 侧卡住后不再发事件，面板便永远停在「进行中」，关闭按钮永久 disabled（见
 * PublishProgressPanel.vue 的 `:disabled="store.hasRunning"`），用户被自己的进度面板锁死。
 *
 * 计时器不归这里（纯函数，时钟由调用方注入）——与 usePublishProgressAutoCollapse 的
 * 「计时器归组件所有，store 保持纯状态」同源。
 */

/**
 * 默认陈旧阈值：3 分钟无事件（审计 1.8 给定的判据时长）。
 *
 * 这里**刻意不做环境变量覆盖**：渲染进程没有可用的 env 通道 —— Vite 在产物里把
 * `process.env` 打成空对象桩（实测 src 下只有 `process.env.NODE_ENV` 这种被静态替换的写法能成立），
 * 加一个用户根本设不动的旋钮等于给自己造一条装饰性防线。要改阈值就走设置页（真持久化），
 * 而不是环境变量。
 */
export const DEFAULT_STALE_AFTER_MS = 180_000

/** 与 store 的 TERMINAL_PHASES 同语义：进入这些相位后不再期待新事件。 */
const TERMINAL_PHASES = new Set(['success', 'failed', 'cancelled'])

function isFiniteNumber(v) {
  return typeof v === 'number' && Number.isFinite(v)
}

/**
 * 判定「运行中的发布是否已无更新」。
 *
 * 口径三条：
 * 1. 射程只含 **status==='running' 的会话里的非终态任务**（已结束的不必再催更）。
 * 2. 取**全局最近一次事件**（跨会话跨任务）作为锚点 —— 面板整体只回答「还有没有动静」，
 *    任一任务刚有事件就不算「无更新」。
 * 3. 锚点取不到（任务从未有事件且会话登记时刻缺失）时**不产出结论**（stale=false），
 *    不得凭猜把用户可点的解禁按钮打开，也不谎报分钟数。
 *
 * @param {Array<object>|null|undefined} sessions store 里的会话数组
 * @param {number} now 当前时刻（调用方注入，便于假时钟测试）
 * @param {number} [staleAfterMs] 阈值毫秒；非法（非有限正数）回落默认，不恒陈旧
 * @returns {{stale: boolean, minutes: number, lastEventAt: number|null}}
 */
export function computeStaleInfo(sessions, now, staleAfterMs = DEFAULT_STALE_AFTER_MS) {
  const threshold = isFiniteNumber(staleAfterMs) && staleAfterMs > 0
    ? staleAfterMs
    : DEFAULT_STALE_AFTER_MS
  const idle = { stale: false, minutes: 0, lastEventAt: null }
  if (!Array.isArray(sessions) || !isFiniteNumber(now)) return idle

  let lastEventAt = null
  for (const session of sessions) {
    if (!session || session.status !== 'running') continue
    const tasks = session.tasks
    if (!tasks || typeof tasks !== 'object') continue
    for (const key of Object.keys(tasks)) {
      const t = tasks[key]
      if (!t || TERMINAL_PHASES.has(t.phase)) continue
      // 任务尚未产出任何事件时，回落「我们知道它存在」的那一刻
      const anchor = isFiniteNumber(t.lastEventAt) ? t.lastEventAt
        : (isFiniteNumber(session.createdAt) ? session.createdAt : null)
      if (anchor === null) continue
      if (lastEventAt === null || anchor > lastEventAt) lastEventAt = anchor
    }
  }
  if (lastEventAt === null) return idle

  const elapsed = now - lastEventAt
  if (elapsed < threshold) return { stale: false, minutes: 0, lastEventAt }
  // 陈旧时分钟数至少为 1：60s 阈值下 90s 无事件不能显示成「0 分钟无更新」
  return { stale: true, minutes: Math.max(1, Math.floor(elapsed / 60_000)), lastEventAt }
}
