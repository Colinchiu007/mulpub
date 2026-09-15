# PRD：移除「分屏监控」功能（Remove Monitor Feature）

- **日期**：2026-09-15
- **状态**：已实施（本 PRD 随变更同一 PR 入库）
- **类型**：功能移除 + 能力迁移（无新增用户功能）
- **分支**：`codex/remove-monitor-feature`
- **决策记录**：用户确认采用「彻底移除并迁移」方案（见 §3 方案对比）

---

## 1. 背景

「监控」（路由 `/monitor`，侧边栏「更多」菜单第一项，页面标题「分屏监控」）是一个多平台分屏在线监控页面：在 Electron 内嵌浏览器视图（WebContentsView）中打开各平台官网，并以 1/2/3/4/6 屏布局同屏排布，用于"多平台同时在线监控，实时查看发布状态"。

产品判断：该功能**没有实际使用价值**——分屏同看多个平台页面的场景不存在真实工作流依赖，且旧实现（`webview:*` IPC 通道 + `openTab()`/`this.tabs`/`this.layout` 分屏布局）是独立于现行「浏览器式标签页系统」（page-manager）之外的一整套并行体系，长期构成僵尸代码与维护负担。

**关键依赖发现**（本次移除必须先解决的前置事实）：

| 消费方 | 使用的旧分屏能力 | 移除后的处理 |
| --- | --- | --- |
| `views/Monitor.vue`（分屏监控页） | `webviewOpenTab` / `webviewSetLayout` / `webviewCloseAll` / `webviewListTabs` + 4 个 `onWebview*` 事件 | 随功能整体删除 |
| `views/Comments.vue`（私信评论） | `webviewOpenTab`（打开平台评论页）+ `webviewCloseTab` | **迁移**到全局标签栏（`pageManager.createNewTabPage` / `closeTab`） |
| `views/Collection.vue`（采集） | `webviewOpenTab`（打开平台页） | **迁移**到全局标签栏（`pageManager.createNewTabPage`） |
| `electron/services/webview-manager.js` 内新标签页系统 | `monitor-preload.js`（WebContentsView 内部 preload） | **保留**（`createNewTabPage` 仍使用，非僵尸代码） |

> 注：「关键词监控」（`/keywords`，`KeywordMonitorView`）是与「分屏监控」**无关**的独立功能（关键词舆情监测），本次不受影响、不得混淆。

## 2. 目标与非目标

### 2.1 目标

1. 用户侧：侧边栏「更多」菜单不再出现「监控」入口；直接访问 `#/monitor` 不再渲染任何页面（无该路由）。
2. 代码侧：旧分屏监控体系（视图、路由、`webview:*` IPC 通道与事件、分屏布局算法、preload 暴露方法）全部删除，零残留、零僵尸分支。
3. 能力侧：「私信评论」「采集」两处"在应用内打开平台网页"的能力**保留**，统一改由浏览器式全局标签栏（page-manager）承载。
4. 质量侧：preload 方法计数断言、E2E 路由矩阵、集成 Flow、i18n 键全部同步更新；lint/单测全绿。

### 2.2 非目标

1. 不改动「关键词监控」功能。
2. 不改动 page-manager 新标签页系统的任何行为（纯消费方）。
3. 不调整侧边栏其余菜单项的顺序与样式。
4. 不做数据迁移（旧分屏系统无任何持久化数据；`persist:monitor-*` session 分区为运行时缓存，随 Electron userData 目录自然淘汰，无需清理任务）。

## 3. 方案对比与决策

| 方案 | 内容 | 结论 |
| --- | --- | --- |
| A. 彻底移除并迁移（**采用**） | 删除 Monitor + 旧分屏系统；Comments/Collection 网页查看迁移到全局标签栏 | 能力保留、无僵尸代码；行为变化为"页面内嵌视图 → 全局标签页"，可接受 |
| B. 仅删监控页面入口 | 只删路由/菜单/视图，保留旧分屏系统 | 否决：旧系统失去 UI 承载，view 定位依赖已删的分屏逻辑，Comments/Collection 显示错乱、生命周期失控 |
| C. 连 Comments/Collection 网页入口一起删 | 移除监控 + 旧系统 + 两处网页查看能力 | 否决：这两个功能的网页查看有真实用途 |

## 4. 变更明细

### 4.1 删除项（运行时）

