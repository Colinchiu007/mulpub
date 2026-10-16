---
record: gate12c-followups
task: 两处口径换代余波的收口——我自己记录里的 worktree 绝对路径占位符化（账本纯收紧），以及给收尾清单第 7 条补「按 (merge SHA, workflow) 这一格判」的限定
date: 2026-10-16
# ↓ 下面三个字段只在「远程同步」尚无法收口时填写；回填成 PASS 后必须整段删除。
sync_status: PENDING
sync_reason: 本 PR（gate12c-followups）尚未合并；合并后由回填 PR 把远程同步行改为 PASS 并删除本段三个字段
sync_backfill_owner: 下一个会话（合并后改为 PASS 并删除本段三个字段；新载体不进 JSON ledger）
---

## 本次执行记录：口径换代的两处余波——自身违规收紧 + 第 7 条收尾规矩的过强限定（gate12c-followups，2026-10-16）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | PASS | 🔧 门禁数据（`scripts/doc-abs-paths-baseline.json`）+ 📝 SOP 条款（`AGENTS.md`）+ 一篇他人会话记录的**一处路径写法**（`openspec/records/openspec-sync-realrepo.md`）⇒ **混合 PR**（不走 docs-only 通道）。worktree `<仓库父目录>/mp-worktrees/mp-gate12c-followups`、裸分支 `gate12c-followups`（`rev-parse --abbrev-ref HEAD` 实证），由 `git worktree add`（PowerShell 原生盘符路径）在 `origin/main` tip `f65584052` 上建并 `--show-toplevel` 回读。⚠️ 偏差如实记：未走 `start-mp-task.ps1`——共享根有他人会话 2 个 untracked，其 `-RequireClean` 按设计拒绝；本 PR 不需 node_modules（判据只用 node 内置模块） |
| 第一性原因（QM-5 ①） | PASS | 两条独立根因。**（A）我自己的违规**：#3693 的执行记录为了"隔离取证"把 worktree 的**本机绝对路径**写进了受管文档（该行现读 `L9`）。旧口径只在"路径不存在"时红，那条路径当时**存在** ⇒ 一路无感；#3652 换成纯计数后它当场被计成「超出存量基线 1 处」，而它只在**有盘符的机器**上才看得见（无盘符 runner 走 `canJudge=false` 支路）。**（B）我自己上一条规矩写过了头**：`AGENTS.md` 收尾清单第 7 条（#3723 加的）写的是"必须有该 merge SHA 的 push run 且 success"，但 push 触发有 `paths-ignore`，纯记录类回填**按设计不跑** `quality-gate`——本 PR 之前实测：#3727 的 merge SHA `f65584052` 上只有 `债务熔断门禁` 在排队、`quality-gate` 零 run。照字面执行会让下一个会话去追一个不存在的 run（或误报"丢证"） |
| 逃逸分析（QM-5 ②） | PASS | ① **判据层**：A 类问题在旧口径下结构性不可见（存在性判据对"存在但仍计入新增"这一类沉默），#3652 把它变可见，但可见域仍受 `canJudge` 的机器维度限制——**同一条违规在两种机器上给出两种结论**，这正是我先前登记为"不假装已闭合"的那条欠账的现场兑现。② **验收层（本轮最该记的一条）**：我在 #3723 改完文本后跑过一个"还剩几条盘符路径"的自查探针，它要求"冒号后至少再跟一个路径字符"，对 `D:` + 反斜杠 + 反引号那种写法命中 0，于是报"干净"，而门禁本体当场把它计成一条 —— 探针漏检伪装成结论。③ **规矩层**：第 7 条是**当天写、当天被自己的实测否证其全称**——写规矩时只用了"改了判据数据的那类 PR"这一个样本，没问"纯记录类回填呢"。④ 分类：测试场景缺失（缺"按设计不跑"这一档的收尾判据）+ 审查盲区（把自己的近似正则当成验收出口） |
| 修复 + 回归保护（QM-5 ④） | PASS | **A**：把那处路径改写成占位符形态 `<仓库父目录>/mp-worktrees/mp-openspec-sync-realrepo`（**AGENTS.md 自己就是这么写的**，分支名 `openspec-sync-realrepo` 与 `git rev-parse --abbrev-ref HEAD` 实证仍在原文里，取证力不丢），随后 `--all --write-baseline` ⇒ 该文件从账本**消失**（565→564 文件 / 1186→1185 处，`新增 0 / 消失 1 / 计数变化 0`）——这是**收紧方向**，合规且被门禁鼓励。**B**：给第 7 条补限定语（已实测在位，`grep -c "NO_RUN(by design)" AGENTS.md` = 1）：回读按 **(merge SHA, workflow)** 这一格判，改了哪条判据就要求承载它的那条 workflow 有该 SHA 的 run 且 success；`paths-ignore` 按设计不跑时如实记 `NO_RUN(by design)` 并转去核该判据**最近一次在 main 上的读数**——既不得把"没有 run"读成"丢了证据"，也不得拿"按设计不跑"当免检。**回归保护**：判据本体自己复跑——`node --test scripts/check-doc-abs-paths.test.js` ⇒ `tests 53 / pass 53 / fail 0 / skipped 0`（rc=0）；`node scripts/check-doc-abs-paths.js --all` ⇒ rc=0，机读行 `counts=1185 domain=3417 files=564 canJudge=true`。**验收一律用门禁本体，不再用我的近似正则**（这条就是 ② 的修法） |
| 防止再次发生（QM-5 ⑤） | PASS | ① **SOP 落点**：第 7 条的限定语进 `AGENTS.md`（可执行、可被下一个人引用），把"按设计不跑"与"丢证"分成两档，杜绝两种误读。② **自身违规清零并把账本缩小**：本轮之后 `openspec/records/` 下由我写过的记录不再携带盘符形态路径；账本从 1186 收到 1185，是这条链上第一次"因为发现了自己的问题而把存量减小"。③ **机制不变**：判据 `all_abs_paths_v2` 与其 53 条锁未改一行代码，本 PR 只动数据与文档 ⇒ 不产生新的口径漂移。④ **口径写进记录**：凡"扫到 0"作完成判据，必须由被验收的判据本身再跑一次（本文件与 `01-docs/learnings.md` 的既有"坐标先验"教训同源） |
| 账本与存量对账 | PASS | 本 PR 改动集 3 个文件（`AGENTS.md`、`openspec/records/openspec-sync-realrepo.md`、`scripts/doc-abs-paths-baseline.json`）+ 本记录 1 个新增。账本：**564 文件 / 1185 处**（前值 565 / 1186）；`新增 0 / 消失 1 / 计数变化 0`，消失项正是被我占位符化的 `openspec/records/openspec-sync-realrepo.md`。**方向：纯收紧**（不是"跑一次 --write-baseline 把新增记进去"那种被门禁明文禁止的形状）。本 PR 动过的三个文档面（`AGENTS.md` 的插入句、被占位符化的那一行、本记录）**均不含盘符形态路径**，由 `--all` rc=0 当场自证 |
| 行尾与 diff 对账 | PASS | `git diff --numstat origin/main HEAD` 与 `--ignore-cr-at-eol --numstat` 两口径**逐字相同**；`AGENTS.md` 工作副本 `crlf==lf==1154`（插入句沿用该文件自身 CRLF，未统一行尾）；`openspec/records/openspec-sync-realrepo.md` `crlf==lf==32`；账本 JSON 保持 `i/lf w/lf`；无 NUL、无替换字符（改后当场量） |
| 接线棘轮 | PASS | 不改 workflow、不改 `CI_IGNORED_PATHS`、不动分支保护 ⇒ 不触发"改谁来守门"的人工过目条件。`check-doc-abs-paths.js` 与其自测仍逐个点名在 `quality-gate.yml` 的 `changes` job（Gate 12c），判据本体本轮由 `--all` 与自测各跑一次；`check-workflow-structure.js` / `check-step-failfast.js` / `check-unwired-tests.js` / `check-gate-record-debt.js` / `check-changelog-growth.js` / `check-no-brand-residue.js` / `openspec-sync-check.js` 复验读数见 PR 正文 |
| TDD 红→绿 | PASS | 本轮不改判据代码，但按同一纪律走"先量再改"：改前先跑 `--all` 得 `counts=1186 files=565`；占位符化后**先跑门禁本体**（不是我的探针）看到该文件 `1 处 > 基线`→ 已归零，再 `--write-baseline` 收紧，最后 `--all` 与 53 条自测同时 rc=0 |
| QM-1 打包 / QM-4 视觉 | N/A | 未触 `apps/desktop/electron/`、`packages/rpa-engine/`、任何 `.vue`/样式/基线 PNG |
| QM-6 CCG 双模型外部评审 | N/A | 变更集 = 一条 SOP 限定语 + 一处路径写法 + 账本收紧，**无运行时代码**；按 AGENTS「纯文档/流程变更不强制 QM-6」判 N/A。如实登记：三条外部评审通道本轮实测仍不可达（同 #3652/#3693/#3723 现场），所以这里没有"跑了但没问题"这回事——N/A 的依据是变更类型，不是评审结果 |
| 远程同步 | PENDING | 合并后取 `git log origin/main --grep='(#NNNN)$' --format=%H\|%cI` 回填 merge SHA 与时间，`git ls-remote --heads origin gate12c-followups` 返回 0 行证远端分支已删；回填时把本行改写为 PASS 并**删除上方三个 `sync_*` 字段**（同一次提交内完成，不在 JSON ledger 留项）。按第 7 条回读 main push 时，本 PR 改了 Gate 12c 的**数据**（账本 JSON 不在 `paths-ignore` 白名单内）⇒ 必须要求 `quality-gate` 有该 SHA 的 run，不适用 `NO_RUN(by design)` 那一档 |

