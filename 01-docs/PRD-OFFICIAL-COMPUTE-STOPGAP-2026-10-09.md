# PRD：官方算力计费体系 —— 安全止血与多供应商混合供给（第一阶段）

> **版本**：v1.0（2026-10-09）
> **状态**：已实现（本 PR）＋ 规划中（第二阶段）
> **作者**：接管 Agent（承接 `01-docs/HANDOFF-OFFICIAL-COMPUTE-2026-10-09.md` 交接与 `01-docs/DEEP-ANALYSIS-CREDIT-PRICING-2026-10-08.md` 研究报告）
> **分支**：`official-compute-stopgap`
> **代码基线**：`Colinchiu007/mulpub` @ `8b3d3e91f`（main，2026-10-09）

---

## 1. 背景与问题定义

### 1.1 三份前序文档的结论链

1. **研究报告**（`DEEP-ANALYSIS-CREDIT-PRICING-2026-10-08.md`）：完成定价测算（v1.2：标准 ¥59/¥499、专业 ¥79/¥699，赠送 30/1600/2200 积分，年付 = 月付 × 12），列出 G1-G12 缺口与 Week-0 三项快赢。
2. **定价落地**（PR #3178）：定价矩阵已按 v1.2 写入 `plan-matrix.js` 并附契约测试——**研究报告 §6.4A 的改价工作不再需要**。
3. **交接文档**（`HANDOFF-OFFICIAL-COMPUTE-2026-10-09.md`）：确认「积分扣减引擎不存在、官方算力供给不存在、成本账恒为 0」三大事实；安全审计列出 S1-S7；推荐「方案 A：平台能力优先 + 安全止血」。

### 1.2 本 PR 解决的问题（方案 A 动作 3-6）

| # | 问题 | 严重度 | 现状证据（修复前） |
|---|---|---|---|
| **S1** | 任意字符串可获永久 Pro（本地激活路径） | 🔴 | `license-manager.js` `activate()` 只 `trim()` 即写 `type=pro + expiresAt=null`。IPC 层已在 #3085 对正式包拒收，但开发构建内该路径可达且方法本身无守卫 |
| **S2** | 权益门禁对非 Logto 身份静默放行 | 🔴 | `publish-api-server.js` `_assertEntitlementFeature`/`_consumeEntitlementFeature` 对 `api_key`/匿名返回 `true`/`null`——未来 compute 路由复用即零成本白嫖（评审 R7 判 CRITICAL） |
| **S4** | 成本账恒为 0 | 🟠 | `model-provider-manager.js` `_writeLog()` 不传 `tokens_in/tokens_out/cost/model` → `model_provider_logs` 四列恒 NULL → `usage-reporter` 聚合恒 0 → **无法回答「这个用户/模型花了多少钱」** |
| **S6** | 日志脱敏缺口 | 🟡 | 裸 `token`（无 `access_`/`refresh_` 前缀）、`sid`/`session`/`pwd` 漏网；无手机号正则 |

### 1.3 不做什么（明确出范围）

- **不动定价矩阵**：v1.2 已落地，无存量用户，零成本窗口期已用完。
- **不建积分扣减引擎**：依赖 K5（usage 列共享冲突）、K6（`used` 只增不减）、K7（无任务调度器）三个前置，属第二阶段独立立项。
- **不做服务端代调**：依赖 S3 加密死结拍板（推荐复用 AES-256-GCM 信封体系），用户已补充的关键运营需求（见 §4）将其纳入第二阶段设计输入。
- **不改 `payment-manager` 的本地订单流**：只把授权来源切到服务端格式对齐，订单生命周期不动。

---

## 2. 已实现：四项安全止血（本 PR 代码变更）

### 2.1 S1 — 激活码格式守卫

**变更**：`apps/desktop/electron/services/license-manager.js`

- 新增 `LICENSE_KEY_PATTERN`：`/^[A-HJ-NP-Z2-9]{4}-?[A-HJ-NP-Z2-9]{4}-?[A-HJ-NP-Z2-9]{4}$/`——与 `packages/api-publish-engine/src/auth/subscription-service.js` 的 `REDEEM_CODE_PATTERN`（4-4-4 段、字母表无易混淆 O/I/0/1）对齐，允许有/无连字符。
- `activate()` 在 trim 之后、写库之前校验格式；不匹配 → `log.warn` + 返回 `false`，**不写任何授权状态**。

