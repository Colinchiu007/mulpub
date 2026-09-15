# 前端 UI/UX 优化方案（Multi-Publish Desktop）

> 文档类型：技术方案 / 优化计划
> 适用代码：`apps/desktop/src/**`（Electron 渲染端），附带 `ops-center/frontend` 参考建议
> 编写日期：2026-09-13
> 关联分支：`codex/frontend-skeleton-unification`（本轮已落地骨架屏基础设施）
> 状态：P0 骨架屏体系 = 已实现并测试；P1/P2 = 待排期

---

## 0. 摘要（结论先行）

本次对桌面端 155 个 `.vue`、14 个全局样式文件、30 条路由做了全量扫描，得到四条**可量化**的结构性结论：

| # | 结论 | 关键证据（数量） |
|---|------|------------------|
| 1 | **加载态没有统一实现**：全仓没有通用骨架屏组件；只有 3 个页面各写了一套骨架，30+ 处加载中用的是"spinner + 文字 / 纯文字 / 字符 / 空白" | 骨架实现 3 处（样式 6 个维度全部不一致）、骨架死代码 3 处、非骨架加载点 30+ |
| 2 | **设计令牌四套并存**：`tokens.css / cohere-design-system.css / apple-design-tokens.css / video-creation-tokens.css` 同时定义 `:root`，间距/字号/圆角各有一套命名族 | 4 处 `:root`；间距 3 族（`--spacing-*` / `--space-*` / `--apple-space-*`）；裸 `font-size: Npx` 出现于 99+ 文件、裸 `border-radius: Npx` 出现于 87+ 文件 |
| 3 | **基础组件覆盖不足，页面各自造轮子**：弹窗 7 种实现、空态 1 个共享组件 + 21 处页面内自造、缺 Card/Tag/Table/Pagination 等通用件 | 弹窗 7 种；空态自造 21 处，图标尺寸 5 种、颜色 10 种 |
| 4 | **三态与错误处理不齐**：加载/空/错误三态覆盖不完整的页面占多数；至少 15 处 API 调用没有用户可见的错误提示 | 三态缺 1 项及以上 ≈ 17 个视图；错误处理缺口 15 处（视图 11 + composable 4） |

另外确认一项**正面结论**：渲染端 `v-html` 使用为 **0 处**、生产代码 `console.log` 为 **0 处**，XSS 与日志污染两个常见风险面目前是干净的，优化时应守住这两条底线。

同时发现三个**独立缺陷**（已在本轮修复）：

- `components/PipelineBrowser.vue` 有一条 `.pipeline-card:focus-visible` 规则被写在样式块结束标签之后，从未生效（键盘可达性缺陷）。
- `@keyframes skeleton-shimmer` 存在 4 份重名定义（`ModelProviders.vue` / `PipelineBrowser.vue` / `create-view.css` / `history-page.css`），而 `@keyframes` 不受 `scoped` 隔离影响，后加载者会覆盖全局，属于跨文件动画串台隐患。
- **测试环境语言不确定（隐性 flakiness）**：`resolveAppLocale()` 在 `@/i18n` 模块**首次被 import 时**即按 `navigator.language` 固定 locale，而 `test-setup.js` 里把语言钉成 `zh-CN` 的代码位于函数体、**晚于该文件自身被提升的 import 执行**。因此只要有组件链在 `test-setup.js` 顶部 import 了 `@/i18n`，整个测试进程的默认语言就从 `zh` 漂移成 `en`，所有依赖中文文案的断言（如 `PipelineSelector.test.js`）随机失败。本轮新增 `test-setup-locale.js` 并置于 `setupFiles` 首位，使 locale 解析与"谁先 import"彻底解耦。

---

## 1. 现状诊断（带证据）

### 1.1 加载态：六类实现并存，视觉上互不相干

**A. 三个"真骨架"页面，样式六维全部不一致**

| 维度 | `views/ProjectLibrary.vue` | `styles/pipeline-selector.css` | `views/ModelProviders.vue` |
|------|---------------------------|-------------------------------|---------------------------|
| 底色/渐变 | 硬编码 `linear-gradient(#f0f0f0 25%, #e0e0e0 50%, #f0f0f0 75%)`（原 :119） | `var(--skeleton-bg)` 静态色块 | `var(--hairline)/var(--soft-stone)` 渐变 |
| 动画 | `background-position` 位移 | **无动画（静态灰块）** | `background-position` 位移 |
| keyframes 名 | `shimmer` | — | `skeleton-shimmer` |
| 时长/缓动 | 1.5s / 默认 ease | — | 1.5s / 默认 ease |
| 圆角 | 12px / 4px | 12px / 4px | 4px |
| 暗色覆盖 | ❌ 无（暗色下仍是浅灰） | 依赖令牌 | ✅ 有 `[data-theme="dark"]` |
| 栅格列宽 | `minmax(240px,1fr)` | `minmax(280px,1fr)` | 复用 provider-grid |

**B. 三处骨架是死代码**（定义了 CSS、模板从未引用）：

- `components/PipelineBrowser.vue` 原 :150-152
- `styles/create-view.css` 原 :422-427
- `styles/history-page.css` 原 :408-425

**C. 其余 30+ 个加载点各自为政**，可归为 6 类：

1. spinner + 文字：`PipelineBrowser`（加载流水线列表...）、`ReplayTimeline`（加载回放数据...）、`ContactSheetView`（加载场景...）、`ProductionBoard`（加载看板...）、`CreateHistory`、`CreateViewHistory`、`ApprovalGateModal`
2. 纯文字：`ResultView`、`Accounts`、`PublishHistory`、`Publish`、`CloudPublish`、`TrendingPanel`、`KeywordMonitorPanel`、`BenchmarkChart`、`PersonalKnowledgePanel`、`ViralLibraryTable`、`TemplatePicker`、`OptimalTimeTip`、`TitleAssistantPanel`、`TagSuggester`、`LogsSettings`、`ConfigProfileManager`、`CreateView`（4 处）、`ViralAnalysis`
3. 字符图标：`NavBar`（`⟳`）、`TabBar`（`⟳`）
4. 按钮内 spinner：`UiButton`、`VideoCloneView`、`FilmEngineeringView` 等
5. Element Plus `v-loading` 遮罩：`PerformanceInsights`、`FilmEngineeringView`、`PatternAnalysisPanel`
6. **完全没有加载态**：`Dashboard`、`PromptEvalView`、`KnowledgeBasePage`、`Comments`、`Intelligence`、`Home`、`Monitor`、`RewriteView`、`KeywordMonitorView`；`Calendar` 有 `loading` ref 但模板无加载分支

