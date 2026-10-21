## ADDED Requirements

### Requirement: 债务守门输入变更后必须重算在飞 PR 并点名陈旧结论

系统在 `scripts/debt-baseline.json` 或 `scripts/check-debt-budget.js` 于主干发生变化后，SHALL 对每个 open PR 计算「该 PR 与当下主干的合并态」，并在**该合并态**内调用 `scripts/check-debt-budget.js` 重算债务结论；凡结论不再是"在基线内"的 PR，SHALL 在其 PR 上留一条可点名的评论。该重算 SHALL NOT 成为 required check，SHALL NOT 改动分支保护或 ruleset，且 SHALL NOT 自动 rebase 或代点合并任何人的 PR。

#### Scenario: PR 未动基线时被主干当下的新基线量

- **WHEN** 一笔 open PR 完全没有改动 `scripts/debt-baseline.json`，而主干基线在该 PR 最后一次绿 run 之后被收紧
- **THEN** 重算必须在「PR + 主干」的合并态里读到**主干那份**基线并据此判定
- **AND** 该判定必须由一条真 git 临时仓库集成用例证明（真跑 merge-tree → commit-tree → 只读 worktree），不得只断言源码里出现了某个字符串

#### Scenario: PR 自己提议的基线不得被主干覆盖

- **WHEN** 一笔 PR 自己改动了 `scripts/debt-baseline.json`
- **THEN** 重算必须采用该 PR 提议的那份（合并态里的结果），SHALL NOT 用主干 blob 覆盖它
- **AND** 把这条"不特例"改成"取主干覆盖"时，上述集成用例必须当场变红

#### Scenario: 量不到必须单列，不得读成通过

- **WHEN** 某笔 PR 因合并冲突、浅历史或 fetch 失败而无法构造合并态，或被调用的判据自身报错
- **THEN** 该 PR 必须分别归入 `UNJUDGEABLE` 与 `CHECKER_FAILED` 两档之一，SHALL NOT 折叠进 `IN_BASELINE`，也 SHALL NOT 与"违规"混成一档
- **AND** 把 `UNJUDGEABLE` 折进 `IN_BASELINE` 的变异必须让对应计数行断言变红

#### Scenario: 计数行在空集时仍必须出行

- **WHEN** 一轮重算没有任何 open PR，或全部 PR 都在基线内
- **THEN** 输出必须逐档打印计数（含 0），形如 `rows=<n> IN_BASELINE=<a> VIOLATES=<b> UNJUDGEABLE=<c> CHECKER_FAILED=<d>`
- **AND** 不得因"没有违规"而整行缺失——本仓已实测过"空数组被读成已通过"的同型缺陷

#### Scenario: 量到了就不该让 CI 红，工具坏了必须红

- **WHEN** 一轮重算对每笔 PR 都拿到了 `IN_BASELINE` 或 `VIOLATES` 结论（即使全部违规）
- **THEN** 作业必须以退出码 **0** 结束——本能力是报告，不是闸门；把"有债"判成 CI 红会诱导人去改评论而不是改债
- **AND** 当出现 `unrelated-histories`、`ref-missing` 或评论写入失败时，作业必须以**非 0** 结束，且只打印一次归因、不得逐条去刷 PR 评论

#### Scenario: 构造不出合并态时归因必须落在封闭词表内

- **WHEN** `git merge-tree` 因故无法产出合并态
- **THEN** 必须按 `rc` 与 stdout 形状分类（真冲突的实测形状是 **stderr 完全为空**），SHALL NOT 以"stderr 有没有内容"作为分类依据
- **AND** `UNJUDGEABLE` 的 `reason` 必须取自封闭集合 `{conflict, unrelated-histories, ref-missing, worktree-setup}`；把"浅历史导致的 unrelated histories"归成 `conflict` 会使一次 `fetch-depth` 配错在 30 个 PR 上伪装成"这些 PR 都合不进主干"

#### Scenario: 评论按标记幂等更新

- **WHEN** 同一笔 PR 被多轮重算
- **THEN** 评论正文首行必须携带机器标记 `debt-baseline-recheck:v1`，命中既有标记条目时 SHALL 更新该条目而非新增
- **AND** 判据 SHALL NOT 要求标记里的 `base=`/`judged=` 值等于当下值（那会把自家历史评论全判成过期）；这两个字段是给人看的现场，不是判据输入

### Requirement: 重算链不得引入第二份债务度量实现

`scripts/check-debt-recheck.js` SHALL 只负责"什么时候、在哪个树上调 `scripts/check-debt-budget.js`"以及结论分类，其一切外部依赖（git 执行、判据调用、HTTP）SHALL 由调用方注入，以便在无网络环境（测试面受 `network-egress-guard` 约束）下逐条验证决策与渲染。

#### Scenario: 度量口径只有一处

- **WHEN** 需要判断"合并态是否在基线内"
- **THEN** 必须经注入的判据调用取得 `check-debt-budget.js` 的原始输出与退出码，SHALL NOT 在重算脚本内自行复算任何指标（行数、扇出、循环依赖）
- **AND** 该约束由结构锁与行为锁共同守住：行为锁断言"判据退出码 0/非 0/自身崩溃"三种输入映射到三档不同结论；结构锁断言重算脚本内不出现任何指标常量表

#### Scenario: 测试面不得真实出站也不得真实克隆整仓

