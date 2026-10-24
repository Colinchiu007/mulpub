# PRD：应用内导航的可见性保障（App Route Navigation Visibility）

- 日期：2026-10-23
- 类型：Bug 修复 + 交互契约固化 + 全仓通查
- 分支：`member-center-overlay-visibility`（隔离 worktree `/workspace/mulpub-wt/member-center-overlay`）
- 关联现象：应用存在多个标签、且当前标签**不是应用页面**（如自媒体账号创作者中心页）时，点击左下角用户头像 → 菜单中的「会员中心」，界面没有任何反应
- 上游合同：`01-docs/PRD-OVERLAY-VIEW-SUSPENSION-2026-09-23.md`（应用级浮层 ↔ 内嵌 WebContentsView 互斥）
- 关联在飞改动：**PR #4209**「快捷键与鼠标共用一段可见导航」（`useVisibleNavigation`）—— 本 PRD 与它**共用同一份可见导航范式**，不重复实现（见 §2.1）

---

## 1. 背景与根因

### 1.1 现象复述

用户在工作台中打开了多个标签，其中一个是自媒体账号的**创作者中心页**（外部网页，由主进程 `WebContentsView` 承载）。当该外部网页标签处于活动状态时：

1. 点击左下角用户头像 → 弹出账号菜单（**正常可见**，因为它在侧边栏内，未越出原生图层覆盖区）；
2. 点击菜单里的「会员中心」→ **界面没有任何反应**。

同类复现路径：

| 入口 | 表现 | 归属 |
|---|---|---|
| 头像菜单 →「会员中心」 | 路由变了，页面被原生图层盖住 | **本 PRD 修复** |
| 头像菜单 →「升级 Pro」 | 同上 | **本 PRD 修复** |
| 全局快捷键 `CmdOrCtrl+Alt+D`（数据看板）等 9 个 | 同上 | **PR #4209 修复**（已全绿在飞，本 PRD 不重复实现） |

### 1.2 第一性根因

主窗口是「渲染进程 DOM + 主进程原生视图」两层结构：

- **渲染进程 DOM**（侧边栏 / 标签栏 / 导航栏 / 路由页面 / toast / 模态框）是**最底层**；
- **外部网页**（创作者中心、登录页、扫码页、OAuth 授权页）由主进程的 `WebContentsView` 承载，是
  **永远压在 DOM 之上、且 CSS `z-index` 对其无效**的原生合成图层。

原生图层的覆盖矩形（客户区坐标，唯一真源 `apps/desktop/electron/services/view-bounds.js` 的
`computeEmbeddedViewBounds`）：

```
x ≥ 侧边栏宽度（默认 200px；全局折叠态为 0，即横跨整窗宽；窄窗 CSS 轨道那一档是 68px）
y ≥ 76（= TabBar 36px + NavBar 40px）
一直到窗口底部
```

于是有一条硬约束：

> **主窗口 router 渲染的页面，只有在「首页虚拟标签」处于活动状态时才可见。**

这条约束由**壳态互斥**（T0-6b）保障：`App.vue` 的 `watch(isHomeTab)` →
`invokePageManager('setShellMode', 'workbench' | 'browser')` → 主进程在 workbench 模式隐藏全部内嵌视图。

而缺陷的入口是**裸 `router.push`**：

```js
// ProfileMenu.vue（会员中心，修复前）
close()
router.push('/member-center')      // ← 路由变了，活动标签没变
```

路由确实变了 ⇒ `isHomeTab` 仍是 `false` ⇒ 主进程仍是 browser 壳态 ⇒ 外部网页的原生图层继续盖住内容区
⇒ 会员中心页面渲染在它背后 ⇒ **用户表现为「点了没反应」**。

