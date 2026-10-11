# 交接文档：官方内置算力体系 —— 现状评估、安全审计与落地方案

> **读者**：接手实现与落地的 Agent（人或 AI）
> **基线**：`Colinchiu007/mulpub` @ `1016cd7`（main，2026-10-09）
> **配套文档**：
> - `01-docs/DEEP-ANALYSIS-CREDIT-PRICING-2026-10-08.md`（定价研究报告，已入库）
> - `openspec/changes/official-compute-credit-engine/REVIEW-CONCLUSION.md`（两轮对抗评审结案，**分支未合入 main**）
>
> **本文件所有行号已在 `1016cd7` 复验。** 若基线前进，先 `git fetch` 并重跑文末「§7 复核清单」再动手。

---

## 1. 一页纸结论

**要落地的确实是一套「平台官方内置模型系统」——它包含三件事：官方 Key 池、用户可选的算力供给、积分扣减。**

但**这三件事的依赖顺序和直觉相反**，而且当前卡在一个架构死结上：

| | 现状 |
|---|---|
| 会员定价与赠送量 | ✅ **已落地**（`plan-matrix.js`，`PLAN_MATRIX_VERSION=2026-10-08`） |
| 积分扣减引擎 | ❌ 不存在。`official_credit` 有字段无引擎，从未被扣减 |
| 官方算力供给 | ❌ **不存在**。官方 Key 池在后台，客户端拿不到；服务端不代理模型调用 |
| 成本可观测 | ❌ 恒为 0。`_writeLog` 不传 tokens/cost，全链路成本账为 0 |

**结论：定价先行、供给缺位。当前「送 1600 积分」是对用户的空头承诺，必须处理。**

**推荐路径见 §5：先按「平台能力 + BYOK 便利」定位会员，积分暂不对外承诺；官方算力作为独立立项分两期推进。**

---

## 2. 已完成，不要重做

| # | 成果 | 位置 | PR |
|---|---|---|---|
| 1 | 定价定案落地：标准版正价 ¥59 / 年付 ¥499；专业版 ¥79 / ¥699；免费版 30 体验额度 | `packages/api-publish-engine/src/auth/plan-matrix.js:21,37,52,67` | #3178 |
| 2 | 年付 = 月付 × 12 的口径写进文件头 | 同上（文件头注释） | #3178 |
| 3 | `official_credit_monthly` 30/1600/2200 的逐值契约测试 | `packages/api-publish-engine/test/plan-matrix.test.js` | #3178 |
| 4 | 12 处文档口径同步 + 5 处口径漂移登记 | `01-docs/**` | #3178 |
| 5 | 定价研究报告 | `01-docs/DEEP-ANALYSIS-CREDIT-PRICING-2026-10-08.md` | #3120 |
| 6 | 官方算力技术方案 + 两轮对抗评审结案 | `openspec/changes/official-compute-credit-engine/`（**分支 `openspec-official-compute-credit-engine`，未合 main**） | — |

**方案文件是「已评审但未通过」的冻结状态**（VERDICT = FAIL）。**它的问题不是写得不好，是规模超出当前决策信息量。** 复用其中的取证与表结构，**不要直接照它的批次表开工**。

---

## 3. 三条硬事实（整个判断的基石）

### F1 · 桌面端没有官方 Key 供给

```bash
grep -rn "official-keys\|officialKey" apps/desktop/electron/   # → 0 命中
```

`ops-center` 的 `official_keys` 表（`ops-center/backend/models.py:116-136`）是管理面资产，**从不下发到客户端**。

### F2 · 服务端不代理模型调用

```bash
grep -riE "chatCompletion|generateVideo|generateImage|createTts" packages/api-publish-engine/src/   # → 0 命中
```

adapter 直连 provider 的 `baseUrl`（`adapters/_base/openai-compatible.js:36`），且要求用户自带 Key（`model-provider-manager.js` 的 `hasUsableApiKey()`）。

