# 变更：快捷采集·内置词条按用户真实需求重排（quick-collect-preset-refresh）

## Why

用户在 2026-10-11 明确指出：**他要求的提示词原话是关于「AI 与新技术领域的真实动态」，而不是
「内容平台规则、内容审核口径、AIGC 标识要求、限流与封禁治理」**。复核仓库证据后确认用户没记错：

- `openspec/changes/quick-collect/proposal.md` 里 6 条内置词条**只有 `AI 领域动向` 标注了「提示词逐字采用用户给定文本」**；
- 用户原话的对照串（`quick-collect-presets.test.js` 里独立手录）全文只讲大模型/框架发布、GitHub 新 AI 项目、
  其他重大事件 —— **没有一个字**提到平台规则；
- 「我关心平台规则有没有变化」这句出现在 PRD §1 场景 2，是**上一个会话自己写的产品推演**，
  `builtin-platform-policy` 与 `builtin-risk-alert` 都是从这句推演出来的 agent 设计内容。

这条错认有实际代价：它为「S3 政策/合规类源」整片扩展提供了理由（PRD §4.3、tasks S3），
而 S3 实测 7 个候选全部不可用、最终只能以证据收口 —— **一整片工作量花在一个并非用户要求的方向上**。

用户本次的处置决定：① 把「平台规则与合规动向」换成 **AI 前沿论文速览**（复用 S2 已接入的
`arxiv_cs_ai` / `hf_papers`，且该方向正落在用户原话范围内）；② 把「舆情风险与避雷」换成另一个实用的
**AI 实操技巧与工作流**。

## What Changes

- **替换 2 条内置词条**（总数仍 6 条，渲染端/校验口径不变）：
  - `builtin-platform-policy`（📜 平台规则与合规动向）→ **`builtin-ai-papers`（📄 AI 前沿论文速览）**；
  - `builtin-risk-alert`（⚠️ 舆情风险与避雷）→ **`builtin-ai-howto`（🛠️ AI 实操技巧与工作流）**。
- **新增 `provenance` 字段（机械可查的来源标注）**：`'user'` = 用户给定原文（必须逐字，改即改需求）；
  `'agent'` = 依 PRD 场景推演的产品内容（可随需求调整）。6 条中**只有 `builtin-ai-trends` 是 `'user'`**。
  这条字段的价值就在本次事故：**让「agent 推演」不可能再被当成「用户要求」**。
- **测试**：id 闭集断言更新；新增「两个被移除的 id 不再存在」负向断言；新增「只有 AI 领域动向是 `provenance:'user'`」
  的来源锁；新增两个新词条的源闭集与专属源断言；渲染端面板夹具随之改名。
- **文档**：PRD-QUICK-COLLECT（场景 2、F-2 口径、新增本次调整说明）、
  `openspec/changes/quick-collect/spec.md`（内置目录 Requirement + 新增 provenance Requirement）、
  proposal、PRD-QUICK-COLLECT-CN-SOURCES（§4.3 标注 S3 目标作废、§13 词条表、§15 未闭合）、
  cn-sources `tasks.md`（S3 标注作废理由）、CHANGELOG、执行记录。

## 不做（明确排除）

- **不改 `builtin-ai-trends` 的提示词**：它是用户原话，逐字保留（AC-10 对照串继续锁着）；本次若改了它，等于替用户改需求。
- 不改内置词条的**数量**（仍 6 条）、不改渲染端交互、不改存储格式（内置指令依旧不落盘）。
- 不新增素材源、不改 registry（只是重新分配已有源）。
- 不删除历史证据：S3 的实测证据表保留（它有独立价值：证明"未实测不入册"这条纪律在起作用）。
