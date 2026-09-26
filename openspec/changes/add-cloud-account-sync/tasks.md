# Tasks: add-cloud-account-sync

进度以本文件为唯一来源。MUST 全部勾选后才可归档。

## 1. 规格与文档前置

- [ ] 1.1 `CONTEXT.md` 术语表落盘（合并键 / 本机自证 / 墓碑 / 信封加密 / 同步摘要 / 逐条结果）
- [ ] 1.2 `docs/adr/0001-0006` 六条不可逆决策落盘
- [ ] 1.3 `01-docs/PRD-CLOUD-ACCOUNT-SYNC-2026-09-27.md`：数据校验、流程、功能逻辑、交互逻辑、显示项、提示文字、错误码、异常态、验收标准（注意 `/01-docs/**/*.md` 被 gitignore，必须 `git add -f`）
- [ ] 1.4 `01-docs/PRD.md` 账号管理章节加交叉引用小节（§2.3 / F1 / §5.2 / §27.7 至少一处）
- [ ] 1.5 AGENTS.md 凭证边界条款修订为"本机为主副本、云端为加密镜像"，并新增本特性回归纪律

## 2. 云端存储与 API（packages/api-publish-engine）

- [ ] 2.1 `migrations/postgresql/005_cloud_accounts.sql`：`cloud_accounts` + `cloud_account_tombstones`，BEGIN/COMMIT 外壳、按 `005_*` 命名、checksum 稳定
- [ ] 2.2 `src/cloud-accounts/envelope-crypto.js`：随机 DK + AES-256-GCM，AAD 绑定 `(user_id, platform, platform_uid)`；KMS 抽象层接口 + 本机实现 + fail-closed
- [ ] 2.3 `src/cloud-accounts/cloud-account-repository.js`：upsert（按合并键）、list+摘要、墓碑读写、按用户全清（disconnect）
- [ ] 2.4 入参校验：平台枚举白名单、字段白名单（未知键 fail closed）、字符串长度上限、`followers` 非负有限、时间戳 ISO 8601、凭证体积上限
- [ ] 2.5 `publish-api-server.js` 路由：`GET/PUT /api/v1/me/accounts`、`POST /api/v1/me/accounts/sync`、`DELETE /api/v1/me/accounts`；鉴权走既有 `_checkAuth` + `_memberUserId`，未配置仓储时 503
- [ ] 2.6 单元测试（fake client，沿用 `postgres-migrations.test.js` 风格）：路由、校验拒绝、墓碑语义、按用户隔离、密文不含明文
- [ ] 2.7 真库回归：新增 ubuntu-latest + `services: postgres` CI job，跑 `migrate-postgres.js` 真实迁移 + repository 真实 SQL；反证（去掉 migration 必须变红）

## 3. 平台原生 uid 提取补齐

- [ ] 3.1 `http-login-checker.js` 为 `wechat_mp` 增 `extract`（正例 + 登录页/未登录负例）
- [ ] 3.2 为 `kuaishou` 增 `extract`；同步检查 `PLATFORM_SESSION_COOKIE_MARKERS` 与「登录页 = 后台同 URL」，补 `platform-definitions.test.js` 负例
- [ ] 3.3 为 `xiaohongshu` 增 `extract`（正例 + 负例）
- [ ] 3.4 为 `zhihu` 增 `extract`（正例 + 负例，且不得把 `document.title` 类页面标题当 uid）
- [ ] 3.5 八平台覆盖结构锁：枚举账号支持平台集合，断言每个都有 extract 实现与至少一正一负回归
- [ ] 3.6 本机真凭证实测：用 debug profile 的真实账号逐平台取证 uid（线级证据，记录到 PRD 验收章节）

## 4. 主进程同步服务

