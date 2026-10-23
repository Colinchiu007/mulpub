## ADDED Requirements

### Requirement: 已否证争议必须带可核证据并随下一轮送审注入

> **交付状态（2026-10-23，QM-6 第一轮 i6 采纳后补）**：本 Requirement **未实现**，且不是"忘了写"——
> 它的前提是往 critic 的送审载荷里注入一段文本，而实测（tasks §0.2）仓外引擎 `ccg-deep-review.js`
> 自己拼 `mc.callCritic({ proposalText })`，仓内没有任何注入点 ⇒ 开工需要一次**仓外引擎改动的人工授权**。
> 引用这一条时先问"授权拿到了吗"，不要把它当成可直接实现的合同。
> 另一处必须同看：PR #4304（`qm6-zero-human-closure`）把"处置凭证"写成同一份 `rebuttals[]` 的消费者，
> **两处不得各建一份否证登记**。

一条被判 `dismissed`（指控不成立）的争议，MUST 携带**可核证据**才能进入 `rebuttals[]` 清单：
形态只认两类——`文件:行号`（该行确实承载被指控的那件事），或 `命令 + 输出摘要`（命令可重跑且摘要与输出对得上）。
"我判断它不是问题"MUST NOT 算否证。下一轮外部评审的送审载荷 MUST 注入这份清单，
并要求评审方对已否证的同一 `finding` 指纹**重复提出时必须携带新证据**。

注入失败（引擎不支持、清单读不到、指纹算不出）MUST 出声成**独立一档**
（`rebuttal-injection=absent`），MUST NOT 把"没有注入"读成"已注入且无重复"——
后者会让整条机制在静默中退化成装饰，与本仓「降级产物不得冒充成功产物」同型。

#### Scenario: 无证据的否证不进清单

- **WHEN** 一条争议被填成 `verdict=dismissed` 而 `rationale` 里没有 `文件:行号` 也没有可重跑命令
- **THEN** 该条 MUST NOT 进 `rebuttals[]`，且 MUST 点名"否证缺可核证据"

#### Scenario: 重复指控被标出但不隐藏

- **WHEN** 评审方再次提出一条与 `rebuttals[]` 中某指纹相同、且未携带新证据的 Critical
- **THEN** 该条 MUST 被标 `duplicate_rebutted` 且 MUST NOT 计入阻断项
- **AND** 它 MUST 原样出现在判定记录里（人工回看时看得见"模型又提了这条"），MUST NOT 被删除或改写成 Info

#### Scenario: 引擎不配合注入时必须出声

- **WHEN** 送审载荷里没有已否证清单（引擎版本不支持或注入路径失败）
- **THEN** 入口 MUST 打印 `rebuttal-injection=absent` 一档，MUST NOT 打印"本轮无重复指控"

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
MUST 逐条保持现状。已否证清单与轮次上限只改变**重复指控的成本**与**何时停手**，
MUST NOT 使任何原本不闭合的产物变成闭合。

#### Scenario: 超限不得成为新的收口词

- **WHEN** 评审达到轮次上限
- **THEN** 产物状态 MUST 落在既有非闭合档（`escalated` / `self_play_*` 原语义不变）
- **AND** `scripts/check-pr-exec-record.js` 对该条 dual 欠账 MUST 仍判未闭合
