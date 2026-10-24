/**
 * startup-promise —— 首屏启动链的 promise 收口原语（UX 审计 1.2 家族 / Unhandled Rejection 收敛）
 *
 * 要解决的问题：`onMounted` 里 `foo()` 直接丢弃返回值的写法，在**两条方向**上都会坏：
 *  1. 被调函数返回 rejected promise ⇒ 没有任何 handler ⇒ 进程级 unhandledRejection
 *     （本仓把它列为独立缺陷家族；症状是控制台一条噪声 + 真实故障被埋在里面）；
 *  2. 顺手写 `.catch(() => {})` ⇒ 不再炸，但把失败**整条吞掉**，
 *     日志零痕迹（AGENTS「静默配置失败必须留日志」明禁）。
 *
 * 所以本原语一次同时守这两条：就地接住 + 必须出声。它是**旁路**，
 * 不改变任何业务结果，也不得被 `await`（否则首屏又阻塞在 IPC 之后，违反 QM-2）。
 *
 * 入参接受两种形态：
 *  - promise（或任何可 `Promise.resolve` 的值）—— 覆盖 `foo()` 已经返回 promise 的调用点；
 *  - thunk（函数）—— 覆盖 `foo()` **同步抛错**的调用点：同步异常发生在实参求值阶段，
 *    原语看不到，所以那种形态必须写成 `() => foo()` 才能纳入收口。
 */

const PREFIX = '[startup]'

function describeReason (reason) {
  if (reason instanceof Error) return reason.message || String(reason)
  if (typeof reason === 'string' && reason.trim() !== '') return reason
  if (reason === undefined) return 'undefined'
  if (reason === null) return 'null'
  try {
    const text = String(reason)
    return text.trim() === '' ? JSON.stringify(reason) ?? text : text
  } catch (_) {
    return '<unstringifiable>'
  }
}

/**
 * @param {string} label 失败归因标签（必须能指认是哪一步，如 'account-groups'）
 * @param {Promise|any|Function} task promise / thunk / 任意值
 * @param {(msg: string) => void} [warn] 日志出口；默认**真** console.warn。
 *        默认值不得是 noop —— 生产接线不传 warn 时，「失败必须出声」这条契约就成了空话
 *        （与 useFirstRunGate 的 QM-6 i6 同一格）。
 * @returns {void} 永远不返回 promise、永远不抛
 */
export function terminateStartupPromise (label, task, warn = (msg) => console.warn(msg)) {
  const report = (reason) => {
    warn(`${PREFIX} ${String(label)} failed: ${describeReason(reason)}`)
  }
  // thunk 与同步抛错走这一支；promise 走下一支。
  try {
    const maybe = typeof task === 'function' ? task() : task
    Promise.resolve(maybe).then(undefined, report)
  } catch (error) {
    report(error)
  }
}
