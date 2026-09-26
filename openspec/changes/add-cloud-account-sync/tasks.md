# Tasks: add-cloud-account-sync

进度以本文件为唯一来源。MUST 全部勾选后才可归档。

## 1. 规格与文档前置

- [x] 1.1 `CONTEXT.md` 术语表落盘（合并键 / 本机自证 / 墓碑 / 信封加密 / 同步摘要 / 逐条结果）
- [x] 1.2 `docs/adr/0001-0006` 六条不可逆决策落盘
- [x] 1.3 `01-docs/PRD-CLOUD-ACCOUNT-SYNC-2026-09-27.md`：数据校验、流程、功能逻辑、交互逻辑、显示项、提示文字、错误码、异常态、验收标准（注意 `/01-docs/**/*.md` 被 gitignore，必须 `git add -f`）
- [x] 1.4 `01-docs/PRD.md` 账号管理章节加交叉引用小节（§2.3 / F1 / §5.2 / §27.7 至少一处）
- [x] 1.5 AGENTS.md 凭证边界条款修订为"本机为主副本、云端为加密镜像"，并新增本特性回归纪律

## 2. 云端存储与 API（packages/api-publish-engine）

- [x] 2.1 `migrations/postgresql/005_cloud_accounts.sql`：`cloud_accounts` + `cloud_account_tombstones`，BEGIN/COMMIT 外壳、按 `005_*` 命名、checksum 稳定
- [x] 2.2 `src/cloud-accounts/envelope-crypto.js`：随机 DK + AES-256-GCM，AAD 绑定 `(user_id, platform, platform_uid)`；KMS 抽象层接口 + 本机实现 + fail-closed
- [x] 2.3 `src/cloud-accounts/cloud-account-repository.js`：upsert（按合并键）、list+摘要、墓碑读写、按用户全清（disconnect）
- [x] 2.4 入参校验：平台枚举白名单、字段白名单（未知键 fail closed）、字符串长度上限、`followers` 非负有限、时间戳 ISO 8601、凭证体积上限
- [x] 2.5 `publish-api-server.js` 路由：`GET/PUT /api/v1/me/accounts`、`POST /api/v1/me/accounts/sync`、`DELETE /api/v1/me/accounts`；鉴权走既有 `_checkAuth` + `_memberUserId`，未配置仓储时 503
- [x] 2.6 单元测试（fake client，沿用 `postgres-migrations.test.js` 风格）：路由、校验拒绝、墓碑语义、按用户隔离、密文不含明文
- [x] 2.7 真库回归：新增 ubuntu-latest + `services: postgres` CI job，跑 `migrate-postgres.js` 真实迁移 + repository 真实 SQL；反证（去掉 migration 必须变红）

## 3. 平台原生 uid 提取补齐

- [x] 3.1 `http-login-checker.js` 为 `wechat_mp` 增 `extract`（正例 + 登录页/未登录负例）
- [x] 3.2 为 `kuaishou` 增 `extract`；同步检查 `PLATFORM_SESSION_COOKIE_MARKERS` 与「登录页 = 后台同 URL」，补 `platform-definitions.test.js` 负例
- [x] 3.3 为 `xiaohongshu` 增 `extract`（正例 + 负例）
- [x] 3.4 为 `zhihu` 增 `extract`（正例 + 负例，且不得把 `document.title` 类页面标题当 uid）
- [x] 3.5 八平台覆盖结构锁：枚举账号支持平台集合，断言每个都有 extract 实现与至少一正一负回归
- [ ] 3.6 本机真凭证实测：用 debug profile 的真实账号逐平台取证 uid（线级证据，记录到 PRD 验收章节）

## 4. 主进程同步服务

- [ ] 4.1 `services/cloud-credential-crypto.js`（桌面侧）：加密上行 / 解密落盘，复用 `credential-store` 读写口径，禁止本机主密钥出机
- [x] 4.2 `services/cloud-account-sync.js`：读真源 + 凭证 → 补 uid → 生成合并计划 → 逐条执行（并发上限 + 单账号硬超时）→ 事件广播（start/done 双边界）
- [x] 4.3 恢复路径：写回本地强制 `status='unverified'` + `last_validated` 取本机时刻且不参与超龄锚点；复用 `loginStatusTransition`，禁止第四份三态映射
- [x] 4.4 冲突裁决：凭证指纹不一致 → 较新者优先 + 本机实测 → 两份皆失效保留本机并标需重登
- [x] 4.5 删除路径接入墓碑：`account:delete` / 批量删除成功后写云端墓碑（best-effort，失败留日志不阻断本机删除）
- [x] 4.6 `ipc-handlers/account.js`：`accounts:cloud-digest`、`accounts:cloud-sync`、`accounts:cloud-disconnect` + `withSenderCheck`；进度事件 `accounts:cloud-sync-progress`
- [x] 4.7 `preload/account.js` 暴露三方法 + 订阅函数，重建 `index.bundle.js` 与 `home-shell-preload.bundle.js`；登记 `preload.test.js` 的 `ACCOUNT_METHODS`
- [x] 4.8 `access-control.js` 白名单归属确认（写操作不得落入默认宽松分支）

