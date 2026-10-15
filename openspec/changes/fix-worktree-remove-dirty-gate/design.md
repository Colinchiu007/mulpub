# Design: fix-worktree-remove-dirty-gate

> 取证、决策与被否证方案。评审对象是 `proposal.md`，本文件不是评审输入（刻意分开：给人看的内容会挤爆 reviewer 提示——实测引擎自带框架约 4300 字符，proposal 3533 字符即触到 opencode 后端 7800 上限）。

## 事故取证（2026-10-14/15）

用 `git-cleanup-analysis` 技能清理本仓隔离区时造成一次半删除。三处系统性错位：

1. `git status --porcelain` 不列 ignored 文件 ⇒ `mp-podcast-episode-tts-entry` 报 `dirty:0`，实际根目录有 20.8MB `ci-failure-detailed.txt`、`SKILL.md`、`CI-*-REPORT-*.md`、`pr-body-*.md`。
2. `$dirty = @(if ($registered) { git -C $wt status --porcelain })` ⇒ 未注册时**恒为空数组**。而"注册已丢、目录还在"正是本次撞了 3 次的状态。
3. `tracked / untracked / ignored` 三档风险共用一个开关一个退出码。

第 4 条属技能打包：技能分发副本（321 行）**缺 `worktree-fs-longpath.ps1`**，因而已修好的 R5 判定与长路径 R6 都不在；仓库副本（463 行）才有。跨仓跟进见 tasks 6。

## 决策 1：`Basis` 三态

| 取值 | 含义 | 门禁 |
|---|---|---|
| `measured-git` | 已注册且 `git status` 成功 | 正常分级 |
| `measured-fs` | git 答不了，但目录枚举成功 | 条目数 > 0 ⇒ exit 4（打印数字后人签字）；已确认则放行 |
| `unproven` | 双双失败 | **exit 10，确认不得放行** |

不能合成布尔：调用方一定会把"没发现问题"读成"没问题"。本仓同族已四次（`gh pr checks` 空集、`dir /aL` 长路径失明、`Get-TestProcessTree` 默认列、本次）。

## 决策 2：纯函数进库、I/O 留脚本

与 `Resolve-RemoveDisposition` 同处，复用 `worktree-fs-longpath.test.ps1:171-174` 已验证的真值表形状（只喂原始值，不碰 git/FS）。该测试文件已在 CI Gate 2d 接线（`quality-gate.yml:575`），`check-unwired-tests.js` 本机 rc=0 亦证"全部已接线"。

## 决策 3：ignored 用可见性而非门槛（由决策层评审的 Critical 逼出）

初版设计是"ignored 字节超预算（默认 10MB）⇒ 要求确认"。评审（critic=claude）判为 **Critical** 且成立：`node_modules` 必被忽略、必然远超任何合理预算 ⇒ **每次移除都 exit 4**，而真正的豁免机制我又推迟了 ⇒ 交付即自我矛盾，且矛盾恰是 proposal 的 Non-goals 明写要避开的东西。

修正采取**换轴**而非调参数：体积不可判断该不该保护，路径语义才可以。故本刀 ignored 只打印（`CONTENT NOTICE`，含条数），阻塞条件收敛为"测不到"（`measured-fs` / `unproven`）；按路径豁免随 tasks 6.5 一起回来，那时才需要复制实现与深路径夹具。

**同时自曝一条**：代码里 `$ignoredBytes` 一直是常量 0、从未真的测字节 ⇒ 初版并没有变成"每次都拦"，而是以"**永不发火**"的方式躲开。那是装饰性门禁的另一种形态，比误伤更需要记。

## 决策 4：R7 只按符号分级，且承认这是收窄

初稿 Risk 写"不放宽任何既有拦截、exit 3 语义逐字不变"——评审（Warning）指出不成立：把 `M/A/??` 从 exit 3 改成放行**就是收窄**。已改为如实表述，并补一条采样的固有局限（决策 6）。

