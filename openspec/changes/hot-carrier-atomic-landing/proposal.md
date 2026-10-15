# 热点载体的未提交窗口必须被原子收掉（hot-carrier-atomic-landing）

## Why

质量节拍要求每次 PR 收尾把「远程同步」回填成 `PASS` + merge SHA，并在**同一次提交**里删掉欠账登记项。这条动作的写入面有两个全仓共享的**追加型热点文件**：`.quality-gates.md`（顶部插块）与 `scripts/gate-record-debt-ledger.json`（增删键）。而 docs-only 通道明确许可「在共享主工作区就地编辑」——共享主工作区是**所有会话共用的一份工作树、一份 index、一份 HEAD**。于是每次回填都必须在别人的 HEAD 底下攒一份「已修改但未提交」的热点改动，而任何一次 `reset` / `rebase` / `checkout` 都会把它静默抹掉，不报错、不留痕。

现有 spec 里那条约束是空转的。`openspec/specs/openspec-integration/spec.md:123` 与 `:131` 都写了「不得与并发会话的脏文件冲突 / 不与并发脏文件冲突」，但仓内**没有任何东西测量它**。唯一会判「共享根是否干净」的实现是 `scripts/mp-worktree-health.ps1:49`（`git status --porcelain=v1 --untracked-files=no`），它的调用点是 `scripts/start-mp-task.ps1:69,71` 和 `scripts/session-init.sh:55,69`——**全部挂在运行时代码任务的入口上**。走 docs-only 那条路的人根本不经过它们。这是「先文档再代码」链条上的一个熟悉形状：判据存在，但不在受影响的那条路径上。

实测（本会话 2026-10-15 勘查共享根 `git reflog`，窗口 `2026-10-14 23:00` → `2026-10-15 04:00`，+08:00，`git reflog --date=iso --format='%gD|%gs'` 可直接复跑）：

| 判据 | 数量 |
| --- | --- |
| 窗口内共享根 HEAD/index 上的 git 写动作 | **29** |
| 其中 `commit` | 7 |
| `reset: moving to origin/main` | 7 |
| `merge origin/main: Fast-forward` | 9 |
| `rebase`（start/finish 各 2 行） | 2 |
| `checkout: moving` | 2 |
| 这 7 条 commit 里属于 docs-only 回填 / learnings 的 | **7（全部）** |

同一窗口里两处直接后果，均可逐条核到提交：

- **同一条回填落了两遍。** #3602（merge `e9c412398`，2026-10-14T17:08:55Z）标题「回填 #3600 远程同步 PASS + merge SHA，并销账（bf-preset-readonly）」，`git show --stat` 只含 `openspec/records/bf-preset-readonly.md` 加一份 `.ccg` 产物，**没碰** `.quality-gates.md` 与 ledger；20 分 17 秒后 #3606（merge `32fdd3d4c`，17:29:12Z）**标题逐字相同**，改的正是 `.quality-gates.md` 4 行 + 删 ledger 1 行。两刀之间 main 上的形态是「记录文件已 PASS、旧载体两形态仍 PENDING、欠账登记项仍在」——恰是 AGENTS.md「回填与销账必须同一次提交」要禁止的那个状态。拆分本身不是疏忽：#3585 的记录里写明那两个文件「是全体会话的追加热点，携带会造成 ~13min 冲突周期 vs ~40min CI 的结构性活锁」，所以会话刻意把热点载体留给后一刀。**热点活锁把「PR 冲突」换成了「共享根脏」，风险没有消失，只是换了个更容易静默的落点。**
- **那两个热点文件是被 git 写重写的，不是被编辑器写的。** `stat` 实测 `.quality-gates.md` mtime `2026-10-15 03:53:00.552`、`scripts/gate-record-debt-ledger.json` mtime `03:53:00.556`，与 reflog 里 `03:53:00` 那次 rebase 的 start/finish **同一秒**。
- 前科仍在仓库里挂着：`stash@{0}`（2026-10-14 01:03:44 +0800）的名字就是 `On main: shared-root-dirty-20261014: 56 files (54 tracked + 2 untracked) 固化待分类处置`，内含 6 篇 `openspec/records/*.md`——共享根脏到必须先整块固化，否则 `start-mp-task.ps1 -RequireClean` 当场拒绝开新任务。