> 用户感知问题：同一个应用里，切页面时有时是灰块闪动、有时是一行"加载中..."、有时是转圈、有时直接空白几百毫秒。**加载体验是"每页一套"，而不是"一个应用一套"**。

### 1.2 设计令牌：4 套 `:root`、3 套命名族

| 文件 | `:root` 位置 | 覆盖内容 | 骨架令牌 |
|------|-------------|---------|---------|
| `styles/tokens.css` | :12（暗色 :70） | 颜色、字号 7 档、圆角 7 档、间距 8 档 | 无 |
| `styles/cohere-design-system.css` | :29（暗色 :1512） | 颜色、间距、圆角、布局宽度 | 无 |
| `styles/video-creation-tokens.css` | :7（暗色 :137） | 流水线/状态语义色 | 曾有 `--skeleton-bg/--skeleton-shimmer` |
| `styles/apple-design-tokens.css` | :7（**无暗色覆盖**） | 颜色、字号、间距、圆角、阴影、动效 | 无 |

- `tokens.css` 自称"桌面端设计 token 唯一来源"，但实际与另外 3 套并存。
- **命名族重复**：间距 `--spacing-*`(2 文件用) / `--space-*`(25 文件用) / `--apple-space-*`(5 文件用)；圆角 `--radius-*`(2) / `--r-*`(6) / `--apple-radius-*`(6)。
- **裸值占绝对主导**：`font-size: Npx` 命中 99+ 文件、`border-radius: Npx` 命中 87+ 文件。TOP：`ModelProviders.vue`（62 次 font-size / 27 次 radius）、`create-view.css`（57 次 radius）、`ViralAnalysis.vue`（34 次 font-size）。
- **硬编码 hex 重度文件 TOP**：`video-creation-tokens.css`(150)、`ModelProviders.vue`(135)、`cohere-design-system.css`(86)、`Accounts.vue`(69)、`PublishHistory.vue`(69)、`create-view.css`(67)、`history-panel.css`(64)。`HotTopics.css` 甚至自造了 `#5149e8`——与主色 `--color-primary: #5048E5` 肉眼几乎相同却各写一份。

### 1.3 基础组件：覆盖不足 + 重复实现

**已有**：`UiButton` / `UiInput` / `UiSelect` / `UiModal` / `EmptyState` / `LoadingState` / `RouteLoadError`（`LoadingState` 全局注册但**全仓 0 处使用**）。

**弹窗 7 种实现，交互能力参差**：

| # | 实现 | Teleport | ESC 关闭 | 遮罩 | 动画 | z-index |
|---|------|---------|---------|------|------|---------|
| 1 | `UiModal.vue` | ✅ | ✅（默认关闭） | `rgba(0,0,0,.3)` + blur | ✅ | 2000 |
| 2 | `.cohere-modal`（cohere-design-system.css） | — | ❌ | — | ❌ | — |
| 3 | `UpgradeModal.vue` | ❌ | ❌ | 仅 `@click.self` | ❌ | — |
| 4 | `PublishDestinationModal.vue` | ✅ | ❌ | `@click.self` | ❌ | — |
| 5 | `ViralFormDialog.vue` / `PersonalFormDialog.vue`（CSS 完全重复） | ❌ | ❌ | `rgba(0,0,0,.4)` | ❌ | 1000 |
| 6 | `video-creation/ErrorDialog.vue` | ❌ | ❌ | `rgba(0,0,0,.5)` | fadeIn/slideIn | 1000 |
| 7 | `<el-dialog>`（4 个文件 8 处） | — | EP 内置 | — | — | — |

**空态**：`EmptyState.vue` 是唯一共享件（用 `tokens.css` 体系），另有 **21 处页面内自造**，类名/尺寸/颜色全不相同（图标尺寸出现 24/38/40/48/56px 五种；颜色出现 `#85858f`/`#b3b4bc`/`#696a73`/`#888`/`#999`/`#555`/`#909399`/`#8a8f98`/`#c9cbd8`/`#b1b2bd` 等 10 种）。

**缺失通用件**：`Card` / `Tag` / `Table` / `Pagination` / `Toast` / `Tabs`（半通用 `TabBar` 存在但含 13 处硬编码色）。

**按钮复用率低**：手写 `class="...btn..."` 出现在 26 个视图中，量最大 `CreateView.vue`(40)、`ModelProviders.vue`(25)、`Collection.vue`(20)、`HotTopics.vue`(17)。

### 1.4 主题切换：实现存在、入口为 0

`composables/useTheme.js` 完整实现（electron store 持久化 + 跟随系统 + `document.documentElement.setAttribute('data-theme', val)`），但**全仓唯一调用者是它自己的测试**——没有任何设置入口调用它。因此：

- 8 个文件写了 `[data-theme="dark"]` 覆盖（`tokens.css`、`cohere-design-system.css`、`video-creation-tokens.css`、`video-creation-buttons.css`、`create-view.css`、`ModelProviders.vue`、`AnnouncementBanner.vue`、`useTheme.js`），**这些暗色分支永远不会被激活**。
- `apple-design-tokens.css` 只有 `:root`、**没有暗色覆盖**，而 `UiButton` / `UiModal` / `UiInput` / `UiSelect` / `history-page.css` 都消费 `--apple-*` → 即使将来打开暗色，这些基础组件也不跟随。

### 1.5 三态（loading / empty / error）覆盖矩阵

按视图逐个核对模板是否有可见的加载态、错误态、空态渲染：

