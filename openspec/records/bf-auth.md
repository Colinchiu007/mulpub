---
record: bf-auth
task: 回填 #3642 与 #3647 的远程同步 PASS + merge SHA，并销账
date: 2026-10-15
sync_status: PENDING
sync_reason: 本回填 PR 尚未合并，merge SHA 还不存在
sync_backfill_owner: 下一个会话
---

## 本次执行记录：回填 #3642 与 #3647 远程同步 PASS + merge SHA，并销账（bf-auth）【docs-only】

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | PASS | 纯文档/流程（`openspec/records/` + `.quality-gates.md` + `scripts/gate-record-debt-ledger.json`）⇒ 共享根就地编辑 + PR 落地；开写前已 `git merge --ff-only origin/main` |
| 判定证据 | PASS | `node scripts/classify-docs-only.js --base=origin/main --head=HEAD`（commit 后取证） |
| 回填内容 | PASS | ① `openspec/records/auth-single-source.md`：远程同步**两形态同时**改写为 PASS + merge SHA `fccee8c26ddd3839845b7f83c0911461e894fd7c`（PR #3642 @ 2026-10-15T12:37:25Z），并删除 frontmatter 的 `sync_*` 三字段；② `.quality-gates.md` 的 auth-learnings 记录：两形态同时改写为 PASS + merge SHA `698090ac358fde62750f31713683e7b34035b162`（PR #3647 @ 2026-10-15T12:01:50Z） |
| 销账 | PASS | 删除 `scripts/gate-record-debt-ledger.json` 中 auth-learnings 的登记项，并在**同一次提交**登记本回填 PR（回填与销账不得分两次） |
| ⚠️ 回填脚本自身的缺陷（QM-5 ②，如实登记） | 已修 | 首版在**整段字符串**上用 `^` 却漏 `m` 标志 ⇒ `.replace()` 静默不改，而断言查的是「逐行 filter」⇒ **断言与替换查的不是同一件事**，脚本打印「已回填」但表格行仍是 PENDING。被 `check-gate-record-debt.test.js` 的 Gate 2c（同篇两形态矛盾）当场判红（48 pass / 1 fail）。修法：两处都加 `m`，并在末尾断言「目标区域内不得再出现 PENDING」——**判据必须与动作同域** |
| ⚠️ 记录文件形态（QM-5 ②，如实登记） | 已修 | 首版 `bf-auth.md` 只有 frontmatter + 表格，缺 `sync_*` 三字段与 `## 本次执行记录：…` 标题 ⇒ 门禁报「bf-auth.md（缺登记字段）」。形态真源是既有 `bf-ops-dead.md`：三字段 + 与 ledger 键**逐字一致**的标题 |
| 反证 | N/A | 纯文档改写；本体反证见 #3642（**五处变异**在 fastapi 0.143.1 下 ⇒ 6/2/1/5/5 条变红 + 字节级还原） |
| 行尾对账 | PASS | `git diff --numstat` 与 `--ignore-cr-at-eol --numstat` 两口径一致 |
| 品牌残留 | PASS | `node scripts/check-no-brand-residue.js` |
| QM-1 / QM-2 / QM-4 视觉 / TDD | N/A | docs-only 通道：与运行时无关（无代码变更） |
| QM-6 双模型外部评审 | 未执行 | 本机无 `codeagent-wrapper`，如实登记（docs-only 通道本不要求） |
| 远程同步 | PENDING | 本回填 PR 自身；合并后就地改写为 `PASS` + merge SHA（同次销账） |

- 保留门禁：行尾对账 ✅ | 品牌残留 ✅ | 文档同步 ✅ | 远程同步 PENDING

### 备注

- 合并产物取证：`gh pr view 3642` → MERGED @ 2026-10-15T12:37:25Z；`gh pr view 3647` → MERGED @ 2026-10-15T12:01:50Z。
- `auth-single-source.md` 里原有**两处重复**的「### 保留门禁」段（编辑遗留）已合并为一处，避免 Gate 2c 的「同篇两形态互相矛盾」误判。
- 本轮 Track A 的 `QG Visual` 曾因 `prompt-eval` 视图 15s 就绪超时判红一次，**rebase 到最新主干后同一套件 pass** ⇒ 抖动（本笔零 `apps/` 变更，非本笔所致）。
- `check-gate-record-debt.js` 另报「旧载体 `.quality-gates.md` 同形态矛盾 7 处 — 属他人会话的记录块」为**可见项、不拦截**，按纪律不代改他人会话的记录。
