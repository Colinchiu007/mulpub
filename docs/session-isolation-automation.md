# Multi-Publish 会话隔离自动化

## 目标

共享仓库根（例如 `D:/Data/projects/mulpub`）是只读协调根，长期保持 main 且干净。运行时代码任务必须创建在隔离 worktree（默认 `<仓库父目录>/mp-worktrees/mp-<task>`，可用 `-WorktreeRoot` 或 `MP_WORKTREES` 覆盖），避免多个 Codex 会话共享同一个 Git HEAD、index 和 stash。

## 自动入口

从仓库根目录运行：

    powershell -ExecutionPolicy Bypass -File scripts/start-mp-task.ps1 -TaskName story2video-fix

启动器会依次检查共享根目录、安装并校验 Git hooks、调用 session-init.sh 创建或复用独立 worktree，并打开定位到该 worktree 的 PowerShell。依赖安装较慢时可以使用 -NoDeps，但交付测试前仍必须完成 worktree 依赖门禁。worktree 根默认取仓库父目录下的 `mp-worktrees`，可通过 `-WorktreeRoot` 或 `MP_WORKTREES` 覆盖；Git Bash 路径会自动探测，也可用 `-GitBash` 或 `MP_GIT_BASH` 指定。

## 新机器一键启用

新电脑克隆仓库后，先运行一次：

    powershell -ExecutionPolicy Bypass -File scripts/bootstrap-write-guard.ps1

该命令按顺序完成：安装 Git hooks → 跑两个自检测试 → 注册健康巡检与写保护计划任务 → 启动 Write Guard watcher → 健康门禁（要求 main clean、hooks 一致、write guard 运行）。任一步失败返回非零；可重复运行（幂等）。`-Minutes` 可调巡检间隔（1-60 分钟），`-WorktreeRoot` / `MP_WORKTREES` 可改隔离目录，`-SkipTests` 可跳过自检。

安装质量节拍 skill 只会带来门禁文本，真正生效还需要仓库脚本与计划任务；bootstrap 就是让新机器补齐这部分的统一入口。

## 健康守护

只读健康检查：

    powershell -ExecutionPolicy Bypass -File scripts/mp-worktree-health.ps1 -RequireClean -RequireHooks

检查内容包括：主 worktree 是 main、工作区干净、没有 shared-root-violation、hooks 与源码 SHA-256 一致，以及 linked worktree 都位于隔离目录（默认 `<仓库父目录>/mp-worktrees`，可用 `-WorktreeRoot` 覆盖）。报告默认写入 %LOCALAPPDATA%\Mulpub\session-isolation\health.json，不写入仓库。

**受管外来 worktree 登记制（2026-10-01）**：harness 级工具（如 WorkBuddy 的项目工作区）会向共享仓库注册隔离目录之外的 linked worktree，健康门禁原本一律判红，导致所有新会话的 `start-mp-task.ps1` 被挡死。现在允许把这类 worktree 登记进机器本地注册表 `%LOCALAPPDATA%\Mulpub\session-isolationallowed-worktrees.json`（JSON 字符串数组，整路径精确匹配，不做前缀通配）；也可用环境变量 `MP_ALLOWED_WORKTREES`（分号分隔）临时追加。已登记的路径在报告 `exemptedWorktrees` 留痕；注册表 JSON 损坏时按空表处理（fail-closed），报告置 `allowedRegistry.valid=false`。未登记的外来 worktree 仍然一律红。传入 -RequireWriteGuard 时，还会要求实时写保护任务已注册且 watcher 正在运行。

**登记表的生命周期与登记入口（2026-10-14）**：登记制落地后暴露两个机制缺口，本次一起补上。

1. **陈旧登记项永久残留**：登记表无生命周期管理，条目对应的 worktree 被删后无人知晓。实测现场：wt-mp-ccgrecord 于 2026-10-07 前后消失（既不在 git worktree list、路径也不存在），登记项却一直留到 2026-10-14 才在排查 ok=false 时被发现。现在健康检查报告新增 staleAllowedEntries（判据：条目既不是本仓库已注册 linked worktree、对应路径也不存在），非 -Quiet 时打一行 WARN；**默认仅出声不拦**，因为登记表是机器本地文件，别的会话可能正在登记一个「即将建好」的 worktree，此刻判红会造成无谓阻塞。要把它变成硬闸：设 MP_ALLOWED_WORKTREES_STRICT=1（报告同步置 staleAllowedStrict=true，ok 随之为 false）。
2. **登记只能手改 JSON**：harness 级 agent 工具（auto-exec 类）建外来 worktree 时不会登记，于是 outside 判据必然判红、start-mp-task.ps1 必然跑不完——这是机制性必然而非偶发。现在统一走入口脚本：

        pwsh -File scripts/register-allowed-worktree.ps1 -Register <path>   # 登记
        pwsh -File scripts/register-allowed-worktree.ps1 -Remove <path>      # 注销
        pwsh -File scripts/register-allowed-worktree.ps1 -Clean              # 剔除所有失效项
        pwsh -File scripts/register-allowed-worktree.ps1 -Verify             # 只读自检（逐条报 live/STALE）

    入口脚本在登记/清理时顺手剔除死项，并把动作写入审计日志 %LOCALAPPDATA%\Mulpub\session-isolation\allowed-worktrees-audit.log（与 safe-delete 同目录）。匹配规则与健康检查完全一致：整路径归一化（斜杠统一、去尾斜杠、小写）后精确匹配，不做前缀通配。

    ⚠️ **该脚本刻意保持 ASCII-only**：Windows PowerShell 5.1 读无 BOM 的 UTF-8 文件时按 GBK 解码，注释里的一个中文字符就能解出虚假的引号/括号并让解析器报 ParserError（首版实测踩中：5.1 在只差一条中文注释的行上报 Unexpected token）。因此脚本正文与全部用户可见输出均为 ASCII，断言也匹配 ASCII。

