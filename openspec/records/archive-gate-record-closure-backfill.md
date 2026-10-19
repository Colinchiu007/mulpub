---
record: archive-gate-record-closure-backfill
task: 归档 ban-record-closure-backfill-pr，把「人工改写收口行判红」这条需求落进主规格
date: 2026-10-18
---

## 本次执行记录：归档 ban-record-closure-backfill-pr（archive-gate-record-closure-backfill，2026-10-18）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ | 纯文档/流程变更（openspec 归档 + CHANGELOG + 本篇记录）。隔离在 worktree `mp-archive-gate-record-closure-backfill`、裸分支 `archive-gate-record-closure-backfill`（依赖就绪校验 `verify-worktree-deps` 通过）；经 PR 落地，不走直推 main |
| 第一性原因（QM-5 ①） | ✅ | 上一刀（#3911）交付了判据却把 change 留在 `openspec/changes/` 未归档 ⇒ 主规格 `quality-gate-execution-record` 缺这条需求，下一个会话读主规格看不到"改写收口行会判红"，仍会按旧 SOP 写回填。归档落点不靠临场自觉，靠这条记录与判据同处一域 |
| 逃逸分析（QM-5 ②） | ✅ | 本刀是文档归档，无运行面；风险面是"归档改主规格会不会连带把 vendored 镜像判红"——上一刀实测踩过（实现 PR 全绿、归档 PR 才红 Gate 2b2）。本刀不靠记忆回答，改测：见下两行 |

| 修复 + 回归保护（QM-5 ④） | ✅ | 镜像联动当场量化：`scripts/quality-rhythm-spec-mirror.test.js:4` 写死比对对象是 `openspec/specs/openspec-integration/spec.md`，本刀只动 `quality-gate-execution-record` ⇒ 不联动；归档前后各跑一次，两次均 `8 passed / 0 failed`。`openspec validate --all --strict` 归档前后失败集逐字相同（18 条既有），Totals 216→215 项、passed 198→197，净少的那 1 项就是本 change 离开 changes 域 |
| 防止再次发生（QM-5 ⑤） | ✅ | 把"要不要同步镜像"的判据从"上次要"改成"看归档落进哪个 capability + 读锁的比对目标"，写进 CHANGELOG 与本篇；上一刀的 tasks.md 38 条实现项逐条绑落点补齐（勾完残留 0，1.8 标撤销、2.3 标被实测否证并改口径，不伪装成完成） |
| 行尾与 diff 对账 | ✅ | 新 worktree 检出为 `i/lf w/crlf`：CHANGELOG 按其档位逐行插（CR 增量 == 插入行数 == LF 增量三计数自证），本篇记录写 LF。移动形态 `git diff --cached -M` 判 5 个 R100 + 1 个 M（主规格）。两口径 numstat 在 commit 后取并写进 PR 正文 |
| 接线棘轮 | N/A | 本刀未新增测试文件；`check-pr-exec-record.js` 的「归档类 PR 也要带执行记录」既有判据即本篇文件 |
| QM-1 打包 / QM-4 视觉 | N/A | 零 `apps/desktop/electron/`、零 `packages/rpa-engine/`、零 UI 文件 |
| QM-6 CCG 双模型外部评审 | N/A | 纯文档归档，未触运行行为，按 AGENTS 不强制（不假装跑过） |
| 远程同步 | 由门禁推导 | 本行**不需要事后改写**：合并后由 `scripts/lib/merge-ledger.js` 按 squash 尾注推导归属。合并前本篇还不在基线上 ⇒ 判 byDesign 不红；把状态列改写成 `PASS` 会被 `HAND-CLOSURE` 人工改写档当场判红——那条锁正是上一刀建的，本刀就是它的第一个非回填消费者 |

### 遗留（不假装已闭合）
- **主规格里那条新需求的 Purpose 段沿用了上一刀建立的原文**，本刀只追加 Requirement；`validate --all` 报的 18 条既有失败（`ccg-convergence-exit` 等）不属本刀，未代他人会话清理。
- **归档不改判据**：`scripts/check-gate-record-debt.js` 与 `scripts/lib/pr-record-diff.js` 本刀一字未动，所以上一刀的 15 条变异反证仍是终局证据；若后续有人改判据形态，那批变异必须重跑，不能引用本刀的 rc。
- **上一刀留下的两笔真实欠账没有被本刀消掉**：闭合→闭合的改写不拦（design 残留风险 5/6）、旧载体 23 条历史欠账仍需人工通道销账。