| 视图 | loading | error | empty | 备注 |
|------|:-------:|:-----:|:-----:|------|
| `Home.vue` | ❌ | ❌ | ✅ | `handleBatchLogin`(:204) 无 catch |
| `Comments.vue` | ❌ | ❌ | ✅ | `loadPlatforms` catch 是 `/* ignore */`(:76) |
| `Publish.vue` | ✅ | 部分 | ✅ | |
| `PublishHistory.vue` | ✅ | ✅ | — | |
| `Accounts.vue` | ✅ | 部分 | ✅ | |
| `Dashboard.vue` | ✅ | ✅ | ✅ | 用了 `ElMessage` 而非 `useNotify` |
| `Collection.vue` | ✅ | ✅ | ✅ | |
| `Monitor.vue` | ❌ | ❌ | ✅ | `webviewListTabs`(:149)/`setLayout`(:159)/`closeAll`(:192) 无 catch |
| `ViralAnalysis.vue` | ✅ | ✅ | ✅ | |
| `ModelProviders.vue` | ✅ | 部分 | — | `ElMessage.warning`(:695,:722) |
| `CreateView.vue` | ✅ | ✅ | ✅ | |
| `MemberCenter.vue` | ✅ | ✅ | ✅ | |
| `ResultView.vue` | ✅（纯文字） | 部分 | ✅ | |
| `CloudPublish.vue` | ✅ | 部分 | ✅ | 两处 catch 只 `reportError`（:173/:235），用户不可见 |
| `Intelligence.vue` | ✅ | ❌ | ✅ | catch 只 `reportError`(:198) |
| `Calendar.vue` | 脚本有 ref | ❌ | ✅ | 模板无 loading 分支 |
| `ProjectLibrary.vue` | ✅ | ✅ | ✅ | |
| `ProductionBoard.vue` | ✅（spinner） | ❌ | ✅ | |
| `ContactSheetView.vue` | ✅（spinner） | ✅ | ✅ | |
| `ReplayTimeline.vue` | ✅（spinner） | ✅ | — | |
| `PromptEvalView.vue` | 部分 | ✅ | ✅ | 无 loading 分支 |
| `PerformanceInsights.vue` | ✅（v-loading） | ❌ | ✅ | `catch { rows.value = [] }`(:103) 静默吞错 |
| `KnowledgeBasePage.vue` | ❌ | ❌ | ❌ | 三态全委托子面板；用 `ElMessage` 8 处 |
| `AutoPipelineView.vue` | ✅ | ✅ | ✅ | |
| `RewriteView.vue` | ✅ | ✅ | — | |
| `HotTopics.vue` | ✅ | ✅ | ✅ | |

**汇总**：三态齐全的仅 8 个；缺 error 内联态 6 个；缺 loading 9 个。

### 1.6 错误处理缺口（调用 API 但用户不可见）

| 文件:位置 | 代码 | 问题 |
|-----------|------|------|
| `Home.vue` 原 :204 | `await accountBatchOpenLogin(expiredAccountIds)` | 无 try/catch，未处理 rejection |
| `Comments.vue` 原 :71/:76 | `await platformList()` | catch 内容为 `/* ignore */` |
| `Comments.vue` 原 :85/:94/:111 | `api.webview*` | 无 try/catch |
| `Monitor.vue` 原 :149/:159/:192 | `api.webview*` | 无 try/catch |
| `CloudPublish.vue` 原 :173/:235 | `reportError(...)` | 只写日志，无 toast |
| `Intelligence.vue` 原 :198 | `reportError(...)` | 同上 |
| `PerformanceInsights.vue` 原 :103 | `catch { rows.value = [] }` | 静默吞错 |
| `composables/useHotTopicsFavorites.js` :25/:30/:54 | favorite add/remove | 无 catch |
| `composables/useVideoClone.js` :95/:105/:113/:117/:166 | profile CRUD / cancel | 无 catch 或仅设内部 error |
| `composables/usePlatformAccounts.js` :108/:123 | `console.warn` | 无用户提示 |
| `composables/useExpiredAccountsBanner.js` :54 | `reportError(...)` | 用户不可见 |

**已有的正确范式**（应推广）：`useNotify`（`composables/useNotify.js`）统一 toast 通道 + `notifyError/Success/Warning/Info/Confirm`，已被 9 个 composable 与 9 个视图使用；`useProviderCrud.js` / `useModelProviderCrud.js` / `useFilmEngineering.js` 的错误提示覆盖率高。**但仍有 5 个视图绕过通道直接用 `ElMessage`**（`KnowledgeBasePage` 8 处、`PerformanceInsights` 3 处、`ModelProviders` 2 处、`Dashboard` 1 处）。

### 1.7 交互细节

- **提交按钮缺反馈**：`CloudPublish.vue:58` 提交按钮只有 `:disabled="submitting"`，无 `:loading`/文案变化；`FirstRun.vue:87` 仅 `opacity: 0.6`。
- **硬编码等待/轮询密集**：`views/` 下 20+ 处 `setTimeout/setInterval`（`CreateView.vue` 独占 12 处，含 3s 轮询 ×4、1s 时钟），`HotTopics.vue` 有 3 个定时器；**存在泄漏风险**（组件卸载未清理的写法需要逐个核对）。
- **`console.warn/error` 残留 20 处**（`stores/tab.js` 独占 11 处、`Dashboard.vue` 4 处）。
- **`v-html` 0 处、`console.log` 0 处** —— 保持。
- 延迟 300ms 的搜索防抖在 `Accounts.vue` / `ViralLibraryTable.vue` / `TitleAssistantPanel.vue` / `TagSuggester.vue` / `PersonalKnowledgePanel.vue` 各自手写 5 份。

### 1.8 根因分析（为什么会长成这样）

