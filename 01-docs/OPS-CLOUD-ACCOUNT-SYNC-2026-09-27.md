# 运维手册 · 账号云镜像同步（【同步云端】）

关联：`01-docs/PRD-CLOUD-ACCOUNT-SYNC-2026-09-27.md`（完整契约）、`docs/adr/0001..0006`（决策）、
`openspec/changes/add-cloud-account-sync/`（规格与任务清单）。
本文件只写**上线/回滚必须知道的运维事实**，功能行为以 PRD 为准。

## 1. 组件与依赖

| 组件 | 位置 | 新增依赖 |
| --- | --- | --- |
| 业务 API（云镜像面） | `packages/api-publish-engine/src/auth/publish-api-cloud-accounts.js` + `src/cloud-accounts/*` | 无新增第三方包（用 Node 内置 `crypto`） |
| 数据库 | PostgreSQL（`BUSINESS_DATABASE_URL`，库 `multi_publish_api`） | 迁移 `migrations/postgresql/005_cloud_accounts.sql` |
| 主密钥 | KMS 接口 `wrap/unwrap` | 生产必须托管；仓库内只有 `createLocalKms` 开发实现 |
| 运营开关 | ops-center `feature_flags` 表 + 运行时下发 | 种子新增 `account_cloud_sync`（默认关） |
| 桌面端 | `apps/desktop/electron/services/cloud-account-*.js`、`ipc-handlers/cloud-account.js` | 无 |

## 2. 发布顺序（必须按序，颠倒会出现可见故障）

1. **先迁移，后发 API**。
   `assertReady()` 现对「未跑 005 的存量库」fail-closed：API 先上而迁移未跑，`/api/v1/ready` 会报
   `MIGRATION_PENDING` 而非静默降级，整个业务 API  readiness 变红。
   ```bash
   # 迁移（幂等；advisory lock 内先探测 identity_schema_migrations，最小权限口径）
   cd packages/api-publish-engine
   BUSINESS_DATABASE_URL=postgres://... node scripts/migrate-postgres.js
   # 校验 ledger 已含 005
   ```
   迁移角色**必须**具备 `SELECT` 既有 ledger 的权限；`005` 只需建表权限一次。
   回滚前须知：`005` 只新增表，不改动既有表，因此**回滚 API 镜像不需要回滚数据库**（旧版本 API 不认识新表即可）。

2. **配置主密钥（KMS）**。
   - 开发/本机：`MP_CLOUD_KMS_LOCAL_KEY`（64 位 hex，即 32 字节）。缺失或非法 → 构造期不抛错，
     首次使用时抛 `KMS_UNAVAILABLE`（503），且不写入任何明文。
   - **生产禁止使用 `createLocalKms`**：主密钥落进环境变量等于把整个镜像库的解密能力放在一台机器上。
     生产必须实现 `wrap(keyId, plaintext, aad)/unwrap(...)` 对接云 KMS（KMS 侧根密钥不可导出、按 `keyId` 轮转），
     并把 `keyId` 与审计日志绑定。轮转口径：AAD 绑 `keyId`，换 `keyId` 后旧信封**解不开**，
     因此轮转必须是「新写入用新 key、存量按需重加密」，不得直接替换根密钥。
   - KMS 不可用时接口返回 `KMS_UNAVAILABLE`，桌面端文案为「云端加密服务未就绪，本次未上传任何凭证」——
     这条路径**不会**把凭证以明文暂存在服务端，也不需要人工清理。

3. **Nginx 路由**。云镜像面在 `/api/v1/me/accounts*` 前缀下，必须落在业务 API 的
   `location /api/v1/` 反代内。按 AGENTS.md「Nginx 反向代理路由分离合同」，禁止用宽匹配
   `location /api/` 把 Logto 内部路径也导到业务 API；发布后必须跑
   `node packages/api-publish-engine/scripts/production-smoke.js` 验证路径守卫与鉴权未被打穿。

4. **打开功能开关（灰度）**。开关是**双条件**：`enabled = true` **且** `value = "true"`。
   运行时下发只取 `enabled=1` 的行并把 `value` 按 `value_type` 解析（见
   `ops-center/backend/services/feature_flag_service.py::list_runtime_feature_flags`），
   只把 `enabled` 打开而 `value` 仍是 `"false"`，桌面端拿到的仍是 `false`。
   ```text
   运营中心 → 功能开关 → account_cloud_sync
     value_type = boolean
     value      = true
     enabled    = true
   ```
   该 key 已进 `SEED_FLAGS`，存量部署会在下次启动时**增量补齐**（只补缺行、不改运营已改过的行）。
   桌面端在拿到运行时策略后才渲染【同步云端】按钮；拿不到 = 不显示（默认关）。

