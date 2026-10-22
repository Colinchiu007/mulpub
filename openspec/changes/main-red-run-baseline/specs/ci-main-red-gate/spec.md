# ci-main-red-gate

## Purpose

规定「主干红着就别往里合」这道合并闸门（`scripts/check-main-red.js` + `scripts/lib/main-red.js`）
**读什么**、**读到一半主干动了怎么办**、**读不到怎么办**。目标是让「主干是否绿」这个判断
在多会话并发合并的场景下**可证伪**：要么给出可归因的红，要么给出「未证实」的诚实读数，
不得因为噪声或移动目标而假装读到了「主干绿」，也不得因为读数不可用而永远卡住合并。

## ADDED Requirements

### Requirement: 主干基准必须来自该 tip 的非 workflow_run run 集合

系统 SHALL 以 `actions/runs?head_sha=<tip>` 为主干基准来源（**MUST 分页**：`--paginate` +
`per_page=100`；实测单页装不下 30+ 个 run 的 tip），并且**只取 `event != 'workflow_run'` 的 run**；
每个 workflow MUST 取**最新**一次 run，判定序 MUST 为
`run_number` → `run_attempt`（**缺失时按 1 计**）→ 时间戳兜底（`updated_at` 优先，其次 `created_at`），
MUST NOT 依赖 API 返回顺序的隐含假设（选错 run 会污染基准）。
再从端点 `actions/runs/{run_id}/jobs` 取该 run 的**作业级**终态（`jobs[].name/status/conclusion`）
作为主干侧读数行。作业名即 check-run 名（GitHub 用作业名做 check run 名）。
PR 侧 MUST 仍读 `commits/<sha>/check-runs`。
两侧的**行粒度 MUST 一致**（都落在作业名这一层），差集按名字对齐；
但两端**取数端点不同**（主干 `actions/runs`、PR `check-runs`），
MUST NOT 把「行粒度一致」表述成「同一个 API」。

**同名多行 MUST 取最严格的一格**（`fail` > `unknown` > `pending` > `skipped` > `pass`）：
跨 workflow 的同名作业（如 `Changes` 在多个 workflow 各有一份）、可重用工作流的
`调用方 / 被调方` 聚合作业名、重跑行，都会让同一个名字出现多行。
不聚合的话同名「一红一绿」会同时落进 fail 集与 pass 集，差集行为不确定。
**两阶段顺序 MUST 明确**：**先**按 workflow 取最新一次 run，**再**按作业名聚合（取最严格的一格）。
**已知局限**：消歧到 workflow 级需要两侧都改取数方式（PR 侧要从 check-run 反查所属 workflow），
本片不做——差集仍按名字对齐。

**两侧名字集合 MUST 同层**：PR 侧 check-run 名 == 主干侧 `jobs[].name` == **作业名** ⇒ 差集口径未变。
**缺格方向 MUST 是保守的**：某条检查在主干侧缺席（该 tip 上没跑）时，
PR 侧同名红 MUST 仍判「新增红」（MUST NOT 因主干缺格而被读成「既有红」）。
**已知局限**：「required check 在该 tip 上没跑 ⇒ 主干绿」这一面本片不额外收紧——
那需要引入一份 required 名单（属「改谁来守门」，须人工过目）。

**基准的事件范围**：MUST 等于该 tip 上的**全部非 `workflow_run` run**（含 `push` / `schedule` /
`workflow_dispatch`）。`pull_request` 事件的 run 的 `head_sha` 是 PR 分支提交，
只有当它恰好等于 tip 时才会落进这个集合（此时它验的就是这个提交，计入是安全的）。
唯一被排除的 MUST 是 `workflow_run` —— 它是「对别的 CI 的反应」，不是「主干自己的验证」。

