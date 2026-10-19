---
branch: s2v-stage-bar-align
date: 2026-10-19
change: s2v-stage-bar-align
type: bugfix
---

# 执行记录：流水线进度浮层阶段子进度条统一对齐（s2v-stage-bar-align）

## 问题

视频创作流水线运行进度浮层中，「提示词优化」阶段的子进度条比其他阶段短（用户截图红框标注），需统一对齐。

## 根因（像素级取证，非目测）

对用户截图逐行扫描四个已完成阶段子进度条（条高 5px，行 y=235/376/518/661）：

| 阶段 | 填充左端 | 填充右端 | 填充宽 |
| --- | --- | --- | --- |
| 文案拆分 | 86 | 1018 | 928 |
| 内容增强 | 86 | 1018 | 928 |
| **提示词优化** | 86 | **968** | **878**（短 50px） |
| AI 视频场景选择 | 86 | 1018 | 928 |

排除的三个假设（均实测）：

1. **不是轨道长度不同**——四条左端同为 x=86，`stage-status` 列左边界同为 x≈1019/1036。
2. **不是 CSS 双来源冲突**——`stage-progress.css` 与 `create-view.css` 都定义 `.stage-sub-*`，但后者（:156-158）只给外层 `.stage-sub-progress` 加 `display:flex; width:100%`，未动内层 `.stage-sub-bar`，不改变条长。
3. **不是 optimize percent 偏小**——`story2video-stages.js:2716` 完成时发射 `percent: 100`，语义正确。

**真实根因**：`StageProgress.vue` 的 `stageProgressPercent()` 仅在 `stage.progress.percent` 为合法有限数时返回值，否则返回 `null`；模板据此 `v-if` 整条不渲染。optimize 的历史/续跑快照里 `stage.progress` 常只带 `messageKey/summaryKey/detail` 而不带 `percent`（`optimize_progress` 只驱动 detail 文案，不驱动条形），该阶段遂无子进度条，视觉上比其余完成阶段短一截。

## 修复

`stageProgressPercent()` 增加完成态对齐补齐：`stage.status === 'completed'` 且取不到合法 `percent` 时返回 `100`。

- `skipped` **不补**（无进度语义，补 100% 即假完成）。
- `running/pending/failed/waiting` 等**不补**，保持真实 percent。
- 越界与非有限值仍旧不渲染，既有校验不放松。

## 测试（TDD）

- RED：未改实现时根因用例失败（`bar.exists()` 为 false）。
- GREEN：实现后 28/28。
- 新增 3 例：完成阶段等长（集合大小 1）、optimize 缺 percent 补齐 100、running 保持 37% 不被抬。
- 渲染级探针（已回收）实证：截图同款四阶段 fill style 全为 `width: 100%`。

## 门禁结果

| 项 | 结果 |
| --- | --- |
| `src/views/video-creation/` | 142 例通过 |
| `CreateView.test.js` | 300 例通过 |
| `story2video-stages.test.js` | 154 例通过 |
| `pipeline-engine.test.js` | 通过 |
| eslint（两文件） | rc=0 |
| `check-debt-budget.js` | PASS（filesOver500 95/95 未增） |
| `check-no-brand-residue.js` | PASS |
| `check-locale-sync.js --pair-base origin/main` | PASS（zh/en 变更=false） |
| 行数硬线 | vue 299 / test 473，均 < 500 |
| QM-4 视觉回归 | 19/20 通过；唯一失败 `collection` 1.44% 经 stash A/B 对照确认与本次无关 |

### QM-4 collection 失败的 A/B 判据

`git stash` 掉本次组件改动后重跑，两次运行的差异图 SHA-256 完全相同（`089A8AA535A0251DF7258AF44F75C412D6123C2B09E6BD33F0A527E5AD358AE5`），misMatchPercentage 均为 1.44% ⇒ 既有基线差异，非本次引入。

## 影响面

复用 `StageProgress.vue` 的三处入口（`CreateView.vue`、`HotTopics.vue`、`film-auto/FilmAutoPanel.vue`）共用同一方法，一并获得对齐修复。纯渲染层变更，不触碰主进程阶段执行、IPC 契约与 `optimize_progress` 数据语义；无新增用户可见文案。

| 远程同步 | 由门禁推导 |
