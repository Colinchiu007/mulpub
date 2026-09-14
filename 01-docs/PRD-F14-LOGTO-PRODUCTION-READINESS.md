# F14 Logto 生产就绪 PRD

> 状态：`PASS`（本地实现）；生产验收 `PENDING_EXTERNAL`  
> 日期：2026-07-21  
> 关联：[PRD.md](./PRD.md)、[ARCH-F14-logto-user-system.md](./ARCH-F14-logto-user-system.md)

## 1. 一句话需求

把已完成的 Logto 用户系统从“本地代码可用”推进到“可配置、可迁移、可探测、可备份、可灰度、可回滚、可验收”的生产就绪状态。

## 2. 目标用户

| 用户 | 目标 |
|------|------|
| 运维/发布负责人 | 在没有阅读源码的情况下完成配置、迁移、部署、检查和回滚 |
| 后端工程师 | 明确数据库 schema 版本、启动边界和故障码 |
| QA | 用同一套 smoke 命令验证测试、预发布和生产环境 |
| 安全负责人 | 确认 Secret 不落库、不进镜像、不出现在探针和日志中 |

## 3. P0 范围

1. **生产配置合同**：提供完整 `.env.example` 和离线校验命令；缺少 URL、数据库、Webhook、权益签名等关键配置时 fail closed。
2. **版本化迁移**：按文件顺序执行 PostgreSQL migration，使用 advisory lock 防止多实例并发迁移，记录文件名和 SHA-256；已执行 migration 被修改时拒绝继续。
3. **启动 DDL 边界**：开发环境可显式自动初始化；生产环境要求 `BUSINESS_DATABASE_AUTO_MIGRATE=false`，应用只检查 schema，不在启动期间修改数据库。
4. **深度就绪探针**：`/api/v1/ready` 检查业务 PostgreSQL、migration 状态、OIDC Discovery 和 JWKS；失败返回 503 和脱敏错误码。
5. **可执行 smoke 验收**：检查 Logto discovery/JWKS、API liveness/readiness；可选 Bearer Token 检查 `/api/v1/me`。
6. **备份与恢复校验**：停写确认后分别备份 Logto DB 和业务 DB，`pg_dump` 通过预先打开的私有文件描述符输出，三个备份工件用硬链接原子发布并生成带一致性模式的 SHA-256 manifest；提供恢复前校验、隔离目标、私有文件权限、并发锁和明确的破坏性确认门槛。真实恢复必须把进度写入备份目录之外的状态文件，只有两个数据库均完成且状态为 `complete` 才允许切换。
7. **监控告警**：提供 Prometheus/blackbox 示例，至少覆盖 API ready、OIDC discovery、连续失败和高延迟。
8. **灰度与回滚**：提供 shadow、required、rollback 三阶段检查清单；回滚只切认证开关，不删除身份和 migration 数据。
9. **高风险回归测试**：覆盖并发额度扣减和并发重复 Webhook；所有测试由 API 全量测试入口真实等待。
10. **桌面认证体验**：登录和注册在 Electron 独立认证窗口中完成，不嵌入主 Renderer、不由应用收集密码；窗口仅允许 Logto issuer 与固定回环地址，用户关闭窗口视为取消。第三方身份提供商拒绝嵌入式 user-agent 时回退系统浏览器。
11. **真实业务 API 接入**：完成登录回调后，桌面端必须能向已部署的业务 API 同步业务用户和权益；API 使用独立 PostgreSQL 数据库、受控反向代理和可审计的 production smoke，不得把占位 audience 当作可访问 API 地址。具体执行与回滚见 [DEPLOYMENT-F14-BUSINESS-API-2026-07-24.md](./DEPLOYMENT-F14-BUSINESS-API-2026-07-24.md)。

## 4. P1 范围

- 在有真实 Logto 租户和 PostgreSQL 的 CI 环境运行 production smoke。
- 以至少 50 个并发请求验证额度扣减只允许限额内请求成功。
- 定期自动恢复备份到隔离数据库并校验关键表和行数。

## 5. 明确不做

- 不在仓库中创建真实 Logto 租户、云数据库或短信供应商账号。
- 不提交任何真实密码、Webhook signing key、权益私钥或 Access/Refresh Token。
- 不实现短信验证码发送服务；它由 Logto connector 或成熟付费 API 承担。
- 不新增组织/团队 UI。本轮继续以验证后的 `sub` 作为业务资源 owner。
- 不把真实外部服务未执行的结果标记为 PASS。

## 6. 验收标准

