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
每个 workflow MUST 取**最新**一次 run（`run_number` 与 `run_attempt` 同时最大），
再取该 run 的**作业级**终态（`{name, status, conclusion}`）作为主干侧读数行。
PR 侧 MUST 仍读 `commits/<sha>/check-runs`。
两侧的**行粒度 MUST 一致**（都落在作业名这一层：check-run 名 == 作业名），差集按名字对齐；
但两端**取数端点不同**（主干 `actions/runs`、PR `check-runs`），
MUST NOT 把「行粒度一致」表述成「同一个 API」。

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
（`--attempts`，默认 3；`--retry-seconds`，默认 90）。重试耗尽 ⇒ MUST 判「未证实」
（退出码 3）并点名两个 sha。**MUST NOT** 把 tip 钉死在旧 sha 上继续判绿。

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
