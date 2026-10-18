---
record: s2v-tone-field-guard
task: 修 main 侧红 —— 「语音 / 音色 ID」的显示条件把「已选模型」窄化成「程序解析出模型」
date: 2026-10-19
---

## 本次执行记录：音色字段显示条件回补（s2v-tone-field-guard，2026-10-19）【混合 PR】

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ | 运行时代码（`apps/desktop/src/views/video-creation/S2vConfigPanels.vue` 及其测试）⇒ 隔离 worktree `D:\Data\projects\mp-worktrees\mp-s2v-tone-field-guard`、裸分支 `s2v-tone-field-guard`（`start-mp-task.ps1 -TaskName s2v-tone-field-guard` 创建，依赖就绪 `verify-worktree-deps` = OK） |
| 第一性原因（QM-5 ①） | ✅ | #3946 把「语音 / 音色 ID」的渲染条件写成 `voiceProvider && s2vVoiceContextModel`，而 `s2vVoiceContextModel` 只认**程序按运营默许模型解析**的结果（依赖 provider 注册表）。上游布局契约 `S2vConfigPanels.test.js:282` 的夹具显式给 `voiceModel` 但不加载注册表 ⇒ 字段不渲染 ⇒ main push 的 `QG Desktop Shards (2/2)` 红（`expected '…' to contain '语音 / 音色 ID'`）。PR 侧没红是因为 shard 分片把该文件分到了另一片、且当时该断言来自更晚合入的上游提交 |
| 逃逸分析（QM-5 ②） | ✅ | ①PR 侧分片与 main 侧分片不是同一集合，同一文件可能落在不同 shard；②该断言的注释写「仅在已选语音模型（或模型下拉被隐藏）时渲染」，而我的实现把「已选模型」重新定义成「注册表解析出模型」，**没有回溯这条既有契约**；③本地只跑了 `S2vConfigPanels.test.js` 的我方版本，未跑上游新增的布局断言 |
| 修复 + 回归保护（QM-5 ④） | ✅ | 显示条件改为「已选提供方 且（程序解析出模型 **或** 显式 `s2vConfig.voiceModel`）」——保留「模型未知时不渲染空控件」的意图，同时兼容历史快照/配置档案回填与分发夹具。测试：既有布局契约 24 条全绿；我方负向用例补「场景 2b：仅 config.voiceModel 已知 → 字段渲染」，并把场景 2 改为「两个来源都为空」 |
| 防止再次发生（QM-5 ⑤） | ✅ | learnings 已记「改共享状态/条件时先 grep 既有断言」（#3946 同批补的两条教训）；本条进一步说明**渲染条件存在多个模型来源时必须把来源列出并逐个覆盖**，否则任一来源缺席就变成显示缺失 |
| 行尾与 diff 对账 | ✅ | `git diff --numstat` 与 `--ignore-cr-at-eol --numstat` 两口径一致（提交前实测） |
| QM-1 打包 / QM-4 视觉 | 见下 | 本片只改 renderer 的 `v-if` 条件（不改 electron 主进程）⇒ QM-1 不触发；QM-4 像素基线由 CI `QG Visual` 承担 |
| QM-6 外部评审 | 由门禁推导 | 见 `.ccg/reviews/*.json`；引擎不可用时的处置与 #3946 同口径（codex 人工跨家族） |
| 远程同步 | 由门禁推导 | 见 PR（收口由 `scripts/lib/merge-ledger.js` 按主干历史推导） |

- 保留门禁：判定 docs-only=false（走完整节拍）| 行尾对账 ✅ | 品牌残留 随 CI | 文档同步 随 CI doc-gate | 执行记录 ✅ 本文件（旧载体 `.quality-gates.md` 与 ledger 按「旧载体冻结」政策零改写）| 远程同步 PR

### 为什么必须单独开 PR（不直接改 main）

main 的 `QG Desktop Shards (2/2)` 红是 #3946 引入的（`2e108e7a6`）。仓规 QM/收尾清单第 6 条要求：main push 红了就按本轮口径补一轮 follow-up PR，**不得把 main 的红留给下一个会话**。本 PR 即该 follow-up。
