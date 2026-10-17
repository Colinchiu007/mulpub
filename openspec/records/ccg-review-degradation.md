---
record: ccg-review-degradation
task: QM-6 外部评审不可用时的降级梯——OpenSpec change 设计四件套（先文档再代码）
date: 2026-10-17
---

## 本次执行记录：CCG 评审降级梯设计（ccg-review-degradation，2026-10-17）【docs-only】

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | PASS | 纯规格/设计文档 ⇒ docs-only。隔离按规范做足：`scripts/start-mp-task.ps1 -TaskName ccg-review-degradation -NoDeps` 建 worktree `mp-ccg-review-degradation` + 裸分支（共享根此前被他会话脏文件挡住，该片合并后其已提交，入口当场可用；本轮**未**在共享根落盘） |
| 判定（docs-only） | PASS | **在最终 base 上重取**：`node scripts/classify-docs-only.js --base=origin/main --head=HEAD` ⇒ `docs-only=true files=7`（`.openspec.yaml` 2/0 / `proposal.md` 30/0 / `design.md` 79/0 / `tasks.md` 52/0 / `specs/openspec-integration/spec.md` 41/0 / 本记录 34/0 / 钩子产物 `.ccg/reviews/146bbd0d….json` 26/0）；merge-base `a1c4237d4`。首跑在旧 base `3e78471f1` 上取的 `30/0 + merge-base 3e78471f1` 已作废，旧数只作演进链保留在本行尾注 |
| 第一性原因（QM-5 ①） | PASS | 降级早已存在且无门槛：`check-pr-exec-record.js:357-361` 的闭集含 `self_play_resolved`，而该状态由引擎在零外部参与时写出（`ccg-deep-review.js:312-313` 同处置 `performedBy: "self-play"`）。引入点即「把 self_play_resolved 纳入闭环白名单」那一次（缺陷 D 的 2026-10-15 收窄提交），当时的意图是修「dual 从未执行」，**没有**顺带问「执行的是外部还是自扮演」 |
| 逃逸分析（QM-5 ②） | PASS | 单元/集成/视觉层对该判据**结构性无关**（它判的是产物字段语义，不是运行时行为）；逃逸在审查层：`performedBy` 由引擎写、由 decider 初始化为 `null`（`:444`），但 `check-pr-exec-record.js` 全文 **0 次消费**它——一个"字段存在但无人读"的接缝，任何只看 status 的用例都照不出。第二处同源：`detectBackends()`（`:459-470`）已在算 `wrapperExists/claude/opencode`，却从未落进记录，于是"不可用"只能靠自述 |
| 修复 + 回归保护（QM-5 ④） | PASS | 本片只落**规格**（proposal/design/tasks/spec 四件套 + `openspec validate --strict` = valid），代码切片按 tasks 1–7 逐片走 TDD，每片指名回归锁 + 变异 M1–M6（design §7 已把每条变异的期望红写死）。自反条款落在 tasks 7.1/7.2：判据本体属高危面 ⇒ 实现片不得以 self-play 收口、不得自动合并 |
| 防止再次发生（QM-5 ⑤） | PASS | 规格层新增 Requirement「QM-6 外部评审不可用时的降级梯与证据分档」6 条 Scenario，把「二元组判据 / 高危面禁用自扮演 / 物证资格 / 欠账只可缩小 / 自反」全部写成可判据要求；后续 Gate 实现必须逐条对上（tasks 6.x 接进 `quality-gate.yml`，由 `check-unwired-tests.js` 防"写了没接"） |
| 行尾与 diff 对账 | PASS | 两口径（`git diff --numstat` vs `--ignore-cr-at-eol --numstat`）在**新 base** 上逐文件同数（7 个文件全 A、删除列全 0）。行尾档如实记：本新建文件初为 LF 工作副本，`git rebase --continue` 的 checkout 按 `text=auto` 把它刷成 **CRLF 工作副本 / LF blob**（正是"隐形大改"那一型）⇒ 补数脚本改为行尾自适应（归一到 LF 内存改、按原档写回），不再硬编 LF 断言。本记录 blob 行数在**本体 PR** 收口时为 34（含 rebase 追加的一条）；本回填同次删 3 个 `sync_*` 字段后为 31 —— 该 34 只描述本体 PR，不得当现状引用 |
| 接线棘轮 | N/A | 本 PR 未新增 `*.test.js` |
| QM-1 打包 / QM-4 视觉 | N/A | 未触运行面 |
| QM-6 CCG 双模型外部评审 | 未执行 | 纯规格文档按 AGENTS.md 豁免通道；**但本 change 的实现片受自反条款约束，届时不得复用本次豁免** |
| 记录欠账 | PASS | `node scripts/check-gate-record-debt.js` ⇒ rc=0；`node scripts/check-record-qm5-rows.js` ⇒ rc=0（必需步骤 ① ② ④ ⑤ 全在，本记录另附 ③）；`node scripts/check-pr-exec-record.js --base=origin/main --mode=enforce` ⇒ OK（变更 7 个、新增记录 1 篇）；`node scripts/check-no-brand-residue.js` ⇒ PASS；`openspec validate ccg-review-degradation-ladder --strict` ⇒ valid，全量 192 passed/16 failed，其中 16 条既有（控制对照：干净 main 191/16，本分支只多 1 条 passed） |
| 远程同步 | PASS | 本 PR 即 **#3765**，`state=MERGED`，merge SHA `dd1055b70e5e659881bbf4bf7b302db252132a0a`，merge 时间 2026-10-17T10:06:23+08:00。取证：`git log origin/main --grep='(#3765)$' --format=%H|%cI` 恰好 1 行；远端分支 `ccg-review-degradation` ref 查询返回 **0 行**（随 squash 删除；本地分支因被本 worktree 持有而未删，属已知 `gh` 收尾形态，rc 不作判据）。**收尾第 7 条回读**：quality-gate.yml 在该 merge SHA 上 `gh run list --commit` = `[]` ⇒ `NO_RUN(by design)`（纯规格/记录改动都在 push `paths-ignore` 内），该 SHA 上实跑的是 `债务熔断检查=success`；转核该判据最近两次 main push 读数 = run `38956768912` @ `110c3aabb` 与 run `38956333350` @ `1cda0ba19`，均 **completed/success**（早前登记的 `38928542688 @ fc24f03d8` 当时为 queued，现已被这两次覆盖，不作现行读数引用）。本行与下方 bullet 同次改写，frontmatter 三个 `sync_*` 字段同次删除 |

