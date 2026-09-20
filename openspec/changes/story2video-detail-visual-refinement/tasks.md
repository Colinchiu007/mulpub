# Tasks: 故事讲述流水线详情页精致化（视觉 + UE）

分支 `codex/ui-story2video-detail-polish`｜worktree `D:/Data/projects/mp-worktrees/mp-ui-story2video-detail-polish`

## Task 1: 布局骨架修复（R1 / R2，P0）

**Status**: done
**Risk**: Medium（连带影响 CreateView 全部 4 视图）
**Files**: `apps/desktop/src/styles/create-view.css`

### Acceptance Criteria
- [x] `.create-page` 显式 `width: 100%`，1920 视口下列宽实测 1080px，右侧无死白
- [x] `.create-page--pipeline-detail` 补 `min-width: 0`，子项溢出不撑破列
- [x] `.view-tabs` flex 等分（`flex: 1 1 0; min-width: 0`）+ `max-width: 100%`，尾部无空灰；`.view-tab.active` 去 `transform: scale()` 改 `box-shadow` + `font-weight`
- [x] `.back-btn` `align-self: flex-start`，不再通栏；详情页隐藏顶部 `nav-arrow` 消除语义重复
- [x] `.action-bar` 间距令牌化 + 主 CTA 左 / 辅助操作右分组，§2.1.6 滚动合同不回退

---

## Task 2: 新增 `UiSlider` / `UiField` 与 `video-creation-forms.css`

**Status**: done
**Risk**: Low（纯新增，向后兼容）
**Files**: `components/UiSlider.vue`（新）、`components/UiField.vue`（新）、`styles/video-creation-forms.css`（新）、`main.js`

### Acceptance Criteria
- [x] `UiSlider`：`appearance: none` 定制 track/thumb，`--pct` 填充段品牌紫；双击复位、↑↓ = step、PageUp/Down = step×10；`disabled`、`suffix`、`hint`；`prefers-reduced-motion` 关过渡
- [x] `UiField`：`optionKey` 驱动显隐（沿用 `s2vOptionVisible` 的 fail-open 语义，不得绕过）；`error` → `aria-invalid` + `role="alert"`；`inject` 缺失 fail-closed
- [x] `video-creation-forms.css` 由 `main.js` 在 `video-creation-buttons.css` **之后**导入（层叠顺序契约）
- [x] `.s2v-range-native` 兜底：未迁移的裸 `<input type="range">` 统一 `accent-color: var(--color-primary)`

---

## Task 3: 抽取 `S2vConfigPanels.vue`（偿还行数债）

**Status**: done
**Risk**: High（触碰 6000+ 行视图）
**Files**: `views/video-creation/S2vConfigPanels.vue`（新）、`views/video-creation/s2v-panel-contract.js`（新）、`views/CreateView.vue`

### Acceptance Criteria
- [x] `CreateView.vue` 6182 → 5657 行（−525，达成 ≥500 目标）；`S2vConfigPanels.vue` 753 行 < 6497 门禁线
- [x] 纯搬运 + 绑定改写：option 的 key / 默认值 / 取值范围 / 显隐判定零改动
- [x] 抽取前后 `optionKey` 清单脚本化 diff 为空
- [x] `s2vConfig` deep watcher 与 `scheduleS2VLastOptionsSave` 节流行为逐字节不变
- [x] 分组顺序与归属严格保持 PRD §9 目录（`basic / visual / videoEnhance / voice / advanced / publish`）
- [x] `check-debt-budget` 的 `MAX_FILE_LINES` 基线未上调

---

## Task 4: 控件统一 + 视觉层级 + 微交互 + UE 加固

**Status**: done
**Risk**: Medium
**Files**: `S2vConfigPanels.vue`、`CreateView.vue`、`components/UiSelect.vue`、`styles/create-view.css`、`styles/video-creation-forms.css`

