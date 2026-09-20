## Why

桌面端渲染层存在**两套并行的设计 token 轨道**，且第二套已被标记 `@deprecated`：

- `styles/tokens.css` 是权威值层（品牌紫 `--color-primary: #5048E5`）。
- `styles/apple-design-tokens.css` 是 Stitch 批次遗留的只读别名层（`--apple-*` → `--color-apple-*`，其中 `--color-apple-accent = #007aff` Apple 蓝）。文件头 L5-L7 明写「值冻结零视觉回归；是否与全局语义色合并由后续批次拍板」「`@deprecated` 只读别名层 —— 新代码禁止消费 `--apple-*` 变量」。

实测（`apps/desktop/src` 全量正则扫描）：

| 事实 | 数值 |
|------|------|
| `--apple-*` 出现总次数 | 341 次 / 8 文件 |
| 其中 `apple-design-tokens.css` 自身定义 | 59 次 / 59 变量 |
| **真实消费点** | **282 次 / 7 文件** |
| `history-page.css` | 190 次（43 个变量）—— 单文件最大债源 |
| `components/UiModal.vue` | 29 次 |
| `components/UiButton.vue` | 28 次 |
| `components/UiInput.vue` | 16 次 |
| `components/ConfigProfileManager.vue` | 15 次 |
| `styles/create-view.css` | 2 次（`.gen-video-modal-content` / `.pipeline-progress-modal-content` 的 `--apple-surface-primary` 背景引用） |
| `views/CreateView.vue` | 2 次（**仅注释提及**，非消费） |
| `components/UiSelect.vue` | 0 次（已在 2026-09-20 详情页批次完成局部收敛） |

比双轨更严重的是**暗色盲区**：`tokens.css` 全文只有 1 个 `[data-theme="dark"]` 块、重定义 31 个变量，而

- `--color-apple-*` 17 个槽位 → **0 个有暗色覆盖**；
- `--color-text-strong` / `--color-text-primary` / `--color-text-secondary` / `--color-text-muted` / `--color-primary-light` / `--text` → **全部无暗色覆盖**（`--color-primary` 无覆盖是 `desktop-ui-consistency` 既有合同，属正确行为）。

2026-09-20 的详情页批次已实证过一次后果：把 12 处 `.btn-secondary` 换成 `.s2v-btn-secondary`（消费 `--text`）后，暗色下文字实测 `rgb(26,26,30)` 落在背景 `rgb(35,35,41)` 上，**完全不可读**。当时的修法是在 `[data-theme="dark"]` 分支改走 `cohere-design-system.css` 的暗色感知别名（`--ink` / `--muted` / `--surface` / `--color-primary-dark-tint`），属**绕过**而非**根治**。根治必须补齐 token 层，否则每个新组件都会重踩一次。

## What Changes

- **令牌单一来源收口**：`--apple-*` 消费点 282 → 0；`apple-design-tokens.css` 保留为迁移期 shim 或直接删除，`--color-apple-*` 槽位随消费点清零后一并移除。

  关键事实：`apple-design-tokens.css` **只有颜色转发到 `--color-apple-*`**（L12-L37），而字体/间距/圆角/阴影/动效（L40-L91）是**各自独立的字面值**，所以下面的映射并非全部保值：

  | 类别 | 映射 | 是否保值 |
  |------|------|---------|
  | 颜色 | `--apple-accent → --color-primary`、`--apple-accent-hover → --color-primary-hover`、`--apple-ink-primary → --color-text-strong`、`--apple-ink-secondary → --color-text-secondary`、`--apple-ink-tertiary → --color-text-muted`、`--apple-surface-primary → --color-bg-card`、`--apple-surface-secondary/tertiary → --color-bg-inset`、`--apple-border(-subtle) → --color-border(-strong)`、`--apple-error/success/warning/info(-bg) → --color-danger/…` | ❌ 语义对应但值不同（`#007aff → #5048E5`）**——视觉会变** |
  | 字号 | `--apple-size-{sm,base,md,lg,xl} → --font-size-{sm,base,md,lg,xl}`（13/15/17/20/24 完全一致）；`--apple-size-xs 11px` vs `--font-size-xs 12px`、`--apple-size-xxl 28px` vs `--font-size-xxl 32px` | ⚠️ xs / xxl **不保值**，需先定尺 |
  | 间距 | `--apple-space-{1,2,3,4,5,6,8,10} → --spacing-{1..10}`（4/8/12/16/20/24/32/40 一致） | ✅ 保值 |
  | 圆角 | `--apple-radius-{sm,md,lg,xl} 6/10/14/18px` vs `--radius-{sm,md,lg,xl} 8/12/16/20px`；pill 两侧等价（`--apple-radius-pill 9999px` ≈ `--radius-full`） | ❌ **全部不保值**，需拍板取哪套尺 |
  | 字重 / 字体族 / 行高 / 动效 | `--apple-weight-*` / `--apple-font-*` / `--apple-leading-*` / `--apple-duration-*` / `--apple-ease-*` | ⚠️ `tokens.css` **无对应槽位**，必须先新增或逐点内联 |
  | 阴影 | `--apple-shadow-{sm,md,lg}`；`tokens.css` 只有 `--shadow-float`（`0 2px 8px rgba(30,27,75,.08)`，与 `--apple-shadow-md` 同几何不同色相）与 `--shadow-sidebar-active` | ⚠️ **无通用阴影级差**，需先引入 `--shadow-sm/md/lg` |
