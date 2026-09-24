# Proposal: api-publish-engine-w2（抖音准自包含发布链，F11 / M2 裁决波）

## Why

W1 已交付三平台 API 链 + publishMode 双轨总闸 + 频控/风控挂起守卫（全部合并 main），W1-W4 波次计划中 W2 的唯一使命是 PRD P1/F11 抖音「准自包含」裁决（M2：通过或回退，二选一，有记录）。逆向证据（技术方案 v1 §5.2 + bundle 切片 `aweme/create@837894/2672895`、`douyin-clientSign@2673500`）表明抖音发布主链**全程无需远程签名服务**：csrf 由 HEAD 请求自取（getSdkToken）、`bd-ticket-guard-client-data` 由本地 cookie 内 EC 私钥 SHA256 签出（clientSign）、`a_bogus=` 在参考产品链中**留空**。这是以最低成本把抖音纳入 API 轨的路径；同时现有 `adapters/douyin.js` 仍是旧骨架（`aweme/post` 链 + 本地 signer 拼参），与证据链不符，必须换血。

## What Changes

- 新增 `packages/api-publish-engine/src/publish/platforms/douyin-video.js` 发布链：getSdkToken（HEAD `x-secsdk-csrf-request`，轮换 URL 池）→ getAuthKey v5 + aws4 签名（region cn-north-1）视频分片上传 → finish 取 videoId → 封面上传 → `create_v2` 提交（完整 `bd-ticket-guard-*` 头组 + cookie msToken + **空 a_bogus**；可见性按 Q15 支持私密/草稿参数）。
- 本地实现 `clientSign`（SHA256 + cookie 内 EC 私钥，`ticket,path,timestamp` 契约）与 `bd-ticket-guard-ree-public-key`/`web-version` 推导，注册进进程内签名注册表（`api-signer-registry` 既有契约，禁止任何远程签名通道回归）。
- `DouyinAdapter` 重指向新链（§4.4 委托模式：适配器变薄委托，旧 `aweme/post` 骨架链下线；旧 `getDouyinSignature` 消费点清除），`config/platforms.yaml` douyin `dom-only → api-then-dom`（发布行为总闸翻转仅此一处）。
- **M2 裁决判据（go/no-go 写死）**：go = 空 a_bogus 活体通过 ≥1 次私密发布（真实标题、间隔≥18min、证据入 `evidence/api-w2-douyin/`）；no-go = 响应命中 `x-tt-verify-passport-decision`/验证信号或空 a_bogus 被拒 → 抖音保持/回退 dom-rpa 并记录裁决，a_bogus 公开算法逆转**另立项不在本 wave 承诺**。⛔ 参考产品的 `checkByPassword` 自动验证路径**不移植**（风控即停合规红线）。
- 契约测试基建复用（127.0.0.1 假 HTTP 服务器钉请求序列/头/body/fail-closed 零请求），新增数据校验面：security-sdk 两 cookie / `bd_ticket_guard_client_data` / `sid_tt` 任一缺失 → fail-closed 零请求（对齐切片入口前置校验）。
- 前置取证：从 `D:\Data\refpub-bundle` 补提抖音上传步骤（getAuthKey→TOS 分片→finish/cover）逐字切片入 `01-docs/rpa-api-publish/evidence/`（Q5：bundle 盘上完好，直接回提取）。

## Capabilities

### New Capabilities

- `api-publish-douyin-chain`: 抖音视频准自包含 API 发布链——csrf/本地 ticket-guard 签名/空 a_bogus 提交的请求契约、fail-closed 数据校验、风控信号识别与 M2 裁决行为。

### Modified Capabilities

（无——W1 三个 delta 能力 `api-publish-chain`/`api-signer-registry`/`publish-mode-routing` 的需求级行为不变；douyin publishMode 翻转是既有三态配置的数据值变化，签名实现注册是既有注册表契约的数据行，均不修改其 Requirement。）

## Impact

- `packages/api-publish-engine`：`publish/platforms/douyin-video.js`（新增）、`signer/registry`（新增本地实现注册）、`adapters/douyin.js`（重指向委托）、`publish-service`/`api-router` 无接口变化。
- `config/platforms.yaml`：douyin `publishMode` 一行。
- 桌面链路：发布队列/双轨路由/风控挂起守卫零改动（W1 §5 enforcement 自动覆盖新平台）。
- 测试：新增 douyin 链契约测试 + 委托测试；全离线零外发（假服务器注入）。
- 文档与证据：techdoc v2 修订记录、PRD F11 状态、evidence 补提切片。
- 风险：空 a_bogus 活体可能即触发风控（no-go 面已封闭：回 dom-rpa 波不阻塞）；W1 §7.5 活体验收尚未执行，抖音活体裁决将与其共用真实账号窗口（用户在场门槛）。
