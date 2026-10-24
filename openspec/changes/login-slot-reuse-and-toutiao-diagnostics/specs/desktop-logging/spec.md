## ADDED Requirements

### Requirement: 登录期网络观测必须按平台覆盖面且未登记平台行为不变

`login-network-diagnostics` 的会话级过滤面 SHALL 按平台取：已登记平台用自己的监测域清单，
未登记平台 MUST 沿用既有默认过滤面（微信域）**一字不变**（既有契约锁不得被扩大）。

- 监测域清单 MUST 是**实测得来**的登录链路资源域，MUST NOT 是拍脑袋的通配清单。
- 匹配口径 MUST 是「主机名等于监测域或为其子域」，MUST NOT 用「URL 含某字符串」这种宽匹配。
- 代理解析探针 MUST 指向该平台自己的站点（回答「这个平台的登录请求走哪条线路」）。

#### Scenario: 头条号走自己的监测域

- **GIVEN** 为头条号挂接登录期诊断
- **WHEN** 读出注册给 webRequest 的过滤面
- **THEN** 它 MUST 含头条号登录链路的监测域
- **AND** MUST NOT 含微信域

#### Scenario: 未登记平台的过滤面一字不变

- **GIVEN** 为微信平台挂接登录期诊断
- **WHEN** 读出注册给 webRequest 的过滤面
- **THEN** 它 MUST 与既有微信四条逐字相等

#### Scenario: 监测域的失败与 4xx/5xx 都要留痕

- **GIVEN** 头条号登录页上某个监测域资源请求失败或返回 5xx
- **WHEN** 会话级监听收到该事件
- **THEN** MUST 各留一条可归因日志（含端点与错误/状态码）

### Requirement: 登录期慢请求与图形验证码组件加载必须留可归因现场

「点发送验证码后页面灰显几秒才弹图形验证码」这类症状，MUST 有日志能直接回答
「哪一步卡了、卡了多久」，MUST NOT 只能靠外部抓包倒推。

- 耗时 MUST 由 CDP 的逐请求起止时刻计算（webRequest 的 details 不含耗时）。
- 超过阈值（默认 3000ms，可经环境变量覆盖）的请求 MUST 记一条慢请求日志，含耗时与阈值。
- 图形验证码组件的加载完成 MUST 单独记一条（它是用户看到的灰显遮罩结束的时刻）。
- 单次登录的慢请求条数 MUST 有上限（防刷屏），MUST NOT 无限制记录。
- 监测域之外的请求 MUST NOT 被计入。

#### Scenario: 慢请求留耗时与阈值

- **GIVEN** 监测域内某请求耗时 3500ms、阈值 3000ms
- **WHEN** 该请求结束
- **THEN** MUST 留一条慢请求日志，含耗时 3500ms 与阈值 3000ms

#### Scenario: 未达阈值不记慢请求

- **GIVEN** 监测域内某请求耗时 500ms
- **WHEN** 该请求结束
- **THEN** MUST NOT 留慢请求日志

#### Scenario: 图形验证码组件加载完成单独留痕

- **GIVEN** 图形验证码组件的两个包之一加载完成
- **WHEN** 该请求结束
- **THEN** MUST 留一条验证码组件加载完成日志，含耗时与字节数

#### Scenario: 监测域外的请求不计入

- **GIVEN** 某请求不在该平台的监测域内
- **WHEN** 该请求结束
- **THEN** MUST NOT 留慢请求日志

### Requirement: 登录期观测不得读取响应体

登录期观测 SHALL 只读事件，MUST NOT 调用 `Network.getResponseBody`：响应体可能含手机号、令牌等
用户输入，落进可被用户上传的反馈日志里即是泄露。

- 日志中的 URL MUST 去掉 query 与 fragment（只留 scheme+host+path）。
- MUST NOT 记录任何 Cookie 值、请求体、响应体。

#### Scenario: 观测层永不读响应体

- **GIVEN** 监测域内某请求返回了响应
- **WHEN** 观测层处理该响应
- **THEN** `Network.getResponseBody` MUST NOT 被调用
