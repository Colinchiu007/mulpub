# openspec-integration Specification

## Purpose
TBD - created by archiving change openspec-integration. Update Purpose after archive.
## Requirements
### Requirement: 三层机制分工
系统开发流程 SHALL 由三层机制分工协作：CCG 负责决策/执行编排（复杂度/风险评估、双模型分析审查、task.json 生命周期），质量节拍负责流程门禁（Phase 0-5 阶段检查、7 步日常循环、QM-1~4），OpenSpec 负责规格工件（change 生命周期与 specs 真相源）。三层职责不得相互替代。

#### Scenario: 新任务进入时按层路由
- **WHEN** 一个新任务进入开发流程
- **THEN** 先由 CCG 评估复杂度与风险，再由质量节拍确定所处 Phase 与门禁，M+/中高风险任务创建 OpenSpec change 承载规格

#### Scenario: 规格真相源唯一
- **WHEN** 需要确认某能力的需求定义
- **THEN** 以 `openspec/specs/<capability>/spec.md` 为准，CCG 的 requirements.md 与质量节拍的 PRD 不重复定义规格内容

### Requirement: OpenSpec change 生命周期
规格层 SHALL 遵循 spec-driven schema 的 change 生命周期：proposal（Why）→ design（How）→ specs（What）→ tasks（执行清单）→ apply（合入 specs/）→ archive（归档）。artifacts 必须按依赖顺序生成（proposal 先行，design/specs 依赖 proposal，tasks 依赖 design+specs）。

#### Scenario: 创建 change
- **WHEN** 规格层启用且用户提出需求
- **THEN** 执行 `openspec new change <kebab-case-name>`，并按 `openspec instructions <artifact> --change <name>` 的模板与依赖顺序生成 proposal.md、design.md、specs/**/spec.md、tasks.md

#### Scenario: 批准并应用
- **WHEN** change 的 design 与 specs 经质量节拍 Phase 1 评审通过且 tasks 就绪
- **THEN** 执行 apply 将规格合入 `openspec/specs/`，变更进入可追踪状态

#### Scenario: 完成后归档
- **WHEN** change 对应的实现已通过质量节拍 Phase 2-3 门禁（测试/审查/CI）
- **THEN** 执行 `openspec archive <change-name>` 归档，规格保留在 `openspec/specs/` 与 `openspec/changes/archive/`

### Requirement: 适用范围约束
规格层 SHALL 仅对 M+ 复杂度或中高风险任务强制启用；S 复杂度且低风险任务允许跳过 OpenSpec 流程，直接由 CCG + 质量节拍完成，以控制流程开销。

#### Scenario: S/低风险任务跳过规格层
- **WHEN** CCG 评估任务为 S 复杂度且低风险
- **THEN** 不强制创建 OpenSpec change，直接进入 CCG task + 质量节拍日常循环

#### Scenario: M+ 或中高风险任务必须建 change
- **WHEN** CCG 评估任务为 M+ 复杂度或中/高风险（auth/数据库/API 契约/加密）
- **THEN** 必须创建 OpenSpec change 并完成 proposal→design→specs→tasks 全流程后才允许进入实现

### Requirement: 归档三同步
change 完成时 SHALL 三同步归档：OpenSpec archive（规格）、CCG task 归档（执行记录）、质量节拍复盘/learnings（经验沉淀）；git 提交可合并为一次，避免历史噪音。

#### Scenario: 三同步完成
- **WHEN** 一个 change 的实现完成并通过全部门禁
- **THEN** OpenSpec change 归档、对应 CCG task 移入 `.ccg/tasks/archive/<yyyy-mm>/`、质量节拍复盘记录 learnings，三者以同一 commit 提交

### Requirement: delta 删除意图的声明方式
本仓 SHALL 用「标记式」表达"有意删除某条 Scenario"的意图：被删的 Scenario **仍列在** change delta 的 `## MODIFIED Requirements` 段内，并在其正文首行写 `**REMOVED**: <理由>`；同步方见到该标记 SHALL 从主规格删除这条 Scenario。

