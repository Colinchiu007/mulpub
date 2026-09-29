# PROJECT-003 Multi-Publish — 开发流程规范

本文件定义本项目开发的完整 SOP。支持 `AGENTS.md` 的 AI 工具（Cursor、Claude Code、Cline、Windsurf、GitHub Copilot 等）启动时自动读取，确保所有 AI 协作按规范执行。

## 语言约定

- **与用户交流默认使用简体中文**：所有面向用户的对话、解释、总结、报告、评审意见一律使用简体中文回复。

- 用户明确要求使用其他语言（如 English）时，优先遵循用户当前指令。

- 代码注释、commit message、文档按项目既有语言习惯执行（本项目以中文为主）。

***

## 核心原则

- **先文档再代码**：没有 PRD 不动手，没有架构设计不动手

- **TDD**：测试先于代码，提交前全部测试通过

- **Code Review**：每 2-3 个功能 review 一次

- **git 提交**：所有变更必须 commit，不允许未跟踪代码

- **分支隔离（分层）**：分层判定只看「是否影响运行行为」——运行时代码变更（apps/、packages/ 及关联配置/CI）必须在 git 分支上进行，禁止直接在 main 主分支上修改，经 PR 审查与 CI 后合并回 main；纯流程/规格/文档变更（openspec/、.ccg/、docs/、scripts/ 工具脚本、CHANGELOG、.quality-gates.md）**不需要独立 worktree，可在共享主工作区就地编辑，但同样必须经 PR 落地——不存在「直接提交到 main 并推送」这条路**。原因是远端分支保护对任何推入 `refs/heads/main` 的变更一律返回 `GH011: Repository rule violations found for refs/heads/main`（required status checks 在直推路径上无法满足），2026-09-26 以纯 `.quality-gates.md` 回填提交实测被拒后确立，见 PR #2411。共享根另有 `[shared-root-guard]` 会把它强制切回 main、禁止离开 main，因此文档类提交的做法是：在本地 main 上 commit → `git branch <name>` 保住该提交 → `git reset --keep origin/main` → 推 `<name>` 开 PR。分层边界以 openspec/specs/openspec-integration/spec.md「分层分支策略」Requirement 为准。

- **⛔ Worktree 隔离（并发会话铁律）**：共享仓库根（例如 `D:/Data/projects/Mulpub`）是 **main-only 协调目录**，必须保持干净并停留在 `main`；不得作为运行时代码任务的 cwd，也不得执行 `git checkout` / `git switch` 到 feature 分支。每个运行时代码任务统一从 Git for Windows Bash 运行 `scripts/session-init.sh <task-name>`，在默认 `<仓库父目录>/mp-worktrees/mp-<task-name>`（可经 `-WorktreeRoot` / `MP_WORKTREES` 覆盖）与**裸 `<task-name>` 分支**中工作（`scripts/gwm-task.sh` 自 2026-09-15 起默认不加分隔符前缀，因为含斜杠的分支名在本机 ref 写入不可靠；需要前缀时显式设 `MP_BRANCH_PREFIX`，例如设 `MP_BRANCH_PREFIX=team` 才得到 `team/<task-name>`）；同名路径已被其他仓库或错误分支占用时必须 fail closed。隔离 worktree 由 pre-commit 自动声明当前分支；共享主目录仅允许 `powershell -ExecutionPolicy Bypass -File scripts/session-guard.ps1 -Branch main`。**已有多个会话绑定同一共享 cwd 时，先暂停所有 Git 写操作，再逐个串行迁移；禁止并行 handoff/stash/checkout，因为 stash、index 与 HEAD 属于同一 Git 状态，会互相竞争。** 新 worktree 依赖就绪：`pnpm install --frozen-lockfile && node scripts/ensure-electron.js && node scripts/verify-worktree-deps.js`。统一使用 Git for Windows Bash（`start-mp-task.ps1` 自动探测，可经 `-GitBash` / `MP_GIT_BASH` 覆盖）；本机裸 `bash` 可能解析到 WSL，不得用于此流程。

- **⛔ Worktree 清理防护铁律（R1-R5）**：删除任何 worktree 前必须：(R1) 对主工作区做基线快照（`git status --porcelain` + stash 数），删除后 diff 基线，出现新增 D/消失的 M 立即报错；(R2) 禁止宽目录恢复/清理（`git checkout -- <目录>`、`git restore <目录>`、`Remove-Item <目录> -Recurse` 一律禁用），恢复只针对 `git status` 精确列出的文件；(R3) 删除前扫描目标 worktree 的 junction/reparse point，凡指向主工作区的共享链接先解除再删，否则会级联删除主工作区物理文件；(R4) 对主工作区做批量操作前，未提交修改（M/A）先备份到 `%TEMP%` 或精确 `git stash push -- <路径>`；(R5) `git worktree remove --force` 是最后手段，使用前必须完成 R1/R3 并确认 dirty 清单无价值。标准流程已落地为 `scripts/safe-worktree-remove.ps1`（删除）与 `scripts/safe-restore-deleted.ps1`（恢复），涉及 worktree 删除/文件恢复一律调用这两个脚本。

- **错误处理**：所有关键路径必须有错误处理

## 会话隔离自动入口与持续守护

运行时代码任务必须从 scripts/start-mp-task.ps1 -TaskName <kebab-case> 启动；该入口会校验共享主目录、安装 hooks，并创建独立 worktree（默认 `<仓库父目录>/mp-worktrees`，路径可经 `-WorktreeRoot` / `MP_WORKTREES` 覆盖）。共享根目录健康检查由 scripts/mp-worktree-health.ps1 执行，Windows 当前用户计划任务由 scripts/install-session-isolation-task.ps1 注册。该脚本自 2026-09-28 起有两个新约束：`-TaskPath` 可指向一次性路径（**自检与测试必须用它**），而 `-Unregister` 打向生产路径 `\Mulpub\` 一律拒绝、须显式加 `-AllowLiveUnregister`。原因是「先 `-Unregister`、随后重注册因提权失败」会把共享根实时写保护**静默拆掉**：AtLogOn 触发器非提权注册一律 `PermissionDenied / HRESULT 0x80070005`（同一次探针里非 AtLogOn 的健康巡检任务可正常注册并删除，所以提权门槛精确只在 AtLogOn 那一格）。注册结果一律以 `Get-ScheduledTask` 产物为准，**不得看 rc**：`Register-ScheduledTask` 失败抛的是非终止错误、不写 `$LASTEXITCODE`，只看 rc 会把「一条都没注册上」报成成功（本仓实测踩过两次）。**接线进 CI 的机器态断言，必须先在「runner 态」本机跑一遍**——CI runner 上 `\Mulpub\` 根本不存在，而 PowerShell 里 `function F { @(...) }` 的隐式输出会把空数组**摊平成 `$null`**（实测 5.1：`(F1)` 为 NULL，`,` 前缀与调用点 `@(F1)` 才是 Object[] 长度 0），于是 `Compare-Object $a $b` 报「无法将 Null 值绑定到 -ReferenceObject」；正解是让快照函数**不返回任何东西**、改写 `$script:` 变量并用 `-join '|'` 的字符串比较（串不可能为 null 也不会摊平）。另两条同场实测：`-Watch` 没有单实例锁，重新注册计划任务会与既存 watcher **并存**（两份 FileSystemWatcher 各记一条 violation）；注册 AtLogOn 需要提权，但 `Start-ScheduledTask` 拉起已注册的任务**不需要**——用任务本身重启 watcher 是唯一有产物的路径。完整说明见 docs/session-isolation-automation.md。不得把运行时代码任务直接绑定到共享仓库根；新电脑克隆后先运行 `scripts/bootstrap-write-guard.ps1` 完成 hooks、计划任务、watcher 与自检，仅安装质量节拍 skill 不会自动启用该机制。

- **⛔ 共享主目录实时写保护**：共享仓库根下 `apps/`、`packages/`、`ops-center/`、`config/`、`.github/` 等运行时路径禁止直接落盘；`scripts/guard-shared-root-writes.ps1` 由 Windows 计划任务 `Session Isolation Write Guard`（AtLogOn）常驻监听，非 gitignored 文件移入 `%LOCALAPPDATA%\Mulpub\session-isolation\quarantine\`，tracked 文件从 HEAD 精确恢复并写 `violations.jsonl`；放行 `docs/`、`01-docs/`、`scripts/`、`openspec/`、`.ccg/`、`.agent_context/`、`.hermes/` 及根级流程文档。任务开始与提交前必须确认 Write Guard 任务已注册且 watcher 运行、共享根保持 main clean。

- **质量节拍强制卡点**：提交前必须完成 `.quality-gates.md` 自检清单，违反不允许提交

### docs-only 快速通道（2026-10，change: docs-only-ci-shortcircuit）

纯文档/流程变更走精简门禁。判定**必须**用单一真源脚本（与 CI changes job 同一实现，禁止人工目测、禁止第二份白名单）：

```
node scripts/classify-docs-only.js --base=origin/main --head=HEAD
```

- 判定 `docs-only=true`（全部改动文件命中文档白名单 `CI_IGNORED_PATHS`，与 push paths-ignore 同源）：
  - **保留门禁**（文档 PR 的真实风险面，一条不省）：①变更类型与隔离声明（就地编辑 + PR 落地，不进 worktree）；②行尾/编码对账（`git diff --numstat` 与 `--ignore-cr-at-eol --numstat` 两口径一致）；③品牌残留 `node scripts/check-no-brand-residue.js`（文档里如实写竞品名会打红，正解写「参考产品」）；④doc-gate 文档同步检查；⑤CHANGELOG 收口（如适用）；⑥远程同步（PR 合并核对）。
  - **跳过**（与运行时无关）：QM-1 打包、QM-2 代码必检项、QM-4 视觉、TDD（无代码）、QM-6 双模型评审。
  - CI 侧由各全量 workflow 的 `changes` job 自动短路重型 job（job 级 `if`，skipped 满足 required check；触发级 paths-ignore 仍是禁区），无需人工干预。
- 判定 `false`（混合 PR，含任一代码/依赖/CI 路径）→ 完整质量节拍，不得借道本通道；改 `.github/workflows/`、`scripts/` 工具脚本自身的 PR 属混合 PR。
- `.quality-gates.md` 记录用精简模板（判定证据必须写入）：

```
## 本次执行记录：<标题>（<slug>，<date>）【docs-only】
- 判定：node scripts/classify-docs-only.js --base=origin/main → docs-only=true（files=N：<文件清单>）
- 保留门禁：行尾对账 ✅ | 品牌残留 ✅ | 文档同步 ✅ | 远程同步 PENDING→PASS
- 备注（可选）
```

- 反向约束：本通道只豁免「与运行时无关」的门禁；`--no-verify` 仍然禁止；判定脚本自身故障（git 取证失败）时 fail-closed 按混合 PR 处理。

### 机制硬化补充（2026-08-08，与 openspec/specs/openspec-integration/spec.md 同步）

- **远程同步**：任务标记 completed 前必须核对关联 PR 已合并或记录 remoteStatus，禁止基于滞后状态做重复工作。

- **子代理降级**：派发探子前探测子代理可用性；出现 403/超时等后端不可用错误时立即降级为主代理直接执行，不盲等。

- **OpenSpec 引导**：OpenSpec 已启用——M+/中高风险任务须经 `/opsx:propose` 建 change，机制契约见 `openspec/specs/openspec-integration/spec.md`。

- **locale 成对修改（i18n-content-sync）**：修改 `apps/desktop/src/locales/zh.js` 或 `en.js` 必须成对提交（CI Gate 7 `.github/scripts/check-locale-sync.js` 拦截）；新增用户可见文案一律写入 locales（zh/en 成对），渲染端 `src/` 非 locales 文件新增中文字符串字面量由 CI 基线扫描拦截；产品名词翻译集中维护于 `01-docs/i18n-glossary.md`。

- **提交分支守卫**：pre-commit 强制校验当前分支 == `.agent_context/expected-branch`（会话声明），无声明或分支不符一律拦截，docs-only 提交同样校验；隔离 worktree 提交时自动声明当前分支（无需手动）；共享主工作区必须运行 `scripts/session-guard.ps1 -Branch <期望分支>`（不传 -Branch 自动取当前分支）。钩子安装在共享 `.git/hooks/`：隔离 worktree 零手动步骤；共享主工作区无声明/不符一律拦截并提示声明命令；`--no-verify` 可绕过钩子，属流程纪律威慑，禁止使用。

### 隔离失败/冲突防坑纪律（2026-08-26 复盘，硬规则）

> 以下条目由一次「worktree 半失效 + 并发冲突」事故复盘得出，属于不可绕过的硬纪律。

**根因复盘（4 类问题叠加）：**

1. **路径规范不一致（系统性根因）**：Git for Windows 在 Git Bash 下遇到 `/d/...` POSIX 路径会拼成 `D:/d/...` 混写，使 worktree 的 `gitdir` 链接、含 `/` 的分支 ref 写入全部落到不存在的位置（分支 ref 静默 rc=0 但从未落盘），worktree 半失效。结论：**任何 git 写操作（worktree add / branch / checkout / commit）必须用 PowerShell 原生** **`D:\`** **路径执行，绝不在 Git Bash 下用** **`/d/...`** **绝对路径做 git 写。**
2. **隔离创建失败即高危手动补救**：共享根有前序脏改动 → 严格入口 `start-mp-task.ps1 -RequireClean` 被拒；fallback `git worktree add -b codex/...` 因 ref 解析异常失败后，手动 `rm` worktree 注册 + `prune`，把当前 git 上下文一并搞乱。
3. **坏 cwd 下跑 git**：shell 卡在失效 worktree 的 cwd，导致 `git -C` 共享根报 "No such file"。
4. **无并发冲突预检**：开 worktree 前没查已有 worktree 是否改同文件。

**行为层硬纪律（立即可执行，最高优先级）：**

- **A. 隔离创建失败 → 立即停、报告用户，绝不手动** **`rm`** **worktree 注册、绝不在共享根落盘。** worktree 删除/恢复只走 `scripts/safe-worktree-remove.ps1` / `scripts/safe-restore-deleted.ps1`（铁律 R1-R5）；孤儿注册清理用 `git worktree prune`。

- **B. git 写操作一律走 PowerShell 原生** **`D:\`** **路径**：worktree add / branch / checkout / commit / push 均在 PowerShell 下执行（Git Bash 的 `/d/` 路径会触发 `D:/d/` 混写，使含 `/` 的分支名 ref 静默写失败）。只读/相对路径操作（status、show-ref、diff）可在 Git Bash 下进行。

- **C. 写码前先** **`git rev-parse --abbrev-ref HEAD`** **确认当前不是共享根的** **`main`；任何 git 写操作前先** **`cd`** **到中立目录再** **`git -C <绝对路径>`，不在可疑 cwd 跑 git。**

**工具层（治本，待排期）：** 统一路径规范（bash 侧 `cygpath -u`、PowerShell 侧 `cygpath -w`）；`git worktree add` 后立即 `git -C <绝对路径> rev-parse --show-toplevel` 验证可进入，失败则 `git worktree remove --force` 并告警，不留半失效注册。**⛔ 隔离入口脚本自身的退出码不得与副作用不一致（2026-09-27 实测并修复）**：`start-mp-task.ps1` 顶部 `$ErrorActionPreference='Stop'` 与 `:63` 的 `$output = & $bash … 2>&1` 组合，在 PowerShell 5.1 下会把 git **成功时**写的 stderr（实测 `Preparing worktree (new branch 'x')`）变成终止性 `NativeCommandError` ⇒ worktree 已建成却 rc=1，并跳过 `.git` 校验、结果报告与开 shell（曾两次被误判成「静默失败」和「只有 fetch 失败才 rc=1」）。这类错配才是"半失效 worktree + 手动 rm 注册"事故的上游。**口径**：① 凡在 PS 里用 `2>&1` 捕获 native 子进程输出，捕获期必须临时 `$ErrorActionPreference='Continue'` 并在 `finally` 原样恢复，判成败一律用 `$LASTEXITCODE` + 显式产物校验；② 判该入口成败一律以 `git worktree list` + `git -C <路径> rev-parse --abbrev-ref HEAD` 实证，不得以 rc 或管道末段退出码（`cmd | tail` 会吃掉真 rc）代替；③ 回归锁 `scripts/start-mp-task.test.js`（结构锁，已接 `quality-gate.yml` Gate 2b）—— 新增任何 `2>&1` 捕获点而未处在放宽作用域内即变红；注释行里的 `2>&1` 不算捕获点（判据要求同时出现调用运算符 `& $`）。

**流程层（防并发冲突）：** 开 worktree 前先 `git worktree list` + 扫 `.git/worktrees`，检查同模块活跃 worktree；建立中央登记 `openspec/active-tasks.json`（分支 + 改动文件清单），开新任务前比对，合并后销账。

## 强制流程规则（MUST）

> **所有涉及代码修改的任务，无论规模大小，都必须强制触发质量节拍。**

### 触发条件（满足任一即触发）

1. **代码修改**：编辑现有文件、创建新文件、删除文件
2. **用户请求**：提到实现、修复、重构、优化、添加等动词
3. **功能相关**：提到具体功能名称（如登录、发布、设置）
4. **Bug修复**：报错排查、行为异常、紧急修复
5. **新功能**：全新模块、特性添加、功能扩展
6. **重构**：代码结构调整、性能优化、安全加固
7. **配置变更**：环境配置、CI/CD、依赖调整
8. **文档变更**：README、API文档、使用说明
9. **会话隔离**：任何运行时代码任务启动前，必须先验证会话隔离状态

### 自动检测机制

在执行任何代码修改前，AI必须自动检查：

1. **文件修改检测**：即将执行 apply\_patch、git add、git commit 等操作
2. **用户意图检测**：用户消息包含代码相关关键词
3. **任务类型检测**：当前任务涉及代码实现、修复、优化等

**检测到任一条件 → 立即触发质量节拍，不等待用户确认。**

### 会话隔离前置检查（MANDATORY）

在执行任何 apply\_patch / git add / 文件修改前，**必须先运行 pre-flight 守卫脚本**：

powershell -ExecutionPolicy Bypass -File scripts/pre-code-edit-guard.ps1

exit 0 -> 放行（当前在 worktree 或非 git 目录）
exit 1 -> 拒绝（当前在共享主目录，禁止修改）

**其他检查项（并行确认）：**

1. **确认入口**：运行时代码任务必须从 scripts/start-mp-task.ps1 -TaskName <kebab-case> 启动
2. **确认写保护**：写保护 watcher 必须存活（Session Isolation Write Guard 计划任务状态为 Running）
3. **确认健康**：mp-worktree-health.ps1 -RequireWriteGuard 检查通过

**未通过 pre-code-edit-guard -> 不允许开始代码修改，立即创建 worktree。**

### 违反后果

- **未触发质量节拍的代码修改**：不允许提交

- **跳过质量节拍流程**：Code Review 打回

- **绕过强制检查**：视为流程违规

### 触发方式

在开始任何代码修改前，AI必须先执行质量节拍技能

或者使用触发词：质量节拍、quality rhythm、门禁、流程、日常循环、阶段检查

***

## AI 角色分工

| 角色            | 阶段   | 产出物            |
| ------------- | ---- | -------------- |
| **PM（产品经理）**  | 需求分析 | PRD、用户故事、功能列表  |
| **架构师**       | 技术设计 | 架构图、技术选型、目录结构  |
| **开发工程师**     | 编码实现 | 功能代码、单元测试（TDD） |
| **QA（测试）**    | 质量验证 | 测试用例、测试报告      |
| **CTO（技术总监）** | 代码评审 | 审查意见、安全审计      |

切换角色口令：

> 「现在你作为 PM，写 PRD」
> 「切换成架构师角色，设计技术方案」
> 「作为 CTO，review 一下这段代码」

***

## 7 阶段开发流程

### 阶段 1：想法澄清（CEO + COO）

把模糊想法变成一句话需求，确认：项目名称、目标用户、核心价值、MVP 范围。

### 阶段 2：PRD（PM）

产出：PRD，包含目标用户、P0/P1/P2 功能列表、验收标准、非功能需求。
**CEO 签字确认后才能进入下一阶段。**

### 阶段 3：技术架构（架构师）

产出：2-3 个方案对比、推荐方案、目录结构、数据流。
**原则：选最简单的方案，能不用数据库就不用，能不用第三方服务就不用。**

### 阶段 4：开发计划（PM）

把 MVP 拆成 ≤4h 的任务，标注依赖关系，标注可并行项。

### 阶段 5：编码实现（开发 + TDD）

- 先写测试，再写代码

- 每次完成做手动验证：能启动 ✅/核心功能 ✅/非法输入不崩溃 ✅/错误提示友好 ✅

### 阶段 6：代码评审（CTO）

整库扫描以下维度：

- **安全**：硬编码密钥、Shell 注入、eval

- **错误处理**：async vs .catch() 比例（健康 ≤5:1）

- **XSS**：v-html / dangerouslySetInnerHTML

- **Electron 安全**：contextIsolation、nodeIntegration、no-sandbox

- **日志污染**：console.log 在生产代码中

- **硬编码等待**：waitForTimeout

分类输出：

```
🔴 CRITICAL | 文件:行号 | 描述 | 修复建议
🟠 MAJOR   | 文件:行号 | 描述 | 修复建议
🟢 MINOR   | 文件:行号 | 描述 | 修复建议
```

CRITICAL 必须修复才能继续。

### 阶段 7：发布（运维）

打包/部署、生成安装包或部署指南、git tag。

***

## 质量门禁

**会话隔离**：worktree 已创建 ✅ / 写保护 watcher 运行中 ✅ / 健康检查通过 ✅
**PRD 阶段**：MVP 范围清晰 ✅ / 验收标准可验证 ✅ / CEO 签字确认 ✅
**架构阶段**：最简单方案 ✅ / 目录结构明确 ✅
**开发阶段**：测试全通过 ✅ / 核心功能可手动验证 ✅ / 错误处理到位 ✅
**Code Review**：CRITICAL 问题已修复 ✅ / 代码规范一致 ✅
**发布阶段**：安装包可用 ✅ / git 已提交并 tag ✅

***

## 实用沟通模板

**启动任务**：

```
按正规开发流程实现 [功能]。先写测试，再实现，再 review。不跳步骤。
```

**加新功能**：

```
① 分析是否在 MVP 范围内
② 写功能规格
③ TDD 实现
④ 跑测试
⑤ Code Review
```

**改需求**：

```
先停。需求调整：[改动]。更新 PRD，告诉我哪些已完成的代码需要改。
```

**报错**：

```
[贴完整错误栈]。分析根因，给出修复方案。
```

### Bug 处理 SOP

发现 Bug 或被告知 Bug 时，按以下步骤处理：

1. **根因溯源**：不要只修表面。找到这个 Bug 的**第一性原因**（最原始的代码改动引入点）。用 git blame 追溯到具体 commit，确认该次改动的意图（重构 / 修另一个 bug / 新功能）
2. **逃逸分析**：追溯这个 Bug 逃过了哪些测试？为什么逃过的？按测试层级逐层输出**逃逸链**（单元测试 → 集成测试 → 端到端测试 → 视觉回归 → 代码审查），每层说明为什么没拦住
3. **系统性漏洞定位**：在现有测试机制里找到**具体的系统性漏洞**，分类为：测试场景缺失 / 测试质量不足 / 审查盲区 / 流程缺失
4. **修复 + 回归保护**：给出修复方案 + 这个 Bug 的**回归保护测试**（明确测试怎么写、放在哪个文件、用什么模式：单元/集成/E2E/视觉回归）
5. **预防措施**：怎么防止再次发生 —— 更新测试场景模板 / 审查清单 / 质量节拍流程 / learnings，必须有具体文件变更落地

***

## 避坑清单

1. 不写 PRD 直接开发 → 做着做着不知道要做什么
2. 不写测试 → 改一行崩一片
3. 不做代码评审 → 代码越来越乱
4. 不建 git → 改坏了救不回来
5. 一次说太多需求 → AI 记不住，漏掉
6. 不问「为什么这么选」→ 被带进复杂方案
7. 不做手动验证 → 测试过但实际用不了

***

## 参考文件

- `01-docs/PRD.md` — 产品需求文档

- `01-docs/P0-IMPLEMENTATION-PLAN.md` / `01-docs/P1-IMPLEMENTATION-PLAN.md` / `01-docs/P2-IMPLEMENTATION-PLAN.md` / `01-docs/P3-IMPLEMENTATION-PLAN.md` — 各优先级实现计划（为独立文件，不存在合并的 `P0/P1/P2-IMPLEMENTATION-PLAN.md` 单文件）

- `01-docs/ARCHITECTURE-PLAYWRIGHT.md` — 架构设计

- `01-docs/DEVELOPMENT_REPORT.md` — 开发报告

- `CHANGELOG.md`（仓库根）— 变更日志

- `01-docs/DESIGN.md` — 设计规范

- `01-docs/INTEGRATION.md` — 集成说明

> 以上路径均经 `git ls-files` 核实存在于当前仓库。历史裸名（如根级 `PRD.md`、`DESIGN.md`）指向仓库根并不存在的文件，会让走「先文档再代码」前置门的人读到空文件、误判缺 PRD 而跳过门禁。

## 目录结构

```
.
├── apps/desktop/          # Electron 桌面应用
├── packages/
│   ├── ai-writer/         # AI 写作引擎
│   ├── ai-writer-api/     # AI 写作 API 封装
│   ├── api-publish-engine/ # API 发布引擎
│   ├── python-backend/    # Python 后端
│   ├── remotion-composer/ # Remotion 视频合成
│   ├── rpa-engine/        # RPA 发布引擎
│   └── shared-utils/      # 共享工具库
├── ops-center/            # 运营后台（FastAPI :8010 + Vue3 :5173，独立 Python/Node 依赖；登录与鉴权均由本服务自持——/api/auth 走 :8010 自己签发会话，2026-08-10 起不再经 platform-orchestrator）
│   ├── backend/           #   FastAPI（pytest 门禁：cd backend && pytest）
│   └── frontend/          #   Vue 3 + Vite（build 门禁：npm run build；Vite 代理 /api/auth→orchestrator:8000，/api/v1→ops-center:8010）
├── 01-docs/               # PRD、架构、设计等文档
├── config/                # 配置文件（config.yaml, platforms.yaml）
├── scripts/               # 脚本（check-docs-sync.sh 等）
├── .hermes/plans/         # 实施计划存档
├── .github/workflows/     # CI/CD 配置
├── CHANGELOG.md / README.md / AGENTS.md
└── 01-docs/PRD.md / ARCHITECTURE-PLAYWRIGHT.md / DESIGN.md / DEVELOPMENT_REPORT.md
```

## 打包验证（质量门禁 QM-1 补充）

每次修改 `apps/desktop/electron/` 或 `packages/rpa-engine/` 下代码后：

```bash
cd apps/desktop
rm -rf dist-electron
pnpm exec electron-builder --win --dir --publish never

