## 1. 地基：隔离工作区与规格

- [x] 1.1 共享根与 `origin/main` 对齐后从规定入口建隔离 worktree：`start-mp-task.ps1 -TaskName fix-precommit-reviews-spawn-storm`（裸分支名，无 `codex/` 前缀）；**判据取产物不取 rc**——`git worktree list` 命中 1 行、`rev-parse --abbrev-ref HEAD` == 期望分支、`HEAD...origin/main` == `0 0`
- [x] 1.2 强制前置检查通过：`pre-code-edit-guard.ps1` 在共享根实测 `exit 1`（源码 L18–26 对共享根无路径放行），在 worktree 内实测 `exit 0`；`git-dir != common-dir` 证实隔离
- [x] 1.3 取证「38 个 worktree 共用同一份钩子」的机械链路：`core.hooksPath` 未设置 ⇒ 走共享 common dir 的 `.git/hooks/pre-commit`；并核对权威源 `scripts/hooks/pre-commit` 与安装体**逐字节 IN_SYNC**（否则测的就不是主干那份）
- [x] 1.4 行尾基线当场量取：`pre-commit.test.sh` = `i/lf w/lf`（CR=0）；`pre-commit` = `i/lf w/crlf attr/text=auto`（工作副本 164 CR / 164 LF 全 CRLF）；`quality-gate.yml` 与 `.gitignore` 同为 `i/lf w/crlf` ⇒ 一律走 CRLF 保真 splice，改后两口径 numstat 对账（实测 `13/0`、`3/0`，纯插入零删除）
- [x] 1.5 本 change 四件套 + `.openspec.yaml` 落地

## 2. 红：进程创建次数规模锁（TDD，先看红再改实现）

- [x] 2.1 写 `scenario16`：PATH 前置计数 shim，测试驱动一律用 git 绝对路径；探针函数只打印不调 `ok/bad`（命令替换是子 shell，FAIL 计数会丢）
- [x] 2.2 三向约束同时成立才算锁：同成本 + 有预算（含 `.ccg/reviews` 的 argv ≤3）+ **仍有效**。缺第三条则「把循环整块删掉」也能通过
- [x] 2.3 **夹具自证（本轮真实踩坑并修）**：首版把 shim 前置到 PATH 后经 `git commit` 触发，读数恒为 `0 / 0` 却报 `scale-locked PASS` —— 假绿。根因是 Git for Windows 生成钩子时把 `/mingw64/libexec/git-core` **前置**到 PATH，钩子里的裸 `git` 永远解析到真实 git。改为直接调用钩子脚本本体（实测对照：经 commit 触发 shim 0 行 / 直接调用捕到 argv 可见的调用），并新增 **probe-alive 命中数下界正控**（`≥6`），使「探针失明」与「成本恒定」在输出上可区分
- [x] 2.4 在未改动的钩子上实跑并见证红（打的是 `/tmp` 冻结快照，避免与绿阶段互相污染）：`N=2 用 8 次、N=200 用 404 次（差 396）` ⇒ FAIL 规模失控；`含 .ccg/reviews 的调用 400 个` ⇒ FAIL 预算超标；`still-effective` 仍 PASS（2/200）⇒ 它确实在干活，只是付 404 次
- [x] 2.5 既有 15 个场景全绿（防回归对照）：全量 `PASS=38 FAIL=0`

## 3. 绿：钩子改常数次批量扫描

- [x] 3.1 候选集由 git 视图派生：`ls-files --others --exclude-standard -z` ∪ `diff --name-only -z`；pathspec 加引号交 git 侧匹配；两集按定义互斥故不去重
- [x] 3.2 一次 `git add --pathspec-from-file=- --pathspec-file-nul`（走 stdin 绕 Windows ~32k 命令行上限，并兼容含空格/中文文件名）
- [x] 3.3 批量失败 ⇒ 回退逐条 `|| true` **并出声**；回退分支由 scenario18 的注入型 shim 真实触发（`per-file add 次数=3`，非死代码）
- [x] 3.4 严格保持四段既有行为一行不动：分支守卫 / 版本同步 / 质量节拍 wrapper / CCG 门禁 —— splice 前对这三段各写一条 in-place 断言，11 条 ack 全 OK
- [x] 3.5 #3396 的原始动因注释**逐字保留**，新约束追加其后（不留误导叙述，也不丢掉「当初为什么这么写」）
- [x] 3.6 实测结果：同一把锁在 N=200 时 **404 次 → 7 次**（58 倍），且 `7 == 7` 与 `N=2` 完全相等

