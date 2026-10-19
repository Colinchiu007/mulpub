# PRD：会员档位机制落地（契约层 / 生命周期 / 客户端校验）

> 版本 v1.0 | 日期 2026-10-20 | 状态：🟡 待 CEO 签字
> 上游依据：`01-docs/MECHANISM-MEMBER-TIERS-2026-10-19.md`（v1.1 档位总表与六条硬规则）、
> `01-docs/MECHANISM-MEMBER-TIERS-DEEP-2026-10-19.md`（v2.1 可执行性/经济学/生命周期）。
> 本 PRD 只覆盖**本轮真正落地的代码面**；未落地项见 §12，不得在对外材料里当作已有能力。

---

## 1. 一句话

把会员档位从「文档里的表」变成「服务端下发、客户端可校验、跨档可保护、到期可收尾」的
可执行契约——新增四项 limits、三条权益轴、档位序保护与到期宽限，并同步调价与视频配额。

---

## 2. 背景

v1.1 文档给出了三档（free / standard / pro）的功能与额度总表，v2.1 进一步指出四个结构性缺口：

| # | 缺口 | 证据 | 本轮处置 |
|---|---|---|---|
| G1 | `limits` 从未进入签名快照，客户端 `normalizeEntitlement()` 又整段丢弃 | `publish-api-server.js` 快照只含 plan/features/quota；`entitlement-service.js` 归一化无 limits | ✅ 快照与响应均下发，客户端透传（§4.3、§5.1） |
| G2 | standard 与 pro 的 `features` **逐字节相同**，升级无感知 | `plan-matrix.js` features 只由 video/schedule/dashboard 派生 | ✅ 派生 `cloud_account_sync` / `batch_publish` / `tier_access_*`（§4.2） |
| G3 | 跨档续叠把高档剩余期整体降级 | `UPSERT_SUBSCRIPTION` 无条件 `plan = EXCLUDED.plan` | ✅ 档位序保护（§6.1） |
| G4 | 到期即悬崖，在线用户无收尾期 | `settleExpiry` 一次性写 free 快照 | ✅ 7 天宽限 + 只读看板保留（§6.2） |

价格与视频配额依据 v2.1 §C2.3（结构 A：相邻档 2.0×，行业中位）与 §C4.3（3× 余量原则）。

---

## 3. 范围

### 3.1 本轮做（代码）

1. `plan-matrix.js`：新增 `rank` / `maxDevices` / `maxCloudAccounts` / `batchSizePerRun` / `modelTier`；
   价格结构调整；`videoMonthly` 500→300；features/limits 扩展；导出 `PLAN_RANK` / `planRank()`。
2. `publish-api-server.js`：签名快照携带 `limits` / `graceUntil` / `previousPlan`；`/api/v1/me` 同步透传。
3. `entitlement-service.js`（主进程）：`normalizeEntitlement()` 透传 `limits` / `graceUntil` / `previousPlan`。
4. `stores/identity.js`（渲染层）：同源透传并深拷贝隔离。
5. `postgres-commerce-store.js`：跨档续叠档位序保护（低档码只延时长不改档位）。
6. `subscription-service.js`：兑换/后台开通走「生效档位」；`settleExpiry` 写入宽限快照。
7. 客户端：`features/member/plan-limits.js` 纯函数 + 发布页平台数上限拦截 + 弹窗文案。
8. 测试与文档（本 PRD、pricing-strategy、机制文档状态、CHANGELOG、执行记录）。

### 3.2 本轮不做（明确记录，防误导）

| 未做项 | 原因 | 归口 |
|---|---|---|
| 设备数**服务端强制** | 需要在会话登记处新增活跃设备计数与 409 契约，属独立 API 变更 | 下一批（§12） |
| 云账号配额**服务端扣减** | 云同步 upsert 入口需接配额校验，涉及 cloud-accounts 模块 | 下一批（§12） |
| 生命周期触点（额度 80%/到期前/D+7） | 需要通知触发点与去重策略，独立立项 | 下一批（§12） |
| 到期横幅 UI | 本轮只透传 `graceUntil`，UI 未接线（无视觉变更，避免视觉门禁风险） | 下一批 |
| proration / 试用 / 在线支付 | 支付未接通，归 P2-PAYMENT | P2-PAYMENT |

