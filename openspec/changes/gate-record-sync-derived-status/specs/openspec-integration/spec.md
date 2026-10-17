# openspec-integration

## ADDED Requirements

### Requirement: 远程同步的收口证据由主干历史推导，squash 尾注是本仓契约

执行记录的「远程同步」收口 SHALL 以主干历史为证据来源：一条记录被认为已同步，当且仅当**把它首次带入 `main` 的那次合并提交**可被解析为带 squash 尾注 `(#NNNN)` 的已合并 PR。本仓 MUST 保持「经 PR 合并且提交信息带 `(#NNNN)` 尾注」这一惯例，因为它是该判据的唯一取证入口；合并方式改为不写尾注的形态（rebase-merge、平台默认合并、人工 merge）会使推导档整体失效，属**契约变更**，MUST 与判据变更同 PR 落地并出声。

收口既由推导得出，系统 SHALL NOT 再要求「合并后另开一次 PR 把状态改写为 PASS + merge SHA」。经 PR 落地这条本身 MUST NOT 放松：直推 `refs/heads/main` 仍被远端分支保护以 `GH011` 拒绝，required status checks 仍只能经 PR 满足。

#### Scenario: 合并即收口，无需二次写回

- **WHEN** 一个 PR 被 squash 合并，其记录文件的 `远程同步` 行仍写着未闭合状态
- **THEN** 判据按主干历史推导为已收口；除本次合并外 MUST NOT 要求任何后续提交或第二个 PR

#### Scenario: 合并方式变更必须连带判据

- **WHEN** 某次合并没有产生 `(#NNNN)` 尾注（例如改用 rebase-merge 或人工 merge）
- **THEN** 该记录不能被推导收口并落入兼容档/欠账且出声；若这是仓内合并方式的永久变更，判据与规格必须在同一 PR 内一起改，不得只改流程留判据烂在那里

#### Scenario: 推导不改变"必须经 PR"这条

- **WHEN** 一次纯文档变更试图借"状态反正能推导"直接推入 `refs/heads/main`
- **THEN** 仍按分层分支策略拒绝——推导改变的是"要不要二次回填"，不是"要不要经 PR"