1. **缺少"加载态"的公共抽象**：项目早期每个页面独立开发，最省事的写法就是 `<div>加载中...</div>`；等意识到要骨架屏时，已有 3 个页面各自实现，于是产生第 4、5、6 套。**这是"没有组件契约"导致的，不是执行者疏忽。**
2. **令牌演进没有回收旧体系**：`tokens.css` 是后来引入的"唯一来源"，但历史组件仍引用 `cohere-*` / `apple-*`；文件级 CSS（`create-view.css` 等）承载了组件级样式，复制粘贴时把渐变/圆角一起搬走。
3. **组件库不完整**：没有 Card/Tag/Table/分页/Toast，页面只能自造；空态虽然有 `EmptyState` 但引导/CTA 能力弱（只支持一个按钮），复杂场景只能自己写。
4. **缺少护栏**：`v-html`、`window.confirm`、renderer IPC 都有 CI 门禁（`check-frontend-consistency.js`、`check-locale-sync.js`），但**"样式与加载态一致性"没有任何门禁**，所以退化不会被拦住。→ 本方案第 5 章补上。

---

## 2. 优化目标与原则

### 2.1 可量化目标（North Star）

| 指标 | 现状 | 目标 | 采集方式 |
|------|------|------|---------|
| 骨架屏实现份数 | 6（3 真 + 3 死） | **1**（`UiSkeleton` + `skeleton.css`） | 契约测试（已实现） |
| 骨架样式维度不一致 | 6 维 | **0**（颜色/圆角/时长/缓动/动画技术/暗色全覆盖） | 契约测试 |
| 有 loading 态但非骨架的页面/面板 | 30+ | **0** | 逐页清单 + 契约测试白名单 |
| 完全无 loading 态的视图 | 9 | **0** | 三态矩阵复核 |
| 间距/圆角/字号命名族 | 3 族 | **1 族**（`--spacing-*` / `--radius-*` / `--font-size-*`） | grep 统计 |
| 弹窗实现数 | 7 | **1**（`UiModal`） | grep `.modal-overlay` / `el-dialog` |
| 空态实现数 | 1 + 21 | **1 + 0** | 契约测试 |
| 三态齐全的视图占比 | 8/30 | **≥ 28/30** | 三态矩阵 |
| 错误处理用户可见率 | 15 处不可见 | **0** | `check-error-visibility` 门禁 |
| 暗色主题可用 | 入口 0 | 可切换且基础组件全覆盖 | 视觉回归 + 手工验收 |

### 2.2 原则

1. **单一来源**：视觉变量只有一个定义点（`styles/*.css`），组件只负责结构与布局。
2. **契约优先**：新抽象必须同时落地"组件 + 令牌 + 契约测试"，否则不引入。
3. **不改变信息架构**：本轮只统一"外观与反馈"，不动页面结构与业务逻辑，避免回归面失控。
4. **渐进替换，可回滚**：按批次交付，每批可独立合并/回滚；旧类名保留一版兼容期（deprecate 标注），下一版删除。
5. **无障碍默认达标**：加载/错误区域必须有 `role` + 可朗读文案；动效尊重 `prefers-reduced-motion`。
6. **零硬编码新增**：新增文案走 `locales`（zh/en 成对），新增颜色/尺寸走令牌。

---

## 3. 方案总览（分层）

```
L4  质量护栏    契约测试 · CI 门禁 · 视觉回归基线 · 三态检查脚本
      ▲
L3  体验与性能  三态补齐 · 错误可见性 · 提交反馈 · 主题接线 · 长列表/轮询治理
      ▲
L2  页面落地    30 个视图 + 20 个面板：加载态换成 UiSkeleton，空/错态换成共享组件
      ▲
L1  基础组件    UiSkeleton ✅ · UiModal 收敛 · EmptyState 增强 · UiCard/UiTag/UiTable/UiTabs/useDebounce
      ▲
L0  设计令牌    skeleton.css ✅ · tokens.css 单一化（颜色/间距/圆角/字号/阴影/动效/层级/z-index）
```

L0/L1 未就绪时不做 L2 大范围替换，避免"换一遍再换一遍"。

---

## 4. 详细方案

### 4.1 L0：骨架屏令牌（✅ 本轮已完成）

新增 `styles/skeleton.css` 作为骨架屏**唯一来源**：

```css
:root {
  --skeleton-bg: #e8eaef;          /* 骨块基色 */
  --skeleton-shimmer: #f7f8fb;     /* 流光高光色 */
  --skeleton-bar-height: 14px;     /* 文本行高度 */
  --skeleton-radius: 6px;          /* 文本行圆角 */
  --skeleton-radius-block: 10px;   /* 方块圆角 */
  --skeleton-media-height: 140px;  /* 卡片媒体区高度 */
  --skeleton-duration: 1.8s;       /* 慢速流光（原 1.5s 偏快） */
  --skeleton-ease: ease-in-out;
}
[data-theme="dark"] {
  --skeleton-bg: #2a2c38;
  --skeleton-shimmer: #3b3e4d;
}
```

统一动画（**全应用唯一 keyframes**，命名 `mp-skeleton-shimmer`，规避历史重名覆盖）：

```css
.mp-skeleton-surface {
  background-color: var(--skeleton-bg);
  background-image: linear-gradient(90deg, var(--skeleton-bg) 25%, var(--skeleton-shimmer) 37%, var(--skeleton-bg) 63%);
  background-size: 400% 100%;
  animation: mp-skeleton-shimmer var(--skeleton-duration) var(--skeleton-ease) infinite;
}
@keyframes mp-skeleton-shimmer { 0% { background-position: 100% 50%; } 100% { background-position: 0 50%; } }
@media (prefers-reduced-motion: reduce) { .mp-skeleton-surface { animation: none; } }
```

配套布局工具（消除各页重复的 `minmax` 列宽与同名 `.skeleton-card` 互相覆盖）：`.mp-skeleton-grid`、`.mp-skeleton-card`。

**设计取舍说明**：

- 动画从 1.5s 调到 **1.8s** + `ease-in-out`，对应"慢速明暗交错"的感知目标；`background-position` 位移（而非 `transform: translateX`）在窄骨块上不会出现"高光跑出元素边界"的空档。
- 暗色令牌独立给值，避免"白块闪在深色底上"；`--skeleton-bg` 与 `--skeleton-shimmer` 的亮度差控制在 ~8%（浅色 `#e8eaef`→`#f7f8fb`、暗色 `#2a2c38`→`#3b3e4d`），保证"能看出在动"但不刺眼。
- `prefers-reduced-motion` 下**不播放动画但保留骨块**（而不是不渲染骨架），保证"内容会来"的心理模型不丢。

