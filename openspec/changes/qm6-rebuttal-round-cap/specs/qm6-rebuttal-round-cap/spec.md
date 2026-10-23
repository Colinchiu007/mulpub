## ADDED Requirements

### Requirement: 跨调用外部评审轮次必须有上限，且状态不得挂在内容寻址的记录名上

真外部评审的**调用次数** MUST 按 **change（分支）维度**累计，MUST NOT 以判定记录名为键——
记录名是内容寻址（`stagedDiffHash`），重投一次提交就换一个名字，挂在它上面的计数器每次归零，
且**全程看起来完全正常**。

累计与清单 MUST 落在受管可见文件 `openspec/changes/<change>/external-rounds.json`，
MUST NOT 落在 `.ccg/reviews/` 子目录：pre-commit 暂存记录用的是
`:(glob).ccg/reviews/*.json`，其中 `*` 不跨 `/`，子目录里的账不会被收进提交，
于是变成"只有本机看得见"的第二份事实。

默认上限 3 轮；MUST 可用环境变量覆盖，非法值 MUST 回落默认并**出声告警**（不得静默）。
超限时入口 MUST 以 `escalated` 收场并在读数里点名"交人工"；MUST NOT 把超限实现成自动放行或自动收口。

#### Scenario: 重投提交不得让轮次归零

- **WHEN** 作者改完代码重新提交（判定记录名随内容改变）后再跑一次入口
- **THEN** 轮次 MUST 仍按 change 维度递增，MUST NOT 因记录名变化而回到 1

#### Scenario: 超限是升级不是放行

- **WHEN** 第 4 次真外部调用完成而阻断项仍未清零
- **THEN** 入口 MUST 输出 `escalated` 与"已达轮次上限，交人工"，MUST NOT 使该条 dual 欠账变成已闭合

#### Scenario: 非法上限不得静默

- **WHEN** 环境变量被设成非正整数（例如 `MP_QM6_MAX_ROUNDS=abc` 或 `0`）
- **THEN** MUST 回落默认 3 并打印一次告警，MUST NOT 静默采用、MUST NOT 因回落而改变退出码语义

### Requirement: 本 change 不得改变"什么算闭合"

`CLOSED_DEEP_REVIEW_STATUSES` 闭集、`tier=external` 的取得条件、`HIGH_RISK_SURFACES` 与收口矩阵
MUST 逐条保持现状。本 change 只交付**轮次上限**（它改变"何时停手"）；已否证清单的规格**不在本 delta 内**—— 见 PR #4304（`qm6-zero-human-closure`）与本 change tasks §2 的留稿，它改变的是"重复指控的成本"，且以一次仓外授权为前提。
MUST NOT 使任何原本不闭合的产物变成闭合。

#### Scenario: 超限不得成为新的收口词

- **WHEN** 评审达到轮次上限
- **THEN** 产物状态 MUST 落在既有非闭合档（`escalated` / `self_play_*` 原语义不变）
- **AND** `scripts/check-pr-exec-record.js` 对该条 dual 欠账 MUST 仍判未闭合
