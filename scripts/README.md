# scripts/ 目录说明

## 会话隔离基础设施

| 脚本 | 用途 |
|------|------|
| `start-mp-task.ps1` | 运行时代码任务入口，创建独立 worktree |
| `session-init.sh` | 会话初始化（Git Bash） |
| `session-guard.ps1` | 分支守卫检查 |
| `session-cleanup.sh` | 会话清理 |
| `pre-code-edit-guard.ps1` | 代码编辑前守卫 |
| `launch-worktree.js` | Worktree 启动器 |
| `mp-worktree-health.ps1` | Worktree 健康检查 |
| `safe-worktree-remove.ps1` | 安全删除 worktree |
| `worktree-fs-longpath.ps1` | worktree 删除的长路径安全原语（`\\?\` 全深度枚举 / 删除 / robocopy 兜底） |
| `safe-restore-deleted.ps1` | 安全恢复已删除文件 |
| `verify-worktree-deps.js` | 验证 worktree 依赖 |
| `prepare-worktree-deps.ps1` | 准备 worktree 依赖 |
| `fix-worktree-node-modules.sh` | 修复 worktree node_modules |
| `install-session-isolation-task.ps1` | 安装会话隔离计划任务 |
| `install-git-hooks.ps1` | 安装 Git hooks |
| `bootstrap-write-guard.ps1` | 引导写保护守卫 |
| `guard-shared-root-writes.ps1` | 共享根目录写保护 |

## 质量门禁 / CI

| 脚本 | 用途 |
|------|------|
| `check-debt-budget.js` | 债务熔断检查（6 指标基线） |
| `debt-baseline.json` | 债务基线数据 |
| `ipc-manifest-registrar.js` | IPC 通道双向校验 |
| `check-docs-sync.sh` | 文档同步检查 |
| `openspec-sync-check.js` | OpenSpec 同步检查 |
| `quality-rhythm-wrapper.js` | 质量节拍 pre-commit hook |
| `run-package-install.js` | 包安装脚本 |

## 桌面应用

| 脚本 | 用途 |
|------|------|
| `start-desktop.ps1` | 启动桌面应用 |
| `start-desktop-identity.js` | 桌面身份启动 |
| `desktop-profile-lock.ps1` | 桌面 Profile 锁定 |
| `ensure-desktop-deps.js` | 确保桌面依赖 |
| `ensure-electron.js` | 确保 Electron 二进制 |

## 工具

| 脚本 | 用途 |
|------|------|
| `deploy-skill-to-github.ps1` | 部署 Skill 到 GitHub |
| `draft-changelog.sh` | 生成 CHANGELOG 草稿 |
| `affected-report.js` | 受影响文件报告 |
| `gwm-task.sh` | GWM 任务脚本 |

## 前端工具（Mp）

| 脚本 | 用途 |
|------|------|
| `mp-all.ps1` | 全量操作 |
| `mp-auto.ps1` | 自动操作 |
| `mp-capture.ps1` | 截图捕获 |
| `mp-fix.ps1` | 修复操作 |
| `mp.cs` | C# 辅助工具 |

## 测试

| 脚本 | 用途 |
|------|------|
| `session-guard.test.ps1` | 会话守卫测试 |
| `session-init.test.sh` | 会话初始化测试 |
| `session-isolation-automation.test.ps1` | 会话隔离自动化测试 |
| `session-write-guard.test.ps1` | 写保护测试 |
| `start-desktop-profile-lock.test.ps1` | 桌面 Profile 锁测试 |
| `worktree-fs-longpath.test.ps1` | 长路径枚举、递归删除与移除决策的回归测试（PowerShell 5.1） |
| `ensure-desktop-deps.test.js` | 桌面依赖测试 |
| `openspec-sync-check.test.js` | OpenSpec 同步检查测试 |
| `hooks/pre-commit.test.sh` | Pre-commit hook 测试 |
| `hooks/post-checkout.test.sh` | Post-checkout hook 测试 |

## 其他

| 脚本 | 用途 |
|------|------|
| `hooks/pre-commit` | Git pre-commit hook |
| `hooks/post-checkout` | Git post-checkout hook |
| `film-engineering/fetch-hell-grind-kit.py` | 影视工程素材获取 |
