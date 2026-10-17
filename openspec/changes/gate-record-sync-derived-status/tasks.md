# 任务拆分（示踪弹垂直切片）

依赖关系：片 0 → 片 1 → 片 2 → 片 3 → 片 4 → 片 5。片 2 之前不得声称"回填 PR 消失了"，因为判据还没接上；片 4 之前不得声称"CI 生效"，因为 ref 可用性只在推导侧本机验过。

## 0. 前置 spike：归档顺序（评审意见 i6，实现前必须做完，因为它决定规格怎么写）——已完成

- [x] 0.1 事实核实：`grep -rl 远程同步 openspec/specs/` 为空；`enforce-gate-record-presence/specs/quality-gate-execution-record/spec.md:5` 是 `## ADDED Requirements`，那条 Requirement 从未进过基线 ⇒ 对它写 MODIFIED 在法律上就不成立。
- [x] 0.2 在临时副本 `D:/Temp/osx-spike-b`（`cp -r openspec` 后独立操作，不碰本仓）跑三条：S1 以 MODIFIED 归档 ⇒ `severity=error / code=archive_spec_update_failed / "archive": null / No files were changed`；S2 改 ADDED 归档 ⇒ `specsUpdated=true, added=3`，基线文件被创建；S3 随后归档 `enforce-gate-record-presence` ⇒ `added=5` + 一条 `delta Purpose ignored` warning。
- [x] 0.3 结论已回写 design D10 与规格：**两侧都只用 ADDED**；MODIFY 假设被实测否证，规格正文加了"取代关系"声明与并存消歧说明（S3 暴露的 Purpose 只认第一份，也如实记进 D10）。
- [x] 0.4 `分层分支策略` 保持不碰：本 change 在 `openspec-integration` 侧只 ADDED 一条，未新增第三条 MODIFY（实测该条已被 `freeze-legacy-gate-carrier` 与 `hot-carrier-atomic-landing` 两条未归档 MODIFY 占用）。

## 1. 共享实现：合并账本与记录归属（scripts/lib/merge-ledger.js）

- [ ] 1.1 写红测：一次遍历产出 `mergeLedger: Map<pr,{sha,iso}>` 与 `addedBy: Map<path,pr|null>`，断言只认行尾 `(#NNNN)$`（正文中间的 `#123` 不算）。
- [ ] 1.2 写红测：`--no-renames` 行为锁——把记录文件改名的提交 MUST NOT 被当成它的归属提交。
- [ ] 1.3 写红测：`core.quotepath=off` 行为锁——含非 ASCII 的路径 MUST 能解析（否则归属静默丢失）。
- [ ] 1.4 写红测：ref 取不到 / git 失败 / 账本规模为 0 三种输入都返回"不可用"信号且不抛裸栈；**不可用不得被读成已合并**。
- [ ] 1.4b **归属三态不得塌成两态**（评审 i1）：`ABSENT`（路径不在映射里）、`NO_FOOTER`（在映射里但归属提交无 `(#NNNN)`）、`PR(n)` 三种输入各有一条用例，且 `NO_FOOTER` 与 `ABSENT` 的下游归类不同（前者落兼容档/欠账，后者落 byDesign）。把两态合并成一个出口必须红（M2b）。
- [ ] 1.5 实现；真仓规模下界锁（`mergedPrs >= 1500`、`recordFiles >= 400`，禁止焊死某次读数）。
- [ ] 1.6 判据接线锁：`check-gate-record-debt.js` MUST 从该模块取值且自身不含第二份 `git log` 解析；把接线摘掉必须红。
- [ ] 1.7 隔离测试（评审 i3）：把 `buildMergeLedger` 改成恒返回空 Map ⇒ 必须红且**只红派生档用例**；空 Map 在 CI 环境还必须触发 `prs=0` 非零出口（见 4.7），两个方向分开测。

## 2. 判据接入：三态收口 + 两处收窄（存量零漂移）

