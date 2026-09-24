# PRD：共享侧边栏驱动当前聚焦标签（home-shell 标签导航可见性修复）

- 日期：2026-09-24
- 状态：已批准（方案 B「共享侧边栏驱动当前标签」，用户确认）
- 关联分支：`tab-sidebar-focus-nav`（worktree `D:/Data/projects/mp-worktrees/mp-sidebar-focus-nav`）
- 上游：`01-docs/PRD-TAB-INDEPENDENT-HOME-2026-09-22.md`（PR #2230，新标签内嵌独立 SPA）
- 优先级：P1（核心交互缺陷修复）

---

## 1. 背景与问题

### 1.1 现象

在「+」新建的 home-shell 标签处于聚焦状态时，点击**左侧共享侧边栏**（首页/账号/发布/采集等菜单项），当前可见标签**毫无反应**；实际路由跳转发生在被 `WebContentsView` 整个覆盖、不可见的第一个「首页」虚拟标签上。用户误以为「点了没反应」，交互体验严重受损。

### 1.2 根因（架构层面）

应用窗口为「1 个 Vue SPA 主窗口（home 虚拟标签）+ N 个 WebContentsView 浏览器标签」混合体系，共享 chrome 模型：

- 外层窗口保留 TOP=76px（TabBar 36 + NavBar 40）与 LEFT=sidebarWidth（默认 200px，`MpSidebar`）；`WebContentsView` 仅占据其右侧、下方的内容矩形（x=sidebarWidth, y=76）。
- 内嵌主页实例（home-shell 标签，`App.vue` 的 `isHomeShell` 分支）按 PRD-TAB-INDEPENDENT-HOME 的设计**只渲染 `MpModuleNav` + `router-view`，不渲染 `MpSidebar`**（避免双份 chrome）。
- 因此用户能看见并点击的左侧边栏，唯一来源是**外层主窗口 SPA** 的 `MpSidebar`（`v-else` 分支）。它的 `<router-link>` 驱动的是主窗口 vue-router，即 **home 虚拟标签** 的内容。
- 当聚焦标签是 home-shell（或其他浏览器标签）时，home 标签的 `router-view` rectangle 正被 `WebContentsView` 覆盖 → 侧边栏点击引发的路由变化在隐藏标签上发生，聚焦标签不受影响、用户不可见。

一句话：**共享侧边栏永远只驱动 home 虚拟标签，而它驱动的结果被聚焦的浏览器标签遮住了。**

### 1.3 目标

让「点击共享侧边栏菜单项」这一动作，在**任意聚焦标签**下都产生**当前可见标签**的响应，并使侧边栏选中态跟随**当前聚焦标签的真实页面**。

## 2. 方案选型

| 方案 | 描述 | 取舍 |
|------|------|------|
| A 每标签独立侧边栏 | 内嵌实例自带 `MpSidebar`，chrome 不再共享 | 违背 PRD-TAB-INDEPENDENT-HOME 的单份 chrome 设计，视觉割裂、成本高 |
| **B 共享侧边栏驱动当前聚焦标签（选定）** | 侧边栏点击路由到「当前聚焦标签」：home-shell 标签→定向让该实例自身导航；普通网页标签→切回 home 再导航；侧边栏高亮跟随聚焦标签真实路由 | 复用既有 chrome 与 IPC 基建，改动内聚，交互直觉一致 |
| C 点击侧边栏自动切回 home 标签 | 强制把焦点拉回 home 标签再导航 | 丢失用户当前标签上下文，体验倒退 |

选 **B**：既保留共享 chrome，又让「点菜单 = 当前标签跳转」符合用户预期。

## 3. 功能契约（P0）

### F1 侧边栏点击路由到当前聚焦标签

- 聚焦 **home-shell 标签**：经 IPC 定向（主进程 → 该标签 `webContents`）让该内嵌实例**自身** `router.push(path)`；主窗口隐藏路由保持不动。
- 聚焦 **普通网页标签**：先 `switchToTab('home')` 切回首页标签，再由主窗口路由导航，使变化可见。
- 聚焦 **home 虚拟标签**：维持原有主窗口路由跳转（行为不变）。

