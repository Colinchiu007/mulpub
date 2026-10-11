---
record: shared-root-path-case-fix
task: 共享根脚本路径引用大小写收口（Mulpub/Multi-Publish → mulpub）+ 补回被吞掉的 3 个 .ps1 UTF-8 BOM
date: 2026-10-11
---

## 本次执行记录：共享根脚本路径大小写收口与 .ps1 BOM 补回（shared-root-path-case-fix，2026-10-11）

> 共享根 `D:\Data\projects\mulpub` 就地进行（本批属「流程/脚本类」，按分层策略允许就地编辑 + PR 落地）；未进隔离 worktree，原因是**这批改动原本就在共享根工作区里**，且它阻塞了 `start-mp-task.ps1` / `scripts/session-init.sh` 的 worktree 创建（`主目录 main 存在未提交文件，拒绝创建任务 worktree`，rc=2）。

### 一、这批改动是什么（逐行核对结论）

13 个文件、35 增 35 删，**没有任何语义性改动**，只有两类：

1. **路径引用大小写收口**：`D:\Data\projects\mulpub` / `Multi-Publish` → `D:\Data\projects\mulpub`，落在 12 个 `scripts/*` 与 `.agents/skills/start-app/SKILL.md`。与历史提交 `bfaeb053e`「共享根目录引用从 Multi-Publish 收口到 Mulpub」同族的未完成尾巴（仓库目录实际是小写 `mulpub`）。
2. **3 处只差一个 UTF-8 BOM**（`git diff` 里表现为 `-﻿#` → `+#`）：`scripts/start-desktop.ps1`、`scripts/deploy-skill-to-github.ps1`、`scripts/mp-capture.ps1`。

**归属与处置（诚实记录）**：这批改动**不是本会话的原始工作**，是另一会话在共享根的就地编辑（文件 mtime 13:20–13:34），**没有任何分支/提交包含它**（`git log --all` 对 13 个文件均无命中）。两个官方隔离入口都因此拒绝建 worktree。经用户明确授权，本会话按**最小动作代为收口**：内容逐字保留，只补回被吞掉的 3 个 BOM。写入特征（只吞 BOM、正文逐字节不变）符合「pwsh7 `Set-Content` / UTF-8-no-BOM 写入」或编辑器默认编码所致。

**为什么 BOM 必须补**（不改会被 CI 当场判红）：CI 同口径 `node .github/scripts/check-ps1-bom.js` 在补 BOM 前实测 **FAIL 3/51**：

```
missing-bom  nonASCII= 3498  scripts/start-desktop.ps1
missing-bom  nonASCII=  258  scripts/deploy-skill-to-github.ps1
missing-bom  nonASCII=   84  scripts/mp-capture.ps1
```

无 BOM 的 `.ps1` 在 Windows PowerShell 5.1（本仓所有 `.ps1` 入口的实际宿主）下按 ANSI 码页解码，轻则中文变问号，重则整脚本 tokenize 失败 —— 该门禁头注释记录的事故正是 `start-mp-task.ps1` 因一行中文 `throw` 而 ParserError，导致**所有新的隔离 worktree 都开不出来**。

### 二、验证

| 门禁 | 状态 | Fresh 证据 |
| ---- | ---- | ---------- |
| 编码门禁（CI 同口径） | PASS | 补 BOM 前 `check-ps1-bom.js` FAIL 3/51（上列三行）→ 补 3 字节前缀后 **OK：51 个 tracked .ps1 全部守约**（含非 ASCII 者均恰好带一个 BOM，正文合法 UTF-8） |
| 正文逐字节不变（自证） | PASS | 对 3 个文件做 `Buffer.compare(原文, 新文.subarray(3)) === 0` ⇒ `true`；size 增量恰好 +3（19016→19019 / 1754→1757 / 4908→4911） |
| 语法解析 | PASS | 11 个改动 `.ps1` 逐个 `[Parser]::ParseFile` ⇒ parse errors = 0；`scripts/start-desktop-wsl.sh` `bash -n` rc=0 |
| 覆盖测试 | PASS | `node --test .github/scripts/check-ps1-bom.test.js scripts/start-mp-task.test.js scripts/safe-delete.test.js` ⇒ **32 passed / 0 failed**；`node --test apps/desktop/scripts/dev-ports.test.js dev-launcher.test.js dev-exit-log.test.js` ⇒ **35 passed / 0 failed** |
| 行尾/编码对账 | PASS | `git diff --numstat` 与 `git diff --ignore-cr-at-eol --numstat` 逐文件完全一致（无 EOL churn） |
| 改动范围 | PASS | `git diff --name-only` 恰好 13 个文件（与代收口前快照一致；未混入其他路径） |
| 上游对账 | PASS | 收口前 `git log HEAD..origin/main` 3 提交与这 13 个文件**零重叠** ⇒ 就地 `git merge --ff-only origin/main` 后才提交，避免 PR 反向撤销上游改动 |
| 前置快照 | PASS | 13 文件 sha256 快照留存 `%TEMP%\batch-before-hashes.txt`；`git status --porcelain` 基线留存 `%TEMP%\sharedroot-before.txt` |

### 三、远程同步

| 项目 | 状态 | 取证与回填要求 |
| ---- | ---- | ---- |
| 远程同步 | PASS | PR #3312 已 squash 合并为 `8138702cd6cdc7f65e1f42cee4988ba4c86ed3bd`（2026-10-11T16:19:31+08:00）；取证：`git log origin/main --grep="(#3312)$" --format=%H|%cI` 恰好 1 行且 SHA 相同、`git ls-remote --heads origin shared-root-path-case-fix` = 0 行。本行、`.quality-gates.md` 同名记录两处、frontmatter 的 `sync_*` 三字段与 `scripts/gate-record-debt-ledger.json` 的登记项在**同一次提交**收口 |

### 四、边界与未闭合（诚实记录）

- 该批改动的**原始意图未由原作者确认**：按「逐行核对只含路径大小写 + BOM 差异」判定为纯机械收口；若原作者本意还包含其他未落盘的编辑，本提交不含它们（无证据表明存在）。
- 收口期间若原作者会话仍在写同一批文件，存在撞车风险；本会话在提交前做了 13 文件 sha256 快照，提交后可与分支内容逐字节对账（`git diff --stat <branch> origin/main` 仅这 13 个文件）。
- `scripts/applive-foreign-audit.test.ps1` 属需要真实应用环境的测试脚本，本会话未跑（无 app 实例）；只做了语法解析校验。
