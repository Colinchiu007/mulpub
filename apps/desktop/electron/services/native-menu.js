// @ts-check
'use strict'

/**
 * native-menu.js — 原生应用菜单（Windows 窗口顶部 File / Edit / View / Window 那一行）的移除策略
 *
 * ⚠️ 命名说明：本模块管的是 **Electron 原生菜单**；`app-menu-config.js` 管的是
 * **运营中心下发的应用内导航菜单**（侧边栏），两者毫无关系，不要混。
 *
 * ── 背景（2026-10-21，remove-native-menu-bar）────────────────────────────
 * Electron 默认会为应用装一份「默认应用菜单」：File / Edit / View / Window / Help。
 * 本仓从未替换过它，于是主窗口顶部一直挂着这一行系统菜单：
 *
 *     [File] [Edit] [View] [Window]
 *
 * 它不是本产品的功能入口（左侧栏才是），却白占一整行窗口高度，
 * 与「界面更美观」的目标冲突。本模块把这行菜单彻底移除。
 *
 * ── 为什么分「全局」与「窗口」两级 ─────────────────────────────────────
 *  · 全局：`Menu.setApplicationMenu(null)` —— 移除默认菜单**模板**（根因级的一刀），
 *    之后创建的窗口不再自带这行菜单。
 *  · 窗口：`win.setMenu(null)` + BrowserWindow 的 `autoHideMenuBar: true` ——
 *    把「本窗口没有菜单栏」钉死在窗口自己身上：即便将来有人再调用
 *    `Menu.setApplicationMenu(...)` 装了个菜单，主窗口也不会重新长出这一行
 *    （`autoHideMenuBar` 只保证「按 Alt 才临时唤出」，`setMenu(null)` 才是真没有）。
 *
 * 两级缺一不可：只做全局，窗口若先于菜单设置创建，就仍会带默认菜单；
 * 只做窗口，其它窗口（登录窗、授权窗等）仍会带菜单。
 *
 * ── 平台策略 ───────────────────────────────────────────────────────────
 * macOS 的菜单在**屏幕顶部**（系统菜单栏），且承载 Cmd+C / Cmd+V / Cmd+Q 等
 * 平台级快捷键，移除会破坏 macOS 交互惯例；本仓 electron-builder 只配了 win（nsis），
 * 但保留 darwin 分支是为了将来出 mac 包时不至于静默坏掉。
 * Windows / Linux 的菜单栏是「窗口内的一行」，正是要去掉的对象。
 */

/**
 * 当前平台是否需要移除原生菜单栏。
 *
 * @param {string} [platform] 平台标识（默认取 process.platform）
 * @returns {boolean} true = 需要移除（Windows / Linux）；false = 保留（macOS）
 */
function shouldRemoveNativeMenuBar (platform = process.platform) {
  return platform !== 'darwin'
}

/**
 * 移除全局应用菜单（默认菜单模板的源头）。
 *
 * 幂等：重复调用不产生副作用（Electron 侧 setApplicationMenu(null) 可重复调用）。
 *
 * @param {object} [options]
 * @param {{ setApplicationMenu?: (menu: unknown) => void } | null} [options.Menu] electron 的 Menu 模块
 * @param {string} [options.platform] 平台标识（默认取 process.platform）
 * @returns {{ removed: boolean, reason: string }} removed=是否真的移除；reason=判定依据（留痕用）
 */
function removeApplicationMenu ({ Menu, platform = process.platform } = {}) {
  if (!shouldRemoveNativeMenuBar(platform)) {
    return { removed: false, reason: 'macos-keeps-native-menu' }
  }
  // Electron 版本差异 / mock 缺失时不能炸：菜单移除失败只是「不好看」，不该拦住应用启动
  if (!Menu || typeof Menu.setApplicationMenu !== 'function') {
    return { removed: false, reason: 'menu-api-unavailable' }
  }
  Menu.setApplicationMenu(null)
  return { removed: true, reason: 'removed' }
}

/**
 * 移除单个窗口的菜单栏（把「这个窗口没有菜单栏」钉在窗口自己身上）。
 *
 * @param {any} win BrowserWindow 或等价 mock
 * @param {object} [options]
 * @param {string} [options.platform] 平台标识（默认取 process.platform）
 * @returns {{ removed: boolean, reason: string }}
 */
function removeWindowMenuBar (win, { platform = process.platform } = {}) {
  if (!shouldRemoveNativeMenuBar(platform)) {
    return { removed: false, reason: 'macos-keeps-native-menu' }
  }
  if (!win || typeof win.setMenu !== 'function') {
    return { removed: false, reason: 'window-menu-api-unavailable' }
  }
  win.setMenu(null)
  return { removed: true, reason: 'removed' }
}

module.exports = {
  shouldRemoveNativeMenuBar,
  removeApplicationMenu,
  removeWindowMenuBar,
}