### 4.2 L1：`UiSkeleton` 组件契约（✅ 本轮已完成）

`components/UiSkeleton.vue`，全局注册（`main.js`）+ 单测同步注册（`test-setup.js`）。

**Props**

| Prop | 类型 | 默认 | 说明 |
|------|------|------|------|
| `variant` | String | `text` | 见下方变体表 |
| `tag` | String | `div` | 根元素标签（表格内可传 `tr`） |
| `rows` | Number | 3 | `paragraph` 行数（末行自动收口到 62%） |
| `count` | Number | 3 | `list` / `table` 条目数 |
| `columns` | Number | 4 | `table` 列数 |
| `width` / `height` | String\|Number | `''` | 数字按 px、字符串原样 |
| `radius` | String | `''` | 覆盖圆角 |
| `animated` | Boolean | `true` | `false` → `.mp-skeleton--static`（关流光保骨块） |
| `label` | String | `''` | 无障碍朗读文案，默认取 i18n `common.loading` |

**变体（variant）语义表**

| variant | 结构 | 适用场景 |
|---------|------|---------|
| `text` | 1 条文本行 | 单行字段、短提示 |
| `paragraph` | N 行（末行 62%） | 段落、卡片正文、弹窗内容 |
| `rect` | 1 个方块（可设 w/h/radius） | 媒体区、图表容器、自定义块 |
| `circle` | 1 个圆形块 | 头像、状态点 |
| `card` | 媒体区(140px) + 2 行 | 项目库、流水线选择、模板选择 |
| `list` | N × (头像 36px + 3 行 + 右侧操作位 72×28) | 收藏夹、草稿、历史、榜单、日志 |
| `table` | 表头 + N 行 × M 列 | 爆款库、数据表 |
| `chart` | 8 根底对齐柱 | 趋势/基准图 |
| `custom` | 默认插槽 | 特殊组合（需自行保证骨块走 `.mp-skeleton-surface`） |

**无障碍与动效**

- 根节点 `role="status"` + `aria-busy="true"`；内含视觉隐藏文案（`.mp-skeleton__sr`，`clip-path: inset(50%)`），默认读 i18n `common.loading`（zh「加载中...」/ en「Loading...」）。
- 骨架屏**不阻断**键盘焦点、不进入 tab 序列。
- 统一由 `skeleton.css` 的 `prefers-reduced-motion` 兜底。

### 4.3 L2：加载态语义映射（统一判定标准）

写码时按下面的对照表选变体，不再"每页自己发挥"：

| 页面内容形态 | 目标写法 | 数量建议 |
|-------------|---------|---------|
| 卡片栅格（项目/流水线/模板/场景素材） | `.mp-skeleton-grid` + `variant="card"` × 6 | 6 |
| 纵向条目列表（草稿/历史/收藏/榜单/日志/时间线） | `variant="list"` + `:count` | 5 |
| 明细/详情/弹窗内容 | `variant="paragraph"` + `:rows` | 3~4 |
| 数据表格 | `variant="table"` + `:count` + `:columns` | 5 |
| 图表/统计 | `variant="chart"` | — |
| 看板/泳道 | `.mp-skeleton-grid` + `variant="rect"`（高度对齐真实卡） | 6 |
| 单字段/单行状态 | `variant="text"` | — |
| 按钮内提交 | **不用骨架**，用 `UiButton :loading` + 文案切换 | — |

统一附加：容器加 `data-testid="<page>-loading"`（便于视觉回归与单测定位），必要时 `aria-live="polite"`。

### 4.4 L2：逐页迁移清单（Loading 态）

P0 已在**本轮**落地：`ProjectLibrary`、`PipelineSelector`、`ModelProviders`、`PipelineBrowser`。

P1 待落地（按视觉曝光度排序）：

| # | 文件 | 现状 | 目标 |
|---|------|------|------|
| 1 | `views/video-creation/SceneAssetSelection.vue` | 缩略图 `…` | `card` × N（缩略图位） |
| 2 | `views/ContactSheetView.vue` | spinner + 加载场景... | `card` × 6 |
| 3 | `views/ProductionBoard.vue` | spinner + 加载看板... | `rect`/`card` × 6 |
| 4 | `views/ReplayTimeline.vue` | spinner + 加载回放数据... | `list` × 5 |
| 5 | `views/CreateHistory.vue` | spinner + 加载中... | `list` × 5 |
| 6 | `views/CreateViewHistory.vue` | spinner + tr('loading') | `list` × 5 |
| 7 | `views/ResultView.vue` | 纯文字 加载中... | `paragraph` × 4 |
| 8 | `views/Accounts.vue` | 纯文字 | `list` × 5 |
| 9 | `views/PublishHistory.vue` | 纯文字（3 处） | `list` × 5 |
| 10 | `views/Publish.vue` | 纯文字 | `list` × 3 |
| 11 | `features/publish/components/PublishDraftList.vue` | 纯文字 | `list` × 3 |
| 12 | `views/CloudPublish.vue` | 纯文字 | `list` × 3 |
| 13 | `components/ViralLibraryTable.vue` | `<tr><td>加载中...</td></tr>` | `table`（`tag="tr"`） |
| 14 | `components/BenchmarkChart.vue` | 纯文字 | `chart` |
| 15 | `components/TrendingPanel.vue` | 纯文字 | `list` × 3 |
| 16 | `components/KeywordMonitorPanel.vue` | 纯文字（2 处，含历史弹窗） | `list` × 3 / `paragraph` |
| 17 | `components/PersonalKnowledgePanel.vue` | 纯文字 | `list` × 3 |
| 18 | `components/TemplatePicker.vue` | 纯文字 | `card` × 3 |
| 19 | `components/TitleAssistantPanel.vue` | 纯文字 | `paragraph` × 2 |
| 20 | `components/OptimalTimeTip.vue` | 分析关键词... | `text` |
| 21 | `components/TagSuggester.vue` | 文字 + pulse | `text` × 3 |
| 22 | `components/LogsSettings.vue` | t('common.loading') | `list` × 5 |
| 23 | `components/ConfigProfileManager.vue` | t('common.loading') | `list` × 3 |
| 24 | `components/ApprovalGateModal.vue` | spinner + 加载审批门... | `paragraph` × 3 |
| 25 | `views/CreateView.vue` | 4 处内联文字 | `paragraph` / `list` / `text` |
| 26 | `views/ViralAnalysis.vue` | 分析中...（页头） | `chart` + `paragraph` |

