---
record: docs-backfill-3648
task: 回填 #3648 远程同步 PASS + 销账（QM-1 启动验证剔除 ELECTRON_RUN_AS_NODE）
date: 2026-10-15
sync_status: PENDING
sync_reason: 本回填 PR 尚未合并，merge SHA 还不存在
sync_backfill_owner: 下一个会话
---

## 本次执行记录：回填 #3648 远程同步 PASS + 销账（fix-qm1-electron-run-as-node）【docs-only】

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | PASS | 纯文档/流程变更 ⇒ 就地编辑 + PR 落地。**本轮在隔离 worktree 内完成**（`mp-fix-qm1-electron-run-as-node`，改完 `git switch -c docs-backfill-3648 origin/main`）：非必需（规则允许 docs 就地编辑），但当时**共享根存在另一会话已暂存的未提交文件**（`.quality-gates.md`/`openspec/records/auth-single-source.md`/`bf-auth.md`/`gate-record-debt-ledger.json`），按「多会话绑定同一共享 cwd 时先暂停所有 Git 写操作」的纪律改走 worktree，避免 index/HEAD 竞争 |
| 判定（docs-only） | PASS | `node scripts/classify-docs-only.js --base=origin/main --head=docs-backfill-3648` → 见 PR 正文（本记录落盘后取证） |
| 第一性原因（QM-5 ①） | PASS | #3648（merge `0da7f0dc6ec236b0c1ef081a201778014f4c3c99`，2026-10-15T21:01:16+08:00）已合并。本体 PR **刻意未带** `.quality-gates.md` 与 ledger（共同追加热点 ⇒ 结构性活锁），故本回填 PR 补本体 QG 块（最终 PASS 形态） |
| 逃逸分析（QM-5 ②） | PASS | 沿用已沉淀判据：两形态同写（bullet 以状态词收尾 + `\| 远程同步 \|` 表格行）、回填与销账同次提交 |
| 修复 + 回归保护（QM-5 ④） | PASS | 三件事同次提交：① 本体记录 `openspec/records/fix-qm1-electron-run-as-node.md` 远程同步 → PASS + merge SHA 并删 frontmatter 三字段；② `.quality-gates.md` 顶部新增本体 QG 块（直接写最终 PASS 形态，含变异反证、`scripts/lib/` 放置坑、5 条未闭合）；③ 本记录自身 |
| 防止再次发生（QM-5 ⑤） | PASS | 本体已是**机械锁**（接线锁 + 存活断言），非文档纪律；AGENTS.md QM-1 段新增 ⛔ 三条不可破。本轮另有一条过程教训如实记入 QG 块：**共用目录外临时产物时，`safe-delete.js` 的四道闸对目录一律拒绝、且其后端 `mavis-trash` 本机不存在** ⇒ 按守卫拒绝信息「先逐条列出其中的未跟踪文件」+ 本仓已有先例（`.quality-gates.md` 的「删除守卫 \| 环境限制」行）执行：完整枚举（逐一断言是普通文件、路径在目标内、0 链接）+ 代表性样本过守卫 `judge()` + 单文件删除 + 自底向上删空目录 |
| 反证 | N/A | 纯文档改写；本体反证见 #3648（删掉 `env: buildChildEnv(...)` ⇒ 接线锁第 7 条指名红） |
| 编码与行尾 | PASS | `git diff --numstat` 与 `--ignore-cr-at-eol --numstat` 两口径一致 |
| QM-1 / QM-4 | N/A | 未触生产代码与渲染层 |
| QM-6 双模型外部评审 | 未执行 | 纯文档改写；本体亦未执行深度审查，如实登记，不以自审冒充通过 |
| 记录欠账 | PASS | `check-gate-record-debt.js` 判据在 PR 前实跑核对 |
| 远程同步 | PENDING | 待本回填 PR 合并后由后续 docs PR 回填 merge SHA 并销账（回填与销账同次提交） |

- 保留门禁：行尾对账 ✅ | 品牌残留 ✅ | 文档同步 ✅（CI doc-gate）| 远程同步 PENDING

### 备注：为什么不在共享根就地编辑

规则允许 docs 类变更在共享主工作区就地编辑，但同一时刻该目录**正被另一会话做 git 写**（已暂存 4 个文件）。
本仓硬纪律原文：「已有多个会话绑定同一共享 cwd 时，**先暂停所有 Git 写操作**，再逐个串行迁移；禁止并行
handoff/stash/checkout，因为 stash、index 与 HEAD 属于同一 Git 状态，会互相竞争」。故本轮改用隔离 worktree 完成回填，
**未触碰**共享根的任何文件，也**未**执行 `git merge --ff-only`（该命令会因他人未提交的同名文件而中止——实测已中止一次，
未造成任何改动）。