理由：openspec 工具侧的约定是「MODIFIED 块携带全部**存活**的 Scenario」，且 `openspec validate` 与 `openspec archive` 会拒绝「丢了主规格仍有的 Scenario」的块（`openspec-sync-specs/SKILL.md` 的 Key Principle 一节明写）。若把被删的 Scenario 移出 MODIFIED 块（另起 `## REMOVED Scenarios` 段或直接省略），工具会直接判红 —— 故"删除"不能靠"不在块里"表达，只能靠"在块里但带标记"表达。

标记 SHALL 只在该 Scenario 所属的 Requirement 内生效（同一 Scenario 标题可能出现在不同 Requirement 下）；标记 SHALL 附删除理由；标记 SHALL 出现在该 Scenario 正文首行。

#### Scenario: 有意删除某条 Scenario
- **WHEN** 一个 change 需要删除主规格里某条已存在的 Scenario
- **THEN** 该 Scenario 仍列在 delta 的 `## MODIFIED Requirements` 块内、正文首行写 `**REMOVED**: <理由>`；同步后主规格不再含这条 Scenario，且 `openspec validate` 不因该块判红

#### Scenario: 未声明的 Scenario 消失按丢失处理
- **WHEN** 合并后主规格相对基线少了某条 Scenario，而本 PR 的 delta 未在对应 Requirement 下用 `**REMOVED**:` 标记声明
- **THEN** 主规格基线零覆盖门禁（`scripts/check-spec-delta-coverage.js`）判红并点名该 Scenario 与所属 Requirement

### Requirement: 规格层选型决策记录
规格层 SHALL 记录选型决策与备选方案。当前决策：采用 OpenSpec（@fission-ai/openspec CLI，本地化、多 IDE 自动集成、schema 版本化）；备选 GitHub Spec Kit（quality-rhythm-sdd Preset，质量节拍 5.4 已定义但 CLI 未安装）暂不启用，切换时须更新本 spec。

#### Scenario: 查询选型依据
- **WHEN** 后续会话需要了解为何选用 OpenSpec 而非 Spec Kit
- **THEN** 本 Requirement 及其场景提供决策记录与切换条件

### Requirement: 规格化前差异审计
对既有基线创建 OpenSpec change 时，SHALL 先执行「基线 vs 现状」差异审计：核对 origin/main 已合并的交付记录与关键源码，产出「已交付 / 待办 / 待确认」三栏清单，change 的 proposal/specs/tasks 只承载真实待办与待确认项，禁止重复规格化已交付功能。

#### Scenario: 基线含已交付项
- **WHEN** 任务基线中的需求已由已合并 PR 交付
- **THEN** 对应项在 tasks 中标为 [已交付] 并附证据（file:line / 合并记录），不进入待办实现

#### Scenario: 审计先行
- **WHEN** 为既有基线创建 change
- **THEN** 在写 proposal 之前完成差异审计，审计结论记录于 change 内

### Requirement: 进度单一来源
实现进度 SHALL 以 change tasks.md 的 checkbox 为唯一来源；CCG task.json 只承载执行阶段、风险与 openspecChange 关联，不维护第二套任务清单，避免双进度漂移。

#### Scenario: 进度查询
- **WHEN** 需要确认任务实现进度
- **THEN** 以 `openspec status --change <name>` 为准，CCG task.json 仅反映当前执行阶段

### Requirement: 归档三同步自动检查
系统 SHALL 提供 `scripts/openspec-sync-check.js`：扫描 `.ccg/tasks` 下 task.json 的 `openspecChange` 关联与 `openspec/changes` 状态，并以可自动化的错误码报告三同步漂移。无关联任务不得误报。