- [ ] 2.1 红测：行存在 + 归属 PR 在账本内 ⇒ `derivedClosed`，状态列写 `PENDING` 也收口。
- [ ] 2.2 红测：**缺行仍然即红**，即使归属可解析（D2，防把「缺行即红」整条作废）。
- [ ] 2.3 红测：账本不可用时退回断言通道，未闭合且无登记 ⇒ 仍红（fail-closed）。
- [ ] 2.4 收窄 `staleRecordFields`：作用域限 `blobClosed`。真仓锁：按改造前口径 21 篇会红，改造后必须 0 红（D5）。
- [ ] 2.5 收窄跨源比对：拦截面保持 `blobClosed`；`derivedClosed × 旧载体未收口` 转可见并打印条数（实测 2 篇，D6）。
- [ ] 2.6 **真仓改前/改后对账行为锁**：改造前后拦截集合逐篇相同、记录文件字节零改动。这是"存量不动"的唯一机械证据。**`baseRef` 必须钉死为显式传入的 SHA 并回写进执行记录**（评审 `TASKS-4`：实测同一会话内 main 从 406 走到 407 篇，取"当前 HEAD"的对账不可复现）；不传参即判"未证实"并出声，禁止默认值蒙混（反证 M13）。
- [ ] 2.7 扫描域复用 `listRecordFiles`，禁止新写文件清单（探针曾把 `_exempt/` 读进门禁域，导致误判"1 篇缺行"；已核实该函数是**非递归** readdirSync + `isFile() && .md && !_前缀`，`_exempt/` 因是目录被排除）。
- [ ] 2.8 **域一致锁**（评审 i8）：派生档遍历的文件集合 MUST 逐等于 `listRecordFiles(recordsRoot)` 的返回值；MUST NOT 有任何额外排除/包含。自建清单当输入 ⇒ 当场红（M10）。
- [ ] 2.9 **优先级锁**（评审 i2）：`missingRow → ABSENT(inThisChangeset/prematureClaim) → derivedClosed → blobClosed → debt` 这条链必须是声明式实现；组合用例「派生成立 ∧ 状态列写了闭合词 ∧ 仍带 legacy 字段」MUST 受字段卫生约束（谁做断言谁受约束），换优先级顺序必须红（M9）。

- [ ] 2.10 **改名重指锁**（评审 `GIT-1`，本设计原写反了）：临时仓库造 `a.md (#100)` → `git mv` → `b.md (#200)`，断言 `addedBy(b.md) === 200` 且 `addedBy(a.md)` 为 `ABSENT`；并断言重指事实被打印（有声明 PR 时 `intentMismatch` 红，无声明时只出声不拦）。**禁止**把这行改回"改名 ⇒ 解析不到"（反证 M12 专守这个回退）。
- [ ] 2.11 **归属候选取向锁**（`GIT-3/GIT-4`）：造"加入→删除→由另一 PR 重新加入"的三段历史，断言取**最近一次 A**（newest-wins）；实现改成取首次 A 必须红（反证 M11）。
- [ ] 2.12 **枚举来源锁**（`D2-1`）：`merge-ledger` 内 MUST NOT 出现 `readdirSync` / `ls-tree` 等自建目录扫描，文件集合只接受调用方传入；测试构造"递归枚举会把 `_exempt/` 纳进来"的反例并断言被拒（反证 M10 的第二落点）。
- [ ] 2.13 **浅检出模拟**（`LEDGER-1`）：给定不可解析的 `baseRef`，断言两件事同时成立——未闭合记录仍判红（不得因派生不可用而放行）且 `MERGE-LEDGER prs=0` 出现在输出里。两条各自独立成用例：实现把"不可用"做成"跳过检查"时只有分开的断言能指出哪一半先烂。

## 3. 净增拦截：预写证据与归属不符

