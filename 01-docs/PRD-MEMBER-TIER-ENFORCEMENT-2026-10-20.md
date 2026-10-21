# PRD｜会员档位「硬门禁」落地（member-tier-enforce，2026-10-20）

> 上游依据：`01-docs/PRD-MEMBER-TIER-MECHANISM-2026-10-20.md`（机制与契约）与
> `01-docs/MECHANISM-MEMBER-TIERS-DEEP-2026-10-19.md`（额度设计）。
> 本文只覆盖该 PRD §12「明确不做」里**本批要转正**的条目，其余仍留在 §12。
>
> 一句话：**把「档位上限」从客户端的提示变成服务端的拒绝。**

---

## 1. 为什么必须做（问题不是「有没有提示」，而是「拦不拦得住」）

上一批（PR #4051）把 `limits` 打通到客户端，发布页会拦「第 6 个平台」。但那条拦截是
**UI 分支**，它有三个绕不过去的结构性缺口：

| # | 绕过路径 | 现状 | 后果 |
|---|---|---|---|
| B1 | 直接调 `POST /api/v1/publish` | 服务端只校验 `cloud_publish` 这个 feature | 免费档可以发布 20 个平台。平台字段是数组，一次请求带 N 个就算 N 次消耗，但**没有任何上限判据** |
| B2 | 直接调 `POST /api/v1/batch-publish` | 同上，仅按数量扣额度 | 免费档 `batch_size_per_run = 1`，但一条批量请求可以打 10 个平台 |
| B3 | 走 `POST /api/v1/schedule`（定时） | 授权契约与即时入口「对称」是既有**文字约定**，两侧都只校验 `cloud_publish` | 定时通道是完全独立的一条授权链，任何「只在即时侧加」的判据都会在这里漏掉 |

这三条不是猜测：B2/B3 的代码位置在 `publish-api-server.js` 的 `_authorizeImmediateEntry`
与 `_authorizeScheduledEntry`，两处都只做 `assert + consume cloud_publish`。

### 1.1 与「额度」的区别（不要混为一谈）

- **额度（quota）**：`cloud_publish_monthly = 150/800/2200`，按次扣减，**已经**由
  `consumeFeature` 保证。
- **上限（limits）**：`max_platforms` / `batch_size_per_run` / `max_cloud_accounts` /
  `max_devices`，是**形态约束**（一次能用几个平台/几条批量/几个账号/几台设备），
  与「一共能用多少次」正交。

本批要补的是后者。它不能被额度替代：免费档 150 次额度完全够用，但「一次打 10 个平台」
仍然越过了档位。

---

## 2. 范围

### 2.1 本批做（In）

| 编号 | 内容 | 判据位置 |
|---|---|---|
| E1 | 平台数上限：即时发布 / 批量发布 / 定时发布三条入口 | `_assertPlanCapabilities`（新增） |
| E2 | 单次批量条数上限：同上三条入口 | 同上 |
| E3 | 判据本体做成**纯函数**，客户端与服务端口径可对账 | `auth/plan-capabilities.js`（新增） |
| E4 | 客户端离线/快照路径的宽限判活（上游 PRD N10） | `electron/services/identity/entitlement-service.js` |

### 2.2 本批不做（Out，仍留在上游 PRD §12）

| 编号 | 内容 | 为什么不在本批 |
|---|---|---|
| N1 | 设备数上限（`max_devices`）落地 | 需要在会话签发链路里读权益并计数；与登录/设备管理同批做才不割裂 |
| N2 | 云账号配额（`max_cloud_accounts`）落地 | 需要把 entitlement 注入云账号 handler 的 context（跨模块接线），单独一批 |
| N9 | `grant` 幂等 | 需要新的去重键与审计列 |
| N4 | 会员中心到期横幅 UI | 属于展示层，与「硬门禁」正交 |
| N5/N6 | 日发提交前校验 / proration | 数据源未就绪 / 未接通支付 |

---

## 3. 数据契约（判据吃的是什么）

判据输入是**权益快照 payload**（即 `PostgresEntitlementProvider.getForUser` 的返回值），
只读 `payload.limits` 这一段：

```jsonc
{
  "plan": "free",
  "features": ["cloud_publish"],
  "quota": { "cloud_publish_monthly": 150 },
  "limits": {
    "max_platforms": 5,          // -1 = 不限
    "batch_size_per_run": 1,
    "max_cloud_accounts": 0,     // 0 = 本档不提供（不是不限）
    "max_devices": 2,
    "plan_rank": 0,              // 不参与数量判定
    "model_tier": 0              // 不参与数量判定
  }
}
```

### 3.1 逐字段校验（三条纪律，与客户端 `plan-limits.js` 同源）

