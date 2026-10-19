---
record: branch-merged-superseded-rev
task: 给「分支内容已进主干」判据补一格读数——区分"落地的是另一版修订"与"根本没带上这份改动"，只解释为什么报缺、不改判据宽严
date: 2026-10-19
---

## 本次执行记录：落地版本读数（branch-merged-superseded-rev，2026-10-19）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ | 混合 PR（`scripts/` 门禁脚本自身 + 文档）：`classify-docs-only --base=origin/main --head=HEAD` = **false** ⇒ 走完整质量节拍（提交后再取一次作数）。worktree `mp-branch-merged-superseded-rev` + 裸分支同名，由 `start-mp-task.ps1` 创建；判成败按产物（`git worktree list` 命中 1 行 + `rev-parse --abbrev-ref HEAD` = 分支名），不按 rc |
| 第一性原因（QM-5 ①） | ✅ | 引入点 = `fd6e9cc4a`（#3875，落地判据 v3）。v3 只问两句：「我这行在不在主干现状里」＋「缺口能否被他人净删除容量解释」，**没有任何一句问"合并落地的那一份是不是我这版"**。于是"分支切在评审修正之前、落地的是修正之后那一版"这一常见形态只能报 LOST，而判据说不出它是"旧版没被采纳"还是"工作丢了"。|
| 逃逸分析（QM-5 ②） | ✅ | 逃过了：① `check-branch-merged.test.js` 的 36 条既有夹具——`land()` 的 `override` 一直被用来构造"漏落/改落"，但从没构造过「产物既 ≠ base 也 ≠ tip」这一格，所以该形态对夹具**结构性不可表示**；② #3875 的真实仓 A/B（5 次新鲜合并 + 7 条分支）里全是 re-sync 型与重复行型，无修订型样本；③ 结构锁只验"判据是否调用 `assertChainCloses`"，不验它能否解释成因。**为什么"看得见"却没拦住**：#3875 的 §9 遗留写下了"份数偏宽松"这一格，却漏了这格——读到了 ≠ 有人在守（同族：装饰性门禁）。|
| 系统性漏洞（QM-5 ③） | ✅ | 具体落点：`scripts/check-branch-merged.js` 的 `classifyFile` 只用 `tipBlob` 与 `againstBlob` 两个坐标，`excludeShas`（本次合并）仅喂给 `mergedCopiesOf` 做份数，**从不参与"落地那份是不是我这版"的判断**；测试侧 `scripts/check-branch-merged.test.js::land()` 虽有 `override` 参数，但既有 26 处调用里没有一处让它落在 base 与 tip 之外。分类：测试场景缺失 + 断言不精确（能报"缺"，不能报"为什么缺"）。|
| 修复 + 回归保护（QM-5 ④） | ✅ | 新增 `classifyRevision(mergeBlob, tipBlob, baseBlob)` **三分**（`carried` / `not-carried` / `revised`）、`lineDiffScale`（按行多重集的双向规模，与判定本体同口径）、`revisionsAtMerge`；plain 在判定行尾打 ` 落地版本=`、末行打 ` 修订落地=<n> 没带上=<n>`；`--json` 的文件对象带 `revisionsAtMerge`。**退出码一字未改**：`lost>0` 仍返回 1。回归锁 5 条：T28 正控（revised + 双向规模 + rc 仍 1）、**T29 反洗白**（产物 == base 必须单独成 `not-carried` 且 `revised` 必须为 0——只比 tip/merge 两格会把"根本没带上"读成"被修订"，那是替真丢失作保的方向）、T30 对偶（正常落地三格皆空且 `carried=1`，防读数凭空出现）、T31 接线（plain 逐行 + 末行汇总 + `--json` 三个出口都要有，`--json` 按既有 `}\n[BRANCH-MERGED]` 口径切而不改出口形状）、T32 三分表逐格（含"我删文件"与"新增文件"两族边界）。|
| 防止再次发生（QM-5 ⑤） | ✅ | ① PRD `01-docs/PRD-BRANCH-MERGED-CHECKER-2026-10-16.md` 新增 §10，把这次的**错误归因及其被 A/B 否证的来路**一起入库（历史快照不改写，追加最新锚点声明现状）；② 三分表与"为什么不能两分"写进判据文件头注释，下一个改它的人不必重新发现；③ `mutants-superseded.cjs` 入库登记在本文，8 条变异红集互不相同，可机器重跑。|
| 行尾与 diff 对账 | ✅ | PRD 工作副本是 CRLF（`git ls-files --eol` = `i/lf w/crlf attr/text=auto`，三份来源分开量：`HEAD blob=0 CR / index blob=0 CR / 工作副本=282 CR`），追加按 CRLF 写；追加后 cr=lf=282 自洽，`git diff --numstat` 与 `--ignore-cr-at-eol --numstat` 两口径均为 `+34 / -0` 相等。**订正**：本文初稿曾把 `git show HEAD:` 的一次读数报成 248 CR，那是探针口径错乱，按上面三源分开读的数为准 |
| 接线棘轮 | ✅ | 未新增测试**文件**（用例并进已接线的 `scripts/check-branch-merged.test.js`，该文件在 `quality-gate.yml:403` 已点名），故 `check-unwired-tests.js` 域不变；提交后按 `git ls-files` 口径复跑一次作数 |
| QM-1 打包 / QM-4 视觉 | N/A | 未触 `apps/desktop/electron/`、`packages/rpa-engine/` 与任何渲染面；改动是根级门禁脚本与文档 |
| QM-6 CCG 双模型外部评审 | PENDING | 见下节（逐次通道读数登记；未跑成一律如实写"未跑成"，不拿自审替代） |
| 远程同步 | 由门禁推导 | 本 PR 不手写状态词、不为收口另开 PR（`gate-record-sync-derived-status` / #3879）；合并发生即由 `scripts/lib/merge-ledger.js` 推导收口 |
## 自测块（当场读数，不预写）

