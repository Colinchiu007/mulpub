# BUGFIX：采集页平台链接浮层盖住侧边栏（2026-09-15）

- **日期**：2026-09-15
- **状态**：已实施（随本变更同一 PR 入库）
- **类型**：Bug 修复 + 防御性回归守卫（无新增用户功能）
- **分支**：`fix-platformlink-sidebar`（worktree `mp-fix-platformlink-sidebar`）
- **关联**：#1840（移除「分屏监控」并将评论/采集网页查看迁移到全局标签栏）；`BUGFIX-EMBEDDED-BROWSER-VIEWPORT-2026-09-13.md`（内嵌视图客户区定位唯一来源 `view-bounds.js`）
- **知识沉淀**：`everos/data/knowledge/embedded-view-zero-width-overlay/index.md`

---

## 1. 用户问题与背景

### 1.1 用户反馈

> 采集页中，底部有几个自媒体平台的链接。这个链接当时放在这的目的是什么？存在一个 bug，这几个链接点击后打开的网页，好像是通过浮层实现的。带来的结果是，左侧边栏的所有按钮都点击没反应。查一下这个问题并修复，同时调查整个应用中还有多少处是有这个类似的问题。

### 1.2 这些链接的「原本目的」（澄清）

采集页（`apps/desktop/src/views/Collection.vue`）底部的三张快捷卡片 **微博 / 知乎 / 今日头条**（`cohere-stat-card`，约第 210/214/218 行），是**进入各自媒体平台「采集/创作者后台」的快捷入口**：

- 点击 → `openCollection(platform)` → 解析 `PLATFORM_DASHBOARD_URLS[platform].url` → `tabStore.createTab({ url, platform, title })` 在**顶部全局标签栏**打开该平台页。
- 目的：让用户在「采集」工作流里，一键跳转到微博/知乎/头条后台去复制、采集素材，再回到应用内整理。**它从来不是「装饰」，而是采集流程的「外部素材来源跳转」快捷方式。**

### 1.3 为什么当时看起来像「浮层 + 侧边栏失灵」

- **旧实现（#1840 之前）**：`openCollection` 调用 `notifyInfo('collection.switchToMonitor')`，经旧「分屏监控（Monitor）」链路打开一个 **WebContentsView 浮层**，定位为 `x=0 / 全屏`。
- 该浮层位于 `x=0`，与位于 `x=0` 的 **MpSidebar（左侧导航栏）** 完全重叠 → 拦截了侧边栏区域的所有鼠标点击 → 表现为「左侧边栏所有按钮点击没反应」。这就是用户看到的现象。
- **#1840 之后（当前 main 代码）**：「分屏监控」已整体移除，采集/评论打开平台页迁移到 **page-manager 全局标签栏**（`tabStore.createTab`）。当前 `openCollection` 已经不再产生任何浮层，结构上**已经没有遮挡侧边栏的路径**——用户描述的 bug 在 #1840 已被根治。

> 结论：本任务**不是修一个还在发生的浮层 bug**，而是（a）澄清链接用途，（b）对「侧栏宽度异常导致内嵌视图 x=0 覆盖侧边栏」这一类隐患做**防御性收口**，并（c）全量排查同类风险面。

---

## 2. 根因与残留风险

### 2.1 真正的根因（通用形态）

内嵌 WebContentsView 的 `x` 坐标 = 侧栏宽度（`computeEmbeddedViewBounds` 的 `x: sidebar`）。当**侧栏宽度 = 0** 时，`x` 落到 `0`，与 `x=0` 的 MpSidebar 重叠 → 侧边栏点击被吞。旧「分屏监控」浮层是这一形态的历史实例（它直接以 `x=0` 全屏定位）。

### 2.2 当前残留的同类风险点

- `view-bounds.js` 的 `normalizeSidebarWidth(width)` 原实现：`MIN_SIDEBAR_WIDTH = 0`，判断 `width < 0` 才回落。即 **`width === 0` 被当成合法值**——一旦侧栏宽度被置 0，内嵌视图 `x=0` 复现「盖住侧边栏」同类 Bug。
- 三处 `setSidebarWidth` 守卫（`webview-manager` / `auth-view-manager` / `qrcode-login`）原阈值都写成内联 `width < 0 || width > 600`，**同样接受 0**。任一管理器在 `_sidebarWidth = 0` 时调用 `computeEmbeddedViewBounds(..., 0)` 都会产出 `x=0`。