### Acceptance Criteria
- [x] 详情页裸 `<select>` = 0（探针实测 `bareSelects: 0`），27 处迁 `UiSelect`（`optionKey`/`hint`/`error` 透传）；`UiSelect.vue` 组件内 `--apple-*` 消费点局部收敛为 0
- [x] 7 处滑杆迁 `UiSlider`
- [x] `.input-tab.active` 由实心主色降级为浅底 + 主色边框；容器 `role="tablist"`，tab 带 `aria-selected`
- [x] `.reset-options-link` 三兄弟升为 `.s2v-btn-ghost`，`data-testid` 全部保留
- [x] 字符计数内嵌 textarea 右下角，三档色阶（`<90%` muted / `≥90%` warning / 达上限 danger + `aria-live="polite"`）
- [x] 折叠面板 staggered reveal（`--stagger-index` 数组下标）+ summary 摘要值 + 「（默认）」后缀
- [x] 主 CTA shimmer；所有新增交互元素统一 `:focus-visible`
- [x] 启动按钮禁用时 `title` + 常驻提示显示首条阻塞原因
- [x] 预估摘要无内容时显示占位（固定最小高度，不塌陷）
- [x] 折叠展开态跨会话持久（复用既有 `ui.expandedGroups` 通道，读失败回落默认展开）

---

## Task 5: D2 令牌双轨收敛（详情页子树）

**Status**: done
**Risk**: Medium
**Files**: `CreateView.vue`、`S2vConfigPanels.vue`、`styles/video-creation-buttons.css`、`styles/video-creation-forms.css`

### Acceptance Criteria
- [x] 19 处双轨清零：12 `.btn-secondary` + 7 `UiButton` → `.s2v-btn-*`；**详情页按钮面 `--apple-*` / `UiButton` 残留 = 0**
- [x] 弹窗域残留（`.gen-video-modal-content` / `.pipeline-progress-modal-content` 的 2 处 `--apple-surface-primary` 背景引用）属 §6.1 弹窗契约，移交 `ui-apple-token-retirement`
- [x] `UiButton` 必须换成原生 `<button>`（scoped 特异性 (0,2,0) 压过外部 (0,1,0)，加类无效）
- [x] 补排版承接：`.config-item > .s2v-btn-secondary { margin-top: 8px }` + 模板编辑器 `min-height: 38px`（写在 `video-creation-forms.css`，避免 `create-view.css` 越过 500 行硬线）
- [x] `.s2v-btn-primary` fallback `#409eff`（Element 蓝）→ `var(--color-primary, #5048E5)`
- [x] 边界：`UiModal #footer` 内 `UiButton` 属 §6.1 弹窗契约，不改，移交 `ui-apple-token-retirement`

---

## Task 6: 暗色模式回归修复

**Status**: done
**Risk**: Low（本次改动引入后自查发现）
**Files**: `styles/video-creation-buttons.css`

### Acceptance Criteria
- [x] 探针发现 `.s2v-btn-secondary` 暗色下文字 `rgb(26,26,30)` on `rgb(35,35,41)` 不可读（`--text` 在 `[data-theme="dark"]` 未重定义）
- [x] 只在 dark 分支改用 `--ink` / `--muted` / `--surface` / `--color-primary-dark-tint`；浅色分支不写覆盖 → 既有基线零影响
- [x] 复测：暗色 `color rgb(232,232,237)` on `rgb(35,35,41)` ✓
- [x] 补 `@media (prefers-reduced-motion: reduce)` 关闭 `.s2v-btn-*` 的 transition 与 transform

---

## Task 7: i18n（zh/en 成对）

**Status**: done
**Risk**: Low（CI Gate 7 硬拦截）
**Files**: `locales/zh.js`、`locales/en.js`

### Acceptance Criteria
- [x] `create.story2video.ui.*` 新增键 zh/en **同 commit 成对**：`doubleResetHint` / `sectionDefaultSuffix` / `estimatePlaceholder` / `charLimitWarning` / `charLimitReached` / `flowGuide` / `blockedReason.{noPipeline,starting,running,noText,noAsset,invalidRange,unavailable}`
- [x] 原硬编码不通顺文案「点击"启动流水线"即可进行流水线自动多个阶段，不需逐步确认。」→ `flowGuide`
- [x] 术语对齐 `01-docs/i18n-glossary.md`（流水线/阶段/旁白/分镜既有译法）
- [x] `check-locale-sync --keys`（1037 成对）与 `--cjk`（0 新增）PASS

