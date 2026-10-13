---
record: budget-probe-form-split
task: Gate 预算探针按"形态"分档——混池让 RULE_VIOLATED 拿旧形态的时长给新形态定墙
date: 2026-10-12
sync_status: PENDING
sync_reason: 本 PR 尚未合并，merge SHA 还不存在；合并后由回填 PR 改写 PASS + merge SHA 并整段删除本三个 sync_ 字段
sync_backfill_owner: 下一个会话（收尾链：合并 → 回填 → 销账；并等当前形态样本 ≥20 后再判 45/55 这档）
---

## 本次执行记录：Gate 预算探针按形态分档（budget-probe-form-split，2026-10-12）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | PASS | 🔧 配置/工具 + 🧪 测试变更，且**改的是判据本身**（`scripts/gate-budget.js` 的 `checkSizing` 与复测入口）⇒ 混合 PR、必须隔离：`scripts/start-mp-task.ps1 -TaskName budget-probe-form-split`，worktree `D:/Data/projects/mp-worktrees/mp-budget-probe-form-split`、裸分支 `budget-probe-form-split`，基线 `c6b4709cd` = 当时 `origin/main` tip。依赖就绪三步实跑：`pnpm install --frozen-lockfile` 15.7s、`ensure-electron.js` v43.7.7 就绪、`verify-worktree-deps.js` OK（11 项消费方解析通过） |
| 第一性原因（QM-5 ①） | PASS | 不是"预算定错了"，是**采样坐标错了**：`scripts/gate-budget-probe.js` 把窗口内所有 `Desktop tests shard` 样本混成一池算 max。而 `#3357` 合并（2026-10-12T16:30Z）之后重跑探针时，那个窗口横跨三代形态（预算 30→45 由 #3313 抬；分片"两腿各跑全量"→真半量由 #3357 修），于是 `max=31.55` 是**"全量 + 45 分预算"那一代**的观测，`RULE_VIOLATED：45 < 31.55×1.5=47.33` 就报了出去 —— 拿半量代码的墙去要求全量代码的时长，方向正好相反。原始误报现场：`openspec/records/desktop-shard-flag.md` 的「远程同步」行（已如实记录当时结论） |
| 逃逸链（QM-5 ②） | PASS | ①判据层——`checkSizing` 的入参只有一个"全局 max"，形态不在字段里，所以它**无法表达**"这批数不是同一种代码跑出来的"；②探针层——只打印聚合值，不打印每个样本属于哪个提交；③历史层——#3313 已经踩过一次"污染观测"（Gate 4 混进桌面全量），但当时靠人工归因改写文档收口，**没把"形态"变成数据结构**，于是同一族问题第二次复发；④样本量层——旧规则只对 Gate 4 侧设 `MIN_SAMPLE_GATE4_SUCCESS`，shard 侧无论多少样本都能直接触发重定数。**结论：系统性漏洞是"判据的入参缺一个维度"，不是某次算错** |
| 修复 + 回归保护（QM-5 ④） | PASS | ①纯函数落进单一真源：`gate-budget.js` 新增 `shardFormOf(workflowText)`（**复用** `check-desktop-shard-forwarding.js#parseShardArgv`，不另抄一份 argv 解析）与 `budgetMinFromGateBudgetText(text)`（旧提交没有该文件时退到 workflow 里的 `WaitForExit(<ms>)` 字面量）；②`checkSizing({…, form})`：传了 form 就一律用当前形态的样本与 max，不传保持旧行为（不破坏既有锁）；③新增 `MIN_SAMPLE_CURRENT_FORM=20`，样本不足时唯一出口是 `INSUFFICIENT_CURRENT_FORM`，**同时跳过** `RULE_VIOLATED`/`NO_LONGER_SIZED`（不给"没量过的数"发指令）；④探针按 `budget×shard` 分档打印每一代，新增退出码 **4 = 当前形态样本不足**；⑤锁 `scripts/gate-budget.test.js` 从 13 条扩到 **17 条**，终态 `17 pass / 0 fail` |
| TDD 红→绿 | PASS | 4 条新锁先落笔即红，实测：`✖ 旧形态的观测最大值不得决定当前预算`、`✖ 当前形态样本不足…`、`✖ 当前形态自己贴脸/违约时…`、`✖ 形态键是纯函数… TypeError: gate.shardFormOf is not a function` —— 前两条红在断言、最后一条红在"函数还不存在"，都不是"忘了写断言"那种红。再补 2 条（`解析不了就是 unknown`、`探针接线`）后实现全部转绿。**第一条测试特意保留"不传 form 时必须仍然红"的夹具断言**，否则"分档后不报红"可以靠把判据整体关掉蒙过 |
| 变异反证（6 条，原件已入库） | PASS | `.ccg/reviews/probeform-mutate.driver.js`（仓库内可重跑）+ 产物 `.ccg/reviews/probeform-mutations.txt`：5 条 want=red 全部**点名**预期的那条锁红（A 让 `checkSizing` 无视 form；B 摘掉样本不足出口；C 把解析失败默认成 fixed；D 探针不传 form；E 把 `FORM_*` 记进 `errs`）、1 条 want=green 照绿（F 只把 `TIMEOUT_MARGIN_MIN` 从 5 抬到 6，判据不该连无关余量微调也打死）、FINAL `17/17`，`MUTATION_BAD=0`。**这轮电池还抓到两处我自己写的驱动缺陷**：① 多行锚点按 `\n` 字面匹配，在工作副本 CRLF 上永远 `hits=0` ⇒ A/C 两条 ABORTED；② 我第一版把它"改成" `replace(/\\n/g,…)`（找两字符序列）仍不生效 —— 修完必须复跑验证，不然就是把 ABORTED 换个姿势留着。两条都记在这里而不是只写"已修" |
| 实测（形态分档上线后同一探针复跑） | PASS | `.ccg/reviews/probeform-measured.txt`：`probe_errors=0`，三档现场 `budget=30\|shard=broken g4 4/4 max=0.23`、`budget=45\|shard=broken g4 41/42 max=2.05 · shard 72/72 **max=31.55**`、`budget=45\|shard=fixed（当前）g4 6/6 max=1.83 · shard 8/8 **max=17.43**` ⇒ `hugging=false`、`sizing_ok=false` 且理由只剩 `INSUFFICIENT_CURRENT_FORM`（当前形态同形态成功样本 14 < 20），**`RULE_VIOLATED` 不再出现**。也就是：那次误报被定位成"样本换代"，而不是靠放宽判据或改倍数消化的 |
| 未知样本的处理口径（不假装已闭合） | PASS | `form_unknown_n=21`（打印首个原因 `FORM_BLOB_MISSING：本地没有该提交（PR head 分支已删？）`）。**unknown 一律不进当前形态池，也不计进 `probe_errors`**：PR run 的 head 提交在 squash + 删分支后本地取不到是结构性的（`refs/pull/*` 不默认 fetch），混进 errs 会让探针永久退 3 = 新判据自己被关闭 —— 变异 E 就是把这条钉死。代价如实写出来：当前形态样本数因此偏保守（只有 push run 与仍存活的 PR run 进池），宁可少判也不误判 |
| 行尾与 diff 对账 | PASS（含一次自纠） | 两段测试是用 `cat >>` 追加的，把 46 行 LF 混进了一个 `w/crlf` 的文件。先按判据核再动手：`git ls-files --eol` = `i/lf w/mixed`、索引 blob `cr=0` ⇒ **git 侧无损，脏的是工作副本**；随后把 46 行 + 7 个空行补回 `\r`，工作副本回到 `w/crlf`、blob 仍 `i/lf`，复跑 `17/17`。教训单独记：追加文本进 CRLF 文件之前要先看这个文件在工作副本里的行尾，别事后靠 `git diff` 才发现 |
| 接线棘轮 | PASS | 本笔没有新增测试文件（扩的是已接线的 `scripts/gate-budget.test.js`，它在 Gate 3 的 `node --test` 清单里已点名）；`node scripts/check-unwired-tests.js` ⇒ OK；`check-step-failfast.js` ⇒ OK。探针本体**不进 CI**（要 gh + 网络），这是 #3313 就定下的口径，本次未改 |
| QM-1 打包 / QM-4 视觉 | N/A | 只触 `scripts/` 两个判据文件、一份测试与 `.ccg`/`openspec`/CHANGELOG；未触 `apps/desktop/electron/**`、`packages/rpa-engine/**` 与任何前端文件 |
| QM-6 CCG 双模型外部评审 | PENDING（合并前必须完成） | 本笔改的是"谁来判预算"的判据本身 ⇒ 按 QM-6 触发条件（核心引擎/门禁判据）必须走双轴。通道沿用 #3357 的做法：先探 CC Switch `:15721`（本会话 2026-10-12 实测 ECONNREFUSED ⇒ 直接走替代通道），逻辑轴 `opencode/nemotron-3-ultra-free`、可维护性轴 `opencode/ling-3.1-flash-free`，任务书显式写"只读 + 结论进 stdout"，且**与写型变异串行**（电池已跑完并逐字节还原）。处置结果将在本行补记，不以自审冒充通过 |
| 远程同步 | PENDING | 合并后按 `git log origin/main --grep='(#NNNN)$' --format=%H\|%cI` 与 `gh pr view <N> --json state,mergedAt,mergeCommit` 两源同 sha 取 merge SHA，`git ls-remote --heads origin budget-probe-form-split` 返回 0 行证远端分支已删；本行改写 PASS + SHA 的**同一次提交**内删除 frontmatter 三个 `sync_*` 字段 |

