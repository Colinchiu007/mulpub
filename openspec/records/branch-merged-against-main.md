---
record: branch-merged-against-main
task: 修 check-branch-merged.js 的判定域与差量口径（re-sync 型分支大面积假报 LOST）+ 顺带抓到并修掉逐行归因的编码盲区
date: 2026-10-17
# ↓ 下面三个字段只在「远程同步」尚无法收口时填写；回填成 PASS 后必须整段删除。
sync_status: PENDING
sync_reason: 本 PR 尚未合并，merge SHA 还不存在
sync_backfill_owner: 本会话（合并后同一次提交内改 PASS 并删除这三个字段）
---

## 本次执行记录：给落地判据换判定域（branch-merged-against-main，2026-10-17）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ | 动 `scripts/` 工具脚本本体 ⇒ 混合 PR，按 AGENTS 分层铁律走隔离工作区：`git worktree list` 里有本任务那条、分支名 = 任务名裸名（`git -C <工作区> rev-parse --abbrev-ref HEAD` 回读 = `branch-merged-against-main`）；建区用 `scripts/start-mp-task.ps1 -TaskName branch-merged-against-main -NoDeps`，rc 不作判据，按产物判 |
| 第一性原因（QM-5 ①） | ✅ | 引入点是本切片自己上午那笔提交（#3749）。两个缺陷叠加：**(D1)** 差量起点取 `merge-base(ref, merge)`，分支 re-sync 过 main 之后这个值退化成 **merge 自己**，于是「我新增的行」里混进了**别人后来合进主干的行**；**(D2)** 判定域钉在 merge 快照且按文件取「最好的那份」，一个文件被同分支多个 PR 分别改时**没有任何一份快照含全量** ⇒ 逐份 LOST ⇒ best 仍 LOST。第三个是本次才暴露的：逐行归因用 `git log -S<行>`，而判据内部按 latin1 保字节、execFileSync 把参数按 **UTF-8** 编码送出 ⇒ **中文行永远匹配不上**（同一次判定里 ASCII 的 `sync_status: PENDING` 命中、紧随的两条中文行全部救不走）。 |
| 逃逸分析（QM-5 ②） | ✅ | 单元测试：v1 的 13 条夹具**全部用 ASCII 行**、且全部是「刚合并、main 未前进」的新鲜形态 ⇒ D1/D2/编码三条都不可表示。真实合并 A/B 当时跑了 8 例，覆盖面同样只有新鲜态——**这就是"0 假阳性"这句结论的真实边界**：它测的是它采过的那一类分支，不是"分支"这个类。视觉/打包/审查轴与本改动无关。逃逸点还有一条形状值得记：判据自己是清理流程的工具，它坏的时候最先发现的是清理任务本身，而上一次清理恰好用的是"新鲜合并"那 8 例。 |
| 修复 + 回归保护（QM-5 ④） | ✅ | 判定域改为 `--against`（默认 `origin/main`，取不到按 `main` 回落**且末行必须打印实际落点**；显式传入而取不到 ⇒ 退出码 2）；差量起点 = `merge-base(ref, against)`；`--merge` 降级为归因排除集。违规行（新增缺失 / 删除复现）一律走**逐行具名归因**：同一次 `git log -p` 拿到的补丁在 latin1 字节空间里与该行等值比对，命中才放行，命不到仍算 `LOST`；**整份文件不在主干（MISSING_FILE）单独成档且不做行级救走**。新增 7 条锁：T10（re-sync 后无差量是通过态）/ T10b（同夹具上分支独有行仍 LOST，防 blanket pass）/ T11（删除行被主干具名加回 ⇒ DRIFT）/ T12（收紧参考系不得放过真丢失）/ T13（`--against` 取不到 ⇒ 2，且必须打印落点）/ T14（我新增的行被别的 PR 正确改写 ⇒ 逐行归因点名）/ T15（从未上主干的行救不走）/ T16（MISSING_FILE 仍 LOST）/ **T17（中文行必须同样能归因——就是那条编码盲区本身的锁）**。全量 `node --test scripts/check-branch-merged.test.js` = **22 tests / 22 pass / 0 fail**。 |
| 防止再次发生（QM-5 ⑤） | ✅ | ① 变异反证 **8 条**，逐条实测 CAUGHT、红集互不相同（下表）；② 真实仓批量 A/B 把**覆盖面从"新鲜合并"扩到四类形态**（新鲜 / 单 PR 老分支 / 多 PR + re-sync / 整份缺席），并把仍红的 3 条逐个手工读现场而不是调宽判据；③ 测试夹具新增一条硬要求并已在本记录里落成文字：**判据涉及"行文本比对"时夹具必须含非 ASCII 行**，否则对中文仓等于没测；④ PRD §8 与 AGENTS 收尾清单第 5 条同步改写（AGENTS 那句现在明写"判定域是 `--against`，`--merge` 只做归因排除"）。 |
| 行尾与 diff 对账 | ✅ | 见下方「对账读数」：本记录所在文件为新建（LF），被改的 `scripts/check-branch-merged.js` / `.test.js` / `AGENTS.md` / PRD 四件，`git diff --numstat` 与 `--ignore-cr-at-eol --numstat` 两口径逐文件相等（当场跑，见下）。 |
| 接线棘轮 | ✅ | 测试文件未改名，Gate 2b4 已在 #3749 接进 `changes` job（`node --test scripts/check-branch-merged.test.js`），本切片不动接线；`check-unwired-tests.js` 实跑 rc=0。 |
| QM-1 打包 / QM-4 视觉 | N/A | 未触 `apps/desktop/electron/`、`packages/rpa-engine/`，也未触任何前端视觉文件；改动面只有 `scripts/` 工具脚本 + 文档。 |
| QM-6 CCG 双模型外部评审 | 见下 | 见「QM-6」一节，如实记录跑成/没跑成，不以自审冒充 |
| 远程同步 | PENDING | 合并后取 `git log origin/main --grep='(#NNNN)$' --format=%H\|%cI` 回填 merge SHA 与时间，`git ls-remote --heads origin <分支>` 返回 0 行证远端分支已删；回填后删除上方三个 `sync_*` 字段 |