- [ ] 3.1 红测：`inThisChangeset`（本次变更集新增、基线上不存在）+ 状态列写闭合词 ⇒ `prematureClaim` 红；这是改造前无法分辨的那一格。
- [ ] 3.2 红测：`inThisChangeset` + 未闭合 ⇒ byDesign 不红；该 PR 合并后自动转 `derivedClosed`，全程零写回。
- [ ] 3.3 "本次变更集"的取值 MUST 复用**唯一取源** `classify-docs-only.js` 的 `changedFileStatuses`（`check-pr-exec-record.js:16` 就是这么做并留了注释的），不得另算一份 merge-base diff，也不得把"复用 check-pr-exec-record 的实现"当成真源——它自己也是消费者。
- [ ] 3.4 红测：`sync_pr` 缺省 ⇒ 归属交叉核对不参与；写了且与 `addedBy` 不符 ⇒ 红并打印两个编号。
- [ ] 3.5 红测：本地无 `--current-pr` 时 3.1/3.2 仍按"文件是否在基线上"判定（否则本地跑会把每条新记录判成欠账）。

## 4. 接线与口径同步

- [ ] 4.1 `quality-gate.yml` 的 `changes` job（无 job 级 `if:`、`shell: bash`）内传 `--current-pr=${{ github.event.pull_request.number }}`，并强制打印 `MERGE-LEDGER prs=<n>`；**不得**放进 `static-gates`（`check-unwired-tests.js` 的 `TEST_ONLY_IN_SKIPPABLE_JOB` 会拦）。
- [ ] 4.2 回读一次真 CI 日志取 `MERGE-LEDGER prs=` 读数：这是"GitHub runner 上 origin/main 真取得到"的唯一证据，本机读数不算（design 残留风险 1）。
- [ ] 4.3 `openspec/records/_TEMPLATE.md`：新记录不再写 `sync_status/sync_reason/sync_backfill_owner`（第 6–13 行那块），状态列（第 28 行）改为"由门禁按主干历史推导"，并删掉"合并后回填并删除三字段"那句指令。**已实测无冲突**：`scripts/check-record-qm5-rows.js` 的 `OUT_OF_DOMAIN` 明确排除 `_TEMPLATE.md`，且它只从带 `（QM-5 ①…⑤）` 标记的行题派生，第 28 行不带该标记 ⇒ 改它不断 QM-5 棘轮。**反向警告**：模板第 20–23 行是 `requiredStepsFromTemplate()` 的派生来源，动这四行才会打断棘轮，本任务禁止触碰。
- [ ] 4.4 `AGENTS.md`：**禁止按行号改**（本轮实测该文件是热点载体：本会话进行期间另一会话给它「合并后收尾清单」新增了第 5 步 `check-branch-merged.js`，行号已整体下移）。改前必须先 rebase 到当时 origin/main，再按**章节锚点**定位：docs-only 快速通道的「两种形态必须同写」「远程同步状态列只认闭合词表」两段、「PR 自动合并」的禁止项「合并后不回填远程同步」与合并后收尾清单第 1–4 步、QM-2 的「执行记录里的待办状态必须有东西在检测」整条。保留不动：历史叙述（GH011 直推被拒、#2411、旧载体冻结动因）与"必须经 PR 落地/禁止直推 main/禁止 `--no-verify`"三条硬约束。
- [ ] 4.5 `scripts/check-pr-exec-record.js` 的"出路④不校验 PENDING→PASS 真实性、信任边界交给 gate-record-debt"注释同步更新——本 change 之后那道信任边界真的存在了，留着旧注释就是装饰性注释。
- [ ] 4.6 workflow 结构自检：`node .github/scripts/check-workflow-structure.js` rc=0，且改过的 `run:` 块喂真解释器做一次 ParseInput（仓规：js-yaml 绿 ≠ PowerShell 能解析）。
- [ ] 4.7 **打印即门禁**（评审 i4）：判据在 CI 环境下 `prs=0` MUST 非零退出并点名"派生档未生效"；`workflow-contract.test.js` 加一条结构锁——该步骤 MUST 在 `changes` job、MUST NOT 在任何带 job 级 `if:` 的 job。把步骤挪进 `static-gates` 必须红（与 5.1 的 M8 配对，一条行为锁一条结构锁，各测各的）。

