# 激活码兑换 · 整体方案（PRD）

> 版本：v2（2026-10-24，v2 = 三个决策定案 + 首轮实施落地）
> 本文件是 `openspec/records/redeem-code-issued-to.md` 那次实施的设计依据。
> 范围：桌面应用端兑换 + 运营中心签发与管理 + 安全设计
> 仓库：`Colinchiu007/mulpub`（基线 `main`，2026-10-24）
> 事实来源：本文所有"现状"条目均来自**本轮逐行读取源码**核实，标注 `文件:行号`。
> 标注「文档称」的条目来自 `01-docs/`，已与代码交叉验证。
> **已做独立核查**（10 条关键断言 + 反向抽查），核查记录与自查出的 2 处自身错误见 §12。

---

## 0. 结论摘要（先看这个）

**1. 这个功能 90% 已经存在，不要重做。** 服务端核销/签发/列表/吊销、运营中心兑换码管理页、桌面端会员中心兑换卡——全部已实现并已合并上线。本轮的真正工作是**补齐语义化与安全加固**，不是从零搭。

**2. "激活码需要加密解密"这个需求，前提是错的，落地会是安全倒退。** 详见 §3。简短版本：

> 激活码的安全**不来自密码学，来自"码里没有任何信息"**。
> 一旦把「档位 + 时长」加密进码里（做成自解密载荷），就必须把解密密钥放进客户端 ⇒ 密钥可提取 ⇒ 可伪造 ⇒ 回到「任意串换永久 Pro」的老漏洞。
> **这个仓已经因为同一个错误栽过三次。**

**3. 真正还没做好的，按性价比排序：**

| 优先级 | 缺口 | 位置 |
|---|---|---|
| P0 | 运营侧「1 个月 / 3 个月」无预设（现在填裸天数，易填错） | ops 签发弹窗 |
| P0 | 运营侧套餐显示原始英文 `standard`/`pro` | `RedemptionCodes.vue:24,97` |
| P0 | 桌面端文案写「16 位激活码」，实际是 12 位（14 字符含连字符） | `zh.js:11` / `en.js:11` |
| P0 | 桌面端无本地格式前置校验，任意串打服务端 | `MemberCenter.vue:227-229` |
| P1 | 兑换**失败无针对性限流**（仓里有全局 IP 级限流器，但默认关闭且不区分端点/成败） | engine 路由层 |
| P1 | 签发 / 吊销 / 手动开通**三类花钱动作无审计**（只有 reveal 有） | `publish-api-redeem-code-admin.js` |
| P1 | 签发结果无一键复制 / CSV 导出（200 个码没法交付） | ops 签发结果弹窗 |
| P2 | 无批次交付追踪（不知道这批卖出去多少） | 需新接口 |
| P2 | 码无"发放对象"字段，泄漏无从溯源 | 需新列 |
| P2 | 桌面端不显示"低档码被压制"的结果差异（**store 没透传该字段 + 视图没有分支，两层都要改**） | `stores/member.js:126-131` + `MemberCenter.vue:270-290` |

**3.5 三个决策已定案（2026-10-24，运营方拍板）**

| 决策 | 结论 | 本轮落地 |
|---|---|---|
| 档位显示名 | **沿用仓内命名**（标准版 / 专业版） | ✅ 运营中心前端加 `PLAN_LABELS` 显示映射；`plan` 值不变 |
| `issued_to`（发放对象） | **做** | ✅ 迁移 009 + 运行时 SCHEMA + 仓储 + 服务层 + 运营 API + ops 转发层 + 运营前端 |
| 限流严格程度 | **先上温和档** | ✅ 同一用户 60 秒内失败 ≥ 5 次 / 同一 IP 10 分钟内失败 ≥ 30 次 ⇒ 429 |


**4. 最重要的一条产品边界（先定死，否则后面全乱）：**

> **在线支付成功 → 服务端直接开通权益，不发码。**
> **激活码 → 只用于「线下/赠送/代运营/批量采购」等无即时支付通道的场景。**
>
> 两者共用同一个 `applySubscription()` 落账路径，但**码只服务"没有即时收款通道"的交易**。
> 理由：支付成功后再发一张码，等于凭空造出"码的库存、批次、发放、对账"四层复杂度，而收益是零。
> 现状代码已经这么做了（`subscription-payment.js:216` 回调直接调 `applySubscription`），本方案沿用。

---

## 1. 现状盘点（实测）

### 1.1 服务端 —— `packages/api-publish-engine`

| 能力 | 端点 | scope | 出处 |
|---|---|---|---|
| 核销 | `POST /api/v1/redeem` | `profile:write` | `publish-api-server.js:938,464` |
| 批量签发 | `POST /api/v1/admin/member/redeem-codes` | `admin:users` | `publish-api-server.js:1427` |
| 列表（默认掩码） | `GET /api/v1/admin/member/redeem-codes` | `admin:users` | `publish-api-server.js:1428` |
| 吊销 | `POST /api/v1/admin/member/redeem-codes/disable` | `admin:users` | `publish-api-server.js:1429` |
| 手动开通 | `POST /api/v1/admin/member/grant` | `admin:users` | `publish-api-server.js:1426` |
| 价目目录 | `GET /api/v1/plans` | `profile:read` | `publish-api-server.js:930,463` |

**鉴权边界（重要）**：`/api/v1/admin/member/*` 只认 `authType === "logto"` 的身份，
**拒绝静态主密钥**（`publish-api-redeem-code-admin.js:24`）。这一条要保住。

**码的生成**（`subscription-service.js:38-44`）：

```js
const REDEEM_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'   // :13  31 字符，排除 I/L/O/0/1
const REDEEM_CODE_PATTERN  = /^[...]{4}-[...]{4}-[...]{4}$/       // :14  4-4-4 = 12 字母
function generateRedeemCode() {                                    // :38
  const pick = () => Array.from({ length: 4 },
    () => REDEEM_CODE_ALPHABET[crypto.randomInt(REDEEM_CODE_ALPHABET.length)]).join('')
  return `${pick()}-${pick()}-${pick()}`
}
```

- 组合空间 = 31¹² ≈ **7.88 × 10¹⁷**
- 即使 10⁶ 次/秒穷举，也需约 **2.5 万年**
- 生成与校验的字母表**严格同型**（pattern 里的字符类 = 生成用的 31 字符，同一份常量）

**核销逻辑**（`subscription-service.js:259-318`）：

```
事务内：
  lockRedeemCode(code)        → SELECT ... FOR UPDATE          (postgres-commerce-store.js:61-67)
  status==='used'  → 同人则返回幂等视图，他人则 409
  status!=='active'→ 409 已停用
  expires_at 已过  → 410
  applySubscription({plan, durationDays, ...})                     (:88-169)
  markRedeemCodeUsed(code, userId)                                (:69-79)
  createNotification(...)                                         (:295-303)
```

**并发安全（双保险）**：
- 码维度：`FOR UPDATE` 行锁 + 条件更新 `WHERE status='active'`
- 用户维度：`pg_advisory_xact_lock(hashtextextended('sub:'+userId))`（`postgres-commerce-store.js:100`）
  —— 防止「两个不同的码同时兑给同一人时 `current_period_end` 读-改-写丢期」

