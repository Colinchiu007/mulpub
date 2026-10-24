# PRD — 会员中心（MemberCenter）重构落地

> 依据：`01-docs/AUDIT-MEMBER-CENTER-IA-2026-10-19.md`（v4，已合入 main）
> 日期：2026-10-24 ｜ 分支：`member-center-revamp` ｜ 范围：Phase 1（止血）+ Phase 2（信息架构重排）+ Phase 3 相关打磨项
> 性质：详细实施规格——数据校验、流程、功能逻辑、交互逻辑、显示项、提示文字逐项写死，供 TDD 直接对照。

---

## 0. 目标与非目标

### 0.1 目标

1. 价目目录 + 激活码兑换从壳层迁入「订阅与方案」tab，壳层只留导航与全局错误条（P0-1）
2. 价目卡从「只看不买」升级为可购买卡片，与既有购买按钮**共用同一支付入口**（P0-6 / v4 E6）
3. 三档（free / standard / pro）标签全链路一致，消除「自定义方案」与「免费版（当前）」误标（P0-3 / MISS-4）
4. feature / quota 全量本地化，键形与服务端派生段逐字符对齐（P0-4）
5. 错误反馈三层修复：store 层不逃逸、渲染层本地化、跨 tab 不串显（P0-5 / §8 MAJOR-1）
6. UpgradeModal 退役，升级入口统一到 Subscription tab（P0-6）
7. 升级 CTA 改用服务端 `limits.plan_rank` 判定（P1-10 / v4 E1）
8. member store 生命周期复位 + 未读角标进入页面即预取（P1-5 / P1-6）
9. 到期宽限态（graceUntil / previousPlan）展示（v4 新增）
10. 兑换码本地前置校验，与服务端正则同型（P1-8 / MISS-9）

### 0.2 非目标（本期明确不做）

- **不做** is_current 会话契约改造（服务端侧，需先核实 #4075 是否已实现——Phase 3 事项）
- **不做** Overview 账号卡三重复制的重构（Phase 2 后半段，独立 change）
- **不做** `?section=` URL 深链（Phase 2 后半段，需与 Dashboard style-guard 锁协同，独立 change）
- **不做** 状态文案 composable 化（影响 ProfileMenu 全域，独立 change；本期只修 member-center 内矛盾）
- **不新增任何 element-plus 组件**（全部用既有 class + 原生元素，避开按需登记机械锁）
- **不引入任何新依赖**

---

## 1. 数据契约（实施前必须对齐的真源）

### 1.1 服务端已就绪契约（#4051/#4075/#4187/#4219/#4252 已落地，只消费不新建）

| 字段 | 来源 | 形状 | 渲染层消费点 |
|------|------|------|-------------|
| `entitlement.plan` | `/me` 快照 | `'free' \| 'standard' \| 'pro'` | 权益卡、版本卡、CTA |
| `entitlement.features[]` | `/me` 快照 | `['cloud_publish','ai_write','video_create','schedule_batch','dashboard_full']` | 权益清单（需本地化） |
| `entitlement.quota` | `/me` 快照 | `{ cloud_publish_monthly, ai_write_monthly, video_create_monthly, official_credit_monthly }` | 配额卡（需本地化） |
| `entitlement.limits.plan_rank` | `/me` 快照（#4051 新增） | `0(free)/1(standard)/2(pro)` 整数 | **升级 CTA 判定（本 PR 切换点）** |
| `entitlement.graceUntil` | `/me` 快照（#4051 新增） | ISO 字符串或缺失 | 宽限期展示（v4 新增） |
| `entitlement.previousPlan` | `/me` 快照（#4051 新增） | `'standard' \| 'pro'` 或缺失 | 宽限期文案（v4 新增） |
| `entitlement.expiresAt` | `/me` 快照 | Unix **秒** | 到期日 |
| `entitlement.source` | `/me` 快照 | `'online' \| 'offline'` | 数据来源徽标 |
| `plans[]` | `GET /api/v1/plans` | `{ id, label, currency, priceMonthlyCents, priceYearlyCents }` | 价目卡（可购买化） |
| `redeem` 响应 | `POST /api/v1/redeem` | `{ idempotent, plan, periodEnd, subscription }` | 兑换结果四分支 |

