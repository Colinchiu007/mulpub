---
name: start-app
version: 1.7.0
description: >
  用当前项目最新代码 + 共享数据（shared-user-data 锚点）启动/重启 Multi-Publish
  桌面应用。支持 Windows 与 WSL（Ubuntu-E）双环境：默认启动 Windows 环境的应用，
  显式指定或检测到 WSL 时走 WSL 流程。启动前先核对本地工作区与远程
  origin/main 对齐（保证跑的是最新代码），再检查环境齐备（node / 依赖 /
  electron / 端口），最后启动并验证窗口与登录态。自动判断应用是否已在运行，
  区分「启动 / 重启 / 仅确认状态」三种场景。触发词：启动应用、启动桌面、
  重启应用、start-app、restart-app、应用在跑吗、跑最新代码。
tags: [launch, desktop, electron, dev, sync, profile, restart, wsl, windows]
---

# 启动应用（最新代码 + 已登录 profile）

> **本文件是单一事实源（single source of truth）。**
> 各 agent 目录（`.codex/skills/`、`.claude/commands/`、`.cursor/commands/` 等）
> 下的 `start-app` / `启动应用` 入口均为轻量包装，指向本文件。修改逻辑请改这里。

## When to Use

- 用户想「启动应用」「打开桌面端」「跑一下最新代码」
- 用户想用**已登录的 profile**（保留登录态 / 模型 key）启动应用做手动验证
- 用户要求「先同步最新代码再启动」，保证跑的不是旧代码
- 需要确认应用能正常起来、登录态还在
- 用户想**重启应用**（`重启应用` / `restart-app`）——先停旧实例再加载最新代码
- 用户想确认应用**是否在运行**（`应用在跑吗` / `app status`）——只查状态不重启

## 自动判断当前 agent（本 skill 如何被各 agent 加载）

本 skill 的完整定义只维护一份（本文件）。各 agent 通过**各自约定目录**的轻量入口
加载，入口内容统一为「指向本文件 + 执行要点」。当前已覆盖：

| Agent | 入口路径 | 加载方式 |
|-------|---------|---------|
| Codex | `.codex/skills/start-app/SKILL.md` | `/start-app` |
| Claude Code | `.claude/commands/启动应用.md` | `/启动应用` |
| Cursor | `.cursor/commands/启动应用.md` | `/启动应用` |

> 说明：不同 agent 只扫描**自己约定目录**下的文件，无法用一个文件同时服务多个
> agent。因此「整合」= 单一事实源 + 各 agent 轻量入口，而非单文件多 agent。

## 三种场景（先判断应用当前是否在运行）

启动前**必须先探测**应用是否已在运行，据此决定处理方式：

| 场景 | 触发词 | 处理 |
|------|--------|------|
| **A. 未运行** | `启动应用` / `start-app` | 正常走完整启动流程（见下）|
| **B. 已在运行 + 想重启** | `重启应用` / `restart-app` | 明确接受丢失当前会话状态 → 先停旧实例再启动（脚本已内置清旧实例）|
| **C. 已在运行 + 只想确认/复用** | `应用在跑吗` / `app status` | 只检查进程+端口，**不重启**，避免丢失正在编辑的草稿/未保存操作 |

**探测方法**（只读，不杀进程）：

```powershell
Get-Process electron -ErrorAction SilentlyContinue | Select-Object Id,MainWindowTitle
Get-NetTCPConnection -LocalPort <vitePort> -State Listen -ErrorAction SilentlyContinue
Get-NetTCPConnection -LocalPort <cdpPort> -State Listen -ErrorAction SilentlyContinue
```

**关键规则：**
- 用户说「**启动**」但发现已在运行 → **先询问**是否要重启，不要默默杀掉（可能丢失会话状态）。
- 用户说「**重启**」→ 明确接受重启，直接执行（`start-desktop.ps1` 第 4 步会自动停掉同 worktree 的旧 Electron/Vite 再启动新的）。
- 用户只问「在跑吗」→ 只报告状态，不执行任何停止/启动动作。

## 核心目标

1. **代码最新**：启动前核对本地工作区与远程 origin/main 对齐，落后则 fast-forward 同步
2. **环境齐备**：node、依赖、electron 二进制、端口都健康，避免启动即崩
3. **共享数据**：用 `shared-user-data` 锚点（WSL/Windows 共用同一数据库、模型 key、账号），不设显式 profile 以免绕过锚点导致数据分裂
4. **双环境**：默认启动 **Windows** 环境的应用；显式指定或检测到 WSL 时走 WSL 流程
5. **验证**：窗口出现 + 登录态可读

## 关键事实（本项目）

- **双环境**：Windows（`start-desktop.ps1`，PowerShell 7）与 WSL Ubuntu-E（`start-desktop-wsl.sh`，bash）。**默认 Windows**。
- **共享数据锚点**：仓库根 `shared-user-data/.shared-data-anchor`（已创建）。`startup-compat.js` 自动检测并启用共享 userData，WSL/Windows 数据一致。**⚠️ 显式设 `ELECTRON_USER_DATA_DIR` / `--user-data-dir=` 会绕过锚点 → 数据分裂**，默认不要设。
- **一键启动（v1.6.0 起首选）**：`scripts/sync-app.ps1`（同步 + 依赖门禁 + electron 校验 + 启动编排）+ `scripts/mp-applive-launcher.ps1`（WMI `Invoke-CimMethod Win32_Process.Create` 脱离 agent job 拉起 electron，WMI 不可用回退 `Start-Process`）。持久运行 worktree = `mp-worktrees/mp-app-live2`（保留 node_modules，避免每次重装依赖）。详见下方「一键启动工作流」。
- **Windows 启动契约（备选）**：`scripts/start-desktop.ps1`（同步 + 依赖 + 端口 + 单实例锁 + 启动 + 验证）。
- **WSL 启动契约**：`scripts/start-desktop-wsl.sh`（bash 版；依赖 Linux 版 node_modules + `LD_LIBRARY_PATH` 指向 `~/mp-wsl-deps/electron-libs`）。
- **WSL 依赖**：项目 node_modules 是 Windows 版（缺 `@rollup/rollup-linux-x64-gnu` 等 Linux 可选依赖），WSL 端须用**独立 Linux 依赖树**（`~/mp-wsl-deps/mp-wsl` worktree 内 `pnpm install --frozen-lockfile`）。
- **WSL electron 库**：Linux electron 缺 5 个 GUI 库（libnspr4/libnss3/libnssutil3/libsmime3/libasound），用 `LD_LIBRARY_PATH=~/mp-wsl-deps/electron-libs` 注入（持久目录，WSL 重启不丢）。
- **远程**：`origin = https://github.com/Colinchiu007/Multi-Publish.git`，主干 `main`。
- **登录态校验**：`scripts/start-desktop-identity.js` 经 CDP 读 `window.electronAPI.identityGetState()`。
- **端口**：worktree 下按路径稳定派生独立端口（`apps/desktop/scripts/dev-ports.js`），避免并发互抢。
- **每日自动化**：`automation-1789788099000`（每天 04:00 跑 `sync-app.ps1 -Safe`，仅 fetch+自愈+依赖哈希门禁，不重写整棵树，并在 live-app 早退前先做锚点热备份 + 健康 lint）。