# 验证 1：asar 文件清单
pnpm exec asar list dist-electron/win-unpacked/resources/app.asar | grep "logger"

# 验证 2：require 链测试
pnpm exec asar extract dist-electron/win-unpacked/resources/app.asar /tmp/app-test
node -e "require('/tmp/app-test/node_modules/@multi-publish/rpa-engine')"

# 验证 3：启动测试（8 秒不崩溃）
dist-electron/win-unpacked/Multi-Publish.exe &
sleep 8 && kill $!
```

- 启动进程存活不等于通过：必须捕获 stderr；出现 `Failed to load platform config`、`PluginLoader.*mkdir failed`、`ENOTDIR.*app.asar` 或配置/插件路径指向 ASAR 内部时，QM-1 失败。

- Git worktree 打包或执行真实 Electron IPC 验证前，必须运行 `node scripts/verify-worktree-deps.js` 确认 `node_modules/@multi-publish/*` 链接指向当前 worktree；禁止借用指向其他分支源码的 workspace 链接（含历史整目录 Junction）生成交付产物或测试证据。

> 本文件由 Hermes `professional-ai-coding-workflow` 技能转换生成，适配通用 AI 编码工具。

***

## 构建与发布

- **依赖管理**：本项目使用 **pnpm**（唯一包管理器，`packageManager: pnpm@11.13.1`，锁文件 `pnpm-lock.yaml`）。所有 `npm ci/npm install/npm run` 均以 `pnpm install --frozen-lockfile` / `pnpm ...` 替代（`node-linker=hoisted`，布局与 npm workspaces 扁平结构一致）。

- **打包**：`pnpm build:win`（需 node\_modules 里有 electron\@43.1.1 + electron-builder\@25.1.8）

- **electron 二进制自愈（方案 B）**：`electron@43.x` 的 npm 包不再声明 `postinstall: node install.js`（31\~41 版本有），`pnpm install` 后 `dist/` 不会自动下载。装完依赖后执行 `node scripts/ensure-electron.js`（缺失时自动触发 `node node_modules/electron/install.js`，优先走本地 `@electron/get` 缓存）；`ELECTRON_SKIP_BINARY_DOWNLOAD=1` 可显式跳过。`electron-ci.yml` 已手动执行 install.js（经 `scripts/run-package-install.js` 放行 esbuild/vue-demi），无需改动。

- **Playwright 浏览器捆绑**：打包前需执行 `cd apps/desktop && PLAYWRIGHT_BROWSERS_PATH=.playwright-browsers pnpm exec playwright install chromium`，浏览器自动捆入 `extraResources`

### 依赖安装与 Worktree 复用（pnpm）

- **全局 store（机器级，不提交）**：`pnpm config set store-dir D:/Data/projects/.pnpm-store`（CI 使用默认 store）。所有 worktree 的依赖均从该 store 硬链接，不重复下载。

- **新 worktree 依赖就绪**：`cd mp-<task-name> && pnpm install --frozen-lockfile && node scripts/ensure-electron.js && node scripts/verify-worktree-deps.js`（首次 \~1 分钟，之后秒级）。

- **解析门禁**：`node scripts/verify-worktree-deps.js` 断言每个被消费的 `@multi-publish/*` 包解析到当前 worktree；打包/测试/截图证据前必须运行。

- **⛔ 禁止整目录 Junction 复用 node\_modules**：它使 `@multi-publish/*` 共享物理链接、并发 worktree 无法解析各自分支源码（双模块实例）。历史 junction 状态用 `scripts/fix-worktree-node-modules.sh` 修复（检测 → 移除 → pnpm install --frozen-lockfile → 门禁）。

- **锁文件变更**：仅在主仓库/单一 worktree 执行一次 `pnpm install` 更新 `pnpm-lock.yaml` 并提交；其他 worktree 用 `--frozen-lockfile` 拉取。

- **离线支持**：安装包自带 Chromium 浏览器（\~170MB），无需代理；
  自动更新模块内置 GFW 网络错误静默处理，无网络时静默失败不弹错

- **CI**：.github/workflows/build.yml 自动完成 Playwright 安装 + 浏览器捆绑

## 强制质量门禁（MUST）

> 违反以下任何一条，任务不算完成。

### QM-1：electron 主进程代码 — 本地打包验证

每次修改 `apps/desktop/electron/` 下的代码后，**必须**在本地执行一次：

```bash
cd apps/desktop && pnpm exec electron-builder --win --x64
```

- ✅ 返回 exit code 0 → 提交代码

- ❌ 打包失败 → 修复后重新打包，直到成功

- ❌ 打包成功但应用启动报错 → 修复后重新打包

**不打包不提交。** 单元测试不能替代完整打包验证（require 路径、文件 glob 覆盖、语法错误等只能在打包产物中检测）。

### QM-2：代码审查必检项

Code review 时除逻辑正确性外，必须逐项检查：

- **require 路径**：每个 `require('../x')` / `require('./y')` 的解析目标文件是否真实存在

- **preload sandbox 兼容**：修改 preload 后必须在 sandbox:true 和 sandbox:false 两种模式下验证 `window.electronAPI` 可用

- **preload 重启验证**：修改 preload.js 后必须重启 Electron 应用（preload 只在窗口创建时加载，Vite HMR 不会热更新 preload）

- **IPC 测试环境**：涉及 IPC 调用的功能必须在 Electron 窗口中测试，浏览器打开 Vite 开发服务器无 `window.electronAPI`，所有 IPC 调用静默 fallback

- **IPC 参数序列化安全**：所有传给 `ipcRenderer.invoke()` / `window.electronAPI.*()` 的参数必须是纯 JSON 对象。Vue ref/reactive 包装的嵌套对象是 reactive proxy，直接传入会报 "An object could not be cloned"。规则：从 Vue ref 取出的对象一律 `JSON.parse(JSON.stringify(obj))` 脱壳后再传 IPC。

- **IPC file URL canonical 合同**：打包 renderer 的 `file://` sender 必须将受信 `app.getAppPath()/dist` 与 sender 文件同时用 `fs.realpathSync.native()` 规范化后再做目录边界比较；允许 worktree/dist-electron junction 的 raw/canonical 根差异，但必须拒绝不存在文件、`dist-evil`、路径遍历及 `dist` 内链接逃逸。修改该逻辑后必须用真实 junction 回归，并在最终打包 Electron 窗口调用受保护 IPC，存活测试不能替代。单元/集成测试必须在 `os.tmpdir()` 自建真实 `dist/index.html`，禁止依赖被 Git 忽略的 `apps/desktop/dist` 构建残留；至少一次在仓库 `dist` 不存在时运行受影响测试。

- **路径层级**：多包工作区中 `..` 层级必须用 path-utils 统一模块，禁止凭直觉估算

- **注释语法**：`/* */` 成对出现，`* text` 开头的行必须前面有 `/*`

- **模块导出**：`module.exports = {` 后不能有多余逗号

- **Story2Video 版本化配置一致性**：`Story2VideoTextConfig` 必须能在没有重复顶层 `text` 时从 `config.prompt` 恢复；renderer、normalizer、YAML 和 compose engine 的枚举、数值边界及默认值必须一致。修改任一层时必须覆盖仅配置恢复、非支持枚举和绕过 renderer 的直接调用。

- **Story2Video 场景上下文朝代成语守卫**：`story-context-engine.js` 的朝代关键词用裸子串匹配（`text.includes(keyword)`），人名类关键词（诸葛亮/曹操/刘备/孙权等）常作为成语/俗语成分（"事后诸葛亮""说曹操曹操到"），会把非该朝代题材整篇误判并污染所有场景。新增朝代关键词时必须：(1) 检查该词是否存在于常见成语中，是则同步登记到 `IDIOM_EXCLUSIONS` 成语守卫表；(2) 回归测试必须同时含正向（真实题材仍识别）与负面（成语/俗语不误判）用例。修改 `detectDynasty`/`keywordHits` 时必须运行 `story-context-engine.test.js` 全量。

- **Story2Video 场景上下文现代信号中和**：`story-context-engine.js` 的朝代判定必须考虑全文现代信号。现代题材全文出现朝代关键词作举例/引用（"比如秦始皇""就像诸葛亮"）时，若现代信号 ≥2 且朝代命中 < 现代信号，`detectDynasty` 应返回 null、`detectEra` 降级 mixed，不得整篇误判为古代。新增朝代关键词或修改 `detectDynasty`/`detectEra` 时必须：(1) 复用模块级 `MODERN_TERMS` 现代信号词表；(2) 回归测试必须覆盖"现代+历史引用不误判朝代""纯历史仍识别""穿越剧不误伤""纯现代不受影响"四类场景。修改 `detectDynasty`/`detectEra` 时必须运行 `story-context-engine.test.js` 全量。

- **Prompt 批量结果内容合同**：`OPTIMIZE_BATCH` 不得只校验 prompt-engine 返回数组的数量；每项必须是非空字符串，或按资产阶段实际读取顺序包含非空 `prompt` / `optimized_prompt` / `optimized`。等长的 `{}`、`null`、空白字段必须在 `StageExecutor` 立即 fail closed。回归测试必须经真实 `PromptBridge`、`ServiceBus` 和本机临时 HTTP 服务覆盖包装响应，不能只 mock 最终数组。

- **打包状态优先于开发环境变量**：许可证、调试入口、logger 和开发短路必须以 `app.isPackaged === false` 为前提；`NODE_ENV=development`、`ELECTRON_IS_DEV=1` 等环境变量不得让已打包应用进入开发权限或开发日志路径。测试必须同时覆盖打包/未打包状态和残留环境变量。
- **发版版本级别 ↔ 改动规模匹配**：合并发版 PR / 打 tag 前，确认 `pnpm version:bump` 的级别与改动匹配（0.x 基线：新功能 / 破坏性变更 bump `minor`，修复 bump `patch`）；`release-gate` 会硬性拦截「未 bump 就打 tag」「CHANGELOG 未收口」，并对「破坏性变更却 `patch` 级」软警告（属人工判断，不阻断）。

- **Adapter capability 单一来源**：修改 `BaseAdapter.KNOWN_METHODS` 后必须检索所有 Adapter 的 `capabilities()` 手动覆盖；已进入 `KNOWN_METHODS` 的能力不得再次 `concat`。回归测试必须断言 `supports(method) === true`、能力只出现一次，并覆盖 `ModelProviderManager` 的调用入口。

- **登录承载路径的观测与节流口径单一来源**：任何新增或改造的登录承载方式（`AuthViewManager.openLogin` 的 `persist:auth-*`、`WebviewManager` 账号标签的 `persist:account-*`、`QrCodeLogin` 扫码视图、`loginSilent` 隐藏窗口）都必须同时满足两条：①在 `loadURL` **之前**挂 `attachLoginNetworkDiagnostics(session, { platform, accountId })`——第三方登录页的二维码由 iframe 加载，其内部请求失败**不触发**外层 `webContents` 的 `did-fail-load`，不挂即日志黑洞；②显式声明 `backgroundThrottling` 取值并给出理由（承载第三方轮询型登录页的视图应为 `false`，先例 `tab-lifecycle.js` / `rpa-view-session.js` / `playwright-manager.js`）。回归锁：`auth-view-manager.test.js` 的「登录视图可观测性」describe 断言 `onCompleted` filter **精确等于** `URL_FILTERS`；修改 `login-network-diagnostics.js` 的 `URL_FILTERS` 或出码端点判定（`getqrcode`）必须同步该断言。诊断属旁路：`try/catch` + warn，**禁止**把 `resolveProxy`/CDP 等异步观测 `await` 在首个导航之前（见 learnings「门控首个导航的异步 promise 必须带超时与销毁守卫」）。另注意 `test-setup.js` 的 `session.fromPartition` 每次返回新 session 对象——诊断幂等标记挂在 session 实例上，共享单例会使「监听注册恰好一次」退化为顺序依赖。③**节流/可见性探针只准读 d.ts 已核实的宿主字段**：视图绘制状态用 `WebContentsView.getVisible()`（继承自 `View`，d.ts 明示它是"应否绘制"，不等于屏幕可见），节流开关用 `webContents.getBackgroundThrottling()`；`getVisibilityState()` / `VisibilityState` 在 Electron 43 的 `electron.d.ts` 里**出现 0 次**，读了就是恒 `unknown` 的死探针（本案真实发生过，且因夹具里手搓该字段而单测全绿）。配套锁：`auth-view-manager.test.js` 的「宿主 API 归属契约锁」describe 直接解析已安装的 `electron.d.ts`，断言 ①我们用到的 `WebContents` 方法全部在 `class WebContents` 段内声明 ②源码不得再出现 `getVisibilityState`。④**定位宿主声明文件禁止数 `..` 层级**：本仓 `node-linker=hoisted`，electron 装在**仓库根** `node_modules`，从 `apps/desktop/electron/services` 数两级 `..` 会指到不存在的 `apps/desktop/node_modules`，使「找不到就 skip」的锁**永久静默跳过**（本案实际发生过：通配锁本地与 CI 全程未执行，却被登记为"反证已实测变红"——那 2 个红来自日志格式断言）。正确做法：从 `__dirname` **逐级上溯**查找目标文件、找不到即红（不允许 `return` 跳过）、并对解析结果加**规模下界断言**（如声明集 `size > 100`），否则"解析退化成空集合"会让通配锁假绿。反证纪律：任何"防再犯锁"必须做一次**把锁本身改成 no-op 必须立刻变红**的变异，只证"业务改动变红"不能证明锁在跑。⑤**节流取值按「是否可能长时间不被绘制」分两档，四类承载都必须把值写出来**：`show:false` 全程或加载期隐藏的承载（`loginSilent`、OIDC `identity-auth-window`）必须 `backgroundThrottling:false` —— 隐藏页不绘制会停掉 rAF 并降频定时器，凡"要等页面 JS 走到跳转/写 storage 才收凭证"的逻辑都会被拖；建好即 `setVisible(true)` 的可见承载（`openLogin` 视图、`QrCodeLogin`）可留 `true`，但**必须显式写 `true`**（留默认等于没写理由，真机曾因此恒 `bgThrottle=true` 无从判断）。结构锁：`auth-view-manager.test.js`「显式声明锁」按文件读真实声明，注释里的字样不算（跳过 `*` 与 `//` 行）。⑥**CDP 观测分「读响应体」与「只数字节」两档，门槛不得共用一张表**：`AUTH_ENDPOINT_MATCHERS`（会 `getResponseBody`，有隐私与时序代价）与 `QR_BYTE_OBSERVE_PLATFORMS`（只 `Network.enable` 读 `loadingFinished.encodedDataLength`，一帧 body 都不碰）。跨域 iframe 的响应头被 Chromium 屏蔽，`contentLength` 在 webRequest 层恒 `redacted`，要区分「200 + 空体」的服务端静默拒绝（#1888 特征）只有 CDP 这一条路，不得再以"避免 CDP 事件量"一概否决轻观测。⑦**「实验开关」不得以「没测出问题」为理由转默认开；取消第三方登录页请求前必须先问「它是否参与会话建立」**：2026-09-27 真机配对 A/B（同机、每次重启后**首次** `openLogin`、两档交替以消除时间趋势，n=15）测得 `MP_LOGIN_NOISE_CANCEL=1` 相对默认关的首屏差为 −145 / −20 / **+17** / −453 ms（均值 −150ms，由单个离群点主导）；默认关档首屏 721–1242ms、出码 `qr bytes #1 after` 1282–1592ms、15/15 无二次导航 ⇒ `attachLoginPageNoiseCancel` **保持默认关**。被取消的 `support.weixin.qq.com/…/cube?biz=3512&label=connect.qrconnect`（每轮 6 次）**可能**承担微信侧 QR 会话登记，而"不扫码就无法证伪"是本次取证的硬边界：**凡"收益落在对端抖动量级内 + 副作用不可证伪"的组合，一律停在实验开关**，不得转默认开（全量数字与判据见 `01-docs/INVESTIGATE-LOGIN-QR-SLOW-2026-09-25.md` §13）。

- **应用级浮层弹窗互斥合同（overlay view suspension）**：`WebContentsView`（浏览器/登录标签的外部网页）是压在渲染进程 DOM 之上的原生图层，CSS z-index 无效。新增任何应用级**模态**浮层（居中弹窗、`fixed inset:0` 遮罩、阻塞交互的 `ElMessageBox.confirm`）时，必须经 `src/composables/useEmbeddedViewSuspension.js` 挂起/恢复内嵌视图（owner 唯一标识、suspend/release 成对、**释放必须穷尽** —— 释放在函数体内发生且其后还有语句时走 `finally`；释放由 `visible` 状态驱动时走 `watch(visible)` 的 false 分支**并另加 `onBeforeUnmount` 兜底**，因为父组件直接 `v-if` 掉浮层时 `visible` 不经过 `false`，少了这条就是残留挂起计数。判据：新登记 owner 先问「释放是状态出口还是控制流中间步」，不得把前者硬写成 `finally`），并在 `apps/desktop/src/overlay-view-suspension.test.js` 登记该 owner 的接入断言。修改 `WebviewManager` 可见性链路（`setVisible` / `_repositionAll` / `setShellMode` / 挂起三方法）必须同跑 `overlay-view-suspension.test.js` + `shell-mode-6b.test.js` 全量；修改 `electron/preload/page-manager.js` 必须重打包 `index.bundle.js`（bundle 断言拦截遗漏）。瞬时非模态浮层（toast/回到顶部/更新通知/ElMessage）明确不接入（挂起致闪烁、无交互闭环），残余限制见 `01-docs/PRD-OVERLAY-VIEW-SUSPENSION-2026-09-23.md` §6。

- **自动更新静默合同**：打包应用必须关闭 electron-updater console logger；检查更新阶段的网络阻断和缺失 `latest*.yml` 按 `not-available` 处理，签名、下载和安装等真实错误不得吞掉。修改更新服务后必须打包启动 8 秒并确认 stderr 无 updater 网络/404 栈。

- **文件 glob 覆盖**：`package.json` 的 `files` 数组必须包含所有被 require 的非 node\_modules 文件

- **生产依赖闭包**：生产入口静态加载的每个第三方包必须由所属 workspace 在 `dependencies` 中直接声明；根工作区或其他包的传递依赖不算满足。发布前必须执行 `npm pack --dry-run` 并从隔离 runner/安装目录加载真实入口。

- **聚合外部搜索源的展示面必须有语义相关性判据，来源标签禁止兜底品牌名**：任何从第三方搜索 API（本项目为 Reddit / Hacker News / GitHub）取列表展示给用户的功能，两条不可省：① **标题级相关性门禁** —— 这些接口匹配的是**正文**，实测中文视频标题「三步学会做红烧肉」查 GitHub issues 返回 `total_count:3595`、首条标题「旧文归档 · 2024 年 2 月」与查询零词重叠；判据必须挂在**共用出口**（`ContentIntelligence.search()`）且在 `engagement` **排序之前** —— 挂在排序后，按下标取 `results[0]` 的下游（`searchMentions` 的 `topSource`/`topEngagement`）仍会拿到垃圾；挂在单个调用点，则每加一个入口就要重抄一份。② **可归因的来源标签** —— 显式映射已知源，未知源如实回显其标识，`source` 缺失则不渲染；**禁止 `v-else → "GitHub"` 这类兜底品牌名**，那等于给用户假证据，且让「标签打错」与「结果真的来自该源」两种情况在界面上无法区分。另：接第三方源时先问「这个源的 `title` 字段，语义上是不是我要展示的那类 `title`」—— GitHub issue 的标题是议题标题，不是内容作品标题，**字段名相同 ≠ 语义相同**。词素切分唯一实现是 `apps/desktop/electron/services/content-intelligence-utils.js` 的 `tokenizeContentWords`（拉丁词 + CJK 相邻二元组）：**中文按空白/标点切会把整句当成一个词**（实测把「申请加入请在这里评论」渲染成"同类标题高频词"并建议用户加进标题），门禁与高频词统计 MUST 共用该实现，禁止第二份切词逻辑（**该"MUST 共用"的范围限于这两者**：`_extractKeywords` 服务的是整篇正文 + 单文档词频，把长串 CJK 展开成二元组会把「人工智能」拆成碎片喂给标签推荐，因此**刻意保留另一口径**，其函数注释已指向本条与专项 PRD §11.5 —— 不要把它当遗漏"顺手收敛")；跨标题共性词按 **document frequency**（出现在几条标题里）计数，不按出现总次数，并列时按词素字典序以保证渲染稳定。查询本身切不出内容词时**不设判据、原样放行**（无判据可依不得改变既有语义）。判据看哪些字段是**按消费者声明的策略**（`opts.relevanceOn`，默认 `["title"]`；`searchMentions` 用 `["title","snippet","author"]`，因为真实转载提及的词在**对方正文**里而非对方标题里，只看标题会把 `totalMentions` 静默少算）——共用层收敛的是**机制**不是**策略**，且策略**必须进缓存键**，否则两种策略共用同一 query 必有一方拿到错的那份。分词必须用 `/\p{Script=Han}{2,}/gu` + **按码点**取二元组（BMP 区间表漏扩展平面 ⇒ 纯扩展平面查询切成空 token 集会把门禁**整体绕过**；按 UTF-16 单元切片会把代理对切成半个字符），且分词前必须剥离 URL 与 HTML 实体（否则两条无关标题因共享域名而过判）。门禁日志**禁止记 query 原文** —— `searchTitles` 的 query 就是用户尚未发布的草稿标题，logger 只脱敏凭证不脱敏用户文本，只记计数与长度。空态属产品契约：无相关结果时如实显示「暂未找到同类高互动标题」并按 `droppedIrrelevant` 区分「源无响应」与「都不相关」，**不得硬凑列表** —— 一条垃圾建议比没有建议更伤，用户会照抄。回归锁：`content-intelligence-utils.test.js`（二元组**精确数组**断言）、`tests/content-intelligence.test.js`（源域锁 + 事故场景 `results` 精确等于真同类那一条 + 门禁在共用层使 `searchMentions` 受益）、`TitleAssistantPanel.test.js`（未知源不得显示 GitHub、空态文案与过滤条数）。反证四条已实跑：摘门禁 3 红 / github 回源域 5 红 / 退回空白切词 2 红 / 退回 `v-else GitHub` 1 红。详见 `01-docs/PRD-TITLE-ASSISTANT-RELEVANCE-2026-09-28.md`。
- **外部可控 URL 绑定可点击锚点前必须过共享协议判据（href scheme guard）**：任何把**第三方返回值**（搜索/榜单 API 的 `url`/`html_url`/permalink、平台发布回传的 `result.url`、历史记录里持久化的 url、导入的项目元信息）渲染成 `<a :href>` / `<el-link :href>` 的展示面，判据只有一份：`packages/shared-utils/src/safe-http-url.js`（CJS，主进程）与 `safe-http-url.browser.js`（ESM，渲染进程，由 `apps/desktop/vite.config.js` 的 alias 指过去，照 platform-definitions / account-name-guard / publish-capabilities 三先例），**禁止新增第二份 `/^https?:/`**。本仓曾同时存在 `hot-topics/channels.js` 的 `sanitizeUrl`（已收敛）与 `usePlatformIconUrl.js` 的图标白名单（属"图标资源允许 data:/相对路径"的**不同问题**，不得顺手合并）两份口径。两条不可绕过的理由：① **Vue 3 不净化 href**（v2 的 `isUnsafeURL` 守卫在 v3 已移除），而本应用渲染进程持有 `window.electronAPI` —— `javascript:` 进 href 等于用户点一下就在特权上下文执行任意 JS，不是"打开坏网页"的量级；② 载荷确实可控（实测 HN Algolia 的 `d.url` 由提交人任意填写，`content-intelligence-sources.js` 曾把它原样透出）。**必须双档**：采集侧在离开第三方响应的第一站收口（`safeHttpUrl(外部字段) || 本站兜底`），渲染侧绑定 href 前再判一次；单靠采集侧会把「下一个不经该采集层的写入口」漏掉，单靠渲染侧会把脏数据留在 IPC 与历史库里。**降级语义是"不产出锚点、保留文本"**：不得渲染成"看着能点、点了没反应"的死链接，也不得整项消失（内容不丢才可人工核对上游脏数据）。`target="_blank"` 必须同时带 `rel="noopener"`（reverse tabnabbing 同族，本仓 Publish / FilmEngineering 两处曾漏）。判据**只做前缀白名单**，禁止清洗后放行（剥控制字符 / 实体解码 / 自动补协议都是在给绕过面添砖）；协议相对 `//host` 与缺协议 `example.com` 在 `file://` 宿主下解析不出正确目标，同样返回 `null`。回归锁三处，改任一侧必须全跑：`packages/shared-utils/src/__tests__/safe-http-url.test.js`（判定表 + CJS/ESM 按 `source`+`flags` parity）、`apps/desktop/src/href-scheme-contract.test.js`（**扫全仓 `src/**/*.vue` 的每一处 `:href=`**，例外清单为空且只能缩小；含「扫描域非空」与「命中数规模下界」两条反失明断言，否则解析退化成空集合即假绿）、`apps/desktop/electron/services/content-intelligence-sources.test.js`（**采集侧按行为锁**——结构锁只查 import 是否在位，把 `safeHttpUrl(d.url)` 的包裹拆掉仍会过锁）。另记一条接缝：`vitest.config.js` **不含**这组 alias，单测里渲染端解析到 CJS、生产解析到 ESM 孪生，所以摘掉 alias 只有结构锁会红，别以为组件用例兜得住。判据范围**按实测全仓清点写，不写"任何文件不得自带 `/^https?:/`"那种不可实现的空话**（实测 1846 个文件里 37 处含同类写法，绝大多数是不同意图：剥协议取 host、判绝对性走分支、网络取回守卫、issuer/proxy/baseURL 的 https 强制）：① **渲染层全域**（`src/**/*.vue` 与 `src/**/*.js`）不得出现协议正则字面量，白名单为空；② 主进程**成链侧文件清单**（`content-intelligence-sources.js` / `hot-topics/channels.js` / `bootstrap/phase4-events.js`）逐个断言"引用共享实现 + 不含自带正则"，新增同用途文件必须登记、清单只能缩小。本 PR 实际收敛掉的四份同用途拷贝：`channels.js` 的 `sanitizeUrl`、`phase4-events.js` 的 `tracked_content.url`（它是 `Publish.vue` 那个 `result.url` 的上游）、`Collection.vue` 用户输入协议校验（同一条 `collectError.protocol` 文案的现场）。href 绑定判据必须覆盖四种形态（`:href="` / `:href='` / 不加引号 / 等号两侧空格），并**显式禁止** `:[href]` 动态参数名与 `v-bind="{ href }"` 对象展开——这两种写法能把判据整条绕过；同时断言"值真的被 `safeHttpUrl(…)` 包裹"，而不是表达式里出现过这个单词。另两条同族结构判据：任何 `target="_blank"` 必须带含 `noopener` 的 `rel`；每个成链点的 `v-if` 与 `:href` 必须取**同一个**判据表达式（否则"弱化 v-if"会让降级语义静默退化成死锚点）。扫开始标签**禁止**用朴素 `<a([^>]*)>`：属性值里就带 `>`（`ReferenceFinder.vue` 的 `@mouseover="e => …"`），会在那个 `>` 处截断使该站点静默漏扫，而"命中数下界"仍被其它站点满足。详见 `01-docs/PRD-HREF-SCHEME-GUARD-2026-09-29.md`（§5.2 实况清点表、§9 反证 20 条、§11 QM-6 逐条处置）。