**行为矩阵**：

| 输入 | 修复前 | 修复后 |
|---|---|---|
| `"a"` / `"随便什么字符串"` / `"!!!"` | ✅ 永久 Pro | ❌ 拒绝，状态保持 free |
| `"12345"`（12 位以内纯数字） | ✅ 永久 Pro | ❌ 拒绝 |
| `"ABCD-EFGH-JKMN"`（服务端格式） | ✅ | ✅（格式通过≠码有效，真实核销在服务端 `/api/v1/redeem`） |
| `"ABCD-EFGH-JKMN"` 且服务端已核销 | ✅ | ✅ 本地格式通过；**服务端核销状态以服务端为准** |
| 正式包（`app.isPackaged !== false`） | ❌ #3085 已拒 | ❌ 不变（IPC 层守卫仍在） |

**联动**：`payment-manager.js` `completePayment()` 原以 `'PAY-PRO-<uuid>'` 作为 key 调 `activate()`——UUID 不符合格式，现会返回 `false`。改为：订单状态照常流转为 `paid`，授权日志改为「deferred to server-side redemption」，不因激活失败回滚订单。

**边界与残留风险**：客户端校验本质可绕过（改一行代码）。本守卫封的是「手滑/瞎猜即可激活」的暴露面；根治（正式包一律服务端核销）已在 #3085 落地正式包路径，开发构建保留本地路径属调试需要。

### 2.2 S2 — Logto 专属 feature fail-closed

**变更**：`packages/api-publish-engine/src/publish-api-server.js`

- 新增模块常量：

```js
const LOGTO_ONLY_FEATURES = new Set(["cloud_publish"]);
```

- `_assertEntitlementFeature(req, feature)`：
  - `feature` 为空 → 放行（原语义，读接口无 feature 要求）。
  - **非 Logto 身份 + 属集内 feature → 抛 `ENTITLEMENT_IDENTITY_REQUIRED`（HTTP 403）**。
  - 非 Logto 身份 + 非属集 feature → 保持放行（API Key 老用户兼容）。
  - Logto 身份 → 走原有 entitlement provider 校验。
- `_consumeEntitlementFeature(req, feature, amount)`：同向 fail-closed——属集内 feature 对非 Logto 身份抛同款 403；原实现对 `plan/execute` 的调用点返回 `null` 被当成功继续执行，等于免费。

**为何是集合而非全局收紧**：`cloud_publish` 是目前唯一「订阅权益」语义的 feature；API Key 的既有 scope 治理（`_authorizeApiKeyScheduledOwner` 等）是另一条合法路径。全局收紧会打破 legacy api_key 发布链路（集成回归已覆盖：`legacy api_key 发布链路语义未变`）。

**新增 feature 登记纪律**：未来任何消费型 feature（如 `official_credit`、compute 类）必须加入 `LOGTO_ONLY_FEATURES`，否则会继承「非 Logto 静默放行」旧语义。

### 2.3 S4 — 成本观测管道接通

**变更**：`apps/desktop/electron/services/model-provider-manager.js`

`_writeLog()` 增加第 6 参 `context`（成功路径传入 `{ params, result }`），从中提取：

| 字段 | 来源 | 落库行为 |
|---|---|---|
| `model` | `params.model`（请求侧） | 字符串直接落；无则 NULL |
| `tokens_in` | `result.usage.prompt_tokens \|\| result.usage.input_tokens` | 四舍五入取整；无则 NULL |
| `tokens_out` | `result.usage.completion_tokens \|\| result.usage.output_tokens` | 同上 |
| `cost` | `result.cost`（仅当响应自带，官方代理场景） | 数值直落；BYOK 直连场景**留 NULL，不做本地估算** |

**设计决策**：cost 不在客户端按单价表估算。理由：① 桌面端无 `cost_per_1k_tokens` 数据源（单价属运营敏感信息，不下发）；② 伪数据比无数据更危险——对账层会把估算值当真实值。真实成本归集的落地路径是第二阶段的 `ModelPriceCard` + 服务端账单回填（研究报告 §4.1），本次只保证 **usage 原料从今天开始积累**。

