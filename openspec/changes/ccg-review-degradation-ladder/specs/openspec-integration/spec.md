## ADDED Requirements

### Requirement: QM-6 外部评审不可用时的降级梯与证据分档

当 CCG 外部评审后端不可用时，系统 SHALL 允许按**证据档**降级收口深度审查，但降级 SHALL 同时具备三件事：**资格以物证为准**（不取自述、不取退出码）、**货币为机械可验产物**、**结果可追偿**（欠账可重开且计数只可缩小）。判据 MUST 以 `(deepReview.status, deepReview.tier)` 判定，其中 `tier` 是**结构化来源字段**（`external|self-play|none`），MUST NOT 从 `performedBy` 的自由文本推断（主干实测 34 种散文取值，含两条以 `self-play` 开头却声明做过外部复核的记录，前缀判据会把真外部证据误判成自扮演）；`tier` 缺失或取值不在闭集内时 MUST 落 `unknown` 并按未收口处理，MUST NOT 被读成外部证据。外部档的佐证 MUST 复用既有口径「`deepReview.findings` 是非空数组」（与 `shouldPreserveClosedRecord` 主判据同源，不得再造第二套词汇）。

#### Scenario: 外部轴交付时语义不变

- **WHEN** 一条 `mode=dual` 的判定记录里有 ≥1 个命名后端交付（`performedBy` 为具体后端名）
- **THEN** `cleared` / `needs_revision` 照常判闭环，本次变更 MUST NOT 收窄既有放行（避免撤销引擎的免等重试能力）

#### Scenario: 仅自扮演时须付货币并落欠账

- **WHEN** 一条 `mode=dual` 的记录 `performedBy` 为 `self-play` 系（引擎第三档出口）且改动**未触及**高危面
- **THEN** 仅当同一次提交内同时存在 ①机械对抗产物（变异驱动 json：`escaped === 0`、变异条数 `>= 2`、产物路径在本 PR 可寻）与 ②记录文件 frontmatter 的 `deep_review_status: fallback_closed` + `deep_review_backfill_owner` + `deep_review_backfill_reason` 三字段时，才判闭环
- **AND** 缺任一前提 MUST 判欠账并阻断

#### Scenario: 高危面不得用自扮演收口

- **WHEN** 改动命中高危面清单（含凭证/加密/登录态/发布内容链/**判据本体 `scripts/check-*.js` 与 `.github/workflows/*`**）
- **THEN** 仅 `self-play` 证据档 MUST 一律判欠账，MUST NOT 因"CLI 不可用"放行
- **AND** 高危面清单 MUST 按路径前缀持有且每项带实测出处，清单只能缩小；新增前缀无出处即红

#### Scenario: 降级资格以物证为准

- **WHEN** 判据需要确认"外部后端是否真的不可用"
- **THEN** MUST 读判定记录中的 `backendAvailability`（由 `detectBackends()` 的 `wrapperExists` / `claude` / `opencode` 落盘而来），并按 `0/1/2` **计数分档**（1/2 与 2/2 不得读成同一含义）
- **AND** MUST NOT 以子进程退出码或人工陈述作为资格判据

#### Scenario: 降级不得变成永久

- **WHEN** 仓内存在 `fallback_closed` 的历史降级记录
- **THEN** 其 outstanding 计数 MUST 只可缩小，且每次 Gate 读数 MUST 出声打印
- **AND** 销账（补跑外部评审）与删除该三字段 MUST 在同一次提交内发生
- **AND** 该欠账 MUST NOT 写入已冻结的旧载体（`.quality-gates.md` / `gate-record-debt-ledger.json`），否则触发 `carrierDrift`

#### Scenario: 修改守门判据的 PR 受自反条款约束

- **WHEN** 某 PR 修改了本判据本体
- **THEN** 该 PR MUST NOT 以 `self-play` 证据档收口自身的 QM-6，MUST NOT 自动合并，一律人工过目
- **AND** 其执行记录 MUST 写明真实证据档，或如实写"未执行"，MUST NOT 出现"降级已建立且本 PR 用它收口"的自我授权