P2 补齐"完全没有 loading 态"的 9 个视图（需先补 `loading` ref 与 `try/finally`）：

`Home`、`Comments`、`Monitor`、`Dashboard`、`Intelligence`、`RewriteView`、`KnowledgeBasePage`、`PromptEvalView`、`Calendar`。

> `Calendar` 已有 `loading` ref，只需在模板加分支；其余需要顺带补 1.6 的错误提示。

### 4.5 L3：三态补齐（empty / error）

- **空态**：`EmptyState.vue` 增强为 `icon / title / description / actionText / secondaryActionText / compact`，支持 `actions` 插槽放多个按钮；然后 21 处自造空态**逐一替换**（P1 批）。
- **错误态**：统一新增 `UiErrorState.vue`（`title` + `message` + `retryText` + `@retry`，`role="alert"`），替换 `ProjectLibrary`/`PipelineSelector`/`ContactSheetView`/`ReplayTimeline`/`AutoPipelineView` 等自绘错误块，并给缺 error 内联态的 6 个视图补上。
- **错误可见性**：把 1.6 表格里的 15 处全部改为 `useNotify.notifyError(...)`（保留 `reportError` 上报）；禁止 `catch {}` 静默。

### 4.6 L3：弹窗收敛（7 → 1）

1. `UiModal` 补齐能力：`size`（sm/md/lg/full）、`closeOnEsc`（默认 **true**）、`closeOnOverlay`、`showClose`、`footer` 插槽、`aria-labelledby` 自动绑定、焦点陷阱（已有 `trapFocus` 保留）。
2. `UpgradeModal` / `PublishDestinationModal` / `ViralFormDialog` / `PersonalFormDialog` / `ErrorDialog` 内部改用 `UiModal`（外部 API 不变，先做"壳替换"，避免调用方大改）。
3. `el-dialog`（`ModelProviders` 4 / `FilmEngineeringView` 2 / `PublishHistory` 1 / `PatternAnalysisPanel` 1）**保留**（Element Plus 表单场景成本收益比不划算），但统一通过 `.el-dialog` 变量桥接主题，并在文档中登记为"允许的例外"。
4. 删除 `cohere-modal` 的重复实现（仅保留 cohere 表单类样式）。

### 4.7 L3：令牌收敛（4 套 → 1 套）

| 阶段 | 动作 | 风险控制 |
|------|------|---------|
| 1 | `tokens.css` 补齐**阴影/动效/层级**令牌（从 `apple-design-tokens.css` 迁入），补 `[data-theme="dark"]` 覆盖；`apple-design-tokens.css` 改为**只做别名映射**（`--apple-shadow-*: var(--shadow-*)` 等） | 纯新增，不改旧值 → 零视觉回归 |
| 2 | 建立"命名族映射表"，把 `--space-*` / `--r-*` 映射到 `--spacing-*` / `--radius-*`；`--apple-*` 同理 | 别名先行，逐步换引用 |
| 3 | 按文件批次替换裸 `px`/`hex`：先做 **13 个全局 css 文件**（风险低）→ 再做 TOP10 视图 → 其余视图 | 每批必须跑视觉回归 + 像素比对 |
| 4 | 删除已无引用的旧令牌与重复定义 | grep 校验 0 引用后再删 |

**批次边界与顺序（重要）**：`cohere-design-system.css` 影响面最大（25 个文件消费 `--space-*`），必须最后动；`video-creation-*` 系列自成体系（150 处 hex），单独成批。

### 4.8 L3：交互与反馈

| 项 | 方案 |
|----|------|
| 提交按钮 | 统一 `UiButton` + `:loading`；禁止只用 `:disabled` + `opacity`（补齐 `CloudPublish`、`FirstRun`） |
| 防抖 | 新增 `composables/useDebouncedRef.js`（含卸载清理），替换 5 份手写 `setTimeout` 防抖 |
| 轮询 | 新增 `composables/usePolling.js`：统一间隔、`visibilitychange` 暂停、卸载清理；替换 `CreateView`(4 处 3s 轮询)、`CloudPublish`、`AutoPipelineView`、`CreateHistory`、`HotTopics` |
| 乐观更新 | 收藏/删除等即时反馈场景，先改 UI 再回滚（参考 `useHotTopicsFavorites` 现有 `try/finally`） |
| 提示通道 | 全部走 `useNotify`；CI 禁止新增 `ElMessage` 直用（白名单 4 个文件待迁移） |
| console 清理 | 20 处 `console.warn/error` → `reportError` / `logger`；CI 增加基线门禁 |

### 4.9 L3：主题与无障碍

1. **接线 `useTheme`**：在设置页（`LogsSettings` 或新增"外观"分组）增加"跟随系统 / 浅色 / 深色"三选一，持久化到 electron store。
2. **补齐暗色**：`apple-design-tokens.css`、`HotTopics.css`、`Accounts.vue`、`PlatformIcon.vue` 品牌色（品牌色可保留，文字/背景必须走令牌）、`layouts/*`、`features/*` 等 8 个无暗色覆盖的文件。
3. **无障碍基线**：
   - 所有可点元素 `tabindex`/`role`/`aria-label`（`PipelineSelector` 已是正确范式，推广到 `ProjectCard`、榜单条目）；
   - 加载/错误区域 `role="status"` / `role="alert"`；
   - 对比度 ≥ 4.5:1（重点核查 `--color-text-muted #9898a8` 在 `#ffffff` 上为 2.6:1 → 需调整到 ≥ 4.5:1）；
   - 全流程键盘可达（`UiModal` 焦点陷阱 + ESC）。

