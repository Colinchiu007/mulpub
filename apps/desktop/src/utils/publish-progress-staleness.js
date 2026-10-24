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

/** 终态相位的唯一定义在 publish-phases.js（store 与本文件共用，QM-6 i2） */
import { PUBLISH_TERMINAL_PHASES } from './publish-phases.js'

const TERMINAL_PHASES = PUBLISH_TERMINAL_PHASES

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
    const sessionCreated = isFiniteNumber(session.createdAt) ? session.createdAt : null
    let sessionAnchor = null
    const tasks = session.tasks
    if (tasks && typeof tasks === 'object') {
      for (const key of Object.keys(tasks)) {
        const t = tasks[key]
        if (!t || TERMINAL_PHASES.has(t.phase)) continue
        // 任务尚未产出任何事件时，回落「我们知道它存在」的那一刻
        const anchor = isFiniteNumber(t.lastEventAt) ? t.lastEventAt : sessionCreated
        if (anchor === null) continue
        if (sessionAnchor === null || anchor > sessionAnchor) sessionAnchor = anchor
      }
    }
    // 这个会话推不出任何任务锚点（tasks 为空；或全部任务已终态而会话还没被移成 done 的
    // 异常形态）时，退回会话登记时刻：否则 hasRunning 为真而 stale 恒 false，
    // × 会被永久钉死 —— 与本 PR 要消灭的症状同形（QM-6 i1）。
    // 注意这是**逐会话**的兜底，不是全局取 max(createdAt, 任务锚点)：
    // 后者会把「刚登记的会话里那条早就停住的任务」洗成新鲜，正常场景反而判不出来。
    if (sessionAnchor === null) sessionAnchor = sessionCreated
    if (sessionAnchor === null) continue
    if (lastEventAt === null || sessionAnchor > lastEventAt) lastEventAt = sessionAnchor
  }
  if (lastEventAt === null) return idle

  const elapsed = now - lastEventAt
  if (elapsed < threshold) return { stale: false, minutes: 0, lastEventAt }
  // 陈旧时分钟数至少为 1：60s 阈值下 90s 无事件不能显示成「0 分钟无更新」
  return { stale: true, minutes: Math.max(1, Math.floor(elapsed / 60_000)), lastEventAt }
}