### 遗留（不假装已闭合）

- **#3723 的 main push 读数：写这行时未收敛，现已按第 7 条回读兑现**——run `38892053080`（merge SHA `89eebe8af`）`status=completed / conclusion=success`（看守在第 `obs=26` 处收到，`VERDICT=MAIN_GREEN`）。证据不停在作业结论：`job QG Changes=success` 且其内层 **step `Gate 12c - Doc abs-path validity (changes job)` = success**（同一 run 里 `QG Static / Visual / Coverage / Unit Tests / Desktop Shards×2 / Browser E2E / Autonomous / Business API Postgres / Gate Result` 亦全 success）⇒ #3652 口径换代的"过渡红"到此闭合，本轮不挂该项欠账。保留"写这行时未收敛"的痕迹而不是把它删掉：它记录的正是**规矩当天写、当天被自己的实测回读兑现**这件事，删掉就等于把兑现过程抹成一条从未存在过的焦虑。
- **第 7 条仍是人读的规矩**，机械化需要一条"main push 后自动重算并比对账本"的作业，那属另一份 PRD。
- **`canJudge` 的机器维度还在**：无盘符 runner 上存在性核对不执行（计数判定已照常），这条不对称由 #3652 显式出声而不是消除；彻底消除要把"存在性"从判据里去掉或改为 CI 可判的形态，属另一件事。