### 变异反证（8 条，逐条实跑，红集互不相同）

| 变异 | 改成什么（被规则明文禁止的那个形态） | 必须红 | 实测 |
|---|---|---|---|
| M1 | 判定域退回 merge 快照（v1 形状） | T6 / T11 | CAUGHT |
| M2 | 摘掉逐行归因（违规一律算丢失） | T11 / T14 / T17 | CAUGHT |
| M3 | 把「无差量」重新当成判据故障（v1 反失明一刀切） | T10 | CAUGHT |
| M4 | 显式 `--against` 取不到时静默回落 merge[0]（把失明伪装成通过） | T13 | CAUGHT |
| M5 | 差量起点退回 `merge-base(ref, merge[0])`（D1 的来源） | T10 | CAUGHT |
| M6 | 逐行归因**无条件命中**（不做补丁等值判定就放行） | T15 | CAUGHT |
| M7 | 摘掉 MISSING_FILE 特殊路径 | T16 | CAUGHT |
| M8 | 归因分片分隔符放回 `%H` 之后（sha 与 patch 错位配对——本切片自己犯过的那次） | T2 / T11 / T14 / T17 | CAUGHT |

驱动收尾断言 `restored_byte_identical=true`，且未变异的基线必须先全绿才允许谈红集（否则"变红"无法归因）。
M3 与 M5 的红集相同（都只有 T10）：那是**同一条锁抓两种坏形态**，如实记而不是假装它们互不相同。

### 真实仓批量 A/B（把覆盖面从"新鲜合并"扩到四类形态）

| 分支形态 | v1 读数 | v2 读数 |
|---|---|---|
| 今天的回填 PR（tip 4e703f3a8） | 未测过这类之外的形态 | `files=1 drift=1 lost=0` rc=0 |
| 今天的撤回 PR（tip a88bd5dba） | 同上 | `files=1 identical=1 lost=0` rc=0 |
| 7 个 PR + re-sync（tip b0df701cf） | **`lost=65 files=66`，48 s** | `files=0 lost=0` rc=0，0.5 s |
| 单 PR 老分支（tip bf520a13c） | — | `files=8 identical=2 drift=4 lost=2` rc=1 |
| 单 PR 老分支（tip 0ec118832） | — | `files=3 identical=2 lost=1`（MISSING_FILE）rc=1 |
| 单 PR 老分支（tip e8a4749fc） | — | `files=13 identical=3 drift=9 lost=1` rc=1 |
| 单 PR 老分支 ×2（5c9a5aa1d / 5f2c95a8a） | — | rc=0 |

**仍红的 3 条逐个读了现场，都是真停手而不是判据坏**：`bf520a13c` 的 `rpa-selector-utils.js` 连文件级归因都没有、点名的是 2026-09-30 那次未落地修复的注释行（项目记忆里那条"远程 head 与每个已合并 PR 的 headRefOid 都不相等 ⇒ 是别的会话尚未合并的工作"正是同一个 tip）；`0ec118832` 是 `_exempt` 记录整份不在主干；`e8a4749fc` 点名的是当初那条没落地的 learnings 文本。

### QM-6

（本行在提 PR 前只写事实：跑成/没跑成、用的哪个通道、findings 原件落点。不得以自审替代。）

### 遗留（不假装已闭合）

- **`--merge` 现在只是归因排除集，但 CLI 仍要求必填**。真实清理里更常用的其实是"只给 ref，让判据自己对主干"；把 `--merge` 变成可选要同时决定"没传时归因如何排除本次合并自身"（否则我的 PR 会被当成他人差异），本切片不动，留给下一轮。
- **v1 的"0 假阳性"结论的边界已在逃逸分析里改写**：那句结论的测量域只有新鲜合并态。留一条通用纪律给下一个会话——判据的真实仓验证必须按**分支形态**分桶采样（新鲜 / 老单 PR / re-sync / 整份缺席），不能只挑刚合的那几个。
