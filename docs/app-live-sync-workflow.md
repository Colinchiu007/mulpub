# 一键启动工作流（sync-app）说明

> 2026-09-19 新增。配套脚本：`scripts/sync-app.ps1`、`scripts/mp-applive-launcher.ps1`。
> 完整操作手册见 `.agents/skills/start-app/SKILL.md`（v1.6.0「一键启动工作流」节）。

## 背景与目标

每次用最新代码重启桌面应用时，此前需要：重新找依赖（worktree 重建后 `pnpm install`）、
重新定位登录态与数据库文件（profile 目录漂移）。本工作流将这两类成本归零：

1. **登录态/数据库持久化**：固定使用仓库根 `shared-user-data/` 锚点（已 gitignore），
   `startup-compat.js` 自动检测；运行 worktree 重建不影响数据。
2. **依赖持久化**：固定持久运行 worktree `mp-worktrees/mp-app-live2`，`node_modules`
   保留；仅当 `pnpm-lock.yaml` SHA256 变化时才重装依赖（锁文件哈希门禁）。

## 脚本职责

| 脚本 | 职责 |
|------|------|
| `scripts/sync-app.ps1` | 同步+启动编排：仓库根解析 → worktree 健康检查 → fetch origin/main →（默认）`checkout -f origin/main` + `clean -fd` /（`-Safe`）撕裂自愈 → 锁文件哈希门禁装依赖 → `ensure-electron.js` → 启动 launcher |
| `scripts/mp-applive-launcher.ps1` | 脱离会话启动：自定位 node（PATH 或托管 22.22.2）/python（系统 3.12）→ `dev-ports.js` 按路径派生端口 → 停同 worktree 旧 electron → 设 `MP_VITE_PORT`/`MP_CDP_PORT`/`ELECTRON_USER_DATA_DIR`（指向 shared-user-data）/`MP_PYTHON`/`MP_CDP_ALLOW_ALL_ORIGINS=1` → WMI `Invoke-CimMethod Win32_Process.Create` 拉起 `node scripts/dev.js`（脱离 agent 会话，WMI 不可用回退 `Start-Process`）→ 轮询 150s 等可见窗口 |

## 用法

```powershell
# 完整：同步 + 启动（普通终端执行；agent 沙箱内禁跑整树重写）
powershell -ExecutionPolicy Bypass -File scripts/sync-app.ps1

# 只同步不启动
powershell -ExecutionPolicy Bypass -File scripts/sync-app.ps1 -PrepareOnly

# 安全模式：fetch + 自愈 + 依赖门禁（无人值守自动化专用，不重写工作树）
powershell -ExecutionPolicy Bypass -File scripts/sync-app.ps1 -Safe
```

## 关键设计决策

1. **WMI 启动而非 `Start-Process`**：`Start-Process` 的子进程绑定在父 PowerShell
   会话，agent 会话/后台 job 退出会连带杀掉 electron。WMI
   `Invoke-CimMethod Win32_Process.Create`（注意：不是 `Get-WmiObject` 的
   `Create`，后者在部分会话返回反序列化对象无该方法）让进程由 WMI 服务托管，
   真正脱离父会话。WMI 不可用时回退 `Start-Process`（普通终端场景足够）。
2. **锁文件哈希门禁**：`pnpm-lock.yaml` 的 SHA256 存于
   `%TEMP%\mp-applive-lockhash-<worktree-leaf>`；仅当哈希变化或 `node_modules`
   缺失时执行 `pnpm install --frozen-lockfile`，避免每次启动重装。
3. **`-Safe` 模式**：agent 沙箱会静默中断「整树重写」类 git 写（`checkout -f
   origin/main`、`reset --hard`），导致 worktree 撕裂（`index.lock` 残留 + 大量
   假删除）。`-Safe` 只做 fetch + 撕裂自愈（`checkout HEAD -- .`）+ 依赖门禁，
   供每日自动化（04:00）安全运行。
4. **纯 ASCII 脚本**：两个 `.ps1` 均为纯 ASCII 无 BOM，规避 PowerShell 5.1 在
   中文系统按 GBK 解析 UTF-8 字面量导致的路径乱码/变量吞没问题；中文用户名
   路径一律经 `$env:USERPROFILE` / `$env:LOCALAPPDATA` 变量解析。

## 撕裂恢复（runbook）

worktree 被撕裂（`git status` 大量 ` D `、HEAD 未动）时：

```bash
# 1. 删除 worktree gitdir 的锁（注意不是 worktree 内 .git/index.lock）
rm -f /d/Data/projects/Multi-Publish/.git/worktrees/<name>/index.lock
# 2. 进入 worktree 用相对路径恢复
cd /d/Data/projects/mp-worktrees/<name>
git checkout HEAD -- .
# 3. 复验
git status --porcelain | wc -l   # 应为 0
```
