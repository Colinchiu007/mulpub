# PRD — 主窗口全局「左侧菜单收起/展开」（sidebar-collapse-toggle）

> **立项日期**: 2026-10-18 | **状态**: 随分支 `sidebar-collapse-toggle` 交付（worktree `D:\Data\projects\mp-worktrees\mp-sidebar-collapse-toggle`）
> **关联**: [PRD.md](./PRD.md) §3.1 F8 系统功能 · [DESIGN.md](./DESIGN.md)「全局壳层：左侧菜单收起/展开」 · OpenSpec change `openspec/changes/sidebar-collapse-toggle/` · 执行记录 `openspec/records/sidebar-collapse-toggle.md`
> **影响模块**:
> - 渲染层：`apps/desktop/src/App.vue`、`apps/desktop/src/components/TabBar.vue`、本次新增的 `apps/desktop/src/stores/sidebar-collapse.js`（模块级单例状态）、`apps/desktop/src/components/SidebarToggleButton.vue`、`apps/desktop/src/components/icons/SidebarToggleIcon.vue`、`apps/desktop/src/locales/tab-bar/{zh,en}.js`
> - **未改动**：`apps/desktop/src/layouts/MpSidebar.vue` —— 折叠由 `App.vue` 对 `<MpSidebar>` 施加 `v-show="!sidebarCollapsed"` 完成；`MpSidebar.vue` 内既有 `ResizeObserver` 的 `if (w > 0)` 守卫保持不变，因此收起时不会把 `width=0` 上报给主进程
> - 第三方声明：图标几何取自 Lucide（ISC），`apps/desktop/THIRD-PARTY-NOTICES.md` 已由实现方登记，本文档不修改该文件
> - 主进程：`apps/desktop/electron/services/view-bounds.js`、`apps/desktop/electron/services/webview-manager/{layout,ipc-handlers,index}.js`、`apps/desktop/electron/services/auth-view-manager.js`、`apps/desktop/electron/services/qrcode-login.js`
> - 桥接：`apps/desktop/electron/preload/page-manager.js`、`apps/desktop/src/api/electron-bridge.js`
> - 基线：`apps/desktop/tests/visual-testing/base-screenshots/`（43 张 PNG 全部需要重建）

---

## 一、背景与问题

主窗口目前是固定三段式壳层：左侧 `MpSidebar`（`apps/desktop/src/layouts/MpSidebar.vue`）+ 右侧 `mp-shell-main`（`TabBar` 36px → `NavBar` 40px → router-view 内容区）。侧栏宽度由 `apps/desktop/src/styles/sidebar.css` 的 `--mp-sidebar-width` 决定：普通窗口 200px，窗口宽度 ≤900px 时媒体查询收窄为 68px 图标栏。

浏览器式标签（`WebContentsView`）由主进程定位，唯一真源是 `apps/desktop/electron/services/view-bounds.js` 的 `computeEmbeddedViewBounds()`：`x = 侧栏宽度`、`y = BROWSER_CHROME_TOP(76)`、宽高按客户区剩余尺寸。`BROWSER_CHROME_TOP = 76` 正是渲染层 `TabBar(36px) + NavBar(40px)` 的固定头高（见 `view-bounds.js:25-29` 注释与 `App.vue:35-41`）。

| 现状 | 问题 |
|------|------|
| 侧栏只有「200px / ≤900px 时 68px」两态，没有用户可控的收起入口 | 用户想专注阅读、比对网页或在小窗口下腾出横向空间时，只能缩放窗口，侧栏始终占位 |
| 侧栏宽度上报依赖 `MpSidebar` 的 `ResizeObserver`（`MpSidebar.vue:221-230`） | 该上报只在 `width > 0` 时发送（`MpSidebar.vue:225`），因此「隐藏侧栏」在既有机制里**无法**用宽度 0 表达；必须新增显式状态 |
| 内嵌 `WebContentsView` 是原生图层，不跟随 DOM 布局 | 侧栏若只靠 CSS 隐藏而主进程不同步重排，浏览器/账号/登录标签左侧会留下 200px 死区（或 68px），鼠标落点与视觉错位 |
| 标签栏是全窗口唯一的全局常驻条，却没有「壳层」控制入口 | 用户没有稳定、全局可达的折叠入口；若放在侧栏内部，收起后入口自身消失，无法再展开 |

本轮目标是把「收起/展开左侧菜单」做成一个**全局、可持久化、跨进程一致**的壳层能力，而不是某个页面的局部样式。

---

## 二、目标与非目标

### 2.1 目标

1. **全局可达**：主窗口工作台壳层（`mp-shell`）内始终可见一个「收起/展开左侧菜单」按钮，位置固定在顶部标签栏 `TabBar` 的最左侧，不随标签条横向滚动。
2. **零新增行高**：按钮与标签栏同高 36px，不改变 `TabBar 36px + NavBar 40px = 76px` 的既有主进程 `TOP` 契约。
3. **状态可持久化**：用户选择在重启后保留；读写 `localStorage` 必须容错，任何异常都退化为「展开」，不阻塞渲染。
4. **跨进程一致**：收起时左侧菜单完全隐藏、主内容区横向铺满；所有内嵌视图（浏览器标签、账号标签、登录视图、扫码登录）按全宽定位；展开时恢复原宽度（200px 或 ≤900px 的 68px），行为与今天逐字节一致。
5. **可访问**：原生按钮语义、`aria-pressed` 状态、随状态变化的可读标签、键盘 Enter/Space 可用、图标对辅助技术隐藏。

### 2.2 非目标（明确不做）