---

## Task 8: 测试与门禁

**Status**: done
**Risk**: Low
**Files**: 4 个新测试文件、`tests/visual-testing/scripts/run-pixel-tests.js`、5 张基线 png

### Acceptance Criteria
- [x] vitest 定向套件（6 文件）329/329 绿，EXIT=0
- [x] 新增 `create-story2video-detail` 像素视图（`prepare` 钩子：先点回「流水线创作」页签再选 `story2video-compose` 卡片）
- [x] 重生成 `create-editor` / `create-pipeline` / `create-history` / `create-result` 4 张（R1 连带），逐张肉眼核对；**禁止全量重生成**
- [x] 像素 18/18 通过 @ `PIXEL_THRESHOLD=0.06`
- [x] 9 项门禁 rc=0：`check-vue-style-parse` / `check-color-literals` / `check-font-size-scale` / `check-frontend-consistency` / `check-locale-sync --pair-base|--keys|--cjk` / `verify-worktree-deps` / `check-debt-budget`（`filesOver500` 92 < 93）
- [x] 未触碰 `apps/desktop/electron/` 与 `packages/rpa-engine/` → QM-1 完整打包不在必经路径

---

## Task 9: 文档同步

**Status**: done
**Risk**: Low
**Files**: `01-docs/PRD-S2V-PIPELINE-PAGE-UX.md`、`01-docs/CHANGELOG.md`、`docs/desktop-ui-layout-spec.md`、`docs/frontend-interaction-spec.md`、`.quality-gates.md`、本 change + `ui-apple-token-retirement`

### Acceptance Criteria
- [x] PRD 新增 §11（13 小节，字段级：布局列宽合同含 flex-auto-margin 陷阱推导、控件显示项/取值/步长/默认值、校验规则与边界、交互逻辑、zh/en 提示文字对照表、暗色与 reduced-motion 降级、§2.1.6 不可回退声明、D2 决策与 backlog 指针、偏离登记 D1–D8、测试与门禁合同、验收标准）
- [x] `desktop-ui-layout-spec.md` §15 + 变更历史 v1.6
- [x] `frontend-interaction-spec.md` §10（滑杆 / 字段容器 / 禁用原因必须可见 / 辅助信息防跳变 / 焦点与动效）
- [x] `CHANGELOG.md` 收口条目（修复 / 新增 / 变更 / 抽取 / 测试 / i18n / 文档）
- [x] `.quality-gates.md` 追加本次门禁执行记录，并修正 4 个 `check-*` 脚本真实路径为 `.github/scripts/`、债务脚本为 `scripts/check-debt-budget.js`

---

## Task 10: 记忆沉淀（三处）

**Status**: pending
**Risk**: N/A

### Acceptance Criteria
- [ ] 内置记忆：`common_pitfalls_experience`（flex column + `margin:0 auto` 抑制 stretch → 列宽坍缩；`--color-text-*` / `--text` 无暗色槽；hash 导航不重载文档污染像素用例；`UPDATE_BASELINE` 不覆盖已有基线；向接近 500 行的 CSS 加规则推高 `filesOver500`）+ `important_decision_experience`（D1 / D2 四元组）
- [ ] 外部记忆：追加 `~/.gstack/projects/multi-publish/learnings.jsonl`
- [ ] EverOS：新建 `everos/data/knowledge/create-page-flex-width-collapse/index.md`，并在 `frontend-ui-consistency-p0/p1`、`desktop-ui-layout` 条目补交叉引用

---

## Task 11: 交付

**Status**: pending
**Risk**: Low

### Acceptance Criteria
- [ ] 推送 `codex/ui-story2video-detail-polish` → `gh pr create`（body 含根因表 + §11 契约指针 + 测试与门禁证据 + 基线 diff 说明 + 偏离登记 D1–D8）
- [ ] `gh pr merge --squash --auto`（CI 通过自动合并）
- [ ] `scripts/safe-worktree-remove.ps1` 收尾（R1–R5 基线 diff 校验），共享根保持 `main` clean