**F1 + F2 合起来 = 用户想用官方算力，必须先有「服务端代调」这条链路，而它不存在。**

### F3 · 就算建了服务端代理，Node 侧也解不开官方 Key

```bash
grep -rln "Fernet" --include=*.js packages/api-publish-engine/src apps/desktop/electron   # → 0 命中
grep -rln "Fernet" --include=*.py ops-center/backend                                      # → 6 命中
```

Fernet 实现在 `ops-center/backend/services/key_service.py`（Python + `cryptography`）。**Node 侧只有 `cloud-accounts/envelope-crypto.js` 的 AES-256-GCM，没有 Fernet。**

官方 Key 不能下发客户端（会被逆向提取），所以只能服务端代理；**但服务端代理是 Node 进程，解不开 Fernet。**

**这是架构级死结，也是本次交接最需要先决策的点。**

---

## 4. 安全审计

> 按「能否直接造成收入损失或数据泄露」排序。**S1 与 S2 是现在就在流血的问题，与官方算力做不做无关。**

### S1 🔴 任意字符串激活码可得永久 Pro（**现在就在流血**）

`apps/desktop/electron/services/license-manager.js:182`

```js
const key = String(licenseKey).trim()
if (!key) return false
this._data.type = "pro"
this._data.expiresAt = null          // 永不过期
this._data.features = PRO_FEATURES.slice()
```

代码注释**自证了这个缺陷**（`:172-181` 原文）：

> 2026-10-07：这里原本只 `trim()` 后就写库，**没有任何有效性校验**。实测：输入 `a` / `x` / `随便什么字符串` / `"   "` / `!!!` 一律返回 true，并写入 type=pro + expiresAt=null（永不过期）+ 8 项 PRO_FEATURES。叠加 #3064 保留的正式包激活码入口 ⇒ **任意非空字符串即可获得永久 Pro**。
> 最小止血：空串/纯空白不得视为有效 key。**这不是完整修复**——客户端校验本质可绕过。

**影响**：任何拿到正式包的用户都能白嫖全部 Pro 功能。**在开通任何付费通道之前必须堵死。**

**根因**（注释自己写了）：本地 license 存在一条**不经服务端核销**的授权路径；而服务端 `POST /api/v1/redeem` 已经带 `durationDays` 与事务化到期结算。

**修法**：正式包一律走服务端核销，客户端激活码入口只保留「提交给服务端」的动作，不在本地写授权。

### S2 🔴 API Key 认证绕过全部权益与配额

`packages/api-publish-engine/src/publish-api-server.js`

```
:475  _usesLogtoIdentity(req) {  ...  return false 当 authType === 'api_key' }
:541  if (!feature || !this._usesLogtoIdentity(req)) return true    → 门禁直接放行
:563  if (!feature || !this._usesLogtoIdentity(req)) return null    → 配额扣减整段跳过
```

**影响**：任何以 API Key 鉴权进来的调用，**既不校验 feature 也不扣配额**。

**注意**：当前 `cloud_publish` 的扣减点有 3 处且 feature 字面量固定，所以暴露面有限。但**一旦官方算力路由上线而没有显式要求 Logto 身份，这就是零成本白嫖**（第二轮评审 R7 判定 CRITICAL）。

**修法**：compute 路由必须显式 `requireLogto`，不能靠 `_requiredFeature` 的默认值。

### S3 🔴 官方 Key 的加密与代理不兼容（F3 的安全侧）

供给侧的核心矛盾：

- 下发客户端 → Key 可被逆向提取 → **无限白嫖**
- 不下发 → 服务端代理 → **Node 解不开 Fernet**

**两条路都走不通，说明「服务端代调 + Node」这个组合缺一环。** 三条候选出路：

