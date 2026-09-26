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

- **分支隔离（分层）**：运行时代码变更（apps/、packages/ 及关联配置/CI）必须在 git 分支上进行，禁止直接在 main 主分支上修改，经 PR 审查与 CI 后合并回 main；纯流程/规格/文档变更（openspec/、.ccg/、docs/、scripts/ 工具脚本）允许在 main 直接小步提交，但须保持可回滚且不得与并发会话的脏文件冲突。分层边界以 openspec/specs/openspec-integration/spec.md「分层分支策略」Requirement 为准。

- **⛔ Worktree 隔离（并发会话铁律）**：共享仓库根（例如 `D:/Data/projects/Multi-Publish`）是 **main-only 协调目录**，必须保持干净并停留在 `main`；不得作为运行时代码任务的 cwd，也不得执行 `git checkout` / `git switch` 到 feature 分支。每个运行时代码任务统一从 Git for Windows Bash 运行 `scripts/session-init.sh <task-name>`，在默认 `<仓库父目录>/mp-worktrees/mp-<task-name>`（可经 `-WorktreeRoot` / `MP_WORKTREES` 覆盖）与 `codex/<task-name>` 独立分支中工作；同名路径已被其他仓库或错误分支占用时必须 fail closed。隔离 worktree 由 pre-commit 自动声明当前分支；共享主目录仅允许 `powershell -ExecutionPolicy Bypass -File scripts/session-guard.ps1 -Branch main`。**已有多个会话绑定同一共享 cwd 时，先暂停所有 Git 写操作，再逐个串行迁移；禁止并行 handoff/stash/checkout，因为 stash、index 与 HEAD 属于同一 Git 状态，会互相竞争。** 新 worktree 依赖就绪：`pnpm install --frozen-lockfile && node scripts/ensure-electron.js && node scripts/verify-worktree-deps.js`。统一使用 Git for Windows Bash（`start-mp-task.ps1` 自动探测，可经 `-GitBash` / `MP_GIT_BASH` 覆盖）；本机裸 `bash` 可能解析到 WSL，不得用于此流程。

- **⛔ Worktree 清理防护铁律（R1-R5）**：删除任何 worktree 前必须：(R1) 对主工作区做基线快照（`git status --porcelain` + stash 数），删除后 diff 基线，出现新增 D/消失的 M 立即报错；(R2) 禁止宽目录恢复/清理（`git checkout -- <目录>`、`git restore <目录>`、`Remove-Item <目录> -Recurse` 一律禁用），恢复只针对 `git status` 精确列出的文件；(R3) 删除前扫描目标 worktree 的 junction/reparse point，凡指向主工作区的共享链接先解除再删，否则会级联删除主工作区物理文件；(R4) 对主工作区做批量操作前，未提交修改（M/A）先备份到 `%TEMP%` 或精确 `git stash push -- <路径>`；(R5) `git worktree remove --force` 是最后手段，使用前必须完成 R1/R3 并确认 dirty 清单无价值。标准流程已落地为 `scripts/safe-worktree-remove.ps1`（删除）与 `scripts/safe-restore-deleted.ps1`（恢复），涉及 worktree 删除/文件恢复一律调用这两个脚本。

- **错误处理**：所有关键路径必须有错误处理

## 会话隔离自动入口与持续守护

运行时代码任务必须从 scripts/start-mp-task.ps1 -TaskName <kebab-case> 启动；该入口会校验共享主目录、安装 hooks，并创建独立 worktree（默认 `<仓库父目录>/mp-worktrees`，路径可经 `-WorktreeRoot` / `MP_WORKTREES` 覆盖）。共享根目录健康检查由 scripts/mp-worktree-health.ps1 执行，Windows 当前用户计划任务由 scripts/install-session-isolation-task.ps1 注册。完整说明见 docs/session-isolation-automation.md。不得把运行时代码任务直接绑定到共享仓库根；新电脑克隆后先运行 `scripts/bootstrap-write-guard.ps1` 完成 hooks、计划任务、watcher 与自检，仅安装质量节拍 skill 不会自动启用该机制。

