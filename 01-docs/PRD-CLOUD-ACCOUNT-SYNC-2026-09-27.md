# PRD：账号管理页【同步云端】（账号云镜像与跨设备恢复）

- 版本：v1.0（2026-09-27）
- 关联 change：`openspec/changes/add-cloud-account-sync/`
- 关联决策：`docs/adr/0001`–`0006`
- 术语唯一来源：仓库根 `CONTEXT.md`（本文所有名词以它为准）

---

## 一、背景与问题

账号管理页（`/accounts`，`apps/desktop/src/views/Accounts.vue`）当前的账号只有本机一份：

| 数据 | 现状位置 | 是否含凭证 |
| --- | --- | --- |
| 账号元数据（真源） | `{userData}/backend-data/accounts.json`，由本机 python-backend 读写（`packages/python-backend/src/server.py:336`） | 否（`server.py:484` 收到 cookies/auth_data 直接 400 `ACCOUNT_METADATA_ONLY`） |
| 登录凭证 | `{userData}/credentials/owners/{sha256(sub)}/{accountId}.json.enc`，AES-256-GCM，主密钥由 safeStorage 包裹（`apps/desktop/electron/services/credential-store.js`） | 是 |
| 会话分区 | Electron session `persist:auth-{accountId}` / `persist:account-*` | 是 |

后果：换机、重装、误删后所有平台都要重新扫码；同一人在两台设备上无法共用已登录账号。

竞品取证（蚁小二 4.13.19 逆向）给出的标准解法是"凭证上云 + 平台原生 uid 做身份 + 换设备免扫码"（`packages/main/dist/index.cjs:118248` 上传 `cookie` 全量、`:263` 按 `spaceId` 从对象存储取回并 gzip 解压、`:87265` 把 `id/platformUserId/platformUserName` 分三列）。它同时暴露了三个我们不接受的做法：不加密托管凭证、纯 MD5 覆盖冲突、本地完全不存账号。本 PRD 在保住"本地真源 + 单向登录态证据"这两个既有收紧点的前提下，取它的可用部分。

## 二、目标与非目标

**目标**
1. 账号管理页有一个【同步云端】按钮，点击后先看到**云端摘要**（共 xx 个）并确认，再执行，执行期间看到**逐条过程信息**。
2. 双向合并：本机账号（含凭证）上云为加密镜像；云端有而本机无的账号恢复到本机，且恢复后免扫码可发布。
3. 提供「断开云端」退路：一键清除该用户在云端的全部账号镜像与墓碑，本机数据不动。

**非目标（本期明确不做）**
- 不做多人/团队共享账号（无 `team_id` 概念，归属只到单个登录身份）。
- 不做账号配置的字段级冲突合并（元数据整体按规则覆盖，见 §5.4）。
- 不做运营后台的账号管理页（账号是用户私有数据，不进运营域，ADR-0001）。
- 不做定时/静默自动同步；只响应用户显式点击。
- 不把登录态结论跨设备传播（ADR-0005 第 1 条）。
- 不改本机 python-backend 的 `ACCOUNT_METADATA_ONLY` 语义。

## 三、角色与前置条件

| 角色 | 前置 | 不满足时 |
| --- | --- | --- |
| 已登录用户（Logto sub 可解析出业务用户） | 应用已登录且 `entitlement` 有效 | 复用 `useLoginGate.ensureLogin`：弹登录引导，登录后自动续做；取消则流程不启动、无云请求 |
| 身份服务不可用（`status === 'disabled' \| 'error'`） | — | fail-closed：`notifyWarning('loginGate.disabledMessage')` 并拒绝，不弹登录框 |
| feature flag `account_cloud_sync` 为真 | 运营中心 `runtime/bootstrap` 已下发；**开启是双条件**：该行 `enabled=1` 且 `value="true"`（运行时只下发 `enabled=1` 的行并取 `typed_value`，只开 `enabled` 而 `value` 仍为 `"false"` 时桌面端拿到的还是 `false`） | 按钮不渲染（缺失/网络不可达/未同步过 → 一律按关闭） |
| 本地至少 1 个账号 | `accountStore.accounts.length > 0` | 按钮 `disabled`，`title` 提示"暂无可同步的账号" |

## 四、数据流总览

```
【同步云端】按钮
  └─ ensureLogin()（未登录则引导）
       └─ IPC accounts:cloud-digest
            主进程：GET {api}/api/v1/me/accounts?view=digest  →  返回 { total, byPlatform[] }
       └─ 弹窗「摘要态」显示 共 xx 个  →  用户点【同步】
            └─ IPC accounts:cloud-sync（单次，全局互斥）
                 主进程：
                   1 读本地真源 accounts.json + 逐账号读 credential-store 凭证
                   2 逐账号补 platform_uid（http-login-checker extract / DOM 选择器）
                   3 GET /api/v1/me/accounts?view=full  取云端全集 + 墓碑
                   4 生成合并计划（§5）
                   5 逐条执行：PUT 上行 / 恢复下行（并发上限 + 单账号硬超时）
                   6 每条发 start 事件（执行前）与 done 事件（终态）
                 渲染层：accounts:cloud-sync-progress 事件驱动过程区
            └─ 终态：汇总（成功/更新/跳过/冲突/失效/失败）
```

## 五、功能逻辑

### 5.1 合并键

- 规范键：`(platform, platform_uid)`。
- `platform_uid` 来源优先级：① `http-login-checker.extractProfileViaHttp`（平台 user-info 接口，带凭证）② DOM 采集选择器（`packages/shared-utils/src/account-profile.js:98-102`，`data-user-id` 等）③ 本地既有 `platform_account_id`（若来自 ①② 则可信）。
- **禁止**来源：`document.title`、`og:title`、昵称、头像 URL、任何页面标题派生值（AGENTS.md 已定："页面标题永远不是账号昵称"，同理不是账号身份）。
- 八平台（`douyin`/`toutiao`/`wechat_mp`/`tencent_video`/`bilibili`/`kuaishou`/`xiaohongshu`/`zhihu`）必须有 extract 实现；某平台确实取不到稳定 uid 时，该平台账号在同步中被判 `uid-unavailable` 并**整体跳过上行**，过程区如实说明，MUST NOT 用名称凑键。