| | 做法 | 代价 |
|---|---|---|
| 1 | Node 侧实现 Fernet 解密 | 需引入 `cryptography` 等价库，密钥管理要重做 |
| 2 | 迁库时重加密进已有的 AES-256-GCM 信封体系 | 复用 `cloud-accounts/envelope-crypto.js`，**成本最低**；但需把 `OPS_ENCRYPTION_KEY` 换成信封主密钥 |
| 3 | 加 key-broker HTTP 接口，Node 向 ops-center 要明文 Key | 引入一个此前不存在的在线依赖，**且与「单事务原子读」冲突** |

**推荐 2**（复用已有加密设施，不引新依赖）。**但这需要你拍板，本文档不替你定。**

### S4 🟠 成本不可观测（无法发现亏损）

```
model-provider-manager.js:356-370   _writeLog() 不传 tokens_in / tokens_out / cost
   → model-log-store 落 NULL
   → usage-reporter.js:123-125  Number(null) || 0
   → ops-center model_usage_daily.cost 恒为 0
```

**影响**：**当前无法回答「这个用户花了多少成本」**。运营侧的「官方积分亏损率」这类指标**没有数据基础**。

即使不做官方算力，这一条也该修——它决定了未来一切成本决策的可行性。

### S5 🟠 未签名构建 + 更新源恒为 GitHub Releases

`apps/desktop/package.json:199-201`

```json
"win": { "target": "nsis", "sign": false, "signAndEditExecutable": false, "signDlls": false }
```

**影响**：产品的核心信任承诺是「凭证在你本机、加密存着」。**更新包一旦被顶替，所有本地加密承诺同时失效**——不需要破解任何加密。

用户看到的是「未验证发布者」警告，而 ToB 采购的技术尽调会直接问这个。

**修法**：上 OV/EV 代码签名证书。属采购流程，不是代码改动。

### S6 🟡 日志脱敏缺口

`SECRET_PATTERNS` 覆盖 cookie / access_token / api_key / Bearer / sk- / JWT，但：

- **裸 `token`（无 `access_`/`refresh_` 前缀）漏网**
- **`sid` / `session` / `pwd` 漏网**
- **全仓无手机号 / 身份证正则**（用户填在账号昵称里会原样进日志）
- 日志默认保留 30 天

**修法**：加两条正则。成本极低。

### S7 🟡 积分体系自身无自防（设计期风险，尚未发生）

**尚未落地，但如果按错误设计实现会立刻出现**：

| 攻击 | 成因 |
|---|---|
| **Reserve 洪水** | 无 outstanding 数量上限 + 无回收器 + 退款路径不存在。攻击者重复 reserve/execute 不 settle，成本 0 |
| **`unknown` 态绕过守卫** | 守卫判据 `count(status IN ('reserved','executing'))` 不含 `unknown`，而超时项正是 `unknown`。守卫全程绿灯 |
| **并发 execute** | 服务内无幂等基础设施，`reservation_id UNIQUE` 只给唯一性不给单次执行 |

**这三条不是"实现细节"，是架构约束。** 详见 `REVIEW-CONCLUSION.md` 的 R1 / A2 / R8。

---

## 5. 可实施方案（三选一）

### 方案 A · 平台能力优先（**推荐**）

**定位改一句话**：会员费买的是**平台能力**（账号数 / 并发 / 发布量 / 定时批量 / 看板）+ **BYOK 便利性**（省心配置、模型市场、用量可见）。

**动作**：

| # | 动作 | 成本 | 说明 |
|---|---|---|---|
| 1 | 页面/文案**停止承诺积分** | 极低 | 撤下「送 1600 积分」「每月可生成 X 条」等一切量化表述 |
| 2 | 定价**维持 v1.2 不变** | 零 | ¥59/¥79 对应的功能配额全部是实打实的，不欠用户 |
| 3 | 堵 S1（激活码口子） | 中 | 见 §4 S1 修法；**在做任何付费通道之前必须完成** |
| 4 | 修 S2（api_key 绕过） | 低 | 单点加固 |
| 5 | 修 S4（成本上报） | 低 | 让 `_writeLog` 带上 tokens/cost，成本账从 0 变可用 |
| 6 | 修 S6（脱敏正则） | 极低 | 两条正则 |
| 7 | BYOK 能力产品化 | 中 | 模型市场、配置向导、用量与成本可见、优选模型标记 |

