# PRD：账号页加载骨架与卡片网格列口径统一（accounts-grid-align）

- **日期**：2026-09-22
- **分支 / worktree**：`codex/accounts-grid-align` / `D:/Data/projects/mp-worktrees/mp-accounts-grid-align`（基于 origin/main `5e8d866`）
- **类型**：🐛 UI 交互缺陷修复（🎨 UI/UX 变更，S/低风险，纯展示层，零数据流改动）
- **优先级**：P1（体验类，非阻断）
- **状态**：已实施，待 CI

---

## 1. 背景与现象

用户反馈：进入应用「账号管理」页（`/accounts`）时，内容尚未加载完成，页面中央的默认占位框（骨架卡片）**只显示 1 列**（纵向堆叠的窄列）；内容加载完成后，卡片**突然跳变成多列**。视觉上存在一次明显的布局跳动（CLS 类体验问题）。

涉及区域：`.account-results-panel`（账号结果面板，页面右栏，宽度 = 视口 − 侧栏 240px − 面板内边距）。

## 2. 根因分析

### 2.1 加载态塌陷成 1 列（主因）

账号页三种列表状态互斥渲染（状态机）：

```
loading=true ──→ .loading-state > .mp-skeleton-grid（骨架卡片 ×4）
loading=false 且 visibleAccounts=0 ──→ EmptyState
loading=false 且有数据 ──→ .account-card-grid（AccountManagementCard ×N）
```

- 骨架栅格 `.mp-skeleton-grid`（全局 `styles/skeleton.css`）：`display:grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr))`。
- 但其容器 `.loading-state` 为 `display:flex; align-items:center; justify-content:center`（为了居中「加载中」类提示）。**flex 行布局下 `justify-content:center` 不沿主轴拉伸子项**，骨架栅格作为 flex item 宽度塌陷为固有内容宽度；`auto-fill` 在**不确定（indefinite）可用宽度**下只能按最小内容解析 → **恒为 1 列**。
- 加载完成后 `.account-card-grid` 是面板的块级子元素，具备确定满宽，`auto-fill` 摆出多列。

即：**同一列口径（auto-fill 280px）在两种宽度上下文下解析结果不同**，产生「1 列 → 多列」跳动。

> 同型先例：`PipelineBrowser.vue` 曾出现同样问题，当时以 `.loading-state--skeleton { display:block }` 局部修补；本次账号页按方案 B（口径单一来源）收口，不再复制补丁模式。

### 2.2 账号网格存在双基线与死代码断点（次因，口径漂移隐患）

`Accounts.vue` 有两个 scoped style 块，`.account-card-grid` 的 `grid-template-columns` 存在**四处声明**：

| 位置 | 声明 | 实际生效？ |
|------|------|-----------|
| 块1 基线 | `repeat(4, minmax(0, 370px))` | ❌ 被块2 同名基线（特异性相同、源码更靠后）覆盖 |
| 块1 `@media (max-width:900px)` | `repeat(auto-fill, minmax(260px, 1fr))` | ❌ 同上（媒体查询不加特异性，压不过后位基线） |
| 块1 `@media (901px–1500px)` | `repeat(2, minmax(0, 1fr)); gap:16px` | ❌ 同上 |
| 块1 `@media (1501px–2050px)` | `repeat(3, minmax(0, 370px))` | ❌ 同上 |
| 块2 基线 | `repeat(auto-fill, minmax(280px, 1fr)); gap:24px` | ✅ **唯一实际生效口径** |

双基线本身即口径漂移隐患（任一处被单独修改都会产生不可预期行为），三处死代码断点制造「响应式已设计」的假象。

## 3. 方案设计（方案 B：列口径单一来源）

### 3.1 功能逻辑

在 `.account-results-panel` 上建立**唯一口径来源**（CSS 自定义属性），真实栅格与骨架栅格共同消费：

```css
.account-results-panel {
  --account-grid-columns: repeat(auto-fill, minmax(280px, 1fr));
  --account-grid-gap: 24px;
}
.account-card-grid          { grid-template-columns: var(--account-grid-columns); gap: var(--account-grid-gap); }
.loading-state .mp-skeleton-grid {
  width: 100%;              /* 关键修复：flex 居中容器内仍占满面板，auto-fill 按确定宽度解析 */
  grid-template-columns: var(--account-grid-columns);
  gap: var(--account-grid-gap);
}
```

- `width:100%` 依据：`.loading-state` 自身为块级子元素、宽度确定（= 面板内容宽），flex item 显式 `width:100%` 沿主轴生效，栅格获得确定宽度后 `auto-fill` 解析列数与加载后完全一致。
- 同时**删除 §2.2 表格中全部失效声明**（块1 基线仅保留 `display:grid; align-items:start` 结构属性），`.account-card-grid` 的列口径与 gap 在代码库中只出现一处。

### 3.2 交互逻辑（修复前后对比）

| 时刻 | 修复前 | 修复后 |
|------|--------|--------|
| 进入页面（loading） | 骨架卡片纵向 1 列窄栏 | 骨架卡片多列排布，列数 = 加载后列数 |
| 数据到达瞬间 | 1 列突然跳成 N 列（跳动） | N 列 → N 列，**零布局跳动**，仅骨架→真实内容质感切换 |
| 切换筛选/Tab 触发 refresh | 同上跳动 | 同上无跳动 |
| 窗口缩放（loading 期间） | 恒 1 列 | 实时跟随列数变化（与加载后同一 `auto-fill` 算法） |

