# PRD：首页标签导航栏只读化 + 标签栏视觉精致化

- 日期：2026-09-23
- 状态：已批准（用户确认：Q1「保留占位但精致化」→ 落地为「渲染只读 NavBar」；Q2 精致化范围 = 标签栏 TabBar）
- 优先级：P2（UI/UX 一致性修复 + 视觉精致化）
- 关联分支：`codex/tab-nav-refine`（worktree `D:/Data/projects/mp-worktrees/mp-tab-nav-refine`）
- 关联文档：`PRD-TAB-INDEPENDENT-HOME-2026-09-22.md`（§13.3 内容矩形 TOP=76px 契约）、壳态收敛 T0-6a/T0-6b
- 变更类型：渲染层（`apps/desktop/src/`），**不触及** `electron/` 主进程与 `packages/rpa-engine/`

---

## 1. 背景与问题

### 1.1 用户反馈

> "为什么现在应用的第一个固定标签，没有浏览器地址和上一页下一页区域条了。而新的标签是有的。另外，把这个区域和标签的样式优化一下，原来太丑了。"

### 1.2 根因溯源（非缺陷，而是既有设计决策的副作用）

第一个"首页"标签是**固化虚拟标签**（`tabId='home'`，不创建 WebContentsView，内容由主窗口唯一 SPA `router-view` 渲染）。在"壳态收敛 6a（T0-6a）"决策中，`App.vue` 对首页标签**整行不渲染 `NavBar`**，改为一个 40px 的空白占位行（`.mp-shell-nav-placeholder`）。当时的理由是：首页是 SPA 页，地址栏/刷新/前进后退"语义失效且误导"。

该决策带来两处副作用：

1. **视觉割裂**：首页标签没有地址栏与翻页条，而新标签（浏览器/登录标签）有——正是用户所感知的问题。
2. **占位理由已过期**：2026-09-15 的修复（`useSpaNavHistory`）已让首页标签的**前进/后退由 vue-router SPA 历史驱动**，具备真实语义；`NavBar` 在 `isHome` 下本就**隐藏刷新按钮、禁用地址栏**。因此"整行不渲染"过度收敛，唯一仍会误导的只剩地址栏 placeholder 文案"搜索或输入网址"。

此外，`TabBar.vue` 长期存在**硬编码灰色**（`#e8eaf2`/`#d5d7e0`/`#6b7280`/`#374151`/`#9ca3af`/`#d1d5db` 等），未走设计 token，与全站"奶油·靛紫"视觉规范（主色 `#5048E5`）脱节，是"丑"的直接来源。

## 2. 目标

1. 消除首页标签与新标签的导航区割裂：首页标签渲染**只读态 NavBar**（地址栏置灰禁用、刷新隐藏、前进/后退经 SPA 历史有效、🏠 回首页）。
2. 精致化 `TabBar`：去硬编码灰、全面改用设计 token，活动标签卡片化 + 品牌色顶部指示条，借鉴参考样式（图3）的布局精致度但配色统一现有浅色规范。
3. **零回归守住核心不变量**：`TabBar(36px) + 导航行(40px) = 76px`，即主进程 `WebContentsView` 内容矩形 `TOP=76px` 定位不变。

## 3. 非目标

- 不改主进程 `WebviewManager`/`pageManager` IPC 契约与视图定位逻辑；
- 不改 `isHomeShell`（"+"新标签的独立 SPA 实例）分支——该分支仍不渲染外层 chrome（由 `tab-independent-home.test.js` 守卫）；
- 不做 NavBar 整体重设计（本轮 NavBar 仅补"首页只读态"正确性，视觉维持现状）；
- 不引入暗色模式新语义（token 已含暗色变体，自动生效）。

## 4. 功能逻辑

### F1 首页标签渲染只读 NavBar

- `App.vue` 主窗口分支移除 `<NavBar v-if="!isHomeTab">` 与 `v-else` 空白占位行，改为**无条件渲染** `<NavBar :is-home="isHomeTab" ... />`。
- `NavBar` 依 `isHome` prop 自动进入只读态（既有能力，本轮补齐 placeholder）：
  - 刷新按钮 `v-if="!isHome"` → 首页隐藏；
  - 地址栏 `:disabled="isHome"` → 首页不可输入；
  - 后退/前进按钮 `:disabled="!canGoBack/!canGoForward"` → 由 `navCanGoBack/navCanGoForward`（首页取 `useSpaNavHistory`）驱动，**功能有效非禁用摆设**。