> **注意对象的区分（本次排查的第一个认知纠正）**：
> 用户报障时描述为「弹出的浮层被挡在当前标签页面后面」。**机制描述是对的（确实被原生图层挡了），
> 但被挡的对象不是浮层，而是一个路由页面。**
> 「会员中心」在本应用里是**路由页**（`/member-center`，`src/router/index.js`），不是浮层。
> 因此它**不能**用浮层互斥（`suspendEmbeddedViewsForOverlay`）解决 —— 浮层互斥是让**模态浮层**
> 在原生图层活动时临时让位；路由页的正解是**让活动标签回到首页虚拟标签**（壳态切到 workbench，
> 原生图层被隐藏，页面才有渲染面）。
> 两者是同族（都是「原生图层压住 DOM」）但**机制不同**，必须分开治理。

### 1.3 逃逸链分析

| 测试层级 | 为什么没拦住 |
|---|---|
| 单元测试 | 组件测试不带真实原生图层；`router.push` 被 mock 后**照样返回成功**，断言只查「有没有调 push」，查不出「push 之后用户看不看得见」 |
| 集成测试 | 无「外部网页标签活动 + 路由跳转」的组合场景 |
| E2E | WebContentsView 内容不在渲染层 DOM 树内，选择器看不到遮挡 |
| 视觉回归 | 截图基线均为首页/工作台壳态，无「外部网页活动 + 路由跳转」场景 |
| 已有合同 | `PRD-OVERLAY-VIEW-SUSPENSION` 治理的是**浮层**，路由页不在其 §4.1 owner 登记范围内 ⇒ 天然漏掉；两份合同之间**无交叉引用** |

**根本逃逸点**：既有合同只规定了「**模态浮层**怎么在原生图层活动时保证可见」，
却**没有规定「应用内页面怎么保证可见」** —— 而后者是靠**活动标签**（壳态）保证的。
两份互补的合同各治一半、彼此不点名 ⇒ 「路由跳转」这一类入口全部逃逸。

### 1.4 本次全仓通查的范围与结论摘要

三路并行只读审计（全局壳层入口 / 浮层登记表完整性 / 主进程原生视图族）覆盖：

- `apps/desktop/src` 下 **550 个非测试 `.vue`/`.js` 文件**
- 主进程**全部 5 个会创建原生视图的 `WebContentsView` 家族**与 **10 处 `BrowserWindow` 创建点**
- 渲染层**71 条逐项判定记录**，展开覆盖 **92 个浮层实例**

结论见 §5。**本次修复 3 处、报告后续项 6 处**，理由逐条写明。

---

## 2. 功能逻辑（修复方案）

### 2.1 可见导航范式（唯一实现，不新增第二份）

本应用**已经**有一份正确的可见导航实现：`apps/desktop/src/layouts/MpSidebar.vue` 的 `onNavClick(to)`
（侧边栏一级导航 / 「更多」菜单 / 「+ 新建发布」全走它）。它的三步契约是：

| 步 | 条件 | 动作 | 目的 |
|---|---|---|---|
| ① | 活动标签是**内嵌主页实例**（home-shell，`tabStore.activeTabIsHomeShell === true`） | 经 IPC `page-manager:navigate-active-home-shell` 定向把路由投递给**该实例自身的 router** | 该实例本身就是一张 `WebContentsView`，页面在它内部渲染 ⇒ 天然可见，无需切标签 |
| ② | 否则**当前不是首页虚拟标签**（`tabStore.isHomeTab === false`） | `await tabStore.switchToTab(homeTab.tabId)` 切回首页标签 | 活动标签变成 home ⇒ 壳态切到 workbench ⇒ 主进程隐藏全部内嵌视图 ⇒ 页面才有渲染面 |
| ③ | 无条件 | `await router.push(path)` | 完成路由跳转 |

**为什么 ① 要先于 ②**：home-shell 实例的可见性由「它自己是活动标签」保证，
若先切回首页标签，就把用户的 home-shell 标签换掉了 —— 用户的上下文被夺走。
因此优先尝试定向投递，只有主进程没接住（`handled: false`）才回落到 ②。