| 非目标 | 原因 |
|--------|------|
| ❌ 收起/展开的动画过渡 | 原生 `WebContentsView` 边界不会跟随 CSS 过渡插值，动画期间会出现视图与布局不同步的可见错位；本功能选择「瞬时切换 + 一次重排」 |
| ❌ 拖拽调宽 / 保存自定义宽度 | 属独立能力（宽度持久化、最小/最大值、双视图同步），本轮只做二态折叠，避免与既有 `MIN_SIDEBAR_WIDTH=1` 守卫语义纠缠 |
| ❌ 窄屏 68px 图标栏的「另一种折叠形态」 | ≤900px 时既有媒体查询已把侧栏收成 68px；本轮收起语义统一为「完全隐藏」，不再新增第二套窄屏形态 |
| ❌ 快捷键 | 避免与输入框、浏览器标签、全局快捷键（`F8` 系统功能已登记 6 组快捷键）冲突；点击与键盘焦点已足够 |
| ❌ 改动 OAuth 内嵌视图 | `apps/desktop/electron/services/oauth-manager.js:86` 调用 `computeEmbeddedViewBounds(this.mainWindow)` 时**不传侧栏宽度**，既有实现本就不跟随侧栏真实宽度（≤900px 时也按默认 200 留白）；本轮如实登记为已知限制，不在范围内 |
| ❌ 改动主进程 `setSidebarWidth(width)` 的 `width<=0` 拒绝守卫 | 见 §4.6：该守卫是 2026-09-15「内嵌视图盖住侧边栏」Bug 的防御层，收起必须用独立的 `sidebarCollapsed` 标志表达 |

### 2.3 成功度量（可机械核对）

1. 工作台壳层每张页面顶部都能看到该按钮，且按钮位于 `.tab-bar-tabs` 之前（DOM 顺序 + `data-testid` 可断言）。
2. 点击一次后侧栏 `display:none`，内容区 `x=0` 宽=客户区全宽（主进程 `computeEmbeddedViewBounds` 返回值可断言）。
3. 刷新/重启应用后状态保持（`localStorage` 键值可断言）。
4. `localStorage` 抛异常、值非法、IPC 参数非布尔值三种输入都不会让渲染层报错或让主进程状态漂移。
5. 视觉基线变更被如实登记为「全量基线重建」，不声称视觉中性。

---

## 三、位置方案对比与风险分析

### 3.1 候选位置

| 方案 | 是否破坏 76px 契约 | 全局可达 | 不随标签条滚动 | 贴近折叠边界 | 实现复杂度 | 判定 |
|------|:---:|:---:|:---:|:---:|:---:|---|
| A. **TabBar 最左侧、`.tab-bar-tabs` 之前**（采纳） | 否（仍在 36px 行内，不新增行高） | 是（工作台壳层所有路由共用） | 是（标签条 `overflow-x:auto` 从它右侧开始，滚动不带动它） | 是（紧贴侧栏右缘/内容区左缘的视觉分界） | 低（TabBar 内加一个元素 + 事件） | ✅ 采纳 |
| B. NavBar 右侧 | 否 | 是 | 是 | 否（离侧栏一个 NavBar 宽度，位置语义不在边界上） | 低 | ❌ 不选：与 URL 搜索栏、保存账号、导航按钮抢占同一行，右侧是高频操作区；折叠是壳层动作，放这里会读成「页面动作」 |
| C. 侧边栏头部内部 | 否 | **否** | 是 | 是 | 中（需处理 68px 形态下的布局） | ❌ 不选：收起后侧栏整体隐藏，入口随侧栏一起消失，用户无法再展开——这是本方案的决定性缺陷 |
| D. 悬浮固定按钮（`position:fixed` 覆盖在内容区左缘） | 否 | 是 | 是 | 是 | 中（层级、遮挡、与内嵌原生视图抢点击） | ❌ 不选：原生 `WebContentsView` 永远在 DOM 之上，悬浮按钮在浏览器标签激活时会被视图盖住/拦截，出现「按钮在但点不到」的间歇态；且需要额外处理滚动与焦点 |

### 3.2 推荐结论

选择 **A：TabBar 最左侧**。理由按优先级：

1. **不破坏 76px 契约**：按钮在既有 36px 标签栏内部，`BROWSER_CHROME_TOP` 不需要改动，`TabBar(36) + NavBar(40) = 76` 的注释与常量继续成立。
2. **全局可达且状态稳定**：`TabBar` 只在工作台壳层渲染，覆盖所有工作台路由；不依赖任何页面组件挂载。
3. **不随标签滚动**：现有标签条 `.tab-bar-tabs` 自身 `overflow-x:auto`、`scrollbar-width:none`（`TabBar.vue:104-116`）；把按钮放在它外面即可获得「固定列 + 可滚动标签」的标准浏览器式布局。
4. **贴近折叠边界**：按钮紧邻侧栏与内容区的分界，动作方向与视觉位置一致；用户不需要在窗口里寻找入口。

### 3.3 方案风险与缓解

| 风险 | 影响 | 缓解 |
|------|------|------|
| 按钮挤占标签条可用宽度 | 标签更多时更早触发横向滚动 | 按钮固定为图标按钮（无文字），宽度仅图标 + 水平内边距；不设文字标签 |
| 用户误以为按钮属于标签操作 | 与「+ 新建标签」混淆 | 图标使用左右向双 `chevron` 组合成「<>」，语义是「折叠两侧」；按钮不进入 tablist；tooltip/aria-label 明确写「展开/收起左侧菜单」 |
| 收起后侧栏彻底不可见，用户找不到恢复入口 | 功能不可逆 | 按钮位于标签栏固定列，永不随侧栏隐藏；`aria-pressed` 与 tooltip 给出当前可执行动作 |
| TabBar 根节点既有 `role="tablist"` 不合规 | 读屏器把「+」与折叠按钮当 tab | 本次把 `role="tablist"` 从根节点移到 `.tab-bar-tabs`，让 tablist 只包含 tab 元素；按钮留在根节点、位于 tablist 之外 |

---

## 四、功能逻辑

### 4.1 状态机

只有两个稳定状态，切换是幂等的：

```text
                 click / keyboard (Enter|Space)
   ┌───────────┐  ───────────────────────────────▶  ┌───────────┐
   │ expanded  │                                    │ collapsed │
   │ (默认)    │  ◀───────────────────────────────  │           │
   └───────────┘        click / keyboard             └───────────┘
        │                                                   │
        │ 持久化: 删除键 / 非 '1'                            │ 持久化: 写入 '1'
        ▼                                                   ▼
   localStorage['mulpub.ui.sidebarCollapsed'] 缺失或非 '1'   = '1'
```