### 1.2 前端既有归一化（identity.js，白名单放行）

`limits` / `graceUntil` / `previousPlan` 已在 `normalizeState` 白名单内（#4051 加入），**本 PR 不改 identity.js 归一化**，只加渲染层消费。

### 1.3 本地化键清单（zh/en 成对，CI Gate 7 强制）

**feature 映射**（键 = 服务端 feature 名原样）：

| key | zh | en |
|-----|----|----|
| `memberCenter.feature.cloud_publish` | 云端发布 | Cloud publishing |
| `memberCenter.feature.ai_write` | AI 写作 | AI writing |
| `memberCenter.feature.video_create` | 视频生成 | Video creation |
| `memberCenter.feature.schedule_batch` | 定时与批量发布 | Scheduled & batch publishing |
| `memberCenter.feature.dashboard_full` | 完整数据看板 | Full analytics dashboard |

**quota 映射**（键 = 服务端 quota 键原样，形如 `${feature}_monthly`）：

| key | zh | en |
|-----|----|----|
| `memberCenter.quota.cloud_publish_monthly` | 每月发布额度 | Monthly publishes |
| `memberCenter.quota.ai_write_monthly` | 每月 AI 写作额度 | Monthly AI writes |
| `memberCenter.quota.video_create_monthly` | 每月视频生成额度 | Monthly videos |
| `memberCenter.quota.official_credit_monthly` | 每月官方积分 | Monthly official credits |

**档位标签**（已有键补值）：`planStandard` = 标准版 / Standard。

**宽限期**（v4 新增）：

| key | zh | en |
|-----|----|----|
| `memberCenter.graceTitle` | 已到期 · 宽限期中 | Expired · Grace period |
| `memberCenter.graceHint` | {plan} 已到期，{date} 前仍可查看历史与收尾排队任务；新建发布按免费版额度 | {plan} expired. History and queued tasks work until {date}; new publishes follow Free quotas. |
| `memberCenter.graceUntilLabel` | 宽限期至 | Grace until |

**兑换前置校验**（P1-8）：

| key | zh | en |
|-----|----|----|
| `memberCenter.redeemErrFormatLocal` | 激活码格式不正确，应形如 ABCD-EFGH-JKMN | Invalid code format. Expected ABCD-EFGH-JKMN. |

**错误展示**（P0-5 / MAJOR-1）：

| key | zh | en |
|-----|----|----|
| `memberCenter.memberPermissionRequired` | 当前账号权限不足，请重新登录后重试 | Insufficient account permission. Sign in again and retry. |
| `memberCenter.memberRequestFailed` | 加载失败，请稍后重试 | Failed to load. Please try again later. |
| `memberCenter.revokeFailed` | 退出其他设备失败，请稍后重试 | Failed to sign out other devices. Please try again later. |
| `memberCenter.sessionsLoadFailed` | 设备列表加载失败，请稍后重试 | Failed to load devices. Please try again later. |
| `memberCenter.notificationsLoadFailed` | 消息加载失败，请稍后重试 | Failed to load messages. Please try again later. |
| `memberCenter.revokePartial` | 已退出 {revoked} 个设备，其余失败，请重试 | Signed out {revoked} device(s); the rest failed. Retry. |

**价目可购买化**（P0-6）：

| key | zh | en |
|-----|----|----|
| `memberCenter.planBuyCta` | 购买 | Buy |
| `memberCenter.planBuyCurrent` | 当前方案 | Current plan |
| `memberCenter.planBuyDowngradeHint` | 当前方案权益更高，购买将在到期后生效 | Your current plan is higher. Purchase takes effect after expiry. |
| `memberCenter.plansUnavailableHint` | 价格暂时无法获取，请稍后重试 | Prices temporarily unavailable. Try again later. |

**待删键**（UpgradeModal 退役连带，zh/en 成对删）：`paymentChannelUnavailable`、`activationCodeMigrated`、`trialUnavailable`。

---

## 2. 功能逻辑（逐模块）