**为什么 ② 要先于 ③**：先 push 再切标签，会出现「路由已变但原生图层仍在」的中间态
（用户看到的是旧页面被盖住、新页面还没出现）；先切标签再 push，中间态是「标签已切回、
页面即将出现」，体感连续。

**本 PRD 的修法：不新增第二份实现，而是把新入口接回这份既有范式。**

- `ProfileMenu` 的「会员中心」入口：由 `router.push` 改为 `emit('navigate', '/member-center')`，
  由宿主（`MpSidebar`）的 `@navigate="onNavClick"` 承载；
- `MpSidebar` 的「升级 Pro」入口：由 `router.push` 改为 `onNavClick('/member-center')`。

> **为什么不写成新 composable**：PR #4209（已全绿在飞）正在把同一份三步判断收敛成
> `apps/desktop/src/composables/useVisibleNavigation.js`。若本 PR 再加一份同义原语，
> 主干上就会出现**两份「同一段判断」**—— 正是 #4209 立项要消灭的形态（「同一段判断被抄了两遍」）。
> 故本 PR 复用既有范式，并把新入口接进去；#4209 合并后范式被收敛成 composable，
> 本 PR 的两个入口**无需改动即继续成立**（它们只依赖 `onNavClick` 这个宿主入口）。

### 2.2 数据校验与边界合同

| 输入 / 状态 | 校验规则 | 结果 |
|---|---|---|
| `path` 非字符串 / 空串 | `typeof to !== 'string' \|\| !to` | `onNavClick` 直接 return，**不产生任何副作用** |
| ① 主进程无 `navigateActiveHomeShell` | `typeof api.pageManager.navigateActiveHomeShell !== 'function'` | 跳过 ①，落到 ②（不报错） |
| ① 返回 `handled: false` | `res.data.handled` 为假 | 落到 ②（回退路径，**不是错误**） |
| ① 抛错（IPC 通道故障） | try-catch | `console.warn('[sidebar] navigate home-shell failed', error)` 后落到 ② |
| ② 找不到首页标签（`tabs` 里没有 `isHome`） | `homeTab` 为 `undefined` | 跳过切标签，直接 ③（不报错） |
| ② 已在首页标签 | `tabStore.activeTabId === homeTab.tabId` | **不重复切标签**（幂等） |
| ② 抛错（切标签失败） | try-catch | `console.warn('[sidebar] switch home failed', error)` 后**继续 ③** —— 一次切标签失败不许吞掉整个导航 |
| ③ `router.push` 抛错（路由被守卫拦截 / 重复导航） | try-catch | `console.warn('[sidebar] navigate failed', error)`，**不把异常抛给调用方** |
| 非 Electron 环境（Vite 浏览器 / 单测桩） | `getApi()` 返回 `null` | 跳过 ①，②③ 照常；任何一步都不抛错 |
| `ProfileMenu` 的菜单项路径 | 由模板写死的 `'/member-center'` | 非法值在 `onNavClick` 入口被挡下，不产生副作用 |

**失败语义总则**：三步中任何一步失败都**不抛错**，只 `console.warn` 并继续走后续步骤
—— 宁可让用户看到一次失败的跳转（页面没变但菜单关了），也不要整条链断在第一步（点了完全没反应）。

### 2.3 接入点（本次修复的 2 处 + 1 处配套）

| # | 文件 | 位置 | 原实现 | 新实现 |
|---|---|---|---|---|
| 1 | `src/components/ProfileMenu.vue` | `goMemberCenter()` | `router.push('/member-center')` | `emit('navigate', '/member-center')` → 宿主 `onNavClick` |
| 2 | `src/layouts/MpSidebar.vue` | 模板 `@upgrade` | `router.push('/member-center')` | `onNavClick('/member-center')` |
| 3 | `src/views/ResultView.vue` | 「故事讲述」异步完成通知模态 | 未接入浮层互斥 | 接入（owner `story2video-notification-dialog`） |

