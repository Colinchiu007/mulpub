# Proposal: 账号管理页【同步云端】

## Why

账号管理页现在的账号只存在于本机：真源是 `{userData}/backend-data/accounts.json`，登录凭证是 `{userData}/credentials/**` 下由 safeStorage 包裹主密钥的 AES-256-GCM 密文。用户换机器、重装系统、或误删账号后，所有平台登录态都要重新扫码；多设备办公（同一人在笔记本和台式机上都要发同几个号）完全没有通路。

竞品取证表明这件事的标准解法就是"凭证上云 + 换设备免扫码"：蚁小二把完整 cookie 上云、凭证按 `spaceId` 存对象存储并用 gzip 传输、用平台原生 uid 作账号身份、客户端不做去重（`index.cjs:118248`、`:263`、`:87265`）。我们的差异在于必须把这个能力接进一个**本地真源 + 单向登录态证据**已经收紧过的体系（见 `openspec/specs/desktop/login-state-evidence/`），不能把刚关闭的"已登录 ↔ 未确认"振荡门重新打开。

## What Changes

1. **业务 API 新增账号云镜像面**：`migrations/postgresql/005_cloud_accounts.sql` 建 `cloud_accounts`（按 `user_id` + `(platform, platform_uid)` 唯一）与 `cloud_account_tombstones`；新增 `/api/v1/me/accounts`（GET 摘要与列表 / PUT 批量 upsert）、`/api/v1/me/accounts/sync`（POST 一次同步的服务端裁决）、`/api/v1/me/accounts/disconnect`（DELETE 清除该用户全部云端镜像）。
2. **凭证信封加密**：随机数据密钥 AES-256-GCM 加密凭证，DK 由按用户隔离的主密钥再加密；主密钥经 KMS 抽象层（本机实现 + 可换云 KMS）。库内永不出现明文凭证。
3. **主进程新增 `cloud-account-sync` 服务**：读本地真源 + `credential-store`，产出合并计划，逐条上报/拉回，经 IPC 事件把逐条结果推给渲染层。登录态写回本机时强制 `unverified`（不传播云端结论）。
4. **补齐 4 个平台的平台原生 uid 提取**：`wechat_mp`、`kuaishou`、`xiaohongshu`、`zhihu`（现仅 douyin/toutiao/tencent_video/bilibili 有 `extract`）。这是合并键可用性的前置条件，快手含「登录页 = 后台同 URL」雷区，必须带负例。
5. **账号管理页新增【同步云端】入口**：命令栏按钮 → `UiModal` 摘要确认（云端现有 xx 个 + 平台分布）→ 同弹窗切过程区（逐条结果 + 汇总）；入口可见性由运营中心 feature flag `account_cloud_sync` 控制，默认关闭；未登录复用 `useLoginGate.ensureLogin`。
6. **「断开云端」出口**：设置/账号页提供清除云端镜像操作，二次确认后删除该用户全部云端账号与墓碑，本机数据与凭证不受影响。

## Capabilities

- `desktop/cloud-account-sync`（新增）：账号云镜像的归属、合并键、双向合并语义、凭证信封加密、同步过程可观测性、断开云端。
- `desktop/account-identity-uid`（新增）：平台原生 uid 提取合同与八平台覆盖。
- `api-publish-engine/cloud-account-store`（新增）：云端账号表、墓碑、API 面与鉴权。

## Impact

- **代码**：`packages/api-publish-engine/{migrations,src,src/auth,src/cloud-accounts,test}`、`migrations/postgresql/005_cloud_accounts.sql`、`apps/desktop/electron/{services/cloud-account-sync.js,services/cloud-credential-crypto.js,publishers/http-login-checker.js,ipc-handlers/account.js,preload/account.js,preload/index.bundle.js,preload/home-shell-preload.bundle.js}`、`apps/desktop/src/{views/Accounts.vue,features/accounts/components/AccountCloudSyncDialog.vue,stores/accounts.js,api/publisher.js,locales/zh.js,locales/en.js}`。
- **契约修订**：AGENTS.md「凭证保留在主进程加密存储」→ 改为"本机为主副本、云端为加密镜像"；`python-backend` 的 `ACCOUNT_METADATA_ONLY` **不变**（本地真源仍拒收凭证）。
- **CI**：`quality-gate.yml` 新增 ubuntu-latest + `services: postgres` 的真库迁移与 API 测试 job（Windows runner 不支持 service container）。
- **数据/合规**：用户全部平台登录钥匙首次离开本机，需隐私声明、用户同意文案、云端数据保留与删除策略（由「断开云端」提供用户侧退路）。
- **风险**：合并键判错 → 墓碑只阻止复活、不反向删本机（ADR-0005 第 2 条）作为爆炸半径控制；KMS 生产实现缺失会 fail-closed，功能默认关。