**下游受益**：`usage-reporter.js` 的聚合（`tokens_in/tokens_out/cost` 求和）从「恒 0」变为「有数据」；`ops-center` 的 `model_usage_daily` 上报开始携带真实 token 数。

**兼容性**：错误路径的 `_writeLog` 调用不传 context（无响应可解析）；store 无 `addProviderLog` 或抛错时静默跳过（原语义不变，测试覆盖）。

### 2.4 S6 — 日志脱敏补正（双端对齐）

**变更**：`apps/desktop/electron/services/logger.js`（桌面端）+ `packages/api-publish-engine/src/log-redact.js`（引擎侧），两份 SECRET_PATTERNS 同步补：

1. 键值对集合扩展：`token`（裸键）、`sid`、`session`、`pwd` 加入 quoted 与 unquoted 两组正则。
2. 新增中国大陆手机号正则：`/\b(?:1[3-9]\d)\d{8}\b/g` → `***`。

**为什么双端都要改**：桌面端 logger 是终端日志真源；引擎侧 `log-redact` 被 `publish-api-server` 的访问日志/错误日志使用。两端口径历史上就是对齐维护的（桌面端注释明写「对齐 api-publish-engine log-redact」），单改一端会让同一敏感值在一端打码、另一端落盘原文。

**误伤评估**：`token` 裸键在日志中几乎总是凭证语境（`token=xxx`）；`session`/`sid` 同理。手机号正则仅命中 13x-19x 完整 11 位且带词边界，长数字串（如时间戳毫秒值 13 位）不被命中。

---

## 3. 测试与验证

### 3.1 新增/修改的回归测试（TDD：先 RED 后 GREEN）

| 测试文件 | 新增用例 | 覆盖 |
|---|---|---|
| `apps/desktop/tests/license-manager.test.js` | 「activate rejects arbitrary garbage strings」「activate accepts service-issued redemption code format」 | S1 正/负用例；存量用例 key 换为服务端格式（测试意图不变） |
| `apps/desktop/tests/payment-manager.test.js` | 「completePayment uses service-format license key (S1 联动)」 | 订单流转不因激活格式拒绝而失败 |
| `apps/desktop/tests/license-manager-bak.test.js` | key 换为合法格式 | 备份恢复链路不受影响 |
| `apps/desktop/electron/services/model-provider-call-adapter.test.js` | 「S4：adapter 返回 usage 时透传」「S4：无 usage 时保持 NULL」「S4：模型名进入日志」 | S4 三态 |
| `apps/desktop/electron/services/logger.test.js` | 「裸 token/sid/session/pwd 键与手机号不落盘原文」 | S6 桌面端 |
| `packages/api-publish-engine/test/log-redact.test.js` | 「redacts bare token」「redacts sid/session/pwd」「redacts CN mobile」 | S6 引擎侧 |
| `packages/api-publish-engine/test/publish-api-entitlement-guard.test.js`（新建） | 门禁契约 7 断言 + 集成回归 1 断言 | S2 全态（Logto 放行 / api_key 403 / 匿名 403 / 非 Logto feature 兼容 / legacy 链路不变） |

### 3.2 本地验证结果

- 桌面侧相关文件：`license-manager` ×3、`payment-manager`、`license IPC` ×2、`model-provider-call-adapter`、`logger`、`usage-reporter`、`model-provider-manager` 关联文件 **全绿**。
- 引擎侧：`log-redact` 13/13、`publish-api-entitlement-guard` 全过 + 全量 `run-tests.js`（见 PR 执行记录）。
- QM-1 打包验证：因本次改动涉及 `apps/desktop/electron/`，PR 执行记录附 electron-builder 产物验证（见 `openspec/records/official-compute-stopgap.md`）。

---

## 4. 第二阶段规划：运营中心多供应商套餐混合供给（用户补充需求的产品化）

> **需求原话**：「将来产品上线运营的时候，给其他用户使用的官方内置模型，应该在运营中心中设置，我可能会购买多个模型供应商的套餐，然后混合在一起给用户提供。」
>
> 本节将该需求展开为可评审的产品/技术方案骨架，作为第二阶段（官方算力供给链路）的 PRD 输入。**本 PR 不实现本节功能。**