### 5.2 合并计划（决策表）

输入：本机集合 L（键 = `(platform, uid)`）、云端集合 C、墓碑集合 T。

| 情况 | 判定 | 动作 | 结果枚举 |
| --- | --- | --- | --- |
| `k ∈ L` 且 `k ∉ C` 且 `k ∉ T` | 本机独有 | 上行 upsert | `created` |
| `k ∈ L` 且 `k ∈ C`，uid 相同、凭证摘要相同、元数据相同 | 无变化 | 不发写请求 | `unchanged` |
| `k ∈ L` 且 `k ∈ C`，需变更 | 本机更新 | 上行 upsert | `updated` |
| `k ∈ L` 且 `k ∈ C`，凭证摘要不同 | 凭证冲突 | 走 §5.5 | `conflict-resolved-local` / `conflict-resolved-cloud` / `invalid-credential` |
| `k ∈ C` 且 `k ∉ L` 且 `k ∉ T` | 云端独有 | 恢复到本机 | `restored` |
| `k ∈ T`（无论 L/C 是否有） | 已删除 | 跳过，不拉回、不新建 | `skipped-tombstone` |
| 本机已删但云端仍在且无墓碑 | 墓碑缺失（历史数据） | 补写墓碑，不反向删本机 | `tombstone-backfilled` |
| uid 取不到 | 身份不可定 | 跳过该平台该账号 | `uid-unavailable` |
| 校验不通过（§6.2） | 非法数据 | 该账号失败，其余继续 | `failed` + 原因码 |

不变式：
- 一条本机记录最多产出一条云端记录（幂等，重复同步不增行）。
- `unchanged` 绝不发写请求（避免把 `last_validated` 之类伪造成新事件）。
- 正向证据与写入顺序遵循既有契约：凭证落盘成功后才允许声称可用。

### 5.3 恢复到本机（下行）

1. 写 `accounts.json`：走本机 python-backend `POST /api/accounts`（元数据）→ 得到本机 `id`；元数据映射见 §6.3。
2. 写凭证：主进程 `credential-store.saveCredential(accountId, {platform, cookies, localStorage, indexedDB, accountInfo})`，本机重新用 safeStorage 主密钥加密（**云端密文不直接落本机**，两侧密钥体系独立）。
3. 登录态：`status` 强制 `unverified`；`last_validated` 写本机恢复时刻，并打 `validation_origin = 'restored'` 使其**不参与** 7 天超龄兜底（`MP_LOGIN_STATE_GRACE_DAYS`）。
4. 队列：恢复成功的账号进入一次自动登录检测（复用 `accounts:batch-check-login` 链路的并发与超时口径），由本机证据决定最终状态。
5. 顺序不可颠倒：凭证未落盘不得把元数据写成可用；凭证落盘失败时返回值如实透传真源原值，MUST NOT 声称 active（对齐 AGENTS.md「固化失败或登录证据不足时不得冒充」）。

### 5.4 元数据冲突（两边都有、字段不同）

- 判定粒度是"整条记录"，不做字段级 merge。
- 取 `updated_at` 较新的一方作为胜出；相同时**本机优先**（本地是真源）。
- `name`（显示名）与 `account_name`（昵称）不参与胜出判定，只随胜方覆盖。
- 覆盖后若本机是"落后方"，本机记录被云端较新元数据更新，但 `status` 保持本机原结论（不被云端状态污染）。

### 5.5 凭证冲突裁决（四分支）

```
digest(local) == digest(cloud) ? → 无冲突（unchanged）
否则：
  A = max(updated_at) 那一份，B = 另一份
  检测(A) 有效            → 采纳 A，conflict-resolved-{local|cloud}
  检测(A) 失效 ∧ 检测(B) 有效 → 采纳 B，conflict-resolved-{local|cloud}
  两者都判失效            → 保留本机凭证原样，invalid-credential（标需重新登录）
  两者都"无定论"          → 保留本机凭证原样，conflict-unresolved（不写负结论，
                            遵守单向证据规则：无定论不得把 active 抹成 unverified）
```

`conflict-resolved-local` 表示本机那份胜出（云端被本机覆盖上行）；`conflict-resolved-cloud` 表示云端胜出（写回本机并触发重加密）。检测动作本身走 `http-login-checker`，其超时/风控降级语义沿用现状。

### 5.6 删除与墓碑

- 本机删除（`account:delete`、批量删除）成功后 best-effort 向云端写墓碑 `(platform, uid)`；失败只 `log.warn`，不回滚本机删除（本机删除是用户强意图，云端补偿靠下次同步补写）。
- 墓碑只影响"是否拉回"，**永不**触发删除本机账号或本机凭证文件（本机凭证删除不可恢复，键判错的爆炸半径不可接受）。
- 「断开云端」时墓碑与账号一并清除（否则用户重登同名账号会被陈旧墓碑挡住）。

### 5.7 一次同步的并发与超时

| 参数 | 值 | 可覆盖 | 说明 |
| --- | --- | --- | --- |
| 并发上限 | 3 | `MP_CLOUD_SYNC_CONCURRENCY` | 含上行与下行；串行会让 8 账号 × 检测耗时叠成分钟级 |
| 单账号硬超时 | 20s | `MP_CLOUD_SYNC_ACCOUNT_TIMEOUT_MS` | 覆盖 uid 提取 + 网络往返 + 冲突检测 |
| 整体预算 | `账号数/并发 × 单账号超时`，上限 180s | `MP_CLOUD_SYNC_TOTAL_TIMEOUT_MS` | 到点未完成的账号计 `failed` + `SYNC_BUDGET_EXCEEDED` |
| 摘要请求超时 | 10s | 复用 `SYNC_TIMEOUT_MS` 口径 | 与 ops-center 四个 reporter 一致 |

