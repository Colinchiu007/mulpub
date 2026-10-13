---
record: ops-menu-learnings
task: 运营中心「应用菜单」改完不生效的教训沉淀
date: 2026-10-14
sync_status: PENDING
sync_reason: 本 PR 尚未合并，merge SHA 还不存在
sync_backfill_owner: 下一个会话
---

## 本次执行记录：运营中心「应用菜单」改完不生效的教训沉淀（ops-menu-learnings，2026-10-14）【docs-only】

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | PASS | 纯文档追加（`01-docs/learnings.md` + 本记录 + `.quality-gates.md` + ledger），按 AGENTS.md「纯流程/文档变更不需要独立 worktree，可在共享主工作区就地编辑，但同样必须经 PR 落地」执行；**开写前先 `git merge --ff-only origin/main`**（本地 main 当时落后 18 个提交），避免 docs PR 反向撤销已合并的行 |
| 第一性原因（QM-5 ①） | PASS | 本轮本体修复（PR #3513 / merge `4d777356d`）的根因是 `autoSyncOnStart()` 三道**静默早退**——判据没错（没配置不该硬发请求），错的是不发请求也不说为什么；配套的认知根因是「两个来源合并进 `url` 后失去区分度」，使「有自动地址缺令牌」伪装成「完全未配置」 |
| 逃逸分析（QM-5 ②） | PASS | 见 `01-docs/learnings.md` 新增 11 条：测试层（既有锁只锁「不调度」没锁「不出声」）、判据层（字段合并丢区分度）、观测层（成功与失败的话都没有 ⇒ 没跑到那里）、验收层（没有端到端判据回答「我的运营配置生效了没有」）。另有 4 条属**排查过程自身**的陷阱（推断未否证、重放复活欠账、常量名触发安全扫描、无 git 导出树误读），一并沉淀以免后人重走 |
| 修复 + 回归保护（QM-5 ④） | PASS | 本体已在 #3513 落地：判据外移到 `ops-center-sync-autosync-guard.js`（纯函数），出声留主文件；三种原因可区分；4 条回归锁同时钉「不调度」与「出声且原因可区分」（含 `not.toContain` 反向断言）；变异反证（出声口改回静默 ⇒ 4 条全红，还原 ⇒ 79/79）。本笔只做**记忆沉淀**，不改任何代码 |
| 防止再次发生（QM-5 ⑤） | PASS | ①**内置记忆**：`01-docs/learnings.md` 追加 11 条（`### <类别>:<slug>` 形态，与文件既有约定一致）；②**外部记忆**：`~/.gstack/projects/multi-publish/learnings.jsonl` 263 → 274 行；③**EverOS**：session `dsh-ops-menu-diag-20261014`，add 11/11 `accumulated`、flush `extracted`；④可迁移判据已逐条写成「问句」形态（如「它不说话时谁会知道」「这条配置在历史里存在过吗」「导出树里判红先问这条判据需要 git 吗」），便于下次直接套用 |
| 反证 | N/A | 纯文档追加，无代码行为可变异；本体反证见 #3513 |
| 编码与行尾 | PASS | 两口径 `numstat` 一致（无行尾噪音）；`check-gate-record-debt.js` rc=0（记录带登记三字段、表格行 + bullet 两形态同写） |
| QM-1 / QM-4 | N/A | 未触 `apps/desktop/electron/` 与渲染层 |
| QM-6 双模型外部评审 | 未执行 | 本机无 `codeagent-wrapper`，如实登记 |
| 远程同步 | PENDING | 待本 PR 合并后回填 merge SHA 并销账（回填与销账同次提交） |

- 保留门禁：行尾对账 ✅ | 品牌残留 ✅ | 文档同步 ✅ | 远程同步 PENDING

### 备注

本笔是 PR #3513 的本体修复所**附带**的排查过程沉淀。除 7 条与缺陷本身同族的教训外，另有 4 条属
**排查过程自身**的陷阱，其中两条是我这一轮实际犯下的：

- 「据 27 字符私钥推断占位串」—— 被一次实测否证，**未据此改任何代码**；
- 「`tar` 导出树里 `check-pr-exec-record` rc=1」—— 误读为真失败，实际是那棵树没有 `.git`。

两条都记在案，不假装没发生。