**失败处理**：任一 API 调用失败（429 / 5xx / token 失效 / 分页中断 / 403 权限不足）MUST 抛错
⇒ 闸门判自身故障（退出码 4），MUST NOT 读成「无检查」或「主干绿」；
分页中断时 MUST **整次读数作废**（MUST NOT 合并已读到的部分页）。
`actions/runs` 需 `actions:read`、`check-runs` 需 `checks:read`——两者 scope **不同**。
本判据是**本地工具**（由合并入口调用，用 gh CLI 的本机凭据），CI 只跑它的测试（不联网）⇒
MUST NOT 因此修改任何 workflow 的 `permissions`，MUST NOT 新增仓库 secret。
凭据不足导致 403 时 MUST 走上面的 fail-closed 路径，MUST NOT 静默返回空。

**请求预算**（depth 评审 i8）：一次读数的请求数 = 1（runs 列表，分页）+ N（逐 run 取 jobs），
N = 该 tip 的非 `workflow_run` workflow 数（实测 6–8）⇒ 每次尝试 ≤ 9 次；
有界重试最多 3 次尝试 ⇒ 单次判定 ≤ 27 次请求。长期 429 会把闸门钉在 rc=4（fail-closed，可重跑）。

理由（实测，2026-10-22）：GitHub 把 `workflow_run` 触发的工作流的 check run 一律挂在
**默认分支当前 tip** 上，不管触发它的是哪个 PR 的 CI。实测主干 tip 上 102 条检查行里
**81 条**是同一个 `handle-ci-failure`（来自 30 个 handler run），真实信号只有 21 行；
闸门实测 `mainPending=4` 而真实未完成只有 2 条——**另一半是噪声**。
按 `event` 过滤是按语义过滤：今后任何新增的 `workflow_run` 触发的工作流都自动被排除。

#### Scenario: workflow_run 触发的检查不得进入主干基准

- **WHEN** 某 tip 上存在 `event == 'workflow_run'` 的 run（CI Failure Handler 即是）
- **THEN** 该 run 的任何作业名 MUST NOT 出现在主干侧读数行里
- **AND** 主干侧读数行数 MUST 等于该 tip 的非 `workflow_run` run 的作业数之和
- **AND** 仅有噪声的 tip MUST NOT 让主干侧变成「零行」（零行按未证实处理，不得读成绿）

#### Scenario: run 的 event 字段缺失 = 形状不认识

- **WHEN** 某条 run 没有 `event` 字段（宿主改了投影或形状变了）
- **THEN** 采集 MUST **抛错**（⇒ 闸门判自身故障，退出码 4）
- **AND** MUST NOT 把它当作「不是 workflow_run」放行——那等于把「没读到事件类型」读成「它是主干自己的验证」

#### Scenario: 同一 workflow 的多次 run 取最新一次

- **WHEN** 同一 tip 上同一 workflow 存在多个 run（重跑 / 重新触发）
- **THEN** MUST 只取 `run_number` 与 `run_attempt` 同时最大的那一次
- **AND** 更早那次的失败结论 MUST NOT 进入主干基准（否则「重跑已修复」会被读成「主干仍红」）

#### Scenario: 采集层不得静默回落到旧数据源

- **WHEN** 采集层没有提供 `mainRowsAt`
- **THEN** 闸门 MUST 判自身故障（退出码 4）并说明缺哪个接口
- **AND** MUST NOT 退回读 `commits/<tip>/check-runs`（那是噪声源，结构锁亦须拦住这条回落）

### Requirement: 读数期间主干 tip 移动即作废读数并有界重试

系统 SHALL 在一次读数**前后各取一次** `origin/main` tip：两次不一致 ⇒ 本次读数**作废**
（主干基准与 PR 读数不在同一棵树上，差集不可归因），MUST 以有界次数重试
（`--attempts`，默认 3；`--retry-seconds`，默认 90；`--max-wait-seconds`，默认 180）。
重试耗尽 ⇒ MUST 判「未证实」（退出码 3）并点名两个 sha。**MUST NOT** 把 tip 钉死在旧 sha 上继续判绿。

**每次尝试 MUST 先 `git fetch origin main` 再 `rev-parse origin/main`**（不 fetch 的话本地
remote-tracking ref 不会变，稳定窗永远不会触发）；fetch 失败 ⇒ 抛错 ⇒ 判自身故障（退出码 4）。

