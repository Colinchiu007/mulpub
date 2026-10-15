---
record: fix-worktree-remove-dirty-gate
task: worktree 删除守卫的脏判据盲区——不再把「测不到」报成「没内容」，并消除打印面里的构造性零
date: 2026-10-15
sync_status: PENDING
sync_reason: 本 PR 尚未合并，merge SHA 还不存在；合并后由后续 docs 回填 PR 改写为 PASS 并删除本段三字段
sync_backfill_owner: 下一个会话（按 AGENTS.md「合并后收尾清单」执行）
---

## 本次执行记录：worktree 删除守卫的脏判据盲区（fix-worktree-remove-dirty-gate，2026-10-15）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ | 运行时代码变更（`scripts/` 工具脚本自身 ⇒ 混合 PR，禁走 docs-only）。隔离 worktree `D:/Data/projects/mp-worktrees/mp-fix-worktree-remove-dirty-gate`、裸分支 `fix-worktree-remove-dirty-gate`；`node scripts/classify-docs-only.js --base=origin/main --head=HEAD` → **docs-only=false**；共享根保持 main + clean |
| 第一性原因（QM-5 ①） | ✅ | `git status --porcelain` 的口径是「git 眼里可见的改动」，不是「目录里有没有东西」；而旧判据 `$dirty = @(if ($registered) { ... })` 在**未注册时塌成空数组**。两者叠加 ⇒ `worktree dirty : 0` 在最需要保护的状态下是**构造出来的 0**。`git log` 归属：该判据自 `safe-worktree-remove.ps1` 引入即为单口径，非某次改动回归 |
| 逃逸分析（QM-5 ②） | ✅ | 单元层：守卫无单测（纯逻辑埋在脚本正文里，测不了）。集成层：`-WhatIf` 预演本身输出 `dirty:0` ⇒ 预演与实跑共用同一个错判据，"先看预演"这条纪律挡不住。审查层：自审把「数字为 0」读成「无内容」，四层同时失明。视觉/流程层：N/A（非 UI）。**真正的拦路虎是「一个数字承载三种语义」**，不是没人想到要检查 |
| 系统性漏洞（QM-5 ③） | ✅ | 具体到点：① `scripts/safe-worktree-remove.ps1` 的脏档只取 `git status --porcelain`（无 `--ignored`、无空数组保护）；② R7 把任何 baseline 漂移都判级联 ⇒ 高频并发共享根下告警被烧成噪声，反过来训练操作者忽略它；③ 三类内容风险共用 `-Force`/`-ConfirmDirtyDiscarded` 一个开关；④ **skill 两份物理副本缺同伴库 `worktree-fs-longpath.ps1`**，而 SKILL.md 指人用那份 |
| 修复 + 回归保护（QM-5 ④） | ✅ | 判据拆为三态 `Basis` + 三个纯函数（`Resolve-WorktreeContent` / `Resolve-ContentDisposition` / `Resolve-DriftDisposition`）+ 打印面纯函数 `Format-ContentSummary`；新增 **exit 10**（内容不可判定，确认不得替代测量）；ignored 走独立**折叠探针**（只出声、不设体积门槛）。回归锁 `scripts/worktree-fs-longpath.test.ps1` 第 12–17 节共 **28 条**（含真 git 夹具与顺序锁），pwsh 7 与 Windows PowerShell 5.1 两档各 **57 PASS / 0 FAIL / rc=0**；变异 M-A/M-B/M-C/M-D 四条各自**指名红** |
| 防止再次发生（QM-5 ⑤） | ✅ | ① 规格新增 5 条 ADDED Requirement（可判定性 / 分级门禁 / 漂移分级 / 证据可见 / 退出码先后）；② 锁接在已接 CI 的 `quality-gate.yml` Gate 2d（`check-unwired-tests.js` rc=0）；③ AGENTS.md R1–R5 的执行体本身被加固，`-WhatIf` 现在预览内容档拒绝；④ **跨仓回流**：SKILL.md v2.1.0 换成三条能力自证 + 退出码 0–10 全表，`references/pitfalls.md` 加载源新增 §二十二，库与补丁守卫成对补齐两份副本并各实跑一遍 |
| 行尾与 diff 对账 | ✅ | 对 merge-base `8e9109a55` 全量两口径 numstat **逐文件相等**（守卫 66/7、库 111/0、测试 190/0、`.quality-gates.md` 18/0、CHANGELOG 12/0）；逐字节判据 `loneCR=0 且 bareLF=0`（`.ps1` 工作副本 CRLF、新 md 文件 LF，两份 `.adversarial` 产物未改写行尾）。删除数 7 全属守卫内被替换的旧判据行，非行尾幽灵 |
| 接线棘锁 | ✅ | 本刀未新增测试文件——扩写的是**已在 CI 点名**的 `scripts/worktree-fs-longpath.test.ps1`（`quality-gate.yml:575`），故无新接线欠账；`node scripts/check-unwired-tests.js` rc=0（检查域 86 个测试文件全部已接线或按欠账登记） |
| QM-1 打包 / QM-4 视觉 | N/A | 未触 `apps/desktop/electron/`、`packages/rpa-engine/` 与任何渲染面；改动全部是仓库工具脚本与规格文档。既有测试文件 `scripts/*.test.ps1` 不产出交付物 ⇒ 打包与像素回归无适用面 |
| QM-6 CCG 双模型外部评审 | ✅ | 决策层：`scripts/plan-review.sh` 第一趟跑满 3 轮判 `blocked`，逐条回应改正后重跑第 2 轮 `converged / cleared`（产物 `.adversarial/ccg-plan-proposal-claude/`）。验证层：`scripts/deep-review.sh` 入口本机失效（`--force` 不真 force + 判定记录 off-by-one，见下「现场」），改按 AGENTS.md QM-6 的原始命令形态并行起两路——`--backend claude` 9 条、`--backend opencode` 9 条，**合计 0 Critical / 3 Medium**，逐条处置见 `design.md`「验证层」。落进代码的改正：F2（BLOCKED 行必须带上触发门禁的那个条目数）、F1/F3（`Get-WorktreeContent` / `TopLevelEntries` 命名与精度）、B4（删 `Total`）、B5（`$baselineFile` 由死 I/O 改为 R7 的读取源并打印来源）、B9（级联文案与打印过滤同源，符号集合收敛为 `Test-DriftCascadeSymbol`）、B2（深链接先走 `\\?\` 重试）。**如实上报未修**：B8 —— R6 主删除策略无 `/XJ` 原语保证，安全性目前是时序性的（tasks 6.11） |
| 远程同步 | PENDING | 合并后取 `git log origin/main --grep='(#NNNN)$' --format=%H\|%cI` 回填 merge SHA 与时间，`git ls-remote --heads origin fix-worktree-remove-dirty-gate` 返回 0 行证远端分支已删；回填后删除上方三个 `sync_*` 字段 |

### 现场（判据一律取产物，不取 rc）

- **对抗评审产物不进主干**：`.adversarial/` 自 `5952d38c2` 起在 `.gitignore` 第 380 行被忽略（主干仍追踪既有的 295 份，新文件默认不再入库）。本片两趟 `plan-review.sh` 的配对产物（`proposal/critique/revision-vN`）因此**只存在本机** `.adversarial/ccg-plan-proposal-claude/`，随 PR 入库的那部分是本记录与 `design.md` 的逐条处置表。这是上游刚做的仓库卫生决定，不在本刀翻案；如需入库须显式 `-f` 并另立议题。

- **决策层工具自身错配**：`plan-review.sh` docblock 承诺「1=有阻断」，实测打印 `blocked` 的那一趟 **rc=0** ⇒ 判"收敛"只看 `critique-vN.md` 里是否仍有未回应的 Critical。缺陷记 tasks 6.7，属「谁来守门」，报人不自治。
- **设计被自己的实测否证两次**：初版 ignored 字节预算被评审判 Critical（`node_modules` 恒触发 ⇒ 训练人加 `-Force`），换轴后又被轮3 i3 抓到取数方式才是成本源（`-uall --ignored` 实测任务 worktree 55,191 行 / 共享根 127,654 行）；且代码里 `$ignoredBytes` 一直是常量 `0`、从未测得——装饰性门禁的另一种形态是"参数存在但没有读数来源"。
- **修复自身再造零**（轮2 i4，唯一落在代码上的真缺口）：`unproven` / `measured-fs` 下 `trackedDirty=0` 照样印 ⇒ 打印面提成纯函数并加「MUST NOT 出现 `trackedDirty=0`」的真值表行。
- **QM-6 验证层的入口在本机不可用，改走文档规定的主命令形态**：`sh scripts/deep-review.sh --force` 实测**没有 force**——wrapper 只把 `--sha` 传给引擎，引擎用 `const mode = decision.mode` 覆盖一切，于是记录里写 `skip` 就恒退 0；而记录本身是**下一笔提交的 pre-commit** 才按当前 HEAD 的名字生成（off-by-one），我手工用 `ccg-gate.js` 生成的那份因为"暂存的只有文档"被判 `SKIP`（docs-only 快通道），反而把真判定**遮住**了。把它改名移开后按 diff 内容寻址回退也命不中（`git diff sha^ sha` 算出的哈希与记录里的 `stagedDiffHash` 不等）。⇒ 本片按 AGENTS.md QM-6 的原始命令形态直接起 `codeagent-wrapper --backend claude`（正确性/边界/安全/规格对账）与 `--backend opencode`（命名/模式/可维护性/集成）两路并行审查；缺陷记 tasks 6.10。
- **跨仓交付**：守卫与库是成对的（缺失即 `exit 8`），两份物理副本都补齐；旧副本先备份（`.codebuddy` 那份不是 git 仓库，不备份即不可逆），发后 `cmp` 逐字节自证并在两处各实跑回归锁（各 57 PASS）。skill-repo 的 commit/push 未做，交用户决定。

### 遗留（不假装已闭合）

- tasks 6.5：`-PreserveEvidenceGlob` 证据镜像豁免（需目录级长路径**复制**原语 + 深路径夹具），届时按**路径语义**而非体积收口。
- tasks 6.7：`plan-review.sh` 的 rc 与裁决接线。
- tasks 6.8：守卫端到端夹具（真建"注册丢失 + 目录非空"的 worktree，验 `exit 10` 全程零 kill 零删除）。
- tasks 6.9：skill-repo 提交与推送（该仓库另有他会话脏文件、`origin` 为共享 GitHub 仓库）。
- tasks 6.10：**QM-6 验证层入口本机失效**——`deep-review.sh --force` 不真 force（引擎用 `decision.mode` 覆盖一切），判定记录存在 off-by-one，按 diff 内容寻址的回退链实测命不中。本刀改按 AGENTS.md 的原始命令形态直接起两路后端完成；属"谁来守门"，报人不自治。
- tasks 6.11：**R6 删除策略的安全性是时序性的**（后端轴 B8，本刀如实上报未修）——`[IO.Directory]::Delete($lp,$true)` 没有 robocopy `/XJ` 那种"不穿透 reparse point"的原语保证，只靠"lateScan 刚刚解过链"兜住。正解需要自己的 change 与自己的评审，不夹带进本 PR。
- `node scripts/openspec-sync-check.js` 在**未改动的 main** 与本片各跑一次，集合逐行相同（14 条，全落 `.ccg/tasks/archive/2026-08~09/`）⇒ 本 PR 引入 0 条，不认领、另单跟进。
- R7 只单次采样：级联若发生在采样之后仍会漏，彻底解法需跨采样时间窗（design 决策 6）。
