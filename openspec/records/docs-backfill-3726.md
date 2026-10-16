---
record: docs-backfill-3726
task: 回填 #3726 远程同步 PASS + 销账（知乎登录检测渲染崩溃修复）
date: 2026-10-16
---

## 本次执行记录：回填 #3726 远程同步 PASS + 销账（docs-backfill-3726，2026-10-16）【docs-only】

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | PASS | 纯文档/流程回填 ⇒ 允许就地编辑 + PR 落地。本轮在隔离 worktree 内完成（`mp-fix-zhihu-login-check`，改完 `git switch -c docs-backfill-3726 origin/main`） |
| 判定（docs-only） | PASS | `node scripts/classify-docs-only.js --base=origin/main --head=HEAD` ⇒ docs-only=true（`.quality-gates.md` 不带；`CHANGELOG.md` 不带；`01-docs/**` + `openspec/**` 命中白名单） |
| 第一性原因（QM-5 ①） | PASS | 本体 PR **#3726**（merge `3c861735584a7aad6e4380c81af0f51d19f9ce77`，2026-10-16T19:56:31+08:00）已合并。本体按「代码 PR 不带热点载体」纪律刻意不带 `CHANGELOG.md` / `01-docs/learnings.md`；BUGFIX 文档因 written-on-branch 后 rebase 丢失，本回填补落 |
| 逃逸分析（QM-5 ②） | PASS | 沿用已沉淀判据：①「远程同步」**两形态同写**（表格行 + bullet 以状态词收尾）；②**回填与销账同一次提交**；③状态列只写当下状态 |
| 修复 + 回归保护（QM-5 ④） | PASS | 同一次提交内四件事：① `openspec/records/fix-zhihu-login-check.md` 的「远程同步」表格行与 bullet 两形态同改为 PASS + merge SHA + main push run `38897125739` success（收尾规矩 7），并**删除 frontmatter 的 `sync_*` 三字段**；② `01-docs/BUGFIX-ZHIHU-LOGIN-CHECK-2026-10-16.md` 落地（完整证据链 + runbook）；③ `01-docs/learnings.md` 顶部追加本轮教训；④ 本记录自身。远端分支已删（`git ls-remote --heads` = 0 行） |
| 防止再次发生（QM-5 ⑤） | PASS | 本体已是**机械锁**（6 例回归锁接 CI + 两道变异反证指名红）；本回填把「HTTP 检测不确定 ⇒ 开隐藏窗口是崩溃面」的教训沉淀进 learnings，新增平台登记 HTTP_CHECK_APIS 时必须给判定函数或入白名单 |
| 反证 | N/A | 纯文档改写；本体反证见 #3726（M1 白名单移除 ⇒ 1 红；M2 checkHtml 恒 undefined ⇒ 2 红） |
| 编码与行尾 | PASS | `git diff --numstat` 与 `--ignore-cr-at-eol --numstat` 两口径一致 |
| QM-1 / QM-4 | N/A | 未触生产代码与渲染层 |
| QM-6 双模型外部评审 | 未执行 | 纯文档回填；通道本身豁免。本体已如实登记 PENDING，不以自审冒充通过 |
| 记录欠账 | PASS | `check-gate-record-debt.js` ⇒ OK；`check-record-qm5-rows.js` ⇒ OK |
| 远程同步 | PASS | 本体 #3726 squash 合并 merge SHA `3c861735584a7aad6e4380c81af0f51d19f9ce77`（2026-10-16T19:56:31+08:00）；远端分支 `fix-zhihu-login-check` 已删（`git ls-remote --heads` 0 行）；main push run `38897125739` **success**（收尾规矩 7）。本回填 PR 自身的远程同步在合并后由后续 docs PR 收口 |

- 保留门禁：判定 docs-only=true ✅ | 行尾对账 ✅ | 品牌残留 ✅ | 文档同步 ✅ | 记录欠账 ✅ | 远程同步 PASS（#3726 merge `3c861735`，远端分支已删）
