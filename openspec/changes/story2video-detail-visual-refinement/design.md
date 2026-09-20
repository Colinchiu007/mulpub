## Context

字段级视觉与交互合同已落在 `01-docs/PRD-S2V-PIPELINE-PAGE-UX.md` §11（13 小节），布局合同落在 `docs/desktop-ui-layout-spec.md` §15，交互范式落在 `docs/frontend-interaction-spec.md` §10。本 design 只记录**架构级定案**与**实现偏离**，不重复字段表。

## Decision 1：`S2vConfigPanels.vue` 的状态绑定 = provide/inject 受控访问器

**结论**：父组件 `CreateView.vue` `provide('s2vPanel', { ... })`，投影的是**同名标识符 + 同一响应式对象引用**（`getConfig: () => this.s2vConfig` 等），子组件 `inject('s2vPanel')`，`inject` 缺失时 **fail-closed 抛错**。

**理由取舍**：`s2vConfig` 是 `CreateView` 的 data 字段，且有 `deep: true` watcher 驱动 `s2vActiveConfigProfile = ''` + `scheduleS2VLastOptionsSave()`；`stores/` 下无对应 store（核查 11 个 store，0 命中）。目标是「净减少 CreateView 行数」，因此绑定机制必须几乎不增加声明量。

**被否方案**：
- *逐字段 `update:modelValue`*：需 40+ 个 prop/emit 声明，抽取后代码量不降反升。
- *整体 `v-model` + 浅拷贝新对象*：破坏 `s2vConfig` 引用稳定性，波及 `cloneForIpc` / `applyS2VPipelineDefaults` / `pickS2VConfigProfileFields` 三处消费点，风险不成比例。
- *新建 pinia store*：架构级变更，超出已确认的「详情页 + 共享骨架」范围。
- *计划原文的 `setValue(path, value)` path setter*：见偏离 D1 —— 写点已是 `v-model` 直绑，加 path setter 需 40+ 代理声明且引入第二写路径。

**适用与失效条件**：适用于「父持有 data 状态 + 已有 deep watcher 副作用 + 仅做视图切分」的抽取。若未来 `s2vConfig` 需要跨视图共享或被持久层直接消费，则本决策失效，应改为 store 单一来源并重接 watcher 副作用。

## Decision 2（D2）：令牌双轨本次只收敛详情页子树，不改 `--color-apple-accent` 取值

**结论**：详情页主/次/幽灵/危险/运行控制按钮统一改用 `video-creation-buttons.css` 的 `.s2v-btn-*`（品牌紫 + 暗色覆盖 + `:focus-visible`），共 19 处；新增组件一律消费 `tokens.css` 的 `--color-*` 与 `cohere-design-system` 的暗色感知别名，禁止 `--apple-*`。全站 `UiButton/UiSelect/UiInput` 的 `--apple-*` 收敛移交 `ui-apple-token-retirement` backlog change。

**理由取舍**：`apple-design-tokens.css#L5-L7` 明确「值冻结零视觉回归；是否与全局语义色合并由后续批次拍板」。改 accent 取值会一次性改变全站所有 `UiButton` primary 颜色，导致全站视觉基线大面积重跑，把不可控范围混进本 PR。

**被否方案**：直接 `--color-apple-accent → #5048E5`（视觉爆炸半径不可控）；给 `UiButton` 加 `.s2v-btn-*` 类（**无效** —— `UiButton.vue` scoped 的 `.ui-btn-primary[data-v-x]` 特异性 (0,2,0) 压过外部 (0,1,0)，必须换成原生 `<button>`，见偏离 D8）。

**边界**：`UiModal #footer` 内的 `UiButton` 属既有弹窗契约（§6.1）管辖，本次不改。

## Decision 3：暗色文字色走暗色感知别名，不补齐 `tokens.css` 的暗色槽

**结论**：`[data-theme="dark"]` 下需要文字色时，一律用 `cohere-design-system.css` 的 `--ink` / `--muted` / `--surface` / `--error`，而非 `tokens.css` 的 `--color-text-*` / `--text`。

**理由**：`tokens.css` 的 `[data-theme="dark"]` 只重定义 31 个槽，**未覆盖** `--color-text-strong/primary/secondary/muted`、`--color-primary-light`、`--text`。本次把 12 处 `.btn-secondary` 换成 `.s2v-btn-secondary` 后，探针实测暗色下文字 `rgb(26,26,30)` 落在背景 `rgb(35,35,41)` 上 —— 完全不可读。修法只在 dark 分支写覆盖、浅色分支不写 → 对既有基线零影响。

**为何不在本次补 `tokens.css` 暗色槽**：那会一次性改变全站所有消费 `--color-text-*` 的暗色渲染，属独立变更 → 登记 `ui-apple-token-retirement`。

## Decision 4：详情页排版承接规则放 `video-creation-forms.css`

`.s2v-btn-secondary` 不带 `margin-top`，而原 `.btn-secondary` 自带 `margin-top: 8px`；模板编辑器栅格另有 `min-height: 38px`。不补就是「换了类名顺手换了排版」。但这两条规则若写进 `create-view.css`（现 496 行）会使其达 502 行，越过 `check-debt-budget.js` 的 500 行硬线，把 `filesOver500` 从 92 顶到基线 93（余量归零）。故写入 `video-creation-forms.css` 并在注释里写明原因。

## Deviations from the approved plan

字段级差异见 PRD §11.11 的 D1–D8 登记表（绑定投影、`reserveError` 显式开启、旁白音量去掉 `%` 后缀、折叠态复用 `ui.expandedGroups` 通道、`.view-tabs` 用 flex 等分取代硬编码 4 列栅格、暗色改为探针人工核对、基线脚本路径与 `UPDATE_BASELINE` 语义、D2 必须做完 19 处）。每条均附「计划原文 / 实现终态 / 为什么」，无一条是缩小范围。

## Risks

| 风险 | 吸收方式 |
|------|---------|
| R1 修复连带改变另 3 视图列宽 | 基线两步式重生成（先删后 `PIXEL_ONLY`）+ 逐张肉眼核对 + 禁止全量重生成 |
| 抽取遗漏 `v-if="s2vOptionVisible(...)"` | 抽取前后 optionKey 清单脚本化 diff 必须为空 |
| `inject` 缺失静默不渲染 | fail-closed 抛错 + `UiField.test.js` / `S2vConfigPanels.test.js` 覆盖 |
| hash-only 导航不重载文档，像素用例互相污染 | `prepare` 钩子显式点回「流水线创作」页签 |
| 暗色缺陷肉眼难发现（本次已发生一次） | Playwright 注入 `data-theme="dark"` 后读 `getComputedStyle` 的探针核对；长期解（暗色基线通道）归 backlog |

## Open Questions

无。`--apple-*` 全量收敛与 `tokens.css` 暗色槽补齐已作为独立 change（`ui-apple-token-retirement`）登记，不阻塞本次交付。
