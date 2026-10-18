# publish-frequency-control (delta: publish-frequency-policy-v2)

> 本 delta 于 2026-10-18 随归档做了一次**按现状重写**：capability 目录名从 `publish-frequency-policy-v2` 收敛到主干真名
> `publish-frequency-control`（否则 CLI 会因目标规格不存在而 fail-closed）；两条 MODIFIED 已**删除而非迁入**——
> 它们写的 v2 数值（账号档 20/10/3、平台档 2′）被 v3/v4/v5 三次推翻，落进主干就是让规格说谎；其语义现由主干既有需求
> （`间隔维度与策略单一真源`、`间隔阻塞必须对用户可见`）与 v5 归档带入的 4 条承载。数值一律以符号名指路，
> 不写行号（行号会漂，符号名不会）。

## ADDED Requirements

### Requirement: 提交阶段判定（不可被获益方伪造）

守卫 MUST 以**提交阶段**而非**错误类型**作为「未提交失败」的判据。发布传输层（真正发出平台写操作的那一层）MUST 在首次
平台写操作前调用一次 `markSubmitted()`，队列 MUST 将其结果记录为 `task.submittedAt`。回滚间隔窗口 MUST 仅在
`task.submittedAt` 为空时允许；错误对象上的 `notSubmitted` / `definitelyNotSent`（见
`apps/desktop/electron/services/publish-not-submitted.js`）MUST 只作**佐证位**，两者与阶段标记不一致时 MUST 按「已提交」
处理（占窗口）并记录 error 级日志。

#### Scenario: 提交前失败可立即重试
- **WHEN** 一次发布在发出任何平台请求之前失败，且该错误带 `notSubmitted` 或 `definitelyNotSent`
- **THEN** 守卫回滚该次占位，同一 (platform, accountId) 无需等待即可再次提交

#### Scenario: 提交后失败仍占窗口
- **WHEN** 一次发布已发出平台请求（`submittedAt` 已置位）后失败或超时
- **THEN** 该窗口 MUST 保持占用，后续同窗口提交被拦；回滚 MUST NOT 发生

#### Scenario: 佐证位与阶段标记不一致时 fail-closed
- **WHEN** 错误带 `notSubmitted === true` 但 `task.submittedAt` 已置位
- **THEN** 判定为已提交，占窗口，并记录 error 级日志与计数

#### Scenario: 成功发布的接线自证
- **WHEN** 一次发布**成功**但 `task.submittedAt` 为空
- **THEN** 记录 error 级日志并递增「接线缺陷」计数（把传输层漏接线从静默风险变为主动告警）

#### Scenario: 竞态输掉且执行器未收敛时不得回滚（v3 起追加的事实）
- **WHEN** 一次发布因超时/中止判输，但执行器 promise **尚未收敛**（请求可能仍在飞）
- **THEN** MUST 置 `task.submitUncertain` 并拒绝回滚；该标记按任务**终身不复位**（重试轮不得还原窗口）

#### Scenario: 某平台出现"成功但未打点"后永久停用该平台回滚
- **WHEN** 某平台命中 `_disableRollbackForPlatform`（成功而 `submittedAt` 为空，见 `packages/shared-utils/src/task-queue-frequency.js`）
- **THEN** 该平台后续失败不再回滚窗口，避免用不可靠的打点证据撤销已生效的限流保护

### Requirement: 账号级日配额

守卫 MUST 支持账号级日配额维度，与最小间隔**并存**：间隔管突发，配额管总量。日配额 MUST 按 `platform:accountId` 计数，
键为**本机运营日** `YYYY-MM-DD`（不换算平台时区、不声称与平台日界等价）。三档默认值以 `TIER_PRESETS`
（`packages/shared-utils/src/publish-frequency-policy.js`）为唯一真源：**长文 200 / 短视频 350 / 短内容 500**，
上界 `MAX_DAILY_QUOTA`（=5000，写成严格大于最大默认值，避免上调默认时撞被静默钳位）。回滚许可数由
`MAX_ROLLBACK_PER_DAY` 与档位共同决定（`packages/shared-utils/src/guard-release.js`），MUST NOT 随配额放大而失去"少量回滚"的语义。
配额被拒 MUST 以 `bucket='daily'`、`reason='daily_quota'` 表达，且 MUST NOT 以固定短间隔反复重判。
计数存储读回类型不一致时 MUST 归一（TEXT 亲和）；`dailyStore` 自身抛错 MUST fail-open 并**出声**，不得静默放行。