### F2 首页地址栏 placeholder 去误导

- 首页（`isHome`）placeholder 由误导性的"搜索或输入网址"改为 `t('nav.home')`（zh：`首页`；en：`Home`），配合禁用态表达"当前为应用主页、不承载网址"。
- 非首页 placeholder 维持 `currentTitle || '搜索或输入网址'`。

### F3 TabBar 视觉精致化（token 化）

| 元素 | 旧（硬编码） | 新（token / 精致化） |
|------|------|------|
| `.tab-bar` 背景 | `#e8eaf2` | `linear-gradient(180deg, var(--color-sidebar-bg-start), var(--color-bg-inset))` |
| `.tab-bar` 下边框 | `#d5d7e0` | `var(--color-border)` |
| 标签间距/内边距 | `gap:1px` / `0 8px 0 12px` | `gap: var(--spacing-1)` / `0 var(--spacing-2) 0 var(--spacing-3)` |
| 圆角 | `8px 8px 0 0` | `var(--radius-sm) var(--radius-sm) 0 0` |
| 常态文字 | `#6b7280` | `var(--color-text-secondary)` |
| hover 背景/文字 | `#d1d5db` / `#374151` | `var(--color-sidebar-hover-bg)` / `var(--color-text-primary)` |
| 活动标签 | `var(--color-bg-card)` + `#1f2937` + 硬阴影 | 卡片底 + `var(--color-text-strong)` + `var(--shadow-sm)` + 1px `var(--color-border)` 描边（底边与卡片同色，形成"抬起"接缝） |
| 活动标签强调 | 无 | `::before` 顶部 2px `var(--color-primary)` 指示条（借鉴图3 标签强调线） |
| 关闭按钮 | `#9ca3af`/`#e5e7eb`/`#374151` | `var(--color-text-muted)` / `var(--color-border)` / `var(--color-text-strong)`，圆角 `var(--radius-xs)` |
| 未保存角标 | `#f59e0b` | `var(--color-warning)`，圆角 `var(--radius-full)` |
| "+"按钮 | `#6b7280`/`#d1d5db` 32px | `var(--color-text-secondary)`，28px，hover 卡片底 + `var(--color-primary)` 图标 + 描边 |
| 平台图标图片 | 无尺寸约束（`.tab-icon-img` 缺样式） | 新增 `16×16` + `var(--radius-xs)` + `object-fit: contain` |

## 5. 交互逻辑明细

1. 启动应用 → 首页标签激活 → TabBar + 只读 NavBar（地址栏灰底显示"首页"、刷新隐藏、🏠 在列）+ MpModuleNav + 内容区。
2. 在首页标签内进入某模块（如"账号管理"）→ 点 NavBar 后退 → 经 vue-router 历史回上一模块页（前进同理）；地址栏始终灰态不可输入。
3. 点 🏠 → `goHome()`：切回首页标签 + `router.push('/')` 归位首页。
4. 点"+" → 新建内嵌主页标签（走 `isHomeShell` 独立分支，不含外层 NavBar，行为不变）；该标签激活后 NavBar 恢复完整可用态（地址栏可输入、刷新可见）。
5. 首页标签与新标签来回切换 → NavBar 只读/可用态随 `isHome` 自动切换，chrome 高度恒为 76px，内容区无跳动。

## 6. 数据校验与边界

| 项 | 规则 |
|----|------|
| 只读判据 | 仅由 `isHomeTab = isHomeShell \|\| store.isHomeTab` 单一来源驱动，禁止组件内另立判据 |
| 高度不变量 | `.tab-bar` height 36px、`.nav-bar` height 40px 冻结；两者之和 = 主进程内容矩形 TOP=76px，改动任一须同步主进程定位常量 |
| 前进/后退可用性 | 首页取 `useSpaNavHistory(router)` 的 `canGoBack/canGoForward`；无历史时按钮 `disabled`（非隐藏），保持布局稳定 |
| placeholder i18n | 首页取 `t('nav.home')`；须 zh/en 成对（`nav.home` 已存在，无新增 key） |
| 暗色模式 | 全部取 token，`[data-theme="dark"]` 覆盖自动生效，禁止新增硬编码色 |
| 内嵌主页分支隔离 | `isHomeShell` 分支不含 `<NavBar>`，本次改动只作用于主窗口 `<template v-else>` 分支 |

