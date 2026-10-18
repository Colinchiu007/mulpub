## ADDED Requirements

### Requirement: 工作台壳层必须提供全局侧栏折叠按钮且位置固定

工作台壳层（`App.vue` 的 `mp-shell` 分支）SHALL 在顶部标签栏 `TabBar`
（`apps/desktop/src/components/TabBar.vue`）最左侧渲染一个「左侧菜单收起/展开」按钮。
按钮 MUST 位于可横向滚动的 `.tab-bar-tabs` 之前（DOM 顺序与视觉顺序一致），
MUST NOT 随标签条横向滚动而移动；按钮所在行高 MUST 保持 36px，
MUST NOT 改变 `TabBar(36px) + NavBar(40px) = BROWSER_CHROME_TOP(76px)` 的既有主进程契约。

按钮 MUST 使用原生 `<button type="button">`，图标 MUST 为内联 SVG 的双向 `chevron`（呈「<>」形状）、
使用 `currentColor`、视觉尺寸 16px，MUST NOT 使用 emoji 或图标字体。

#### Scenario: 工作台任意路由都能看到按钮且不随标签滚动

- **WHEN** 在工作台壳层渲染任意路由，并让 `.tab-bar-tabs` 横向滚动
- **THEN** 折叠按钮始终可见且位置不变
- **AND** 按钮在 DOM 中位于 `.tab-bar-tabs` 之前，`TabBar` 总高仍为 36px

#### Scenario: 全屏路由与 home-shell 实例不渲染该按钮

- **WHEN** 当前路由为 `/first-run`，或当前页面是 `?mp-home-shell=1` 的独立 SPA 实例
- **THEN** 不渲染 `TabBar`/`MpSidebar`，因此也不存在折叠按钮
- **AND** 这两类壳层的行为与本次变更前一致

### Requirement: 点击按钮必须在展开与收起之间切换且收起时完全隐藏侧栏

按钮 SHALL 在 `expanded` 与 `collapsed` 两个稳定状态间切换，切换 MUST 幂等。
`collapsed` 时左侧菜单 `MpSidebar`（`apps/desktop/src/layouts/MpSidebar.vue`）MUST 完全隐藏
（`v-show` / `display:none`，MUST NOT 卸载组件），主内容区横向铺满窗口；
`expanded` 时 MUST 恢复既有宽度：普通窗口 200px，窗口宽度 ≤900px 时按既有媒体查询为 68px 图标栏。
本功能 MUST NOT 引入收起/展开动画过渡。

#### Scenario: 点击一次收起、再点一次展开

- **WHEN** 用户点击按钮（或聚焦后按 Enter/Space）
- **THEN** 首次点击后侧栏 `display:none`、内容区铺满
- **AND** 再次点击后侧栏恢复原宽度，且 `MpSidebar` 组件实例未被卸载

#### Scenario: 收起时新建的浏览器/账号/登录视图按全宽定位

- **WHEN** 侧栏处于收起态，用户新建浏览器标签、账号标签或登录视图
- **THEN** 内嵌 `WebContentsView` 的 `x = 0`、`width = 窗口客户区全宽`、`y = 76`
- **AND** MUST NOT 出现「先按侧栏宽度渲染、再跳到全宽」的可见闪跳

### Requirement: 折叠状态必须持久化且非法值与存储异常一律降级为展开

渲染层 SHALL 使用 `localStorage` 键 `mulpub.ui.sidebarCollapsed` 持久化折叠状态：
值为 `'1'` 表示收起，其他任意值或缺失表示展开。
读取与写入 MUST 包裹 `try/catch`：读取抛异常（隐私模式/配额/权限）时 MUST 退化为展开且不阻塞渲染；
写入抛异常 MUST 静默吞掉、不阻止本次内存态切换。
非法值（`'0'`、`'true'`、空串、任意损坏字符串）MUST 按展开处理。

#### Scenario: 持久化为收起时重启保持收起

- **WHEN** 用户收起侧栏后重启应用
- **AND** `localStorage` 中该键为 `'1'`
- **THEN** 应用启动后侧栏保持收起
- **AND** 渲染层在工作台壳层挂载后主动上报一次 `setSidebarCollapsed(true)`，使之后新建的视图按全宽定位

#### Scenario: localStorage 不可用或值非法时降级为展开

- **WHEN** `localStorage.getItem` 抛异常，或键值为 `'0'`/`'true'`/空串/任意非法字符串
- **THEN** 应用以展开态启动，不弹错、不抛未捕获异常
- **AND** `localStorage.setItem` 抛异常时，用户点击仍能切换，界面不进入错误态

### Requirement: 收起状态必须跨进程同步到内嵌视图布局

收起/展开状态 SHALL 经 preload `pageManager.setSidebarCollapsed(boolean)`
→ IPC 通道 `page-manager:set-sidebar-collapsed` → 主进程 `WebviewManager`
→ `AuthViewManager` / `QRCodeLogin` 同步；主进程 SHALL 保存 `_sidebarCollapsed` 并将其用于
`computeEmbeddedViewBounds(win, sidebarWidth, topOffset = 76, sidebarCollapsed = false)` 的第 4 参。
当且仅当第 4 参严格为 `true` 时，内嵌视图 MUST 使用 `x = 0`、`width = 客户区全宽`；
为 `false` 或省略时 MUST 保持既有 `x = sidebarWidth`、`width = 客户区宽 - sidebarWidth` 的行为。
IPC 参数 MUST 为严格布尔；非布尔值 MUST 被主进程 warn 后忽略，MUST NOT 抛错或改变状态。
主进程 MUST 在状态未变化时不重复重排。

