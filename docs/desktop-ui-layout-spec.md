# 桌面端 UI 布局规格

> **状态**：生效中
> **版本**：v1.0
> **日期**：2026-09-03
> **适用范围**：`apps/desktop/src` 渲染层 + `apps/desktop/electron` 主进程 WebContentsView 管理
> **关联提交**：`959d65cff` (fix: prevent WebContentsView from overlapping left sidebar)

---

## 1. 总体布局框架

### 1.1 根组件 (App.vue)

桌面应用采用 **左侧固定侧边栏 + 右侧主体区域** 的经典布局，由 `App.vue` 的 `.mp-shell` 容器承载。

```
┌─────────────────────────────────────────────────────┐
│  .app-root                                          │
│  ┌────────────────────────────────────────────────┐ │
│  │  .mp-shell (flex row, height: 100%)       │ │
│  │  ┌──────────┬─────────────────────────────────┐│ │
│  │  │ 侧边栏    │  .mp-shell-main            ││ │
│  │  │ Sidebar  │  ┌─────────────────────────────┐││ │
│  │  │          │  │ TabBar (浏览器式标签栏)       │││ │
│  │  │ 固定宽度  │  ├─────────────────────────────┤││ │
│  │  │ 200px    │  │ NavBar (导航/URL 栏)          │││ │
│  │  │          │  ├─────────────────────────────┤││ │
│  │  │ 不可滚动  │  │ MpModuleNav (模块导航) │││ │
│  │  │ 不可移动  │  │ 仅首页标签时显示；发布域不渲染 │││ │
│  │  │          │  ├─────────────────────────────┤││ │
│  │  │          │  │ .mp-workspace          │││ │
│  │  │          │  │ (flex: 1, overflow: auto)    │││ │
│  │  │          │  │ → <router-view />            │││ │
│  │  │          │  └─────────────────────────────┘││ │
│  │  └──────────┴─────────────────────────────────┘│ │
│  └────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────┘
```

### 1.2 关键 CSS 规则

| 元素 | CSS 规则 | 说明 |
|------|---------|------|
| `.mp-shell` | `height: 100%; display: flex; min-width: 0; overflow: hidden;` | 整个外壳不可滚动，Flex 横向排列 |
| `.mp-sidebar` | `width: var(--mp-sidebar-width, 200px); min-width: var(--mp-sidebar-width, 200px);` | 固定宽度，不可压缩 |
| `.mp-shell-main` | `min-width: 0; flex: 1; display: flex; flex-direction: column; overflow: hidden;` | 右侧主体，纵向 Flex 布局 |
| `.mp-workspace` | `min-width: 0; min-height: 0; flex: 1; overflow: auto;` | 内容工作区，独立滚动 |
| `.fullscreen-main` | `height: 100%; min-height: 0; overflow: auto;` | 全屏路由（如 `/first-run`）独立渲染 |

> ⚠️ **页面级容器宽度陷阱**（详见 §15.2）：`.mp-shell-main` / `.cohere-main` 这类 `flex-direction: column` 容器内，子元素一旦同时写了 `max-width` 与 `margin: 0 auto`，交叉轴上的 auto margin 会抑制默认的 `align-self: stretch`，宽度退化为 `fit-content(max-content)` —— **必须显式 `width: 100%`**。同类缺陷已在本仓库出现两次：`BUGFIX-REWRITE-PAGE-WIDTH`（RewriteView，2026-09-16，修于 `cohere-design-system.css`）与 `BUGFIX-CREATE-PAGE-WIDTH`（CreateView，2026-09-20，修于 `create-view.css`）。

### 1.3 全屏路由

路由 `/first-run`（首跑引导）为全屏模式，脱离侧边栏和导航壳，独立整屏渲染。由 `isFullScreenRoute` computed 属性控制：

```javascript
const isFullScreenRoute = computed(() => route.path === '/first-run')
```

---

## 2. 左侧导航栏 (MpSidebar)

### 2.1 概述

- **文件**：`apps/desktop/src/layouts/MpSidebar.vue`
- **宽度**：200px（CSS 变量 `--mp-sidebar-width: 200px`，定义于 `src/styles/cohere-design-system.css:69`）
- **窄屏适配**：视口 ≤900px 时折叠为 68px，隐藏文字标签和部分元素
- **背景**：渐变紫色 `linear-gradient(180deg, #f4f2ff 0%, #f0efff 100%)`

### 2.2 固定行为

- 侧边栏是 Flex 布局中的固定宽度子元素
- 父容器 `.mp-shell` 设置 `overflow: hidden`，整体不可滚动
- 右侧工作区 `.mp-workspace` 独立滚动（`overflow: auto`），不影响侧边栏
- **侧边栏不会随右侧内容滚动或移动**

### 2.3 内容组成（2026-09-14 调整）

| Header | 品牌区：汤姆鱼 Logo + 应用版本号 `vX.Y.Z` + `+` 新建发布按钮 | 登录区已移出（见 2.5），保留快捷发布入口；品牌区细则见 2.6 |
| 主导航 | 主页、发布、账号、数据、视频创作、采集 | 6 个主要导航项，使用 `router-link` |
| 更多菜单 | 发布日历、私信评论、CLI、素材库、关键词监控、爆款分析、提示词评估、文案改写、热门选题、模型提供商、知识库、性能洞察、会员中心 | 13 个次要导航项，折叠在下拉菜单中；原「分屏监控」入口已随功能移除 |
| Footer 第 1 行 | 服务连接信息（`SidebarServiceStatus`） | 六服务聚合状态 + hover 明细 |
| Footer 第 2 行 | 底部用户 banner（`ProfileMenu`） | 收起态仅一条；点击向上展开菜单（账号操作 / 设置 / 升级 Pro） |

> **已移除（2026-09-14）**：主导航「设置」按钮（迁入底部展开菜单）、footer 独立「⭐ 升级 Pro」胶囊按钮（迁入底部展开菜单并统一版式）、footer「客户端状态」独立文字行（合并进 banner 状态点与 `title`）、header 的 `MP` 文字徽标与 `Multi-Publish` 文本（被正式品牌 Logo + 版本号取代，见 2.6）。

### 2.4 宽度同步机制

侧边栏宽度通过 `ResizeObserver` 实时同步到主进程，确保 WebContentsView 定位准确：

```javascript
// MpSidebar.vue onMounted
const el = document.querySelector('.mp-sidebar')
if (el) {
  const syncWidth = () => {
    const w = el.getBoundingClientRect().width
    if (w > 0) invokePageManager('setSidebarWidth', Math.round(w))
  }
  syncWidth()
  _sidebarObserver = new ResizeObserver(syncWidth)
  _sidebarObserver.observe(el)
}
```

