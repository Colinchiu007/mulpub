# Tasks：主窗口左侧菜单收起/展开（sidebar-collapse-toggle）

判据口径：`[x]` 只列本 change 交付范围内的任务；验证读数与证据由 `openspec/records/sidebar-collapse-toggle.md` 回填，
任务描述本身不预写测试数字或 merge SHA。

## 1. 设计与取证

- [x] 1.1 核对壳层现状：`TabBar.vue` 36px / `NavBar.vue` 40px / 主进程 `BROWSER_CHROME_TOP=76`（`view-bounds.js:29`）
- [x] 1.2 核对侧栏宽度真源：`sidebar.css` 的 `--mp-sidebar-width:200px` 与 `@media (max-width:900px)` 的 68px
- [x] 1.3 核对宽度守卫：`MIN_SIDEBAR_WIDTH=1` / `MAX_SIDEBAR_WIDTH=600` 与三处 `setSidebarWidth` 拒绝逻辑，确认收起不可用 `width=0` 表达
- [x] 1.4 核对既有宽度上报链路：`MpSidebar.vue:221-230` 的 `ResizeObserver` 有 `w > 0` 守卫，收起不会把 0 上报
- [x] 1.5 位置方案对比（TabBar 最左 / NavBar 右侧 / 侧栏头部 / 悬浮固定）并定稿为 TabBar 最左侧（见 design.md 决策 1）
- [x] 1.6 确认视觉基线影响：`base-screenshots/` 实测 43 张 PNG（目录含 `.gitignore` 共 44 项），全局按钮使全部基线变化

## 2. 渲染层

- [x] 2.1 新增 `apps/desktop/src/stores/sidebar-collapse.js`：模块级单例 `sidebarCollapsed` ref（非 Pinia），导出 `setSidebarCollapsed` / `toggleSidebarCollapse` / `reportSidebarCollapsed`，模块加载时读取持久化
- [x] 2.2 持久化实现：键 `mulpub.ui.sidebarCollapsed`，`'1'` 为收起；读只认严格 `'1'`，其余/缺失/异常按展开；写 `'1'/'0'`，读写均 try/catch；非布尔入参忽略
- [x] 2.3 新增 `apps/desktop/src/components/icons/SidebarToggleIcon.vue`：内联 SVG 双 chevron（`viewBox 0 0 16 16`、16px、`currentColor`、`aria-hidden`、`focusable=false`）
- [x] 2.4 新增 `apps/desktop/src/components/SidebarToggleButton.vue`：原生 button 封装图标，`collapsed` 由父层传入，点击只 `emit('toggle')`
- [x] 2.5 接入 `apps/desktop/src/components/TabBar.vue`：按钮置于 `.tab-bar-tabs` 之前，标签条滚动不带动按钮；不新增行高
- [x] 2.6 `apps/desktop/src/App.vue`：`MpSidebar v-show="!sidebarCollapsed"`（不卸载组件），收起时 `display:none`、主内容区横向铺满
- [x] 2.7 `role="tablist"` 从 TabBar 根节点迁移到 `.tab-bar-tabs`，折叠按钮与「+」按钮留在 tablist 之外
- [x] 2.8 启动恢复上报：`App.vue` 工作台壳层 `onMounted`（`!isHomeShell`）调用 `reportSidebarCollapsed()`；非 Electron（返回 `undefined`）与 IPC reject 静默
- [x] 2.9 样式走既有 token：常态 `--color-text-secondary`、hover `--color-bg-card`/`--color-border`/`--color-primary`、收起态 `--color-primary`、焦点 `--color-primary`；无十六进制颜色字面量，折叠无动画（按钮 hover 过渡在 reduced-motion 下关闭）
- [x] 2.10 locales 成对新增：`apps/desktop/src/locales/tab-bar/zh.js` 的 `collapseSidebar: '收起左侧菜单'` / `expandSidebar: '展开左侧菜单'`，`en.js` 的 `'Collapse sidebar'` / `'Expand sidebar'`；tooltip 与 `aria-label` 同文案
- [x] 2.11 a11y：`aria-pressed`（true=已收起）随状态变化，`aria-label`/`title` 随状态切换，键盘 Enter/Space 可用，SVG 不进入可访问名称

## 3. 主进程与桥接

