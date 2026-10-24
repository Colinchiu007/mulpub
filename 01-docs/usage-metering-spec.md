# 用量计量口径规范

> **状态**：Phase 0（口径对齐）· 2026-10-23
> **适用范围**：`model_provider_logs`（桌面端）→ `model_usage_daily` / `model_usage_events`（ops-center）
> **真源关系**：本文件定义**口径**；`packages/api-publish-engine/src/auth/credit-schema.js` 与
> `ops-center/backend/models_credit.py` 定义**存储**；二者必须一致。

## 0. 为什么需要这份规范

现有链路已经能采到 token，但**口径不是为计价设计的**：

- 字段叫 `tokens_in` / `tokens_out`，而 OTel GenAI 语义约定已把 `prompt_tokens` /
  `completion_tokens` 标记为 **deprecated**，推荐口径是五类 token 独立计量。
- 成本字段 `cost` 是 **Float（元）**，且由**客户端**算好后透传上报，服务端只校验"非负"，
  **不校验它与 tokens 是否自洽**。
- 价格只有一个 `official_keys.cost_per_1k_tokens`（**单一混合单价**），改价即改写历史口径，
  **历史成本不可复算**。

结果是：账面看得见"花了多少"，但**算不出"应该花多少"**，也无法把成本归到用户头上。
本规范先统一口径，价格卡与账本见 §4/§5。

## 1. token 计量（五类独立）

| 口径 unit | 含义 | 桌面端字段 | 计价单位 |
|---|---|---|---|
| `1k_tokens_in` | 输入 / prompt token | `tokens_in` | 微元 / 1K |
| `1k_tokens_out` | 输出 / completion token | `tokens_out` | 微元 / 1K |
| `1k_tokens_cache_read` | 缓存命中读取 | `tokens_cache_read` | 微元 / 1K |
| `1k_tokens_cache_write` | 缓存写入 | `tokens_cache_write` | 微元 / 1K |
| `1k_tokens_reasoning` | 推理 token | `tokens_reasoning` | 微元 / 1K |

⚠️ **unit 字面量必须与 `models_credit.UNIT_*` 逐字一致**（`1k_tokens_in` …，不是 `token_in`）。
本节早期版本写的是 `token_in`，与实现不一致 ⇒ 回算时 `cards.get("token_in")` 恒为 `None`
⇒ **成本恒为 0 且全量报「缺价格」**。判据：任何 unit 名都要对着 `UNIT_*` 常量抄，不靠记忆。

**采集侧兼容读**：`model-provider-manager.js` 目前读 `usage.prompt_tokens ?? usage.input_tokens`
与 `usage.completion_tokens ?? usage.output_tokens`——**读取保持兼容**（供应商两种叫法并存），
**落库用新名**。

**五类必须独立计价**：输入与输出单价通常差 3~5 倍，缓存读写与推理 token 又有各自价位。
混成一个"每千 token 混合价"必然算不准——**这是当前 `cost_per_1k_tokens` 的结构性问题**。

## 2. 成本口径

```
cost_micros = Σ( token_count / 1000 × unit_price_micros )
```

- **单位一律用整数微元（1e-6 元）**。禁止用 Float 元做成本计算（浮点误差会随累加放大）。
  `model_usage_daily.cost` 保留 Float（元）仅为兼容既有看板，**它不再是成本的权威源**；
  权威源是 `model_usage_events.cost_micros`（Integer）。
- **单价口径是「微元 / 1K unit」**。
  ⚠️ **为什么不是「分」**：LLM 的每千 token 单价天然是**亚分**
  （DeepSeek V4.1-Flash 国内高峰价 ¥3 / 百万 tokens ⇒ **0.3 分 / 1K**），
  整数「分」存不下 ⇒ 只能存 0（**静默当免费**、恒 0 成本）或 1（**放大 3.3 倍**）。
  ⇒ 最小单位取微元；**换算基准「1 积分 = 1 分 = 10000 微元」是单一真源常量**
  （`models_credit.CREDIT_UNIT_MICROS`），改一处即全局生效。
  ⚠️ 这与 10-08 定案（`unit_price NUMERIC(12,6)` 单位为元）**方向一致、粒度更细**：
  定案是历史依据，不回改。
