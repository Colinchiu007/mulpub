# 会员中心功能设计（Member Center Design Spec）

> 版本 v1 | 日期 2026-09-23 | 状态：✅ CEO 签字通过（2026-09-23），进入实施计划
> 范围：Multi-Publish 桌面端「会员中心」页面的产品规格 + 后端底座契约
> 关联真源：`apps/desktop/src/views/MemberCenter.vue`、`apps/desktop/electron/services/identity/*`、`packages/api-publish-engine/src/publish-api-server.js`、`ops-center/docs/pricing-strategy.md`

---

## 0. 背景与现状（探索结论）

- 桌面端已有 `MemberCenter.vue` 骨架：账号信息卡、版本/许可证卡、会员权益卡（online/offline 快照）、资源配额卡。
- 已有 `UpgradeModal.vue`：免费版 vs Pro（¥99 永久）、支付宝/微信**模拟支付**（开发模式）、激活码、7 天试用。
- 权益链路已跑通：electron 主进程 `EntitlementService` 从 `/api/v1/me` 拉取 + RSA 签名离线快照；`license-access-control.js` 按 feature 做 IPC 门禁。
- 服务端（`api-publish-engine`，Postgres）已有表：`identity_users`、`identity_subscriptions`、`identity_entitlement_snapshots`、`identity_entitlement_usage`、`identity_user_sessions`、`identity_webhook_events`；`/api/v1/me` 已能返回 plan/features/quota 与签名快照；`requireFeature` 门禁存在。
- **缺口**：无订单表、无任何真实支付通道、无订阅创建/续费/取消写入路径、无支付回调、无消息中心。桌面端 `PaymentManager` 是纯本地 mock（写 `payment-orders.json`，只有 ¥99 pro，只有 `simulatePayment`）。
- **口径冲突（本次统一）**：桌面端"¥99 永久 Pro 两级" vs 定价文档"三级订阅"。本 spec 采用**三级订阅制**。

---

## 1. 范围与分期

### 1.1 分期
- **阶段 1（本 spec 主体）**：订阅状态模型 + 卖码/后台开通变现 + 配额用量真实化 + 会员中心全部 UI。
- **阶段 2（另立 spec）**：真实内嵌支付（聚合托管，如 Paddle/Lemon Squeezy/国内托管）+ 自动续费 + 续费/退款 webhook。

### 1.2 登录边界
- **强依赖 Logto 登录**：未登录仅见「登录引导 + 本地版本信息」（沿用现有 `status==='disabled'` / `signed_out` 分支）。
- 权益/购买/订阅/订单/用量/消息等全部要求已登录态。

### 1.3 非目标（推后 / 移出会员中心）
- API Key 管理页（自有 Key 配置留在 Settings/Providers，不进会员中心）。
- 内容/数据入口（草稿、已发布记录、数据看板入口不在本页面）。
- 独立设置页（语言/主题/通知偏好）。
- 团队协作、私有部署、SLA 等企业能力。

---

## 2. 三级权益矩阵（数据契约）

> feature 名沿用代码既有枚举（`cloud_publish`、`ai_write`、`video_create`、`schedule_batch` 等），最终以 `BaseAdapter.KNOWN_METHODS` / `requireFeature` 清单为准。
> 带 `*` 的数值为「运营可配」（`config.yaml`），下表给默认值。金额/配额以服务端为唯一真源，客户端禁止硬编码。

| 能力 | 免费 free | 标准 standard ¥29/月（¥199/年） | 专业 pro ¥79/月（¥599/年） |
|---|---|---|---|
| 支持平台数 | 5 | 15 | 不限 |
| 每日发布内容数 | 5 | 50 | 不限（默认上限 1000，运营可配） |
| AI 写稿月额度 | 200 次* | 不限（用自有 Key） | 12000 次* |
| 视频创作 | ✗ | ✓ 500*/月 | ✓ 3000*/月 |
| 定时/批量发布 `schedule_batch` | ✗ | ✓ | ✓ |
| 数据看板 | 基础 | ✓ | ✓ |
| 官方积分配额（按档） | 无 | 中 | 高 |
| 自有 Key | 无限 | 无限 | 无限 |
| 并发任务数 | 1 | 3 | 10 |

