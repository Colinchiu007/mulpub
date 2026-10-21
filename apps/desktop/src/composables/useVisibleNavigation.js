/**
 * useVisibleNavigation —— 把"导航"做成"当前聚焦面上看得见的跳转"（UX 审计 1.5）
 *
 * 为什么需要单一实现：本应用同时存在三种"当前页面"，只 push 主窗口路由是不够的。
 *   1. 聚焦内嵌主页实例（home-shell）：真正在显示的是那个 SPA 实例自己的路由，
 *      必须经 IPC 定向让它自己 router.push；主窗口那条隐藏路由推了也看不见。
 *   2. 聚焦普通网页标签：显示的是原生 WebContentsView 覆盖层，主窗口路由在它背后 ——
 *      只 push 就是"按了没反应"。必须先切回首页标签，再 push。
 *   3. 聚焦首页标签：维持主窗口路由跳转。
 *
 * 这三段原先只写在 `layouts/MpSidebar.vue` 的 `onNavClick` 里。全局快捷键那条路
 * （主进程 `app:navigate` → `App.vue` 的订阅回调）做的是裸 `router.push(route)`，
 * 于是同一个"去发布页"动作，鼠标点侧边栏看得见、按 Ctrl+Alt+P 看不见（审计 1.5 的现象）。
 * 两处行为不一致的根因不是漏了一个 if，而是**同一判断被抄了两遍**，所以这里收成一处。
 *
 * 依赖注入口径：本模块**不 import** electron-bridge。桥由调用方以 `apiGetter` 传入
 * （两个真实入口都传 `getApi`）。这样每个消费方的测试夹具不必为了间接导入而被迫
 * 补齐 `getApi` 导出——vi.mock 的工厂缺一个具名导出，会让整份测试文件在 import 期就炸。
 */

/**
 * @param {object} deps
 * @param {object} deps.tabStore tab store 实例（读取 activeTabIsHomeShell / isHomeTab / tabs / activeTabId）
 * @param {{push: (to: string) => any}} deps.router 主窗口路由
 * @param {() => any} deps.apiGetter 取 electronAPI 的函数，生产调用方传 `() => getApi()`。
 *   **必须是惰性求值的箭头函数**：在 setup 期直接绑定 `getApi` 会让每一个 mock
 *   `@/api/electron-bridge` 的测试夹具被迫补出该具名导出（Vite 的 mock 在**访问**时抛
 *   "No getApi export is defined"，而 setup 就是访问），与本单元无关的用例会整片变红。
 *   缺席时定向导航分支不生效、回落到主窗口路径，因此**调用点漏传必须被结构锁拦下**
 * @param {(msg: string, err?: unknown) => void} [deps.warn] 告警出口（测试注入，默认 console.warn）
 * @returns {{navigateVisibly: (to: string) => Promise<void>}}
 */
export function useVisibleNavigation ({
  tabStore,
  router,
  apiGetter,
  warn = (msg, err) => console.warn(msg, err),
}) {
  /**
   * 是否已经把导航交给内嵌主页实例自己处理。
   * 只有 IPC 明确回执 `handled:true` 才算handled；任何其他情况（无 API、无回执、
   * 回执非 0、抛错）一律**继续走主窗口路径**——降级比什么都不做更好，
   * 但绝不能把"没回执"读成"已处理"。
   * @returns {Promise<boolean>}
   */
  async function tryNavigateHomeShell (to) {
    if (!tabStore.activeTabIsHomeShell) return false
    const api = apiGetter ? apiGetter() : null
    try {
      const nav = api && api.pageManager && api.pageManager.navigateActiveHomeShell
      if (typeof nav !== 'function') return false
      const res = await nav.call(api.pageManager, to)
      return !!(res && res.code === 0 && res.data && res.data.handled)
    } catch (error) {
      warn('[sidebar] navigate home-shell failed', error)
      return false
    }
  }

  /** 聚焦在普通网页标签时，先切回首页标签，否则跳转发生在看不见的背后 */
  async function ensureVisibleTab () {
    if (tabStore.isHomeTab) return
    const homeTab = (tabStore.tabs || []).find((tab) => tab && tab.isHome)
    if (!homeTab || tabStore.activeTabId === homeTab.tabId) return
    try {
      await tabStore.switchToTab(homeTab.tabId)
    } catch (error) {
      // 切标签失败仍然继续 push：至少主窗口路由对了，用户切回首页时看到的是目标页
      warn('[sidebar] switch home failed', error)
    }
  }

  /**
   * @param {string} to 目标路由（必须以 / 开头的路径；非法输入直接不动作）
   */
  async function navigateVisibly (to) {
    if (typeof to !== 'string' || !to) return
    if (await tryNavigateHomeShell(to)) return
    await ensureVisibleTab()
    try {
      await router.push(to)
    } catch (error) {
      warn('[sidebar] navigate failed', error)
    }
  }

  return { navigateVisibly }
}