## 4. 反证与全量

- [x] 4.1 变异 M1：把候选集改成「无差别 stage 全部已跟踪 json + 硬塞 keep.md」⇒ scenario17 三条指名变红（暂存集合不符 / 未跟踪记录有遗漏 / 非 .json 越界）。**并且它逃过规模锁**（`expected-blind-but-caught=0`）⇒ 证明成本锁与范围锁互不替代，范围锁不是冗余
- [x] 4.2 变异 M2：整份退回旧实现（取 `HEAD` blob）⇒ 规模失控 + 预算超标两条指名变红，`probe-alive`/`still-effective` 照旧绿（红集精确到名）
- [x] 4.3 变异 M3：把 `-z`/NUL 退回换行分隔 ⇒ 「含空格/中文的记录未入库」+「暂存集合不符」变红（git 默认把非 ASCII 路径引用成 `"...\345..."`，add 必然失配）
- [x] 4.4 变异 M4：批量失败既不回退也不告警（then 分支换成 no-op 保持语法合法）⇒ `fallback-walked` / `fallback-spoken` / `fallback-effective` 三条变红，`injection-hit` 照旧绿 ⇒ 红的是被测语义而非夹具
- [x] 4.5 变异 M5：**对判据本体做变异**（让 scenario16 的 shim 不再记日志）⇒ `probe-alive` 变红（`0 / 0 < 6`）。只证「业务改动变红」不能证明锁在跑，故必须测锁自己
- [x] 4.6 汇总：5 条变异 `TOTAL_ESCAPED=0`；全量 `bash scripts/hooks/pre-commit.test.sh` = **PASS=38 FAIL=0**
- [x] 4.7 **自我更正记录**：scenario17 原有一条「重加了已跟踪且无改动的记录 ⇒ 变红」的断言被 M1 揭穿为**装饰性**——对干净文件 `git add` 是 no-op，暂存集里永不会出现它，该性质在提交内容上不可观察。已替换为可观察的「未跟踪记录必须一条不少」，并在注释里写明为什么不能保留原写法
- [x] 4.8 变异 M7（第三轮 i1）：把 `:(glob)` 摘成裸 pathspec ⇒ **只有** `scenario17 把子目录里的 json 纳入候选` 指名变红，证明嵌套锁承重
- [x] 4.9 变异 M8（第三轮 i2）：把回退循环的输入从「git 视图候选」换成「盘上 glob 全集」⇒ 只有 `scenario20 回退成本不按候选数走` 变红，而 `scenario16 规模失控` 照绿（批量未失败时回退根本不跑）⇒ 证明 scenario20 不是 scenario16 的冗余
- [x] 4.10 最终态读数（单笔提交、rebase 到新 origin/main 之后重跑）：全量 **PASS=47 FAIL=0**；8 条变异 **TOTAL_BAD=0**；结构判据自测 **14/14**；`git --version` = 2.55.0.windows.3

## 5. CI 常驻结构锁