超时的结果语义：计 `failed`，MUST NOT 计 `unchanged`；超时后迟到的 promise reject MUST NOT 产生 unhandledRejection（AGENTS.md 批量 IPC 规则）。

### 5.8 互斥与重入

- 全局单实例：`syncing === true` 时再次触发返回 `CLOUD_SYNC_IN_PROGRESS`，按钮禁用。
- 断开云端与同步互斥（同一把锁）。
- 与「一键检测登录」(`account-batch-check-all`) 互斥：两者并行会同时改 `status`，任一先结束都会让另一份结论错乱；实现为互相 disable，过程区文案提示"登录检测进行中，稍后再同步"。

## 六、数据模型与校验

### 6.1 云端表结构

`cloud_accounts`

| 列 | 类型 | 约束 | 说明 |
| --- | --- | --- | --- |
| `id` | BIGSERIAL | PK | 内部主键 |
| `user_id` | TEXT | NOT NULL, FK→`identity_users.id` | 归属登录身份 |
| `platform` | TEXT | NOT NULL | 平台枚举值 |
| `platform_uid` | TEXT | NOT NULL | 平台原生主键，**不接受空串** |
| `display_name` | TEXT | NOT NULL, ≤200 | 显示名 |
| `account_name` | TEXT | NULL, ≤200 | 平台昵称 |
| `avatar` | TEXT | NULL, ≤1024, https 或空 | 头像 URL |
| `followers` | BIGINT | NULL, ≥0 且有限 | 粉丝数 |
| `is_active` | BOOLEAN | NOT NULL DEFAULT true | 启用态 |
| `credential_ciphertext` | BYTEA | NOT NULL | AES-256-GCM 密文 |
| `credential_iv` | BYTEA | NOT NULL | 12 字节 |
| `credential_auth_tag` | BYTEA | NOT NULL | 16 字节 |
| `encrypted_data_key` | BYTEA | NOT NULL | DK 经主密钥加密后的密文 |
| `credential_digest` | TEXT | NOT NULL | 明文凭证规范化后的 SHA-256（仅判变更，不用于身份） |
| `credential_updated_at` | TIMESTAMPTZ | NOT NULL | 凭证最后变更时刻（冲突裁决用） |
| `metadata_updated_at` | TIMESTAMPTZ | NOT NULL | 元数据最后变更时刻 |
| `last_sync_device_label` | TEXT | NULL, ≤64 | 「上次由哪台设备同步」展示用，**不参与身份** |
| `created_at` / `updated_at` | TIMESTAMPTZ | NOT NULL | |

唯一约束 `cloud_accounts_user_platform_uid_key` = `(user_id, platform, platform_uid)`。

`cloud_account_tombstones`：`(user_id, platform, platform_uid)` 唯一 + `deleted_at`。

> 云端**不存** `status`/`last_validated` 作真源字段。登录态不跨设备传播（ADR-0005）；摘要里的"已登录 x 个"来自云端各自最近一次同步上报的 `last_reported_status`（只读快照，仅用于展示，恢复流程不读它）。

### 6.2 上行字段校验（服务端与客户端同一口径，fail closed）

| 字段 | 规则 | 违反时的错误码 |
| --- | --- | --- |
| 整体 | 只允许白名单键；出现未知键即拒 | `ACCOUNT_FIELD_NOT_ALLOWED` |
| `platform` | ∈ `PlatformType` 枚举（与 `packages/shared-utils` 同源） | `ACCOUNT_PLATFORM_UNSUPPORTED` |
| `platform_uid` | 非空、trim 后 ≤128、不含控制字符 | `ACCOUNT_UID_INVALID` |
| `display_name` | 非空、≤200；命中 `isNoiseAccountName` 的判为非法 | `ACCOUNT_NAME_NOISE` |
| `account_name` | ≤200；命中形态规则（数字+量词+统计项 / 以站点 chrome 词结尾 / 含省略号 / 括号开合不等）判非法 | `ACCOUNT_NAME_NOISE` |
| `avatar` | 空 或 `https://` 开头 ≤1024；拒绝 `file://`、`javascript:`、data URI | `ACCOUNT_AVATAR_INVALID` |
| `followers` | 整数、`0 ≤ n ≤ 1e12`；NaN/Infinity/负数/布尔/字符串一律拒 | `ACCOUNT_FOLLOWERS_INVALID` |
| 时间戳 | ISO 8601 且可解析；不得为未来时间（> now + 5min 判非法） | `ACCOUNT_TIMESTAMP_INVALID` |
| 凭证体积 | 规范化 JSON 后 ≤ 2 MiB；加密前判定 | `CREDENTIAL_TOO_LARGE` |
| 凭证结构 | cookies 为数组、每项含 `name`/`value`；localStorage 为对象；键总数 ≤ 5000 | `CREDENTIAL_SHAPE_INVALID` |
| 单批条数 | ≤ 100 | `ACCOUNT_BATCH_TOO_LARGE` |

客户端 MUST 先本地校验再发请求（省一次往返并给出即时文案），服务端 MUST 独立再校验一遍——客户端校验不是安全边界。

### 6.3 字段映射（本机真源 → 云端 → 恢复）

| 本机 `accounts.json` | 云端列 | 恢复回本机 | 备注 |
| --- | --- | --- | --- |
| `id` | 不映射 | 新本机 id | 本机 id 不跨设备（`uuid4[:8]` 随机） |
| `platform` | `platform` | `platform` | |
| `name` | `display_name` | `name` | |
| `account_name` | `account_name` | `account_name` | |
| `platform_account_id` | `platform_uid` | `platform_account_id` | 仅当来自 uid 提取路径；否则该行判 `uid-unavailable` |
| `followers` | `followers` | `followers` | |
| `avatar` | `avatar` | `avatar` | |
| `is_active` | `is_active` | `is_active` | |
| `status` | 不参与真源 | 强制 `unverified` | ADR-0005 |
| `last_validated` | 不参与真源 | 恢复时刻 + `validation_origin='restored'` | 不入超龄 |
| `created_at` | `created_at` | 本机新建时刻 | 保留云端原创建时刻供展示 |
| `owner_subject` | `user_id`（服务端由 token 解析） | 本机 `owner_subject` | 客户端 MUST NOT 自报归属 |
| （凭证，不在 accounts.json） | `credential_*` 四列 | `credential-store.saveCredential` | |

