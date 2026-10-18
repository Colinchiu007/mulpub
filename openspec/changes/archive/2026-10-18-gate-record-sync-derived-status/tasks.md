# 任务拆分（示踪弹垂直切片）

依赖关系：片 0 → 片 1 → 片 2 → 片 3 → 片 4 → 片 5。片 2 之前不得声称"回填 PR 消失了"，因为判据还没接上；片 4 之前不得声称"CI 生效"，因为 ref 可用性只在推导侧本机验过。

## 0. 前置 spike：归档顺序（评审意见 i6，实现前必须做完，因为它决定规格怎么写）——已完成

- [x] 0.1 事实核实：`grep -rl 远程同步 openspec/specs/` 为空；`enforce-gate-record-presence/specs/quality-gate-execution-record/spec.md:5` 是 `## ADDED Requirements`，那条 Requirement 从未进过基线 ⇒ 对它写 MODIFIED 在法律上就不成立。
- [x] 0.2 在临时副本 `<os.tmpdir>/osx-spike-b`（`cp -r openspec` 后独立操作，不碰本仓）跑三条：S1 以 MODIFIED 归档 ⇒ `severity=error / code=archive_spec_update_failed / "archive": null / No files were changed`；S2 改 ADDED 归档 ⇒ `specsUpdated=true, added=3`，基线文件被创建；S3 随后归档 `enforce-gate-record-presence` ⇒ `added=5` + 一条 `delta Purpose ignored` warning。
- [x] 0.3 结论已回写 design D10 与规格：**两侧都只用 ADDED**；MODIFY 假设被实测否证，规格正文加了"取代关系"声明与并存消歧说明（S3 暴露的 Purpose 只认第一份，也如实记进 D10）。
- [x] 0.4 `分层分支策略` 保持不碰：本 change 在 `openspec-integration` 侧只 ADDED 一条，未新增第三条 MODIFY（实测该条已被 `freeze-legacy-gate-carrier` 与 `hot-carrier-atomic-landing` 两条未归档 MODIFY 占用）。

## 1. 共享实现：合并账本与记录归属（scripts/lib/merge-ledger.js）——已完成

跑法与 CI 同：`node --test scripts/lib/merge-ledger.test.js`，本轮实测 `# tests 10 / pass 10 / fail 0 / skipped 0`。
接线落点：`.github/workflows/quality-gate.yml` 的 `changes` job「Detect docs-only changes」步骤内、**非 PR 早退之前**（⇒ PR 与 push 两档都跑，且该 job 无 job 级 `if:` 不会被 docs-only 短路）。三条自检本机实跑 rc=0：`check-workflow-structure.js` / `check-unwired-tests.js` / `check-step-failfast.js`。