- **expanded**：初始态；`MpSidebar` 按既有宽度显示；主进程 `_sidebarCollapsed = false`；内嵌视图 `x = 侧栏宽度`。
- **collapsed**：`MpSidebar` 完全隐藏（`v-show`/`display:none`，**不卸载组件**，避免丢失侧栏内部状态与重复挂载副作用）；内容区横向铺满；主进程 `_sidebarCollapsed = true`；内嵌视图 `x = 0`、`width = 客户区全宽`。
- 切换动作只改「二态标志」，不改 `_sidebarWidth`（见 §4.6 与 §4.4）：收起不是宽度 0，展开时直接用回上一次合法宽度。

### 4.2 持久化

| 项 | 约定 |
|----|------|
| 存储位置 | `localStorage`（渲染进程） |
| 键 | `mulpub.ui.sidebarCollapsed` |
| 值 | `'1'` 表示收起；其他任意值或缺失表示展开 |
| 读 | `try { localStorage.getItem(...) } catch { 展开 }`；只认严格等于 `'1'`，其余（`'0'`、`'true'`、`'false'`、空串、JSON 串、被手工改坏的值）一律按展开 |
| 写 | `try { localStorage.setItem(key, collapsed ? '1' : '0') } catch { 静默 }`；写失败不影响本次内存态切换 |
| 清除 | 不需要额外清除逻辑；非法值天然按展开处理，保证未来版本变更不会把用户卡在收起态 |
| 参考实现 | 与 `apps/desktop/src/composables/usePanelVisibilityPrefs.js` 的「读失败/写失败一律降级默认、绝不抛错阻塞渲染」同一纪律 |

### 4.3 启动恢复

1. 应用启动 → 工作台壳层挂载 `App.vue` → `apps/desktop/src/stores/sidebar-collapse.js` 在模块加载时同步读取 `localStorage`（模块单例，不引入首屏等待）。
2. 若持久化为收起：渲染层立即以收起态渲染（`App.vue` 的 `MpSidebar v-show="!sidebarCollapsed"` 隐藏），**并在工作台壳层 `onMounted`（`!isHomeShell` 分支）调用 `reportSidebarCollapsed()` 主动上报一次** `pageManager.setSidebarCollapsed(true)`。
3. 主进程收到上报后保存 `_sidebarCollapsed = true`，同步 `AuthViewManager` / `QRCodeLogin`，并重排已存在的内嵌视图。
4. 之后新建的浏览器标签 / 账号标签 / 登录视图在创建后由主进程统一重排，`_repositionAll()`（`webview-manager/layout.js:188-191`）使用该标志按全宽定位；窗口 resize 触发的 `resize()` → `_repositionAll()`（`layout.js:12-13`）同样使用该标志。
5. 若持久化为展开：`reportSidebarCollapsed()` 同样上报一次 `false`（统一「上报当前状态」语义）；主进程值未变化即幂等返回，不重排、无额外开销。

**时序约束**：上报必须发生在 App 挂载之后（此时 preload 已注入、`window.electronAPI.pageManager` 可用），且必须容错——非 Electron 环境下 `invokePageManager` 返回 `undefined`（`apps/desktop/src/api/electron-bridge.js:158-163`），不得因此抛错或阻塞渲染。

### 4.4 跨进程同步

**链路（收起方向）**：

```text
TabBar 按钮 click
  → toggleSidebarCollapse()（apps/desktop/src/stores/sidebar-collapse.js）
  → 更新本地 ref（触发 MpSidebar v-show / 布局）
  → localStorage.setItem('mulpub.ui.sidebarCollapsed', '1')（失败静默）
  → invokePageManager('setSidebarCollapsed', true)
      → preload pageManager.setSidebarCollapsed(boolean)
      → ipcRenderer.invoke('page-manager:set-sidebar-collapsed', collapsed)
      → ipc-handlers.js handler（withSenderCheck + try/catch；回执 { code:0, data:{ collapsed: isSidebarCollapsed() } }）
      → WebviewManager.setSidebarCollapsed(true)
          → 参数校验（非 boolean 忽略 + warn）
          → _sidebarCollapsed = true（值未变化则不重排）
          → AuthViewManager.setSidebarCollapsed(true)（存在且为函数时）
          → QRCodeLogin.setSidebarCollapsed(true)（存在且为函数时）
          → _repositionAll()
              → computeEmbeddedViewBounds(mainWindow, _sidebarWidth, 76, true)
              → { x: 0, y: 76, width: 客户区全宽, height: 客户区高 - 76 }
```

**展开方向**：同一链路反向，`collapsed = false`，主进程恢复 `x = _sidebarWidth`、`width = 客户区宽 - _sidebarWidth`。`_sidebarWidth` 保持收起前的合法值（普通窗口 200、≤900px 媒体查询下 68），因此展开能回到用户熟悉的原宽度。

**契约要点**：

1. `computeEmbeddedViewBounds(win, sidebarWidth, topOffset = 76, sidebarCollapsed = false)`：只有第 4 参严格为 `true` 时才全宽；其他任何值（`false`、`undefined`、`1`、`'true'`）都按展开计算，保证向后兼容（既有 3 参调用方 `oauth-manager.js:86` 行为不变）。
2. `setSidebarCollapsed(boolean)` 只改折叠标志，**不得**顺带修改 `_sidebarWidth`；`setSidebarWidth(width)` 的既有守卫（`typeof width !== 'number' || width < 1 || width > 600` → warn + return）逐字保留。
3. 状态变化才重排：`_sidebarCollapsed` 与目标值相同则直接返回，避免启动上报与一次点击之间重复 `setBounds`。
4. `AuthViewManager` 与 `QRCodeLogin` 各自持有 `_sidebarCollapsed` 并在 `_positionView()` 中把第 4 参传入 `computeEmbeddedViewBounds`；`WebviewManager.setSidebarCollapsed` 在状态变化时调用它们的同名方法。未实现新方法时用 `typeof fn === 'function'` 守卫，不抛错（与既有 `setSidebarWidth` 同步方式一致，见 `webview-manager/layout.js:146-155`）。

