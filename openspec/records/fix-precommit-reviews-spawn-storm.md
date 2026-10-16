---
record: fix-precommit-reviews-spawn-storm
task: pre-commit 判定记录自动暂存从逐文件 fork git 改为常数次扫描（提交耗时与树上记录数解耦）
date: 2026-10-16
sync_status: PENDING
sync_reason: 本 PR 尚未合并，merge SHA 此刻不存在；合并后由后续回填 PR 就地改写为 PASS 并删除本段三个 sync_* 字段
sync_backfill_owner: 下一个会话（按 `git log origin/main --grep='(#NNNN)$'` 取 merge SHA 回填）
---

## 本次执行记录：pre-commit 判定记录暂存的进程创建预算（fix-precommit-reviews-spawn-storm，2026-10-16）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ | 运行时代码（守门钩子本体）：worktree `D:/Data/projects/mp-worktrees/mp-fix-precommit-reviews-spawn-storm`，裸分支 `fix-precommit-reviews-spawn-storm`，基线 `HEAD...origin/main = 0 0`；`pre-code-edit-guard.ps1` 在共享根实测 `exit 1`、在 worktree 内 `exit 0`；`git-dir != common-dir` |
| 第一性原因（QM-5 ①） | ✅ | 引入点 `#3396`（该段注释自述由 2026-10-12 排查触发；树上该目录最早的新增可追到 2026-10-07 的三笔）。当时意图正确（把以「提交前 HEAD sha」命名、squash 后永不被引用的判定记录 stage 进同一提交）；错在**候选集来源选了文件系统 glob 而非 git 视图** ⇒ N 变成「树上全部记录」而非「本次新增 1–2 条」。放大系数实测：`N=200` 时旧实现 404 次进程创建 vs 新实现 7 次 |
| 逃逸分析（QM-5 ②） | ✅ | 单元/集成层：`scripts/hooks/pre-commit.test.sh` 原 15 个场景**只断言功能结果**（记录是否入库、幂等），对「花多少次进程创建」结构性免疫——旧实现全部通过。审查层：该段代码评审时读起来「每个文件问一次 git」语义清晰，无成本类检查项可指。视觉/CI 层：无关。**本类缺陷的通用形态：正确性测试看不见成本，所以成本必须由独立的规模锁守** |
| 修复 + 回归保护（QM-5 ④） | ✅ | `scripts/hooks/pre-commit` L166+ 改为 `ls-files --others --exclude-standard -z` ∪ `diff --name-only -z`（两集按定义互斥，且 MUST 带 `:(glob)` 使 `*` 不跨 `/`）→ 一次 `git add --pathspec-from-file=- --pathspec-file-nul`（stdin+NUL，绕 Windows ~32k argv 上限）；扫描按侧独立、批量失败回退逐条并出声。回归锁同文件 `scenario16/17/18/19/20`，最终基线（单笔提交、rebase 到新 origin/main 后重跑）全量 **PASS=47 FAIL=0**；实测 N=200 时 404→7 次，且 N=2 与 N=200 读数相等（`git_calls=7 / 7`，`staged=2 / 200`） |
| 防止再次发生（QM-5 ⑤） | ✅ | ① CI 常驻结构判据 `scripts/check-precommit-spawn-budget.js` 接进 `quality-gate.yml` **`changes`** 作业（Gate 2b3，`shell: bash`），读钩子正文、与执行路径无关，10 条自测全通过；② 落 `.gitignore:106` negation（实测 `git check-ignore -v` 曾命中 `scripts/*.js`）；③ `check-unwired-tests`（域内 89 个文件全接线）与 `check-step-failfast`（36 个多命令步骤全 fail-fast）均绿；④ 机器级前提另立文档 `01-docs/INVESTIGATE-PROCESS-SPAWN-COST-2026-10-15.md` |
| 行尾与 diff 对账 | ✅ | 两口径 `git diff --numstat` 与 `--ignore-cr-at-eol --numstat` 逐个文件相等：`pre-commit 3/1`（工作副本纯 CRLF，index blob 为 LF）、`pre-commit.test.sh 83/0`（该文件 `attr=text eol=lf`，纯 LF）、`check-precommit-spawn-budget.js 64/10`、`check-precommit-spawn-budget.test.js 75/13`（纯 CRLF，改判据本体那一次）、`spec.md 23/2`、`design.md 23/1`、`tasks.md 10/1`、`quality-gate.yml 13/0`、`.gitignore 3/0`。删除数只出现在「就地改写那一行」的位置，无幽灵整文件改写。插行一律由脚本逐行保留锚点行尾，且**写前**断言 CR/LF 增量等于插入行数（本轮两次靠这条自证挡住：一次把纯 LF 的测试文件按 CRLF 插、一次把纯 CRLF 的钩子行写丢一个 CR） |
| 接线棘轮 | ✅ | 新增 `scripts/check-precommit-spawn-budget.test.js` 已被 `quality-gate.yml` Gate 2b3 按完整相对路径显式点名；`node scripts/check-unwired-tests.js` → `OK: 全部测试均已接线或按欠账登记` |
| QM-1 打包 / QM-4 视觉 | N/A | 未触 `apps/desktop/electron/`、`packages/rpa-engine/` 与任何渲染层文件；本次改动全在开发流程工具链（钩子 shell + node 判据 + workflow 接线 + 文档），不产生用户可见界面或打包产物变化 |
| QM-6 CCG 双模型外部评审 | ⚠️ 已跑三轮，裁决见引擎产物 | 模型名取真源 `[routing.backend].primary=claude` / `[routing.frontend].primary=opencode`（读 `~/.claude/.ccg/config.toml`，不抄文档）。前两轮处置见 `openspec/changes/fix-precommit-reviews-spawn-storm/tasks.md` 6.5.1–6.5.10。**第三轮压成单笔后真跑 DUAL**（`sh scripts/deep-review.sh`，HEAD=`20d44310`，diff 基线 origin/main 1313 行，proposer=opencode + critic=claude 跨家族通过；critic 出 7 条 → 3 条进入自扮演裁决）：i1 **upheld**（裸 pathspec 的 `*` 跨 `/`，候选域是旧 shell glob 集合的超集，spec 那句「恰好等于旧集合」被静默扩大）⇒ 加 `:(glob)`，行为锁 scenario17 nested + 结构绊线 GLOB_SCOPED_PATHSPEC + 变异 M7 各测一格；i3 **upheld**（预算按全文计数，与无关的 `[sync-version]` 段耦合、余量恒为 0 ⇒ 必然假红、假红逼人抬预算）⇒ 预算改段作用域（3→2），全文计数保留为 metrics 出声，锚点缺失判 SELF_FAULT 并 CLI 退 2；i2 **dismissed，依据是读数不是措辞**（回退成本由「本次真要暂存的条数」驱动：树上恒 200 条时新增 1→逐条 1 次、新增 2→2 次，而旧形态的 N 是盘上 696 条全集），并配 M8 反证「退回盘上全集」时只有 scenario20 红、成本锁照绿。⛔ 状态字段一律不由本记录预填：`check-pr-exec-record.js` 的闭环判据读的是**工作树里的** `.ccg/reviews/<父sha>.json`，取值以引擎 writeBack 为准；单提交分支无法把闭环状态写进已提交的记录内容，该缺口已登记（见下方遗留与 tasks 6.5.14） |
| 远程同步 | PENDING | 合并后取 `git log origin/main --grep='(#NNNN)$' --format=%H|%cI` 回填 merge SHA 与时间，`git ls-remote --heads origin fix-precommit-reviews-spawn-storm` 返回 0 行证远端分支已删；回填后删除上方三个 sync_* 字段 |