## 一键启动工作流（v1.6.0 起默认路径）

> **何时用**：用户要「启动/重启最新代码的应用」且无特殊 worktree 要求时，优先走本节，替代旧的「手动同步 + start-desktop.ps1」长流程。

### 命令

```powershell
# 完整：同步 origin/main + 条件装依赖 + 启动（在普通终端跑，勿在 agent 沙箱内）
powershell -ExecutionPolicy Bypass -File D:/Data/projects/Multi-Publish/scripts/sync-app.ps1

# 只同步不启动（预同步）
powershell -ExecutionPolicy Bypass -File D:/Data/projects/Multi-Publish/scripts/sync-app.ps1 -PrepareOnly

# 安全模式：fetch + 自愈 + 依赖门禁（供无人值守自动化；不重写工作树）
powershell -ExecutionPolicy Bypass -File D:/Data/projects/Multi-Publish/scripts/sync-app.ps1 -Safe
```

### 机制要点

| 组件 | 职责 |
|------|------|
| `sync-app.ps1` | 解析仓库根（git common-dir 的父目录）→ worktree 健康检查 → 活体实例检测（本 worktree electron **或**共享同一 userData profile 的外部 Electron 主进程，分隔符双向匹配；`-Safe`/`-PrepareOnly` 遇活体即跳过同步）→ fetch origin/main →（默认/`-PrepareOnly`）`checkout -f origin/main` + `clean -fd`；（`-Safe`）先锚点热备份（shared-user-data.backups\<ts>，保留 7 套）+ mp-anchor-health.ps1 lint，再只自愈不重写 → pnpm-lock.yaml SHA256 门禁装依赖 → `ensure-electron.js` → 启动 launcher |
| `mp-applive-launcher.ps1` | 自定位 node/python → dev-ports.js 派生端口 → 停同 worktree 旧 electron + **审计停止从其他目录启动但共享同一 userData 的 foreign 实例（v1.7.0，applive-foreign-audit.ps1）** → 设 env（`MP_VITE_PORT`/`MP_CDP_PORT`/`ELECTRON_USER_DATA_DIR=shared-user-data`/`MP_PYTHON`/`MP_CDP_ALLOW_ALL_ORIGINS=1`）→ WMI 拉起 `node scripts/dev.js` → 轮询 150s 可见窗口；失败时输出 `LOCK_HOLDER_CANDIDATES` 点名单实例锁持有者（防"旧窗口被误认为新应用"） |
| `applive-foreign-audit.ps1` | 纯函数模块（PS5.1/7 兼容、可注入进程列表）：按 `--user-data-dir` 斜杠双向变体匹配 profile 持有者，按 worktree 归属分 Same/Foreign，仅 foreign **主进程**是审计停止对象；另提供 lock-holder 诊断行 |
| `mp-app-live2` worktree | 持久运行目录（detached at origin/main），node_modules 保留不删 |
| `shared-user-data/` | 登录态/DB 持久锚点（gitignored）：`multi-publish.db`（模型 key）、`backend-data/accounts.json`（平台登录态）、`identity-session.json`、`session/`、`credentials/`。防护：safe-worktree-remove.ps1 R0 禁删守卫（exit 6）+ 每日 `.backups` 快照 + `mp-anchor-health.ps1` lint |

### ⚠️ 沙箱纪律（agent 会话内必读）

- **agent 沙箱会杀整树重写类 git 写**（`checkout -f origin/main`、`reset --hard`、大 merge）→ 撕裂 worktree（留 `index.lock` + 大量假 ` D `）。**完整同步必须在普通终端跑**。
- agent 会话内只允许：fetch、`-Safe` 自愈（`checkout HEAD -- .`）、状态查询。
- 撕裂恢复三步：删 `D:/Data/projects/Multi-Publish/.git/worktrees/<name>/index.lock` → `cd` 进 worktree → `git checkout HEAD -- .` → 复验 dirty==0。
- 无人值守自动化一律用 `-Safe`，绝不跑整树重写。

### 验证（启动后）

1. `Get-Process electron` 的 MainWindowHandle 非 0（或 `tasklist /v` 见窗口标题）。
2. `curl http://127.0.0.1:<vitePort>/` 与 `http://127.0.0.1:<cdpPort>/json/version` 均 200（mp-app-live2 → vite 5231 / cdp 9279）。
3. CDP `listAccounts()` 返回 7 平台账号、`identityGetState()` authenticated（见「CDP 完整服务清单核验」节）。
4. 窗口属于本次启动的新进程：`Get-Process electron` 主进程的 `StartTime` 晚于本次 launcher 执行时刻（防旧窗口被误认为新应用，v1.7.0）。

## 流程（备选长流程，特殊 worktree/环境要求时用）

### 0. 环境判定（默认 Windows）

**先判定当前运行环境，决定用哪个启动脚本：**

```bash
uname -s   # Linux → WSL；MINGW/CYGWIN/MSYS → Windows
# 或检测 WSL：/proc/version 含 microsoft-standard-WSL2
```

| 判定 | 启动脚本 | 说明 |
|------|---------|------|
| **Windows（默认）** | `scripts/start-desktop.ps1` | PowerShell 7 版 |
| **WSL** | `scripts/start-desktop-wsl.sh` | bash 版，Linux electron + LD_LIBRARY_PATH |

- **不指定时默认 Windows**（用户要求「启动应用/重启应用」默认走 Windows）。
- 用户显式说「WSL 启动」/「wsl 环境」→ 走 WSL 流程。
- 若当前 shell 本身在 WSL 内（如本会话），直接用 WSL 流程；若在 Windows PowerShell，默认走 Windows 流程。

