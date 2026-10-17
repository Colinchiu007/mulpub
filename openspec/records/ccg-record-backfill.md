---
record: ccg-record-backfill
task: 回填 PR #3755 的远程同步（PASS + merge SHA）并更正 learnings 里「靠侥幸过门禁」的错误归因
date: 2026-10-17
sync_status: PENDING
sync_reason: 本回填 PR 尚未合并，它的 merge SHA 还不存在；远程同步这一行只能在合并后取
sync_backfill_owner: 下一个会话（按 AGENTS.md「合并后收尾清单」回填并删除本段三个字段）
---

## 本次执行记录：回填 #3755 远程同步 + 更正「侥幸」错误归因（ccg-record-backfill，2026-10-17）【docs-only】

判定证据：`node scripts/classify-docs-only.js --base=origin/main --head=HEAD` → **`docs-only=true`**。

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ | 纯文档/记录：在 worktree `mp-ccg-record-content-addressing` 的裸分支 `ccg-record-backfill` 上编辑，经 PR 落地。未触 `apps/` `packages/` `.github/` |
| 第一性原因（QM-5 ①） | ✅ | 见下「两件事」——回填欠的是**收尾链第 3 步**；learnings 欠的是**一次错误归因** |
| 逃逸分析（QM-5 ②） | ✅ | 见下「为什么当时没发现」 |
| 修复 + 回归保护（QM-5 ④） | ✅ | 记录行就地改写 + `sync_*` 三字段删除（同一次提交）；learnings 增判据而非只删错句 |
| 防止再次发生（QM-5 ⑤） | ✅ | learnings 新增机械判据：「凡写侥幸/碰巧/运气好，必须先去读判据源码确认是豁免还是漏网」 |
| 行尾与 diff 对账 | ✅ | `git diff --numstat` 与 `--ignore-cr-at-eol --numstat` 两口径**完全一致** |
| 接线棘轮 | N/A | 未新增 `*.test.js` |
| QM-1 打包 / QM-4 视觉 | N/A | 未触运行面（纯记录 + 文档） |
| QM-6 CCG 双模型外部评审 | 跳过 | `docs-only=true` 按「docs-only 快速通道」跳过 QM-6（本变更与运行时无关） |
| 远程同步 | PENDING | 合并后取 `git log origin/main --grep='(#NNNN)$' --format=%H\|%cI` 回填 merge SHA 与时间，`git ls-remote --heads origin <branch>` 返回 0 行证远端分支已删；回填后删除上方三个 `sync_*` 字段 |

### 两件事（都在这一笔里，各自欠的对象不同）

**① 回填 PR #3755 的远程同步。**
`openspec/records/ccg-record-content-addressing.md` 的 `| 远程同步 |` 行由 `PENDING` 就地改写为
`PASS` + merge SHA（`0386afdfcf739fbb39cca4bf05f56cd7732d4654`，2026-10-17T02:33:48+08:00），
并删除 frontmatter 的 `sync_status` / `sync_reason` / `sync_backfill_owner` 三字段 ——
**回填与销账同一次提交**（AGENTS.md 硬规则）。同时补上第六轮（CI 实证修复）段落，
那是上一笔提交（`ce7251627`）漏掉的内容，属于本条记录的一部分。

**② 更正 `01-docs/learnings.md` 第 5 条的错误归因。**
原文写着「本轮实际是靠最后一次提交只动了 `.ccg/` 与 `openspec/`、被判 **skip/single** 模式而**侥幸**越过
—— 侥幸不能当机制」。**这句话是错的。** `check-pr-exec-record.js` 只对 `mode === 'dual'` 判欠账，
`single` 是 **2026-10-15 缺陷 G 的刻意豁免**，不是运气。

为什么这条错误归因必须改（两个具体危害，不是文字洁癖）：
- 它会诱使后来者去**复现那个「运气」**：例如故意把最后一个提交做成文档改动来躲门禁。而那条路在
  `mode` 判据下根本不成立 —— 照着错误归因去做，只会浪费一轮又把结论写成「这次没躲过去，运气不好」。
- 它把「门禁其实是靠概率才没红」这个印象固化，从而**低估真正的设计方案**（换一个真正唯一的键），
  让人以为问题只能靠豁免绕开。

新增的机械判据（写进 learnings）：**凡在复盘里写「侥幸 / 碰巧 / 运气好」，必须先去读判据源码确认
那是「设计豁免」还是「漏网」；确认不了就写「未查明」，不得反向拟因为运气。**

### 为什么当时没发现（逃逸分析）

- **测试层**：这条错误归因写在文档里，任何测试都读不到语义对错 —— 文档类断言只能锁「形状」
  （比如「远程同步行是否存在且闭合」），锁不住「归因是否属实」。
- **评审层**：QM-6 的 judge 读的是 **diff**，这条错误归因是**更早**（#3677 那一轮）就写进 `main` 的，
  不在本 PR 的 diff 里 ⇒ 评审天然看不见。**这是「历史文本错误」的通用盲区**：
  所有以「本次 diff」为审查面的机制，都看不见存量错误。
- **会话层**：用户曾单独问过「3 个零消费者的未鉴权端点」，我在回答里顺带引用了这条「侥幸」表述，
  但当时没去核判据源码 —— **引用了别人的结论就当成了事实**，这本身就是本条要防的同一个错误。

### 遗留（不假装已闭合）

- `check-pr-exec-record.js` 的**提示文案**仍写「`.ccg/reviews/<40 位小写十六进制>.json`」，
  而 `AUDIT_ARTIFACT_RE` 已同时接受 40 与 64 位（本 PR 的判据是两者都认）。**文案与判据不同步**
  属陈旧提示，不影响拦截结果，但会误导排障者以为 64 位记录不算纯回填。**未修**：
  改它是改判据文案（同属门禁文件），且会扩大本 PR 的变更集使其不再「纯回填」。已登记待办。
- `01-docs/learnings.md` 是本仓库多会话共用的追加型写面。本 PR 只改**第 5 条**这一处，
  未触碰其它会话在同一文件里的在建改动（开工前 `git status` 确认共享根有他人未提交修改，
  故全程未在共享根落盘，改在本 worktree 的独立分支上完成）。