**数据流**：
1. 渲染进程 `MpSidebar` → `invokePageManager('setSidebarWidth', width)`
2. Preload API `pageManager.setSidebarWidth(width)` → IPC `page-manager:set-sidebar-width`
3. 主进程 `WebviewManager.setSidebarWidth(width)` → 更新 `_sidebarWidth` → 同步到 `AuthViewManager` / `QrCodeLogin` → 调用 `_repositionAll()`

### 2.5 底部用户 banner（登录区，2026-09-14 新增）

登录区由侧边栏**顶部**迁移到底部，采用「收起只为一条 banner、点击向上展开完整菜单」的范式（对齐主流桌面客户端）。详细需求见 [PRD：侧边栏底部用户菜单与导航精简](../01-docs/PRD-SIDEBAR-BOTTOM-USER-MENU-2026-09-14.md)。

**唯一实现**：`apps/desktop/src/components/ProfileMenu.vue`（底部向上展开形态）。**禁止**各视图自建用户菜单 / 登录入口副本。

#### 2.5.1 结构与显示项

| 位置 | 元素 | 内容 |
|------|------|------|
| banner（收起态） | 头像 + 状态点 + 显示名 + 许可徽标 + 展开指示 `⌃` | 头像右下方 10×10 状态点；`title` = 身份状态文案 |
| 展开面板（向上） | 菜单标题（显示名 + 状态）| `role="menu"`，`aria-labelledby="profile-menu-trigger"` |
| 展开面板 | 会员中心 / 切换账号 / 退出登录 | 已登录时；`loading` 中禁用并显示进行中文案 |
| 展开面板 | 状态说明 + 重试登录 | 未登录/过期/身份服务不可用时 |
| 展开面板 | 分隔线 `role="separator"` | 账号区与通用区之间 |
| 展开面板 | 设置（`nav.settings`） | 任意状态均显示，抛出 `open-settings` |
| 展开面板 | ⭐ 升级 Pro（`memberCenter.upgradePro`） | 非 Pro 显示，抛出 `upgrade` |

#### 2.5.2 展开方向与几何

| 项 | 值 |
|----|----|
| banner 宽度 | 100%（footer 内容宽度），`padding: 8px 10px`，圆角 10px |
| 面板定位 | `absolute`，`bottom: calc(100% + 8px)`，`left/right: 0`（与 banner 同宽，**不溢出侧边栏**） |
| 面板最大高度 | `min(70vh, 420px)`，超出内部滚动 |
| 面板层级 | `z-index: 140` |
| 菜单项版式 | 统一 `.profile-menu-action`（宽 100%、`padding: 8px 10px`、1px 描边、圆角 `--r-xs`）；升级项仅加金色强调，不改结构 |

#### 2.5.3 交互逻辑

| 触发 | 行为 |
|------|------|
| 点击 banner（`signed_out` / `expired` 且未登录中） | 直接发起登录，**不展开**菜单；失败才展开展示错误 |
| 点击 banner（其他状态） | 展开菜单并聚焦首个菜单项 |
| 点击 banner（已展开） | 收起菜单 |
| 键盘 `↓` | 展开并聚焦首项 |
| `Esc` | 收起并回焦 banner |
| `Tab` | 收起菜单（焦点不落入收起区域） |
| `↑`/`↓`/`Home`/`End` | 菜单项间循环 |
| 点击面板外 | 收起菜单 |
| 选中菜单项 | 先收起菜单，再执行动作（跳转 / 打开弹窗 / 抛出事件） |
| 服务连接信息 | 始终位于 banner **上方**（footer DOM 顺序 [0] 服务信息 → [1] banner，由单测钉死） |

#### 2.5.4 数据校验与降级

| 校验项 | 规则 | 失败处理 |
|--------|------|---------|
| `placement` 枚举 | 仅 `'bottom'` / `'top'` | 非法值回落到默认（向下）定位，不抛异常 |
| 身份状态 | 9 态枚举，未匹配归 `error` | 橙点 + 错误文案 |
| 显示名 | 空值 → 头像取 `M`，菜单标题回落 `Multi-Publish` | 不渲染空字符串 |
| Pro 判定 | `licenseStore.isPro` | 假值一律按非 Pro 显示升级入口（不误隐藏付费入口） |
| 重复提交 | `pendingAction` 锁 + `disabled` | 进行中文案，防二次触发 |

### 2.6 左上角品牌区（Logo + 版本号，2026-09-14 新增）

侧边栏 header 的品牌区由「`MP` 文字徽标 + `Multi-Publish` 文本」升级为「**品牌 Logo 图片 + 应用版本号**」，对齐参考客户端左上角 *Logo + vX.Y.Z* 的形态。详细需求见 [PRD：侧边栏左上角品牌区](../01-docs/PRD-SIDEBAR-BRAND-LOGO-VERSION-2026-09-14.md)。

**唯一实现**：`apps/desktop/src/layouts/MpSidebar.vue` 的 `.mp-sidebar-header`。**禁止**各视图自建品牌标识 / 版本号副本。

#### 2.6.1 结构与显示项

| 位置 | 元素 | 内容 | 选择器 |
|------|------|------|--------|
| header | Logo `<img>` | 汤姆鱼 Logo（透明 PNG） | `[data-testid="mp-sidebar-logo"]` |
| header | 版本号 `<span>` | `v` + `app:get-version` 返回值（如 `v0.1.0`），`title` = 当前版本 | `[data-testid="mp-sidebar-version"]` |
| header | 新建发布按钮 | `+`（`aria-label`/`title` = 新建发布） | `button[aria-label="新建发布"]` |

#### 2.6.2 尺寸推导（200px 侧边栏）

| 步骤 | 计算 | 结果 |
|------|------|------|
| ① 可用宽度 | 200px − 14px×2 内边距 | 172px |
| ② 让位新建发布按钮 | 24px + gap 8px | 剩 140px |
| ③ 让位版本号 | `v0.1.0`（11px）≈ 38px + gap 8px | 剩 ≈94px |
| ④ 垂直约束 | 与 40px 导航行对齐且 header 轻量 → Logo 高 **36px** | header 高 66px |
| ⑤ 内容宽高比 | 源图内容包围盒 2930 / 1798 = **1.6296** | Logo 宽 ≈ **59px** |
| ⑥ 资源倍率 | 3×（HiDPI/200% 缩放不模糊） | 资源 **176×108** |

