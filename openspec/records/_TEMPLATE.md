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
# ⛔ 也不要手工把下面那行「远程同步」的状态列改写成 PASS / ✅ / 已合并 —— 那是一次「状态词跃迁」，
#    Gate 2c 的 check-gate-record-debt 会按本次 PR 的 git 差量判红并点名这篇（change: ban-record-closure-backfill-pr）。
#    合并后 main push 的回读证据写在 PR 评论里，不写回本文件：merge SHA 只在合并之后存在，
#    把它的读数要求落进受扫描的文件，等于重新造出「必须为改写这一行另开一次 PR」那个循环。
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

<!--
  下面两个小节是 CHANGELOG.md / 01-docs/learnings.md 的**唯一真源**（change: changelog-record-carrier）。
  ⛔ 不要为了"让变更进台账"去编辑那两个文件 —— 它们是每个 PR 都往第 1 行插块的写面，
     任意两个在飞 PR 结构上必撞（实测 4/4 个可判定的 CONFLICTING PR，冲突文件只有这两个）。
     现在这条形状由 scripts/check-no-hot-carrier-edit.js（CI Gate 2b9）按 PR 差量点名。
  搬运由脚本做：`node scripts/aggregate-changelog.js --write`，幂等键是**本文件名**（= 分支名），
     不是标题文本（主干上同一标题有多份历史副本，按标题判"已搬"会静默少吃一条）。
  发版顺序（scripts/release-gate.mjs 会按这个顺序拦你）：
     ① 先 --write 把这条记录搬进台账 → ② 把顶部 "## [未发布]" 收口成 "## [vX.Y.Z]" → ③ bump → ④ 打 tag。
  两个小节的形状要求（不合规会被聚合作业出声，但不会静默搬走）：
     `## CHANGELOG 条目` 正文**首行必须是一条 H1**（一条变更一个标题块；用两个空行分隔多条）；
     `## learnings` 选填，一旦存在就必须内含 `### lesson: <slug>`，不能用 `## 标题` + 正文那种层级。
-->

## CHANGELOG 条目

# feat(scope): 一句话说明这次变更（<slug>）

- 用户或维护者能感知到的变化，一条一个 bullet；写"为什么/拦什么"，不写文件清单。

## learnings

### lesson: <一句话教训标题（slug 化，便于台账里检索）>

**现场**：当时发生了什么（含可重取的取证坐标：run id / job id / 命令原文）。

**根因**：为什么会这样，而不是表面症状。

**可复用的 N 条**：

1. 换成别的模块也成立的那句话才是教训。