- **⛔ 共享主目录实时写保护**：共享仓库根下 `apps/`、`packages/`、`ops-center/`、`config/`、`.github/` 等运行时路径禁止直接落盘；`scripts/guard-shared-root-writes.ps1` 由 Windows 计划任务 `Session Isolation Write Guard`（AtLogOn）常驻监听，非 gitignored 文件移入 `%LOCALAPPDATA%\Multi-Publish\session-isolation\quarantine\`，tracked 文件从 HEAD 精确恢复并写 `violations.jsonl`；放行 `docs/`、`01-docs/`、`scripts/`、`openspec/`、`.ccg/`、`.agent_context/`、`.hermes/` 及根级流程文档。任务开始与提交前必须确认 Write Guard 任务已注册且 watcher 运行、共享根保持 main clean。

- **质量节拍强制卡点**：提交前必须完成 `.quality-gates.md` 自检清单，违反不允许提交

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

**工具层（治本，待排期）：** 统一路径规范（bash 侧 `cygpath -u`、PowerShell 侧 `cygpath -w`）；`git worktree add` 后立即 `git -C <绝对路径> rev-parse --show-toplevel` 验证可进入，失败则 `git worktree remove --force` 并告警，不留半失效注册。

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
├── ops-center/            # 运营后台（FastAPI :8010 + Vue3 :5173，独立 Python/Node 依赖，登录经 platform-orchestrator /api/auth）
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

- **登录承载路径的观测与节流口径单一来源**：任何新增或改造的登录承载方式（`AuthViewManager.openLogin` 的 `persist:auth-*`、`WebviewManager` 账号标签的 `persist:account-*`、`QrCodeLogin` 扫码视图、`loginSilent` 隐藏窗口）都必须同时满足两条：①在 `loadURL` **之前**挂 `attachLoginNetworkDiagnostics(session, { platform, accountId })`——第三方登录页的二维码由 iframe 加载，其内部请求失败**不触发**外层 `webContents` 的 `did-fail-load`，不挂即日志黑洞；②显式声明 `backgroundThrottling` 取值并给出理由（承载第三方轮询型登录页的视图应为 `false`，先例 `tab-lifecycle.js` / `rpa-view-session.js` / `playwright-manager.js`）。回归锁：`auth-view-manager.test.js` 的「登录视图可观测性」describe 断言 `onCompleted` filter **精确等于** `URL_FILTERS`；修改 `login-network-diagnostics.js` 的 `URL_FILTERS` 或出码端点判定（`getqrcode`）必须同步该断言。诊断属旁路：`try/catch` + warn，**禁止**把 `resolveProxy`/CDP 等异步观测 `await` 在首个导航之前（见 learnings「门控首个导航的异步 promise 必须带超时与销毁守卫」）。另注意 `test-setup.js` 的 `session.fromPartition` 每次返回新 session 对象——诊断幂等标记挂在 session 实例上，共享单例会使「监听注册恰好一次」退化为顺序依赖。

- **应用级浮层弹窗互斥合同（overlay view suspension）**：`WebContentsView`（浏览器/登录标签的外部网页）是压在渲染进程 DOM 之上的原生图层，CSS z-index 无效。新增任何应用级**模态**浮层（居中弹窗、`fixed inset:0` 遮罩、阻塞交互的 `ElMessageBox.confirm`）时，必须经 `src/composables/useEmbeddedViewSuspension.js` 挂起/恢复内嵌视图（owner 唯一标识、suspend/release 成对、释放走 `finally`），并在 `apps/desktop/src/overlay-view-suspension.test.js` 登记该 owner 的接入断言。修改 `WebviewManager` 可见性链路（`setVisible` / `_repositionAll` / `setShellMode` / 挂起三方法）必须同跑 `overlay-view-suspension.test.js` + `shell-mode-6b.test.js` 全量；修改 `electron/preload/page-manager.js` 必须重打包 `index.bundle.js`（bundle 断言拦截遗漏）。瞬时非模态浮层（toast/回到顶部/更新通知/ElMessage）明确不接入（挂起致闪烁、无交互闭环），残余限制见 `01-docs/PRD-OVERLAY-VIEW-SUSPENSION-2026-09-23.md` §6。

- **自动更新静默合同**：打包应用必须关闭 electron-updater console logger；检查更新阶段的网络阻断和缺失 `latest*.yml` 按 `not-available` 处理，签名、下载和安装等真实错误不得吞掉。修改更新服务后必须打包启动 8 秒并确认 stderr 无 updater 网络/404 栈。

- **文件 glob 覆盖**：`package.json` 的 `files` 数组必须包含所有被 require 的非 node\_modules 文件

- **生产依赖闭包**：生产入口静态加载的每个第三方包必须由所属 workspace 在 `dependencies` 中直接声明；根工作区或其他包的传递依赖不算满足。发布前必须执行 `npm pack --dry-run` 并从隔离 runner/安装目录加载真实入口。

- **批量 IPC 进度双边界与超时预算契约**：任何逐条循环调用异步检测/网络任务的 IPC handler，若向渲染层广播进度，必须同时覆盖 `start`（in-flight，检测体执行前）与 `done`（完成后）两个边界；只在 `await` 之后广播会让进度语义退化为「已完成数」，单个慢任务使遮罩长时间静止（视觉上等同卡死）。批量任务必须声明并发上限与单任务硬超时（均可用环境变量覆盖以便排障），超时结果语义（计入失效 / 跳过 / 重试）须在 PRD 中写明；用 `Promise.race` 实现超时时必须保留「超时后原任务迟到的 reject 不产生 unhandledRejection」的回归测试。回归锁：`apps/desktop/electron/ipc-handlers/account-batch-check.test.js`（断言检测体执行期间该账号只收到过 start）。
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

- **登录态真源只被正/负证据改写（单向证据规则）**：`accounts.json` 的 `status` MUST 只在检测给出「有效」（→ `active`）或「明确失效」（→ `expired`）时被改写；「本轮无定论」（含 `CHECK_LOGIN_INCONCLUSIVE`、检测自身异常、硬超时）**不得**把既有结论抹成 `unverified`——「没拿到新证据」不是反证。此前 `expired` 已是粘滞态而 `active` 无对等保护，加上同一个三态映射被抄成三份（`account-manager` / `ipc-handlers/account.js` / `login-status-monitor`），导致已登录账号每 30 分钟在「已登录 ↔ 未确认」之间来回。唯一实现是 `packages/shared-utils/src/login-state.js` 的 `loginStatusTransition`（返回 `null` = 本轮不改写），三个调用点 MUST 直接 import，禁止再新增第四份映射；凭证落盘（登录即正向证据）继续直写 `active`，不经该函数形成双门控。超龄兜底默认 7 天（`MP_LOGIN_STATE_GRACE_DAYS`，非法值回落默认），防止「已失效却永远显示已登录」。新增任何「无定论」出口时 MUST 运行 `apps/desktop/electron/publishers/account-manager-login-state-transition.test.js` 与 `login-status-monitor.test.js` 全量，并确认规则表 6 行都有断言。详见 `openspec/changes/fix-login-state-oscillation/` 与 PRD §7.6。

- **登录态固化契约覆盖全部「凭证落盘」同族路径**：主进程成功捕获并落盘加密凭证的每一条入口都必须把 `status='active'` + `last_validated` 回写唯一真源（后端 `accounts.json`），且顺序不可颠倒——凭证未落盘不得把真源置为 active（防半成功）。入口共三条：`saveCapturedAccount`（`auth:open-login` 新登录 / `qrcode-login._onLoginSuccess` 扫码登录 / `account:add` 首次运行引导）、`updateCapturedAccount`（重新登录与登录标签保存）。两条附加约束：① 固化失败或登录证据不足时返回值如实透传真源原值，不得声称 active；② `account:add` 的 `captureCookies` 把「URL host 离开登录页」也算登录成功，那是**弱证据**（用户未登录却导航到别的域名同样满足），必须传 `loginVerified:false` 保持后端 `unverified`、等一次真实检测，不得固化 active。只锁其中一条路径会把另一条留成沉默缺陷——创建路径漏写时后端 `create_account` 默认 `unverified`，会让每个新账号显示「未确认」直到用户手动点一次检测。新增或修改任一条路径时必须运行 [account-manager-relogin-status.test.js](apps/desktop/electron/publishers/account-manager-relogin-status.test.js) 全量（8 例：两条路径固化 / 固化顺序 / 凭证落盘失败 / 固化失败不冒充 / 弱证据不固化 / 更新路径同口径），并保持 IPC 边界用例（`ipc-handlers/account.test.js`）的 mock 与真源返回口径一致。注意：渲染层在 `auth:completed` 后重新拉列表，用户可见状态由**真源**决定，返回值承担的是 IPC 合同一致性，不是首帧渲染来源。
- **E2E fixture 断言渲染语义**：路由/工作流测试不得用内部枚举值断言已经过本地化或格式化的 UI 文案。优先使用稳定状态 class/testid 加用户可见文本，并在 UI 映射函数变更时同步运行受影响路由用例。

- **预设/种子类语义合同（R85）**：`getAvailablePresets`、`getAvailableTemplates`、`getAvailableProfiles` 等“可配置目录”类 API 必须返回该类别全部内置预设，**不得用“是否已入库”判断能否添加**。种子初始化（`_seedPresets` / `INSERT OR IGNORE`）只表示“目录存在”，不表示“用户已完成配置”；“是否已配置”必须用 `api_key_enc IS NOT NULL AND enabled = 1` 等业务字段判定。修改此类 API 时必须运行 [`model-provider-preset-integration.test.js`](apps/desktop/electron/services/model-provider-preset-integration.test.js) 并覆盖：(1) 空 userData 初始化后预设列表非空；(2) 种子已入库但预设列表仍返回全部项；(3) 用户选预设后保存路径走“ID 冲突 → 降级更新”而非创建重复行。详见 [01-docs/learnings.md 模型预设列表为空 Bug 复盘](01-docs/learnings.md)。

- **宿主 API 字段归属必须先核实（Electron/浏览器 API 不得凭字段名写）**：读 `app.*` / `webContents.*` / 任何宿主对象属性前，必须在**已安装**的类型声明里确认该属性挂在哪个接口上（Electron 为 `node_modules/electron/electron.d.ts`），或运行时打印一次。反例：`configureUserAgentFallback` 读 `app.userAgent`（真实 Electron 上不存在，UA 只在 `app.userAgentFallback`），导致知乎登录风控规避逻辑长期静默 no-op，而单测因手搓 `{app:{userAgent}}` 假形状全绿。配套要求：① mock 的字段集来自 d.ts 或运行时 dump，并保留一条「真实形状」用例（只带宿主真有的字段）；② 关键取源用计数字段 getter 断言「未读错误字段」；③ 前提本身做真实依赖锁（对 `electron.d.ts` 结构断言，缺 electron 时 skip）。

- **静默配置失败必须留日志**：任何以 `{configured: boolean}` / 布尔返回值表达「已生效 / 已跳过」的启动期配置函数，调用点的未生效分支一律 `console.warn` 或 `log.warn`；只在成功分支打印等于吞掉失败，回归在运行日志里零痕迹。

- **出站行为以线级取证为准**：断言「请求头 / UA / 证书 / 编码已设置」时，最终证据必须来自真实链路抓到的出站数据（本机回显 HTTP 服务 + 生产同款 session/webPreferences 做开关 A/B），单测绿不代表线上头部变了。注意 `Sec-CH-UA` 系列客户端提示只在 HTTPS 请求发送，本机 http 回显看不到，不得据此判「不存在」。

- **跨端目录常量 ↔ 存量数据必须前向兼容（MUST）**：凡「代码内目录常量 + 数据库表」双真源结构（如 `app_menu_service.CATALOG` ↔ `app_menu_items`），目录新增条目时**禁止**只用「表为空才播种」的供给逻辑——存量部署永不获得新行，管理页会看不到该项、无法配置，而按目录遍历下发的客户端照常显示，两侧项目与顺序同时漂移。供给必须是**增量补齐且只补不改已有行**（覆盖已有行会抹掉运营者配置，比缺行更糟），并在读取/写入/重置/下发**全部**入口调用。缺行兜底值必须取**目录序号**而非 `0`（0 在排序语义里是第一名）。回归锁必须有一条从**非空旧状态**出发（先建全量再删一项）的用例——「每例 `drop_all/create_all` 重建空表」的夹具对这类缺陷完全免疫。同族先例见 R85。CI 的结构校验（清单 ↔ 清单自洽）**不能**作为通过证据：漂移发生在运行库里，CI 看不到。

- **多通道同步编排不得失败互锁（MUST）**：一个 handler/服务内先后拉取多条独立通道（如模型目录 catalog 与运行时策略 runtime/bootstrap）时，任何一条的失败或提前 `return` **不得**阻止另一条执行——「best-effort 分支」若写在主通道 `await` 之后，就等同于反向门控（主通道失败 ⇒ 该分支永远不执行）。必须用 `Promise.allSettled` 并行解耦，并遵守：① 并行不得叠加超时预算（整体仍是单请求超时，不得退化为串行求和）；② 结果对象必须逐通道如实上报（如 `code/message` 属目录，`runtimeApplied/runtimeSyncedAt` 属运行时），不得因一条成功而掩盖另一条失败；③ 若该通道结果**面向用户展示**，文案必须区分「部分成功」与「完全失败」，否则用户会用反复重启应用来排障；若产品决定该链路**对用户透明**（界面无任何入口，如桌面端运营中心同步卡片已隐藏），则**不得为不存在的反馈路径新增 locale 键**（AGENTS.md 禁止死键），区分度改由主进程日志承担。写 UI 反馈前先确认调用方是否可达。回归锁：为「A 失败时 B 仍须执行」单独写一条注入用例；并行预算用假时钟**单次**推进 + 断言**每个端点各被请求一次**（实现退化为串行时该用例会挂死，挂死本身即结构断言）。

- **测试断言不得反向固化错误行为**：任何断言“X 已初始化所以 Y 应为空”的测试必须额外验证“Y 为空是用户期望行为”而非“实现副作用”。当 X 的初始化是系统自动行为（如种子写入）时，Y 的空状态几乎一定是 Bug，必须改为“Y 应返回全部可配置项”。composable 测试不得只 mock IPC 返回空数组，至少包含一条“IPC 返回非空数据 → composable 转发到响应式状态”的真实数据路径用例。**同一类缺陷的另一形态**：为「兜底/回退逻辑」写的用例，如果断言的是「兜底产出的结果正确」，就会把兜底本身的错误钉成契约（2026-09-26 账号昵称 Bug：`account-profile-collector.test.js` 断言「选择器全 miss 时回落 `document.title` 并剥掉平台后缀」为正确，而生产库 6/7 条脏 `account_name` 正是该兜底产出的）。写这类用例前必须先问「这个兜底源在语义上能不能等于被提取字段」；不能等于就把断言改成「不采纳」，并额外用**真实平台数据形态**（含颜文字、内嵌连字符、整块容器文本）做 fixture，不得只用为通过而构造的干净样例。

- **DOM 采集禁止把「标题类来源」当结构化身份字段**：昵称/用户名/账号名等身份字段只能来自**语义指向该字段的选择器**命中；`document.title`、`og:title`、`twitter:title` 是页面标题，永远不是账号昵称，一律不得作为兜底（未命中就不产出该键，交给「字段缺席 = 不修改」语义与展示端平台名回落）。同理禁止宽匹配选择器（`.user-info`、`[class*="creator"] span`、`[class*="profile"] strong` 这类会命中统计块/占位文案的容器），采集候选必须带长度上限等形态约束。修改 `accountInfoCollector` 或任何页面内采集器时必须跑 `apps/desktop/electron/tests/account-profile-collector.test.js` 全量。**同一缺陷的第二落点**：`auth-view-manager` 的 `captured.name` 就是 `document.title`，它既直接 POST/PATCH 进真源 `name`，又是 `profileForCreate` 的昵称兜底 —— 显示名/账号名的**每一个写入口**都必须过 `isNoiseAccountName`（新增 `resolveAccountDisplayName` 作为唯一入口），加校验时必须逐参数问「这个参数是否也承载同一待验证的东西」，名字带 `fallback` / `default` 的参数是校验最常见的漏项；改这两处写回点必须跑 `account-manager.test.js` + `account-manager-profile.test.js`。

- **枚举式黑名单必须配结构化正向契约**：任何「判定某串是垃圾/非法值」的守卫，不得只靠逐个列举已知坏值（`KNOWN_*` 集合是打地鼠，换平台换文案即复发）。必须同时存在按**形态指纹**的泛化规则（如「数字+量词+统计项」「以站点 chrome 词结尾」「含省略号」「括号开合不等」），并且**测试样本不得取自被枚举集合本身**（用黑名单测黑名单等于自证）。新增坏值时，先问能否写成形态规则，只有不能才进枚举表；新增枚举项必须同步补形态规则的负控用例，防止其误杀面扩大。判定函数存在 CJS/ESM 孪生实现时，新词表与新规则一律纳入 parity 断言（正则按 `source`+`flags` 比较）。


- **GUI 主窗口等待预算**：Electron GUI runner 必须使用条件轮询等待主窗口，等待上限必须覆盖 `createWindow()` 之前所有串行启动阶段的健康检查 timeout 总和并保留余量。修改 Bridge 启动顺序、健康检查 timeout 或窗口创建时机时，必须同步更新假时钟边界回归；不得通过测试专用 skip 开关静默绕过生产启动路径。

- **全局单例事件监听器生命周期**：`autoUpdater` 等进程级 EventEmitter 不得在 BrowserWindow 重建时重复注册监听器。初始化函数必须把当前窗口/回调与“一次注册”分离：每次调用更新状态目标，只在首次调用绑定全局事件。回归必须用两个不同窗口连续初始化，并断言监听器数量不增长、单次事件只发送到新窗口一次。

- **跨实例事件订阅按 id 精确注销**：主进程中任何「渲染实例订阅集合」（`WebviewManager._subscribers` 等）都是**多 SPA 实例共享**的，注销 IPC 必须只按调用方自身的 `subscriberId` 删除，**一律禁止无 id 时 `clear()` 全清**，也禁止用 `Date.now()` 等粗粒度值作 id（同毫秒两实例取到同一 id，`Set` 去重后共享一条，任一方注销即误删另一方）。渲染层 store 必须在 `init()` 保存主进程下发的 id，并在 `dispose()` 原样回传；preload 包装函数不得丢弃该参数。回归锁：`apps/desktop/electron/services/webview-manager.test.js`「page-manager 事件订阅按 subscriberId 精确删除」+ `apps/desktop/src/stores/tab.test.js` dispose 回传用例。症状特征：原生 `WebContentsView` 照常显示（登录页/网页出现在当前标签区域），但 TabBar 不再出现新标签，且重启应用即恢复——遇到先查订阅集合大小，不要误判为标签注册逻辑失效。

- **Windows 路径身份断言**：生产代码返回 canonical 路径时，测试必须对实际值和期望值同时调用 `fs.realpathSync.native()` 后比较；不得用原始字符串、`path.resolve()` 或 `path.normalize()` 判断 8.3 短路径与长路径是否为同一文件，也不得为消除平台差异而放宽受控根、符号链接或越界检查。

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

### QM-3：测试策略

- 单元测试（1830 passed | 10 skipped）：覆盖核心业务逻辑 ✅

- 本地打包验证：覆盖 require 链、文件包含、语法 ✅（新增）

- Docker 运行时合同：按 runner `COPY` 清单构造隔离文件集并加载真实入口；生产镜像必须完成 build + start + readiness 回归。

- OIDC 生产合同：对真实租户 discovery/JWKS 执行 readiness，并分别覆盖允许的 RSA/EC 算法、错配密钥类型/曲线、未知 `kid` 与按 `alg:kid` 隔离的负缓存。

- 后续补充：main.js 启动测试（`node -e "require('./electron/main.js')"`）

- **composable 导出完整性测试**：所有使用 composable 的 Vue 组件，对应的 composable 测试必须包含导出完整性断言 — 列出模板需要的所有属性和方法，逐个 `toHaveProperty` 验证。防止模板引用未解构的属性。

- **Bridge 启动回归测试**：Bridge 子类的测试必须包含 `pythonModule` 值断言（不能只断言字符串，还要验证目标模块路径指向的包能被 `python -m` 启动）。已有用例如用例 13b。

- **文本结构断言（MUST）**：凡断言**文本结构**（换行 / 分段 / 分隔符 / 字段顺序 / 序列化格式）的测试，必须**至少一条 `toBe` / `toEqual` 精确断言或结构断言**（如 `expect(out.split("\n")).toEqual([...])`），`toContain` 仅可作为补充。原因：纯 `toContain` 子串匹配对结构性回归**完全免疫** —— 正文被压成一整行时每个子串依然命中（2026-09-16 采集页正文换行全丢即由此逃逸，见 `01-docs/BUGFIX-COLLECT-NEWLINE-PRESERVE-2026-09-16.md`）。新增/修改文本提取、解析、格式化类代码时必须同时补一条精确断言，并用「修复前实现副本」实测确认该断言能抓住 Bug。

- **全仓关键词复扫必须带 `-a`（MUST）**：本仓 `01-docs/PRD.md`、`01-docs/learnings.md` 等历史文档含 NUL 字节，`grep`/`rg` 默认把这类文件判为二进制并**静默跳过**，只输出一行 `Binary file ... matches`，命中数直接归零——于是「全仓扫到 0 命中」这类收口结论对真正有问题的文件完全失明（2026-09-26 实测：`grep -rn 立即同步 01-docs/PRD.md` = 1，`grep -rna` = 10）。凡以「扫到 0」作为完成判据的检查，一律 `grep -na` / `rg -a`，并额外确认**扫描器没有把这些文件当二进制**（`grep -c` 单文件计数对照）。

- **测试库/配置状态必须按模块确定化，不得依赖导入顺序（MUST）**：`config.settings` 这类**导入期单例**会让「模块级设环境变量再 import」的写法只对第一个被收集的测试文件生效——其余文件自设的临时库全部失效，整个 session 共用同一份状态，任一文件 teardown 里的 `drop_all` 都会波及其他文件，表现为「单跑绿、全量红」的假失败。修法：在 `tests/conftest.py` 里做**按模块**的 autouse 重置（幂等补齐 schema + 按外键逆序清空全部行 + 复位 `sqlite_sequence`），并用回归对锁定（制造方推进 rowid 并 `drop_all`，消费方不建表不清库、断言新父行 `id == 1` 且能写外键子行）；把该 fixture 改成 no-op 必须**立刻变红**，否则锁是装饰性的。既有案例：`ops-center/backend/tests/conftest.py::_isolate_database_per_test_module` + `tests/test_zz_conftest_isolation_a_wrecker.py` / `..._b_consumer.py`。归属纪律：全量红而单跑绿时，先在**未改动的 main** 上跑同一条全量做对照，既禁止把既有缺陷认领成本 PR 引入，也禁止反过来以「不是我改的」直接放行。 **但对照只证明「既有缺陷存在」，不证明「本 PR 无关」**：本 PR 自己可能叠加第二颗独立的雷（实测：#2397 清库修好后，本仓一条 5 路 `async_session` 并发的用例仍会让远处模块报外键失败）。所以必须二分到自己身上——用 `--deselect` 逐条摘除本 PR 新增用例跑全量，配合「摘掉修复即变红」的反证定责。规则：**在测试里开并发 session 的用例，必须在 `finally` 里 `await engine.dispose()` 归还连接池**（aiosqlite 池连接绑定事件循环，跨用例复用会读到过期 WAL 快照）。
- **文本空白归一化（MUST NOT）**：清理 HTML 源码缩进噪声时**禁止**用 `replace(/\s+/g, ' ')` —— `\s` 含 `\n`/`\r`/`\u2028`/`\u2029`/全角空格 `\u3000`/NBSP `\u00a0`/BOM `\ufeff`，会把**语义换行一起压掉**，正文变成一整行。正确口径：行内空白压缩用 `[^\S\n]+`（显式排除换行）；块级结构（`p`/`h1-h6`/`blockquote` → 段间空行，`div`/`li`/`tr` → 单换行，`td`/`th` → 制表符，`<br>` → 换行，`<pre>` → 原样保留）在 DOM 层转成换行，最后只做「连续 3 个以上换行压成 1 个空行」收口。正文提取统一复用 `apps/desktop/electron/services/readable-text.js`（`extractReadableText` / `normalizeExtractedText`），禁止在采集通道里另写一套。

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

- **PR 合入前（必须通过）**：像素对比核心视图，无需 API Key

  ```bash
  cd apps/desktop && npm run test:visual:pixel
  ```

- **发版前（人工核查项，非自动硬门禁）**：完整回归（94 个测试：44 视图 + 50 工作流）

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
├── views/        # 单视图快照(43 用例：23 核心 + 20 补充)
├── workflows/    # 多步工作流(50 用例：32 核心 + 18 补充)
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

# 发版前(必跑,94 用例全量)
npm run test:all:visual
```