### 4.5 窗口缩放与媒体查询下的宽度

| 窗口宽度 | 展开时侧栏宽 | 收起时 | 说明 |
|----------|------------:|--------|------|
| > 900px | 200px | 0（完全隐藏） | `--mp-sidebar-width: 200px`；主进程 `_sidebarWidth` 由 `ResizeObserver` 上报为 200 |
| ≤ 900px | 68px（图标栏） | 0（完全隐藏） | `apps/desktop/src/styles/sidebar.css:228-231` 媒体查询；`ResizeObserver` 上报 68 |
| 收起态下缩放窗口 | 不显示，但 `_sidebarWidth` 仍随媒体查询更新？ | — | **关键**：`MpSidebar` 收起时 `getBoundingClientRect().width = 0`，`syncWidth` 的 `w > 0` 守卫会跳过上报（`MpSidebar.vue:225`），因此 `_sidebarWidth` 停留在收起前最后一个合法值（200 或 68）。展开瞬间使用该值；若用户恰在收起期间跨越 900px 断点，展开后会由下一次 ResizeObserver 回调（侧栏重新有宽度）把真实宽度补报给主进程，最终一致 |

> 该表是「收起不能用 width=0 表达」的直接理由：若用 0 上报，`normalizeSidebarWidth` 会把 0 判非法并回落 200（`view-bounds.js:111-116`），同时 `setSidebarWidth` 会整条拒绝（`layout.js:112-119`）——两条守卫都会把「收起」吞掉，视图反而按 200 定位。

### 4.6 与既有宽度守卫的关系（不可绕过）

- `MIN_SIDEBAR_WIDTH = 1`（`view-bounds.js:41`）的注释明确写着：宽度 0 会让内嵌视图 `x=0` 与 `x=0` 的 `MpSidebar` 完全重叠、拦截侧边栏全部点击（2026-09-15 Bug）。本轮**不修改**该常量，也不修改 `normalizeSidebarWidth` 的回落规则。
- `WebviewManager.setSidebarWidth`、`AuthViewManager.setSidebarWidth`（`auth-view-manager.js:236-244`）、`QRCodeLogin.setSidebarWidth`（`qrcode-login.js:600-605`）三处守卫全部保留。
- 「收起」只用新增的显式布尔标志表达；任何实现若试图用 `setSidebarWidth(0)` 或 `setSidebarWidth(1)` 模拟收起，都属于偏离本 PRD 的实现错误。

---

## 五、交互逻辑

### 5.1 点击

1. 鼠标左键点击按钮 → 触发一次切换（`expanded ⇄ collapsed`）。
2. 切换立即生效：本地 ref 更新 → `MpSidebar` 的 `v-show` 立即隐藏/显示 → 同一帧内按钮 `aria-pressed`、`aria-label`、`title` 更新。
3. 同一帧内发起一次 IPC（失败不回滚视觉态：本地状态是用户意图，主进程同步是增强；失败时保留本地态并在下次成功同步时收敛）。
4. 连续快速点击：状态机天然幂等；实现应保证每次点击至多一次 IPC，不做防抖延迟（避免「点了没反应」）。

### 5.2 键盘

- 使用原生 `<button type="button">`，Enter 与 Space 均触发 `click`，不额外注册 `keydown`，避免与全局快捷键/输入法冲突。
- Tab 焦点顺序：按钮位于 TabBar DOM 最前，进入 TabBar 时最先聚焦；不进入 tablist（`role="tablist"` 移到 `.tab-bar-tabs` 后，按钮不属于 tab 序列）。
- 焦点可见：`:focus-visible` 显示 2px `var(--color-primary)` 焦点环 + 2px offset（沿用项目焦点 token 语义，暗色主题随 token 覆写自动适配），不改变布局尺寸。

### 5.3 hover / active / 常态

| 状态 | 视觉 |
|------|------|
| 常态 | 透明背景、`currentColor` 图标取 `--color-text-secondary` |
| hover | 背景 `--color-bg-card`、前景/图标 `--color-primary`、边框 `--color-border`（与 `.tab-add:hover` 同源） |
| active（按下） | 沿用 hover 背景，不新增位移/缩放，避免抖动 |
| focus-visible | `outline: 2px solid var(--color-primary); outline-offset: 2px` |
| `aria-pressed="true"`（已收起） | 图标/前景可采用主色或更强化色（与常态区分），但**不改变图标形状**——图标始终是双向 `chevron`，避免用户误解为「单侧箭头」 |

### 5.4 无动画说明（明确设计决策）

**折叠本身不做宽度/透明度过渡动画**（按钮 hover 的颜色过渡 0.15s 属既有壳层交互风格，不参与布局变化）。原因：

1. 左栏宽度变化会同时触发渲染层重排与主进程 `WebContentsView.setBounds`，两个坐标系没有共享时钟；任何 CSS 过渡期间原生视图都会滞后于 DOM，出现内容「先被盖住再露出」或「先露出再被盖住」的可见错位。
2. 若只做透明度动画（侧栏淡出），布局宽度仍要瞬时变化，动画只会掩盖边界跳变，不能消除视图错位。
3. 瞬时切换 + 单次重排是当前架构下唯一一致的行为；如未来把内嵌视图改为 DOM 渲染，再单独评估动画。

---

## 六、显示项