**双 Key 体系说明**：自有 Key 不受平台配额限制（费用由用户承担）；官方积分配额按档位（无/中/高）由平台承担并计入 `identity_entitlement_usage`。标准版「AI 写稿不限」的前提是使用自有 Key；走官方积分则受「中」档配额约束。

---

## 3. 后端底座改造（`api-publish-engine` / Postgres）

### 3.1 订阅真源（已有表，补写入路径）
- `identity_subscriptions`（plan / user_id / period / status / expires_at）当前**只读无写**。
- 新增统一 upsert 服务，三条写入通道：① 兑换码核销 ② ops-center 后台开通 ③（阶段 2）支付回调。
- 变更后 `/api/v1/me` 重新签发 entitlement 快照（RSA），客户端 `sync()` 拉新。

### 3.2 订单表（新建）
- `identity_orders`（id / user_id / plan / amount / currency / channel / status / created_at / paid_at / refunded_at / invoice_status）。
- **订单以服务端为准**：桌面端本地 mock `payment-orders.json` 迁移为服务端订单，本地仅缓存展示。（已获用户确认）

### 3.3 兑换码（新建）
- `identity_redeem_codes`（code / plan / duration_days / batch / used_by / used_at / status）。
- 核销接口幂等；复用现有 `LicenseManager.activate` 语义但改为服务端记账 + 回写订阅。

### 3.4 配额用量（已有表，扩展读）
- `identity_entitlement_usage`（feature / period_start / period_end / used）已存在。
- `/api/v1/me` 扩展返回 `usage`（本月已用 / 上限），会员中心渲染进度条；超限抛 `QuotaExceededError`。

### 3.5 消息中心（新建）
- `identity_notifications`（id / user_id / title / body / level / read / created_at）。
- ops-center 发布入口 + `/api/v1/me/notifications`（列表 / 标记已读）。

### 3.6 设备管理（已有表，补接口）
- `identity_user_sessions` 已存在。
- 新增「列出活跃会话」「注销其它设备」接口，基于 Logto + session 表；注销当前会话外的所有 session。

### 3.7 账号资料与安全
- 昵称/头像编辑、绑定手机/邮箱、修改密码：以 Logto 为身份真源，服务端提供 profile 更新与绑定接口。

### 3.8 服务端实现模块结构与端点数据校验契约（2026-09-23 落地）

**模块拆分（因逐文件行数门禁 check-max-lines 的 LEDGER_GREW 而按 mixin 范式拆出，对外 HTTP 契约零改动）：**

| 文件 | 职责 |
|------|------|
| `packages/api-publish-engine/src/publish-api-server.js` | HTTP 路由与 `_handle` 派发链（1342 行） |
| `.../src/auth/publish-api-commerce.js` | 商务/设备辅助方法 mixin（`applyCommerceHelpers` 原型描述符拷回 `PublishApiServer.prototype`）：`_commerceFailure` / `_memberUserId` / `_deviceIdFrom` / `_deviceNameFrom` / `_commerceRepository` |
| `.../src/auth/safe-error-code.js` | 语义错误码守卫 `safeErrorCode`（共享 util，避免循环 require） |
| `.../src/auth/postgres-identity-repository.js` | 身份仓储（446 行） |
| `.../src/auth/postgres-commerce-store.js` | 商务数据访问层（兑换码/订单/订阅/权益快照/通知/设备会话的 SQL + `PostgresCommerceTransaction`，经 mixin 挂回仓储） |

**端点鉴权 scope 契约：** `/api/v1/me*` 读类需 `profile:read`，写类（redeem / notifications.read / sessions.revoke-others / profile 更新）需 `profile:write`；`/api/v1/admin/member/*` 需 `admin:users`。scope 缺失一律 `403 AUTH_SCOPE_MISSING`。