- **批量 IPC 进度双边界与超时预算契约**：任何逐条循环调用异步检测/网络任务的 IPC handler，若向渲染层广播进度，必须同时覆盖 `start`（in-flight，检测体执行前）与 `done`（完成后）两个边界；只在 `await` 之后广播会让进度语义退化为「已完成数」，单个慢任务使遮罩长时间静止（视觉上等同卡死）。批量任务必须声明并发上限与单任务硬超时（均可用环境变量覆盖以便排障），超时结果语义（计入失效 / 跳过 / 重试）须在 PRD 中写明；用 `Promise.race` 实现超时时必须保留「超时后原任务迟到的 reject 不产生 unhandledRejection」的回归测试。回归锁：`apps/desktop/electron/ipc-handlers/account-batch-check.test.js`（断言检测体执行期间该账号只收到过 start）。
- **发布进度事件双边界与富化契约（publish-progress-ux；panel-refine 扩展 cancelled 相位）**：`publish:progress` 的富化字段（`phase`/`stageKey`/`percent`/`batchId`/`timestamp`）只在主进程发射层单一实现（`electron/services/publish-progress-events.js`），渲染层禁止维护第二份阶段映射；任务开始必须发 `phase:'start'` 边界事件，终态以 phase4-events 的 `task:success`/`task:failed`/`task:cancelled` 为单一来源（executor 不得重复发成功终态；`task:cancelled` 由 phase4-events 转发为 `phase:'cancelled'` 中性终态——取消不是失败：不落历史、不挂风控，且**相位枚举三处同步**：emitter `PHASE_ENUM` / store `PHASE_ENUM` / store `TERMINAL_PHASES`，漏任一处 cancelled 会被归一为 progress 或不收敛，测试锁各自覆盖）；新增引擎阶段串必须同步登记 `KNOWN_STAGE_MAP` 封闭清单（`publish-stage-map.test.js` 锁全量已知串与规模下界）；渲染层发布进度状态唯一承载是 `src/stores/publishProgress.js`（App 级订阅），页面 composables 禁止再持有页面级 `publish:progress` 订阅（监听器死亡 bug 的结构性预防——`usePublishFlow.test.js`「不再订阅」回归锁）；`task:failed` 必须落发布历史（`status:'failed'` 含 error）；取消动作（store `cancelRunning`）只发 `queue:cancel` 请求与计数，任务状态更新只认转发的 `phase:'cancelled'` 事件——禁止渲染层自标记（不自造第二份真相）。修改任一层必须跑 `publish-stage-map.test.js` + `publish-progress-events.test.js` + `phase4-events.test.js` + `src/stores/publishProgress.test.js` + `src/components/PublishProgressPanel.test.js` 全量。
- **Docker runner 文件集**：修改 Dockerfile 或其构建上下文时，必须按最终 runner stage 的本地 `COPY` 清单构造隔离 staging，并加载真实入口验证完整 require 链；Docker daemon 可用时还必须真实 build、启动容器并验证 `/ready`，静态合同不能替代镜像启动。

- **容器运行用户与健康检查**：非 root 容器的插件、缓存、上传和状态目录必须显式落到可写持久卷；Alpine 健康检查固定使用 `127.0.0.1`，除非服务同时验证过 IPv4/IPv6 监听。

- **跨 Compose 网络与服务 DNS**：当容器通过 `postgres` 等 Compose 服务名访问数据库或身份依赖时，业务 Compose 必须显式加入正确的外部网络；合同测试要断言网络名和服务归属，ECS 必须用真实 `docker compose run` 执行 DNS 与 migration dry-run，不能用临时 `docker run --network` 替代。

- **PostgreSQL migration 最小权限**：migration runner 在 advisory lock 内必须先探测 `identity_schema_migrations`；ledger 已存在时只能读取并校验，不得用 `CREATE TABLE IF NOT EXISTS` 等 DDL 作为存在性检查，因为 PostgreSQL 仍会校验 schema `CREATE` 权限。只有 ledger 缺失时才允许建表；回归必须覆盖“已有 ledger + 无 pending + 运行角色无 CREATE”成功、“缺失 ledger”创建，以及“缺失 ledger + 无 CREATE”失败并释放 advisory lock。ECS 发布还必须用真实 `multi_publish_api` 角色执行正式 runner，不能只以 dry-run 代替。

- **OIDC 算法互操作**：JWT 算法白名单必须由目标租户真实 discovery/JWKS 证据驱动，并严格绑定 `alg`、`kty`、曲线和签名编码；Node/Python 双实现必须使用同一生产 JWKS fixture 回归，不能只以自生成 RSA fixture 证明兼容。

- **OIDC access token 格式兼容**：业务 API 验证 Logto access token 时必须同时支持 JWT 和 Opaque Token 两种格式。Logto 默认签发 Opaque Token（非 JWT，无法本地验签），需通过 `/oidc/token/introspection` 验证。修改 `packages/api-publish-engine/src/auth/logto-*`、readiness 或认证回退逻辑时必须：(1) 在发送 M2M Basic 凭据前校验 discovery 的 introspection endpoint 使用 HTTPS、与 issuer 同源且不含 userinfo；仅本机 loopback issuer 允许同源 HTTP；discovery、JWKS、introspection 及携带 Bearer Token 的生产 smoke 请求禁止跟随 HTTP 重定向；(2) 对 active token 强制要求非空 `sub` 和目标 `aud`，`iss`/`exp` 可省略但存在时必须严格匹配且类型有效；(3) 生产环境强制同时配置 `LOGTO_CLIENT_ID` 和 `LOGTO_CLIENT_SECRET`，`/ready` 必须用随机无效 token 得到 `active:false` 后才报告 `checks.introspection=ready`；(4) `AUTH_*_UNAVAILABLE` 必须返回 503，且不得回退到 API Key；(5) introspection 缓存只能使用 token 指纹作为键，同 token 并发请求必须合并；(6) 至少运行 `logto-jwks.test.js`、`logto-runtime.test.js`、`production-config.test.js`、`production-readiness.test.js`、`logto-optional-auth.test.js`、`production-operations.test.js` 和 `logto-deploy-contract.test.js`。详见 [01-docs/learnings.md Opaque Token Introspection 缺失复盘](01-docs/learnings.md)。

- **Logto Webhook POST 重试合同**：不得根据 `retry.limit` 或消费者端手工重放测试推断 Logto 会自动重试 Webhook。Logto 1.41.0 使用 Ky 1.2.3，默认可重试方法不含 `POST`，且 `TimeoutError` 不重试。派生镜像必须绑定已验收运行时文件 SHA-256、精确匹配一次后才显式加入 `methods: ["post"]`，目标缺失、重复、哈希漂移、路径替换、symlink/hardlink、部分写入或已被上游修复时一律 fail closed；补丁读取、哈希、写入和读回必须使用同一文件描述符，失败时恢复原字节并关闭全部描述符。基础 Compose 必须继续保留 `svhd/logto:1.41.0` 作为不删除 PostgreSQL 卷的回滚路径。修改相关 Dockerfile、补丁或 Compose 后必须运行 `logto-webhook-runtime-patch.test.js`、`logto-deploy-contract.test.js`，并在生产切换前后用独立签名密钥的临时 Hook 验证 `503 -> 503 -> 204` 共三次真实 POST、签名均有效、临时资源全部清理。超时场景必须单独标为未覆盖，不得用数据库锁或客户端超时冒充 HTTP 状态码重试证据。

- **OIDC Token 类型判定**：不得仅按点号数量或三段 base64url 结构把 access token 判定为 JWT；OAuth Opaque Token 可以包含任意字符。只有首段能解析为 JSON JOSE header 时才进入 JWT 验签，进入后任何算法、密钥、签名或 claims 失败都不得降级到 introspection。Opaque introspection claims 必须与 JWT 路径一致检查 `nbf`/`exp` 时间边界，回归必须包含带两个点的有效 Opaque Token、未来/非法 `nbf` 和损坏 JWT 不降级三个场景。

- **Entitlement 独立时钟偏差合同**：桌面端与 API 的 entitlement 验签必须统一使用默认 `60s`、可配置范围 `0..300s` 的可信本地时钟容差；不得从 token payload 读取容差。时间边界固定为 `iat > now + tolerance` 拒绝、`exp <= now - tolerance` 拒绝，在线同步与离线恢复必须使用同一参数。修改 `apps/desktop/electron/services/identity/entitlement*` 或 `packages/api-publish-engine/src/auth/entitlement.js` 时，必须用真实 RSA 签名覆盖客户端/服务端独立时钟、默认窗口、显式零容差、`300s` 上限及越界，并在真实登录验收中记录两端 UTC 时间差。

- **打包权限模式不可由环境变量提权**：`app.isPackaged` 是 Electron 主进程判断开发/打包状态的权威来源。`NODE_ENV=development`、`ELECTRON_IS_DEV=1` 等环境变量不得让 `app.isPackaged=true` 的应用获得 `admin`；权限相关修改必须覆盖打包应用、未打包应用、本地 Pro 和 Logto 身份四组合同。

- **Adapter 能力注册表同步**：修改 `BaseAdapter.KNOWN_METHODS` 后必须全局检索同名 `supports()` / `capabilities()` 手工覆盖和旧测试断言；标准能力只能出现一次，所有受影响 Adapter 必须断言 `supports()` 为 true 且 `capabilities()` 无重复项。