---

## 4. 数据契约

### 4.1 `plan-matrix.js` 字段（服务端唯一真源）

| 字段 | 含义 | free | standard | pro | 校验 |
|---|---|---|---|---|---|
| `rank` | 档位序（跨档续叠保护） | 0 | 1 | 2 | 整数 ≥0；**不可被 overrides 覆盖** |
| `maxDevices` | 登录设备数上限 | 2 | 3 | -1（不限） | 整数 ≥-1；-1 在白名单内 |
| `maxCloudAccounts` | 云凭证同步账号数 | 0（不提供） | 20 | -1（不限） | 整数 ≥-1；0 是「本档不提供」而非「不限」 |
| `batchSizePerRun` | 单次批量发布条数上限 | 1（单篇） | 10 | -1（不限） | 整数 ≥-1；1 表示不派生批量能力 |
| `modelTier` | 模型分层访问级别 | 0 | 1 | 2 | 整数 0-2；**-1 被拒** |
| `videoMonthly` | 视频月配额 | 0 | **300**（原 500） | 3000 | 整数 ≥-1 |
| `priceMonthlyCents` / `priceYearlyCents` | 价格（分） | 0 / 0 | 5900 / 49900 | **11900 / 99900**（原 7900 / 69900） | 整数 ≥0 |

**兼容性说明**：
- `dailyPublish` 仍**不允许 -1**（它派生 `cloud_publish_monthly`，`consumeFeature` 要求 `limit >= 0`）。
- `rank` **不在 `NUMERIC_KEYS`**：运营 overrides 尝试覆盖时抛 `PLAN_MATRIX_CONFIG_INVALID`。
  理由：档位序可配 ⇒ 改错一个数就能让降级保护静默失效，而这类错误在日志里不可见。
- 未知档位：`planRank()` 返回 `-1`（「无法比较」），**不得**当 0/2 参与大小比较。

### 4.2 `features` 派生规则（与原规则兼容）

```
features = ['cloud_publish', 'ai_write']
+ video_create           当 videoMonthly > 0
+ schedule_batch         当 scheduleBatch === true
+ dashboard_full         当 dashboard === 'full'
+ cloud_account_sync     当 maxCloudAccounts !== 0      ← 本轮新增
+ batch_publish          当 batchSizePerRun !== 1       ← 本轮新增
+ tier_access_standard   当 modelTier >= 1              ← 本轮新增
+ tier_access_pro        当 modelTier >= 2              ← 本轮新增
```

派生后实际结果：

| 档 | features |
|---|---|
| free | cloud_publish, ai_write |
| standard | cloud_publish, ai_write, video_create, schedule_batch, dashboard_full, **cloud_account_sync, batch_publish, tier_access_standard** |
| pro | 同 standard + **tier_access_pro** |

这直接消除 G2（两档 features 相同）：升级 pro 至少多一项 `tier_access_pro`，且 limits 四项全放宽。

### 4.3 entitlement 快照新增字段

签名快照（`GET /api/v1/me` 的 `entitlementSnapshot.token` payload）新增：

| 字段 | 类型 | 产生方 | 消费方 | 缺省行为 |
|---|---|---|---|---|
| `limits` | object | `_buildEntitlementSnapshot` | `normalizeEntitlement` → store → 发布页 | 缺失 ⇒ 客户端按「不限」放行 |
| `graceUntil` | ISO string | `settleExpiry` 写入快照 | 客户端透传（后续横幅） | 缺失 ⇒ 非宽限态 |
| `previousPlan` | string | `settleExpiry` | 客户端透传（文案用） | 缺失 ⇒ 未知上一档 |

`/api/v1/me` 的 `entitlement` 对象同步透传三者（未签名响应与签名快照同源，避免两处漂移）。

### 4.4 客户端归一化校验（必须逐条实现）

`normalizeEntitlement(value)`（主进程）与 `normalizeState`（渲染层）对新增字段的规则：

