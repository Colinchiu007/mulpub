# Spec: schedule-heartbeat-lock

## Requirement 1：每条声明了 `on.schedule:` 的作业必须有心跳读数

- 判据域 = `scripts/check-schedule-failure-watch.js::loadWorkflows` 读出的、含 `crons: [string]`（非空）的全部作业；
  **不得**在本判据里再手写一份"哪个文件有哪些 cron"的枚举（上一刀要消灭的形状）。
- 每条作业按其 cron 推出的周期与最近一次心跳判定，逐条打印 `period / last / age_hours / 阈值_hours`。
- 判据域为空（一个带 schedule 的作业都没扫到）⇒ 一律 `SCANNER_FAULT`、退出码 **2**，
  不得把"什么都没扫到"读成"全部按时跑了"。

#### Scenario: 定时作业连续多天没有 run
- **WHEN** `Cleanup Artifacts` 声明 `23 3 * * *`，而 API 返回的 completed schedule run 最近一条在 40 小时前
- **THEN** 红，档位 `LATE`，点名 `<workflow 文件>` 并打印 `age_hours=40`、`阈值_hours=32`

#### Scenario: 定时作业一次都没跑过
- **WHEN** 采集成功（HTTP 2xx、JSON 可解析、是数组）但该作业零条 `status=completed` 且 `event=schedule` 的 run
- **THEN** 红，档位 `NEVER_RAN`（**不得**与 `LATE` 合并，二者修法不同：前者查 cron/作业是否还在册，后者查 runner/配额）

## Requirement 2：心跳只认「completed 且由 schedule 触发」的 run

- `status ∈ {queued, in_progress}` 不算一次兑现；`event ∈ {push, pull_request, workflow_dispatch, workflow_run}` 不算。
- 判据必须能区分「有 push run 但没有 schedule run」与「一条 run 都没有」——前者仍判 `NEVER_RAN`，
  因为形状上"作业被别的触发跑得很勤"完全掩盖"cron 从未兑现"。

#### Scenario: 作业被 PR 触发跑得很勤但 cron 从未兑现
- **WHEN** 某作业有 20 条 `event=push` 的 completed run，零条 `event=schedule`
- **THEN** `NEVER_RAN`，且首行读数里它的 `last=` 为空（不得把 push run 的时间当 last）

#### Scenario: run 卡在排队
- **WHEN** 最近一条 schedule run 的 `status=in_progress`
- **THEN** 不视为心跳；若无更旧的 completed schedule run ⇒ `NEVER_RAN`

## Requirement 3：周期由 cron 自身推导，推不出即失明

- 5 字段 cron 的三种形状可推周期：`m h * * *` ⇒ daily 86400s；`m h * * d`（dom/mon 为 `*`、dow 非 `*`）⇒ weekly 604800s；
  `m h D * *`（dow 为 `*`、dom 为数字）⇒ monthly 31×86400s。
- 其余一律返回 null（`mon` 非 `*`、dom 含 `,` 或 `*/n`、字段数 ≠ 5、非 cron 形状），并落 `SCANNER_FAULT`、退出码 **2**。
  **禁止**"推不出就按 daily 算"。
- 一条作业声明多行 cron ⇒ 取**最短周期**（任一条按时跑过即有心跳）。

#### Scenario: cron 写成 4 段
- **WHEN** `on.schedule:` 下某条 cron 是 `30 6 * *`（缺一个字段）
- **THEN** `SCANNER_FAULT`，点名该文件并打印原串，退出码 2（不是 1）

#### Scenario: 同作业 daily 与 weekly 两条 cron
- **WHEN** `crons = ['0 18 * * 3', '23 3 * * *']`，最近一次 completed schedule run 在 30 小时前
- **THEN** 按 daily 阈值 32h 判 ⇒ `OK`；若为 33 小时 ⇒ `LATE`（证明取的是最短周期）

## Requirement 4：阈值 = 周期 + 宽限，且宽限的取值必须可重跑取证

