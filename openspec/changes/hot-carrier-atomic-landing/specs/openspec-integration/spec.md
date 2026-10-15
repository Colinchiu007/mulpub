# openspec-integration

## MODIFIED Requirements

### Requirement: 分层分支策略
分支策略 SHALL 分层执行：运行时代码变更（apps/、packages/ 及关联配置/CI）MUST 在 `D:/Data/projects/mp-worktrees/mp-<task-name>` 下的独立 linked worktree 与**裸 `<task-name>` 分支**（`scripts/gwm-task.sh` 默认不加含斜杠前缀；需要前缀时由 `MP_BRANCH_PREFIX` 显式开启）进行，经 PR 审查与 CI 后合并回 main；共享主工作区 MUST 保持在 main，禁止运行时代码任务在共享主工作区切换 feature 分支或修改代码。纯流程/规格/文档变更（openspec/、.ccg/、docs/、scripts/ 工具脚本、CHANGELOG、.quality-gates.md）MAY 跳过独立 linked worktree 在共享主工作区就地编辑，但 MUST NOT 直接推入 `refs/heads/main`（远端分支保护对任何直推一律返回 `GH011`，required status checks 只能经 PR 满足），且 MUST 保持可回滚。判定以「是否影响运行行为」为准，禁止以文档提交夹带运行时代码。

共享主工作区的所有会话共用**一份工作树、一份 index、一份 HEAD**，因此「可回滚」不能是一句无人测量的声明。全仓会话共用的追加型写面（下称**热点载体**，清单唯一来源为 `scripts/hot-carrier-paths.json`，见 `hot-carrier-atomic-landing` 能力）SHALL NOT 以「已修改但未提交」的状态跨出单条命令的边界。该声明由本地层三档共同测量（常驻守卫量开窗时长、`scripts/docs-land.ps1` 在 `reset --keep` 前拦、`scripts/hooks/pre-commit` 拦「把他人脏混进本次提交」），**手工 git 写不在覆盖范围内，必须如实声明而非含糊带过**。命中热点载体的 docs-only 写入 MUST 在以下两条出路中选一条：(a) 由一条命令完成「fetch → stage 命名路径 → commit → 建分支保住提交 → `git reset --keep origin/main` → push → 开 PR」（`scripts/docs-land.ps1`），使窗口只存在于该命令内部；(b) 改在独立 linked worktree 准备（`scripts/start-mp-task.ps1 -TaskName <slug> -NoDeps`）。既不走 (a) 也不走 (b) 且把他人脏混进了提交时，`scripts/hooks/pre-commit` MUST 拒绝该提交。

#### Scenario: 运行时代码必须分支
- **WHEN** 变更涉及产品代码、测试、构建或部署配置
- **THEN** 必须在 D 盘独立 linked worktree 的裸任务名分支上开发并经 PR 合并回 main，不得在共享主工作区开发或提交

#### Scenario: 纯流程文档不豁免 PR
- **WHEN** 变更仅涉及 openspec/、.ccg/、docs/、工具脚本、CHANGELOG、.quality-gates.md 等纯流程/文档
- **THEN** 不要求独立 linked worktree，可在共享主工作区就地编辑并 stage 命名路径且保持可回滚；但 MUST 经 PR 落地——远端分支保护对任何推入 `refs/heads/main` 的变更一律返回 `GH011: Repository rule violations found for refs/heads/main`，直推路径无法满足 required status checks（2026-09-26 以纯 `.quality-gates.md` 回填提交实测被拒，见 PR #2411）

#### Scenario: 热点载体在共享根攒着未提交
- **WHEN** 一次提交的内容命中 `scripts/hot-carrier-paths.json`，当前工作区是共享主工作区，且工作树中还存在**不在本次提交内**的已跟踪改动
- **THEN** `scripts/hooks/pre-commit` 必须拒绝提交，点名那些路径，并给出两条出路（改用 `scripts/docs-land.ps1` 一条命令收口，或改在独立 worktree 准备）；未跟踪文件不参与该判定（与 `scripts/mp-worktree-health.ps1` 的 `-RequireClean` 同口径）

#### Scenario: 一条命令收口时放行
- **WHEN** docs-only 会话通过 `scripts/docs-land.ps1` 提交热点载体，且声明的路径清单覆盖本次全部已跟踪改动
- **THEN** 提交放行；工具必须以产物取证（本地分支 SHA 等于 `git ls-remote` 返回的 SHA、共享根回到 clean、PR 号可查），并打印本次窗口时长与路径清单

#### Scenario: 文档夹带代码
- **WHEN** 一次提交同时包含流程文档与运行时代码
- **THEN** 该提交按运行时代码处理，必须拆分并走独立 worktree + 分支 + PR

#### Scenario: 共享主工作区误切 feature 分支
- **WHEN** 任一会话使共享主工作区成功切换到非 main 分支
- **THEN** Git 守卫必须立即检测并恢复 main；恢复失败时必须进入 fail-closed 事故状态并给出精确恢复步骤
