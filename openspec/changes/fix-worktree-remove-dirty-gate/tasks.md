# Tasks: fix-worktree-remove-dirty-gate

> 顺序即依赖：1（文档）→ 2（RED）→ 3（GREEN）→ 4（接线脚本）→ 5（本地全门禁）→ 6（跨仓，另单）。
> 混合 PR：`scripts/` 工具脚本自身变更，**禁止**走 docs-only 快速通道。

- [x] 1. OpenSpec change 四件套（先文档再代码）
  - [x] 1.1 `openspec/changes/fix-worktree-remove-dirty-gate/proposal.md`：Why 带三处错位的取证链 + 旧副本第 4 条；Non-goals 写明"为什么不能把 ignored 并入既有计数"
  - [x] 1.2 `design.md`：5 条决策，含**被自己实现期否证的方案与否决理由**（决策 4 的证据豁免改为本刀只做可见性；决策 1 的 `measured-fs` 语义由测试表反推改正）
  - [x] 1.3 `tasks.md`（本文件）
  - [x] 1.4 `specs/worktree-removal-safety/spec.md`：ADDED 4 条 Requirement（内容可判定性 / 分级门禁与 ignored 可见性 / 漂移分级 / 证据可见性）
  - [x] 1.5 `openspec validate fix-worktree-remove-dirty-gate --strict` → `Change 'fix-worktree-remove-dirty-gate' is valid`（实跑 rc=0）

- [x] 2. 回归锁先写红（TDD RED）
  - [x] 2.1 `scripts/worktree-fs-longpath.test.ps1` 追加第 12/13/14 节（既有 1–11 节逐字不动），锚点按唯一内容定位、逐行 `\r\n`、**先验后写**；第 3 轮评审后又扩第 15（真 git 夹具）与第 16（先后顺序锁）节，Check2 断言数由 12 → **25**，总 PASS 由 41 → **54**
  - [x] 2.2 三条负控在位：① `Registered=$false` + git 读不到 ⇒ `Basis='measured-fs'` 且 `GitMeasured=$false`（不得塌成空数组）；② porcelain 全空但文件系统计数 > 0 ⇒ 不得判干净；③ git 与枚举双失败 ⇒ `unproven`，且 `-Confirmed=$true` 仍返回 `unproven`
  - [x] 2.3 第 14 节漂移真值表 10 行：仅 `M`/`A`/`??`/`R` ⇒ `benign_drift`；` D`/`D ` 混入 / `DU` / `UD` ⇒ `cascade`
  - [x] 2.4 **RED 实跑取证**（`/d/Temp/mulpub-cleanup/red4.out`）：rc=1，`FAIL all three new predicates exist ... missing: Resolve-WorktreeContent, Resolve-ContentDisposition, Resolve-DriftDisposition`、`FAIL sections 12-14 aborted`、`FAIL ... executed every one of their 12 assertions ran=1` ⇒ **指名红**，非 LOADFAIL
  - [x] 2.5 反失明自证（本轮由两次真实假绿逼出）：第一版表插入后 rc=**0** 且 `WORKTREE_FS_LONGPATH_TEST_OK`、28 条 PASS 全来自 1–11 节 —— harness 只在 `Check` 里计失败，**异常中断的整节会静默消失**。故新增前置存在性断言 + 节内 try/catch 计入 failures + **断言执行条数 == 12**；无此三重防护则本锁为装饰
  - [x] 2.6 真 git 行为夹具（**ignored 档已闭环**，测试第 15 节）：`%TEMP%` 内 `git init` + `.gitignore` 造 unborn 仓库，实测三件事——`-uall` 档确实**不列** ignored（盲区正半）、`--ignored` 折叠档确实列（反半）、被忽略目录只出 **一条** `!! ignored/`（成本论证的现场）。**偏差**：夹具用 `git init` 而非 `git clone`，因为本片断言的是"git 对 ignored 的可见性"、不依赖索引/EOL 形态；一旦要断言"恢复后 status 干净度"就必须按本仓纪律换成 `clone` + 夹具自声明 `.gitattributes`
  - [ ] 2.7 守卫**端到端**行为夹具（注册 worktree 的 `exit 10` 路径 + WhatIf 与实跑同源比对）—— 本刀只落了第 16 节的**顺序锁**（只数语句行、不数注释），完整的"真建一个半失效 worktree 再删"仍未做，转 6.8

