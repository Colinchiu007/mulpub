# api-publish-kuaishou-chain (delta)

## ADDED Requirements

### Requirement: 快手视频 API 发布链（spike 门禁后）
签名 spike（M3）判定 go 后，发布引擎 SHALL 以账号 Cookie 直连 `cp.kuaishou.com` 官方 HTTP API 完成视频发布：上传参数获取 → 分片上传 → 完成换取作品素材标识 → 封面上传 → 发布提交；请求序列与字段名 MUST 以 bundle 逐字切片为准（假服务器契约测试钉死），MUST NOT 依赖平台页面 DOM。提交 SHALL 支持可见性参数（验收默认私密/草稿优先，Q15），且 AI 生成内容声明字段（`ai_generated`）MUST 从既有 adapter 平移保留、默认如实声明。

#### Scenario: 全链成功
- **WHEN** 有效登录态且各步校验通过
- **THEN** 返回 `{success:true, publishId, mode:"api"}`，publishId 为平台作品 ID

#### Scenario: result=109 登录失效
- **WHEN** 链上任一步响应 `result===109`
- **THEN** 任务以 `login_expired` 语义失败，停任务不降级 DOM、不重试刷登录

### Requirement: sig3 签名经进程内注册表分派
`__NS_sig3` MUST 经进程内签名注册表 `kuaishou.ns-sig3` 命令获得，其实现按 spike 裁决取二者之一：S0 通过 → 本地公式（Tier-A）；S2/S3 通过 → 浏览器辅助签名页 provider（Tier-B）。运行时代码 MUST NOT 含任何外包签名服务 URL 常量或远程 HTTP 求签通道；签名串提交前 MUST 本地断言非空且长度 ≥40、仅拼接进白名单参数名。

#### Scenario: 签名 provider 未就绪
- **WHEN** browser-page provider 桥未注入或 `signer.degraded=true`
- **THEN** 求签以「签名页未就绪」语义失败，按 publishMode `api-then-dom` 降级 DOM（非风控、非挂起）

### Requirement: Adapter 变薄委托与双轨翻转
`KuaishouAdapter` SHALL 变薄委托新链（override `execute`，保留 granular 统一入口空安全契约），`config/platforms.yaml` kuaishou `publishMode` SHALL 在 spike go 后翻转为 `api-then-dom`；风控信号命中 MUST 经 `outcomeOfResult` 归一 `risk_blocked` → 挂起 `platform::accountId`、后续请求零发出、绝不自动换号。

#### Scenario: 风控信号挂起
- **WHEN** 发布提交返回非 JSON 验证页或频率风控文案
- **THEN** 任务 `risk_blocked`、平台账号被挂起并广播 suspend，二次同账号调用不发出任何请求