- **服务端算成本**。客户端只报 token，不报成本。客户端的 cost 保留为
  `client_reported_cost_micros` 仅用于**对拍**（偏差 > 5% 告警），不参与计费。
  依据：`model-provider-manager.js:371` 注释已定调「不做本地估算避免伪数据」。

### 2.1 延迟直方图不得用于成本

`model_usage_daily.latency_buckets`（`lt1s` / `1to3s` / `3to10s` / `gt10s`）是**直方图**，
OTel 明确 **usage counter 才是成本口径，per-operation 直方图不得用于成本计算**。
延迟只作 SLA 指标。

## 3. 归属口径：必须带 user_id

| 字段 | 含义 | 缺失时的后果 |
|---|---|---|
| `user_id` | Logto subject（业务用户） | **成本无法归到用户 ⇒ 无法按用户扣积分** |
| `client_id` | 设备稳定哈希（脱敏） | 一人多设备散成多行；一机多账号混在一行 |

`model_usage_daily` 的唯一键是 `(usage_date, client_id, provider_id, action)`，**没有 user_id**
——这是"按用户扣积分"的硬前提缺失。事件级表 `model_usage_events` 补上 `user_id`。

**未登录**：`user_id` 为空串，仍记 `client_id`，标记为匿名用量（不扣积分）。

## 4. 积分口径

```
credit_cost = ceil( cost_micros / credit_unit_price_micros × credit_multiplier )
```

> ⚠️ **单位是「微元」（1e-6 元），不是「分」**。LLM 每千 token 的单价天然亚分
> （DeepSeek 输入 ¥0.003 / 1K tokens = 3000 微元）⇒ 整数「分」列只能存 0（静默当免费）
> 或 1（放大 3.3 倍）。1 积分 = ¥0.01 = **10000 微元**（`CREDIT_UNIT_MICROS`）。

- `credit_unit_price_micros`：**1 积分值多少微元**（全局配置，默认 10000 ⇒ 1 积分 = ¥0.01）。
  ⚠️ **下限就是 10000，不允许调低**（引擎侧会把小于基准的配置静默抬回基准 ⇒ 写接口回显 ≠ 实际）。
  调高允许（抬高毛利），调低一律 400。
- `credit_multiplier`：**该模型相对基准的倍率**（贵模型多扣积分），存在价格卡上。
- **向上取整是刻意的**：宁可少收 1 积分，不可多付 1 分成本。

### 4.1 现有档位与 1 积分 = 1 分 的自洽性验证

用 `plan-matrix.js` 的现值反推，两个档位都自洽（赠送量以**积分**为单位，1 积分 = ¥0.01）：

| 档位 | 月付价 | 年付价 | 目标成本占比 | 目标成本 | `officialCreditMonthly` | 反推单价 | 年付守线（≤40%） |
|---|---|---|---|---|---|---|---|
| standard | ¥59/月 | ¥499 | 27.1% | ≈ ¥16 | 1600 | 1600 分 ÷ 1600 积分 = **1 分/积分** ✓ | 12×1600 = ¥192 = ¥499 的 **38.5%** ✓ |
| pro | ¥119/月 | ¥999 | 28.0% | ≈ ¥33.3 | 3330 | 3330 分 ÷ 3330 积分 = **1 分/积分** ✓ | 12×3330 = ¥399.6 = ¥999 的 **40.0%** ✓ |

⇒ **赠送量的约束不是「随便一个整数」，而是两个式子的唯一交点**：
`0.01M / 月付价 = 目标占比`（月付口径）且 `12 × 0.01M / 年付价 ≤ 40%`（年付守线）。
pro 档的 **3330** 正是这两式的唯一交点；**2200 是旧价 ¥79 时代**按 27.8% 反解的遗留值，
涨价后占比掉到 18.5%、年付 26.4% ⇒ 白送 13.6 个点 ⇒ 必须重解，不能凭感觉调。

