import { ref } from 'vue'

/**
 * SPA 路由历史栈跟踪（vue-router hash 模式）
 *
 * 背景（2026-09-15 修复）：home 标签是虚拟标签（无 WebContentsView），主进程
 * webview-manager 对其 canGoBack/canGoForward 恒返回 false。而所有 SPA 页面
 * （侧边栏进入的 Vue 页面）都运行在 home 标签内，其「后退/前进」依赖 vue-router
 * 的历史栈 —— 若直接沿用主进程状态，NavBar 左右箭头按钮会被永久禁用。
 *
 * 本 composable 通过 window.history.state.position（vue-router 4 在每次导航时
 * 写入的单调递增栈索引）跟踪 SPA 历史栈位置，并区分两种导航来源：
 * - popstate 触发（router.back()/forward()）：前进栈可能仍存在，maxSeen 不收缩；
 * - 普通导航（router.push 等）：前进历史被截断，maxSeen 重置为当前位置。
 *
 * 返回值：
 * - canGoBack:    position > 0（栈首之前无历史）
 * - canGoForward: position < maxSeen（前方还有可前进的记录）
 *
 * 已知局限：position 不可读（history.state 为 null）时保持上一次状态；
 * 浏览器/WebView 外部前进（键盘手势等）同样经 popstate 感知，无需额外处理。
 */
export function useSpaNavHistory (router) {
  const canGoBack = ref(false)
  const canGoForward = ref(false)

  let maxSeen = 0
  let lastPos = -1
  let viaHistory = false
  let removeAfterEach = null
  let attached = false

  function readPosition () {
    const state = window.history.state
    return state && typeof state.position === 'number' ? state.position : null
  }

  function sync () {
    const pos = readPosition()
    // position 未变化时跳过（popstate 已 sync，随后的 afterEach 无需重复处理，
    // 否则会把 popstate 导航误判为新导航而收缩前进栈）
    if (pos === null || pos === lastPos) return
    lastPos = pos
    if (viaHistory) {
      // back/forward：前进栈可能仍存在，不收缩 maxSeen
      viaHistory = false
    } else {
      // 新导航：截断前进历史
      maxSeen = pos
    }
    if (pos > maxSeen) maxSeen = pos
    canGoBack.value = pos > 0
    canGoForward.value = pos < maxSeen
  }

  function onPopState () {
    // 真实浏览器语义：popstate 触发时 history.state 已是目标条目的状态
    viaHistory = true
    sync()
  }

  /**
   * 绑定路由监听。在组件 onMounted 中调用一次。
   * 初始路由未就绪时等待 router.isReady() 后做首次同步。
   */
  function attach () {
    if (attached) return
    attached = true
    window.addEventListener('popstate', onPopState)
    removeAfterEach = router.afterEach(() => sync())
    if (router.currentRoute.value.name) {
      sync()
    } else {
      router.isReady().then(() => sync()).catch(() => { /* 路由失败不影响按钮态 */ })
    }
  }

  /** 解绑监听。在组件 onBeforeUnmount 中调用。 */
  function dispose () {
    if (!attached) return
    attached = false
    window.removeEventListener('popstate', onPopState)
    if (typeof removeAfterEach === 'function') removeAfterEach()
    removeAfterEach = null
  }

  return { canGoBack, canGoForward, attach, dispose }
}