| 项 | 值 |
|----|----|
| 资源路径 | `apps/desktop/src/assets/brand/tom-fish-logo.png` |
| 资源规格 | 176×108 RGBA PNG，约 13.9KB（源图 3042×1910 / 1.06MB，裁剪透明边距后等比缩小） |
| CSS | `height: 36px; width: auto; object-fit: contain`（宽度由固有宽高比自动得出） |
| 版本号样式 | `font-size: 11px; line-height: 1; letter-spacing: .2px; color: #9a9cb3`；超长省略号截断 |
| 版本号数据源 | 主进程 IPC `app:get-version`（读 `apps/desktop/package.json` 的 `version`）；该字段由根 `package.json` 单一真相源经 `scripts/sync-version.mjs` 自动派生（见 [版本管理规范](./version-management.md)） |
| 唯一取数封装 | `apps/desktop/src/composables/useAppVersion.js`（`extractAppVersion` + `useAppVersion`） |

#### 2.6.3 校验与降级

| 校验项 | 规则 | 失败处理 |
|--------|------|---------|
| 成功响应 | `code === 0` 且 `data` 非空 | 渲染 `v{data.trim()}` |
| 失败码 | `code !== 0` | 不渲染版本号（**不得**把 `message` 当版本号） |
| `data` 为空 | `null` / `undefined` / `''` / 纯空白 | 不渲染版本号 |
| 非对象响应 | 字符串 / 数组 / `null` | 不渲染版本号 |
| IPC 不可用 | 无 `window.electronAPI` → `invoke` 返回 `undefined` | 不渲染版本号（纯浏览器 / 视觉回归环境走此路径） |
| IPC 抛异常 | `loadVersion` 内 `catch` | 吞掉异常，不打断应用壳渲染 |
| 资源缺失 | 图片 404 | 图片空占位，不影响版本号与新建发布按钮 |

#### 2.6.4 响应式（`max-width: 900px`，侧边栏 68px）

| 元素 | 窄屏行为 |
|------|---------|
| Logo | 保留，`height: 28px; max-width: 100%`（≈46px ≤ 可用 56px） |
| 版本号 | 隐藏（宽度不足） |
| 新建发布按钮 | 隐藏（沿用原行为） |

#### 2.6.5 交互与无障碍

| 元素 | 属性 |
|------|------|
| Logo | 无交互（不跳首页、不可拖拽、不可选中）；`alt` = `sidebar.brandLogoAlt`（`Multi-Publish`） |
| 版本号 | 无点击行为；`title` = `sidebar.appVersionTitle`（当前版本 / Current version） |
| 焦点 | 两者均不可聚焦，不进入键盘 Tab 序 |

---

## 3. 模块导航栏 (MpModuleNav)

### 3.1 概述

- **文件**：`apps/desktop/src/layouts/MpModuleNav.vue`
- **显示条件**：仅当 `isHomeTab` 为 `true`（当前活动标签为首页标签）时挂载（`App.vue` 中 `v-if="isHomeTab"`）
- **域级显示条件**：组件内部再按路由域过滤——发布域路由（`/publish`、`/publish/history`、`/publish?tab=drafts`、`/collection` 等非首页且非账号域路由）不渲染任何标签，导航整行不占位（含底部分隔线）；主页域与账号域正常渲染
- **高度**：`var(--mp-nav-height, 70px)`（渲染时）

### 3.2 模块标签

| 模块 | 标签 | 路由 | 状态 |
|------|------|------|------|
| 首页 | 主页 | `/` | 显示 |
| 账号 | 账号管理、分组管理、分享链接、收藏分组 | `/accounts`（含 `?tab=` 查询参数切换） | 显示 |
| 发布 | 新建发布、发布记录、草稿箱 | `/publish` | **2026-09-15 整行移除** |

### 3.3 工具按钮（2026-09-14 移除）

原右侧工具区 4 个入口（移动端预览 / 客服支持 / 使用指南 / 通知）的能力均为占位说明文案（如"当前工作区尚未接入在线客服服务""暂无新通知"），已按产品要求整体移除：模块导航现只保留左侧标签区，避免为零能力入口提供视觉热区。

### 3.4 发布域快捷标签行移除（2026-09-15）

**背景**：发布域快捷标签行（「新建发布 / 发布记录 / 草稿箱」）在采集页等非发布页面同样渲染，与左侧边栏导航职责重复，且与当前页面内容无关联，造成界面噪音。用户要求整行移除。

**行为规格**：

- **移除范围**：发布域路由下（`module === 'publish'`，即除 `/` 与 `/accounts*` 外的全部 SPA 路由）不再渲染模块导航整行——无标签、无 70px 占位高度、无底部分隔线；主内容区上移，`NavBar` 直接衔接 `.mp-workspace`
- **保留范围**：主页域（`/`，显示「主页」标签）与账号域（`/accounts*`，显示账号四标签）不受影响
- **导航替代**：发布域页面的导航入口完全由左侧边栏承担——「发布」（`/publish`）、「草稿」（`/publish?tab=drafts`）、「采集」（`/collection`）等；发布记录（`/publish/history`）经发布页内「发布记录」入口或地址 hash 路由到达，e2e 已同步改为 hash 导航（`tests/e2e/publish-flow.test.js`）
- **实现方式**：`publishTabs` 数据删除；`tabs` 计算属性在发布域返回空数组；`<nav v-if="tabs.length > 0">` 空标签时整行不渲染；`isTabActive` 的发布域分支同步删除
- **无障碍**：随整行移除，`role="tablist"` 与 `role="tab"` 热区同步消失，不残留空 tab 语义节点
- **回归保护**：`MpModuleNav.test.js` 断言 `/publish`、`/publish/history`、`/publish?tab=drafts`、`/collection` 四条路由下 `[data-testid="mp-module-nav"]` 不存在且无任何 `role="tab"` 节点；主页/账号域用例保持不变

---

## 4. WebContentsView 定位

### 4.1 概述

主进程通过 `WebContentsView` 承载浏览器标签页（创作者中心页面）、登录视图（内嵌浏览器登录）和二维码扫码视图。所有 WebContentsView 必须定位在右侧主体区域，**不得遮挡左侧导航栏**。

### 4.2 定位参数

| 参数 | 值 | 说明 |
|------|-----|------|
| 默认侧边栏宽度 | 200px | 常量 `SIDEBAR_WIDTH_DEFAULT` |
| 窄屏侧边栏宽度 | 68px | 视口 ≤900px 时由渲染进程同步 |
| 顶部偏移 (浏览器标签) | 76px | TabBar(36px) + NavBar(40px) |
| 动态宽度 | 由渲染进程通过 IPC 实时同步 | `page-manager:set-sidebar-width` |

### 4.3 三个管理器定位

