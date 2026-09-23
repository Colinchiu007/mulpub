/**
 * 风控挂起通知消费端（W1 §6.1）— 纯 DI 工厂，不触碰渲染框架，node/jsdom 均可测。
 *
 * 职责：订阅主进程 publish:risk-hold 信号（经 preload.onRiskHold → api.onRiskHold 注入），
 * 把每条信号规整成事件、累积近端列表（默认上限 50），并交由注入的 notify 展示。
 *
 * 合规红线：本模块只做「识别 + 信息提示」，绝不宣称已自动挂起队列 / 自动恢复；
 * 真正的「暂停后续发布」由桌面 riskSuspender 接派发前置守卫承担（§5 后续切片），
 * 端到端正确性验收绑定 §7 真实风控触发（用户门槛）。
 *
 * @param {Object} deps
 * @param {(cb: Function) => Function} deps.onRiskHold - 订阅函数，返回取消订阅函数
 * @param {(event: Object) => void} deps.notify - 展示单条事件（注入以隔离 UI）
 * @param {() => number} [deps.now] - 时间戳来源（测试可注入）
 * @param {number} [deps.maxRecent] - 近端列表上限，默认 50
 */
export function createRiskHoldNotifier(deps) {
  const { onRiskHold, notify } = deps || {}
  if (typeof onRiskHold !== 'function') throw new TypeError('createRiskHoldNotifier: onRiskHold must be a function')
  if (typeof notify !== 'function') throw new TypeError('createRiskHoldNotifier: notify must be a function')
  const now = typeof deps.now === 'function' ? deps.now : () => Date.now()
  const maxRecent = Number.isFinite(deps.maxRecent) && deps.maxRecent > 0 ? deps.maxRecent : 50

  const recent = []
  let unsubscribe = null

  function handle(payload) {
    const p = payload || {}
    const event = {
      platform: typeof p.platform === 'string' ? p.platform : '',
      accountId: p.accountId == null ? null : p.accountId,
      taskId: p.taskId == null ? null : p.taskId,
      error: typeof p.error === 'string' ? p.error : '',
      at: now(),
    }
    recent.push(event)
    while (recent.length > maxRecent) recent.shift()
    notify(event)
    return event
  }

  function start() {
    if (unsubscribe) return unsubscribe
    unsubscribe = onRiskHold(handle)
    return unsubscribe
  }

  function stop() {
    if (typeof unsubscribe === 'function') {
      try { unsubscribe() } catch (_) { /* 取消订阅失败不抛出 */ }
    }
    unsubscribe = null
  }

  function list() {
    return recent.slice()
  }

  return { start, stop, list, handle }
}