回归锁：scripts/mp-worktree-health.test.ps1 的 case 11-17（默认出声 / STRICT 判红 / 活项不算 stale / 入口四动作 + 幂等 + Verify 只读）。

## 实时写保护

写保护由 scripts/guard-shared-root-writes.ps1 执行，随当前用户登录自动启动。它监听共享主目录，把 apps/、packages/、ops-center/、config/、.github/ 等运行时路径下非 gitignored 的新建/修改/删除文件移入：

    %LOCALAPPDATA%\Mulpub\session-isolation\quarantine\

tracked 文件会从 HEAD 精确恢复，违规记录追加到同一目录的 violations.jsonl。docs/、01-docs/、scripts/、openspec/、.ccg/、.agent_context/、.hermes/ 及根级流程文档保持可写；node_modules/、dist/ 等 gitignored 构建产物不会被误隔离。文件被占用时只做有界重试并保留原文件，不会覆盖或删除数据。

隔离动作发生时，写保护还会在共享根 `.agent_context/write-guard-alert.json` 写入最新违规快照（ts/path/action/hint）。该放行目录会被 AI 会话读取；配合编辑前运行的 `scripts/pre-code-edit-guard.ps1`（在共享主目录 BLOCKED 时自动展示最近违规与 worktree 指引），让会话直接感知 write guard 的存在与正确工作流，而不是被静默恢复后无从得知。

## 依赖复用与 node_modules Junction 禁令

worktree 依赖通过 pnpm 全局 store 硬链接复用（`pnpm config get store-dir` 指向 `D:/Data/projects/.pnpm-store`）：每个 worktree 的 `node_modules` 只含指向 store 的链接与 workspace 链接，`@multi-publish/*` 由 pnpm 自动指向**当前** worktree 的 `packages/`。

**禁止整目录 Junction 复用 node_modules**：历史方案级联共享物理 `node_modules`，导致 `@multi-publish/*` 解析到其它 checkout（双模块实例）；`scripts/fix-worktree-node-modules.sh` 用于检测与修复此类残留。

新 worktree 依赖就绪可走秒级复用：`scripts/prepare-worktree-deps.ps1 -Worktree <dir>` —— store 热时零下载、electron 幂等跳过、`verify-worktree-deps` 门禁保证解析正确；等价于 pnpm store 的「软链接」效果，但不引入 node_modules junction。

## Windows 计划任务

当前用户注册两个任务：健康巡检每 15 分钟运行一次（可用 -Minutes 调整为 1-60 分钟），写保护在登录时启动：

    powershell -ExecutionPolicy Bypass -File scripts/install-session-isolation-task.ps1 -Minutes 15

查看任务：

    Get-ScheduledTask -TaskPath '\Mulpub\'

移除任务（同时移除健康巡检与写保护）：

    powershell -ExecutionPolicy Bypass -File scripts/install-session-isolation-task.ps1 -Unregister

健康巡检只读，不会自动 stash、切分支、删除文件或覆盖用户变更；写保护会自动隔离运行时目录的直接写入并把 tracked 文件恢复到 HEAD。异常时通过退出码、用户目录 JSON 和隔离日志暴露问题；恢复动作仍使用 session-init.sh 或 safe-worktree-remove.ps1。

## 冷克隆引导的两个已知拦路石（git 2.55 实测）

新电脑跑 `scripts/bootstrap-write-guard.ps1` 时，会在 `[2/5] 自检` 阶段失败，导致 `[3/5] 注册计划任务` 与 `[4/5] 启动 watcher` 永远到不了。两处原因：

1. **`git hash-object` 参数互斥**：`guard-shared-root-writes.ps1` 的 `Test-MatchesIndex` 曾用 `hash-object --no-filters --path <p> -- <file>`。git 2.55 的 usage 明确 `--path=<file>` 与 `--no-filters` 互斥，同时传是**直接 error 而非降级**，于是守护碰到「被改动的 tracked 文件」整链失败：
   `error: Can't use --path with --no-filters`。原始字节口径不需要 `--path`；过滤器口径仍由紧随其后的 `$filteredHash` 覆盖，两级比对语义不变。
