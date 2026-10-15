# Design — hot-carrier-atomic-landing

## Context

「回填链」是每篇 PR 收尾都要走一遍的动作，它必须写两个全仓共享的追加型文件（`.quality-gates.md`、`scripts/gate-record-debt-ledger.json`）。docs-only 通道许可在共享主工作区就地编辑，而共享主工作区的所有会话共用**一份工作树 + 一份 index + 一份 HEAD**。于是「我已改完但还没提交」这个状态一旦跨出单条命令，就不再只属于本会话——它暴露给同一台机器上每一个 `reset` / `rebase` / `checkout`。

本设计的对象不是「冲突」，而是**窗口的可被观察时长**。冲突有 PR 兜底，工作树级的静默丢弃没有任何兜底。

## Decisions

### D1 — 不做「一律 worktree」，做「一条命令收口 + worktree 兜底」

备选 A（政策化：凡写热点载体必须开 worktree）被实测成本否证：本次为落地本 change 跑 `scripts/start-mp-task.ps1 -TaskName hot-carrier-atomic-landing -NoDeps`，checkout 写了 **9133 个文件**（`Updating files: 100% (9133/9133)`）。热点载体只有两三个文件，为它们把每次回填的成本乘上一个全库 checkout，会把「回填」这个每天都在发生的动作推到「攒着不做」——那正是本仓「回填欠账」缺陷的上游形状。

正解是两条出路互为兜底：默认走 `scripts/docs-land.ps1`（把窗口压进一条命令内部），工具不可用或改动复杂时走独立 worktree。spec 里写成「二者必居其一」而不是「必须 X」，是为了让判据可以机械检查（见 D2）而不制造日常摩擦。

### D2 — 判据只能落 pre-commit，CI 侧只许锁「判据源仍在位」

