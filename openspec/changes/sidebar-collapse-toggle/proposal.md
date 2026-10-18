# Proposal: sidebar-collapse-toggle

> 本 change 为 Multi-Publish 主窗口工作台壳层增加「左侧菜单收起/展开」能力：
> 渲染层二态状态 + `localStorage` 持久化 + preload/IPC 合同 + 主进程内嵌视图全宽重排 +
> 可访问性 + 视觉基线影响登记。代码服从本文件与 `specs/sidebar-collapse-toggle/spec.md`。

## Why

主窗口是固定三段式壳层：左侧 `MpSidebar` + 右侧 `TabBar`(36px) / `NavBar`(40px) / 内容区。
侧栏宽度只有「普通窗口 200px、窗口 ≤900px 时 68px 图标栏」两态（`apps/desktop/src/styles/sidebar.css`），
用户没有任何可控的收起入口：

1. **横向空间不可让渡**：用户专注阅读网页、比对内容或在小窗口下操作时，侧栏始终占 200px（或 68px），
   只能靠缩放窗口换取空间，而缩放又会连带把内容区压窄。
2. **内嵌视图不跟随 DOM**：浏览器/账号/登录标签是主进程 `WebContentsView` 原生图层，
   由 `apps/desktop/electron/services/view-bounds.js` 的 `computeEmbeddedViewBounds()` 按
   `x = 侧栏宽度` 定位。只用 CSS 隐藏侧栏而不通知主进程，浏览器标签左侧会留下 200px/68px 死区，
   鼠标落点与视觉分界错位——这是「加个按钮」之外必须解决的跨进程问题。
3. **宽度 0 已被守卫禁止**：`MIN_SIDEBAR_WIDTH = 1`（`view-bounds.js:41`）与三处 `setSidebarWidth` 守卫
   是 2026-09-15「内嵌视图覆盖侧边栏、拦截全部点击」Bug 的防御层。收起**不能**用 `width = 0` 表达，
   否则会被 `normalizeSidebarWidth` 回落 200 / 被 `setSidebarWidth` 整条拒绝。
4. **入口位置受限**：侧栏头部内部不可行（收起后入口随侧栏消失，用户无法再展开）；悬浮按钮不可行
   （原生 `WebContentsView` 永远压在 DOM 之上，浏览器标签激活时按钮会点不到）。
5. **全局可见 UI 的代价必须提前说清**：按钮位于顶部标签栏，会让所有视觉基线截图变化；
   本 change 不声称视觉中性，而是把「全量基线重建」作为交付的一部分登记。

## What Changes

- **新增 capability `sidebar-collapse-toggle`**，用 Requirement/Scenario 钉住七件事：
  1. 按钮全局存在且位置固定（TabBar 最左侧、`.tab-bar-tabs` 之前、36px 行内、不随标签滚动）；
  2. 点击在 `expanded ⇄ collapsed` 间切换，收起时 `MpSidebar` 完全隐藏（`v-show`，不卸载）；
  3. `localStorage['mulpub.ui.sidebarCollapsed']` 持久化：`'1'` 收起、其他/缺失展开，读写 try/catch，
     非法值与异常一律降级展开，不阻塞渲染；
  4. IPC 合同：preload `pageManager.setSidebarCollapsed(boolean)` → `page-manager:set-sidebar-collapsed`
     → `WebviewManager._sidebarCollapsed` → 同步 `AuthViewManager` / `QRCodeLogin`；
     `computeEmbeddedViewBounds` 新增第 4 参 `sidebarCollapsed`，为 `true` 时内嵌视图 `x=0`、宽=客户区全宽；
  5. 既有宽度守卫不被绕过：`MIN_SIDEBAR_WIDTH=1`、`MAX_SIDEBAR_WIDTH=600` 与三处 `setSidebarWidth` 校验逐字保留，
     收起只用显式布尔标志表达；
  6. 可访问性：原生 `<button type="button">`、`aria-pressed`、随状态变化的 `aria-label`/`title`
     （zh/en 成对 locales）、SVG `aria-hidden`、Enter/Space 可用、焦点环沿用设计 token、
     `role="tablist"` 从 TabBar 根节点移到 `.tab-bar-tabs`（按钮与「+」不进入 tablist）；
  7. 非 Electron 降级：`invokePageManager` 返回 `undefined` 时功能退化为仅本地折叠，不抛错、不阻塞渲染。