> 注意：渲染侧 `MpSidebar.vue` 的 `ResizeObserver` 仅在 `w > 0` 时才 `invokePageManager('setSidebarWidth', ...)`，**正常永远不会下发 0**；所以 0 是「异常/越界上报值」而非正常业务值。但防御层必须兜底，因为历史已证明「x=0 覆盖侧边栏」是高频且高危害的回归点。

---

## 3. 全量排查结论（整个应用还有多少处类似问题）

| 排查对象 | 方式 | 结论 |
| --- | --- | --- |
| 内嵌视图管理器（4 个） | 读 `webview-manager` / `auth-view-manager` / `qrcode-login` / `oauth-manager` | 全部使用 `computeEmbeddedViewBounds(this.mainWindow, this._sidebarWidth)`，无独立坐标计算；`oauth-manager` 走独立窗口不内嵌。✅ 无遗留 `<iframe>`/`<webview>` 渲染层。 |
| 侧栏宽度校验 | 搜 `setSidebarWidth` / `normalizeSidebarWidth` | 三处 `setSidebarWidth` 守卫原本**均接受 0**（同类隐患 ×3）；`normalizeSidebarWidth` 原本**接受 0**。 |
| 渲染层浮层 | 搜 `createElement('webview')` / `<iframe` / `addChildView` | 仅主进程 `contentView.addChildView`（已统一管理）；渲染层无裸 `<webview>`/`<iframe>` 浮层。 |
| 其他浮层入口 | 搜 `switchToMonitor` / `monitor` IPC | #1840 后全仓 0 命中（已验证）。 |

**结论：当前唯一残留的同类风险 = 侧栏宽度 0/负值**，集中在上述三处守卫 + `normalizeSidebarWidth` 一处兜底。无第二处独立的「浮层盖侧边栏」实现。

---

## 4. 修复方案（双保险 + 单一真源）

### 4.1 修改清单

| 文件 | 改动 |
| --- | --- |
| `apps/desktop/electron/services/view-bounds.js` | `MIN_SIDEBAR_WIDTH` 由 `0` 收紧为 `1`；`normalizeSidebarWidth` 注释更新，明确「宽度必须严格 > 0，0 会让视图盖住侧边栏」 |
| `apps/desktop/electron/services/webview-manager.js` | `setSidebarWidth` 守卫改为 `width < MIN_SIDEBAR_WIDTH \|\| width > MAX_SIDEBAR_WIDTH`（阈值改为从 `view-bounds` 导入的常量，消除内联硬编码） |
| `apps/desktop/electron/services/auth-view-manager.js` | `setSidebarWidth` 守卫同步改为导入 `MIN_SIDEBAR_WIDTH` / `MAX_SIDEBAR_WIDTH` 并 `width < MIN_SIDEBAR_WIDTH`（**原接受 0 → 现在拒绝 0**） |
| `apps/desktop/electron/services/qrcode-login.js` | 同上（**原接受 0 → 现在拒绝 0**） |
| `apps/desktop/electron/services/view-bounds.test.js` | 新增回归：`normalizeSidebarWidth(0)` 回落默认；`computeEmbeddedViewBounds(win, 0)` 的 `x` 必须等于 `SIDEBAR_WIDTH_DEFAULT`(200) 而非 0 |
| `apps/desktop/electron/services/webview-manager.test.js` | 新增 `setSidebarWidth` 守卫 describe：0/负值/超上限被拒绝、合法窄屏 68 被接受 |

### 4.2 防御分层（为什么三处都要改）

```
渲染侧 MpSidebar.ResizeObserver
   │ (仅 w>0 才下发 setSidebarWidth，正常不会是 0)
   ▼
IPC page-manager:set-sidebar-width
   ▼
WebviewManager.setSidebarWidth  ── 守卫层①：width < MIN_SIDEBAR_WIDTH 拒绝（≤0 及亚1浮点）
   │ 同步给 auth-view-manager / qrcode-login
   ▼
各 manager._positionAll / _positionView
   ▼
computeEmbeddedViewBounds(win, sidebarWidth)  ── 兜底层②：normalizeSidebarWidth 把 ≤0 回落 200
   ▼
WebContentsView.setBounds({ x: 200, ... })   ← 永远 ≥ 200，绝不落到 0
```