| 管理器 | 文件 | 定位方法 | X 偏移 | Y 偏移 |
|--------|------|---------|--------|--------|
| WebviewManager (浏览器标签) | `electron/services/webview-manager.js` | `_repositionAll()` | `sidebarWidth` | 76px |
| AuthViewManager (登录视图) | `electron/services/auth-view-manager.js` | `_positionView()` | `sidebarWidth` | 76px |
| QrCodeLogin (扫码登录) | `electron/services/qrcode-login.js` | `_positionView()` | `sidebarWidth` | 76px |

### 4.4 浏览器标签页定位

```javascript
// webview-manager.js _repositionAll()
activeView.setBounds({
  x: sidebarWidth,                                    // 左侧留出侧边栏宽度
  y: 76,                                              // 顶部留出 TabBar + NavBar
  width: bounds.width - sidebarWidth,                 // 宽度 = 窗口宽度 - 侧边栏宽度
  height: bounds.height - 76                          // 高度 = 窗口高度 - 顶部导航
})
```

### 4.5 登录视图定位

```javascript
// auth-view-manager.js _positionView()
this.currentView.setBounds({
  x: sidebarWidth,                                    // 左侧留出侧边栏宽度
  y: AUTH_VIEW_TOP,                                   // 76px
  width: Math.max(0, bounds.width - sidebarWidth),    // 防止负值
  height: Math.max(0, bounds.height - AUTH_VIEW_TOP)  // 防止负值
})
```

---

## 5. 标签页系统

### 5.1 概述

桌面应用采用浏览器式标签页系统，由 `TabBar` 组件和 `TabStore` (Pinia) 管理，与主进程 `WebviewManager` 通过 IPC 通信。

### 5.2 标签类型

| 类型 | 标识 | 说明 | WebContentsView |
|------|------|------|-----------------|
| 首页标签 | `isHome: true` | 默认标签，显示 Vue 路由内容（侧边栏 + 模块导航 + 工作区） | 无 |
| 浏览器标签 | `btab-*` | 创作者中心等外部网页 | 有，定位在右侧主体区域 |
| 虚拟登录标签 | `auth-login` | 平台账号登录页面 | 有，由 AuthViewManager 或 QrCodeLogin 管理 |

### 5.3 标签切换行为

- **切换到首页标签**：隐藏所有 WebContentsView，显示 Vue 路由内容（包括侧边栏、模块导航、工作区）
- **切换到浏览器标签**：隐藏其他 WebContentsView，显示目标标签视图，定位在右侧主体区域
- **切换到登录标签**：隐藏所有浏览器标签，显示登录视图，定位在右侧主体区域
- **关闭标签**：移除 WebContentsView，自动切换到剩余标签或首页

### 5.4 窗口大小变化

窗口 resize 事件触发所有视图重新定位：

```javascript
// window.js
mainWindow.on('resize', () => {
  authViewManager._onWindowResize()
  webviewManager.resize()
  qrCodeLogin._onWindowResize()
})
```

---

## 6. 数据校验

### 6.1 侧边栏宽度校验

| 校验项 | 规则 | 位置 |
|--------|------|------|
| 宽度范围 | 1 ≤ width ≤ 600px（0 视为非法，回落默认 200；见 2026-09-15 防御性收口） | `WebviewManager.setSidebarWidth()` 及各 manager 守卫（统一取自 `view-bounds.MIN_SIDEBAR_WIDTH` / `MAX_SIDEBAR_WIDTH`） |
| 类型校验 | `typeof width === 'number'` | `WebviewManager.setSidebarWidth()` |
| 无效值处理 | 日志警告，忽略更新 | `log.warn('WebviewManager', 'Invalid sidebar width ignored: ' + width)` |
| 重复值跳过 | 宽度未变化时跳过更新和重排 | `if (this._sidebarWidth !== width)` |

### 6.2 WebContentsView 边界校验

| 校验项 | 规则 | 位置 |
|--------|------|------|
| 主窗口存在 | 必须存在 `mainWindow` | `_repositionAll()` 开头 |
| 宽度非负 | `Math.max(0, bounds.width - sidebarWidth)` | `AuthViewManager._positionView()` |
| 高度非负 | `Math.max(0, bounds.height - AUTH_VIEW_TOP)` | `AuthViewManager._positionView()` |
| 视图存在 | `if (activeView)` 检查 | `_repositionAll()` |

### 6.3 IPC 安全校验

| 校验项 | 规则 | 位置 |
|--------|------|------|
| Sender 校验 | 所有 IPC handler 必须通过 `withSenderCheck` 包装 | `webview-manager.js` |
| 参数类型 | 宽度参数必须是 number 类型 | `page-manager:set-sidebar-width` handler |

---

## 7. 交互逻辑

### 7.1 账号管理中打开创作者中心

1. 用户在账号管理页面点击账号卡片（或点击"去登录"按钮）
2. 触发 `open-creator` 事件 → `openCreatorCenter(account)` 函数
3. 获取平台对应的创作者中心 URL（`PLATFORM_DASHBOARD_URLS[account.platform]`）
4. 如果平台不支持创作者中心，显示警告提示：`accountsPage.creatorUnsupported`
5. 调用 `tabStore.createTab({ url, platform, accountId, title })` 创建新浏览器标签
6. 主进程创建 `WebContentsView`，使用账号持久化 session 分区（`persist:account-{accountId}`）
7. 恢复已保存的 Cookie 和 localStorage（保持登录态）
8. 视图定位在右侧主体区域（`x: sidebarWidth, y: 76, width: windowWidth - sidebarWidth, height: windowHeight - 76`）
9. 侧边栏保持可见，不被遮挡

### 7.2 重新登录账号

1. 用户点击账号卡片的"重新登录"按钮
2. 触发 `relogin` 事件 → `reloginAccount(account)` 函数
3. 调用 `accountActions.openLogin('browser', account.platform)` 打开登录视图
4. 主进程创建登录 `WebContentsView`（`AuthViewManager`）
5. 视图定位在右侧主体区域（同创作者中心）
6. 登录完成后自动提取 Cookie/localStorage/IndexedDB 并保存
7. 登录视图关闭，恢复之前的标签

### 7.3 添加新账号

1. 用户点击"添加账号"按钮
2. 弹出 `AccountLoginDialog` 对话框
3. 选择平台和登录方式（浏览器登录 / 扫码登录）
4. 点击"打开登录页" → 创建登录视图或扫码视图
5. 视图定位在右侧主体区域
6. 登录完成后保存凭证

---

## 8. 显示项与提示文字

### 8.1 侧边栏