## What Changes

> 机制形态在 QM-6 外部评审后被改过一次，且必须如实记下这一刀：初稿把行为判据写成「**本次提交命中热点清单** 且 工作树另有脏改动」，后端模型（claude）判 **CONFIRMED** 并逐条推出——本提案自己立据的那次拆分（#3602/#3606）**两刀都不过这个条件**：刀 1 提交的是 `openspec/records/`（被 D4 明确排除在清单外）⇒ 第一条为假；刀 2 提交热点文件时工作树已无其它脏 ⇒ 第二条为假。于是「可判定且默认变红」对已发生过的形态不成立。下面的 (2) 就是为补这个洞而换的宿主，(4) 保留但**降级为只覆盖形状 B**。

1. **新增热点载体清单的单一来源**（机器可读的一行一路径）。清单只收**回填链每次必写**的两个文件（`.quality-gates.md`、`scripts/gate-record-debt-ledger.json`）——初稿把 `AGENTS.md` / `CHANGELOG.md` / `01-docs/learnings.md` 也收了进来，理由只是 AGENTS.md 里「上游也在改同一处」那句半截结论，**没有实测误拒率**；后端模型据此判过度设计（PLAUSIBLE），已按 R2 口径先收窄，将来若 (2) 量到这三者也成窗口，再凭数据加入。清单进 git，禁止在脚本里另抄第二份。
2. **把「窗口是否开着、开了多久」的测量落到常驻写守卫**（`scripts/guard-shared-root-writes.ps1`）。这是唯一能对准已实证形态的落点：热点载体本来就在它的放行面里（实测 `:69` `$allowedRootFiles` 含 `.quality-gates.md`，`:68` `$allowedTop` 含 `scripts`/`openspec`），它已经常驻监听共享根，且 `:247` 已有一条处理「FileSystemWatcher 漏事件必须回看」的启动对账路径——把「开窗 / 收窗」作为事件写进同一份 `violations.jsonl`，就得到一个**可复盘的时长读数**，而不是又一句自觉纪律。超上限（`MP_HOT_CARRIER_WINDOW_MAX_MINUTES`）一律出声并记账；**不拦截**（拦截别人的提交是惩罚无辜方）。
3. **新增 `scripts/docs-land.ps1`**：把全靠手工的动线——`git fetch origin main` → stage 命名路径 → commit → `git branch <name>` 保住提交 → `git reset --keep origin/main` → push → 开 PR——压成一条命令，使窗口只存在于该命令内部。`reset --keep` 之前 MUST 核「工作树里没有**本会话声明之外**的热点载体脏改动」，有则中止（这才是真正会丢工的那一步）。
4. **`scripts/hooks/pre-commit` 加一条窄判据（覆盖面如实写明）**：提交命中热点清单 **且** 工作树还有既不在本次提交内、也不在本会话 `.agent_context/pending-landings` 声明里的已跟踪脏改动 ⇒ 拒绝并给两条出路。它守的是「把别人的脏混进自己这一刀」，**守不住**「攒着不提交」——后者由 (2) 量、由 (3) 拦。
5. **规则侧收口**：不使用 `docs-land.ps1` 的 docs-only 会话，凡要写热点载体，MUST 在独立 linked worktree 准备（`scripts/start-mp-task.ps1 -TaskName <slug> -NoDeps` 已支持，本 change 的落地 PR 即为第一条实例）。
6. **显式退场条件**：`openspec/changes/enforce-gate-record-presence` 的目标是「登记随记录文件走、聚合清单改为派生产物」。一旦那两个文件不再是写入面，(1)(2)(3)(4) MUST 在同一次归档里一并删除，不得留恒不命中的死判据。

非 BREAKING：不改任何运行时代码；不改 `CI_IGNORED_PATHS` 白名单内容；不改分支保护规则。使用者可观察变化只有两处：手工提交热点文件且工作树另有未声明的脏时，pre-commit 会拒绝并说明原因；窗口超上限时共享根守卫会出声并记一条 `violations.jsonl`。

**覆盖边界（不假装已闭合）**：手工敲的 `git reset --hard` / `git checkout -- <目录>` 不在任何钩子的调用链上，本机制**拦不住**；`git commit --amend` 与 rebase 重放也不走 pre-commit 的新版本。所以本机制的价值是「让窗口可测量 + 把走工具的那条路收干净 + 给无辜方一道闸」，不是「杜绝静默丢工」。这句必须留在文档里，否则下一个会话会把它当成已根治。

