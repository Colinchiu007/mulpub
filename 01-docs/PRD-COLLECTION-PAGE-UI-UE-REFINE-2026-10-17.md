# PRD — 采集页整体 UI/UE 统一与精致化（collection-page-ui-ue-refine，2026-10-17）

- 关联模块：`apps/desktop/src/views/Collection.vue`、`apps/desktop/src/features/collection/`（BatchCollectPanel / CollectedResultsList / ColProgressBlock / CollectionDraftsPanel / QuickCollectPanel / CreatorMonitor）、`apps/desktop/src/styles/tokens.css`、`apps/desktop/src/locales/collection/{zh,en}.js`
- 关联 change：`openspec/changes/collection-page-ui-ue-refine/`（proposal / design / tasks + specs delta）
- 上一轮基线：`PRD-COLLECTION-UI-REFINEMENT-2026-10-12.md`（collection-ui-refinement，#3409）—— 本轮是它的**续作**，上一轮解决了「折叠分组 / 进度统一 / 卡片分级 / token 收编」，遗留的是「五套控件方言、六套间距节奏、页面级统一感」。
- 决策来源：用户真机走查原话「整体布局和细节元素和用户交互体验，视觉上都很散乱，不够统一和清晰，也不够精致高级。整体对 UI 和 UE 用户体验进行优化。」+ 本 PRD §11 的问题清单（逐条 file:line 取证）。

## 1. 背景与问题定性

用户反馈指向的不是「某个控件坏了」，而是**整页缺少一套统一的视觉与交互语法**。逐条取证如下：

