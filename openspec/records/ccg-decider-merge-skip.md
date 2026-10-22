---
record: ccg-decider-merge-skip
task: 修掉判定器在合并提交上按「对方整侧」判档（遗留 10）与判定记录不补末尾换行（遗留 7）两个遗留缺陷
date: 2026-10-21
---

## 本次执行记录：合并提交按「两侧交集」判档并停止落盘，判定记录统一补末尾换行（ccg-decider-merge-skip，2026-10-21）

> 本记录按 `gate-record-sync-derived-status` 之后的新形态写：不带 `sync_*` 三字段，状态列不手写状态词，收口由门禁按主干历史推导。
> 一个 change 收掉两条遗留项（遗留 10 + 遗留 7），理由是它们的引入点是**同一个提交**（`d98f54dbc` / PR #2955），
> 且都在同一条 `saveRecord` 落盘链上；拆成两个 PR 会让第一条的测试夹具与第二条的写盘断言在两次评审里各审一遍。

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | PASS | 运行时代码 + 判定规则：`scripts/ccg-review-decider.js` 是 **pre-commit 闸门本体**（每次提交都跑），属运行面；且命中 `check-pr-exec-record.js::HIGH_RISK_SURFACES` 的前缀 `scripts/ccg-review-`，因此 QM-6 必须真跑外部评审（不能只写 `closureNote`）。隔离 worktree `<worktreeRoot>/mp-ccg-decider-merge-skip` + 裸分支 `ccg-decider-merge-skip`，分支起点 = 当时的 `origin/main` = `2dbda6925`；`node scripts/verify-worktree-deps.js` rc=0（`@multi-publish/*` 全部解析到本 worktree）。改动面：`scripts/ccg-review-decider.js`、`scripts/ccg-review-decider.test.js`、`openspec/changes/ccg-decider-merge-skip/`、本记录。**不含 `CHANGELOG.md`**：该文件自 2026-10-21（change: changelog-record-carrier，`85dc44ddc` 起的 `origin/main` 已含）起明确「⛔ 不由 PR 直接编辑」，条目真源改为本记录的 `## CHANGELOG 条目` 小节，发版时由 `scripts/aggregate-changelog.js --write` 聚合搬运；顺带使本分支与主干在热写面上文件集不相交（实测 4/4 个可判定的 CONFLICTING PR，冲突文件**只有** `CHANGELOG.md` 与 `01-docs/learnings.md`）。 |
| 第一性原因（QM-5 ①） | PASS | 两条遗留项同源，引入点都是 `d98f54dbc`（PR #2955，2026-10-05T17:09:40Z，那次的名义是「新增深度审查本地入口 `deep-review.sh`」，两处缺陷是搭车改动）。① 它写了 `collectStaged()`，输入是 `git diff --cached`；而 pre-commit 在**合并提交**上运行时，index 相对 `HEAD` 的差异恰好是「ours tip → 合并结果」= **对方那一侧**的改动集（合并前 `HEAD` 是 ours，`MERGE_HEAD` 是 theirs），于是判档读的是对方的规模，`layer` 仍是 `diff`、`sha` 仍是 ours tip，看不出任何异常。② 它写盘用 `JSON.stringify(record, null, 2)`，**从不补末尾换行**，于是每个判定记录都缺 POSIX 意义上的尾换行。两条相隔 16 天（2026-10-05 → 2026-10-21）。 |
| 逃逸分析（QM-5 ②） | PASS | 三层同时漏过，逐层有具体原因，不是「没人想到」：① **单测层**：既有 52 条用例里**没有一条构造过 `MERGE_HEAD`**（`git merge` 形态），夹具全是「单父 + 工作区改文件 + `git add`」，于是「输入其实是对方一侧」这件事在测试里**结构性地不可表示**——夹具没有第二种父提交可供区分。② **断言层**：判 `dual` 本身不像故障，理由字符串是「变更 1880 行 > 200 行阈值（对齐 §12.6 Red Team）」，1880 行看起来完全像一个真实的大改动，没有任何读数在说「这 1880 行不是你写的」；`layer:"diff"` 也让它与正常路径同形。③ **门禁层**：这条记录由 pre-commit 自动 `git add` 进那次提交，而 `scripts/check-pr-exec-record.js` 只问「本变更集内的 `dual` 记录有没有闭环」，**不问「这条 `dual` 记录该不该存在」**——它无从判断记录里的规模读数是否属于本 PR，于是误产记录的唯一后果是变成一笔必须偿还的评审欠账，而不是一个被拦下的错误。通用形状：**判据的输入面（`--cached`）与闸门所处的时刻（merge）之间，没有任何一条断言把两者绑起来**。 |
| 系统性漏洞（QM-5 ③） | PASS | 具体到文件与环节：`scripts/ccg-review-decider.test.js`（`node --test`，由 `quality-gate.yml` Gate 2b 显式点名）只覆盖 `layer=diff` 的单父路径，**没有任何 merge-state 夹具**，也没有一条断言把「落盘文件名/hash」与「判定所依据的 diff」绑在一起；`scripts/check-pr-exec-record.js` 的 `evaluateDeepReviewDebt` 校验的是记录**存在性 + 闭环状态**，不校验记录的**测量域**。两者叠加 ⇒ 误产记录既不会被测试发现，也不会被门禁质疑。补的口子正是这两处：行为层 T1/T2（测量域）+ T8（CLI 级接线，把落盘哈希钉到交集档）。 |
| 修复 + 回归保护（QM-5 ④） | PASS | **修复**：① `detectMergeState()` 用 `git rev-parse --verify MERGE_HEAD` 返回 `{merging, mergeHead, probeError}`，读取失败 fail-open 回落旧口径；② `collectMergeStaged(state)` 以 `git merge-base HEAD MERGE_HEAD` 为 base，两侧各 `git diff --name-only --no-renames <base> <rev>` 后取**交集**——读不到 base 返回 `null`（→ 走既有「未判定」口径），交集为空直接返回零值形态且**不派生子进程**，非空才用 `:(literal)` pathspec 调既有 `collectFromDiff`；`mergeScope` 五元组（`mergeHead/base/oursFileCount/theirsFileCount/intersectionFileCount`）挂 `collected` 顶层并进 `stats`。③ `judge()` 在阈值链**之前**插入 `mergeNoIntersection` 分支（先回答「这是不是一次没有共同改动的合并」，再谈规模）。④ `main()` 合并态改走 `collectMergeStaged`，「暂存区无变更」早退**仅在非合并态**生效；`mode==='skip' && staged.mergeScope` 时**不落盘**。⑤ 尾 LF 抽出单点实现 `recordBody(record) = JSON.stringify(record, null, 2) + "\n"`，主/备两条写盘路径共用（实测 `recordBody` 定义 1 处、调用 2 处）；`saveRecord` 新增第 6 参 `opts.diffPaths`，默认值 `["--", ".", ":(exclude).ccg"]` ⇒ 非合并态**逐字节不变**。⑥ `.ccg` 自产物三面分工：观测面（`collectMergeStaged` 的三处 git 参数）**不排除**，消费面（`judge()` 的 `isSelfArtifact`）**排除**，命名面（`main()` 的 `mergeDiffPaths`）**保留排除**——git 层排除会让 `ccgChangedLines` 结构性恒 0（与主干刚修掉的暂存档缺陷同形），而命名面算进 hook 自动 stage 的 `.ccg/reviews/*.json` 会让同一次改动在「钩子跑没跑」下得到两个记录名。**回归保护 T1–T11** 追加在既有 `scripts/ccg-review-decider.test.js`（不新建文件，避免落进 `cover` 之外的收集面）：`mkGitFixture` 真造 git 仓库（`git merge --no-ff --no-commit` 保持 `MERGE_HEAD`、自声明 `core.autocrlf=false`），T1 交集为空判 `skip` 且不落盘、T2 交集非空按交集判且带五元组、T3 非合并态对照、T4 linked worktree 里探测仍成立、T5 尾 LF 两条写盘路径、T6 `saveRecord` 的 `diffPaths` 同源、T7 `:(literal)` 对 glob 元字符文件名、T8 CLI 级接线锁、T9 探测失明与「真的不在合并中」可分（i1）、T10 判定域漏进非交集文件即升 `dual`（i6）、T11 `.ccg` 观测进/消费出（三向）。 |
| 防止再次发生（QM-5 ⑤） | PASS | ① **测试进 CI**：T1–T11 在既有 `scripts/ccg-review-decider.test.js`，该文件被 `quality-gate.yml` Gate 2b 的 `node --test` 点名；`node scripts/check-unwired-tests.js` rc=0（检查域内 113 个测试文件全部已接线）。② **变异反证 14/14 全部 CAUGHT**（逐条红集见下节；M15 为预测项未实测，不计入），每条跑完都自证 `src === original: true` + `node --check` rc=0。③ **两条既有结构锁同 PR 更新**（Test 36 的 `String(git([…]))` 断言改成「先判 null 再 `String`」；Test 49 丙3.2 的接线锁尾部 `\s*\)` → `\s*[,)]`），理由是新增了同名调用的第二形态，**属必要的判据扩宽而非放宽**，论证写在 `design.md` §10。④ **设计侧留下可复查的论证**：为什么取交集而不是并集 / 为什么不按 ours 统计 / 为什么空交集不派生子进程（§3），三处 `.ccg` 路径的观测面/消费面/命名面分工（§3 末节），以及 8 条残余风险（§9；其中第 8 条「热文件累加面」的初稿读数被收尾时的真实合并实测**否证并改写**，错法本身也留在文档里）。⑤ **pre-commit 自身的现场验证**：本 PR 收尾把 `origin/main` 合进本分支时，两种口径在真实仓库上给出不同答案——这正是新口径的端到端证据（见「收尾实测」一节）。 |
| 行尾与 diff 对账 | PASS | 对账基准取**最终**的 `origin/main`（`3621894d4`；本 PR 期间主干两次前进：`2dbda6925` → `85dc44ddc` → `3621894d4`，收尾按最后一次重置）。改动集 **7 个文件**：`git diff --cached --numstat origin/main` = `339/9 scripts/ccg-review-decider.js` + `748/1 scripts/ccg-review-decider.test.js` + 5 个 `openspec/**` 新文件（`design.md 370/0`、`proposal.md 78/0`、`specs/ccg-decider-merge-skip/spec.md 85/0`、`tasks.md 182/0`、本记录 `242/0`）；`git diff --cached --ignore-cr-at-eol --numstat origin/main` **逐文件数字完全相同** ⇒ 没有整文件行尾重写。**`CHANGELOG.md` 不在改动集内**（原因见「变更类型与隔离」行；条目内容改落本记录的 `## CHANGELOG 条目` 小节，`node scripts/aggregate-changelog.js --dry-run` 打印的 `LAND ccg-decider-merge-skip` 就是它被采信的机械证据）。另有 2 个 `.ccg/reviews/*.json`（`0b6390f8…`、`231634088…`）曾出现在暂存区：它们是重建前旧 sha 的判定产物，收尾用 `node scripts/safe-delete.js` 删除，**不随 PR 入库**。行尾实测（工作副本，`\r\n` 与裸 `\n` 分别计数）：`scripts/ccg-review-decider.js` crlf=1298 / lf_only=0，`scripts/ccg-review-decider.test.js` crlf=2200 / lf_only=0，本记录 crlf=242 / lf_only=0，四个新 openspec 文件 crlf=0 / lf_only=365、78、85、182，七者 `ends_with_lf=true`。主干侧 `git ls-files --eol "openspec/records/*.md"` 655 份全是 `i/lf w/crlf`，故工作副本呈 CRLF 是 checkout 转换、不是内容 ⇒ 任何「工作副本字节 == blob 字节」的判据都会假红，只能两口径 numstat 相减。`recordBody` 的尾 LF 只作用于判定记录**产物**，不回头清理历史存量（理由见「遗留 7 的行为证据」）。 |
| 接线棘轮 | PASS | `node scripts/check-unwired-tests.js` rc=0（113 个）；`node scripts/check-step-failfast.js` rc=0（40 个受管 run 块）；`node scripts/check-no-brand-residue.js` rc=0（扫描 11184 个 tracked 文件）；`node scripts/check-doc-abs-paths.js --base=origin/main --head=HEAD` rc=0（`counts=1161 domain=562 files=561 canJudge=true`，与账本逐文件对齐，无新增本机绝对路径）；`node scripts/openspec-sync-check.js` rc=0（387 tasks / 80 active changes / 243 archives）。 |
| QM-1 打包 / QM-4 视觉 | N/A | 未触碰 `apps/desktop/electron/**`、`packages/rpa-engine/**` 或任何渲染层文件 ⇒ 打包验证与视觉回归均不适用。改动面是一个纯 Node 判据脚本 + 其测试 + 文档。 |
| QM-6 双模型评审 | PENDING_QM6 | 待填：真跑 `sh scripts/deep-review.sh` 后按该次产物填写（`mode` / `performedBy` / `reviewBackends` 实值 / `tier` 与 `evidence` 的**来源归属**）。本行不得先写 `PASS`。 |
| 远程同步 | 由门禁推导 | 本行不需要事后回写：合并后门禁按主干历史推导归属（`scripts/lib/merge-ledger.js`，只认 squash 尾注 `(#NNNN)`）。合并前这篇文件还不在基线上，分类机判 `NOT_IN_BASE` ⇒ byDesign，也不需要登记任何手动状态；反过来把状态列写成 `PASS` 会被判「预写不存在的证据」而红。 |