**验收**：用户付费后**立刻能兑现**的权益 100% 兑现；页面上不存在任何无法兑现的承诺。

**风险**：无技术风险。商业上暂失"送算力"这个转化钩子。

**周期**：动作 1-2 当天可上；3-6 一到两周；7 视投入。

---

### 方案 B · 官方算力全量（分两期，独立立项）

**Phase 1 · 纯基建（不碰任何产品，风险最低，可立刻启动）**

1. **拍板 Node 侧加密方案**（§4 S3 三选一，推荐选项 2）
2. 迁移台账重构：编号冲突必须先解决（`006` 被三个批次、两个文件名同时占用，台账锁 checksum + `assertReady(allowPending:false)`，冲突会让**整个会员仓储硬失败** → `MEMBERSHIP_UNAVAILABLE`）
3. 堵 S1 / S2
4. 修 S4（成本账）

**Phase 2 · 供给链路**

官方 Key 池 → 服务端代理 → 积分扣减。**必须在 §7 的 8 个坑全部知晓的前提下开工。**

**周期**：Phase 1 约 2-4 周；Phase 2 一个季度以上，且强依赖真实上游账单数据。

**前置条件（缺一不可）**：

- 拿到**近 30 天上游账单**（否则赠送量只能按公开挂牌价估算，误差不可控）
- 确认**部署环境是否允许**代理方案（带宽、密钥存储能力）
- 确认**是否要做 S3 的加密体系重构**

---

### 方案 C · 只做 S1-S4 止血（最小闭环）

只做安全与可观测性修复，**不做官方算力，不动定位**。

**适合**：暂时不确定是否投入算力供给，但已知有漏洞在流血。

**周期**：一到两周。**风险最低。**

---

### 推荐

**方案 A。** 理由：

1. **今天就能上**，且不欠用户任何东西
2. 把积分承诺摘掉，等供给链路真能用了再加回来，**用户不会觉得被坑**（因为从没看见过承诺）
3. BYOK 是**已经存在的真实能力**（55 个 adapter、`safeStorage` 加密、fail-closed 无明文降级），把它产品化的边际成本远低于新建供给链路
4. 方案 A 的 3-6 项本来就是方案 B Phase 1 的内容——**做 A 不浪费**

**如果你倾向于"积分是核心卖点"**，那走 B，但**必须先回答 §6 的三个问题**，否则大概率返工。

---

## 6. 开工前必须回答的三个问题

| # | 问题 | 为什么必须问 |
|---|---|---|
| **Q1** | **你那些 AI Key 现在实际是怎么用的？** | 我推断它们只躺在后台页面里没人用。**如果我推断错了，整个"官方算力"方案的前提要重写**，已有分析有一半作废 |
| **Q2** | **Node 侧加密走哪条路？**（§4 S3 三选一） | 决定 Phase 1 全部设计。**本环境无法自证，这必须是业务/架构决策** |
| **Q3** | **上游账单能给吗？** | 赠送量、单价、摊销全靠它。没有它，测算只能停在"公开挂牌价"这一层 |

**答不上 Q1，就不要启动任何开发。**

### 6.1 Q1 定案：那批官方 Key 的实际用途（2026-10-11 调查结论）

> 行号取证基线 `origin/main@68838e9ab`。本节回答 Q1，**取代**「我推断它们只躺在后台页面里没人用」这句推断——推断方向对，但「没人用」不准确：**有一个生产读取点**。

