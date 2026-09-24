import { defineStore } from 'pinia'
import { ref } from 'vue'
import { onRiskSuspended, listSuspendedRisk, resumeRisk } from '@/api/publisher'
import { createRiskSuspendedTracker } from '@/services/risk-suspended-tracker'

/**
 * 风控挂起态 Store（W1 §5 桌面 enforcement 消费端）
 *
 * 职责：以响应式镜像维护「权威挂起清单」，供账号列表徽标 / 恢复入口消费。
 * 真源仍是主进程 riskSuspender —— 本 store 只订阅 publish:risk-suspended 广播，
 * 不自行判定风控，也不自动恢复（恢复必须经 start({confirm}) 注入的人工确认）。
 *
 * confirm / notify 由 main.js 注入（依赖 ElMessageBox / i18n，避免 store 直接耦合 UI）。
 */
export const useRiskStore = defineStore('risk', () => {
  /** @type {import('vue').Ref<Array<{platform:string,accountId:(string|null),reason:string,at:(number|null)}>>} */
  const suspended = ref([])
  let tracker = null

  function isSuspended(platform, accountId) {
    const acc = accountId == null ? null : accountId
    return suspended.value.some(
      (x) => x && x.platform === platform && (x.accountId == null || x.accountId === acc),
    )
  }

  function count() {
    return suspended.value.length
  }

  // start 幂等：注入人工确认与展示回调后订阅广播并初次拉取权威清单
  function start(hooks = {}) {
    if (tracker) return tracker
    tracker = createRiskSuspendedTracker({
      onRiskSuspended,
      listSuspended: listSuspendedRisk,
      resumeRisk,
      confirm: typeof hooks.confirm === 'function' ? hooks.confirm : undefined,
      // 响应式镜像的唯一来源：tracker 清单任何变更（广播/初次 refresh/恢复后）都经 onChange 回传。
      onChange: (list) => { suspended.value = Array.isArray(list) ? list.slice() : [] },
      notify: (event) => {
        if (typeof hooks.notify === 'function') hooks.notify(event)
      },
    })
    tracker.start()
    return tracker
  }

  async function resume(platform, accountId) {
    if (!tracker) return { ok: false, reason: 'not-started' }
    // 恢复后的清单变更由 tracker 内部 onChange 同步，无需在此重读
    return tracker.resume(platform, accountId)
  }

  async function refresh() {
    if (!tracker) return suspended.value.slice()
    await tracker.refresh()
    return suspended.value.slice()
  }

  function stop() {
    if (tracker) {
      tracker.stop()
      tracker = null
    }
  }

  // 测试/本地兜底：直接注入清单（不触发主进程）
  function setSuspended(list) {
    suspended.value = Array.isArray(list) ? list.slice() : []
  }

  return { suspended, isSuspended, count, start, stop, resume, refresh, setSuspended }
})