## 遗留 10 的现场证据（为什么合并提交会判 `dual`）

现场是 2026-10-20 一次「把 `origin/main` 合进长命分支」的提交，pre-commit 生成的判定记录（原产物已随分支清理，
副本留在本机临时目录 `%TEMP%/opencode/p54-merge-dual-record.json`，**未入库**）：

| 字段 | 读数 |
|------|------|
| `mode` | `dual` |
| `reason` | `变更 1880 行 > 200 行阈值（对齐 §12.6 Red Team）` |
| `stats.changedLines` / `fileCount` / `codeFileCount` | `1880` / `27` / `20` |
| `layer` | `diff` |
| `sha` | `f6490b814f0b603d20e1bf8ad7fe0b9f82ebb747`（= 提交前的 `HEAD`，即 ours tip） |
| `stagedDiffHash` | `77f262d61da71308…` |
| `deepReview` | `{"required":true,"status":"pending","tier":"unknown","performedBy":null,…}` |
| `reviewBackends` | `{"proposer":"opencode","critic":"claude","from":{"proposer":"list","critic":"list"},"overridden":false}` |
| 顶层 `status` | **不存在**（状态在 `deepReview.status`） |

三条读法：

1. **`sha` 是 ours tip，而规模读数来自 theirs**。合并提交尚未存在，所以 `sha` 只能是 ours tip；但
   `git diff --cached` 在合并态下比的是「index（= 合并结果）对 `HEAD`（= ours tip）」，即对方那一侧。
   两者被写进同一条记录，读的人只会理解为「ours tip 这个提交改了 1880 行」。