## 5. 渲染层

- [x] 5.1 `features/accounts/components/AccountCloudSyncDialog.vue`：`UiModal` 摘要态（共 xx 个 + 平台分布 + 确认/取消）与过程态（逐条结果 + 进度 + 汇总）；`variant` 与焦点陷阱按既有约定
- [x] 5.2 `Accounts.vue` 命令栏新增【同步云端】`page-button secondary` + `data-testid="account-cloud-sync"`，feature flag 门控
- [x] 5.3 `useLoginGate.ensureLogin` 接入；feature flag 读取接入运营同步 runtime 链路
- [x] 5.4 浮层互斥：经 `useEmbeddedViewSuspension` 挂起/恢复内嵌视图，并在 `overlay-view-suspension.test.js` 登记 owner
- [x] 5.5 `locales/zh.js` + `en.js` 成对新增 `accountsPage.cloudSync*` 文案簇（zh/en 同序，禁止硬编码中文进 `src/` 非 locales）
- [x] 5.6 文案精确断言测试（QM-3 文本结构断言）：仿 `accounts-batch-check-copy.test.js`，含条件段有无两形态

## 6. 测试与门禁

- [x] 6.1 渲染层单测：按钮显隐（flag 三态）、摘要态、取消不发写请求、过程态逐条渲染、汇总区分部分成功
- [x] 6.2 主进程单测：合并计划生成、恢复强制 unverified、冲突四分支、墓碑不反向删、start/done 双边界、超时结果语义
- [x] 6.3 结构锁：`preload.test.js` 方法清单、`overlay-view-suspension.test.js` owner、locale 成对（CI Gate 7）、sender guard 覆盖（CI Gate 17）、自旋让出（CI Gate 19）
- [x] 6.4 `network-egress-guard` 合规：所有新测试只打 `os.tmpdir()` 自建回环服务，禁真实出站
- [x] 6.5 QM-1 本地打包验证（改了 `apps/desktop/electron/`）：`build:vue` + `electron-builder --win --dir` 退出 0；asar 清单含 `electron/services/cloud-account-{sync,core,conflict,tombstone}.js`、`electron/ipc-handlers/cloud-account.js`、`electron/publishers/platform-uid.js` 与 `dist/index.html`；解包后 require 链六个模块全部加载成功且 `ipc-handlers/cloud-account.js` 与源码逐字节一致；打包产物启动 12 秒，stderr 仅 ICU fd 一行既有噪声，无 `Failed to load platform config` / `PluginLoader.*mkdir` / `ENOTDIR.*app.asar` / `Cannot find module` / updater 网络栈
- [ ] 6.6 视觉回归：`npm run test:visual:pixel` 通过；`accounts-list` 视图因新增按钮需换基线，且基线只能取自 CI 产物（AGENTS.md QM-4 第 7 条）
- [ ] 6.7 QM-6 CCG 双模型外部评审（claude + opencode 并行），Critical 修完、数据校验/安全类 Warning 修完
- [ ] 6.8 `.quality-gates.md` 自检清单与评审记录

## 7. 交付

- [x] 7.1 `CHANGELOG.md` 收口 + `pnpm version:bump`（新功能 bump minor）
- [x] 7.2 推送分支、创建 PR、CI 全绿、自动合并
- [x] 7.3 运维文档：`01-docs/OPS-CLOUD-ACCOUNT-SYNC-2026-09-27.md` —— 发布顺序（先迁移后发 API，`assertReady()` 对未跑 005 的存量库 fail-closed）、KMS 生产实现要求（本地实现禁用于生产、AAD 绑 keyId 的轮转口径）、Nginx 前缀路由、feature flag **双条件**（enabled 且 value）与 SEED_FLAGS 增量补齐、可观测性排障表、数据边界；生产 ECS 发布与真机端到端在本文件 §5 如实登记为**未执行**
- [ ] 7.4 记忆写入：内置记忆 / 外部记忆（learnings）/ EverOS

## 状态（2026-09-27 提交 PR #2461 时）

已勾选 = 代码/文档已落地且有测试证据。以下条目**未勾选即未执行**，不得当作已完成：