| 输入 | 输出 | 理由 |
|---|---|---|
| `limits` 是普通对象 | 深拷贝（`JSON.parse(JSON.stringify())`） | 隔离，防调用方改坏内部权益 |
| `limits` 是字符串/数组/null | 丢弃该字段 | 形状非法不污染 store |
| `limits` 内单键为字符串数字 `"15"` | 客户端 `readLimit` 允许（非空数字串） | 兼容 JSONB/配置序列化 |
| `limits` 内单键为 `""`/`NaN`/`undefined` | 视为缺失 ⇒ 不限 | `Number('') === 0` 会把缺失读成零额度（反方向静默故障） |
| `graceUntil` 非空字符串 | 透传 | |
| `graceUntil` 非字符串 | 丢弃 | |
| `previousPlan` 非空字符串 | 透传 | |
| `previousPlan` 非字符串 | 丢弃 | |

---

## 5. 流程

### 5.1 权益下发链路（端到端）

```
plan-matrix.getPlanEntitlement(plan)
  ↓ （features / quota / limits 三块）
SubscriptionService.entitlementPayload(plan) → 落库 identity_entitlement_snapshots.payload（JSONB）
  ↓
GET /api/v1/me
  ├─ entitlement: { plan, features, quota, limits, graceUntil?, previousPlan? }   ← 未签名，UI 读
  └─ entitlementSnapshot: { token }                                              ← RSA 签名，离线权威
         payload = { sub, device_id, plan, features, quota, limits, graceUntil?, previousPlan?, iat, exp }
  ↓
EntitlementService.sync() → normalizeEntitlement()（主进程）→ _current
  ↓ IPC
stores/identity.js normalizeState() → entitlement.limits / graceUntil / previousPlan
  ↓
发布页 usePlatformSelection({ getEntitlement }) → plan-limits.canAddPlatform()
```

**离线路径**：`restore()` 用签名快照验签后 `normalizeEntitlement(snapshot)`，因此离线态同样带 limits；
72h 宽限内 `source='grace'` 仍可读，写通道（`onlineOnly`）拒绝——与本轮改动无冲突。

### 5.2 跨档续叠（兑换码 / 后台开通）

```
redeem(code) / grant(plan, durationDays)
  ↓
commerceTransaction:
  ├─ SELECT 现有 active 且未过期订阅（advisory lock 已先取）
  ├─ existingRank = planRank(existing.plan)   （无存量 ⇒ -1）
  ├─ requestedRank = planRank(请求档位)
  ├─ downgradeSuppressed = existing && existingRank >= 0 && requestedRank >= 0 && existingRank > requestedRank
  ├─ effectivePlan = downgradeSuppressed ? existing.plan : requestedPlan
  ├─ payload = entitlementPayloadFor(effectivePlan)     ← 快照按生效档位现算
  ├─ UPSERT identity_subscriptions（plan = effectivePlan；periodEnd 照常叠加）
  ├─ INSERT identity_orders（plan = **请求档位**，对账要看用户实际兑换的那一档）
  └─ PUT identity_entitlement_snapshots（payload = 生效档位）
  ↓
通知：
  ├─ 正常：已开通 {effectivePlan}，有效期 N 天
  └─ 压制：已续叠 N 天；当前有效期内的档位高于该码，档位保持 {effectivePlan} 不变
  ↓
返回体：{ plan: 生效档位, requestedPlan: 请求档位, downgradeSuppressed, periodStart, periodEnd, subscription, order, version }
```

**为什么订单记请求档位**：订单是资金/发放凭证，必须保留「用户买的是哪一档」；订阅与快照才是「他此刻拥有什么」。
两者分列，才能在客服场景解释「为什么订单是 standard 而权益还是 pro」。

**边界**：
- 未知档位（`planRank === -1`）不参与比较，保持原有覆盖语义（fail open 到既有行为，不新增拦截）。
- 同档续叠：`downgradeSuppressed=false`，行为与改造前完全一致。
- 幂等重放（`_idempotentRedeemView`）：键集合与首次核销**完全一致**，同样返回 `requestedPlan` /
  `downgradeSuppressed`（按当前 active 订阅与码面档位重算），否则调用方按「缺字段=无压制」读会误判。

### 5.3 到期降级与宽限