### 变异反证（8 条，最终基线重跑 `TOTAL_BAD=0`）

| 变异 | 结果 | 红集（指名） |
|------|------|-------------|
| M1 候选集改成「无差别 stage 全部已跟踪 json + 硬塞 keep.md」 | 3/3 抓到 | `scenario17 暂存集合与预期不符` / `未跟踪记录有遗漏` / `把非 .json 纳入候选`；**且逃过规模锁** ⇒ 成本锁与范围锁互不替代 |
| M2 整份退回旧实现（取 `HEAD` blob） | 2/2 抓到 | `规模失控：N=2 用 8 次、N=200 用 404 次（差 396）` / `预算超标 400` |
| M3 `-z`/NUL 退回换行分隔 | 2/2 抓到 | `含空格/中文的记录未入库` / `暂存集合与预期不符` |
| M4 批量失败不回退也不告警 | 3/3 抓到 | `回退分支未被走到（per-file add 次数=0）` / `未出声告警` / `回退未补齐记录`；`injection-hit` 照旧绿 ⇒ 红的是被测语义不是夹具 |
| M5 **对判据本体**变异（shim 不再记日志） | 1/1 抓到 | `计数通路失明（0 / 0 < 6）` |
| M6 把扫描失败重新吞掉（`2>/dev/null \|\| true`，回到 i5 修复前） | 1/1 抓到 | `scenario19 扫描失败被静默吞掉`；**成本锁与存活锁照绿**（`规模失控`/`计数通路失明` 均未红）⇒ 上一轮正是这个组合让修复裸奔（实测 PASS=6 FAIL=0），scenario19 承重而非冗余 |
| M7 摘掉 `:(glob)` 路径魔法（第三轮 i1） | 1/1 抓到 | `scenario17 把子目录里的 json 纳入候选（pathspec 的 * 跨了 /，域比旧 shell glob 大）`（外加 `暂存集合与预期不符`）|
| M8 回退循环输入换成盘上 glob 全集（第三轮 i2） | 1/1 抓到 | `scenario20 回退成本不按候选数走（1→201 / 2→202）`；**`scenario16 规模失控` 照绿**（批量未失败时回退根本不跑）⇒ 证明 scenario20 不是 scenario16 的冗余 |

