# Tasks: film-auto-runseq-isolation

> 实施分支：`film-production-identity-followup`（与 `film-taskid-path-safety` 同批落地，两者正交）
> 依赖序：组 1（实现）→ 组 2（spec 同步）→ 组 3（验证与收尾）

## 1. 组 1：实现（TDD）

- [x] 1.1 RED：`auto-runner.test.js` 新增 4 条——轮次 1 沿用历史布局（存量零影响）；轮次 ≥2 带 `r<runSeq>` 且与轮次 1 不同；非法/缺失 runSeq 回落轮次 1；`collectMissingShots` 按 `project.runSeq` 探针
- [x] 1.2 GREEN：`autoRunIdFor(taskId, batchIndex, runSeq)` 带轮次；`regenerateOneShot` / `collectMissingShots` / `film-engineering-auto.js` 的 `runIdFor` 三处透传 `project.runSeq`
- [x] 1.3 取证：`grep -rn "autoRunIdFor("` 确认无遗漏调用点

## 2. 组 2：spec 同步

- [x] 2.1 spec delta：MODIFIED「全量分批出片驱动」——补自动模式轮次隔离条款
- [x] 2.2 并入主 spec
- [x] 2.3 自查：Scenario 全部含 WHEN/THEN

## 3. 组 3：验证与收尾

- [x] 3.1 变异反证：拿掉 runSeq ⇒ **2 条红**；还原 ⇒ 17/17 绿
- [x] 3.2 端到端实跑：轮次 2 runId = `auto/tk/r2/b0`、生成器**真实调用 1 次**、轮次 1 产物仍在原处可审计
- [x] 3.3 回归：auto-runner / auto-project / auto-exec-contract + 影视工程全量
- [x] 3.4 执行记录 `openspec/records/film-auto-runseq-isolation.md`

## 4. 明确不做

- **手动出片路径**：其批次 `runId` 带分镜集指纹（内容身份），与本 change 的轮次（任务身份）正交，**不动**。
- **`project.shots` 的增删排序入口**：当前**不存在**（全仓 grep `shots.push|splice|sort` 零命中），故「批内序号漂移」在产品里不可达。本 change 不为其加防护；若将来新增增删入口，须同时引入按 shotId 寻址的产物命名。