```
GET /api/v1/me → getSubscriptionView → settleExpiry(userId)
  ↓ 同一事务
  ├─ expireSubscription(userId)：把过期 active 行置 expired，返回该行（含 plan）
  ├─ 无过期行 ⇒ 直接返回 null（不写任何东西）
  ├─ freePayload = entitlementPayload('free')
  ├─ graceUntil = now + 7 天（ISO）
  ├─ features = free.features ∪ { dashboard_full }（仅当上一档拥有；不保留 schedule_batch）
  ├─ payload = { ...freePayload, features, graceUntil, previousPlan }
  ├─ PUT 快照（payload）
  └─ 通知：会员已到期（文案见 §8）
```

**宽限期内保留什么 / 不保留什么**（契约级边界）：

| 能力 | 宽限期内 | 依据 |
|---|---|---|
| 发布历史、数据看板（只读） | ✅ 保留 `dashboard_full` | 收尾期要能看数据 |
| 已排队的定时任务继续执行 | ✅ **不需要**保留 `schedule_batch` | 队列执行走 `cloud_publish`（免费档自带，`_authorizeScheduledEntry` 只校验它）；`schedule_batch` 是「新建批量/定时入口」，保留它等于把付费入口留给到期用户 |
| 新建 AI 视频 | ❌ 不保留 `video_create` | 免费档配额为 0，新建即拒绝 |
| 模型分层（tier_access_*） | ❌ 不保留 | 高档模型不在收尾期白送 |
| 云端发布 | ✅ 免费档本身有 `cloud_publish` | 走免费档 150/月配额 |

**与客户端 72h 离线宽限的区别**（不得合并成一个值）：
- `ENTITLEMENT_GRACE_SECONDS = 72h`（客户端）：管「断网后还能离线用多久」，`onlineOnly` 写通道在此期拒绝。
- `PLAN_EXPIRY_GRACE_DAYS = 7d`（服务端）：管「订阅到期后还能收尾多久」，只降档位、保留只读看板；在途队列本就走免费档自带的 `cloud_publish`，不受影响。

### 5.4 发布页平台数校验

```
用户点击平台
  ↓
handleTogglePlatform(platformId)
  ├─ togglePlatform(platformId) → composable
  │    ├─ 已选中 ⇒ 取消，返回 true（上限不锁死退出路径）
  │    └─ 未选中 ⇒ canAddPlatform(getEntitlement(), selectedCount)
  │          ├─ limits 缺失 / max_platforms < 0 ⇒ 允许
  │          └─ selectedCount < max_platforms ⇒ 允许，否则返回 false
  ├─ true ⇒ 结束（无提示）
  └─ false ⇒ notifyWarning('publishPage.platformLimitReached', { limit })
```

**按组添加**（`selectPlatform`）走同一判据：否则一条「应用分组」就能绕过单点选择的上限。

---

## 6. 功能逻辑

### 6.1 档位序保护（G3）

- 输入：现有 active 且未过期订阅的 `plan`、本次请求的 `plan`。
- 判据：`rank(existing) > rank(requested)` 且两者均已知。
- 动作：订阅档位、权益快照保持 `existing.plan`；订单记录 `requestedPlan`；时长照常叠加。
- 不变量：**任何路径都不得让已付费且未到期的高档用户因兑换/被授予低档码而失去权益**。
- 可观测性：返回体带 `downgradeSuppressed=true`；通知文案明确「档位保持 X 不变」。

### 6.2 到期宽限（G4）

- 触发：仅 `/me` 访问时的惰性结算（无定时任务，沿用既有设计）。
- 幂等：`expireSubscription` 只命中「过期且仍 active」的行，第二次访问无行可降，不重复写快照。
- 事务性：降级 + 快照 + 通知三写同事务（既有约束，本轮不动）。
- 语义：宽限期是「降档 + 收尾」，不是「免费续期」——配额按免费档，不保留任何生成类能力。

### 6.3 客户端校验纪律（G1）

三条硬纪律（写在 `plan-limits.js` 头注，并由测试锁定）：
1. **只读不改**：不兜底、不缓存、不推算出比服务端更严的限制。
2. **缺失即放行**：字段缺失/非法一律按「不限」。反方向（缺失即拦截）会让一次快照字段漂移把
   付费用户整片拦死，且表现为「功能消失」这种最难归因的故障。
3. **-1 是不限**：不得当成「-1 个」参与加减。

### 6.4 价格与配额调整（结构 A）