### F2 侧边栏高亮跟随聚焦标签真实页面

- home-shell 聚焦时：高亮依据为该实例回传的 SPA 路由 `activeTab.spaRoute`（而非主窗口 `route.path`）。
- 其他情况：沿用主窗口 `route.path`。

### F3 壳态自然结束不受影响

- home-shell 内部导航走 hash 路由（`#/path`），触发 `did-navigate-in-page`（search 仍含 `mp-home-shell=1`），**不触发** PRD-TAB-INDEPENDENT-HOME F5 的「壳态自然结束」；仅当文档级导航到不带壳态参数的地址（用户在地址栏输入去外站）才解除壳态。

## 4. 数据流与 IPC 契约

```
[内嵌 home-shell 实例]
  did-navigate-in-page(hash)  ──► 主进程 state.spaRoute = _parseHashRoute(url)
                                   _broadcastNav → navigation-changed(含 homeShell, spaRoute)
                                        │
[外层主窗口]  ◄── onNavigationChanged ──┘  tab.spaRoute / tab.homeShell 实时更新
  MpSidebar.onNavClick(to):
    activeTabIsHomeShell ──► IPC page-manager:navigate-active-home-shell(path)
                                   主进程 navigateActiveHomeShell → 定向 send
                                   page-manager:home-shell-navigate{path}
                                        │
    [内嵌实例] App.vue 订阅 on('home-shell-navigate') ──► 本实例 router.push(path)
    （handled:false / 异常）──► 回退：切回 home 标签 + 主窗口 router.push(to)
```

- 新增主进程方法 `WebviewManager.navigateActiveHomeShell(path)`：仅当活动标签为 home-shell 且视图存活时投递，返回 `{ handled }`。
- 新增 IPC：`page-manager:navigate-active-home-shell`（渲染→主进程，`withSenderCheck` 受信校验）；`page-manager:home-shell-navigate`（主进程→特定标签 webContents 定向投递）。
- 状态扩展：tab state 增加 `spaRoute`；`getAllTabs`/`getActiveTab`/`navigation-changed` 均暴露 `homeShell` + `spaRoute`。
- preload：`pageManager.navigateActiveHomeShell(path)`；内嵌实例经 `home-shell-preload`（双判据通过后 `require('./preload/index.js')`）获得同一 `pageManager.on`/`navigateActiveHomeShell`。

## 5. 安全约束

- 导航指令定向投递到**该标签自身** `webContents`，不广播、不跨标签；仅对 `homeShell===true` 的活动标签生效，普通网页标签返回 `handled:false`。
- `path` 必须以 `/` 开头的字符串才受理（防注入非路由目标）。
- 沿用 `withSenderCheck` 来源校验；不新增 electronAPI 暴露面（复用既有 `pageManager` 聚合）。

## 6. 验收标准

1. 新建 home-shell 标签聚焦 → 点侧边栏任一菜单项 → **当前标签**内容跳转到对应模块（不再无反应）。
2. 上述跳转后侧边栏对应项高亮；在 home-shell 标签内部再导航，侧边栏高亮同步跟随。
3. 聚焦普通网页标签 → 点侧边栏 → 自动切回首页标签并导航，变化可见。
4. home 虚拟标签行为与改动前一致（回归保护）。
5. IPC 不可用/异常 → fail-open 回退到「切回首页 + 主窗口导航」，不静默失败。
6. 单测覆盖：`navigateActiveHomeShell` 受理/拒绝、`spaRoute` 更新与广播、壳态自然结束清空 `spaRoute`、tab store `activeTabIsHomeShell` getter、MpSidebar 三种聚焦态点击路由 + 高亮跟随。

## 7. 非目标

- 不改变共享 chrome 尺寸契约（TOP=76、LEFT=sidebarWidth）。
- 不为普通网页标签提供应用内模块导航（它们浏览外部站点，语义上应回首页承载）。
- 不引入每标签独立侧边栏（方案 A 明确否决）。