- [x] 5.1 `scripts/check-precommit-spawn-budget.test.js` 10 条：合规正控 / 逐文件形态三形态**各自**指名 / 「禁词只在注释里 ⇒ 不得变红」负控 / 空正文判不通过 / 文件不可读判 `selfFault` / 例外清单为**注入参数**且缺省为空 / 预算棘轮可注入调整 / CRLF 与 LF 判定一致 / 真仓正文通过并带 `codeChars > 3000` 规模下界 / CLI 三档退出码 0·1·2 互不混档。实测 **10/10 通过**
- [x] 5.2 `scripts/check-precommit-spawn-budget.js`：只 require `fs`/`path`；判据先剥行注释；required 带命中下界（读不出正文即 `SOURCE_TOO_SMALL_OR_EMPTY`，不把「零命中」读成合规）；缺省 allowlist 为空且只能缩小。实测真仓 `OK`，`gitAddCalls=3`
- [x] 5.3 接进 `.github/workflows/quality-gate.yml` 的 **`changes`** 作业（Gate 2b3，`shell: bash`）。落点理由已写进步骤注释：`static-gates` 带 `if: docs-only != 'true'`，守门判据不得落在会被自己防的形态短路的 job 里
- [x] 5.4 `.gitignore` negation：实测 `git check-ignore -v` 先命中 `.gitignore:106:scripts/*.js` ⇒ 补 `!scripts/check-precommit-spawn-budget.js`；**测试文件不单独加**——第 204 行 `!scripts/*.test.js` 已通用兜住（先例注释同口径），加了就是冗余配置。复核两条回显均为 `!` 反选 ⇒ 已放行；`git add` 成功且 `staged_budget_files=2`
- [x] 5.5 `node .github/scripts/check-workflow-structure.js` → `files=14 violations=0`（改 workflow 正文后必跑，YAML 能被解析 ≠ GitHub 能编译）；`check-unwired-tests.js` → `检查域内测试文件 89 个 OK`；`check-step-failfast.js` → `含 ≥2 条受管命令的 run 步骤 36 个 OK`
- [x] 5.6 **自我更正记录**：首轮 splice 用 `latin1` 读写 UTF-8，把 workflow 全文中文写坏 ⇒ `YAML_PARSE_FAIL: non-printable characters`。行尾两口径对账**抓不出这种破坏**（两者一致），是「插入 13 行却出现 705 增/692 删」的规模上界把它暴露的。已按 R2 精确单文件 `git restore --source=HEAD` 还原，并把「剔除插入块后必须与原文逐字相等」写成 splice 的前置断言重做
- [x] 5.7 第三轮 i3 后：自测由 10 条增至 **14 条**（新增 `:(glob)` 缺席指名红 / 终点锚被搬走判 SELF_FAULT 且 CLI 退 2 / 段外新增 add 不红但全文 metrics 仍可观测 / 段内新增 add 必红）。实测真仓 `OK`，读数改为 `gitAddCalls=2`、`gitAddCallsWholeFile=3`、`sectionLines=29`

## 6. 机器级未闭合项（只交付文档，不改任何第三方设置）

- [x] 6.0 **复测更正**：初稿把「~1 秒/进程」当机器级前提；排空后同法复测 53 ms（差 22 倍），在场组件由「疑似元凶」降级为「候选放大器」，并把「回归锁只数调用条数、不数墙钟」写成显式理由
- [x] 6.1 `01-docs/INVESTIGATE-PROCESS-SPAWN-COST-2026-10-15.md`：实测读数表（拥堵现场 `cmd.exe /c exit` 1,175 ms / `git --version` 699 ms / 空临时仓库 `rev-parse` 705 ms / 本仓 774 ms / git.exe 创建速率 18.2 个每秒）、三条已否证误判、在场但未做对照实验的组件（管家实时防护 / Everything 累计 36.4 CPU·小时 / 极空间同步 / `ipf_helper` 归属未明），以及「改前改后各测 10 次同法 A/B」的自证口径
- [x] 6.2 文中明写未闭合边界：本 PR 只解除「提交耗时随记录数增长」的耦合，~1 秒/进程属机器级前提；并给出下次全体变慢时的归因分流步骤（先复跑 `cmd.exe` 均值，再决定往机器还是仓库找）
- [x] 6.3 测量污染如实登记（含本会话自己造的）：首版诊断脚本递归扫 38 个 worktree 的 `node_modules`，单进程涨到 7,957 MB，使「内存 98.5% / 剩 480 MB」成为**探针自造**的读数；杀掉自己的探针后真值 74.2% / 8.4 GB。另记 `MSYS_NO_PATHCONV` 令 `git -C /d/...` 找不到目录、`ls-tree` 的 glob pathspec 造出 `on_main_json_only=0` 假读数（正解先全量列名再 grep）、以及「杀手脚本命令行含匹配串 ⇒ 把自己杀掉」的自指形态

