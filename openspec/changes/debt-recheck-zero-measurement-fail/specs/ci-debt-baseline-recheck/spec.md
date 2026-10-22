## ADDED Requirements

### Requirement: 重算轮次必须把"没量到"与"量到了"分档，且不得把没量到报成成功

系统 SHALL 使 `scripts/check-debt-recheck.js` 的一轮重算在「拉到 open PR 清单但一笔都没有真正量到」时以非零退出，除非该轮**每一行**都是 `conflict`（他人 PR 与主干真有冲突，在 GitHub 侧本就不可合并，陈旧绿进不了主干）。退出码 SHALL NOT 依赖某份手抄的原因名单是否完备。

#### Scenario: 全部条目为工具侧失败 ⇒ 非零

- **WHEN** 一轮里 `rows>0`、`IN_BASELINE+VIOLATES=0`，且条目原因含 `merge-commit-failed` / `merge-worktree-failed` / `worktree-setup` / `unrelated-histories` / `ref-missing` / `unknown-shape` 中任一
- **THEN** `summarize()` 必须给出非零 `exitCode`，并在结论行点名列出的故障档
- **AND** `shouldComment` 必须为假——工具失明不得伪装成对别人 PR 的判决

#### Scenario: 全部条目确因他人 PR 冲突 ⇒ 退零但必须留痕

- **WHEN** 一轮里每一行都是 `UNJUDGEABLE/conflict`
- **THEN** `exitCode` 为 0（那些 PR 在 GitHub 侧 CONFLICTING、合不进去，本作业要防的事没发生）
- **AND** 输出必须含一行 `MEASURED=0(all-conflict)`，使"一条都没量"与"量了且都在基线内"在日志里可区分

#### Scenario: 量到了就退 0，哪怕结论全是违规

- **WHEN** 至少一笔得到 `IN_BASELINE` 或 `VIOLATES`，其余条目因真冲突量不到
- **THEN** `exitCode` 为 0 且 `shouldComment` 为真
- **AND** 把这条判成 CI 红会诱导人改评论而不是改债，属既有语义，SHALL NOT 改动

### Requirement: 量不到的原因必须按可修复单位分档并带出现场

系统 SHALL 为 `UNJUDGEABLE` 的每一档原因给出**唯一**的失败单位：工具自身 seam 未装配、合成提交失败、只读检出失败三者不得共用一个档名；并且每一条 `UNJUDGEABLE` SHALL 携带失败命令的首条非空 stderr（截断）作为现场，同时出现在逐条日志与评论表格里。

#### Scenario: 三个失败单位三个档名

- **WHEN** `commitTree` 返回非零 rc，或 `worktreeAdd` 返回非零 rc，或三者之一根本没被注入
- **THEN** 条目原因分别必须是 `merge-commit-failed`、`merge-worktree-failed`、`worktree-setup`
- **AND** 断言这三档在词表里互不相同、且都属工具侧故障档

#### Scenario: 现场必须随条目出来

- **WHEN** 某个真 git 阶段失败且其 stderr 含 `fatal: something`
- **THEN** 该条目的 `detail` 必须包含 `fatal: something`，逐条日志与评论表格的现场列都必须带出它
- **AND** 摘掉 `detail` 赋值的变异必须让对应断言指名变红

### Requirement: 档位归类只准有一处真源

系统 SHALL 由单张 reason→归类表派生 `UNJUDGEABLE_REASONS` 与工具侧故障清单，SHALL NOT 再手写第二份名单；归类表里出现两个合法档之外的值 SHALL 使判据失败。

#### Scenario: 新增一档忘记归类 ⇒ 当场红

- **WHEN** 归类表被加入一个值为空串或第三种字符串的条目
- **THEN** 判据必须失败并点名该档
- **AND** 测试必须覆盖"每个词表成员都在归类表里"与"每个归类值都是合法档"两个方向

#### Scenario: 构造合并态的那条路与判决那条路档位同源

- **WHEN** `mergedTreeEvidence` 与 `evaluatePr` 走到同一个真 git 失败阶段
- **THEN** 两者必须报出同一个档名
- **AND** 只改其中一条路的边数必须被断言抓住