- **守卫层①**（三处 `setSidebarWidth`）：第一道闸，异常 width 直接不更新 `_sidebarWidth`、不重排。
- **兜底层②**（`normalizeSidebarWidth`）：即使有调用方绕过 `setSidebarWidth` 直接传 0 给 `computeEmbeddedViewBounds`，x 仍被强制抬到默认 200。
- 两层都引用 `view-bounds.js` 的同一个 `MIN_SIDEBAR_WIDTH` / `MAX_SIDEBAR_WIDTH` → **单一真源，避免阈值漂移**。

---

## 5. 数据校验

| 校验点 | 规则 | 位置 |
| --- | --- | --- |
| 侧栏宽度下限 | `width` 必须 `>= MIN_SIDEBAR_WIDTH`(=1)；`0` / 负值 / 亚 1 浮点 一律非法 | `view-bounds.normalizeSidebarWidth` + 三处 `setSidebarWidth` 守卫 |
| 侧栏宽度上限 | `width <= MAX_SIDEBAR_WIDTH`(=600) | 同上 |
| 类型校验 | `typeof width === 'number'` 且 `Number.isFinite` | `normalizeSidebarWidth` |
| 非法值处理（守卫层） | 日志 `log.warn('WebviewManager'/'AuthViewManager'/'QrCodeLogin', 'Invalid sidebar width ignored: ' + width)`，忽略更新、跳过重排 | 三处 `setSidebarWidth` |
| 非法值处理（兜底层） | 回落 `SIDEBAR_WIDTH_DEFAULT`(=200)，保证 `x >= 200` | `normalizeSidebarWidth` |
| 重复值跳过 | 宽度未变化时跳过更新和重排（`if (this._sidebarWidth !== width)`） | `webview-manager.setSidebarWidth` |

---

## 6. 流程（调用链）

1. 用户拖拽窗口边缘 → 侧栏 `ResizeObserver` 触发 → `w > 0` 时 `invokePageManager('setSidebarWidth', Math.round(w))`。
2. IPC `page-manager:set-sidebar-width` → `WebviewManager.setSidebarWidth(width)`。
3. 守卫层校验：
   - `width` 非法（≤0 / >600 / 非数字）→ `log.warn` + 直接 return（**不更新 `_sidebarWidth`、不重排**）→ 视图维持上一合法位置，侧边栏始终可点。
   - `width` 合法 → 更新 `_sidebarWidth` → 同步 `auth-view-manager.setSidebarWidth` / `qrcode-login.setSidebarWidth`（同样守卫）→ `_repositionAll()`。
4. `_repositionAll()` → `computeEmbeddedViewBounds(win, sidebarWidth)` → `normalizeSidebarWidth` 兜底（即使 `sidebarWidth` 异常也回落 200）→ `WebContentsView.setBounds({ x: ≥200, ... })`。
5. 结果：内嵌视图永远在侧栏右侧，侧边栏点击区不被覆盖。

---

## 7. 功能逻辑 / 交互逻辑

- **功能逻辑**：侧栏宽度是内嵌视图 x 偏移的唯一来源；本修复不改变任何正常布局行为（200 默认 / 68 窄屏），只把「0/负值」这一非法区间从「静默接受」改为「拒绝并回落」。
- **交互逻辑（对用户可见的影响）**：
  - 正常使用时无任何感知变化（侧栏宽度恒为 200 或 68）。
  - 极端异常（width 误报 0）：旧行为 = 网页盖住侧边栏、全部按钮失灵；新行为 = 该次上报被忽略，视图维持上一合法位置，侧边栏照常可点。
- **采集页平台卡片交互不变**：点击微博/知乎/头条 → 顶部标签栏新增对应平台页标签（#1840 迁移后的行为），toast「已打开 {platform} 采集页面」。

---

## 8. 显示项与提示文字（i18n）