- [x] 3. 实现判据（TDD GREEN）
  - [x] 3.1 `Get-WorktreeContent`（`scripts/worktree-fs-longpath.ps1` EOF 追加）：porcelain 按 XY 分三档 + 三态 `Basis` + `GitMeasured` 标志
  - [x] 3.2 `Resolve-ContentDisposition`：纯门禁矩阵 `ok|confirm_required|unproven`；`Resolve-DriftDisposition`：`clean|benign_drift|cascade`
  - [x] 3.3 双解释器实跑全绿：`pwsh 7` 与 `Windows PowerShell 5.1` 各 **54 PASS / 0 FAIL / rc=0**（`Capable=True` / `Capable=False` 两条支路各自留痕，符合本仓"每次跑都打印走了哪条支路"）。数字随 4A/4B 的改正演进：初版 41 → 补 ignored 探针 45 → 补真 git 夹具 51 → 补先后锁 **54**
  - [x] 3.4 **变异反证三条各自指名红**（还原后重跑全绿、库与测试 md5 与变异前逐字节相同）：M-A `$ignoredKnown` 硬置 `$true` ⇒ 2 红（两条"unknown"断言）；M-B `$probeAnswered` 恒 `$false` ⇒ 3 红（含真 git 那条 `ignored=0`）；M-C 在 `exit 10` **之前**插一条 `Stop-Process`（放在 `if ($false)` 里，绝不执行）⇒ 2 红（顺序锁，detail 打印 `exit10=346 firstKill=344`）

- [x] 4. 接线到守卫脚本（`scripts/safe-worktree-remove.ps1`）
  - [x] 4.1 脏判据拆成**两次 git 调用**：门禁取 `--porcelain --untracked-files=all`（240–580ms，精确到文件），可见性取 `--porcelain --ignored`（折叠档，10–80 条）；未注册/非零退出 → 文件系统**顶层**条目计数，**禁止回落空数组**。（原实现把两者合成一次 `-uall --ignored`，实测任务 worktree 55,191 行 / 共享根 127,654 行，每次删除都付这笔递归——这是 4C 之前由轮3 i3 逼出来的改正）
  - [x] 4.2 门禁由 `$disposition` 驱动：`confirm_required` ⇒ exit 4；`unproven` ⇒ **exit 10**
  - [x] 4.3 ~~新增 `-IgnoredByteBudget`（默认 10MB）~~ —— **已被决策层评审否证并整体删除**（含参数、含测量代码）。否证理由与本刀的纠正方向见 `design.md` 决策 3：体积门槛在每一个含 `node_modules` 的 worktree 上恒触发 ⇒ 训练使用者习惯性加 `-Force`，等于把要保护的确认变成噪声；ignored 只升**可见性**不升**门槛**
  - [x] 4.4 打印面拆为 `content : trackedDirty/untracked/ignored/basis=` + 非 git 口径时补一行"topLevelEntries 是文件系统计数而非 git 测量" + ignored>0 时 `CONTENT NOTICE`（措辞明写 reported, not blocked）；**位于 WhatIf 分支之前**，故预演与实跑同源
  - [x] 4.5 R7 接 `Resolve-DriftDisposition`：`cascade` 保持 exit 3 与原文恢复提示；`benign_drift` ⇒ 打印 `R7 BENIGN-DRIFT` 并全量列出，不改退出码
  - [x] 4.6 docblock 补**完整退出码契约 0–10**（6/7/8/9 此前也无说明书）
  - [ ] 4.7 `-PreserveEvidenceGlob` 镜像豁免 —— **本刀不做**（决策 4 已记否决理由），转 6.5
  - [x] 4.8 三文件 PSParser 语法 0 错误；`git diff --numstat` 与 `--ignore-cr-at-eol --numstat` 两口径一致（53/7 与 53/7）⇒ 未改写行尾
  - [x] 4.9 **行为证明**（合成目录 `D:\Temp\mp-synthetic-dirty`，未注册 + 2 项）：
    - `-WhatIf` ⇒ 打印 `content : trackedDirty=0 untracked=0 ignored=0 basis=measured-fs` + `topLevelEntries=2 is a filesystem count, not a git measurement`（旧版此处只打 `worktree dirty : 0`）
    - 无确认实跑 ⇒ **GUARD_RC=4** 且目录 2 项原封不动、无任何删除
    - 带 `-ConfirmDirtyDiscarded` ⇒ **RC=0** 且目录被删除

