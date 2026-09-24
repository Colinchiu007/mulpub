/**
 * 风控挂起清单消费端（W1 §5 桌面 enforcement）— 纯 DI 工厂，不触碰渲染框架，node/jsdom 均可测。
 *
 * 职责：订阅主进程 publish:risk-suspended 广播（经 preload.onRiskSuspended → api.onRiskSuspended 注入），
 * 维护「权威挂起清单」（每次广播整体替换），并对外暴露「显式恢复」动作。
 *
 * 与 risk-hold-notifier 的分工：
 *   - risk-hold-notifier（§6.1）：订阅 publish:risk-hold，只做单条信息提示（瞬时）；
 *   - 本模块（§5）：订阅 publish:risk-suspended，维护权威挂起态 + 提供恢复入口（持久）。
 *
 * 合规红线：风控即停绝不自动换号绕过；resume 仅显式（人工确认）——
 *   恢复动作必须先经注入的 confirm()（默认返回 false，即不自动恢复），确认后才调 resumeRisk；
 *   「停止」即用户取消确认框，保持挂起态不变。
 *
 * @param {Object} deps
 * @param {(cb: Function) => Function} deps.onRiskSuspended - 订阅函数，返回取消订阅函数
 * @param {() => Promise<Object|Array>} [deps.listSuspended] - 拉取权威清单（start 时初次同步）
 * @param {(payload: Object) => Promise<Object>|Object} [deps.resumeRisk] - 调主进程恢复发布
 * @param {(event: Object) => void} deps.notify - 展示（注入以隔离 UI），事件形如
 *   { kind: 'suspended', suspended, count } / { kind: 'resumed', platform, accountId } /
 *   { kind: 'resumeFailed', platform, accountId, message }
 * @param {(info: Object) => Promise<boolean>|boolean} [deps.confirm] - 人工确认，默认不恢复
 */
export function createRiskSuspendedTracker(deps) {
  const { onRiskSuspended, notify } = deps || {}
  if (typeof onRiskSuspended !== 'function') throw new TypeError('createRiskSuspendedTracker: onRiskSuspended must be a function')
  if (typeof notify !== 'function') throw new TypeError('createRiskSuspendedTracker: notify must be a function')
  const listSuspended = typeof deps.listSuspended === 'function' ? deps.listSuspended : null
  const resumeRisk = typeof deps.resumeRisk === 'function' ? deps.resumeRisk : null
  const confirm = typeof deps.confirm === 'function' ? deps.confirm : async () => false
  // onChange：清单任何变更（含清空）都回调，供响应式镜像（与仅做 UI 提示的 notify 解耦）。
  const onChange = typeof deps.onChange === 'function' ? deps.onChange : null

  /** @type {Array<{platform: string, accountId: (string|null), reason: string, at: (number|null)}>} */
  let suspended = []
  let unsubscribe = null

  // 把任意来源（数组 / {suspended:[...]} / IPC envelope {code,data}）规整成同构清单
  function normalize(payload) {
    let arr = []
    if (Array.isArray(payload)) arr = payload
    else if (payload && Array.isArray(payload.suspended)) arr = payload.suspended
    else if (payload && payload.data && Array.isArray(payload.data)) arr = payload.data
    return arr
      .filter((x) => x && typeof x.platform === 'string')
      .map((x) => ({
        platform: x.platform,
        accountId: x.accountId == null ? null : x.accountId,
        reason: typeof x.reason === 'string' ? x.reason : '',
        at: x.at == null ? null : x.at,
      }))
  }

  function applyList(next) {
    suspended = next
    if (onChange) { try { onChange(suspended.slice()) } catch (_) { /* 镜像回调异常不影响内部状态 */ } }
  }

  // 广播处理：整体替换清单；仅在非空时提示（避免每帧空清单刷屏）
  function handle(payload) {
    const next = normalize(payload)
    applyList(next)
    if (next.length) notify({ kind: 'suspended', suspended: next.slice(), count: next.length })
    return next.slice()
  }

  function list() {
    return suspended.slice()
  }

  // 平台级挂起（accountId==null）覆盖该平台所有账号；细粒度仅命中该账号
  function isSuspended(platform, accountId) {
    const acc = accountId == null ? null : accountId
    return suspended.some(
      (x) => x.platform === platform && (x.accountId == null || x.accountId === acc),
    )
  }

  async function refresh() {
    if (!listSuspended) return suspended.slice()
    try {
      const res = await listSuspended()
      const arr = normalize(res)
      // 仅当确实拿到清单结构（数组 / data 数组 / suspended 数组）才覆盖，否则保留上次
      if (Array.isArray(res) || (res && res.data && Array.isArray(res.data)) || (res && Array.isArray(res.suspended))) {
        applyList(arr)
      }
    } catch (_) { /* 拉取失败保留上次清单，不抛出 */ }
    return suspended.slice()
  }

  function start() {
    if (unsubscribe) return unsubscribe
    unsubscribe = onRiskSuspended(handle)
    if (listSuspended) { refresh() }
    return unsubscribe
  }

  function stop() {
    if (typeof unsubscribe === 'function') {
      try { unsubscribe() } catch (_) { /* 取消订阅失败不抛出 */ }
    }
    unsubscribe = null
  }

  /**
   * 显式恢复：先人工确认，确认后才调 resumeRisk；成功回传最新清单并提示 resumed，失败提示 resumeFailed。
   * 用户取消确认 = 「停止/保持挂起」，不改动状态，返回 { ok:false, reason:'cancelled' }。
   */
  async function resume(platform, accountId) {
    if (typeof platform !== 'string' || !platform) return { ok: false, reason: 'invalid' }
    const acc = accountId == null ? null : accountId
    let okToResume = false
    try { okToResume = await confirm({ platform, accountId: acc }) } catch (_) { okToResume = false }
    if (!okToResume) return { ok: false, reason: 'cancelled' }
    if (!resumeRisk) return { ok: false, reason: 'no-handler' }
    try {
      const res = await resumeRisk({ platform, accountId: acc == null ? undefined : acc })
      const code = res && typeof res.code === 'number' ? res.code : -1
      if (code === 0) {
        const data = (res && res.data) || {}
        if (Array.isArray(data.suspended)) applyList(normalize(data.suspended))
        else await refresh()
        notify({ kind: 'resumed', platform, accountId: acc })
        return { ok: true, changed: data.changed !== false }
      }
      const message = (res && res.message) || ('code ' + code)
      notify({ kind: 'resumeFailed', platform, accountId: acc, message })
      return { ok: false, reason: 'error', message }
    } catch (e) {
      const message = e && e.message ? e.message : String(e)
      notify({ kind: 'resumeFailed', platform, accountId: acc, message })
      return { ok: false, reason: 'error', message }
    }
  }

  return { start, stop, list, handle, isSuspended, refresh, resume }
}
