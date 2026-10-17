---
# 用法：复制本文件为 `openspec/records/<分支名或任务 slug>.md`。
# 文件名就是这条记录的键（与历史 `.quality-gates.md` 的"标题键"互不重叠，两套语义不混）。
# 下划线开头的文件与 `_exempt/` 子目录不参与记录计数。
record: <slug>
task: <一句话说明这次干了什么>
date: <YYYY-MM-DD>
# 「远程同步」不再需要任何事后回填字段（change: gate-record-sync-derived-status）。
# 收口由门禁按主干历史推导：这篇文件被哪个带 (#NNNN) 尾注的已合并提交最近一次带入 main，即算收口。
# 可选：delivered_by_pr: <PR 号> —— 只用于与主干事实交叉核对（抓"把别人的记录夹进我的 PR"），
#       它不参与收口判定；写了就必须与 git 推出的归属一致，否则判红。
# ⛔ 不要再写 sync_status / sync_reason / sync_backfill_owner：那是旧形态的登记字段，
#    只服务于旧载体与存量 21 篇历史记录；新记录写了它们不会被判红，但会被记为歧义可见项。
# ⛔ 也不要复用键名 sync_pr —— 真仓已有 6 篇用它，形态是 0 / pending / 完整 URL，语义是"回填状态"。
---

## 本次执行记录：<标题>（<slug>，<YYYY-MM-DD>）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 |  | 运行时代码：worktree 路径 + 裸分支；纯文档：就地编辑 + 经 PR 落地 |
| 第一性原因（QM-5 ①） |  |  |
| 逃逸分析（QM-5 ②） |  |  |
| 修复 + 回归保护（QM-5 ④） |  |  |
| 防止再次发生（QM-5 ⑤） |  |  |
| 行尾与 diff 对账 |  | 两口径 numstat 必须相等，并给出删除数归因 |
| 接线棘轮 |  | 新增 `*.test.js` 必须被 workflow 显式点名，否则等于没写 |
| QM-1 打包 / QM-4 视觉 |  | 未触运行面时写 N/A |
| QM-6 CCG 双模型外部评审 |  | 本机无 `codeagent-wrapper` 时如实写「未执行」，不得以自审冒充通过 |
| 远程同步 | 由门禁推导 | 本行**不需要事后改写**：合并后门禁按主干历史推导归属（`scripts/lib/merge-ledger.js`，只认 squash 尾注 `(#NNNN)`）；现场读数看 CI 步骤首行 `MERGE-LEDGER prs=<n>`。合并前这篇文件还不在基线上，判 byDesign 不红；把本行状态列写成 `PASS` 会被判「预写不存在的证据」而红 |

### 遗留（不假装已闭合）
-