### 2.4 配套修复：「故事讲述」异步完成通知模态接入浮层互斥

| 文件 | 位置 | 说明 |
|---|---|---|
| `src/views/ResultView.vue` | `showStory2VideoNotification` / `closeStory2VideoNotificationDialog` / `unmounted` | 新增 owner `story2video-notification-dialog`，打开时 `suspendEmbeddedViewsForOverlay(OWNER)`（**不 await**：模态先出现，原生图层晚一帧隐藏，用户只看到模态浮现而非「页面先消失再弹模态」；suspend/resume 走同一条 renderer→main 通道，Electron 保序投递，不存在「释放先到、挂起后到」的竞态），关闭与卸载兜底处 `releaseEmbeddedViewsForOverlay(OWNER)` |

**为什么它也归本次修**：这个模态**不是被用户点击打开的**，而是被后台生成任务的完成回调打开
（场景视频 / 图片 / 字幕 / 配音生成返回后）。生成耗时以分钟计，期间用户完全可能切到外部网页标签
⇒ 模态被原生图层整块盖住 ⇒ **「生成完成」信号丢失**（切回首页标签才发现）。
按**触发路径**判定（而不是按「代码写在哪个文件」判定）—— 这正是
`PRD-OVERLAY-VIEW-SUSPENSION` §8.1 防复发清单要求的那件事。

**owner 必须与其它浮层不同名**：浮层互斥是**按 owner 引用计数**的，复用他人 owner 会让
A 的释放把 B 的挂起计数一起减掉（`useEmbeddedViewSuspension.js` 的 `activeOwners` Set 是模块级共享的）。

---

## 3. IPC 契约

本次**不新增 IPC 通道**，只复用既有三条：

| 通道 | 方向 | 参数 | 返回 | 用途 |
|---|---|---|---|---|
| `page-manager:navigate-active-home-shell` | renderer → main（handle） | `{ path: string }` | `{ code: 0, data: { handled: boolean } }` | 范式 ①：定向投递到 home-shell 实例 |
| `page-manager:suspend-embedded-views` | renderer → main（handle） | `owner: string` | `{ code: 0, data: { suspended: boolean } }` | §2.4 通知模态的挂起 |
| `page-manager:resume-embedded-views` | renderer → main（handle） | `owner: string` | `{ code: 0, data: { resumed: boolean } }` | §2.4 通知模态的释放 |

preload 暴露面**零改动**（`suspendEmbeddedViews` / `resumeEmbeddedViews` / `navigateActiveHomeShell`
均已存在），因此**不需要重打包** `preload/index.bundle.js`，也不触碰 preload 的方法清单契约测试。

---

## 4. 交互逻辑与显示项

### 4.1 用户可感知行为

| 场景 | 修复前 | 修复后 |
|---|---|---|
| 外部网页标签活动 → 头像菜单 →「会员中心」 | 菜单关闭，界面纹丝不动 | 活动标签切回首页标签，**会员中心页面出现**；外部网页标签仍在标签栏中，随时可切回（**不丢用户上下文**） |
| 外部网页标签活动 → 头像菜单 →「升级 Pro」 | 同上 | 同上 |
| 外部网页标签活动 → `CmdOrCtrl+Alt+D` | 同上 | 由 **PR #4209** 修复（切回首页标签并打开数据看板） |
| 外部网页标签活动 → 侧边栏任意导航项 | 正常（`onNavClick` 本来就是正确范式） | **行为不变**（本 PR 只是把另两个入口接回它） |
| home-shell 标签活动 → 头像菜单 →「会员中心」 | 路由变了但页面在**另一个实例**里，用户看不到 | 定向投递给该实例，**在用户当前这个标签里**打开会员中心 |
| 首页虚拟标签活动 → 头像菜单 →「会员中心」 | 正常 | **行为不变**（不重复切标签） |
| 生成任务在后台完成 → 通知模态弹出（用户在外部网页标签） | 模态被盖住，完成信号丢失 | 内嵌视图临时让位，**模态可见可交互**；关闭后网页归位（视图仅 hide 不销毁，滚动位置与登录态不受影响） |