### 2.1 壳层 MemberCenter.vue（瘦身）

**移除**：
- `<section class="member-center-plans">` 整块（含 plansLoading / currentPlanId / formatPrice 逻辑）→ 迁入 Subscription
- `<section class="member-center-redeem">` 整块（含 redeemCode / redeemResult / submitRedeem 逻辑）→ 迁入 Subscription
- `<UpgradeModal>` 渲染 + import + showUpgrade ref
- `useLicenseStore` import（CTA 不再回退本地 license）
- `defineExpose` store 泄漏 + `void identityStore`

**保留/改造**：
- header：未登录按钮保留；**升级 CTA 改造**为路由跳转（见 2.7）
- 左导航 7 栏 + messages 角标保留
- **新增**：进入页面（onMounted）预取 `memberStore.loadNotifications()`——只为角标准确，不弹错（失败静默，进消息 tab 时会重试并展示错误）
- **新增**：watch identity `user.sub` 变化 / status 进入 `signed_out`|`disabled` → `memberStore.$reset()`
- 全局错误条（errorMessage + IdentityDiagnostics）位置保留在 main 区顶部

**壳层结构锁（新增回归测试）**：
1. 模板不得出现 `<UpgradeModal`
2. 模板不得出现 `member-center-plans` / `member-center-redeem` class
3. 已登录态下 `member-center-plans` data-testid 不存在

### 2.2 Subscription.vue（本 PR 主战场）

**结构（自上而下）**：

```
┌─ 权益卡（member-center-subscription-detail）───────────────────┐
│ 标题：会员权益 + 来源徽标（在线/离线）                            │
│ 档位名（本地化三档）+ 到期日 / 长期有效                            │
│ 【v4 新增】graceUntil 存在时：替换到期行为「宽限期」中性态条        │
│ 权益清单（feature 本地化，未知 key 回退原文）                      │
└──────────────────────────────────────────────────────────────┘
┌─ 套餐卡（member-center-plans，从壳层迁入）──────────────────────┐
│ 标题：会员套餐                                                  │
│ 三态：null→暂不可用 / []→暂无套餐 / 有数据→卡片列表               │
│ 每张卡：label + 月价/年价 + 「当前方案」徽标 + 「购买」按钮        │
│ 点击卡或购买按钮 → openPay(plan, 'month')（月为默认周期）          │
└──────────────────────────────────────────────────────────────┘
┌─ 兑换卡（member-center-redeem，从壳层迁入）─────────────────────┐
│ 标题：激活码兑换 + 提示文案                                       │
│ 输入框（maxlength=14 + 前置格式校验）+ 兑换按钮                   │
│ 结果区：success/info/error 三 tone 配色                           │
└──────────────────────────────────────────────────────────────┘
┌─ WeChatPayDialog（既有，唯一支付入口）──────────────────────────┐
└──────────────────────────────────────────────────────────────┘
```

**套餐卡交互逻辑（v4 E6 约束）**：
- `plans` 中每个 plan 渲染为可点卡片（`role="button"`、键盘可达、`@keydown.enter`）
- 点击卡片或「购买」按钮 → **同一个** `openPay({ plan: plan.id, period: 'month' })`
- **删除**原 `purchaseOptions` 四个按钮区（`member-center-purchase`）——价目卡即购买入口，消除双路径
- `canPurchase` 条件保留：`identityStore.isAuthenticated` 为真才渲染购买按钮
- **降级保护**：`plan_rank`（来自 plans 的 id 映射）≤ 当前 `limits.plan_rank` 时，按钮文案为「当前方案」且不可点；若当前方案更高（如 pro 用户看 standard 卡），按钮文案「购买」+ 提示「到期后生效」

**价目三态文案**（保留既有设计，补 CSS）：
- `plans === null` → 「价格暂时无法获取，请稍后重试」
- `plans.length === 0` → 「暂无可购买的套餐」
- 有数据 → 卡片列表

