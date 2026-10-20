# PRD：采集页视觉精致化（collection-page-visual-polish，2026-10-20）

> 承接 `collection-page-ui-ue-refine`（PR #3864，已合并）。上一轮解决的是**机制性缺陷**
> （消费了不存在的类、分级不成立、死文件、硬编码 hex），观感改善有限。用户复看后反馈
> 「视觉上还是不够精致」。
>
> 本轮定位不同：只动**视觉骨架与节奏**（间距体系、文本截断、密度、色彩噪音、状态区分），
> 不再重做机制。所有结论均以**代码取证**为依据（行号可查），不凭观感。

## 1. 目标与非目标

### 1.1 目标（可验收）

用户在不读文档的前提下打开采集页，应能感到三件事：

1. **安静**：页面上没有任何主动抢注意力的循环动画。
2. **齐整**：任意两张卡片的标题基线、元信息基线、操作区基线在同一条水平线上。
3. **有主次**：每张卡片第一眼能看到一个主操作，其余操作退为次级。

### 1.2 非目标（明确不做）

- 不改数据模型、IPC 契约、5 个页签集合、默认页签 `collect`、`zhihu-fav-*` testid。
- 不改 `cohere-design-system.css` 的**全局**规则（只允许在采集域作用域内覆盖）。
- 不引入新依赖、不换图标库、不重排页面区块顺序。
- 不动 `tokens.css` 的既有槽位语义（只允许新增采集域专用别名）。

## 2. 诊断（每条都带代码坐标）

| # | 问题 | 证据 | 为什么观感差 |
|---|---|---|---|
| D1 | 每个面板顶部有 **4px 橙红渐变**、`3s infinite` 无限扫光饰带 | `collection-page.css:146-161`；`--color-ribbon: linear-gradient(90deg,#ea580c,#fb923c,#fdba74)`（`tokens.css:186`） | 页面有 2+ 面板即多条饰带**不同步扫动**，持续抢注意力；橙红与紫主色**双色系冲突**。成熟产品（Linear/Stripe/Notion/Vercel）均无此元素 |
| D2 | 项目并存**两套间距体系** | `cohere-design-system.css:66-70` → `--space-xs:6px / --space-sm:8px / --space-lg:16px / --space-xl:24px`（**2px 起、6px 非 4 倍数**）；`tokens.css` → `--spacing-1..N` = 4/8/12/16（**4 基数**） | 同一张卡片里外间距来自两套刻度，无法形成节奏 |
| D3 | 卡片标题无行数上限、无显式行高 | `cohere-design-system.css:723-727` 只有 `font-size/weight/color` | 长标题换行 4–5 行，卡片高度失控 |
| D4 | 卡片内用非刻度间距 `gap:14px`、`margin-top:2px` | `cohere-design-system.css:698`、`:728` | 14px 不在 4/8 刻度上，基线差 2px 累积成"看得出但说不清"的歪 |
| D5 | 卡片内按钮压到 28px 高 / 12px 字 | `collection-page.css:343`（`.col-card-actions .col-btn`） | 低于国际最小可点高度（Material 36px / Stripe 32px / Apple HIG 44px），点击信心不足 |
| D6 | 4 个操作**同权重并列**（2 primary + 2 secondary，同尺寸） | `CollectedResultsList.vue:100-105` | 主次只靠颜色，密度上完全平等 |
| D7 | `.cohere-card` 有 `cursor:pointer` 但卡片本体不可点 | `cohere-design-system.css:695` + 模板仅 `card-icon`/`card-info` 绑定 | 鼠标承诺了行为却无响应 |
| D8 | 空/错数据卡与正常卡外观完全一致 | `CollectedResultsList.vue:85-95`（「百度安全验证」「无标题 · 0字」） | 脏数据混在正常结果里，用户无法一眼排除 |

## 3. 设计决策与外部依据

