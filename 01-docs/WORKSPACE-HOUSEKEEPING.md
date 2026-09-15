# 工作区 / Worktree / 分支治理 SOP（2026-08-09 建立）

> 背景：2026-08-09 全面梳理后，回收 8 个 worktree、18 个本地分支、9 个远程分支，
> 并清理 C:\tmp 历史残留约 17.6GB（C 盘剩余从 7.9GB 恢复到 25.5GB）。
> 本文固化回收流程与目录约定，防止再次堆积。

## 一、Worktree 生命周期（四同步）

任务从合并到回收必须完成 **4 个同步动作**（合并 PR 后执行）：

1. **规格同步**：OpenSpec archive（openspec/changes → archive）
2. **CCG 归档**：`.ccg/tasks/<task>` → `.ccg/tasks/archive/<yyyy-mm>/`
3. **worktree 回收**：`git worktree remove <path>`（dirty 时先确认是行尾噪音/构建产物等可丢弃内容，再 `--force`；残留目录用 `rm -rf` 清理，路径必须已在 `git worktree list` 中解除注册）
4. **分支回收**：`git branch -d <branch>`（已合并）+ `git push origin --delete <branch>`（已合并 PR 的 head，删除前用 `gh pr list --state merged` 核对）

## 二、目录约定

| 位置 | 用途 | 生命周期 |
|------|------|---------|
| `D:\Data\projects\mp-worktrees\mp-<task>` | 隔离 worktree（D 盘，2026-08-12 起） | 合并后立即回收（四同步第 3 步） |
| `C:\tmp\multi-publish-tmp\<task>/` | 一次性调试产物/日志/临时 profile | 任务归档时连同删除 |
| `D:\tmp\Multi-Publish-debug-profile` | **已登录调试 profile**（含登录态；2026-08-14 从 C 盘迁移至 D 盘） | 永久保留，绝不删除 |
| `E:\Multi-Publish-builds\` | 打包/构建产物 | 旧版本构建（非当前 source）随版本归档清理 |
| `E:\Multi-Publish-builds\main-<sha>-source` | 注册 worktree（构建源） | 保留 |

## 三、清理判定规则

- **可回收**：分支已合并进 `origin/main`（`git branch --merged origin/main`）+ 无未推送提交（非 `ahead`）+ 远程 PR 已 merged。
- **保留**：`ahead`（本地有未推送提交）、并发会话当前分支、已登录 profile、验收证据（截图/报告目录，如 `mp-gui-e2e-ci-artifacts`、`worktree-evidence-backup-*`）、当前交付 worktree。
- **行尾噪音**：`packages/ai-writer/src/cli.js`、`packages/api-publish-engine/bin/publish-api` 等在所有 worktree 中恒为 `M` 的是 EOL 差异（非真实改动），归档时可直接丢弃；删除前用 `git diff` 确认。

## 四、磁盘告警

- worktree 一律建在 D 盘 `D:\Data\projects\mp-worktrees\`（禁止 C 盘）；C 盘剩余 < 10GB 时执行一次全量清理（历史 `C:\tmp` 残留 + 临时产物）。
- **C:\Users 缓存（2026-08-09 实测）**：`AppData\Local\npm-cache`（约 3.5GB，可 `npm cache clean --force` 但会拖慢下次 install）、`AppData\Local\electron\Cache`（约 1.2GB Chromium 缓存，可清）、`AppData\Local\fnm_multishells`（每启动一次 dev 产生一组残留，可全清）、`AppData\Local\Temp` 下历史 `multi-publish-asar-*`/`s2v-verify-*` 产物（约 1GB）；**保留**运行中应用的 `Temp\story2video`。
- 打包产物默认落 `E:\Multi-Publish-builds`，不堆 C 盘。

## 五、启动脚本与已知环境差异

- **启动脚本**：`scripts/launch-worktree.js`（收编自 `C:\tmp\launch-worktree-4k.js`）——以指定 worktree + 已登录 profile 启动桌面应用；参数 `--worktree/--profile/--cdp/--backend-port/--prompt-port/--splitter-port/--dev-server-port/--callback-port/--env-file`；macOS 前瞻（electron 可执行路径按平台解析）。用法：`node scripts/launch-worktree.js --env-file /d/Data/projects/prompt-engine/.env`。
- **worktree node_modules 独立化（2026-08-09 已根治）**：交付 worktree 曾以 junction 指向主仓库 node_modules，导致 `@multi-publish/ai-writer` 解析到主仓库副本、`ai-writer-flow` 的 `instanceof AiWriter` 本地 1 例失败（主仓库/CI 全绿）。已执行 `scripts/fix-worktree-node-modules.sh`（停应用 → 删 junction → 独立 `npm install` → 验证解析指向本 worktree packages），本地全量测试恢复全绿（6673/6673）。**注意**：worktree 现持有独立 node_modules（约 1.3GB），不再共享主仓库依赖；若某 worktree 又出现 junction（如被旧脚本重建），用同一脚本再根治即可。

## 六、常用命令

```bash
# 盘点
git worktree list
git branch --merged origin/main        # 可回收本地分支
git branch -r                          # 远程分支
gh pr list --state merged --limit 60 --json number,headRefName   # 已合并 PR 的 head

# 回收（示例）
git worktree remove --force D:/Data/projects/mp-worktrees/mp-<task>
git branch -d codex/<task>
git push origin --delete codex/<task>
```