另记 M2 的最终读数（退回旧实现那一格）：`规模失控：N=2 用 8 次、N=200 用 404 次（差 396）` + `预算超标：含 .ccg/reviews 的调用 400 个` + `候选集未取自 git 视图` + `批量 add 未被走到` 四条同时红，而 `probe-alive`/`still-effective` 照绿——红集精确到名，没有连带噪音。

### 过程中自造并被当场纠正的四处（留档，避免下一个读者重踩）

- **规模锁第一版是假绿**：把 shim 前置 PATH 后经 `git commit` 触发，读数恒 `0 / 0` 却打印 `scale-locked PASS`。根因是 Git for Windows 生成钩子时把 `/mingw64/libexec/git-core` **前置**到 PATH，钩子里裸 `git` 永不经过 shim。修法：夹具改为直接调用钩子脚本本体 + **命中数下界正控**（`probe-alive ≥6`），使「探针失明」与「成本恒定」可区分。
- **一条装饰性断言被 M1 揭穿**：原写「重加了已跟踪且无改动的记录 ⇒ 应变红」，但对干净文件 `git add` 是 no-op，暂存集里永不会出现它 —— 该性质在提交内容上不可观察。已替换为可观察的「未跟踪记录必须一条不少」。
- **我把自己 8 GB 的探针当成了环境**：首版诊断脚本递归扫 38 个 worktree 的 `node_modules`，单进程 7,957 MB，读数「内存 98.5% / 剩 480 MB」全是探针造成；杀掉后真值 74.2% / 8.4 GB。
- **我用 latin1 读写 UTF-8 写坏了 workflow**：全文中文变乱码 ⇒ `YAML_PARSE_FAIL`。**行尾两口径对账抓不出这种破坏**（两者一致），暴露它的是「插入 13 行却出现 705 增/692 删」的规模上界。已按 R2 精确单文件还原并重做为「剔除插入块后与原文逐字相等」的前置断言。