- `status=completed` 与 `currentPhase in {completed, archived}` MUST 双向一致；任一方向不一致均为 task 元数据错误。
- `openspecState=superseded` 只能在 `supersededBy` 是非空字符串时用于豁免缺失 change；否则为 task 元数据错误。
- 当已完成 CCG task 关联的 change 仍 active 时，检查 SHALL 返回非零 workflow violation；若该 active change 的 `tasks.md` 缺失、没有 task checkbox，或仍有未完成 checkbox，检查 SHALL 额外报告可追踪性 violation。
- 已完成 task 关联的 change 既不 active 也未归档且未具备有效 supersession 证据时，检查 SHALL 返回 nonzero workflow violation。
- 输入/元数据错误使用 exit `2`；有效数据的 workflow violation 使用 exit `1`；无发现使用 exit `0`。

#### Scenario: task 完成但 change 未归档
- **WHEN** CCG task 的 `status=completed`、`currentPhase=completed` 且关联的 OpenSpec change 仍 active
- **THEN** 检查输出 active-change workflow violation，提示归档该 change

#### Scenario: active change 仍有未完成任务
- **WHEN** 一个已完成 CCG task 关联 active change，且其 `tasks.md` 含有一个或多个 `- [ ]` checkbox
- **THEN** 检查除 active-change violation 外还输出 incomplete-task-tracking violation，并包含未完成数量

#### Scenario: 终态字段双向漂移
- **WHEN** task 的 `status=completed` 与非终态 `currentPhase` 组合，或 task 使用终态 `currentPhase` 但 `status` 不是 `completed`
- **THEN** 检查把该记录报告为 task-state input error 并返回 exit `2`

#### Scenario: superseded 缺少替代证据
- **WHEN** task 的 `openspecState=superseded` 但 `supersededBy` 缺失、非字符串或 trim 后为空
- **THEN** 检查把该记录报告为 supersession-evidence input error，不允许其豁免缺失 change

#### Scenario: 无关联任务
- **WHEN** task.json 无 `openspecChange` 字段
- **THEN** 检查跳过该 task，不产生 change-state violation

### Requirement: M+/中高风险任务建 change 模板化
CCG 评估为 M+ 复杂度或中/高风险的任务，SHALL 在任务创建时同步执行 `openspec new change`，把建 change 作为固定动作而非可选项；S 复杂度且低风险任务不受此约束。

#### Scenario: M+ 任务创建
- **WHEN** CCG 评估任务为 M+ 或中/高风险
- **THEN** 任务创建步骤必须包含 openspec new change，并在 task.json 记录 openspecChange 关联

### Requirement: spec 场景与测试映射
change 的每个 WHEN/THEN 场景 SHALL 在实现时映射到对应测试（单元/集成/E2E），tasks 中标注测试目标；archive 前通过 `openspec validate` 并核对场景可追踪性。

#### Scenario: 场景有测试引用
- **WHEN** 某 spec 场景被实现
- **THEN** tasks.md 对应任务标注测试文件/用例，archive 前可追踪到验证

#### Scenario: 归档前校验
- **WHEN** 执行 openspec archive
- **THEN** 先运行 openspec validate 确认 change 有效，并核对场景-测试映射无遗漏

### Requirement: 分层分支策略
分支策略 SHALL 分层执行：运行时代码变更（apps/、packages/ 及关联配置/CI）MUST 在 `D:/Data/projects/mp-worktrees/mp-<task-name>` 下的独立 linked worktree 与**裸 `<task-name>` 分支**（`scripts/gwm-task.sh` 默认不加含斜杠前缀；需要前缀时由 `MP_BRANCH_PREFIX` 显式开启）进行，经 PR 审查与 CI 后合并回 main；共享主工作区 MUST 保持在 main，禁止运行时代码任务在共享主工作区切换 feature 分支或修改代码。纯流程/规格/文档变更（openspec/、.ccg/、docs/、scripts/ 工具脚本、CHANGELOG、.quality-gates.md）MAY 跳过独立 linked worktree 在共享主工作区就地编辑，但 MUST NOT 直接推入 `refs/heads/main`（远端分支保护对任何直推一律返回 `GH011`，required status checks 只能经 PR 满足），且 MUST 保持可回滚、不得与并发会话的脏文件冲突。判定以「是否影响运行行为」为准，禁止以文档提交夹带运行时代码。