### 4.1 角色与核心概念

| 概念 | 定义 | 存储 |
|---|---|---|
| **供应商套餐（Provider Plan）** | 运营方向某供应商采购的一份额度合同：如「可灵 ¥3000 套餐、含 2000 秒 720P」。有总额度、已用量、有效期、单价口径 | ops-center 新表 `provider_plans` |
| **供给池（Supply Pool）** | 同一质量档背后的一组可调度套餐集合，如「影视档池 = 可灵套餐A + 智谱套餐B + 聚合API」 | ops-center 新表 `supply_pools` + `pool_members` |
| **调度策略（Routing Policy）** | 从池中挑套餐的规则：优先级 / 加权轮询 / 成本最低优先 / 剩余额度比例 | `supply_pools.routing_policy` |
| **质量档（Tier）** | 用户侧唯一可见概念（standard / hd / cinema），沿用研究报告 §4.4「用户只选质量档，不选模型」 | 已有设计，沿用 |
| **熔断开关（Kill Switch）** | 运营中心 P0 能力：一键把某套餐/供应商摘出所有池，流量自动落到池内其他成员 | 复用 `OfficialKey.is_active` + 新增池级摘除 |

**与研究报告的衔接**：研究报告 §3.4 的「套餐成本摊销（保底期/接近耗尽/濒危/耗尽四段）」落在 `provider_plans` 的剩余比例字段上；§八 P0-1「模型熔断开关」即本设计的 Kill Switch；§八 P1-8「套餐/聚合 API 切换」即池内成员的 `enabled` 位。

### 4.2 运营中心功能清单（第二阶段 Phase 1）

**F1 套餐管理页**
- 字段：供应商、采购渠道、套餐类型（订阅制/按量，并细分 coding plan / API 套餐 / 会员制——决定能否商用）、总额度（按计量单位：tokens / 张 / 秒 / 次 / 字符）、**已用量（自动累计，与总额度是两个独立字段，禁止混填）**、**计量口径**（额度按什么扣：是否含缓存读/写、缓存读是否打折）、有效期、等效单价（套餐总价 ÷ 总额度，月内固定）、采购折扣系数（研究报告 §3.3 的防亏参数）、**速率限制（并发 / RPM / TPM / 每 N 小时次数）**、状态（active/exhausted/expired/reference_only）。
- **两种计费形状必须分别落库**（2026-10-11 依运营方上游实况补充——上游既有订阅套餐，也有按量付费中转站）：
  - **订阅套餐型**（例：可灵 ¥3000 套餐包 2000 秒）：实付金额（注明含税/未税）、套餐总额度、计量单位、计量口径、有效期起止、已用量、折扣来源（年付/预付/销售议价）、是否续费。
  - **按量付费型（中转站）**：账户余额、按模型的单价表（输入/输出 每百万 tokens，或按次/按秒）、**倍率**（中转站常见「官方价 × N」口径）、结算币种与汇率口径（若以 USD 结算）、近 30 天实付与用量（用于**校验报价是否兑现**——中转站标称单价与实际扣费常有出入）。
  - 两者**等效单价算法不同**：套餐＝实付金额 ÷ 套餐总额度；按量＝周期实付金额 ÷ 周期实际用量。`provider_plans` 需同时容纳，或拆两张表（见 §4.4-6）。