**比较对象 MUST 是 tip SHA**（`origin/main` 的 rev-parse 结果），不是完整数据集：
SHA 相同即视为稳定、继续判读、不重试；SHA 不同才作废本次读数。
**重试的唯一触发条件 MUST 是 tip SHA 变化**：同一 SHA 上的未完成作业 MUST NOT 触发重试
（那由判据既有的「未证实」档 rc=3 处理——重试解决的是「判的是哪棵树」，不是「作业跑完没有」）。

**时间预算 MUST 写清且自洽**：3 次尝试 ⇒ **最多 2 次等待** ⇒ 2 × 90s = **180s**，
与 `--max-wait-seconds` 的默认值相等（上限在默认档刚好咬住）。

**每次尝试 MUST 重新取当前 tip**（fetch + rev-parse），MUST NOT 复用上一次的 sha：
下一次尝试从**新的当前 tip** 开始。这样「重试」既不是死等同一个 sha，也不是钉死在旧 sha。

#### Scenario: tip 移动后重试拿到稳定读数

- **WHEN** 第一次读数期间 tip 从 A 移到 B，重试时 tip 稳定在 B
- **THEN** 闸门 MUST 用 B 的读数重新判定，并在读数输出里打印 A→B 的移动事实
  （独立成行，MUST NOT 改变 `MAIN-RED verdict=` 行的字段形状）
- **AND** 若 B 上无红且 PR 侧无红，MUST 判 OK（退出码 0）

#### Scenario: 重试耗尽仍不稳定

- **WHEN** 全部重试都遇到 tip 移动
- **THEN** MUST 判「未证实」（退出码 3）
- **AND** reason MUST 点名最后一次的读数 tip 与读数后的 tip 两个 sha
- **AND** MUST NOT 报「新增红」（基准已作废，差集不可归因）

#### Scenario: 基准作废时不得把 PR 侧的红报成新增红

- **WHEN** tip 移动导致基准作废，且 PR 侧有一条已证实的红
- **THEN** MUST 判「未证实」并把该红列在 reason 里
- **AND** MUST NOT 判「新增红」——那会把「不可归因」读成「证据」
- **AND** MUST 把 PR 侧已证实的失败名**机器可读地**交出（`prFailNames`），
  并用 `newRedComputed=false` 明示「本档的新增红是**未计算**，不是零」——
  下游 MUST NOT 把这一档的 `newRed` 读成「没有新增红」

### Requirement: 稳定窗的总等待必须有上限

系统 SHALL 给稳定窗的累计等待设一个有限上限（`--max-wait-seconds`，默认 300）：
再睡一次就会超过上限时，MUST 停止重试并把这一档按「未证实」（退出码 3）交出，
MUST 打印「因上限停手」的事实，MUST NOT 静默延长。
理由：`attempts × retry-seconds` 是调用方可传的，没有上限就等于「重试」可以无限睡。

#### Scenario: 上限为 0 时只尝试一次

- **WHEN** `--max-wait-seconds 0` 且第一次读数就遇到 tip 移动
- **THEN** MUST 只尝试一次就停手（不得进入第二轮）
- **AND** MUST 判「未证实」（退出码 3）并打印上限停手的事实

### Requirement: 闸门的档位与退出码契约不因本片改变

系统 SHALL 保持既有退出码语义不变：`0` 可合、`1` 本 PR 新增红、`2` 主干红、
`3` 未证实、`4` 判据自身故障——共**五档**（AGENTS 口语里的「四档」指**不可合**的那四档 1/2/3/4，
不含 `0`）。「tip 移动」MUST 归入既有的「未证实」档（3），
MUST NOT 引入第 5 个退出码（即 MUST NOT 出现 `5`）；读数行（`MAIN-RED verdict=…`）的字段形状
MUST NOT 改变。

#### Scenario: 退出码集合仍是 0–4

- **WHEN** 检查 `scripts/lib/main-red.js` 的退出码集合
- **THEN** MUST 恰好覆盖 0、1、2、3、4 五档，**且没有第 5 档**
- **AND** 五个档位名（OK / NEW_RED / STOP_MAIN_RED / INCOMPLETE / SELF_FAULT）MUST 全部存在