#### Scenario: 运行时代码必须分支
- **WHEN** 变更涉及产品代码、测试、构建或部署配置
- **THEN** 必须在 D 盘独立 linked worktree 的裸任务名分支上开发并经 PR 合并回 main，不得在共享主工作区开发或提交

#### Scenario: 纯流程文档不豁免 PR
- **WHEN** 变更仅涉及 openspec/、.ccg/、docs/、工具脚本、CHANGELOG、.quality-gates.md 等纯流程/文档
- **THEN** 不要求独立 linked worktree，可在共享主工作区就地编辑并 stage 命名路径、不与并发脏文件冲突且保持可回滚；但 MUST 经 PR 落地——远端分支保护对任何推入 `refs/heads/main` 的变更一律返回 `GH011: Repository rule violations found for refs/heads/main`，直推路径无法满足 required status checks（2026-09-26 以纯 `.quality-gates.md` 回填提交实测被拒，见 PR #2411）

#### Scenario: 文档夹带代码
- **WHEN** 一次提交同时包含流程文档与运行时代码
- **THEN** 该提交按运行时代码处理，必须拆分并走独立 worktree + 分支 + PR

#### Scenario: 共享主工作区误切 feature 分支
- **WHEN** 任一会话使共享主工作区成功切换到非 main 分支
- **THEN** Git 守卫必须立即检测并恢复 main；恢复失败时必须进入 fail-closed 事故状态并给出精确恢复步骤

### Requirement: 主规格的 Purpose 完整性必须有门禁

系统 SHALL 对 `openspec/specs/**/spec.md` 的 `## Purpose` 段做**全量**自动检查：
缺失、正文为空、或仍是归档占位词（`TBD` / `TODO` / `待补充` 等开头形态）一律判失败，
并在输出里逐条点名文件与原因码。该检查 MUST 接在**不被 docs-only 短路**的执行面上。

理由：`openspec archive` 留下的 `TBD - created by archiving change …` 此前没有任何东西在看
（2026-10-07 实测：151 份主规格里 43 份如此，`git grep -l Purpose -- scripts .github` = 0 命中），
于是"先文档再代码"的前置门对这些规格静默失效。

#### Scenario: 占位词被拦下

- **WHEN** 任一主规格的 Purpose 正文以 `TBD` 开头（或整段缺失、或只有空白）
- **THEN** `scripts/check-spec-purpose.js` MUST 返回非零，并列出该文件路径与原因码
  （`TBD` / `MISSING_SECTION` / `EMPTY`）

#### Scenario: 判据必须能分辨"写好但形状特别"与"真的没写"

- **WHEN** 一份规格的 `## Purpose` 与正文之间按惯例存在空行，或正文含代码围栏
- **THEN** 检查 MUST 判其合规，MUST NOT 因取正文的实现把空行当段落结束而误判 `EMPTY`
- **AND** 存在一条锁，用**真实仓库里已写好 Purpose 的规格**验证这一点
  （第一版实现正是这样误判了 15 份，被这条锁的形态挡住）

#### Scenario: 扫描域退化不得读成通过

- **WHEN** `openspec/specs` 目录不存在、或遍历后命中 0 份 `spec.md`、或命中数低于规模下界
- **THEN** 检查 MUST 抛错并返回非零，MUST NOT 输出"全部合规"
- **AND** 两条空集出口（目录不存在 / 目录存在但零命中）MUST 各有独立回归锁
  （反证实测：只锁其中一条时，把另一条改成"判通过"的变异照样全绿）