| 情形 | 判定 | 理由 |
|---|---|---|
| `limits` 缺失 / `null` / 数组 / 非对象 | **不拦** | 旧快照没有这段；按 0 处理会把全体存量用户挡在门外 |
| 键缺失 / `null` / `''` / `NaN` / 非数字 | **不拦**（该键视为无信息） | 同上；`Number('') === 0` 是反方向的静默故障，必须显式排除 |
| 数字字符串 `'3'` | 按 3 判 | 兼容 JSON 序列化与环境变量来源 |
| `-1` | 不限 | 与 `plan-matrix.js` 的 `UNLIMITED_ALLOWED` 同语义 |
| `0` | **上限为 0**（第 1 个就拒） | 云账号 `0` 表示「本档不提供」，不是「不限」 |
| 值 `> 0` | 边界值放行（`count > limit` 才拒） | 免费档 5 个平台 ⇒ 第 5 个允许、第 6 个拒绝 |

### 3.2 判定顺序（同一次请求多处越界时报哪条）

固定顺序：**平台数 → 单次批量 → 云账号 → 设备**。
理由：用户动作的「最外层」先报。一次批量打 10 个平台时，`PLATFORM_LIMIT_EXCEEDED`
比 `BATCH_SIZE_EXCEEDED` 更接近用户正在做的事。

### 3.3 响应契约

| 违约码 | HTTP | 附带字段 |
|---|---|---|
| `PLATFORM_LIMIT_EXCEEDED` | 402 | `limit`、`requested` |
| `BATCH_SIZE_EXCEEDED` | 402 | 同上 |
| `CLOUD_ACCOUNT_LIMIT_EXCEEDED` | 402 | 同上 |
| `DEVICE_LIMIT_EXCEEDED` | 403 | 同上 |

402（需要付费）而不是 403（无权限）：这是**可购买的边界**，不是身份问题。
错误体沿用既有形状 `{ error: <code> }`，与 `ENTITLEMENT_QUOTA_EXHAUSTED` 一致，
客户端按 `error` 字段分支即可。

---

## 4. 流程（三条入口，同一判据）

### 4.1 即时发布 `POST /api/v1/publish`

```
解析 body → platform = body.platform
  → _authorizeImmediateEntry(req, 1)           # 既有：feature + 额度
  → _assertPlanCapabilities(req, { platforms: [platform] })   # 新增
      ├─ provider 未配置 → 放行（自建部署零改动）
      ├─ businessUser 缺失 → 放行
      ├─ getForUser → payload
      └─ checkPlanCapability(payload, { platforms: 1 })
            └─ 越界 → throw capabilityError → 402 + { error }
  → 发布
```

### 4.2 批量发布 `POST /api/v1/batch-publish`

与 4.1 同一位置，判据从 `{ platforms: [platform] }` 换成
`{ platforms, batchSize: platforms.length }`。

### 4.3 定时发布（`schedule` / 定时执行器入口）

`_authorizeScheduledEntry(entry)` 在 `consumeFeature` **之前**插入同一判据，
用 `entry.platforms`（数组）与 `entry.platforms.length`。

> **对称性契约**：`_authorizeScheduledEntry` 与 `_authorizeImmediateEntry` 必须保持
> 同一组校验。文件里已有这条注释；本批把「数量上限」也纳入这条契约，
> 改一侧必须同步另一侧。

### 4.4 客户端宽限判活（E4）

```
sync() 在线路径   → normalizeEntitlement(body.entitlement) → applyGraceWindow(now)
restore() 宽限路径 → normalizeEntitlement(snapshot)        → applyGraceWindow(now)
离线缓存路径      → normalizeEntitlement(snapshot)        → applyGraceWindow(now)
```

`applyGraceWindow` 规则：

| 情形 | 处理 |
|---|---|
| 无 `graceUntil` | 原样返回 |
| `graceUntil` 可解析且 > now | 原样保留 |
| `graceUntil` 可解析且 ≤ now | 删除 `graceUntil` 与 `previousPlan` |
| `graceUntil` 不可解析 | 删除两者（fail closed 到「不显示宽限」） |

**为什么不能只靠服务端**：服务端只在 `/me` 与 provider 读取端投影；断网期间客户端
用的是本地缓存快照，那条路径不经过服务端。

---

## 5. 功能逻辑

### 5.1 判据是纯函数

`checkPlanCapability(entitlement, request)` → `null | violation`。
不读时钟、不读数据库、不抛异常（调用方决定怎么处理）。这样它能在
客户端/服务端/测试三处复用，也便于把「三条纪律」写成表驱动用例。

### 5.2 为什么 `_assertPlanCapabilities` 在 provider 缺失时放行

服务端有一批**未接入会员体系**的部署形态（自建/本地调试/`dryRun`）。
在这些形态下 `_entitlementProvider` 为 `null`，若判据按「没有权益 ⇒ 拒」处理，
会把所有自建部署打成 402，属于**把可选能力做成硬依赖**。故：

- provider 未配置 ⇒ 放行（与 `_authorizeImmediateEntry` 里 `!this._logtoVerifier` 的处理同型）；
- provider 配置了但快照没有 `limits` ⇒ 放行（旧快照）。

这两条都不是「为了绿而放宽」：它们各自对应一个**明确的产品形态**，
且都有单测锁（`缺失即放行` 用例覆盖了 11 种形态）。

### 5.3 与既有 `consumeFeature` 的关系

顺序是**先判上限、再扣额度**：上限拒绝的请求**不消耗**用户额度
（否则「被拒一次还扣一次」会被用户当作扣费 bug）。定时入口里
`_assertPlanCapabilitiesForContext` 明确排在 `_consumeEntitlementFeature` 之前。