## 七、云端 API 契约

基址：业务 API（`config/identity-public.json` 的 `businessApiUrl`；本机回环同源可用 http，其余强制 https）。鉴权：`Authorization: Bearer <Logto access token>` + `X-Device-Id`，与 `member-api-service.js:27-34` 同口径。路径前缀守卫已允许 `/api/v1/`（`publish-api-server.js:619`），新路径无需改守卫；Nginx 侧 `/api/v1/` 反代不变（AGENTS.md 路由分离合同）。

### 7.1 `GET /api/v1/me/accounts`

| 参数 | 说明 |
| --- | --- |
| `view=digest`（默认） | 只回摘要：`{ code, data: { total, byPlatform: [{platform, count}], tombstones, updatedAt } }` |
| `view=full` | 回合并所需全集（不含凭证明文）：`{ accounts: [{platform, platformUid, displayName, accountName, avatar, followers, isActive, credentialDigest, credentialUpdatedAt, metadataUpdatedAt, lastReportedStatus}], tombstones: [{platform, platformUid, deletedAt}] }` |

状态码：200 / 401（未认证）/ 403（scope 不足）/ 503（仓储未配置，`BUSINESS_USER_REPOSITORY_NOT_CONFIGURED`，与既有 `/me` 族一致）。

### 7.2 `PUT /api/v1/me/accounts`（批量 upsert）

请求体 `{ accounts: [...] }`，每项含 §6.2 字段 + `credential`（`{cookies, localStorage, indexedDB}`，经 TLS 上行，服务端落库前才加密）+ 可选 `force`（冲突裁决后本机胜出的强制覆盖标记 `'local-wins'`；云端胜出回写时为 `'cloud-wins'`）。

**凭证摘要由服务端计算**，客户端不自算：摘要口径（cookies 规范化排序 + 丢弃非语义字段）一旦在两处各写一份必然漂移，而漂移的表现是 `unchanged` 被误判成冲突、每次同步都重写一遍凭证。客户端只消费服务端回传的裁决结果。

响应 `{ code, data: { results: [{ platform, platformUid, outcome, errorCode?, credentialFreshness? }] } }`，`outcome ∈ created|updated|unchanged|conflict|rejected`；`conflict` 时 `credentialFreshness ∈ {local, cloud}` 指明哪一方的 `credential_updated_at` 较新（供客户端实测裁决定序）。逐条独立裁决，一条失败不影响其余（MUST NOT 整批回滚）。

幂等：同一 `(platform, platformUid)` 且服务端算得的摘要未变 → `unchanged` 且不更新 `updated_at`。

### 7.3 `POST /api/v1/me/accounts/sync`

服务端裁决端点（供客户端在合并计划不确定时索取权威视图）：入本机计划摘要，出 `actions: [{key, action, reason}]` + 需要解密的凭证槽。若实现上把裁决完全放客户端，本端点退化为"批量取凭证"：`{ keys: [{platform, platformUid}] } → { credentials: [{platform, platformUid, credentialEnvelope}] }`。**本期按后者实现**（客户端裁决，服务端只存取），因为凭证解密必须在服务端做、而合并键判定不需要服务器状态。

### 7.4 `POST /api/v1/me/accounts/disconnect`（断开云端）

请求体 `{ confirm: "cloud" }`（防误触的显式二次确认标记，由 UI 在用户确认后附带；服务端 MUST 独立校验该值，缺失即 400 `DISCONNECT_CONFIRMATION_REQUIRED`）。归属只认 token，MUST NOT 接受请求体里的 user/subject 字段。
响应 `{ code, data: { deletedAccounts, deletedTombstones } }`。
失败：`{ error: "CLOUD_DISCONNECT_PARTIAL", deletedAccounts, remaining }` → 客户端 MUST 显示失败并保留入口。

> 用 POST 而非 `DELETE`：本仓所有变更类云接口都是 POST（`/me/sessions/revoke-others`、`/me/notifications/read`），且 `DELETE` 带 body 在反向代理与 HTTP 客户端上是长期歧义源；同时会员白名单 `ME_API_PATHS` 里该路径只放开 `POST` 一个方法，方法集中不存在"能 DELETE 却删多了"的余地。

### 7.5 错误码全表

| 码 | 触发 | HTTP | 用户可见文案键 |
| --- | --- | --- | --- |
| `UNAUTHORIZED` | token 缺失/过期 | 401 | `accountsPage.cloudSync.err.unauthorized` |
| `BUSINESS_USER_REPOSITORY_NOT_CONFIGURED` | 服务端未接库 | 503 | `…err.serviceUnavailable` |
| `ACCOUNT_FIELD_NOT_ALLOWED` | 未知字段 | 400 | `…err.fieldNotAllowed` |
| `ACCOUNT_PLATFORM_UNSUPPORTED` | 平台枚举非法 | 400 | `…err.platformUnsupported` |
| `ACCOUNT_UID_INVALID` | uid 空/超长/控制字符 | 400 | `…err.uidInvalid` |
| `ACCOUNT_NAME_NOISE` | 名称命中噪声形态 | 400 | `…err.nameNoise` |
| `ACCOUNT_AVATAR_INVALID` | 头像 URL 非法 | 400 | `…err.avatarInvalid` |
| `ACCOUNT_FOLLOWERS_INVALID` | 粉丝数非法 | 400 | `…err.followersInvalid` |
| `ACCOUNT_TIMESTAMP_INVALID` | 时间戳非法/未来 | 400 | `…err.timestampInvalid` |
| `CREDENTIAL_TOO_LARGE` | 凭证 >2MiB | 413 | `…err.credentialTooLarge` |
| `CREDENTIAL_SHAPE_INVALID` | 凭证结构非法 | 400 | `…err.credentialShape` |
| `ACCOUNT_BATCH_TOO_LARGE` | 一批 >100 | 413 | `…err.batchTooLarge` |
| `KMS_UNAVAILABLE` | 主密钥服务不可达 | 503 | `…err.kmsUnavailable` |
| `CLOUD_SYNC_IN_PROGRESS` | 重入 | 409 | `…err.inProgress` |
| `SYNC_BUDGET_EXCEEDED` | 整体预算耗尽 | 200（逐条计 failed） | `…err.budgetExceeded` |
| `CLOUD_DISCONNECT_PARTIAL` | 断开未全清 | 500 | `…err.disconnectPartial` |

