## Why

用户报障（截图红框标注）：「视频创作 → 流水线运行进度浮层」中，**「提示词优化」阶段的子进度条比其他阶段短**，破坏阶段清单的视觉对齐，需要统一对齐。

### 根因（像素级取证，非目测）

对用户截图（1194×1154）逐行扫描四个已完成阶段的子进度条（行 y=235/376/518/661，条高 5px）：

| 阶段 | 填充左端 | 填充右端 | 填充宽 |
| --- | --- | --- | --- |
| 文案拆分 | 86 | 1018 | 928 |
| 内容增强 | 86 | 1018 | 928 |
| **提示词优化** | 86 | **968** | **878**（短 50px） |
| AI 视频场景选择 | 86 | 1018 | 928 |

**排除的假设**（都做过实测，不是猜）：

1. **不是「轨道长度不同」**：四条左端同为 x=86，`stage-status` 列左边界同为 x≈1019/1036，四张卡片同宽 ⇒ 轨道本身等长。
2. **不是「CSS 双来源冲突」**：`stage-progress.css` 与 `create-view.css` 都定义了 `.stage-sub-*`，但 `create-view.css:156-158` 只追加 `display:flex; width:100%` 到**外层** `.stage-sub-progress`，未动内层 `.stage-sub-bar`，不改变条长。
3. **不是「optimize percent 偏小」**：`story2video-stages.js:2716` 完成时发射 `percent: 100`，语义正确。

**真实根因**：`StageProgress.vue` 的 `stageProgressPercent()` 只在 `stage.progress.percent` 为**合法有限数**时才返回数值，否则返回 `null`；模板 `v-if="stageProgressPercent(stage) !== null"` 于是**整条不渲染**。optimize 的历史/续跑快照里 `stage.progress` 可能只带 `messageKey/summaryKey/detail` 而不带 `percent`（`optimize_progress` 只驱动 detail 文案，不驱动条形），该阶段就没有子进度条，视觉上比其余完成阶段「短一截」。

## What Changes

- **`apps/desktop/src/views/video-creation/StageProgress.vue`**：`stageProgressPercent()` 增加**完成态对齐补齐**——`stage.status === 'completed'` 且取不到合法 `percent` 时返回 `100`，使全部已完成阶段子进度条满格等长。
  - `skipped` **不补**（该状态本就无进度语义，补 100% 会是假完成）。
  - `running/pending/failed/waiting` 等**不补**，保持真实 percent，避免把「进行中」画成「已完成」。
  - 越界（<0 或 >100）与非有限值仍旧返回 null/不渲染，既有校验不放松。
- **回归测试**（`StageProgress.test.js` 新增 `describe("StageProgress 子进度条统一对齐")`，3 例）：
  1. 四个完成阶段条形 `aria-valuenow` 全为 `100` 且 `width: 100%`，集合大小为 1（等长）；
  2. optimize 完成态但快照缺 `percent` ⇒ 补齐 100（锁根因）；
  3. running 阶段保持真实 `37%` 不被抬到 100（防假完成）。

## 影响面

- 复用 `StageProgress.vue` 的四处入口：`CreateView.vue`（story2video 默认前缀）、`HotTopics.vue`（一键生成视频弹窗）、`film-auto/FilmAutoPanel.vue`（`testidPrefix="film-auto"`）。三者共用同一 `stageProgressPercent()`，一并获得对齐修复，无入口差异。
- 纯渲染层变更，不触碰主进程阶段执行、IPC 契约、`optimize_progress` 数据语义。
- 无新增用户可见文案，`locales/zh.js` / `en.js` 零改动（locale 成对门禁已实测 PASS）。

## 验证

- `src/views/video-creation/` 全量 142 例通过；`CreateView.test.js` 300 例通过；`electron/services/story2video-stages.test.js` 154 例通过；`pipeline-engine.test.js` 通过。
- `eslint` 两文件零告警。
- 视觉回归（QM-4）A/B 对照：本次唯一失败项 `collection` 页 1.44%（阈值 1%）经** stash 对照实验**确认与本次改动无关——有改动/无改动两次运行的差异图 SHA-256 完全相同（`089A8AA5…58AE5`），misMatchPercentage 均为 1.44%，属既有基线差异。
- `check-debt-budget` PASS；`check-no-brand-residue` PASS；`check-locale-sync --pair-base origin/main` PASS。