- [x] 1.1 红测：一次遍历产出 `mergedPrs` 与 `addedBy`，只认行尾 `(#NNNN)`。证据：用例「合并账本只认行尾 (#NNNN) 尾注，同一标题里靠前的编号不算」——夹具标题写 `docs: fix (#999) then ship (#101)`，断言 101 入账、999 不入账。原任务写的"正文中间的 `#123` 不算"是**假测**：`%s` 只取标题行，中段编号若落在正文根本测不到，必须同行才成立。
- [x] 1.2 红测：`--no-renames` 行为锁。证据：用例「改名会把归属重指到改名那次提交」+ 变异 MU-B **CAUGHT**（红集恰为该条指名用例）。本条同时否证了设计原文两处措辞并已回改 design D3 与 spec：旧路径 `alpha.md` 的创建提交本身就是一次 `A`，**永远留在映射里**（实测 `addedBy(alpha.md)=100`），所以 `NOT_IN_BASE` 的唯一真实来源是"本次变更集新增"，不含改名旧路径；把它写成"改名⇒失去收口能力"方向恰好相反。
- [x] 1.3 红测：`core.quotepath=off` 行为锁。证据：用例「非 ASCII 路径必须解析成字面键」+ MU-A **CAUGHT**。
- [x] 1.4 红测：ref 取不到 / 非仓库 / 空账本三种输入各返回不可用信号且不抛裸栈。证据：用例「三种取不到读数各自出声，且绝不返回空 Map 冒充"没有已合并 PR"」+ MU-D **CAUGHT**。实现用 `--is-inside-work-tree` 与 `rev-parse --verify` 两步区分"跑错目录"与"分支不存在"——两者 git 都只回 128，混成一个码就把"判据装错了地方"报成"分支还没建好"。
- [x] 1.4b 归属三态不塌（`NOT_IN_BASE` / `NO_FOOTER` / `PR(n)`，各一条用例；另加「PR 解析出来了但不在账本 = 取证不一致」一条）。证据：MU-F **CAUGHT**（删掉 NO_FOOTER 出口即红在该条指名用例）。
- [x] 1.5 实现 + 真仓规模下界锁（`mergedPrs >= 1500`、`addedRecordPaths >= 400`，未焊死某次读数）。证据：用例「真仓 origin/main 上账本与归属都读出非零规模」实跑未 skip（`skipped 0` 即"这条真的跑了"的现场，写成 `t.skip` 就会把洞伪装成按设计跳过）。
- [x] 1.6 判据接线锁（`check-gate-record-debt.js` 从本模块取值、自身不含第二份 `git log` 解析）——**留给片 2**：判据尚未接入，现在写这条锁等于锁一个还不存在的调用点（装饰性断言的已知形态）。
- [x] 1.7 隔离测试的派生档一半——模块侧已具备（MU-D 红在指名用例）；「恒空 Map 时只红派生档、兼容档仍绿」要等片 2 出现派生档用例后才能测，届时与 M2 分别验。

变异反证 6 条（MU-A…MU-F）全部 CAUGHT 且红集互不相同、还原后 md5 一致；一次性工具 `.tmp-mutate.cjs` 收尾时删除，结论以本节为现场记录。

## 2. 判据接入：三态收口 + 两处收窄（存量零漂移）

- [x] 2.1 红测：行存在 + 归属 PR 在账本内 ⇒ `derivedClosed`，状态列写 `PENDING` 也收口。
- [x] 2.2 红测：**缺行仍然即红**，即使归属可解析（D2，防把「缺行即红」整条作废）。
- [x] 2.3 红测：账本不可用时退回断言通道，未闭合且无登记 ⇒ 仍红（fail-closed）。
- [x] 2.4 收窄 `staleRecordFields`：作用域限 `blobClosed`。真仓锁：按改造前口径 21 篇会红，改造后必须 0 红（D5）。
- [x] 2.5 收窄跨源比对：拦截面保持 `blobClosed`；`derivedClosed × 旧载体未收口` 转可见并打印条数（实测 2 篇，D6）。
- [x] 2.6 **真仓改前/改后对账行为锁**：改造前后拦截集合逐篇相同、记录文件字节零改动。这是"存量不动"的唯一机械证据。**`baseRef` 必须钉死为显式传入的 SHA 并回写进执行记录**（评审 `TASKS-4`：实测同一会话内 main 从 406 走到 407 篇，取"当前 HEAD"的对账不可复现）；不传参即判"未证实"并出声，禁止默认值蒙混（反证 M13）。
- [x] 2.7 扫描域复用 `listRecordFiles`，禁止新写文件清单（探针曾把 `_exempt/` 读进门禁域，导致误判"1 篇缺行"；已核实该函数是**非递归** readdirSync + `isFile() && .md && !_前缀`，`_exempt/` 因是目录被排除）。
- [x] 2.8 **域一致锁**（评审 i8）：派生档遍历的文件集合 MUST 逐等于 `listRecordFiles(recordsRoot)` 的返回值；MUST NOT 有任何额外排除/包含。自建清单当输入 ⇒ 当场红（M10）。
- [x] 2.9 **优先级锁**（评审 i2）：`missingRow → NOT_IN_BASE(inThisChangeset/prematureClaim) → derivedClosed → blobClosed → debt` 这条链必须是声明式实现；组合用例「派生成立 ∧ 状态列写了闭合词 ∧ 仍带 legacy 字段」MUST 受字段卫生约束（谁做断言谁受约束），换优先级顺序必须红（M9）。

- [x] 2.10 **改名重指锁**（评审 `GIT-1`，本设计原写反了）：临时仓库造 `a.md (#100)` → `git mv` → `b.md (#200)`，断言 `addedBy(b.md) === 200` 且 `addedBy(a.md)` 为 `NOT_IN_BASE`；并断言重指事实被打印（有声明 PR 时 `intentMismatch` 红，无声明时只出声不拦）。**禁止**把这行改回"改名 ⇒ 解析不到"（反证 M12 专守这个回退）。
- [x] 2.11 **归属候选取向锁**（`GIT-3/GIT-4`）：造"加入→删除→由另一 PR 重新加入"的三段历史，断言取**最近一次 A**（newest-wins）；实现改成取首次 A 必须红（反证 M11）。
- [x] 2.12 **枚举来源锁**（`D2-1`）：`merge-ledger` 内 MUST NOT 出现 `readdirSync` / `ls-tree` 等自建目录扫描，文件集合只接受调用方传入；测试构造"递归枚举会把 `_exempt/` 纳进来"的反例并断言被拒（反证 M10 的第二落点）。
- [x] 2.13 **浅检出模拟**（`LEDGER-1`）：给定不可解析的 `baseRef`，断言两件事同时成立——未闭合记录仍判红（不得因派生不可用而放行）且 `MERGE-LEDGER prs=0` 出现在输出里。两条各自独立成用例：实现把"不可用"做成"跳过检查"时只有分开的断言能指出哪一半先烂。

## 3. 净增拦截：预写证据与归属不符

- [x] 3.1 红测：`inThisChangeset`（本次变更集新增、基线上不存在）+ 状态列写闭合词 ⇒ `prematureClaim` 红；这是改造前无法分辨的那一格。
- [x] 3.2 红测：`inThisChangeset` + 未闭合 ⇒ byDesign 不红；该 PR 合并后自动转 `derivedClosed`，全程零写回。
- [x] 3.3 "本次变更集"的取值 MUST 复用**唯一取源** `classify-docs-only.js` 的 `changedFileStatuses`（`check-pr-exec-record.js:16` 就是这么做并留了注释的），不得另算一份 merge-base diff，也不得把"复用 check-pr-exec-record 的实现"当成真源——它自己也是消费者。
- [x] 3.4 红测：`sync_pr` 缺省 ⇒ 归属交叉核对不参与；写了且与 `addedBy` 不符 ⇒ 红并打印两个编号。
- [x] 3.5 红测：本地无 `--current-pr` 时 3.1/3.2 仍按"文件是否在基线上"判定（否则本地跑会把每条新记录判成欠账）。

## 4. 接线与口径同步

- [x] 4.1 `quality-gate.yml` 的 `changes` job（无 job 级 `if:`、`shell: bash`）内传 `--current-pr=${{ github.event.pull_request.number }}`，并强制打印 `MERGE-LEDGER prs=<n>`；**不得**放进 `static-gates`（`check-unwired-tests.js` 的 `TEST_ONLY_IN_SKIPPABLE_JOB` 会拦。）——**旗标那一半经第三轴评审 F2 撤销，打印与落点两半已落，见 §7/§10**)
- [ ] 4.2 回读一次真 CI 日志取 `MERGE-LEDGER prs=` 读数：这是"GitHub runner 上 origin/main 真取得到"的唯一证据，本机读数不算（design 残留风险 1）。
- [x] 4.3 `openspec/records/_TEMPLATE.md`：**四处内部矛盾必须一次改完**（评审 `F4` 逐行点名，只改第 28 行会留下自相矛盾的模板）：① 第 8 行"回填成 PASS 后必须整段删除"这条触发器在新形态下**永远不会触发**（人不再写 PASS）；② 第 9 行"留下不删 = 门禁报已回填却仍留登记字段"对纯派生收口的记录不成立（D5 豁免该格）；③ 第 10–12 行默认预填 `sync_status/sync_reason/sync_backfill_owner` 与 D5"新记录一律不写"正相反；④ 第 28 行 Fresh 证据列还写着"合并后取 git log…回填 merge SHA…回填后删除上方三个字段"的人工回填指令，与 D1 冲突。正解：删掉 8–12 整块（含两句注释），第 28 行状态列写"由门禁按主干历史推导"、证据列改写为"归属由 `merge-ledger` 解析，无需事后回填"。**已实测无冲突**：`scripts/check-record-qm5-rows.js` 的 `OUT_OF_DOMAIN` 排除 `_TEMPLATE.md`，且只从带 `（QM-5 ①…⑤）` 标记的行题派生 ⇒ 改 8–12/28 行不断 QM-5 棘轮。**反向警告**：第 20–23 行是 `requiredStepsFromTemplate()` 的派生来源，禁止触碰。
- [x] 4.4 `AGENTS.md`：**禁止按行号改**（本轮实测该文件是热点载体：本会话进行期间另一会话给它「合并后收尾清单」新增了第 5 步 `check-branch-merged.js`，行号已整体下移）。改前必须先 rebase 到当时 origin/main，再按**章节锚点**定位：docs-only 快速通道的「两种形态必须同写」「远程同步状态列只认闭合词表」两段、「PR 自动合并」的禁止项「合并后不回填远程同步」与合并后收尾清单第 1–4 步、QM-2 的「执行记录里的待办状态必须有东西在检测」整条。保留不动：历史叙述（GH011 直推被拒、#2411、旧载体冻结动因）与"必须经 PR 落地/禁止直推 main/禁止 `--no-verify`"三条硬约束。
- [x] 4.5 `scripts/check-pr-exec-record.js` 的"出路④不校验 PENDING→PASS 真实性、信任边界交给 gate-record-debt"注释同步更新——本 change 之后那道信任边界真的存在了，留着旧注释就是装饰性注释。
- [x] 4.6 workflow 结构自检：`node .github/scripts/check-workflow-structure.js` rc=0，且改过的 `run:` 块喂真解释器做一次 ParseInput（仓规：js-yaml 绿 ≠ PowerShell 能解析）。
- [x] 4.7 **打印即门禁**（评审 i4）：判据在 CI 环境下 `prs=0` MUST 非零退出并点名"派生档未生效"；`workflow-contract.test.js` 加一条结构锁——该步骤 MUST 在 `changes` job、MUST NOT 在任何带 job 级 `if:` 的 job。把步骤挪进 `static-gates` 必须红（与 5.1 的 M8 配对，一条行为锁一条结构锁，各测各的）。