**WSL 启动核心命令（显式指定 WSL 时）：**

```bash
# 在 WSL Ubuntu-E 内执行
bash /mnt/d/Data/projects/Multi-Publish/scripts/start-desktop-wsl.sh
```

> 该脚本自动：同步 origin/main → 用 Linux 依赖树（`~/mp-wsl-deps/mp-wsl`）→ 注入 `LD_LIBRARY_PATH` → 启动 vite + electron（共享 userData 由锚点决定）。

### 0. 确认目标工作区

- 默认目标 = 当前仓库根（`D:\Data\projects\Multi-Publish`）。
- 若用户指定 worktree（如 `D:\Data\projects\mp-worktrees\mp-<task>`），用该 worktree。
- ⚠️ `start-desktop.ps1` 默认 **fail-closed 拒绝共享主工作区**（`git-dir == common-dir`），因为脚本会 fetch/merge 并强停进程。若确实要在共享主目录启动，需 `-ForceShared`（高风险，先向用户说明）。

#### 0a. 共享主工作区可用性检测（关键，曾多次踩坑）

**若目标是共享主工作区（`D:\Data\projects\Multi-Publish`），必须同时检查两项：**

```powershell
# 1. 脏文件数
git -C <repo> status --short | Measure-Object | Select-Object -ExpandProperty Count

# 2. 依赖健康度（⚠️ 曾因跳过此检查，pnpm install 跑了 1 小时没好）
node scripts/ensure-desktop-deps.js --check
```

**判定矩阵：**

| 脏文件 | 依赖 | 决策 |
|--------|------|------|
| > 0 | 任意 | ⛔ 立即改用隔离 worktree，不动共享主工作区 |
| = 0 | `DESKTOP_DEPS_OK` | ✅ 可正常走下方流程 |
| = 0 | `DESKTOP_DEPS_MISSING` | ⛔ **立刻改用隔离 worktree**，不要在共享主目录跑 `pnpm install` |

> **⚠️ 核心教训 1（曾导致误 stash）**：
> 之前重启时，共享主工作区有 1204 个其他会话的脏文件，我直接 `git stash` 处理冲突，违反铁律。**正确做法：脏文件多时直接改用隔离 worktree，绝不在共享主工作区动 git 状态。**

> **⚠️ 核心教训 2（曾导致 pnpm install 死等 1 小时）**：
> 共享主目录的 `node_modules` 可能被其他会话破坏（缺包、hoisting 不完整）。此时 `pnpm install --frozen-lockfile` 极慢（>1 小时）且不可靠——因为多会话并发时 hardlink 竞争、watcher 干扰。**依赖缺失时不要修，直接改用隔离 worktree。**

#### 0b. 隔离 worktree 启动（共享主工作区不可用时用）

当共享主工作区脏文件多或依赖残缺时，在隔离 worktree 启动最新代码。

**优先复用已有 worktree（快）：**

若已有基于 `origin/main` 的隔离 worktree（如 `mp-start-win`），直接复用：

```powershell
# 1. 丢弃所有本地改动，确保干净
git -C "D:\Data\projects\mp-worktrees\mp-<name>" checkout -- .
git -C "D:\Data\projects\mp-worktrees\mp-<name>" clean -fd

# 2. 同步到 origin/main 最新
git -C "D:\Data\projects\mp-worktrees\mp-<name>" fetch origin
git -C "D:\Data\projects\mp-worktrees\mp-<name>" checkout origin/main

# 3. 验证依赖仍健康（isolated worktree 的 deps 通常不受共享主目录影响）
node "D:\Data\projects\mp-worktrees\mp-<name>/scripts/ensure-desktop-deps.js" --check
# 若仍然 DESKTOP_DEPS_OK → 跳到步骤 5
```

**无可用 worktree 时新建：**

```powershell
# 1. 创建隔离 worktree（基于 origin/main 最新代码），用 PowerShell 原生 D:\ 路径
git -C <repo> worktree add -b "local/<task>" "D:\Data\projects\mp-worktrees\mp-<task>" origin/main
# 2. 验证 worktree 可进入（铁律：失败则 worktree remove --force，不留半失效注册）
git -C "D:\Data\projects\mp-worktrees\mp-<task>" rev-parse --show-toplevel

# 3. 新 worktree 依赖就绪
cd "D:\Data\projects\mp-worktrees\mp-<task>"
pnpm install --frozen-lockfile
node scripts/ensure-electron.js
node scripts/verify-worktree-deps.js
```

**`pnpm install` 超时纪律（⚠️ 曾踩坑）：**

隔离 worktree 的 `pnpm install` 通常 1-2 分钟完成。若超过 **2 分钟**还没结束——立即 `Ctrl+C` 终止，检查：
- 是否有其他会话在同时跑 `pnpm install`（hoisted hardlink 竞争）
- pnpm store 是否可达（`pnpm config get store-dir`）
- 是否有写保护 watcher 在干扰（`Get-Process` 查 `pwsh` 进程命令行含 `guard-shared-root-writes`）

**不要死等。** 2 分钟上限，超时就 kill 换方案。

**4. 启动（⚠️ 重启场景必须加 `-StopForeignProfile`）：**

```powershell
# 重启场景：必须加 -StopForeignProfile，因为其他 worktree 可能留有旧 Electron 进程占用 profile
pwsh -File scripts/start-desktop.ps1 -Worktree "D:\Data\projects\mp-worktrees\mp-<task>" -Profile 'D:\tmp\Multi-Publish-debug-profile' -CheckIdentity -Json -StopForeignProfile
```

> **⚠️ 核心教训（曾因没加 -StopForeignProfile 白跑一轮）**：
> 重启时，`mp-e2e-run` 等 worktree 可能留有 5+ 个 Electron 进程占用同一 profile。不加 `-StopForeignProfile` 会直接报错退出。**重启场景一律加此参数。**

- 隔离 worktree 的端口由 `dev-ports.js` 按路径独立派生，不会与共享主工作区互抢。
- `-StopForeignProfile`：审计停止占用同一 profile 的其他 worktree 实例（避免单实例锁互杀）。
- 完成后可 `git -C <repo> worktree remove "D:\Data\projects\mp-worktrees\mp-<task>"`（走 `safe-worktree-remove.ps1`，遵守 R1-R5 铁律）。