2. **它不可自证**：那条提交的**真实**手写量是合并解冲突的那几行，而记录里没有任何字段能区分
   「我写的」与「对方带进来的」。这正是本次修复要加的第五个读数（`stats.mergeScope`）。
3. **它不报错、不阻断**，只会在下一次 PR 上变成一笔必须偿还的 `dual` 评审欠账——即
   「误产记录」的成本被转移到别人头上，而根源那次提交看起来完全正常。

## 遗留 7 的行为证据（1313/1565 份判定记录没有尾换行）

本轮实测（`git ls-files .ccg/reviews` + 逐文件读末字节）：判定记录共 **1565** 份，其中 **1313** 份
**没有**末尾换行。这个数只作量级参考，不是不变量（记录会随每次提交增长）；它的用途是说明
「缺尾 LF」不是个别产物，而是写盘实现的稳定行为——因为写盘处就是 `JSON.stringify(record, null, 2)`
这一个表达式，任何一次提交都会复现。

修复口径与边界：

- **只修新增产物**，不回改存量 1313 份。理由是回改要动 1313 个 tracked 文件，产出一次没有语义价值的
  巨型 diff，并且会与当时所有打开中的 PR 争抢 `.ccg/` 这个热写面（本仓已有多次「热写面整文件冲突」事故）。
  存量作为**已知欠账**留在原处，不做「顺手统一」。