- [x] 4A. 决策层评审（plan-review）一轮：否证并改正
  - [x] 4A.1 评审对象 `proposal.md` 被当场判出 1 条 **CRITICAL**：ignored 字节预算会在每次正常删除上触发 → 与本提案 Non-goals 自相矛盾。**采纳，但拒绝其给出的修法**（"把预算调大/默认关闭"）——那是调参数；本刀换轴为「体积不可判该不该保护，路径语义才可以」，参数与测量代码一并删除
  - [x] 4A.2 同轮自曝：改正过程中发现代码里 `$ignoredBytes` 恒为常量 `0`、从未被赋值测量 ⇒ 所谓预算门禁**本来就不会触发**，是装饰性门禁。若只做 4A.1 的"放宽阈值"，这条会永久隐身
  - [x] 4A.3 评审其余意见的逐条处置记在 `design.md` 的 findings 处置表（采纳 / 取证后拒绝 / 转入跟进项），不在此复述
  - [x] 4A.4 改正后**重跑回归锁**：`pwsh 7` 与 `Windows PowerShell 5.1` 两档各 **41 PASS / 0 FAIL / rc=0**（含第 13 节新增那一行「大体积 ignored 且 dirty=0 ⇒ `ok`，不得 exit 4」的负控），两口径 numstat 一致
  - [x] 4A.5 规格与记录同步改写：`spec.md` Requirement 2/3（可见性而非门槛 + 收窄拦截面的两个边界 + 混合漂移取最坏符号）、`proposal.md`（瘦身为可评审对象，取证链移入 `design.md`）、`.quality-gates.md` 与 `CHANGELOG.md`（不得留着已删参数的描述）


- [x] 4B. 对抗循环自动跑（`scripts/plan-review.sh`，proposer=opencode / critic=claude）
  - [x] 4B.1 轮1 6 条（Critical 2）→ 轮2 6 条（Critical 1）→ 轮3 4 条（Critical 1）→ `maxRounds` 用尽、裁决 **blocked**；产物配对落盘 `.adversarial/ccg-plan-proposal-claude/`（proposal/critique/revision v1–v3）
  - [x] 4B.2 第 3 轮 4 条逐条处置见 `design.md`：i1 采纳（Non-goals 措辞自相矛盾）、i2 采纳（新增先后 Requirement + 两条顺序锁）、**i3 采纳且实测后比评审说得更重**、i4 采纳（新增 `IgnoredKnown`，禁止把"没测"印成 0）
  - [x] 4B.3 i3 的实测数据（不得凭印象）：`--untracked-files=all --ignored` 在任务 worktree **55,191 行**、共享根 **127,654 行**；折叠档分别 **10 / 80 条**。原实现每次都付这笔递归
  - [x] 4B.4 **工具缺陷留痕**：`plan-review.sh` 文档承诺"1=有阻断"，实测打印 `blocked` 那一趟 **rc=0** ⇒ 按 rc 判定的自动化会把阻断读成放行。本刀一律按产物判，缺陷转 6.7

- [x] 4C. 对抗循环**第二次完整运行**（改正 4A/4B 后重跑）：轮1 7 条（Critical 1）→ 轮2 6 条（**Critical 0**）→ `converged`、裁决 **cleared**
  - [x] 4C.1 i4 是本轮唯一落在代码上的真缺口：**未测得的档位此前仍印 `trackedDirty=0`**——同一个构造性零换了件衣服。处置是把打印面从脚本正文**提成纯函数** `Format-ContentSummary`（第 16 节 3 行真值表 + 变异 M-D 指名红 2 条），因为"写在脚本正文里的字符串没法被测"
  - [x] 4C.2 i1/i3/i5 **取证后判为不成立、但采纳其文档诉求**：单 `D` 本就计入级联（判据含 `" D|D |DU|UD|.D"`）；`measured-fs` 的回退是**浅层顶层计数、且只在 git 答不上时**跑（评审把它当成了全树遍历）；`measured-fs` 并非惰性态（它是 `exit 4` 的主要触发者之一）。三条结论已写进规格，不留"只躺在 design.md 里"的精度描述
  - [x] 4C.3 i2 部分采纳：`unproven` 的出路写成"修好测量再跑"（句柄/长路径既有收口法），**拒绝**新增"绕过不可判定"的参数——那等于把人自愿闭眼写成合同
  - [x] 4C.4 i6：说明书真源改为**仓内守卫 docblock**（随 PR 落地），SKILL.md 属跨仓、按 6.3 单独交付并附两份副本实跑证据
  - [x] 4C.5 变异 M-D 还原时 `old_string` 连带吞掉函数闭合 `}`（结构破损），由 `PSParser` 计数当场暴露 ⇒ "还原后必须重新解析 + 重跑"不是形式主义；还原后两档各 **57 PASS / 0 FAIL / rc=0**