| 项 | 变更前 | 变更后 | 依据 |
|---|---|---|---|
| pro 月付 | ¥79（7900 分） | **¥119（11900 分）** | v2.1 C2.3：相邻档 2.0×（行业中位） |
| pro 年付 | ¥699（69900 分） | **¥999（99900 分）** | 年付折扣 30.0%，与标准版 29.5% 对齐 |
| standard 视频配额 | 500/月 | **300/月** | v2.1 C4.3：3× 于画像 p75（100 条/月） |
| standard 价格 | ¥59 / ¥499 | 不变 | — |
| 积分配额 | 30 / 1600 / 2200 | 不变 | v1.2 定案，本文不推翻 |
| 成本占比 | pro 27.8%（按 ¥79） | pro **18.5%**（按 ¥119，积分成本不变） | 涨价部分是功能价，毛利为正 |

**零存量窗口**：真实支付未接通（G12），当前无在线付费用户；调价无退差价/存量兑换码重签问题。
**运营可配**：`planOverrides` 只允许覆盖数值键，`rank` 与 `scheduleBatch`/`dashboard` 一样被冻结。

---

## 7. 交互逻辑

### 7.1 发布页平台选择（本轮唯一 UI 变更）

| 场景 | 触发 | 系统行为 | 用户可见 |
|---|---|---|---|
| 未达上限 | 点击未选平台 | 选中，无提示 | 平台卡片进入选中态 |
| 达到上限 | 点击未选平台 | **不选中**，`notifyWarning` 一条 | 顶部警告 toast：「当前档位最多选择 5 个平台，升级后可继续添加」 |
| 已选平台取消 | 点击已选平台 | 正常取消（上限不锁死退出） | 取消选中 |
| 按组添加超限 | 应用分组 | 允许的逐个加入，超限的静默跳过（由分组应用组件既有反馈） | 分组内已加入数量变化 |
| limits 缺失 | 任意 | 不拦截 | 无提示（缺失即放行） |

**不做**：不在平台卡片上加「锁」图标、不弹升级弹窗、不跳会员中心——本轮只做「说清楚为什么点不动」，
升级引导沿用 `fix-upgrade-payment-entry` 已接线的会员中心入口。

### 7.2 会员中心

本轮**不改**会员中心 UI。原因：价目来自服务端 `/api/v1/plans`（`getPlanCatalog`），
价格调整后自动生效；新增 limits 不改变会员中心展示结构。

### 7.3 到期宽限 UI

本轮**只透传字段**，不渲染横幅。原因：任何渲染改动都会触发视觉回归门禁，
而宽限横幅需要设计稿与文案确认，属独立切片。字段到位后，后续只需在会员中心加一个条件区块。

---

## 8. 显示项

| # | 位置 | 显示内容 | 数据来源 | 格式 |
|---|---|---|---|---|
| D1 | 发布页警告 toast | 「当前档位最多选择 {limit} 个平台，升级后可继续添加」 | `entitlement.limits.max_platforms` | 纯文本，limit 为整数 |
| D2 | 会员中心价目卡（既有） | 月付/年付金额 | `/api/v1/plans` → `priceMonthlyCents` / `priceYearlyCents` | 前端按分转元（既有实现） |
| D3 | 通知中心（既有） | 兑换成功 / 会员开通 / 会员已到期 | `identity_notifications` | 见 §9 文案表 |
| D4 | 后续（未做） | 宽限横幅「会员已于 {date} 到期，{graceUntil} 前发布历史与看板仍可查看」 | `graceUntil` / `previousPlan` | 待设计稿 |

---

## 9. 提示文字（zh / en 成对，CI Gate 7）

| key | zh | en |
|---|---|---|
| `publishPage.platformLimitReached` | 当前档位最多选择 {limit} 个平台，升级后可继续添加 | Your current plan allows up to {limit} platforms. Upgrade to add more. |
| `publishPage.platformLimitHint` | 已选 {selected} / {limit} 个平台 | {selected} / {limit} platforms selected |
| 服务端通知：兑换成功（正常） | 已开通 {plan}，有效期 {days} 天 | —（服务端通知为中文，客户端不翻译） |
| 服务端通知：兑换成功（压制） | 已续叠 {days} 天；当前有效期内的档位高于该码，档位保持 {plan} 不变 | — |
| 服务端通知：会员开通（正常） | 已开通 {plan}，有效期 {days} 天 | — |
| 服务端通知：会员开通（压制） | 已顺延 {days} 天；当前有效期内的档位高于该次开通，档位保持 {plan} 不变 | — |
| 服务端通知：到期 | 本期订阅已结束，档位已回到免费版；7 天内发布历史与数据看板仍可查看、已排队任务会执行完毕。兑换新码可续叠。 | — |