5. **打开顺序建议**：单个内部账号 → 观察服务端日志与 `credential_digest` 一致性 → 小流量 → 全量。
   回滚 = 关掉 `account_cloud_sync`（按钮即消失，已在途批次会在当前条完成后自然收口），无需回滚 API 或数据库。

## 3. 可观测性与排障

| 现象 | 第一落点 | 判读 |
| --- | --- | --- |
| 按钮不出现 | ops-center 运行时下发（`opsCenterSyncRuntime` 的 `featureFlags.account_cloud_sync`） | 双条件都满足才为真；缺键按关处理 |
| 摘要区显示「无法获取云端账号信息」 | API 日志 `CLOUD_ACCOUNTS_NOT_CONFIGURED` / `BUSINESS_USER_REPOSITORY_NOT_CONFIGURED` | 业务库未接或迁移未跑 |
| 每条都 `kmsUnavailable` | `KMS_CONFIG_INVALID` / `KMS_UNAVAILABLE` | 主密钥未配或与 `keyId` 不匹配 |
| 个别账号「未能确认账号身份，已跳过」(`uid-unavailable`) | `apps/desktop/electron/publishers/platform-uid.js` 的三通道（json/html/cookie） | 该平台本轮没拿到可信 `platform_uid`，**不上行**（不做猜测合并） |
| 「云端未接受该账号」 | 服务端逐条 `results[i].errorCode` | 原始码只进该行 `data-error-code` 属性，界面上不直出；按码查 PRD §7.5 码表 |
| 长时间停在「同步中 x/y」 | 并发 3、单账号 20s、整批 180s（`MP_CLOUD_SYNC_CONCURRENCY` / `MP_CLOUD_SYNC_ACCOUNT_TIMEOUT_MS` / `MP_CLOUD_SYNC_TOTAL_TIMEOUT_MS`） | 超时按失败计入，不重试；调参只在排障时用 |

日志红线：主进程与服务端都**禁止**打印凭证内容或明文信封字段（`iv/ciphertext/tag/encryptedDataKey`）。

## 4. 数据边界与合规

- 上行只含白名单字段（`ACCOUNT_METADATA_ONLY` 契约）+ 信封化凭证；`credential_digest` **只由服务端计算**，
  桌面端提交的同名值一律丢弃（防两侧口径漂移）。
- 「断开云端」只删云端镜像与写墓碑，**不反向删除本机账号或本机凭证**；墓碑只阻止恢复，不阻止重新登录。
- 恢复回本机的账号登录状态强制 `unverified`，必须本机自证一次才可能变 `active`。
- 用户同意点：弹窗的隐私提示行（`cloudDigestPrivacy`）在摘要态恒显示，首次同步前必然被看到。

## 5. 本期**未执行**的运维事项（如实登记，不得当作已完成）

- 生产 ECS 发布与 `production-smoke.js` 实跑：**未执行**（无可用的生产目标）。
- 真机端到端（真实业务库 + 真实 Logto 身份 + 真实第三方平台凭证）同步一轮：**未执行**。
- 八平台 `platform_uid` 线级取证（小红书/知乎 SSR 是否真直出身份属性、快手 `userId` 是否等于平台原生主键）：
  **未执行**；未取到可信 uid 的平台走 `uid-unavailable` 跳过上行，不会污染合并键。
- 生产 KMS 实现：仓库内只有 `createLocalKms`（开发/测试用），**生产实现尚未编写**。
  在这一项落地前，本特性不得对真实用户开启。
- 视觉基线：`accounts-list` 视图因命令栏新增按钮必然产生 diff；基线只能取自 CI 产物后回填（QM-4 第 7 条），
  本 PR 内**未回填**。

CI 侧已有的等价证据：`business-api-postgres` job 用真实 PostgreSQL 16 跑 dry-run + apply + 断言 `005` 进 ledger +
幂等重跑 + 真 SQL 用例，这是「迁移可用」的证据，**不等于**上面任何一条已执行。