| 显示项 | 文字 | 说明 |
|--------|------|------|
| 品牌 Logo | 无文字（`<img>` 替代文本 `sidebar.brandLogoAlt` = Multi-Publish） | 2026-09-14 由 `MP` 文字徽标升级为正式 Logo（见 2.6） |
| 应用版本号 | `v` + `app:get-version` 返回值（如 `v0.1.0`） | 2026-09-14 新增；`title` = `sidebar.appVersionTitle`；版本号单一真相源见 [版本管理规范](./version-management.md) |
| 服务状态 | `sidebar.serviceStatus.allRunning`（服务运行中）/ `partialRunning`（{count}） / `unavailable` | 六服务聚合，hover 展示明细 |
| 用户 banner 主文案 | 显示名 / 未登录等状态文案 | 收起态唯一入口 |
| 用户 banner 状态点 | 无文字（`title` = 身份状态文案） | 合并原 footer「客户端状态」独立文字行 |
| 许可徽标 | `memberCenter.licenseFree` / `licenseTrial` / `licensePro` | 免费 / 试用 / 专业 |
| 设置（菜单项） | `nav.settings` | 任意身份状态均显示 |
| 升级 Pro（菜单项） | `memberCenter.upgradePro` | 非 Pro 用户显示（`⭐` 图标，版式与其它菜单项统一） |
| 更多菜单 | 更多 | 展开/收起次要导航项 |

> 已移除：`sidebar.clientStatusUnknown` 占位状态、独立升级胶囊按钮、主导航设置按钮。

### 8.2 账号管理

| 提示文字 | Key | 说明 |
|----------|-----|------|
| 不支持创作者中心 | `accountsPage.creatorUnsupported` | 该平台尚未支持创作者中心 |
| 创作者中心标签标题 | `accountsPage.creatorTabTitle` | 标签栏显示 "{platform}创作者中心" |
| 卡片悬停提示 | `accountsPage.creatorCardHint` | "点击卡片打开该账号的创作者中心" |
| 登录完成 | `accountsPage.saved` | 账号登录信息已保存 |
| 登录失败 | `accountsPage.saveFailed` | 账号登录信息保存失败 |

### 8.3 登录对话框

| 显示项 | Key | 说明 |
|--------|-----|------|
| 标题 | `accountsPage.addAccount` | 添加账号 |
| 平台选择 | `accountsPage.selectPlatform` | 选择平台 |
| 登录方式 | `accountsPage.loginMethod` | 登录方式 |
| 浏览器登录 | `accountsPage.browserLogin` | 浏览器登录 |
| 扫码登录 | `accountsPage.qrLogin` | 扫码登录 |
| 取消 | `accountsPage.cancel` | 取消 |
| 打开登录页 | `accountsPage.openLoginPage` | 打开登录页 |
| 扫码不可用 | `accountsPage.qrUnavailable` | 当前平台不支持扫码登录 |

---

## 9. 视觉规范

### 9.1 设计 Token

| Token | 值 | 用途 |
|-------|-----|------|
| `--mp-sidebar-width` | 200px | 侧边栏宽度 |
| `--mp-nav-height` | 70px | 模块导航高度 |
| `--mp-primary` | #5048e5 | 主色调 |
| `--mp-muted` | #8b8e9a | 次要文字色 |
| `--mp-nav-border` | #e8eaf2 | 导航边框色 |

### 9.2 响应式断点

| 断点 | 侧边栏宽度 | 行为 |
|------|-----------|------|
| > 900px | 200px | 完整显示：品牌 + 导航文字 + 服务连接信息 + 完整用户 banner |
| ≤ 900px | 68px | 仅显示图标：隐藏品牌/标题/`+`/导航文字/服务连接信息；用户 banner **只保留头像**（登录、设置、升级入口仍可达） |
| ≤ 700px | 68px | 模块导航标签横向滚动（右上角工具按钮已于 2026-09-14 移除） |

---

## 10. 错误处理

### 10.1 侧边栏宽度同步失败

- **现象**：`invokePageManager` 返回 `undefined`（API 不可用）
- **影响**：主进程使用默认宽度 200px，与 CSS 默认值一致，布局不受影响
- **降级**：默认值 200px 保证基本布局正确

### 10.2 WebContentsView 定位失败

- **现象**：`mainWindow` 为 null 或视图不存在
- **处理**：`_repositionAll()` 开头检查 `if (!this.mainWindow) return`，静默跳过
- **影响**：视图保持上次定位或默认位置，不会崩溃

### 10.3 无效侧边栏宽度

- **现象**：渲染进程传入非数字、负数或超过 600px 的值
- **处理**：日志警告 `Invalid sidebar width ignored`，保持当前宽度不变
- **影响**：避免异常宽度导致视图定位错误

---

## 11. 相关文件

| 文件 | 职责 |
|------|------|
| `apps/desktop/src/App.vue` | 根组件，定义整体布局框架 |
| `apps/desktop/src/layouts/MpSidebar.vue` | 左侧导航栏组件（含底部服务连接信息 + 用户 banner） |
| `apps/desktop/src/components/ProfileMenu.vue` | 底部用户 banner / 向上展开菜单（账号操作 + 设置 + 升级 Pro） |
| `apps/desktop/src/components/SidebarServiceStatus.vue` | 服务连接信息聚合 + 六服务明细 |
| `apps/desktop/src/layouts/MpModuleNav.vue` | 模块导航栏组件（工具区与发布域标签行已移除） |
| `apps/desktop/src/components/TabBar.vue` | 浏览器式标签栏 |
| `apps/desktop/src/components/NavBar.vue` | 导航/URL 栏 |
| `apps/desktop/src/stores/tab.js` | 标签页状态管理 (Pinia) |
| `apps/desktop/src/api/electron-bridge.js` | IPC 桥接层 |
| `apps/desktop/src/styles/cohere-design-system.css` | 设计 Token 定义 |
| `apps/desktop/electron/services/webview-manager.js` | WebContentsView 标签管理（浏览器标签 + 虚拟登录标签） |
| `apps/desktop/electron/services/auth-view-manager.js` | 内嵌浏览器登录管理器 |
| `apps/desktop/electron/services/qrcode-login.js` | 二维码扫码登录管理器 |
| `apps/desktop/electron/preload/page-manager.js` | Preload API 定义 |
| `apps/desktop/electron/window.js` | 窗口创建与事件绑定 |
| `apps/desktop/src/features/accounts/components/AccountManagementCard.vue` | 账号卡片组件 |
| `apps/desktop/src/views/Accounts.vue` | 账号管理页面 |

---

## 12. 变更历史