⇒ 剩下的改造不在赠送量本身，而在它当前是"**可发上限**"而非"**按实际消耗扣减**"：
语义要从"上限"变成"发放量"，扣减接线在 Phase 2。

## 5. 价格卡：版本化，改价即新行

价格卡存 `model_price_cards`，同一 `(provider_id, model_id, action_type, unit, spec,
quality_tier, effective_from)` **唯一**（`uq_model_price_active`）⇒ 同一维度只能有一条生效行。

> ⚠️ 唯一键**必须含 `unit`**：少了它，同一 provider 的 `1k_tokens_in` / `1k_tokens_out` /
> `1k_tokens_cache_read` 三张卡在其余维度上完全相同 ⇒ **LLM 的输入/输出/缓存三张卡根本存不下**。

**改价 = 插入新行 + 给旧行补 `effective_to`。禁止 UPDATE `unit_price_micros`。**
理由：价格卡被 `model_usage_events.price_id` 引用，UPDATE 会让**历史成本不可复算**，
账目失去审计能力。

**生效优先级**：精确 model 价 > 通用价（`model_id` 为空串）。
**生效判定**：`effective_from <= now` 且（`effective_to` 为空 或 `effective_to > now`）。

## 6. 缺价格卡的处理（不许静默按 0）

命中不到价格卡时：**成本记 0，但必须产生告警**（`missing_units` 落日志，
`model_usage_events.price_id` 留空）。
静默按 0 会让成本统计失真——亏了都不知道。运营看板须把这类 provider 显式标红。

> ⚠️ **0 价卡与「没有卡」同义**，不许当「免费」：
> `unit_price_micros <= 0` 的卡在回算里**同样计入 `missing_units`**（而不是按 0 计入成本）。
> 理由：0 价卡一旦入库就会被静默命中 ⇒ 成本算成 0 ⇒ 既不告警、又被当成免费
> ⇒ 成本统计系统性偏低且**无任何信号**。
> ⇒ 防线是**两道**：写入侧（管理端建卡 API 与种子脚本都拒 0 价，fail-closed）
> \+ 回算侧（0 价卡当缺价）。写入侧是主防线，回算侧防的是历史遗留的 0 价行。

## 7. 信任边界总表

| 数据 | 谁产生 | 谁记账 | 理由 |
|---|---|---|---|
| 五类 token | 供应商响应（桌面端读） | **服务端** | 客户端 token 可被篡改，但服务端按价格卡重算成本，篡改会直接体现为成本异常 |
| 成本 | ❌ 客户端不再上报为权威 | **服务端** | 客户端算钱 = 客户端说了算 |
| 积分消耗 | ❌ 客户端不碰 | **服务端** | 同上 |
| 价格卡 | 运营配置 | 服务端选 | 版本化保证可复算 |

> ⚠️ **已知缺口（Phase 2 收口）**：`model_usage_daily.cost` 这一列目前有**两个语义相反的写者** ——
> 上报路径按**累加**写（`cost = cost + excluded.cost`，值来自客户端），
> 而回算路径按**覆写**写（服务端按价格卡算出的权威值）。
> ⇒ 在两列分离之前，「服务端权威成本」这条只在**回算覆盖后**成立；
> 两者叠加的窗口里，该列既不是纯服务端口径、也不与 token 列自洽。
> ⇒ Phase 2 必须把「客户端上报值」与「服务端回算值」拆成两列（或让回算只写专用列）。

## 8. 本期落地范围与未覆盖项

**本期（Phase 1）已落地**：
- 价格卡（`model_price_cards`）、积分单价配置（`credit_price_config`）、
  事件级用量（`model_usage_events`）三张表
- 服务端按价格卡回算成本（`credit_cost_backfill_service.py`）
- PG 侧积分账户与不可变账本（`008_credit_ledger.sql`）

**本期未覆盖（下一期）**：
- 桌面端上报带 `user_id` / `byok` / `model`（`usage-reporter.js` 增事件上报路径）
- 扣减接线（`consumeFeature` 目前只用于次数配额 `cloud_publish`，积分额度尚未接入）
- 预授权 / 结算两段式扣减
- 兑换码核销与运营补发写 ledger 的 hook