- `阈值 = period + slack`，`slack` 默认 **8 小时**；`slack` 可由 `MP_SCHEDULE_HEARTBEAT_SLACK_HOURS` 覆盖，
  非数字 / ≤0 / 空 ⇒ 回落默认 **并 `console.warn` 出声**，每次跑在首行打印生效值。
- **不得**改成"周期 ×2"或任何按倍数的口径：实测最大相邻间隔为周期 ×1.04，倍数阈值只会把发现时间推后。
- 判据本体导出 `HEARTBEAT_PROVENANCE = {maxIntervalRatio, maxDriftHours, samplesPerWorkflow, measuredAt, slackHours, remeasure}`；
  `remeasure` 必须是可原样重跑的取数命令；`samplesPerWorkflow` 的样本量低于下界（`3`）时该格必须明写样本数，
  不得省略（防"把一次观测当定律"）。
- `monthly` 的 31 天取值属于**未实测的保守上界**，provenance 里必须逐字承认"monthly 未实测"。

#### Scenario: 环境变量写了垃圾值
- **WHEN** `MP_SCHEDULE_HEARTBEAT_SLACK_HOURS=abc`
- **THEN** 用默认 8 判定，且本次运行输出里出现 warn 行（点名非法取值与回落结果）；首行 `slack_hours=8`

#### Scenario: 有人把 slack 调小
- **WHEN** `slack_hours` 被改成使 `period + slack < maxIntervalRatio × period` 对 daily 或 weekly 成立
- **THEN** provenance 用例红，并提示"预算必须 ≥ 实测最大值 × 安全系数，先重跑 `remeasure`"

## Requirement 5：三档退出码不得互相冒充

- `0` = 全部 `OK`；`1` = 存在 `LATE` 或 `NEVER_RAN`；`2` = 存在 `SCANNER_FAULT`（采集抛错 / 非 2xx / JSON 解析不动 / 非数组 / 周期推不出 / 判据域为空）。
- `2` 优先于 `1`（"我不知道"必须先于"运维事实"被解决）。
- CLI 参数：未知旗标、`--limit` 非正整数一律走 **2**（自身故障档）并抛错出声；`--limit N` 与 `--limit=N` 两种写法都必须生效。
- 采集挂死必须落 `SCANNER_FAULT`（每作业采集有硬上限），不得静默跳过该作业。

#### Scenario: 采集器字段名写错
- **WHEN** 注入的 `runsOf` 返回的对象里没有 `status`/`conclusion`/`created_at` 任一必需字段
- **THEN** `SCANNER_FAULT`（"未知字段"不得被读成"没有 run"，更不得被读成"有 run"）

#### Scenario: API 返回非 2xx
- **WHEN** `runsOf` 返回 `{ok: false, error: 'gh api: HTTP 404'}`
- **THEN** `SCANNER_FAULT` 并点名该作业与错误原文；退出码 2

## Requirement 6：心跳锁自身必须被覆盖面锁守住

- 新作业 `.github/workflows/schedule-heartbeat.yml` 自身带 `on.schedule:` ⇒ 其名称必须出现在 `ci-failure-handler.yml`
  的作业名单里；这条由 `Gate 2b13`（`schedule-failure-watch`）机械判定，不靠自觉。
- 反向：本判据的接线锁必须断言 `schedule-heartbeat.yml` 存在、含 `on.schedule:`、且判据本体在其中被点名执行。
- 判据与行为锁只用 node 内置模块；行为锁零真实出站（由 `network-egress-guard` 保证），`now` 与采集均为注入。

#### Scenario: 心跳作业被改名而从名单里消失
- **WHEN** `schedule-heartbeat.yml` 的作业名被改而 handler 名单未同步
- **THEN** `Gate 2b13` 红（名单与 workflow 声明漂移）；同时本判据的接线锁红

#### Scenario: 摘掉 workflow 里跑判据那一行
- **WHEN** `schedule-heartbeat.yml` 里点名执行 `check-schedule-heartbeat.js` 的步骤被删除
- **THEN** H12 接线锁红（判据存在但没有执行体 = 装饰性门禁）
