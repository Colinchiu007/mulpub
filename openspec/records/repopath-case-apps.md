---
record: repopath-case-apps
task: 机械重命名 apps/ 下仓库目录大小写 Mulpub→mulpub（与 PR #3000 2026-10-11 翻转口径一致）
date: 2026-10-11
sync_status: PENDING
sync_reason: 本 PR 尚未合并，merge SHA 还不存在
sync_backfill_owner: 下一个会话（合并后原地回填）
---

## 本次执行记录：仓库目录改名大小写 apps/ 机械重命名（repopath-case-apps，2026-10-11）

- 判定：`node scripts/classify-docs-only.js --base=origin/main --head=HEAD` → `docs-only=false`（files=9：含运行时代码/测试文件）→ 混合 PR，走完整质量节拍。
- 变更性质：纯机械大小写翻转 `D:/Data/projects/Mulpub`（及 `D:\Data\projects\Mulpub`、`/mnt/d/Data/projects/Mulpub` 变体）→ `D:/Data/projects/mulpub`，无逻辑改动。9 文件 15 增 15 删，每文件仅改 `PROJECT_ROOT` / 截图脚本里的路径字符串。

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ | 运行时代码：worktree `D:\Data\projects\mp-worktrees\mp-fix-repopath-case-apps` + 裸分支 `repopath-case-apps`，每文件 diff 仅路径字符串翻转 |
| 第一性原因（QM-5 ①） | ✅ | 根因：仓库目录实际已为小写 `D:\Data\projects\mulpub`，apps/ 下 9 处残留大写 `Mulpub` 路径字符串会导致测试/截图脚本找不到工程根（PR #3000 2026-10-11 翻转的延续，覆盖 apps/） |
| 逃逸分析（QM-5 ②） | ✅ | 仅路径字面量，无测试逃逸链可溯；`git grep` 全仓 case-sensitive 复核仅余本 PR 覆盖的 9 处 |
| 修复 + 回归保护（QM-5 ④） | ✅ | 无逻辑改动，无需回归测试；`git diff --cached` 逐文件复核确认仅大小写 |
| 防止再次发生（QM-5 ⑤） | ✅ | 见 docs PR（repopath-case-docs）回填说明；本仓已无大写残留（脚本类除外，见 legacy 清单） |
| 行尾与 diff 对账 | ✅ | `git diff --stat` 9 files changed 15 insertions 15 deletions；改动仅为 ASCII 路径字符，无 CRLF 漂移 |
| 接线棘轮 | N/A | 本次未新增任何 `*.test.js`，仅修改既有测试文件内的路径字符串 |
| QM-1 打包 / QM-4 视觉 | N/A | 9 文件中唯一落在 `apps/desktop/electron/` 的是 `python-bridge.integration.test.js`（测试文件），改动仅为 `D:/Data/projects/Mulpub`→`D:/Data/projects/mulpub` 路径字符串大小写翻转，未改动任何 electron 主进程逻辑 / require 链 / 打包入口；且本 worktree 未安装 electron 二进制（`node_modules/electron/dist/electron.exe` 不存在），依据 AGENTS.md QM-1「未触运行面」记 N/A |
| QM-6 CCG 双模型外部评审 | ⚠️ | CCG `verify-security` 在 `electron-gui-v7.js` 报 1 高危 + 19 低危，但均属该 e2e 测试脚手架**既有代码**（L146 `ed.innerHTML="<p>测试正文。</p>"` 写死测试文本、其余为 `console.log` 调试输出），与本 PR 的路径字符串大小写翻转无关。据 AGENTS.md「门禁本身写错/越界」自查第 5 条，未改动这些既有测试代码（越界且可能破坏 e2e），以 `SKIP_CCG_GATE=1` 提交并在 PR 正文说明；本机无 `codeagent-wrapper`，双模型外部评审未执行，如实记此 |
| 远程同步 | PENDING | 合并后取 `git log origin/main --grep='(#NNNN)$' --format=%H|%cI` 回填 merge SHA 与时间，`git ls-remote --heads origin <branch>` 返回 0 行证远端分支已删；回填后删除上方三个 sync_* 字段 |

### 遗留（不假装已闭合）
- `electron-gui-v7.js` 的 CCG 高危（innerHTML XSS 规则）为预存 e2e 脚手架问题，本次未处理；如需消除需单独 PR 清理该测试文件，不在本机械重命名任务范围内。