**跨档续叠保护**（`postgres-commerce-store.js:112-116`）：
低档码只加时长、**不改档位**（`downgradeSuppressed=true`），高档码整期升级。
这是"用户已有 pro 期间兑一张 standard 码"不会把剩余 pro 期整体降级的保证。

**表结构**（`migrations/postgresql/004_member_commerce.sql:23-36`）：

```sql
CREATE TABLE identity_redeem_codes (
  code          TEXT PRIMARY KEY,
  plan          TEXT NOT NULL CHECK (plan IN ('standard','pro')),
  duration_days INTEGER NOT NULL CHECK (duration_days > 0),   -- 90 天然合法
  batch         TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','used','disabled')),
  used_by       TEXT REFERENCES identity_users(id),
  used_at       TIMESTAMPTZ,
  expires_at    TIMESTAMPTZ,          -- 码的"使用截止日"（≠ 兑换后会员天数）
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### 1.2 运营中心 —— `ops-center/`

| 位置 | 内容 |
|---|---|
| `frontend/src/views/RedemptionCodes.vue` | 兑换码管理页：筛选 + 列表 + 签发弹窗 + 签发结果弹窗 + 作废 |
| `frontend/src/views/MemberGrants.vue` | 手动开通订阅 |
| `frontend/src/api/redemptionCodes.js` | API 转发封装 |
| `backend/services/redeem_batch_service.py` | **纯转发层**——ops 后端不生成、不存储任何兑换码 |
| `backend/services/member_grant_service.py` | 手动开通转发层 |

设计原则已写进代码注释（`RedemptionCodes.vue:5-7`）：
> 签发由服务端 `api-publish-engine` 统一落库（`identity_redeem_codes`），本页面只负责发起签发与展示结果——ops 后端不生成、不存储任何兑换码。

**这条原则要保住**：一旦 ops 也存一份码，就出现两个真源，吊销/对账必然漂移。

### 1.3 桌面端 —— `apps/desktop/`

| 位置 | 内容 |
|---|---|
| `src/views/MemberCenter.vue:118-148` | 兑换卡 UI（输入框 + 提交按钮 + 结果行） |
| `src/views/MemberCenter.vue:218-295` | 核销逻辑 + 三态结果（success / info / error） |
| `src/stores/member.js:120-133` | `redeemCode()`，返回 `idempotent` + `hasActiveSubscription` **两个独立字段** |
| `src/api/identity.js:35-39` | IPC 契约注释 |
| `electron/services/identity/member-api-service.js:25-27` | 路径白名单：**只放 POST**（放 GET 等于允许用 query 传码 → 进 access log 与浏览器历史） |
| `src/locales/member-center/zh.js:10-21` / `en.js` | 文案成对（Gate 7） |

**已处理好的语义**（这些不要动）：
- 三态区分：首次成功 / 幂等重放（订阅仍有效）/ 幂等重放（订阅已过期）
  —— 服务端在第三种情况返回 **HTTP 200 + `subscription: null`**，只判 `code===0` 会给用户发假承诺
- 未登录本地短路（`requireSubject: true`）
- IPC body 白名单只放 `code` 一个字段
- 兑换卡常驻订阅页上方，订单页空态 `navigate('redeem')` → 落到订阅页（`MemberCenter.vue:196-200`）

### 1.4 已被刻意删除的"本地加密"方案 —— 安全设计的历史证据

这一节是本文档最重要的论据来源。

| 被删的东西 | 为什么删 | 出处 |
|---|---|---|
| `license:activate` 本地激活通道 | `licenseManager.activate()` 只做 `trim()`，**任意非空串**（含 `"   "`）都能拿到 `type=pro` + `expiresAt=null` **永久** + 8 项全功能 | `apps/desktop/electron/services/license-manager.js:36-38`；`UpgradeModal.vue:54-62`；`stores/license.js:28-33` |
| 桌面端 HMAC 签发模块 `redemption-codes.js`（`MP-RAND-RAND-SIG`） | "签发得出来、兑不了"（正式包拒收兑换）⇒ 等于第二套权威，死代码 | `openspec/records/remove-dead-redemption-codes.md`（PR #3565, 2026-10-14） |
| 硬编码 HMAC 种子 `\|\| "mp-redemption-seed-v1"` | 密钥硬编码 ⇒ 任何人拿到包即可伪造 | `01-docs/decision-log.md:421` |

**三次事故，同一个根因：把「码 → 权益」的映射逻辑放进了本地。**

---

## 2. 术语与档位映射（动手前先定死）

| 你的说法 | 仓内档位 id | 仓内显示名 | 单价（`plan-matrix.js`） | 备注 |
|---|---|---|---|---|
| 基础会员 | `standard` | **标准版** | ¥59/月、¥499/年 | ⚠️ 与「免费版」易混 |
| 高级会员 | `pro` | **专业版** | ¥119/月、¥999/年 | |
| （无） | `free` | 免费版 | ¥0 | 不可签发（服务端拒 `free`） |
| 1 个月 | — | — | — | ⇒ `duration_days = 30` |
| 3 个月 | — | — | — | ⇒ `duration_days = 90` |

**⚠️ 术语冲突警告**：仓内「基础」一词已被占用且含义相反——
`modelTier: 0` 叫「基础模型层级」，`free` 档叫「免费版」。
`standard` 是**付费中间档**，不是「基础档」。

**建议**：代码/接口/表里继续用 `standard` / `pro`（不动，避免污染既有契约与迁移），
**只在 UI 文案层**做映射，并且**展示为仓内既有的「标准版/专业版」**——
因为 `plan-matrix.js:62,83` 的 `label` 已经是「标准版」「专业版」，
会员中心的购买区用的也是这套（`Subscription.vue:79-82`）。
若强行改成「基础/高级」，同一产品里会出现两套档位名，客服和用户都会混。

> **决策项（需你拍板）**：UI 显示"标准版/专业版"（与既有购买区一致）
> 还是"基础会员/高级会员"（与你的渠道话术一致）？
> 我的建议是**前者**，理由是同一产品内档位名必须唯一；渠道话术可以在营销物料里另行映射。

**时长语义**（`duration_days`）：30 天 = 1 个月，90 天 = 3 个月。
注意这是**按天计**，不是"自然月"——3 个月码 = 90 天，不保证对齐到同一个日号。
这一点在运营签发时必须写进提示文案（当前 ops 页面已提示"按天计"，✅）。

---

## 3. 核心架构判断：为什么**不要**给激活码加"加密解密"

这是本次需求里最需要先说清楚的一点，因为**照着做会引入漏洞**。

### 3.1 你的需求里隐含了一个假设

> "激活码的生成和检验，需要实现加密和解密。要从安全性考虑，如何防止破解本地算法。"

这句话隐含：**激活码应当是一段自解释的密文**，里面装着「档位 + 时长」，用密钥解密出来就知道该给什么权益。

### 3.2 这个假设正是历史漏洞的根源

| 时间 | 做法 | 后果 |
|---|---|---|
| 2026-10-07 前 | 本地 `activate(key)` 里写死"码 → pro 永久" | 任意非空串换永久 Pro。**修法是把整条本地路径删掉**，不是"把算法加密得更强" |
| 2026-10-14 前 | 本地 HMAC 签发 + 验签（`MP-RAND-RAND-SIG`） | 密钥在客户端 ⇒ 可提取 ⇒ 可伪造。**修法是删掉整个模块** |
| v2.3.43 | HMAC 种子硬编码在源码里 | 拿到包即可造码。**修法是改成 `\|\| ''`，让签名功能直接失效** |

三次的共同点：**只要"码 → 权益"的映射存在于本地，本地就是攻击面**。
给映射加密码，只是把"读代码就能看懂"变成"读代码+逆向密钥"——**门槛提高了，但门还在**。
而删掉本地映射，门就没了。

### 3.3 正解：码 = 无信息的随机 token，权益 = 服务端的一行状态

```
激活码  = 31 字符字母表上随机取 12 位（不加密、不签名、不含任何权益信息）
          ↓  只是一把「查表的钥匙」
