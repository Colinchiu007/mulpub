## ADDED Requirements

### Requirement: 内置词条必须标注来源（用户给定 vs agent 推演）

系统 SHALL 为每条内置词条声明 `provenance ∈ {'user', 'agent'}`：`'user'` 表示该条 `prompt` 是用户给定原文
（必须逐字实现，任何改动都属"改需求"），`'agent'` 表示该条是依 PRD 场景推演的产品内容（可随需求调整）。

内置词条中 `provenance === 'user'` 的**必须恰好是 `builtin-ai-trends` 一条**，其 `prompt` SHALL 与独立手录的
用户原文对照串逐字一致。任何把 agent 推演内容标注为用户给定、或把用户给定内容的提示词改写的行为，
SHALL 被测试判红。

#### Scenario: 归属被误标

- **WHEN** 把 `builtin-ai-trends.provenance` 改成 `'agent'`（或把任一条 `'agent'` 词条改成 `'user'`）
- **THEN** 来源锁断言失败并点名该 id，CI 红

#### Scenario: 用户给定提示词被改写

- **WHEN** `builtin-ai-trends.prompt` 与用户原文对照串出现任何一个字符的差异
- **THEN** AC-10 逐字断言失败，CI 红

### Requirement: 内置词条按用户真实需求收敛为 6 条

系统 SHALL 内置 6 条官方指令，其 id 集合 SHALL 恰为
`builtin-ai-trends` / `builtin-ai-papers` / `builtin-hot-topics` / `builtin-dev-tools` / `builtin-peer-content` /
`builtin-ai-howto`。

其中「平台规则与合规动向」（原 `builtin-platform-policy`）与「舆情风险与避雷」（原 `builtin-risk-alert`）
SHALL NOT 再存在：这两条是 agent 依场景推演设计、并非用户要求，用户已明确不需要这类内容；
其位置 SHALL 由「AI 前沿论文速览」（`builtin-ai-papers`）与「AI 实操技巧与工作流」（`builtin-ai-howto`）替代。

每条内置词条的 `sources` SHALL 是素材源注册表闭集的子集；`builtin-ai-papers` SHALL 至少包含
`arxiv_cs_ai` 与 `hf_papers`，`builtin-ai-howto` SHALL 至少包含 `github` 与 `sspai`。

#### Scenario: 旧 id 被重新引入

- **WHEN** 有人把 `builtin-platform-policy` 或 `builtin-risk-alert` 加回内置目录
- **THEN** 「两个被移除 id 不再存在」断言失败并点名 id，CI 红

#### Scenario: 新词条吃到闭集外的源

- **WHEN** `builtin-ai-papers.sources` 含注册表里不存在的源 id
- **THEN** 闭集子集断言失败，CI 红
