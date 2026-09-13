// @ts-check
/**
 * view-bounds — 内嵌 WebContentsView 定位的唯一来源（single source of truth）
 *
 * ── 背景与根因（2026-09-13 Bug 修复）───────────────────────────────
 * 主窗口是带系统边框 / 标题栏 / 菜单栏的原生 BrowserWindow：
 *   • BrowserWindow.getBounds()        → 窗口**外框**（含标题栏、菜单栏、左右与底部边框）
 *   • BrowserWindow.getContentBounds() → 窗口**客户区**（真正可绘制区域）
 *   • mainWindow.contentView.addChildView(view).setBounds(...) 使用**客户区**坐标系
 *
 * 历史实现用 getBounds() 的宽高布局内嵌视图，视图因此比可见区域宽出左右边框、
 * 高出标题栏 + 底部边框（Windows 100% DPI 约 +16px 宽、+39px 高）。后果：
 *   • 视图右边缘（网页垂直滚动条所在处）落在窗口之外被裁掉 → 「右侧没有滚动条」；
 *   • 视图底边超出窗口下边界 → 「底部内容显示不全，且页面认为自己已滚到底，
 *     用户无法滚动查看被裁掉的部分」。
 *
 * 结论：**所有内嵌视图必须用客户区尺寸定位**。本模块是该规则的唯一实现，
 * 禁止在各 manager 内重复用 `mainWindow.getBounds()` 做内嵌视图布局。
 *
 * 已接入：webview-manager（浏览器标签页 / 分屏监控）、auth-view-manager（登录视图）、
 * qrcode-login（扫码登录视图）、oauth-manager（OAuth 授权视图）。
 */

/**
 * 浏览器式标签页内容区的顶部偏移。
 * TabBar(36px) + NavBar(40px) 是渲染进程 DOM 的固定头高（见 TabBar.vue / NavBar.vue）；
 * WebContentsView 是原生图层，无法用 CSS 与之对齐，只能按同一常量下移。
 */
const BROWSER_CHROME_TOP = 76

/** 左侧导航栏默认宽度（与 YixiaoerSidebar 的 CSS 变量 --yixiaoer-sidebar-width 一致） */
const SIDEBAR_WIDTH_DEFAULT = 200

/** 左侧导航栏宽度合法区间（与各 manager setSidebarWidth 的入参校验保持一致） */
const MIN_SIDEBAR_WIDTH = 0
const MAX_SIDEBAR_WIDTH = 600

/**
 * 把 Electron 的多种尺寸返回形式归一成 { width, height }。
 * @param {any} value getContentBounds() 对象 / getBounds() 对象 / getContentSize() 数组
 * @returns {{ width: number, height: number } | null}
 */
function normalizeSize(value) {
  if (!value) return null
  if (Array.isArray(value)) {
    const [width, height] = value
    return typeof width === 'number' && typeof height === 'number' && width > 0 && height > 0
      ? { width, height }
      : null
  }
  if (typeof value === 'object' && typeof value.width === 'number' && typeof value.height === 'number') {
    return value.width > 0 && value.height > 0 ? { width: value.width, height: value.height } : null
  }
  return null
}

/**
 * 读取窗口**客户区**尺寸（不含标题栏 / 菜单栏 / 边框）。
 *
 * 降级顺序：
 *   1. getContentBounds() —— 语义正确，首选
 *   2. getContentSize()   —— 返回 [width, height]，等价语义
 *   3. getBounds()        —— 兜底（外框尺寸，会复现历史裁切 Bug，仅在无法读取客户区时使用）
 *
 * 任何一步抛错（窗口正在销毁）都不会中断调用方，最终返回 { width: 0, height: 0 }。
 *
 * @param {any} win BrowserWindow 或等价 mock
 * @returns {{ width: number, height: number }}
 */
function getContentSize(win) {
  if (!win) return { width: 0, height: 0 }

  if (typeof win.getContentBounds === 'function') {
    try {
      const size = normalizeSize(win.getContentBounds())
      if (size) return size
    } catch (_e) { /* 窗口销毁中，降级 */ }
  }

  if (typeof win.getContentSize === 'function') {
    try {
      const size = normalizeSize(win.getContentSize())
      if (size) return size
    } catch (_e) { /* 窗口销毁中，降级 */ }
  }

  if (typeof win.getBounds === 'function') {
    try {
      const size = normalizeSize(win.getBounds())
      if (size) return size
    } catch (_e) { /* 窗口销毁中 */ }
  }

  return { width: 0, height: 0 }
}

/**
 * 归一化左侧导航栏宽度：非法值（非数字 / NaN / 越界）一律回落默认值，
 * 避免把 undefined、负值或异常上报值直接拼进 setBounds 造成视图错位。
 * @param {number} [width]
 * @returns {number}
 */
function normalizeSidebarWidth(width) {
  if (typeof width !== 'number' || !Number.isFinite(width)) return SIDEBAR_WIDTH_DEFAULT
  if (width < MIN_SIDEBAR_WIDTH || width > MAX_SIDEBAR_WIDTH) return SIDEBAR_WIDTH_DEFAULT
  return Math.round(width)
}

/**
 * 计算「右侧主体区域」内嵌视图的 bounds：左侧留出导航栏，顶部留出 TabBar + NavBar。
 * 宽高下限为 0（窗口被缩到极小时不产生负尺寸，Electron 会拒绝负值）。
 *
 * @param {any} win BrowserWindow 或等价 mock
 * @param {number} [sidebarWidth] 左侧导航栏宽度，缺省 200
 * @param {number} [topOffset] 顶部偏移，缺省 BROWSER_CHROME_TOP(76)
 * @returns {{ x: number, y: number, width: number, height: number }}
 */
function computeEmbeddedViewBounds(win, sidebarWidth, topOffset = BROWSER_CHROME_TOP) {
  const content = getContentSize(win)
  const sidebar = normalizeSidebarWidth(sidebarWidth)
  const top = typeof topOffset === 'number' && Number.isFinite(topOffset) && topOffset >= 0
    ? topOffset
    : BROWSER_CHROME_TOP

  return {
    x: sidebar,
    y: top,
    width: Math.max(0, content.width - sidebar),
    height: Math.max(0, content.height - top),
  }
}

module.exports = {
  BROWSER_CHROME_TOP,
  SIDEBAR_WIDTH_DEFAULT,
  MIN_SIDEBAR_WIDTH,
  MAX_SIDEBAR_WIDTH,
  normalizeSize,
  getContentSize,
  normalizeSidebarWidth,
  computeEmbeddedViewBounds,
}