- [x] 4.8 **相邻缺陷：已按用户拍板在仓侧修**（落点与我最初的判断不同，如实纠正）。真正缺陷住在**仓外**用户级技能 `~/.claude/skills/adversarial-review-loop/scripts/ccg-deep-review.js:541`：slug = `"ccg-plan-" + basename(方案文件去扩展名) + "-" + critic`，**只用文件名、不带所在目录** ⇒ 两个 change 里都叫 `design.md` 的规划文件撞进同一产物目录，后跑静默覆盖先跑（2026-10-10 那次修复加了 critic 维度，没加目录维度）。仓内没有 vendored 驱动可改（`scripts/ccg-deep-review.js` 不存在，`plan-review.sh` 回落到用户级）。用户选定：**不动共享技能文件**，改在仓侧调用点加碰撞守卫。
      落点 `scripts/plan-review.sh`（环境闸之前）：同名 slug 目录里 `proposal-v1.md` 与本次方案逐字不同 ⇒ 打印根因 + 三条出路 + rc=2 拒绝；`MP_ALLOW_PLAN_COLLISION=1` 知情放行但必须留痕；`MP_ARTIFACT_ROOT` 仅供测试覆盖。回归锁在 `scripts/plan-review-deps.test.js`（9/9），含一条"守卫必须早于环境闸与驱动搜索"的结构锁。变异反证 P-A/P-B/P-C/P-D 各自 CAUGHT：其中 **P-D 起初 PASSED**，暴露我 `rc===2` 断言不可分辨（环境闸也退 2）——本仓第三次踩到"两个原因共用一个读数"，改成"守卫必须是最后一段输出"的形状断言才咬住。
      仍待上游处理（不在本 PR）：技能侧把目录维度并进 slug。本条**不**删，作为指针留着。