#### Scenario: 收起后浏览器标签左缘与内容区对齐

- **WHEN** 侧栏展开且存在激活的浏览器标签，用户点击收起
- **THEN** 主进程重排该视图：`x = 0`、`y = 76`、`width = 客户区全宽`、`height = 客户区高 - 76`
- **AND** 登录视图与扫码登录视图同样按 `x = 0` 定位，不得在左侧留出侧栏宽度

#### Scenario: 展开后视图回到既有定位且旧调用方零变化

- **WHEN** 侧栏从收起切回展开
- **THEN** 视图 `x = _sidebarWidth`（普通窗口 200、≤900px 时 68）
- **AND** 以 3 个参数调用 `computeEmbeddedViewBounds` 的旧路径（如 `oauth-manager.js:86`）返回值与本次变更前逐字节相同

#### Scenario: IPC 参数非法时被忽略

- **WHEN** 主进程收到非布尔的 `setSidebarCollapsed` 参数（如 `0`、`"true"`、`null`）
- **THEN** 主进程记录 warn 并忽略，不改变 `_sidebarCollapsed`、不重排
- **AND** IPC 调用不抛未捕获异常

### Requirement: 既有侧栏宽度守卫不得被折叠逻辑绕过

收起状态 MUST 由独立的布尔标志表达，MUST NOT 通过 `setSidebarWidth(0)` 或任何 `< MIN_SIDEBAR_WIDTH`
的宽度值表达。`MIN_SIDEBAR_WIDTH = 1`、`MAX_SIDEBAR_WIDTH = 600`、`normalizeSidebarWidth()` 的回落规则，
以及 `WebviewManager` / `AuthViewManager` / `QRCodeLogin` 三处 `setSidebarWidth` 的入参拒绝逻辑
MUST 逐字保留。`setSidebarCollapsed` MUST NOT 修改 `_sidebarWidth`。

#### Scenario: 宽度 0 仍被拒绝且不污染展开宽度

- **WHEN** 调用 `setSidebarWidth(0)` 或 `setSidebarWidth(-5)`
- **THEN** 调用被拒绝，`_sidebarWidth` 保持上一个合法值
- **AND** 收起再展开后，视图仍回到该合法值（200 或 68），不会回落默认 200 或出现 0 宽

#### Scenario: 收起期间侧栏的 0 宽度不进入主进程状态

- **WHEN** 侧栏进入收起态、其 `getBoundingClientRect().width` 变为 0
- **THEN** `MpSidebar` 既有的 `w > 0` 守卫阻止 0 被上报
- **AND** 主进程 `_sidebarWidth` 保持收起前的合法值

### Requirement: 折叠按钮必须满足可访问性合同

按钮 MUST 是原生 `<button type="button">`，MUST 暴露 `aria-pressed`（`true` = 已收起、`false` = 展开），
其 `aria-label` 与 `title` MUST 使用同一文案并随状态切换：
展开态动作为「收起左侧菜单」/“Collapse sidebar”，收起态动作为「展开左侧菜单」/“Expand sidebar”。
文案 MUST 写入 `apps/desktop/src/locales/tab-bar/{zh,en}.js` 且 zh/en 成对，渲染层 MUST NOT 硬编码中文。
图标 SVG MUST 带 `aria-hidden="true"` 与 `focusable="false"`；按钮 MUST 支持键盘 Enter/Space 并显示沿用设计 token 的焦点环。
`role="tablist"` MUST 位于 `.tab-bar-tabs`，折叠按钮与「+」按钮 MUST NOT 位于 tablist 内。

#### Scenario: 读屏器与键盘用户可获知并切换状态

- **WHEN** 键盘用户 Tab 到按钮并按 Enter 或 Space
- **THEN** 状态切换，`aria-pressed` 与 `aria-label`/`title` 在同一帧更新为相反状态的文案
- **AND** 图标不被读屏器单独播报

#### Scenario: tablist 只包含标签页

- **WHEN** 检查 `TabBar` 的 ARIA 结构
- **THEN** `role="tablist"` 只出现在 `.tab-bar-tabs` 上
- **AND** 折叠按钮与「+」按钮在 tablist 之外，不参与 tab 序列

### Requirement: 非 Electron 环境与 IPC 失败必须静默降级为本地折叠

当 `window.electronAPI.pageManager` 不可用（如浏览器打开 Vite dev server）或 IPC 调用失败时，
`invokePageManager` 的结果 SHALL 被静默忽略；渲染层 MUST 保持本地二态切换可用，
MUST NOT 抛出未捕获异常、MUST NOT 无限重试、MUST NOT 以模态弹窗打断用户。

#### Scenario: 浏览器环境点击按钮不报错

- **WHEN** 在无 `window.electronAPI` 的环境点击折叠按钮
- **THEN** 侧栏 UI 正常切换
- **AND** 控制台无未捕获异常，功能退化为「仅本地折叠」

#### Scenario: 旧主进程缺少新通道时功能降级可见

- **WHEN** 渲染层调用 `setSidebarCollapsed` 但主进程未注册该通道（新旧版本混用）
- **THEN** 调用失败被静默吞掉，UI 仍可本地切换
- **AND** 不出现阻塞式错误弹窗或渲染层白屏