| 层 | 文件 | 删除内容 |
| --- | --- | --- |
| 视图 | `apps/desktop/src/views/Monitor.vue` | 整文件删除（分屏监控页：布局切换 1/2/3/4/6、添加监控弹窗、全部关闭、底部状态栏） |
| 视图测试 | `apps/desktop/src/views/Monitor.test.js` | 整文件删除 |
| 覆盖测试 | `apps/desktop/src/views/views-coverage.test.js` | 删除 `MonitorView (coverage)` describe 块 |
| 路由 | `apps/desktop/src/router/index.js` | 删除 `{ path: '/monitor', name: 'Monitor' }` |
| 导航 | `apps/desktop/src/layouts/MpSidebar.vue`（#1837 应用命名空间统一时的改名产物，本 PR 对旧侧边栏文件的修改经 rename-detection 迁移至此） | 删除 moreItems 中 `monitor` 项与 `Monitor` 图标 import |
| 主进程 | `apps/desktop/electron/services/webview-manager.js` | 删除 `openTab()`、`setLayout()`、`closeMonitorTab()`、`closeAllMonitorTabs()`、`getTabsInfo()`、`_calculatePositions()`、`_emit()`、constructor 的 `tabs/layout/_nextTabId` 状态、`closeTab()` 旧分屏分支、`_repositionAll()` 旧分屏分支、5 个 `webview:*` IPC handler、头部品牌残留注释 |
| preload | `apps/desktop/electron/preload/system.js` | 删除 10 个方法：`webviewSetLayout` / `webviewOpenTab` / `webviewCloseTab` / `webviewCloseAll` / `webviewListTabs` / `onWebviewLayoutChanged` / `onWebviewTabOpened` / `onWebviewTabClosed` / `onWebviewNav` / `onWebviewAllClosed` |
| 鉴权白名单 | `apps/desktop/electron/preload/access-control.js` | `PUBLIC_METHODS` 同步移除上述 10 个方法 |
| 产物 | `apps/desktop/electron/preload/index.bundle.js` | `pnpm run build:preload` 重建 |
| i18n | `src/locales/zh.js` / `en.js` | 删除 `nav.monitor`、`monitor.*`（4 键）、`collection.switchToMonitor` |
| E2E | `tests/e2e/helpers/*` | 路由矩阵/路由顺序/报告清单移除 `monitor`；`exerciseMonitor` 删除；Flow 4 重写；`ipc-mock.js` 移除 webview mock 并新增 `pageManager` mock |

### 4.2 迁移项（Comments / Collection → 全局标签栏）

统一模式（与 `Accounts.vue` 既有的 `openCreatorCenter` / `openLoginPage` 范本一致）：

```js
// 经 stores/tab.js 的 useTabStore()，底层调用 pageManager.createNewTabPage
const tabId = await tabStore.createTab({ url, platform, title })
```

**Comments.vue（评论管理）**

| 项 | 迁移前 | 迁移后 |
| --- | --- | --- |
| 打开评论页 | `webviewOpenTab({ platform, url })`（旧分屏 view 浮层） | `tabStore.createTab({ url: comment_url, platform, title: '<平台名>评论' })` |
| 切换平台 | 先 `webviewCloseTab(currentTabId)` 再开新 tab | 先 `tabStore.closeTab(currentTabId)` 再 `createTab`（保持"一次一个评论标签"） |
| 页面内嵌容器 | `<div id="comment-view-container">`（占位，实际 view 由主进程分屏坐标定位） | 删除；网页由顶部 TabBar 的浏览器标签承载 |
| 离开页面行为 | `onBeforeUnmount` 自动关闭当前评论标签 | 移除自动关闭——评论标签持久保留在标签栏，用户可随时切回（与浏览器标签语义一致），需手动关闭 |
| 无 pageManager 降级 | 无 API 时直接 return（页面无响应） | `createTab` 内部安全降级返回 `null`，页面仍完成选中态，`currentTabId` 保持 `null`，不报错 |
| 选中后右侧区域 | 空占位容器 | 空态提示：图标 🧭 + 标题 `<平台名>` + 文案「评论页已在顶部标签栏打开，点击上方标签即可查看」 |

**Collection.vue（采集）**

| 项 | 迁移前 | 迁移后 |
| --- | --- | --- |
| 打开平台页 | `webviewOpenTab({ platform })`（主进程按 `PLATFORM_DASHBOARD_URLS` 解析 URL） | renderer 侧解析：`PLATFORM_DASHBOARD_URLS[platform]` → `tabStore.createTab({ url, platform, title: '<平台名> 采集页' })`（`PLATFORM_NAMES` 取中文名） |
| 平台无 URL | 无校验（静默失败） | 新增校验：URL 缺失时 `notifyWarning('collection.platformUnsupported')` 并中止 |
| 降级提示 | API 缺失时 `notifyInfo('collection.switchToMonitor')`（"请先切换到分屏监控页查看"） | 删除（监控页已不存在）；改为 URL 校验告警 |

### 4.3 数据校验

| 校验点 | 规则 | 失败处理 |
| --- | --- | --- |
| 评论页 URL | `p.comment_url` 为真值才允许打开（列表构建时已 `filter`） | 显示"暂不支持"空态，不调用 IPC |
| 采集平台 URL | `PLATFORM_DASHBOARD_URLS[platform]` 必须存在 | `notifyWarning('collection.platformUnsupported')`，不调用 IPC |
| 主进程侧（保留） | `createNewTabPage` 原有 URL 协议白名单（http/https）与 Cookie 恢复时序不变 | 原有日志与失败语义不变 |