## 5. 验证与收尾

- [x] 5.1 变异反证 M1–M13（含 M2b/M9/M10/M11/M12/M13）逐条实跑，要求**红集互不相同**且各自指名（不得用"整体 LOADFAIL 一片红"充当证据）。
- [x] 5.2 静态门禁本机点名跑（本机 pre-commit 不覆盖 CI 静态项）：`check-gate-record-debt.test.js`、`check-pr-exec-record.test.js`、`workflow-contract.test.js`、`check-unwired-tests.js`、`check-step-failfast.js`、`check-workflow-structure.js`、`check-doc-abs-paths.js`、`check-changelog-growth.js`。
- [x] 5.3 `node scripts/classify-docs-only.js --base=origin/main --head=HEAD` 在 **commit 之后**取证；本 PR 含 `scripts/` 工具脚本 + workflow 正文 ⇒ 预期 `docs-only=false`（混合 PR），走完整质量节拍，不得借道快速通道。
- [x] 5.4 QM-6 双模型外部评审（后端 + 前端，打在设计文档与实现 diff 上），Critical 清零后才继续。—— 实到 **3 轴**：后端 claude（决策层 + 验证层）、前端 opencode（两次零交付，记为未执行）、跨家族第三轴 codex（验证层，Critical 0 / High 1 / Medium 3）。逐条处置见 §10。
- [x] 5.5 执行记录 `openspec/records/gate-record-sync-derived-status.md`：门禁表 + `远程同步` 行按新形态写（不填 merge SHA）。
- [x] 5.6 CHANGELOG 收口 + `01-docs/learnings.md` 记「键选错导致循环依赖」这条根因。
- [ ] 5.7 开 PR；按「PR 自动合并」判据 1–5 自查后 squash 合并并删远端分支（判据取产物：`state=MERGED` + `mergeCommit.oid`、远端分支 0 行、`git log` 恰 1 行；rc 不作判据）。
- [ ] 5.8 回读本次合并触发的 main push（按 (merge SHA, workflow) 判）：`quality-gate.yml` 无 push run 时如实记 `NO_RUN(by design)` 并转核该判据最近一次在 main 上的读数。
- [x] 5.9 **本 change 自身不得留下回填 PR**：收口由片 2 的推导得出，若仍需人工补写，说明判据没接上，回到 2.1 重做。
- [ ] 5.10 worktree 按 R1–R7 走 `scripts/safe-worktree-remove.ps1`（先 `-WhatIf`）；删前先删本任务遗留的两个一次性探针 `.tmp-*.cjs` / `.tmp-*.out`（走 `node scripts/safe-delete.js`，禁止递归删除）。
- [ ] 5.11 归档执行（判定已在**片 0** 做完）：按片 0 的结论归档本 change；归档后回读 `openspec/specs/` 是否收敛到预期文本，并核对 `enforce-gate-record-presence` / `freeze-legacy-gate-carrier` / `hot-carrier-atomic-landing` 三份未归档件在本 change 归档后仍能 validate。禁止在这一步临时改判据形态。

## 6. 片 2 / 片 3 实现现场与偏差（回填，非计划）

判据接入完成：`node --test scripts/check-gate-record-debt.test.js` ⇒ `# tests 73 / pass 73 / fail 0`（既有 58 条 + 本轮 15 条）。邻居判据未被打断：`check-pr-exec-record.test.js` 57/57、`check-record-qm5-rows.test.js` 19/19。
真仓 CLI 现场（本机 base=origin/main）：`MERGE-LEDGER prs=1936 归属可解析记录=424 派生收口=403 byDesign=0`，rc=0（改前也是 rc=0 ⇒ 总判定同向）；旧键歧义 6 篇进可见项。

