---
record: publish-history-thumb-portrait
task: 发布记录列表缩略图由横版改为竖屏 3:4 显示（四个断面统一 + 像素基线双通道刷新）
date: 2026-10-14
sync_status: PENDING
sync_reason: 本 PR 尚未合并，merge SHA 还不存在
sync_backfill_owner: 下一个会话（回填与销账必须同一次提交）
---

## 本次执行记录：发布记录缩略图竖屏 3:4（publish-history-thumb-portrait，2026-10-14）【混合 PR】

- **变更类型**：运行时代码（`apps/desktop/src/views/PublishHistory.vue` 的 scoped CSS + 同目录测试）+ 视觉基线两图 ⇒ `node scripts/classify-docs-only.js` 判 **false**（混合 PR，不走 docs-only 快通道）。
- **隔离**：`scripts/start-mp-task.ps1 -TaskName publish-history-thumb-portrait` 创建 worktree `D:\Data\projects\mp-worktrees\mp-publish-history-thumb-portrait`（D 盘）+ 裸分支 `publish-history-thumb-portrait`（基线 `origin/main` = `cc6a4f988`）。`pre-code-edit-guard.ps1` 在 worktree 内 rc=0 放行；`verify-worktree-deps.js` OK（11 项消费方解析到本 worktree）。
- **需求**（用户原话）：「应用的发布页，发布记录列表的缩略图，目前是横版尺寸，改成竖屏的尺寸显示（3:4比例）」。

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | PASS | worktree `mp-publish-history-thumb-portrait` + 裸分支；`pre-code-edit-guard` rc=0；共享根全程保持 `main` clean |
| TDD | PASS | **先写测试后实现**：5 条比例锁先跑成 **5 failed \| 78 skipped**，逐条精确报出现状横版尺寸（200x112 / 108x82 / 78x66 / 68x60）；实现后 **83 passed** |
| 变异反证 | PASS | 把四处 `width/height/flex-basis` **同时**退回原始横版尺寸 ⇒ 5 条锁 **5/5 全红**（证明锁在跑，不是恒真式）；还原后复跑 83/83 绿 |
| 单测 | PASS | `PublishHistory.test.js` **83 passed**（原 78 + 新增 5） |
| 相关域回归 | PASS | 5 文件 **137 passed**：`PublishHistory.test.js` + `publish-history-filter-scan.test.js` + `publish-history-metrics.test.js` + `useHistoryCoverThumbnails.test.js` + `href-scheme-contract.test.js` |
| 行数门禁 | PASS | `check-max-lines.js` rc=0（超限 97 / 挂账 97 / 墓碑 3 / 点名还账 20，无新增）；`PublishHistory.vue` 1285 → 1293 行（登记 1394 零容差内）；测试文件未挂账（testLimit 1500） |
| ESLint | PASS | 改动文件 **0 error**；1 个 warning（`auditValue` 未使用）为 main 既有（#2824 记录在案），非本 diff 引入 |
| locale 成对 | N/A（本刀零文案改动） | CJK 基线扫描 PASS（当前 1224 ≤ 基线 1374，无新增硬编码）；未触碰 `locales/zh.js` / `en.js` |
| 前端一致性组 | PASS | `check-vue-style-parse` / `check-css-var-defined` / `check-font-size-scale` / `check-color-literals` / `check-scoped-root` / `check-frontend-consistency` / `check-route-registry` **7/7 rc=0** |
| QM-1 打包 | N/A | 未改 `apps/desktop/electron/` 或 `packages/rpa-engine/`（纯渲染层 scoped CSS），按规则不触发 |
| QM-4 视觉 | PASS（基线已刷新，明暗双通道人工审核） | 见下方专节 |
| 视觉框架自锁 | PASS | `run-pixel-tests.test.js` 13 passed + `visual-readiness-classification.test.js` 15 passed + `check-baseline-freshness.test.js` 36 passed |
| QM-6 双模型评审 | 未执行 | 本刀为纯 CSS 尺寸调整，无跨模块逻辑，未派双模型评审；如实记录 |
| 远程同步 | PENDING | 待本 PR 合并后回填 merge SHA 并销账（回填与销账同次提交） |

### QM-4 视觉：为什么必须刷新基线，以及刷新前做了什么

改动只碰 `.record-preview` 的尺寸，但缩略图在每张卡片上都有 ⇒ 像素门禁**必然**超阈。判据分三步走，不允许"红了就刷"：