- **登录态真源只被正/负证据改写（单向证据规则）**：`accounts.json` 的 `status` MUST 只在检测给出「有效」（→ `active`）或「明确失效」（→ `expired`）时被改写；「本轮无定论」（含 `CHECK_LOGIN_INCONCLUSIVE`、检测自身异常、硬超时）**不得**把既有结论抹成 `unverified`——「没拿到新证据」不是反证。此前 `expired` 已是粘滞态而 `active` 无对等保护，加上同一个三态映射被抄成三份（`account-manager` / `ipc-handlers/account.js` / `login-status-monitor`），导致已登录账号每 30 分钟在「已登录 ↔ 未确认」之间来回。唯一实现是 `packages/shared-utils/src/login-state.js` 的 `loginStatusTransition`（返回 `null` = 本轮不改写），三个调用点 MUST 直接 import，禁止再新增第四份映射——`account-manager` 侧原有的 `loginStatusFromCheckResult` 与同名转发 shim 已删除（结构锁见 `account-manager-relogin-status.test.js` 的「单一口径结构锁」）；凭证落盘（登录即正向证据）继续直写 `active`，不经该函数形成双门控。超龄兜底默认 7 天（`MP_LOGIN_STATE_GRACE_DAYS`，非法值回落默认），防止「已失效却永远显示已登录」。**写者层还有两条不能合并进规则函数**（规则只管「该写什么」，管不了「这次写有没有意义」）：① 无定论且规则值已等于现状，或现状根本读不到时 MUST NOT 发写请求——冗余 PATCH 会把 `last_validated` 伪造成一次没有结论的检测，而现状未知时猜 `active` 或抹成 `unverified` 都是在再造一扇振荡的门；② 正向证据即使现状已是 `active` 也 MUST 回写，否则宽限期锚点被冻结，常青账号会在 7 天后被自己的兜底降级。新增任何「无定论」出口时 MUST 运行 `packages/shared-utils/src/__tests__/login-state.test.js`（规则表 6 行 + 边界）、`ipc-handlers/account.test.js`（写者层两条 + 真源快照按需读）与 `login-status-monitor.test.js` 全量。详见 `openspec/changes/fix-login-state-oscillation/` 与 PRD §7.6。

- **登录态固化契约覆盖全部「凭证落盘」同族路径**：主进程成功捕获并落盘加密凭证的每一条入口都必须把 `status='active'` + `last_validated` 回写唯一真源（后端 `accounts.json`），且顺序不可颠倒——凭证未落盘不得把真源置为 active（防半成功）。入口共三条：`saveCapturedAccount`（`auth:open-login` 新登录 / `qrcode-login._onLoginSuccess` 扫码登录 / `account:add` 首次运行引导）、`updateCapturedAccount`（重新登录与登录标签保存）。两条附加约束：① 固化失败或登录证据不足时返回值如实透传真源原值，不得声称 active；② `account:add` 的 `captureCookies` 把「URL host 离开登录页」也算登录成功，那是**弱证据**（用户未登录却导航到别的域名同样满足），必须传 `loginVerified:false` 保持后端 `unverified`、等一次真实检测，不得固化 active。只锁其中一条路径会把另一条留成沉默缺陷——创建路径漏写时后端 `create_account` 默认 `unverified`，会让每个新账号显示「未确认」直到用户手动点一次检测。新增或修改任一条路径时必须运行 [account-manager-relogin-status.test.js](apps/desktop/electron/publishers/account-manager-relogin-status.test.js) 全量（9 例：两条路径固化 / 固化顺序 / 凭证落盘失败 / 固化失败不冒充 / 弱证据不固化 / 更新路径同口径 / 不自带映射的结构锁），并保持 IPC 边界用例（`ipc-handlers/account.test.js`）的 mock 与真源返回口径一致。注意：渲染层在 `auth:completed` 后重新拉列表，用户可见状态由**真源**决定，返回值承担的是 IPC 合同一致性，不是首帧渲染来源。
- **账号凭证云端镜像契约（2026-09-27 起，取代"凭证不出本机"旧表述）**：登录凭证（cookies/localStorage/indexedDB）现在除本机 `credential-store` 的 AES-256-GCM 密文外，还会以**信封加密**形态镜像到业务 API `POST/PUT /api/v1/me/accounts`（归属按 Logto 身份，主密钥在服务端 KMS 抽象层之后）。四条不可绕过：①本机 python-backend 的 `ACCOUNT_METADATA_ONLY`（`server.py:484`）**保持不变**——它管本地真源不收凭证，与云端镜像是两条独立通道，不得把它当本特性的门禁去改；②`credential_digest` 的规范化口径**只在服务端实现一份**，客户端禁止另写一份（两份必然漂移，漂移表现为 `unchanged` 被误判成冲突、每次同步重写凭证）；③恢复到本机的账号 MUST 由 `credential-store.saveCredential` 先落盘、再按 `AccountManager.persistLoginState` 的**位置签名** `(accountId, platform, status, validatedAt)` 调用并回写 `status='unverified'`（`validation_origin` 从未存在过、超龄兜底只作用于 `active`，2026-09-27 按实现纠正，不再为无人消费的字段建死列），返回值非 `ok` 必须落 warn，顺序不可颠倒，且**绝不**把云端回传的 `active` 写进真源（否则违反「登录态只被正/负证据改写」，并让 7 天超龄兜底在新设备立刻误判失效）；④云端墓碑**只阻止复活，不反向删除**本机账号与本机凭证——凭证删除不可恢复，合并键判错时反向删除等于跨设备抹号。改任一条路径必须跑 `apps/desktop/electron/services/cloud-account-sync.test.js` 全量，并对「恢复即 unverified」做一次把 `status` 改成 `active` 的**反证**（必须变红）。详见 `01-docs/PRD-CLOUD-ACCOUNT-SYNC-2026-09-27.md`、`docs/adr/0002`–`0006`。

- **跨包响应信封只在一处剥，契约夹具不得替对方剥壳（2026-09-27 事故补写）**：业务 API 成功响应恒为 `{code:0,data:{…}}`、失败为 `{error:<语义码>}`，而 `member-api-service.request()` **原样返回整个响应体**（`return response.json()`）。同一个 `/api/v1/me/*` 前缀的另一半由 ops-center 提供、是**裸 JSON 不带壳**，两种约定共用一个传输层，于是「谁负责剥壳」必须显式声明：唯一实现是 `apps/desktop/electron/services/cloud-account-core.js` 的 `unwrapApiResponse()`，只在 `cloud-account-sync.js` 的 `callApi()` 一处调用，调用点一律按业务字段读；信封缺失或 `data` 非对象一律抛 `CLOUD_ENVELOPE_INVALID`，**禁止**返回空对象（那会把契约破坏伪装成「云端一个账号都没有」，违反 §10.2「不可达不得显示共 0 个」）。三条同源教训：① 跨包契约测试的夹具一旦**代替对方剥壳**（当时 `apiClient.request` 写的是 `return response.body.data`），漏剥信封的实现就永远测不出来 —— 夹具必须与真实传输层逐字同形；② 禁止用「断言对方源码里出现了某种读法」这种**记录性断言**代替真跑一次流程，那是把 Bug 钉成契约（实测：`弹窗永远共 0 个 / 同步永远 0 条` 在全绿单测下躺了一整轮，反证是把 `unwrapApiResponse` 改成恒等 → 桌面端红 19 条、契约文件红 4 条）；③ 新增测试文件必须**看见它被执行过**（runner 的通过清单里出现该文件名且测试数 >0），只有 `node --check` 或"文件存在"不算 —— 本次契约文件因 `test()` 头被编辑吞掉而长期语法不合法、从未运行，却被登记为反证已建立的锁。同族纪律见「门禁断言随实现迁移同步」「批量 IPC 进度双边界」。
- **跨包上行契约必须有一把「拿真校验器 + 真加密器」的锁（2026-09-27 事故补写）**：`PUT /api/v1/me/accounts` 的字段形状由服务端 `validate-account.js` 的白名单单一持有，只有五个键允许客户端提交：`credential`（**明文**，服务端落库前才信封加密）、`credentialUpdatedAt`（仅供回传 `credentialFreshness` 定序，**不得**成为存储值）、`force`、以及 §6.2 元数据字段。`credentialEnvelope` / `credentialDigest` / `lastReportedStatus` / `metadataUpdatedAt` / `createdAt` 一律**禁止**客户端提交，且必须是 `ACCOUNT_FIELD_NOT_ALLOWED` 而不是静默忽略。两条曾同时踩到的坑：① 服务端白名单里没有 `credential`，桌面端每个 PUT 都被拒；② 服务端入口守卫 `_isCloudAccountsUrl` 手抄了一份路径清单且漏了 `/accounts/tombstones`，于是**删除账号时写的墓碑全部 404**，「已删账号不得复活」的防线静默失效而用户毫无感知。教训：**入口守卫的路径集必须由 `CLOUD_ACCOUNTS_ROUTES` 推导**（一处真源），且跨包必须有 `packages/api-publish-engine/test/cloud-accounts-desktop-contract.test.js` 这类锁——它直接读桌面端源码里的 method+path 与 PUT 请求体，喂给**真**校验器与**真**加密器，不许 mock 形状。纪律：桌面端测试一律 mock 掉 `apiClient`，因此**任何只改一侧字段/路径的改动，本地全绿也可能是坏的**；新增/改云账号面时必须同时跑跨包契约锁，并对其做反证（从白名单删 `credential`、从守卫删 tombstones 路径，都必须变红）。`force` 方向同样由该锁钉住：只有 `'local-wins'` 可覆盖凭证列，`'cloud-wins'` 只写元数据；两份都无定论时桌面端**不得**发出带 `force` 的 PUT（「没验出来」不是反证，不构成覆盖他设备有效凭证的授权，且无 `force` 时服务端只会回 `conflict`，那趟是冗余写）。
- **凭证明文的出站面必须自带 no-store，并在真 HTTP 层锁出站头**：任何回传「服务端解密后的凭证明文（或等价敏感材料）」的 HTTP 面，必须在**该面的统一出口**上声明 `Cache-Control: no-store`。禁止把「网关恰好不缓存」当防线——出站头是应用合同，网关配置是部署事实，只有前者能被测试锁住。头要加在出口而不是逐个处理器：新增路由自动继承，漏写的唯一途径是删掉那个常量，而那会被锁抓到。回归锁必须经真 `http.createServer` 读实抓到的响应头（见本文件「出站行为以线级取证为准」），并做**两条分离的变异反证**：① 摘掉出口的合并动作 → 全红；② 只摘提前应答分支的实参 → 只有那条红。②证明每个发送点被独立守住，而不是靠成功路径顺带通过。先例：`publish-api-cloud-accounts.js` 的 `NO_STORE` + `test/cloud-accounts-no-store.test.js`。

- **多个主进程写者改同一份真源时必须有一把按记录键的串行锁，并且跨模块契约要注入真实现**（2026-09-27 事故补写）：登录态真源（`accounts.json` 的 `status` / `last_validated`）有四个互不知情的写者——`login-status-monitor`（`setInterval` 自己起来，**不经过任何按钮**）、`account:check-login`、`accounts:batch-check-login`、`cloud-account-restore`。渲染层把两个按钮互相 disable **不构成**这条防线（定时器不受它约束）。唯一实现是 `apps/desktop/electron/services/account-state-lock.js` 的 `withAccountStateLock(accountId, section, { waitTimeoutMs })`，七条口径：① 检测侧「读凭证 → 得结论 → 回写」与恢复侧「覆盖本机凭证 → 回写 unverified」各自整段进临界区，不变量是**凭证覆盖不得插在检测读凭证与写结论之间**；② 键必须是 `accountId`，不得退化成全局单锁（批量检测声明了并发上限与单任务硬超时，全局串行会让整批撞预算、遮罩钉死在第一个账号）；③ 前一个临界区抛错必须放行后来者（否则该账号从此再也不被检测）；④ 排队型后续动作（恢复收尾的 `queueLoginCheck`）走同一把键，必须在临界区**之外**发起，写进区内即自死锁且不报错；
⑤ 缺 `accountId` 一律当场抛错，不得静默降级成"不串行"；⑥ **锁的等待必须有上限**，且上限只作用于"还没进场"的等待者——
超时的等待者 MUST NOT 执行其临界区（调用方已经放弃之后，由迟到的排队者补写一份过期结论，正是本锁要消灭的形态），
批量侧把这段等待计入**同一个**单任务硬超时预算（否则一个挂死的写者会让已广播 `start` 的账号永不 `done`，
定期检测的 `_running` 永不复位 = 之后所有轮次静默停摆且不报错），超时语义是"本轮无结论"
（`valid: undefined` + 不回写 + 照常 `done`），**不是失效**；⑦ 无定论分支的"保持还是降级"MUST 以**临界区内重读**的
真源现状为准，不得沿用取锁前拍的全量列表快照——期间别的写者可能已落成 `expired`，拿旧快照猜现状会把负向证据抹成
`unverified`。另记一条方法论：**给并发写加锁时，必须同时问"原来被并行掩盖的挂死，现在会不会变成永久停摆"**——
锁把并发问题换成排队问题，排队没有上限就是新的死法（本轮 ⑥⑦ 两处后果由外部双模型评审独立命中，自审漏掉）。另配一条**注入真实现的跨模块契约锁**：`cloud-account-restore.test.js` 把真 `AccountManager.persistLoginState` 装进恢复流，断言后端真收到 `PATCH /api/accounts/<id>`。原因——本轮修掉的正是「夹具按调用方想象的形状收参数」（`(accountId, patch)` 收位置签名的调用），于是 status 恒为 undefined、真源一次都没写、全绿躺了一整轮，连 warn 都没有（返回值被丢弃，只有 throw 才落日志）。这是「契约夹具不得替对方剥壳」的第三种落点：**替对方改签名**。跨模块调用新增/修改时，MUST 同时有一条用真实现的用例，并把该调用做反证（退回错误形状必须变红）。

- **E2E fixture 断言渲染语义**：路由/工作流测试不得用内部枚举值断言已经过本地化或格式化的 UI 文案。优先使用稳定状态 class/testid 加用户可见文本，并在 UI 映射函数变更时同步运行受影响路由用例。

- **发布能力注册表单一真源合同（publish-capability-registry，2026-10-08）**：15 平台发布提交内容项（titleMode/内容限制/差异化字段/通用字段支持矩阵）的单一真源是 `packages/shared-utils/src/publish-capabilities.json`（CJS `publish-capabilities.js` 与 ESM `publish-capabilities.browser.js` 双版本消费同一份 JSON，parity 测试锁导出一致）。修改该 JSON 后必须运行：shared-utils `__tests__/publish-capabilities.test.js`（58 例，含 15 平台完整性与无标题清单精确断言）+ `packages/api-publish-engine/test/no-title-contract.test.js`（跨包契约锁）+ apps/desktop 的 `PlatformOverridePanel.test.js`（字段快照）与 `publish-contract.test.js`（限制对齐）。**无标题平台清单（titleMode=caption：视频号/快手/微博/X/Instagram/TikTok 共 6 个）变更必须三处同步**：DOM RPA 行为（rpa-view-platforms 结构锁）、引擎链合并行为（shipinhao/kuaishou/twitter/weibo/tiktok）、契约锁 A 清单断言——任何一处漂移 CI 变红。渲染层 `publish-contract.js` 的平台内容限制必须从注册表派生，MUST NOT 再维护独立限制常量表。注册表标签文案存放于共享数据层（apps/desktop/src 的 CJK 基线扫描不覆盖 packages/shared-utils，PLATFORM_NAMES 先例），但 apps/desktop/src 新增用户可见文案仍必须 zh/en 成对进 locales（Gate 7）；取证 note 不得写竞品品牌名（Gate 12，用中性称谓「参考产品」）。详见 [01-docs/PRD-PUBLISH-CAPABILITY-REGISTRY-2026-10-08.md](01-docs/PRD-PUBLISH-CAPABILITY-REGISTRY-2026-10-08.md) §九（维护 SOP）。

- **预设/种子类语义合同（R85）**：`getAvailablePresets`、`getAvailableTemplates`、`getAvailableProfiles` 等“可配置目录”类 API 必须返回该类别全部内置预设，**不得用“是否已入库”判断能否添加**。种子初始化（`_seedPresets` / `INSERT OR IGNORE`）只表示“目录存在”，不表示“用户已完成配置”；“是否已配置”必须用 `api_key_enc IS NOT NULL AND enabled = 1` 等业务字段判定。修改此类 API 时必须运行 [`model-provider-preset-integration.test.js`](apps/desktop/electron/services/model-provider-preset-integration.test.js) 并覆盖：(1) 空 userData 初始化后预设列表非空；(2) 种子已入库但预设列表仍返回全部项；(3) 用户选预设后保存路径走“ID 冲突 → 降级更新”而非创建重复行。详见 [01-docs/learnings.md 模型预设列表为空 Bug 复盘](01-docs/learnings.md)。

- **平台登录成功判定合同（登录页 ≠ 已登录）**：`PLATFORM_AUTH_HOSTS` 中出现的域必须是「登录成功后才允许出现」的域，登录/passport 域一律不得同时出现在 `PLATFORM_LOGIN_SUCCESS_PATTERNS` 中（裸域名成功模式会把登录页自己判成登录成功）。修改任一平台的 `PLATFORM_LOGIN_URLS` / `PLATFORM_AUTH_HOSTS` / `PLATFORM_LOGIN_SUCCESS_PATTERNS` 时，必须：(1) 在 `packages/shared-utils/src/__tests__/platform-definitions.test.js` 同步补该平台的「登录页不算成功」负例（百家号/头条/视频号/快手已有先例，缺负例即审查不通过）；(2) 确认 `isPlatformLoginSuccessUrl` 的「URL 等于初始登录地址一律不算成功」守卫是否因 `PLATFORM_LOGIN_URLS` 改动而静默失效（2026-09-25 快手事故即此）。对「登录页与后台同 URL」的平台（快手实测未登录与登录后都落在 `cp.kuaishou.com/profile`），URL 判定本质上不可区分，必须声明 `PLATFORM_SESSION_COOKIE_MARKERS`，由 `hasPlatformSessionCookie` 在 auth-view-manager（含手动「我已完成登录」与 `loginSilent` 静默校验）、qrcode-login、webview-manager/credential-saver、account-manager/`captureCookies`（IPC `account:add`）**四个**入库入口统一拦截——第四个是本地自审漏掉、由 QM-6 外部评审补上的，改门禁时必须以「所有能把凭证写进库的函数」为清单逐个核对，不要按调用链想当然；标记键必须以真实登录态 DevTools/CDP 实测取证为准，禁止混入 `did`/`wid`/`divid` 等埋点或设备标识（「有 Cookie」不等于「已登录」）。2026-09-26 同族收口追加三条：① `isPlatformLoginSuccessUrl` 与 `isPlatformLeftLoginPage` 共用 `LOGIN_PAGE_PATH_MARKERS` 形态否决层（路径含 login/signin/register/passport 即不算登录成功，**只扫路径不扫 query**，否则 OAuth 回跳的 `continue=.../login` 会把成功页反判成登录页）；该词表逐项挂实测证据出处，无证据不得加词（`signup`/`sso`/`verify` 因未实测被明确排除），且刻意不含 `auth`/`oauth`，因 youtube 已声明 `accounts.google.com/o/oauth2/approval` 为成功回跳点。② 「成功模式是裸域名」与「声明会话标记」互为必要条件，由 `platform-definitions.test.js` 的**棘轮锁**按形态（host-only 正则）自动计算并 `toEqual` 钉住待取证清单（只能缩小、新增即红）；判据用形态而非枚举平台名，枚举只用于记录欠账。③ 采集侧 `captureCookies`「方式 2」禁止再用「host 相对登录页发生变化」作判据（快手点「登录」跳 `passport.kuaishou.com` 即误满足）：必须 `isPlatformLeftLoginPage`（离开登录 host + 落在可信域 + 非登录页）或「已声明的会话标记出现」才算完成等待；未声明标记的平台不得凭「有 Cookie」放行（`hasPlatformSessionCookieMarkers` 是这一区分的前置判据），并须记 `names=`（只记 Cookie 名、绝不记值）作为下一次逐平台取证的现场来源。④**标记键取证必须走「A−B 差集」，且负向基线可以自建**（2026-09-27 确立，已据此为 douyin/bilibili/xiaohongshu 补标记）：「补标记需用户逐平台登录一次」是错的半截结论——**负向**证据（登录页也会种哪些 Cookie）完全可自建：用与主进程**同版本**的`node_modules/electron/dist/electron.exe`、复刻 `startup-compat.configureUserAgentFallback` 的 UA token 白名单净化（否则风控发的 Cookie 集与真实应用不一致）、`session.fromPartition` 全新隔离分区 + `show:false` + `backgroundThrottling:false`，访问该平台**登录页与创作者首页**各一次取名字；**正向**证据取 `auth-auth-<平台>-<Date.now()>` 分区（`account-<id>` 分区常年 0 条 Cookie，凭证只在开标签时从加密库回填，不得当 A 侧）。标记 = A 独有 ∧ B 没有 ∧ 语义上是会话票据/身份，三条同时成立才进表。五条硬约束：(a) **基线有效性必须自证**——B 内要出现该平台公认的匿名 Cookie（知乎 `d_c0`/B 站 `buvid3`/小红书 `a1`·`webId`/抖音 `ttwid`），否则页面根本没渲染、A−B 是虚高假差集；(b) 采集一律 `node:sqlite` **readOnly** 且`SELECT` 禁含 `value`/`encrypted_value`（`creation_utc`/`expires_utc` 是 INT64 微秒，须 `CAST(... AS TEXT)` 否则抛「Value is too large…」），**禁止解密 `credential-store`**；(c) 测试夹具必须由脚本从实测产物**生成**，禁止手抄；(d) `SESSION_MARKER_SHAPE` 这类形态正向契约只是**必要条件不是充分条件**——泛化它（如为接纳 `uid_tt`/`SESSDATA`/`x-user-id-*`而放宽）必须同 PR 补两类断言：「形态可拒」的负控（样本取自实测匿名名单，不取自黑名单自身）**加上**「形态放过但实测匿名也会种」的墓碑断言（如 `csrf_session_id`/`passport_csrf_token`），否则泛化就是把打地鼠换了个方向；(e) **知乎 MUST NOT 声明 Cookie 标记**——实测其登录视图内 `.zhihu.com` 无任何会话 Cookie（A−B 唯一项是验证码票据 `captcha_ticket_v2`，`z_c0` 在 A/B 两侧都不存在），声明即把每次真实登录判成失败，它只能走 `PLATFORM_LS_SESSION_MARKERS`；且**不得**从离线 leveldb 抠 localStorage 键名当证据（键名后紧跟 UTF-16LE 值，ASCII 截取会把值首字符并进键名，实测 `cid`→`cidY`），LS 标记必须 CDP 实时取证。配套两条纪律：**收紧与可诊断必须同 PR**——让某平台从「未声明（门禁恒过）」变为「声明（门禁实际将拦）」时，MUST 同时让拒绝路径输出 `names=` 现场，且名字投影 MUST 收敛到 shared-utils 的 `sessionCookieNames` 单一实现（四处门禁`auth-view-manager`/`qrcode-login`/`credential-saver`/`account-manager.captureCookies` 禁止各抄一份），否则「标记收得太窄」会变成用户可见的静默登录失败；以及既有用例若把某平台当「未声明代表」或「随便一个平台」的夹具，声明标记后 MUST 同步改锚或补真实登录态 Cookie（本次 `platform-definitions.test.js` 与 `webview-manager.test.js` 各撞一处，均由门禁当场暴露）。另记一条方法论教训（2026-09-28 实测更正，别再把「否证」当结论）：本次曾两次把**未实测的推断**当结论写出（「匿名也会种空值 `sessionid`」「mock 实例漂移导致日志断言恒空」），当时都以一次重测宣告"已否证"——前者确实错（`sessionid` 不在匿名基线里），**后者只对了一半**：`credential-saver` 的日志断言在 `-t` 单跑抓到 1 条、在全文件跑抓到 0 条，根因不是「vite SSR 绕过 `Module._load`」，而是 `beforeEach` 每轮**新建** logger mock 与被测模块在 require 期**冻结**的本地绑定不是同一实例。口径改为两条：① 凡「某某抓不到 / 某某也会种」这类关于测试接缝或外部行为的判断，必须在 **runner 真实采用的那种跑法**下跑一次（本仓 CI 收编的是全量，`-t` 单跑不构成证据）；② 日志类锁的前提是 mock **对象身份跨用例稳定**（模块作用域建一次、每轮 `mockReset()`），退回每轮新建会让锁恒 0 次却不报错。四处门禁的 `names=` 现场现均有可执行锁（`auth-view-manager` #2527，`credential-saver` / `qrcode-login` / `account-manager.captureCookies` 2026-09-28），每条都锁**两个方向**：`names=` 必须含逐个 Cookie 名，且 Cookie **值**不得出现在日志里。详见 [01-docs/learnings.md 「登录页 = 登录成功」第四次复发](01-docs/learnings.md)。