| 日期 | 版本 | 变更内容 | 关联提交 |
|------|------|---------|---------|
| 2026-09-01 | v1.0 | 初始版本：WebContentsView 定位偏移侧边栏宽度 | `959d65cff` |
| 2026-09-03 | v1.1 | 补充完整 UI 布局规格文档 | 本文档 |
| 2026-09-05 | v1.2 | 修复流水线详情页底部操作条与内容区重叠： 从  改为正常流 ，新增  可滚动内容区 | #1405 |
| 2026-09-14 | v1.3 | 新增「回到顶部」浮标（BackToTop）完整规格（第 14 章）：挂载与定位 / 显隐与滚动容器 / 数据校验 / 交互逻辑 / 显示项与提示文字 / 视觉规范 / 层级协调 | 分支 `back-to-top-button` |
| 2026-09-14 | v1.4 | 侧边栏底部用户 banner（§2.5）：登录区由顶部迁移到底部并改为向上展开菜单、「设置」与「⭐ 升级 Pro」迁入菜单、服务连接信息上移至 banner 上方；移除模块导航右上角 4 个占位工具入口（§3.3）；同步 §2.3 / §8.1 / §9.2 / §11 | 分支 `codex/sidebar-footer-user-menu` |
| 2026-09-15 | v1.5 | 移除发布域快捷标签行（§3.4、§3.2）：发布域路由下模块导航整行不渲染，导航职责归左侧边栏；同步 §2 / §3.1 / §11 | 分支 `codex/remove-publish-quicknav` |
| 2026-09-20 | v1.6 | 新增 §15 CreateView 列宽与页签合同（`.create-page` 必须显式 `width: 100%`、flex 交叉轴 auto margin 陷阱、`.view-tabs` 等分、`.back-btn` 不通栏、详情页卡片统一、`.action-bar` 分区）；§1.2 补 `BUGFIX-CREATE-PAGE-WIDTH` 同源引用 | 分支 `codex/ui-story2video-detail-polish` |

## 13. 已知问题修复

### 13.1 左侧菜单随内容滚动（2026-09-03 修复）

**根因**：`.app-root` 缺少 `height: 100%`，导致 CSS 百分比高度链断裂。

**影响**：`.mp-shell` 的 `height: 100%` 无法解析为视口高度，退化为 `auto`（由内容撑开），整个页面随工作区内容滚动，侧边栏随之移动。

**修复**：
- `.app-root` 添加 `height: 100%; display: flex; flex-direction: column;`
- `.mp-shell` 改为 `flex: 1; min-height: 0;`
- `.fullscreen-main` 改为 `flex: 1; min-height: 0;`
- `html, body` 添加 `overflow: hidden;`
- `.mp-sidebar` 添加 `flex-shrink: 0; overflow-y: auto;`