- [x] 3.1 `apps/desktop/electron/services/view-bounds.js`：`computeEmbeddedViewBounds(win, sidebarWidth, topOffset = 76, sidebarCollapsed = false)`，仅严格 `true` 时 `x=0`、`width=客户区全宽`
- [x] 3.2 `apps/desktop/electron/services/webview-manager/layout.js`：新增 `setSidebarCollapsed(value)` 与 `isSidebarCollapsed()`，非布尔 warn + 忽略、同值直接 return、变化时置 `_sidebarCollapsed` 并 `_repositionAll()`
- [x] 3.3 `apps/desktop/electron/services/webview-manager/index.js`：初始化 `_sidebarCollapsed = false`
- [x] 3.4 同步 `apps/desktop/electron/services/auth-view-manager.js`：新增 `setSidebarCollapsed(boolean)` 并在 `_positionView()` 传入第 4 参
- [x] 3.5 同步 `apps/desktop/electron/services/qrcode-login.js`：同上，保证扫码登录视图收起后也 x=0
- [x] 3.6 `apps/desktop/electron/services/webview-manager/ipc-handlers.js`：新增 `page-manager:set-sidebar-collapsed`，沿用 `withSenderCheck` + try/catch，回执 `{ code:0, data:{ collapsed: isSidebarCollapsed() } }`
- [x] 3.7 `apps/desktop/electron/preload/page-manager.js`：新增 `setSidebarCollapsed: (collapsed) => ipcRenderer.invoke('page-manager:set-sidebar-collapsed', collapsed)`
- [x] 3.8 保留既有守卫：`setSidebarWidth` 的 `width<1 || width>600` 拒绝与 `normalizeSidebarWidth` 回落规则逐字不变
- [x] 3.9 幂等与重排：一次折叠只触发一次 `_repositionAll`；窗口 resize 路径（`layout.js:12-13`）复用同一标志

## 4. 测试与验证

- [x] 4.1 `apps/desktop/src/stores/sidebar-collapse.test.js`：默认展开 / `'1'` 收起 / 非法值展开 / `getItem`·`setItem` 抛异常 / 同值幂等 / 非布尔忽略 / `reportSidebarCollapsed` 只上报 / IPC reject 不产生未处理拒绝
- [x] 4.2 组件测试（`apps/desktop/src/components/TabBar.sidebar-toggle.test.js`、`SidebarToggleButton.test.js`、`apps/desktop/src/App.sidebar-collapse.test.js`）：按钮位于 `.tab-bar-tabs` 之前、不进入 tablist；`role="tablist"` 只在 `.tab-bar-tabs`；`aria-pressed` 与文案随状态切换；SVG `aria-hidden`；`MpSidebar v-show` 生效
- [x] 4.3 `apps/desktop/electron/services/view-bounds.test.js` 新增第 4 参用例：`true` → `x=0`、宽=客户区宽、`y=76`；`false`/省略/非布尔 → 与现状逐字节一致
- [x] 4.4 `apps/desktop/electron/services/webview-manager.test.js` 新增：`setSidebarCollapsed` 更新并重排、同值不重排、非法类型忽略且 `_sidebarWidth` 不变；既有 0/-5/700 拒绝用例全绿；`auth-view-manager.test.js` / `qrcode-login.test.js` 补同步用例
- [x] 4.5 IPC/preload 契约（`apps/desktop/electron/preload/page-manager.sidebar-collapse.test.js`）：新方法存在、通道名逐字匹配、参数原样透传、不复用 `set-sidebar-width`；非布尔参数在 manager 层被忽略不抛错
- [x] 4.6 非 Electron 降级：无 `window.electronAPI` 时点击按钮 UI 正常切换、无未捕获异常
- [x] 4.7 locale 成对校验：`check-locale-sync.js` 的配对与 CJK 检查通过；`tabBar` 命名空间两侧键集一致
- [x] 4.8 手动验证（真实 Electron 窗口）：展开 → 收起 → 打开浏览器标签（全宽）→ 展开 → 新建登录标签（左侧留出 200px）→ 重启保持收起
- [x] 4.9 QM-1：因触及 `apps/desktop/electron/**` 与 preload，执行本地打包 + 启动三层判据（存活、stderr 红线、剔除 `ELECTRON_RUN_AS_NODE`）
- [x] 4.10 视觉基线：确认 43 张全部变化并登记 CI 同源重建流程；本 PR 不执行本机 `--update-baseline`

## 5. 文档