| # | 问题 | 证据（file:line） | 归属 |
|---|---|---|---|
| P1 | **六套按钮方言并存**：`cohere-btn-primary`（圆角 32px 药丸）、`cohere-btn-secondary`（无边框、padding 8px 0 的幽灵文字按钮）、`card-actions button`（圆角药丸 + 细边框）、`is-primary`（**全仓零样式定义**，是一个死类）、`class="primary"`（同样是死类，`Collection.vue:328/346` 与 `CollectionDraftsPanel.vue:56` 在用）、`zb-config-badge`/`tag-toggle`/`library-filter-btn` 各自一套 | `cohere-design-system.css:488/506/739`；`Collection.vue:328/346`；`CollectionDraftsPanel.vue:56`；`CollectedResultsList.vue:99-102` | 视觉 |
| P2 | **六套间距节奏**：`col-panel` 用 `--space-md`(12px) 内边距，而同为卡片的 `.qc-card` 用 `--space-sm`(12px 硬编码)、`creator-panel` 用 `padding:12px` 裸值、`.zb-list-row` 用 `6px 10px`、`card-actions` 用 `4px 14px`、`.batch-bar` 用 `10px 12px` —— 同为「卡片内边距/行内边距」出现 6 个值 | `Collection.vue:2173`、`QuickCollectPanel.vue:343/750/749`、`CreatorMonitor.vue:456/459`、`cohere-design-system.css:746`、`CollectedResultsList.vue:171` | 视觉 |
| P3 | **`is-primary` / `primary` 两个死类被三处消费**：`CollectedResultsList.vue:99-100` 靠 `is-primary` 声明主次，但全仓无该样式定义 ⇒ 「创建草稿/发布」与「查看/视频创作」**视觉上完全相同**，分级是假的（测试只断言 class 名不断言样式）。`Collection.vue:328` 与 `CollectionDraftsPanel.vue:56` 的 `class="primary"` 同理 | 全 src 检索：仅 2 处消费、0 处定义 | 视觉 + 测试盲区 |
| P4 | **页面头与内容区两套底色**：`.cohere-content` 被采集页 scoped 覆盖为 `--color-bg-page`（#f7f8fa），而页头 `.cohere-page-header` 无背景 ⇒ 页头白、内容灰，中间一条硬切线；同时 `.cohere-content` 的 `flex:1; overflow-y:auto` 与 `--color-bg-page` 的 min-height 在同一规则里打架 | `cohere-design-system.css:665`、`Collection.vue:1944` | 视觉 |
| P5 | **页签两套容器**：`.collection-tabs`（`background: var(--soft-stone)` 药盒）与 `.library-filters`（同款药盒）视觉同源但分居两处定义；页签无 `role="tabpanel"` 联动，仅按钮带 `role="tab"`，`aria` 不完整 | `Collection.vue:2021/2080` | 视觉 + 可访问性 |
| P6 | **快捷操作卡语义混乱**：6 张 `cohere-stat-card` 里混了三类语义——新建草稿（写操作）、剪贴板导入（写操作）、草稿箱（导航）、微博/知乎/头条热榜（外跳）。emoji 图标（✏️✧❓📰）与 el-icon 混用，字号 32px 的 `stat-value` 把「入口卡」撑成「数据卡」 | `Collection.vue:179-204`、`cohere-design-system.css:1141-1167` | 视觉 + UE |
| P7 | **`col-panel::before` 顶部 3s 无限扫光饰带**是全页唯一动效，与其它卡片无动效 ⇒ 「动效孤岛」；且 `col-panel` 与 `BatchCollectPanel` 的 `col-panel` 双份定义（`Collection.vue:1964` 与 `BatchCollectPanel.vue:2`）重复 | `Collection.vue:1974-1989` | 视觉 |
| P8 | **文案库页 6 个操作按钮平铺无主次**（编辑/创建草稿/视频创作/发布/改写/删除），其中 `class="primary"` 是死类；删除按钮靠 `.danger` 但样式在 `Collection.vue:2164` 的 scoped 覆盖里，与全局 `cohere-design-system.css:757` 双份定义 | `Collection.vue:323-330` | 视觉 + UE |
| P9 | **错误横幅三套视觉**：`col-error-banner`（采集）、`col-stage-banner`（视频阶段，蓝底）、`qc-stage`（快捷采集，`#e6a23c` 硬编码 hex）—— 同是「进行中/失败提示」，底色/字色/内边距各不相同 | `Collection.vue:2186/2187`、`QuickCollectPanel.vue:376-379` | 视觉 |
| P10 | **硬编码 hex 残留在采集域新文件**：`QuickCollectPanel.vue` 有 `#e6a23c`（qc-stage）、`#f56c6c`（counter--over）、`--surface-secondary, #f7f7f7` 等兜底 hex；`WordCountRangeInput.vue:82` 有 `#d32f2f`。它们不在 `collection-tokens.test.js` 的 SCOPE_FILES 里 ⇒ 门禁照绿、代码照脏 | `QuickCollectPanel.vue:359/360/366/378/438/444`、`WordCountRangeInput.vue:82` | 视觉 + 门禁盲区 |
| P11 | **控件尺寸不统一**：`col-select` padding 8px、`zb-select` padding 8px 10px、`batch-bar` 内 select padding 6px 8px、`col-select-sm` padding 4px 8px、`qc-input` 6px 8px —— 五种 select/input 高度在 28–36px 间跳动 | `Collection.vue:2176/2177/2178`、`BatchCollectPanel.vue:743`、`CollectedResultsList.vue:178`、`QuickCollectPanel.vue:444` | 视觉 |
| P12 | **`QuickCollectCommandDialog` 用 el-icon 而弹窗是手写 mask**（未用 `el-dialog`），与 ASR 安装弹窗（`el-dialog`）形态不一致；`qc-modal-mask` 背景 `rgba(0,0,0,.45)` 与全局 overlay 惯例不同 | `QuickCollectCommandDialog.vue:2`、`Collection.vue:384` | 视觉 |
| P13 | **「已配置/未配置」徽标、tag、badge 圆角三套**：`zb-config-badge` 10px、`cohere-tag` 32px 药丸、`card-tag` 10px、`qc-badge` 10px、`copy-origin-badge` 10px | `BatchCollectPanel.vue:719`、`cohere-design-system.css:839`、`Collection.vue:2059` | 视觉 |
| P14 | **`collection-tab-badge`（页签角标）在全仓无样式定义**：`CollectionDraftsTab.vue:11` / `CollectionCreatorTab.vue:11` 渲染 `<span class="collection-tab-badge">`，但 src 内无该规则 ⇒ 角标是**裸文本**，无底色无圆角，与「徽标」语义不符 | 全 src 检索 0 处定义 | 视觉 + 测试盲区 |
| P15 | **`col-toolbar-icon`（🔗 图标）与 select/input 混排在一行**，图标无功能（纯装饰）却占据视觉焦点；输入框 placeholder 以 `...` 结尾而非 `…` | `Collection.vue:24/32` | 视觉 |

