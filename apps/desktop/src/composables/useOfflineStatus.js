// @ts-check
/**
 * useOfflineStatus.js — 离线状态 composable（从 App.vue 拆分；实时检测见 UX 审计 1.7）
 *
 * 职责：
 *   - 维护 isOffline / cachedTaskCount
 *   - init：读一次主进程状态 + 注册主进程 `offline:restored` + 挂浏览器 online/offline 监听
 *   - dispose：成理解绑（本仓多个 SPA 实例共存，泄漏的监听器会跨实例串写状态）
 *
 * 两条口径必须写清（原实现只在「重启后读一次」这条路上，中途断网用户看不到任何提示）：
 *   1. **连通性的第一响应来自浏览器事件**（Chromium 的网络栈），不等 IPC 往返 —— 横幅要在
 *      用户拔线的那一刻出现。
 *   2. **最终裁决权在主进程**：`offline-manager` 用 electron `net` 栈判连通性，还持有
 *      待发布队列深度（`cachedCount`）。因此每次事件后都向主进程复核一次，
 *      复核结果**覆盖**浏览器给的乐观值（两者不一致时以主进程为准，不得各写各的）。
 *   3. 复核失败（IPC 不可用）**不得静默**：保留浏览器值 + 留一条 warn。
 *      「读不到」与「没有离线」在界面上必须可区分，否则运维只能靠用户复现。
 */
import { ref } from 'vue'
import { getApi } from '@/api/electron-bridge'

/**
 * 「已恢复连接」回执的驻留时长（OfflineIndicator 消费）。
 * 单点导出常量而不是让组件写裸数字：测试要按同一口径推进假时钟，
 * 两处各写一份就会漂（本仓「预算与消费者必须引用同一常量」的先例）。
 */
export const RECOVERY_NOTICE_MS = 6000

/**
 * 离线状态 composable
 * @returns {{ isOffline: import('vue').Ref<boolean>, cachedTaskCount: import('vue').Ref<number>, init: Function, dispose: Function }}
 */
export function useOfflineStatus() {
  const isOffline = ref(false)
  const cachedTaskCount = ref(0)

  let attached = false
  let unsubscribeRestored = null
  let unsubscribeLost = null
  /**
   * 新鲜度序号：init 的首次读回与每次事件后的复核**共用**一个计数器。
   * 没有它时「谁最后到达谁说话」，而 IPC 不保证多次调用的响应按发起顺序到达 ——
   * 一次迟到的旧结论会把已确认的离线改回在线（也抹掉队列深度），且日志里完全正常。
   */
  let readEpoch = 0

  function onBrowserOnline () { setByBrowser(false) }
  function onBrowserOffline () { setByBrowser(true) }

  function setByBrowser (offline) {
    // 先按浏览器事件乐观更新，随后 reconcile 会用主进程结论覆盖它
    isOffline.value = offline
    reconcile()
  }

  /** 向主进程复核：连通性 + 待发布队列深度都以它为准 */
  function reconcile () {
    const api = getApi()
    if (!api || !api.offlineStatus) return
    const epoch = ++readEpoch
    try {
      Promise.resolve(api.offlineStatus()).then(function (res) {
        if (epoch !== readEpoch) return
        if (res && res.code === 0 && res.data) {
          isOffline.value = !!res.data.offline
          cachedTaskCount.value = res.data.cachedCount || 0
          return
        }
        console.warn('[offline] offlineStatus returned non-success; keeping browser-event connectivity:', res && res.code)
      }).catch(function (e) {
        console.warn('[offline] reconcile failed:', (e && e.message) || String(e))
      })
    } catch (e) {
      // 宿主同步抛错（例如 IPC 桥已销毁）同样要出声
      console.warn('[offline] reconcile call threw:', (e && e.message) || String(e))
    }
  }

  function init() {
    if (attached) return
    attached = true

    const api = getApi()
    if (api && api.offlineStatus) {
      const epoch = ++readEpoch
      try {
        Promise.resolve(api.offlineStatus()).then(function (res) {
          if (epoch !== readEpoch) return
          if (res && res.code === 0 && res.data) {
            isOffline.value = !!res.data.offline
            cachedTaskCount.value = res.data.cachedCount || 0
            return
          }
          console.warn('[offline] initial read returned no valid response; showing online:', res && res.code)
        }).catch(function (e) {
          console.warn('[offline] initial read failed:', (e && e.message) || String(e))
        })
      } catch (e) {
        console.warn('[offline] initial call threw:', (e && e.message) || String(e))
      }
    }

    if (api && api.onOfflineRestored) {
      try {
        unsubscribeRestored = api.onOfflineRestored(function (data) {
          isOffline.value = false
          cachedTaskCount.value = (data && data.cachedCount) || 0
          // QM-6 i1：恢复方向也必须作废在途的旧结论。此前只有 lost 那条走复核（它内部
          // ++readEpoch），restored 只赋值 ⇒ 一次更早发出的 `offlineStatus()`（例如浏览器
          // offline 事件触发的那次）可以在恢复推送**之后**才落地，把横幅从"已恢复"改回"离线"，
          // 且日志里两条读都完全正常。`reconcile()` 自增 epoch，正是"作废在途"这个动作本身。
          reconcile()
        })
      } catch (e) {
        console.warn('[offline] onOfflineRestored registration failed:', (e && e.message) || String(e))
      }
    }

    // 断网方向：主进程现在也会推（1.7 主进程半边）。它比浏览器事件更可信——
    // 待发布队列深度与缓存真源都在主进程，载荷里的 cachedCount 直接采纳，不再另起一次复核。
    // 浏览器 `offline` 事件继续保留：宿主不支持该订阅（旧 preload / 浏览器直开）时它是唯一通道。
    if (api && api.onOfflineLost) {
      try {
        unsubscribeLost = api.onOfflineLost(function (data) {
          isOffline.value = true
          cachedTaskCount.value = (data && data.cachedCount) || 0
          reconcile()
        })
      } catch (e) {
        console.warn('[offline] onOfflineLost registration failed:', (e && e.message) || String(e))
      }
    }

    window.addEventListener('offline', onBrowserOffline)
    window.addEventListener('online', onBrowserOnline)
  }

  function dispose() {
    if (!attached) return
    attached = false
    window.removeEventListener('offline', onBrowserOffline)
    window.removeEventListener('online', onBrowserOnline)
    for (const pair of [['offline:restored', unsubscribeRestored], ['offline:lost', unsubscribeLost]]) {
      if (typeof pair[1] !== 'function') continue
      try {
        pair[1]()
      } catch (e) {
        console.warn('[offline] unsubscribing ' + pair[0] + ' failed:', (e && e.message) || String(e))
      }
    }
    unsubscribeRestored = null
    unsubscribeLost = null
  }

  return {
    isOffline,
    cachedTaskCount,
    init,
    dispose,
  }
}
