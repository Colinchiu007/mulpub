# api-publish-chain (delta)

## ADDED Requirements

### Requirement: 签名 provider 双形态进程内分派
发布链所需签名 MUST 一律经进程内签名注册表（`api-signer-registry` 契约 `{signCommand, payload} → signature`）分派，实现形态限两类：`local`（纯计算，Tier-A）与 `browser-page`（浏览器辅助签名页桥接，Tier-B，仅 `verified` 槽位可服务）。任何形态均 MUST NOT 引入远程 HTTP 签名通道或外包签名服务 URL 常量（Q16 拆除形态永久化）；`browser-page` 桥未注入/降级时求签 MUST 以可识别错误语义失败并按 publishMode 双轨处理，MUST NOT 静默伪造签名提交。

#### Scenario: 远程通道零命中门禁扩展
- **WHEN** W3 新增 `apps/desktop/electron/signer/` 与 `packages/api-publish-engine` 代码提交前
- **THEN** 外包签名服务 URL 片段与 `MP_SIGNER_BASE` 类远程通道关键词在 `apps/`、`packages/` 运行时代码零命中（测试 fixture 按既有豁免口径）

#### Scenario: provider 形态注册
- **WHEN** 平台链 require 签名模块
- **THEN** 注册表仅暴露 `sign/register/has/list`，`browser-page` provider 以注入 bridge 函数形式登记，引擎包不依赖 electron API