### 遗留（不假装已闭合）

- **进程创建成本的归因经过一次自我更正（已写入文档）**：初稿把「~1 秒/进程」当机器级前提；风暴排空后同法复测为 `cmd.exe` **53 ms** / `git --version` 84 ms / 本仓 `rev-parse` 136 ms，与拥堵现场的 1,175 / 699 / 774 ms 差 **22 倍**，同一套防护与索引器始终在场 ⇒ **「~1 秒」是并发放大的读数，不是机器常数**，在场组件从「疑似元凶」降级为「候选放大器」，仍未做单变量停用实验。修订后的因果是：O(N) 的 spawn 形态 × 并发会话 ⇒ 互相拖慢 ⇒ 拥堵自持，所以本 PR 消掉 N 是在拆放大器本身。判据与演进链见 `01-docs/INVESTIGATE-PROCESS-SPAWN-COST-2026-10-15.md` §7 复测更正。
- **`.ccg/reviews/` 的无界增长未治理**：该目录在 origin/main 上是**已跟踪**的审计留痕，且每个 worktree 检出即全量继承；月度新增在 2026-10 达数百，**没有任何回收机制**。本次经决策**不删除**（删除受轨文件须 `git rm` 评审，且 38 个 worktree 同时大规模 `D` 会与在飞提交撞车）。成本解耦之后它不再惩罚提交，但「主干持续吸收一次性判定产物」本身是待裁的产品/治理问题。计数会随每笔提交自增，故此处只描述构成、不写死总数。
- **`pre-code-edit-guard.ps1` 与 `AGENTS.md` 口径冲突（经决策本次不动，仅登记）**：守卫 L18–26 对共享根**无条件** `exit 1`、无路径放行清单；而 AGENTS.md 分层规则称「`scripts/` 工具脚本、docs 可就地编辑」。二者由不同层执行且互不认账，需人工裁定收敛方向（放宽守卫 vs 收紧文档）。
- **隔离区堆积超阈值**：`mp-worktree-health.ps1` 报 `quarantineCount=350 / violations=355`，越过质量节拍 pre-flight 的告警线（>50 / >100），建议另开 `git-cleanup-analysis` 诊断。
- **并发提交风暴仍在**：调查期间实测 13 条在飞 `git commit` 链；本 PR 合并后新提交受益，**已在跑的链仍按旧钩子走完**。收尾时不得把「合并了但还慢」判成修复无效。
- **深度审查的闭环状态在「单提交分支」上结构上无法写进已提交的记录（实测结论，非推测）**：`ccg-review-decider.js` 每次提交无条件重写 `deepReview` 段、无保留逻辑，而记录按**父 sha** 命名 ⇒ 单提交分支的父恒为 origin/main 顶，amend 也落在同一文件名上，于是已提交的记录内容必然是 `pending`。origin/main 指纹：dual 记录 233 篇中 `pending` 217、`self_play_resolved` 2、`needs_revision` 2、`cleared` 1 ⇒ 闭环此前只发生在 ≥2 提交的分支（第二条提交的钩子重写的是「上一条 sha」那份，第一条那份得以保留裁决值，再被本次自动暂存段带进提交）。CI 以 `--mode=advisory` 调用（`quality-gate.yml:145`）因此不因此变红；本地 `--mode=enforce` 读工作树文件，引擎裁决即生效。**本 PR 不改建「谁来守门」的判据**，只把缺口写进 tasks 6.5.14 交后续裁决（可选解法：decider 保留已有裁决 / 记录改按 diff 内容寻址 / 允许多提交收尾——三者都动门禁语义）。