## 决策 5：退出码 10 与文档同步

10 只表达"内容不可判定"，与 5（残留删不掉）、9（被活进程持有）互斥。原 SKILL.md 连既有的 6/7/8/9 都没有说明书，本刀一并补。

## 决策 6：单次采样的局限（评审 Warning，接受但不假装解决）

`git status` 是瞬时采样：并发会话可能正处在"删了一半"的中间态，此刻采样恰无 `D` 不等于无级联。本刀接受的缓解是既有的 R7b（锚点必须仍在）+ 目标目录消失 + 注册解除三条同时成立才判误报；彻底解法需要跨采样的时间窗，超出本刀范围，留待跟进。

## 决策层评审处置（critic=claude，7 条：Critical 1 / Warning 3 / Info 3）

| # | 级别 | 主张 | 处置 |
|---|---|---|---|
| i1 | Critical | ignored 字节预算必触发于构建残留 ⇒ 每次 exit 4，自相矛盾 | **采纳，换轴**：删预算与参数，ignored 只出声（见决策 3、5） |
| i2 | Warning | 称"不放宽"与 M/A/?? 改放行矛盾 | **采纳**：Risk 改为如实写收窄（决策 4） |
| i3 | Warning | "git 可测但字节不可测"分支未定义 | **随 i1 消解**：不再需要字节测量，该分支不存在 |
| i4 | Warning | 真值表未覆盖行为级新行为 | **部分采纳**：新增 `untrackedOnly⇒confirm_required`、`bigIg⇒ok`、`blind+Confirmed⇒unproven` 三类行；WhatIf 同源打印与 exit 10 仍属脚本侧，落到 tasks 6.6 的真 git 夹具 |
| i5 | Info | 全量 ignored 展开的性能成本 | **采纳为记录**：不再对 ignored 做逐文件字节统计；`--ignored` 的行展开成本仍在，记为后续实测项 |
| i6 | Info | 须实测"测试文件已被 CI 收集" | **已实测**：`quality-gate.yml:575` 点名该文件 + `check-unwired-tests.js` rc=0 |
| i7 | Info | 再分发缺"字节一致"校验 | **采纳**：tasks 6.1 增加 hash 校验一步 |

## 对抗循环自动跑的第 2–3 轮（proposer=opencode / critic=claude，产物在 `.adversarial/ccg-plan-proposal-claude/`）

手工处置之外，把 `proposal.md` 原样喂进 `scripts/plan-review.sh` 跑了完整循环：
轮1 问题 6（Critical 2）→ 自动修订 8 处；轮2 问题 6（Critical 1）→ 修订 7 处；轮3 问题 4（Critical 1）→ **maxRounds 用尽，裁决 blocked**。
第 3 轮那 4 条是给人看的最终意见，逐条处置如下（编号沿用 critique-v3）：

| # | 级别 | 主张 | 处置 |
|---|---|---|---|
| i1 | Critical | Non-goals 写"不放宽 R7 硬失败面"，与 What Changes/Risk 的"`??`/`M/A` 放行"自相矛盾 | **采纳**：Non-goals 改写成"`D/U` 硬失败面不变；`??`/`M/A` 由拦改放行 + 打标"。这是纯措辞自相矛盾，critic 说得对 |
| i2 | Warning | 多个拒绝条件并存时退出码先后未定义，真值表未覆盖叠加 | **采纳**：新增 Requirement「按结构性先后取唯一值」，先后**从代码里读出来**（`8→6→2→7→10/4→9→1→5→3`），并落两条可执行锁：`exit 10` 语句必须出现在任何 `Stop-Process` 之前、`exit 4` 亦然（测试第 16 节）。**判据只数语句行**（`^\s*exit N\s*$`），不数文档与 `would REFUSE … -> exit 9` 预览字符串——注释可以怎么说都行，代码反着写照样绿 |
| i3 | Warning | "报条数"仍需递归枚举 ignored 文件，省成本的说法不成立 | **采纳，且实测后比 critic 说的更严重**：原实现用 `--untracked-files=all --ignored`，实测任务 worktree **55,191 行**、共享根 **127,654 行**（2–8 秒 + 六位数数组），等于每次删除都付这笔递归。改为独立的第二次调用 `--porcelain --ignored`（默认 untracked 档，被忽略目录折叠成一条：本机 10–80 行），并因此**修正口径**：`ignored=N` 的单位是**条目**不是文件数，打印文案与规格同步改写 |
| i4 | Info | `measured-fs` / 探针失败时 `ignored` 行的取值未定义 | **采纳**：新增 `IgnoredKnown`，未测得时打印 `n/a(not measured)`，**禁止打印 0**——把"没测"印成 0 就是本刀要消灭的"构造性零"在同一段新代码里复活 |