| 项 | 规格 |
|----|------|
| 位置 | `TabBar` 根节点内、`.tab-bar-tabs` 之前；水平方向紧贴标签栏左缘，垂直方向在整个 36px 行内 |
| 按钮尺寸 | 30×28px（与「+」新建标签按钮同尺寸族）；上下外边距 4px/0 落在 36px 标签栏内，不新增行高；水平外边距左侧 `var(--spacing-2)`、右侧 2px |
| 图标 | 内联 SVG（`apps/desktop/src/components/icons/SidebarToggleIcon.vue`，`viewBox 0 0 16 16`），两个左右向 `chevron` 组成「<>」：`width/height=16`、`stroke="currentColor"`、`stroke-width=1.6`；`aria-hidden="true"`、`focusable="false"`；不使用 emoji 或图标库。几何取自 Lucide（ISC），第三方声明见 `apps/desktop/THIRD-PARTY-NOTICES.md`「Lucide 图标（内联 SVG 几何）」 |
| 与标签条的间距 | 按钮右外边距 2px + `.tab-bar-tabs` 左内边距 `var(--spacing-2)`（8px），视觉间隔约 10px；按钮不覆盖标签、不被标签滚动裁切 |
| 背景 | 默认透明；hover 背景 `--color-bg-card`、边框 `--color-border`、前景 `--color-primary`（与 `.tab-add:hover` 同源）；hover 颜色过渡 0.15s，`prefers-reduced-motion: reduce` 时关闭 |
| 暗色主题 | 全部颜色取自 CSS 变量（`--color-text-secondary` / `--color-bg-card` / `--color-border` / `--color-primary`），`[data-theme="dark"]` 覆写时自动生效；组件内不得出现十六进制颜色字面量 |
| z-index / 层级 | 位于普通流内，不使用 `position:fixed`；因此不会与内嵌原生视图、弹窗、`BackToTop` 争层级 |
| 测试标识 | 提供稳定 `data-testid`（如 `sidebar-toggle`），供组件/视觉回归定位；具体名称以实现为准，文档要求「稳定且唯一」 |

---

## 七、提示文字（zh/en 必须成对）

按钮的 `title`（tooltip）与 `aria-label` 使用**同一文案**，按「点击后会发生什么」描述动作，而不是描述当前状态：

| 当前状态 | 按钮动作 | zh | en | ARIA |
|----------|----------|----|----|------|
| 展开（侧栏可见） | 收起 | 收起左侧菜单 | Collapse sidebar | `aria-pressed="false"`、`aria-label="收起左侧菜单"`、`title="收起左侧菜单"` |
| 收起（侧栏隐藏） | 展开 | 展开左侧菜单 | Expand sidebar | `aria-pressed="true"`、`aria-label="展开左侧菜单"`、`title="展开左侧菜单"` |

约束：

- 文案必须写入 locales：`apps/desktop/src/locales/tab-bar/{zh,en}.js`（`tabBar` 命名空间；具体键名由实现落定，zh/en 键必须成对）。`.vue` 文件内**不得**新增中文字符串字面量（CI 的 CJK 基线扫描会拦截）。
- `aria-pressed` 语义：`true` = 已收起（按钮处于「按下」态），`false` = 展开。
- 不使用 emoji 作为图标或提示。

---

## 八、数据校验

| 输入点 | 输入 | 合法值 | 非法/异常时行为 |
|--------|------|--------|-----------------|
| `localStorage` 读 | `mulpub.ui.sidebarCollapsed` | 缺失 → 展开；`'1'` → 收起；其他 → 展开 | `getItem` 抛异常（隐私模式/配额/权限）→ 展开，静默，不阻塞渲染 |
| `localStorage` 写 | `'1'` / `'0'` | 字符串 | `setItem` 抛异常 → 静默吞掉，内存态照常切换 |
| 渲染层切换 | 内存布尔 | `true` / `false` | 组件只接受自身状态，不暴露可被外部注入非法值的 API |
| preload → IPC | `setSidebarCollapsed(arg)` | 严格布尔 | 非布尔值原样透传给主进程；preload 不做猜测性转换 |
| 主进程 handler | IPC 参数 | `typeof === 'boolean'` | 非布尔 → `warn` 记录（含接收到的类型）+ 忽略，不改变状态、不抛错、不刷屏 |
| `computeEmbeddedViewBounds` 第 4 参 | `sidebarCollapsed` | 严格 `true` 或 `false` | 任何非 `true`（含 `undefined`、`1`、`'true'`）按 `false`（展开）计算，保证旧调用方零行为变化 |
| `setSidebarWidth(width)` | 既有宽度入参 | `number` 且 `1 ≤ width ≤ 600` | 保持现状：warn + 忽略；**不得**被折叠逻辑复用/放宽 |

---

## 九、流程

### 9.1 用户点击（收起方向）时序

1. 用户点击 TabBar 最左侧按钮（或键盘 Enter/Space）。
2. `SidebarToggleButton` 触发 `toggle` 事件；`toggleSidebarCollapse()`（`stores/sidebar-collapse.js`）把 `sidebarCollapsed` 置 `true`。
3. 同一 tick：`MpSidebar` 的 `v-show="!collapsed"` 生效 → 侧栏 `display:none`；`.mp-shell-main` 自然占满剩余宽度。
4. 同一 tick：按钮 `aria-pressed=true`，`aria-label`/`title` 切换为「展开左侧菜单」。
5. 持久化：`localStorage.setItem('mulpub.ui.sidebarCollapsed', '1')`（异常静默）。
6. 跨进程：`invokePageManager('setSidebarCollapsed', true)` → IPC → `WebviewManager.setSidebarCollapsed(true)`。
7. 主进程：`_sidebarCollapsed = true`；同步 `AuthViewManager` / `QRCodeLogin`；`_repositionAll()`。
8. 若当前激活的是浏览器/账号/登录标签，其 `WebContentsView` 立即 `setBounds({ x: 0, y: 76, width: 客户区全宽, height: 客户区高 - 76 })`，视觉上与内容区左缘对齐。
9. 展开方向为同一序列的反向，第 3 步恢复显示、第 8 步恢复 `x = _sidebarWidth`。

### 9.2 主进程重排流程

