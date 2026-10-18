# 本次执行记录：发布失败 6 平台归因 —— CHANGELOG 与 learnings 收口（changelog-learnings-publish-failures-6，2026-10-18）【docs-only】

- 判定：见 §判定（`node scripts/classify-docs-only.js --base=origin/main --head=HEAD`，**必须在 commit 之后取证**）
- 保留门禁：行尾对账 ✅ | 品牌残留 ✅ | 文档同步 ✅ | `远程同步` 由门禁推导
- 关联 PR：#3905（`fix(publish): 发布失败 6 平台归因 …`，merge `b6573f00`）—— 该 PR **刻意不含**本两处改动

## 为什么单独开这一篇

`CHANGELOG.md` 与 `01-docs/learnings.md` 是多会话共用的**置顶追加型热写面**（实测主干重复行键：
CHANGELOG 3348 个、learnings 4104 个）。#3905 连续 3 次 rebase 全部卡在 `CHANGELOG.md` 的
首行冲突上：每次解决冲突 → 推 → CI 跑 10 分钟 → 期间别的会话又往主干首行插了一条 ⇒ 再冲突。

按 AGENTS「分层分支策略」，纯文档/流程变更**不需要独立 worktree，可在共享主工作区就地编辑**，
因此这两条收口走 docs-only 通道（精简门禁、CI 重型 job 自动短路），把热文件的冲突面从代码 PR 里摘干净。

## 本次落地内容

1. `CHANGELOG.md` 顶部新增一条：发布失败 6 平台的现场 / 真因（逐平台，含日志原文）/
   修复（前置门禁四判据 + `_runVideoUpload` 下沉 + `markNotSentByResult`）/ 测试 / 未闭合。
2. `01-docs/learnings.md` 顶部新增一个 lesson：
   `lesson:best-effort-continue-launders-root-cause-into-symptom`
   —— 四条判据（失败步骤 ≠ 报错步骤时信息量为零；`if (A && B.length>0)` 是静默跳过；
   只写不读的字段等于没收集；丢弃返回值即丢弃判据）+ 接线面三条 + 文案面两条。

内容与 #3905 里的 `01-docs/PRD-PUBLISH-FAILURE-ATTRIBUTION-2026-10-18.md`、
`01-docs/BUGFIX-PUBLISH-FAILURES-6PLATFORMS-2026-10-18.md`、`openspec/records/publish-failures-6.md`
同源、不新增结论。

## 判定

`node scripts/classify-docs-only.js --base=origin/main --head=HEAD` ⇒ **docs-only=true，files=4**：
`.ccg/reviews/e57ee523….json`、`01-docs/learnings.md`、`CHANGELOG.md`、
`openspec/records/changelog-learnings-publish-failures-6.md`。
（取证在 commit 之后，避免「未提交时 HEAD==base ⇒ files=0」的取证顺序错误。）
CCG 判定器对本次改动给出 `mode=skip / deepReview.required=false`（docs-only 正确短路 QM-6）。

## 门禁读数

| 门禁 | 读数 |
| --- | --- |
| `check-no-brand-residue.js` | **PASS**（10135 tracked 文件；竞品名按要求写「参考产品」） |
| `check-changelog-growth.js` | **PASS**（base 510 条全部在 head 510 条里；字节 2762346 → 2762346，纯新增 1 条标题） |
| `check-doc-abs-paths.js` | **PASS**（3997 受管文件，无新增本机绝对路径） |
| `check-no-conflict-markers.js` | **OK**（4 个文件带原因登记，不超基线） |
| `check-gate-record-debt.js` | **OK**（两源无未收口新增） |
| `check-text-encoding-integrity.js` | **OK**（无新增编码损坏） |

## 远程同步

| 远程同步 | 由门禁推导（合并后按主干历史收口；不手写状态词） |
