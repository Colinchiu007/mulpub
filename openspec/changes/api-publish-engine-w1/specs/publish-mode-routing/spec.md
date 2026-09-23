# publish-mode-routing (delta)

## ADDED Requirements

### Requirement: 发布模式路由总闸
每个平台 SHALL 由 `config/platforms.yaml` 的 `publishModes` 控制发布路径，取值 `api-then-dom`（默认）| `api-only` | `dom-rpa`；修改配置即可强制切换，无需改代码。未纳入波次的平台 MUST 保持 `dom-rpa` 且行为与现状完全一致。

#### Scenario: 自动降级
- **WHEN** `api-then-dom` 平台的 API 链因网络性/引擎性失败（request_error 重试尽、upload_fail、signer_degraded、未知 5xx）终止
- **THEN** 同一任务自动转 DOM RPA 路径执行，发布记录标记 `degraded:true` 与原因码

#### Scenario: 禁止降级
- **WHEN** API 链失败原因为 `risk_blocked`、`login_expired` 或参数校验错误
- **THEN** 不触发 DOM 降级，任务停报

### Requirement: 账号级发布频控
同一账号两次 API 发布提交之间 MUST 间隔 ≥18 分钟（可配置键 `publish.api.minIntervalMinutes`，默认 18）；未达窗口的任务排队等待并在界面显示等待状态，跨平台任务共享同一账号时也受该窗口约束。

#### Scenario: 边界判定
- **WHEN** 距上次提交 17 分 59 秒时有新 API 发布任务就绪
- **THEN** 任务保持排队；18 分 01 秒后放行

### Requirement: 风控挂起的用户可见行为
某平台命中 `risk_blocked` 时，MUST 挂起该平台后续发布任务（其他平台不受影响），发出一条带 `恢复发布` / `停止本批` 操作的用户通知，文案为「{平台}风控校验拦截，本次发布已停止，请稍后在应用内手动确认账号状态」；系统 MUST NOT 自动更换账号重试。

#### Scenario: 单平台挂起
- **WHEN** B站发布命中 risk_blocked，同时视频号任务进行中
- **THEN** B站后续任务挂起并弹通知，视频号任务不受影响继续

### Requirement: 发布方式显示项
发布记录列表 SHALL 展示「发布方式」徽标：`API 直发` / `网页降级`（tooltip 含原因码）/ `仅API失败`；详情含分片进度历史与平台原始响应（折叠）。所有新增用户可见文案 SHALL 成对写入 zh/en locales。

#### Scenario: 降级可观测
- **WHEN** 一次发布经 API 失败后 DOM 成功
- **THEN** 记录显示「网页降级」且验收统计可将该任务计入 degraded 集合
