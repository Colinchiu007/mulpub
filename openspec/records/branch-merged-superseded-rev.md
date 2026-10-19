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

- `node --check scripts/check-branch-merged.js` / `--test scripts/check-branch-merged.test.js`：**41 tests / 41 pass / 0 fail**。
  先红后绿：首跑 5 条新增用例红（T32 红在 `classifyRevision` 未导出，T28–T31 红在 `revisionsAtMerge` 字段不存在），实现后逐条转绿。
  T31 中途红过一次，红因是**我的测试自己**直接 `JSON.parse` 整个 `--json` stdout，而该出口末尾按既有形状还跟着汇总行（T25 已钉）⇒ 改按 `}\n[BRANCH-MERGED]` 切；**没有**为了"解析方便"去改出口。
- 变异反证 **8/8 CAUGHT**，红集互不相同（驱动 `mutants-superseded.cjs`，仓库外；基线先证绿 41/41，还原后按 md5 逐字节核对 = `cb88a3489700f0d6c2454c54162b0304`）：
  M1 摘掉 `not-carried` 分支 ⇒ 只红 T29,T32（反洗白那条锁真有牙）；M2 plain 不打印 ⇒ T31；M3 从 LOST 出口摘字段 ⇒ T28,T29,T31；M4 `classifyRevision` 恒返 `revised` ⇒ T29,T30,T32；M5 末行不给条数 ⇒ T31；M6 差异规模只算单边 ⇒ T28；M7 `carried` 不计数 ⇒ T30；M8 从导出面摘掉 `classifyRevision` ⇒ T32。
  **两条驱动自己的坑如实记**：首跑 M1 锚点写成跨行串，而工作副本是 CRLF ⇒ 命中 0 次、变异从未生效（`ANCHOR_0`，不得读成"变异没红"）；M5 的替换把 `+` 留在括号前 ⇒ 套件语法加载失败、报出 `fail=1 pass=0 红集=无`，那是**探针自身故障**伪装成结论。两处已改为单行锚点 + 语法可解析的替换，并给驱动加 `PROBE_BLIND` 档（红集为空而 fail≠0 一律单独成档）。
- Gate 12c 现场：`node scripts/check-doc-abs-paths.js --all` ⇒ `counts=1163 domain=4312 files=563 canJudge=true PASS`（无新增本机绝对路径；PRD 里那条安装路径示例按占位符表述，不重述原文）。
- 真实仓现场（用**还原后的实现**复跑 #3733 探针 tip `04e5895964`）：
  `lost=12 rc=1` **一字未动**，新增 `修订落地=13 没带上=1`；`font-resolver.js` 现场打 `落地版本=修订@110c3aabb(主干独有95行/我这版独有8行)`，
  而 `.ccg/reviews/4e34763ec…json` 走的是另一格 `根本没带上@110c3aabb` —— 三分确实把"旧版没被采纳"与"真没落"分开，且后者没有被前者洗掉。
  注：这里的 95/8 与 §10 里 `git diff --numstat` 报的 +99/−8 口径不同（前者按行多重集去重计数，后者按补丁行计数），两者都如实保留，不得互相"校正"。

## QM-6（如实登记）

<!-- 通道读数与逐条处置在评审回件落地后填；未跑成写"未跑成" -->