**结论：那批 Key 不是为「平台用户使用内置模型消耗积分」录入的**（录入时积分引擎尚不存在），其真实定位是**运营后台的供应商凭据登记 + 模型预设连通性验证**，同时按 PRD 规划预留了「按档位回退给用户」的路径但**从未接线**。

**A. 运营中心确实有需要 LLM 的功能，但用的是另一套密钥表**

| 功能 | 真实 LLM 调用点 | 密钥来源 |
|---|---|---|
| 提示词评估工作台（生成） | `services/prompt_eval_generation_service.py:147-151` | `prompt_eval_provider_keys` 表 |
| 提示词评估（评估） | `services/prompt_eval_evaluation_service.py:150-152` | 同上 |
| 提示词翻译 | `services/prompt_eval_translation_service.py:33-35,76-78` | 同上 |
| 视频评估 | `services/prompt_eval_video_service.py:112-113,155-156` | 同上 |
| 引擎连通性探测 | `services/prompt_eval_service.py:395+` | 同上 + 环境变量 `OPS_PROMPT_EVAL_LLM_API_KEY` |

`PromptEvalProviderKey`（`models.py:562-565`）与 `OfficialKey`（`models.py:116-136`）是**两张互不相干的表**；`routers/prompt_eval.py:33-66` 的取键路径从不读 `official_keys`。前端操作该表的是 `views/ModelKeys.vue:27,49` 的「测试连通」按钮。

**B. `official_keys` 的生产读取点只有 1 个**

```
services/model_preset_service.py:1112-1127   # 表单未带 api_key 时，按 provider 回退读 official_keys（Fernet 解密）
routers/model_presets.py:156                 # POST /api/v1/model-presets/{preset_id}/test 暴露
```

其余全部是管理面：`routers/secrets.py` 的 CRUD 与池概览（`services/key_service.py:300-375`）。

**C. 那条「给用户用」的路径从未接线（三重取证）**

1. `services/key_service.py:360-373` `get_active_keys_for_tier()`——唯一符合「按用户档位取 Key 供给」语义的函数，**生产零调用**，仅 `tests/test_key_service.py:150-171` 引用；
2. 桌面端 `apps/desktop/electron/` 对 `official_keys` / `officialKey` **零命中**；
3. ops-center 的 PRD 把「Key → Tier 访问映射」列为 V0.2 功能点，**勾选框全为 `[ ]`**（`ops-center/docs/PRD.md:245-265`）。

**D. 该端点当前也没有活跃入口**（解释了为什么「录了却没人用」）

- ops-center 前端 `api/modelPresets.js` **没有 test 接口**，`views/ModelPresets.vue` 无测试按钮 ⇒ 运营后台 UI 点不到；
- 桌面端唯一调用者 `electron/services/provider-manager.js:25,80` 属旧的 platform-orchestrator 桥接（`ORCHESTRATOR_BASE = process.env.ORCHESTRATOR_URL || ''`，未配置即整体降级）；桌面真正的「测试连接」按钮走本地 BYOK 的 `model-provider:test`（`ipc-handlers/model-provider.js:104`）。

**E. 历史动机构成**

- 表随 ops-center 集成进 monorepo 的提交 `f6086ada4` 带入，**不是为某个具体功能新建**；
- 2026-08-10 批次只增强管理面（配额/日限/成本告警/备注/池概览），并**书面写明**：「桌面端消费（官方 Key 回退路由、许可证服务端验签）**需商业模式确认后另行接入**，本 change 不触碰桌面端 entitlement 现有合同」（`ops-center/docs/PRD.md:897-906`、`openspec/specs/ops-center/keypool-license/spec.md:7`）；
- `01-docs/PRD-MODEL-PROVIDER-TEST-REAL-CALL.md:59` 把「读 `official_keys` 做真实连通测试」写成数据来源优先级第 3 项 ⇒ **这是最可能的录入动机**。