```text
IPC 'page-manager:set-sidebar-collapsed'
  → withSenderCheck 校验发送者
  → typeof collapsed !== 'boolean' → warn + return（不重排）
  → WebviewManager.setSidebarCollapsed(collapsed)
      → 与 _sidebarCollapsed 相同 → return（幂等，不重排）
      → _sidebarCollapsed = collapsed
      → AuthViewManager.setSidebarCollapsed?.(collapsed)
      → QRCodeLogin.setSidebarCollapsed?.(collapsed)
      → _repositionAll()
          → 挂起中（isEmbeddedViewsSuspended）→ 只 _hideAllTabs()，恢复时由既有 release 流程重排
          → AUTH_TAB 激活 → 由 AuthViewManager 自身 _onWindowResize 重新定位（其内部使用折叠标志）
          → 其他标签 → computeEmbeddedViewBounds(win, _sidebarWidth, 76, _sidebarCollapsed)
```

### 9.3 启动恢复流程

```text
应用启动
  → App.vue 工作台壳层挂载
  → stores/sidebar-collapse.js 模块加载读取 localStorage
      ├─ '1' → collapsed=true → MpSidebar 隐藏
      │        → App.vue onMounted（!isHomeShell）调用 reportSidebarCollapsed()
      │           → invokePageManager('setSidebarCollapsed', true)（非 Electron → undefined，静默跳过）
      └─ 其他/缺失/异常 → collapsed=false → 不上报（主进程默认 false）
  → 用户打开浏览器标签/账号标签/登录视图
      → 主进程用 _sidebarCollapsed 计算 bounds（新建即正确，无「先 200 再跳 0」闪烁）
```

### 9.4 新建视图时的定位

- 所有内嵌视图最终经 `WebviewManager._repositionAll()` 的 `computeEmbeddedViewBounds(this.mainWindow, sidebarWidth, undefined, this._sidebarCollapsed)` 定位（`webview-manager/layout.js:191`）；新建视图后必须触发一次重排（或由既有创建路径统一调用 `_repositionAll`）。
- 新建视图不得先按 `x=_sidebarWidth` 渲染再异步跳到 `x=0`；若创建路径不经过重排，必须在创建后同步重排一次，避免可见闪跳。

---

## 十、错误与降级

| 场景 | 表现 | 处理 |
|------|------|------|
| `localStorage` 不可用/抛异常 | 读取失败 | 退化为「展开」；不弹错、不阻塞渲染；仅可选 `console.warn`（生产不弹 UI） |
| `localStorage` 写入失败（配额） | 本次仍可切换，下次启动回到展开 | 静默；不阻止用户本次操作 |
| 非 Electron 环境（浏览器打开 Vite dev server） | `invokePageManager` 返回 `undefined`（`electron-bridge.js:158-163`） | 本地二态照常工作（纯 UI），主进程同步静默跳过；不得出现未捕获异常 |
| 未登录 / IPC 权限不足 / handler 拒绝 | 主进程不同步 | 渲染层保留本地视觉态；不得无限重试、不得弹模态；下次成功同步时收敛（幂等） |
| 主进程未注册新 handler（旧 preload/旧主进程混用） | `invoke` reject 或返回 error | 渲染层 `try/catch`/`.catch()` 静默；功能退化为「仅本地折叠」 |
| 窗口销毁中触发重排 | `getContentBounds` 等可能抛错 | 沿用 `view-bounds.js` 既有 try/catch 与 `{0,0}` 降级，不向外抛 |
| 连续点击 / 重复上报 | 多次 IPC | 主进程「值未变化即返回」保证幂等；不产生可见重排 |

---

## 十一、边界

| 边界 | 行为 |
|------|------|
| 全屏路由 `/first-run` | `App.vue:5-9` 走 `isFullScreenRoute` 分支，不渲染 `TabBar`/`MpSidebar`，因此**没有**该按钮，也不存在侧栏折叠；首次运行引导页布局不受影响 |
| home-shell 新标签实例（`?mp-home-shell=1`） | `App.vue:15-23` 只渲染 `MpModuleNav + 工作区`，不渲染 TabBar/Sidebar（外层窗口已有 chrome，避免双份）；该实例内无按钮、无侧栏，折叠状态对它无意义 |
| 多窗口 | 状态持久化在 `localStorage`（同一应用数据目录下按 origin 共享）与各 `WebviewManager` 实例内存；本功能**不要求**多窗口实时互相同步；新建窗口启动时按持久值初始化。若未来需要多窗口实时同步，应另立 `storage` 事件/广播能力，不在本轮范围 |
| 窗口最大化/还原/跨 900px 断点 | 渲染层媒体查询即时生效；主进程由 `resize()` 重排并使用同一折叠标志；收起态下 `_sidebarWidth` 不被 0 污染（见 §4.5） |
| 弹窗互斥（设置/升级/关闭确认） | 既有 `suspendEmbeddedViewsForOverlay` 逻辑优先：挂起期间折叠仍可切换本地态，主进程只改标志、不重排可见性；恢复时按新标志一次性归位 |
| 登录标签激活 | 登录视图由 `AuthViewManager` 自持；折叠标志必须同步到它，否则登录页左侧留白；`qrcode-login` 同理 |

---

## 十二、可访问性

1. **原生语义**：`<button type="button">`，不使用 `div`/`span` + 点击监听；不设置 `role` 覆盖原生按钮角色。
2. **状态可读**：`aria-pressed` 反映折叠状态（`true`=已收起），读屏器可播报「切换按钮，已按下/未按下」。
3. **可读名称**：`aria-label` 与 `title` 使用同一动作文案，且随状态切换；名称来自 locales（zh/en），不硬编码中文。
4. **图标装饰性**：SVG 带 `aria-hidden="true"` 与 `focusable="false"`，不进入可访问名称计算。
5. **键盘**：Enter/Space 触发；按钮可被 Tab 聚焦；焦点环可见且不裁剪。
6. **不进入 tablist**：`role="tablist"` 从 `TabBar` 根节点移到 `.tab-bar-tabs`，确保 tablist 的 `aria-label="标签页"` 只描述标签集合；折叠按钮与「+」按钮留在 tablist 之外。
7. **对比度**：图标前景与背景对比度 ≥ 3:1（非文本 UI 元素），hover/focus 态同样满足；暗色主题由 token 保证。
8. **动效偏好**：本功能无动画，`prefers-reduced-motion` 无额外分支。

