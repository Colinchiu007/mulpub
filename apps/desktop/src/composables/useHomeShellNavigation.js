import { getApi } from '@/api/electron-bridge'
import { useTabStore } from '@/stores/tab'
import { useRouter } from 'vue-router'

/**
 * 导航的唯一实现（UX-AUDIT-2026-10-17 阶段 1.5）
 *
 * 此前这段三段式只写在 `MpSidebar.vue` 的点击处理里，而全局快捷键落点是
 * `App.vue` 的裸 `router.push(route)` —— 同一个「跳到某页」有两套语义：
 * 鼠标点击会让变化可见，键盘快捷键在「当前是网页标签」时把路由推到用户看不见的
 * 后台首页标签上（按 Ctrl+Alt+D 像没反应）。本模块把判据收成一份，鼠标与键盘共用。
 *
 * 三段式（顺序不可换，每条各有一个失败模式）：
 *  ① 当前聚焦内嵌主页实例（home-shell）→ 经 IPC 定向让**该实例自己** router.push，
 *     主窗口的隐藏路由保持不动；`handled` 为真即结束。
 *  ② 当前聚焦普通网页标签 → 先切回首页标签，否则路由变化发生在看不见的地方。
 *  ③ 落到主窗口 router.push。
 *
 * ①②的失败都只停对应步骤、不升级成整次导航失败（console.warn 留痕），
 * 因为「点侧边栏彻底没反应」比「少了定向」更糟。
 */
export async function navigateToHomeShellRoute (to, deps) {
  const { tabStore, router, api = getApi(), warn = (msg, err) => console.warn(msg, err) } = deps || {}
  if (typeof to !== 'string' || !to) return false

  if (tabStore.activeTabIsHomeShell) {
    try {
      const res = api && api.pageManager && typeof api.pageManager.navigateActiveHomeShell === 'function'
        ? await api.pageManager.navigateActiveHomeShell(to)
        : null
      if (res && res.data && res.data.handled) return true
    } catch (error) {
      warn('[nav] navigate home-shell failed', error)
    }
  }

  if (!tabStore.isHomeTab) {
    const homeTab = tabStore.tabs.find((tab) => tab.isHome)
    if (homeTab && tabStore.activeTabId !== homeTab.tabId) {
      try {
        await tabStore.switchToTab(homeTab.tabId)
      } catch (error) {
        warn('[nav] switch home failed', error)
      }
    }
  }

  try {
    await router.push(to)
  } catch (error) {
    warn('[nav] navigate failed', error)
  }
  return true
}

/** 组件内用法：在 setup 里调用一次，拿到与其它入口同一段实现的 navigate */
export function useHomeShellNavigation () {
  const tabStore = useTabStore()
  const router = useRouter()
  return {
    navigate: (to) => navigateToHomeShellRoute(to, { tabStore, router }),
  }
}