---

## 6. 交互与提示

本批**不改 UI**。服务端返回的新错误码需要客户端能读懂，因此：

### 6.1 客户端提示（本批只落文案映射，不改页面结构）

| 错误码 | 提示文案（zh） | 提示文案（en） |
|---|---|---|
| `PLATFORM_LIMIT_EXCEEDED` | 当前档位单次最多 {limit} 个平台，升级后可继续添加 | Your plan allows up to {limit} platforms per publish. Upgrade to add more. |
| `BATCH_SIZE_EXCEEDED` | 当前档位单次最多批量 {limit} 条，升级后可提高上限 | Your plan allows up to {limit} items per batch. Upgrade to raise the limit. |
| `CLOUD_ACCOUNT_LIMIT_EXCEEDED` | 当前档位不提供云端账号同步，升级后可绑定 {limit} 个 | Cloud account sync isn't included in your plan. Upgrade to bind up to {limit}. |
| `DEVICE_LIMIT_EXCEEDED` | 当前档位最多同时在 {limit} 台设备上登录 | Your plan allows up to {limit} devices. |

> 文案落点：`apps/desktop/src/locales/publish-page/{zh,en}.js`（与既有
> `platformLimitReached` 同一命名空间），zh/en **成对**提交（CI Gate 7）。

### 6.2 本批不做的界面项

- 会员中心「到期宽限中」横幅（N4）：需要设计稿与视觉基线，另批。
- 超限时的「一键升级」跳转：依赖定价页路由，另批。

---

## 7. 显示项（D 表）

| # | 位置 | 显示内容 | 数据来源 | 空态/异常态 |
|---|---|---|---|---|
| D1 | 发布页平台选择器 | 触顶时的 `notifyWarning` 文案 | 本地 `limits`（既有） | `limits` 缺失 ⇒ 不显示、不拦截 |
| D2 | 发布页提交失败 toast | 服务端 `error` 码 → 6.1 文案 | 响应体 | 未知码 ⇒ 通用「发布失败，请重试」 |
| D3 | 会员中心（本批不改） | — | — | — |

---

## 8. 兼容与迁移

| 场景 | 行为 |
|---|---|
| 旧快照（无 `limits`） | 放行；用户升级/续期后快照刷新自然生效 |
| 自建部署（无 provider） | 放行 |
| 存量已超限用户（例如免费档已选 7 个平台） | **不回溯拦截已选**；只在「再次提交」时按上限拒绝，提示改为减少平台 |
| 定时队列里已排队的超限任务 | 执行时按当时权益判；越界则失败并落 `PLATFORM_LIMIT_EXCEEDED`（不静默丢弃） |

> 「不回溯」是刻意的：降级瞬间把用户已选平台裁掉会造成数据丢失感，
> 且当前没有「自动裁剪」的产品共识。裁剪属 N7 后半条，仍在 §12。

---

## 9. 验收标准

| # | 判据 | 证据 |
|---|---|---|
| A1 | 免费档发 6 个平台 ⇒ 402 `PLATFORM_LIMIT_EXCEEDED` | `plan-capabilities.test.js`（边界 5 通过 / 6 拒） |
| A2 | 免费档批量 2 条 ⇒ 402 `BATCH_SIZE_EXCEEDED` | 同上 |
| A3 | `-1` 档位任意数量放行 | 同上（pro 四键 999999） |
| A4 | `limits` 缺失/空串/NaN/数组/`null` 一律放行 | 同上（11 种形态表驱动） |
| A5 | 判定顺序固定 | 同上 |
| A6 | 三条入口都接了判据（缺一条即红） | 接线锁（读源码断言调用点数量与位置） |
| A7 | 过期 `graceUntil` 在客户端被剔除 | `entitlement-service.test.js`（过期/不可解析/仍有效三态） |
| A8 | 服务端全量测试不回归 | `npm test` rc=0 |
| A9 | 打包产物可启动 | QM-1（`electron-builder` + 启动验证） |

---

## 10. 风险与回滚

| 风险 | 缓解 |
|---|---|
| 判据把正常用户挡住 | 「缺失即放行」+ 11 形态单测；上线先观察 402 计数 |
| 两处入口判据不同步 | 接线锁 + 文件内对称性注释 |
| 402 语义被客户端当成「无法恢复」 | 文案明确「升级后可继续」；且**不扣额度** |
| 误把 `0` 当不限 | 单测显式锁定「0 ⇒ 第 1 个就拒」 |

**回滚**：删掉三处 `_assertPlanCapabilities` 调用即回到旧行为（模块本身无副作用）。
客户端 `applyGraceWindow` 三个调用点同删即回到「永久显示宽限」。

---

## 11. 遗留（本批结束后的真实状态）

- `max_devices` / `max_cloud_accounts` 的**执行点**仍未接线（判据已具备，缺调用方）。
- `grant` 幂等（N9）、到期横幅（N4）、日发提交前校验（N5）仍未做。
- 本批**不**改变任何价格、配额数值或 features 集合。