- `node --check` 双文件通过；`node --test scripts/check-branch-merged.test.js` ⇒ **42 tests / 42 pass / 0 fail**。
  先红后绿：首跑红 5 条（T32 红在 `classifyRevision` 未导出，T28–T31 红在 `revisionsAtMerge` 字段不存在），实现后逐条转绿；
  T31 中途又红一次，红因是**我的测试自己**直接 `JSON.parse` 整个 `--json` stdout，而该出口末尾按既有形状仍跟着汇总行（T25 已钉）⇒ 改按 `}\n[BRANCH-MERGED]` 切，**没有**为了"解析方便"去改出口形状。
- 变异反证 **10 条、逐条实跑、红集互不相同，10/10 CAUGHT**（驱动 `mutants-superseded.cjs`，仓库外；基线先证绿；每轮收尾以 md5 断言实现与备份逐字节相同，两轮均 `final_md5_match=true`）：
  M1 摘 `not-carried` 一格 ⇒ T29,T32｜M2 plain 不打印 ⇒ T31,T33｜M3 从 LOST 出口摘字段 ⇒ T28,T29,T31｜M4 恒返"版本不同" ⇒ T29,T30,T32,T33｜M5 汇总不给条数 ⇒ T31｜M6 差异规模只算单边 ⇒ T28｜M7 `carried` 不计数 ⇒ T30,T33｜M8 摘导出 ⇒ T32｜**M9 把中性名退回宣称方向的「修订@」⇒ T33**｜**M10 分类名退回 `revised` ⇒ T32**。
  首轮跑出 3 条 MISMATCH，全部是"多红了 T33"——**我的期望清单写在 T33 之前**，逐条核对后确认 T33 对那三个形态本就应当有牙（M2 摘打印 ⇒ T33 查不到中性标签；M4/M7 动 `carried` ⇒ T33 断言 `carried===1`）。改正期望后重跑 M2/M4/M7 三条均 CAUGHT。**不是**拿期望凑红：改的是期望清单，锁的断言一字未动。
  另两条驱动自身的坑如实记：首版 M1 用跨行锚点而工作副本是 CRLF ⇒ 命中 0 次、变异从未生效（`ANCHOR_0`，不得读成"没红"）；首版 M5 的替换把 `+` 留在括号前 ⇒ 套件语法加载失败报 `fail=1 pass=0 红集=无`，那是**探针自身故障伪装成结论** ⇒ 驱动补 `PROBE_BLIND` 档（红集为空而 fail≠0 单独成档）。
- 改名一轮中被批量替换误伤的两处，均由**跑套件**当场抓住并回改：`T33` 的"旧名不得出现"被连带改成 `rev.different` 自相矛盾（改为 `!('revised' in rev)`）；`T31` 的 `revisionsAtMerge.revised` 不在 `rev.revised` 规则覆盖内（补齐）。第二次用单引号套单引号的 `node -e` 改期望，JS 引号被 shell 吃掉、报"命中 0"——那是探针坏，不是锚点坏，遂改用编辑工具。
- 真实仓现场（用最终实现复跑 #3733 探针 tip `04e5895964`）：`files=21 identical=7 drift=2 lost=12 unattributed=0 judge_error=0 **落地版本不同=13 没带上=1**`，
  `lost=12 / rc=1` 与加读数前逐字相同；两格各一例：`font-resolver.js LOST … 落地版本=版本不同@110c3aabb(主干独有95行/我这版独有8行)`、
  `.ccg/reviews/4e34763ec….json LOST(整份文件不在主干) … 落地版本=根本没带上@110c3aabb`。**后者没被前者洗掉**是本片的全部要点。
  口径注：95/8 与 PRD §10 里 `git diff --numstat` 的 +99/−8 是两个口径（行多重集去重 vs 补丁行计数），两份都保留，不互相"校正"。