### 4.10 L3：性能

| 项 | 现状 | 方案 |
|----|------|------|
| 路由懒加载 | `router/index.js` 直接 import 全部 30 个视图 | 改为 `() => import(...)` 动态导入 + `Suspense`/loading 骨架兜底 |
| 长列表 | 收藏/爆款库/历史全量渲染 | 超过 50 条启用虚拟滚动（或"分页 + 骨架"） |
| 图片 | `ProjectCard` 等部分已有 `loading="lazy"` | 全站补齐 + 固定宽高比占位（避免 CLS） |
| 轮询 | 3s 级多处常驻 | `usePolling` + 页面不可见暂停 + 指数退避 |
| 首屏 | 无骨架 → 白屏 | 首屏路由挂 `<UiSkeleton variant="card" :count="6"/>` 兜底 |

### 4.11 实施批次与工作量

| 批次 | 内容 | 影响文件 | 预估 | 风险 | 可独立回滚 |
|------|------|---------|------|------|-----------|
| **P0** | 骨架屏令牌 + `UiSkeleton` + 4 处迁移 + 死代码清理 + 契约测试 | 12 | ✅ 已完成 | 低 | ✅ |
| **P1** | 26 处 loading 态迁移 + 视觉回归基线 | ~26 | 1.5~2 人日 | 低 | ✅ |
| **P2** | `UiErrorState` + `EmptyState` 增强 + 21 处空态/错误态替换 + 15 处错误可见性 | ~30 | 2~3 人日 | 中 | ✅ |
| **P3** | 弹窗收敛（7→1）+ 提交反馈 + `usePolling`/`useDebouncedRef` | ~15 | 2 人日 | 中（交互回归） | ✅ |
| **P4** | 令牌收敛（4→1）+ 硬编码颜色治理（分批） | ~60 | 4~6 人日 | **高**（视觉回归） | 按批回滚 |
| **P5** | 主题接线 + 暗色补齐 + 无障碍 + 性能 | ~25 | 3~4 人日 | 中 | ✅ |

---

## 5. 测试与质量护栏

### 5.1 单元/契约测试（本轮已落地示例）

实测：`UiSkeleton.test.js`(14) + `UiSkeleton.contract.test.js`(8) + `ProjectLibrary.test.js`(10) + `PipelineBrowser.test.js`(7) + `PipelineSelector.test.js`(8) = **47 条全绿**。

- `components/UiSkeleton.test.js`：14 条 —— 各 variant 结构、`rows`/`count`/`columns`、尺寸 px 化、`animated=false`、`label` 兜底、`tag`、`custom` 插槽、`role="status"`。
- `components/UiSkeleton.contract.test.js`：8 条**源码级契约**（jsdom 不应用 scoped CSS，沿用 `UiModal.test.js` 的 `readFileSync` 范式；扫描集排除 `*.test.js` 自身）：
  1. `--skeleton-bg` 只允许定义在 `styles/skeleton.css`；
  2. `skeleton.css` 必须含 `[data-theme="dark"]` 覆盖；
  3. `mp-skeleton-shimmer` 全仓只允许 1 处，且历史命名 `shimmer` / `skeleton-shimmer` 必须归零；
  4. 必须含 `prefers-reduced-motion`；
  5. `var(--skeleton-*)` 只允许出现在 `skeleton.css` 与 `UiSkeleton.vue`；
  6. 历史内联类名（`skeleton-thumb/line/header/title/desc/meta`）必须归零；
  7. `.mp-skeleton-surface` 只能出现在 `UiSkeleton.vue`；
  8. 组件必须声明 9 个 variant。

> 这 8 条是**防退化**的关键：任何人再把一套内联骨架粘回来，CI 直接红。

### 5.1.1 已登记的一致性例外（白名单）

| 例外 | 位置 | 理由 |
|------|------|------|
| `@keyframes seg-shimmer` | `styles/history-panel.css` | 流水线进度条"活动段"扫光（2s 无限），非加载占位 |
| `<el-dialog>` | `ModelProviders.vue` / `FilmEngineeringView.vue` / `PublishHistory.vue` / `PatternAnalysisPanel.vue` | Element Plus 表单场景，改造收益低 |
| 平台品牌色 | `components/PlatformIcon.vue`（32 个平台色） | 品牌识别需求，不随主题变化 |
| 骨架栅格外层类名 | `PipelineBrowser` 的 `.skeleton-card` | 页面级外壳微调（`pointer-events:none`） |

### 5.2 视觉回归

- 每批替换后跑 `apps/desktop` 的 Playwright 视觉用例：`--single` 逐视图 → 全量。
- 新增/更新基线截图必须随 PR 提交，并在 PR 描述中给出"改前/改后"对照。
- 加载态必须在 `prefers-reduced-motion: reduce` 与 `dark` 两种模式下各截一张。

### 5.3 CI 门禁（新增建议）

| 门禁 | 内容 | 落地方式 |
|------|------|---------|
| 骨架一致性 | 复用 `UiSkeleton.contract.test.js`（已在 vitest 内） | 现有 `quality-gate` 即可覆盖 |
| 空态/弹窗一致性 | 新增 `check-ui-consistency.js`：统计 `.empty-*` / `.modal-overlay` 自定义实现数，基线只降不升 | 模仿 `check-frontend-consistency.js` |
| 错误可见性 | 扫描 `catch {}` / 仅 `console.*` 的 catch 块，基线只降不升 | 同上 |
| 硬编码视觉值 | 统计裸 `font-size:Npx` / `border-radius:Npx` / `#[0-9a-f]{3,8}`，基线只降不升 | 同上 |
| i18n | 既有 `check-locale-sync.js --cjk/--keys`（新增文案必须走 locale，`common.loading` 已存在） | 已存在 |

> 基线式门禁的好处：不阻塞历史债务，但**新增即失败**，让"统一"成为不可逆的过程。

---

## 6. 验收标准（DoD）

**P0（本轮）**

