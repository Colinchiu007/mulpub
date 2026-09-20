## Context

`apple-design-tokens.css` 头部注释已把决策显式推迟：「值冻结零视觉回归；是否与全局语义色合并由后续批次拍板」。本 change 就是那个「后续批次」。design 记录的是**必须先拍板的三个问题**，不是实现步骤。

## Decision Point 1：圆角与字号取哪一套尺

`--apple-radius-{sm,md,lg,xl}` = 6/10/14/18px，`--radius-{sm,md,lg,xl}` = 8/12/16/20px；`--apple-size-xs` 11px vs `--font-size-xs` 12px，`--apple-size-xxl` 28px vs `--font-size-xxl` 32px。两套尺同时活在线上，同一类组件（如卡片）在不同页面圆角差 2px 且无规律。

- **推荐**：以 `tokens.css` 为准（它是 `desktop-ui-consistency` 已认定的「唯一 token 文件」），`--apple-*` 侧全部丢弃自身值改指权威令牌。
- **代价**：`history-page.css`（190 处）与全部 `Ui*` 组件的圆角/字号会统一变化 → 全站视觉基线重生成 + 逐张核对。
- **被否**：保留 `--apple-*` 数值、只改「谁引用谁」（把 `--radius-*` 改成 6/10/14/18）。这会把 Stitch 尺烘进全站权威令牌，等于用一次大回归换掉另一次大回归，且让 `check-font-size-scale` 门禁基线全部重标。

## Decision Point 2：缺失的语义槽（字重 / 字体族 / 行高 / 动效 / 阴影级差）先补还是先内联

`tokens.css` 没有 `--font-weight-*`、`--font-family-*`、`--leading-*`、`--duration-*`、`--ease-*`，也没有通用 `--shadow-sm/md/lg`。`--apple-*` 侧有。清零 `--apple-*` 之前必须先决定：

- **推荐**：先在这些语义上补齐权威令牌（阴影级差用现有 `--shadow-float` 的色相口径 `rgba(30,27,75,α)` 保持一致），再迁移消费点。
- **被否**：迁移时就地写 `font-weight: 600` 这类字面量 —— 会撞 `check-color-literals` / `check-font-size-scale` 的既有门禁精神，并制造第三套真相。

## Decision Point 3：`UiButton` 的 scoped 特异性问题必须一并解决

2026-09-20 详情页批次实证：给 `<UiButton class="s2v-btn-primary">` 加类**完全无效** —— `UiButton.vue` 内 scoped 的 `.ui-btn-primary[data-v-x]` 特异性 (0,2,0) 压过外部全局类 (0,1,0)。所以「收敛到品牌紫」只有两条路：

- **(a) 组件内部换 token 来源**（推荐）：`UiButton` 的 `--apple-accent` → `--color-primary`，保持 props/variants API 不变，全站 `UiButton` primary 一次性变紫。回归集中、可控、可测。
- **(b) 组件全部换成原生 `<button>` + 全局类**：详情页子树已用这招（19 处），但把它推广到全站等于放弃共享按钮组件，与 `desktop-ui-consistency`「同类交互唯一实现」相悖 → 不采纳为全站策略。

**混合边界**：`UiModal #footer`、`UiButton` 的既有调用点走 (a)；已经在业务页用原生 button + `.s2v-btn-*` 的保持不动，不再新增第三种写法。

## Sequencing（爆炸半径控制）

```
① 暗色基线通道（测试基建，独立可先行）
② tokens.css 补暗色槽 + 补缺失语义槽（新增不改动 → 零视觉回归）
③ UiButton / UiInput / UiModal / ConfigProfileManager 组件层收敛（回归集中在组件）
④ create-view.css 2 处弹窗背景
⑤ history-page.css 190 处（单文件单 PR，最大一块回归）
⑥ 删除 --apple-* alias 层与 --color-apple-* 槽位 + 加静态门禁禁止回潮
```

② 必须在 ⑥ 之前；① 建议在 ③ 之前，否则暗色回归无人看守。

## Migration Guard

收口完成后 SHALL 增加一条静态检查（并入 `check-frontend-consistency` 或独立脚本）：`apps/desktop/src/**` 中 `var(--apple-` 命中数必须为 0，防止别名层删除后又被手写回来。当前基线：282。

## Risks

| 风险 | 处置 |
|------|------|
| 全站 primary 变紫导致既有基线大面积失败 | 按 ③④⑤ 分片，每片独立 PR + 定向 `PIXEL_ONLY` 重生成，禁止一次性全量重生成（会把无关环境漂移烘进基线） |
| 暗色下新问题无人发现 | ① 先行；未建通道前，禁止只做浅色核对 |
| `history-page.css` 43 个变量交织，改一个动全身 | 单文件单 PR；先出「变量 → 新令牌 → 值差异」三栏清单再动手 |
| 别名层删除后回潮 | Migration Guard 静态门禁 |

## Out of Scope

- 不改 `--color-primary` 取值（`#5048e5`，暗色不覆盖 —— `desktop-ui-consistency` 既有合同）。
- 不重做 Stitch 设计语言本身；本 change 只做「双轨合一」，不引入新视觉方向。