| 任务 | 状态 | 证据 / 偏差 |
|---|---|---|
| 2.1–2.3 | 完成 | 用例「派生通道收口」「缺行仍然即红」「账本不可用必须退回断言档并 fail-closed」；变异 N1/N4/N2 CAUGHT |
| 2.4–2.5 | 完成 | 用例「字段卫生只约束做过闭合断言的记录」「谁做断言谁受约束」「跨源拦截面保持 blob」；N7 CAUGHT（把旧键算进拦截面即红） |
| 2.6 | 完成，且**比计划更严** | 真仓对账锁把 `baseRef` 钉成 `git rev-parse origin/main` 的**显式 SHA** 再两侧同 SHA 跑；变异 N8a/N8b/N8c 全部 CAUGHT（N8 最初 PASSED，暴露出"collect 默认分支永不被走"的死路径，已改为只能注入，见 D4b） |
| 2.7 / 2.8 / 2.12 | 完成 | 派生档输入 = `listRecordFiles` 结果（同一次循环）；`merge-ledger` 源码禁 `readdirSync/ls-tree/globSync`；判据源码禁第二份 `git log` 与 `execFileSync('git'` |
| 2.9 | 部分完成 | 优先级写成声明式链并有 N3/N4 反证；**M9（把 blobClosed 提到派生之前的严格 reorder 变异）留到片 5 与 M1–M13 一并实跑**，现未跑 |
| 2.10 / 2.11 | 完成 | 在 `merge-ledger.test.js`：改名重指（MU-B）、newest-wins（MU-C） |
| 2.13 | 完成 | 用例「CI 档账本不可用必须非零退出」真起子进程，断言 rc=2 且本机不套用；顺带测出并修掉 `parseFlags` 白名单前缀 bug（CI 下发 `--carrier-mode=visible` 原本会抛未捕获异常） |
| 3.1 / 3.2 / 3.4 / 3.5 | 完成 | 用例「byDesign / prematureClaim」「声明不符判红；缺省不判；一致不判」「规范键读不出整数即红；旧键只可见」 |
| **3.3 偏差** | **未按计划实现** | 计划要求"本次变更集"复用 `classify-docs-only.changedFileStatuses`。实现改为**「该路径不在 base 的归属映射里」= 本次新增**，理由：判据已经必须读 `addedBy`，用它作判据不引入第二个取源，也不依赖 merge-base 参数在 push 事件下的形态；`changedFileStatuses` 反而会把 CI 的 base/head 事件差异引入本判据。**代价如实记**：本地在陈旧 baseRef 上跑时，"别人已合并但我没 fetch"的记录会被判 byDesign 而非派生收口——这只会少拦不会多拦，且 CI 档 fetch-depth 0 下不存在该形态。若片 5 双模型评审认为须换回，改判据为注入 changeset 即可，位置已在 D3 标注。 |

新增产物：`scripts/lib/merge-ledger.js`、`scripts/lib/merge-ledger.test.js`（片 1）；判据与 CLI 改动在 `scripts/check-gate-record-debt.js` / `.test.js`；CI 接线一行在 `quality-gate.yml` 的 `changes` job。
一次性工具（收尾删除）：`.tmp-mutate.cjs`、`.tmp-mutate2.cjs`、`.tmp-mutate3.cjs`、`.tmp-*.out`、`.tmp-*.cjs` 探针若干、`.tmp-commit*.txt`。

## 7. 片 4 完成现场（口径与接线）

- [x] 4.3 `_TEMPLATE.md` 四处矛盾一次改完（删第 8-13 行整块、第 28 行改「由门禁推导」并删人工回填指令；第 20-23 行 QM-5 派生来源未触碰）。实测 `check-record-qm5-rows.test.js` 19/19 仍绿。
- [x] 4.4 `AGENTS.md` 四处按章节锚点改写：取消「合并后必须回填远程同步」禁止项并写替代；收尾清单第 3-4 步合并成「不再需要回填动作」并顺延重编号（5/6/7→4/5/6）；docs-only 快速通道两条收窄为只约束旧载体与存量；QM-2「待办状态必须有东西在检测」补"推导比回填更强"。
  **事故如实记**：第一次替换我把收尾清单第 5 步（`check-branch-merged.js`）的行首吞进了 new_string，导致该项与第 3 步粘连；当场核对 `sed -n '116,117p'` 发现并补回、重排后续号。教训：改**有序列表**时 old_string 不得跨到下一条目的开头。
- [x] 4.5 `check-pr-exec-record.js` 出路④信任边界注释按新事实改写；①号出路不再教作者写 `sync_*` 三字段。`check-pr-exec-record.test.js` 57/57。
- [x] 4.6 workflow 结构自检 `check-workflow-structure.js` rc=0；`workflow-contract.test.js` 新增落点锁后 40/40，且变异 M-A（整行摘掉）/M-B（挪到非 PR 早退之后）各自 CAUGHT、`check-unwired-tests` 同步点名（两把锁各测各的）。
- [x] 4.7 打印即门禁：CI 档账本不可用 ⇒ rc=2（真起子进程断言，另断言本机不套用）；`MERGE-LEDGER prs=<n>` 必须在输出首行，默认 baseRef 由 CLI 测试自己证明读得到（变异 N8a/b/c 因此 CAUGHT）。
- [x] 4.1 **已收敛（片 5 第三轴 F2 的裁决）**：`--current-pr` 从 `parseFlags` 白名单里**删除**，并加一条"传它就抛未知旗标"的用例。理由链在 design D7：byDesign 的判据是"该路径不在 base 归属映射里"，不需要 PR 号；而一个被白名单接受又没有消费者的旗标，在 CI 日志里读起来就像"某一档生效了"——与"拼错了被静默忽略"是同一条反模式的两端。workflow 侧本来就没注入过它，所以删除零影响。另一半（强制打印 `MERGE-LEDGER prs=<n>` + 落点不得进 `static-gates`）片 4/片 5 已落。
- [ ] 4.2 **留到 PR 之后**：`MERGE-LEDGER prs=` 在 GitHub runner 上的真实读数只能等这次 CI 跑完取日志（本机读数不算证据，见 design 残留风险 1）。