**根因判断**：P1/P2/P11/P13 是「**没有组件级规范可依**」——每个作者按自己当时 nearest-neighbor 抄一份；P3/P14 是「**消费了不存在的类**」——抄的时候抄到了 class 名但没抄到定义（双份拷贝只拷了一半）；P4/P5/P7 是「**页面级语法缺位**」——`cohere-design-system.css` 提供了零件，但没人规定「采集页这一页怎么组合」。因此本轮的处方不是继续加零件，而是**立一份采集页组件规范并把它机械锁住**。

## 2. 范围

**做**：
- 建立采集页统一控件规范（按钮三档 / 输入控件一档 / 卡片一档 / 间距一档 / 徽标一档 / 圆角一档），落到新增 `features/collection/collection-page.css`（scoped 之外的共享层）+ `styles/tokens.css` 补槽。
- 修 P3/P14 两个死类：`is-primary`/`primary` → 统一 `col-btn--primary/secondary/danger`，并在 **CSS 契约测试**里断言「类名被消费 ⇒ 必须有定义」（本轮新增的判据，见 §8）。
- 页头/内容区统一底色与分隔（P4）；页签 aria 补全（P5）。
- 快捷操作卡按语义重排为「新建/导入」（写）+「草稿箱」（导航）+「素材来源」（外跳）三组，图标统一（P6）。
- 文案库卡片操作主次分级 + 删除 danger（P8）。
- 错误/进行中横幅统一（P9）；`QuickCollectPanel` 硬编码 hex 收编（P10）并把该文件纳入 token 门禁。
- 控件尺寸统一（P11）、徽标圆角统一（P13）、placeholder 文案规范化（P15）。
- 删除 `Collection.polish.css`（全仓零引用的死文件，49 行，与 `Collection.vue` scoped 重复定义）。

**不做**：
- 不改任何 IPC 契约、数据模型、采集/改写/批量发布业务逻辑（含 zhihu-fav-batch 通道）。
- 不改页签集合（仍是 5 个：内容采集/快捷采集/草稿箱/文案库/博主监控）与默认页签（`collect`）。
- 不改 `BatchCollectPanel` 的折叠分组行为与 `zhihu-fav-*` testid。
- 不引入新 UI 框架/新组件库；不新增全局 `app.component` 注册（QM-2 首屏性能红线）。
- 不改 `cohere-design-system.css` 的既有规则值（那是 62 个文件的共用面，动它等于全库视觉回归）；采集页规范以**本页新增层**承载，靠导入顺序覆盖。

## 3. 信息架构（改造后）

```
采集页
├─ 页头：页签（5，带 aria 完整 + 角标真样式）+ 副标题 + 剪贴板导入 / 新建草稿
├─ [内容采集页签]
│  ├─ ① URL 单条采集面板（常驻，col-panel：来源 select + 输入 + 采集/一键改写）
│  │    └─ 结果详情框（改写策略 → 创建草稿/爆款库/结合开关/风格/字数区间/改写 → 对比双栏）
│  ├─ ② 批量采集面板（BatchCollectPanel，互斥手风琴：RSS / URL 列表 / 知乎收藏夹）
│  │    └─ 统一进度块 ColProgressBlock
│  ├─ ③ 采集结果列表（CollectedResultsList）：批量操作条 + 卡片网格 + 空态
│  └─ ④ 快捷操作区（重排为三组语义，见 §4.6）
├─ [草稿箱页签] CollectionDraftsPanel
├─ [文案库页签] 卡片网格（操作分级）+ 预览弹窗
├─ [快捷采集页签] QuickCollectPanel + 指令弹窗
└─ [博主监控页签] CreatorMonitor
```

## 4. 交互逻辑与视觉规范（详细）

### 4.1 按钮三档（统一 `col-btn` 族）

新增共享类（定义在 `features/collection/collection-page.css`，由 `Collection.vue` 与域内组件共同 import）：