共享根是否存在跨会话脏改动属**机器态**，CI runner 上既没有共享根也没有并发会话（同族实测：AGENTS.md「时钟判据」条目记载 `quality-gate.yml` 的 runner 态断言必须先本机跑一遍，因为 runner 上 `\Mulpub\` 根本不存在）。因此：

- **行为判据落在 `scripts/hooks/pre-commit`**。钩子权威源在 `scripts/hooks/`、由 `scripts/install-git-hooks.ps1` 同步到共享 `.git/hooks/`，对共享根与全部 worktree 同时生效；且 `start-mp-task.ps1` 每次开任务都会重装，不需要人工步骤。
- 钩子里**已有**共享根 / 隔离 worktree 的分域实现（`git rev-parse --git-dir` vs `--git-common-dir`，`scripts/hooks/pre-commit:13-17`），并已有 `.agent_context/shared-root-violation` 这条违规通道——新判据复用分域，禁止新造第三套判定。
- CI 侧**只**加一条结构锁：`scripts/hot-carrier-paths.json` 存在且非空、`scripts/hooks/pre-commit` 里那段判据的语义特征仍在、`scripts/docs-land.ps1` 存在。**不得**把这条结构锁当行为锁——它是「记录性断言」的一种，只证明代码在位，不证明运行时拦住过任何东西。真正的行为锁必须在**本机临时仓库**里造两个会话的脏状态跑出来（沿用既有先例：`session-write-guard.test.ps1` 因夹具用 `git init`+`git add` 现场造仓库而量的是 git 的换行启发式，正解是 `git clone` 出工作树，见 AGENTS.md「断言 `git status` 干净度的测试夹具」条目）。

### D3 — 清单单一来源，且必须与 docs-only 白名单**同源自洽**

新增 `scripts/hot-carrier-paths.json`，一行一路径。两条约束：

1. MUST NOT 在脚本里再抄一份清单（AGENTS.md 反复出现的同型事故：同一个三态映射被抄成三份、`sanitizeUrl` 与 `usePlatformIconUrl` 两份口径）。
2. MUST 由测试断言**每一项都落在 `scripts/classify-docs-only.js` 导出的 `CI_IGNORED_PATHS` 之内**，且判定 MUST 复用其导出的 `matchesPattern`，不得用字符串相等。原因：`.quality-gates.md` / `CHANGELOG.md` / `AGENTS.md` / `01-docs/learnings.md` 命中的是 glob `'*.md'` 与 `'01-docs/**'`（实测 `scripts/classify-docs-only.js:33-49`），只有 `scripts/gate-record-debt-ledger.json` 是显式一行（`:55`）。若这个子集关系不成立，就会出现「改了热点文件被判混合 PR，却按 docs-only 走精简门禁」的口径分裂。

子集关系之所以是硬约束：热点清单里的文件若不在 docs-only 白名单内，就说明它带运行面，那属于「文档夹带代码」，本就该按运行时代码走 worktree，不需要本机制兜。

### D4 — 清单内容：回填链必写面 + AGENTS.md 已点名的「上游也在改同一处」文件

| 路径 | 进清单的理由 |
| --- | --- |
| `.quality-gates.md` | 回填链每次必写；顶部追加型，是最常见的 PR 冲突点（AGENTS.md「PR 自动合并」判据 1 点名） |
| `scripts/gate-record-debt-ledger.json` | 回填链每次必写；末尾追加型，同上一条；且**删除列必须为 0** 的判据只适用纯追加（记忆条目已实测） |

**初稿曾收、现按外部评审意见撤下的三项**：`AGENTS.md`、`CHANGELOG.md`、`01-docs/learnings.md`。依据必须拆开写，不得混引（混引本身就是本 change 反对的那类「拿类比当实测」）：

- `AGENTS.md` 与 `CHANGELOG.md` 出自 `AGENTS.md:116` 那句「共享根 `main` 滞后于 `origin/main` 时**不得**就地编辑 `AGENTS.md` / `.quality-gates.md` / `CHANGELOG.md` 这类『上游也在改同一处』的文件」——该短语**逐项只点名这三项**（已实测该行原文），其中 `.quality-gates.md` 本就在回填必写面里；
- `01-docs/learnings.md` **不在**那句点名清单内。它进初稿只是因为 AGENTS.md 行尾条目把 `CHANGELOG.md` 与它并列为「blob 里就是 CRLF」的热点文档——那是「同一处被反复改写」的证据，**不是**「回填链每次必写」的证据。

撤下三者的共同理由：没有量过它们在回填链里是否真的构成窗口，而收进来会让「共享根提交被拒」的触发面成倍放大、收益未知（后端模型判 PLAUSIBLE）。重进清单的前提：由 D9 的窗口读数**先量到**这些路径在共享根出现过超时窗口，凭读数加入。

**刻意排除**：`openspec/records/*.md`（按 PR 一篇独立文件，天然无并发写面，正是 `enforce-gate-record-presence` 用来消热点的手段，列进来等于把会话推回单文件）、`.ccg/reviews/*.json`（按 SHA 命名，同理）。注意这条排除同时是 D9 那条 CONFIRMED 的一半成因——刀 1 提交的正是 records，所以「提交命中清单」这类判据结构性看不见它。

**不分档**：不给「硬判据 / 软判据」两级。本仓同一决策的两端写在两个文件里就是漂移的开始（AGENTS.md 里反复出现的「两处各维护一份必然口径分裂」），清单一个、判据一条。

### D5 — 独占校验只看已跟踪文件；「同口径」必须是锁，不是形容词

与 `scripts/mp-worktree-health.ps1:49` 的既有口径逐字同形：`git status --porcelain=v1 --untracked-files=no`。该文件 `:46-48` 的注释已写清理由——`.ccg/`、`.agent_context/` 等被 Write Guard 放行直接落盘，未跟踪证据文件是共享根的**设计内常态**，一并拒绝会让判据天天误红，最终结局是被人绕过。

**同一把尺子不得量两遍**：钩子（bash）与 `mp-worktree-health.ps1`（PowerShell）会各写一遍同一条 porcelain 命令——跨语言无法共享函数，这是既有现实（本仓 CJS/ESM 孪生实现的处理方式就是「不合并实现、但用 parity 断言钉住判定面」）。因此 MUST 加一条 parity 锁：两处出现的 status 命令串**逐字相同**（含 `--untracked-files=no`），任一改动未同步另一处即红。**不得**只在注释里写「与某某同口径」——注释不会变红。

### D6 — 工具的成败一律取产物，窗口时长必须打印

AGENTS.md「收尾链上的已知假失败」与本仓多次实测：`gh pr merge` 的 rc 在本仓同时出现过 0 和 1 而合并都成功；`cmd | tail` 之后 `echo $?` 取到的是 `tail` 的 rc，被拒的 push 会报成成功。所以 `docs-land.ps1` MUST：

- 核 **本地分支 SHA == `git ls-remote --heads origin <branch>` 返回的 SHA**（不是 rc、不是末段输出）；
- 核共享根在 `reset --keep` 后回到 `git status --porcelain --untracked-files=no` 空集，且 `HEAD` == `origin/main`；
- 核 `gh pr view --json number` 拿得到号；
- **`git fetch origin main` 必须是第一条动作，且在 `git reset --keep origin/main` 之前**。`reset --keep` 的目标是本地 ref 里那个 `origin/main`；用陈旧 ref 会把主干已合并的那笔回填重新摊成一份待推的本地脏（AGENTS.md 处理 CONFLICTING 的既有口径就是「先 `git fetch` 再 rebase」，同一个道理）。fetch 失败必须中止，不得带着旧 ref 继续；
- **打印窗口时长**（从进入 stage 到 PR 号到手，毫秒）与本次声明的路径清单。没有这个数，「窗口被压进一条命令内」就是一句不可复现的宣称，与 AGENTS.md 反对的「量过一次之后没人再量」同型。

判据本体必须能在仓库里一句话重取（`git reflog --date=iso --format='%gD|%gs'` 计数即是本 change 的立据命令，已写进 proposal）。

### D7 — 显式退场条件，不留常驻机制

`openspec/changes/enforce-gate-record-presence`（未归档，实测 `openspec/specs/quality-gate-execution-record/` 不存在）已经交付「登记随记录文件走」，其提案原文就写明：「只要还需要往一个共享清单里登记欠账，撞车面就没有真正消失」。当那两个热点文件不再是写入面时，本 change 的清单条目会随之清空，此时 MUST 在同一次归档里删除 `docs-land.ps1`、pre-commit 那段判据与清单文件，而不是留一条恒不命中的死判据——AGENTS.md 已有同型禁令（「不得为不存在的反馈路径新增 locale 键」）。退场判据的写法必须**避开恒真陷阱**：一条「清单为空 ⇒ 实现文件必须不存在」的断言，在清单非空的整个存续期里都不会被求值到后件，读起来有牙实际恒绿（QM-6 前端评审 CRITICAL 命中此处）。可执行形态是两件事同时做：① 判据本体对**当前真实仓**求值——清单非空时实现文件必须存在（这条现在就红得起来），清单为空时实现文件必须不存在；② MUST 对判据本身做变异：把 `scripts/hot-carrier-paths.json` 在临时 clone 里改成空数组，退场那条**必须指名变红**，还原后按字节核对与改前一致。只做 ① 不做 ②，等于把「将来某天它会生效」当成已验证。

与 #3582 跨源一致性门禁的分工：那条检测「记录文件与旧载体的状态是否矛盾」（静态、CI 可见），本机制检测「同一份工作树里同时存在两个会话的未提交热点改动」（机器态、CI 不可见）。本 change MUST NOT 改那条门禁的判据，也 MUST NOT 用它冒充本问题的兜底——#3602/#3606 那 20 分钟里两形态分处两刀，跨源门禁当时是否报红未实测，**只作线索，不写成结论**。

### D8 — 判据必须有「本会话声明的待落路径」这一层，否则它分不清别人和自己

最初的判据是「工作树里还有不在本次提交内的已跟踪改动 ⇒ 拒绝」。QM-6 前端评审指出这条会误伤**同一个会话自己计划的第二刀**：共享根里那份脏可能就是我自己下一步要提交的东西，钩子没有信息区分「别人的脏」与「我自己的未完步骤」——两者在 `git status` 里逐字节同形。

采纳其观察，修法如下（**不**采纳「缩回只比热点清单」那条：那等于让判据恒不命中）：

- 会话在开始攒第二刀之前，把**打算落的路径**逐行写进 `.agent_context/pending-landings`（该目录 gitignored 且**按 worktree 独立**，与既有 `.agent_context/expected-branch` 同一接缝，见 `scripts/hooks/pre-commit:16`）；
- 钩子的拒绝条件改为「脏路径 ∉ 本次提交 ∪ 本会话声明」；声明命中即放行，但钩子输出 MUST 打印放行依据（`allowed-by-pending-landings: <路径>`）——**放行也要留痕**，否则下一个读日志的人分不清「判据没跑」与「判据跑了但被声明豁免」；
- 声明 MUST 会过期：条目带写入时间，超过上限（`MP_PENDING_LANDINGS_MAX_AGE_MINUTES`，非法值回落默认并出声告警）即不再豁免。没有到期条件的声明等于给判据装了永久旁路开关，而可长期存在的旁路会把门禁退化成装饰（与 AGENTS.md「豁免清单只能缩小」同族）；
- 该声明文件的存在本身 MUST 被结构锁看见：若某会话长期挂着声明而不落地，可见项要出声（不拦截，但要能被下一个人读到）。

### D9 — 行为判据的宿主必须是常驻守卫，不是 pre-commit（这条由外部评审 CONFIRMED 逼出来的）

初稿把「未提交窗口」的行为判据整个压在 pre-commit 上，WHEN 写的是「**本次提交命中热点清单** 且 工作树另有未提交已跟踪改动」。后端模型（claude）判 **CONFIRMED** 并把本提案自己的立据案例代进条件里算了一遍：

| 那一刀提交的内容 | 第一条「命中清单」 | 第二条「另有脏」 | 结论 |
| --- | --- | --- | --- |
| 刀 1：`openspec/records/bf-preset-readonly.md` | 否（records 被 D4 排除） | —— | 放行，而此刻热点文件正开着窗口 |
| 刀 2：`.quality-gates.md` + ledger | 是 | 否（工作树已无其它脏） | 放行 |

两刀都不拦 ⇒ 「可判定且默认变红」对**已发生过一次**的形态不成立。这不是措辞问题，是宿主选错了：窗口是「一段时间内工作树的状态」，而 pre-commit 只在**某一次提交的瞬间**被调用；它既看不见窗口何时开、也看不见窗口何时被 `reset` / `rebase` / `checkout` 抹掉（实测那 29 次 git 写动作里，除 7 次 commit 外的 22 次都不走 pre-commit）。

换到的宿主是 `scripts/guard-shared-root-writes.ps1`，四条理由都可在仓内核验：① 它已经**常驻**监听共享根（Windows 计划任务 AtLogOn），窗口这种时间属性只有常驻进程能测；② 热点载体本来就在它的放行面里（`:69` `$allowedRootFiles` 含 `.quality-gates.md`，`:68` `$allowedTop` 含 `scripts`、`openspec`），要观察的文件它已经全部在看；③ 它已有「开窗即写 `violations.jsonl`」的记账出口（`:123-125`）和一条专门处理 *FileSystemWatcher 漏事件必须回看* 的启动对账路径（`:247` 起的 Why 注释）——漏事件回看正是「窗口」这种跨事件状态必需的另一半，不用再造；④ 它天生**只作用于共享根**，不会误伤 worktree 会话。

于是分工变成三档，且每档都写清它守什么、守不住什么：

- **(2) 守卫量**：开窗 / 收窗时长，超上限出声并记账。守「有没有开过、开了多久」，不拦截。
- **(3) `docs-land.ps1` 拦**：`reset --keep` 之前若存在本会话声明之外的热点脏 ⇒ 中止。守「真正会丢工的那一步」，但只覆盖走工具的会话。
- **(4) pre-commit 拦**：把别人的脏混进自己这一刀。守形状 B，**守不住**形状 A（如实写进 spec 的 Scenario，不得由「已加判据」这句话吸收）。

### D6 补 — 「回到基线」的断言必须比对外部真值，不能比对本地陈旧 ref

`git reset --keep origin/main` 之后 `HEAD == origin/main` **必然**成立，而 `origin/main` 是上次 fetch 的快照——push 被远端拒绝时本地 ref 仍是旧的，这条断言照样满足（后端模型次要观察，复核成立）。三条产物里真正有牙的是「本地分支 SHA == `git ls-remote` 返回值」；`HEAD` 那条 MUST 改成比对**本次 fetch 后**从 `git ls-remote origin main` 取到的 SHA，否则它是空转断言。同理，判据一律不写「HEAD 等于某个本地 ref」这种可被陈旧引用满足的形状。

## Risks & Rollback

- **R1 新脚本自身属 `scripts/` ⇒ 实现 PR 是混合 PR**，要走完整门禁（含 `QG Changes` 与各静态门禁）。这是范围事实，不得借 docs-only 通道，也不得以「只是加个工具」为由跳过。
- **R2 判据可能变成新的日常摩擦**：它只在「提交内容命中热点清单」时生效，其余提交零影响；若实测出现高频误拒，正解是核对清单是否收得过宽（回到 D3/D4），**不得**放宽判据或加 skip——那会把锁拆掉还留一盏绿灯（AGENTS.md「测试在 CI 上跑不过时……共同禁止项」）。
- **R3 钩子版本随分支漂移**：共享 `.git/hooks/` 由 `install-git-hooks.ps1` 重装，而 `start-mp-task.ps1` 每次开任务都会跑它，因此某条分支上的钩子可能被带回旧版。缓解：`docs-land.ps1` 自己在动作前重跑一次 `install-git-hooks.ps1`，并核已装文件开头与权威源字节一致（沿用记忆条目「真源字节须原样出现在已装文件开头」，该判据比 hash 全等更容忍 IDE 尾部追加）。
- **R4 `.ps1` 正文一律纯 ASCII**：无 BOM UTF-8 里的中文会被 Windows PowerShell 5.1 按 GBK 解码并吞掉引号，报出来全是误导性语法错（本机已踩过）。`scripts/docs-land.ps1` 全文 MUST 只用 ASCII 注释与输出串，中文说明放 md 里；测试 MUST 在 **5.1 与 pwsh 7 两种 shell 各跑一遍**（既有先例：AGENTS.md 记 7 条 PowerShell 测试按两 shell 分档）。
- **回退**：钩子改动是一段独立判据，摘掉即整体回退，`docs-land.ps1` 与清单文件随 PR 反转删除；行为锁与结构锁都在实现 PR 内新增，回滚后不会留下悬空引用。本 change 自身的规格文件按 openspec 惯例随 `git revert` 退。