## 8. 验证层（动手后）评审：交付情况与逐条处置

**先如实记交付面**：`scripts/deep-review.sh` 跑完 rc=0，但它按**最后一笔提交的差量**（104 行）判成 SINGLE、且产物 `deepReview.status=error`（proposer 步骤失败）⇒ 对 enforce 卡着的 4 条 DUAL 判定**没有闭环作用**。按本仓口径"评审成败一律按产物判"，改为手动起后端。

| 轴 | 后端 | 交付 | 处置 |
|---|---|---|---|
| 后端 | `claude` | **6 条（1 critical / 2 high / 3 medium）** | 逐条见下 |
| 前端 | `opencode` | **两次尝试均零交付**（只回会话状态，文件读取截断） | 记为未执行；补发第三轴 `codex`（跨家族第二路），结果落在本节末 |

| 条 | 判定 | 处置 |
|---|---|---|
| F1 critical「账本不可用时 prematureClaims 永不触发，预写 PASS 被判绿」 | **部分成立，非新洞** | 这正是设计声明的"退回断言通道"（改前行为），且 CI 档由 rc=2 先拦。但它指出我出声不够：n/a 那行原文只说"派生档停用"，没说** prematureClaims 与 delivered_by_pr 核对一起熄灯**。已补进文案并加断言 |
| F3 high「交叉核对被 `ml.ok && state==='PR'` 双重锁死，新增记录永远跳过」 | **同上，按设计** | 同 F1 处置；新增记录本就走 byDesign，合并后才有事实可比对，跳过是对的 |
| F4 medium「规范键存在时旧键被静默吞掉」 | **成立** | 改为两键并存且取值不一致时也记可见歧义（文案点名"并存且不一致"），并加用例锁；收口结论仍只由规范键 + 主干事实决定 |
| F5 medium「碰撞守卫可被 `MP_ARTIFACT_ROOT` 指向空目录绕过」 | **成立（知情面）** | 覆盖默认产物根时必须出声（已在 stderr 打印"产物根被覆盖"）。`MP_ALLOW_PLAN_COLLISION=1` 是显式知情放行，本就有留痕 |
| F6 medium「落点缺结构化防护，误迁到 static-gates 无测试能捕获」 | **驳回，取证在案** | 该锁已存在且已实测：`workflow-contract.test.js` 新增用例断言"必须在 changes job、必须早于非 PR 早退、不得出现在带 job 级 if 的 job"，变异 M-A（摘行）与 M-B（挪位）各自 CAUGHT。评审者没读到那个测试文件（我给它的范围里没列），属范围盲区而非缺陷 |

**F1/F3 连出的第二条真缺陷（由我自己踩出来）**：新形态记录在账本不可用时会落进"未登记欠账"——那是把"我测不了"说成"你没做"的**假指控**，还会诱导作者回补登记字段（正是本 change 要淘汰的形态）。已加第三档 `unprovenDerived`（可见、不拦、明说未证实），并锁"未证实 ≠ 已收口"与"账本可用后同篇必须转派生收口"两个方向。真仓用例 #24/#70 就是这条的现场。

套件：`check-gate-record-debt` **76/76**、`plan-review-deps` 9/9、`workflow-contract` 40/40。
过程事故如实记：这轮一次编辑漏了一个右括号导致测试文件 LOADFAIL、`node --check` 之前直接跑全量 ⇒ 红只以"整片挂"呈现、指不出用例。已改为**先 `--check` 再跑**，与既有记忆「校验必须在 write 之前」同源。


## 9. 片 5 收尾现场（验证与交付）

