---
record: bf-auth-sync
task: 回填 #3651 远程同步 PASS + merge SHA，并登记本轮两处严重失误
date: 2026-10-15
---

## 本次执行记录：回填 #3651 远程同步 PASS + merge SHA，并销账（bf-auth-sync）【docs-only】

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | PASS | 纯文档/流程（`openspec/records/`）⇒ 共享根就地编辑 + PR 落地；开写前先 `git merge --ff-only origin/main` |
| 判定证据 | PASS | `node scripts/classify-docs-only.js --base=origin/main --head=HEAD`（commit 后取证） |
| 回填内容 | PASS | `openspec/records/bf-auth.md`：远程同步**两形态同时**改写为 PASS + merge SHA `43f621feaaa96f17fd55a6b672e74411a3a3bcca`（PR #3651 @ 2026-10-15T13:53:07Z），并删除 frontmatter 的 `sync_*` 三字段 |
| 销账 | PASS | `bf-auth.md` 是**文件源**记录 ⇒ 登记随文件走（`sync_reason`/`sync_backfill_owner` 两字段），删除这两个字段即销账；本笔未新增 ledger 键（ledger 标题键只服务 `.quality-gates.md` 源，见 `check-gate-record-debt.js` L284 与「登记随文件走」） |
| ⚠️ **严重失误 1：误把整份旧文件当冲突解**（如实登记） | 已修 | `bf-auth` 的 rebase 冲突里我对 `.quality-gates.md` 用了 `git checkout --theirs` —— 在 rebase 中 `--theirs` 是**被重放提交的整份文件**，它基于旧主干，取它等于**反向撤销上游新记录**（AGENTS.md 明令禁止的「后推覆盖」）。**检测**：`git diff origin/main -- <文件>` 与 `git show origin/main:<文件>` 的 `## ` 标题集求差 ⇒ 实测**缺 0 个**（本次未造成实际丢失），但方法本身是错的。**正解**：取 `--ours`（= 新基底）后**重放本笔的定点改动**（脚本 `D:\Temp\replay-qg-auth.js`） |
| ⚠️ **严重失误 2：批量改写他人 139 行记录**（如实登记） | 已回滚 | 为修「前缀替换留下的残留单元格」，我写了一个**跨文件通配**的清理脚本，它匹配了 `.quality-gates.md` 里**所有** `\| 远程同步 \| PASS \|` 超长行并剥掉尾格 —— **139 行属其他会话的记录**，我只该动自己那 1 行。**检测**：脚本自报「共修 140 行」，而本笔只应改 1 行。**回滚**：`git checkout HEAD -- <文件>` 撤销全部误改，改为**按自己的 SHA（`698090ac`）精确定位单行**，并断言命中数 === 1。**教训**：跨会话共享的热点文件上，任何「批量/通配」清理都不得存在——判据与动作必须都收敛到**本笔自己的标识** |
| ⚠️ 失误 3：前缀替换留下残留单元格 | 已修 | 首版回填用 `^\|\s*远程同步\s*\|\s*PENDING\s*\|` 只替换行**前缀**，旧行尾被拼在新行后（多出一个陈旧单元格）。正解是**整行替换**并断言「PASS 行不再含未收口措辞」 |
| ⚠️ 失误 4：`--continue` 的失败被取证方式掩盖 | 已修 | 首次 `git rebase --continue` 实际未成功（冲突仍在、rebase 未结束），而我把输出用 `Select-Object -Last 1` 截断后读成「成功」。**教训**：判 rebase 成败**不得只看截断输出**，必须查 `<git-dir>/rebase-merge` 是否仍存在 + `git status` 是否仍有 `UU` + `HEAD` 与意图差异是否一致 |
| 反证 | N/A | 纯文档改写；本体反证见 #3642（五处变异在 fastapi 0.143.1 下 ⇒ 6/2/1/5/5 条变红 + 字节级还原） |
| 行尾对账 | PASS | 两口径 `numstat` 一致 |
| 品牌残留 | PASS | `node scripts/check-no-brand-residue.js` |
| QM-1 / QM-2 / QM-4 视觉 / TDD | N/A | docs-only 通道：与运行时无关 |
| QM-6 双模型外部评审 | 未执行 | 本机无 `codeagent-wrapper`，如实登记（docs-only 通道本不要求） |
| 远程同步 | PASS | PR #3661 已 squash 合并，merge SHA `c1ff0a55658a115cc57ce2f0974966447d04b915`（2026-10-15T15:13:05Z）；远端分支已删 | 本回填 PR 自身；合并后就地改写为 `PASS` + merge SHA（同次销账） |

- 保留门禁：行尾对账 ✅ | 品牌残留 ✅ | 文档同步 ✅ | 远程同步 PASS