- 配置校验对缺失 Secret、HTTP 公网 issuer、弱数据库口令、生产自动迁移和矛盾认证开关返回非零退出码。
- 两个 migration runner 并发启动时只有一个持锁执行；checksum 漂移被拒绝。
- schema 缺失、数据库不可用、OIDC discovery/JWKS 不合法时 `/api/v1/ready` 返回 503；`/api/v1/health` 仍只表示进程存活。
- readiness 响应和日志不包含数据库 URL、Token、签名 key、邮箱或手机号。
- backup 未确认双库写入已暂停时拒绝执行；确认后输出两个独立 dump 和带 `quiesced` 标记的 manifest，校验失败时 restore 不启动。
- backup 使用独占锁且不覆盖已有快照，Unix 输出目录权限必须为 `0700` 且 dump、manifest、锁文件为 `0600`；Windows 目录必须配置仅运行账号可写的 NTFS ACL。`pg_dump` 不接收输出路径，只能写入父进程持有的 descriptor；dump 与 manifest 在完整写入、`fsync` 和身份校验后通过硬链接发布，不支持原子硬链接的文件系统 fail closed。
- manifest 在锁仍持有时最后发布并完成目录同步；恢复端检测到 `.backup.lock` 时必须返回 `BACKUP_IN_PROGRESS`。失败时不留下可被误用的 manifest，进程异常留下的锁必须阻止自动重试和恢复。
- restore 必须逐一确认两个隔离目标数据库名，并在修改任何数据库前验证两个目标都不含业务对象；使用已校验的 dump 文件描述符和单库事务恢复，并在备份目录之外独占创建状态文件。已有完成、失败或进行中状态时拒绝覆盖。任一库失败时只生成 `failed` 状态，整个临时恢复集不得切换；只有包含两个已恢复数据库且状态为 `complete` 的记录可供切换自动化使用。
- smoke 命令任一关键检查失败即非零退出；输出 JSON 可被 CI 和监控读取。
- API Docker 镜像使用根 lockfile 构建，并包含 production scripts 与 PostgreSQL migrations。
- API Compose 的配置持久化挂载必须覆盖运行时实际读写目录，容器重启后 API Key 状态不得丢失。
- 并发额度测试在 quota=1 时恰好一个成功；同一 Webhook 并发投递只执行一次副作用。
- Node API 全量测试、`git diff --check`、安全审查和 `.quality-gates.md` 自检通过。
- 独立认证窗口使用隔离 Session、`contextIsolation: true`、`nodeIntegration: false`、`sandbox: true`；非法导航和新窗口请求被阻止，登录成功、取消、加载失败均关闭窗口并清理回调服务。

## 7. 外部验收门禁

以下项目在没有真实环境变量/凭据时明确保持 `PENDING_EXTERNAL`，不能以本地测试替代：

1. 真实 Logto 登录、刷新、退出、账号切换和短信验证码。
2. 真实 PostgreSQL migration、备份恢复和并发压力。
3. 真实云端发布、用户暂停/删除后的会话撤销。
4. 真实业务 API 部署后普通用户的首次登录、权益同步、重启恢复、退出和账号切换。

仓库交付的目标是把这些步骤变成“一条命令可执行、结果可审计”，不是代替外部账号和审批。

## 8. 登录失败原因透传与本地会话韧性（2026-09-14 迭代）

> 背景：「点登录却提示『退出失败，当前登录仍然有效。』」事故（详见
> [BUGFIX-IDENTITY-SESSION-CLEAR-FAILED-2026-09-14.md](./BUGFIX-IDENTITY-SESSION-CLEAR-FAILED-2026-09-14.md)）。
> 本节把「失败必须说清原因」与「本地会话清理不得依赖文件删除能力」上升为可验收需求。

### 8.1 目标

1. 用户看到的每一句失败提示，都必须与**实际失败的操作**一致（登录失败不得显示退出失败）。
2. 本地会话的「清空/失效化」不得因宿主环境的文件删除限制而整体失败。
3. 任何身份链路失败都必须可诊断：原始错误码与 cause 链必须进入应用日志。

### 8.2 数据校验