### 4.2 显示项

本次修复**不新增任何 UI 元素、不改动任何已有显示项**：

- 侧边栏、标签栏、导航栏的结构与尺寸不变（`TabBar` 36px + `NavBar` 40px = 76px 坐标契约不变）；
- 头像菜单的项序、图标、文案、状态胶囊、展开动效全部不变；
- 会员中心页面本身的布局、字段、文案全部不变（本次只修「能不能被看到」）。

### 4.3 提示文字

本次修复**不新增任何用户可见文案**（无新 toast、无新确认框、无新错误提示）。
用户感知到的变化是「该出现的页面出现了」，而不是「多了一句提示」。

开发者可见日志（全部为 `console.warn`，仅在异常路径出现）：

| 位置 | 文案 |
|---|---|
| 渲染层 `MpSidebar.vue` `onNavClick`（既有） | `[sidebar] navigate home-shell failed` / `[sidebar] switch home failed` / `[sidebar] navigate failed` |
| 渲染层 `useEmbeddedViewSuspension.js`（既有） | `[embedded-view-suspension] suspend failed <owner>` / `release failed <owner>` |
| 主进程 `webview-manager`（既有） | `Embedded views suspended for overlay: <owner>` / `Embedded views resumed after overlay: <owner>` |

**为什么失败时不给用户弹提示**：导航失败的唯一可感知后果是「页面没切换」，
而这与「点击入口没反应」是同一种观感。给一次 toast 反而会让用户以为是账号/权限问题。
真实缺陷已由结构锁与行为测试拦在合并前，运行期的降级只写开发者日志。

### 4.4 键盘与无障碍

- 头像菜单的键盘契约不变：`↑/↓` 移动、`Enter/Space` 激活、`Esc` 关闭并归还焦点；
- 「会员中心」菜单项仍是 `role="menuitem"` 的 `<button>`，回车触发同一条 `goMemberCenter` 路径；
- 切标签与路由跳转均不改变焦点位置（`switchToTab` 走主进程 IPC，DOM 焦点不动）。

---

## 5. 全仓通查清单（三路审计结论）

### 5.1 判据基础

- **覆盖矩形**：x ≥ 侧栏宽（默认 200；**全局折叠态为 0**，横跨整窗宽）、y ≥ 76，到底部。
  真源 `apps/desktop/electron/services/view-bounds.js:156` `computeEmbeddedViewBounds`。
  ⚠️ 早期口头口径「折叠 68px」是**窄窗 CSS 轨道**那一档，与原生视图 bounds 无关 —— 已订正。
- **两套互斥机制**：
  - 机制一 · 壳态互斥（让**应用页面**可见）：`App.vue` `watch(isHomeTab)` → `setShellMode`；
  - 机制二 · 浮层互斥（让**应用级模态浮层**可见）：`useEmbeddedViewSuspension` → owner 引用计数挂起。
- **登记表**：`apps/desktop/src/overlay-view-suspension.test.js`（逐个登记合规浮层的 owner 契约）。

### 5.2 本次修复（2 处 + 1 处配套）

见 §2.3 / §2.4。

### 5.3 报告后续项（6 处，含判定依据）