## 八、加密契约

1. **加密发生在服务端收到 `PUT` 之后、写库之前**：对每条凭证 `dk = randomBytes(32)`；`ciphertext = AES-256-GCM(key=dk, iv = randomBytes(12), aad = "${userId}|${platform}|${platformUid}")`。客户端不做加密、不持有主密钥——客户端加密要么把明文 DK 一起传上去（等于没加密），要么多一次 GenerateDataKey 往返；本项目的信任边界就是"服务端持有 KMS 主密钥"，两种做法安全上限相同，多一条链路只多一处漂移点。
2. `encryptedDataKey = KMS.wrap(dk, keyId = "user:${userId}")`；DK 明文在进程内用后必须清零。
3. KMS 抽象层接口：`{ wrap(dk, keyId) → Promise<Buffer>, unwrap(cipherDk, keyId) → Promise<Buffer> }`。本机实现用环境密钥文件（仅开发/测试），生产实现接云 KMS；实现缺失 → `KMS_UNAVAILABLE`，**禁止**退化为"不加密"或"用固定密钥"。
4. AAD 绑定三元组，防跨账号/跨用户串解（换 AAD 必须解密失败）。
5. 桌面侧解密后写本机 `credential-store`，用**本机** safeStorage 主密钥重新加密；云端 DK 密文与本机 `.enc` 文件互不可解，两套体系独立。
6. `credential_digest` = SHA-256(规范化 JSON 排序后的凭证)，**只在服务端计算**（见 §7.2）。规范化 MUST 固定：cookies 按 `(domain, path, name)` 字典序、丢弃 `expirationDate/lastAccessTime/session/hostOnly` 等非语义字段后序列化。否则同一次登录会产生不同摘要，把 `unchanged` 误判成冲突。客户端侧禁止另写一份 normalization：本仓已有"同一判定逻辑抄成三份导致行为漂移"的先例（登录态三态映射），摘要口径同理。

## 九、IPC 与 preload 契约

| 方向 | channel / 方法 | payload |
| --- | --- | --- |
| renderer → main | `accounts:cloud-digest` | → `{ code, data: { total, byPlatform, tombstones, reachable, errorCode? } }` |
| renderer → main | `accounts:cloud-sync` | 入 `{ }`；出终态汇总 `{ code, data: { created, updated, unchanged, restored, skipped, conflicts, invalid, failed, items: [...] } }` |
| renderer → main | `accounts:cloud-disconnect` | 入 `{ confirm: 'cloud' }`；出 `{ code, data: { deletedAccounts, deletedTombstones } \| null, errorCode? }` |
| renderer → main | `accounts:cloud-sync-abort` | 出 `{ code, data: { aborted: boolean } }`；置中止标记，当前条完成后停止（不硬杀在途请求） |
| main → renderer 事件 | `accounts:cloud-sync-progress` | `{ phase:'start'\|'done', rowKey, index, total, platform, accountId?, outcome?, code?, elapsedMs? }` |

**`rowKey` 是渲染层行标识的唯一来源（MUST）**：每个进度事件（`start` 与 `done` 两个边界都要）都必须携带同一条账号的 `rowKey`，
且 `start` 与 `done` 取到的值必须相同。上行阶段取 `String(account.id)`；恢复阶段取 `'restore:' + platform + ':' + platformUid`
——因为恢复项此刻**还没有本机 accountId**（正是这次恢复才创建），若渲染层优先取 `accountId` 就会让一条账号在界面上裂成两行，
`doneCount`、进度百分比与汇总区同时失真（本条由 QM-6 外部评审发现，回归锁 `cloud-account-sync.test.js`
「恢复阶段 start 与 done 必须同一 rowKey」+「结构锁：源码里每个进度 send 都必须带 rowKey」）。
渲染层 `rowKeyOf` 的取键顺序为 `rowKey → accountId → platform-index → platform`，
**禁止**使用 `rows.length` 这类随调用时序变化的量（键不稳定 = 双边界语义失效）；末位 `platform` 兜底的取舍是
「同平台合并成一行」而非「凭空多一行」，宁可少一行也不让进度失真。

约束：
- 三个 invoke 方法 MUST 过 `withSenderCheck`（CI Gate 17），MUST 在 `apps/desktop/electron/preload/account.js` 暴露，MUST 登记 `preload.test.js` 的 `ACCOUNT_METHODS`（`:86-100`），MUST 重新构建 `index.bundle.js` 与 `home-shell-preload.bundle.js`（改 `preload/page-manager.js` 类文件漏 bundle 会被 bundle 断言拦截）。
- `access-control.js`：四个 invoke 方法 MUST NOT 落入默认宽松分支；`accounts:cloud-sync`/`cloud-disconnect`/`cloud-sync-abort` 属写操作或状态变更，按 `authenticated` 及以上门控并显式声明。
- 进度事件 MUST 有 start（执行前）+ done（终态）两个边界（AGENTS.md 批量 IPC 双边界规则；先例 `ipc-handlers/account.js:580-591`）。
- IPC 入参 MUST 是纯 JSON；从 Pinia ref 取出的对象 MUST `JSON.parse(JSON.stringify(x))` 脱壳（"An object could not be cloned"）。

## 十、交互逻辑与显示项

### 10.1 弹窗状态机

```
idle →（点按钮）→ loading-digest →（成功）→ digest-confirm →（点同步）→ running → terminal-summary → closed
                        │                            │              │
                     失败态 digest-error          取消→closed     关闭→cancelled(后台继续到当前条完成)
```

