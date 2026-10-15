# worktree-removal-safety (delta: fix-worktree-remove-dirty-gate)

## ADDED Requirements

### Requirement: 删除前必须能区分「没有内容」与「无法判定内容」

`safe-worktree-remove.ps1` 在决定是否放行删除前，SHALL 得出三态之一的判定基（`Basis ∈ {measured-git, measured-fs, unproven}`），且 MUST NOT 以单一布尔或单一计数表达工作树内容状态。当 worktree 未被 git 注册、或 `git status` 非零退出时，MUST NOT 把结果回落为空集合——空集合会被调用方读成"干净"，而它实际表达的是"测不到"。

#### Scenario: 未注册且目录非空必须由人看着数字签字
- **WHEN** `Registered=$false` 且目录存在、文件系统实测条目数 `> 0`
- **THEN** `Basis='measured-fs'`，输出 MUST 打印该条目数并声明它是文件系统计数而非 git 测量；未带 `-ConfirmDirtyDiscarded` 时 MUST exit 4 且 MUST NOT 删除任何内容；带该参数时放行（人已看到数字）

#### Scenario: 双读失败时确认参数不得替代测量
- **WHEN** `git status` 不可用**且**目录枚举也失败
- **THEN** `Basis='unproven'`，即使传入 `-ConfirmDirtyDiscarded` 也 MUST exit 10（确认不能替代测量）

#### Scenario: 文件系统回退是浅层计数，且只在 git 答不上时发生
- **WHEN** `git status` 成功（`Basis='measured-git'`）
- **THEN** MUST NOT 触发任何文件系统遍历（守卫不得为"顺便报个数"再爬一遍树）；确需回退时计数只取**顶层条目**（`GetFileSystemEntries` 一层，不递归），因为 `node_modules` 量级的 worktree 递归一次就是数万条目——**"不得把守卫自己变成性能炸弹"与"不得漏测"是同一条约束的两端**

#### Scenario: unproven 的出路是修好测量，不是加旁路
- **WHEN** 目标处于 `unproven`
- **THEN** 处置 MUST 是"释放挡枚举的东西后重跑"（句柄持有者、长路径残留走既有 robocopy `/MIR /XJ` 收口），而 **MUST NOT** 新增"绕过不可判定"的参数——那等于把本刀消除的构造性零换成一个"人自愿闭眼"的开关

### Requirement: 内容风险分级门禁，ignored 只升可见性不升门槛

脏判据 SHALL 由**两次独立 git 调用**装配：`trackedDirty` / `untracked` 取自 `git status --porcelain --untracked-files=all`（**不带** `--ignored`），`ignored` 取自另一次 `git status --porcelain --ignored`（默认 untracked 档，被忽略目录折叠为一条）；三档按 XY 码分别计为 `trackedDirty` / `untracked` / `ignored`。**禁止**合并成一次 `--untracked-files=all --ignored`（实测 55,191 / 127,654 行，每次删除都要付这笔递归）。快照字段名 SHALL 如实表达精度：`TopLevelEntries`（顶层条目计数，**含目录**），不得用暗示"文件数"的名字（QM-6 B1/F3）。只有 `trackedDirty` 与 `untracked` SHALL 参与放行判定（未带 `-ConfirmDirtyDiscarded` 时 exit 4）；`ignored` MUST NOT 并入既有 `dirty` 计数，也 MUST NOT 设置任何体积/条数门槛——`node_modules`、构建产物、日志天然是 ignored 且天然体积巨大，任何以体积为判据的门槛都会在**每次正常删除**上触发，其后果不是保护而是训练使用者习惯性加 `-Force`（那会连带绕开真正需要的确认）。`ignored` 的处置是**打印条数使其可见**，体积不作为拦截条件。

> **本条是决策层评审当场纠正的结果**（原条文写了「超过 `10MB` 字节预算即 exit 4，可由 `-IgnoredByteBudget` 覆盖」）。评审指出该门槛会在每一个含 `node_modules` 的 worktree 上恒触发，与本提案自己的 Non-goals 相矛盾；纠正方向是**换轴**（体积 → 可测性；路径语义的分级留给 tasks 6.5），而非调参数。实现期另暴露一处自我欺骗：代码里 `$ignoredBytes` 一直是常量 `0`、从未被测量，因此"预算门禁"即便保留也不会触发——那正是装饰性门禁的又一形态，详见 `design.md` 决策 3。