- [x] 4D. 验证层 QM-6 双模型（直接起 `codeagent-wrapper`，非 `deep-review.sh` —— 该入口本机不可用，见 6.10）
  - [x] 4D.1 前端轴 opencode 9 条、后端轴 claude 9 条，合计 **0 Critical / 3 Medium**；逐条处置表在 `design.md`「验证层」
  - [x] 4D.2 落在代码上的真缺口 **F2**：`measured-fs` 的 BLOCKED 行只印三个 `n/a`，**真正触发门禁的那个数不在句子里** ⇒ `Format-ContentSummary` 带上 `topLevelEntries=N (top-level entries, includes directories)`；变异 M-E 摘掉即 1 条指名红
  - [x] 4D.3 命名与精度改正 **F1/F3**：`Resolve-WorktreeContent` → `Get-WorktreeContent`（库里对象返回的先例是 `Get-*`，`Resolve-*` 一律返回裁决串）；`FilesInTree` → `TopLevelEntries`（计数含目录，名字不得高估）。传播到守卫、测试、proposal/CHANGELOG/.quality-gates 与 design 的**非引用**位置；`tasks 2.4` 那条 RED 日志原文引用**保留旧名不改写**
  - [x] 4D.4 两个模型独立命中同一处（F5 / B4：`Total`、`GitMeasured` 无人消费）⇒ 不再一律辩护：`Total` **删**（它确实不承载判据语义，只被一条断言读），`GitMeasured` **留**（它是"未注册不得塌成空测量"的断言对象）。这条是对我上一轮判断的更正
  - [x] 4D.5 **B2 取证后降级但照修**：评审担心"深链接被当成安全"，实测失败方向相反（`$null` 已归入 `escaping` 并 exit 2 ⇒ 误拦而非放行）；仍加 `\\?\` 重试，使"很深"不再被读成"很危险"
  - [x] 4D.6 **B5 死 I/O 接线**：`$baselineFile` 此前只写不读（13 处 `Remove-Item`、0 处读）⇒ R7 改从该文件读回并打印 `baseline source : disk|memory`，长度不一致则告警用内存；"半接线"是评审给的正确批评形态
  - [x] 4D.7 **B9 级联文案与打印面对齐**：新增库里唯一实现 `Test-DriftCascadeSymbol`，`Resolve-DriftDisposition` 与 R7 的打印过滤共用它，文案改为"检测到级联符号，以下为删除形态行"
  - [x] 4D.8 **B3 拒绝删除、采纳写明**：`-or $ignored -gt 0` 不是死路径——函数接受"拆开的"与"合并的一次 `-uall --ignored`"两种喂法，删掉会让合并喂法把已测得判成未测；不变量已写进注释
  - [x] 4D.9 **B8 不闭合，如实上报**：R6 主删除策略 `[IO.Directory]::Delete(...,$true)` 无 `/XJ` 等价物，安全性靠"lateScan 刚解过链"的**时序**而非原语保证。换原语属另一个安全命题，值得自己的 change 与自己的评审 ⇒ 转 tasks 6.11，本刀不夹带
  - [x] 4D.10 收尾验证：两档解释器各 **59 PASS / 0 FAIL / rc=0**（Check2 **30** 条）、`PSParser` 三文件 0 错、五条变异各自指名红、`-WhatIf` 真机现场打印新文案、两份 skill 副本重发并各实跑 59 PASS

- [ ] 5. 交付与门禁
  - [x] 5.1 `git status --porcelain` 改动面恰好 3 个 `scripts/*.ps1` + 新 change 目录（无越界改动）
  - [x] 5.2 `.quality-gates.md` 记录（`远程同步` bullet + 表格行两形态同写）+ `scripts/gate-record-debt-ledger.json` 登记 —— 已在 `12551e772` 落；4A.5 的同步改写并入本刀第二个提交
  - [x] 5.3 CHANGELOG 独立标题块 + `node scripts/check-changelog-growth.js` 本机自证
  - [ ] 5.4 `check-unwired-tests.js` / `check-step-failfast.js` / `check-pr-exec-record.js --mode=enforce` 全过
  - [ ] 5.5 QM-6 双模型外部评审（M+ 强制，改的是守门脚本）
  - [ ] 5.6 开 PR → 判据齐备则自动 squash 合并 → 回填与销账同一次提交
  - [ ] 5.7 worktree 按 R1–R5 用**本 PR 改后的守卫**清理（自食其果式验收）

- [x] 6. 跨仓跟进（skill 侧，用户当场问的那条"要不要回流"——结论：要，但只写 pitfalls **不够**）
  - [x] 6.1 **两份物理副本都补齐** `worktree-fs-longpath.ps1` + 其测试，并把打过补丁的 `safe-worktree-remove.ps1` 一起发（守卫与库是**成对**的，只发一份等于发一个缺依赖的可执行文件，使用者必撞 `exit 8`）。旧副本先备份到 `~/mulpub-skill-backup-<ts>/`（加载源是 git 仓库可回滚，`.codebuddy` 那份**不是**仓库，不备份即不可逆），发后逐文件 `cmp` 自证（`SHIP_OK`，rc=0）
  - [x] 6.2 SKILL.md 把"默认用内置副本 / 哈希不一致就用 skill 那份"换成**三条能力自证**（同伴文件在场 → 回归锁真跑 → `-WhatIf` 探针看 `links found (full depth)` / `entries enumerated` / `content : … basis=`）。原指引的方向是**反的**：照它选"内置副本"会每次都选到跑不起来的那份；同时记下"含中文的用户名路径喂 `git hash-object` 产生过假哈希并被写进结论"这条取证陷阱
  - [x] 6.3 SKILL.md 退出码表补全 **0–10**（含 6/7/8/9 此前无说明书），每码给"正确处置"而不是只给含义——`exit 8` 明确写"不是环境不支持"、`exit 10` 明确写"确认不能替代测量"
  - [x] 6.4 `references/pitfalls.md` **加载源**追加 §二十二：`dirty:0` 的三口径盲区表 + 判据改正三条 + 同场两条反向成因（`exit 5` 的两种成因、`exit 3` 在高频并发共享根近乎常态）+ 可复用手法（"这个数字在什么输入下会塌成 0 / 它把几种风险压成一个数 / 签字的人看得见吗"）。§二十一 同步补第 6 条：**文档沉淀只写加载源，脚本沉淀必须两份一起发**
  - [ ] 6.5 `-PreserveEvidenceGlob` 镜像豁免（须自带深路径复制回归夹具）；判据届时按**路径语义**而非体积收口
  - [x] 6.6 真 git 行为夹具 —— 已随 2.6 落在测试第 15 节
  - [ ] 6.7 `plan-review.sh` 的 rc 与裁决错配（打印 `blocked` 却 rc=0）：应把"仍有未回应 Critical"写进退出码或写进 ack 文件由人/CI 判。**属改「谁来守门」，报人不自治**
  - [ ] 6.8 守卫端到端夹具（真建一个"注册丢失 + 目录非空"的 worktree，验 `exit 10` 全程不产生 kill/删除）
  - [ ] 6.9 skill-repo 的**提交与推送**未做（该仓库另有他会话留下的 6 个脏文件与 1 个未跟踪目录，且 `origin` 是共享 GitHub 仓库）：本次只落盘，是否 commit/push 交用户决定
  - [ ] 6.10 `scripts/deep-review.sh` 的两处失效：① `--force` **不真 force**（wrapper 只传 `--sha`，引擎用 `decision.mode` 覆盖一切 ⇒ 记录写 `skip` 就恒退 0）；② 判定记录存在 off-by-one（记录名 = 提交时的 HEAD，而查询用当前 HEAD），且"按 diff 内容寻址"的回退链实测命不中（`git diff sha^ sha` 的哈希 ≠ 记录里的 `stagedDiffHash`）。本刀按 AGENTS.md QM-6 的原始命令形态直接起两路后端完成。**属改「谁来守门」，报人不自治**
  - [ ] 6.11 **R6 删除策略的安全性是时序而非原语**（后端轴 B8，本刀如实上报未修）：主策略 `[IO.Directory]::Delete($lp,$true)` 没有 robocopy `/XJ` 那种"不穿透 reparse point"的原语保证，靠的是"lateScan 刚刚把看到的链接全解掉"这一步的顺序；链接若在该窗口内出现即无防护。正解需要自己的 change：删除前对新链接做 `Test-FsReparsePoint` 复探，存在任一 reparse point 就跳过该策略直接走 `/MIR /XJ`，并配夹具