- [ ] 4.8 **相邻缺陷登记，不隐身**：`scripts/plan-review.sh` 把评审产物写到**固定目录名** `.adversarial/ccg-plan-design-<critic>/`，不含被评方案的标识 ⇒ 两个会话评不同方案必然互覆盖。本轮实测：本会话跑 plan-review 时覆盖了 commit `f66081aec`（2026-10-15 的 B1 RPA 反检测评审）的 `critique-v1.md`，靠 `git restore` 精确路径救回（恢复后与 HEAD 逐字节相同），本会话产物改存唯一路径 `.adversarial/gate-record-plan-r1/`，并因该目录被 .gitignore 忽略（worktree 收尾即消失）而把原件入库到 `openspec/changes/gate-record-sync-derived-status/reviews/`。修法：目录名带上方案 slug 或内容 hash（与本仓「追加型共用写面会丢工」同族，见旧载体冻结的动因）。是否并入本 PR 由 QM-6 裁定；若不并入，本条转为独立欠账登记，**不得删条目装作没看见**。

## 5. 验证与收尾

- [ ] 5.1 变异反证 M1–M13（含 M2b/M9/M10/M11/M12/M13）逐条实跑，要求**红集互不相同**且各自指名（不得用"整体 LOADFAIL 一片红"充当证据）。
- [ ] 5.2 静态门禁本机点名跑（本机 pre-commit 不覆盖 CI 静态项）：`check-gate-record-debt.test.js`、`check-pr-exec-record.test.js`、`workflow-contract.test.js`、`check-unwired-tests.js`、`check-step-failfast.js`、`check-workflow-structure.js`、`check-doc-abs-paths.js`、`check-changelog-growth.js`。
- [ ] 5.3 `node scripts/classify-docs-only.js --base=origin/main --head=HEAD` 在 **commit 之后**取证；本 PR 含 `scripts/` 工具脚本 + workflow 正文 ⇒ 预期 `docs-only=false`（混合 PR），走完整质量节拍，不得借道快速通道。
- [ ] 5.4 QM-6 双模型外部评审（后端 + 前端，打在设计文档与实现 diff 上），Critical 清零后才继续。
- [ ] 5.5 执行记录 `openspec/records/gate-record-sync-derived-status.md`：门禁表 + `远程同步` 行按新形态写（不填 merge SHA）。
- [ ] 5.6 CHANGELOG 收口 + `01-docs/learnings.md` 记「键选错导致循环依赖」这条根因。
- [ ] 5.7 开 PR；按「PR 自动合并」判据 1–5 自查后 squash 合并并删远端分支（判据取产物：`state=MERGED` + `mergeCommit.oid`、远端分支 0 行、`git log` 恰 1 行；rc 不作判据）。
- [ ] 5.8 回读本次合并触发的 main push（按 (merge SHA, workflow) 判）：`quality-gate.yml` 无 push run 时如实记 `NO_RUN(by design)` 并转核该判据最近一次在 main 上的读数。
- [ ] 5.9 **本 change 自身不得留下回填 PR**：收口由片 2 的推导得出，若仍需人工补写，说明判据没接上，回到 2.1 重做。
- [ ] 5.10 worktree 按 R1–R7 走 `scripts/safe-worktree-remove.ps1`（先 `-WhatIf`）；删前先删本任务遗留的两个一次性探针 `.tmp-*.cjs` / `.tmp-*.out`（走 `node scripts/safe-delete.js`，禁止递归删除）。
- [ ] 5.11 归档执行（判定已在**片 0** 做完）：按片 0 的结论归档本 change；归档后回读 `openspec/specs/` 是否收敛到预期文本，并核对 `enforce-gate-record-presence` / `freeze-legacy-gate-carrier` / `hot-carrier-atomic-landing` 三份未归档件在本 change 归档后仍能 validate。禁止在这一步临时改判据形态。