第 15 节真 git 夹具就是 i3/i4 的现场证据：`git init` + `.gitignore` 造一个 unborn 仓库，
实测 `!! ignored/` **折叠成一条**（`blob.txt` 不出现在探针输出里）而 `-uall` 档**完全不列**它们——
"折叠"与"盲区"两侧各一条断言，缺一条就只是半句话。

## 一处工具缺陷（本刀不修，但必须记）

`plan-review.sh` 的 docblock 承诺「退出码 0 收敛可动手 / 1 有阻断」，实测**轮3 用尽、裁决打印 `blocked` 的那一趟 rc=0**。
即"打印了阻断"与"退出码参与判定"之间没有接线——与本仓已知的「捕获而不判定」「空集恒真」同族。
本刀一律按产物判（`critique-vN.md` 里还有未回应 Critical 即为未收敛），并把该 rc/裁决错配记入 tasks 6.7。

## 对抗循环第二次完整运行（改正 i1–i4 后重跑）：轮1 7 条（Critical 1）→ 自动修订 8 处 → 轮2 6 条（**Critical 0**）→ `converged / cleared`

轮2 那 6 条已不阻断，但其中一条**打在实现上**、必须处置；其余按"先取证再决定"处理：

| # | 级别 | 主张 | 处置 |
|---|---|---|---|
| i1 | Warning | 「含 `D/U` 才算级联」没列全触发码集合，担心精确匹配 `DU/UD` 漏掉单 `D` | **取证后判为已被实现覆盖，采纳其文档诉求**：判据是 `^( D|D \|DU\|UD\|.D)`，单 `D`（` D` 与 `D `）本就计入，第 14 节真值表有 `'M  ok.js',' D missing.js' ⇒ cascade` 与 `'D  y' ⇒ cascade` 两行。规格仍把**集合逐字列出**（评审说得对：安全核心的精度不该只躺在 design.md 里） |
| i2 | Warning | `unproven` ⇒ 永远删不掉，且没有手动出路，属未申明的行为反转 | **部分采纳**：前提的一半不成立——未注册但**可枚举**时 `Basis='measured-fs'`，`-ConfirmDirtyDiscarded` 照常放行（本刀 4.9 的行为证据就是这条路径，实跑删成功）。真正走到 `exit 10` 的只有"git 与枚举双双失败"，那是被句柄/长路径挡住的异常态；出路＝先解掉挡枚举的东西（§十九 robocopy `/MIR /XJ`、释放 cwd 持有者），**不是**给脚本加旁路开关——加一个"绕过测不到"的参数等于把本刀的成果退回构造性零。此口径已写进 Requirement 1 与 SKILL.md 的 `10` 那一行 |
| i3 | Warning | `measured-fs` 的枚举同样会递归 `node_modules`，成本同级 | **取证后否证**：实现是 `[System.IO.Directory]::GetFileSystemEntries()` ——**只取顶层、不递归**，且**仅当 git 答不上时**才跑（`if ($null -eq $porcelain)`）。评审把"条目计数"当成了"全树遍历"。采纳其文档诉求：触发条件与"浅层计数"写进规格，避免下一个改动者把它"顺手改成递归" |
| i4 | Warning | 反构造性零只落到 ignored 那一档；`unproven` 时 `trackedDirty=0` 照样印出来，是同一个 Bug 换新衣 | **采纳，且这是本轮唯一落在代码上的真缺口**。把打印面从脚本正文里**提成纯函数** `Format-ContentSummary`：非 `measured-git` 时三档一律印 `n/a`，`ignored` 未测得时印 `n/a(not measured)`。第 16 节 3 行真值表锁住它，变异 M-D（退回原写法）实测 **2 条指名红**、detail 直接打出旧 Bug 的形状 `trackedDirty=0 untracked=0 ignored=n/a(not measured)`。**这条之所以是 Critical 级的品味问题**：脚本正文里的字符串没法被测，下一次编辑就会把 0 放回去，而没人会红 |
| i5 | Info | `measured-fs` 是"永不进入处置"的惰性态，三态机含惰性态易误读 | **取证后拒绝**：`Resolve-ContentDisposition` 的第一条 `needsConfirm` 分支就是 `Basis -eq 'measured-fs' -and FilesInTree -gt 0 ⇒ confirm_required`，第 13 节有该行且 `+Confirmed ⇒ ok`。它不但进处置，还是 `exit 4` 的主要触发者之一；把它降为打印辅助会让未注册目录重新变成"看起来干净" |
| i6 | Info | 「exit 10 同 PR 进 SKILL.md」——SKILL.md 不在本仓，无法被门禁强制 | **采纳**：措辞改为"仓内唯一真源是守卫自己的 docblock（随 PR 落地）"，SKILL.md 属跨仓、按 tasks 6.3 单独交付并附两份副本的实跑证据 |

