# openspec-integration

## MODIFIED Requirements

### Requirement: 分层分支策略
分支策略 SHALL 分层执行：运行时代码变更（apps/、packages/ 及关联配置/CI）MUST 在 `D:/Data/projects/mp-worktrees/mp-<task-name>` 下的独立 linked worktree 与**裸 `<task-name>` 分支**（`scripts/gwm-task.sh` 默认不加含斜杠前缀；需要前缀时由 `MP_BRANCH_PREFIX` 显式开启）进行，经 PR 审查与 CI 后合并回 main；共享主工作区 MUST 保持在 main，禁止运行时代码任务在共享主工作区切换 feature 分支或修改代码。纯流程/规格/文档变更（openspec/、.ccg/、docs/、scripts/ 工具脚本、CHANGELOG、.quality-gates.md）MAY 跳过独立 linked worktree 在共享主工作区就地编辑，但 MUST NOT 直接推入 `refs/heads/main`（远端分支保护对任何直推一律返回 `GH011`，required status checks 只能经 PR 满足），且 MUST 保持可回滚。判定以「是否影响运行行为」为准，禁止以文档提交夹带运行时代码。

执行记录的唯一强制载体 SHALL 是每 PR 一篇的 `openspec/records/<分支名>.md`。两个全仓共用的追加型写面（`.quality-gates.md` 与 `scripts/gate-record-debt-ledger.json`）MUST 视为**只读存档**：新 PR SHALL NOT 向其追加记录块或登记键，SHALL ONLY 允许就地改写既有记录块内的状态行以关闭历史欠账（详见 `gate-record-carrier-freeze` 能力）。

> 归档顺序依赖：`hot-carrier-atomic-landing`（未归档）也 MODIFY 了本 requirement。两条 delta 必须先归档一条、另一条再按归档后的基线重述，否则 `openspec archive` 会以后者覆盖前者。本 change 是收敛方向（取消写面），应**先**归档本 change，再把那份规格的「两条出路」条款按"写面已消失"改写。

#### Scenario: 运行时代码必须分支
- **WHEN** 变更涉及产品代码、测试、构建或部署配置
- **THEN** 必须在 D 盘独立 linked worktree 的裸任务名分支上开发并经 PR 合并回 main，不得在共享主工作区开发或提交

#### Scenario: 纯流程文档不豁免 PR
- **WHEN** 变更仅涉及 openspec/、.ccg/、docs/、工具脚本、CHANGELOG、.quality-gates.md 等纯流程/文档
- **THEN** 不要求独立 linked worktree，可在共享主工作区就地编辑并 stage 命名路径且保持可回滚（**就地编辑的"许可"不等于往旧载体"新增"记录块**：`.quality-gates.md` 与 ledger 自「旧载体冻结」起是只读存档，只许就地关闭已有行，边界由下一条 Requirement 承载）；但 MUST 经 PR 落地——远端分支保护对任何推入 `refs/heads/main` 的变更一律返回 `GH011: Repository rule violations found for refs/heads/main`，直推路径无法满足 required status checks（2026-09-26 以纯 `.quality-gates.md` 回填提交实测被拒，见 PR #2411）

#### Scenario: 新 PR 不再写旧载体
- **WHEN** 一个 PR 的执行记录同时出现在 `openspec/records/` 与 `.quality-gates.md` 顶部（或向 ledger 新增了键）
- **THEN** 门禁必须判红并点名新增的记录块标题，给出"改写进 openspec/records/<分支名>.md"这一出路；不得以"惯例如此"放行，因为该写面是所有会话共用的追加型文件，未提交窗口会造成静默丢工

#### Scenario: 关闭历史欠账仍走旧载体
- **WHEN** 一个 PR 只就地改写 `.quality-gates.md` 里既有记录块的状态行（把历史 PENDING 改成 PASS + merge SHA），未增删任何记录块
- **THEN** 冻结判据 MUST NOT 报漂移——ledger 现存 25 条未收口欠账多为 2026-08 的老记录、只存在于旧载体，封掉这条路等于把旧账永远钉红

#### Scenario: 文档夹带代码
- **WHEN** 一次提交同时包含流程文档与运行时代码
- **THEN** 该提交按运行时代码处理，必须拆分并走独立 worktree + 分支 + PR

#### Scenario: 共享主工作区误切 feature 分支
- **WHEN** 任一会话使共享主工作区成功切换到非 main 分支
- **THEN** Git 守卫必须立即检测并恢复 main；恢复失败时必须进入 fail-closed 事故状态并给出精确恢复步骤