| 类名 | 用途 | 视觉 |
|---|---|---|
| `.col-btn--primary` | 每区唯一主操作（采集、采集并改写、创建草稿、发布、立即采集） | 主色底 + 白字，圆角 `--radius-sm`(8px)，高 32px，padding 0 14px |
| `.col-btn--secondary` | 次操作（重试、取消、查看、存入草稿、加载收藏内容） | 透明底 + 1px `--color-border` 边 + 主文字，同圆角同高度 |
| `.col-btn--danger` | 不可逆操作（删除文案、清空） | 透明底 + 1px `--color-danger` 边 + danger 字 |
| `.col-btn--ghost` | 纯文字出口（前往设置） | 无底无边，主色字，hover 加下划线 |

四条不可破：
1. **一区一主**：每个面板/区块内 primary 至多 1 个（结果详情框例外：创建草稿与去发布分属两个产物阶段，见 §4.5）。
2. **禁用态统一**：`opacity:.55; cursor:not-allowed`，不得用 `pointer-events:none`（那会让 tooltip/title 也失效，`o-disabled` 类即此模式，本轮一并收敛）。
3. **高度统一 32px**：`col-btn--*` 一律 `min-height:32px`，覆盖 `cohere-btn-primary` 的 `padding:8px 24px` 与 `card-actions button` 的 `4px 14px` 两套既有高度。
4. **死类清零**：`is-primary` 与 `primary` 两个 class 从采集域彻底移除，由 CSS 契约测试锁「消费 ⇒ 必有定义」。

⚠ 覆盖范围说明：`cohere-btn-primary` 等既有类**保留定义不动**（其它页面在用），采集域改用 `col-btn--*`。这样本页视觉统一，但不牵动 62 个文件的共用面。

### 4.2 输入控件一档（`col-field` 族）

| 类名 | 元素 | 规范 |
|---|---|---|
| `.col-field` | select / input / textarea 共用 | 高 32px（textarea 除外）、padding 0 10px、圆角 `--radius-xs`(4px)、1px `--color-border`、聚焦 1px `--color-primary` + `--color-primary-light` 外晕 |
| `.col-field--grow` | 需要撑满的（URL 输入） | `flex:1; min-width:0` |
| `.col-field--sm` | 行内小控件（字数输入、知乎数量） | 宽 88px、高 28px、字号 `--font-size-xs` |

`col-select` / `col-select-sm` / `col-input` / `zb-select` / `qc-input` / `qc-textarea` 的既有类名**保留**（测试与样式引用），但其视觉声明统一改为引用 `--col-field-*` 变量组，消除「6 个 padding 值」。

### 4.3 卡片与面板一档

| 类名 | 规范 |
|---|---|
| `.col-panel`（大面板） | 圆角 `--radius-lg`(16px)、内边距 `--spacing-5`(20px)、1px `--color-border`、`--shadow-sm`、底部间距 `--spacing-5` |
| `.col-card`（列表卡/指令卡/博主行） | 圆角 `--radius-md`(12px)、内边距 `--spacing-4`(16px)、1px `--color-border`、无阴影（靠边框分层） |
| `.col-panel__head` | 面板标题行：`display:flex; justify-content:space-between; align-items:center; margin-bottom:--spacing-4`，标题 `--font-size-base` + `--font-weight-semibold` |

**饰带（ribbon）处置**：`col-panel::before` 的 3s 无限扫光动画**保留**（上一轮 learnings #445 记载它与视觉基线的关系，且它是本页唯一品牌辨识元素），但补一条 `@media (prefers-reduced-motion: reduce)` 关闭动画——这是本轮新补的可访问性项，不改变默认观感。

### 4.4 间距与徽标一档

- 间距只允许 4 个值：`--spacing-2`(8，控件间距) / `--spacing-3`(12，卡片内分组) / `--spacing-4`(16，卡片内边距) / `--spacing-5`(20，面板间距)。`zb-mt4/mt6/mt8` 三个魔术 margin 类收敛为 `--spacing-2/3/4`。
- 徽标一档 `.col-badge`：圆角 `--radius-xs`(4px)、字号 `--font-size-xs`、padding 1px 6px；语义变体 `--ok`（success 边）/`--warn`（warning 边）/`--muted`（secondary 字）。`zb-config-badge` / `card-tag` / `cohere-tag` / `qc-badge` / `copy-origin-badge` / `collection-tab-badge` 的圆角统一为 `--radius-xs`，`collection-tab-badge` **补上真实定义**（主色底 + 白字 + 最小宽 18px + 居中，`count > 99` 显示 `99+`）。

