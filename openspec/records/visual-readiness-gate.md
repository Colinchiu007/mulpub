---
record: visual-readiness-gate
task: 让「视图从未渲染出来」成为硬失败——修 film-engineering 就绪选择器 + Gate 7 按退出码 3 阻断（就绪类与像素类分档）
date: 2026-10-11
sync_status: PENDING
sync_reason: 本 PR 尚未合并，merge SHA 还不存在
sync_backfill_owner: 下一个动这些文档的会话（PR 号必须回读：`gh pr list --repo Colinchiu007/Multi-Publish --head visual-readiness-gate --json number,state,headRefOid`，不得凭印象；合并后按 `git log origin/main --grep='(#NNNN)$' --format=%H|%cI` 取 merge SHA，把下表「远程同步」行改写为 PASS + SHA + 时间，并**同一次**整段删除 frontmatter 的三个 sync_* 字段）
---

## 本次执行记录：视觉就绪门禁（visual-readiness-gate，2026-10-11）

- 变更类型与隔离声明：**混合 PR**（`apps/desktop/tests/**` + `.github/workflows` + `.github/scripts` + 文档）⇒ 必须走隔离 worktree `mp-visual-readiness-gate`（分支 `visual-readiness-gate`），且 `classify-docs-only` 判 `docs-only=false`，重型门禁不得短路。
- 规格与方案：`01-docs/PRD-VISUAL-READINESS-GATE-2026-10-11.md`（QM-5 五步 + R1–R11 场景矩阵 + §5 实测反证与六格行为表 + §6 不在范围登记）。

### 做了什么

1. **根因**：`routeView('film-engineering', '/film-engineering', '.film-canvas-view')` 指向的节点**不在该路由上** —— `/film-engineering` 渲染 Hub（`.film-hub-view`），canvas 是 `v-if="isMounted('canvas')"` 的懒挂载标签页（默认 `auto`），所以每次 run 都烧满 15s 就绪预算后抛超时。锚点改为 `.film-hub-view .fh-title`。
2. **分档**：新增唯一实现 `apps/desktop/tests/visual-testing/ready-classification.js`，按 `error.code`（`ERR_VISUAL_APP_READY_TIMEOUT` / `ERR_VISUAL_READY_SELECTOR_TIMEOUT`）把「视图从未渲染出来」与「像素/校验失败」分开；就绪 ⇒ `ERR_VISUAL_NOT_READY` ⇒ **exit 3**。
3. **两套 `runViewSuite` 共用同一份分类**（`all-views` 与 `supplementary-views` 各有一份聚合循环，只改一侧会让 Gate 7 的另一条判定永远点不到火）。
4. **Gate 7 参与判定**：四个套件退出码任一 `= 3` ⇒ 在 `$pixelExit` 判定之前 `exit 3` 并点名套件；`1` 仍交 Gate 7b 的两轮甄别（把「非 0 即拦」当收敛会把真实存在的采集抖动变成所有 PR 的常量红）。

### 验证（本地实跑数字，逐条可在 PRD §5/§7 复核）

| 项 | 命令 | 结果 |
| --- | --- | --- |
| 分类回归锁（R1–R11） | `pnpm exec vitest run tests/visual-testing/visual-readiness-classification.test.js` | `Tests 11 passed (11)` |
| 消费者并集 | 上述 + `tests/visual-ci.test.js` + `tests/visual-testing/condition-waiting.test.js` + `electron/tests/visual-view-runner.test.js` | `4 passed / Tests 68 passed (68)` |
| workflow 结构锁（含新锁） | `node --test .github/scripts/workflow-contract.test.js` | `35 pass / 0 fail`（改前基线 34） |
| Gate 7 判定行为表 | 抽出 workflow 原文喂 `pwsh` 跑六格 | 全 0 ⇒ rc=0；`views=3`/`pixel=3` ⇒ rc=3 点名套件；`views=1` ⇒ rc=0；**删掉 `$suitesNotReady = ''` 初始化 ⇒ rc=3 且名单为空** |
| 变异 N1–N6 | `mutate_vrg2.cjs`（rc 为准，还原后 `Buffer.compare` 逐字节相同） | `red=6/6 notRed=0` |
| 打包（QM-1） | 本 PR 不改 `apps/desktop/electron/**` 与 `packages/rpa-engine/**` | 不适用（判据：`git diff --name-only` 命中 0） |

### 待回填的现场证据（合并后由后续 docs PR 补）

本 PR 自己的 `QG Visual` 必须出现 `[GATE-7] suite exits: pixel=0 views=0 views-supplement=0 dark=0`（`views` 由 1 变 0）且同一步结尾 `[GATE-7] All visual tests passed` 与之一致 —— 这是「根因真的被修掉」的唯一现场证据，回填时一并写入。

| 门禁 | 结果 |
| --- | --- |
| 远程同步 | PENDING（本条自己的欠账） |
