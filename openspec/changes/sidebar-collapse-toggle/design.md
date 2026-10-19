# Design：左侧菜单收起/展开

## 决策 1 —— 按钮位置：TabBar 最左侧固定列

| 方案 | 判定 | 理由 |
|---|---|---|
| A. **TabBar 最左侧、`.tab-bar-tabs` 之前** | ✅ 采纳 | 位于既有 36px 行内，不破坏 `TabBar(36) + NavBar(40) = TOP 76`；标签条自身 `overflow-x:auto` 从按钮右侧开始，滚动不带动按钮；紧贴侧栏/内容区分界，动作方向与视觉位置一致 |
| B. NavBar 右侧 | ❌ 否 | 与 URL 搜索栏、保存账号、导航按钮抢同一行；折叠是壳层动作，放在页面工具栏会被读成页面动作 |
| C. 侧边栏头部内部 | ❌ 否 | 收起后侧栏整体隐藏，入口随侧栏消失，用户无法再展开——决定性缺陷 |
| D. 悬浮固定按钮（`position:fixed`） | ❌ 否 | 原生 `WebContentsView` 永远在 DOM 之上，浏览器标签激活时按钮会被视图覆盖/拦截点击，产生「按钮在但点不到」的间歇态 |

## 决策 2 —— 状态归属：渲染层持二态，主进程持布局权威

- **渲染层**：`apps/desktop/src/stores/sidebar-collapse.js` 持有模块级单例 `sidebarCollapsed` ref，负责：
  1. 模块加载时同步读取 `localStorage`；
  2. `setSidebarCollapsed` / `toggleSidebarCollapse` 更新 ref、写 `localStorage`、调用 preload；
  3. `reportSidebarCollapsed` 供启动恢复（只上报、不改状态）；
  4. 对非 Electron、IPC reject、存储异常静默降级。
- **主进程**：`WebviewManager._sidebarCollapsed` 是**内嵌视图布局的权威**（原生图层只看主进程状态）。
  渲染层上报只是「用户意图 → 布局权威」的单向同步；主进程不反向驱动 UI（避免双写循环）。
- **为什么是模块单例而不是 Pinia**：它被壳层（`App.vue`）与 `TabBar` 同时消费，且不依赖任何业务 store 的
  生命周期；与既有 `apps/desktop/src/stores/settings-dialog.js` 同族。模块单例在模块加载时就完成持久化读取，
  比 Pinia store 更早、更简单，也更容易脱离 Vue 测试。
- **为什么不用 `v-if`**：`v-if` 会卸载 `MpSidebar`，导致其内部菜单状态、`ResizeObserver`、运营菜单订阅
  全部重建；`v-show` 只切换 `display`，保持组件实例与订阅生命周期不变（与 `App.vue` 对工作区
  `v-show` 的「不卸载以免丢状态」纪律一致）。**`v-show` 施加在 `App.vue` 的 `<MpSidebar>` 上，
  `MpSidebar.vue` 本体不修改**；其既有 `if (w > 0)` 守卫保证隐藏时不上报 `width=0`。

## 决策 3 —— 收起不能用 `width = 0` 表达

- `view-bounds.js` 的 `MIN_SIDEBAR_WIDTH = 1` 与 `normalizeSidebarWidth()` 的「`<1` 或 `>600` 回落 200」
  是 2026-09-15「平台链接浮层盖住侧边栏」Bug 的防御层；`WebviewManager.setSidebarWidth` 对 `width<=0`
  直接 warn + return。若用 0 表达收起：① 上报会被整条拒绝；② 即便进了计算，`normalizeSidebarWidth(0)`
  会回落 200，视图仍按 200 定位，收起失败且感知不到。
- **正确做法**：新增独立布尔标志 `_sidebarCollapsed`，`computeEmbeddedViewBounds` 增加第 4 参：
  `computeEmbeddedViewBounds(win, sidebarWidth, topOffset = 76, sidebarCollapsed = false)`。
  - `sidebarCollapsed === true` → `x = 0`、`width = 客户区宽`；
  - 其他任何值（`false`/`undefined`/非布尔）→ 保持既有 `x = sidebarWidth`、`width = 客户区宽 - sidebarWidth`。
- **旧调用方零变化**：`oauth-manager.js:86` 仍以 3 参调用，落入默认 `false` 分支；新增参数只影响显式传入 `true` 的路径。
- **不碰宽度状态**：`setSidebarCollapsed` 不修改 `_sidebarWidth`。收起时 `MpSidebar` 宽度变 0，
  但其 `ResizeObserver` 有 `if (w > 0)` 守卫（`MpSidebar.vue:225`），不会把 0 上报；
  展开时直接用回最后一个合法宽度（200 或 68）。