- **渲染层新增**：`apps/desktop/src/stores/sidebar-collapse.js`（模块级单例 ref：状态 + 持久化 + 上报，
  导出 `sidebarCollapsed` / `setSidebarCollapsed` / `toggleSidebarCollapse` / `reportSidebarCollapsed`）、
  `apps/desktop/src/components/SidebarToggleButton.vue`（原生按钮）与
  `apps/desktop/src/components/icons/SidebarToggleIcon.vue`（内联 SVG 双 chevron「<>」、16px、`currentColor`），
  并接入 `apps/desktop/src/components/TabBar.vue` 与 `apps/desktop/src/App.vue`
  （`MpSidebar v-show="!sidebarCollapsed"` + 启动 `reportSidebarCollapsed()`）。
- **主进程新增**：`computeEmbeddedViewBounds(win, sidebarWidth, topOffset = 76, sidebarCollapsed = false)`；
  `WebviewManager.setSidebarCollapsed(boolean)`（值未变化不重排）；IPC handler 与 preload 方法。
- **i18n**：新增「收起左侧菜单 / Collapse sidebar」「展开左侧菜单 / Expand sidebar」两条文案，
  写入 `apps/desktop/src/locales/tab-bar/{zh,en}.js`，zh/en 成对；`.vue` 内不得硬编码中文。
- **文档**：专项 PRD `01-docs/PRD-SIDEBAR-COLLAPSE-TOGGLE-2026-10-18.md`、本 change、
  执行记录 `openspec/records/sidebar-collapse-toggle.md`、`CHANGELOG.md`、`01-docs/PRD.md` F8、
  `01-docs/DESIGN.md`「全局壳层」、`01-docs/i18n-glossary.md` 术语、`01-docs/learnings.md` 沉淀。
- **视觉基线**：`apps/desktop/tests/visual-testing/base-screenshots/` 下 43 张 PNG 全部变化，
  由 CI 同源渲染重建，不在本轮用本机 `--update-baseline` 覆盖。

## 不在本 change 范围

- ❌ 收起/展开动画过渡（避免与原生 `WebContentsView` 边界不同步）。
- ❌ 拖拽调宽、自定义宽度持久化（本轮只做二态折叠）。
- ❌ 窄屏 68px 图标栏的第二种折叠形态（≤900px 的既有媒体查询保持不变）。
- ❌ 快捷键（避免与输入框、浏览器标签、全局快捷键冲突）。
- ❌ OAuth 内嵌视图：`apps/desktop/electron/services/oauth-manager.js:86` 既有实现不传侧栏宽度，
  始终按默认 200 定位，本就不跟随真实侧栏宽度；本轮如实登记为已知限制，不扩大改动面。
- ❌ 多窗口运行期实时同步（状态在各自启动时读取；实时同步需另立 `storage` 广播能力）。
- ❌ 本机覆盖视觉基线（基线重建走 CI 同源流程并逐张审核）。

## Impact

| 面 | 影响 |
|---|---|
| 渲染层 | 新增模块单例 store、按钮与图标组件；`TabBar.vue` 增加按钮与 `role="tablist"` 迁移；`App.vue` 用 `v-show` 隐藏 `MpSidebar` 并在 `onMounted` 上报启动恢复；`MpSidebar` 既有 `ResizeObserver` 的 `w > 0` 守卫保证收起不会把宽度 0 上报给主进程 |
| 主进程 | `view-bounds.js` 新增第 4 参（旧 3 参调用零行为变化）；`webview-manager/layout.js` 新增 `setSidebarCollapsed` 并同步 `auth-view-manager.js` / `qrcode-login.js`；`webview-manager/ipc-handlers.js` 新增通道 |
| preload / IPC | `electron/preload/page-manager.js` 新增 `setSidebarCollapsed`；通道 `page-manager:set-sidebar-collapsed` 必须与主进程 handler 成对，拼写漂移由测试锁 |
| 持久化 | 新 `localStorage` 键 `mulpub.ui.sidebarCollapsed`，无数据库/文件迁移；旧版本无该键即展开 |
| i18n | 两条动作文案 zh/en 成对进 `tab-bar` 命名空间；不得在 `.vue` 新增中文字面量（Gate 7 + CJK 基线扫描） |
| 可访问性 | tablist 语义修正（根节点 → `.tab-bar-tabs`）；新按钮 `aria-pressed` + 动态 label；不引入 emoji |
| 视觉基线 | 43 张 PNG 全量变化；PR 内不覆盖基线，由 CI 同源重建并逐张审核，禁止声称「视觉中性」 |
| 测试 | 新增 store/组件/App/view-bounds/webview-manager/auth-view/qrcode-login/preload 用例；既有 `width<=0` 拒绝用例必须继续全绿 |
| 回退 | `localStorage` 键按非法值处理（展开），`git revert` 后主进程默认 `false`，无持久化格式迁移；风险最低 |
| 风险 | 若同步链路漏一环（preload/通道/handler/manager 同步），会出现「侧栏隐藏但浏览器标签左侧死区」——这是本 change 的核心失败模式，规格与测试把它钉成必检项 |