### 1. 核对本地工作区与远程对齐（保证代码最新）

在目标工作区执行：

```powershell
git fetch origin
git rev-list --left-right --count HEAD...origin/main   # 输出 "a<TAB>b"：a=领先数 b=落后数
```

**按 a/b 组合处理（关键：分叉状态必须 fallback 到普通 merge，不能只用 --ff-only）：**

| 状态 | 处理 |
|------|------|
| **0/0**（已对齐）| 继续，无需同步 |
| **0/b**（b>0，仅落后）| `git merge --ff-only origin/main`（可 fast-forward）|
| **a/0**（a>0，仅领先）| 本地有远程没有的提交（如未 push 的本地提交/未合并 PR），提示用户确认是否要跑本地领先版本 |
| **a/b**（a>0 且 b>0，**分叉**）| ⚠️ **`--ff-only` 必然失败**。必须用普通 merge：`git merge origin/main`（ort 策略，可合并分叉）。若本地领先提交是文档/流程类，合并通常无冲突；若冲突，停止并报告用户先处理，**不要**强推或丢弃改动 |

> **⚠️ 核心教训（曾导致启动用旧代码）**：
> 之前 skill/脚本只用 `merge --ff-only`，在**分叉状态**（本地领先 + 落后）下必然失败，导致同步失败后应用仍用旧代码启动。**必须**在分叉时 fallback 到普通 `git merge origin/main`。

**合并后必须验证 HEAD 已更新到最新（防旧代码启动）：**

```powershell
# 合并后确认 HEAD 已包含 origin/main 最新提交
git rev-list --left-right --count HEAD...origin/main   # 应输出 "a<TAB>0"（落后必须为 0）
git log --oneline -1 origin/main                       # 远程最新提交
git log --oneline -1 HEAD                              # 本地 HEAD，应 >= 远程
```

- **落后数必须为 0** 才允许启动。若合并后仍落后（合并失败/被中断），**停止，不要启动**，否则跑的是旧代码。
- 若用户指定了某个修复/功能，启动前用 `git merge-base --is-ancestor <修复提交> HEAD` 确认该提交已在 HEAD 中。

> 说明：`start-desktop.ps1` 内部也会做同步（除非 `-NoSync`），但**先手动核对 + 验证**能确保启动前 HEAD 已是最新，避免脚本同步失败时静默用旧代码启动。

### 2. 检查环境齐备

- **node**：`Get-Command node` 或按 `start-desktop.ps1` 的候选路径探测；缺失则提示先装/激活 Node。
- **依赖**：
  ```powershell
  node scripts/ensure-desktop-deps.js --check   # 只检查；缺失返回非零
  ```
  缺失时运行 `node scripts/ensure-desktop-deps.js`（默认 restore 自愈）。
- **electron 二进制**：`node_modules\electron\dist\electron.exe` 存在（缺失先 `node scripts/ensure-electron.js`）。
- **端口**：目标 Vite/CDP 端口未被其他 worktree 占用（`start-desktop.ps1` 会自动 fail-closed 检查）。

> 这些检查 `start-desktop.ps1` 默认都会做（`-NoDepsCheck` 可跳过）。手动跑 `--check` 便于提前暴露问题。

### 3. 用已登录 profile 启动

**首选（推荐）——复用启动契约脚本：**

```powershell
pwsh -File scripts/start-desktop.ps1 `
  -Worktree <目标工作区绝对路径> `
  -Profile 'D:\tmp\Multi-Publish-debug-profile' `
  -CheckIdentity `
  -Json
```

参数说明：
- `-Worktree`：目标工作区（默认脚本所在仓库根）。
- `-Profile`：已登录 profile（默认 `D:\tmp\Multi-Publish-debug-profile`）。
- `-CheckIdentity`：窗口出现后经 CDP 校验登录态。
- `-Json`：输出结构化证据块。
- 可选：`-InvalidateViteCache`（陈旧 Vite 缓存导致 504 空白页时用）、`-StopForeignProfile`（其他 worktree 占用同一 profile 时审计停止后继续）。

**备选——直接启动（不经过完整契约，仅调试用）：**

```powershell
node scripts/launch-worktree.js --worktree <dir> --profile 'D:\tmp\Multi-Publish-debug-profile'
```

### 4. 验证

- 脚本轮询等待可见主窗口（默认 150s），成功输出 `START_CONTRACT_OK` + 窗口 handle/标题。
- `-CheckIdentity` 会输出登录态 JSON（`identity-session.json` 解密后的状态）。
- 若 `identity` 输出 `IDENTITY_UNAVAILABLE` / `NO_PAGE`：窗口起来了但登录态不可读，提示用户确认是否已登录。

**账号数据验证（多自媒体账号是否加载，2026-09-13 实测）：**

经 CDP WebSocket 调 `window.electronAPI.listAccounts()`，确认已登录 profile 的账号完整加载：

```js
// 连 CDP（端口见启动输出，mp-app-live 为 11415），找 vite 页面 target
const targets = await getJson('http://127.0.0.1:<cdpPort>/json/list')
const page = targets.find((t) => t.type === 'page' && t.url.startsWith('http://127.0.0.1:<vitePort>'))
// 经 page.webSocketDebuggerUrl 发 Runtime.evaluate：
// expression: '(async () => JSON.stringify(await window.electronAPI.listAccounts()))()'
// awaitPromise: true, returnByValue: true
```

- 返回 `{"code":0,"data":[{platform,name,status,...}]}`，`data.length` 应为 7（百家号/快手/B站/抖音/公众号/头条/视频号）。
- `status: "active"` 表示该平台 cookie 有效；`expired` 表示 cookie 过期（数据仍在，需重新登录）。
- 若 `NO_PAGE`：窗口起来了但 CDP 页面不可达，检查 vite 端口是否被其他 worktree 占用。

## CDP 完整服务清单核验（登录后账号缺失排查，2026-09-16 实测）

现象：登录态正常（`identityGetState()` → `authenticated`）但账号管理里平台账号全空。

**根因定位（经 CDP 拉 `servicesGetStatus()`）**：账号缺失不是登录问题，而是主 Python 后端 `mainBackend` 没起来——其 `not_started` 让 `listAccounts()` 直接返回 "Python backend is not running"。

**完整 6 服务清单（端口固定）**：

