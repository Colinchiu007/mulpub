import { ref } from 'vue'
import { invokePageManager } from '@/api/electron-bridge'

/**
 * 全局左侧菜单「收起 / 展开」状态（模块单例，非 Pinia store）。
 *
 * 为什么是模块单例而不是 Pinia：它被壳层（App.vue）与 TabBar 同时消费，
 * 且不依赖任何业务 store 的生命周期；与 `stores/settings-dialog.js` 同族。
 *
 * 三条不变量（PRD-SIDEBAR-COLLAPSE-TOGGLE-2026-10-18 §五）：
 *  1. **本地持久化**：localStorage key `mulpub.ui.sidebarCollapsed`，`'1'` = 收起，
 *     其余（缺失 / `'0'` / 非法值）一律按展开处理。读写全部 try/catch：
 *     Electron 关闭存储 / 隐私模式 / 磁盘配额都可能抛错，持久化失败不得影响本次会话。
 *  2. **主进程同步**：收起时左侧菜单是 `display:none`，但浏览器/账号/登录标签的
 *     WebContentsView 是**原生图层**，不跟随 CSS 布局；不同步的话它们仍从 x=200
 *     开始，左侧会留出 200px 死区。因此每次状态变化都上报一次
 *     `pageManager.setSidebarCollapsed(boolean)`。
 *  3. **失败静默降级**：非 Electron（浏览器打开 Vite）、老版本 preload（方法不存在）、
 *     未登录时 IPC 权限拒绝 —— 一律只影响主进程同步，按钮仍能切换界面本身。
 */

/** localStorage key：跨重启记住用户的折叠偏好。 */
export const SIDEBAR_COLLAPSED_STORAGE_KEY = 'mulpub.ui.sidebarCollapsed'

function readStoredCollapsed () {
  try {
    return globalThis.localStorage?.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY) === '1'
  } catch {
    // 存储不可用：按默认展开处理，不阻塞首屏
    return false
  }
}

/** 当前是否已收起左侧菜单（唯一真源；消费方只读，写入走 set/toggle/applyRemote）。 */
export const sidebarCollapsed = ref(readStoredCollapsed())

/**
 * 状态变更订阅者集合。
 *
 * 为什么需要：折叠是**应用级**状态（主进程 WebviewManager 是唯一真源），
 * 但每个窗口的渲染进程各持有一份 ref 副本。窗口 A 点收起后，主进程会把**所有**
 * 内嵌视图重排成 x=0 全宽；窗口 B 若不跟上，它的 DOM 侧栏还显示着、却被原生
 * 视图盖住 ⇒ 点击错乱（侧栏看得见却点不动）。订阅机制让主进程广播能推到这里。
 *
 * 回环防护分两道：
 *   ① applyRemoteCollapsed 不持久化、不上报 IPC（状态本就来自主进程广播）；
 *   ② 所有写入路径都有「同值即短路」，重复值不会再次触发通知。
 */
const subscribers = new Set()

function notify (collapsed) {
  for (const cb of subscribers) {
    try {
      cb(collapsed)
    } catch {
      // 单个订阅者抛错不得影响其它订阅者，也不得中断状态变更本身
    }
  }
}

function persistCollapsed (collapsed) {
  try {
    globalThis.localStorage?.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, collapsed ? '1' : '0')
  } catch {
    // 持久化失败只影响下次启动的默认值，不影响本次切换
  }
}

function reportCollapsed (collapsed) {
  try {
    const pending = invokePageManager('setSidebarCollapsed', collapsed)
    // preload 可能返回 rejected promise（未登录 / 权限不足 / 老版本主进程未注册 handler）；
    // 主动挂 catch，避免 unhandled rejection 污染控制台。
    if (pending && typeof pending.catch === 'function') pending.catch(() => {})
  } catch {
    // 非 Electron 环境或 preload 同步抛错：静默降级
  }
}

/**
 * 设置折叠状态。
 * @param {boolean} collapsed true = 收起，false = 展开。非布尔值一律忽略
 *   （IPC 合同只接受 boolean，避免 `'1'` / `1` 这类松散值把主进程参数契约带偏）。
 */
export function setSidebarCollapsed (collapsed) {
  if (typeof collapsed !== 'boolean') return
  if (sidebarCollapsed.value === collapsed) return
  sidebarCollapsed.value = collapsed
  persistCollapsed(collapsed)
  reportCollapsed(collapsed)
  notify(collapsed)
}

/**
 * 应用**来自主进程广播**的折叠状态（多窗口同步专用）。
 *
 * 与 setSidebarCollapsed 的三处刻意差异：
 *   1. 不写 localStorage —— 持久化真源是「用户点击的那个窗口」，避免两个窗口
 *      互相覆盖彼此的持久化值（后写的那次会赢，与用户最后一次操作无关）；
 *   2. 不上报 IPC —— 状态本就来自主进程广播，回传会形成 A↔B 无限互刷；
 *   3. 仍通知订阅者 —— 同窗口的其它组件（如将来加的状态指示）要跟上。
 *
 * @param {boolean} collapsed true = 收起，false = 展开。非布尔值一律忽略
 */
export function applyRemoteCollapsed (collapsed) {
  if (typeof collapsed !== 'boolean') return
  if (sidebarCollapsed.value === collapsed) return
  sidebarCollapsed.value = collapsed
  notify(collapsed)
}

/**
 * 订阅折叠状态变更。
 * @param {(collapsed: boolean) => void} cb
 * @returns {() => void} 退订函数（调用方必须在卸载时调用，否则跨路由/跨窗口泄漏）
 */
export function subscribeSidebarCollapsed (cb) {
  if (typeof cb !== 'function') return () => {}
  subscribers.add(cb)
  return () => { subscribers.delete(cb) }
}

/** 在「收起 / 展开」之间切换（全局按钮与后续快捷键的唯一入口）。 */
export function toggleSidebarCollapse () {
  setSidebarCollapsed(!sidebarCollapsed.value)
}

/**
 * 把**已持久化**的折叠状态上报主进程，但不改变内存状态。
 *
 * 启动时序专用：主进程默认 `_sidebarCollapsed=false`；若用户上次退出时是收起态，
 * App 挂载时必须补这一报，否则之后新建的浏览器/登录标签仍按 x=200 布局。
 */
export function reportSidebarCollapsed () {
  reportCollapsed(sidebarCollapsed.value)
}
