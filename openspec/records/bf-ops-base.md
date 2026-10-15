---
record: bf-ops-base
task: 回填 #3622 远程同步 PASS + merge SHA，并补本体 QG 块
date: 2026-10-15
sync_status: PENDING
sync_reason: 本回填 PR 尚未合并，merge SHA 还不存在
sync_backfill_owner: 下一个会话
---

## 本次执行记录：回填 #3622 远程同步 PASS + merge SHA，并补本体 QG 块（ops-base-single-src）【docs-only】

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | PASS | 纯文档/流程变更 ⇒ 就地编辑 + PR 落地；开写前先 `git merge --ff-only origin/main` |
| 第一性原因（QM-5 ①） | PASS | #3622（merge `a92508dff528c8c6c7c4f156abe50849f3c5d93f`，2026-10-15 13:10:48 +08:00）已合并。**本体 PR 刻意未带 QG 块与 ledger**（共同追加热点 ⇒ 活锁），故本回填 PR 补本体 QG 块（最终 PASS 形态） |
| 逃逸分析（QM-5 ②） | PASS | 沿用已沉淀判据（两形态两个文件都改；回填与销账同次提交），一次通过 |
| 修复 + 回归保护（QM-5 ④） | PASS | 三处同次提交：本体记录两形态 → PASS + merge SHA、删 frontmatter 三字段；新增本体 QG 块（PASS）；登记本回填 PR 自身 |
| 防止再次发生（QM-5 ⑤） | PASS | 本轮新增 2 条教训：**env 第二真源类缺陷要靠「扫源码数归一处出现次数」的锁**（恰好 2 处且形态固定）；**变异反证要覆盖「把坏味道加回去」这一侧**（B1 即把 env 兜底加回） |
| 反证 | N/A | 纯文档改写；本体反证见 #3622（四处变异 ⇒ 2/2/3/1 条变红 + 字节级还原） |
| 编码与行尾 | PASS | 两口径 `numstat` 一致 |
| QM-1 / QM-4 | N/A | 未触生产代码与渲染层 |
| QM-6 双模型外部评审 | 未执行 | 本机无 `codeagent-wrapper`，如实登记 |
| 远程同步 | PENDING | 待本回填 PR 合并后由后续 docs PR 回填 merge SHA 并销账 |

- 保留门禁：行尾对账 ✅ | 品牌残留 ✅ | 文档同步 ✅ | 远程同步 PENDING