**F. 对第二阶段的影响（比 Q1 本身更重要）**

1. **无存量流量**：零生产调用 ⇒ 第二阶段**不需要处理「新旧流量混跑/迁移」**，可直接按 §4 从零建供给池；
2. **但额度基线为 0**：无历史用量可反推采购折扣系数与摊销单价 ⇒ **Q3（上游账单）从「重要」升为「必须」**；
3. **表结构不对齐**：`official_keys` 有 `tier_access`/`priority`/`cost_per_1k_tokens`/`rate_per_minute`/`daily_limit`/`alert_threshold_cost`，但**缺**套餐总额度、已用量、有效期、采购折扣系数 ⇒ 第二阶段须扩表或新建 `provider_plans`（建议：`official_keys` 退化为「密钥槽位」，套餐台账独立建表）；
4. **`get_active_keys_for_tier` 是现成接缝**：签名与「按档位供给」语义吻合，接线即可，不必重写。

**G. 残留不确定（不假装已闭合）**

代码只能回答「这批 Key **能被**什么消费」，回答不了「录入时的主观意图」。最可能是「验证某供应商 Key 能否连通 / 集中登记凭据」；若运营侧记忆能对上该场景，Q1 才算彻底闭合。

---

## 7. 交接：接手前必读的 8 个坑

> 全部来自两轮对抗评审（`REVIEW-CONCLUSION.md` 有完整证据链）。**这些是已经花了两轮才挖出来的，不要重新踩。**

| # | 坑 | 后果 |
|---|---|---|
| **K1** | **不能假设"表里有数据 = 功能能用"** | `official_keys` 表存在、`officialCreditMonthly` 字段存在、`cost_per_1k_tokens` 字段存在——**三个都没有任何生产消费方**。本仓已中过两次同型坑（PR #3066：212 行模块、21 单测全绿、生产引用 0；`mergePlanSection` 的 override 机制：实现完整、测试覆盖、**注入点在仓外**） |
| **K2** | **不要用 `plan-matrix.js` 的 `overrides` 改价就以为生效了** | `logto-runtime.js:129` 读 `options.planOverrides`，**本仓内无任何传参方**，`createLogtoRuntime` 本身也无仓内调用方。`publish-api-server.js:134-136` 显示 entitlement/subscriptionService 都是依赖注入——**注入发生在仓外，本仓无法自证能否触达** |
| **K3** | **权益快照是物化的，改 `plan-matrix.js` 对存量用户无效** | 快照只在订阅事件时写（`subscription-service.js:103,209,258`）。"运营改价即时生效"对 `model_price_cards` 成立，**对积分额度不成立** |
| **K4** | **迁移编号被台账锁 checksum** | `postgres-migrations.js:104-106` 锁 checksum，`assertReady` 用 `allowPending:false`（`postgres-identity-repository.js:293`）。编号撞车 → **整个商务仓储硬失败**，表现为会员中心整体降级。**动手前先查 `migrations/postgresql/` 现有编号** |
| **K5** | **`used` / `quota_limit` 是 `INTEGER`，且被 4 种 feature 共用** | PK 是 `(user_id, feature, period_start)`。把"按 feature 的单位约定"塞进共享列，下游读者无从判断单位。**积分要小数必须用独立列** |
| **K6** | **`used` 只增不减** | `grep "UPDATE identity_entitlement_usage"` → 0 命中。**退款路径不存在**，任何"先扣后退"的方案都要先把它建出来 |
| **K7** | **全仓没有任务调度器** | `grep -rn "cron\|APScheduler\|node-cron"` → 0 命中，唯一 `setInterval` 是 `rate-limiter.js:8` 的内存清理。**任何"回收/对账/超时清理"都需要先解决任务宿主** |
| **K8** | **F3 那个加密死结** | 见 §3 / §4 S3。**这是最容易被漏掉的一条**——它让"服务端代理"方案在实现前就缺一环 |