- **宿主 API 字段归属必须先核实（Electron/浏览器 API 不得凭字段名写）**：读 `app.*` / `webContents.*` / 任何宿主对象属性前，必须在**已安装**的类型声明里确认该属性挂在哪个接口上（Electron 为 `node_modules/electron/electron.d.ts`），或运行时打印一次。反例：`configureUserAgentFallback` 读 `app.userAgent`（真实 Electron 上不存在，UA 只在 `app.userAgentFallback`），导致知乎登录风控规避逻辑长期静默 no-op，而单测因手搓 `{app:{userAgent}}` 假形状全绿。配套要求：① mock 的字段集来自 d.ts 或运行时 dump，并保留一条「真实形状」用例（只带宿主真有的字段）；② 关键取源用计数字段 getter 断言「未读错误字段」；③ 前提本身做真实依赖锁（对 `electron.d.ts` 结构断言，缺 electron 时 skip）。

- **静默配置失败必须留日志**：任何以 `{configured: boolean}` / 布尔返回值表达「已生效 / 已跳过」的启动期配置函数，调用点的未生效分支一律 `console.warn` 或 `log.warn`；只在成功分支打印等于吞掉失败，回归在运行日志里零痕迹。

- **出站行为以线级取证为准**：断言「请求头 / UA / 证书 / 编码已设置」时，最终证据必须来自真实链路抓到的出站数据（本机回显 HTTP 服务 + 生产同款 session/webPreferences 做开关 A/B），单测绿不代表线上头部变了。注意 `Sec-CH-UA` 系列客户端提示只在 HTTPS 请求发送，本机 http 回显看不到，不得据此判「不存在」。

- **跨端目录常量 ↔ 存量数据必须前向兼容（MUST）**：凡「代码内目录常量 + 数据库表」双真源结构（如 `app_menu_service.CATALOG` ↔ `app_menu_items`），目录新增条目时**禁止**只用「表为空才播种」的供给逻辑——存量部署永不获得新行，管理页会看不到该项、无法配置，而按目录遍历下发的客户端照常显示，两侧项目与顺序同时漂移。供给必须是**增量补齐且只补不改已有行**（覆盖已有行会抹掉运营者配置，比缺行更糟），并在读取/写入/重置/下发**全部**入口调用。缺行兜底值必须取**目录序号**而非 `0`（0 在排序语义里是第一名）。回归锁必须有一条从**非空旧状态**出发（先建全量再删一项）的用例——「每例 `drop_all/create_all` 重建空表」的夹具对这类缺陷完全免疫。同族先例见 R85。CI 的结构校验（清单 ↔ 清单自洽）**不能**作为通过证据：漂移发生在运行库里，CI 看不到。

- **多通道同步编排不得失败互锁（MUST）**：一个 handler/服务内先后拉取多条独立通道（如模型目录 catalog 与运行时策略 runtime/bootstrap）时，任何一条的失败或提前 `return` **不得**阻止另一条执行——「best-effort 分支」若写在主通道 `await` 之后，就等同于反向门控（主通道失败 ⇒ 该分支永远不执行）。必须用 `Promise.allSettled` 并行解耦，并遵守：① 并行不得叠加超时预算（整体仍是单请求超时，不得退化为串行求和）；② 结果对象必须逐通道如实上报（如 `code/message` 属目录，`runtimeApplied/runtimeSyncedAt` 属运行时），不得因一条成功而掩盖另一条失败；③ 若该通道结果**面向用户展示**，文案必须区分「部分成功」与「完全失败」，否则用户会用反复重启应用来排障；若产品决定该链路**对用户透明**（界面无任何入口，如桌面端运营中心同步卡片已隐藏），则**不得为不存在的反馈路径新增 locale 键**（AGENTS.md 禁止死键），区分度改由主进程日志承担。写 UI 反馈前先确认调用方是否可达。回归锁：为「A 失败时 B 仍须执行」单独写一条注入用例；并行预算用假时钟**单次**推进 + 断言**每个端点各被请求一次**（实现退化为串行时该用例会挂死，挂死本身即结构断言）。

- **测试断言不得反向固化错误行为**：任何断言“X 已初始化所以 Y 应为空”的测试必须额外验证“Y 为空是用户期望行为”而非“实现副作用”。当 X 的初始化是系统自动行为（如种子写入）时，Y 的空状态几乎一定是 Bug，必须改为“Y 应返回全部可配置项”。composable 测试不得只 mock IPC 返回空数组，至少包含一条“IPC 返回非空数据 → composable 转发到响应式状态”的真实数据路径用例。**同一类缺陷的另一形态**：为「兜底/回退逻辑」写的用例，如果断言的是「兜底产出的结果正确」，就会把兜底本身的错误钉成契约（2026-09-26 账号昵称 Bug：`account-profile-collector.test.js` 断言「选择器全 miss 时回落 `document.title` 并剥掉平台后缀」为正确，而生产库 6/7 条脏 `account_name` 正是该兜底产出的）。写这类用例前必须先问「这个兜底源在语义上能不能等于被提取字段」；不能等于就把断言改成「不采纳」，并额外用**真实平台数据形态**（含颜文字、内嵌连字符、整块容器文本）做 fixture，不得只用为通过而构造的干净样例。

- **DOM 采集禁止把「标题类来源」当结构化身份字段**：昵称/用户名/账号名等身份字段只能来自**语义指向该字段的选择器**命中；`document.title`、`og:title`、`twitter:title` 是页面标题，永远不是账号昵称，一律不得作为兜底（未命中就不产出该键，交给「字段缺席 = 不修改」语义与展示端平台名回落）。同理禁止宽匹配选择器（`.user-info`、`[class*="creator"] span`、`[class*="profile"] strong` 这类会命中统计块/占位文案的容器），采集候选必须带长度上限等形态约束。修改 `accountInfoCollector` 或任何页面内采集器时必须跑 `apps/desktop/electron/tests/account-profile-collector.test.js` 全量。**同一缺陷的第二落点**：`auth-view-manager` 的 `captured.name` 就是 `document.title`，它既直接 POST/PATCH 进真源 `name`，又是 `profileForCreate` 的昵称兜底 —— 显示名/账号名的**每一个写入口**都必须过 `isNoiseAccountName`（新增 `resolveAccountDisplayName` 作为唯一入口），加校验时必须逐参数问「这个参数是否也承载同一待验证的东西」，名字带 `fallback` / `default` 的参数是校验最常见的漏项；改这两处写回点必须跑 `account-manager.test.js` + `account-manager-profile.test.js`。

- **枚举式黑名单必须配结构化正向契约**：任何「判定某串是垃圾/非法值」的守卫，不得只靠逐个列举已知坏值（`KNOWN_*` 集合是打地鼠，换平台换文案即复发）。必须同时存在按**形态指纹**的泛化规则（如「数字+量词+统计项」「以站点 chrome 词结尾」「含省略号」「括号开合不等」），并且**测试样本不得取自被枚举集合本身**（用黑名单测黑名单等于自证）。新增坏值时，先问能否写成形态规则，只有不能才进枚举表；新增枚举项必须同步补形态规则的负控用例，防止其误杀面扩大。判定函数存在 CJS/ESM 孪生实现时，新词表与新规则一律纳入 parity 断言（正则按 `source`+`flags` 比较）。

- **新增持久化字段必须同时改「所有」投影白名单，并配一条端到端穿透断言**：一个字段从后端到界面往往要连续穿过多道**手工维护的白名单**（本仓实测两道：`packages/python-backend/src/server.py` 的 `_account_to_dict` 与 `apps/desktop/electron/ipc-handlers/account.js` 的 `publicAccountFields`）。漏改任意一道的症状是「改了没反应」，而**两侧各自的单测都会绿**（后端测自己返回了、IPC 测自己透传了输入）—— 绿灯不代表链路通。必须补一条从落盘到渲染层 store 的穿透断言，或（更省）加一道读源码的「接线守卫」断言每道白名单都含该键，漏一处即红。同类：改字段语义时禁止在中间层做提前合并（如 `account_name: account_name || name`），那会让上游无法区分来源。

- **任何「用户输入落盘」的写入口必须先证明它写的是被读取的那份真源**：写副本不算完成。本仓存在两份账号存储（python-backend `accounts.json` 为读源；Electron SQLite 仅用于就绪门禁），`renameAccount` 长期走 `accountUpdate` → `store:update-account` 写 SQLite，于是**改名功能自引入起就是空操作**，且既有测试还把这条断链断言成正确行为（`expect(accountUpdate).toHaveBeenCalledWith(id, {name})`）。这是 learnings 记录的「装饰性链路」第四次复发。**判定手法**：给一个写入口收尾时，从「列表/详情读哪张表」反查写入目标，二者不同即缺陷；写入口的测试必须断言**具体通道与被写对象**，而不是断言「返回码为 0」。另注意 mock 陷阱：主进程若在 `require` 期就把依赖函数解构为本地绑定（`account-manager.js:13`），`vi.spyOn(module, 'fn')` 拦不到，须先给被缓存的依赖模块装好 spy 再重新 require 消费方，否则测试静默调用真实实现而**假绿**。

- **噪声/合法性类守卫的判据不得用「文本形态猜」，必须记录来源意图**：`isNoiseAccountName` 的作用是藏掉系统抓错的文本，但用户手改的名字也会命中形态规则（含 ` - ` / ` · ` / 省略号、以「服务平台」结尾、括号不闭合），于是用户的命名被永久藏掉，连编辑框回填的都是回落值。更危险的是反向误判：旧的回填保护用「现网名是否非噪声」推断「这是不是手改名」，实测在用户名字恰好长得像噪声时**会直接冲掉改名**。修法必须是显式来源字段（`name_source: auto|manual`），并且该字段要绑定在**界面实际优先读取的那个字段**上 —— 绑错字段会让 `manual` 永远不可见，等于没修。



- **GUI 主窗口等待预算**：Electron GUI runner 必须使用条件轮询等待主窗口，等待上限必须覆盖 `createWindow()` 之前所有串行启动阶段的健康检查 timeout 总和并保留余量。修改 Bridge 启动顺序、健康检查 timeout 或窗口创建时机时，必须同步更新假时钟边界回归；不得通过测试专用 skip 开关静默绕过生产启动路径。

- **全局单例事件监听器生命周期**：`autoUpdater` 等进程级 EventEmitter 不得在 BrowserWindow 重建时重复注册监听器。初始化函数必须把当前窗口/回调与“一次注册”分离：每次调用更新状态目标，只在首次调用绑定全局事件。回归必须用两个不同窗口连续初始化，并断言监听器数量不增长、单次事件只发送到新窗口一次。

- **跨实例事件订阅按 id 精确注销**：主进程中任何「渲染实例订阅集合」（`WebviewManager._subscribers` 等）都是**多 SPA 实例共享**的，注销 IPC 必须只按调用方自身的 `subscriberId` 删除，**一律禁止无 id 时 `clear()` 全清**，也禁止用 `Date.now()` 等粗粒度值作 id（同毫秒两实例取到同一 id，`Set` 去重后共享一条，任一方注销即误删另一方）。渲染层 store 必须在 `init()` 保存主进程下发的 id，并在 `dispose()` 原样回传；preload 包装函数不得丢弃该参数。回归锁：`apps/desktop/electron/services/webview-manager.test.js`「page-manager 事件订阅按 subscriberId 精确删除」+ `apps/desktop/src/stores/tab.test.js` dispose 回传用例。症状特征：原生 `WebContentsView` 照常显示（登录页/网页出现在当前标签区域），但 TabBar 不再出现新标签，且重启应用即恢复——遇到先查订阅集合大小，不要误判为标签注册逻辑失效。

- **Windows 路径身份断言**：生产代码返回 canonical 路径时，测试必须对实际值和期望值同时调用 `fs.realpathSync.native()` 后比较；不得用原始字符串、`path.resolve()` 或 `path.normalize()` 判断 8.3 短路径与长路径是否为同一文件，也不得为消除平台差异而放宽受控根、符号链接或越界检查。
- **行尾（CRLF）不是噪声：改前先认基线，改后必须保持**（2026-09-27 事故补写）：本仓 `CHANGELOG.md`、`01-docs/learnings.md` 等文档**在 blob 里就是 CRLF**，而新建的 JS/MD 文件多为 LF。用脚本或编辑器把 CRLF 文件整体写成 LF，git 会把**每一行**判为改动：本次 PR 的 diff 从内容级 13k 行膨胀到 42k 行，且此后**任何**并发会话合并这两个文件都会得到"整文件冲突"（两边都像重写了全文）—— 表现为"置顶型文档反复撞车"，真实原因却是行尾被改写。三条纪律：① 动手前先测基线 `git show <ref>:<file> | grep -c $'\r'`（或 `node -e` 数 `\r\n`），脚本改写时**逐行保留各自的行尾**（`split('\n')` 之后不碰任何一行 —— `\r` 本就是行内容的一部分 —— 再 `join('\n')`）；**禁止「探测多数派 eol 后统一回写」**，因为本仓这些 blob 自身就是混行尾，2026-09-28 实测行尾分布：`CHANGELOG.md` 14391 行 = 14365 行单 `\r` + **2 行 LF-only** + **24 行双 `\r`**，`01-docs/learnings.md` 16446 行 = 16437 + 3 + 6（两个数均经「各行类之和=总行数」与「`\r` 加总=文件 CR 总数」双重自洽校验）。统一回写会一次性改写 **26 行**（learnings 为 9 行）—— 即 ② 要抓的幽灵行，量级远超"一行"。**另有第二个独立缺陷**：若写成 `lines.join(eol) + '\n'`，文件**末行**的 `\r` 会被整体吃掉（末行分隔符是 `eol` 而尾部只补了 `'\n'`），实测再叠 1 行 ⇒ 27 / 10；要保留末行就得 `+ eol`，而这正说明"统一回写"没有一处是对的。② 提交前对账 `git diff --numstat` 与 `git diff --ignore-cr-at-eol --numstat`，**两个数差得远就是行尾被改**，别把幽灵行当成果；③ `git status`/commit 输出里的 `warning: in the working copy of 'X', LF will be replaced by CRLF the next time Git touches it` 不是噪声，它就是这件事的即时告警（本轮把它当作风控提示忽略了）。合并这类文件时的正解不是 union 硬合（那会把整份文件复制两遍，且"每行都在"的多重集对账依然通过），而是 `git show origin/main:<file>` 为底 + 只把自己的新增行插回去 + **逐行保留 main 那一行原本的结尾（不得统一成一种）**，并用多重集断言"两边的每一行都至少保留原次数"。

- **文件系统测试隔离**：测试不得把可写状态固定到仓库内共享文件。并行会话或重复 runner 可能同时执行时，必须使用 `os.tmpdir()` 下带 PID/随机标识的独立路径；原子写测试需在 setup/teardown 同时清理 final 与 `.tmp` 文件。

- **Windows 原子文件替换重试**：Electron 主进程或 Node 业务服务用“临时文件 + `renameSync`”迁移、全文重写用户状态、系统保护主密钥、加密凭据、API Key 等本地持久化数据时，必须让所有 rename 点保持相同的原子替换语义。Windows 上只允许对 `EPERM`、`EACCES`、`EBUSY` 做短且有界的退避重试；超过预算或遇到其他错误必须原样抛出/进入既有错误处理，禁止无限重试或退化为直接覆盖。回归必须分别锁住主文件、备份和业务数据目标，并使用真实 Windows 文件句柄制造短暂 delete-share 冲突，不得只 mock `fs.renameSync`。

- **API Key 单 writer 合同**：`PublishApiServer` 必须在自动迁移和监听端口前，对 `API_KEYS_PATH` 指向的持久化文件取得跨进程 writer lock；同路径第二实例必须以 `API_KEY_WRITER_LOCKED` fail closed。监听失败、迁移失败和 `stop()` 都必须释放锁，启动进行中的 `stop()` 必须等待启动收敛后再关闭，重复 `start()` 必须明确拒绝。Compose 必须把 `API_KEYS_PATH` 显式指向 UID `1001` 可写的持久卷；除锁竞争专项测试外，所有服务器测试必须使用系统临时目录中的唯一 Key 路径并在停止后清理。文件锁只实现单 writer 所有权，不代表支持共享卷横向多实例；扩容前必须迁移到具备事务或 CAS 的共享存储。

- **Story2Video 媒体工具资源闭包**：修改 Story2Video 的 FFmpeg/ffprobe 命令、`scripts/before-pack.js`、`scripts/stage-media-tools.js` 或桌面 `extraResources` 时，必须使用与目标平台/架构一致的原生构建主机；禁止把 Playwright 裁剪版或 Remotion 定制版 FFmpeg 当作通用媒体工具。打包前必须按 `media-tools-lock.json` 校验二进制字节数/SHA-256，并真实检查所需编码器、滤镜和 ffprobe；打包后必须确认 `resources/media-tools/ffmpeg(.exe)`、`ffprobe(.exe)`、资产锁、构建信息、许可证原文、包装层许可证与第三方声明存在，并在隔离用户目录中生成短视频再用捆绑 ffprobe 解码。有效打包资源必须优先于 `FFMPEG_PATH`/`FFPROBE_PATH`、宿主 `PATH` 和开发依赖，环境变量只能作为未找到打包资源时的开发回退；宿主工具或仅启动 8 秒不能替代该门禁。

- **GPL 媒体二进制发布约束**：静态 FFmpeg 启用 `--enable-gpl`/`--enable-version3` 时，安装包必须保留适用许可证和来源声明；公开分发前必须确认对应源码及构建材料的提供方式。许可证材料缺失时 `beforePack` 必须失败关闭，不得降级为警告。

- **Vue 模板语法**：修改 `.vue` 文件后，必须确认无模板编译错误（Vite HMR 报错或 `vite build` 通过）。使用 MCP node\_repl 的 splice 操作修改 Vue 文件后，必须检查新旧代码没有重叠或残留。

- **Vue 子组件 emit→父模板绑定交叉验证（R92）**：新增子组件 `$emit('xxx')` 时，必须交叉验证父模板中存在 `@xxx` 绑定。审查时对每个 `$emit('xxx')` 搜索父模板中 `@xxx` 绑定。**这是编译期不可检测的运行时沉默失效**——子组件 emit 存在、父组件方法存在，但缺少绑定，按钮点击无反应。