- 保留门禁：判定 docs-only=true ✅ | 行尾对账 ✅ | 品牌残留 ✅（扫描数随每笔提交自增故不记总数） | 文档同步 ✅（`openspec validate --strict` valid；16 条既有失败经控制对照排除归属） | 记录欠账 ✅ | 远程同步 PASS

### 遗留（不假装已闭合）

- 高危面清单按**路径前缀**取，漏「行为变更发生在非高危路径却影响高危面」的跨面改动（design §3 已记原因与否证出处，不改成内容指纹——records 里 #3747 后端 #5 已给出同型否证）。
- outstanding 棘轮只做到"计数只可缩小 + 每次出声"，**不**阻止新降级发生；彻底防"降级变永久"要靠补跑节律，本规格未定义补跑时限（待定：是否给 `fallback_closed` 挂 TTL）。
- 既有 16 条 `openspec validate` 失败与本 PR 无关（控制对照：干净 main 191 passed/16 failed，本分支 192/16），未认领、未代清。
- rebase 与撞名：首推后 `mergeable=CONFLICTING`，冲突**不在**规格文件（`Auto-merging` 全过），仍是 add/add 的 `.ccg/reviews/3e78471f….json`——本机钩子按**父 SHA** 命名，两会话同父必撞。按既有口径取主干那份（`git checkout --ours`），故钩子产物换名为 `146bbd0d….json` 且计数由 30/0 变 26/0。另记一条探针纪律：CONFLICTING 时 GitHub **不调度 checks**，`gh pr checks` 返回空表——本轮轮询带 `rows>=10` 下限，才没把"0 pending"读成"全绿"。