### 提交前自检（每个 commit 都要做）

本项目**中文经手就有风险**：任何写入路径（`write` 工具 / heredoc / shell）都可能把汉字压成 U+FFFD 替换字符（码位 U+FFFD，下同，不再写出字面量）。

```bash
grep -rn $'\xef\xbf\xbd' <改动的文件>   # 命中就改
```

注意它会连带把**句子截断**（半个词被替换成 U+FFFD 码位），**别只修字符，要看上下文是否通顺**。

> ⚠️ **文档里连提及这个码位都不能写出它的字面量**——`check-text-encoding-integrity` 门禁按字节扫 `EF BF BD`，
> 哪怕你只是**举例**写出来，它也算「基线外新增损坏」。本文件第一版就是这么红的。

> 📌 **本文件第一版的真实经历**（不是转述）：第一版在说明这个陷阱时，为了举例**把该字符原样写进了正文**，
> 于是 `scripts/check-text-encoding-integrity.test.js` 判定「基线外新增损坏」，`QG Changes` 与 `Gate Result` 双双变红。
> **本地 `grep` 明明只查到 1 处、我也确认过「那是我故意写的示例」——但门禁不区分「故意的」和「意外的」。**
> 门禁按字节扫，示例就是损坏。改成文字描述即通过（5/5）。

### 引用纪律

本项目历史上出现过**至少 4 处引用漂移**（含我自己写的），包括把不存在的校验说成存在、SQL 引用是删节版、行号指错字段。

**每条结论都要 `file:line` 复核后再写。** 读不到就写"未能证实"，**严禁编造行号**。

---

## 8. 复核清单（基线前进后先跑这些）

```bash
# 1. 定价真源
grep -n "PLAN_MATRIX_VERSION\|priceMonthlyCents\|priceYearlyCents\|officialCreditMonthly:" \
  packages/api-publish-engine/src/auth/plan-matrix.js

# 2. 激活码口子是否还在
sed -n '170,195p' apps/desktop/electron/services/license-manager.js

# 3. api_key 绕过
sed -n '470,480p;538,570p' packages/api-publish-engine/src/publish-api-server.js

# 4. 官方 Key 是否仍未下发
grep -rn "official-keys\|officialKey" apps/desktop/electron/ ; echo "(空 = 仍未下发)"

# 5. Fernet 是否仍只在 Python
grep -rln "Fernet" --include=*.js packages/api-publish-engine/src apps/desktop/electron ; echo "(空 = Node 侧仍无)"

# 6. 迁移编号占用
ls migrations/postgresql/

# 7. 成本账是否仍为 0
grep -n "tokens_in\|cost" apps/desktop/electron/services/model-provider-manager.js | head
```

---

## 9. 交付定义（做完了长什么样）

| 方案 | 交付定义 |
|---|---|
| **A** | ① 站内站外无任何无法兑现的积分承诺 ② S1/S2/S4/S6 已修并有回归测试 ③ BYOK 能力在会员中心有可发现的入口 |
| **B-Phase1** | ① Node 侧加密方案已落地且有互操作测试（Node 能解 ops-center 写的密文）② 迁移台账无编号冲突、`discoverMigrations` + `validateMigrationLedger` 通过 ③ S1/S2/S4 已修 ④ 成本账 `model_usage_daily.cost` 有真实非零数据 |
| **B-Phase2** | ① 用户可用官方算力生成，且服务端有完整成本记录 ② outstanding/速率双守卫在**单事务内**生效（参考 `postgres-commerce-store.js:98` 的 `pg_advisory_xact_lock` 先例）③ 退款路径可把 `used` 减回去且不会撞 `CHECK (used >= 0)` ④ 重复 `execute` 幂等 ⑤ `unknown` 态有对账出口，不会永久占用额度 ⑥ 熔断 ≤1s 全网生效 |

**任何一条拿不出证据，就不算完成。**