- **供给资格（eligibility）三判据**（2026-10-11 新增，来自首条样本实测——一份「个人自用 coding plan」被当作候选供给源，三条全不满足，详见 `01-docs/HANDOFF-UPSTREAM-BILLING-INTAKE-2026-10-11.md` §8.3）：只有三条同时成立才能进供给池——① **条款允许商用/供给**（自用、coding plan 通常禁止转售或供第三方）；② **有可观测且够用的速率上限**（大额度 + 紧速率的套餐，瓶颈在速率，买更多额度解决不了）；③ **有效期覆盖运营期**。任一不满足 ⇒ 状态置 `reference_only`，**只能计入成本测算的参考单价，不得进池**；页面须显示逐条判据结果与未通过原因。
- 校验：总额度 > 0；**「总额度」若与导入的用量合计吻合则判可疑并要求复核**（额度与已用量几乎不可能相等；首条样本即把已用量当额度填报，会让单价低估一到几个数量级，见交接口径文档 §2.4-1 与 §8.1）；有效期不可与同供应商同类型套餐完全重叠（防重复计价）；折扣系数 ∈ (0, 1]；**按量型账户余额 ≤ 0 必须在页面上红标**（否则线上会静默失败）；**套餐到期前 7 天告警 + 到期自动摘出全部供给池**（防线上静默失败）。
- **计量口径缺失即不得参与定价比较**（2026-10-11 新增）：实测同一数字在「含缓存读 / 仅输入输出 / 缓存读按 10% 折算」三种口径下的单价可差约 40 倍（样本缓存读占 97.5%，输入 : 缓存读 ≈ 1 : 40.8）。
- 数据校验失败提示逐字段给出（例：「有效期与『可灵 2026Q4 按量套餐』重叠，请先停用旧套餐」）。

**F2 供给池配置页**
- 每个质量档一个池；池成员 = 套餐 × 权重 × 优先级 × 启用位。
- 池规则显示：调度策略（下拉：priority / weighted / cheapest_first / proportional）、耗尽行为（fallback 到聚合 API / 拒绝并提示）、熔断联动（供应商级熔断自动摘除其全部成员）。
- 交互逻辑：拖拽排序即优先级；权重滑杆 1-100；改动即时生效但需二次确认（影响线上调度）。

**F3 熔断与告警**
- 一键摘除：供应商级 / 套餐级两级；摘除后 ≤1s 内全网生效（交接文档 B-Phase2 交付定义⑤）。
- 告警三线：套餐剩余 <20%（研究报告「濒危」段）→ 运营通知；单套餐日消耗异常（偏离 7 日均值 ±3σ）→ 运营通知；池内全部成员不可用 → 自动 fallback 聚合 API + 熔断降级提示用户。

### 4.3 调度与扣费逻辑（桌面端 ↔ 服务端分工）

```
用户在桌面端选质量档 + 规格
  → 桌面端展示「本次预计消耗 N 积分」（按档位等效单价 × 规格，研究报告 §9.2）
  → 服务端接收（必须 Logto 身份，S2 门禁已就位）
  → 服务端按质量档查供给池 → 按策略选套餐 → 检查套餐剩余额度
      ├─ 足够：按研究报告 §3.4 摊销口径预扣（reserve）
      ├─ 不足：池内下一成员；全部不足 → 聚合 API 按 §3.4「耗尽」段实时价
      └─ 熔断成员直接跳过
  → 调上游 → 成功：按实际用量结算（settle）；失败：全额退（refund）
  → 写 generation_requests 台账（研究报告 §4.2），expected vs actual 差异 >15% 进对账报表
```

**扣费与展示原则**（全部沿用研究报告既有决策，此处汇总为第二阶段约束）：

| 约束 | 来源 |
|---|---|
| 降级必须同向降扣费 + 正向话术「省钱模式」 | 研究报告 §4.4 / §9.4 |
| 失败/超时不扣积分（判据 = 上游是否返回有效产出） | 研究报告 §3.3 |
| 会员额度日释放 + 月清零，充值积分永久有效且后扣 | 研究报告 §5.1 |
| 会员额度耗尽不硬阻断，BYOK 与平台能力保留 | 研究报告 §9.3 |
| reserve/outstanding 双守卫在单事务内（`pg_advisory_xact_lock` 先例） | 交接文档 B-Phase2 ② |

### 4.4 第二阶段前置条件（开工前必须全部满足）