**兑换前置校验（P1-8）**：
- `maxlength="14"`（ABCD-EFGH-JKMN = 12 字母 + 2 连字符）
- 本地正则：`/^[ABCDEFGHJKMNPQRSTUVWXYZ2-9]{4}-[ABCDEFGHJKMNPQRSTUVWXYZ2-9]{4}-[ABCDEFGHJKMNPQRSTUVWXYZ2-9]{4}$/`——与服务端 `subscription-service.js:14` **逐字符同型**（排除 I/O/0/1）
- 输入时自动 `toUpperCase()`（服务端也 toUpperCase，前端先做减少用户困惑）
- 校验失败 → 本地 error tone 提示 `redeemErrFormatLocal`，**不发请求**
- 校验通过 → 走既有 `submitRedeem` 全链路（四分支结果不变）

**宽限期展示（v4 新增）**：
- 触发条件：`entitlement.graceUntil` 为非空 ISO 字符串
- 展示位置：权益卡内，替换原「权益到期」meta 行
- 显示项：「已到期 · 宽限期中」徽标（warning 色）+ 「{previousPlan} 已到期」+ 「宽限期至 {date}」
- **禁止**：显示正式档位名（如「专业版」）而不加宽限标注——那会让用户以为权益满血
- `graceUntil` 解析失败（非法 ISO）→ 退化为普通到期展示，不崩

### 2.3 Messages.vue（错误本地化）

- `memberStore.error` 不再直接渲染；经 `resolveMemberErrorKey(error)` 映射：
  - `MEMBER_PERMISSION_REQUIRED` → `memberPermissionRequired`
  - `MEMBER_REQUEST_FAILED` / 其他 → `memberRequestFailed`
- 修 store 后 error 必为已知码；映射函数放 `member-center/labels.js`（纯函数，可单测）
- 保留 `role="alert"` 无障碍属性
- 「全部标记为已读」失败时同样走本地化错误（按钮区域下方）

### 2.4 AccountSecurity.vue（错误展示补全 + revoked 语义）

- 新增 error 展示区（与 Messages 同模式，本地化）
- 「退出其他设备」结果语义：
  - `revoked > 0` → success 提示「已退出 {revoked} 个设备」（3s 后自动消失或手动关闭）
  - `revoked === 0` 且无 error → info 提示「没有其他需要退出的设备」
  - 失败 → error 提示 `revokeFailed`
- 会话列表保留 `index === 0` 徽标（is_current 契约是 Phase 3，本期不动），但**徽标文案改为「可能为当前设备」存疑态**？——不，方案未要求改文案，保持「当前设备」不动（避免超出方案范围）

### 2.5 labels.js（纯函数集中地）

新增/修改：

| 函数 | 逻辑 |
|------|------|
| `planLabelOf(t, plan)` | `'pro'→planPro` / `'standard'→planStandard` / `'trial'→planTrial` / `'free'→planFree` / `undefined\|null\|''`→**planUnknown（新键「方案加载中」）** / 其他→planCustom。**去掉 `\|\| 'free'` 兜底** |
| `resolveMemberErrorKey(code)` | 错误码 → i18n key 映射（白名单制，未知→memberRequestFailed） |
| `featureLabelOf(t, feature)` | 命中 `memberCenter.feature.*` 用本地化；未知回退原文 |
| `quotaLabelOf(t, quotaKey)` | 同上，`memberCenter.quota.*` |
| `quotaValueText(value)` | 数字：`-1`→「不限」；对象：`JSON.stringify`；null/undefined→「—」 |
| `graceState(entitlement)` | `{ inGrace: boolean, untilText: string, previousPlanLabel }`——纯函数，ISO 解析失败返回 `inGrace:false` |

新增键：`planUnknown` = 方案加载中 / Loading…。

### 2.6 member store（生命周期 + 错误不逃逸）

**§8 MAJOR-1 修复**：所有 `invoke` 包一层 `safeInvoke`：

```js
async function safeInvoke(channel, payload) {
  try {
    return await invoke(channel, payload)
  } catch (e) {
    // LicensePermissionError（权限不足）→ 专属码；其余 → 通用失败码
    error.value = e && e.name === 'LicensePermissionError'
      ? 'MEMBER_PERMISSION_REQUIRED'
      : 'MEMBER_REQUEST_FAILED'
    return null
  }
}
```