- **WHEN** 跑 `scripts/check-debt-recheck.test.js`
- **THEN** 全部用例必须在注入依赖或 `os.tmpdir()` 的临时小仓库里完成，SHALL NOT 访问网络、SHALL NOT 克隆本仓
- **AND** 该测试文件必须与实现同 PR 登记进 `quality-gate.yml` 的未被 docs-only 短路的作业，否则等于没写


### Requirement: 对他人 PR 的写入面必须默认关闭，开启后受每轮预算与写前状态二次核查约束

系统在重算链中向**任何人的** open PR 写评论的那一步，SHALL 默认关闭：仅当环境变量 `MP_RECHECK_COMMENT` 取值为字符串 `1` 时才执行写入；其它取值（未设、空串、`0`、`true`、`01`）SHALL NOT 放行写入。开启后，单轮写入条数 SHALL 受 `MP_RECHECK_MAX_COMMENTS` 约束（默认 `10`；`0` 是合法值，语义为"只点名不写"；非负整数以外的取值 SHALL 回落默认并出声告警，SHALL NOT 静默）。每次写入前 SHALL 重新核查该 PR 仍处于 `OPEN`；状态取不到时 SHALL 按未证实处理而不写。上述约束 SHALL 由**行为级**用例证明——注入 `gh`/`git`/判据 seam，比较"门闩关"与"门闩开"两档下实际发生的写调用次数——SHALL NOT 仅以"源码里调用了门闩函数"这类结构断言代替。

#### Scenario: 门闩未开时一次写调用都不能发生

- **WHEN** 以不含 `MP_RECHECK_COMMENT` 的环境运行 `--live`（注入夹具：两笔 VIOLATES 的 PR）
- **THEN** 注入的 `gh` 必须收到过 `pr list`（证明跑的是注入面而非真实进程），且 `-f body=` 形态的写调用次数必须为 0
- **AND** 输出必须逐条留痕"本来会写谁"（`would-comment pr=<n>`），否则关档读起来等同"没有违规"

#### Scenario: 开启后每轮写入不得突破预算

- **WHEN** `MP_RECHECK_COMMENT=1` 且 `MP_RECHECK_MAX_COMMENTS=2`，而本轮有 3 笔需点名的 PR
- **THEN** 只允许发生 2 次写调用，并必须打印"已达上限"一行；把上限判据摘掉的变异必须让该用例变红
- **AND** `MP_RECHECK_MAX_COMMENTS` 取 `abc`/`-1`/`2.5`/空串时 SHALL 回落默认 10 并出声；取 `0` 时必须一条都不写（不得被"假值回落"吃掉）

#### Scenario: 写入前必须复查 PR 仍然 open

- **WHEN** 清单拉取后该 PR 已被合并（`state=MERGED`），或状态查询自身失败
- **THEN** 必须跳过写入并打印实际读到的状态值（读不到时打印 `unreadable`），SHALL NOT 把"工具读不到"读成"它大概还 open"

#### Scenario: 结构断言不得冒充行为断言

- **WHEN** 只保留"源码中出现 `shouldCommentOn(env)` 恰好一次"这条结构锁、而 `live()` 的写路径没有任何行为用例
- **THEN** 本 Requirement 视为未满足；必须存在一条注入夹具的用例，在两档环境下断言写调用次数差
- **AND** 把门闩退回 truthy 判定（`Boolean(env.MP_RECHECK_COMMENT)`）的变异必须让门闩用例变红


### Requirement: 「哪些文件算守门输入」必须从 debt-guard.yml 的阻断 step 派生，不得由人抄一份

系统在决定重算触发面时，SHALL 以 `debt-guard.yml` 实际执行的**阻断** step 为唯一来源：每个 `node <脚本>` 调用 SHALL 进集合，且每个阻断脚本 SHALL 连带它自己声明的基线/账本文件（按 `path.join(__dirname, '<file>.json')` 字面量解析）一起进集合；带 `continue-on-error: true` 的软门禁 step SHALL NOT 进集合（改了它不会让任何 required check 由绿变红）。workflow 的 `paths:` 清单 SHALL 由一条机械锁与该派生集合对账，出现未覆盖项时 SHALL 变红。

#### Scenario: 新增一个阻断性债务判据会同时要求触发面跟进

- **WHEN** 有人在 `debt-guard.yml` 里加一个不带 `continue-on-error` 的 `node scripts/<新判据>.js` step，而本 workflow 的 `paths:` 没有列它
- **THEN** 对账锁必须变红并点名缺的那一项，SHALL NOT 靠"注释里写了要记得同步"过关

#### Scenario: 软门禁不得被算成守门输入

- **WHEN** `debt-guard.yml` 的某 step 带 `continue-on-error: true`（本仓现场是死代码检测）
- **THEN** 派生集合必须排除该 step 里的脚本；把排除判据摘掉的变异（M13）必须让集合断言变红

#### Scenario: 账本与判据本体是同一件事的两半

- **WHEN** 某阻断脚本声明了自己的基线文件（如 `check-debt-budget.js` → `debt-baseline.json`、`check-max-lines.js` → `max-lines-baseline.json`）
- **THEN** 派生集合必须同时含脚本路径与该基线路径；只收脚本名的变异（M14）必须让**两条**用例变红——其中一条夹具内不含软门禁 step，专为把 M13 与 M14 的红集分开