1. ~~S3 加密拍板~~ → **✅ 已拍板（2026-10-11）：走选项 2**。迁移重加密进已有的 AES-256-GCM 信封体系（复用 `cloud-accounts/envelope-crypto.js`，不引新依赖）。**剩余待办**：`OPS_ENCRYPTION_KEY` → 信封主密钥的迁移脚本 + 存量 Key 重加密 + 两端互操作测试（Node 必须能解开 Python 写的密文）。
2. ~~近 30 天上游账单~~ → **🔄 进行中（2026-10-11：运营方确认可导出）**。上游为**多供应商 + 混合计费**（订阅套餐 + 按量付费中转站），数据将全量提供或提供只读接口由接手方自行拉取；交接口径见 `01-docs/HANDOFF-UPSTREAM-BILLING-INTAKE-2026-10-11.md`。
3. **迁移编号核对**：`migrations/postgresql/` 现占用 002-005，新表迁移从 006 起必须先查台账锁 checksum（交接文档 K4）。
4. **任务宿主**：全仓无 cron/APScheduler；套餐用量日聚合、对账、超时回收都需要先解决任务宿主（交接文档 K7）。
5. **退款路径**：`identity_entitlement_usage.used` 只增不减（K6），预扣-结算-退款模型必须先建出减回通道且不撞 `CHECK (used >= 0)`。
6. **计费口径归一化**（2026-10-11 新增，因上游为混合计费）：订阅套餐是「总额度 + 有效期」，按量中转站是「余额 + 单价表（常含倍率）」——`provider_plans` 必须同时容纳两种形状，或拆成「套餐台账」与「按量价目表」两张表；等效单价算法也不同（套餐＝实付 ÷ 总额度；按量＝周期实付 ÷ 周期实际用量）。**这一条在做表结构设计前必须先定**否则迁移返工。

### 4.5 用户可见行为（第二阶段 UI 契约，供后续设计评审）

- 会员中心「我的算力」卡：剩余积分、本月剩余天数、「约可生成」四行换算（研究报告 §9.1 的版式与浮动说明）。
- 生成前确认弹窗：质量档下拉（standard/hd/cinema，pro 档位对 standard 用户禁用并显示升级引导）、「背后模型：运营方配置中（不展示具体模型名）」、本次消耗、剩余额度、自动切换勾选框（研究报告 §9.2）。
- 三段式预警：80% 站内提示 / 50% 弹窗+加购 / 10% 强提示+加购+BYOK 入口；耗尽不阻断平台能力。
- 全部新增用户可见文案进 `apps/desktop/src/locales/zh.js` 与 `en.js` 成对（CI Gate 7 强制）。

---

## 5. 交付定义对照（本 PR 完成度）

| 交接文档验收项 | 状态 |
|---|---|
| 方案 A-①：站内无无法兑现的积分承诺 | ✅（定价页文案已在 #3178 校正为「体验额度」口径；本 PR 不新增承诺） |
| 方案 A-③：S1 已修并有回归测试 | ✅（格式守卫 + 7 个正/负用例） |
| 方案 A-④：S2 已修并有回归测试 | ✅（fail-closed + 门禁契约测试） |
| 方案 A-⑤：S4 已修并有回归测试 | ✅（管道接通 + 3 用例；cost 真值依赖第二阶段单价卡，已明示） |
| 方案 A-⑥：S6 已修并有回归测试 | ✅（双端对齐 + 用例） |
| 用户补充需求（多供应商混合供给） | 📋 已产品化为 §4 设计骨架，列入第二阶段 |

## 6. 风险与开放问题

| # | 风险/问题 | 处置 |
|---|---|---|
| 1 | S1 客户端守卫可被绕过（本质限制） | 已在文档明示；正式包路径由 #3085 服务端核销承担 |
| 2 | S4 的 cost 列短期内仍为 NULL（BYOK 场景无单价源） | 接受；token 数先行积累，避免伪数据；第二阶段 ModelPriceCard 接管 |
| 3 | S2 的 `LOGTO_ONLY_FEATURES` 靠人工登记 | 已写入本 PRD §2.2 纪律；建议第二阶段给 plan-matrix 新 feature 加 CI 提醒 |
| 4 | 多供应商套餐的「套餐并发上限」（研究报告 §7.4 重度包限速）依赖速率治理 | 第二阶段设计时与 `rate-limiter`/`api-usage-governor` 统一口径，避免第二套限速 |
| 5 | 本 PR 未建 OpenSpec change | 按「S 复杂度且低风险直接质量节拍」口径执行（四项独立小修复，无跨模块数据变更）；第二阶段 M+ 复杂度必须走 `/opsx:propose` |