- **单点实现**：`recordBody(record)` 一个定义、两个调用点（主路径与内容寻址的 alt 路径），T5 分别断言
  两条路径的末字节都是 `\n`，因此「只修了一条写盘路径」会被单独抓住。
- **可复算**：`String(fs.readFileSync(file, "utf8"))` 的末字符可直接断言，不需要重新格式化整个文件。

## 变异反证（14/14 全部 CAUGHT；M15 为预测项，未实测）

评估域与批次（同一 pattern 内跑完的才做算术自洽，跨批不混算）：

| 批次 | pattern | baseline | 含 |
|------|---------|----------|-----|
| 第一批 | `--test-name-pattern=遗留` | `rc=0 / pass=8 / fail=0` | M1–M11（T1–T8 命中该 pattern） |
| 第二批 | 同上 | `rc=0 / pass=10 / fail=0` | M12/M13（T9/T10 落地后补跑） |
| 第三批 | `--test-name-pattern=T11` | `rc=0 / pass=1 / fail=0` | M14（T11 落地后补跑） |

前两批的算术自洽：域内 8 条 ⇒ 任一变异跑完 `pass + fail = 8`；域内 10 条 ⇒ `pass + fail = 10`。
第三批评估域只有 T11 一条，故不参与那种算术。逐条单跑，红集如下（台账以 `tasks.md` §3 为准）：