> `platformLimitHint` 本轮未渲染（无 UI 位），但文案与键先落库：它是后续「已选 N / 上限 M」
> 展示位的唯一文案源，避免届时各写一份。

---

## 10. 兼容与迁移

| 存量形态 | 行为 | 说明 |
|---|---|---|
| 旧快照（无 limits） | 客户端按「不限」放行 | 不清缓存、不阻断；下次 `/me` 自然升级 |
| 旧快照（无 graceUntil） | 视为非宽限态 | |
| 存量 active 订阅 | 不受影响 | 档位序保护只在「续叠/开通」时判定 |
| 已过期但未结算的订阅 | 首次 `/me` 触发 settleExpiry，写宽限快照 | 与改造前一致（只是快照多了三个字段） |
| 存量兑换码 | 正常核销；低档码对高档用户改为「只延时」 | 这是行为变更，需在运营侧告知：**低档码不再能缩短高档期** |
| 运营 overrides | 新增四个数值键可覆盖；`rank` 不可覆盖 | 覆盖非法值仍 fail closed |

---

## 11. 验收标准（可机械验证）

| # | 验收项 | 判据 |
|---|---|---|
| A1 | 新字段随矩阵下发 | `node --test packages/api-publish-engine/test/plan-matrix.test.js` 全绿；pro 价格 11900/99900；standard video 300 |
| A2 | features 派生 | standard 含 `cloud_account_sync`/`batch_publish`/`tier_access_standard` 且**不含** `tier_access_pro`；pro 两者都含 |
| A3 | limits 进签名快照 | `publish-api-server.js` 快照含 `limits`；单元用例断言 |
| A4 | 客户端透传 | `entitlement-service.test.js` 断言 sync 返回 `limits/graceUntil/previousPlan`，且深拷贝隔离 |
| A5 | 渲染层透传 | `stores/identity.test.js` 断言 limits 透传、非法形状丢弃 |
| A6 | 跨档续叠保护 | 仓储用例：existing=pro + 请求 standard ⇒ upsert plan=pro、快照按 pro 现算、订单记录 standard、`downgradeSuppressed=true` |
| A7 | 到期宽限 | 服务用例：`graceUntil = now+7d`、`previousPlan` 正确、保留 `dashboard_full`、不保留 `schedule_batch` / `video_create` / `tier_access_*` |
| A8 | 幂等重放键集合一致 | `subscription-service.test.js` F3 用例全绿 |
| A9 | 平台数拦截 | `usePlatformSelection.test.js`：免费档第 6 个返回 false；取消不受限；按组同受约束；limits 缺失放行 |
| A10 | 纯函数边界 | `plan-limits.test.js`：空串/NaN 视为缺失、-1 不限、日发闭区间 |
| A11 | 全量测试 | `packages/api-publish-engine npm test` rc=0；`apps/desktop` 受影响用例全绿 |
| A12 | QM-1 | `electron-builder --win --x64` rc=0；启动 8s 存活且 stderr 为空 |

---

## 12. 未落地项与后续路线

| # | 项 | 前置 | 建议切片 |
|---|---|---|---|
| N1 | 设备数服务端强制 | `identity_user_sessions` 活跃计数 + 登录 409 契约 + 客户端「注销其他设备」引导 | 独立 PR（服务端 + 会员中心） |
| N2 | 云账号配额服务端扣减 | cloud-accounts upsert 接配额校验（`max_cloud_accounts`） | 独立 PR（cloud-accounts 模块） |
| N3 | 生命周期触点 | 额度 80%/耗尽/到期前 7 天/D+7 的触发点与去重 | 独立 PR（通知引擎） |
| N4 | 到期横幅 UI | `graceUntil` 已就位；需设计稿 + 视觉基线 | 前端切片 |
| N5 | 视频/日发提交前校验 | 需要「今日已发条数」的数据源（当前 renderer 无聚合通道） | 独立 PR（IPC 或既有 stats 扩展） |
| N6 | proration / 试用 | 真实支付接通 | P2-PAYMENT |