#### Scenario: 归档增量目录不入域

- **WHEN** `openspec/changes/<name>/specs/**/spec.md` 里存在 `TBD`
- **THEN** 检查 MUST NOT 判失败 —— 那是尚未归档的提案增量，TBD 属其正常生命周期

#### Scenario: 接线位置由测试钉住而非注释

- **WHEN** 有人把这条门禁从 `changes` job 移到被 `docs-only != 'true'` 门控的 `static-gates`，
  或移到写出 `docs-only` 输出的 `classify` step 之前，或从 step 里摘掉测试点名
- **THEN** `scripts/check-spec-purpose.test.js` 的结构锁 MUST 变红
- **AND** 去掉 `.gitignore` 中对判据本体的 negation 时，同文件的 `check-ignore` 锁 MUST 变红
- **AND** 定位 step MUST 用其**语义标题**而非门禁编号，命令 MUST 落在该 step 正文内，
  注释行 MUST NOT 参与"已接线"判定（在注释里提一句脚本路径既不构成接线，也不得把位置判据骗过去）

#### Scenario: 每个 Purpose 段都被判，而不只是第一个

- **WHEN** 一份主规格里出现两个 `## Purpose` 段，第一段已写好、第二段仍是归档占位词
- **THEN** 检查 MUST 判失败，并点名"第 2 个 Purpose 段"
- **AND** 两段都合规时 MUST NOT 判失败 —— 重复标题本身不属本门禁的职责，不得把它变成噪声源

#### Scenario: 标题形态与文件编码的取值边界

- **WHEN** Purpose 标题写作 `### Purpose`，或文件带 UTF-8 前导 BOM
- **THEN** 检查 MUST 判其合规（层级 `##`/`###` 都收；BOM 先剥）
- **AND** 当标题写作 `##Purpose`（`#` 序列后无空白）时 MUST 判 `MISSING_SECTION` ——
  CommonMark 下那不是标题，"没有 Purpose 段"是事实而非误报
- **AND** BOM 档位 MUST 用"BOM 直接压在 Purpose 标题行上"的样本验证（否则该锁对判据路径失明，
  反证 M9 首跑 `NOT_RED` 即由此而来）

#### Scenario: 参数化行为必须从进程入口被验证

- **WHEN** 以 `--limit=abc` / `--min-specs=2.5` / `--min-specs=-1` 调用判据
- **THEN** MUST 以 rc=2 出声并点名坏参数，MUST NOT 静默回落默认值 ——
  旧写法 `Number('abc')=NaN` 会让 `slice(0, NaN)` 把违规明细整页吞掉而 rc 仍为 1
- **AND** `--root` / `--min-specs` / `--limit` MUST 同时接受等号式与空格式，且两式产出同一结果
- **AND** MUST 存在 `--help`（rc=0），其正文写明退出码口径：0 合规 / 1 违规或判据自身故障
  （文案带 `FAIL(closed)`）/ 2 用法错误
- **AND** 至少一条 CLI 用例 MUST 经**子进程入口**打进去：只调用导出函数不构成对参数层的覆盖

### Requirement: 远程同步的收口证据由主干历史推导，squash 尾注是本仓契约

执行记录的「远程同步」收口 SHALL 以主干历史为证据来源：一条记录被认为已同步，当且仅当**最近一次把它带入 `main` 的那次合并提交**（取向显式，非"首次新增"，见 `quality-gate-execution-record` 的归属映射条款）可被解析为带 squash 尾注 `(#NNNN)` 的已合并 PR。本仓 MUST 保持「经 PR 合并且提交信息带 `(#NNNN)` 尾注」这一惯例，因为它是该判据的唯一取证入口；合并方式改为不写尾注的形态（rebase-merge、平台默认合并、人工 merge）会使推导档整体失效，属**契约变更**，MUST 与判据变更同 PR 落地并出声。

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
