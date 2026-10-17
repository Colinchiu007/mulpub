# 任务拆分（示踪弹垂直切片）

依赖关系：片 1 → 片 2 → 片 3 → 片 4 → 片 5。片 2 之前不得声称"回填 PR 消失了"，因为判据还没接上；片 4 之前不得声称"CI 生效"，因为 ref 可用性只在推导侧本机验过。

## 1. 共享实现：合并账本与记录归属（scripts/lib/merge-ledger.js）

- [ ] 1.1 写红测：一次遍历产出 `mergeLedger: Map<pr,{sha,iso}>` 与 `addedBy: Map<path,pr|null>`，断言只认行尾 `(#NNNN)$`（正文中间的 `#123` 不算）。
- [ ] 1.2 写红测：`--no-renames` 行为锁——把记录文件改名的提交 MUST NOT 被当成它的归属提交。
- [ ] 1.3 写红测：`core.quotepath=off` 行为锁——含非 ASCII 的路径 MUST 能解析（否则归属静默丢失）。
- [ ] 1.4 写红测：ref 取不到 / git 失败 / 账本规模为 0 三种输入都返回"不可用"信号且不抛裸栈；**不可用不得被读成已合并**。
- [ ] 1.5 实现；真仓规模下界锁（`mergedPrs >= 1500`、`recordFiles >= 400`，禁止焊死某次读数）。
- [ ] 1.6 判据接线锁：`check-gate-record-debt.js` MUST 从该模块取值且自身不含第二份 `git log` 解析；把接线摘掉必须红。

## 2. 判据接入：三态收口 + 两处收窄（存量零漂移）

- [ ] 2.1 红测：行存在 + 归属 PR 在账本内 ⇒ `derivedClosed`，状态列写 `PENDING` 也收口。
- [ ] 2.2 红测：**缺行仍然即红**，即使归属可解析（D2，防把「缺行即红」整条作废）。
- [ ] 2.3 红测：账本不可用时退回断言通道，未闭合且无登记 ⇒ 仍红（fail-closed）。
- [ ] 2.4 收窄 `staleRecordFields`：作用域限 `blobClosed`。真仓锁：按改造前口径 21 篇会红，改造后必须 0 红（D5）。
- [ ] 2.5 收窄跨源比对：拦截面保持 `blobClosed`；`derivedClosed × 旧载体未收口` 转可见并打印条数（实测 2 篇，D6）。
- [ ] 2.6 **真仓改前/改后对账行为锁**：同一 main tip 上，改造前后拦截集合逐篇相同、记录文件字节零改动。这是"存量不动"的唯一机械证据。
- [ ] 2.7 扫描域复用 `listRecordFiles`，禁止新写文件清单（探针曾把 `_exempt/` 读进门禁域，导致误判"1 篇缺行"）。

## 3. 净增拦截：预写证据与归属不符

- [ ] 3.1 红测：`inThisChangeset`（本次变更集新增、基线上不存在）+ 状态列写闭合词 ⇒ `prematureClaim` 红；这是改造前无法分辨的那一格。
- [ ] 3.2 红测：`inThisChangeset` + 未闭合 ⇒ byDesign 不红；该 PR 合并后自动转 `derivedClosed`，全程零写回。
- [ ] 3.3 "本次变更集"的取值 MUST 复用 `check-pr-exec-record.js` 的既有实现（规格「变更集取自同一实现」），不得另算一份 merge-base diff。
- [ ] 3.4 红测：`sync_pr` 缺省 ⇒ 归属交叉核对不参与；写了且与 `addedBy` 不符 ⇒ 红并打印两个编号。
- [ ] 3.5 红测：本地无 `--current-pr` 时 3.1/3.2 仍按"文件是否在基线上"判定（否则本地跑会把每条新记录判成欠账）。

## 4. 接线与口径同步