**请求头数据校验：**
- `X-Device-ID`：合同 `^[A-Za-z0-9._:-]{16,128}$`；签发 entitlement 快照与「注销其它设备」必需，缺失 `400 DEVICE_ID_REQUIRED`、格式非法 `400 DEVICE_ID_INVALID`；会话登记场景不合法降级为 null（尽力而为，不阻断）。
- `X-Device-Name`：截断至 100 字符，含控制字符（\u0000-\u001f\u007f）或尖括号 `<>`（存储型 XSS 载荷）一律丢弃为 null，不阻断请求；与 displayName/avatarUrl 守卫对称。

**Profile 更新校验：** 空补丁 `400 PROFILE_PATCH_EMPTY`；`displayName` 非法 `400 DISPLAY_NAME_INVALID`；`avatarUrl` 非法 `400 AVATAR_URL_INVALID`。`PATCH` 与 `PUT /api/v1/me/profile` 互为别名。

**兑换码核销错误映射：** `REDEEM_CODE_NOT_FOUND`(404) / `REDEEM_CODE_USED`(409) / `REDEEM_CODE_EXPIRED`(410) / `REDEEM_CODE_FORMAT`(400) / `PLAN_INVALID`(400) / `USER_ID_REQUIRED`(400，后台开通)。集合家族错误动词 `405 METHOD_NOT_ALLOWED`，未注册路径 `404 ROUTE_NOT_FOUND`。

**CommerceError → HTTP 统一映射（`_commerceFailure`）：** status 夹紧只接受 `[400,599]` 整数，否则一律 500（防服务层 bug 把内部失败伪装成 200，或越界触发 writeHead RangeError 丢失原错误码）；code 必须匹配 `^[A-Z][A-Z0-9_]{2,63}$` 语义码，否则换兜底码 `COMMERCE_INTERNAL_ERROR`，绝不外泄 SQLSTATE 等内部原文；`status>=500` 记 error 日志并回提示「服务暂时不可用」，业务错误（<500）不污染 error 日志、回 `error.message` 或「请求未生效」。

**会员视图 fail-soft：** `/api/v1/me` 聚合 entitlement/snapshot/membership，会员视图不可用时记 `MEMBERSHIP_UNAVAILABLE`（WARN）并仍返回 200（不含 membership 段），保证基础身份/权益不因下游抖动整体失败。plan-matrix 配置非法 `500 PLAN_MATRIX_CONFIG_INVALID`。

---

## 4. 会员中心信息架构（A 布局：左侧分组侧栏 + 右侧内容）

未登录态：整页仅「登录引导 + 本地版本信息」。登录后左栏 7 项 → 右内容：

1. **概览**（吸收卡片流）：当前套餐卡 + 到期/续费 + 3 条用量进度条 + 未读消息 + 快捷升级入口。
2. **账号与安全**：昵称/头像编辑、绑定手机/邮箱、修改密码、活跃设备列表 + 「退出其它设备」。
3. **我的订阅**：当前套餐/周期/到期、套餐对比与升级/降级、续费、自动续费开关（阶段 1 置灰并标注「阶段 2 可用」）。
4. **订单与账单**：订单历史（服务端）、发票申请入口、退款入口。
5. **用量与配额**：AI / 发布 / 视频 / 并发 进度条 + 本月已用明细。
6. **消息**：官方通知列表、已读/未读。
7. **帮助与支持**：客服/反馈、常见问题、关于我们、检查更新（复用现有版本卡）。

---

## 5. 关键交互流程

### 5.1 变现闭环（阶段 1）
会员中心「升级」→ 弹套餐对比 → 选套餐 → 提供 ① 输兑换码 ② 「联系开通 / 第三方店铺」引导 → 服务端核销 upsert 订阅 → 客户端 `sync()` 拉新快照 → 权益/配额即时刷新。**不内嵌真实扣款。**

