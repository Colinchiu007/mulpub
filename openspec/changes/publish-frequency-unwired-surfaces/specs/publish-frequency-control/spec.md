# publish-frequency-control Delta Specification（change: publish-frequency-unwired-surfaces）

## MODIFIED Requirements

### Requirement: 间隔维度与策略单一真源

发布频率策略 SHALL 由 `packages/shared-utils` 的频率策略模块单一持有，按平台返回**三个**维度：
账号档（`platform:accountId`）、平台档（`platform:*`，同平台跨账号）、账号日配额
（`accountDailyMax`，本机运营日）。除该模块外 MUST NOT 存在第二份数值表或第二份合法域；
渲染层定时发布表单与设置页输入框的校验属于输入期 UX 校验，MUST NOT 被视为主进程执行期门禁，
也 MUST NOT 自己持有一份上界数字。

各维度的合法域上界 MUST 与数值同处定义并**对全部写入路径生效**：环境变量、设置页覆盖、
设置页输入框三者共用同一个界（日配额 `MAX_DAILY_QUOTA`、间隔 `MAX_INTERVAL_MS`）。
越界处理保持各路径既有语义：env 钳位并出声，设置页覆盖整体丢弃并回报原因。
上界 MUST 严格大于当前最大默认值（等于时下一次上调默认值会被静默钳位）。

策略模块 MUST NOT 置于 `publish-capabilities.json`（该注册表承载内容能力，与调度节奏是两类关注点）。

#### Scenario: 15 平台全覆盖且未知平台回落最严档

- **WHEN** 分别查询 wechat_mp、zhihu、weibo、douyin、xiaohongshu、tencent_video、kuaishou、
  toutiao、bilibili、baijiahao、youtube、tiktok、twitter、instagram、facebook 的间隔策略
- **THEN** 每平台返回非空的三维度值；不在表内的平台回落基线最严档，MUST NOT 回落 0

#### Scenario: 环境变量覆盖与非法值出声

- **WHEN** `MP_PUBLISH_MIN_INTERVAL_MS` 或 `MP_PUBLISH_PLATFORM_MIN_INTERVAL_MS`
  被设为合法值、`0`、或非法值（NaN/负数/非数字字符串）
- **THEN** 合法值生效；`0` 表示该档显式关闭；非法值回落默认并输出 warn 日志，
  MUST NOT 静默当作 0 处理

#### Scenario: 日配额越界在两条路径上都被拒（但拒绝方式不同）

- **WHEN** `MP_PUBLISH_DAILY_MAX_CLIP` 被设为超过 `MAX_DAILY_QUOTA` 的值
- **THEN** 生效值钳位到上界且输出一条点名该上界的告警
- **AND** 设置页覆盖里 `accountDailyMax` 或 `dailyMax[tier]` 越界时，整个覆盖对象被丢弃并回报原因，
  MUST NOT 出现"一半生效一半被忽略"

#### Scenario: UI 的上界来自下发，不来自抄写

- **WHEN** 策略模块的上界常量发生变化
- **THEN** 设置页输入框的 `:max` 随之变化（值经 `publishFreq:getPolicy` 下发），
  渲染层源码中 MUST NOT 出现该数字的第二份字面量；载荷缺字段时取"不设上界"而非回落一个自造默认值

## ADDED Requirements

### Requirement: 派生表必须有生产调用点的保留窗口维护

任何"由运行期不断追加、且有保留窗口"的本地表（本条为 `publish_daily_count`），
其裁剪实现 MUST 有**生产调用点**，且调用点 MUST 被回归锁观察到 ——
"实现完整 + 单测全绿 + 无人调用"在本仓记作装饰性链路，不是半成品。

两条附加约束：① 维护用的日键 MUST 与写入方同源（守卫的 `today()`），MUST NOT 在调用侧重算本地日期；
② 删除 MUST 按 owner 逐个进行，且判据必须锁**语句本身**带 `owner_subject` 谓词
——"逐 owner 删"与"一条跨 owner 的 DELETE"在最终删了哪些行上可以同形，只断言结果等于锁不住做法。
维护属旁路：失败只出声（WARN）不得打断启动；接不上时同样必须出声，不得静默跳过。

#### Scenario: 启动时执行一次裁剪

- **WHEN** 应用上下文构建（`extractContext`）
- **THEN** `prunePublishDailyCountAllOwners` 被调用**恰好一次**，且参数等于
  `publishIntervalGuard.today()` 的返回值

#### Scenario: 裁剪失败不影响启动，但一定留痕

- **WHEN** 裁剪抛出异常，或 store / 守卫任一侧不具备所需方法
- **THEN** 上下文照常构建完成，并输出一条含 `prune` 的 WARN；MUST NOT 静默什么都不说

#### Scenario: 破坏性日键被拒绝

- **WHEN** 裁剪入口收到形状合规但日历不存在的日键（如 `2026-13-40`，其归一化会落到未来）
- **THEN** 不删除任何行；MUST NOT 因"看起来是合法日期串"而把整表裁掉

### Requirement: 不得保留没有调用点却承诺了能力的接口

系统 MUST NOT 导出或声明任何满足以下两条的成员：① 无生产调用点；② 其文档或日志文案承诺了
一个不存在的能力入口（如"设置页确认后解除"而设置页并无该入口）。此类成员一律删除，
并把承诺改为事实（本条实测删除 `clearRollbackDisabled` 与从未被任何代码路径产出的
`PLATFORM_BUCKET_DAILY_KEY_PREFIX`）。

保留的纯观测面（如探针计数读取口）MUST 在文档里写明确切消费者；MUST NOT 用"待接线"
掩盖"没有消费者"这一事实。

#### Scenario: 停用回滚后的唯一出路是重启

- **WHEN** 某平台被探针判定接线矛盾而停用"未提交失败回滚"
- **THEN** 该停用在本进程内不可撤销，告警文案 MUST NOT 承诺任何进程内/设置页的手动解除路径；
  新建队列实例（重启语义）后该平台恢复可回滚

#### Scenario: 反证取被禁形态本身

- **WHEN** 分别把被删接口加回来、把承诺文案改回去、把 DELETE 改成跨 owner、把日键校验退回只看形状
- **THEN** 对应的锁各自变红且红的是**指名字**的用例；
  只把"被禁物的一部分"改回来的变异不算反证（它证不出锁守的是哪一格）