| 校验项 | 规则 | 失败后果 |
|--------|------|----------|
| 主进程状态 `error.code` | 必须为非空字符串；渲染层 `normalizeError()` 兜底为 `IDENTITY_OPERATION_FAILED` | 未知码走中性文案，不得复用具体业务文案 |
| 主进程状态 `error.cleanup` | 可选对象，仅允许 `{ code: string }`；非法形态直接丢弃 | 丢弃后不影响主错误展示 |
| 会话存储信封 | `ciphertext` 必须为字符串；`cleared === true` 视为「已清空」；其余非法结构触发 best-effort 清理并返回空会话 | 损坏数据不阻塞登录 |
| 会话内容 | 必须是对象，且非数组 | 违反时按损坏处理（清理 + 空会话） |
| 重试判定 | 仅 `EPERM / EBUSY / EACCES / EMFILE / ENFILE` 视为瞬时错误并重试（最多 3 次，25/50/100ms） | 其他错误立即上抛，不隐藏真实失败 |
| 残余临时文件回收 | 仅回收 `identity-session.json.<pid>.tmp` 且 mtime 早于 60 秒 | 正在写入的临时文件不得被误删 |

### 8.3 流程与功能逻辑

**登录（`identitySignIn`）**

1. 前置校验（进行中操作、回调配置、已登录需走切换账号）不通过 → 立即失败，不写会话文件；
2. 认证成功 → 同步权益 → `authenticated`；
3. 任一步失败：
   - 主错误 = 失败原因（如 `IDENTITY_AUTH_WINDOW_LOAD_FAILED` / `IDENTITY_SIGN_IN_FAILED`）；
   - 执行本地清理，**清理结果不改写 state 的主错误码**，只在 `error.cleanup` 中附带；
   - 对外抛出的错误保持主错误码，并附 `cleanupCode` 供诊断。

**退出（`identitySignOut`）**：远端撤销失败只作为 `warning`；本地清理失败**是**主错误（`IDENTITY_SESSION_CLEAR_FAILED`），此时保留 `user` 以便重试（与原行为一致）。

**本地会话清空（`SecureTokenStorage.clear()`）**

1. 尝试删除文件（带瞬时错误重试）；
2. 删除失败 → 覆写「已清空」信封（不依赖删除能力），`load()` 返回 `null`；
3. 删除与覆写都失败 → 抛 `IDENTITY_SESSION_CLEAR_FAILED` 并保留原始 `cause`；
4. 成功后回收陈旧临时文件。

**日志**：`signIn` / `signInCleanup` / `tokenStorage.clear` / `clearLocalSession` /
`clearSignInWindowSession` / `getAccessToken` / `restore` / `signOut.remote` 失败均落一条
`Identity <scope> failed: code: message <- cause` 级别 WARN 日志。

### 8.4 交互逻辑

| 状态 | 点击头像 | 面板内容 |
|------|----------|----------|
| `signed_out` / `expired` | 直接发起登录（不展开面板） | — |
| `disabled` | 展开面板 | 说明 + 不显示登录按钮 |
| `authenticated` 等已登录态 | 展开面板 | 会员中心 / 切换账号 / 退出登录 |
| `signing_out` | 展开面板 | 按钮显示「正在退出…」 |
| `error`（未登录） | 展开面板 | 状态说明 = `retryHint`；按钮「重试登录」；底部错误 = 按错误码解析的具体原因（如有 `cleanup` 再追加一条） |

### 8.5 显示项与提示文字（错误码 → 文案，zh/en 成对）

