import { ref } from 'vue'
import { getApi } from '@/api/electron-bridge'

/**
 * 离线状态（UX-AUDIT-2026-10-17 阶段 1.7 / audit-7 修正版）
 *
 * 原实现只在**挂载那一刻**拉一次 `offline:status`，此后浏览器/Electron 侧发生的
 * 断网/恢复都不会再进来 ⇒ 启动时在线、中途断网，横幅永不出现，用户直到采集/发布
 * 报错才知道是网络问题。主进程其实早注册了 `net.on("online"/"offline")`，
 * 缺的是**断网方向的推送通道**（本批已在 offline-manager + preload 补 `offline:lost`）。
 *
 * 三条通道并存，不是冗余，是三种宿主：
 *  ① 主进程 `offline:lost` / `offline:restored`（Chromium 网络栈的真实观测）
 *  ② 渲染进程 `window` 的 `online` / `offline` 事件（主窗口隐藏或未就绪时的兜底）
 *  ③ 挂载时的一次 `offlineStatus()` 拉取（首帧正确性）
 * 任一通道失败都只停那一通道，不冒泡（本模块是旁路观测，不得影响主流程）。
 *
 * 监听器必须成对释放：`dispose()` 返回后再次 `init()` 会重新注册。
 */
export function useOfflineStatus () {
  const isOffline = ref(false)
  const cachedTaskCount = ref(0)
  const loaded = ref(false)
  const removers = []

  function safeCall (fn, label) {
    try {
      return Promise.resolve(fn())
    } catch (error) {
      console.warn('[offline] ' + label + ' failed:', error && error.message)
      return Promise.resolve(null)
    }
  }

  function applyStatus (res) {
    if (res && res.code === 0 && res.data) {
      isOffline.value = !!res.data.offline
      cachedTaskCount.value = res.data.cachedCount || 0
    }
    loaded.value = true
  }

  function init () {
    const api = getApi()

    if (api) {
      if (typeof api.offlineStatus === 'function') {
        safeCall(() => api.offlineStatus(), 'offlineStatus').then(applyStatus)
      }
      if (typeof api.onOfflineLost === 'function') {
        const off = api.onOfflineLost((data) => {
          isOffline.value = true
          if (data && typeof data.cachedCount === 'number') cachedTaskCount.value = data.cachedCount
        })
        if (typeof off === 'function') removers.push(off)
      }
      if (typeof api.onOfflineRestored === 'function') {
        const off = api.onOfflineRestored((data) => {
          isOffline.value = false
          cachedTaskCount.value = (data && data.cachedCount) || 0
        })
        if (typeof off === 'function') removers.push(off)
      }
    }

    if (typeof window !== 'undefined') {
      const onOffline = () => { isOffline.value = true }
      const onOnline = () => {
        isOffline.value = false
        // 浏览器侧只知道「连上了」，不知道队列还剩多少 ⇒ 回主进程取真值，
        // 不得凭猜测把计数清零（那会让「N 个待发布」在恢复瞬间消失）
        const freshApi = getApi()
        if (freshApi && typeof freshApi.offlineStatus === 'function') {
          safeCall(() => freshApi.offlineStatus(), 'offlineStatus(after online)').then(applyStatus)
        }
      }
      window.addEventListener('offline', onOffline)
      window.addEventListener('online', onOnline)
      removers.push(() => window.removeEventListener('offline', onOffline))
      removers.push(() => window.removeEventListener('online', onOnline))
    }
  }

  function dispose () {
    while (removers.length > 0) {
      const off = removers.pop()
      try { off() } catch (e) { /* 单个释放失败不得阻断其余 */ }
    }
  }

  return { isOffline, cachedTaskCount, loaded, init, dispose }
}