- **幂等**：`_sidebarCollapsed` 与目标值相同则直接 return，避免启动上报与用户点击叠加造成重复 `setBounds`。

## 决策 4 —— 跨进程合同

```text
渲染层 toggleSidebarCollapse()（stores/sidebar-collapse.js）
  → localStorage['mulpub.ui.sidebarCollapsed'] = collapsed ? '1' : '0'（try/catch）
  → invokePageManager('setSidebarCollapsed', collapsed)       // 无 API 时返回 undefined，reject 被 .catch 吞掉
      → preload: pageManager.setSidebarCollapsed(boolean)
      → ipcRenderer.invoke('page-manager:set-sidebar-collapsed', collapsed)
      → ipc-handlers: withSenderCheck + try/catch；回执 { code:0, data:{ collapsed } }
      → WebviewManager.setSidebarCollapsed(boolean)
          校验 typeof === 'boolean'，否则 warn + 忽略
          值变化时：_sidebarCollapsed = value
                    → AuthViewManager.setSidebarCollapsed(value)（typeof 守卫）
                    → QRCodeLogin.setSidebarCollapsed(value)（typeof 守卫）
                    → _repositionAll()
```

- **同源模式**：与既有 `setSidebarWidth` 完全同构（preload → `page-manager:*` → handler → manager → 同步两个子管理器），
  不引入第二套 IPC 约定。
- **失败降级**：渲染层视觉态以本地为准；IPC reject/无 API 时静默，不重试、不弹窗。主进程状态若落后，
  下一次成功调用或启动上报会收敛（幂等）。
- **参数校验**：主进程只接受严格布尔；非布尔 warn 并忽略（不抛错，避免渲染层进入错误重试循环）。
- **启动恢复**：持久化为收起时，`App.vue` 的工作台壳层 `onMounted`（`!isHomeShell`）调用 `reportSidebarCollapsed()`
  上报一次当前状态（只上报、不改内存状态）；保证之后新建的浏览器/账号/登录视图按全宽定位。
  持久化为展开时也走同一函数，主进程值未变化即幂等返回。
- **新建视图**：所有内嵌视图最终经 `WebviewManager._repositionAll()` 的
  `computeEmbeddedViewBounds(this.mainWindow, sidebarWidth, undefined, this._sidebarCollapsed)` 定位
  （`webview-manager/layout.js:191`）；新建后必须触发一次重排，禁止「先按 200 显示再跳到 0」。

## 决策 5 —— DOM 与可访问性

- 按钮位于 `TabBar` 根节点内、`.tab-bar-tabs` 之前；`.tab-bar-tabs` 承载 `overflow-x:auto`。
- **`role="tablist"` 迁移**：现状 `TabBar.vue:2` 根节点带 `role="tablist"`，但根节点还包含「+」按钮和新增的折叠按钮，
  ARIA 不合规。修正：`role="tablist" aria-label="标签页"` 移到 `.tab-bar-tabs`；根节点降为普通容器。
  折叠按钮与「+」按钮都在 tablist 之外，不参与 tab 序列。
- 按钮：`<button type="button" data-testid="sidebar-toggle" :aria-pressed="collapsed ? 'true' : 'false'"`
  `:aria-label="actionLabel"` `:title="actionLabel"`；`actionLabel = t(collapsed ? 'tabBar.expandSidebar' : 'tabBar.collapseSidebar')`。
- 图标：`apps/desktop/src/components/icons/SidebarToggleIcon.vue` 的内联 SVG，两个左右向 `chevron` 组成「<>」；
  `viewBox 0 0 16 16`、`width/height = 16`、`stroke="currentColor"`、`stroke-width=1.6`、
  `aria-hidden="true"`、`focusable="false"`；不使用 emoji、不引入图标依赖。
  几何取自 Lucide（ISC 许可），第三方声明由实现方登记在 `apps/desktop/THIRD-PARTY-NOTICES.md`。
- 焦点：`:focus-visible { outline: 2px solid var(--color-primary); outline-offset: 1px }`，暗色主题随 token 覆写。
- **折叠无动画**：侧栏显隐与内嵌视图重排都不写过渡；按钮自身的 hover 颜色过渡（0.15s）沿用既有壳层交互风格，
  并在 `prefers-reduced-motion: reduce` 下关闭。理由：原生 `WebContentsView` 不跟随 CSS 过渡，折叠动画期必然错位。