## 7. 显示项与提示文字（i18n，zh/en 成对）

| key | zh | en | 位置 | 状态 |
|-----|----|----|------|------|
| `nav.home` | 首页 | Home | 首页标签地址栏 placeholder | 复用既有 |
| `tabs.newTabTitle` | 新标签页 | New Tab | 新标签初始标题 | 既有不动 |
| `tabBar.unsavedBadge` | 登录未保存 | Login not saved | 未保存角标 tooltip | 既有不动 |

- 本轮**不新增**用户可见文案（placeholder 复用 `nav.home`），故无 Gate 7 成对新增压力；渲染层不新增中文字符串字面量。

## 8. 验收标准

1. 首页标签激活时，导航区显示 NavBar 行（地址栏灰底、placeholder"首页"、无刷新按钮、🏠 在列），不再是一片空白。
2. 首页标签内切换模块后，NavBar 后退/前进按钮可真实回退/前进 SPA 路由历史；无历史时按钮置灰不可点。
3. 新标签（浏览器/内嵌主页）NavBar 完整可用（地址栏可输入、刷新可见），与首页只读态视觉风格一致。
4. 首页 ↔ 新标签切换，内容区顶部不跳动（chrome 恒 76px）。
5. TabBar 视觉：活动标签为白底卡片 + 顶部品牌紫指示条 + 轻投影；hover、关闭、"+"、未保存角标均取 token 色，暗色模式下无浅色突兀。
6. 单测全绿：`TabBar.test.js`（功能 + 样式 token 契约）、`NavBar.test.js`（首页只读态）、`shell-mode-6a.test.js`（修订契约）、`tab-independent-home.test.js`（内嵌分支隔离，不回归）。
7. CI 全绿并合并。

## 9. 测试计划（TDD，先红后绿）

| 层 | 文件 | 场景 |
|----|------|------|
| 组件功能 | `src/components/TabBar.test.js`（新） | 活动标签 `.active`；首页无关闭按钮、浏览器标签有；switch/create/close 事件 |
| 组件样式契约 | `src/components/TabBar.test.js` | `.tab-bar` 36px 不变量；背景去 `#e8eaf2` 用 token；活动标签含 `--color-bg-card`+`--color-primary`；`.tab-icon-img` 存在 |
| 组件只读态 | `src/components/NavBar.test.js`（扩展） | isHome：后退/前进/首页/地址栏存在、刷新隐藏、地址栏 disabled、placeholder="首页"；非首页：地址栏不禁用、placeholder 含"搜索" |
| 源码契约 | `src/shell-mode-6a.test.js`（修订） | 移除 `mp-nav-placeholder`；NavBar 不被 `v-if="!isHomeTab"` 隐藏且绑 `:is-home`；TabBar 36 + NavBar 40 = 76 不变量；save-account 入口保留 |
| 回归隔离 | `src/tab-independent-home.test.js`（不动） | isHomeShell 分支仍不含 NavBar/TabBar/Sidebar |

## 10. 风险与缓解

| 风险 | 等级 | 缓解 |
|------|------|------|
| 破坏 76px TOP 不变量 → 浏览器标签内容错位 | 中 | NavBar 本就 40px 替换 40px 占位；`shell-mode-6a.test.js` 源码契约锁定 36+40 |
| 首页地址栏被误认为可输入 | 低 | 禁用态 + 灰底 + placeholder"首页"三重暗示；只读态单测覆盖 |
| TabBar token 化引发暗色回归 | 低 | 全部取既有 token（含 dark 变体），无新增硬编码；视觉走查 |
| 与并发会话改同一 App.vue 冲突 | 低 | 独立 worktree；改动集中在模板/style 局部 |

## 11. 追溯

- 代码：`apps/desktop/src/App.vue`、`components/TabBar.vue`、`components/NavBar.vue`
- 测试：`components/TabBar.test.js`、`components/NavBar.test.js`、`shell-mode-6a.test.js`
- CHANGELOG：行为变更（首页标签由隐藏导航栏改为渲染只读导航栏）+ 视觉（TabBar token 化精致）
- 决策沉淀：内置记忆 / 外部记忆 / EverOS（壳态收敛 6a 修订理由 + TabBar token 化模式）
