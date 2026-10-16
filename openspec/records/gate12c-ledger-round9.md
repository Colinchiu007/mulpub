---
record: gate12c-ledger-round9
task: 账本第九轮——#3652 合并后 main push 转红，按新口径把追不上的存量文件补进快照
date: 2026-10-16
# ↓ 下面三个字段只在「远程同步」尚无法收口时填写；回填成 PASS 后必须整段删除。
sync_status: PENDING
sync_reason: 本 PR（gate12c-ledger-round9）尚未合并；合并后由回填 PR 把远程同步行改为 PASS 并删除本段三个字段
sync_backfill_owner: 下一个会话（合并后改为 PASS 并删除本段三个字段；新载体不进 JSON ledger）
---

## 本次执行记录：账本第九轮——口径换代落地后 main push 的过渡红（gate12c-ledger-round9，2026-10-16）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | PASS | 🔧 CI/门禁数据（`scripts/doc-abs-paths-baseline.json`）+ 📝 SOP 条款（`AGENTS.md`）⇒ **混合 PR**（不走 docs-only 通道），必须在隔离 worktree 做。worktree `<仓库父目录>/mp-worktrees/mp-gate12c-ledger-round9`、裸分支 `gate12c-ledger-round9`，由 `git -C … worktree add -b …`（用 PowerShell 原生盘符路径写法，不用 /d/… 混写）在 `origin/main` tip `5546bea64` 上建，`rev-parse --abbrev-ref HEAD` 与 `--show-toplevel` 双回读实证。⚠️ 偏差如实记：未走 `start-mp-task.ps1`，因共享根有他人会话 2 个 untracked（`01-docs/EVEROS-DISTILL-INDEX-*` / `SESSION-AUDIT-ALL-27-*`），其 `-RequireClean` 健康检查按设计拒绝；本 PR 不需 node_modules（判据只用 node 内置模块），故手工 `worktree add` + 可进入性自检，不碰共享根状态 |
| 第一性原因（QM-5 ①） | PASS | **账本是「某一棵树的快照」，而自测算的是「CI 检出来的那棵树」，squash 合并让两棵树必然不同**。#3652 的账本在 merge-base `820bf19e8` 上重算（域 3412 / 564 文件 / 1184 处）；GitHub 的 squash 把我的**差量**落到**当时更新的 main tip** 上，产物树多出 `openspec/records/dep-audit-alias.md`（他人会话在 `820bf19e8` 之后合入的记录，含 2 处 worktree/临时目录绝对路径），账本给它 0 ⇒ 当场判「超出存量基线 1 个文件」。追溯链：main push run `38886071122` → job `116923992057` → step 11 `Gate 12c - Doc abs-path validity (changes job)` → 失败测试 `scripts/check-doc-abs-paths.test.js:608`「全量审计必须与基线逐文件相等」（`1 !== 0`）。这不是判据写错，也不是我的差量引入：**任何比 main 旧的 base 上重算的快照，落地那一刻就已经过期** |
| 逃逸分析（QM-5 ②） | PASS | ① **PR 侧为什么绿**：PR 侧检出的是我自己分支的树（merge-base + 我的提交），里面根本没有 `dep-audit-alias.md`，账本与树自洽 ⇒ `--all` 自测照绿；红只在 squash 产物树上出现。② **门禁层**：#3652 的 PR 判据（改动集 + 基线并入）与自测（真实仓库全量）在 PR 侧是同一棵树，所以"全绿"这件事本身**不构成"main 会绿"的证据**——这是本仓既有教训「真实仓库自证在未提交时跑的域 ≠ CI 的域」的第 N 次命中，只是这次的域差来自 squash 语义而不是未提交状态。③ **流程层**：AGENTS.md 的「合并后收尾清单」只要求取 merge SHA / 证远端分支已删 / 回填，**没有任何一步要求回读那次合并触发的 main push**——所以"合并即收口"是默认心态，红了要等下一个会话发现。④ 分类：审查盲区（把"PR 侧 CI 全绿"当成"这次改动在 main 上成立"）+ 流程缺失（收尾清单缺 main push 回读这一格） |
| 修复 + 回归保护（QM-5 ④） | PASS | ① **机械修法**：在 `origin/main` tip 上跑 `node scripts/check-doc-abs-paths.js --all --write-baseline` ⇒ 域 **3416** 个受管文件 / **565** 个文件 / **1186** 处，`新增 1 / 消失 0 / 计数变化 0`（新增项即 `openspec/records/dep-audit-alias.md`，2 处：`L22` worktree 路径、`L153` `<盘符>:\Temp`）。② **归属反查**（本 PR 不认领别人的内容，也不把自己引入的红推给别人）：`git diff --name-only 820bf19e8 5546bea64` 里 `dep-audit-alias.md` 由 #3707 侧的记录写入，**不在本 PR 改动集**；本 PR 改动集只有账本 JSON、`AGENTS.md` 与本记录。③ **回归保护**：修完当场复跑 `node --test scripts/check-doc-abs-paths.test.js` ⇒ `tests 53 / pass 53 / fail 0 / **skipped 0**`（rc=0），复核 #75 换来的 `skipped=0` 未被加回；先复现再修也做了——在 main tip 上修前实测 `52/53`、红因与 CI 逐字同形（同一条 `全量审计必须与基线逐文件相等` + 同一个文件名与两处行号）。 **该读数不是终点**：随后本 PR 自己的记录文本又把它打破一次，全过程与口径见下一行「本 PR 自带文本被本 PR 的判据判红」。④ **不做的事**：不把 `dep-audit-alias.md` 里的绝对路径就地改成占位符。那一条也是合法修法（门禁自己列的两条正解之一），但它会让本 PR 去改**别人会话的证据文本**；账本按设计就是把"落地前已存在"的现场收进存量，改别人的记录要由记录作者或后续专门 PR 做（已另立任务收敛我自己那条）。⑤ 未顺带收紧判据本体：本轮的域是 3416/565/1186，判据代码零改动 |
| 防止再次发生（QM-5 ⑤） | PASS | ① **SOP 落点（有文件变更）**：`AGENTS.md`「合并后收尾清单」新增第 7 条——合并后必须回读**这次合并触发的 main push**，且对"账本/基线/快照型数据文件"类 PR 规定：PR 侧全绿不构成 main 会绿的证据，红了按本轮口径补一轮并把归属写进记录。② **机制本体早已存在**：`check-doc-abs-paths.test.js` 的「全量审计必须与基线逐文件相等」就是把这件事**从人工发现变成机械发现**的那条锁——本轮它第一次在 main push 上开火（不是它写坏了，是它第一次真的有能力开火，因为口径换代刚落地）。③ **反失明**：修法判据取产物（`tests/pass/fail/skipped` 四数 + `--all` 的 `counts/domain/files` 机读行），不取 rc；重算前先备份旧账本到 `.tools/tmp` 以便逐键对账新增/消失/变化三个数。④ **口径写进记录**：过渡成本只发生一次——新口径落地后账本首次覆盖全量存量，后续红只会来自"main 又前进了"，那属第 7 条收尾回读该抓的事 |
| 本 PR 自带文本被本 PR 的判据判红（一次现场自证，四步读数如实记） | PASS | 时序：① 在 `origin/main` tip 上先复现 main 的红——`tests 53 / pass 52 / fail 1 / skipped 0`，红因逐字等于 CI（同一句「全量审计必须与基线逐文件相等」、同一个 `openspec/records/dep-audit-alias.md`、同两处行号）； ② `--all --write-baseline` 后同一条命令回到 `53/53`； ③ **写完本记录后再测又变成 `52/53`**——红在我自己的文本：我为说明"必须用 PowerShell 原生路径写法"举了一个"单盘符 + 冒号 + 反斜杠"的字面量例子， 而判据按该形态计数，**例子本身就是一条本机绝对路径**（`L15: 1 处 > 基线 0`）； ④ 把那处改成纯文字描述（不再写出该形态）后：`--all` = `counts=1186 domain=3417 files=565` PASS，自测 `53/53 skipped 0`， 改动集口径 `counts=1186 domain=567` PASS。**教训（这条比修法更重要）**：我在改完文本后跑过一个"还剩几条盘符路径"的自查探针， 它要求"冒号后至少再跟一个路径字符"，所以"反斜杠后面紧跟反引号"的那种写法命中 0 条、探针报 `driveLikeTokens: []` 判"干净"， 而门禁本体当场把它计成一条。口径：**要判"扫到 0"，必须用被验收的那把判据本身再跑一次**，不得用自己抄的近似正则代替—— 这与本仓既有教训「『0 命中』先证明我的坐标是旧的」同型：探针的漏检会伪装成结论。 |
| 账本与存量对账 | PASS | 旧账本（`5546bea64` 上，即 #3652 刚落地的那份）：**564 文件 / 1184 处**；重写后：**565 / 1186**。`新增 1 / 消失 0 / 计数变化 0`；新增键集合 `{dep-audit-alias.md}` ∩ 本 PR 改动集 = **空集**（同第八轮的 `addedInMyChangeset=[]` 判据）。方向上这是**扩大存量**而不是放宽判据：计数口径 `all_abs_paths_v2` 未变、阈值未变、豁免清单未动、`isManagedDoc` 域未动。另：`generated` 字段仍写 `2026-10-14`（该字段由判据代码持有，本轮不改代码，故不动它——改它会与自测的逐字段断言对撞） |
| TDD 红→绿 | PASS | 本轮无新判据，但按同一纪律走"先复现再修"：在 main tip 的自有 worktree 上先实测 `tests 53 / pass 52 / fail 1 / skipped 0` 并确认红因逐字等于 CI（文件名 `openspec/records/dep-audit-alias.md`、`L22`/`L153` 两处、`1 !== 0`）；重写账本后同一条命令 `53/53`、rc=0。红→绿的差量只有一个文件（账本 JSON），可归因 |
| 行尾与 diff 对账 | PASS | `git diff --numstat` 与 `git diff --ignore-cr-at-eol --numstat` 两口径**逐字相同**（见 PR 正文取证块）；`scripts/doc-abs-paths-baseline.json` 与记录为 `i/lf w/lf`，未改写行尾；重写后的账本 `crlf=0 / loneCR=0 / nul=0 / U+FFFD=0`，`JSON.parse` 通过 |
| 接线棘轮 | PASS | 不改 workflow、不改 `CI_IGNORED_PATHS`、不动分支保护 ⇒ 不触发"改谁来守门"的人工过目条件。`check-doc-abs-paths.js` 与其自测仍逐个点名在 `quality-gate.yml` 的 `changes` job（Gate 12c），本轮正是该点名的步骤在 main push 上执行并报错——接线有效性由现场日志（step 11）自证，不靠登记表。`check-unwired-tests.js` / `check-workflow-structure.js` / `check-step-failfast.js` 复验见 PR 正文 |
| QM-6 CCG 双模型外部评审 | N/A | 变更集 = 一个门禁数据 JSON + 一条 SOP 条款 + 一篇记录，**无运行时代码**；按 AGENTS「纯文档/流程变更不强制 QM-6」处理。如实登记：三通道本轮实测不可达（同 #3652/#3693 现场），因此也**没有**"跑了但没问题"这回事，判 N/A 的依据是变更类型而不是评审结果 |
| QM-1 打包 / QM-4 视觉 | N/A | 未触 `apps/desktop/electron/`、`packages/rpa-engine/`、任何 `.vue`/样式/基线 PNG |
| 远程同步 | PENDING | 合并后取 `git log origin/main --grep='(#NNNN)$' --format=%H\|%cI` 回填 merge SHA 与时间，`git ls-remote --heads origin gate12c-ledger-round9` 返回 0 行证远端分支已删；回填时把本行改写为 PASS 并**删除上方三个 `sync_*` 字段**（同一次提交内完成，不在 JSON ledger 留项） |

### 遗留（不假装已闭合）

- **收尾清单第 7 条仍是人读的规矩**：它挡得住"下一个会话不看 main push 就宣布收工"，挡不住"共享根上并发会话谁先 push 谁覆盖"。真正机械化需要一条在 main push 后自动重算并比对账本的作业，那属另一份 PRD。
- **过渡成本只降不消**：只要判据持有 checked-in 快照，"PR 侧绿 / squash 产物树红"这一族就会在**每次口径变严**时重犯一次。本轮把新口径的存量补齐，是这条纪律的第一次兑现，不是最后一次。
- **我自己那条 #3693 记录里的 worktree 绝对路径**（`openspec/records/openspec-sync-realrepo.md:12`）现已进存量。更干净的做法是占位符化并同步**收紧**账本，已另立任务，不混进本轮。