- [x] `styles/skeleton.css` 为骨架屏唯一来源（令牌 + keyframes + 暗色 + reduced-motion）
- [x] `UiSkeleton.vue` 提供 9 个 variant，含 `role="status"` 与 i18n 可朗读文案
- [x] 3 处现存骨架 + 1 处 spinner 页面迁移到 `UiSkeleton`；3 处死代码骨架删除
- [x] 4 处重名 `@keyframes skeleton-shimmer` 收敛为 1 处
- [x] `ProjectLibrary` 样式块由全局改为 `scoped`（消除 `.skeleton-card` 跨文件串台）
- [x] `PipelineBrowser` 失效的 `:focus-visible` 样式修复
- [x] `UiSkeleton.test.js` + `UiSkeleton.contract.test.js` 全绿；受影响的页面测试同步更新（本次 5 文件 47 条全绿）
- [x] `--skeleton-*` 从 `video-creation-tokens.css` 迁出，无重复定义
- [x] 修复测试环境语言漂移（`test-setup-locale.js` 前置），消除依赖 `@/i18n` 的中文文案断言 flakiness

**P1~P5（各批次通用 DoD）**

- [ ] 目标文件全部迁移完成，`grep` 无遗留 `加载中`/`spinner` 页面级加载
- [ ] 三态（loading/empty/error）矩阵复核通过，缺项归零
- [ ] 新增/更新单测与契约测试全绿；`pnpm --filter @multi-publish/desktop test` 通过
- [ ] 视觉回归通过（浅色 + 暗色 + reduced-motion 三模式）
- [ ] `check-locale-sync.js --cjk --keys` 通过（无新增硬编码中文、key 全部存在）
- [ ] CI 全绿后合并；CHANGELOG 记录；PRD/本文档同步更新

---

## 7. 风险与对策

| 风险 | 影响 | 对策 |
|------|------|------|
| 视觉回归面大（令牌收敛） | 中高 | 别名映射先行 + 分批 + 每批截基线；`cohere-design-system.css` 最后动 |
| 页面测试断言"加载中"文案 | 低 | `UiSkeleton` 默认渲染 i18n `common.loading`（zh 为「加载中...」），绝大多数断言自然通过；差异处逐个更新断言为"骨架存在"而非"文案存在" |
| 暗色主题接线后暴露大量未覆盖页面 | 中 | 先在暗色下跑全量视觉回归，把问题页列入 P5 清单后再开放入口 |
| 轮询重构引入状态不同步 | 中 | `usePolling` 保留"立即执行一次 + 间隔执行 + 可见性恢复补一次"语义，配单测（假计时器） |
| 中文硬编码门禁 | 低 | 骨架屏文案走 i18n `common.loading`，不新增中文字面量 |
| 契约测试过严导致误伤 | 低 | 白名单 + 明确的"允许例外"清单（如 `el-dialog`、品牌色） |

---

## 附录 A：本轮改动文件清单（P0）

| 文件 | 动作 |
|------|------|
| `apps/desktop/src/styles/skeleton.css` | 新增：骨架令牌 + `.mp-skeleton-surface` + `mp-skeleton-shimmer` + 栅格/卡片工具 |
| `apps/desktop/src/components/UiSkeleton.vue` | 新增：9 variant 统一骨架组件 |
| `apps/desktop/src/components/UiSkeleton.test.js` | 新增：组件单测 |
| `apps/desktop/src/components/UiSkeleton.contract.test.js` | 新增：源码一致性契约测试 |
| `apps/desktop/src/main.js` | 引入 `skeleton.css`；全局注册 `UiSkeleton` |
| `apps/desktop/test-setup-locale.js` | 新增：`setupFiles` 首位，语言确定性前置（修复 locale 漂移隐患） |
| `apps/desktop/vitest.config.js` | `setupFiles` 增加前置语言设置文件 |
| `apps/desktop/test-setup.js` | 同步注册 `UiSkeleton`；语言设置改为指向前置文件说明 |
| `apps/desktop/src/styles/video-creation-tokens.css` | 迁出 `--skeleton-bg/--skeleton-shimmer` |
| `apps/desktop/src/styles/pipeline-selector.css` | 删除骨架骨块样式，保留栅格/卡片外壳 |
| `apps/desktop/src/styles/create-view.css` | 删除死代码骨架样式 |
| `apps/desktop/src/styles/history-page.css` | 删除死代码骨架样式 |
| `apps/desktop/src/views/ProjectLibrary.vue` | 迁移骨架 + 样式块改 `scoped` |
| `apps/desktop/src/views/ProjectLibrary.test.js` | 断言更新为 `.mp-skeleton-*` + `data-testid="ui-skeleton"` |
| `apps/desktop/src/views/video-creation/PipelineSelector.vue` | 迁移骨架 |
| `apps/desktop/src/views/ModelProviders.vue` | 迁移骨架 + 删除重名 keyframes 与暗色覆盖 |
| `apps/desktop/src/components/PipelineBrowser.vue` | 迁移骨架 + 删除死代码 + 修复失效 `:focus-visible` |

## 附录 B：证据索引（改动前位置）

- 骨架样式：`ProjectLibrary.vue` :103-135、`pipeline-selector.css` :204-223、`ModelProviders.vue` :866-883
- 死代码：`PipelineBrowser.vue` :150-152、`create-view.css` :422-427、`history-page.css` :408-425
- 令牌：`tokens.css` :12-76、`cohere-design-system.css` :29-94/:1512+、`apple-design-tokens.css` :7-89、`video-creation-tokens.css` :7-135
- 主题：`composables/useTheme.js` :23-110（调用方 0）
- 弹窗：`UiModal.vue`、`UpgradeModal.vue`、`PublishDestinationModal.vue`、`ViralFormDialog.vue`、`PersonalFormDialog.vue`、`video-creation/ErrorDialog.vue`、`<el-dialog>` ×8
- 空态：`EmptyState.vue` + 21 处自造（`Accounts` :1142、`history-panel.css` :174、`HotTopics.css` :50、`MemberCenter` :270 等）
- 错误处理缺口：见 §1.6 表格