变异清单至此共 **4 条**（M-A/M-B/M-C/M-D），每条都还原后重跑全绿；还原 M-D 时一次 `old_string` 连带吞掉了函数的闭合 `}`（结构破损），靠 `PSParser` 计数当场暴露 ⇒ 反证纪律里"还原后必须重跑并重新解析"这一条不是形式主义，它抓住了这一次的还原本身。

## 验证层（QM-6 双模型直接起后端，非脚本入口）处置

入口缺陷（见上文「现场」）：`scripts/deep-review.sh --force` 不真 force，且判定记录存在 off-by-one。
按 AGENTS.md QM-6 的原始命令形态并行起两路：`--backend claude`（正确性/边界/安全/规格对账）与
`--backend opencode`（命名/模式/可维护性/集成），判成败只看 findings 产物。

### 前端轴（opencode）findings 与逐条处置

| # | 级别 | 主张 | 处置 |
|---|---|---|---|
| F1 | Medium | `Resolve-WorktreeContent` 返回对象，而同前缀的三个兄弟函数返回字符串裁决 ⇒ `Resolve-` 在本文件内覆盖两种返回形态 | **采纳**：改名 `Get-WorktreeContent`（对齐既有对象返回先例 `Get-FsLinkReport`），测试前置存在断言与真值表同步改 |
| F2 | Medium | **`measured-fs` 触发的 BLOCKED 行只印三个 `n/a`，真正触发门禁的那个数 `FilesInTree>0` 不在这条消息里** ⇒ 只读 BLOCKED 段的人会把"没测到"读成"没内容、不用签核"，恰是本刀要消灭的误读 | **采纳（本轮唯一合并前必修）**：`Format-ContentSummary` 的 `measured-fs` 分支带上 `topLevelEntries=N`；真值表加一行「BLOCKED 文案必须含那个数」，并做变异反证（摘掉即红） |
| F3 | Low | 参数名 `FilesInTree` 高估精度（`GetFileSystemEntries` 计数**含顶层目录**） | **采纳**：改名 `TopLevelEntries`，打印面与规格同步 |
| F4 | Low | `gitMeasured=false` 时 ignored 循环仍填 `Ignored`，而 `IgnoredKnown` 恒 false ⇒ 一个永不显示的非零值挂在对象上，是给后来者的埋雷 | **采纳**：计数入口收紧为 `gitMeasured` 前置，不可显示的值不生成 |
| F5 | Low | `Total` / `GitMeasured` 无生产消费者 ⇒ 死表面积 | **取证后部分拒绝**：两者都被真值表消费（`GitMeasured` 是"未注册不得塌成空 git 测量"那条的断言对象，`Total` 是"空行不算内容"那条的断言对象）。纯判据返回快照对象、由锁消费，与本仓既有 `Resolve-RemoveDisposition` 同形；删掉等于把可断言的中间量藏回实现里 |
| F6 | Low | `.PARAMETER WhatIf` 与退出码契约都没写「`-WhatIf` 恒 exit 0，拒绝只靠打印行传达」⇒ 脚本化调用方会漏判 | **采纳**：docblock 补该句（这条与我自己写的"预演必须预览它将要撞的拒绝"是同一条约束的另一面） |
| F7 | Low | `unproven` 的 BLOCKED 文案没提示"上方已列出活持有者" | **采纳**：补一句指向 `busy holders` 行（顺序是真实存在的：holder 扫描在内容门禁之前） |
| F8 | Info | 两条同以 `content :` 打头的打印行，第二条易被扫读跳过 | **采纳**：澄清行改独立标签 `content note :` |
| F9 | Info | `exit 10` 在既有 {0..9} 之外、无冲突、已登记 | **无需动作**，仅记录 |

