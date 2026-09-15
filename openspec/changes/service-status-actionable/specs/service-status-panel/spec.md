## ADDED Requirements

### Requirement: 服务状态聚合返回故障归因

服务状态聚合接口（IPC `services:get-status`）SHALL 为每一项返回 `reason` 字段，取值限定为 `ok` / `not_started` / `on_demand` / `connection_refused` / `timeout` / `http_error` / `unhealthy` / `unknown`，用于区分「从未启动」「进程存活但无响应」「端口被占用」等故障模式。

接口 SHALL 保持既有 `status` 三态枚举（`running` / `stopped` / `standby`）不变，`reason` 作为向后兼容的新增字段提供。

#### Scenario: 进程未启动的归因
- **WHEN** 某 Python bridge 的运行标志为 false 且健康检查失败
- **THEN** 该项 `status` 为 `stopped`，`reason` 为 `not_started`

#### Scenario: 进程存活但健康检查失败
- **WHEN** 某 bridge 的运行标志为 true 但健康检查失败并给出具体原因
- **THEN** 该项 `status` 为 `stopped`，`reason` 采用健康检查给出的具体原因（如 `timeout` / `http_error`）

#### Scenario: 健康检查支持归因
- **WHEN** 调用 `BasePythonBridge.healthCheckDetail()`
- **THEN** 返回 `{ ok, reason, statusCode }`，且 `healthCheck()` 保持原有布尔返回值语义不变

#### Scenario: 探测超时与连接错误互不覆盖
- **WHEN** 一次探测同时触发 `destroy()` 与 `error` 事件
- **THEN** 归因取先到达者，不被后到达的事件覆盖

### Requirement: 按需服务必须显式标注

按需懒启动、无常驻实例的服务 SHALL 通过 `onDemand: true` 与 `reason: 'on_demand'` 显式标注，且不得以隐式空引用（如向状态提取函数传入 `null`）产生默认状态。

#### Scenario: 对齐引擎的按需标注
- **WHEN** 查询服务状态
- **THEN** 对齐引擎项返回 `status: 'standby'`、`reason: 'on_demand'`、`onDemand: true`、`restartable: false`

#### Scenario: 按需状态不视为故障
- **WHEN** 计算整体健康度
- **THEN** `standby` 与 `running` 同样计入健康，不触发降级汇总

### Requirement: 支持按服务重启

应用 SHALL 提供按服务重启的 IPC 通道 `services:restart`，仅接受白名单内的服务 key（`mainBackend` / `splitterEngine` / `promptEngine` / `callbackServer` / `mediaServer`），并 SHALL 在服务未暴露可用启动入口时拒绝该请求。

该通道 SHALL 要求可信调用来源；未登录状态下调用 SHALL 被拒绝（属写操作，不进入未登录可见通道白名单）。

#### Scenario: 成功重启
- **WHEN** 对白名单内且存在启动入口的服务发起重启
- **THEN** 调用其 `ensureRunning()` / `start()` / `startPythonBackend()` 中优先级最高者，返回成功

#### Scenario: 白名单外的 key
- **WHEN** 请求受理一个不在白名单内的服务 key
- **THEN** 返回校验错误，不产生任何副作用

#### Scenario: 服务无启动入口
- **WHEN** 请求重启一个未暴露启动入口的服务
- **THEN** 返回「不可用」错误，不抛异常

#### Scenario: 并发重复请求
- **WHEN** 同一服务的重启请求仍在进行中再次发起请求
- **THEN** 第二次请求返回「进行中」错误，且底层启动入口仅被调用一次

#### Scenario: 重启失败
- **WHEN** 启动入口抛出错误
- **THEN** 返回失败结果并携带错误消息，不向渲染进程抛出异常

#### Scenario: 不可信来源
- **WHEN** 非可信来源调用重启通道
- **THEN** 返回鉴权错误，且不调用任何启动入口

### Requirement: 面板可展开服务详情并提供重试

服务状态面板 SHALL 允许用户点击单个服务项展开详情，展示该服务的故障归因文案与最近一次运行时间（若曾运行），并在该服务可重启且当前非运行态时提供「重试连接」入口。

#### Scenario: 展开与折叠
- **WHEN** 用户点击同一服务项
- **THEN** 首次点击展开详情，再次点击折叠

#### Scenario: 展示归因与上次运行时间
- **WHEN** 展开一个故障服务
- **THEN** 显示对应归因文案；若该服务曾被观测到运行，另显示上次运行时间

#### Scenario: 重试按钮显隐
- **WHEN** 服务可重启且状态非 running
- **THEN** 显示重试按钮；否则不显示

#### Scenario: 重试失败反馈
- **WHEN** 重试返回失败
- **THEN** 在详情区内展示对应错误文案，未知错误码回退为通用失败文案

#### Scenario: 重试进行中
- **WHEN** 重试请求尚未返回
- **THEN** 按钮显示进行中文案且被禁用，重复点击不产生第二次请求

### Requirement: 轮询按健康度退避

服务状态轮询 SHALL 在全部健康时使用固定间隔；在存在故障时按指数退避延长间隔并设上限；恢复健康后 SHALL 立即回落到固定间隔。

#### Scenario: 健康时固定间隔
- **WHEN** 所有服务均为 running 或 standby
- **THEN** 以 10 秒为间隔轮询

#### Scenario: 降级时退避
- **WHEN** 存在服务为 stopped
- **THEN** 轮询间隔按 10s→20s→40s→60s 递增并封顶于 60 秒

#### Scenario: 恢复健康后回落
- **WHEN** 服务从故障恢复为健康
- **THEN** 下一次轮询间隔回落至 10 秒

#### Scenario: 轮询幂等启停
- **WHEN** 重复调用启动轮询，或在停止后经过若干间隔
- **THEN** 不产生并行轮询；停止后不再发起新请求

### Requirement: 面板摘要以故障数为中心

服务状态摘要 SHALL 在存在故障服务时优先呈现不可用服务数量与运行比例，而非仅呈现运行中数量；摘要 SHALL 在降级时提供区别于正常态的视觉提示，并在用户启用减少动态偏好时降级动效。

#### Scenario: 降级摘要
- **WHEN** 存在 N 项 stopped 服务
- **THEN** 摘要显示「N 项服务不可用（M/总数 运行中）」

#### Scenario: 全部健康摘要
- **WHEN** 所有服务均为 running 或 standby
- **THEN** 摘要显示全部运行，且状态指示为正常态样式

#### Scenario: 减少动态偏好
- **WHEN** 系统启用 prefers-reduced-motion: reduce
- **THEN** 降级状态的脉冲动画关闭

#### Scenario: 可访问性
- **WHEN** 面板与服务行渲染
- **THEN** 面板触发器暴露展开状态与摘要标签，服务行暴露 `aria-expanded` 以反映详情展开状态
