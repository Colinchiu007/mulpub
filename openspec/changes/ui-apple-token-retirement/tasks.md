# Tasks: UI Apple Token 双轨退役（backlog）

**状态**：提案已建立，未开始实现。依赖 `story2video-detail-visual-refinement`（2026-09-20 详情页批次）先落地，以便沿用其确立的「新代码禁止消费 `--apple-*`」约束与暗色核对手法。

**基线（动手前重测，勿沿用本文件数字）**：`--apple-*` 消费点 282 处 / 7 文件；`tokens.css` 暗色块仅重定义 31 个变量；`--color-apple-*` 17 个槽位 0 个暗色覆盖。

## Task 1: 视觉基线增加暗色通道

**Status**: pending
**Risk**: Low（测试基建，不改运行行为）
**Files**: `apps/desktop/tests/visual-testing/scripts/run-pixel-tests.js`、`test-runner.js`

### Acceptance Criteria
- [ ] runner 支持主题参数（如 `THEME=dark`），注入 `data-theme="dark"` 后逐视图截图
- [ ] 基线命名区分主题（`<view>.png` / `<view>-dark.png`），互不覆盖
- [ ] CI GATE-7 增跑暗色一遍，失败信息与浅色同格式
- [ ] 既有 18 张浅色基线在改造后仍逐张通过（证明改造零视觉影响）

---

## Task 2: `tokens.css` 补齐缺失语义槽与暗色槽

**Status**: pending
**Risk**: Low（**只新增、不改动既有值 → 零视觉回归**）
**Files**: `apps/desktop/src/styles/tokens.css`

### Acceptance Criteria
- [ ] 新增 `--font-weight-regular/medium/semibold/bold`、`--font-family-display/text/mono`、`--leading-tight/normal/relaxed`、`--duration-fast/normal/slow`、`--ease-default/spring/in-out`
- [ ] 新增通用阴影级差 `--shadow-sm/md/lg`，色相与既有 `--shadow-float` 的 `rgba(30,27,75,α)` 口径一致
- [ ] `[data-theme="dark"]` 增补 `--color-text-strong` / `--color-text-primary` / `--color-text-secondary` / `--color-text-muted` / `--color-primary-light`
- [ ] `--text` 去留拍板：保留则给暗色值，废弃则清空消费点（当前 `.s2v-btn-secondary` 曾因此踩坑）
- [ ] `--color-primary` 保持不覆盖（既有合同）
- [ ] 全量浅色基线不变（证明是纯新增）

---

## Task 3: 组件层收敛（`UiButton` / `UiInput` / `UiModal` / `ConfigProfileManager`）

**Status**: pending
**Risk**: High（全站观感：Apple 蓝 → 品牌紫）
**Files**: `components/UiButton.vue`(28)、`UiInput.vue`(16)、`UiModal.vue`(29)、`ConfigProfileManager.vue`(15)

### Acceptance Criteria
- [ ] 采取 design 的 (a) 方案：组件**内部**改 token 来源，props/emits/slots API 完全不变
- [ ] 不得要求调用方「加类覆盖」（scoped 特异性 (0,2,0) 会压过外部全局类，已实证无效）
- [ ] 每个组件一份「旧 `--apple-*` → 新令牌 → 值差异」三栏清单，随 PR 附上
- [ ] 组件单测全绿 + 受影响的视图测试全绿
- [ ] 相关视图基线**定向**重生成（`PIXEL_ONLY`），浅色 + 暗色各一遍并逐张核对
- [ ] 完成后 `apps/desktop/src/components` 下 `var(--apple-` 命中 = 0

---

## Task 4: `create-view.css` 弹窗域 2 处

**Status**: pending
**Risk**: Low
**Files**: `apps/desktop/src/styles/create-view.css`

### Acceptance Criteria
- [ ] `.gen-video-modal-content` / `.pipeline-progress-modal-content` 的 `var(--apple-surface-primary, var(--surface, #fff))` → `var(--color-bg-card)`
- [ ] 注意 `create-view.css` 现 496 行，改动不得使其越过 500 行硬线（`check-debt-budget` 的 `filesOver500` 余量仅 1）
- [ ] 弹窗基线（含暗色）定向重生成核对

---

## Task 5: `history-page.css` 190 处（最大一块）

**Status**: pending
**Risk**: High
**Files**: `apps/desktop/src/styles/history-page.css`

### Acceptance Criteria
- [ ] 先产出 43 个变量的「旧 → 新 → 值差异」清单并拍板圆角/字号取尺（design Decision Point 1）
- [ ] 单文件单 PR，不与其它收敛混提
- [ ] 历史视图浅色 + 暗色基线定向重生成，逐张肉眼核对
- [ ] `check-color-literals` / `check-font-size-scale` / `check-frontend-consistency` 全绿

---

## Task 6: 删除别名层并加回潮门禁

**Status**: pending
**Risk**: Medium
**Files**: `styles/apple-design-tokens.css`、`styles/tokens.css`、`.github/scripts/check-frontend-consistency.js`、`main.js`

### Acceptance Criteria
- [ ] `var(--apple-` 在 `apps/desktop/src/**` 命中 = 0（含 `main.js` 的导入）
- [ ] 删除 `apple-design-tokens.css` 与 `tokens.css` 的 17 个 `--color-apple-*` 槽位
- [ ] 移除 `main.js` / `cohere-design-system.css` 中对 alias 层的导入
- [ ] 新增静态门禁：`var(--apple-` 命中数必须为 0，非 0 则 CI 失败并列出行号
- [ ] 全量基线（浅 + 暗）跑一遍通过
- [ ] `cohere-design-system.css` 的 `--ink` / `--muted` / `--surface` 收敛为对 `tokens.css` 的纯转发，不再承担暗色救火

---

## Task 7: 文档收口

**Status**: pending
**Risk**: Low

### Acceptance Criteria
- [ ] `01-docs/CHANGELOG.md` 记为 BREAKING（视觉）
- [ ] `docs/desktop-ui-layout-spec.md` 与 `docs/frontend-interaction-spec.md` 中的令牌指引改指权威令牌，删除 `--apple-*` 示例
- [ ] `desktop-ui-consistency` spec 归档本 change 的 delta
- [ ] `.quality-gates.md` 记录每片的基线重生成证据