| 变异 | 内容 | 实测红集 |
|------|------|----------|
| M1 | `detectMergeState` 恒返回 `{merging:false}` | T1/T2/T4/T7/T8（`fail=5`） |
| M2 | 交集改成两侧并集 | T1/T2/T4/T7/T8（`fail=5`） |
| M3 | 删掉 `judge` 的 merge 分支 | T1（`fail=1`） |
| M4 | 删掉 `skip` + `mergeScope` 的落盘豁免 | T1（`fail=1`） |
| M5 | 摘掉主路径尾 LF | T5（`fail=1`） |
| M6 | 摘掉 alt 路径尾 LF | T5（`fail=1`） |
| M7 | `:(literal)${f}` 换成裸路径 | T7（`fail=1`） |
| M8 | `diffPaths` 忽略入参（恒用默认域） | T6/T8（`fail=2`） |
| M9 | 摘掉 `main` 的第 6 参接线 | **仅 T8**（`fail=1`） |
| M10 | 把 `mergeScope` 从 `stats` 摘掉 | **仅 T8**（`fail=1`） |
| M11 | 交集为空时仍派生子进程 | T1/T4（`fail=2`） |
| M12 | `detectMergeState` 把「探测失明」也当成「不在合并中」（i1） | **仅 T9**（`fail=1`） |
| M13 | 删掉 `judge` 的 `mergeScopeLeak` 升档（i6） | **仅 T10**（`fail=1`） |
| M14 | 把 `:(exclude).ccg` 加回 `sideFiles()`（观测面收窄） | **仅 T11**（`fail=1`），首个失败断言是 `collected.files` 的 `deepStrictEqual` |
| M15 | **预测项，未实测**：只把 `:(exclude).ccg` 加回 `pathspecs`（交集仍含 `.ccg`，只收窄 numstat/diff） | 预期仅 T11 红，落点应在 `changedLines` / `ccgChangedLines` |

M12/M13/M14 的红集互不相交（分别只打 T9 / T10 / T11），因为它们守的是三台不同的机器：
「探测失明的可见性」「判定域上界」「`.ccg` 的观测面/消费面分层」。M15 只把推断写成预期，
不写成实测——它与 M14 落在同一函数的两处 pathspec，红集形态可推，但没有跑过就不算证据。

第一批里五处与写码前预测不符的地方**一律以实测为准**，并已回写 `design.md` §8：M1 少 T6（T6 直接调
`saveRecord`，不经 `detectMergeState`）、M1/M2 多 T7/T8（退回整侧或改并集会让「交集」形态整体消失）、
M8 多 T8（接线锁比对的哈希也一起吃域外文件）、M10 少 T2（T2 断 `collected.mergeScope`，M10 摘的是
`stats.mergeScope`，两个载体）、M11 多 T4（零值形态是 T4 的判据之一）。

两条最值得记的读数：