### 4.5 结果详情框（采集主路径）

保持现有结构（`RewriteStrategyPicker` + chip 行 + 对比双栏），仅统一控件类名与间距。chip 行改名为 `.col-result__actions`，内部按 §4.1 分档：
- primary：创建草稿、（有改写结果时）去发布
- secondary：加入爆款库、AI 改写、存入草稿、取消、重试
- 纯开关：结合爆款库 / 结合个人经历（`label` + checkbox，禁用时整组 `opacity:.55` 但保留 hover 说明）

### 4.6 快捷操作区重排（P6）

六张卡改为一组三段式（DOM 仍是一个 grid，但用 `col-quick__group` 分组并加分组标题）：

| 分组标题 | 卡片 | 语义 |
|---|---|---|
| 新建 | 新建草稿 / 剪贴板导入 | 写操作（进发布页） |
| 草稿 | 草稿箱 | 导航（切页签，带条数） |
| 素材来源 | 微博热搜 / 知乎热榜 / 头条热榜 | 外跳（新标签打开） |

- 图标统一用 el-icon（`EditPen` / `DocumentCopy` / `FolderOpened` / 平台首字徽标），**移除 emoji**（✏️✧❓📰 在跨平台字体下渲染不一致，是本页「不高级」的直接来源之一）。
- `stat-value` 字号从 `--font-size-xxl`(32px) 降到 `--font-size-lg`(20px)，`stat-label` 从 `--font-size-sm` 提到 `--font-size-base`，卡片从「数据卡」观感改为「入口卡」观感。
- 保留 `data-testid="quick-drafts-box"`（既有测试与视觉用例依赖）。

### 4.7 文案库卡片操作分级（P8）

| 按钮 | 档位 | 序 |
|---|---|---|
| 改写 | primary | 1 |
| 创建草稿 | secondary | 2 |
| 编辑 / 视频创作 / 发布 | secondary | 3-5 |
| 删除 | danger | 末位 |

采集结果卡（CollectedResultsList）同表：创建草稿/发布 primary、查看/视频创作 secondary。**修正 P3：`is-primary` 死类换成 `col-btn--primary`**，并在测试里断言「primary 档的按钮真的有别于 secondary 档」——本轮把 `CollectedResultsList.test.js:77-80` 的「只断类名」升级为「断类名 + 断该类在 CSS 中有定义且与 secondary 的边框/底色不同」（CSS 契约层）。

### 4.8 页头与底色统一（P4）

- `.cohere-page-header` 在采集页加 `background: var(--color-bg-page)`（与内容区同底），去掉「上白下灰」的硬切感；分隔改用 `--color-border` 的 1px 底线（既有）。
- 页签容器 `.collection-tabs` 与 `.library-filters` 统一改名为 `.col-tabs` / `.col-filter-bar`（旧类名保留为 alias 一年，本轮仅新增不删引用），视觉同源：`--color-bg-inset` 底 + 4px 圆角 + 3px 内边距，active 项白底 + 主色字 + `--shadow-sm`。
- 页签 aria：`role="tab"` + `aria-selected` + `aria-controls="collection-tabpanel"`，内容容器补 `role="tabpanel"` + `aria-labelledby`（指向当前 active 页签按钮）。既有 `role="tablist"` 保留。

### 4.9 错误与进行中横幅统一（P9）

统一为 `.col-banner` + 语义变体：

| 变体 | 底色 | 字色 | 用途 |
|---|---|---|
| `.col-banner--error` | `--color-error-banner-bg` | `--color-error-banner-text` | 采集失败、改写失败、批量失败 |
| `.col-banner--info` | `--color-info-soft` | `--color-info-text` | 视频采集阶段、剪贴板导入成功类进行中提示 |
| `.col-banner--warn` | `--color-warning-soft` | `--color-warning` | 改写失败用原文、配额提示 |

`col-error-banner` / `col-stage-banner` / `qc-stage` 的类名保留（测试在用），视觉声明统一引用 `.col-banner` 变量组。`qc-stage` 的 `#e6a23c` 收编为 `--color-warning`。

### 4.10 弹窗统一（P12）