**关联 PR**：[#1371](https://github.com/Colinchiu007/Multi-Publish/pull/1371)

---

## 14. 回到顶部浮标（BackToTop，2026-09-14 新增）

### 14.1 概述

桌面端长内容页面（列表页 / 详情页 / 设置页）缺少「一键回到顶部」入口。本章定义全局浮标的挂载位置、显隐规则、数据校验、交互逻辑、显示项与视觉规范。

**唯一实现**：`apps/desktop/src/components/BackToTop.vue`，在 `App.vue` 全局挂载一个实例，**不在各视图内单独引入**（见 [前端交互规范](./frontend-interaction-spec.md) §2 交互原语唯一实现清单）。完整需求说明见 `01-docs/PRD-BACK-TO-TOP-BUTTON-2026-09-14.md`。

### 14.2 挂载与定位

| 项 | 值 | 说明 |
|----|----|------|
| 挂载点 | `App.vue` 的 `v-else` 分支内（`</div>` 收纳 `.mp-shell` 之后） | 与 `UpdateNotification` / `PipelineBackgroundToast` 同级，均为全局浮层 |
| 渲染方式 | `<Teleport to="body">` + `<Transition>` | 脱离内容容器层叠上下文，避免被 `overflow: auto` 裁剪 |
| 定位 | `position: fixed` | 相对视口，不随滚动移动 |
| 右偏移 | `var(--spacing-6)` = 24px | — |
| 下偏移 | `var(--spacing-6)` = 24px | — |
| 尺寸 | 44 × 44 px | — |

### 14.3 显隐规则与滚动容器

**显隐条件**（唯一条件，无页面白名单）：

```
可见  ⇔  最后一个产生滚动的容器.scrollTop > threshold（默认 320px）
```

由于内容不足一屏时 `scrollTop` 恒为 0，该条件自动实现「只有内容超出一屏的页面才出现浮标」，新增页面无需任何额外改动即可获得该能力。

**滚动容器层级**：

| 层级 | 容器 | 监听方式 |
|------|------|---------|
| 主容器 | `.mp-workspace`（`overflow: auto`，App.vue 内联样式 / cohere-design-system.css `.cohere-main`） | 组件挂载时 `querySelector('[data-testid="mp-workspace"]')`，以**捕获阶段**（`addEventListener('scroll', fn, true)`）监听 |
| 嵌套容器 | 视图内自带的 `overflow: auto` 区块（如 `PublishHistory.vue`、`ModelProviders.vue`、`ResultView.vue`、`ContactSheetView.vue`） | 由主容器的捕获阶段监听自动覆盖，无需逐视图声明 |

> 设计要点：`scroll` 事件不冒泡，只有在**捕获阶段**监听祖先才能拿到后代滚动容器的滚动。因此不需要为每个嵌套容器单独注册监听，也不会遗漏视图内滚动区。

**排除场景**：

| 场景 | 排除机制 |
|------|---------|
| `/first-run` 全屏引导 | 挂载点在 `v-else` 分支，该路由走 `isFullScreenRoute` 独立分支，组件不渲染 |
| 登录标签页 | 该分支下 `router-view` 不渲染（`v-if="!isLoginTab"`），滚动容器无内容，`scrollTop` 恒为 0 |

### 14.4 数据校验

| 校验项 | 规则 | 位置 | 失败处理 |
|--------|------|------|---------|
| `threshold` 类型 | `Number`，默认 `320` | props 定义 | 非数值时比较恒为 false，浮标不显示（fail-safe） |
| `containerSelector` 命中 | 必须能被 `document.querySelector` 命中 | `onMounted` | `console.warn` + 不注册监听，浮标保持隐藏，不抛异常 |
| 滚动事件目标 | `event.target` 存在且 `typeof target.scrollTop === 'number'` | `onScroll` | 直接 return，忽略该次事件 |
| 阈值比较符 | 严格 `>`（等于阈值不触发） | `onScroll` | 避免边界抖动 |
| 回滚目标有效性 | `activeScroller.isConnected === true` | `resolveScroller` | 回退主容器；主容器不可用则不动作 |
| 平滑滚动能力 | `try { el.scrollTo({top, behavior}) }` | `handleClick` | 捕获异常后降级为 `el.scrollTop = 0` |
| 重复点击 | 600ms 时间锁 | `handleClick` | 锁定期内 return，一次滚动只触发一次 |

**数据依赖声明**：本组件**不读写任何持久化数据**（无 SQLite / localStorage / IPC），唯一状态是内存中的 `visible` 与滚动位置，无数据迁移与并发写入风险。

### 14.5 交互逻辑

1. 用户滚动内容区 → 主容器以捕获阶段收到 `scroll` 事件（含嵌套子容器发出的事件）
2. 解析 `event.target.scrollTop`：`> 320px` 则记录该容器为回滚目标并显示浮标；同一容器回落至阈值以内则隐藏
3. 用户点击浮标：
   1. 检查 600ms 点击锁，已锁定则忽略
   2. `resolveScroller()` 选定回滚目标（最后滚动容器 → 主容器）
   3. 系统开启「减少动态效果」→ `behavior: 'auto'`（瞬时）；否则 `behavior: 'smooth'`（平滑）
   4. 平滑滚动使 `scrollTop` 递减至 0，`onScroll` 自然将浮标收起（**不强制在点击时隐藏**，避免滚动被中断时出现「按钮已消失但未回到顶部」的状态不一致）
4. 路由切换（`route.fullPath` 变化）→ 强制隐藏浮标、清空回滚目标、解除点击锁（新页面默认停在顶部）

### 14.6 显示项与提示文字

| 显示项 | 内容 | 位置 | 备注 |
|--------|------|------|------|
| 图标 | 20×20 向上箭头，内联 SVG，`stroke-width: 2`，圆头圆角连接，`currentColor` | 按钮中心 | 零新依赖；与 `CreateView.vue` 等既有内联 SVG 图标写法一致 |
| 文字提示 | 「回到顶部」 | 按钮**左侧**垂直居中 | 深色圆角气泡 + 指向按钮的右侧小三角 |

| 提示文字 | Key | zh | en |
|----------|-----|----|----|
| 回到顶部 | `common.backToTop` | 回到顶部 | Back to top |

**提示展示条件**：

| 条件 | 是否显示提示 |
|------|-------------|
| 鼠标悬浮 | ✅ |
| 键盘聚焦（`:focus-visible`） | ✅（保证键盘用户与鼠标用户信息等价） |
| 鼠标点击（`focus` 但非 `focus-visible`） | ❌ 避免点击后提示滞留 |
| 浮标隐藏 | ❌ 元素已移出 DOM |

**缺 key 兜底**：`t()` 返回 key 原文时判定为未翻译 → 气泡文案回退空串（不渲染气泡），`aria-label` 回退英文常量 `Back to top`，保证读屏用户不会遇到无名按钮。此策略与 `PipelineBackgroundToast.vue` 一致。

### 14.7 视觉规范

**几何**

| 项 | 值 |
|----|----|
| 按钮尺寸 | 44 × 44 px |
| 圆角 | `var(--radius-lg)` = 16px（圆角阶梯 4/8/12/16/999 内取值） |
| 图标 | 20 × 20 px，`stroke-width: 2` |
| 气泡 | 内边距 6px 10px，圆角 `var(--radius-sm)` = 8px，与按钮间距 10px，右侧 4px 三角 |
| 焦点描边 | 2px `var(--color-primary)`，`outline-offset: 2px` |

**颜色**（新增语义 token，定义于 `styles/tokens.css`，亮/暗双模式）

| 语义 | Token | 亮色 | 暗色 |
|------|-------|------|------|
| 浮标底色 | `--color-float-surface` | `#ececef` | `#2c2c34` |
| 浮标底色（悬浮） | `--color-float-surface-hover` | `#e0e0e5` | `#383842` |
| 浮标底色（按下） | `--color-float-surface-active` | `#d4d4dc` | `#44444f` |
| 图标色 | `--color-float-icon` | `#707080` | `#a0a0b0` |
| 图标色（悬浮） | `--color-float-icon-hover` | `#1e1b4b` | `#f0f0f5` |
| 气泡底色 | `--color-float-tooltip-bg` | `#303038` | `#4a4a55` |
| 气泡文字 | `--color-float-tooltip-text` | `#ffffff` | `#ffffff` |
| 阴影 | `--shadow-float` | `0 2px 8px rgba(30,27,75,.08)` | `0 2px 10px rgba(0,0,0,.45)` |

暗色模式遵循 `frontend-interaction-spec.md` §1「主色/文字不降级为低对比灰」：浮标表面保持比页面卡片（`--color-bg-card` `#232329`）更亮一档，图标用亮色而非低对比灰。

**状态视觉对照**

| 状态 | 底色 | 图标 | 其他 |
|------|------|------|------|
| 常态 | `--color-float-surface` | `--color-float-icon` | 阴影 `--shadow-float` |
| 悬浮 | `--color-float-surface-hover` | `--color-float-icon-hover` | 左侧提示淡入（140ms） |
| 按下 | `--color-float-surface-active` | `--color-float-icon-hover` | `scale(0.94)` |
| 焦点 | 常态底色 | 常态图标 | 2px 主色描边 + 提示显示 |
| 进入/离开 | — | — | 180ms 透明度 + `translateY(8px)` 自右下方浮起/沉下 |

### 14.8 层级与浮层协调

| 浮层 | z-index | 关系 |
|------|---------|------|
| `PipelineBackgroundToast` | 2100 | 屏幕居中，与右下角浮标无空间冲突 |
| `UpdateNotification` toast（2026-09-14 起仅结果提示，更新模态框已下线） | 2000 | **高于浮标**：提示条与模态弹窗打开时应占据最高焦点，浮标被覆盖符合语义 |
| **`BackToTop`** | **1900** | 低于模态层，高于所有普通页面内容 |

**侧边栏「新版本」入口（2026-09-14 新增，见 [PRD-SIDEBAR-UPDATE-ENTRY-2026-09-14.md](../01-docs/PRD-SIDEBAR-UPDATE-ENTRY-2026-09-14.md)）**：位于侧边栏 footer 内、登录菜单按钮**正上方**（footer 顺序 `[0] 服务连接信息 → [1]「新版本」入口（仅在检测到新版本时渲染）→ [2] 登录 banner`），属导航壳内元素，不参与右下角浮标坐标系；配色为设计主色 `var(--primary)`，窄屏（≤900px）仅显示图标。

**与右下角 `UpdateNotification` toast 的位置协调**：该提示条原为 `bottom: 16px; right: 16px`，与浮标（`bottom: 24px; right: 24px`，占 44×44）在水平 24–68px、垂直 24–60px 区间重叠。处置：提示条 `right` 由 `16px` 调整为 `88px`（保持贴底）。调整后提示条右边缘距窗口 88px > 浮标左边缘距窗口 68px，完全消除重叠；代价是提示条视觉内缩 72px，因其出现频率低（仅更新检查完成/失败）而可接受。

### 14.9 错误处理

| 异常 | 处理 | 影响 |
|------|------|------|
| 滚动容器未找到 | `console.warn`，不注册监听 | 浮标不出现，其余功能不受影响 |
| 不支持 `scrollTo(options)` | 捕获异常，降级 `el.scrollTop = 0` | 平滑滚动退化为瞬时跳转 |
| `scrollTop` 非数值 | `onScroll` 提前 return | 该次滚动不改变显隐 |
| 回滚目标脱离 DOM | `resolveScroller` 回退主容器 | 仍能正常回滚 |
| i18n key 缺失 | 气泡回退空串 + `aria-label` 回退英文常量 | 浮标仍可用且可被读屏识别 |
| 平滑滚动中路由切换 | 路由 `watch` 强制隐藏并解锁 | 浮标收起，无残留状态 |

### 14.10 相关文件

| 文件 | 职责 |
|------|------|
| `apps/desktop/src/components/BackToTop.vue` | 浮标组件（唯一实现） |
| `apps/desktop/src/components/BackToTop.test.js` | 单元测试（12 项） |
| `apps/desktop/src/App.vue` | 全局挂载点（`v-else` 分支） |
| `apps/desktop/src/styles/tokens.css` | 新增 `--color-float-*` / `--shadow-float` 语义 token |
| `apps/desktop/src/locales/zh.js` / `en.js` | `common.backToTop` 文案（成对） |
| `apps/desktop/src/components/UpdateNotification.vue` | 右下角 toast 右偏移 16px → 88px（避让浮标） |
| `01-docs/PRD-BACK-TO-TOP-BUTTON-2026-09-14.md` | 功能 PRD |

### 14.11 测试覆盖

`apps/desktop/src/components/BackToTop.test.js`（12 项，全部通过）：初始不渲染 / 显隐基本流 / 阈值边界（等于不触发）/ 自定义阈值 / 点击回滚参数 / 减少动效降级 / 嵌套滚动容器 / 防重复点击 / 中英双语文案与 `aria-label` / 路由切换重置 / 容器缺失异常路径 / 卸载清理。

其中「阈值边界」「防重复点击」「卸载清理」三项为最易被后续重构破坏的行为契约，作为回归保护重点。

---

## 15. CreateView 列宽与页签合同（2026-09-20 新增）

### 15.1 适用对象

`apps/desktop/src/views/CreateView.vue` + `apps/desktop/src/styles/create-view.css`，覆盖视频创作页的四个视图（流水线列表 / 流水线详情 / 任务编辑 / 历史记录）。

### 15.2 列宽合同（必修项）

| 选择器 | 必需声明 | 缺失后果 |
|--------|---------|---------|
| `.create-page` | `width: 100%` + `max-width: 1080px` + `margin: 0 auto` | 父 `.cohere-main` 是 flex column，**交叉轴上的 `margin: 0 auto` 会抑制 `align-self: stretch`**，宽度退化为 `fit-content(max-content)` → 实际列宽由「最宽子元素」决定（实测约 500px），右侧大片死白 |
| `.create-page--pipeline-detail` | `min-width: 0` | 子项溢出会把 1080px 列撑破 |
| `.create-page--pipeline-list` | `max-width: 1600px`（宽屏可 `calc(100% - 64px)`） | 列表页刻意放宽，**不适用 1080px 合同** |
| 全局 | `box-sizing` 不重复声明 | `cohere-design-system.css` 已提供 `*,*::before,*::after` reset；重复声明曾导致内边距双算 |

同类缺陷已出现两次（`RewriteView` 的 `BUGFIX-REWRITE-PAGE-WIDTH` 2026-09-16、本次 `BUGFIX-CREATE-PAGE-WIDTH` 2026-09-20）。**任何新增页面级容器若同时用了 `max-width` 与 `margin: 0 auto`，必须显式 `width: 100%`。**

### 15.3 页签与返回按钮

- `.view-tabs`：`display: flex` + `width: 100%`，子项 `.view-tab { flex: 1 1 0; min-width: 0; text-align: center }`。页签数可变（当前 3），**禁止硬编码栅格列数**（`repeat(4, …)` 在 3 页签下必留 1/4 空灰）。
- `.view-tab.active`：白底 + `box-shadow` + `font-weight: 600` + 底部指示条；**禁用 `transform: scale()`**（重排抖动 + 与指示条打架）。
- `.back-btn`：`align-self: flex-start`。否则在 `flex-direction: column` 的 `.pipeline-detail` 中被 `align-items: stretch` 拉成通栏灰条（实测整列宽 → 71px）。
- 详情页态隐藏顶部 `nav-arrow`（`.create-page--pipeline-detail .page-header-nav { display: none }`），返回入口唯一。

### 15.4 表面处理统一

详情页的 `.detail-header`、`.input-section`、`.s2v-config-section` 三块必须**同规格卡片表面**：`background: var(--color-bg-card)` + `1px solid var(--color-border)` + `border-radius: 12px` + `padding: var(--spacing-5)`。“头部是卡片、输入区是裸 `<h3>`”的混用是「散乱」感的主要来源。

子标题用 `.s2v-card-title`（`--font-size-md` + 暗色感知文字色），字段网格用 `.s2v-field-grid`（`repeat(auto-fit, minmax(280px, 1fr))`）。

### 15.5 操作条分区

`.action-bar`：`gap: var(--spacing-3)`；主/次操作靠左，配置管理操作靠右（`margin-left: auto` 分组）。**不可回退**：§2.1.6（PRD）定义的「正常流底部 + 内层独立滚动」合同——`.action-bar` 必须在 `.pipeline-detail-scroll` 之外，详情页整页不得出现外层滚动条。

### 15.6 窄屏

`@media (max-width: 720px)`：`.action-bar > div` 与 `.action-bar .btn-start` 整行宽；`.view-tab { flex: 1 0 auto }`（横向滚动优先于等分压缩，避免文案被挤截）。选择器必须带 `.action-bar` 限定抬到 (0,2,0)，不因样式表引入顺序而飘移。