### 4.4 交互逻辑（变更后）

1. 侧边栏「更多」菜单：不再有「监控」项；`#/monitor` 路由不存在，`isActive` 前缀匹配不会误亮任何项。
2. 评论管理：点平台 → 顶部标签栏新增/聚焦该平台评论标签 → 页面内显示引导空态；切换平台时旧评论标签自动关闭（保持单评论标签）。
3. 采集：点微博/知乎/头条快捷卡 → 顶部标签栏新增 `<平台名> 采集页` 标签 → toast「已打开 {platform} 采集页面」。
4. 窗口 resize / 侧边栏宽度变化：`_repositionAll()` 仅布局当前活动浏览器标签（客户区坐标系，R94 口径不变）。

### 4.5 显示项与提示文字（i18n）

| 键 | zh | en | 状态 |
| --- | --- | --- | --- |
| `nav.monitor` | 监控 | Monitor | 删除 |
| `monitor.selectPlatform` | 请选择平台 | Please select a platform | 删除 |
| `monitor.addedMonitor` | 已添加 {platform} 监控 | Added {platform} monitor | 删除 |
| `monitor.addFailed` | 添加失败 | Failed to add | 删除 |
| `monitor.closedAll` | 已关闭所有监控 | Closed all monitors | 删除 |
| `collection.switchToMonitor` | 请先切换到分屏监控页查看 | Please switch to the split-screen monitor view | 删除 |
| `collection.platformUnsupported` | 该平台暂不支持网页查看 | Web view is not available for this platform | 新增 |
| `collection.openedPlatform` | 已打开 {platform} 采集页面 | Opened {platform} collection page | 保留 |

zh/en 成对修改，通过 CI Gate 7 locale 同步校验。

### 4.6 preload 方法计数（契约测试同步）

| 断言 | 变更前 | 变更后 |
| --- | --- | --- |
| system 模块方法数 | 153 | 143（-10） |
| 合并 api 总键数 | 321 | 311（-10） |
| `SYSTEM_METHODS.length` | 141 | 131（-10） |

## 5. 验收标准

1. [x] 全仓（排除构建产物重建前的旧 bundle）`webviewOpenTab|webviewSetLayout|webviewCloseAll|webviewListTabs|onWebview*|webview:*|'/monitor'|switchToMonitor` 搜索 0 命中。
2. [x] `pnpm run build:preload` 重建成功，`index.bundle.js` 与源码一致。
3. [x] `Comments.test.js` / `Collection.test.js` 迁移后用例全绿（pageManager 契约 + 无 URL 告警 + 降级路径）。
4. [x] `preload.test.js` 计数断言按 §4.6 更新并通过。
5. [x] eslint error 0；i18n zh/en 成对。
6. [ ] CI quality-gate 全绿（push 后确认）。
7. [ ] 打包验证（QM-1）：修改了 `electron/` 代码，`electron-builder --win --dir` 通过、启动无 `webview:*` 相关报错（CI electron-tests 覆盖）。

## 6. 风险与回滚

- **风险**：Comments/Collection 打开平台网页的 UX 从"页面内嵌视图"变为"顶部标签页"，属可感知行为变化（已在此 PRD §4.2 明示）。
- **回滚**：单 PR revert 即可整体恢复（无数据/配置兼容性负担）。

## 7. 经验沉淀

1. **删除共享底层前必须穷举消费方**：`webviewOpenTab` 表面是"监控的 API"，实际被 Comments/Collection 借用；直接删除会让打开的 WebContentsView 成为"无主视图"（有 view、无 UI 承载）。任何"整个移除"都要先做全仓引用矩阵（本 PRD §1）。
2. **新旧行为对齐看既有范本**：迁移直接复用 `Accounts.vue` 的 `tabStore.createTab({ url, platform, accountId, title })` 模式，不发明新调用形态。
3. **"打开网页"这类能力应收敛到唯一承载层**：page-manager 标签系统是本应用内嵌网页的唯一 UI 承载；任何新的"打开某平台页面"需求都应走 `tabStore.createTab`，禁止再引入并行视图体系。
4. **迁移后务必复查被移除功能的「假设边界」**：#1840 把 Monitor 浮层删了，`collection.switchToMonitor` 也随之移除，但 `view-bounds.normalizeSidebarWidth` 仍把侧栏宽度 `0` 当合法（`MIN_SIDEBAR_WIDTH=0`），等于给「x=0 覆盖侧边栏」这类回归留了口子。后续在 `fix-platformlink-sidebar` 分支（见 `01-docs/BUGFIX-PLATFORMLINK-SIDEBAR-OVERLAY-2026-09-15.md`）已把下限收紧为 1，并对 `webview-manager` / `auth-view-manager` / `qrcode-login` 三处 `setSidebarWidth` 守卫做双保险。教训：**移除功能时，连同它依赖的「非法值边界假设」一起清理**。