- **M9 只打红 T8**：把 `main()` 里的 `{ diffPaths: mergeDiffPaths }` 整个摘掉后，T1/T2/T4/T6 全绿。
  这条证明「只有行为锁、没有 CLI 级接线锁」时，遗留 10 会以**同样的形状**换一个落点回来——
  `collectMergeStaged` 算得再对，只要没接到落盘参数上，记录名仍然回到对方整侧的哈希。
- **M3 与 M4 红集相同（都是 T1）**，这是正常的：T1 一条用例同时依赖「判 `skip`」与「`skip` 时不落盘」，
  两个变异各自都能让它失败。所以这两条**不能**用红集区分，只能靠变异本身的作用点区分（`judge` vs 写盘豁免）。

## 本机读数（命令 → 结果，供下一位复核）

| 命令 | 结果 |
|------|------|
| `node --test scripts/ccg-review-decider.test.js`（全量，合并后） | `# tests 70 / pass 70 / fail 0` |
| TDD 红灯留证（实现前） | `RC=1`、`# tests 59 / pass 52 / fail 7`（T1–T7 红，T8 后补；T9–T11 是评审派生项，各自先红后绿） |
| `node scripts/openspec-sync-check.js` | rc=0（387 tasks / 80 active / 243 archives） |
| `node scripts/check-unwired-tests.js` | rc=0（113 个测试文件） |
| `node scripts/check-step-failfast.js` | rc=0（40 个 run 块） |
| `node scripts/check-no-brand-residue.js` | rc=0（11184 个 tracked 文件） |
| `node scripts/check-doc-abs-paths.js --base=origin/main --head=HEAD` | rc=0（`counts=1161 domain=562 files=561`） |
| `node scripts/verify-worktree-deps.js` | rc=0 |

## 沿用遗留清单（本轮**不**处理，逐条说明为什么）

| 编号 | 内容 | 本轮为何不处理 |
|------|------|----------------|
| 6 | `STALE_REQUIRED` 的处方文案 | 文案改动会改变门禁红文案的形态，属「改谁来守门」的可见面，须人工过目后单独 PR。 |
| 8 | `CHANGELOG.md` 长度无门禁 | 新增长度门禁会立刻对所有打开中的 PR 产生约束，属改「谁来守门」，须人工过目。 |
| 9 | `CreateView.test.js` 单文件 A/B | 与本 change 的判定器无关，混进来会让本 PR 的验证面从「一个判据脚本」扩到「渲染层测试」，得不偿失。 |
| — | 存量 1313 份判定记录缺尾 LF | 见「遗留 7 的行为证据」：回改要动 1313 个 tracked 文件并争抢 `.ccg/` 热写面。 |

## 收尾实测（新口径的端到端证据，真实仓库、非夹具）

本节初稿写的是预测，**实测把预测否证了**，按实测改写并保留错法供后来者对照。

写记录时 `origin/main` 已从 `2dbda6925` 前进到 `85dc44ddc`（含 `CHANGELOG.md`、`01-docs/learnings.md`、
设计文档、224 份 `.ccg/reviews/*.json`、若干 openspec 记录；其中 `scripts/ccg-review-decider.js`
与 `.test.js` **也被主干改过**——这是初稿没预料到的）。把主干合进本分支时的实测读数
（命令输出留证 `%TEMP%/opencode/p61-mergeprobe.txt`）：

| 读数 | 值 |
|------|-----|
| base（`git merge-base HEAD MERGE_HEAD`） | `2dbda6925` |
| `MERGE_HEAD` | `85dc44ddc` |
| ours 侧文件数 / theirs 侧文件数 / **交集文件数** | `10` / `628` / **`3`** |
| 交集文件 | `CHANGELOG.md`、`scripts/ccg-review-decider.js`、`scripts/ccg-review-decider.test.js` |
| 交集上的 `git diff --cached --numstat` | `204/0`、`53/6`、`275/0` ⇒ **`changedLines=538`** |
| 同三文件在 theirs 侧的 numstat | `204/0`、`53/6`、`201/0` |

两条结论：

1. **新口径下这次合并判 `dual` 并落盘**（538 行 > 200 行阈值），而**旧口径会判 `skip`**——
   因为旧口径读的是对方整侧（628 文件），交集概念在旧实现里根本不存在。
   这就是遗留 10 的正向前后对照，也是一次真实的 A/B：同一份工作区、同一条命令，两种口径给不同答案。