- 5 个方法（loadNotifications / markNotificationsRead / loadSessions / revokeOtherSessions / redeemCode）全部改用 `safeInvoke`
- `runExclusive` 保留（loading 态不变）
- `redeemCode` 的失败分支：壳层据 `memberStore.error` 选文案——现在 error 可能是 `MEMBER_PERMISSION_REQUIRED`，需在 `REDEEM_ERROR_KEYS` 补一条映射到 `redeemErrSignedOut`

**P1-5 生命周期**：`$reset()` 已在 store 定义，本 PR 由壳层 watch 触发调用（见 2.1）。

### 2.7 升级 CTA（plan_rank 切换 + 路由跳转）

```js
const showUpgradeCta = computed(() => {
  if (!hasSessionIdentity.value) return false
  const rank = entitlement.value?.limits?.plan_rank
  if (Number.isInteger(rank)) return rank < PLAN_RANK_MAX  // 2
  return false  // entitlement 未加载 / rank 缺失 → 不猜，不显示
})
```

- **删除** `licenseStore.isPro` 回退分支（本地 license 与服务端权益是两套真源，A2 早已定论）
- CTA 点击行为：`router.push('/member-center?section=subscription')`——**同一路由内切 tab**，不打开任何弹窗
- nav 侧新增：从 URL query 读 `section` 初始化 activeKey（浅实现：onMounted 读一次，不双向同步——完整深链是 Phase 2 独立 change）
- `PLAN_RANK_MAX = 2` 定义在 `member-center/constants.js`（新文件，纯常量 + 注释说明服务端真源）

### 2.8 角标预取（P1-6）

- 壳层 `onMounted`：`memberStore.loadNotifications()`（仅已登录态）
- 失败静默（不设 error 提示）——消息 tab 激活时会重新 load 并展示错误
- 角标渲染条件不变（`unreadCount > 0`）

---

## 3. 交互逻辑状态矩阵（TDD 对照）

### 3.1 价目卡三态 × 登录态

| plans | 登录态 | 渲染 |
|-------|--------|------|
| null | 已登录 | 「价格暂时无法获取」+ 重试提示 |
| [] | 已登录 | 「暂无可购买的套餐」 |
| 有数据 | 已登录 | 卡片列表，每卡含购买按钮（canPurchase=true） |
| 任意 | 未登录 | 整个 Subscription tab 不渲染（壳层门控） |

### 3.2 兑换结果四分支（既有逻辑保留，新增本地校验前置）

| 输入 | 路径 | 展示 |
|------|------|------|
| 格式不符 | 本地拦截 | error tone + `redeemErrFormatLocal` |
| 空串 | 按钮禁用 | — |
| 首次兑换成功 | 服务端 200 + subscription | success tone + plan + 到期日 |
| 同码重放 + 订阅有效 | 服务端 200 + idempotent | info tone + 「此前已兑换」 |
| 同码重放 + 订阅已过期 | 服务端 200 + idempotent + subscription=null | info tone + 「重放不加时长」 |
| 格式/不存在/已用/停用/过期 | 服务端错误码 | error tone + 对应本地化文案 |
| 权限不足 | safeInvoke 捕获 LicensePermissionError | error tone + 「请先登录」 |

### 3.3 升级 CTA × 档位

| entitlement.limits.plan_rank | CTA | 点击行为 |
|------------------------------|-----|----------|
| 0 (free) | 显示 | 跳 Subscription tab |
| 1 (standard) | 显示 | 跳 Subscription tab |
| 2 (pro) | 不显示 | — |
| 缺失/非整数 | 不显示 | — |

### 3.4 宽限期

| entitlement | 权益卡展示 |
|-------------|-----------|
| graceUntil 有效 ISO | 「已到期 · 宽限期中」徽标 + previousPlan + 宽限期日期 |
| graceUntil 缺失 | 正常到期日 / 长期有效 |
| graceUntil 非法 ISO | 同缺失（不崩） |

---

## 4. 显示项与提示文字汇总（全部走 locales，zh/en 成对）

