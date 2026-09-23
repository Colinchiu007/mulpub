# api-publish-chain (delta)

## ADDED Requirements

### Requirement: 平台 HTTP API 发布链
发布引擎 SHALL 支持以账号 Cookie + UA 直连平台官方创作者 HTTP API 完成发布（W1：视频号视频、B站视频、百家号文章），流程为 预上传 → 8MiB 分片上传 → 合并完成 → 封面上传 → 发布提交，全程不依赖平台页面 DOM。

#### Scenario: 全链成功
- **WHEN** 账号持有有效登录态且视频/文章通过所有步骤校验
- **THEN** 返回 `{success:true, publishId, mode:"api"}`，publishId 为该作品在平台侧的真实 ID

#### Scenario: 分片边界
- **WHEN** 文件大小不是 8388608 的整数倍（含小于单片、恰为整片、非整除三种）
- **THEN** 分片计划为 `ceil(size/8388608)` 片，前 n-1 片各 8388608 字节，末片为余数，Content-Range 与文件字节严格一致

### Requirement: 响应校验与风控信号识别
每一步 API 响应 SHALL 校验为 JSON 且语义字段非空（uploadId/fileId/bvid/coverKey/作品ID）；连续重试（≤3 次）后仍收到非 JSON 响应时 MUST 判定为风控信号 `risk_blocked`，禁止将 HTML 内容当成功继续。

#### Scenario: 风控页拦截
- **WHEN** 平台返回 HTML 验证页而非 JSON
- **THEN** 重试至多 3 次后任务以 `risk_blocked` 失败，不进入降级、不自动换号

#### Scenario: 登录失效
- **WHEN** 响应命中平台登录失效码（如视频号 300330/300333/300334）
- **THEN** 任务终止并标记账号登录失效，错误提示为对应文案，不重试不降级

### Requirement: 数据校验 fail-closed
Cookie 或 UA 缺失时引擎 MUST 直接拒绝发起发布请求；签名字段为空或长度低于阈值时 MUST 拒绝拼入请求；视频文件不存在时 MUST 在发出任何网络请求前以 `io_error` 失败。

#### Scenario: 缺 Cookie 裸发防护
- **WHEN** 任务账号无有效 Cookie
- **THEN** 零网络请求发出，任务以参数校验失败终止

### Requirement: 进度回传与节流
上传进度 SHALL 按分片完成度回传（>100MB 文件每 5 秒最多一次，小文件每 10% 或每片一次），阶段文案覆盖：准备上传/获取上传参数/上传中 n%/封面处理/提交发布。

#### Scenario: 大文件节流
- **WHEN** 上传 500MB 文件持续写入分片
- **THEN** 进度事件最多每 5 秒回传一次，不刷屏

### Requirement: AI 内容声明保留
发布提交 body MUST 保留平台要求的 AI 生成内容声明字段（如快手 `ai_generated`），默认如实声明，仅在任务显式标记人工创作时关闭。

#### Scenario: 默认声明 AI
- **WHEN** 任务未显式标记人工创作
- **THEN** 提交 body 含 `ai_generated=1`（或平台等价字段）

### Requirement: 契约测试离线可跑
三条发布链 MUST 有基于本机临时 HTTP 假服务器的契约测试（断言请求序列、headers 白名单、body schema、分片 Range），在无网络环境下全部通过；测试夹具 MUST NOT 包含任何真实登录态。

#### Scenario: CI 无外发
- **WHEN** 在断开外网的 CI 中运行 api-publish-engine 测试
- **THEN** 全绿且无对公网域名的请求