- 组件：`apps/desktop/src/features/accounts/components/AccountCloudSyncDialog.vue`，用 `UiModal`（`src/components/UiModal.vue`，size `md`）。账号域**不用** `el-dialog`（既有约定）。
- 摘要态 MUST 先有数据再显示数字；`loading` 期间显示骨架/加载行，MUST NOT 先显示"共 0 个"再跳变。
- 过程态 MUST 复用同弹窗（不叠加第二个遮罩）。
- 浮层互斥：弹窗为模态，MUST 经 `src/composables/useEmbeddedViewSuspension.js` 挂起/恢复内嵌视图，owner 标识唯一、suspend/release 成对、release 走 `finally`；并在 `src/overlay-view-suspension.test.js` 登记 owner（AGENTS.md overlay 合同）。

### 10.2 摘要态显示项

| 显示项 | 内容 | 空/异常时 |
| --- | --- | --- |
| 标题 | 「同步到云端」 | — |
| 主计数 | 「云端现有 **{total}** 个账号」 | total=0 → 「云端还没有账号，本次将首次上传」 |
| 平台分布 | 按平台一行：平台图标 + 平台名 + 计数；`platform` 顺序按 `PlatformType` 枚举稳定序，MUST NOT 随响应顺序抖动 | 无数据时整块隐藏 |
| 本机待同步 | 「本机 {local} 个账号将参与同步」 | local=0 → 按钮禁用 |
| 墓碑说明 | 有墓碑时一行「其中 {n} 个已删除账号不会被恢复」 | n=0 不显示 |
| 隐私提示 | 固定一行：凭证将加密上云，可在断开云端时清除 | 恒显示 |
| 操作 | 【取消】ghost + 【同步】primary | 摘要失败时【重试】替换【同步】 |

### 10.3 过程态显示项

| 显示项 | 内容 |
| --- | ---|
| 进度行 | 「同步中 {done}/{total}」+ 进度条（百分比 = done/total，样式复用 `.batch-check-bar`） |
| 当前平台 | 进行中的平台名集合（in-flight，可多个） |
| 逐条列表 | 每账号一行：平台图标、账号名、结果标签（已上传/已更新/已是最新/已恢复/已跳过/冲突已解决/凭证失效/失败）、失败时原因文案 |
| 已用时 | 秒表，1s tick（复用一键检测的 ticker 模式） |
| 汇总区 | 终态后出现：成功 n / 更新 n / 恢复 n / 跳过 n / 冲突 n / 需重登 n / 失败 n |
| 操作 | 进行中：【停止同步】（显式中止，见下）+【后台继续】（仅关弹窗，批次不打断）；终态：【完成】 |

> **两个动作语义不同，不得合并**：`【后台继续】` = 关闭弹窗、同步照常进行到终态（重开弹窗可看结果）；`【停止同步】` = 请求中止，**当前条完成后**停止发起新账号，已完成的结果保留，剩余账号计 `cancelled`。中止按钮在 IPC 回执后不得自行伪造"已停止"终态；若批次其实已自然结束（`data.aborted === false`），按钮直接失效并走正常汇总流程。

结果标签颜色语义：成功类 `success`、跳过/已最新 `muted`、冲突 `warning`、失效/失败 `danger`。

**汇总区逐类计数（chips）的口径**：优先按终态 `items` 统计（与逐条列表同源，绝不允许出现两个口径）；
只有旧载荷/`items` 缺席时才回落 `counters`，回落映射表 `COUNTER_TO_OUTCOME` 的唯一落点在
`apps/desktop/src/features/accounts/composables/useCloudSyncRows.js`，别处不得再抄一份。两条细则：
- `uid-unavailable` **必须**出现在 chips 里（曾被静默漏掉：主进程已回传 `uidUnavailable` 计数，
  而渲染层的兜底表没有这一项，导致「跳过了几条」用户看不到）；
- 兜底表**故意不含 `conflicts`**：主进程把 `conflict-resolved-local` 与 `conflict-resolved-cloud`
  合并成一个 `conflicts` 计数，没有逐条 `items` 就判不出是哪一侧胜出——宁可少一枚 chip，也不给一条错标签
  （与服务端 `extractUidFromHtml` 的「不确定就不给结论」同口径）。汇总文字仍按 `counters` 如实反映成功/失败数。

### 10.4 提示文案全表（zh，en 见 locales 文件，MUST 成对）

> 文案落位（实现事实）：本表全部键位于 `apps/desktop/src/locales/accounts-cloud-sync/{zh,en}.js`，
> 由装配文件 `locales/{zh,en}.js` 以 `import` + 对象展开接回 `accountsPage` 命名空间，**键名与访问路径不变**
> （仍写作 `accountsPage.cloudSync*`）。拆出子模块是因为 `locales/zh.js` 已 3300+ 行、逐文件行数门禁的处方是拆分；
> CI 门禁 `check-locale-sync.js` 已同步支持「装配文件跟随 import」解析键集，并把成对口径泛化为
> 「`locales/` 目录下每个 `zh.js` ↔ 同目录 `en.js`」，拆文件不会打开单边文案的口子。

**按钮与标题**

| 键 | zh |
| --- | --- |
| `accountsPage.cloudSync` | 同步云端 |
| `accountsPage.cloudSyncBusy` | 同步中… |
| `accountsPage.cloudSyncTitle` | 同步到云端 |
| `accountsPage.cloudSyncAria` | 同步账号到云端 |

**摘要态**

| 键 | zh |
| --- | --- |
| `accountsPage.cloudDigestLoading` | 正在获取云端账号信息… |
| `accountsPage.cloudDigestTotal` | 云端现有 {total} 个账号 |
| `accountsPage.cloudDigestEmpty` | 云端还没有账号，本次将首次上传 |
| `accountsPage.cloudDigestLocal` | 本机 {local} 个账号将参与同步 |
| `accountsPage.cloudDigestTombstone` | 其中 {count} 个已删除账号不会被恢复 |
| `accountsPage.cloudDigestPrivacy` | 登录凭证将加密后上传；可在需要时一键清除云端数据 |
| `accountsPage.cloudDigestFailed` | 无法获取云端账号信息，请检查网络后重试 |
| `accountsPage.cloudDigestRetry` | 重试 |

