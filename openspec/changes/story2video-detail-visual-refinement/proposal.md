## Why

用户感知「视频创作 → 流水线创作 → 故事讲述」详情页「视觉粗糙、散乱、不够精致」。经代码溯源收敛为 4 条可验证根因（均有文件行号证据，详见 `01-docs/PRD-S2V-PIPELINE-PAGE-UX.md` §11.1）：

- **R1（P0）列宽坍缩**：`.create-page` 缺 `width: 100%`。父 `.cohere-main` 是 `flex-direction: column`，交叉轴上的 `margin: 0 auto` 抑制 `align-self: stretch`，宽度退化为 `fit-content(max-content)` —— 设计列宽 1080px 实际约 500px，右侧大片死白。同类缺陷已第二次出现（`BUGFIX-REWRITE-PAGE-WIDTH 2026-09-16`）。
- **R2（P0）返回按钮通栏**：`.back-btn` 位于 `align-items: stretch` 的 column 容器中被拉成通栏灰条。
- **R3（P0）原生控件零定制**：`apps/desktop/src/styles/` 下 `appearance: none` / `accent-color` / `input[type=range]` 0 命中，滑杆为 Chrome 默认亮蓝，与品牌紫 `--color-primary: #5048E5` 冲突；`<select>` 为裸原生控件。
- **R4（P1）令牌双轨**：`UiButton/UiSelect/UiInput` 全部消费 `@deprecated` 的 `--apple-*`（`--color-apple-accent = #007aff` Apple 蓝），与 `--color-primary` 不同源；详情页混用 4 套按钮写法 + 原生 `button`。

次级粗糙源：`.view-tabs` 无宽度约束致尾部空灰、`.input-tab.active` 实心主色胶囊压过主 CTA、`.reset-options-link` 把真实操作降级为下划线灰文字、字符计数游离灰药丸、卡片与裸 `<h3>` 表面处理不统一、硬编码不通顺文案。

## What Changes

- **布局骨架修复**：`.create-page` 显式 `width: 100%`、详情页补 `min-width: 0`、`.view-tabs` flex 等分、`.back-btn` `align-self: flex-start`、`.action-bar` 令牌化间距与左右分组。修复影响 CreateView 全部 4 视图（编辑器/流水线/历史/结果）列宽，视觉基线随之重生成。
- **新增可复用组件**：`UiSlider.vue`（品牌紫定制滑杆，双击复位 + 键盘步长 + `--pct` 填充段）、`UiField.vue`（label/控件/hint/error/运营显隐统一容器）；新增 `video-creation-forms.css`（`.s2v-card` / `.s2v-field-grid` / 裸 range 兜底 `accent-color`）。
- **控件统一**：详情页 27 处裸 `<select>` 全量迁 `UiSelect`（新增 `optionKey`/`hint`/`error` 透传），7 处滑杆迁 `UiSlider`。
- **D2 令牌收敛（详情页子树）**：19 处双轨按钮（12 `.btn-secondary` + 7 `UiButton`）统一到 `.s2v-btn-*` 品牌紫体系；弹窗 `UiModal #footer` 内的 `UiButton` 属既有弹窗契约，不在本次范围（移交 `ui-apple-token-retirement`）。
- **视觉层级与微交互**：`.input-tab` 激活态降级、`.reset-options-link` 升级为 ghost 按钮、字符计数内嵌 textarea 右下角并加三档状态色阶、折叠面板 staggered reveal、主 CTA shimmer、统一 `:focus-visible`。
- **UE 加固**：启动按钮禁用原因可见化（`title` + 常驻提示，取首条阻塞项）、成本/时长预估占位防跳变、折叠分组展开态跨会话持久、硬编码文案迁 locale。
- **抽取偿还行数债**：`CreateView.vue` 的 `.s2v-config-sections` 整棵子树迁出为 `views/video-creation/S2vConfigPanels.vue`（6182 → 5657 行，−525），父侧 `provide('s2vPanel')` 受控访问器、子侧 `inject` 缺失 fail-closed；`optionKey` 清单抽取前后 diff 为空。
- **i18n**：`create.story2video.ui.*` 新增键 zh/en 成对（`doubleResetHint` / `sectionDefaultSuffix` / `estimatePlaceholder` / `charLimitWarning` / `charLimitReached` / `flowGuide` / `blockedReason.*`）。
- 非 BREAKING：不改任何 IPC、payload 形状、option 的 key/默认值/取值范围/显隐判定、流水线执行语义。

## Capabilities

### New Capabilities

- 无新增 capability。本次是既有 `story2video-page-ux`（页面 UX 合同）与 `desktop-ui-consistency`（UI 一致性合同）的规格增量。

### Modified Capabilities

- `story2video-page-ux`：新增「详情页列宽与页签合同」「表单控件统一实现」「禁用原因必须可见」「辅助信息防跳变」「折叠态跨会话持久」5 条需求。
- `desktop-ui-consistency`：新增「暗色文字色必须走暗色感知别名」「交互元素必须提供可见焦点与 reduced-motion 降级」「复用子树不得反向依赖父视图内部实现」3 条需求（含 `--color-text-*` 无暗色槽这一现状边界的显式说明）。

## Impact

- **受影响代码**：`apps/desktop/src/views/CreateView.vue`、`views/video-creation/S2vConfigPanels.vue`（新）、`components/UiSlider.vue`（新）、`components/UiField.vue`（新）、`components/UiSelect.vue`、`styles/create-view.css`、`styles/video-creation-forms.css`（新）、`styles/video-creation-buttons.css`、`locales/zh.js` / `en.js`、`main.js`（样式导入顺序）。
- **受影响测试**：新增 `UiSlider.test.js` / `UiField.test.js` / `S2vConfigPanels.test.js` / `story2video-ue-contract.test.js`；视觉基线新增 `create-story2video-detail.png`、重生成 `create-editor` / `create-pipeline` / `create-history` / `create-result` 4 张。
- **不受影响**：`apps/desktop/electron/`、`packages/rpa-engine/`（未触碰 require 链，QM-1 完整打包不在必经路径）。
- **债务预算**：`scripts/check-debt-budget.js` 的 `filesOver500` 92 < 基线 93（余量 1）；`MAX_FILE_LINES` 基线只降不升。`create-view.css` 停在 496 行 —— 详情页的「`.s2v-btn-*` 排版承接」规则若写进该文件会变 502 行、把 `filesOver500` 顶到基线（余量归零），故写入 `video-creation-forms.css`。
- **风险**：中 — R1 修复连带改变另 3 视图列宽（已用基线重生成 + 逐张肉眼核对 + 暗色探针吸收）；抽取遗漏 `s2vOptionVisible` 守卫（已用 optionKey 清单脚本化 diff 防护）；`inject` 缺失静默不渲染（已 fail-closed 抛错 + 单测覆盖）。
- **依赖**：无新增第三方依赖。
- **遗留**：全站 `UiButton/UiSelect/UiInput` 的 `--apple-*` → `--color-*` 收敛、`--color-text-*` 暗色槽补齐 → 见 `ui-apple-token-retirement` change。