| # | 现象 | 位置 | 判定 | 后续方案 |
|---|---|---|---|---|
| F1 | 「升级失败」告警被原生图层盖住 | `src/components/UpdateNotification.vue:52`（`fixed bottom:16 right:88`） | **真缺陷，但属既有合同的「瞬时非模态」残余限制**（`PRD-OVERLAY-VIEW-SUSPENSION` §6） | 按 §6 方向治理：告警改为不进入覆盖区（迁到 y<76 的 chrome 条），或主进程独立 alwaysOnTop 窗口 |
| F2 | 发布进度浮卡 + 最小化胶囊被盖住 | `src/components/PublishProgressPanel.vue:207`（`fixed` 右下） | **真缺陷，但既有合同显式「不接入」**（非模态；`PublishProgressPanel.test.js:579` 有**负向锁**断言源码不得出现 `suspendEmbeddedViewsForOverlay`） | 保留负向锁；发布任务以分钟计，「发布中切到外部网页标签 ⇒ 进度完全不可见」是高频场景，建议按 §6 方向治理并更新合同 |
| F3 | 「后台运行」居中 toast 被盖住 | `src/components/PipelineBackgroundToast.vue:36`（`fixed top:50% left:50%`） | **真缺陷；且合同 §5 把它写成「右下 toast」与实现不符（文档漂移）** | 本次已订正 §5 表述；治理方案同 F1（居中被盖的观感损失比右下更大，§6 的「生命周期短、闪烁损失大于收益」对居中 toast 不成立） |
| F4 | 离线横幅把 chrome 整体下推约 35px，**破坏 76px 坐标契约** | `src/components/OfflineIndicator.vue:22`（流内 flex 子项，无 `position`） | **真缺陷（新根因，非遮挡族）**：断网时横幅占流高 ⇒ 整个 `.mp-shell` 下移 ⇒ 原生视图（固定 y=76）盖住 NavBar 的地址栏输入框与「保存账号」按钮 ⇒ 浏览器标签下这两个入口点不动 | 根治方案：主进程按渲染进程上报的**实际 chrome 高度**重算内嵌视图 bounds（`computeEmbeddedViewBounds` 的 `topOffset` 参数已存在但未接线；可沿用 `setSidebarWidth` 的先例）。需改 preload 暴露面 + 重打包 bundle + 视觉基线重建，**本次未做** |
| F5 | OAuth 授权视图不参与两套互斥 | `electron/services/oauth-manager.js:146`（`mainWindow.contentView.addChildView(view)`，bounds x=200/y=76 与其它内嵌视图一致）；`webview-manager/layout.js:36-42,76-82` 的 `_hideAllTabs` 只隐藏 tabs/auth/qrcode | **真缺陷（机制级盲区）**：OAuth 授权页开着时，连**已受保护**的设置弹窗 / 关标签确认框都会被盖住 | 需在 `setShellMode` 与 `suspendEmbeddedViewsForOverlay` 两处一并纳入 OAuth 视图的 hide/show，**属主进程改动，本次未做** |
| F6 | 「下载历史视频」的完成/失败提示根本弹不出来 | `src/views/CreateView.vue:4952`（`this.showStory2VideoNotification(...)`）、`:4954`（`this.showStory2VideoOperationFailure()`） | **真缺陷（新发现，与遮挡无关）**：这两个方法**只在 `ResultView.vue` 里定义**（`:927` / `:934`），`CreateView.vue` 无定义、无 mixin ⇒ 运行时 TypeError；catch 分支再调另一个不存在的方法 ⇒ 二次 TypeError 逃逸出 catch | 与本次遮挡修复无关，属独立缺陷；需决定 CreateView 侧用「错误对话框」还是「toast」承接下载结果，另开 PR |

### 5.4 已排查并排除（不复查）

审计共给出 19 条「疑似但已排除」+ 20+ 条「已受保护」条目，摘要：