见 §1.3 键清单。硬规则：
- **禁止**在 `.vue` 模板新增中文字符串字面量（CI 基线扫描拦截）
- **禁止**渲染服务端原始错误码 / feature 名 / quota 键给终端用户
- 未知 key 一律回退原文（服务端加新 feature 不开天窗），但不得白屏

---

## 5. 回归测试清单（补逃逸链）

| # | 测试文件 | 断言 |
|---|----------|------|
| 1 | `labels.test.js`（新） | planLabelOf('standard')→planStandard；planLabelOf(undefined)→planUnknown；planLabelOf('pro_max')→planCustom；featureLabelOf 已知/未知；quotaLabelOf 已知/未知；quotaValueText(-1/对象/数字)；graceState 三种输入；resolveMemberErrorKey 全部已知码+未知码 |
| 2 | `Subscription.test.js`（新） | 三态价目渲染；点击卡→emit openPay(plan,'month')；canPurchase=false 不渲染购买按钮；降级档按钮文案；兑换本地格式校验（合法/含 O/含 I/含 0/含 1/长度不足）；宽限期渲染与非法 ISO 退化 |
| 3 | `Messages.test.js`（新） | 错误本地化（MEMBER_REQUEST_FAILED/MEMBER_PERMISSION_REQUIRED）；无 error 不渲染；已读按钮禁用态 |
| 4 | `AccountSecurity.test.js`（新） | revoked>0/0/失败三分支提示；列表渲染；revoke 按钮 disabled 态 |
| 5 | `MemberCenter.test.js`（改） | 134 行「CTA 打开 UpgradeModal」**改写**为「CTA 存在且不渲染 UpgradeModal」+「CTA 点击跳 subscription」；新增壳层结构锁 3 条；新增角标预取断言；新增 $reset 触发断言；删除 UpgradeModal stub |
| 6 | `member.test.js`（改） | safeInvoke 捕获 LicensePermissionError→MEMBER_PERMISSION_REQUIRED；捕获通用 Error→MEMBER_REQUEST_FAILED；正常路径不受影响 |
| 7 | `icon-usage.test.js`（改） | FILES 移除 UpgradeModal.vue 登记行 |
| 8 | `more-tests.test.js`（改） | 移除 UpgradeModal import |
| 9 | `UpgradeModal.test.js` | **随组件删除** |
| 10 | 视觉回归 | member-center.css 属触碰计算样式：按 AGENTS.md 像素门禁四步（差集命中数→控制台→连拍→样式签名） |

---

## 6. 落地顺序（TDD：先红后绿）

1. `constants.js` + `labels.js` 纯函数 + `labels.test.js`（先红后绿）
2. `Subscription.vue` 迁移 + `Subscription.test.js`
3. `Messages.vue` / `AccountSecurity.vue` + 各自测试
4. `member.js` safeInvoke + `member.test.js`
5. 壳层瘦身 + CTA 切换 + `MemberCenter.test.js` 改写
6. UpgradeModal 退役四件套（删组件/删测试/改 import/改 FILES）
7. locales zh/en 成对补删 + Gate 7 自测
8. CSS 补齐 + 视觉回归四步
9. 全量测试 + QM-1 打包 + 启动三层判据
10. 记忆三处落盘 + PR + CI + 自动合并

---

## 7. 风险与对策

| 风险 | 对策 |
|------|------|
| 迁 plans/redeem 动到既有 data-testid，破坏未知消费方 | 全仓 grep `member-center-plans`/`redeem-code-input` 等 testid，确认消费方后同迁 |
| 删 UpgradeModal 撞 buyout-removal 命名锁 | 本 PR 只删不加，无新 `payment[A-Z]\w+` 命名 |
| CSS 补齐触发像素回归 | 按 AGENTS.md 四步门禁执行，阈值对齐本地 1%/CI 6% |
| 壳层迁出后 Subscription 变长，消息/账号 tab 空 | 壳层 main 区 gap 已有 `--space-md`，无需额外处理 |
| plan_rank 切换后 CTA 对 standard 仍显示（rank=1<2） | 预期行为：standard 可升 pro；MISS-6 的「口径矛盾」由价目卡可购买化解释（买不买是选择，不是矛盾） |