**过程与汇总**

| 键 | zh |
| --- | --- |
| `accountsPage.cloudSyncProgress` | 同步中 {done}/{total} |
| `accountsPage.cloudSyncElapsed` | 已用时 {seconds} 秒 |
| `accountsPage.cloudSyncDone` | 同步完成：新增 {created}，更新 {updated}，恢复 {restored} |
| `accountsPage.cloudSyncPartial` | 同步部分完成：{ok} 个成功，{fail} 个失败 |
| `accountsPage.cloudSyncAllFailed` | 同步失败：{fail} 个账号未上传 |
| `accountsPage.cloudOutcomeCreated` | 已上传 |
| `accountsPage.cloudOutcomeUpdated` | 已更新 |
| `accountsPage.cloudOutcomeUnchanged` | 已是最新 |
| `accountsPage.cloudOutcomeRestored` | 已恢复到本机 |
| `accountsPage.cloudOutcomeSkippedTombstone` | 已跳过（云端标记删除） |
| `accountsPage.cloudOutcomeConflictLocal` | 冲突：保留本机登录状态 |
| `accountsPage.cloudOutcomeConflictCloud` | 冲突：采用云端登录状态 |
| `accountsPage.cloudOutcomeInvalidCredential` | 凭证已失效，需重新登录 |
| `accountsPage.cloudOutcomeUidUnavailable` | 未能确认账号身份，已跳过 |
| `accountsPage.cloudOutcomeFailed` | 失败 |
| `accountsPage.cloudSyncBackground` | 后台继续 |
| `accountsPage.cloudSyncClose` | 完成 |

**门控与错误**

| 键 | zh |
| --- | --- |
| `accountsPage.cloudSyncNoAccounts` | 暂无可同步的账号 |
| `accountsPage.cloudSyncGateBusy` | 登录检测进行中，请稍后再同步 |
| `accountsPage.cloudDisconnect` | 断开云端 |
| `accountsPage.cloudDisconnectConfirm` | 将清除云端全部 {count} 个账号镜像，本机账号与登录状态不受影响。是否继续？ |
| `accountsPage.cloudDisconnectSuccess` | 云端账号已清除 |
| `accountsPage.cloudDisconnectFailed` | 云端未完全清除：{deleted} 已删，{remaining} 仍在，请重试 |
| `accountsPage.cloudSyncErr.unauthorized` | 请先登录后再同步 |
| `accountsPage.cloudSyncErr.serviceUnavailable` | 云端同步服务暂不可用，请稍后再试 |
| `accountsPage.cloudSyncErr.kmsUnavailable` | 云端加密服务未就绪，本次未上传任何凭证 |
| `accountsPage.cloudSyncErr.credentialTooLarge` | 该账号登录数据过大，无法上传 |
| `accountsPage.cloudSyncErr.budgetExceeded` | 同步超时，未完成 |
| `accountsPage.cloudSyncErr.inProgress` | 已有一次同步在进行中 |

> **键名口径（实现约束，不要改回点分）**：原设计写作 `cloudSync.err.<code>`，但 `accountsPage.cloudSync` 已经是按钮文案的**叶子**，vue-i18n 无法让同一路径同时是叶子和父对象（点分平铺键不会被路径解析命中，已实测）。故错误码文案统一落 `accountsPage.cloudSyncErr.<code>`，沿用同命名空间 `accountCheckStatus` 错误码表的先例。§7.5 里那些**只存在于服务端**的校验码（`ACCOUNT_NAME_NOISE` 等）不在 `cloudSyncErr` 下建条目——那会造出 AGENTS.md 禁止的死键，改为按语义分组映射到少数几条用户可读文案。

文案纪律：拼接类汇总（`cloudSyncDone`/`cloudSyncPartial`）MUST 有整句字面量精确断言测试，覆盖条件段有无两种形态（QM-3 + 先例 `locales/accounts-batch-check-copy.test.js`）。用户可见文案一律进 locales，渲染层 `src/` 非 locales 文件不得新增中文字面量（CI Gate 7）。

## 十一、异常态矩阵

| 场景 | 界面表现 | 数据后果 |
| --- | --- | --- |
| 未登录点按钮 | 弹登录引导；登录后自动继续；取消则无请求 | 无 |
| 身份服务不可用 | warning 提示，流程不启动 | 无 |
| 离线 / 网络不通 | 摘要态显示"无法获取云端账号信息"+重试 | 无写请求 |
| 云端 5xx | 同上，错误码区分 serviceUnavailable | 无 |
| 云端为空 | "云端还没有账号，本次将首次上传" | 确认后全量首次上传 |
| 本机 0 账号 | 按钮 disabled + title 说明 | 无 |
| 单账号 uid 取不到 | 该行"未能确认账号身份，已跳过" | 该账号不上行；其余照常 |
| 部分账号失败 | "同步部分完成：n 成功 / m 失败"并列出原因 | 失败账号不写云端 |
| 批次进行中关弹窗（后台继续） | 弹窗关闭，同步照常进行到终态；重开可看结果 | 不中断，结果照常落盘 |
| 用户点【停止同步】 | 按钮转"正在停止…"并失效，当前条完成后停止 | 已完成的结果保留，剩余账号计 `cancelled`，MUST NOT 伪造终态 |
| 停止时批次已自然结束 | 按钮直接失效，走正常汇总 | 无额外影响 |
| 单账号超时 | 该行计失败 + "同步超时" | 迟到 reject MUST NOT 冒 unhandledRejection |
| KMS 不可用 | 明确提示"未上传任何凭证" | MUST NOT 出现明文降级 |
| 恢复后检测判失效 | 该行"凭证已失效，需重新登录" | 账号留在列表，status=expired 由本机证据产生 |
| 云端有墓碑而本机仍有该账号 | 过程区如实报告 | 本机账号与凭证保持不变（不反向删） |
| 断开云端部分失败 | 保留入口 + 显示已删/剩余 | 未删部分仍在云端，可重试 |