### 后端轴（claude）findings 与处置

后端明确结论：**主工作区级联路径是真被守住的**（junction 解析到 `$wt` 外 ⇒ `escaping` ⇒ 破坏动作之前就 exit 2；
R3b 只解 self-contained 链接），并点名两条**不是**装饰性的判据：ignored 档不参与放行（反向守"体积门槛恒触发"）、
`measured-fs` 的 `TopLevelEntries>0` 要求确认（守的正是本轮消除的"未注册塌成空数组"）。

| # | 级别 | 主张 | 处置 |
|---|---|---|---|
| B1 | **Medium** | 规格 Requirement 2 首句仍写"脏判据取自 `--untracked-files=all --ignored`"（**一次**调用），与实现的两探针形态自相矛盾 | **采纳**：首句改为"由两次独立 git 调用装配"，并把"禁止合并成一次"写成约束；同时把字段名精度要求写进同一句 |
| B2 | Medium | `Resolve-LinkTarget` 用**去前缀**的路径调 `Get-Item`，本身受 MAX_PATH 约束——正是全脚本被改写要绕开的东西 | **采纳（后果比评审说的轻，但仍需修）**：实测该函数返回 `$null` 时调用方**已经**按 `'(unresolvable)'` 归入 `escaping` 并 exit 2 ⇒ **失败方向是"误拦"，不是"级联放行"**。修法：先用 `\\?\` 形式重试，两种形态都解析不出才判 unresolvable，从而"很深"不再被读成"很危险" |
| B3 | Low | `IgnoredKnown` 里的 `-or $ignored -gt 0` 项在本 PR 唯一调用方是死路径 | **取证后拒绝删除、采纳其"必须写明不变量"的诉求**：该函数**接受两种喂法**——拆开的（本守卫）与合并的一次 `-uall --ignored`（改动前的形态，也是真值表 `$mixed` 那一行喂的东西）。删掉该项会让合并喂法把已测得的 ignored 判成"未测"。注释已写明该不变量 |
| B4 | Low | `Total` 无消费者，是死表面积 | **采纳删除**（与前端 F5 同一处，两个模型独立命中 ⇒ 上一轮我对 F5 的"由锁消费"辩护只对 `GitMeasured` 成立：`Total` 确实只被一条断言读、不承载任何判据语义 ⇒ 删字段并把该断言改为读 `TrackedDirty`/`Untracked`；`GitMeasured` 保留，它是"未注册不得塌成空测量"那条的断言对象）。**这条是对我自己上一轮判断的更正，不是评审改了我的结论那么轻** |
| B5 | Low | `$baselineFile` 只写不读（13 处 `Remove-Item`，0 处 `Get-Content`）⇒ 纯死 I/O，且"半接线"是最坏选项 | **采纳接线而非删除**：R7 改从该文件读回（长度与内存副本一致才采纳，不一致则告警并用内存），并打印 `baseline source : disk\|memory` ⇒ 那份"进程中途被杀时唯一留存的证据"变成承重件；否则它只是个每次运行都写的临时文件 |
| B6 | Low | `measured-fs` 的 `TopLevelEntries` 只数顶层，一个"只含 `node_modules/` 的未注册目录"报 1 | **采纳为"如实标注"**：判据接受该粒度（1 也必须签核），但打印面必须说清单位——与 F2/F3 同一条修法（`topLevelEntries=N (top-level entries, includes directories)`） |
| B7 | Low | 退出码先后表没写"内容档之后、持有者档之前还有 R4 的销毁性 kill" | **采纳**：先后链补上 `内容 10/4 → R4 处置自己拥有的进程 → 9 → 1 → 5 → 3`；顺序锁仍按语句行位置成立（`exit 10` 在任何 `Stop-Process` 之前） |
| B8 | Low | R6 主删除策略 `[IO.Directory]::Delete($lp,$true)` **没有 `/XJ` 等价物**，其安全性靠"lateScan 刚刚解过链"这个**时序**保证，而非原语保证；链接若在该窗口内出现则无防护 | **不在本刀修，升为独立跟进（tasks 6.11）**。理由：换删除原语/加删除前再扫描会改变 R6 的行为面，属另一个安全命题，值得自己的 change + 自己的评审；把它塞进本 PR 会让"已评审的实现"和"评审过的实现"不再是同一件事。**这条是本报告里风险最高的未闭合项，如实标注，不假装已解决** |
| B9 | Low | R7 的 cascade 文案写 "has DELETIONS outside the baseline"，但打印的是全部新条目（可能混入 ` M`/`??`） | **采纳**：文案改为"检测到级联符号（D/U），以下为删除形态行"，打印列表按 `Test-DriftCascadeSymbol` **过滤**；该符号集合收敛为库里**唯一实现**，判据与打印面不再各持一份正则 |

### 验证层合计

两轴共 18 条 findings（前端 9 / 后端 9）：**0 Critical**，Medium 3 条（F1 命名、F2 BLOCKED 缺触发数、B1 规格自相矛盾、B2 长路径边界——其中 B2 实测失败方向为误拦），其余 Low/Info。
处置分布：采纳并改代码 7（F1/F2/F3/F4/F6/F7/B1/B2/B5/B7/B8→文案与过滤，B9）、采纳并只改文档 3（B3 不变量注释、B6 单位、F8 标签）、取证后拒绝 1（B3 的"删掉那一项"）、**如实上报不闭合 1（B8）**。
最终锁：两档解释器各 **59 PASS / 0 FAIL / rc=0**，Check2 断言 **30** 条；变异 M-A/M-B/M-C/M-D/M-E **五条各自指名红**（M-E 的 detail 直接打出旧文案 `trackedDirty=n/a untracked=n/a ignored=n/a(not measured)`，证明 F2 那条锁真的有牙）；两份 skill 副本各实跑 59 PASS。

## 影响面与行尾纪律
改动文件：`scripts/worktree-fs-longpath.ps1`、`scripts/safe-worktree-remove.ps1`、`scripts/worktree-fs-longpath.test.ps1` + 本 change + `.quality-gates.md` / `CHANGELOG.md` / ledger。

`scripts/*.ps1` 为 `i/lf w/crlf`。判据：`loneCR == 0 且 CRLF 文件内 bareLF == 0`。**只用"两口径 numstat 对账"抓不到孤立 CR**（两者会一起爆），必须逐字节数 CR/LF/CRLF。