2. **自检夹具与真实仓库不同形**：`session-write-guard.test.ps1` 的临时仓库 `.gitignore` 原本只有 `node_modules/` 与 `dist/`，缺 `.agent_context/`（仓库根 `.gitignore` 是忽略它的）。而守护按设计会在仓库根写 `.agent_context/write-guard-alert.json` 供后续会话感知违规，于是断言「restore 后 status 仍干净」把这个设计内的文件误判为脏。

两点排查提示：

- 自检里 `PASS: tracked file is restored from HEAD` 读的是 `git show HEAD:<path>`（HEAD 内容），**不检查工作区文件**，属假 PASS；真正有信号的是紧随其后的 status 干净断言。改这类断言时留意别被它骗过。
- 手工复现守护行为时，Git Bash 的 `/tmp` 与 Write 工具的 `/tmp` 可能映射到不同盘符目录；给 PowerShell 传路径要用 `cygpath -w` 取真实 Windows 路径，否则会静默命中不存在目录的分支。

修复后 `session-write-guard.test.ps1` 应输出 `PASS: 14 session write guard checks`。

## 控制台窗口与运行主体（2026-10-03 实测）

开发过程中桌面反复弹出 PowerShell 窗口，来源有两个，结论都推翻了「想当然的修法」：

- **任务入口**：`start-mp-task.ps1` 过去默认开一个 `-NoExit` 的常驻 shell，父进程一退出它就变成孤儿窗口，每建一个隔离任务就多一个。现在默认不开窗，需要 shell 时显式加 `-Shell`。
- **计划任务**：两个任务原先以交互主体注册，每次运行都创建一个可见控制台窗口（健康巡检每 15 分钟一次，即「反复闪窗」的节拍源）。判据**不是**「设 Hidden」：实测 `Settings.Hidden=True` 之后手动触发，300ms 内仍新增一个可见顶层窗口；把主体换成非交互（`LogonType=S4U`）后同一探针 `NEW_TOTAL=0`，而任务确实执行（health.json 的 `checkedAt` 前进、`LastTaskResult=0`），write guard 在 S4U 下仍在约 1 秒内把探针文件移入隔离区并记入 `violations.jsonl`。
- **S4U 必须提权注册**：同一段安装逻辑指向一次性 `-TaskPath` 在非提权下运行，S4U 尝试被拒、任务落成 `Interactive` 并打出 WARN。所以安装脚本按 `S4U → Interactive` 兜底，而不是硬失败——窗口可见只是外观损失，任务注册不上才是防线缺失。要拿到无窗口的主体，就用提权方式跑安装（`bootstrap-write-guard.ps1` 本来也必须提权，因为 AtLogOn 触发器）。
- **存活判定不得依赖跨会话可读字段**：S4U 实例运行在别的 session，非提权调用读不到它的 `CommandLine`（该属性返回 `$null`），拿名字匹配就会把**正在执法**的 watcher 判成「未运行」。`mp-worktree-health.ps1` 因此改以任务自身 `State -eq 'Running'` 为主判据，`CommandLine` 匹配只保留为兜底佐证。

回归锁：`scripts/start-mp-task.test.js` 的「任务入口默认不得开窗」「注册主体合同」「存活判定合同」三条。三条都做过变异反证：退化成无条件开窗 / 主体顺序倒回 Interactive 优先 / 判定退回只看 `CommandLine`，各自让对应锁当场变红，且还原后文件逐字节相同。

## 自检

    powershell -ExecutionPolicy Bypass -File scripts/session-isolation-automation.test.ps1
    powershell -ExecutionPolicy Bypass -File scripts/session-write-guard.test.ps1

自检覆盖脚本存在性、当前主目录健康状态、报告写出、main/primary 识别、计划任务注册后稳定指向共享主目录 scripts 的合同，以及写保护的隔离/恢复/放行行为。计划任务注册/注销全部发生在一次性 `-TaskPath` 上，绝不触碰生产任务（`\Mulpub\`），自检因此不会关闭持续守护；非提权宿主上 AtLogOn 写保护任务注册被系统拒绝时，安装器必须以非零退出并给出提权重跑指引——该失败路径同样是被断言的合同。

## 边界

Git 没有 pre-checkout hook，Git hooks 不能阻止所有客户端的首次目录选择；--no-verify 也能跳过提交 hook。因此新任务必须从 start-mp-task.ps1 入口创建，Git hooks、实时写保护、健康守护和 GitHub 分支保护分别承担入口、直接落盘拦截、持续发现和远程交付兜底。

### 同一份瞎探针的第二落点（外部评审捞出的观察，2026-10-04）

第一版只修了 `mp-worktree-health.ps1`。codex 侧评审虽然中途截断没出结论，它的一条观察经我自己复核成立：`scripts/bootstrap-write-guard.ps1` 里也有「按 CommandLine 认守护」的判据，而且比报个 `running=false` 更糟——它据此决定是否 `Start-ScheduledTask`，30 秒轮询看不见就直接抛「Write Guard watcher 未在 30 秒内启动」。照旧逻辑，S4U 会把一台健康机器判成装配失败。两处现已统一为「任务 State 优先、CommandLine 只作兜底」，防再犯锁也改成按特征扫全域并钉住文件清单（只能缩小），而不是点名我记得的两个文件。