| 条目 | 排除依据 |
|---|---|
| 头像菜单面板本身 | 在侧边栏内（x < 侧栏宽），不越出原生图层覆盖区 |
| 标签栏 / 导航栏内的一切 | 恒 y < 76，原生视图永不覆盖（例外见 F4） |
| 顶部 toast（`ElMessage` 等） | Element Plus 默认 `position: fixed; top: 16px` ⇒ y ∈ [16,56) < 76，本仓未覆写该定位 |
| `App.vue` 的 `goHome()` | **先 `switchToTab(home)` 再 `router.push('/')`** —— 已核对源码，属正确范式，不冤枉 |
| `App.vue` 的 `retryRouteLoad()` | 按钮在工作区内（y ≥ 124），外部网页活动时本就点不到；不构成「点了没反应」 |
| `App.vue` 的 `home-shell-navigate` 回调 | 目标就是该实例自身的 router，页面在它内部渲染 ⇒ 可见 |
| `Accounts.vue:1363` `.login-state` / `:1369` `.login-qr-preview` | 几何上必落覆盖区，但模板与 `:class` 绑定**零使用** ⇒ 死 CSS，不报 |
| `SidebarServiceStatus` 的 `el-popover` | 宽 300px，右缘约 100px 落入覆盖区（部分遮挡），低危 |

---

## 6. 验收标准

- [x] 行为锁：`ProfileMenu.test.js`（会员中心入口交回宿主，不再自行 push）、`MpSidebar.test.js`（升级入口在外部网页标签活动时**先切回首页标签再跳转**，含调用顺序断言）
- [x] 结构锁：新增 `apps/desktop/src/visible-route-navigation-contract.test.js`（入口不得自行裸 push + 可见导航范式必须含「切回首页标签」与「home-shell 定向投递」两步；**刻意不锁死具体实现形态**，以便 PR #4209 把范式收敛成 composable 时不撞锁）
- [x] 浮层登记表补登：`overlay-view-suspension.test.js` 新增 ResultView 通知模态 owner 条目
- [x] 变异验证：把 `ProfileMenu` 改回裸 `router.push`、把 `MpSidebar` 的 `@upgrade` 改回裸 `router.push`、把范式的「切回首页标签」一步删掉 —— 结构锁均当场变红
- [x] 既有回归：`ProfileMenu.test.js` / `MpSidebar.test.js` / `overlay-view-suspension.test.js` / `ResultView.*.test.js` 全绿
- [ ] 人工验证：外部网页标签活动时点「会员中心」/「升级 Pro」，页面出现且可交互；切回外部网页标签，登录态与滚动位置未丢
- [ ] 人工验证：生成任务在后台完成时，通知模态在外部网页标签活动时可见可交互，关闭后网页归位

---

## 7. 防复发措施

1. **结构锁**（`visible-route-navigation-contract.test.js`）：
   任何「让用户去某个应用内页面」的入口**必须**交回可见导航范式；
   锁里带**反向断言**（`not.toMatch(/router\.push\(/)`）—— 加新入口时若写成裸 `router.push` 当场红。
   锁的匹配一律**先剥全部注释**（行注释 / 块注释 / HTML 注释三类），避免「注释里的散文满足断言」这种假绿。
2. **锁不锁死实现形态**：本仓另有一条在飞改动（PR #4209）正在把范式收敛成 composable ——
   本锁按**行为关键字**（`switchToTab(` / `navigateActiveHomeShell`）匹配，两种形态都成立；
   锁死函数名会让那份收敛必然撞锁。
3. **行为锁判据域对齐**（`AGENTS.md`「取证口径」）：本修复用**行为测试**锁
   （真的跑、真的断言「切标签早于跳转」的调用顺序），不用「源码里存在某个字符串」当证据；
   结构锁只用于「新增入口会不会又写回裸 push」这一**文本属性**。
4. **合同交叉引用**：`PRD-OVERLAY-VIEW-SUSPENSION` §8 新增第 0 条，本 PRD §2.1 与之**并列互补** ——
   浮层要的是「原生图层让位」（挂起/释放），路由页要的是「活动标签回到首页虚拟标签」（切标签）。
   **只治理其一，另一半必然漏**（2026-10-23 的「点了会员中心没反应」正是范围外的那一半）。
5. **审查清单**：新增「跳转到应用内路由」的入口时，必须确认它交回可见导航范式，不得直接调 `router.push`。