## 6.5 QM-6 评审处置轮（评审真找到东西，也真找错了东西）

- [x] 6.5.1 **i1（唯一 Critical）驳回并留证据**：主张「行为锁未接 CI」不成立 —— `quality-gate.yml:480` 已跑 `bash scripts/hooks/pre-commit.test.sh`，该 job 在 `gate-result` 的 `needs` 内；且 `scripts/**` 不在 `CI_IGNORED_PATHS`，改钩子的 PR 不可能是 docs-only。另核 `check-unwired-tests.js` 第 20 行确已把 `.test.sh` 纳入扫描域
- [x] 6.5.2 **i5 修复**：两次扫描去 `2>/dev/null` 抑制 + 显式检查退出码 + 点名告警 + 扫描不可信时**不发起**批量 add（半截清单会静默漏暂存）
- [x] 6.5.3 **i4 修复**：probe-alive 由写死 `>= 6` 改为**按内容**断言（看见 `rev-parse --git-dir`）；并把「形态判据」与「存活判据」拆开——混用的实测后果是旧实现先在存活判据上红并 `return`，导致主判据「规模失控」根本没被评估，M2 的指名红集被自己截断
- [x] 6.5.4 **i2 修复**：回退告警带出 `git --version` 现场 + scenario16 新增 `batch-path-taken`（批量路径必须真被走到，防静默退化成逐条）
- [x] 6.5.5 **i3 不狡辩**：在 `scripts/check-precommit-spawn-budget.js` 头部明写它是**补充绊线**（只认三种历史形态），主判据是形态无关的 scenario16
- [x] 6.5.6 **自曝一处裸奔修复**：i5 修完重跑变异电池，「把扫描失败重新吞掉」的 M6 **PASS=6 FAIL=0** —— 所有锁无反应，即修复无回归保护，违反本 PR 自身论点。新增 `scenario19` 承载该契约，并把 M6 重指向它：实测**只被 scenario19 抓到**，成本锁与存活锁全盲 ⇒ 该锁承重而非冗余
- [x] 6.5.7 终局读数：全量 **PASS=43 FAIL=0**；6 条变异 **TOTAL_BAD=0**；结构判据自测 10/10；`git --version` = 2.55.0.windows.3
- [x] 6.5.9 **第二轮 DUAL 评审 + 自扮演裁决**（引擎复用存档 critique、跳过模型调用）：两条争议逐条取证裁决 —— **i1 upheld**（一侧扫描失败连带弃掉另一侧健康清单，且与批量失败的逐条回退不对称、不报放弃条数）⇒ 已修为**每侧独立判定 + 报 `count=`**，契约由 scenario19 两条新断言锁定（`no-partial-list-staged` / `healthy-side-independent`）；**i2 dismissed**（其关键事实"无任何测试锁定该语义"不成立 —— scenario15 正是绊线：`.ccg` 若被 gitignore 则未跟踪记录取不到、该场景当场红），成立的部分（耦合未写明）已补注释指向 scenario15
- [x] 6.5.10 裁决连带修掉一处**自相矛盾的旧断言**：scenario19 原 `no-add-on-broken-scan`（扫描失败就不发起 add）恰好把 i1 批评的"一侧失败弃两侧"固化成契约，已替换为"失败侧清单不得入库"，避免留下两条互相打架的判据
- [x] 6.5.11 **第三轮 DUAL 评审真跑**（`sh scripts/deep-review.sh`，HEAD=20d44310，diff 基线 origin/main 1313 行，critic=claude 出 7 条 → 3 条争议进入自扮演裁决；跨家族 proposer=opencode 通过）：i1 upheld（`:(glob)`）、i3 upheld（预算段作用域）、i2 **dismissed 并附读数**（回退成本随候选数走：树上 200 条时 1→1 / 2→2，非随树上记录数走）
- [x] 6.5.12 i1 的实现与两把锁（行为锁 scenario17 nested + 结构绊线 GLOB_SCOPED_PATHSPEC）；i3 的实现与三把锁（段外不红 / 段内必红 / 锚点缺失 SELF_FAULT）；两条 upheld 各自配变异 M7/M8 反证，均已实跑
- [x] 6.5.13 自曝一处**规格与实现漂移**（评审未点名、本轮读规格时发现）：spec 的扫描失败那一维还写着「任一失败即 MUST NOT 发起批量暂存」，而第二轮 i1 已把实现改为「按侧独立、健康侧照常暂存」。规格是后来者的真相来源，写着旧契约的规格比没有规格更坏 ⇒ 已就地改写该行并保留其它两句
- [x] 6.5.14 **闭环机制缺口的实测结论**（本条取代 6.5.8 的「待人工裁决」）：`check-pr-exec-record.js` 的 `evaluateDeepReviewDebt` 读的是**工作树文件**（`fs.readFileSync(path.join(repo, rel))`），而 decider 每次提交都无条件重写记录、不含保留逻辑 ⇒ 单提交分支上「已提交的记录内容」必然是 `pending`（父 sha 恒为 origin/main 顶，amend 也落在同一个文件名上）。origin/main 实测指纹：dual 记录 233 篇，其中 `pending` 217、`self_play_resolved` 2、`needs_revision` 2、`cleared` 1 ⇒ 闭环只可能发生在 ≥2 提交的分支上（第二条提交的 hook 重写的是「上一条 sha」那份文件，第一条那份得以保留裁决值并被自动暂存段带进提交）。CI 侧以 `--mode=advisory` 调用（`quality-gate.yml:145`），因此**不会**因提交内是 pending 而变红；本地自动合并判据用 `--mode=enforce`，读工作树 ⇒ 引擎裁决即生效。缺口如实登记，不改判据（改「谁来守门」属人工过目范围）
- [x] 6.5.8 **人工裁决已下达（用户选项 D7）**：引擎对**修复前**的 critique 复用后判 `self_play_blocked`（upheld 的 Warning 即阻断），而 `self_play_blocked` 不在闭环白名单 `{cleared, needs_revision, self_play_resolved}` 内 ⇒ `check-pr-exec-record --mode=enforce` 不过 ⇒ 自动合并判据第 4、5 条均不满足。i1 的实质修复已提交并验证，但"对修复后状态重评"需要新的模型轮次与新判定记录，而新提交体量小会被判 SINGLE、债务仍挂在 dual 那篇上 —— 这是寻址机制的缺口，交人工裁定处置方式
      裁决内容：把分支压成单笔（本仓 squash 惯例）并丢弃两篇描述已不存在提交的孤儿记录，然后**对最终态重跑 DUAL 评审**，由引擎自己算 status——既不手写引擎产物，也不为了让 enforce 变绿而删除孤儿记录。原判据里「新提交体量小会被判 SINGLE、债务仍挂在 dual 那篇」的担忧已被实测否证：单笔 646 行 > 200 阈值 ⇒ 仍判 DUAL，且 deep-review 按父 sha 寻址命中新记录。剩余缺口见 6.5.14。

## 7. 收尾链

- [ ] 7.1 QM-6 CCG 双模型并行外部评审（模型名读 `~/.claude/.ccg/config.toml` 的 `[routing]`）；Critical 必修
- [ ] 7.2 `openspec/records/fix-precommit-reviews-spawn-storm.md` 执行记录：`| 远程同步 |` 表格行与 bullet 两形态同写；自增类读数（`.ccg/reviews` 计数）按构成描述并标测量日期，不写死总数
- [ ] 7.3 CHANGELOG 一条变更一个标题块；`classify-docs-only.js` 判定（commit 之后取证）应为 `docs-only=false` 混合 PR ⇒ 完整门禁
- [ ] 7.4 开 PR → CI 全绿按判据自动 squash 合并（只认产物四条）→ 回填 PR 一次提交内改 PASS + merge SHA 并删 ledger 登记项与 `sync_*` 字段
- [ ] 7.5 worktree 按 R1–R5 清理：`safe-worktree-remove.ps1 -WhatIf` 干跑通过后再实跑