2. **初稿错在哪**：初稿断言「两侧交集应当是 `{CHANGELOG.md}` ⇒ 应判 `skip`」，理由是主干没碰代码。
   实测主干**确实碰了**本 change 正在改的那两个文件（`scripts/ccg-review-decider.js` / `.test.js`
   是并发热点），于是交集是 3 个而不是 1 个，判档也随之从 `skip` 变 `dual`。
   错法是**拿预测当实测**：只设想了热文件（`CHANGELOG.md`）会两侧都改，忘了同一个判定器家族本身
   也在被别的会话改。这条已回写 `design.md` §9 第 8 条，并把错法原文留在那里。

**上表读数的一个适用范围**（不要让后来的人以为它矛盾）：那次实测时本分支还带着一条 `CHANGELOG.md` 条目，
所以交集是 3 个。收尾时该条目改落本文的 `## CHANGELOG 条目` 小节（理由见「变更类型与隔离」行末），
本分支与主干的交集随之变成 2 个文件（`scripts/ccg-review-decider.js` `53/6`、本文件 `275/0`），
按上面实测的逐文件 numstat **推算** `changedLines=334`（仍 > 200 ⇒ 仍判 `dual`，结论与上面第 1 条一致；
这个 334 是从实测分量算术得到的**推算值，没有重跑**，故不写成读数）。

另有一条**副作用要在收尾动作里处理**：既然这次 `git merge` 会产生一条 `dual` 判定记录，
而合并提交的 `stagedDiffHash` 是按「`HEAD^` → `HEAD`」的 diff 内容寻址的（合并提交的这份 diff
是对方那一侧的完整改动，无法代表本次工作），那条记录在结构上**无法自然收口**。
因此本 PR **不采用合并提交**：改为在 `origin/main` 上重建**单条线性提交**（内容不变），
让 pre-commit 在非合并态产出唯一一条 `dual` 记录，并让它对应真正的改动集。
这也说明遗留 10 的修复价值不在于「让合并提交少判一次 `dual`」，而在于**合并态不再被静默判成 `skip`**。


## CHANGELOG 条目

# fix(gates): 合并提交按「两侧交集」判档、零语义合并判 skip 且不落盘，判定记录补尾换行（ccg-decider-merge-skip）

- **现场（遗留 10，不是理论风险）**：`scripts/ccg-review-decider.js` 在**合并提交**上读的是 `git diff --cached`，
  而 merge 提交的暂存面语义是「ours tip → 合并结果」，也就是**对方那一侧**的全部改动。实测一份 merge 提交的
  pre-commit 产物：`mode=dual` / `deepReview.status=pending` / `stats.changedLines=1880` / `fileCount=27` /
  `codeFileCount=20`，而这批改动里**没有一行**是本分支写的。后果不是「多跑一次审查」，而是把「需不需要 CCG 审查」
  机械地推向 `dual`，并让一份待审记录永久挂在那里（`check-pr-exec-record.js` 的欠账面按 `mode=dual` 取）。
- **修法（判定范围收敛）**：`detectMergeState()` 用 `git rev-parse --verify MERGE_HEAD` 探测合并态——
  不硬编码 `.git/MERGE_HEAD`，因为 linked worktree 的 `.git` 是**文件**、那条路径在那里恒不存在，
  硬编码会让修法在 worktree 里静默失效（而本仓所有运行时代码任务都在 worktree 里做）。
  `collectMergeStaged()` 以 `merge-base HEAD MERGE_HEAD` 为 base，两侧各取
  `git diff --name-only --no-renames <base> <rev>` 后取**交集**，再以交集为 pathspec 走既有 `collectFromDiff`
  ⇒ 判定范围回到「双方都动过的文件」。
- **为什么是「交集」而不是并集 / 单侧 / 只取冲突文件**：并集把对方整侧导入又搬回来（原缺陷本身）；单侧会漏掉
  「我方和对方都改了同一文件」里对方那一份；冲突文件列表在**无冲突合并**上恒为空，而后者是最常见的形态。
  副作用是**保守放大**（交集内按 `HEAD` 统计），已在 `design.md` §9 作为残余风险登记，不假装精确。