#### Scenario: 大体积 ignored 内容不得阻断删除，但必须出声
- **WHEN** worktree 内 ignored 文件体积达到 `node_modules` 量级，而 `trackedDirty=0`、`untracked=0`
- **THEN** 判为 `ok`、exit 0 并照常删除；输出 MUST 含 `ignored=N`（N>0）与一行 `CONTENT NOTICE` 说明这些文件随本 worktree 一起销毁、且属未判定为需保护的内容；**不得**出现 exit 4，也不得出现任何字节预算参数

#### Scenario: ignored 档位来自独立的折叠探针，且单位是条目
- **WHEN** 守卫需要 ignored 可见性
- **THEN** MUST 由**第二次** git 调用取得（`status --porcelain --ignored`，默认 untracked 档，被忽略目录折叠为一条），**禁止**用 `--untracked-files=all --ignored`（实测 55,191 行 / 127,654 行，每次删除都要付这笔递归）；打印文案 MUST 标明单位是**条目**（折叠后）而非文件数

#### Scenario: 探针失败不得印成 0
- **WHEN** 折叠探针自身非零退出（或 git 完全答不上）
- **THEN** `IgnoredKnown=$false`，打印面 MUST 输出 `ignored=n/a(not measured)` 并另起一行说明"ignored 档位未知，未知不等于空"；MUST NOT 出现 `ignored=0`（那会把"没测"伪装成"没有"，正是本刀消除的构造性零）

#### Scenario: 无定论时确认参数不得替代测量
- **WHEN** `Basis='unproven'`
- **THEN** 即使传入 `-ConfirmDirtyDiscarded` 也 MUST exit 10；`Basis='measured-fs'` 且条目数 > 0 时未带确认参数 MUST exit 4

#### Scenario: 预演与实跑共用同一打印面
- **WHEN** 以 `-WhatIf` 运行
- **THEN** MUST 打印 `trackedDirty/untracked/ignored + basis=` 分级，与实跑路径逐字同源；`Basis='unproven'` 时 MUST 打印 `UNPROVEN` 而非数字 0

### Requirement: 主工作区漂移按符号分级，仅删除类失败保持硬拦截

R7 校验 SHALL 用 `Resolve-DriftDisposition` 对 baseline 外新增条目按 porcelain XY 首字符分级：出现删除或冲突符号 MUST 判为级联嫌疑并 exit 3、保留原文恢复提示；仅含 `M`/`A`/`??` MUST 判为并发良性漂移、exit 0 并**全量列出条目**（MUST NOT 静默通过，且 MUST NOT 建议执行恢复脚本）。

**触发级联的符号集合逐字列出**（精度是本刀的安全核心，不得只写在设计文档里）：`" D"`（工作树删除）、`"D "`（索引删除）、`"DU"`、`"UD"`、以及任意 `".D"`（即 Y 位为 `D`）。单 `D` **本就计入**——把它当"只认合并态"是误读。

> **本条是「收窄既有拦截面」，必须如实声明两个边界**：① 旧逻辑对任何非空漂移都 exit 3，新逻辑对 `M`/`A`/`??` 放行，因此**若一次真级联删除恰好在 R7 采样前被并发会话的同名 `M` 条目掩盖，本判据不会红**——现状的可靠信号仍是删除类符号，不是"有任何变化就报"。② R7 只做**单次采样**（删除后比较一次 baseline），不轮询；级联若发生在采样之后（例如残留目录被后台进程继续删）仍会漏。这两点在本刀不修，属已知残余，见 `design.md` 决策 4 与决策 6。

#### Scenario: 并发暂存不得被读成级联删除
- **WHEN** 删除期间另一会话在共享根 `git add` 了 `.quality-gates.md`（`M`）而 `D` 计数为 0
- **THEN** 判为 `benign_drift`，exit 0，打印 `R7 BENIGN-DRIFT` 并列出该条目；输出中 MUST NOT 出现 "Run safe-restore-deleted.ps1"

#### Scenario: 真级联仍当场硬失败
- **WHEN** baseline 外出现任一条 `D`/`U` 符号条目
- **THEN** 判为 `cascade`，exit 3，并保留原"Possible cascade delete. Run safe-restore-deleted.ps1"提示

#### Scenario: 混合漂移按更严重的一侧定性
- **WHEN** baseline 外同时出现 `M` 与 ` D` 条目
- **THEN** MUST 判为 `cascade`（分级取最坏符号，不得按"多数条目 benign"投票）