| 任务 | 状态 | 证据 / 偏差 |
|---|---|---|
| 5.1 变异反证 M1–M13 | 完成 | 合并工具一次跑 **15 条**（M4 拆 a/b、含 M2b）：全部 CAUGHT、还原后五个文件 md5 一致。红集互不相同，两处如实记的例外：① **M4b 与 M12 红集相同**（都红在改名重指那条）——M12 是**测试文本**变异，按设计必须红在它自己那条断言上，否则那条断言就是同义反复，这不是 uniqueness 破口；② M9 起初与 M13 同红在真仓对账锁，给「谁做断言谁受约束」补了 `derivedClosed.length === 1` 才拿到指名红 |
| 1.7 隔离测试的派生档一半 | 完成（此前只落了一半，现在补齐） | M2（`addedBy` 恒解析不到 PR）实测红 8 / 全量 77 ⇒ 红的全是派生档用例（派生通道收口、谁做断言谁受约束、真仓对账…），"状态列写了闭合词"的兼容档一条没红——正是 i1 口径修正要求的那个**不对称**：归属读不出应落欠账分支，不是派生分支自己红 |
| 5.1 过程失真（三格，全是工具自己的错） | 已修并写进 learnings | ① 锚点写 `\n` 而判据/workflow 是 CRLF 工作副本 ⇒ M8/M10 报 ANCHOR-MISS **静默不跑**，第一版差点被读成"这两条已验过"；② M7 用"整行删除"表达"摘掉拦截"，让下一行 `else` 悬空变 SyntaxError ⇒ 红集打印成**文件名**而不是用例名；③ 改成 `\r?\n` 锚定 + `if (false && …)` 摘除后重跑才拿到真读数 |
| 2.8 / 反证 M10 | **补落，之前是过度声称** | 片 2 那轮把 2.8 记成"完成"，依据是"主循环只有一份枚举"——那是构造性论证，没有任何断言能抓到"循环输入换成第二份 readdirSync"。现补 `recordsClassified`（派生档实际处理过的集合）+ 集合相等用例，M10 实测 CAUGHT（同时红在模板排除锁与域一致锁两条） |
| 2.6 / 反证 M13 | 补断言 | 真仓对账锁加 `ml.baseSha === frozen`：去掉 `baseRef: frozen` 的钉死（退回默认值或改写 HEAD）当场红。钉死的 SHA 已回写执行记录 = `c57616b6100792d950c3a717775d8aab4362c383` |
| 5.2 静态门禁本机点名 | 完成（rebase 后重跑） | `check-gate-record-debt` **77/77**、`merge-ledger` 10/10、`check-pr-exec-record` 66/66、`workflow-contract` **43/43**、`plan-review-deps` 9/9、`check-record-qm5-rows` 19/19；`check-unwired-tests` / `check-step-failfast` / `check-changelog-growth` / `check-workflow-structure` / `check-doc-abs-paths` / `check-gate-record-debt` 各 rc=0 |
| 5.3 docs-only 判定 | 完成 | `node scripts/classify-docs-only.js --base=origin/main --head=HEAD` 在**提交之后**取证 ⇒ `docs-only=false files=41`（含 `scripts/` 工具脚本 + `.github/workflows/` 正文）⇒ 走完整质量节拍，不借道快速通道。本条 tasks 更新本身只动 tasks.md，不改这一结论 |
| 5.5 执行记录 | 完成 | `openspec/records/gate-record-sync-derived-status.md`：新形态（状态列「由门禁推导」、不带 `sync_*` 字段）。判据当场把它判成 `byDesign=1` 而不是欠账——**本 change 自己就是第一条不需要回填 PR 的记录**（这也是 5.9 的正面证据） |
| 5.6 CHANGELOG + learnings | 完成 | CHANGELOG 置顶一条标题块（`check-changelog-growth` PASS：base 498 条全在 head，无条目丢失；`check-changelog-duplicate-entries` 无重复）；`01-docs/learnings.md` 三条 lesson（断言 vs 测量 / 键名先清点 / 构造正确不等于有锁） |
| 5.9 本 change 不留回填 PR | 成立 | 判据首行 `MERGE-LEDGER prs=1975 … 派生收口=426 byDesign=1`，合并后本篇自动转派生收口，无任何人工写回动作 |
| rebase 冲突三处（热点载体） | 已按语义解决，非"后推覆盖" | `AGENTS.md`：收尾清单是**同一条目的不同状态** ⇒ 条目 3 取我的（不再需要回填），条目 4 取 HEAD 的（含 2026-10-17 v2 的判定域说明），busy holders 条顺延为 5；两口径 numstat 一致 `9/10`。`workflow-contract.test.js`：**并集**（HEAD 的桌面产物配对锁 + 我的落点锁都保留，补一个 `});` 让两个 test 各自闭合）⇒ 43/43。`CHANGELOG.md`：**并集**（两侧是不同记录）⇒ `11/0`，棘轮 PASS。`learnings.md` 第一次插成**双 CR=20234**（`split(\n)` 后原行自带 `\r`，又 `join(\r\n)` 再补一个），当场被"双 CR 必须为 0 且 CR/LF 守恒"的写前校验挡下并单文件还原 |
| 4.6 的 ParseInput 一半 | 不适用，已按替代口径取证 | 该 `run:` 块是 `shell: bash`，PowerShell ParseInput 检查对它没有对象；正解改成"把接线的那一条命令原样在 bash 里跑一次"——`node --test scripts/lib/merge-ledger.test.js` 实测 10/10，且 `check-workflow-structure.js` / `check-step-failfast.js` 各 rc=0 |
| 本文件自己的行尾现实（第一次真拦下东西） | 已改并保持 LF，并记下写入者的行为 | `git ls-files --eol` 对 tasks.md 报 `i/lf w/-text attr/text=auto`：**`-text` 意味着 git 不再对它做 eol 转换 ⇒ 工作副本里的 `\r` 会原样进 blob**。按 CRLF 写回时 `git diff --numstat` = 152/132（每行都算被改）而 `--ignore-cr-at-eol` = 46/26——两口径背离正是仓规那条对账判据，本轮第一次拦住我自己写的脚本。更细的一格：把整份归一成 LF 之后，编辑器写回单行改动又留下**恰好一个 `\r`**（151 行里 1 个 CR），而两口径此时仍然一致（52/32）——说明"孤立 CR 让 text=auto 整份失效"这个坑**不能靠两口径对账兜底**，必须显式数 CR。落点：追加脚本一律先 `replace(/\r/g,'')` 再写，并报出剥掉的 CR 数 |