## 决策 6 —— 视觉与文案

- 颜色全部走既有 token：常态 `--color-text-secondary`；hover 背景 `--color-bg-card`、边框 `--color-border`、
  前景 `--color-primary`（与 `.tab-add:hover` 同源）；收起态前景 `--color-primary`；焦点 `--color-primary`；
  组件内禁止十六进制颜色字面量。
- 文案按「点击后会发生什么」写，而不是描述当前状态：
  - 展开态动作：zh「收起左侧菜单」/ en “Collapse sidebar”；
  - 收起态动作：zh「展开左侧菜单」/ en “Expand sidebar”。
- 文案写入 `apps/desktop/src/locales/tab-bar/{zh,en}.js`（`tabBar` 命名空间），zh/en 键成对；`.vue` 不新增中文字面量。
- 按钮 tooltip 与 `aria-label` 同文案，避免视觉提示与读屏提示不一致。

## 测试策略

| 层 | 重点 | 期望锁 |
|---|---|---|
| 单元（`stores/sidebar-collapse.test.js`） | 默认展开；`'1'` 恢复收起；非法值/异常/无 localStorage 均展开；同值幂等；非布尔入参忽略；非 Electron 与 IPC reject 不抛错 | 每个分支一条断言，异常路径不得用「不抛错」一句话带过 |
| 组件（`TabBar.sidebar-toggle.test.js` / `SidebarToggleButton.test.js` / `App.sidebar-collapse.test.js`） | 按钮在 `.tab-bar-tabs` 之前；`role="tablist"` 只在 `.tab-bar-tabs`；`aria-pressed`/`aria-label` 随状态切换；SVG `aria-hidden`；`App.vue` 的 `MpSidebar v-show` 生效 | 结构锁 + 行为锁各一条；zh/en 文案（`tabBar.collapseSidebar` / `tabBar.expandSidebar`）逐字断言（防只改一侧） |
| 主进程（`view-bounds.test.js`） | 第 4 参 `true` → `x=0`、宽=客户区全宽、`y=76` 不变；`false`/省略/非布尔 → 与现状逐字节一致 | 既有 3 参用例原样保留作为回归锁；新增用例不得替换旧断言 |
| 主进程（`webview-manager.test.js` + `auth-view-manager.test.js` + `qrcode-login.test.js`） | `setSidebarCollapsed` 更新标志并重排；同值不重排；非法类型忽略且不动 `_sidebarWidth`；两个子管理器同步且自身重排；既有 `setSidebarWidth` 的 0/-5/700 拒绝用例继续全绿 | 用 spy 断言 `_repositionAll` 调用次数；用 `_sidebarWidth` 断言不被污染 |
| IPC / preload（`preload/page-manager.sidebar-collapse.test.js`） | 命名空间方法存在、通道名 `page-manager:set-sidebar-collapsed` 逐字匹配、参数原样透传、不复用 `set-sidebar-width` | 通道字符串必须逐字断言，防拼写漂移 |
| 视觉门禁 | 43 张基线全部变化；不本机覆盖；CI 同源重建后逐张审核 | 记录里如实登记影响，禁止写「视觉中性」 |
| QM-1 | 主进程/preload 改动 ⇒ 本地打包 + 启动三层判据（存活、stderr 红线、剔除 `ELECTRON_RUN_AS_NODE`） | 由 Lead 执行并回填执行记录 |

## 风险与回退

1. **漏环风险（最高）**：preload / 通道 / handler / manager / 两个子管理器任一环缺失，会表现为「侧栏隐藏但浏览器标签左侧 200px 死区」。
   缓解：规格把链路写成一条 Requirement 的多个 Scenario；测试对每一环单独断言；实现后用真实 Electron 窗口手动验证浏览器标签与登录标签。
2. **窄屏断点时序**：收起期间跨越 900px 断点，`_sidebarWidth` 停留旧值，展开后需等侧栏重新有宽度再上报纠正（一次重排，不造成死区）。
3. **OAuth 内嵌视图**：`oauth-manager.js:86` 不传侧栏宽度，收起后 OAuth 页左侧保留 200px 空白；属既有实现限制，登记遗留，不在本轮修。
4. **视觉基线不可局部豁免**：全局可见按钮让 43 张基线全部变化；只能整体重建。
5. **回退安全**：`git revert` 后主进程默认 `false`；`localStorage` 残留的 `'1'` 在新代码里若仍被读取需等价于展开（非法值降级规则保证）；
   本功能无数据库/文件格式迁移，回退成本低。