#### Scenario: 当日配额用尽
- **WHEN** 同一账号当日已提交次数达到该档位上限
- **THEN** `check()` 返回 `allowed=false`、`bucket='daily'`、`reason='daily_quota'`；任务进入 `_quotaBlocked`，
  `_processNext` 跳过它，定时器指向次日（`msUntilNextDay`，`apps/desktop/electron/services/store/publish-daily-store.js` 侧的 `prune*` 保留 7 天）

#### Scenario: 跨日恢复
- **WHEN** 本机运营日跨过 00:00
- **THEN** 该账号计数从 0 起算，被阻任务重新入队并重新判定

#### Scenario: 未提交回滚回补配额且幂等
- **WHEN** 一次未提交失败触发了回滚
- **THEN** 该次占用的配额计数 MUST 被回补（下限 0），且重复回滚 MUST NOT 重复回补

#### Scenario: 回滚计数只增不减
- **WHEN** 任意一次回滚发生
- **THEN** 该账号当日的回滚计数 +1，且不因配额回补而减少

### Requirement: 间隔抖动只增不减

守卫 MUST 支持可注入随机源与抖动比例；实际等待 MUST 为 `remaining × (1 + ratio × rand)`，`rand ∈ [0,1)`。
`ratio` 默认值取 `DEFAULT_JITTER_RATIO`（=0.4），非法值 MUST 回落默认并**出声**。抖动 MUST NOT 使等待短于标称最小间隔，
且抖动后仍 MUST 钳在 `setTimeout` 安全值内；`ratio = 0` 时行为 MUST 严格等于未引入抖动前的值。

#### Scenario: 抖动区间
- **WHEN** 抖动比例为 0.4 且连续采样多次
- **THEN** 每次实际等待均落入 `[base, base × 1.4)`

#### Scenario: 关闭抖动等价旧行为
- **WHEN** 抖动比例为 0
- **THEN** 实际等待严格等于标称剩余时间（与未引入抖动时逐值一致）

#### Scenario: 非法抖动比例回落并出声
- **WHEN** `MP_PUBLISH_JITTER_RATIO` 被配成空白、负数或 `>= 1`
- **THEN** 回落 `DEFAULT_JITTER_RATIO` 并打印一次告警，MUST NOT 静默当成 0（那等于关掉防突发）

### Requirement: 未登记平台出声且回落不得弱于任何已登记平台

平台未登记于策略表时，守卫 MUST 回落最严基线（`BASELINE_INTERVALS`，其账号档**引用逐平台表的最严值**而非另写数字），
MUST NOT 回落 0；并 MUST 对该平台**出声告警一次**（进程内按平台去重）。基线强度 MUST 可被自检：
`checkBaselineStrength()`（`packages/shared-utils/src/publish-frequency-policy.js`）在加载期断言回落值不弱于任一已登记平台。

#### Scenario: 未登记平台回落并告警
- **WHEN** 对未登记平台发起发布
- **THEN** 使用最严基线档位，且日志出现且仅出现一次该平台的回落告警

#### Scenario: 有人把基线改松时当场变红
- **WHEN** 回落基线的任一维度弱于某个已登记平台的现行值
- **THEN** `checkBaselineStrength()` 自检失败并出声（"新增平台忘记登记 ⇒ 更松"这条路 MUST NOT 静默成立）

### Requirement: 一次性紧急放行

系统 MUST 提供显式的一次性紧急放行入口，跳过某一 (platform, accountId) 的当前等待。每账号每日次数默认 1、上界 10；
跨账号冷却 `DEFAULT_COOLDOWN_MS`（=10 分钟）与"每日 1 次"**正交**（见 `apps/desktop/electron/services/publish-emergency-release.js`）。
放行 MUST 经二次确认、MUST 受每日次数上限与冷却约束、MUST 写入追加式审计 `publish-emergency-audit.jsonl`（UI 无编辑入口），
并 MUST 对结果给出明确回显。IPC 通道名是 `publishFreq:emergencyRelease`（`apps/desktop/electron/ipc-handlers/publish-frequency.js`）。

#### Scenario: 放行成功并留痕
- **WHEN** 用户在设置页确认紧急放行且当日次数未用尽
- **THEN** 该账号的等待被解除、任务立即进入队列，审计追加一行，设置页与进度面板同步刷新

#### Scenario: 超过每日上限
- **WHEN** 当日紧急放行次数已达上限
- **THEN** 拒绝放行，队列状态不变，界面给出上限文案

#### Scenario: 无等待中的窗口
- **WHEN** 该账号当前没有等待中的窗口
- **THEN** 明确回显「当前没有等待中的窗口」，MUST NOT 静默

#### Scenario: 功能被关闭时回显 disabled
- **WHEN** 紧急放行被整体禁用（配置/开关关闭）
- **THEN** 返回第 4 种结果态 `disabled` 并给出文案，MUST NOT 把它伪装成"无等待中的窗口"