- `QuickCollectCommandDialog` 保持手写 mask 形态（改它牵动 `QuickCollectPanel.test.js` 的挂载断言），但视觉对齐 el-dialog：mask 背景 `rgba(23,23,32,.45)`（与全局 overlay 同值）、弹窗圆角 `--radius-lg`、标题行加底部分隔线。
- `collection-tab-badge` 补定义（见 §4.4）。

## 5. 数据校验（显式不变声明）

本轮**不新增任何数据校验**，以下既有校验逐条声明不变：

| 项 | 现状 | 本轮 |
|---|---|---|
| URL 非空 / 分享文本链接提取 | `collectUrl` 入口校验 + `extractUrlFromShareText` | 不变 |
| 采集错误分类与重试判定 | `classifyCollectError` + `RETRYABLE_CODES` | 不变 |
| 视频通道路由（域名级 + 路径级） | `isVideoPlatformUrl` | 不变 |
| 反爬站点直连 stealth | `needsStealthRoute` | 不变 |
| 知乎数量 1–100 / 全量 ≤200 / 含已采集 | `BatchCollectPanel` 内既有 | 不变 |
| 改写字数区间（min 0-5999 / max 1-6000 / max≥min） | `useWordCountValidation` | 不变 |
| 类别标签归一（≤5、丢弃非法 key） | `normalizeItemTags` | 不变 |
| 草稿空内容门禁（仅新建空白草稿开 allowEmpty） | `useCollectionDrafts.saveDraft` | 不变 |
| 批量平台预筛 / 视频池 / 单批 ≤10 视频 | `useCollectionBatchPublish` | 不变 |
| IPC 参数纯 JSON 化 | 各调用点逐字段归一 | 不变（本轮不改任何 IPC 调用） |

**新增的唯一机械校验**：CSS 类「消费 ⇒ 必有定义」契约（见 §8.3），它防的正是 P3/P14 这类「抄了类名没抄定义」的缺陷复燃。

## 6. 提示文字（全部 locale，zh/en 成对）

本轮**不新增任何用户可见文案 key**。所有改动都是「把已有的裸字符串搬进 locale」或「改类名不改字」。逐条登记：

| 位置 | 现状 | 处置 |
|---|---|---|
| `Collection.vue:12` 副标题「从各平台采集内容，或快速创建草稿」 | 裸中文 | → `collection.pageSubtitle`（新增 key，zh/en 成对） |
| `Collection.vue:32` placeholder「输入文章链接，自动采集标题、正文、封面...」 | 裸中文 + CJK 基线已登记 | → `collection.urlPlaceholder`（新增 key），**CJK 基线同步更新**（同一字符串从「模板内裸串」迁到 locale，`check-locale-sync --cjk` 的分子分母都变，属合法迁移） |
| `Collection.vue:36` 「采集中...」/「采集」 | 裸中文 + 已登记 | → `collection.collecting` / `collection.collect` |
| `Collection.vue:41-43/116-118` 「🔄 重试」 | 裸中文 + 已登记 | → `collection.retry` |
| `Collection.vue:60-63` 「✅ {title}」「· 有封面图」 | 裸中文 + 已登记 | → `collection.resultTitlePrefix` / `collection.hasCoverImage` |
| `Collection.vue:84-123` 创建草稿/结合爆款库/结合个人经历/取消 | 裸中文 | → 复用/新增：`collection.createDraft`、`collection.useViralLibrary`、`collection.usePersonalExperience`、`collection.cancel` |
| `Collection.vue:182-202` 快捷卡标签「新建草稿」「剪贴板导入」 | 裸中文 | → `collection.quickNewDraft` / `collection.quickClipboard`（草稿箱/三热榜已有 key 复用） |
| `WordCountRangeInput.vue:82` 错误字色 `#d32f2c` 是样式不是文案 | — | 收编为 `--color-error-banner-text` |

⚠ `STYLE_TO_TONE` 的中文键（轻松易懂/正式严谨/…）是**引擎 prompt 语气枚举**，非用户可见文案（既有注释已声明，CJK 基线已登记），本轮不动。

## 7. 视觉规范（token 收编映射）

### 7.1 tokens.css 新增槽（全部亮暗两档 + 契约测试登记）

