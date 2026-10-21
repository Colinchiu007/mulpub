# changelog-record-carrier — delta for quality-gate-execution-record

## ADDED Requirements

### Requirement: 执行记录 MUST 携带可聚合的变更说明小节，且小节边界只能按语义位置切

每篇 `openspec/records/<分支名>.md` MUST 含一个小节，其标题逐字为 `## CHANGELOG 条目`。该小节承载本 PR 面向人的变更说明，MUST NOT 是门禁取证表——取证表已有 `| 门禁 | 状态 | Fresh 证据 |` 的既有形状，把同一份流水账抄进变更说明小节会让归档读起来像审计报告，而归档的消费者是人。

小节边界的判定 MUST 按**语义位置**：一个 `## ` 开头行只有在其标题文本逐字等于约定小节名时才是该小节的起点，其终点是下一个顶层 `## ` 行或文件末。MUST NOT 用"文本里出现过 `CHANGELOG 条目` 这串"作为边界判据——本仓规范文档与记录正文会原样引用这些名字（含本句），字符串判据会把引用点当成小节起点，从而把整篇记录搬进 CHANGELOG（禁令与存在性判据必须按语义位置切，同族先例见 `AGENTS.md` 2026-10-19 三条实测）。

`## learnings` 小节 MAY 缺席（不是每次变更都产出教训）。缺席 MUST NOT 判红；存在时其内 MUST 至少有一个 `### lesson: <slug>` 子块，否则判形状非法并点名。

#### Scenario: 缺变更说明小节时点名

- **WHEN** 一篇记录不含标题逐字为 `## CHANGELOG 条目` 的小节
- **THEN** 校验 MUST 判红并点名该文件名（不是标题文本、不是行号）
- **AND** MUST NOT 退化为"取正文第一个二级小节顶上"——猜出来的边界会把门禁表搬进归档

#### Scenario: 正文引用小节名不得被当成边界

- **WHEN** 记录的取证表单元格或正文里出现字面串 `## CHANGELOG 条目`（例如在说明本规范本身时引用）
- **THEN** 解析 MUST 忽略行内代码/表格单元内的该串，MUST NOT 以此为小节起点
- **AND** 该忽略行为 MUST 有一条独立用例：把解析器改成朴素 `indexOf('CHANGELOG 条目')` 时，这条用例 MUST 变红

#### Scenario: 缺 learnings 小节不判红，有但形状坏判红

- **WHEN** 一篇记录完全没有 `## learnings`
- **THEN** 校验 MUST 通过，MUST NOT 因"少一段可选内容"阻断提交
- **AND** 当 `## learnings` 存在而其内没有任何 `### lesson: ` 子块时，MUST 判形状非法并点名，MUST NOT 静默产出空归档块
