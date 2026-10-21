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
 * 离线状态 composable
 * @returns {{ isOffline: import('vue').Ref<boolean>, cachedTaskCount: import('vue').Ref<number>, init: Function, dispose: Function }}
 */
export function useOfflineStatus() {
  const isOffline = ref(false)
  const cachedTaskCount = ref(0)

  let attached = false
  let unsubscribeRestored = null

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
    try {
      Promise.resolve(api.offlineStatus()).then(function (res) {
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
      try {
        Promise.resolve(api.offlineStatus()).then(function (res) {
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
        })
      } catch (e) {
        console.warn('[offline] onOfflineRestored registration failed:', (e && e.message) || String(e))
      }
    }

    // 中途断网的那条边原先没人监听：主进程只在「恢复」时通知前端
    window.addEventListener('offline', onBrowserOffline)
    window.addEventListener('online', onBrowserOnline)
  }

  function dispose() {
    if (!attached) return
    attached = false
    window.removeEventListener('offline', onBrowserOffline)
    window.removeEventListener('online', onBrowserOnline)
    if (typeof unsubscribeRestored === 'function') {
      try {
        unsubscribeRestored()
      } catch (e) {
        console.warn('[offline] unsubscribing offline:restored failed:', (e && e.message) || String(e))
      }
    }
    unsubscribeRestored = null
  }

  return {
    isOffline,
    cachedTaskCount,
    init,
    dispose,
  }
}