| 服务 | 端口 | 说明 |
|------|------|------|
| **mainBackend（主服务）** | 8299 | 承载账号/后端 API 的核心，挂了账号全空 |
| splitterEngine | 8002 | 分句引擎 |
| promptEngine | 8013 | 提示词优化引擎 |
| callbackServer | 16521 | 回调服务（通常 running）|
| mediaServer | 动态高端口 | 媒体服务（通常 running，端口随机分配）|
| alignerEngine | 8004 | 对齐引擎（on_demand 按需）|

**标准验证流程（可复用 runbook）**：

1. 启动器带 `MP_CDP_ALLOW_ALL_ORIGINS=1` 启动 application（否则 CDP 403）。
2. 轮询 `http://127.0.0.1:<cdpPort>/json/list` 直到出现 vite 页面 target（mp-start-app-win: cdp 11412 / vite 7364）。
3. 经 page `webSocketDebuggerUrl` 发 `Runtime.evaluate`（`awaitPromise:true, returnByValue:true`）：
   - `JSON.stringify(await window.electronAPI.servicesGetStatus())` → 看 6 服务状态
   - `JSON.stringify(await window.electronAPI.listAccounts())` → 应返回 `{"code":0,"data":[...7 个平台...]}`
   - `JSON.stringify(await window.electronAPI.identityGetState())` → 应 `authenticated`
4. 判定：若 `mainBackend` 非 running + `listAccounts` 报 "Python backend is not running" → 查两个根因（孤儿后端占端口 / `PYTHON_PATH` 误当解释器）。

**账号数据位置**：`ELECTRON_USER_DATA_DIR/backend-data/accounts.json`。切换 profile 必须复制该目录（见「profile 数据分裂」坑）。

## Skill 同步（同步到 skill-repo，2026-09-13 实测）

用户要求「把 start-app skill 同步到 skill repo」时执行。**skill-repo 是本机所有 agent skill 的单一事实源**（Nacos skill-sync local 模式）：

