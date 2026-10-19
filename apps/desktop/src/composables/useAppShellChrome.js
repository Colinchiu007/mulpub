/**
 * 壳层 chrome 装配桥：公告横幅的顶部下移上报 + 左侧菜单折叠的多窗口同步。
 *
 * 为什么从 App.vue 抽出来：这两段都是「订阅宿主事件 + 上报 IPC」的装配代码，
 * 与壳层的模板渲染无关；留在 App.vue 里壳层会继续长（max-lines 上限 500）。
 * 抽出不改变行为：生命周期钩子仍在 App 组件的 setup 顶层注册（Vue 的
 * onMounted/onBeforeUnmount 归属调用时所在的组件实例）。
 */
import { onBeforeUnmount, onMounted } from 'vue'
import { getApi, invokePageManager } from '@/api/electron-bridge'
import { applyRemoteCollapsed, reportSidebarCollapsed } from '@/stores/sidebar-collapse'

export function useAppShellChrome ({ isHomeShell = false } = {}) {
  /**
   * 公告横幅高度 → 内嵌视图顶部下移（阶段 1.2 / audit-6）。
   * 表现层不直接摸 IPC：横幅只上报自己多高，由壳层决定这条 chrome 怎么和原生图层共处。
   * 0 是有效值（横幅消失/卸载），主进程侧 setTopInset 会据此把内嵌视图收回到 76px。
   * @param {number} px
   */
  function onChromeInset (px) {
    invokePageManager('setTopInset', px)
  }

  // 多窗口折叠同步（2026-10-18）：主进程是应用级唯一真源，任一窗口点击后它会重排全部
  // 内嵌视图并向每个窗口广播。本窗口若不跟上，DOM 侧栏还显示着却被原生视图盖住
  // ⇒ 侧栏看得见却点不动（点击错乱）。
  let unsubscribeSidebarCollapsed = null
  onMounted(() => {
    // 启动恢复折叠态：主进程默认展开；若用户上次退出时是收起态，这里补一次上报，
    // 否则之后新建的浏览器/登录标签 WebContentsView 仍从 x=200 开始，左侧留死区。
    if (!isHomeShell) reportSidebarCollapsed()

    // preload 未暴露该方法（老版本桥）时静默跳过，绝不影响壳层挂载。
    const pm = getApi() && getApi().pageManager
    if (pm && typeof pm.onSidebarCollapsedChanged === 'function') {
      unsubscribeSidebarCollapsed = pm.onSidebarCollapsedChanged((collapsed) => {
        applyRemoteCollapsed(collapsed)
      })
    }
  })

  onBeforeUnmount(() => {
    if (typeof unsubscribeSidebarCollapsed === 'function') unsubscribeSidebarCollapsed()
    unsubscribeSidebarCollapsed = null
  })

  return { onChromeInset }
}