- **Bridge/子进程启动验证**：新增或修改 Bridge（BasePythonBridge 子类）时，必须验证：(1) `pythonModule` 指向的模块有 `__main__.py` 入口；(2) 真实执行一次 spawn + health check。不能只断言 `pythonModule` 字符串值。

- **composable↔模板导出一致性**：composable 新增/重命名导出属性时，必须同步更新所有使用该 composable 的 Vue 模板的解构列表。新增属性后应运行 composable 导出完整性测试。

- **AI 工具修改后的完整性校验**：使用 MCP node\_repl splice / PowerShell 字符串替换 / apply\_patch 修改大文件时，修改后必须用 `rg` 或 `git diff` 验证所有目标变更都已写入，不能假设「操作成功 = 内容正确」。

- **HTTP 路径前缀守卫**：任何 HTTP 服务（Express/Koa/http.createService/publish-api-server）的 `_handle` 入口必须在鉴权逻辑之前增加路径前缀守卫——只允许声明的业务路径前缀（如 `/api/v1/`）通过，非业务前缀直接返回 404 + 明确错误码（如 `PATH_NOT_UNDER_BUSINESS_API`），不进入鉴权。避免反向代理误路由时返回误导性鉴权错误（如 "Valid API key required"）。回归测试必须覆盖 5 个场景：(1) 业务路径前缀正常通过；(2) 非 /api/v1/ 的 Logto 内部路径返回 404 守卫错误码；(3) 根路径被守卫拦截；(4) 守卫在 webhook 之后（webhook 路径仍能通过）；(5) 守卫不调用 keyManager.load（避免副作用）。详见 [publish-api-server-path-guard.test.js](packages/api-publish-engine/test/publish-api-server-path-guard.test.js)。