- [x] 5.1 `01-docs/PRD-SIDEBAR-COLLAPSE-TOGGLE-2026-10-18.md`：背景、目标/非目标、位置对比、状态机、持久化、IPC 合同、交互、显示项、文案、校验、流程、降级、边界、a11y、性能、兼容、测试、验收、遗留
- [x] 5.2 `openspec/changes/sidebar-collapse-toggle/`（proposal / design / tasks / spec）
- [x] 5.3 `01-docs/PRD.md` §3.1 F8 功能表新增条目并链接专项 PRD
- [x] 5.4 `01-docs/DESIGN.md` 新增「全局壳层：左侧菜单收起/展开」章节（位置、尺寸、图标、状态、持久化、a11y）
- [x] 5.5 `01-docs/i18n-glossary.md` 新增「收起左侧菜单 / Collapse sidebar」「展开左侧菜单 / Expand sidebar」两条表行，并注明 `侧边栏 / Sidebar` 因 `glossary.test.js` 的出现状态校验（zh 侧无字符串值含该词）暂不登记为表行的原因
- [x] 5.6 `CHANGELOG.md` 顶部新增一条（功能、持久化、跨进程、a11y、视觉基线影响、非目标）
- [x] 5.7 `01-docs/learnings.md` 追加本次经验（视觉基线全量变化、width=0 不可表达收起、原生视图必须同步重排、tablist 不能塞非 tab 按钮）
- [x] 5.8 `openspec/records/sidebar-collapse-toggle.md` 按 `_TEMPLATE.md` 写 frontmatter 与门禁表格，未取证处写 PENDING

## 6. 交付与收尾

- [x] 6.1 相关单测并集全绿（`stores/sidebar-collapse` / 组件 / App / view-bounds / webview-manager / auth-view / qrcode-login / preload）
- [x] 6.2 执行记录回填实测命令与读数（由 Lead 验证后完成）
- [x] 6.3 开 PR 后等待 CI 全绿；混合 PR 走完整质量节拍
- [x] 6.4 合并后按主干历史推导收口（`scripts/lib/merge-ledger.js`），不另开回填 PR
- [x] 6.5 视觉基线由 CI 同源重建并逐张审核新增按钮区域

## 7. 已知限制收尾（PR #3916 合并后，`sidebar-collapse-followups` 分支）

判据口径：本节三项来自 #3916 执行记录「遗留（不假装已闭合）」清单，逐条关闭或降级，并写明依据。

- [x] 7.1 OAuth 内嵌视图接入侧栏宽度/折叠同步：`oauth-manager.js` 的 `_positionView()` 只传 1 参给 `computeEmbeddedViewBounds` ⇒ `sidebarWidth` 回落默认 200、`collapsed` 恒 false。补 `setSidebarWidth` / `setSidebarCollapsed` + `_positionView` 传满 4 参，`WebviewManager` 两个 setter 纳入同步链，`window.js` 经 `setOAuthManager` 注入
- [x] 7.2 OAuth 视图补 `mainWindow` resize 监听（原只在 `startAuth` 定位一次；授权过程中拖动窗口会复现 `view-bounds.js` 头部所述 2026-09-13「视图被窗口边框裁掉」同形态缺陷）；`close()` 与 `setMainWindow` 换绑时解绑
- [x] 7.3 抽出 `view-bounds.isValidSidebarWidth()` 单一真源：四处 manager 各自手写的 `width < MIN || width > MAX` 拦不住 NaN（NaN 的所有比较都是 false），NaA 会穿过 `typeof === 'number'` 检查被写进 `_sidebarWidth`；四个 manager 改为共用该守卫
- [x] 7.4 多窗口实时同步：主进程 `WebviewManager.broadcastSidebarCollapsed()` 向 `getAllWindows()` 投递 `page-manager:sidebar-collapsed-changed`（载荷 `{ data: { collapsed } }`），`setSidebarCollapsed` 变更后自动触发
- [x] 7.5 渲染层 `applyRemoteCollapsed()`：只改本地 ref 并通知订阅者，**不写 localStorage、不上报 IPC**（持久化真源是用户点击的那个窗口；回传会形成 A↔B 互刷）；`subscribeSidebarCollapsed()` + `App.vue` onMounted 订阅 / onBeforeUnmount 退订
- [x] 7.6 测试：新增 OAuth 布局同步 7 例、`isValidSidebarWidth` 4 例（含 NaN 复现）、广播 8 例、`setOAuthManager` 注入 4 例、store 广播同步 8 例、App 订阅 5 例、preload 广播合同 3 例、跨进程链路多窗口 1 例
- [x] 7.7 第 3 项遗留（收起期间跨 900px 断点、展开后需一次宽度上报纠正）经代码复核**降级为「无需处理」**：`computeEmbeddedViewBounds` 内部 `collapsed ? 0 : normalizeSidebarWidth(width)` 已让 width 参数在收起态完全失效，展开时 `MpSidebar` 的 `ResizeObserver`（`w > 0` 守卫）在同一帧后上报真实宽度，不产生错误布局；实测未捕获到可见跳动，故不再单开修复
- [x] 7.8 文档：本节 tasks + spec 新增 3 条 Requirement + 执行记录 `openspec/records/sidebar-collapse-followups.md`