- **补齐 token 暗色槽**：`tokens.css` 的 `[data-theme="dark"]` 增补 `--color-text-strong` / `--color-text-primary` / `--color-text-secondary` / `--color-text-muted` / `--color-primary-light`（以及评估 `--text` 的去留：若保留则必须给暗色值，若废弃则删除并迁移全部消费点）。补齐后 `cohere-design-system.css` 的 `--ink` / `--muted` 别名层收敛为纯转发，不再承担「暗色救火」职责。
- **主色不变**：`--color-primary` 保持 `#5048e5` 且暗色不覆盖（既有合同），本 change 不改主色取值。
- **暗色基线通道**（可选同批次或拆出）：`apps/desktop/tests/visual-testing/` 的 runner 增加主题参数与 `*-dark.png` 基线命名，使暗色回归从「人工计算样式探针」升级为门禁。
- 按爆炸半径分片推进：① `UiButton` / `UiInput` / `UiModal` / `ConfigProfileManager` 组件层（同时决定 `UiButton` 的 scoped 特异性策略，见 design）→ ② `create-view.css` 2 处弹窗背景 → ③ `history-page.css` 190 处 → ④ 删除 alias 层与 `--color-apple-*` 槽位 → ⑤ token 暗色槽补齐（可与 ① 并行，但必须在 ④ 之前落地）。

## Capabilities

### New Capabilities

- 无。

### Modified Capabilities

- `desktop-ui-consistency`：修订「设计 token 单一来源」—— 把「主色定标 `#5048e5` + 禁止新增主题色字面量」扩展为「`@deprecated` 别名层不得存在活跃消费者」，并把「暗色文字色走别名」升级为「token 层必须自带暗色覆盖，别名层只做语义转发」。

## Impact

- **受影响代码**：`styles/apple-design-tokens.css`（删除或降级为迁移期 shim）、`styles/tokens.css`（暗色槽补齐 + 移除 `--color-apple-*`）、`styles/cohere-design-system.css`（别名层收敛）、`components/UiButton.vue` / `UiInput.vue` / `UiModal.vue` / `ConfigProfileManager.vue` / `UiCard.vue` / `UiBadge.vue`、`styles/history-page.css`、`styles/create-view.css`。
- **视觉影响**：**大面积** —— `--apple-accent` 从 Apple 蓝变品牌紫会改变全站所有 `UiButton` primary、`UiInput` focus、`UiModal` 强调色的观感；`history-page.css` 190 处涉及历史页全部视觉。**因此必须全量重生成视觉基线并逐张核对**，且需暗色基线通道先行，否则暗色回归无法被门禁捕获。
- **不受影响**：IPC / store / payload / 业务语义 / i18n 文案。
- **风险**：高 —— 爆炸半径覆盖全站；`UiButton` 的 scoped 选择器特异性 (0,2,0) 使「外部加类覆盖」无效，收敛必须在组件内部完成或改变其 scoped 结构。
- **依赖**：建议先完成「暗色基线通道」，再做 token 补齐，最后删 alias 层。
- **与 2026-09-20 详情页批次的边界**：该批次已完成 `UiSelect.vue` 局部收敛与详情页按钮/表单面（19 处）双轨清零，并在 PRD-S2V-PIPELINE-PAGE-UX §11.7 / §11.11 登记本 change 为遗留项。本 change 不得回退该批次已确立的「新代码禁止消费 `--apple-*`」约束。