### 5.2 到期降级
`expires_at` 过期 → `/api/v1/me` 回落 free → `requireFeature` 拒绝受控功能 → 会员中心提示续费。

### 5.3 配额超限
`increment_usage` 超限抛 `QuotaExceededError` → 进度条满 + 引导升级。

---

## 6. 前端组件与复用

- 扩 `MemberCenter.vue` 为**带子路由的壳**（左栏 + `<router-view>`），各模块拆子视图组件；复用 `useIdentity` / `identity` store / `license` store / `UpgradeModal`。
- 新增文案一律写入 `locales/zh.js` + `en.js` **成对**（CI Gate 7 `check-locale-sync.js` 拦截）。
- 遵循项目 UI 规范（既有 cohere 卡片体系 + 奶油/薰衣草精致化方向 + Staggered Reveal 动效）。
- IPC 新增 `subscription:*` / `orders:*` / `notifications:*` / `account:*` / `sessions:*`，全部走 `withSenderCheck` + 纯 JSON 序列化（Vue ref 取出的对象 `JSON.parse(JSON.stringify())` 脱壳后再传）。

---

## 7. 错误处理与安全

- 沿用 IPC file URL canonical 合同、entitlement 离线宽限（默认 7 天）、打包态以 `app.isPackaged` 为准（禁 `NODE_ENV`/`ELECTRON_IS_DEV` 让打包应用进开发短路）。
- 兑换/开通/退款等写操作幂等 + 服务端校验；金额/套餐以服务端矩阵为唯一真源。
- 敏感操作（改密码、退出设备、退款）二次确认。
- 真实错误不得静默（沿用自动更新静默合同的边界：网络阻断类静默，签名/下载类不吞）。

---

## 8. 验收标准（阶段 1）

1. 未登录 → 只见登录引导；登录 → 7 栏可用。
2. 输兑换码 / 后台开通后，套餐、feature 门禁、配额在客户端 30s 内一致刷新；离线重启后仍生效（快照）。
3. 三档套餐各自 feature 门禁与配额数值与 §2 矩阵一致（含绕过 renderer 的直接调用回归、非支持枚举回归）。
4. 设备管理能列活跃会话并注销其它设备；消息能接收/标记已读。
5. 订单/账单以服务端为准，本地缓存与服务端一致。
6. zh/en 成对；QM-1 打包验证通过；Story2Video 等既有场景不回归。

---

## 9. 测试策略（TDD 要点）

- **契约测试**：`/api/v1/me` 返回结构（plan/features/quota/usage/notifications）；三档矩阵数值断言。
- **门禁测试**：`requireFeature` 对每档 feature 的正/负例；`QuotaExceededError` 触发路径。
- **兑换码**：核销幂等、重复核销、过期码、跨账号使用。
- **订阅状态机**：开通/升级/降级/到期降级 转移；快照离线宽限。
- **设备/会话**：注销其它设备后当前会话保活。
- **前端**：`MemberCenter` 壳 + 子路由挂载、未登录分支、IPC 序列化、locales 成对。
- **打包**：改 `apps/desktop/electron/` 后 QM-1 完整打包 + require 链 + 8s 启动。

---

## 10. 待办登记（进入实施计划前）

- [x] 阶段 2 spec：支付通道选型（Paddle / Lemon Squeezy / 国内托管）+ 自动续费 + webhook。→ 已产出 `01-docs/DESIGN-MEMBER-CENTER-P2-PAYMENT-2026-09-24.md`（2026-09-24，待 CEO 签字）。
- [ ] ops-center 后台：兑换码批次生成、订阅手动开通、消息发布三个运营入口。
- [ ] `config.yaml`：§2 带 `*` 数值的运营可配项落地。
- [ ] 数据迁移：本地 `payment-orders.json` → 服务端订单的一次性迁移/兼容策略。
