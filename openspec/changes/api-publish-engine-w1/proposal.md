# Proposal: api-publish-engine-w1

## Why

现有 DOM 点击式 RPA 发布存在结构性缺陷（`publish btn not found` / `douyin timeout` / `kuaishou 缺作品ID`），选择器与等待逻辑随平台改版脆弱失效。逆向证据（参考产品 4.0 发布引擎逐字切片，已存 `01-docs/rpa-api-publish/evidence/`）证实其发布 = Cookie + 直连平台官方 HTTP API，免疫 DOM 改版。PRD `01-docs/PRD-API-PUBLISH-ENGINE.md` 已获批准（grilling 21 问锁定），W1 交付 Tier-A 自包含三平台链与引擎骨架收口。

## What Changes

- 新增 `packages/api-publish-engine` 的 `publish/core`（HTTP 基座：60s timeout、`retryCondition=!isJson` 重试≤3、代理注入；8MiB 分片器 + UploadEmitGate 节流；进度/取消/错误码）与 `publish/platforms/{shipinhao,bilibili,baijiahao}` 三条 API 发布链（预上传→分片→complete→封面→提交，全部数据校验 fail-closed）。
- 新增进程内签名注册表 `signer/registry`（`signCommand → impl` 契约，未知 command fail-closed）。
- **BREAKING** 拆除 `signer.js` 的 `MP_SIGNER_BASE` / `getRemoteSign` 远程签名对比通道（合规红线：不留任何远程签名出口）。
- 新增 `config/platforms.yaml` `publishModes` 双轨总闸（`api-then-dom | api-only | dom-rpa`，默认 api-then-dom；API 失败按降级矩阵自动落现有 DOM RPA 路径，风控/登录失效不降级直接停报）。
- 新增同账号 API 发布提交频控 ≥18 分钟（队列调度层）。
- 桌面端显示项：发布记录「发布方式」徽标、风控挂起通知（locales zh/en 成对，键前缀 `publish.api.*`）。
- 测试基建：本机临时 HTTP 假服务器契约测试（禁止真实外发/VCR 夹具含登录态）。

## Capabilities

### New Capabilities
- `api-publish-chain`: 平台 HTTP API 发布链行为契约（视频号/B站视频、百家号文章；分片、校验、错误分类、进度）
- `api-signer-registry`: 进程内签名注册表契约（本地实现、fail-closed、无网络出口、句柄不落盘）
- `publish-mode-routing`: 双轨发布模式路由、18 分钟频控与风控停止的用户可见行为

### Modified Capabilities

（无——现有 specs 无发布链能力；DOM RPA 路径行为不变，仅作为降级目标被调用。）

## Impact

- 代码：`packages/api-publish-engine/src/{signer.js,signer-local.js,index.js,adapters/*}` 重构收口 + 新增 `publish/`、`signer/` 子树；`apps/desktop/electron`（发布接线、通知）与 `apps/desktop/src/locales/{zh,en}.js`（成对）；`config/platforms.yaml` 增段。
- 兼容：未入波平台 publishMode 保持 `dom-rpa`，行为零变化；旧 adapters 委托新链。
- 门禁：CI 品牌 grep（`refpub\.cn` 在 apps/packages 必须为空）、Gate 7 locale 同步、`.quality-gates.md`。
- 不影响：数据库、rpa-engine DOM 路径逻辑、账号登录态存储格式。