### Requirement: 被忽略的历史证据必须可见（豁免迁移为本刀后续）

`safe-worktree-remove.ps1` SHALL 在存在 ignored 内容时打印其**条数**，使操作者在签字前看得见"Plain git status 不列出的文件将随本 worktree 一起销毁"。

> **范围调整（实现期如实回写）**：原提案把"命中证据型路径先镜像到 `mp-retired-evidence/` 再删"（`-PreserveEvidenceGlob`）列入本刀。实现时发现镜像需要一条目录级长路径复制实现，而既有库里只有**删除向**的原语（`Clear-FsDirectoryByMirror` 等），临时造一份会把"证据保护"做成不可靠的半成品，因此**本刀只落"必须打印可见"**，豁免迁移单列为 tasks 6.5。默认行为不变（ignored 内容仍随删除消失），但不再**沉默**。

#### Scenario: ignored 内容在预演阶段就已可见
- **WHEN** 目标 worktree 含被 `.gitignore` 忽略的文件（`git status --porcelain` 不列出的那类），以 `-WhatIf` 运行
- **THEN** 输出 MUST 含 `ignored=N`（N>0）与一行 `CONTENT NOTICE` 说明这些文件随本 worktree 销毁且未被判定为需保护的内容；MUST NOT 出现"无任何内容提示即进入删除计划"的路径

#### Scenario: 分级行在 WhatIf 分支之前计算
- **WHEN** 同一目标分别以 `-WhatIf` 与不带该参数运行
- **THEN** 两次输出的 `content : trackedDirty=… untracked=… ignored=… basis=…` 行 MUST 逐字相同（计算发生在 WhatIf 分支之前），使"预演报 0"不可能与"实跑删了东西"分叉

#### Scenario: 未测得的档位印 n/a，不印 0
- **WHEN** `Basis` 为 `measured-fs` 或 `unproven`（git 没能分类）
- **THEN** 打印面 MUST 输出 `trackedDirty=n/a untracked=n/a`，MUST NOT 出现 `trackedDirty=0`——`0` 与"没测"在人的眼睛里是同一件事，正是本刀要消灭的构造性零；该格式 SHALL 由**纯函数** `Format-ContentSummary` 产生（写在脚本正文里的字符串无法进真值表，下一次编辑会把 `0` 放回去且无人变红）

### Requirement: 多个拒绝条件同时成立时，退出码按结构性先后取唯一值

守卫 SHALL 按**代码里的实际先后**产出唯一退出码，而不是"取最严重的码"这种需要仲裁的定义：
`8`(同伴库缺失) → `6`(R0 受保护锚点) → `2`(ESCAPING 链接) → `7`(链接无法枚举) →
内容档 `10`/`4` → **R4 处置自己拥有的进程（销毁性，非门禁）** → `9`(外来持有者/枚举失败) →
`1`(`git worktree remove` 失败) → `5`(残留目录删不掉) → `3`(R7 漂移)。
其中 `10`/`4` 与 `Stop-Process` 的先后由回归锁按**语句行位置**钉住（只数 `^\s*exit N\s*$`，不数文档与预览字符串）。
由此两条推论 MUST 成立：

- **`10` 与 `3` 不会并存**：`10` 发生在任何写动作之前，树未被触碰，R7 根本没有采样对象；
  规格 MUST NOT 暗示"两者并存时取其一"。
- **内容档 MUST 先于持有者档**：人在签字丢弃内容之前，应当先知道内容是什么；持有者档负责的是"能不能删得动"，
  它在内容被确认后才有意义。该先后是**实现事实**，写进规格是为了让下一个改动者知道它承重，
  而不是把它当可调参数。

#### Scenario: 未注册且被进程占用时取内容档还是持有者档
- **WHEN** `Basis='unproven'` 且同时存在存活持有者
- **THEN** MUST 以 `10` 退出且**不**尝试任何删除或 kill；持有者档（`9`）在此路径上永不被评估——这是先后定义的直接后果，回归锁按"该分支不产生 kill 调用"验证

#### Scenario: 预演打印面同时呈现所有未来会被拦的档
- **WHEN** 目标同时存在 ESCAPING 链接之外的多项风险（如有存活持有者 + 未提交内容）
- **THEN** `-WhatIf` MUST 把每一条**独立成行**列出（`would REFUSE : … -> exit N`），而不是只报第一个命中项，使一次预演就能看全需要几道签字