| 新槽 | 亮色 | 暗色 | 用途 |
|---|---|---|---|
| `--col-field-h` | 32px | 32px | 控件基准高 |
| `--col-field-h-sm` | 28px | 28px | 行内小控件高 |
| `--col-field-pad` | 0 10px | 同 | 控件水平内边距 |
| `--col-btn-h` | 32px | 32px | 按钮基准高 |
| `--col-panel-pad` | 20px | 同 | 面板内边距 |
| `--col-card-pad` | 16px | 同 | 卡片内边距 |
| `--col-banner-pad` | 8px 12px | 同 | 横幅内边距 |
| `--color-tab-active-bg` | `#ffffff` | `#2d2d35` | 页签/筛选 active 底（此前各处硬编码白底） |
| `--shadow-tab-active` | `0 1px 3px rgba(30,27,75,.10)` | `0 1px 3px rgba(0,0,0,.4)` | 页签 active 影 |

命名口径：采集页专属槽统一 `--col-*` 前缀（与既有 `--color-*`/`--space-*`/`--radius-*` 区分，避免和 tokens.css 的通用槽混淆）；纯色值仍走 `--color-*`。

### 7.2 硬编码 hex 收编清单（P10）

| 文件:行 | 现值 | 目标 |
|---|---|---|
| `QuickCollectPanel.vue:359` | `var(--color-text-secondary, #888)` | `var(--color-text-secondary)` |
| `QuickCollectPanel.vue:360` | `var(--border, #e0e0e0)` | `var(--color-border)` |
| `QuickCollectPanel.vue:366` | `var(--color-text-secondary, #666)` | `var(--color-text-secondary)` |
| `QuickCollectPanel.vue:374` | `var(--color-text-secondary, #888)` | `var(--color-text-secondary)` |
| `QuickCollectPanel.vue:378` | `#e6a23c`（qc-stage） | `var(--color-warning)` |
| `QuickCollectPanel.vue:394` | `var(--surface-secondary, #f7f7f7)` | `var(--color-bg-inset)` |
| `QuickCollectPanel.vue:400` | `rgba(0,0,0,.45)` | `rgba(23,23,32,.45)`（对齐全局 overlay） |
| `QuickCollectPanel.vue:410` | `var(--surface, #fff)` | `var(--color-bg-card)` |
| `QuickCollectPanel.vue:421/435` | `#666` / `#999` | `var(--color-text-secondary)` / `var(--color-text-muted)` |
| `QuickCollectPanel.vue:438` | `#f56c6c` | `var(--color-danger)` |
| `QuickCollectPanel.vue:444` | `var(--border, #dcdfe6)` | `var(--color-border)` |
| `WordCountRangeInput.vue:82` | `#d32f2f` | `var(--color-error-banner-text)` |
| `Collection.vue:2193` | `var(--color-primary-light, rgba(59,130,246,.18))` | `var(--color-primary-light)`（tokens.css 亮暗均有定义，兜底可删） |

### 7.3 死文件删除

`apps/desktop/src/views/Collection.polish.css`（49 行，全仓零 import）——内容与 `Collection.vue` scoped 块重复且是亮色硬编码源头。删除，不走 safe-delete（它不在 git 索引里？先核实：`git ls-files` 命中即走 `git rm` 评审）。

## 8. 回归保护（TDD）

### 8.1 新增测试（先 RED 后 GREEN）

| 文件 | 锁什么 |
|---|---|
| `features/collection/collection-page-css-contract.test.js`（新） | ① `--col-*` 新槽在 tokens.css 亮暗两档有定义且暗色真覆盖；② 采集域 6 个文件的 `<style>` 块无 hex 字面量（SCOPE_FILES 扩到 `QuickCollectPanel.vue`/`CollectionDraftsPanel.vue`/`QuickCollectCommandDialog.vue`）；③ **「消费的类必须有定义」**——枚举 `col-btn--primary` 等在本域 .vue 的 class 用法，逐个在 `collection-page.css` 或 `tokens.css` 里找到规则；④ `is-primary`/`primary` 两个死类在采集域 0 消费 |
| `features/collection/collection-page.test.js`（新） | 挂载 `Collection.vue`：页签 5 个不变、默认 collect、`role="tabpanel"` 与 `aria-controls` 存在、快捷卡三组标题渲染、草稿箱角标 count>99 显示 `99+` |
| `styles/collection-tokens.test.js`（改） | SCOPE_FILES 增加 3 个文件；`is-primary` 死类锁 |
| `CollectedResultsList.test.js`（改） | `result-draft-*`/`result-publish-*` 断言从 `is-primary` 改为 `col-btn--primary`，并断言 `col-btn--primary` 在 CSS 中有定义（读文件） |
| `views/Collection.test.js`（改） | 副标题/placeholder/采集按钮文案改从 locale 断言（不变行为）；页签 aria 断言 |

