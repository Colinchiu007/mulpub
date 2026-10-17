# ccg-review-degradation-ladder：QM-6 外部评审不可用时的**有资格、有货币、可追偿**降级梯

## Why

CCG 外部评审的 agent CLI 经常不可用（本机 records 已登记 9 种"跑完但零交付"形态 + 一次 80 分钟 execution timeout + 前端轴三试全败）。强制它会让 PR 堵塞；不强制它又守不住质量。**但真正的风险不是"没有降级"，而是"降级早就存在、却没有任何判据在看它"**——三条已核实的现场：

1. **闭环白名单含 `self_play_resolved`**（`scripts/check-pr-exec-record.js:357-361`），而该状态由引擎在**完全没有外部模型参与**时写出（引擎 `ccg-deep-review.js:312-313`：`self_play_resolved` 同一处把 `performedBy` 置为 `"self-play"`）。⇒ 一条 `mode=dual` 的改动可以外部轴零参与、只靠自扮演裁决收口，门禁照绿。这就是 #3747 记进 AGENTS.md 的那条 ⚠️。
2. **出处字段已经在写，但没人读**：引擎写 `performedBy`（`"self-play"` / `cfg.critic` / `cfg.proposer`），`ccg-review-decider.js:444` 初始化它，而 `check-pr-exec-record.js` 全文只在注释里提过一次、判据里 **0 次消费**。⇒ 「这是外部证据还是自扮演」这个问题，**产物里已经有答案，只是门禁不看**。
3. **可达性已经有计数，但没进产物**：`scripts/deep-review.sh:351-380` 的 `report_backends` 按 `_RB_CODE ∈ {ABS, MISS}` 逐后端解析并聚合成 `_rb_n ∈ {0,1,2}`，注释里还专门写了"必须按计数分档，2/2 与 1/2 不能长成一个样"；`--check-deps` 就是给"为什么我的评审降级了"用的第一手诊断入口（`deep-review.sh:400-403`）。⇒ 降级**资格**的物证机制已经在，只差把它写进判定记录，让"不可用"可被复核而不是自述。

所以本片不是新增一条豁免通道，而是把一条已经通行的暗道改造成**有门槛、有货币、可追偿**的降级梯。

## What Changes

- **D1 证据分级取代单字段判据**：闭集判定从「只看 `deepReview.status`」改为「看 `(status, performedBy)` 二元组」。新增仓侧纯函数 `classifyEvidenceTier()`：命名后端 ⇒ `external`；`self-play` 前缀 ⇒ `self-play`；其余/缺失 ⇒ `unknown`，且 **`unknown` 一律不享受 `external` 的任何放行**（fail-closed，与既有「状态列只认闭合词表」同口径）。
- **D2 `mode=dual` 的收口矩阵**：
  - ≥1 轴 `external` ⇒ `cleared` / `needs_revision` 照常收口（**不改现状语义**，避免撤销引擎的免等重试能力）；
  - 仅 `self-play` ⇒ 只允许在**非高危面**收口，且必须**同一次提交**内满足：①附一份机械对抗产物（见 D4）②落一条可重开欠账（见 D5）；
  - 高危面（见 D3）⇒ 仅 `self-play` 一律判欠账，红。镜像引擎既有词汇 `high_risk_requires_external`。
- **D3 高危面在本仓显式持有**：引擎的 `highRiskDomains` 不在本仓（在用户级 skill 里），不可被仓侧判据直接消费，故本仓定义一份**按路径前缀 + 自指**的清单并加锁；其中一条是硬规则：**判据本体（`scripts/check-pr-exec-record.js`、`.github/workflows/`）属高危面 ⇒ 修改守门逻辑的 PR 不得用 `self-play` 收口**（本片自身即受此约束，见 tasks 5.4）。
- **D4 降级的货币是机械对抗产物，不是"我自己对抗想想"**：要求变异驱动产出的 json（`escaped=0` + 失败用例**全名**清单 + 规模下界），判据取产物不取自述——这条与 records 里「降级/占位产物不得冒充成功产物」的既有教训同源。代价如实写：一次变异驱动在本仓实测 10–35 分钟，比"等外部 CLI 80 分钟后超时"便宜，但**不是零成本**，这是设计意图而非疏漏。
- **D5 可重开欠账，防降级永久化**：复用 `sync_*` 的既有形态，在 PR 记录文件 frontmatter 增加 `deep_review_status: fallback_closed` + `deep_review_backfill_owner` + `deep_review_backfill_reason`；新增一条**只可缩小**的仓内 outstanding 棘轮。理由：一旦降级只需一句"CLI 挂了"，它就会因为省事而变成常态——本仓 `.quality-gates.md` 的 32 条未收口欠账是同型事故的先例。
- **D6 降级资格以物证为准**：`report_backends` 的 0/1/2 计数与逐后端 `_RB_CODE` 写入判定记录（新字段 `backendAvailability`），降级资格判据读它。⚠️ **不得把 rc 当资格**（本仓实测两种值都出现过、且 `Register-ScheduledTask` 型教训反复强调"产物为准"）。
- **AGENTS.md 同步**：把 #3747 新立的那条 ⚠️（`self_play_resolved` 可判绿）改写成矩阵引用，并删掉"未镜像它"这句将过时的事实——避免文档与判据二次脱钩。

## 不做什么（明确排除）

- 不改合并策略、不改 required check 清单本身（不新增/摘除 required 检查项）；只改一条判据的**判定函数**。
- 不引入新的外部依赖，不试图在本仓复刻引擎的多轮对抗循环（那是用户级 skill 的职责，本仓只做**资格与出处**的判定）。
- 不动 `mode=single` 的语义（既有实测：对 `single` 也要求闭环会造出"无法闭合的循环"，见 `check-pr-exec-record.js:398-406`）。