- **Nginx 反向代理路由分离合同**：当一台 Nginx 同时反代业务 API container（如 `127.0.0.1:3030`）和 Logto container（如 `127.0.0.1:3021`）时，**禁止**用 `location /api/` 宽匹配反代到业务 API container，否则 Logto 自身的 `/api/users`、`/api/forgot-password`、`/api/sign-in` 等内部路径会被误路由。必须用精确前缀 `location /api/v1/` 反代到业务 API，其余路径兜底反代到 Logto。详见 [DEPLOYMENT-F14-BUSINESS-API-2026-07-24.md §8](01-docs/DEPLOYMENT-F14-BUSINESS-API-2026-07-24.md#8-nginx-路由分离合同2026-07-25-修订qm-5-回归)。部署后**必须**运行 `production-smoke.js` 验证 `api.path-guard/api/users` 和 `api.path-guard/api/forgot-password` 检查 passed，否则视为路由配置错误。

- **production-smoke 路由分离检查**：每次修改 Nginx 配置、业务 API 路由或新增 API 路径前缀后，必须运行 `node packages/api-publish-engine/scripts/production-smoke.js --logto <LOGTO_URL> --api <API_URL>` 验证：(1) 业务 API 的 `/api/v1/health`、`/api/v1/ready` 返回 200；(2) Logto 内部路径 `/api/users`、`/api/forgot-password` 不被业务 API 错误处理（返回非 "Valid API key required" 响应）。这是部署后自动检测反向代理误路由的合同测试。

- **可编辑性判断必须用数据语义而非字段存在性**：判断「历史记录任务是否可进入编辑页」时，不得仅凭 `projectId` 字段存在（主进程对 run-only 记录会把 projectId 回退为 runId，字段存在 ≠ 项目真实存在）。必须用 `historyType === 'story2video-project'`（真实项目）区分，run-only 记录（`historyType === 'pipeline-run'`）不得提供编辑入口。回归测试必须覆盖「run-only 记录即使带 projectId 也不可编辑、不跳转结果页」场景。详见 [CreateViewHistory.test.js](apps/desktop/src/views/CreateViewHistory.test.js) run-only 不可编辑用例。

- **删除 story2video 项目必须级联清理持久化 run-state 快照**：`story2video:delete-project` 只移除项目索引并尽力清理项目目录，但「已中断/失败/暂停」的编排 run 以 `RunStateStore` 快照（`userData/run-state/<runId>.json`）持久化，`pipelineHistory()` 会从快照重新加载。删除项目时必须同步调用 `runStateStore.remove(projectId)`（runId 与 projectId 同源），否则删除后重进历史页该任务会再次出现。回归测试必须用真实 `RunStateStore`（os.tmpdir 隔离目录）断言删除项目后 `load(projectId)` 为 null、`listRunning()/listFailed()` 为空；快照清理失败仅告警不阻断项目删除。详见 [story2video.test.js](apps/desktop/electron/ipc-handlers/story2video.test.js) 级联清理用例。

- **宿主事件的置位与收口必须取自同一对语义，且状态订阅必须写回「实际被渲染的那份状态」（MUST）**（2026-09-29 标签转圈卡死复盘，缺陷存续约 50 天）：给宿主事件（Electron `webContents` / 浏览器 / 子进程）做布尔状态机时，两条都不可省：① **配对性**——置位与收口必须取自宿主文档里语义成对的那两个事件，不得按「看起来像结束」挑。Electron 的 `did-start-loading` / `did-stop-loading` 在 `electron.d.ts` 里的原文注释就是「the spinner of the tab started / stopped spinning」，而 `did-finish-load` **只在主框架成功时**触发、失败与被中止（`did-fail-load` / `ERR_ABORTED`）路径上永不调发，用它收口 `loading` 必然永久卡住；崩溃类还须补 `render-process-gone` 就地收口（此后不会再有任何事件）。② **接线**——订阅回调写的字段必须就是渲染端读取的那一份。本案主进程广播的 `tab-loading` / `tab-finished-loading` 只改写 `navigation.loading`，而 `TabBar` 的徽标读的是 `tabs[].loading`（唯一来源是全量快照 `getAllTabs()`），于是徽标**自诞生起从未被实时熄灭过**，只在切标签时偶然纠正。判据手法：给任一「有事件、有订阅、有 UI」的指示器收尾时，必须从 UI 实际读的字段**反查写入者清单**（`grep` 该字段名），链路不通即缺陷；同一字段出现第二套写法（本案 `onNavigationChanged` 还把 `loading` 硬编码成 `false`）即口径分裂，必须收敛为「载荷带真值 + 字段缺席则保持现状」，**禁止**用 `!!data.loading` 把「载荷破坏」当成「结束」。另注：宿主事件回调被测试**当作夹具触发器**使用（只为驱动副作用链而 fire 某回调、不断言该回调自身的语义效果）时，「置位后收口永不到来」这一组合在测试里根本不可表示——本案单元/集成/视觉/审查四层同时漏过，视觉层还因图标占页面积 < 0.1% 对回归结构性失明。回归锁与六条反证变异见 `01-docs/PRD-BROWSER-NAV-ICONS-LOADING-2026-09-29.md` §3、§6。

### QM-3：测试策略

- 单元测试（1830 passed | 10 skipped）：覆盖核心业务逻辑 ✅

- 本地打包验证：覆盖 require 链、文件包含、语法 ✅（新增）

- Docker 运行时合同：按 runner `COPY` 清单构造隔离文件集并加载真实入口；生产镜像必须完成 build + start + readiness 回归。

- OIDC 生产合同：对真实租户 discovery/JWKS 执行 readiness，并分别覆盖允许的 RSA/EC 算法、错配密钥类型/曲线、未知 `kid` 与按 `alg:kid` 隔离的负缓存。

- 后续补充：main.js 启动测试（`node -e "require('./electron/main.js')"`）

- **composable 导出完整性测试**：所有使用 composable 的 Vue 组件，对应的 composable 测试必须包含导出完整性断言 — 列出模板需要的所有属性和方法，逐个 `toHaveProperty` 验证。防止模板引用未解构的属性。

- **Bridge 启动回归测试**：Bridge 子类的测试必须包含 `pythonModule` 值断言（不能只断言字符串，还要验证目标模块路径指向的包能被 `python -m` 启动）。已有用例如用例 13b。

- **测试文件必须显式接进 CI，否则等于没写（MUST）**：本仓**没有**任何自动收集机制覆盖 `scripts/` 与 `.github/scripts/`——vitest 只收 workspace（`apps/desktop` 等），根 `package.json` 的 `test` 是 `pnpm -r --if-present run test`（不跑根目录），CI 里每一条 `node --test` 都是逐个显式点名。所以新写一条 `*.test.js` / `*.test.mjs` / `*.test.sh` 而没在同 PR 里登记进 `.github/workflows/quality-gate.yml`（Gate 2b/2c），它**永远不会执行、也没有任何东西会因此变红**——实测 2026-09-27 检查域内 32 个测试文件有 8 个是这种死锁，其中 `session-init.test.sh` 一拉起来就 FAIL=1（它断言 `codex/` 前缀分支，而 `gwm-task.sh:38` 早在 2026-09-15 就把前缀改成 `MP_BRANCH_PREFIX` 可选；该断言与三处文档已按"代码为准"回灌，并由 `scripts/branch-naming-contract.test.js` 钉住）。接线判据由 `scripts/check-unwired-tests.js` 强制：按 workflow **可执行正文**匹配（注释里提一句不算接线）、同名 basename 必须写全相对路径、workflows 集合为空直接抛错而非判绿、欠账走 `KNOWN_UNWIRED` 且必须带原因、清单只能缩小。扫描域现含 `*.test.js` / `*.test.mjs` / `*.test.sh` / `*.test.ps1`。**检查域自 2026-09-28 起不再是两个写死目录，而是「全仓减去显式排除」**：`WORKSPACE_COVERED`（vitest 已按 workspace 收集的 `apps/`、`packages/`、`ops-center/`）与 `VENDORED_MIRROR`（上游技能制品的 vendored 副本 `.quality-rhythm/`），两张表由测试用 `deepEqual` 钉住、只能缩小。起因是旧口径把域钉死在 `scripts/` 与 `.github/scripts/`，于是**落在这两个目录之外的测试文件对棘轮完全隐身**——实测漏掉 `.quality-rhythm/.github/scripts/tpl-contract.test.js`：它被同目录那份 `.quality-rhythm/.github/workflows/mechanism-check.yml` 用 `node --test` 点名，读起来像“有门禁”，而 **GitHub 只调度仓库顶层的 `.github/workflows/`**，嵌套那份永远不会被排队执行。由此加一条同类判据 `NESTED_WORKFLOW_NOT_EXECUTED`：任何 `.../.github/workflows/*.yml` 出现在子目录即红，除非在 `KNOWN_NESTED_WORKFLOWS` 里带理由承认（承认清单同样只能缩小）。遍历还有一条硬约束：**读不动的目录必须抛错而不是静默跳过**——不完整的遍历判定全绿是假绿（与 worktree 链接扫描 R3 同款坑）。PowerShell 那 7 条已逐个实跑分档（`pwsh 7.6` 与 `Windows PowerShell 5.1` 各一遍，再以 runner 首跑为准）：**6 条接进 Gate 2d**，**1 条留在 `KNOWN_UNWIRED`**（`session-isolation-automation.test.ps1` 会注册真实计划任务且非提权必红）。三条要记住的运行时事实：① `applive-foreign-audit.test.ps1` / `start-desktop-profile-lock.test.ps1` 带小写 `#requires -Version 7`，在 5.1 下直接 `ScriptRequiresUnmatchedPSVersion` 拒跑（grep 时 `-i` 才能命中，别按 `#Requires` 大写照抄）；② `worktree-fs-longpath.test.ps1` 的负控「未加 `\\?\` 前缀的 `IO.Directory::Delete` 应当失败」写死了期望，而它实际绑的是**运行本测试的这个进程能不能走长路径**——同时受注册表 `LongPathsEnabled` 与该 exe 清单是否 `longPathAware` 影响（pwsh 7 带、5.1 不带，.NET FW 4.6.2+ 在 OS 开启后还自己补前缀）：本机 5.1 失败、本机 pwsh 7 成功、CI runner 两种 shell 都成功（run 36313053992 / step `Gate 2d-b`）。已改成**运行时探针实测本进程能力再选期望**（不能走 ⇒ 仍要求必须失败；能走 ⇒ 只要求结果与探针一致，深浅由该文件 `depth>260` 硬断言守住），并每次打印三元组留痕；本机两档各命中一条支路实跑。③ `session-write-guard.test.ps1` 曾在 runner 上红、本机绿（同一条 run），当时被我判成"只有 runner 知道"那一类并登记欠账——**判错了**：差异维度是宿主的 `core.autocrlf`（本机 `false`、GitHub windows runner 默认 `true`），用 `GIT_CONFIG_GLOBAL` 指到一个只写 `[core] autocrlf=true` 的临时文件即可在本机确定性复现，红因见下一条 MUST，已修并回接。由此修正口径：**"绿灯与否只有 runner 本身算数"只适用于本机不可复现的维度（runner 自己的清单位、注册表状态）；先问差异落在哪一维、这一维是否可配置（git 全局配置 / 环境变量 / shell），可配置就必须在本机复现后修测试，不得记成欠账**。事实②那条确实不可在本机 runner 等价条件下复现，仍留欠账。新增任何一条不接线的测试都会立刻变红。同源坑：`.gitignore` 第 106 行 `scripts/*.js` 默认忽略新建脚本（`git add` 会当场报错），新工具须按既有惯例补一条 `!scripts/<name>.js` negation。

- **执行记录里的「待办状态」必须有东西在检测，否则它会永久说谎（MUST）**：`.quality-gates.md` 每条记录都有一行 `| 远程同步 | … |`，本意是"合并后回来回填证据"。实测 origin/main 上 127 条该行的状态列有 **22 种自由写法**、其中 32 条停在 `PENDING / OPEN / 待 PR 合并后核验 / 进行中 / （待填）…`，而**没有任何门禁检测这笔欠账**——已合并的记录顶着"没干完"的字样被下一个会话读到，就是重复开工的入口（95 条确实被回填过，说明约定存在，缺的只是 enforcement）。机制：`scripts/check-gate-record-debt.js` + `scripts/gate-record-debt-ledger.json`（接在 `Gate 2c`），口径三条——① 状态列按**闭合词表**判（`PASS`/`N/A`/`✅`/`已…`），未知写法一律算未收口（fail closed，否则换个新词就能绕过）；② 每个未收口行必须按**所属记录标题**在清单里带原因登记，标题改了会同时报「未登记欠账」和「陈旧登记」两条红（键漂移不许静默）；③ **回填一条记录必须顺手删掉它的登记项**，这条耦合使清单只能缩小。回填口径沿用既有写法，且字段一律可离线取证：`git log origin/main --grep='(#NNNN)$' --format=%H|%cI` 取 merge SHA 与时间、`git ls-remote --heads origin <branch>` 返回 0 行证远端分支已删——**不得**凭记忆或推测写 SHA。新会话给自己写 `PENDING` 行时，必须同时往清单里加自己那条并写明"合并后由后续 docs PR 回填并删除本条"。

- **一个 `run:` 块里塞多条测试命令时，必须用 `shell: bash`（MUST）**：PowerShell 步骤**不会**在中间某条命令非零退出时中止 —— 只有最后一条命令的 `$LASTEXITCODE` 决定步骤成败。后果是"前 5 个门禁红、第 6 个绿 ⇒ 步骤照绿"，一条看起来在守、实际恒绿的装饰门禁。实测：`quality-gate.yml` 的 `Gate 2d`（`shell: pwsh`）里 `session-write-guard.test.ps1` 抛 `FAIL: shared status stays clean after tracked restore` 之后，后续测试照跑、步骤照 success、PR 照合并（run `36313053992` / step 11）。GitHub 的 `shell: bash` 默认带 `-e -o pipefail`，任一非零即中止；确需 pwsh 时必须在正文里显式 `if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }`。判据由 `scripts/check-step-failfast.js` 强制（含 ≥2 条测试命令的 run 块若非 fail-fast 即红，欠账清单保持为空）。同源教训：**判定"某测试在 CI 里到底成不成"，本机实跑只能筛掉必然不行的**——但"只有 runner 本身算数"只适用于本机复现不了的维度；`core.autocrlf` 这类可配置维度必须先用 `GIT_CONFIG_GLOBAL` 在本机复现，别把可修的差异记成欠账（本仓实测：写保护恢复断言属可复现、已修；长路径负控属 runner 清单态、仍挂欠账）。

- **断言 `git status` 干净度的测试夹具，必须自己声明 EOL 档并把索引交给 checkout（MUST）**：守卫 `guard-shared-root-writes.ps1` 恢复 tracked 文件走 `git restore --source=HEAD --worktree`。它的测试夹具原来用 `git init` + `git add` 现场造仓库，于是量的不是守卫而是 git 的换行启发式。实测 8 格（{混合行尾, 单 LF} × {无属性, `* text=auto`} × {autocrlf false, true}）：`init`+`add` 形态 5 格在恢复后报脏，`clone` 形态 8 格全干净，且**「纯 `git restore`」与「经守卫恢复」逐格完全相同**——守卫无责。三条口径：① 被测工作树必须由 `git clone`/`checkout` 建立（`git add` 现场造的索引不带 git 的转换状态）；② EOL 档位由**夹具自己提交的 `.gitattributes`** 声明，`text eol=lf` 与 `text eol=crlf` 两档都跑，禁止让结论依赖宿主 `core.autocrlf`（真仓根是 `* text=auto`，其落地形态恰好由宿主配置决定，这正是"本机绿 CI 红"的来源）；③ 夹具内写文件一律 `[IO.File]::WriteAllText` 显式 LF，禁止 `Set-Content -Encoding UTF8`（5.1 加 BOM、pwsh 7 不加，同一夹具两个 shell 两种字节；且它会在值尾再补一个宿主换行，写出 `'\n\r\n` 混合行尾——就是那 5 格的触发条件）。配套：断言"恢复成功"必须**读工作树内容**，禁止读 `git show HEAD:<path>`——HEAD 里永远是被覆盖前的版本，守卫什么都不做该断言也通过（本仓上一条即是装饰性断言，反证：把守卫恢复动作摘掉后 `git show` 版仍绿、读工作树版变红）。

- **测试在 CI 上跑不过时，有且只有两条正解，且共同禁止"放宽断言 / 加 skip / 改记欠账"（MUST）**：判「是环境不对还是断言不对」之前，先分清这两类，因为它们的修法**方向相反**——
  ① **夹具该更像真实形态** ⇒ 把环境造成那个形态，别改断言。适用：断言依赖 git 索引 / EOL / 分支名 / hooks 等"由检出方式决定"的前提。先例三连：`session-write-guard.test.ps1` 改成 `git clone` 出工作树 + 夹具自声明 `.gitattributes`（#2516）；`session-isolation-automation.test.ps1` 因 `mp-worktree-health.ps1:106` 在 `-RequirePrimary` 下硬要 `branch==main` 而 CI 给的是 detached HEAD，正解是在 `$RUNNER_TEMP` 造一个**自有临时 clone**（`checkout -B main` + 复制两个 hook）后在里面跑（本轮）；共享根写保护的反证一律用 `%TEMP%` 临时仓库跑同一段代码。
  ② **期望该由实测推导** ⇒ 断言的期望值来自**本进程当场探测到的能力**，两条支路各自成立。适用：结论绑在"这台机器/这个 exe 有没有某能力"上，而不是绑在某个可配置形态上。先例：`worktree-fs-longpath.test.ps1` 那条「未加 `\\?\` 前缀必须失败」的负控，实际由注册表 `LongPathsEnabled` + 该 exe 清单 `longPathAware` 共同决定（pwsh 7 带、5.1 不带），本机/runner 三方不一致 ⇒ 改成运行时探针先测能力再选期望，深浅由 `depth>260` 硬断言守住（#2521）。
  **共同禁止项**：放宽断言、`skip`/`return` 早退、把文件从检查域里摘掉、或再登记成欠账来"让它不红"。这些都是把锁拆掉还留一盏绿灯——本仓把它记作「装饰性门禁」。三条判据：(a) 每次跑必须**打印本次走的是哪条支路 + 关键实测值**（如 `LIVE_TASK_COUNT=0`、`(probe) processCapable=True depth=628`），否则下次没人知道它测了什么；(b) 归因先问**这一维可否本地配置**（`GIT_CONFIG_GLOBAL`、环境变量、shell），可配置就必须本地复现（见 [[project-mulpub-runner-only-red-attribution]]），不许直接挂"只有 runner 知道"；(c) 销账与接线**必须同一次发生**——清空白名单而不点名进 workflow，或接线了而白名单还留着，都当场红（`check-unwired-tests.js` 用 `deepEqual` 钉死清单内容，另加「已销账文件必须仍在检查域内」防"排出域作弊"）。

- **文本结构断言（MUST）**：凡断言**文本结构**（换行 / 分段 / 分隔符 / 字段顺序 / 序列化格式）的测试，必须**至少一条 `toBe` / `toEqual` 精确断言或结构断言**（如 `expect(out.split("\n")).toEqual([...])`），`toContain` 仅可作为补充。原因：纯 `toContain` 子串匹配对结构性回归**完全免疫** —— 正文被压成一整行时每个子串依然命中（2026-09-16 采集页正文换行全丢即由此逃逸，见 `01-docs/BUGFIX-COLLECT-NEWLINE-PRESERVE-2026-09-16.md`）。新增/修改文本提取、解析、格式化类代码时必须同时补一条精确断言，并用「修复前实现副本」实测确认该断言能抓住 Bug。

- **全仓关键词复扫必须带 `-a`（MUST）**：本仓 `01-docs/PRD.md`、`01-docs/learnings.md` 等历史文档含 NUL 字节，`grep`/`rg` 默认把这类文件判为二进制并**静默跳过**，只输出一行 `Binary file ... matches`，命中数直接归零——于是「全仓扫到 0 命中」这类收口结论对真正有问题的文件完全失明（2026-09-26 实测：`grep -rn 立即同步 01-docs/PRD.md` = 1，`grep -rna` = 10）。凡以「扫到 0」作为完成判据的检查，一律 `grep -na` / `rg -a`，并额外确认**扫描器没有把这些文件当二进制**（`grep -c` 单文件计数对照）。

- **测试库/配置状态必须按模块确定化，不得依赖导入顺序（MUST）**：`config.settings` 这类**导入期单例**会让「模块级设环境变量再 import」的写法只对第一个被收集的测试文件生效——其余文件自设的临时库全部失效，整个 session 共用同一份状态，任一文件 teardown 里的 `drop_all` 都会波及其他文件，表现为「单跑绿、全量红」的假失败。修法：在 `tests/conftest.py` 里做**按模块**的 autouse 重置（幂等补齐 schema + 按外键逆序清空全部行 + 复位 `sqlite_sequence`），并用回归对锁定（制造方推进 rowid 并 `drop_all`，消费方不建表不清库、断言新父行 `id == 1` 且能写外键子行）；把该 fixture 改成 no-op 必须**立刻变红**，否则锁是装饰性的。既有案例：`ops-center/backend/tests/conftest.py::_isolate_database_per_test_module` + `tests/test_zz_conftest_isolation_a_wrecker.py` / `..._b_consumer.py`。归属纪律：全量红而单跑绿时，先在**未改动的 main** 上跑同一条全量做对照，既禁止把既有缺陷认领成本 PR 引入，也禁止反过来以「不是我改的」直接放行。 **但对照只证明「既有缺陷存在」，不证明「本 PR 无关」**：本 PR 自己可能叠加第二颗独立的雷（实测：#2397 清库修好后，本仓一条 5 路 `async_session` 并发的用例仍会让远处模块报外键失败）。所以必须二分到自己身上——用 `--deselect` 逐条摘除本 PR 新增用例跑全量，配合「摘掉修复即变红」的反证定责。规则：**在测试里开并发 session 的用例，必须在 `finally` 里 `await engine.dispose()` 归还连接池**（aiosqlite 池连接绑定事件循环，跨用例复用会读到过期 WAL 快照）。
- **清库/删数据类测试夹具自身必须 fail-closed 校验目标在仓库外（MUST）**：一条「DELETE 全部表」的 autouse 夹具，其目标来自**导入期单例** `config.settings.db_path`，而该默认值是**相对 cwd** 的 `data/config.db`。整轮套件绑到哪个库，历史上取决于「第一个被收集且设了 `OPS_DB_PATH` 的模块」——所以只要有人**单跑**一个没设该变量的模块（本仓实测：`pytest tests/test_security_config.py`），夹具就会去清空共享开发库的全部行（含 `admins`，症状是运营后台 admin 登录返回 503「未配置管理员账号」）。因此这类夹具必须同时具备两件事：①在 `tests/conftest.py` **导入期**就把 `OPS_DB_PATH`/`OPS_CONFIG_OUTPUT_DIR` 兜底到会话级临时目录（宿主显式设置的仍优先），把「谁先导入谁定绑」这条脆弱前提**收窄**（注意：`setdefault` 只兜住未显式赋值的场景，模块若在 import config 前自己写 `OPS_DB_PATH`，它仍然是定绑者——所以谓词那条一道防线不能省）；②动作**开始之前**用纯谓词（如 `is_safe_reset_target`）断言目标不在仓库内，违反即抛错，禁止「先清完再报」。回归锁见 `ops-center/backend/tests/test_conftest_db_isolation.py`：一条用**真子进程 + 弹掉 `OPS_DB_PATH`** 跑出实际绑定路径，另两条锁谓词与动手前的拒绝。

- **文本空白归一化（MUST NOT）**：清理 HTML 源码缩进噪声时**禁止**用 `replace(/\s+/g, ' ')` —— `\s` 含 `\n`/`\r`/`\u2028`/`\u2029`/全角空格 `\u3000`/NBSP `\u00a0`/BOM `\ufeff`，会把**语义换行一起压掉**，正文变成一整行。正确口径：行内空白压缩用 `[^\S\n]+`（显式排除换行）；块级结构（`p`/`h1-h6`/`blockquote` → 段间空行，`div`/`li`/`tr` → 单换行，`td`/`th` → 制表符，`<br>` → 换行，`<pre>` → 原样保留）在 DOM 层转成换行，最后只做「连续 3 个以上换行压成 1 个空行」收口。正文提取统一复用 `apps/desktop/electron/services/readable-text.js`（`extractReadableText` / `normalizeExtractedText`），禁止在采集通道里另写一套。

- **等待/就绪判据必须锚定「只随目标状态出现」的最小出口（MUST）**：E2E/集成测试里 `waitForFunction` 一类的就绪判据，若把「容器有文字」挂在**常驻节点**（应用外壳、侧边栏、导航）上，该条件恒为真 —— 等于没有等待，懒加载 chunk / 异步挂载从未被 await。**症状指纹**：导航后**第一条断言随机红、紧随其后的断言绿**，且落点路由不固定 —— 因为第一条独吞了本应由等待吸收的编译时间，它烧掉的预算又让后面的断言恰好赶上加载完成。修法：判据指向真正的**内容出口**（本项目为 `App.vue` 的 `[data-testid="mp-workspace"]` / `[data-testid="fullscreen-view"]`）并要求其 `textContent` 非空。收紧门禁时**必须带回退**，且回退**只在超时分支**触发（非超时错误原样抛出），否则会把间歇误红变成确定性硬失败。**回归手法（可复用 pattern）**：mock `page.waitForFunction` 把谓词回调**抠出来当纯函数**调用，配最小假 DOM 断言其布尔返回值 —— 不需要浏览器与 dev server 即可进 CI 快速单元阶段。既有案例：`apps/desktop/tests/e2e/helpers/functional-runner.js::waitForAppReady` + 同目录 `functional-runner.test.js`「应用就绪判据合同」。

- **上一条的镜像要求：瞬时故障的「可恢复」判定必须覆盖整条加载链，且恢复逻辑必须同时处理自己产生的证据（MUST）**：同一个错误码（本项目 `net::ERR_NO_BUFFER_SPACE`）会打断**两条**路径 —— 文档导航（`page.goto` 自己抛错）与**子资源**（模块 chunk / CSS：`goto` 成功，只有 `page.on('requestfailed')` 看得见，后果是应用壳子永不挂载）。只给前者加重试 = 给后者留一颗硬红雷，且后者在产物里表现为「`locator('#app')` 超时不可见 + `34 × locator resolved`」（节点一直在、零高度），**「resolved 很多次」不是「快好了」的信号，是「等错东西」的信号**。判据必须是「超时 **∧** 本次导航期内确有该错误码的资源失败」两条同时成立，且**证据光标在 `goto` 之前落位**（`resourceFailures.length` 快照）—— 陈旧证据会污染后续所有 spec，一次故障演变成整轮全红。重载次数必须有硬上限（本项目 `MAX_APP_READY_RELOADS = 2`），且**无证据 / 非超时 / 预算耗尽一律原样抛出**。**最难的一步是证据卫生**：重载不会抹掉旧页面状态的 console 错误，于是「已经恢复了」的运行仍会被自家的 console 门禁与产物 `consoleErrors` 判红（实测同一事故同时打红两条门）—— 必须按错误码**精确**移出 `consoleErrors` 并落入独立留痕（`recoveredTransientErrors` → 产物 `transientRecoveries` / `recoveredConsoleErrors`），**非该码的错误一律不得移出**，预算耗尽时末次证据必须原样保留。回归锁：同文件「应用就绪超时后的有界重载合同」「页面观测挂载合同」（`launch()` 需真实浏览器无法单测 ⇒ 监听挂载收敛为 `attachPageObservers(page)` 并用假 page 测，另加一条源码结构锁防「launch 绕开该方法」）；四种变异（预算改 0 / 光标失效 / 无差别清噪 / 删 `requestfailed` 监听）均已实测变红。
  - **⛔ 但上面那条恢复实现自己先失效过一次，根因是"恢复动作没真的重做副作用"（MUST，2026-09-27 实测）**：`#2455` 把恢复写成"对完全相同的 URL 再 `page.goto` 一次"，而 Chromium 下这是**同文档导航** —— 实测 `window` 标记存活、**子资源 0 次重新请求**；只有 `page.reload()` 会重建文档并重取（实测 64 个模块）。于是"重载"白烧满预算后抛同一个超时，恢复路径整体空转，而**单测与 CI 全绿**：假 `page.goto` 只记录调用，"有没有真的重取资源"在这类夹具里不可表示。**口径**：① 写 retry / reload / refetch / reconnect / 重启子进程型恢复时，必须先确认该动作**重做了哪个副作用**，并在目标运行时上实测一次，禁止从 API 名字推断（`goto` 这个名字本身就骗人）；② 单测夹具必须把这条实测语义编进去（本项目：假 page 规定"同 URL 的 goto 不让应用挂载，只有 `reload()` 会"），使该用例对错误原语必须变红 —— 只断言"我调用过某个方法"的夹具不构成回归锁；③ 恢复循环每轮都要**重新落证据光标**（`reload` 前复位 `resourceFailureMark`），否则旧证据会把预算烧在已经换因的失败上，表现为一次抖动 → 每个 spec 各多烧 N×超时 → 整轮时长翻倍；④ 恢复动作自身被同一个瞬时码打断时，要把这次打断**记进证据账**（它就是一条新的瞬时观测），否则下一轮会因"本轮无证据"而放弃剩余预算；⑤ 原语换掉后失去读者的状态（本案 `lastNavigationUrl`）连赋值一起删，留著就是让下一个人重抄同一个错误。**回归锁**：同文件「应用就绪超时后的有界重载合同」新增 3 条（真重取语义 / reload 被打断仍用满预算 / 本轮无新证据立刻收口）；变异"退回同 URL goto"与"改成 no-op"各让 **6 条**变红。真实浏览器端到端对照（本机 Edge）：入口模块被丢弃 + 真实 `runner.goto()` → 首轮 14.9s 失败 → 1 次重载 → 2.0s 挂载成功；同场景只做两次同 URL `goto` → 入口模块 0 次重请求、`#app` 始终未挂载。

- **等待预算必须按「相位」拆分，环境开销不得与被测语义共用一个预算（MUST）**：一条"等子进程/外部宿主到达某状态"的等待，若只有一个预算，就把**宿主进程启动开销**（本仓 Windows 锁夹具 = `powershell.exe` 冷启动：CLR/AMSI/Defender）和**真正被测的那一步**（能不能拿到独占句柄）压成同一句话。后果不是"慢"，是**不可归因**：`stdout=""` 且无 exit 事件在旧文案里只能读成"锁没拿到"，而实测根因是启动被饿死 —— 与断言毫无关系。硬约束：① 让被等待方在**做被测动作之前**先吐一个 `READY` 类标记，两相位各带独立预算与**点名相位**的错误文案；② 预算值必须有**实测分布**支撑，禁止把"某宿主启动是秒级"这类未量过的断言写进注释当依据（本案注释原文如此，实际满载下首个字节 3.6–8.4s、CI 上超过过 20s）；③ 每次跑都留痕（`[windows-file-lock] ready= locked= verify=`），让下一次调参有数据，而不是再猜一轮；④ 总预算与用例超时的关系仍受下一条「预算倒挂」约束。既有案例：`test-helpers/windows-file-lock.js` + `apps/desktop/electron/services/windows-file-lock.test.js`「握手相位」「预算不得倒挂」。

- **夹具/子进程「自报成功」不等于效果成立，必须从对侧反向验证（MUST）**：任何以"对端打印了一个标记"为完成判据的测试夹具，都是把**声明**当成了**事实**。本仓实测到一条完整的假绿路径：去掉 `& { param($file,$holdMs) }` 块后命令行尾参不再绑定 ⇒ `$file` 为空 ⇒ `[IO.File]::Open` 抛异常，但 PowerShell 默认 `ErrorActionPreference=Continue` **继续执行下一条语句并照样打印 `LOCKED`** —— 夹具变成 no-op，消费用例对着"根本没有锁"的文件断言重试逻辑并全绿，而且比正确实现**快 4 倍**（看起来像优化）。口径：① 拿到标记后，从**父进程/调用方**做一次反向探针（本项目：请求写权限的 `openSync(path,'r+')` 必须失败才算真持有），不成立即 fail closed 并回收子进程；② 探针本身必须再配一条「无任何持有者时必须判不成立」的用例 —— 只测"有锁时能查出"证明不了它不会恒真；③ 这类"更快/更简单"的变体在动手前必须回答"它还持有那个东西吗"。变异对应红度：探针恒 true / 探针默认关掉 各让本文件变红。同族纪律见「测试断言不得反向固化错误行为」「门禁断言随实现迁移同步」。

- **测试层禁止真实出站，等待必须可打断，且警惕「预算倒挂」（MUST）**：本仓 **没有** `nock`/`msw`/`setupServer`（实测全仓命中 0），"测试不出网"没有任何传输层兜底，全靠逐文件注入 —— 漏一处就是一次真出站，而真出站挂起时先撞上框架 `testTimeout`，红里只剩 `Test timed out in 10000ms`，看不到主机也看不到出路。四条硬约束：① **禁止真实出站**：桌面侧唯一实现是 `apps/desktop/test-setup.js` 里对 `net.Socket.prototype.connect` 的守卫（放行 `127.0.0.1`/`::1`/`localhost` 与 unix/pipe。**注意跨运行时**：Node 22 的 `_http_client` 会把 socket 早期错误改写成 `socket hang up`（CI 实测，本地 Node 24 不改写），所以守卫必须**同时记账**（`globalThis.__mpBlockedEgress`）并按 host 去重 `console.warn`；测试断言只依赖"秒失败 + 账本有记录"，不要在 http 路径上断言错误文案，其余 emit `[TEST-NETWORK-BLOCKED]`）；需要 HTTP 就构造注入（`new X({ axios })`/`fetchImpl`）或 `__registerMock("axios", 桩)`，本地服务一律 `listen(0, '127.0.0.1')`。② **禁止只在微任务里让出的自旋**：`while (...) await Promise.resolve()` 对基于 `setTimeout` 的超时机制**免疫**，条件永不满足就是 worker 死循环（只能靠 job 级 30 分钟预算硬杀）；轮询必须让出宏任务（`await new Promise(r => setTimeout(r, 0))` 或 `vi.advanceTimersByTimeAsync`）并带 deadline + 响亮错误。零容忍门禁：`.github/scripts/check-test-microtask-spin.js`（Gate 19，含"合法写法不得命中"的反例夹具）。③ **预算倒挂检查**：凡"期望被调方快速失败"的用例，被测侧超时（如 `zhihu-favlist-service.js` 的 axios `timeout: 15000`）必须**小于** `testTimeout`（10000），否则永远是框架先赢、错误信息先被吃掉。**同一判据的夹具侧镜像（2026-09-27 实测）**：`account-state-restorer.test.js` 的 Windows 锁用例**没写** `timeout`，继承全局 10s，而夹具握手预算 20s ⇒ 冷启动一超 10s 就只剩框架超时、诊断全被吃掉。口径：夹具的**总预算**必须由它自己单点导出（`LOCK_CASE_TIMEOUT_MS`），所有消费方一律引用该常量，并加**扫描式接线守卫**（发现裸数字 `timeout:` 或未引用即红）—— 靠"约定大家都记得写"必然会漂，一个漏写的用例就是隐形倒挂。④ **新增测试文件名不得匹配 `.gitignore` 的 `test-*.js`**（该规则本意是清临时产物，未锚定目录，会把新用例静默排除在 git 之外 → CI 永远不跑它）；仓库自带 `electron/tests/e2e-quality-infrastructure.test.js`「源代码测试文件不得被 .gitignore 静默排除」会拦住，别绕过它，改名（例：`test-setup-network-guard.test.js` → `network-egress-guard.test.js`）。新增守卫类夹具若要在测试 realm 外打补丁，注意 Node 24 的 http/undici 会把 `[options, cb]` **当单个数组参数**传给 `Socket.prototype.connect`，不递归展开就判成 unknown 而静默放过 —— 读不出目标必须 `console.warn` 出声。既有案例：`apps/desktop/electron/services/network-egress-guard.test.js`。

- **门禁断言随「平台/实现迁移」同步（MUST）**：凡改动 **runner / OS / 工作流步骤名 / 组件实现细节 / 工具抽取 / locale 值 / 文件增删**，必须全仓检索并**同 PR 更新**锁死旧前提的门禁断言与基线，否则会留下**长期不可自愈的假红灯**（无人认领、且与本 PR 无关）。已知必须同步的文件：
  - `.github/scripts/workflow-contract.test.js` —— workflow 结构；含 GUI gate 的 `xvfb-run` 断言（xvfb 是 Linux-only，迁 `windows-latest` 后必须反转为 `doesNotMatch`）
  - `.github/scripts/autonomous-loop-workflow.test.js` / `check-route-registry.test.js` —— 同类结构断言
  - `apps/desktop/tests/gui-ci-exit-contract.test.js` —— Electron CI 结构：`runs-on`、step 名、归档文件名（`linux-x64`↔`win32-x64`）、诊断命令（`ps -eo`↔`tasklist.exe`）、`|| true` 断言的**作用范围**（诊断步骤可合法吞错，冒烟步骤不可）
  - `scripts/debt-baseline.json` —— `maxFileLines` / `filesOver500` / `modelProviderRequireFanOut` 等指标须**逐项**核对，**别只改前两项**；更新即「如实记录现状」，须在 PR 说明是接受漂移而非清理
  - 渲染端测试 —— 断言 **i18n 键**而**不是 locale 字面量**（字面量会在文案调整时假红）；mock **被测代码当前真正调用的依赖**（如 `@/utils/clipboard` 的 `writeClipboard`），而非它曾经的底层浏览器 API；组件被删除时同步删除其专用测试与专用 locale 死键
  - **判定「红灯是否本 PR 引入」的标准路径**：① `gh run list --workflow=<wf> --limit 8` 看**同一 job 在本 PR 之前的 main run 是否已红**；② `gh api .../actions/jobs/<job_id>` 读 `.steps[]` 定位失败步骤；③ 下该 job 日志取失败文件清单（大日志须 `curl --max-time 900`，`gh run view --log-failed` 对大日志静默返回空）；④ `git show --name-only <my-sha>` 比对是否在本 PR diff 内。**别只看结论就认领**。
  - 实证：2026-09-17~18「全量迁 windows-latest 云 runner」+ #1899「统一空态」+ #1891「剪贴板工具抽取」三处改动漏更 → main 上 Electron CI 与 Quality Gate **长期红灯**（`3 failed / 542 passed`），最终由 #1907 + #1924 + #1927 才收口；期间至少两个会话重复诊断同一根因。

### QM-4：视觉回归测试

**框架位置**：`apps/desktop/tests/visual-testing/`

| 测试模式         | 依赖                  | 适用场景                |
| ------------ | ------------------- | ------------------- |
| **像素对比**     | Resemble.js         | 日常开发（默认，无需 API Key） |
| **OCR 文字提取** | Tesseract.js        | 日常开发（默认，无需 API Key） |
| **AI 视觉**    | OpenAI / Claude（可选） | 仅 CI 无人值守流水线        |

**集成规则**：

- `pre-commit`：**不集成**视觉测试（需要 dev server 运行，触发频率过高）

- **日常开发**：改完 UI 后用 `--single` 单独验证

  ```bash
  node apps/desktop/tests/visual-testing/views/all-views.visual.test.js --single home-default
  ```

> ⚠️ **视觉用例有两份清单**：`views/all-views.visual.test.js` 的 `viewTests`（`test:visual` / `test:all:visual` / `--single`）
> 与 `scripts/run-pixel-tests.js` 的 `pixelTests`（**`QG Visual` Gate 7 只执行这一份**）。只登记前者会得到一条必然的"绿"，
> 它等于没跑。新增像素用例必须两处都登记，并以「CI 日志里该用例名出现次数 > 0」为通过证据。
> 
> **全量四套注册表**（views / supplementary-views / workflows / supplementary-workflows）由 `scripts/run-all-visual.js` 单点聚合：
> 聚合器直接 `require` 各模块的导出数组（`toBe` 引用相等由 `visual-ci.test.js` 锁），**不得另抄一份清单**；
> 每套输出一行 `[VISUAL-SUMMARY] suite=<id> total= passed= failed= elapsed_ms=`，这是"这套用例真的在 CI 上跑过"的唯一现场证据。

- **PR 合入前（必须通过）**：像素对比核心视图，无需 API Key

  ```bash
  cd apps/desktop && npm run test:visual:pixel
  ```

- **发版前（人工核查项，非自动硬门禁）**：完整回归（103 个测试：35 + 19 视图 + 31 + 18 工作流）由 `tests/visual-testing/scripts/run-all-visual.js` 逐套隔离执行——**一套红不会停掉后面三套**（旧 `a && b && c && d` 串联会让"CI 产物里有没有这套截图"取决于前一套的成败）

  ```bash
  npm run test:all:visual
  ```

- **CI 流水线**：AI 视觉可选，有 Key 才跑，无 Key 安全跳过

  ```bash
  npm run test:visual:ci
  ```

**依赖**（已在 `package.json` 中）：

- `playwright` — 浏览器自动化

- `resemblejs` — 像素对比

- `tesseract.js` — OCR 识别

- `openai` / `@anthropic-ai/sdk` — AI 视觉（仅 CI 可选）

**门禁规则**：

> `npm run test:visual:pixel` 返回非零退出码 → **禁止合入 PR**

## 视觉测试框架(供其他 AI 使用)

> 完整说明文档:[apps/desktop/tests/visual-testing/USAGE.md](apps/desktop/tests/visual-testing/USAGE.md)

### 一句话介绍

本项目使用**像素对比 + OCR + Agent 视觉判断**三层视觉回归测试框架,**完全本地运行,无需任何外部 AI API Key**。

### 框架位置

```
apps/desktop/tests/visual-testing/
├── views/        # 单视图快照(54 用例：35 核心 + 19 补充)
├── workflows/    # 多步工作流(49 用例：31 核心 + 18 补充)
├── providers/    # 本地检测器:像素对比 + OCR
├── base-screenshots/  # 基准图(8 张核心视图)
└── reports/      # diff 图 + judge-report.md + JSON
```

### 三种检测能力

| 能力                | 是否需 Key | 适用         |
| ----------------- | ------- | ---------- |
| 像素对比(Resemble.js) | ❌ 本地    | 日常开发、PR 合入 |
| OCR(Tesseract.js) | ❌ 本地    | 文字内容校验     |
| Agent 视觉判断        | ❌ 自带    | 像素失败后最终判断  |

### 命令速查(必须 `cd apps/desktop`)

```bash
# 单视图快速验证(改完 UI 后)
node tests/visual-testing/views/all-views.visual.test.js --single home-default

# PR 合入前(必跑,门禁)
npm run test:visual:pixel

# 像素失败后生成 Agent 判断报告
npm run test:visual:agent

# 发版前(必跑,103 用例全量;逐套隔离,一套红不停后面三套)
npm run test:all:visual
```

### 强制规则(MUST)

1. **pre-commit 不集成**视觉测试(需 dev server,触发频率过高)
2. **PR 合入前必须通过** `npm run test:visual:pixel`(非零退出码禁止合入)
3. **发版前人工确认**已跑 `npm run test:all:visual` 且无未审核的回归（**当前 `scripts/release-gate.mjs` 未将视觉回归纳入硬门禁**，它只核验版本 bump + CHANGELOG 收口 + 破坏性变更级别；因此本条是人工核查项而非自动拦截。若要将其升级为「必须通过」的硬门禁，需先给 release-gate 接入视觉回归结果标记的硬检查，并定义时长预算/flaky/基线策略）。
   自 2026-09-28 起全量四套**已由 CI 每次 main push / dispatch 代跑**（Visual Tests workflow 的 `Full visual suites` 步骤，产物在 `visual-test-reports` artifact），人工核查项从此不必每次手跑；**自 2026-09-29 起该步骤是阻断门禁**——此前刻意 `continue-on-error: true` 的前提（工作流基线不同源：实测同屏两态差 0.16%、仓库基线 vs CI 渲染差 3.82% ⇒ 不可判据）已消除：13 条非同源基线换成同一次 CI 渲染并自证「新基线 vs 同一次 CI 渲染 = 0 px」，`continue-on-error` 与 `.github/scripts/workflow-contract.test.js` 的反向断言**同 PR** 变更。任何重新降级为"只采集不判定"的改动都必须重新论证基线为何不可判据，并同 PR 反号该断言。残余已知噪声：4 条已同源基线仍稳定差 709 px（顶部标签栏动态元素），正解是给 `pixel-diff` provider 加忽略区（mask），**不得**用提阈值消化。
4. **baseline 更新需人工审核** diff 图,确认是预期变化后再覆盖
5. **像素失败后**必须跑 `npm run test:visual:agent` 生成报告,Agent 用 view\_image 看图判断
6. 所有命令必须在 `apps/desktop/` 目录下执行
7. **基线必须与比对环境同源（MUST）**：`test:visual:pixel` 在 CI 用 `windows-latest` + CI 的 Chromium/字体渲染做比对，因此**基线只能取自 CI 产物**（`quality-gate-visual-reports` artifact 里的 `screenshots/<view>-current.png`），**禁止**把本地 `test:visual:update-baseline` 截出的图直接提交。反例实测：`accounts-list.png` 曾在本地机器上捕获并入库，与 CI 渲染产生 **3.659%** 的全页文字亚像素重影差异（两次不同分支 CI run 之间比对为 **0 px**，证明 CI 渲染是确定性的），而 `PIXEL_THRESHOLD=0.06` 是**全页**容差——门禁因此长期被环境噪声吃掉、对局部回归近乎失明。判据：换/补基线后必须自证「新基线 vs 同一次 CI 渲染 = 0 px」，并确认差异中**属于本次代码改动的比例**（分区统计），不能让噪声占大头却报「PASSED」。
   `test:all:visual` 的四套用例同理：其**唯一** CI 产物来源是 Visual Tests workflow（main push / dispatch）上传的 `visual-test-reports` artifact，本机截图不得提交为基线；该步骤跑完前一套红也会跑完后三套，所以 artifact 始终含全部四套的截图。

### 失败处理流程

1. 查看 `tests/visual-testing/reports/pixel-diff/*.png` 确认 diff 范围
2. 判断是否为预期变化:

   - ✅ 是 → `cp screenshots/<view>-current.png base-screenshots/<view>.png` 更新基准

   - ❌ 否 → 修复 UI 后重跑
3. 仍有疑问 → 跑 `npm run test:visual:agent`,Agent 读 judge-report.md 判断

### 无外部 AI 依赖

**重要**:本项目视觉测试**不使用** OpenAI / Claude / 任何云端 AI。所有能力本地完成:

- 像素对比、OCR 走本地 Node 库

- Agent 视觉判断走 Agent 自带的 LLM(view\_image 工具)

***

### QM-5：Bug 修复协议（MUST）

> 发现 Bug 或被告知 Bug 时，必须按以下 5 步执行，不修表面、追根溯源。

#### 第 1 步：找到第一性原因

- 不修表面：不要只修报错的那一行，要找到这个 Bug 最原始的代码改动引入点

- 用 git log + git blame 追溯：这个错误是哪次提交引入的？当时的意图是什么？

#### 第 2 步：追溯测试逃逸

- 这个 Bug 逃过了哪些测试？

- 为什么逃过？具体原因（5 类：无测试 / Mock 过度 / 测试不执行 / 断言不精确 / 环境差异）

#### 第 3 步：识别系统性漏洞

- 在现有测试机制里找到具体的系统性漏洞

- 必须具体到：哪个文件、哪个测试框架、哪个环节缺失

#### 第 4 步：修复 + 回归保护测试

- 给出修复方案（代码变更）

- 编写回归保护测试：测试文件命名 {被测文件}.test.js，与被测文件同目录

- 要求：用真实依赖（非 Mock），验证 Bug 的具体场景不会复现

#### 第 5 步：防止再次发生

- 必须有具体的系统性措施，不能只说以后注意

- 至少落地以下一项：

  1. 更新 AGENTS.md QM 规则 — 增加检查项
  2. 更新 01-docs/learnings.md — 记录根因和教训
  3. 增加自动化测试 — 回归测试写入 CI
  4. 增加代码检查 — lint 规则 / pre-commit hook

> 审查时检查：修复 Bug 的 PR / 提交必须包含以上 5 步的产出物。

### QM-6：CCG 双模型外部评审（MUST）

> M+ 复杂度或中/高风险任务，在提交 PR 前必须执行 CCG 双模型外部评审，不得仅依赖本地测试与自审。

#### 触发条件

满足任一即触发（与质量节拍 M5 交付节奏对齐）：

- 新增功能 / 重构 / 跨模块变更（M+ 复杂度或中/高风险）
- 修改主进程服务（`apps/desktop/electron/services/`）、IPC handler、核心引擎包
- 修改涉及安全 / 数据校验 / 状态机 / 持久化的逻辑

#### 执行方式（双模型并行，禁止串行）

用 `codeagent-wrapper` 并行启动后端模型与前端模型两路审查，审查实现 diff（`run_in_background: true`，同一条消息两个调用）。**模型名不在本文档写死**：调用前先读 `~/.claude/.ccg/config.toml`（该文件不在本仓；本仓 `.ccg/codex/config.toml` 是另一回事）的 `[routing.backend].primary` 与 `[routing.frontend].primary`，把下面两处的 `<BACKEND_PRIMARY>` / `<FRONTEND_PRIMARY>` 替换为读到的值：

```
# 后端模型（逻辑/安全/规格合规审查）
codeagent-wrapper --backend <BACKEND_PRIMARY> --lite "审查 <change> 实现：正确性/边界/安全/规格合规" <workdir>

# 前端模型（模式/可维护性/集成风险审查）
codeagent-wrapper --backend <FRONTEND_PRIMARY> --lite "审查 <change> 实现：命名/模式/可维护性/集成" <workdir>
```

> 两路实际用哪个模型，唯一真源是 `~/.claude/.ccg/config.toml` 的 `[routing]`；本文档不复制其值，历史上抄写的示例值（曾写成 claude / opencode）已与配置脱节，照抄会跑错模型。前端模型失败最多重试 2 次（间隔 5 秒），3 次全败才跳过；后端模型结果必须等待（5-15 分钟属正常）。

#### 评审输出与处理

- 两个模型各返回 JSON findings（severity: Critical / Warning / Info）
- **Critical 必须修复**后才能合并（含回归保护测试）
- **Warning 评估后修复**（数据校验/安全类 Warning 必须修复）
- 评审记录写入 `.quality-gates.md`（双模型评审 PASS + 发现项 + 修复项）

#### 与既有门禁的关系

- QM-6 是**外部交叉审查**，补充 QM-2 的自审（代码审查必检项）——两者不可互相替代
- 质量节拍 skill 的"日常循环 Step ④ 审查"已同步固化此强制卡点（见质量节拍 skill 仓库）
- 纯文档/流程变更（`openspec/`、`docs/`、`scripts/` 工具脚本）不强制 QM-6，但建议执行

## 测试质量增强工具（v0.16.0）

### 新增 npm 命令（`cd apps/desktop` 下执行）

| 命令                      | 作用                               | 运行时间           |
| ----------------------- | -------------------------------- | -------------- |
| `npm run test:mutation` | Stryker 变异测试，找出"假测试"             | 数小时（55293 突变体） |
| `npm run test:coverage` | 覆盖率报告（阈值以 `apps/desktop/vitest.config.js` 为唯一真源：statements 55 / branches 40 / functions 60 / lines 55）         | 30 秒           |
| `npm run test:fault`    | 故障注入测试，20% IPC 请求随机失败            | 10 秒           |
| `npm run test:monkey`   | 500 次随机 IPC 操作序列                 | 5 秒            |
| `npm run test:quality`  | 一键跑全部（fault + monkey + mutation） | 数小时            |

### 配置说明

- **Stryker 配置**：项目根目录 `stryker.conf.json`（`inPlace: true` 模式，避免 Windows junction 链接复制问题）

- **Vitest 专用配置**：`apps/desktop/vitest.stryker.config.js`（排除不兼容 Instrumentation 的测试文件）

- **运行方式**：从项目根目录用 `node node_modules/@stryker-mutator/core/bin/stryker.js run stryker.conf.json` 执行

### 质量门禁（提交前必须检查）

- 变异测试得分 ≥ 30%（见 `.quality-gates.md`，首次运行需数小时）

- 分支覆盖率 ≥ 40%（`npm run test:coverage`）

- 故障注入测试通过（`npm run test:fault`）

### 用户会话录制

设置 `BACKLOT_RECORD_SESSION=true` 后正常使用软件，IPC 调用序列自动录制到 `tests/sessions/`，可通过 `SessionRecorder.replaySession()` 回放为测试。

***

## 新增模块（参考产品逆向分析集成）

- `electron/services/account-state-restorer.js` — 账号登录状态持久化（JSONL）

- `electron/services/credential-store.js` — localStorage + accountInfo 加密存储（AES-256-GCM）

- `electron/services/publish-monitor.js` — 发布后状态自动查询（QueryStateTaskScheduler）

- `electron/services/system-tray.js` — 系统托盘（最小化到托盘 + 托盘菜单）

- `electron/services/api-platform-adapter.js` — API 模式发布适配器（微博/抖音/B站/知乎）

- `electron/services/webview-manager.js` — **分屏监控**（P0，WebContentsView 多屏布局，支持2/3/4/6屏）

- `electron/services/callback-server.js` — **实时回调服务器**（P1，HTTP POST回调 + 59s心跳，端口16521）

- `electron/monitor-preload.js` — 分屏视图预加载脚本

- `electron/services/qrcode-login.js` — **二维码扫码登录**（P2，自动检测页面二维码，扫码即登录）

- `electron/auth-qrcode-preload.js` — 扫码登录视图预加载脚本

- `electron/services/store.js` — **统一 SQLite 持久化**（P2，sql.js，替代零散JSONL）

- `electron/services/oauth-manager.js` — **OAuth 2.0 认证**（P2，YouTube/TikTok/微博/抖音 API Token 授权）

- `electron/services/batch-manager.js` — **批量发布管理器**（批量编辑/排期/复制，支持多篇文章独立选平台+定时）

- `electron/services/url-collector.js` — **URL 内容采集**（HTTP+Playwright双模式，og:meta提取）

- `electron/services/hotkeys.js` — **全局快捷键**（6组 Ctrl+Alt+... 导航快捷键）

***

## 质量节拍强制执行

本仓库已启用质量节拍（quality-rhythm）门禁系统。每次新任务自动执行：

1. 判断变更类型（14种全覆盖）
2. 评估变更规模
3. 路由到对应 Phase
4. 用户确认后开始

**视觉测试强制：** UI 文件变更时自动提示视觉回归测试。

## 记忆体系（内置记忆 / 外部记忆 / EverOS 记忆）

> 本章节只记录三套记忆系统的**概念与使用边界**（可移植、跨机器有效）。具体到某台机器的绝对路径（含用户名）、监听端口、CLI 安装位置、脚本版本、MCP 配置内容、项目空间清单与服务存活状态等**个人机运行态**，一律不写入本跟踪文件——它会随每次会话注入 Rules 并被 git 历史长期保存，既泄漏个人文件系统布局，又在换机/协作克隆时立即失效。需要这些细节时从本机外部记忆检索，并**在使用前先核验该服务确实存活且已正确配置**。

### 三套记忆的定位与边界

| 记忆类型 | 存放形态 | 定位 | 何时用 |
| --- | --- | --- | --- |
| **内置记忆** | 当前 AI 工具自带的会话记忆目录（路径随工具与机器而异） | 工具自动生成/检索的会话记忆，系统提示自动注入摘要 | 默认第一入口：任务开始时快速 pass 检索相关关键词；引用按工具约定带引用标记 |
| **外部记忆** | 项目仓库内文档（openspec/、01-docs/、.ccg/、docs/）+ 用户显式让写入的文件 | 项目级持久知识，git 管理，跨会话/跨工具共享 | 项目约定、流程规范、PRD/架构文档；AGENTS.md 是每次会话自动加载的入口 |
| **EverOS 记忆** | 独立记忆服务（HTTP API + MCP 桥），数据落在本机用户目录 | 跨项目语义检索、episode/atomic\_fact 级别的长期记忆沉淀 | 需要跨项目历史经验（"之前怎么处理 X"）时检索；具体端点/项目空间见本机外部记忆 |

### 使用规则

1. **任务开始时**：先做内置记忆 quick pass（按关键词检索）；若涉及跨项目历史经验，再调外部语义记忆服务（如 EverOS）检索。
2. **写入记忆**：用户显式要求「记住/存到记忆」时——项目相关知识写外部记忆（AGENTS.md/openspec/01-docs/），跨项目个人偏好/经验写内置记忆，语义级长期记忆可调外部记忆服务的写入接口。
3. **过时记忆处理**：不改写历史记录（记忆是历史事实快照），而是追加最新锚点声明现状取代旧表述。
4. **依赖外部服务前先核验**：外部记忆服务均不保证随系统自启，调用前必须确认其后端存活且已正确配置；不可达时可能静默返回空结果而非报错，判「无结果」前先验后端。某套服务是否可用属运行态判断，按当次实测处理，**不得把「不可用」结论写进本跟踪文件**。

## Skill routing

When the user's request matches an available skill, invoke it via the Skill tool. When in doubt, invoke the skill.

Key routing rules:

- Product ideas/brainstorming → invoke /office-hours

- Strategy/scope → invoke /plan-ceo-review

- Architecture → invoke /plan-eng-review

- Design system/plan review → invoke /design-consultation or /plan-design-review

- Full review pipeline → invoke /autoplan

- Bugs/errors → invoke /investigate

- QA/testing site behavior → invoke /qa or /qa-only

- Code review/diff check → invoke /review

- Visual polish → invoke /design-review

- Ship/deploy/PR → invoke /ship or /land-and-deploy

- Save progress → invoke /context-save

- Resume context → invoke /context-restore

## 强制工具路由（Iron Rules）

以下规则**仅在 FastCtx MCP 已配置且当前会话可调用时生效**：可用时提供不可协商的强制路由；不可用时按下条 fail-open 回退到内置工具并显式声明降级，不得因指定工具缺失而中止任务。（本章节原为无条件强制，会在未配置 FastCtx 的环境里把 agent 逼进「找不到指定工具、又不允许用内置工具」的自我 DoS。）

### 文件操作强制路由

| 操作类型        | 必须使用                              | 严禁使用                                                                                                                 |
| ----------- | --------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| 文本搜索        | mcp\_\_fastctx\_\_grep            | 禁止 exec\_command("rg ...")、exec\_command("grep ...")、exec\_command("findstr ...")、exec\_command("Select-String ...") |
| 文件读取        | mcp\_\_fastctx\_\_read            | 禁止 exec\_command("cat ...")、exec\_command("Get-Content ...")、exec\_command("type ...")                               |
| 文件列表/查找     | mcp\_\_fastctx\_\_glob            | 禁止 exec\_command("ls ...")、exec\_command("dir ...")、exec\_command("Get-ChildItem ...")                               |
| Shell 命令    | mcp\_\_fastctx\_\_run             | 禁止 exec\_command 直接执行 shell（例外见执行规则第 4、5 条）                                                              |
| 批量文本替换      | mcp\_\_fastctx\_\_replace         | 禁止 exec\_command("sed ...")、exec\_command("(Get-Content ...) -replace ...")                                          |
| 长时间任务（>2分钟） | mcp\_\_fastctx\_\_run\_background | 禁止 exec\_command                                                                                                     |

### 执行规则

1. 收到用户请求后，Agent 必须先检查操作类型是否命中上表，命中则必须使用对应 FastCtx 工具。
2. apply\_patch 仅用于语义级代码修改，不用于机械文本替换。
3. **条件强制（FastCtx 可用时）**：当 mcp\_\_fastctx\_\_run 等 FastCtx 工具在当前会话可用时，shell 命令必须走 mcp\_\_fastctx\_\_run（预计超过 2 分钟走 mcp\_\_fastctx\_\_run\_\_background），不得用内置 exec\_command 绕过，例外仅限下列第 4、5 条。当 FastCtx 未配置或不可调用时 **fail-open**：改用当前环境可用的内置读取/搜索/shell 工具完成任务，并在首次回退时向用户显式声明「FastCtx 未配置，已回退平台内置工具」，不得因指定工具缺失而中止。
4. **例外 A（PTY 交互式会话）**：确需 PTY 交互式会话（如启动开发服务器后持续观察输出、向运行中进程写 stdin）时，允许 exec\_command 创建会话并用 write\_stdin 轮询。
5. **例外 B（PowerShell 原生操作白名单）**：仅限无法用 bash 语法表达的 Windows 原生操作，允许 exec\_command 直跑 PowerShell，避免 bash→PowerShell 双跳（实测每次约 +1.3s）与引号转义腐蚀。范围：注册表（reg.exe / Get-ItemProperty / Set-ItemProperty）、计划任务（schtasks / Register-ScheduledTask）、CIM/WMI 查询（Get-CimInstance / Get-WmiObject）、Windows 服务（Get-Service / Start-Service）等系统管理 API，且命令体含内联 PowerShell 语法（对象管道、哈希表、$_、[PSCustomObject] 等，经 bash 转义必腐蚀）。
   - 执行 .ps1 脚本文件（如 scripts/session-guard.ps1）不适用本例外：仍走 mcp\_\_fastctx\_\_run，命令形如 "powershell -NoProfile -ExecutionPolicy Bypass -File <脚本路径>"——路径不含复杂引号，无转义风险，仅承担 PowerShell 自身启动开销（该开销 exec\_command 同样无法避免）。
   - 白名单禁止扩大解释：文件搜索/读取/批量替换，以及普通 git、node、npm、pnpm、rg 命令，即使写成 PowerShell 语法也不属于本例外。
6. **违规回退（仅 FastCtx 可用时）**：当 FastCtx 可用却发现自己在 PowerShell 或内置 exec\_command 中执行了本应走 FastCtx 的操作时，改用对应 FastCtx 工具重做，并以 FastCtx 的结果为准；FastCtx 不可用时本条不适用，按第 3 条 fail-open 继续完成任务，不得中止。