### 8.2 既有测试必须全绿

`src/features/collection/` 14 文件 + `src/views/Collection.test.js` + `src/styles/` 全集（当前 287 例）。testid/DOM 角色/交互契约不变是红线。

### 8.3 视觉基线

`collection` / `collection-dark` 两套像素基线必漂移。按 learnings 先例：**先归因**（差异带必须落在本轮有意改动区：页头底色、页签、快捷卡、卡片内边距、按钮）→ `PIXEL_ONLY=collection` 重建 → 前后 diff 图入 `openspec/records/`。⚠ 本机 Chromium 未安装（`apps/desktop/.playwright-browsers` 不存在），视觉门禁以 CI `QG Visual` 结论为准；本机若装不上，如实登记「未本机取证」而不是声称通过。

## 9. 文件拆分与行数预算

`Collection.vue` 当前 2230 行、max-lines 登记 2721 / targets 零容差 ⇒ **净增量必须 ≤ 0**（现状 2230 < 2721，已有 491 行余量，但 targets 规则是「一行都不能涨」……核实：`evaluate()` 对 targets 文件判 `lines > ceiling` 即红，ceiling = targets[rel] = 2920；2230 < 2920 ⇒ 有 690 行空间）。仍按纪律执行：

| 文件 | 动作 | 预算 |
|---|---|---|
| `features/collection/collection-page.css` | 新增 | ~200 行 |
| `features/collection/collection-page-css-contract.test.js` | 新增 | ~120 行 |
| `features/collection/collection-page.test.js` | 新增 | ~90 行 |
| `styles/tokens.css` | +9 槽 × 2 档 | +12 行 |
| `Collection.vue` | 模板类名替换 + style 块收编 + 副标题/文案迁 locale | 净增 ≤ 0 |
| `QuickCollectPanel.vue` / `WordCountRangeInput.vue` / `CollectedResultsList.vue` / `CollectionDraftsPanel.vue` | hex 收编 + 类名统一 | 净增 ≤ 0 |
| `views/Collection.polish.css` | 删除 | −49 行 |

## 10. 验收标准

1. 按钮三档：采集域无 `is-primary`/`primary` 死类；每面板 primary ≤1；CSS 契约测试断言「消费⇒有定义」通过。
2. 控件一档：`--col-field-h` 基准高在采集域 select/input 上生效（合同测试读 CSS）。
3. 页面统一：页头与内容区同底；页签 aria 完整（tab/tabpanel/aria-controls）。
4. 快捷卡三组语义分组 + 无 emoji 图标。
5. hex 硬编码：采集域 6 文件 `<style>` 块 hex = 0（含 `QuickCollectPanel.vue`）。
6. locale 成对 + CJK 基线合法迁移（不新增裸中文字面量）。
7. 视觉：`collection` light/dark 像素归因后重建，diff 图入档。
8. QM-1 打包 + 8s 启动 stderr 干净（改了 renderer 也要跑，判据分三层）。
9. PR CI 全绿 → 自动 squash 合并 → 回填销账。

## 11. 记忆与文档收尾

- 内置记忆：`.agent_context/collection-page-ui-ue-refine.md`（gitignore，本机）。
- 外部记忆：`01-docs/learnings.md` 置顶追加（本轮可复用教训：**「消费了不存在的 class」这类缺陷，功能测试全绿也发现不了——它只能靠「消费⇒有定义」的 CSS 契约测试抓**）。
- EverOS：`POST /api/v1/memory/add` → `flush` → 落盘 episode grep 哨兵词 `collection-page-ui-ue-refine`（接口回显成功不作数）。
- 文档：本 PRD + `CHANGELOG.md` 前插 + `openspec/records/collection-page-ui-ue-refine.md`。
