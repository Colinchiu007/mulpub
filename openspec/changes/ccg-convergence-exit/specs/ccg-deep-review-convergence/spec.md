## Purpose

定义「CCG 深度审查的收敛出口可达性」这一事实**应当如何被测量、被报警、被接线**：结论必须是可复跑的读数而不是散文断言；所有上游参数必须现读而不是抄写；取不到数与读数偏离必须是两个不同的退出码；并且这条判据本身必须被 CI 看见。它规定测量的形状，不改变审查的判定语义。

## ADDED Requirements

### Requirement: 收敛出口可达性 MUST 由可复跑探针给出读数，且参数 MUST 现读自上游源码

探针 MUST 从 vendor 的 `engine.js` 与 `ccg-deep-review.js` 现场解析 `maxRounds / scoreThreshold / stallRounds / stallScoreDelta / selfPlay.enabled / confidenceWeight`；任一项读不出时 MUST 以「自身故障」档退出并点名缺失项。本仓 MUST NOT 保存这些数值的第二份副本（副本会在上游改动时静默失真，而失真后的读数仍完全可读）。

#### Scenario: 上游缺失时不得判通过

- **WHEN** 运行环境不存在 vendor 引擎（`CCG_ARL_DIR` 未设、用户技能目录不存在）
- **THEN** 探针必须以自身故障档退出（非 0），并在诊断输出中点名「探针失明」；MUST NOT 输出任何关于出口可达性的结论行，也 MUST NOT 被 skip 后报绿

#### Scenario: 参数写法漂移时不得沿用旧数

- **WHEN** 上游把某个默认值改写成正则匹配不到的形态
- **THEN** 探针必须以自身故障档退出并列出读不出的键名；MUST NOT 回退到任何本地常量继续产出 ladder 读数

#### Scenario: 只读一份源码会被反向证明不足

- **WHEN** 分别只把 `engine.js` 或只把 `ccg-deep-review.js` 交给默认值解析器
- **THEN** 前者必须读不出 `confidenceWeight`、后者必须读不出 `maxRounds`（即「两份都要读」这一前提是断言对象，不是实现细节）

### Requirement: 三档退出码 MUST 互不混档

`0` = 读数符合预期、`1` = 读数偏离（上游行为或驱动形状变了）、`2` = 探针自身取不到数。把 2 并入 0 等于将「没测到」读成「测到了且没问题」；把 1 并入 0 等于让上游漂移静默通过。

#### Scenario: 驱动形状退回被禁形态时必须变红

- **WHEN** 在隔离副本中把驱动上报的轮次字段改回「单轮且轮次为 1」的被禁形态，并让探针指向该副本
- **THEN** 探针必须以偏离档退出，且 JSON 结论里的偏离清单必须点名该轮次字段；在同一副本里把驱动换回真实源码后，探针必须回到符合档（A/B 对照，缺一即红不能归因）

#### Scenario: 失明档与偏离档不得同形

- **WHEN** 分别构造「找不到引擎」与「引擎形状偏离」两种现场
- **THEN** 两次退出码必须不同，且失明档的机器输出（stdout）必须为空——不得吐半截 JSON 让调用方解析成功后当作空结论

### Requirement: 机器档输出 MUST 只有机器可读内容

`--json` 模式下 stdout MUST 仅包含一个完整 JSON 文档；人类可读的结论与告警 MUST 走 stderr。否则调用方的解析失败信息（形如「JSON 之后有多余字符」）会把「探针多嘴」误报成「探针损坏」。

#### Scenario: JSON 之后不得拼接任何行

- **WHEN** 以 `--json` 运行且探针成功取到读数
- **THEN** stdout 必须能被严格 JSON 解析，且结论、告警、计数等文本一律不出现在 stdout

### Requirement: 夹具 MUST 是真产物逐字摘录并带出处

用于测量出口可达性的样本必须来自真实判定记录的字段级摘录，并记录出处（记录文件名、被审 commit、PR 号、当轮引擎 stdout 原文）。摘录计数与原始产出计数若不同，MUST 在夹具内就地说明差异来源。

#### Scenario: 出处缺失或形态过旧即红

- **WHEN** 夹具缺少出处字段，或记录文件名不是内容寻址形态
- **THEN** 回归锁必须失败；MUST NOT 用为通过而构造的干净样例替代真产物

### Requirement: 该判据 MUST 被 CI 执行且 MUST NOT 被 docs-only 短路

探针与其回归锁 MUST 接进 `quality-gate.yml` 中不被 `docs-only=true` 门控的作业，并 MUST 在 `.gitignore` 为判据本体显式放行（仓库级 `scripts/*.js` 忽略规则会把新建判据本体静默排除在版本控制之外，症状是本地全绿而 CI 报模块缺失）。

#### Scenario: 本体被忽略即视为未接线

- **WHEN** 用 `git check-ignore --no-index -v` 探测判据本体，命中的是忽略规则而非放行规则
- **THEN** 视为该门禁在 CI 上不可执行，必须在同一 PR 补放行规则

#### Scenario: 测试文件必须被点名执行

- **WHEN** 新增该回归锁文件而未在 workflow 的可执行正文里点名
- **THEN** 未接线棘轮必须变红；已销账的文件必须仍在检查域内