---

## 十三、性能

| 维度 | 结论 |
|------|------|
| 首屏 | 状态读取是一次同步 `localStorage.getItem`（微秒级）；不新增网络/IPC 等待；渲染不依赖任何异步结果 |
| IPC 次数 | 启动时最多 1 次上报（仅当持久化为收起）+ 每次用户切换 1 次；无轮询、无定时器、无 `ResizeObserver` 新增（折叠不改变既有宽度上报链路） |
| 重排次数 | 主进程「值未变化即返回」；一次切换只触发一次 `_repositionAll`；一次重排只对当前可见视图 `setBounds` |
| 内存 | 不持有全局监听器；`apps/desktop/src/stores/sidebar-collapse.js` 是模块级单例 ref（非 Pinia、无 store 生命周期），组件卸载不需要额外清理；`SidebarToggleButton` 无订阅、无内部状态 |
| 布局抖动 | 折叠是单次 `display:none` 重排；无动画、无过渡，不产生连续帧重排 |
| 包体 | 内联 SVG（几十字节）替代图标依赖；不引入新依赖 |

---

## 十四、兼容性与回归风险

| 面 | 风险 | 现状/缓解 |
|----|------|-----------|
| `TabBar 36 + NavBar 40 = TOP 76` 契约 | 若按钮把标签栏撑高，所有内嵌视图会下移/遮挡 | 按钮在 36px 行内；不新增行；`BROWSER_CHROME_TOP` 不改 |
| 内嵌 `WebContentsView` | 侧栏隐藏但主进程不重排 → 左侧死区 | 新增显式跨进程同步链路（§4.4）；主进程侧为布局单一真源 `view-bounds.js` |
| 登录视图 `AuthViewManager` | 不同步 → 登录页左侧留白/覆盖 | `setSidebarCollapsed` 同步；未实现时 `typeof` 守卫不抛错 |
| 扫码登录 `QRCodeLogin` | 同上 | 同上 |
| OAuth 内嵌视图 | **已知限制**：`oauth-manager.js:86` 不传侧栏宽度，始终按默认 200 留白；收起后 OAuth 视图仍从 x=200 开始，左侧 200px 为空白 | 本轮明确不改；在 PRD/执行记录登记为遗留（见 §十七） |
| 窗口 ≤900px 的 68px 图标栏 | 收起/展开后宽度错乱 | 展开时使用 `_sidebarWidth` 的最后一个合法值（68）；收起不写 0，避免 `normalizeSidebarWidth` 回落 200 |
| `role="tablist"` 迁移 | 既有 E2E/组件测试若断言根节点 role，会失败 | 测试同步更新为断言 `.tab-bar-tabs` 的 role；根节点仅保留 `data-testid` 与容器语义 |
| 视觉基线 | 按钮是全局可见 UI，**所有**页面截图都会变化 | 见 §15.5 与 §17：不声称视觉中性；基线由 CI 同源渲染重建，禁止本机 `--update-baseline` 掩盖 |
| i18n | 新文案硬编码或 zh/en 不成对 | locale 成对写入 `tab-bar/{zh,en}.js`；CI Gate 7 `check-locale-sync.js` 拦截；`.vue` 新增中文字面量由 CJK 基线扫描拦截 |
| 旧 preload/主进程混用 | 新方法不存在 | `invokePageManager` 返回 `undefined`/`invoke` reject 均静默降级（§十） |

---

## 十五、测试计划

### 15.1 单元（渲染层）

1. `apps/desktop/src/stores/sidebar-collapse.test.js`：默认展开；`'1'` 恢复为收起；`'0'`/`'yes'` 等非法值展开；切换写 `'1'`/`'0'` 并上报 `setSidebarCollapsed(boolean)`；同值幂等（不重复上报）；非布尔入参忽略。
2. `localStorage.getItem` 抛异常 → 展开且不抛；`setItem` 抛异常 → 内存态仍切换、仍上报、不抛。
3. `reportSidebarCollapsed()` 只上报、不改状态（启动恢复主进程认知）；IPC reject 被吞掉，不产生未处理拒绝。
4. 非 Electron（`invokePageManager` 返回 `undefined`）→ 不抛错，切换照常生效。

### 15.2 组件

测试文件：`apps/desktop/src/components/TabBar.sidebar-toggle.test.js`、`apps/desktop/src/components/SidebarToggleButton.test.js`、`apps/desktop/src/App.sidebar-collapse.test.js`。

1. `TabBar` 渲染顺序：折叠按钮在 `.tab-bar-tabs` 之前；按钮不进入 tablist。
2. `role="tablist"` 位于 `.tab-bar-tabs`，根节点不再有 `role="tablist"`。
3. `aria-pressed` 随状态变化（false→true→false）；`aria-label`/`title` 与 locales 文案逐字一致（`tabBar.collapseSidebar` / `tabBar.expandSidebar`，zh/en 两侧）。
4. 按钮为 `<button type="button">`；图标 SVG `aria-hidden="true"`；无 emoji。
5. `App.vue` 的 `MpSidebar v-show="!sidebarCollapsed"` 生效：收起时 `display:none`，组件实例不卸载。

### 15.3 主进程

1. `apps/desktop/electron/services/view-bounds.test.js`：新增第 4 参用例——
   - `sidebarCollapsed=true` → `{ x: 0, y: 76, width: 客户区宽, height: 客户区高 - 76 }`；
   - `false` / 省略 / 非布尔 → 与既有 `x=sidebarWidth` 行为逐字相同（回归保护）。
2. `apps/desktop/electron/services/webview-manager.test.js`：`setSidebarCollapsed(true)` 更新 `_sidebarCollapsed` 并重排；同值重复调用不重排；非法类型忽略且 `_sidebarWidth` 不变；`setSidebarWidth` 既有守卫用例（0/-5/700）继续全绿。
3. `apps/desktop/electron/services/auth-view-manager.test.js` / `qrcode-login.test.js`：`setSidebarCollapsed` 同步存在，收起时登录/扫码视图按 `x=0` 定位、展开恢复。

