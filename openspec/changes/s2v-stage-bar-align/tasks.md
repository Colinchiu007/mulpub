# s2v-stage-bar-align 任务清单

## 1. 回归测试（TDD RED → GREEN）

- [x] 1.1 `apps/desktop/src/views/video-creation/StageProgress.test.js` 新增 `describe("StageProgress 子进度条统一对齐（2026-10-19）")`，3 例：
  - 完成阶段条形 `aria-valuenow=100` + `width: 100%`，四阶段集合大小为 1
  - optimize 完成态但快照缺 `percent` ⇒ 补齐 100（锁根因）
  - running 阶段保持真实 `37%` 不被抬到 100（防假完成）
- [x] 1.2 RED 实证：未改实现时第 2 例失败（`bar.exists()` 为 false，子进度条整条不渲染）
- [x] 1.3 GREEN：实现后 28/28 通过

## 2. 实现

- [x] 2.1 `apps/desktop/src/views/video-creation/StageProgress.vue` `stageProgressPercent()`：
  - 抽出 `hasStagePercent`（有限数 + 值域）判定，替代原 `Number.isFinite` 单条件（原条件会把 NaN 路径外的越界值也当合法）
  - 合法 percent 优先返回；compose 旧快照降级路径不变
  - 新增 `stage.status === 'completed'` ⇒ 返回 100 的对齐补齐
  - 注释写明根因、50px 实测差、skipped 不补的理由
- [x] 2.2 渲染级验证（临时探针，跑完已按 R0 铁律走 `safe-delete.js` 回收）：截图同款四阶段 fill style 全为 `width: 100%`

## 3. 质量门禁

- [x] 3.1 `src/views/video-creation/` 142 例通过
- [x] 3.2 `CreateView.test.js` 300 例通过
- [x] 3.3 `electron/services/story2video-stages.test.js` 154 例通过
- [x] 3.4 `electron/services/pipeline-engine.test.js` 通过
- [x] 3.5 `eslint` 两文件 rc=0
- [x] 3.6 `check-debt-budget.js` PASS（filesOver500 95/95 未增）
- [x] 3.7 `check-no-brand-residue.js` PASS
- [x] 3.8 `check-locale-sync.js --pair-base origin/main` PASS（zh/en 变更=false）
- [x] 3.9 QM-4 视觉回归：19/20 通过；唯一失败 `collection` 1.44% 经 stash A/B 对照确认与本次无关（差异图 SHA-256 两次完全相同）
- [x] 3.10 行数硬线：`StageProgress.vue` 299 行、`StageProgress.test.js` 473 行，均 < 500

## 4. 提交与落地

- [x] 4.1 openspec change 提案落 `openspec/changes/s2v-stage-bar-align/proposal.md`
- [x] 4.2 执行记录落 `openspec/records/s2v-stage-bar-align.md`
- [x] 4.3 commit + push + PR（#4043）
- [x] 4.4 `classify-docs-only.js` 判定 `docs-only=false files=7` ⇒ 走完整质量节拍（符合预期：含运行时代码）
- [x] 4.5 `check-pr-exec-record.js --mode=enforce` OK（本 PR 携带执行记录 1 篇）
- [ ] 4.6 CI 全绿后按 AGENTS.md「PR 自动合并」判据自动 squash 合并