- **零语义合并**：交集为空 ⇒ `judge()` 在阈值链**之前**显式判 `skip`，理由写「交集为空」而不是「≤10 行」——
  后者会让「普通小改动」与「合并没带来双方共同改动」两个事实共用同一句话。`main()` 在 `mode==='skip' && mergeScope`
  时**不落盘**（`skip` 本来就不是待审记录）。
- **pathspec 必须用 `:(literal)` magic**：交集里的文件名可能含 glob 元字符（`[`/`]` 在 Windows 文件名里合法且仍是
  pathspec 元字符），裸路径会被当成模式**放大**判定范围。
- **内容寻址键与判定范围同源**：`saveRecord` 新增第 6 参 `opts.diffPaths`，默认值与历史配方逐字节相等 ⇒
  非合并态路径**零行为变化**；合并态让「判定范围」与 `stagedDiffHash` 用同一组 pathspec，否则记录名按全域算、
  内容按交集算，读的人无从比对。
- **遗留 7（尾换行）**：两处写盘抽成单点 `recordBody()` = `JSON.stringify(record, null, 2) + "\n"`；
  不回溯清理历史存量（存量缺尾换行的量级见本文「遗留 7 的行为证据」）。
- **评审派生项**：i1 把「探测失明」与「不在合并中」分开（`probeError` 出声告警，仍 fail-open）；
  i6 在判定域漏进非交集文件时**升 `dual`（fail-closed）**并告警，不抛错（交集内两侧相同改动的文件不进 numstat，
  故取上界判据，`files.length` 合法地更小）。
- **测试与反证**：既有 59 例 + T1–T11 = **70/70 全绿**（真 git 仓库夹具，`git merge --no-ff --no-commit` 保持
  `MERGE_HEAD`；含 linked worktree 档与 CLI 级接线锁）；变异 M1–M14 **全部 CAUGHT**，且 M12/M13/M14 红集互不相交
  （M15 为预测项，未实测，不计入）。
- **遗留（明确不在本 PR 范围）**：6 `STALE_REQUIRED` 处方文案、8 CHANGELOG 长度无门禁、9 `CreateView.test.js`
  单文件 A/B。其中 6 与 8 属「改谁来守门」，须人工过目，不走 agent 自动合并。

## learnings

### lesson: 判据的输入面与闸门所处的时刻之间，必须有一条断言把两者绑起来

**现场**：判定器在合并提交上把 `git diff --cached`（= 对方那一侧）当成「本分支的改动」判档，
一份 merge 提交的 pre-commit 产物报 `changedLines=1880 / fileCount=27`，而本分支手写量是解冲突那几行。
该缺陷自 `d98f54dbc`（2026-10-05）存续 16 天，产出的 `dual` 记录被当成真事由反复偿还。

**根因**：判据本身没错，错的是**输入面在某一时刻被换掉了**。既有 52 条用例的夹具全是
「单父 + 工作区改文件 + `git add`」，**没有第二种父提交可供区分**，于是「输入其实是对方一侧」在测试里
结构性地不可表示；`layer:"diff"` 又让合并路径与正常路径同形。

**可复用的 3 条**：

1. 给「读暂存区 / 工作区 / 磁盘状态」的判据加一条时刻断言：**它在哪些状态下会被调用**（commit / merge commit /
   rebase / cherry-pick / revert），每个状态各有几个父、`--cached` 相对谁比对。合并态里 `MERGE_HEAD` 存在而
   `HEAD` 仍指向 ours，这是唯一能区分两者的机器事实，靠 `layer` 或 `sha` 都看不出来。
2. 夹具必须能**表达**缺陷：为某个输入维写测试之前先问「这个维在我的夹具里有第二种取值吗」。没有就造
   （本项目：`git merge --no-ff --no-commit` 真造合并态）。用对象拼一个带字段的假输入只能证明消费端，
   证明不了生产端。
3. 记录/产物的**规模读数必须与它的名字同源**：凡是会给别人留下欠账的产物（这里是 `dual` 记录），
   判据输入与产物命名要走同一组 pathspec（本项目共用 `opts.diffPaths`），否则名字按全域算、内容按交集算，
   复核的人第一步就会怀疑数据。