服务端 DB = identity_redeem_codes 的一行：
          plan(standard|pro) + duration_days + status + used_by + ...
          ↓
权益 = 服务端根据这行状态计算并落库（entitlement 快照）
```

这个结构下：
- **客户端没有任何"码 → 权益"的算法** ⇒ 没有"本地算法"可破解
- 攻击者改客户端、改本地缓存、改常量，**一分钱权益都开不出来**（因为权益写库发生在服务端）
- 唯一可行的攻击是攻服务端或偷库 —— 这两条已被 scope 隔离、行锁、审计覆盖
- 穷举不现实（7.88×10¹⁷ 空间）

### 3.4 结论：把"加密解密"翻译成正确的需求

你真正想要的是"**用户伪造不了码、运营看得住码、码泄漏了能止损**"。这三件事**不需要密码学**：

| 你担心的 | 正确的解法（现有能力 / 本方案新增） |
|---|---|
| 用户伪造码 | ✅ 随机码 + 服务端查库 + 零本地映射 |
| 用户重复用同一个码 | ✅ 行锁 + 条件更新 + 幂等返回 |
| 码被用户截图外传 | ✅ 一次性资源 + 作废接口 + 发放对象溯源（**新增**） |
| 运营误发高价值码 | ✅ 跨档压制 + 签发二次确认（**新增**） |
| 运营泄漏全库未用码 | ✅ 默认掩码 + reveal 留痕（**需补 scope 隔离**） |
| 用户拿旧码反复试 | ❌ **无限流**（**新增**） |

### 3.5 唯一的例外：如果你确实需要"离线可验签"

只有一种场景会需要密码学：**码要交给一个我们不控制、且需要离线验真的一方**
（例如批量发给代理商，代理商要自己确认"这是我方签发的码"）。

即便如此，正确的做法**也不是"加密"**，而是**服务端签名**：

```
码 = base64(payload) ‖ base64(Ed25519签名)
payload = { plan, durationDays, expiresAt, nonce }
私钥：只在服务端（永不进客户端）
第三方：只持公钥验签
```

**但必须接受它的边界**：
- 公钥验签只能证明"**这码是我方签发的**"，**证不了"这码还没被用"**（一次性状态在服务端）
- ⇒ 第三方**不能**据此给用户开通权益，最终仍要回调我方服务端核销
- ⇒ 这会引入**第二套真源**，而 `DESIGN-MEMBER-CENTER-P2-PAYMENT` 明确禁止"第二套权威"

**建议：除非产品明确要求"第三方离线发码/离线核销"，否则不做。**
当前没有任何场景提出这个需求 ⇒ 结论是**不做**。

---

## 4. 安全设计

### 4.1 威胁模型与现状覆盖

| # | 威胁 | 现状 | 处置 |
|---|---|---|---|
| T1 | 改本地代码换永久 Pro | ✅ 已堵（本地激活通道 2026-10-17 整体删除） | **保持零本地权益写入路径** |
| T2 | 伪造激活码 | ✅ 随机码 + 服务端查库，码内无权益信息 | 保持 |
| T3 | 穷举激活码 | ✅ 7.88×10¹⁷ 空间 | 保持 |
| T4 | 同一码重复兑换 | ✅ 行锁 + 条件 UPDATE + 幂等视图 | 保持 |
| T5 | 暴力试码（探测已存在码 / 骚扰） | ⚠️ **无针对性限流**（详见下方「限流现状」小节） | **P1 新增**（§4.2①） |
| T6 | 运营导出全库未用码 | ⚠️ 有 `reveal=true` + 审计，但**所有 `admin:users` 都能导** | **P1 新增独立 scope** |
| T7 | 签发/吊销/手动开通无痕 | ❌ **无审计**（只有 reveal 有） | **P1 新增** |
| T8 | 码泄漏后无法止损 | ⚠️ 可作废，但**不知道发给了谁** | **P2 新增 `issued_to`** |
| T9 | 码进日志/截图 | ✅ 默认掩码 + POST-only（不进 URL） | 保持 |
| T10 | 内部人直改 DB 开会员 | ⚠️ 靠 DB 权限 | 审计覆盖 §4.2 |
| T11 | 桌面端被逆向提取密钥 | ✅ **无密钥可提**（码非签名） | **这是核心资产，保持** |
| T12 | 错档/错时长发给用户 | ✅ 跨档压制（低档不覆盖高档） | 保持 + UI 二次确认 |

### 4.2 建议新增的加固（按性价比排序）

**① 兑换失败限流（P1，最高性价比）**

**限流现状（先说清，避免重复造轮子）**：仓里**有**一个限流器，但它对兑换场景基本无效：

| 事实 | 出处 |
|---|---|
| 全局 IP 级滑窗限流，窗口 60s | `packages/api-publish-engine/src/rate-limiter.js:13-27` |
| 在**所有**请求前统一执行，命中返回 429 | `publish-api-server.js:777-780` |
| **默认不启用**：`maxRpm` 缺省为 `null` ⇒ `this._rateLimiter` 为 `null` | `config-loader.js:15`；`publish-api-server.js:158` |
| **不区分端点**：兑换与发布共用同一个计数器 | `publish-api-server.js:777-780` |
| **不区分成败**：成功请求同样计数 | `rate-limiter.js:24-25` |
| **单进程内存态**：多实例部署时每个实例各算各的 | `rate-limiter.js:6` |

⇒ 三个后果：
1. 部署若**没配** `MAX_RPM` ⇒ **完全无限流**；
2. 配了 ⇒ 是"全站每分钟 N 次"的粗桶，**低速率定向探测（每秒 1 次）抓不到**；
3. 桶被正常流量占满时，**兑换失败请求反而挤不进额度**（成功请求已经把额度用掉了），
   而真正该拦的失败请求没有独立额度。

⇒ 所以需要的是**端点级、失败计数**的限流，而不是复用现有桶。

建议（engine 路由层，与 `publish-api-server.js:938` 同层）：
- 同一用户：60 秒内**失败** ≥ 5 次 ⇒ 429 + 退避
- 同一 IP：10 分钟内**失败** ≥ 30 次，**且最近 60 秒内失败 ≥ 10 次** ⇒ 429
- **只计失败**，成功不计数（否则正常用户连兑几张码就被限）
- 命中时只回 429，**不透露剩余次数**（否则限流器本身可被探测）
- 计数存储：短期用进程内 LRU（多实例时各自计数，精度可接受）；若已部署 Redis 则用它
- ⚠️ 失败判定要覆盖**格式错误**与**不存在**两种：
  `REDEEM_CODE_FORMAT` 也计（否则可以拿格式错的串无限刷）

**② 拆分 scope（P1）**

现状：`/api/v1/admin/member/*` 全部是 `admin:users`（`publish-api-server.js:468`）。
⇒ 任何一个有 `admin:users` 的人都能 **reveal 全库未兑换码**。

建议拆成：
```
admin:redeem:read     列表（掩码）
admin:redeem:export   reveal 完整码
admin:redeem:write    签发 / 作废
admin:members:grant   手动开通
```
（改 scope 需同步改 `publish-api-server.js:468` 的映射与 ops 后端 token 配置）

**③ 补审计（P1）**

现状审计只有两处：`redeem_code_reveal`（:99）、`redeem_code_batch_incomplete`（:138）。
**签发成功**、**作废**、**手动开通 grant** 三类花钱动作**都没有审计**。

建议补：
```js
{ type: "redeem_code_batch_issued", batch, plan, durationDays, count, operator }
{ type: "redeem_code_disabled", code, operator }
{ type: "member_grant", userId, plan, durationDays, operator }
```
理由：**签发 500 个码 ≈ 一笔真实支出**。没有审计 = 出了事查不到人。

**④ 发放对象溯源（P2）**

`identity_redeem_codes` 加可空列：
```sql
ALTER TABLE identity_redeem_codes ADD COLUMN IF NOT EXISTS issued_to TEXT;
ALTER TABLE identity_redeem_codes ADD COLUMN IF NOT EXISTS note TEXT;
```
`issued_to` = 发放对象（渠道名 / 客户名 / 活动名），`note` = 运营备注。
泄漏后可按 `batch` 列出该批次的码 → 逐个吊销。

> ⚠️ **能力边界**：仓里**只有单码吊销**（`POST /api/v1/admin/member/redeem-codes/disable`），
> **没有批量作废端点**；`issued_to` 也**不是列表筛选条件**（列表只支持 `plan`/`status`/`batch` 过滤）。
> 「批量作废端点」与「按 `issued_to` 筛选」是下一轮的独立改动（见 §5.4 已标注「新增」的那条）。

⚠️ **迁移纪律**：新迁移放 `migrations/postgresql/007_*.sql`
（⚠️ 目录当前已有 `002_logto_identity.sql` / `003_logto_webhook_events.sql` /
`004_member_commerce.sql` / `005_cloud_accounts.sql` / `006_payment_orders.sql`
—— **005 和 006 已被占用**，不要按"上一个是 004"来推编号）。
迁移必须**幂等可重跑**（`ADD COLUMN IF NOT EXISTS`）。

⚠️ **且不止迁移一处**：加列要**四处同改**（迁移 + 运行时 SCHEMA 数组 + INSERT + SELECT），
其中运行时 SCHEMA 数组那一处最隐蔽——`CREATE TABLE IF NOT EXISTS` 对已存在的表是 no-op，
**不会加列**。完整清单见 §6.4.2。
加**列**不影响 `REQUIRED_SCHEMA_RELATIONS` 的表清单（那三处硬编码只管表名），
但若后续要**新增表**（如批次统计表），则必须同步那三处副本 —— 见 §6.4。

**⑤ 码的"面值"只读推导，不新增字段（P2）**

3 个月标准版的名义价值 = ¥59 × 3 = ¥177。
**不要**把它存进表（会与 `plan-matrix` 改价漂移）。
运营界面**实时算**并注明口径"按月付折算，不含年付折扣"。

**⑥ 批次临期提醒（P2）**

`expires_at` 临期的码在 ops 列表高亮 + 看板角标。
（`MECHANISM-MEMBER-TIERS-DEEP-2026-10-19.md:443` 已把"兑换码临期运营侧无提醒"登记为待办）

### 4.3 明确**不做**的安全动作

| 动作 | 为什么不做 |
|---|---|
| 给码加"加密载荷" | §3。会把客户端变回攻击面 |
| 客户端内置 Ed25519 私钥 | 私钥进包 = 可提取 = 可伪造 |
| 把码做成"可离线自证"的凭证 | 一次性状态在服务端，证不了；且制造第二套真源 |
| 用码的内容当随机源（如取哈希前 12 位） | 长度固定 ⇒ 熵受限；不如直接 `crypto.randomInt` |
| 把兑换码塞进 URL query | 会进 access log / 浏览器历史。现有 POST-only 设计正是为此（`member-api-service.js:25-27`） |
| 物理删除已兑换码 | 权益已发放，删了就对不上账。现状只支持作废（`disabled`），✅ 已正确 |

---

## 5. 运营中心 UI 方案

### 5.1 签发弹窗（`RedemptionCodes.vue:90-120`）

**当前**：数量 / 套餐(英文) / 有效天数(裸数字) / 兑换码过期(ISO 字符串手填) / 批次号

**改成**：

```
┌─ 批量签发兑换码 ────────────────────────────────┐
│                                                │
│  套餐 *            [ 标准版 · ¥59/月      ▾ ]   │  ← 显示中文名+价格
│                                                │     value 仍是 standard
│  会员时长 *                                    │
│    ( ● ) 1 个月 (30 天)                         │  ← 预设单选
│    ( ○ ) 3 个月 (90 天)                         │
│    ( ○ ) 自定义 [___] 天                        │  ← 自定义默认收起
│                                                │
│  数量 *          [ 10 ▾ ]  (预设 10/50/100/200) │
│                                                │
│  名义价值         ≈ ¥177（按月付折算 ¥59×3）    │  ← 实时算，注明口径
│                                                │
│  兑换码截止使用日  [ 2027-01-31 📅 ]            │  ← date-picker，非 ISO 手填
│     ⓘ 留空 = 长期有效。指"码的使用截止日"       │
│       与上面的"会员时长"是两件事。               │
│                                                │
│  发放对象          [ 渠道/客户名/活动名       ]  │  ← 新增，写 issued_to
│  批次号            [ batch-20261024-std-90d ]  │  ← 自动建议，可编辑
│                                                │
│           [ 取消 ]      [ 签发 200 个 ]         │
└────────────────────────────────────────────────┘
```

**签发前二次确认**（新增）：
> 将签发 **200 个「标准版 · 1 个月」**兑换码，合计名义价值约 ¥11,800。
> 签发后**不可撤销**（只能逐个作废）。确认签发？

理由：现在 200 个码一点就发出去，没有回头成本提示。

### 5.2 签发结果弹窗（`RedemptionCodes.vue:122-144`）

**当前**：一个滚动 div 装所有码 + "完整码仅本次显示"。

**改成**：

```
┌─ 签发结果 ────────────────────────────────┐
│  已签发 200 个 · 批次 batch-20261024-…   │
│  [ 📋 复制全部 ]  [ ⬇ 导出 CSV ]  [ 📄 复制模板行 ] │
│                                           │
│  ABCD-EFGH-JKMN                          │
│  WXYZ-2345-JKMN                          │
│  ...                                     │
│                                           │
│  ⓘ 完整码也可在列表中打开"显示完整码"找回， │
│     该操作会被记入审计日志。                │
└───────────────────────────────────────────┘
```

- **一键复制全部**：`navigator.clipboard.writeText` + `document.execCommand` fallback
- **导出 CSV**：`﻿` UTF-8 BOM 前缀（Excel 中文不乱码），列 = 码/套餐/时长/批次/截止日
- **复制模板行**：每行一个码，方便直接贴进 IM/邮件
- 文案修正：现在的"关闭后无法再次查看"**不准确**（reveal=true 可查回）⇒ 改成上面那句

### 5.3 列表页（`RedemptionCodes.vue:58-87`）

| 列 | 现状 | 改成 |
|---|---|---|
| 兑换码 | 掩码 `ABCD-****-****` | 保持；加"复制"按钮 |
| 套餐 | `standard` / `pro` | **标准版 / 专业版** |
| 天数 | `30` | **1 个月**（30 天） |
| 批次 | 裸 batch 串 | 保持 + **可点击进批次详情** |
| 状态 | 未使用/已兑换/已作废 | 保持 |
| 使用者 | userId 裸值 | 保持（可加用户标识） |
| — | — | **新增：发放对象**（`issued_to`） |
| — | — | **新增：本批兑换率**（需 §6.1 接口） |

### 5.4 批次详情（新增）

点批次号 → 抽屉/弹窗：
- 概览：套餐 / 时长 / 签发数 / 已兑换 / 未使用 / 已作废 / **兑换率**
- 明细表：码 / 状态 / 使用者 / 兑换时间
- 操作：批量作废本批未使用码（**新增**，需 engine 支持批量 disable）

### 5.5 术语与口径对齐

- `PLAN_OPTIONS`（`:155`）保持 `['standard','pro']` 不变（值），**只加显示映射**：
  ```js
  const PLAN_LABELS = { standard: '标准版', pro: '专业版' }
  ```
  ⚠️ 后端 `SUPPORTED_PLANS = ("standard","pro")`（`redeem_batch_service.py:36`）——保持同源，不要在前端另造一份不同的档位集合。
- `MAX_BATCH` 不一致：ops 前端/后端都是 **200**（`redeem_batch_service.py:32`、`RedemptionCodes.vue:157`），
  engine 允许 **500**（`subscription-service.js:387`）。**取 ops 的 200 更安全**（更小批量更好追责），
  但要**在文档里写明**"ops 主动收窄到 200"，否则以后有人看到 engine 500 会以为是 bug。

---

## 6. 服务端与数据模型改造

### 6.1 新增：批次统计接口

```
GET /api/v1/admin/member/redeem-codes/batches?batch=<id>
  → { success, batch, plan, durationDays, total, active, used, disabled,
      issuedAt, redeemedCount, redeemRate }
```
- engine：新增 `getRedeemBatchSummary()`，**必须开新文件**（如 `subscription-redeem-batch.js`，
  用现成的 mixin 范式 `applySubscriptionRedeemBatchOps`）
- ⚠️ **`subscription-service.js` 只剩 4 行余量**：
  该文件当前 **496 行**，且**不在** `max-lines-baseline.json` 的 `files`（挂账）或 `targets`（点名）任一清单里
  ⇒ 受全局 `limit: 500` 的 `NEW_OVER_LIMIT` 规则约束（`lines >= 500` 即阻断，`.github/scripts/check-max-lines.js:268`）
  ⇒ **再加 4 行就撞门禁**。
  理由与先例同 `subscription-payment.js`（`subscription-service.js:481-486` 的注释就是为它写的：
  "那组方法 140 行会把本文件推到 632 行，顶破 filesOver500 债务基线"）。

### 6.2 新增：批次号建议值生成

engine 侧给默认批次号一个**可读格式**，比现在的
`batch-2026-10-24-a1b2c3`（`:390`）更有运营价值：
```
batch-20261024-std-90d      # 日期-档位-时长
```
保留原格式作为 fallback（自定义批次号优先）。

### 6.3 新增：时长预设常量（单一真源）

```js
// engine
const REDEEM_DURATION_PRESETS = Object.freeze([
  { key: 'month1', days: 30, label: '1 个月' },
  { key: 'month3', days: 90, label: '3 个月' },
])
```
- engine 与 ops **各持一份会漂移** ⇒ 建议由 engine 在
  `GET /api/v1/admin/member/redeem-codes/presets`（或并入 `GET /api/v1/plans`）下发
- ops 前端从接口取，不硬编码
- 自定义天数仍允许（保持现状弹性）

### 6.4 迁移纪律（来自本仓既有教训）

#### 6.4.1 本仓的 schema 管理有三套并行机制（先搞清楚再动手）

| 机制 | 位置 | 何时生效 |
|---|---|---|
| **迁移文件** | `migrations/postgresql/*.sql` | **生产**；`assertReady()` 用 `validateMigrationLedger(..., {allowPending:false})` 校验**每一份都已应用且 checksum 一致**（`postgres-identity-repository.js:216-222`） |
| **运行时 SCHEMA 数组** | `postgres-identity-repository.js:26-176`（含 `payment-schema.js`） | **仅非生产**：`initialize()` 逐条执行（`:196-203`）；生产直接抛 `PRODUCTION_AUTO_MIGRATE_FORBIDDEN` |
| **运行时表清单** | `REQUIRED_SCHEMA_RELATIONS`（`postgres-identity-repository.js:10-24`） | `assertReady()` 检查这些表**存在**，缺一个就 `BUSINESS_DATABASE_SCHEMA_NOT_READY`（`:213-217`） |

⚠️ **本仓的既有惯例 = 迁移与 SCHEMA 数组逐字成对**。
先例：`migrations/postgresql/006_payment_orders.sql:19-23` 与
`packages/api-publish-engine/src/auth/payment-schema.js:18-23` 是一对**内容相同**的
`ALTER TABLE ... ADD COLUMN IF NOT EXISTS` 语句。

#### 6.4.2 给 `identity_redeem_codes` 加列 ⇒ **四处必须同改**（漏一处就分叉）

以 `issued_to` / `note` 为例：

| # | 文件 | 改什么 | 漏了会怎样 |
|---|---|---|---|
| 1 | `migrations/postgresql/007_*.sql`（**新建**） | `ALTER TABLE identity_redeem_codes ADD COLUMN IF NOT EXISTS issued_to TEXT;`（同理 `note`） | 生产 `assertReady()` 报 `MIGRATION_PENDING` |
| 2 | `postgres-identity-repository.js` 的 `SCHEMA` 数组（`:104-116` 之后） | **同一条 ALTER 语句** | ⚠️ **最隐蔽的一个**：SCHEMA 里那张表是 `CREATE TABLE IF NOT EXISTS`（`:104`）——**对已存在的表是 no-op，不会加列**！开发库既有表将永远缺这一列 ⇒ 新 INSERT 报 `column "issued_to" does not exist` |
| 3 | `postgres-commerce-store.js:282-298` `createRedeemCodes` | INSERT 是 `unnest($1,$2,$3,$4,$5)` 批量形式 ⇒ 要加第 6 个数组参数 | 签发直接失败 |
| 4 | `postgres-commerce-store.js:310-317` `listRedeemCodes` | SELECT 列清单加 `issued_to` | 列表页拿不到发放对象 |

再往上一层，字段要能从前端走到库里，还要同步：
`subscription-service.js:380-414`（`createRedeemBatch` 收 `issuedTo`）→
`:400` 构造 records → `:420-452`（`listRedeemCodes` 映射 `issuedTo`）→
`publish-api-redeem-code-admin.js:40-51`（解析 body 的 `issuedTo`）→
ops `redeem_batch_service.py`（转发 + 校验）→ ops `RedemptionCodes.vue`（表单 + 列表列）。

#### 6.4.3 若**新增表**（本方案不建议）

`REQUIRED_SCHEMA_RELATIONS`（`postgres-identity-repository.js:10-24`）在**三处**被硬编码复制：
① readiness 断言的期望表清单 ② fail-closed 路径的关系表清单
③ 「生产迁移 ↔ 运行时表一致性」那张表名列表。

⇒ **改主清单前先 grep 它的每一个副本**，用上一张同类条目作锚点比逐个读文件快且不漏；
追加必须**按主清单的同一顺序**（有 `assert.deepStrictEqual` 逐项比对，见
`test/cloud-accounts-schema-drift.test.js:54-55`）。

> 建议：**本期不新增表**。批次统计用 `identity_redeem_codes` 上的 `GROUP BY batch` 聚合即可，
> 零迁移、零清单同步、零风险。若未来要预聚合表再单独立项。

### 6.5 兑换失败限流的落点

放在 `publish-api-server.js` 的 `/api/v1/redeem` 分支（`:938`）**之后**、`_commerceFailure` 之前，
与现有 scope 校验并列——但**不能**挂在 `publish-api-server.js:777-780` 的全局限流位上：
那个是全站粗桶（默认关闭、不分端点、不分成败，见 §4.2①），语义完全不同。

⚠️ 落点的行数约束：`publish-api-server.js` 在 `max-lines-baseline.json` 里
`files=1356` / `targets=1574` ⇒ **targets 容差为 0**，**一行都不能加**
（`check-max-lines.js:250-255`：被 targets 点名的文件天花板 = targets 值，容差 0）。
⇒ 限流逻辑必须放**新文件**（如 `src/auth/redeem-rate-limit.js`），
由 `publish-api-server.js` **改动既有行**（如在 `require` 区加一行 + 在 redeem 分支调用）来接线。
注意 `files=1356` 的挂账值给了 `growthAllowance=200` 的增长空间，
但 `targets=1574` 是**零容差**——两者的约束不同，别混。

计数存储：
- 短期：进程内 LRU（多实例时各自计数，精度可接受）
- 长期：Redis（若已部署）

---

## 7. 桌面端 UI 方案

### 7.1 兑换卡升级（`MemberCenter.vue:118-148`）

**当前**：
```html
<input v-model="redeemCode" placeholder="ABCD-EFGH-JKMN" :disabled="redeeming" ...>
<button :disabled="!canSubmitRedeem" @click="submitRedeem">立即兑换</button>
```

**改成**：

```
┌─ 激活码兑换 ───────────────────────────────────────┐
│ 输入激活码兑换会员权益。一码仅可核销一次，          │
│ 与账号绑定。                                        │
│                                                   │
│  ┌────────────────────────────────────┐ ┌────────┐ │
│  │ ABCD-EFGH-JKMN                     │ │立即兑换│ │
│  └────────────────────────────────────┘ └────────┘ │
│                                                   │
│  ✓ 格式正确                          ← 实时反馈   │
└───────────────────────────────────────────────────┘
```

具体改动：

| # | 改动 | 理由 |
|---|---|---|
| D1 | **修正文案「16 位」→「12 位」**（zh/en 同步） | 实际是 12 字母（14 字符含连字符）。`zh.js:11` / `en.js:11` 现在的说法是错的 |
| D2 | 输入框 `maxlength=14` | 物理上挡住超长输入 |
| D3 | 自动 `toUpperCase()` + 自动补连字符（`ABCD` → `ABCD-`） | 用户手输体验；且服务端是 `trim().toUpperCase()` 后再匹配（`subscription-service.js:261`） |
| D4 | **提交前本地格式校验** | 现状 `canSubmitRedeem` 只查非空（`:227-229`）。`01-docs/AUDIT-MEMBER-CENTER-IA-2026-10-19.md:111`（P1-8）已点名此缺口 |
| D5 | 格式合法时给绿色边框 + "格式正确" | 即时反馈，减少往返 |
| D6 | 粘贴支持（整段粘贴自动格式化） | 运营常从 IM/邮件整段贴 |
| D7 | 错误态保留服务端语义码映射 | 现状 `REDEEM_ERROR_KEYS`（`:232-240`）已完备，**不动** |

**D4 的契约锁（重要）**：桌面端不能 `require` 服务端文件（跨包），
所以要在桌面端建一份**镜像常量**并加**一致性测试**锁住与服务端同型。
先例：仓内已有 `buyout-removal.contract.test.js` 这类跨端契约锁。

```js
// apps/desktop/src/views/member-center/redeem-code-format.js
// 镜像 packages/api-publish-engine/src/auth/subscription-service.js:14
// ⚠️ 两份定义必须同型；改动任一处必须同时改另一处，并由 redeem-code-contract.test.js 锁住
export const REDEEM_CODE_PATTERN = /^[ABCDEFGHJKMNPQRSTUVWXYZ2-9]{4}-[ABCDEFGHJKMNPQRSTUVWXYZ2-9]{4}-[ABCDEFGHJKMNPQRSTUVWXYZ2-9]{4}$/
```

> **备选方案**：让 `GET /api/v1/plans` 一并下发 `redeemCodePattern` 描述。
> 好处是单一真源；坏处是**首次启动没网就没有校验**。⇒ 建议**镜像常量 + 契约测试**（离线也可用，且漂移会被 CI 抓住）。

### 7.2 结果反馈强化（`MemberCenter.vue:270-290`）

现状三态已正确，缺的是**「档位压制」这一态没有单独文案**。

服务端在低档码被高档压制时返回 `downgradeSuppressed: true`（`subscription-service.js:309`），
但**桌面端全仓 `downgradeSuppressed` 零命中** —— 它既没被 store 透传，也没被视图使用。
⇒ 现状下用户看到"已开通 standard"，而实际生效仍是 pro ⇒ **误导**。

**改两层（不是一层）**：
1. `apps/desktop/src/stores/member.js:126-131` —— 归一化视图里补一个字段：
   ```js
   downgradeSuppressed: data.downgradeSuppressed === true,
   ```
   （与 `idempotent` / `hasActiveSubscription` 同处；`subscription-service.js:309` 已经把它送出来了，
   只是 store 没往下传）
2. `apps/desktop/src/views/MemberCenter.vue:270-290` —— 加第 4 个分支。

新增第 4 态：
```
tone: 'info'
text: 已续叠 30 天；当前档位（专业版）高于该码，档位保持专业版不变。
      有效期至 2026-12-24
```
配套新增 i18n key（zh/en 成对，Gate 7）。

| 场景 | tone | 文案 |
|---|---|---|
| 首次成功 | success | 已开通 标准版，有效期至 X |
| 首次成功但被压制 | info | 已续叠 N 天；当前档位（X）高于该码，档位保持不变 |
| 幂等重放（订阅仍有效） | info | 该码此前已兑换，当前订阅有效至 X |
| 幂等重放（订阅已过期） | info | 该码此前已兑换，对应订阅已到期，重放不会增加时长 |
| 服务端错误 | error | 按 `REDEEM_ERROR_KEYS` 映射（不变） |

### 7.3 兑换历史（零新增接口）

`identity_orders` 已有 `channel='redeem'` 的记录（`subscription-service.js:287`），
`GET /api/v1/me/orders` 已存在 ⇒ **兑换历史天然出现在「订单与账单」页**（`OrdersBilling.vue`）。

需要做的只是：
- 订单列表里把 `channel='redeem'` 的行显示成"激活码兑换"（而非"支付"）
- 显示该订单的 `plan` + 有效期

⇒ **本项零后端改动**，只改前端展示。

### 7.4 桌面端**不做**的事

- ❌ 不在桌面端做任何本地权益计算/校验（那是漏洞的根源）
- ❌ 不缓存未兑换码
- ❌ 不做"离线兑换"（需服务端在线确认一次性状态）
- ❌ 不在本地生成激活码（签发只在 ops-center）

---

## 8. 落地拆分

> 依赖顺序自上而下。P0 全部是**零/低后端改动**，可以先合，快速见效。

（2026-10-24 首轮已落地：**P0-2 运营侧** + **P1-1 限流** + **P1-3 issued_to**；
P0-1 桌面端、P0-3 复制导出、P1-2 scope 拆分、P2 系列仍在下一轮。）

| PR | 范围 | 后端 | 前端 | 依赖 |
|---|---|---|---|---|
| **P0-1** | 桌面端兑换卡体验：文案修正 + 本地校验 + 自动大写/分隔 + 契约测试 | — | desktop | 无 |
| **P0-2** | 运营中心签发弹窗：中文档位名 + 1月/3月预设 + date-picker + 二次确认 + 发放对象 | 迁移 007（加列） | ops | 无 |
| **P0-3** | 运营中心签发结果：一键复制 + CSV 导出 + 模板行复制 + 文案修正 | — | ops | P0-2 |
| **P1-1** | 失败限流（429 + 退避） | engine | — | 无 |
| **P1-2** | scope 拆分（`admin:redeem:read/export/write`） | engine + ops 配置 | — | 无 |
| **P1-3** | 补审计：签发 / 作废 / grant 三类 | engine | — | 无 |
| **P2-1** | 批次统计接口 + 批次详情抽屉 | engine（新文件） | ops | P0-2 |
| **P2-2** | 桌面端「档位压制」第四态文案（**store 加透传字段 + 视图加分支，两层**） | — | desktop | 无 |
| **P2-3** | 兑换历史展示（订单页 channel=redeem） | — | desktop | 无 |
| **P2-4** | 批次临期提醒 | engine | ops | P2-1 |

### 8.1 建议的先后

1. **先 P0-1 / P0-2**（各半天到一天，风险低，运营和用户立刻受益）
2. **再 P0-3**（交付效率，运营签 200 个码的刚需）
3. **然后 P1-1 / P1-2 / P1-3**（安全，一次性做完，别拆三次上线）
4. **P2 按需**

### 8.2 与支付通道的衔接（不在本方案范围，但需对齐）

微信 Native 支付设计已定稿（`01-docs/PRD-WECHAT-PAY-INTEGRATION-2026-10-21.md`），编码未开始。
本方案**不碰支付**，但要保证：
- 支付成功 → **直接开通**（`subscription-payment.js:216` 现状如此），不发码
- 兑换码 → 只服务无即时支付通道的场景
- 两者共用 `applySubscription()`，**不复制**任何落账逻辑（`subscription-payment.js:159` 的注释已明确此纪律）

---

## 9. 验收判据

### 9.1 功能

| # | 判据 | 怎么测 |
|---|---|---|
| A1 | 桌面端输入合法码 → 开通对应档位与时长 | 端到端；`res.plan` / `periodEnd` 与码面一致 |
| A2 | 桌面端输入 `abcd-efgh-jkmn`（小写）→ 能兑换 | 服务端 `toUpperCase()`；前端自动大写 |
| A3 | 桌面端输入非法格式 → **不发请求**，就地提示 | 抓包确认无 `/api/v1/redeem` 请求 |
| A4 | 同一码二次提交（订阅仍有效）→ 不加时长，明确提示"此前已兑换" | 对比 `periodEnd` 不变 |
| A5 | 同一码由他人兑换后再提交 → 明确报"已被他人使用" | 409 → `redeemErrUsed` |
| A6 | 已兑换的码不可作废 → 409 | `REDEEM_CODE_ALREADY_USED` |
| A7 | 运营签发 1 个月标准版 10 个 → 10 个码可兑换，各得 30 天 | 逐个核销 |
| A8 | 运营签发 3 个月专业版 10 个 → 各得 90 天 | 同上 |
| A9 | pro 用户兑 standard 码 → 时长 +30 天，档位仍 pro | 检查 `downgradeSuppressed=true` |
| A10 | 运营签发 200 个 → 列表可查、CSV 可导出 | — |

### 9.2 安全

| # | 判据 | 怎么测 |
|---|---|---|
| S1 | 全仓 grep 桌面端**无**任何"码 → 权益"映射 | 否定式 grep 零命中 |
| S2 | 全仓 grep 无激活码私钥/种子 | 否定式 grep 零命中 |
| S3 | 同一用户 5 次失败兑换 → 第 6 次 429 | — |
| S4 | 只有 `admin:redeem:export` 能 reveal，其他 admin 不能 | — |
| S5 | 签发 / 作废 / grant 三类动作都进审计 | 查 audit log |
| S6 | `issued_to` 能定位泄漏批次 | — |
| S7 | 兑换码不出现在任何 URL query | grep + 抓包 |

### 9.3 门禁（照抄本仓既有要求）

- 桌面端：zh/en 文案成对（Gate 7）；`QG Desktop Shards` / `QG Coverage` 绿
- ops-center：`ops-center-ci.yml` 绿
- engine：`redeem-code-admin-routing.test.js` 需同步更新（新增端点时）
- 门禁清单类改动照抄 `01-docs/AUDIT-MEMBER-CENTER-IA-2026-10-19.md` 的命名锁与契约锁

---

## 10. 边界：明确不做的事

| 不做 | 理由 |
|---|---|
| 给激活码加"加密载荷" | §3。这是安全倒退 |
| 客户端内置验签私钥 | 可提取 = 可伪造 |
| 支付成功后自动发码 | 凭空多出库存/批次/发放/对账四层复杂度，收益为零 |
| 物理删除已兑换码 | 权益已发放，对不上账。现状只作废 ✅ |
| 新增批次统计表 | 用 `GROUP BY batch` 聚合即可，零迁移零清单同步（§6.4） |
| 改 `standard`/`pro` 的 id | 会污染既有契约、迁移、plan-matrix |
| 把「1 个月/3 个月」做成硬约束 | 现状允许 1-3650 任意天数，有运营需要（如 7 天体验码）⇒ **预设 + 自定义**并存，不是二选一 |
| 支付宝 | 仓内已定「支付宝未排期」（`roadmap-v1.1.0.md:33`） |
| 改 `MAX_BATCH` | ops 200 / engine 500 的差异是**主动收窄**，写进文档即可 |

---

## 11. 三个决策的定案结果（2026-10-24，运营方拍板）

| # | 决策 | **定案** | 理由与落地 |
|---|---|---|---|
| 1 | 档位显示名 | **沿用仓内命名**（标准版 / 专业版） | 同一产品内档位名必须唯一；「基础」在仓内已被 `modelTier: 0`「基础模型层级」占用且含义相反。渠道话术在营销物料里做映射表，不改产品内档位名。**落地**：运营中心前端加 `PLAN_LABELS` 显示映射，`plan` 的值仍是 `standard`/`pro`（服务端契约不变）。 |
| 2 | `issued_to`（发放对象） | **做** | 它回答「这批码发给了谁」——没有它，泄漏后运营只能靠记忆排查。**能力边界**：仓里只有单码吊销，**没有批量作废端点**；`issued_to` 也**不是列表筛选条件** ⇒ 处置靠 `batch` 过滤 + 逐个吊销（批量作废列入下一轮）。**落地**：迁移 `009_redeem_code_issued_to.sql`（+ 运行时 SCHEMA 数组逐字成对 + 防漂移锁）+ 仓储 INSERT/SELECT + 服务层透传与归一化 + 运营 API + ops 转发层 + 运营前端输入与列表列。 |
| 3 | 失败限流严格程度 | **先上温和档** | 同一用户 60 秒内失败 ≥ 5 次 / 同一 IP 10 分钟内失败 ≥ 30 次 ⇒ 429。只计「格式错 / 不存在」两类探测型失败；已用 / 停用 / 过期不计（那是正常业务）。命中时不透露剩余次数。**落地**：`redeem-rate-limit.js`（端点级 + 失败计数）+ `publish-api-redeem.js`（路由 + 限流门）。观察一周真实数据后再决定是否收紧或上共享存储。 |

### 本轮实施的三处「必须这么写」（踩过的坑，别再犯）

- **迁移编号用 009，刻意跳过 007 / 008**：008 已被在飞 PR #4322 占用，007 预留给尚未开 PR 的
  compute-key-envelope-migration change。编号机制（实测自 `postgres-migrations.js`）：台账按
  **完整文件名**记账，排序按文件名字母序 ⇒ 两个**同号不同名**的迁移不会撞台账，但**相对执行顺序
  会退化成字母序** ⇒ 有依赖关系时可能以错误顺序执行。真正让 identity 仓储**启动期硬失败**的是
  「同名文件被改」（checksum 不一致）与「文件已入库未执行」。⇒ 结论不变：**宁可跳号，不可撞号**。
- **加列要两处同改**（迁移 + 运行时 SCHEMA 数组）：SCHEMA 数组里那张表写的是
  `CREATE TABLE IF NOT EXISTS` ⇒ **对已存在的表是 no-op、不会加列** ⇒ 开发库永远缺列 ⇒
  只在开发环境复现的诡异差异。两处都用 `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`。
- **两个大文件走「抽模块」而非抬基线**：`subscription-service.js` 496 → 458 行、
  `publish-api-server.js` 1573 → 1565 行（后者在 `targets` 点名还账清单里，**零增长容差**）。


## 12. 本文事实基础与独立核查记录

**本文所有"现状"条目均为本轮逐行读源码核实**，不是从文档转述。
在此基础上做了**一轮独立核查**（派独立核查者对 10 条关键断言 + 1 项反向抽查逐条取证，
要求"读不到就写未找到证据、禁止猜"，否定类断言要求全仓否定式 grep 并说明排除项）。

**核查结论：10 条关键断言全部成立**，其中：
- 行号类断言（N1–N10）逐条命中，**无一处行号错误**
- 反向抽查发现并修正了本文初稿的 **2 处自身错误**：

| 初稿错处 | 修正后 |
|---|---|
| 断言"兑换失败**无任何速率限制**" | 仓里**有**全局 IP 级限流器（`rate-limiter.js`），但**默认关闭**（`maxRpm` 缺省 `null`）**且不区分端点与成败** ⇒ 对兑换场景基本无效，但"完全无限流"的说法是错的 |
| 新迁移编号写成 `005_*.sql` | `005_cloud_accounts.sql` / `006_payment_orders.sql` **已被占用** ⇒ 新迁移应为 `007_*.sql` |

**核查过程中额外发现的两条实施级细节**（已写入正文）：
1. `subscription-service.js` 当前 **496 行**，且不在挂账/点名清单里 ⇒ 受全局 `limit:500` 的
   `NEW_OVER_LIMIT` 约束，**只剩 4 行余量** ⇒ 任何新增方法必须开新文件（§6.1）
2. 给 `identity_redeem_codes` 加列要**四处同改**，其中运行时 SCHEMA 数组那一处最隐蔽
   （`CREATE TABLE IF NOT EXISTS` 对已存在的表是 no-op，**不会加列**）⇒ §6.4.2

---

## 附录 A：关键文件索引

| 关注点 | 文件 |
|---|---|
| 码生成 / 核销 / 签发 / 列表 / 吊销 | `packages/api-publish-engine/src/auth/subscription-service.js` |
| 仓储（行锁 / advisory lock / 续叠） | `packages/api-publish-engine/src/auth/postgres-commerce-store.js` |
| 运营路由 + 审计 | `packages/api-publish-engine/src/auth/publish-api-redeem-code-admin.js` |
| 端点与 scope 映射 | `packages/api-publish-engine/src/publish-api-server.js:463-469, 926-945, 1416-1431` |
| 档位矩阵（价格 / 配额 / rank） | `packages/api-publish-engine/src/auth/plan-matrix.js` |
| 支付回调（共用 applySubscription） | `packages/api-publish-engine/src/auth/subscription-payment.js` |
| 表结构 | `migrations/postgresql/004_member_commerce.sql:23-36` |
| 运营中心页面 | `ops-center/frontend/src/views/RedemptionCodes.vue` |
| 运营中心转发层 | `ops-center/backend/services/redeem_batch_service.py` |
| 桌面端兑换 UI | `apps/desktop/src/views/MemberCenter.vue:118-148, 218-295` |
| 桌面端 store / IPC 白名单 | `apps/desktop/src/stores/member.js:120-133`；`apps/desktop/electron/services/identity/member-api-service.js:25-27` |
| 桌面端文案 | `apps/desktop/src/locales/member-center/{zh,en}.js:10-21` |
| 运行时 SCHEMA 数组（加列必须同改） | `packages/api-publish-engine/src/auth/postgres-identity-repository.js:10-24, 104-116` |
| 限流器现状 | `packages/api-publish-engine/src/rate-limiter.js:13-27`；`publish-api-server.js:158, 777-780` |
| 行数门禁 | `.github/scripts/check-max-lines.js`；`.github/scripts/max-lines-baseline.json` |
| 本地激活删除记录 | `openspec/records/remove-dead-redemption-codes.md`；`01-docs/decision-log.md:419-437` |
| 会员中心 IA 审计（含 P1-8 本地校验缺口） | `01-docs/AUDIT-MEMBER-CENTER-IA-2026-10-19.md` |
| 档位机制深度分析 | `01-docs/MECHANISM-MEMBER-TIERS-DEEP-2026-10-19.md` |
| 支付 PRD（边界对齐用） | `01-docs/PRD-WECHAT-PAY-INTEGRATION-2026-10-21.md` |

## 附录 B：术语速查

| 本文档用语 | 含义 |
|---|---|
| 码面档位 | 码在库里记录的 `plan`（standard/pro） |
| 生效档位 | 用户**此刻实际持有**的档位（可能被压制保护） |
| 会员时长 | `duration_days`，兑换后获得的**天数**（30/90） |
| 码的截止使用日 | `expires_at`，码**本身**的过期时间（不兑换就作废） |
| 压制 | 低档码不覆盖高档权益，只加时长（`downgradeSuppressed`） |
| 续叠 | 新码的时长接在当前 `period_end` 之后（不是覆盖，不是重置） |
