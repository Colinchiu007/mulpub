# publish-frequency-control (delta: publish-frequency-control)

## ADDED Requirements

### Requirement: 发布频率守卫必须在生产装配路径上生效

系统 SHALL 在任务队列执行发布前检查发布频率守卫，并在提交前完成记账。守卫实例必须由
DI 容器持有并**经生产装配路径注入** `TaskQueue`；`TaskQueue` 构造函数在生产的
`options.taskQueue` 缺省时 MUST 仍收到 `publishIntervalGuard`。任何"注册了守卫但无人注入"
的装配状态 MUST 使回归测试变红。

理由：本能力此前已有完整实现与 60+ 条单元测试，但生产调用点为 0、
`publish_timeline` 表 0 行——测试在套件内手工 `new` 守卫并注入，从不经过装配路径。

#### Scenario: 生产容器里的队列拿到守卫

- **WHEN** 以生产方式构建 DI 容器（`createContainer()` 不带参数，等价于 `bootstrap.js:77`）
- **THEN** `container.get('taskQueue')` 内部的频率守卫不为 `null`，且就是
  `container.get('publishIntervalGuard')` 同一实例

#### Scenario: 装配回归（把注入摘掉必须变红）

- **WHEN** 从 `taskQueue` 注册工厂中移除 `publishIntervalGuard` 注入
- **THEN** 装配锁用例失败；不得因"守卫仍被注册在容器里"而判为通过

#### Scenario: 死引用不得充当接线证据

- **WHEN** 源码中存在读取 `publishIntervalGuard` 但结果未被使用的语句
- **THEN** 该语句 MUST 被删除；MUST NOT 以"容器里有注册"作为能力已生效的论据

### Requirement: 间隔维度与策略单一真源

发布最小间隔 SHALL 由 `packages/shared-utils` 的频率策略模块单一持有，按平台返回两档：
账号档（`platform:accountId`）与平台档（`platform:*`，同平台跨账号）。除该模块外
MUST NOT 存在第二份间隔常量表；渲染层定时发布表单的校验属于输入期 UX 校验，
MUST NOT 被视为主进程执行期门禁。

策略模块 MUST NOT 置于 `publish-capabilities.json`（该注册表承载内容能力，
与调度节奏是两类关注点）。

#### Scenario: 15 平台全覆盖且未知平台回落最严档

- **WHEN** 分别查询 wechat_mp、zhihu、weibo、douyin、xiaohongshu、tencent_video、kuaishou、
  toutiao、bilibili、baijiahao、youtube、tiktok、twitter、instagram、facebook 的间隔策略
- **THEN** 每平台返回非空的两档间隔；不在表内的平台回落基线最严档，MUST NOT 回落 0

#### Scenario: 环境变量覆盖与非法值出声

- **WHEN** `MP_PUBLISH_MIN_INTERVAL_MS` 或 `MP_PUBLISH_PLATFORM_MIN_INTERVAL_MS`
  被设为合法值、`0`、或非法值（NaN/负数/非数字字符串）
- **THEN** 合法值生效；`0` 表示该档显式关闭；非法值回落默认并输出 warn 日志，
  MUST NOT 静默当作 0 处理

### Requirement: 账号身份缺席不得绕过频率门禁

当发布任务不携带 `accountId`（含 `publish:wechat` 固定传 `null`、
`publish:batch` 字符串形态目标归一化为 `null`）时，系统 SHALL 跳过账号档，
但 MUST 仍然执行平台档间隔检查与记账。"无账号身份" MUST NOT 等价于"无发布行为"。

#### Scenario: 无账号目标仍受平台档约束

- **WHEN** 同一平台先以 `accountId: null` 完成一次发布，随后在平台档窗口内再次提交
  该平台任务（仍为 `accountId: null`）
- **THEN** 第二次提交被阻塞并进入等待，MUST NOT 因账号缺失而被直接放行

#### Scenario: 不同账号仍各自持有账号档窗口

- **WHEN** 同平台的账号 A 刚发布，账号 B 从未发布，且平台档已满足
- **THEN** 账号 B 的账号档不阻塞；仅在平台档窗口未满时被阻塞

### Requirement: 记账必须发生在提交之前且失败仍占用窗口

系统 SHALL 在两档间隔均满足后、**调用执行器提交之前**完成记账。
任务失败、超时或被中止 MUST NOT 回滚该记账。

理由：平台侧限流窗口按"请求已发生"计时。仅在成功路径记账会让
"实际已发到平台但应用判定失败"的三类形态（执行器抛错、任务超时、重试环重入）
不占窗口，从而下一次提交不受限，且重试会重复发布。

#### Scenario: 超时任务仍占用间隔

- **WHEN** 一次发布提交后因超过 `task.timeout` 被判定失败
- **THEN** 该平台/账号的间隔窗口仍被占用，窗口内的后续提交被阻塞

#### Scenario: 重试不得立即连发

- **WHEN** 任务失败进入重试环（`retriesLeft > 0`）并重新入队
- **THEN** 重试提交前仍须通过间隔检查；等待 MUST NOT 消耗 `retriesLeft`

### Requirement: 等待中的任务必须保持可取消、可退出、可跨重启

被间隔阻塞的任务 SHALL 回到等待队列尾部或头部并保持 `status: 'pending'`、
`startedAt: null`、从运行集合移除；重排定时器 MUST 登记以便退出时统一清理，
MUST NOT 让事件循环因等待句柄而无法退出。

#### Scenario: 等待期间取消

- **WHEN** 任务处于间隔等待中且用户请求取消
- **THEN** 重排回调发现取消标记后 MUST NOT 重新入队，MUST NOT 提交

#### Scenario: 应用退出清理等待句柄

- **WHEN** `shutdown()` 在存在等待中任务时被调用
- **THEN** 所有重排定时器被清除，等待中的任务被标记为取消，不留悬挂句柄

### Requirement: 间隔阻塞必须对用户可见

系统 SHALL 通过既有 `publish:progress` 的 `phase: 'blocked'`
（`stageKey: 'waiting'`）向渲染层广播阻塞，并携带 `remainingWait`。
本要求 MUST NOT 新增相位枚举值、MUST NOT 新增引擎阶段串、MUST NOT 在渲染层
维护第二份阶段映射——消费链（`phase4-events.js` 转发、
`PublishProgressTaskRow.vue` 渲染剩余等待）已存在，本次仅补齐生产者侧。

#### Scenario: 阻塞事件携带剩余等待时间

- **WHEN** 任务因账号档或平台档间隔被阻塞
- **THEN** 渲染层收到 `phase:'blocked'` 且 `remainingWait` 为正数毫秒，
  进度行展示等待状态而非静止不动

#### Scenario: 阻塞不是终态

- **WHEN** 任务处于 `blocked`
- **THEN** `blocked` MUST NOT 被归入终态集合；到点后同一任务应继续走到
  `start`/`progress`/`success` 正常收敛