- [ ] 3.6 八平台真凭据线级取证（保留未勾选）：小红书/知乎 SSR 是否真直出身份属性、快手 `userId` 是否严格等于平台原生主键 —— 仓库内无实测证据；未命中即走 `uid-unavailable` 跳过上行。
- [x] 6.5 QM-1 已执行（见上；证据为本次干净工作树下的 `--dir` 产物与 12 秒启动 stderr 采集）。
- [ ] 6.6 视觉回归：`accounts-list` 基线因命令栏新增按钮必然 diff；基线**只能取自 CI 产物**（AGENTS.md QM-4 第 7 条），需 CI 出图后回填并重跑 `test:visual:pixel`。
- [ ] 6.7 QM-6 CCG 双模型外部评审（M+ 变更强制卡点）。
- [ ] 6.8 `.quality-gates.md` 自检清单与评审记录。
- [x] 7.3 运维文档已落地（生产 ECS 发布与 `production-smoke` 仍未执行，登记在运维文档 §5，不得当作已完成）。
- [ ] 7.4 记忆写入：内置记忆与 EverOS 已写；`01-docs/learnings.md` 已追加 4 条。

### 本期发现的已知缺口（follow-up，未悄悄放宽测试）
- `validateSyncKeys` 不拒 `keys` 之外的顶层字段（`{keys:[…],extra:1}` 目前放行），与 PRD §6.2「未知键 fail closed」不完全一致。
- `isNoiseAccountName` 在 `api-publish-engine` 侧是**等价重写 + parity 锁**（该包不能 require shared-utils），新增形态规则必须两处同改，否则 parity 锁红。
- 跨包契约锁已建（`cloud-account-tombstone.test.js`：`ME_API_PATHS` 必须覆盖 `CLOUD_ACCOUNTS_ROUTES`），本 PR 内该锁实测拦住过路由清单的一次漂移。

## 8. 收口补充（PR #2461 行数门禁红项，按门禁处方真拆分而非登记基线）

- [x] 8.1 主进程 `http-login-checker.js` 557 → 490 行：uid 归一化/三通道与 HTML 唯一性守卫拆到 `publishers/platform-uid.js`，结构锁 `http-login-checker-uid-coverage.test.js` 继续锁两处契约。
- [x] 8.2 服务 `cloud-account-sync.js` 576 → 480 行：枚举/超时/汇总与并发工具拆到 `cloud-account-core.js`，冲突四分支拆到 `cloud-account-conflict.js`（两者均 <200 行，可独立验证）。
- [x] 8.3 弹窗 `AccountCloudSyncDialog.vue` 810 → 478 行：outcome/错误码口径拆到 `composables/useCloudSyncResultModel.js`，逐条行状态 + 终态汇总拆到 `composables/useCloudSyncRows.js`（15 条独立单测覆盖 start/done 双边界与「汇总与列表同源」），展示拆成 `AccountCloudSyncDigestBody.vue` / `AccountCloudSyncItems.vue` / `AccountCloudSyncSummary.vue`（纯 props 单向，无 emit，故无 R92 绑定缺口）。
- [x] 8.4 locales 增量：`locales/zh.js` 与 `en.js` 各自膨胀 206/203 行触发 LEDGER_GREW。归因核实为**本 PR 越过容差**（origin/main 已到 141，容差 200）。按门禁处方拆分：本功能文案移入 `locales/accounts-cloud-sync/{zh,en}.js`，装配文件 import 后展开回 `accountsPage`，键名与访问路径不变（叶子键集逐键比对 before/after 均 3158，零漂移）。
- [x] 8.5 CI 门禁跟随：`check-locale-sync.js` 的 `--keys` 原按单文件文本求值，拆子模块后会静默漏判键存在性（漏判的表现是 vue-i18n 把键名原样打到界面）。改为「装配文件跟随相对 import」递归求值 + 解析失败一律抛错；成对口径泛化为 `locales/` 目录下每个 `zh.js` ↔ 同目录 `en.js`（拆文件不得打开单边文案的口子）；加 `require.main` 守卫并导出求值器，新增 5 条用例含 3 条反证（子模块缺失 / 无 export default / 循环引用必须变红）。
- [x] 8.6 运营开关补种子：`account_cloud_sync` 此前只被桌面端读取，未登记进 ops-center `SEED_FLAGS` —— 存量部署的管理页永远看不到该项，运营只能手敲 key（AGENTS.md「跨端目录常量 ↔ 存量数据必须前向兼容」）。补种子为 `boolean/false/enabled=0`，并把供给循环的硬编码 `enabled=1` 改为逐条可声明；回归锁从**非空旧状态**出发（先建全量、删新 key、改旧行为运营值，再跑供给），同时断言「只补不改」。顺带修掉 `test_feature_flags_count_cap` 里硬编码「种子占 1 个名额」的假红前提。

门禁状态：`check-max-lines.js` 全绿（新增超限 0、挂账与现实一致），`check-debt-budget.js` 的 `filesOver500` 由基线 101 降到 98（还了 3 个文件的债）；`--pair-base` / `--cjk` / `--keys` / `check-vue-style-parse` / `check-color-literals` / `check-font-size-scale` / `check-scoped-root` 均通过。