### 为什么这笔需要人工过目

它改的是**判据**：`checkSizing` 现在多了一个入参、多了一条"样本不足就不判"的出口，探针也多了一个退出码（4）。判据变更本身不可能被"判据自己"验证 —— 本仓禁止清单里"改谁来守门"这一类正是它。所以 CI 全绿后停下等人确认，不自动合并。

### 遗留（不假装已闭合）

- **45/55 这档仍未被"当前形态"的数据确认过**：要等 `budget=45min|shard=fixed` 这一档攒到 ≥20 个成功样本再跑 `node scripts/gate-budget-probe.js --check`。届时若报 `RULE_VIOLATED` 才是要重定数的信号；报 `INSUFFICIENT_SAMPLES_FOR_FORM`（现在这个）只是"还没量够"。
- **`form` 只覆盖两个维度（预算、分片是否真分文件）**。真实上还有第三个会换代的因子：`--maxWorkers` / `--no-file-parallelism`（并行度变了时长直接换代）。本次没做，因为窗口里它没变过；等它变一次再加分档键，不提前建结构。
- **push run 与 PR run 混在同一份 Gate 4 统计里**（`g4` 两池合并是 #3313 留下的口径，`events` 字段有声明）。分档后仍然合并计数，只是同一形态内合并。要不要彻底拆成两池，等下一次真按样本定墙时一起判。
- 探针仍**不进 CI**：形态误报这次靠人跑才发现。可选方案（把纯函数版判据接进 Gate 3，网络采集留在本机）没有在本次夹带。