- [ ] 4.1 `quality-gate.yml` 的 `changes` job（无 job 级 `if:`、`shell: bash`）内传 `--current-pr=${{ github.event.pull_request.number }}`，并强制打印 `MERGE-LEDGER prs=<n>`；**不得**放进 `static-gates`（`check-unwired-tests.js` 的 `TEST_ONLY_IN_SKIPPABLE_JOB` 会拦）。
- [ ] 4.2 回读一次真 CI 日志取 `MERGE-LEDGER prs=` 读数：这是"GitHub runner 上 origin/main 真取得到"的唯一证据，本机读数不算（design 残留风险 1）。
- [ ] 4.3 `openspec/records/_TEMPLATE.md`：新记录不再写 `sync_status/sync_reason/sync_backfill_owner`，状态列改为"由门禁按主干历史推导"，并删掉"合并后回填并删除三字段"那句指令。
- [ ] 4.4 `AGENTS.md`：改写 docs-only 快速通道的回填 SOP 与「PR 自动合并」合并后收尾清单第 3–6 步（不再开回填 PR）；保留"必须经 PR 落地""禁止直推 main""禁止 `--no-verify`"。旧载体冻结段原样保留（存量）。
- [ ] 4.5 `scripts/check-pr-exec-record.js` 的"出路④不校验 PENDING→PASS 真实性、信任边界交给 gate-record-debt"注释同步更新——本 change 之后那道信任边界真的存在了，留着旧注释就是装饰性注释。
- [ ] 4.6 workflow 结构自检：`node .github/scripts/check-workflow-structure.js` rc=0，且改过的 `run:` 块喂真解释器做一次 ParseInput（仓规：js-yaml 绿 ≠ PowerShell 能解析）。

## 5. 验证与收尾

- [ ] 5.1 变异反证 M1–M8 逐条实跑，要求**红集互不相同**且各自指名（不得用"整体 LOADFAIL 一片红"充当证据）。
- [ ] 5.2 静态门禁本机点名跑（本机 pre-commit 不覆盖 CI 静态项）：`check-gate-record-debt.test.js`、`check-pr-exec-record.test.js`、`workflow-contract.test.js`、`check-unwired-tests.js`、`check-step-failfast.js`、`check-workflow-structure.js`、`check-doc-abs-paths.js`、`check-changelog-growth.js`。
- [ ] 5.3 `node scripts/classify-docs-only.js --base=origin/main --head=HEAD` 在 **commit 之后**取证；本 PR 含 `scripts/` 工具脚本 + workflow 正文 ⇒ 预期 `docs-only=false`（混合 PR），走完整质量节拍，不得借道快速通道。
- [ ] 5.4 QM-6 双模型外部评审（后端 + 前端，打在设计文档与实现 diff 上），Critical 清零后才继续。
- [ ] 5.5 执行记录 `openspec/records/gate-record-sync-derived-status.md`：门禁表 + `远程同步` 行按新形态写（不填 merge SHA）。
- [ ] 5.6 CHANGELOG 收口 + `01-docs/learnings.md` 记「键选错导致循环依赖」这条根因。
- [ ] 5.7 开 PR；按「PR 自动合并」判据 1–5 自查后 squash 合并并删远端分支（判据取产物：`state=MERGED` + `mergeCommit.oid`、远端分支 0 行、`git log` 恰 1 行；rc 不作判据）。
- [ ] 5.8 回读本次合并触发的 main push（按 (merge SHA, workflow) 判）：`quality-gate.yml` 无 push run 时如实记 `NO_RUN(by design)` 并转核该判据最近一次在 main 上的读数。
- [ ] 5.9 **本 change 自身不得留下回填 PR**：收口由片 2 的推导得出，若仍需人工补写，说明判据没接上，回到 2.1 重做。
- [ ] 5.10 worktree 按 R1–R7 走 `scripts/safe-worktree-remove.ps1`（先 `-WhatIf`）；删前先删本任务遗留的两个一次性探针 `.tmp-*.cjs` / `.tmp-*.out`（走 `node scripts/safe-delete.js`，禁止递归删除）。
- [ ] 5.11 归档顺序：`openspec archive` 前先核 `quality-gate-execution-record` 基线仍只在未归档的 `enforce-gate-record-presence` 里；两条 delta 谁先归档都要求 specs/ 收敛到同一文本，实跑两种顺序的 `openspec validate --strict` 并记录结论。`openspec-integration` 侧本 change 只 ADDED 一条（`分层分支策略` 已被 `freeze-legacy-gate-carrier` 与 `hot-carrier-atomic-landing` 两条未归档 MODIFY 占用，第三条会成三方覆盖）。