### 3.3 显示项

| 项 | 值 | 说明 |
|----|----|------|
| 骨架卡片数量 | 4（`v-for="i in 4"`，不变） | 覆盖 2–4 列首屏可见行 |
| 列最小宽 | `minmax(280px, 1fr)`（不变） | 与原实际生效口径一致，**真实卡片渲染行为零变化** |
| 列间距 / 行间距 | `24px`（不变） | 骨架原为全局默认 16px，本次对齐真实栅格 24px |
| 列表视图（grid/list 切换） | list 态不受影响 | `.account-card-grid.account-list-view` 仍为 flex 纵向，优先级更高 |
| 空态 EmptyState / 错误提示 | 不变 | 仍居中（`align-items/justify-content:center` 保留） |

### 3.4 提示文字（i18n）

本次**零新增用户可见文案**：不改任何 locale 键；`accountsPage.loadFailed` 等既有提示保持原样。满足 locale 成对修改门禁（无 zh/en 变更即天然成对）。

### 3.5 数据校验（结构与口径合同，由契约测试机器拦截）

| # | 校验项 | 规则 | 拦截方式 |
|---|--------|------|----------|
| V1 | 口径变量唯一定义 | `--account-grid-columns:` 与 `--account-grid-gap:` 在 `Accounts.vue` 中各恰出现 1 次，值分别为 `repeat(auto-fill, minmax(280px, 1fr))` / `24px` | `accounts-grid.source.test.js` 计数断言 |
| V2 | 真实栅格只消费变量 | `.account-card-grid` 规则含 `var(--account-grid-columns)`，且全文件不存在任何 `.account-card-grid {...repeat(...)}` 硬编码 | 同上（正则扫描，含注释防呆） |
| V3 | 骨架与真实栅格同源 | `.loading-state .mp-skeleton-grid` 规则必须同时含 `width: 100%` 与两个 `var(...)` 消费 | 同上 |
| V4 | SFC 可编译 | `Accounts.vue` 样式改动不破坏编译 | 既有 `accounts-compile.test.js` |
| V5 | 渲染行为零变化 | `Accounts.test.js` 80 例全绿（列表/网格视图、筛选、骨架存在性等断言不改动） | vitest 回归 |

## 4. 验收标准

1. 【人工/UAT】桌面端进入 `/accounts`，在数据加载完成前，骨架占位即为多列，且列数与加载完成后一致；加载全程无「1 列↔多列」跳变。
2. 【自动】`accounts-grid.source.test.js` 3 例契约全绿（V1–V3）。
3. 【自动】既有账号页全量测试（`Accounts.test.js` + `features/accounts` + `accounts-compile`）零回归。
4. 【自动】真实卡片栅格渲染口径不变：`auto-fill minmax(280px, 1fr)`、gap 24px（与修复前实际生效值一致，属行为保持重构）。
5. 【CI】QG Static / Unit Tests / Lint / 文档同步 / 债务熔断全绿。

## 5. 防回归机制

- **契约测试**（本次新增）：`apps/desktop/src/views/accounts-grid.source.test.js`——任何人再引入第二处列口径、或删掉 `width:100%`，CI 直接红。
- **单一来源结构**：口径只写在 `--account-grid-columns` 一处，改口径只需改一处，两端自动同步。
- **先例归档**：与 `pipeline-grid.source.test.js`（流水线网格单一来源护栏）同属「网格列口径源测试」家族，模式沉淀入 learnings。

## 6. Decision Log

| 决策 | 理由 | 被否方案 |
|------|------|----------|
| 骨架消费账号页局部 CSS 变量，而非改全局 `skeleton.css` | 全局骨架默认口径（minmax 280/gap16）服务十余个页面，改动 blast radius 大且各页真实栅格口径不一 | 全局把 `.mp-skeleton-grid` 强设 `width:100%`（各页 gap/列口径仍与真实栅格不一致，跳动只是变小不是消失） |
| `.loading-state` 保留 flex 居中，用 `width:100%` 拉伸骨架 | 空态/错误态仍需居中；改动面最小 | `display:block` 覆盖（需照顾同规则里的 empty-state 居中，副作用面更大） |
| 删除死代码断点（repeat 2/3/4 与 ≤900 覆盖） | 四处声明中仅 auto-fill 基线生效，属行为保持清理；保留死代码会继续误导「响应式已生效」 | 恢复断点口径（会改变真实渲染行为，超出缺陷修复范围，若需响应式列数定制另立需求） |
| 骨架数量维持 4 张 | 2–4 列布局下首屏可见约 1–2 行，4 张足够；扩 6 张收益低且加载后可能出现骨架→缩略跳动 | 骨架数对齐典型账号数（数据未知，无意义） |

## 7. 非目标与边界

- 不改其他页面（项目库/流水线/模型服务商等）的骨架口径——它们未报此缺陷，且各自真实栅格口径不同，按需另立任务推广同一模式。
- 不改列表视图（list mode）、筛选逻辑、加载数据链路（`accountStore.load()` 的 `loading` 置位时序不动）。
- 不引入新的 CSS 框架/断点体系。
