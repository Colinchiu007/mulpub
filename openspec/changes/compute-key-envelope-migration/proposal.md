# Proposal: 官方 Key 迁移进 AES-256-GCM 信封体系（compute-key-envelope-migration）

## Why

官方算力供给侧要求**服务端代调模型**（客户端不能持有官方 Key，否则可被逆向提取、无限白嫖）。但官方 Key 存在 `ops-center.official_keys.api_key`，由 **Python Fernet**（`cryptography.fernet`，密钥 `OPS_ENCRYPTION_KEY`）加密，而要去解开它的是 **Node 侧** `packages/api-publish-engine`——Node 没有 Fernet 等价实现。这就是交接文档 `HANDOFF-OFFICIAL-COMPUTE-2026-10-09.md` §3 的 **F3 死结**：两条路（下发客户端 / 服务端代调）都走不通，说明「服务端代调 + Node」这个组合缺一环。

运营方已于 2026-10-11 拍板走 **Q2 选项 2**：迁移重加密进**已有的 AES-256-GCM 信封体系**（`packages/api-publish-engine/src/cloud-accounts/envelope-crypto.js`），**不引入新依赖**。

**为什么现在**：① 该决策是第二阶段（官方算力供给）开工的前置条件，未闭环则供给链路在实现前就缺一环；② 实测 `official_keys` 表**当前无任何生产消费方**（详见下方差异审计），存量重加密的风险窗口是零——以后再迁就要带线上流量做。

## What Changes

- **新增官方 Key 的信封密文存储**：复用现有 KMS 抽象形状与 AES-256-GCM 参数（DK 32 / IV 12 / tag 16），但使用**官方 Key 自己的归属元组与 AAD**（`official|<provider>|<keyRowId>`）与**独立的 alg/version 标识**，不与云端凭证信封混用同一版本号。
- **新增 Node 侧解密路径**：`api-publish-engine` 能在**不解锁 Python 侧**的前提下解开官方 Key 信封（模块级封装，明文不出模块）。
- **新增存量重加密迁移**：Fernet → 信封，幂等、可断点续跑、逐行原子、fail-closed；因仓库**无任何任务宿主**（K7），以 admin 触发的 CLI 承载，不依赖调度器。
- **新增双向过渡与巡检**：过渡期双格式并存（双写 + 双读），并提供全量一致性巡检（每行都能解开且与旧格式明文一致）。
- **BREAKING（内部兼容，非客户端契约）**：收尾阶段删除 `official_keys.api_key`（Fernet）与其读写路径。**该步不可逆**，须独立提交并显式授权；在此之前的所有步骤均可回滚。
- **不改变**对外 API 契约：`GET /api/v1/secrets/*` 仍只返回掩码，客户端依旧拿不到官方 Key。

## 基线差异审计（规格化前必做，禁止重复规格化已交付项）

| 栏位 | 项 | 证据 |
|---|---|---|
| **已交付** | 官方算力四项安全止血 S1/S2/S4/S6 | PR #3217 = `2a330fc2`（`openspec/records/official-compute-stopgap.md`） |
| **已交付** | 定价矩阵校正（§6.4A） | PR #3178（`plan-matrix.js` = 5900/49900、7900/69900） |
| **已交付** | Q1/Q2/Q3 定案与账单交接口径 | PR #3342 = `8cb884f866b7d556d56a07ac08e075cce95b5a95`、#3347 = `5fc2cecdf34b389fa23f50d71f58ef7c603d3270`（交接文档 §6.1/§6.2） |
| **已交付** | 算力计费模型分层设计（DN） | PR #3350 = `ea85b6e0`（`01-docs/DESIGN-COMPUTE-BILLING-MODEL-2026-10-11.md`） |
| **待办（本 change）** | 官方 Key 信封闭环：存储 + Node 解密 + 存量迁移 + 过渡巡检 + 收尾删 Fernet | 本 proposal；F3 死结至今未解 |
| **待办（另 change）** | 官方算力供给链路本身（套餐池/调度/扣费/供给资格落库） | `DESIGN-COMPUTE-BILLING-MODEL-2026-10-11.md` §10 四个决策点未定 |
| **待确认** | 云 KMS 选型与主密钥托管方（生产不得用 `createLocalKms`） | 属部署决策，本 change 只定义抽象与配置项 |
| **待确认** | 删除 `api_key`（Fernet）列的执行授权与时点 | 不可逆步骤，需运营方显式授权 |
| **待确认** | 官方 Key 的 AAD 归属元组是否需要承载「套餐/池」维度 | 依赖 `provider_plans` 表结构（另一 change 未定） |

**关键审计结论**：`official_keys` 表**当前无任何生产消费方**——唯一生产读取点是 `services/model_preset_service.py:1112-1127` 的连通性测试回退取键，且该端点在前端无入口（`api/modelPresets.js` 无 test 接口）。⇒ 本 change 是**零存量流量下的格式迁移**，这是安全窗口，也是把它排在供给链路之前做的理由。

## Capabilities

### New Capabilities

- `official-key-envelope` — 官方 Key 的信封加密存储与解密契约：归属元组与 AAD 构造、alg/version 标识、fail-closed 判据、双格式过渡与巡检、Node/Python 两侧解密主体与最小权限。落在 `openspec/specs/official-key-envelope/spec.md`。

### Modified Capabilities

- `ops-center/keypool-license` — 现有规格只定义 `official_keys` 的字段、校验与权限，**未定密钥的加密格式与解密主体**。本 change 追加 Requirement：官方 Key SHALL 以信封密文存储（格式与归属元组见新能力），Fernet 仅作为过渡期兼容读取路径，且 `OPS_ENCRYPTION_KEY` 在生产不得再作为官方 Key 的唯一解密凭据。需要 delta spec：`openspec/specs/ops-center/keypool-license/spec.md`。

## Impact

| 面 | 影响 |
|---|---|
| `ops-center/backend` | `services/key_service.py`（封印/解封抽象、双写双读）、`routers/secrets.py`（写路径）、新增迁移 CLI 与巡检脚本 |
| `packages/api-publish-engine` | 新增 `src/cloud-accounts/official-key-envelope.js`（或同族模块）与 KMS 接入；复用 `envelope-crypto.js` 的常量与 KMS 形状 |
| 数据库 | 新增 `migrations/postgresql/006_*.sql`（编号必须避开 002-005 且过 checksum 台账；见 K4） |
| 部署/运维 | 主密钥托管方案、双写窗口、切换顺序、回滚步骤；生产禁用 `MP_CLOUD_KMS_LOCAL_KEY` 的启动期断言 |
| 安全面 | **Node 进程新增解密能力**（原先只有 Python 能解）⇒ 明文不出模块、用后清零、不缓存；日志沿用 S6 脱敏 |
| 客户端 | **无影响**（桌面端始终拿不到官方 Key，`apps/desktop/electron/` 对 `officialKey` 零命中） |
| 测试 | 新增信封单测/契约测试 + 迁移幂等与续跑 + 跨行/跨 provider 换密文必失败（变异反证）+ fail-closed 判据 |