### 强制规则(MUST)

1. **pre-commit 不集成**视觉测试(需 dev server,触发频率过高)
2. **PR 合入前必须通过** `npm run test:visual:pixel`(非零退出码禁止合入)
3. **发版前人工确认**已跑 `npm run test:all:visual` 且无未审核的回归（**当前 `scripts/release-gate.mjs` 未将视觉回归纳入硬门禁**，它只核验版本 bump + CHANGELOG 收口 + 破坏性变更级别；因此本条是人工核查项而非自动拦截。若要将其升级为「必须通过」的硬门禁，需先给 release-gate 接入视觉回归结果标记的硬检查，并定义时长预算/flaky/基线策略）
4. **baseline 更新需人工审核** diff 图,确认是预期变化后再覆盖
5. **像素失败后**必须跑 `npm run test:visual:agent` 生成报告,Agent 用 view\_image 看图判断
6. 所有命令必须在 `apps/desktop/` 目录下执行

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

用 `codeagent-wrapper` 并行启动两个后端模型审查实现 diff（`run_in_background: true`，同一条消息两个调用）：

```
# 后端模型（逻辑/安全/规格合规审查）
codeagent-wrapper --backend claude --lite "审查 <change> 实现：正确性/边界/安全/规格合规" <workdir>

# 前端模型（模式/可维护性/集成风险审查）
codeagent-wrapper --backend opencode --lite "审查 <change> 实现：命名/模式/可维护性/集成" <workdir>
```

> 后端模型（claude）与前端模型（opencode）由 `.ccg/config.toml` 的 `[routing]` 配置决定；前端模型失败最多重试 2 次（间隔 5 秒），3 次全败才跳过；后端模型结果必须等待（5-15 分钟属正常）。

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