---

## 13. 测试计划（质量节拍）

| 层 | 文件 | 覆盖 |
|---|---|---|
| 单元（服务端契约） | `test/plan-matrix.test.js` | 价格、配额、features、limits、rank、overrides fail-closed |
| 单元（仓储） | `test/member-commerce-repository.test.js` | 续叠叠加、档位序保护、订单/快照分列、事务编排 |
| 单元（服务） | `test/subscription-service.test.js` | 兑换/开通/幂等/到期宽限/视图 |
| 单元（主进程） | `electron/services/identity/entitlement-service.test.js` | limits/grace 透传、深拷贝、非法形状 |
| 单元（渲染层） | `stores/identity.test.js` | 透传与丢弃 |
| 单元（纯函数） | `features/member/plan-limits.test.js` | 缺失即放行、-1、非法值、边界 |
| 单元（composable） | `composables/usePlatformSelection.test.js` | 上限拦截、取消不受限、按组同约束 |
| 回归（视图） | `views/Publish.test.js` | 既有 110 例全绿（证明接线未破坏发布流程） |
| 打包 | QM-1 | electron-builder + 启动 stderr 三层判据 |

---

## 14. 风险与回滚

| 风险 | 影响 | 缓解 / 回滚 |
|---|---|---|
| 调价（¥79→¥119）与既有营销物料不一致 | 对外口径冲突 | 同步更新 `pricing-strategy.md`；支付未接通无存量；回滚 = 改四个常量 |
| 低档码不再缩短高档期 | 运营预期变化 | 通知文案明示；运营侧发码需注意档位；如需恢复原语义，回滚 `applySubscription` 一处判定 |
| 宽限快照多三个字段 | 客户端旧版本忽略未知字段 | 前端归一化对未知字段天然免疫；旧快照按缺失处理 |
| 平台数拦截误伤 | 付费用户无法选平台 | 缺失即放行 + 仅 `max_platforms >= 0` 才拦截；测试覆盖 |
| 快照体积增大 | token 略长 | limits 为 8 个数字，体积可忽略（<200B） |

---

## 15. 与既有文档的关系

| 文档 | 关系 |
|---|---|
| `MECHANISM-MEMBER-TIERS-2026-10-19.md`（v1.1） | 档位总表与六规则仍有效；本文落地其 C1/C2/C4/C6/C7 的代码面 |
| `MECHANISM-MEMBER-TIERS-DEEP-2026-10-19.md`（v2.1） | 本文是其实施；§12 未落地项与 v2.1 §C7 四批对应 |
| `pricing-strategy.md` | 价格真源解释；本轮按 §7 先改代码再回写 |
| `DESIGN-MEMBER-CENTER-2026-09-23.md` §2 | 数据契约来源；新增 limits 键已在本文 §4 定义 |
| `DEEP-ANALYSIS-CREDIT-PRICING-2026-10-08.md` | 积分推导未改，仅引用 |

---

## 16. 变更清单（文件级）

| 文件 | 变更 |
|---|---|
| `packages/api-publish-engine/src/auth/plan-matrix.js` | 新字段、新派生、价格、`PLAN_RANK`/`planRank` |
| `packages/api-publish-engine/src/publish-api-server.js` | 快照与 `/me` 透传 limits/grace |
| `packages/api-publish-engine/src/auth/postgres-commerce-store.js` | 档位序保护 |
| `packages/api-publish-engine/src/auth/subscription-service.js` | 生效档位、宽限快照、通知文案 |
| `apps/desktop/electron/services/identity/entitlement-service.js` | 归一化透传 |
| `apps/desktop/src/stores/identity.js` | 归一化透传 |
| `apps/desktop/src/features/member/plan-limits.js` | 新增（纯函数） |
| `apps/desktop/src/composables/usePlatformSelection.js` | 上限判据 + 返回值 |
| `apps/desktop/src/views/Publish.vue` | 接线与提示 |
| `apps/desktop/src/locales/publish-page/{zh,en}.js` | 两条文案 |
| 测试 5 个文件 | 见 §13 |
| 文档 4 个文件 | 本 PRD、pricing-strategy、机制文档状态、CHANGELOG |
