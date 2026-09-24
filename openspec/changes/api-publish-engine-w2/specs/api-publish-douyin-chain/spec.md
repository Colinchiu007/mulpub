# api-publish-douyin-chain (delta)

## ADDED Requirements

### Requirement: 抖音准自包含视频发布链
发布引擎 SHALL 以账号 Cookie + UA 直连抖音创作者 HTTP API 完成视频发布，全程不依赖平台页面 DOM、不调用任何远程签名服务：csrf 令牌由 HEAD 请求自取（`x-secsdk-csrf-request:1` → 响应头 `x-ware-csrf-token` 逗号分隔第 2 段）→ 上传鉴权（`upload/auth/v5` 返回 AK/SK/auth）→ aws4 签名（region `cn-north-1`）分片上传 → 上传完成换取视频标识 → 封面上传 → `create_v2` 提交（查询串含 cookie 来源 `msToken` 与**空 `a_bogus`**，请求头含完整 `bd-ticket-guard-*` 组与本地签出的 `bd-ticket-guard-client-data`）。提交 SHALL 支持可见性参数（验收默认私密/草稿优先，Q15）。

#### Scenario: 全链成功
- **WHEN** 账号持有有效登录态（含 security-sdk 签名材料 cookie）且视频通过所有步骤校验
- **THEN** 返回 `{success:true, publishId, mode:"api"}`，publishId 为响应 `aweme_id`

#### Scenario: 空 a_bogus 直发
- **WHEN** 构造 `create_v2` 请求
- **THEN** 查询串 `a_bogus=` 恒为空且 `msToken` 取自 cookie（缺失时按证据切片回退伪值），请求不因空 a_bogus 在客户端被拒绝——可提交性由平台响应裁决（M2 判据）

### Requirement: 本地签名材料前置校验（fail-closed）
`bd-ticket-guard-client-data` MUST 由本地实现生成：从 cookie `security-sdk/s_sdk_crypt_sdk` 双层解码（decodeURIComponent → JSON → base64 data → JSON）取 EC 私钥，从 `security-sdk/s_sdk_sign_data_key/web_protect` 取 `{ticket, ts_sign}`，对 `ticket=<ticket>&path=/web/api/media/aweme/create_v2/&timestamp=<unix秒>` 做 SHA256 私钥签名，组装 `{ts_sign, req_content:"ticket,path,timestamp", req_sign, timestamp}` 后 base64。上述任一签名材料 cookie（含 `bd_ticket_guard_client_data`、`sid_tt`）缺失或解析失败时，引擎 MUST 在发出任何发布请求前失败并提示重新授权该账号，禁止携带空签名头提交。

#### Scenario: 签名材料缺失
- **WHEN** 任务账号 cookie 缺少 `security-sdk/s_sdk_crypt_sdk`
- **THEN** 零网络请求发出，任务以「账号信息缺失，请重新授权此账号再试」语义失败（data_error，不重试不降级为伪造签名）

#### Scenario: web-version 推导
- **WHEN** ticket 以 `hash` 开头
- **THEN** `bd-ticket-guard-web-version` 取 `2`，否则取 `1`；`ree-public-key` 从 cookie `bd_ticket_guard_client_data_v2`（或 `bd_ticket_guard_client_data`）base64 解码 JSON 提取

### Requirement: 风控信号识别与 M2 裁决记录
`create_v2` 或链上任一步响应出现验证信号（响应头 `x-tt-verify-passport-decision` 非空、非 JSON 验证页连续重试后仍存在）时，引擎 MUST 判定 `risk_blocked` 并经由既有风控挂起守卫暂停该平台后续发布，等待人工确认恢复；MUST NOT 移植参考产品的自动验证（`checkByPassword`/短信）路径，MUST NOT 自动换号。每次活体验收 MUST 在文档域记录 M2 裁决结论（go：空 a_bogus 通过 ≥1 次私密发布；no-go：触发风控 → 抖音回退/保持 dom-rpa，a_bogus 算法逆转另立项）。

#### Scenario: 验证头命中
- **WHEN** `create_v2` 响应携带 `x-tt-verify-passport-decision`
- **THEN** 任务以 risk_blocked 失败、抖音平台被挂起、不发起第二次带验证令牌的提交

### Requirement: 旧骨架链下线与委托契约
`DouyinAdapter.publish` SHALL 变薄委托新发布链（§4.4 模式），旧 `aweme/post` + `_signature` 拼参骨架链 MUST 整体下线；`config/platforms.yaml` 的 douyin `publishMode` SHALL 由 `dom-only` 翻转为 `api-then-dom`，未显式声明链能力的其他平台不受影响。签名实现 SHALL 注册于进程内签名注册表，签名函数句柄与私钥材料只存内存，禁止序列化落盘/入库/入 git，禁止任何远程签名通道（`MP_SIGNER_BASE` 类）回归。

#### Scenario: 双轨降级
- **WHEN** 新链以非风控、非登录失效错误失败
- **THEN** 按 `api-then-dom` 语义降级 DOM RPA 发布并在发布日志记录 `degraded + reasonCode`

#### Scenario: 委托零外发测试
- **WHEN** 契约测试运行
- **THEN** 全部请求打到 127.0.0.1 本机假服务器，序列/头/body 与证据切片逐字段一致，无任何真实外发