本修复**未新增任何硬编码中文或 i18n 键**（纯防御性逻辑，无用户可见文案）。相关既有键（来自 #1840，沿用无需改动）：

| 键 | zh | 关联 |
| --- | --- | --- |
| `collection.platformUnsupported` | 该平台暂不支持网页查看 | 平台 URL 缺失时告警（与本次无关但同页） |
| `collection.openedPlatform` | 已打开 {platform} 采集页面 | 平台卡片点击成功 toast |
| `collection.platformTabTitle` | （含 {platform} 参数） | 平台标签标题 |

守卫层拒绝 width 时仅 `log.warn`（非用户可见），不触发任何文案。

---

## 9. 验证

- **单元回归**（本 PR 新增）：
  - `view-bounds.test.js`：`normalizeSidebarWidth(0) === 200`；`computeEmbeddedViewBounds(win, 0).x === 200`（断言 `{x:200,y:76,width:1224,height:785}`，**关键：x 不是 0**）。
  - `webview-manager.test.js`：`setSidebarWidth(68)` 接受、`setSidebarWidth(0/-5/700)` 均被拒绝且 `_sidebarWidth` 保持上一合法值，视图不以 `x=0` 重排。
- **回归全绿**：`view-bounds`(16) + `webview-manager`(37) + `auth-view-manager` + `qrcode-login`(15) 共 94 例通过。
- **lint**：eslint 0 errors（新增注释为中文，无新增硬编码 UI 字符串，不触发 CJK 门禁）。
- **CI**：push 后由 quality-gate / 契约测试把关；electron-tests 覆盖 `setSidebarWidth` 守卫与 `computeEmbeddedViewBounds` 契约。

---

## 10. 风险与回滚

- **风险**：极低。仅收紧非法区间定义（0 从「合法」变「非法」），不改变任何正常宽度（200/68）的布局；且渲染侧永远不会下发 0。
- **回滚**：单 PR revert 即可恢复。
- **潜在误伤排查点**：若未来产品引入「侧栏折叠到 0 宽」特性，本守卫会拒绝 0 —— 届时应使用独立布尔 `collapsed` 而非 `width=0` 表达折叠状态（已在根因分析中记录，避免回头再踩）。

---

## 11. 经验沉淀

1. **「x=0 覆盖侧边栏」是内嵌视图的高频回归点**：根因不在某个具体浮层，而在「侧栏宽度参与内嵌视图 x 坐标」这一布局契约。`view-bounds.js` 已是唯一来源，但**校验边界（0 是否合法）同样必须唯一且严格**。
2. **守卫与兜底要双层、且引用同一常量**：只在 `setSidebarWidth` 拦、或只在 `normalizeSidebarWidth` 拦都不够；两层 + 单一真源（`MIN_SIDEBAR_WIDTH` / `MAX_SIDEBAR_WIDTH`）才能杜绝漂移与漏网。
3. **全量排查比单点修复更有价值**：用户问「还有多少处类似问题」，答案不是「只有这一处」，而是「侧栏宽度 0 这个非法值被三处守卫和一处兜底同时接受」——修复面应是这四个点，而非只改触发现象的那一行。
4. **历史浮层已迁移，但遗留假设要清理**：#1840 把 Monitor 浮层删了，但 `normalizeSidebarWidth` 仍把 0 当合法，等于给「新版本的同类 bug」留了口子。移除功能时，必须同步复查其依赖的「假设边界」。

---

## 12. 关联文档

- `01-docs/PRD-REMOVE-MONITOR-FEATURE-2026-09-15.md`（#1840，平台链接迁移到全局标签栏）
- `01-docs/BUGFIX-EMBEDDED-BROWSER-VIEWPORT-2026-09-13.md`（`view-bounds.js` 客户区定位唯一来源，本修复在其之上收紧宽度边界）
- `docs/desktop-ui-layout-spec.md` §6.1（侧栏宽度校验，已同步更新为 `1 ≤ width ≤ 600`）
- `01-docs/PRD-ACCOUNT-LOGIN-WINDOW.md`（侧栏宽度同步链路，已同步更新区间）
- `everos/data/knowledge/embedded-view-zero-width-overlay/index.md`（运行时知识库，同类 Bug 防御范式）
