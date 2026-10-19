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

/** 左侧导航栏默认宽度（与 MpSidebar 的 CSS 变量 --mp-sidebar-width 一致） */
const SIDEBAR_WIDTH_DEFAULT = 200

/**
 * 左侧导航栏宽度合法区间下限。
 * ⚠️ 下限取 1 而非 0：宽度 = 0 会让内嵌 WebContentsView 的 x 落到 0，与位于 x=0 的
 * MpSidebar 完全重叠，从而拦截侧边栏全部点击（即 2026-09-15 修复的「平台链接浮层盖住
 * 侧边栏」同类 Bug）。故 0 与负值一律视为非法、回落默认 200。与 WebviewManager.
 * setSidebarWidth 的入参守卫（width <= 0 拒绝）保持一致。
 */
const MIN_SIDEBAR_WIDTH = 1
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
 * 归一化左侧导航栏宽度：非法值（非数字 / NaN / <=0 / 越界）一律回落默认值，
 * 避免把 undefined、负值、0 或异常上报值直接拼进 setBounds 造成视图错位。
 * 注意：width=0 会让内嵌视图的 x 落到 0，与 x=0 的 MpSidebar 重叠、拦截其全部点击
 * （2026-09-15 修复的同类 Bug），因此 0 与负值均按非法处理（见 MIN_SIDEBAR_WIDTH）。
 * @param {number} [width]
 * @returns {number}
 */
function normalizeSidebarWidth(width) {
  if (typeof width !== 'number' || !Number.isFinite(width)) return SIDEBAR_WIDTH_DEFAULT
  // 关键防御：宽度必须严格 > 0（见 MIN_SIDEBAR_WIDTH 注释），0 会让视图盖住侧边栏
  if (width < MIN_SIDEBAR_WIDTH || width > MAX_SIDEBAR_WIDTH) return SIDEBAR_WIDTH_DEFAULT
  return Math.round(width)
}

/**
 * 各 manager 的 setSidebarWidth 入参守卫（单一真源）。
 *
 * 为什么必须有这个函数：WebviewManager / AuthViewManager / QRCodeLogin / OAuthManager
 * 四处各自写了 `typeof width !== 'number' || width < MIN || width > MAX`，
 * 而 **NaN 的所有比较都是 false ⇒ NaN 能穿过这道守卫**并被写进 _sidebarWidth，
 * 之后 computeEmbeddedViewBounds 的 normalizeSidebarWidth 才把它拦下（回落 200）。
 * 结果是：渲染进程上报 NaN 时 manager 层认为"宽度变了"并触发一次无意义重排，
 * 而守卫的语义（"挡住非法值"）实际被推迟了一层——四份重复实现还各自漂移。
 *
 * ⚠️ 不只是 NaN：`Infinity > MAX` 为 true 能被挡，但 `-Infinity < MIN` 同样为 true，
 * 真正的漏网口径只有 NaN。用 `Number.isFinite` 一并覆盖。
 *
 * @param {unknown} width
 * @returns {boolean} true = 合法（有限数字且落在 [MIN, MAX]）
 */
function isValidSidebarWidth(width) {
  return typeof width === 'number' && Number.isFinite(width) &&
    width >= MIN_SIDEBAR_WIDTH && width <= MAX_SIDEBAR_WIDTH
}

/**
 * 计算「右侧主体区域」内嵌视图的 bounds：左侧留出导航栏，顶部留出 TabBar + NavBar。
 * 宽高下限为 0（窗口被缩到极小时不产生负尺寸，Electron 会拒绝负值）。
 *
 * 侧栏收起（2026-10-18，全局折叠按钮）用**第 4 个独立布尔参数**表达，而不是 width=0：
 *   · width=0 是「缺失/异常上报」，必须回落 200（否则原生视图盖住 x=0 的侧边栏，见上）；
 *   · 收起是用户显式意图：此时侧边栏 `display:none`，内嵌视图必须 x=0 全宽，
 *     否则浏览器/账号/登录标签左侧会留出 200px 死区（原生图层不跟随 CSS 布局）。
 * 两件事混用同一个数值会让「守卫」与「功能」互相证伪，故参数分离。
 *
 * @param {any} win BrowserWindow 或等价 mock
 * @param {number} [sidebarWidth] 左侧导航栏宽度，缺省 200（收起时忽略）
 * @param {number} [topOffset] 顶部偏移，缺省 BROWSER_CHROME_TOP(76)
 * @param {boolean} [sidebarCollapsed] 是否已收起左侧导航栏；严格 `=== true` 才生效，
 *   其余值（1 / 'true' / undefined）一律按展开处理，避免 IPC 参数漂移改变布局
 * @returns {{ x: number, y: number, width: number, height: number }}
 */
function computeEmbeddedViewBounds(win, sidebarWidth, topOffset = BROWSER_CHROME_TOP, sidebarCollapsed = false) {
  const content = getContentSize(win)
  const collapsed = sidebarCollapsed === true
  const sidebar = collapsed ? 0 : normalizeSidebarWidth(sidebarWidth)
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

/**
 * 渲染层可上报的「顶部额外下移」（公告横幅等常驻 chrome）默认值与上限。
 *
 * 上限取 200：横幅是「徽标 + 标题 + 可选正文 + 关闭按钮」的单/双行块，实测高度远小于此；
 * 超限一律按非法处理并回落 0 —— 一个异常上报值（NaN / 负数 / 整屏高度）若被接受，
 * 会把内嵌 WebContentsView 的可用高度压成 0，用户侧表现为「网页标签打开后一片空白」，
 * 比"横幅挡住一点内容"严重一个量级。
 */
const TOP_INSET_DEFAULT = 0
const MAX_TOP_INSET = 200

/**
 * 归一化顶部下移量。与 normalizeSidebarWidth **不同**：0 在这里是**合法值**
 * （它表示"当前没有横幅"，是卸载/关闭时必须回写的收口态），所以判据是 `0 <= px <= MAX`。
 * 非法值（非数字 / NaN / 负 / 越界）回落 TOP_INSET_DEFAULT 而不是拒绝，
 * 因为这一路的重排成本低于让视图停在错误顶偏移的成本。
 * @param {number} [px]
 * @returns {number}
 */
function normalizeTopInset(px) {
  if (typeof px !== 'number' || !Number.isFinite(px)) return TOP_INSET_DEFAULT
  if (px < 0 || px > MAX_TOP_INSET) return TOP_INSET_DEFAULT
  return Math.round(px)
}

/**
 * 内容区顶部 = 固定 chrome（TabBar + NavBar）+ 渲染层上报的额外下移。
 * 单一实现，避免三处 manager 各写一遍 `76 + inset` 而漂移。
 * @param {number} [inset]
 * @returns {number}
 */
function contentTopWithInset(inset) {
  return BROWSER_CHROME_TOP + normalizeTopInset(inset)
}

module.exports = {
  BROWSER_CHROME_TOP,
  SIDEBAR_WIDTH_DEFAULT,
  MIN_SIDEBAR_WIDTH,
  MAX_SIDEBAR_WIDTH,
  TOP_INSET_DEFAULT,
  MAX_TOP_INSET,
  normalizeTopInset,
  contentTopWithInset,
  normalizeSize,
  getContentSize,
  normalizeSidebarWidth,
  isValidSidebarWidth,
  computeEmbeddedViewBounds,
}