- [ ] 4.1 `services/cloud-credential-crypto.js`（桌面侧）：加密上行 / 解密落盘，复用 `credential-store` 读写口径，禁止本机主密钥出机
- [ ] 4.2 `services/cloud-account-sync.js`：读真源 + 凭证 → 补 uid → 生成合并计划 → 逐条执行（并发上限 + 单账号硬超时）→ 事件广播（start/done 双边界）
- [ ] 4.3 恢复路径：写回本地强制 `status='unverified'` + `last_validated` 取本机时刻且不参与超龄锚点；复用 `loginStatusTransition`，禁止第四份三态映射
- [ ] 4.4 冲突裁决：凭证指纹不一致 → 较新者优先 + 本机实测 → 两份皆失效保留本机并标需重登
- [ ] 4.5 删除路径接入墓碑：`account:delete` / 批量删除成功后写云端墓碑（best-effort，失败留日志不阻断本机删除）
- [ ] 4.6 `ipc-handlers/account.js`：`accounts:cloud-digest`、`accounts:cloud-sync`、`accounts:cloud-disconnect` + `withSenderCheck`；进度事件 `accounts:cloud-sync-progress`
- [ ] 4.7 `preload/account.js` 暴露三方法 + 订阅函数，重建 `index.bundle.js` 与 `home-shell-preload.bundle.js`；登记 `preload.test.js` 的 `ACCOUNT_METHODS`
- [ ] 4.8 `access-control.js` 白名单归属确认（写操作不得落入默认宽松分支）

## 5. 渲染层

- [ ] 5.1 `features/accounts/components/AccountCloudSyncDialog.vue`：`UiModal` 摘要态（共 xx 个 + 平台分布 + 确认/取消）与过程态（逐条结果 + 进度 + 汇总）；`variant` 与焦点陷阱按既有约定
- [ ] 5.2 `Accounts.vue` 命令栏新增【同步云端】`page-button secondary` + `data-testid="account-cloud-sync"`，feature flag 门控
- [ ] 5.3 `useLoginGate.ensureLogin` 接入；feature flag 读取接入运营同步 runtime 链路
- [ ] 5.4 浮层互斥：经 `useEmbeddedViewSuspension` 挂起/恢复内嵌视图，并在 `overlay-view-suspension.test.js` 登记 owner
- [ ] 5.5 `locales/zh.js` + `en.js` 成对新增 `accountsPage.cloudSync*` 文案簇（zh/en 同序，禁止硬编码中文进 `src/` 非 locales）
- [ ] 5.6 文案精确断言测试（QM-3 文本结构断言）：仿 `accounts-batch-check-copy.test.js`，含条件段有无两形态

## 6. 测试与门禁

- [ ] 6.1 渲染层单测：按钮显隐（flag 三态）、摘要态、取消不发写请求、过程态逐条渲染、汇总区分部分成功
- [ ] 6.2 主进程单测：合并计划生成、恢复强制 unverified、冲突四分支、墓碑不反向删、start/done 双边界、超时结果语义
- [ ] 6.3 结构锁：`preload.test.js` 方法清单、`overlay-view-suspension.test.js` owner、locale 成对（CI Gate 7）、sender guard 覆盖（CI Gate 17）、自旋让出（CI Gate 19）
- [ ] 6.4 `network-egress-guard` 合规：所有新测试只打 `os.tmpdir()` 自建回环服务，禁真实出站
- [ ] 6.5 QM-1 本地打包验证（改了 `apps/desktop/electron/`）：electron-builder 产物 + asar 清单 + require 链 + 启动 8 秒无 stderr
- [ ] 6.6 视觉回归：`npm run test:visual:pixel` 通过；`accounts-list` 视图因新增按钮需换基线，且基线只能取自 CI 产物（AGENTS.md QM-4 第 7 条）
- [ ] 6.7 QM-6 CCG 双模型外部评审（claude + opencode 并行），Critical 修完、数据校验/安全类 Warning 修完
- [ ] 6.8 `.quality-gates.md` 自检清单与评审记录

## 7. 交付

- [ ] 7.1 `CHANGELOG.md` 收口 + `pnpm version:bump`（新功能 bump minor）
- [ ] 7.2 推送分支、创建 PR、CI 全绿、自动合并
- [ ] 7.3 运维文档：KMS 生产实现要求、`BUSINESS_DATABASE_MIGRATIONS_DIR` 与 `005` 发布步骤、feature flag 打开顺序；生产部署与真机端到端**如实登记未执行**
- [ ] 7.4 记忆写入：内置记忆 / 外部记忆（learnings）/ EverOS