1. **干净基线对照**（`git stash` 掉本分支改动后跑同一命令）：`publish-history` **PASSED（0/1 失败）** ⇒ 该视图在 main 上不是既有红，失败由本刀引入。
2. **人工审核差异图**：浅色差异图（3.96%）与暗色差异图（5.62%）的差异**全部集中在缩略图矩形区域**，页面骨架、工具栏、统计列零差异 ⇒ 是本次预期变更，不是误拍。
3. **人工审核新渲染**：明暗两张 `*-current.png` 逐一目视核对，缩略图确为竖版（明显比原横版窄而高），`图文`/`视频` 角标位置未破坏。

三步都过，才更新 `base-screenshots/publish-history.png` 与 `publish-history-dark.png`；复跑明暗双通道均 **PASSED（100%）**。

**基线入库核验**（AGENTS.md 记录的 `.gitignore` 静默陷阱）：`git check-ignore -v` 对两份 PNG 返回 **rc=1（无命中）**，且二者都以 `M` 出现在 `git status` ⇒ 被 git 正常跟踪，没有"基线永远缺"。

**基线取自本 worktree 自己的 dev server**（5199，`--strictPort` 独占，未借用他人 5174）：`run-pixel-tests.js` 的 `preflightVisualTarget` 明确要求 `TEST_URL` 指向本 worktree 构建，否则会"拿别人的界面当自己的证据"。

### 实现口径：四处断面、一个比例

| 断面 | 改前（横版） | 改后（竖版 3:4） |
|------|------|------|
| 列表视图 `.record-preview` | 200 × 112 | 150 × 200 |
| 网格视图 `.grid-view .record-preview` | 108 × 82 | 84 × 112 |
| 720px 窄屏 | 78 × 66 | 63 × 84 |
| 460px 窄屏 | 68 × 60 | 54 × 72 |

三处刻意选择：

- **宽度以高度为基准推导**（`height × 3/4`），不各写一个"看起来对"的近似值 —— 近似值会在某次调高度时悄悄漂成非 3:4，而这种漂移在视觉上几乎看不出来。推导关系写进注释。
- **显式写 `flex-basis`**（列表视图原先是 `flex: 0 0 150px` 简写）：窄容器下 flex 收缩会让实际比例漂回横版，而简写形式下"basis 与 width 是否一致"无法被机械断言。测试因此要求 `flex-basis === width`。
- **角标（`<small>` 内容类型）保持右下角**：竖版容器更高，右下角仍是最不挡主体的位置，未位移。

### 为什么判据读 CSS 原文而不是渲染结果

jsdom **不布局**：`width`/`height` 的计算值在测试环境里恒为 0，去量渲染结果等于什么都没量。故判据读组件自身的 scoped CSS 原文（与既有用例「移动端记录主体使用可收缩布局」同一范式），并额外补一条**补集断言**：四处断面一律不得出现 `width > height` 的规则 —— 只断言"四处是 3:4"挡不住有人在响应式块里另起一条 `.record-preview` 覆盖（那会让四条正向断言全绿而实际仍是横版）。

### 过程留痕（如实）

- **`flex-basis` 首轮漏了显式声明**：实现后 4/5 绿、列表视图 1 红，报 `flex-basis 缺失或非 px`。这不是测试写错，是实现只写了 `flex: 0 0 150px` 简写 —— 补显式声明后转绿。该红位证明了这条断言真在校验。
- **两次跑错视觉入口**：`pnpm exec vitest ... --single` 报 `Unknown option`（`--single` 是 `all-views.visual.test.js` 自身的参数，须 `node` 直跑）；随后 `TEST_URL` 一开始写成了 `VISUAL_BASE_URL`，被静默忽略后仍连 5174 ⇒ `ERR_CONNECTION_REFUSED`。环境变量名最终以源码为准（`process.env.TEST_URL`）。
- **门禁副产物已还原**：`contrast-audit.js` 跑完会写 `contrast-audit-diag.txt` / `contrast-audit-report.json`，二者是审计过程产物、非本任务改动，已 `git checkout --` 精确还原，未混入提交。

### 遗留（不假装已闭合）

- **暗色 misMatch 5.62% 高于浅色 3.96%**：同为缩略图区域差异，已人工看过暗色差异图确认无第二处变化；但暗色通道下的封面占位/边框对比更强，故占比更高。属预期，不是回归。
- **未做 QM-1 打包**：本刀纯渲染层 CSS，按 AGENTS.md 规则不触发；若后续在 electron 侧改封面写库字段，需另跑打包链。
- **QM-6 双模型评审未跑**：纯尺寸调整无跨模块逻辑，按成本未派；如后续要在缩略图上叠加交互（点击放大、封面缺失占位图），应补一轮。