**故意不做**（防止下一个会话"顺手补上"）：`.ccg/reviews/` 下的孤儿判定产物不删（无门禁校验文件名↔commit，留着是审计面，删了反而制造 dirty）；`--current-pr` 已彻底删除而不是"留着但不注入"——见上条 4.1，"接受一个不生效的旗标"本身就是本仓禁止的那类静默失效。


## 10. 第三轴（codex，跨家族）验证层评审：交付与逐条处置

opencode 两次零交付后补发的一轴，产物落在本机临时目录下的 `qm6-codex-r1.txt`（含 Session-ID，可续问；**不写绝对路径**——Gate 12c 当场把第一次写入拦红了，占位符形态才是受管文档该有的写法）。它按范围**逐文件读过**（输出里逐条给了实际读到的行号与原文），Critical 0 / High 1 / Medium 3，另有 F3/F4/F7/F8 四条自我核实为"非缺陷"。

| 条 | 严重度 | 判定 | 处置 |
|---|---|---|---|
| F1 规格明写的 fail-closed 被实现反向放行，且第三态没写进 spec | High | **成立——这是我造成的规格漂移** | 代码是对的（§8 里由后端轴 F1/F3 逼出来的 `unprovenDerived`），但我只改了 design 与代码，**没传导到 `specs/quality-gate-execution-record/spec.md`**：spec 原文写"派生不成立一律进入断言通道、凡未知写法判未收口""不得出现悬空格"，而实现让 `由门禁推导` 跳过了断言通道。已在 spec 求值序列加 **2b 未证实档**（三条件齐全：账本不可用 ∧ 该标记 ∧ 不计收口），并明确"它是一条有名字、有判据、有打印的档，不是悬空格"；新增一条 Scenario 锁住两个方向（账本恢复后同篇必须转档；词表外其它写法仍判未收口）；上面那句"退回断言通道判定"也同步带上例外指针。**这是本 change 第三次栽在同一格**（前两次：design 改了 specs 没改、specs 改了 _TEMPLATE 没改），已写进 learnings |
| F2 `--current-pr` 在白名单里但没有任何消费者 | Medium | **成立，且比我自己记的那条偏差更严重** | tasks 4.1 原本写的是"留着但不注入，若评审认为应删就删"。评审的理由直接命中仓规：接受一个不生效的旗标 = "拼错被静默忽略"的同一条反模式的正向版。已删白名单项 + 删 `needValue` 项，并把原来那条 `doesNotThrow` 测试**翻成 `assert.throws`**（翻之前它守的是缺陷，翻之后守的是修法）；design D7 与 tasks §7/§10 同步 |
| F5 方案文件不可达时碰撞守卫被静默跳过 | Medium | **成立** | `plan-review.sh` 第 21 行就 `cd "$ROOT"`，从子目录传的相对路径到守卫处已解不进原文件 ⇒ `[ -f "$PROPOSAL" ]` 假 ⇒ 整块守卫**一声不吭地跳过**。已补一条"不可达 ⇒ stderr 出声并点名该路径 + 给出改传绝对路径"的分支，回归锁 `plan-review-deps.test.js` 新增一条（判据不看 rc：跳过时脚本照样往下跑；只看有没有出声、有没有点名）⇒ 套件 10/10。变异反证两条各红在该条**指名用例**：**P-E** 摘掉整个出声分支；**P-F** 把文案改短（同时摘掉"点名路径"与"绝对路径"两个线索），证明这条锁不是"只要打印点什么就绿"。还原后 `plan-review.sh` md5 一致；两条红在同一条用例属正常（同一条锁的三个断言各测一格），不冒充成两个不同红集 |
| F6 `runGit` 未传 `--no-optional-locks` / `fsmonitor` | Medium | **驳回，理由写在这** | 它自己给了降级理由但没核对判据形态：`buildLedger` 只跑 `rev-parse` / `log`（**全部只读、不取 index.lock**）；`--no-optional-locks` 作用对象是 `status` 那类"可选加锁"命令，对 `git log` 是空操作。隔离夹具是 `git init` 出来的私有目录，锁竞争面不存在。加它不会更错，但会制造"这条被处理过"的错觉——按仓规「不为不存在的消费方加键」，不加 |
| F3 / F4 / F7 / F8 | — | 评审者自行核实为非缺陷 | F3 关心 `recordsClassified` 把缺行文件也计入——它确认这是对的（域锁测的是"循环实际处理了哪些文件"）；F4 确认"派生与断言同时记账"与 spec 一致（这正是 M9 那条新断言）；F8 主动排除了一个**假 finding**：它一开始怀疑我删了 `Gate 2b6`，自己查回那是 merge-base 差异（本分支 fork 点早于 PR #3830），未误报 |

套件复跑（codex 处置之后）：`check-gate-record-debt` 77/77、`merge-ledger` 10/10、`plan-review-deps` 10/10、`workflow-contract` 43/43、`check-pr-exec-record` 66/66、`check-record-qm5-rows` 19/19。