- Gate 12c：`node scripts/check-doc-abs-paths.js --all` ⇒ `counts=1163 domain=4312 files=563 canJudge=true PASS`。
- 行尾：PRD 按 CRLF 追加/改写（`cr=lf=284` 自洽），`git diff --numstat` 与 `--ignore-cr-at-eol --numstat` 两口径相等（`+9 / -7`）。

## QM-6（如实登记，逐次通道读数）

| 轴 | 通道 | 派发（UTC） | 现场读数 | 结论 |
|---|---|---|---|---|
| 后端 | **规定** `[routing.backend].primary=codex` | 02:21 起 | rc=0、4.2 min、stdout **62 B**（只有 SESSION_ID 分隔行）、stderr 5× `failed to parse function arguments: missing field 'cmd'`、无产物 | 零结论（既有死法第 5 种复发） |
| 后端 | 同上，二投 | 02:24 起 | rc=0、**15.2 min**、stdout **1042 B**、首行回显 `6afa09354724d0a81d409f2214304e62badcb271 files=4`（审的就是这个 head） | **出货**，但只交付 1.5 条：B1 完整，B2 在 1042 B 处被截断（stderr 仍 17× `missing field cmd`） |
| 前端 | **规定** `[routing.frontend].primary=claude` | 02:21 起 | rc=1、3.4 min、stdout **0 B**、stderr `claude completed without agent_message output` | 零结论 |
| 前端 | 同上，二投（任务书压到 1.4 KB） | 02:33 起 | `TIMEOUT_KILLED=true`、跑满 12 min、stdout **0 B** | 零结论 ⇒ **「claude 吃小任务书就能成」这条本机既有结论被否证** |
| 前端 | 同上，三投（极小任务书 + 明令不许执行命令） | 02:47 起 | rc=0、1.6 min、stdout **213 B**：内容为 "I need to see the main function around line 628-750" 一类**中间态**加一个 `Skip`，无任何 finding | 零结论 ⇒ 三投全败，按 AGENTS「3 次全败才跳过」**跳过并如实登记**，不用自审替代 |

**跨家族独立性因此打折**：双模型只剩单轴出货，且该轴只交付 1.5 条。这不等于一轮完整 QM-6。

**另记一条机制缺口（未在本片动）**：本次 pre-commit 打印 `[CCG] 未找到 CCG（run_skill.js），已跳过 CCG 门禁` ⇒ 没有 `.ccg/reviews/<sha>.json` 审计产物，`evaluateDeepReviewDebt` 因此**没有东西可查**、对这条 PR 无从判红。"要不要走 CCG"在这台机器上目前不由机械闸门兜住（AGENTS「QM-6 与既有门禁的关系」链条的第 2 环在此断裂）。修它属"改谁来守门"。

## 逐条处置

| 编号 | 评审主张（摘要） | 我的复量 | 处置 |
|---|---|---|---|
| B1 | `base` 是 `merge-base(ref, against)` 的**当前**起点，不是每笔 PR 各自的基线；多 PR / re-sync 形态下早前合法落地的 merge 也会被标成 `revised`，而注释/PRD 把它解释成"旧版没被采纳" ⇒ 读数误导。给三条修法：逐笔取 merge-base / 文案降级为"相对当前 base/tip 的另一版" / 只在 LOST 上附读数 | **本地复现成立**：`repro-b1.cjs` 造 `C0(A) → tip1(B) → merge1(B) → tip2(D) → merge2(D) → main(E)`，`collect(ref=tip2, merges=[merge1,merge2])` ⇒ `carried:1, different:[merge1]`（merge1 当年确实合法落地） | **采纳，取"文案中性化"那一支**：分类名 `revised → different`、出口 `修订@ → 版本不同@`、汇总 `修订落地= → 落地版本不同=`，注释/PRD 同步改为"只说版本不同、不说方向，定性须自己比 blob"，并加回归锁 **T33**（断言读数对象里不得有 `revised` 键、打印里不得出现"修订/旧版"）+ 变异 **M9/M10** 专打这一格退化。**不取**"只在 LOST 上附读数"——`not-carried` 对每笔合并单独看仍成立，缩到 LOST 会把 DRIFT 文件上同样有用的信息丢掉。**不取**"逐笔 merge-base"——squash 历史里"那笔合并当时的 tip"没有可靠锚点，硬造等于引入新的猜测 |
| B2 | 被截断，只剩 `"file": "scripts/check-branch-merged.test.js"` 一个字段名，claim/evidence/fix 均不存在 | 无法复量 | **不替它编内容**，也不因"它存在过"而自创修法；本片对测试文件的改动来自 B1 的处置与自审 |
| 前端轴 | 三投零结论 | — | 无条目可处置；本 PR 的外部支撑因此只有"单轴后端 1.5 条 + 本地证据"，如实记在此 |