| # | 决策 | 依据 |
|---|---|---|
| P1 | **删除饰带**，面板改为 `1px 边框 + 极淡阴影` | Linear / Stripe / Notion / Vercel 面板均无装饰性色条；`shadow-sm` 已有槽位 |
| P2 | 采集域间距**全部收敛到 4px 刻度**（`--spacing-*`），卡片内 12px、卡片间 16px | 8pt grid 的 4px 半格是通用最小单位（Material / Polaris / Carbon 一致） |
| P3 | 标题 `-webkit-line-clamp: 2` + `line-height: 1.45` + 固定占位 | Notion gallery、Linear issues 均 2 行截断；固定占位保证等高 |
| P4 | 卡片内 `gap` 统一 12px，元信息 `margin-top` 4px | P2 同源 |
| P5 | 卡片内按钮统一 **32px 高 / 13px 字**（用规范层 `--col-btn-h`） | Stripe 32px、Material 36px 之间取 32px 以控密度 |
| P6 | 操作分级改为 **1 primary（创建草稿）+ 1 secondary（发布）+ 其余收进"更多"**；「更多」用原生 `<details>` 或现有 el-dropdown？**→ 用 hover 浮层易丢可发现性，最终选「主操作可见 + 次级操作常驻但更轻」** | 见 §4 决策记录 |
| P7 | 移除 `.cohere-card` 在采集域的 `cursor:pointer`，卡片本体不做整卡点击 | 整卡可点会与内部按钮冲突；改为信息区可点并加 hover 反馈（已有），但卡片本体恢复默认光标 |
| P8 | 空/错数据卡加 `col-result-card--invalid` 态：浅琥珀底 + 警示图标 + 「重新采集」引导 | 错误态需与正常态**视觉可分**（NN/g：错误状态必须可辨识） |

### 4. 决策记录：P6 为什么不用「收进更多菜单」

备选 A：hover 才显示次级操作（Notion 式）—— **否决**：桌面端鼠标离开即消失，可发现性差；
且本应用主用户是批量操作者，频繁使用「编辑/视频创作」。

备选 B：收进 `...` 弹出菜单 —— **否决**：需要新增弹层与焦点管理，且 4 个操作里 2 个是高频，
藏起来反而增加点击成本。

**采用方案 C**：主操作（创建草稿，primary 实心）+ 次级操作（发布、编辑、视频创作）用
`col-btn--ghost`（无边框、hover 才显底），并在**尺寸上降一档**（32px 高 / 13px 字 → ghost 用 30px）。
这样「分级」由**填充 vs 幽灵 + 尺寸差**双重表达，无需隐藏。

## 5. 交互与状态

| 状态 | 表现 | 提示文字 |
|---|---|---|
| 卡片 hover | 边框转 `--color-border-strong`，阴影 `--shadow-md`，`transition: 120ms` | 无 |
| 信息区 hover | 标题转主色（既有行为保留） | 无 |
| 标题超 2 行 | 截断加省略号，`title` 属性承载全文 | tooltip 原文 |
| 数据无效（无标题且 0 字 / 验证页） | 卡左 3px 琥珀条 + 标题前警示图标 + 底部「重新采集」文字按钮 | `collection.invalidResultHint`：该条看起来是验证页或空结果，建议重新采集 |
| 空列表 | 既有 `EmptyState`（不改） | 既有 |
| 批量条出现 | 既有（不改） | 既有 |

## 6. 数据校验（本轮涉及的两条）

1. **无效结果判定**（纯展示判定，不改数据）：
   - `invalid = !title?.trim() || wordCount === 0`
   - 两者均需按 `String().trim()` 归一，`0` 与 `'0'` 同判。
   - 与 `collected-content-guard.js#isVerificationContent` **不合并**：后者判「验证页文字特征」，
     本轮只在**已有该判定结果**时叠加展示；不重复实现正则。
2. **标题截断**是纯 CSS，不改 `item.title`；`title` 属性必须写**原文全文**（不截断），
   否则 tooltip 也看不全。

## 7. 验收标准

- [ ] A1 `git grep -c "col-panel-ribbon"` = 0（饰带与关键帧全删）
- [ ] A2 采集域 `.col-card-actions .col-btn` 的 `min-height` = 32px（契约测试断言）
- [ ] A3 `.cohere-card .card-platform` 在采集域含 `-webkit-line-clamp: 2` 与 `line-height`
- [ ] A4 采集域新样式**不出现** `gap:14px` / `margin-top:2px` / `--space-*` 变量
- [ ] A5 无效结果卡带 `col-result-card--invalid` 类，且有 `data-testid="result-invalid-*"`
- [ ] A6 既有测试全绿（采集域 353 例 + 视觉契约 + 页面测试）
- [ ] A7 QG Visual 基线经 CI 同源回填后 0 px
- [ ] A8 `prefers-reduced-motion` 下无残留动画

## 8. 风险与回滚

| 风险 | 缓解 |
|---|---|
| 删饰带被视作品牌识别度丢失 | 饰带是 2026-10 引入的装饰（`--color-ribbon` 仅在采集域使用），非品牌资产；改动可单 commit 回滚 |
| 间距统一引发其他页面回归 | 只改采集域选择器（`.col-*` / `html .col-panel`），不动 `cohere-design-system.css` 全局值 |
| 视觉基线大面积变化 | 预期内；按既有流程用 CI 同源渲染回填基线（QM-4） |
| 无效卡高亮误伤正常数据 | 判定条件极窄（无标题 AND 0 字），且只加视觉类不改数据与行为 |