## Capabilities

### New Capabilities

- `hot-carrier-atomic-landing`：全仓共享写面（热点载体）的清单单一来源与其与 docs-only 白名单的同源自洽约束；「未提交窗口不得跨会话驻留」这条判据**为什么只能落本地、落在 pre-commit**；一条命令收口（`docs-land.ps1`）的产物取证口径（含窗口时长留痕）；以及该机制相对 `enforce-gate-record-presence` 的退场条件。命名约束两处：① 本仓「原子落盘」已被 tmp+rename 语义占用（实测 4 处命中），本文一律写「一条命令收口」，不复用该词；② slug 里的 `atomic` 修饰的是 **landing（收口动作的不可分割）**，与文件写法的 tmp+rename 无关——读到「atomic」不要去找原子替换实现。

### Modified Capabilities

- `openspec-integration`：**分层分支策略**。把现有「MAY 在共享主工作区就地编辑 …… 且 MUST 不得与并发会话的脏文件冲突」这条**无检测器的声明**改写为可判条款：命中热点载体清单的 docs-only 写入必须走一条命令收口或独立 worktree，二者必居其一。

已做基线差异审计（按 config.yaml 规则）：`openspec/specs/` 全树对 `shared-root-dirty`、`docs-land`、`hot-carrier` 命中均为 0；`enforce-gate-record-presence` 仍在 `openspec/changes/` 未归档（`openspec/specs/quality-gate-execution-record/` 不存在），其已交付行为（记录按 PR 独立成文件、登记字段随文件走）不在本 change 重复规格化，本 change 只声明**它尚未覆盖的那一面**——聚合热点文件的写入窗口。#3582 的跨源一致性门禁检测的是「记录文件与旧载体的状态是否矛盾」（静态、CI 可见），本 change 检测的是「同一份工作树里同时存在两个会话的未提交热点改动」（机器态、CI 不可见），两者判据域不重叠。

## Impact

- 新增：`scripts/hot-carrier-paths.json`（清单，只含两个回填必写面）、`scripts/docs-land.ps1` 与其测试、`scripts/hooks/` 内新增钩子判据及其既有行为锁 `scripts/hooks/pre-commit.test.sh`（12497 字节，必须同步）。
- 修改：`scripts/guard-shared-root-writes.ps1`（加「开窗 / 收窗」事件与时长读数，复用其既有 `violations.jsonl` 记账与启动对账路径）、`openspec/specs/openspec-integration/spec.md`（归档时）、`AGENTS.md` 的「docs-only 快速通道」与「PR 自动合并」收尾清单、`.github/workflows/quality-gate.yml`（新脚本的锁接线）。
- **实现 PR 属混合 PR**：改动 `scripts/` 工具脚本与 `.github/workflows/` 即触发 AGENTS.md 的混合 PR 判定，不得借 docs-only 精简通道；按既有先例，接进 `changes` job 的锁 MUST 只 require node 内置模块。
- 本 change 自身（proposal / design / specs / tasks / 记录 + 两个热点载体的登记）是 docs-only，且**按本 change 自己提议的规则在独立 worktree 准备**——`start-mp-task.ps1 -TaskName hot-carrier-atomic-landing -NoDeps`，实测 checkout 写入 9133 个文件（`Updating files: 100% (9133/9133)`），这个数字是 D1 否证「一律走 worktree」的直接依据。
- 不触碰 `apps/desktop/`、`packages/`、任何 UI ⇒ QM-1 / QM-4 不适用。
- 残留风险（不假装已闭合，三条都要留着，不得被「已加判据」这句话吸收）：① 手工敲的 `git reset --hard` / 宽目录 `git checkout -- <目录>` 不在任何钩子的调用链上，本机制**拦不住**，只能靠 (2) 的事后时长读数发现「窗口开过、工丢了」；② `git commit --amend` 与 rebase 重放不跑 pre-commit 的新版本，形状 B 那道闸对这两条路径失效；③ 「两个会话各自在自己的 worktree 里改同一个热点键然后都推上去」这一形态本机制明确不管，仍由 PR 冲突与 #3582 的跨源门禁兜。