## 十二、日志与可观测

- 主进程 `logger` 记：同步开始（计划摘要 n 条 / 并发 / 超时）、每条终态（outcome + code + elapsedMs）、批次汇总。MUST NOT 记录凭证内容、`credential_digest` 之外的明文、access token。
- 静默配置失败必须留日志：KMS/feature flag/业务 API 基址任一未生效时 `log.warn`，不得只在成功分支打日志（AGENTS.md）。
- 埋点（本期不新增 UI 反馈路径，故不做用户侧埋点键，避免死键）：以日志与过程区文案承担可观测性。

## 十三、验收标准

**功能**
1. flag 开 + 已登录 + 本机有账号 → 按钮出现；点击 → 摘要态显示云端真实条数；取消后抓包确认无 PUT/POST。
2. 点【同步】→ 过程区每条账号都有 start→done 两次状态变化，进度与汇总是用户可读懂的具体数字。
3. 设备 A 同步后，设备 B 登录同一身份、同步：设备 B 出现 A 的账号且**不需要扫码即可发布**（发一条测试内容成功），且首次显示"未确认"、自动检测后才变"已登录"。
4. 在 A 删除某账号并同步 → B 同步后该账号不复活；B 上从未同步过的账号不被云端墓碑删除。
5. 断开云端 → 云端 `cloud_accounts`/`cloud_account_tombstones` 该用户计数为 0；本机 `accounts.json` 与 `credentials/**` 逐字节不变（哈希对照取证）。
6. 八平台各自至少一次真机 uid 提取取证（成功产出 uid 的原始响应记录），并对登录页/未登录响应产出"不判成功"负例。

**安全**
7. 直查 `cloud_accounts` 得到的是密文 + 加密 DK；库内任何列都不出现 cookie 明文子串。
8. AAD 篡改（换 platform/uid/userId）解密必须失败。
9. 未认证请求四个端点全部 401/503，响应不含账号字段；A 身份读不到 B 身份的任何记录。

**质量**
10. `pnpm` 单测全绿（含新增主进程/渲染层/repository/校验套件）、CI 真库 job 绿（含"删掉 005 迁移必须变红"的反证）、`test:visual:pixel` 绿、QM-1 打包产物启动 8 秒无 stderr、QM-6 双模型评审无未修 Critical。
11. 新增 locale 键 zh/en 成对且行序一致；渲染层无新增中文字面量。

## 十四、测试策略（对应 tasks.md §6）

| 层 | 内容 | 位置 |
| --- | --- | --- |
| 单元 | 校验表逐条、规范化摘要稳定性、合并计划决策表全行、KMS 缺失 fail-closed、错误码映射 | `packages/api-publish-engine/test/cloud-accounts*.test.js`、`apps/desktop/electron/services/cloud-account-sync.test.js` |
| 集成 | repository 真实 SQL（upsert/唯一约束/墓碑/按用户全清/逐条不整批回滚） | 真库 job（ubuntu + `services: postgres`） |
| 结构锁 | uid 八平台覆盖、`extract` 存在性与负例、preload 方法清单、overlay owner 登记、sender guard 覆盖 | `platform-definitions.test.js`、`preload.test.js`、`overlay-view-suspension.test.js` |
| 渲染层 | flag 三态显隐、摘要渲染、取消无请求、逐条渲染、汇总区分部分成功 | `src/views/Accounts.test.js`、`components/AccountCloudSyncDialog.test.js` |
| 文案 | 整句精确断言（条件段有/无） | `src/locales/accounts-cloud-sync-copy.test.js` |
| 视觉 | `accounts-list` 基线（命令栏多一个按钮）→ 基线只能取自 CI 产物 | `tests/visual-testing/base-screenshots/accounts-list.png` |
| 端到端 | 本机真凭证 × 八平台 uid 取证；两设备（两份 userData）真实合并 | 记录在本文 §十五，人工/脚本取证 |
| 反证 | 每条"防再犯锁"改成 no-op 必须立刻变红 | 提交前逐条执行 |

## 十五、上线、灰度与回滚

**发布顺序（硬约束）**
1. 后端先上：执行 `005_cloud_accounts.sql` 迁移 → 部署带 `/api/v1/me/accounts` 的业务 API → KMS 生产实现配好并冒烟 `wrap/unwrap`。
2. 桌面端合并发布（flag 仍为 false，用户看不到入口）。
3. 打开 `account_cloud_sync` flag → 灰度观察。该 key 已登记进 ops-center `SEED_FLAGS`（`value_type=boolean`、
   `value="false"`、`enabled=0`），供给逻辑是「已存在即跳过」的**增量补齐**，因此存量部署启动后会自动出现该项且默认关闭，
   运营无需手敲 key（回归锁 `ops-center/backend/tests/test_feature_flags_api.py::test_cloud_sync_flag_seeded_into_existing_deployment`
   从**非空旧状态**出发验证「只补不改」）。

运维细节（KMS 生产实现要求、迁移与 readiness 的先后、Nginx 路由、开关双条件、未执行项登记）见
`01-docs/OPS-CLOUD-ACCOUNT-SYNC-2026-09-27.md`。

回滚：关 flag（入口消失，已上云数据保留不动）；彻底回退需额外执行云端数据清除（按用户或全量）。

**如实登记（本 PR 不执行）**
- 生产 ECS 发布、真实 `multi_publish_api` 角色的迁移 runner、`production-smoke.js`、真实双设备端到端 —— 属运维步骤，本 PR 交付到"代码 + 迁移 + CI 真库 + 本机真凭证 uid 取证"为止，并在此声明未执行项，避免形成"已上线"假事实。

**合规**
- 首次同步的隐私提示行即为同意点；`credential_updated_at` 与断开入口保证用户可撤回。
- 隐私声明需新增"平台登录凭证加密托管"条目（本文档 §八 为依据），由文档任务跟进。