- **位置**：`E:\BaiduSyncdisk\100-Agent-data\skill-repo\start-app\`（Baidu 网盘同步目录，非 git 仓库）。
- **结构**：`SKILL.md`（完整定义，v1.3.0）+ `agents/openai.yaml`（OpenAI Agents UI 元数据，可选）。
- **同步步骤**：
  1. 复制项目内单一事实源：`cp D:/Data/projects/Multi-Publish/.agents/skills/start-app/SKILL.md E:/BaiduSyncdisk/100-Agent-data/skill-repo/start-app/SKILL.md`
  2. 创建/更新 `agents/openai.yaml`（格式参考 skill-repo 内 `git-cleanup-analysis/agents/openai.yaml`）。
  3. 验证：`diff <项目内 SKILL.md> <skill-repo SKILL.md>` 应输出 IDENTICAL；`file openai.yaml` 应为 UTF-8 无 BOM。

**⚠️ 编码坑（2026-09-13 实测）**：写含中文的 `.yaml`/`.md` 到 skill-repo 时，**必须用 bash heredoc**（`cat > file << 'EOF'`），不要用 PowerShell `Set-Content -Encoding UTF8`——PowerShell 5.1 会把中文按 GBK 读取再转 UTF-8，产生双重编码乱码（hex 可见 `e9 8d 8f` 等无效序列）。验证：`file` 应显示 `UTF-8 text`（无 BOM），`cat` 回读中文正常。

**⚠️ 全局 agent 目录**：本机 `C:\Users\邱领\.codex\skills` / `.agents\skills` 全局目录**当前不存在**（skill roots 配置 r1/r2 指向它们但目录未创建）。nacos-cli 当前不可用（npm global 里无此命令）。所以「同步到 skill repo」= 更新 skill-repo 文件即可，无需建全局链接。

## 失败处理

| 现象 | 处理 |
|------|------|
| merge --ff-only 失败 | 有未提交脏文件冲突，报告用户先处理，不丢弃改动 |
| 端口被其他 worktree 占用 | 脚本 fail-closed；先停占用方或换 worktree |
| profile 被其他 worktree 占用 | 加 `-StopForeignProfile` 审计停止，或手动停旧实例 |
| 依赖缺失 | `node scripts/ensure-desktop-deps.js` 自愈后重试 |
| 150s 无窗口 | 看 `%TEMP%\mp-start-dev.err.log`（Windows）或脚本输出日志（WSL）尾部错误 |
| 504 空白页 | 加 `-InvalidateViteCache` 重试 |
| WSL electron 缺库 | `LD_LIBRARY_PATH=~/mp-wsl-deps/electron-libs` 注入；缺失则从 `/tmp/electron-libs/extracted/usr/lib/x86_64-linux-gnu/` 复制 |
| WSL GPU 崩溃（GPU process isn't usable）| 加 `--in-process-gpu`（start-desktop-wsl.sh 已内置）|
| WSL 数据分裂 | 确认 electron 用共享目录：`--user-data-dir=/mnt/d/Data/projects/Multi-Publish/shared-user-data`；不要设 `ELECTRON_USER_DATA_DIR` |
| 启动后窗口还是旧版界面（代码已同步但 UI 未更新，2026-09-20 复盘） | **单实例锁跨目录接管**：从别的目录/入口启动的旧 Electron 共享同一 userData（如 `shared-user-data`）持有单实例锁，新实例 `app.quit()` 静默退出，老进程 `second-instance` 只重新聚焦**旧 renderer 窗口**（老窗口连的 Vite HMR 已断，永远不会自行换新代码）。v1.7.0 起 launcher 自动审计停止此类 foreign 主进程；手工排查：看 launcher 输出 `PROFILE_OWNER`/`LOCK_HOLDER_CANDIDATES` 行点名 pid+exe，手动 `Stop-Process` 后重启。**任何情况下都不要假定"看到窗口=新代码"，须核对窗口所属进程启动时间** |
| 启动后窗口出现几十秒就消失（无崩溃日志、退出码 0） | **单实例锁冲突**：另一 worktree 用同一 profile 启动，后启动实例被 `app.quit()` 顶掉。改用独立 profile 启动（见 Pitfalls「profile 单实例锁」） |
| 后台 job 里跑 start-desktop.ps1，job 结束应用就没了 | **父会话连带杀进程**：`Start-Process` 启动的 electron 进程树挂在启动它的 PowerShell 会话下，会话退出即被终止。改用 WMI `Win32_Process.Create` 拉起独立启动器（见 Pitfalls「独立启动器」） |
| 窗口加载 5174 而非 worktree 派生端口 | **WMI Create 不继承环境变量**：`Win32_Process.Create` 启动的进程不继承调用者的 `DEV_SERVER_PORT`，electron 回退默认 5174。启动器脚本内显式设置环境变量后再 `Start-Process` |
| 窗口 show() 后 Win32 层面仍隐藏（visible=False） | 该执行环境特性。用 `ShowWindow(SW_RESTORE/SW_SHOW)` + `SetWindowPos(SWP_SHOWWINDOW)` + `SetForegroundWindow` 强制显示 |
| 切换 profile 后账号信息消失 | **profile 数据分裂**：账号在 `userDataDir/backend-data/accounts.json`（Python 后端数据目录 = `ELECTRON_USER_DATA_DIR/backend-data`）。切 profile 必须复制该目录 |
| 窗口没了但进程还在（用户以为应用关闭） | 窗口被关闭后应用可能进入后台/托盘模式，进程与后端服务仍存活。先查进程+CDP 页面再判断，必要时重启恢复窗口 |
| worktree 的 git 注册被其他会话清理（`not a git repository: (NULL)`） | **worktree 半失效**：`.git/worktrees/<name>` 注册被 `git worktree prune` 或清理脚本移除，但物理目录还在。无法复用，需重建 worktree（见 Pitfalls「worktree 注册反复失效」） |
| 启动器 WMI 拉起但无 electron、CDP 连不上、毫无报错 | worktree git 注册失效 → `start-desktop.ps1` 在 `git -C $repoRoot log -1` 返回空时 fail-closed「非 git 工作区」，根本没启动 electron；WMI 脱离会话又把 stderr 吞掉。诊断：`git -C <wt> rev-parse --git-dir` 确认失联；改用直启 `node apps/desktop/scripts/dev.js` + 设 MP_VITE_PORT/MP_CDP_PORT/ELECTRON_USER_DATA_DIR/MP_PYTHON/MP_CDP_ALLOW_ALL_ORIGINS=1（见 Pitfalls「worktree 注册失效致 start-desktop.ps1 不可用」） |
| servicesGetStatus 主服务 not_started / listAccounts 报 "Python backend is not running" | 账号缺失表象=主 Python 后端没起。根因二选一或叠加：① 孤儿 Python 后端占端口（强杀 electron 不杀孙进程）；② `PYTHON_PATH` 误当解释器（PR #1866，bridge spawn 目录→ENOENT）。先级联清理本 worktree 后端 python 进程，再确认 bridge 仅用 `MP_PYTHON` 覆盖（见 Pitfalls 两条对应坑） |
| CDP WebSocket 返回 403 | 外部 CDP 客户端缺 `--remote-allow-origins=*`。启动器必须设 `MP_CDP_ALLOW_ALL_ORIGINS=1`（dev-launcher.js 已支持，默认关），否则只能连本机页面 target、拿不到 `servicesGetStatus` 等 API |

## Pitfalls

- **共享主目录默认被拒**：`start-desktop.ps1` 对共享主工作区 fail-closed，需 `-ForceShared` 且先向用户说明风险。
- **共享主目录依赖残缺（核心坑）**：多会话并发时，共享主目录的 `node_modules` 可能被破坏（hoisting 不完整、缺包）。此时 `pnpm install --frozen-lockfile` 极慢（>1 小时）且不可靠。**处置优先级**：① 先用隔离 worktree 启动（优先，不阻塞）；② 有空时再修复共享主目录依赖——删除 `node_modules` 重装：`rm -r -fo node_modules; pnpm install --frozen-lockfile`（约 1 分钟，比增量修复快 60x）。
- **重启必须加 `-StopForeignProfile`**：其他 worktree 可能留有旧 Electron 进程占用同一 profile，不加此参数会直接报错退出。重启场景一律加。
- **`pnpm install` 超时纪律**：无论共享主目录还是隔离 worktree，`pnpm install` 超过 2 分钟就 kill 排查，不要死等。
- **`node_modules` 半损状态识别**：若 `node_modules/.pnpm` 为空且 `.modules.yaml` 不存在，说明 node_modules 是之前安装中断的残留——增量修复（`pnpm install --frozen-lockfile`）在此状态下极慢甚至卡死。**直接删除重建**：`rm -r -fo node_modules; pnpm install --frozen-lockfile`（约 1 分钟）。
- **隔离 worktree 优先复用**：创建新 worktree 需要 `pnpm install`（1-2 分钟），但已有 worktree 只需 `git checkout` + `git clean`（秒级）。优先检查是否已有可用的隔离 worktree。
- **不要静默连别人的 Vite**：端口归属检查是 fail-closed，绝不绕过。
- **profile 单实例锁**：同 profile 多实例互杀会导致窗口空白，先处理占用。
- **快链路 "最新代码" 契约依赖 foreign profile 审计（v1.7.0，2026-09-20 复盘）**：Electron 单实例锁按 **userData 目录**归属而非代码目录归属。v1.6.0 快链路（sync-app + applive-launcher）只停"Path 在本 worktree 下"的实例，从其他目录启动但共享 `shared-user-data` 的旧进程完全不可见：checkout 反复更新磁盘代码，前台窗口却永远是旧 renderer（`second-instance` 只聚焦老窗口，Vite/HMR 不会刷新一个从未重载的页面）。修补要点：① launcher 启动前经 `applive-foreign-audit.ps1` 按 profile 点名所有持有者并审计停止 foreign 主进程；② 窗口验证失败时输出 `LOCK_HOLDER_CANDIDATES` 而非笼统 WARN；③ sync-app 活体检测须**双向匹配斜杠变体**（进程路径永远反斜杠，参数可能正斜杠，`-like` 不匹配=静默失明），并把 foreign 持有者计入"活体"。
- **profile 单实例锁（跨 worktree 顶掉，2026-09-08 复盘）**：Electron `requestSingleInstanceLock()` 基于 **userData 目录**。多个 worktree 用同一 profile（如 `D:/tmp/Multi-Publish-debug-profile`）启动时，后启动实例拿不到锁 → `app.quit()` 正常退出（**code 0、无崩溃日志**），表现为「应用启动后 2-3 分钟消失」。排查要点：`Get-CimInstance Win32_Process -Filter "Name='electron.exe'"` 看主进程命令行属于哪个 worktree；`tasklist` 看是否有其他 worktree 的 electron 用同一 `--user-data-dir`。**解决：给每个 worktree 用独立 profile**（如 `D:/tmp/Multi-Publish-debug-profile-mp-start`），彻底隔离锁。⚠️ 切换 profile 必须复制登录态与数据（见「profile 数据分裂」坑）。
- **独立启动器（脱离父会话，2026-09-08 / 2026-09-13 补充）**：`Start-Process` 启动的 electron 进程树**绑定在启动它的 PowerShell 会话**下，会话退出（后台 job 结束 / 脚本 exit）即连带终止。**2026-09-13 实测补充**：仅用 `Start-Process` 启动 pwsh 跑 `start-desktop.ps1` 仍不够——fastctx run / bash job 结束时，`Start-Process` 的 pwsh 子进程也会被进程树清理连带杀掉（表现为 start-desktop.ps1 输出 START_CONTRACT_OK 后 electron 立即消失）。**可靠做法（实测有效）**：写一个启动器 `.ps1`（内部设置 `ELECTRON_USER_DATA_DIR` / `MP_VITE_PORT` / `MP_CDP_PORT` → `Start-Process pwsh ... start-desktop.ps1 -PassThru` → `WaitForExit()`），用 WMI `Invoke-CimMethod Win32_Process Create -Arguments @{ CommandLine = "powershell -NoProfile -ExecutionPolicy Bypass -File <launcher>" }` 拉起启动器（进程由 WMI 服务托管，真正脱离父会话，父退出不影响）。验证：`Get-Process electron` 的 MainWindowHandle 非 0 + CDP 端口可连 + `window.electronAPI.listAccounts()` 返回账号。参考 `mp-start-desktop/scripts/start-electron-detached.ps1`。
- **启动器脚本必须纯 ASCII（2026-09-13 起，2026-09-16 强化）**：`.ps1` 一旦含字面非 ASCII 字符（中文注释、中文路径）且无 BOM，Windows PowerShell 5.1 会按系统 ANSI 码页（中文机=GBK）解析 UTF-8 字节，产生三类破坏：① 变量赋值被吞（`$worktree` 变 null，`Join-Path` 报参数空）；② 转义破坏（`C:\tmp\...` → `C:	mp...`）；③ **中文用户名被读成乱码**——字面 `邱领` 变成 `閭遍`，若它拼进 `$env:MP_PYTHON`，spawn 目标变成 `C:\Users\閭遍\...\python.exe` → `ENOENT`，主 Python 后端 `mainBackend` 起不来（本次 2026-09-16 实踩，症状：`app-2026-09-16.log` 报 `spawn C:\Users\閭遍\...\python.exe ENOENT`）。**强制纪律**：启动器 `.ps1` 必须纯 ASCII（bash heredoc 写入、无 BOM），所有含用户名的路径一律经无中文字面量变量解析：`$pyDir = Join-Path $env:LOCALAPPDATA 'Programs\Python\Python312'`、`$nodeDir = Join-Path $env:USERPROFILE '.workbuddy\binaries\node\versions\22.22.2'`；`MP_PYTHON` 用 `Join-Path $pyDir 'python.exe'`。参考已验证可用的 `D:\tmp\start_app_dev_launcher.ps1`。验证：`file <script>.ps1` 显示 `ASCII text`。
- **WMI Create 不继承调用者环境变量（2026-09-08）**：`Win32_Process.Create` 启动的进程**不继承**调用 PowerShell 的 `$env:...`。若 electron 需要 `DEV_SERVER_PORT`（worktree 派生端口），必须由启动器脚本内部显式设置后再 spawn，否则 electron 回退默认 5174，页面加载到错误端口（CDP 页面 URL 可验证）。
- **窗口强制显示（2026-09-08）**：该执行环境（Codex 桌面 app 会话）里应用主窗口 `show()` 后 Win32 层面仍 `visible=False`（`Get-Process` 的 MainWindowHandle 为 0，但 `EnumWindows` 能找到标题窗口）。验证窗口存在用 `EnumWindows` + `GetWindowThreadProcessId` 匹配主进程 PID；强制显示用 `ShowWindow(SW_RESTORE=9)` → `ShowWindow(SW_SHOW=5)` → `SetWindowPos(SWP_SHOWWINDOW=0x0040)` → `SetForegroundWindow`。
- **profile 数据分裂（backend-data，2026-09-08 核心坑）**：账号信息存在 **`userDataDir/backend-data/accounts.json`**（Python 后端 `server.py` 的 `DATA_DIR` = `ELECTRON_USER_DATA_DIR/backend-data`，经 `python-bridge.js` 注入 `MULTI_PUBLISH_DATA_DIR`）。**切换 profile 必须复制 `backend-data/` 目录**（含 accounts.json），否则账号管理里保存的平台账号全部消失。登录态在 `identity-session.json`（加密）+ `multi-publish.db`（模型 key）+ `Local State` + `session/`，一并复制。验证账号恢复：CDP 调 `window.electronAPI.listAccounts()`。
- **窗口关闭但进程存活（2026-09-08）**：窗口被关闭后应用可能进入后台/托盘模式（`window-all-closed` → 无运行任务时正常退出；有托盘/后台逻辑时进程存活）。用户报「应用没了」时先查 `tasklist` + CDP `/json/list`（页面还在 = 进程活着），再决定重启恢复窗口，不要误判为已关闭。
- **worktree 注册反复失效（2026-09-09 复盘）**：多会话并发时，其他会话的 `git worktree prune` 或清理脚本会移除 `<repo>/.git/worktrees/<name>` 注册，导致 worktree 半失效（`git -C <worktree> status` 报 `not a git repository: (NULL)`，但物理目录和 node_modules 还在）。**无法复用失效 worktree**（`git worktree add` 到已存在目录会报 "already exists" 或误绑到父级仓库）。可靠做法：**新建全新 worktree**（新目录名）→ `pnpm install --frozen-lockfile`（复用 store 约 1 分钟）→ `node scripts/ensure-electron.js` → `node scripts/verify-worktree-deps.js` → 启动。⚠️ 若目标目录位于另一 git 仓库（如 `D:/Data/projects` 本身是仓库）内，`git worktree add` 到已存在目录会误绑到父级仓库，务必用全新目录名。
- **同步失败即停**：代码未对齐时不要启动，否则跑的是旧代码。
- **git 写操作走 PowerShell 原生路径**：避免 Git Bash `/d/...` 触发 `D:/d/...` 混写（项目硬纪律）。
- **WSL/Windows 数据分裂（双环境核心坑）**：项目 node_modules 是 Windows 版，WSL 端必须用独立 Linux 依赖树（`~/mp-wsl-deps/mp-wsl`）；electron 必须显式 `--user-data-dir` 指向共享目录（Linux worktree 上溯不到共享主仓库锚点）；**默认不要设 `ELECTRON_USER_DATA_DIR`**（显式值会绕过共享目录）。
- **WSL /tmp 是 tmpfs**：`/tmp/mp-electron`、`/tmp/electron-libs`、`/tmp/mp-wsl-profile` 都是临时方案，WSL 重启即清空。持久方案是 `~/mp-wsl-deps/`（electron-libs 库 + mp-wsl worktree）。
- **Codex 执行环境转义坑（2026-09-13 实测）**：在 Codex exec/fastctx 的 bash 里跑 PowerShell 命令时，`$` 变量（如 `$worktree`、`$_`、`$LASTEXITCODE`）会被 bash 展开为空，导致「变量为 null」「空管道」等诡异错误。**可靠做法**：① 复杂 PowerShell 一律写成 `.ps1` 文件再 `powershell -File` 执行；② 写 .ps1 用 bash heredoc（`cat > file << 'EOF'`），**不要用 apply_patch**——apply_patch 会转义 `\t` 等序列（路径 `C:\tmp\...` 变成 `C:	mp...`）且可能引入 BOM；③ 脚本保持纯 ASCII（无中文注释），避免 PowerShell 5.1 解析异常。
- **PYTHON_PATH 不是解释器（PR #1866 引入的致命 bug，2026-09-16 复盘）**：bridge 解析 Python 解释器时 `process.env.MP_PYTHON || process.env.PYTHON_PATH || 'python'` 把 `PYTHON_PATH`（Python 模块搜索路径，值是目录）当 exe → spawn 目录 → `ENOENT`，所有 Python 服务崩溃、主后端起不来。修复：仅 `MP_PYTHON` 覆盖 + 回退 `python`/`python3`（已落 `base-python-bridge.js` / `python-bridge.js` / `prompt-bridge.js` / `asset-generator.js`，Grep 仅注释含 `PYTHON_PATH`）。预防：① 启动前诊断 `where python` 与 env `PYTHON_PATH`/`MP_PYTHON`；② CI 加门禁——任何 bridge 不得把 `PYTHON_PATH` 当解释器路径。
- **孤儿 Python 后端占端口（Windows Stop-Process 不杀孙进程，2026-09-16 复盘）**：`Stop-Process -Force` 只杀目标进程、不杀其经 `execFile` 拉起的 Python 后端（everos/uvicorn）。electron 被强杀后这些后端存活并占着派生端口 → 新实例 bridge 端口冲突（`EADDRINUSE`）→ `not_started`。预防：停 electron 后**级联清理本 worktree 的 backend python 进程**（按端口/命令行匹配 everos/uvicorn），不要只杀 electron。
- **启动失败但无可见错误（WMI 脱离会话吞 stderr，2026-09-16 复盘）**：经 WMI `Win32_Process.Create` 拉起的启动器，stdout/stderr 不回传调用方。若 `start-desktop.ps1` 中途 fail-closed（如 git 校验失败），错误被吞，表现就是「没起来也没报错」。诊断：① 先 `git -C <wt> rev-parse --git-dir` 确认 worktree 未失联；② 直启 `dev.js` 并前台跑一次看报错；③ 查 `%TEMP%\mp-start-dev.err.log`。
- **worktree 注册失效致 start-desktop.ps1 不可用（2026-09-16 复盘）**：其他会话 `git worktree prune` 会移除 `.git/worktrees/<name>` 注册且可能删分支，导致 `git -C <wt> log -1` 返回空 → `start-desktop.ps1` fail-closed。此时 `start-desktop.ps1` 无法用。可靠替代：直启 `node apps/desktop/scripts/dev.js`（不依赖 git），env 设 `MP_VITE_PORT`/`MP_CDP_PORT`/`ELECTRON_USER_DATA_DIR`/`MP_PYTHON`/`MP_CDP_ALLOW_ALL_ORIGINS=1`；端口由 `dev-ports.js` 按路径派生（mp-start-app-win = vite 7364 / cdp 11412）。⚠️ `python` 必须解析到系统 3.12（前置 `C:\Users\邱领\AppData\Local\Programs\Python\Python312` 到 PATH，或显式 `MP_PYTHON` 指向它；**路径用 `$env:LOCALAPPDATA` 解析，不要字面写中文用户名，否则 GBK 乱码→ENOENT，见「启动器脚本必须纯 ASCII」**），否则托管 3.13 缺 uvicorn/pydantic/splitter → 导入即崩。
- **CDP 验证必须带 allow-origins 开关（2026-09-16）**：外部 CDP 客户端（WorkBuddy / Python 诊断脚本）连 DevTools WebSocket 需 `--remote-allow-origins=*`，否则 403。dev-launcher.js 已加 `MP_CDP_ALLOW_ALL_ORIGINS` 开关（默认关，显式设 1 才附加 `--remote-allow-origins=*`）。启动器脚本内 `$env:MP_CDP_ALLOW_ALL_ORIGINS='1'` 才能经 CDP 拉 `servicesGetStatus()`/`listAccounts()`/`identityGetState()`。
- **主服务 = mainBackend（端口 8299）**：`servicesGetStatus()` 返回的 6 服务中，`mainBackend` 是主服务（承载账号/后端 API 的核心）。其 `not_started` 直接导致 `listAccounts()` 报 "Python backend is not running"（账号缺失表象=后端没起来）。完整清单：mainBackend(8299, 主服务)/splitterEngine(8002)/promptEngine(8013)/callbackServer(16521, running)/mediaServer(动态高端口, running)/alignerEngine(8004, on_demand)。账号数据在 `ELECTRON_USER_DATA_DIR/backend-data/accounts.json`；切换 profile 必须复制该目录（见「profile 数据分裂」坑）。
- **单一事实源**：逻辑修改只改本文件；各 agent 入口只做「指向本文件 + 执行要点」，不要各自维护重复逻辑。