| 错误码 | 提示文字（zh） | i18n key |
|--------|----------------|----------|
| `IDENTITY_SIGN_IN_FAILED` | 登录失败，请重试。 | `memberCenter.loginFailed` |
| `IDENTITY_SIGN_IN_CANCELLED` | 登录已取消，可重新登录。 | `memberCenter.loginCancelled` |
| `IDENTITY_SIGN_IN_IN_PROGRESS` | 登录正在进行中，请稍候。 | `memberCenter.loginInProgress` |
| `IDENTITY_CALLBACK_TIMEOUT` | 登录超时，请重试。 | `memberCenter.loginTimeout` |
| `IDENTITY_CALLBACK_PORT_UNAVAILABLE` / `IDENTITY_CALLBACK_STATE_INVALID` / `IDENTITY_CALLBACK_ALREADY_STARTED` | 登录回调失败（本机回调端口不可用），请重试。 | `memberCenter.loginCallbackFailed` |
| `IDENTITY_AUTH_WINDOW_LOAD_FAILED` / `IDENTITY_AUTH_WINDOW_NAVIGATION_BLOCKED` / `IDENTITY_AUTH_WINDOW_URL_INVALID` | 登录页面加载失败，请检查网络后重试。 | `memberCenter.loginWindowFailed` |
| `IDENTITY_ACCOUNT_SWITCH_REQUIRED` | 当前已登录其他账号，请使用「切换账号」。 | `memberCenter.switchAccountRequired` |
| `IDENTITY_ACCOUNT_SWITCH_FAILED` | 切换账号失败，请稍后重试。 | `memberCenter.switchFailed` |
| `IDENTITY_SIGN_OUT_FAILED` | 退出失败，当前登录仍然有效。 | `memberCenter.signOutFailed` |
| `IDENTITY_OPERATION_IN_PROGRESS` | 另一个账号操作正在进行中，请稍候重试。 | `memberCenter.operationInProgress` |
| `IDENTITY_SESSION_EXPIRED` | 会话已过期 | `memberCenter.statusExpired` |
| `IDENTITY_SESSION_INVALID` | 登录会话无效，请重新登录。 | `memberCenter.sessionInvalid` |
| `IDENTITY_SESSION_CLEAR_FAILED` / `IDENTITY_AUTH_WINDOW_SESSION_CLEAR_FAILED` | 本地登录信息无法删除或清空，通常是安全软件拦截了应用数据目录里的删除操作。请重试；若反复出现，请把该目录加入白名单后重启应用。 | `memberCenter.sessionStoreBlocked` |
| `IDENTITY_SECURE_STORAGE_UNAVAILABLE` | 系统安全存储暂时不可用，无法安全保存登录信息。 | `memberCenter.secureStorageUnavailable` |
| `IDENTITY_NETWORK_UNAVAILABLE` | 网络暂时不可用，请稍后重试。 | `memberCenter.networkUnavailable` |
| `IDENTITY_LOAD_FAILED` | 身份状态加载失败，请重试。 | `memberCenter.identityLoadFailed` |
| `IDENTITY_API_UNAVAILABLE` / `IDENTITY_NOT_CONFIGURED` | 当前运行环境未连接身份服务，仅可查看本地版本与许可证信息。 | `memberCenter.identityDisabledHint` |
| `IDENTITY_CONFIG_INVALID` / `IDENTITY_SDK_INVALID` / `IDENTITY_FETCH_UNAVAILABLE` / `IDENTITY_TOKEN_UNAVAILABLE` | 身份服务暂时不可用，请稍后重试。 | `memberCenter.identityServiceUnavailable` |
| 未登录态状态说明（`error`） | 上次操作未完成，可重试。 | `memberCenter.retryHint` |
| **其他/未知错误码** | 操作失败，请重试。 | `memberCenter.operationFailed` |

**契约**：只有 `IDENTITY_SIGN_OUT_FAILED` 允许使用「退出失败…」文案（由单测遍历断言）。

### 8.6 环境契约（启动器）

Electron 主进程 spawn 前必须经 `apps/desktop/scripts/electron-runtime-env.js` 的
`buildElectronEnv()`，剔除：

- `ELECTRON_RUN_AS_NODE`（否则 Electron 退化为纯 Node）；
- 宿主 safe-delete shim 的激活变量与守卫上下文（`CODEBUDDY_SESSION_ID`/`CLAUDE_SESSION_ID`/
  `CODEBUDDY_TOOL_CALL_ID`/`CODEBUDDY_CONVERSATION_REQUEST_ID`/`CODEBUDDY_SAFE_DELETE_*`/`BASH_ENV`）；
- `NODE_OPTIONS` 中指向 shim 的 `--require` 片段（支持含空格路径与引号两种写法）；
- `PATH` / `PYTHONPATH` 中指向 `extensions/genie/out/vendor/shim` 的条目。

### 8.7 验收标准

1. 未登录态 `error` 且错误码为登录类时，面板**不得**出现「退出失败」文案（单测断言）。
2. 登录失败且清理也失败时，渲染层收到的 `error.code` 必须是主错误码，`error.cleanup.code` 为清理错误码。
3. 「删除被拒绝（错误不带 `.code`）」条件下 `SecureTokenStorage.clear()` 必须成功，且随后 `load()` 返回 `null`。
4. 删除与覆写都失败时抛出的错误必须带 `cause`。
5. 身份链路失败必须产生含 scope 与 cause 链的日志行。
6. `buildElectronEnv()` 对宿主实测注入值（含 `--require="D:/Program Files/.../node-language-shim.cjs"`）净化后不得保留任何 shim 痕迹，且保留其他无关选项与变量。
7. `zh`/`en` 词条成对；`--cjk` 无新增硬编码中文。

### 8.8 非目标

- 不改变 Logto 认证流程与回调契约；
- 不实现「会话文件不可删除时告警并引导用户」的独立 UI 流程（仅提示文案）；
- 不修改宿主 IDE 的 safe-delete 策略（仅做进程环境隔离与本地降级）。