### 15.4 IPC / preload

1. `apps/desktop/electron/preload/page-manager.sidebar-collapse.test.js`：preload 暴露 `pageManager.setSidebarCollapsed`，且只经 `page-manager:set-sidebar-collapsed` 通道、参数原样透传，不复用 `set-sidebar-width`。
2. IPC handler：合法布尔 → `code:0` 且状态更新（回执 `data.collapsed`）；非布尔 → 忽略 + warn，不抛错。

### 15.5 视觉门禁

1. **如实承认**：`apps/desktop/tests/visual-testing/base-screenshots/` 下 43 张 PNG（目录内除 `.gitignore` 外实测 43 个 PNG）全部包含顶部标签栏，因此**全部会变化**；不得把本次视觉门禁红解释为「无关抖动」。
2. 正确流程：本轮 PR 内**不**在本机执行 `pnpm test:visual:update-baseline` 覆盖基线；由 CI 在同源渲染环境重建基线（或按仓库既有基线重建流程单独提交基线更新 PR），并以浏览器/人工 diff 审核确认变化仅来自新增按钮与标签条起点右移。
3. 门禁读数口径：像素阈值沿用 CI（`PIXEL_THRESHOLD`）与本地默认值的差异，不私自放宽；更新基线时逐张确认差异区域位于标签栏左侧。
4. 补充取证：至少一张「展开」与一张「收起」的工作台截图（含浏览器标签激活态）用于人工审核，但**不作为**替代像素门禁的证据。

### 15.6 打包与启动（QM-1）

- 改动触及 `apps/desktop/electron/**`（主进程）与 preload ⇒ 必须执行本地打包 + 启动三层判据（存活断言、stderr 红线、`ELECTRON_RUN_AS_NODE` 剔除），具体命令与读数由 Lead 在执行记录回填。

---

## 十六、验收标准（可机械核对）

| # | 验收项 | 判据 |
|---|--------|------|
| 1 | 按钮全局存在且位置固定 | 工作台壳层任意路由渲染 `TabBar`，按钮 DOM 位于 `.tab-bar-tabs` 之前；标签条横向滚动时按钮位置不变 |
| 2 | 与标签栏同高 | 按钮所在行高 36px；`TabBar` 总高 36px，不新增行 |
| 3 | 点击切换 | 点击后 `MpSidebar` `display:none`、内容区铺满；再点恢复；`aria-pressed` 同步 |
| 4 | 持久化 | `localStorage['mulpub.ui.sidebarCollapsed']` 在收起后为 `'1'`，展开后为 `'0'`；重启后状态保持 |
| 5 | 非法值降级 | 手工写入 `'true'`/`'abc'`/空串后启动，侧栏为展开 |
| 6 | 跨进程全宽 | 收起时主进程 `computeEmbeddedViewBounds(win, w, 76, true)` 返回 `x=0`、`width=客户区宽`；展开时与现状逐字节一致 |
| 7 | 宽度守卫不被绕过 | 全量运行 `view-bounds.test.js` 与 `webview-manager.test.js`，`width<=0` 拒绝用例全绿；源码中不存在 `setSidebarWidth(0)` 的调用 |
| 8 | 非 Electron 降级 | 浏览器打开 Vite dev server，点击按钮 UI 正常切换，控制台无未捕获异常 |
| 9 | 可访问性 | 按钮为原生 button；`aria-pressed` 正确；zh/en `aria-label`/`title` 成对；SVG `aria-hidden`；Tab 可聚焦 |
| 10 | 契约不变 | `BROWSER_CHROME_TOP === 76` 未被修改；`TabBar` 高 36、`NavBar` 高 40 |
| 11 | 视觉基线影响已登记 | 文档/记录如实写明 43 张基线全量变化与重建流程，无「视觉中性」表述 |
| 12 | 文档同步 | 专项 PRD、OpenSpec change、PRD.md F8、DESIGN.md、i18n 术语、CHANGELOG、执行记录全部落盘 |

---

## 十七、遗留风险（不假装已闭合）

1. **OAuth 内嵌视图不跟随侧栏宽度**：`apps/desktop/electron/services/oauth-manager.js:86` 调用 `computeEmbeddedViewBounds(this.mainWindow)` 时未传宽度，始终按默认 200 计算。收起侧栏后 OAuth 授权页左侧会留 200px 空白。既有实现本就不跟随 ≤900px 的 68px，本轮不扩大改动面；登记为已知限制，建议后续单独立项把 `oauth-manager` 接入与登录视图相同的同步链路。
2. **视觉基线需要一次全量重建**：43 张基线全部变化，重建必须在同源渲染环境完成并逐张审核；本轮不提供「本机 update-baseline」的替代证据。
3. **多窗口不实时同步**：同一应用打开多个窗口时，折叠状态只在各自启动时从 `localStorage` 读取；运行期互不感知。若用户强需求，需新增 `storage` 事件广播或主进程统一状态源，属独立能力。
4. **`ResizeObserver` 与媒体查询的时序窗口**：收起跨 900px 断点后立即展开，`_sidebarWidth` 可能短暂沿用旧断点值，需等侧栏重新有宽度后的下一次上报才纠正。视觉上表现为一次重排，不造成死区；若要彻底消除，可让渲染层在展开时立即上报当前 CSS 宽度（实现可选，非验收必须）。
5. **RTL / 高 DPI 未专项验证**：图标为双向 chevron，RTL 下语义不变；高 DPI 下 SVG 矢量无模糊。但本轮不做 RTL 语言与 200% 缩放的专项视觉验收，登记为未取证项。

---

## 十八、变更记录

| 日期 | 变更 | 说明 |
|------|------|------|
| 2026-10-18 | 初版 | 随 `sidebar-collapse-toggle` 分支立项；设计已定稿（按钮位置、图标、持久化、IPC 合同、a11y、视觉基线影响），实现与验证证据由执行记录回填 |
