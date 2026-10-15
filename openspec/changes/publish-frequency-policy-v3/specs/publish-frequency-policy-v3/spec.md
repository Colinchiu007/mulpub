# publish-frequency-policy-v3 (delta: publish-frequency-policy-v3)

## ADDED Requirements

### Requirement: 回滚资格由竞态收敛性决定，不得只由打点状态决定

系统 MUST 在 `Promise.race([执行器, 超时, 中止])` 结束后判定执行器**是否已收敛**，并把该结论
作为「未提交失败回滚」的前置判据。执行器尚未收敛（请求可能仍在飞）时，MUST NOT 回滚间隔窗口
与日配额，MUST NOT 声称该次尝试"未提交"。被 race 的那个 promise MUST 就是被观测收敛性的
那个 promise（不得另起一次执行器调用）。

理由：传输层的提交打点按运行中任务表查任务，任务离开该表后迟到的打点永久落空；
"没有打点"在竞态输掉那一刻**不构成**"没有发起"的证据。

#### Scenario: 超时输掉且执行器仍在飞时窗口保持占用
- **WHEN** 一次发布提交后被 `task.timeout` 判超时，而执行器 promise 尚未收敛
- **THEN** 守卫不得回滚该次占位；该平台/账号的间隔窗口仍被占用，窗口内的后续提交被阻塞

#### Scenario: 同通道第二条任务不得因上一条超时而提前发出
- **WHEN** 上一条任务在同 (platform, accountId) 通道上因超时失败，随后提交同通道的新任务
- **THEN** 新任务 MUST 被频控拦下并报 `bucket:'account'`，MUST NOT 被执行

#### Scenario: 在飞未知必须可归因且不得伪装成"未提交"
- **WHEN** 一次失败发生在执行器未收敛时
- **THEN** 该任务被置 `submitUncertain`，探针计数 `inflightUnknown` 增加一次（按任务而非按轮），
  并输出一条点名平台与任务 ID 的告警；`lastAttemptNotSubmitted` MUST 为 false

#### Scenario: 终身锁——一旦在飞未知，本任务后续轮次不得回滚
- **WHEN** 一条已置 `submitUncertain` 的任务在后续轮次失败，且该轮错误带 `definitelyNotSent=true`
- **THEN** 仍 MUST NOT 回滚窗口（回滚会还原到"第一轮仍在飞那次提交之前"的窗口，比不回滚更糟）

#### Scenario: 对偶——确证未送出的快速失败仍须照常回滚
- **WHEN** 执行器**已收敛**地失败，且从未发起写尝试或显式声明 `definitelyNotSent`
- **THEN** 窗口 MUST 被回滚、配额 MUST 回补，重试按 `releaseGraceMs` 有界退避
  （把禁止回滚写成永不回滚即撤销 v2 的免等重试能力）

### Requirement: 频率数值按档单一落点并可派生

长文 / 短视频·图文社区 / 短内容三档的账号档、平台档与日配额 MUST 各自只在一处定义，
平台表 MUST 由「档位预设 + 平台分组」派生；未登记平台的回落基线 MUST 是独立常量
（不得由档位预设派生）。`platformMinMs ≤ accountMinMs` MUST 对每个已登记平台成立，
且账号档 MUST 满足 `long > clip > short` 的严格单调。

#### Scenario: 逐档精确值
- **WHEN** 分别查询 wechat_mp、douyin、weibo 的生效策略
- **THEN** 返回 `{5′,3′,30}`、`{3′,2′,50}`、`{1′,1′,200}`；平台档取值集合为 `{1′,2′,3′}`
  （不再是统一 2′）

#### Scenario: 日配额恰为 v2 的 10 倍
- **WHEN** 按档位比较 v2 基线 (3/5/20) 与当前生效值
- **THEN** 每档恰为 10 倍；未登记平台的回落基线同步为 30，MUST NOT 让新登记平台比老平台严 10 倍

#### Scenario: 未登记平台回落最严档并出声
- **WHEN** 查询不在策略表内的平台
- **THEN** 回落 `BASELINE_INTERVALS` 并置 `fallback:true`，由守卫按平台去重输出一条告警

### Requirement: 未提交回滚的每日许可数不得随日配额放大

守卫 MUST 以 `min(max(2, accountDailyMax), MAX_ROLLBACK_PER_DAY)` 决定每账号每日的回滚许可，
`MAX_ROLLBACK_PER_DAY` MUST 是守卫导出的独立常量。日配额被调大 MUST NOT 使回滚许可同比例放大。

#### Scenario: 高日配额下仍受硬顶约束
- **WHEN** 某账号当日已回滚 5 次而其档位日配额为 200
- **THEN** 第 6 次回滚被拒绝并回报 `reason:'rollback_cap'`，窗口保持占用

#### Scenario: 封顶必须真的在管
- **WHEN** 断言当前策略表的任一档日配额
- **THEN** 其值 MUST 大于 `MAX_ROLLBACK_PER_DAY`（否则本锁测的是从不生效的死支路）

### Requirement: 有界退避等待中的任务必须仍可观测与持久化

任务因回滚成功而进入 `releaseGraceMs` 退避时，系统 MUST 把它登记进频控等待承载处
（与 `publish:blocked` 同一处）并持久化队列快照；`getStatus()` / `getPendingTasks()` /
`serialize()` MUST 在该期间仍能看到它，`cancel()` MUST 能取消它。

#### Scenario: 退避期间仍可查、可序列化
- **WHEN** 一次未提交失败刚完成回滚并进入退避
- **THEN** 该任务出现在待办列表与队列快照中；重启后可恢复，MUST NOT 只活在定时器闭包里
