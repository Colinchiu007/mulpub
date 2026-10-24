---
record: credit-grant-recalc
task: 赠送量重算（standard 1600 / pro 3330）+ 价格卡初始数据灌入 + 回算链路修复
date: 2026-10-24
branch: credit-grant-recalc
---

| 远程同步 | 由门禁推导 |

## 本次做了什么

按「3 → 1 → 2」的顺序推进，但盘点后确定实际顺序是 **④ → ③ → ① → ②**：
不先灌价格卡，回算必然全是「缺价格」告警；不回算出真实成本，赠送量没有校准依据。

1. **① 赠送量定案** —— `plan-matrix.js` 的 `officialCreditMonthly`
   - standard **1600 保持不变**（旧价时代推导，但恰好满足新价年付守线 40%：年付 19200 积分 = ¥192 = ¥499 的 38.5%）
   - pro **2200 → 3330**：3330 是「月付目标 28%」与「年付守线 40%」的**唯一交点**
     （年付 12×3330 = ¥399.6 = ¥999 的 40.0%；月付 ¥33.3/¥119 = 28.0%）
   - 2200 是**旧价 ¥79 时代**按 27.8% 反解的遗留值（2200×0.01/0.278 ≈ ¥79.1）；
     涨价到 ¥119/¥999 后赠送量没跟着补 ⇒ 实际占比掉到 18.5%，年付占比 26.4% ⇒ 白送 13.6 个点
   - 订正了 free 档注释：旧注释「约 2 条 720P 视频或 7 张配图」与 10-08 §3.2 价表差 7~10 倍；
     按价表 30 积分 = ¥0.3 ≈ **1 张**标准配图，且**买不起最便宜的视频**（¥0.6）⇒
     这与「free 档 features 不含 video_create」互为印证（免费档禁视频的**定量依据**）
   - `PLAN_MATRIX_VERSION` 随矩阵变更 bump
   - 新增 `official_credit` **能力声明**到 features（三档都有额度）——
     此前 features 数组里根本没有它，后续 `consumeFeature('official_credit')` 会直接 403
2. **④ 价格卡初始数据**（新增）
   - `ops-center/backend/seed/model_price_cards.seed.json`：`priced` 5 张卡 + `pending` 18 组待确认项
     （⚠️ 路径是 `seed/` **不是** `data/` —— 仓根 `.gitignore` 第 12 行的 `data/` 会把整个
     `ops-center/backend/data/` 排除掉 ⇒ 放那里等于种子数据进不了仓）
   - `ops-center/backend/scripts/seed_credit_price_cards.py`：幂等导入，**只插不改价**
3. **③ 回算链路修复**（5 个真缺陷，见下）
4. **精度单位从「分」改「微元」**：LLM 的每千 token 单价天然是**亚分**
   （DeepSeek V4.1-Flash 高峰价 ¥3/百万 tokens ⇒ 0.3 分/1K），
   整数「分」列存不下 ⇒ 只能存 0（静默当免费、恒 0 成本）或 1（放大 3.3 倍）
5. **QM-6 外部评审收口**（本轮新增，见下节：14 条 finding 全部处置）

## 回算链路的 5 个真缺陷（全部只有「真跑」才暴露）

⚠️ 这 5 个缺陷在**单元测试全绿**的情况下存在 ⇒ 纯函数测试证明不了链路通不通。

| # | 缺陷 | 后果 |
|---|---|---|
| 1 | `_tokens_of` 把 unit 键写成 `"token_in"`，与价格卡的 `1k_tokens_in` 不匹配 | 回算成本**恒为 0** + 全量「缺价格」告警。事件级路径 `token_counts_from_event` 是对的、既有单测测的正是那条 ⇒ 恒真自检 |
| 2 | 价格卡唯一约束**漏了 `unit`** | 同一 provider 的 in/out 两张卡其余维度全同 ⇒ 撞约束 ⇒ **LLM 的输入/输出/缓存三张卡根本存不下**（灌种子时插第二张就炸） |
| 3 | 回算里用 `card.category`，但表里那一列叫 `action_type` | **AttributeError，回算从来没跑通过** |
| 4 | `get_credit_unit_price_micros` 在「配置行不存在」时返回 **1**（旧「分」口径遗留），而 `ensure_credit_price_config` 建的是 10000 | 在没有配置行的库上，**积分消耗被放大 10000 倍**（成本 12000 微元 ⇒ 记 12000 积分而不是 2）；同一段代码，有无配置行结果差 10000 倍 |
| 5 | `backfill_costs` **没有 `await db.commit()`**，而 `async_session()` 退出时不自动提交 | router 调完回算，所有 UPDATE 随 session 关闭被丢弃 ⇒ **回算从来没有落过库** |

缺陷 4 与 5 都由本轮新增的**端到端回算测试**（自建内存 SQLite，不依赖 conftest 的 DB 隔离）抓住。

## QM-6 外部评审（M+ 变更强制）：14 条 finding 的逐条处置

### 怎么做的（含诚实边界）

- 判定器 `node scripts/ccg-review-decider.js --base <本 PR 的 base>` 判本 PR 为 **`mode=dual`**
  （895 行 > 200 阈值；敏感命中 1 路径 + 13 内容）⇒ QM-6 强制。
- ⚠️ **仓外评审引擎与后端在本环境不可达**：CCG 引擎在仓外 `~/.claude/skills/adversarial-review-loop/`
  （本机该目录不存在），清单里的 `claude` / `opencode` 两个后端 CLI 与 `codeagent-wrapper` 均不存在
  （`sh scripts/deep-review.sh --check-deps` 报「没有任何评审后端可用 —— 深度审查根本起不来」）。
- ⇒ 按**判定器自己给出的降级路径**执行（其原话：「降级为 SELF-REVIEW：必须由 agent 自行完成评审并记录结论」）：
  由**一条独立评审会话**（与本会话分离、不读本会话的推理过程）对本 PR 的 13 个文件做只读评审，
  产出 14 条 finding（每条带 `file:line` / 触发条件 / 影响 / 依据），其中 8 条用**可复现脚本实测**过。
- ⇒ 本会话对 14 条**逐条回源码复核**（审计结论是线索不是证据）⇒ **14 条全部成立**，
  逐条处置见下表。公开可核的评审原文与逐条处置见本 PR 的评论（链接见判定记录的 `evidence`）。

### 逐条处置

| # | 严重度 | 缺陷 | 处置 |
|---|---|---|---|
| F1 | Warning | `list_price_cards` 读 `c.model`，而 `ModelPriceCard` 的列名是 `model_id` | **已修**（`c.model_id`）+ 端点级回归测试 |
| F2 | Warning | `create_price_card` 构造 `ModelPriceCard(model=…, category=…)` ⇒ TypeError | **已修**（`model_id=` / `action_type=`） |
| F3 | Warning | 写接口 `minimum=1` 放行 1..9999，而引擎 `max(10000, …)` 静默抬回基准 ⇒ **写接口回显 ≠ 引擎实际值** | **已修**：写接口下限改为 `CREDIT_UNIT_MICROS`（调价只能调高） |
| F4 | Warning | 0 价卡在种子脚本与管理端 API 两处都无守卫 ⇒ 插得进去，回算时**静默当免费、连缺价告警都不响** | **已修**：写入侧两道守卫（API `minimum=1` + 种子脚本 fail-closed）+ 回算侧「0 价卡 = 缺价」 |
| F5 | Warning | 列重命名与唯一约束改动**没有迁移** ⇒ 存量库上种子脚本直接 `OperationalError` | **登记 + 诊断**（见下） |
| F6 | Warning | `load_effective_cards` 里 `card.model` ⇒ 传非空 model 时 AttributeError（当前靠 `model=""` 短路**潜伏**） | **已修**（`card.model_id`）+ 传非空 model 的回归测试 |
| F7 | Warning | 回算按**覆写**写 `model_usage_daily.cost`，上报路径按**累加**写 ⇒ 同一列两个语义相反的写者 | **登记 Phase 2**（见下） |
| F8 | Warning | `if not tokens: continue` 让非 LLM 桶在缺价判定**之前**被跳过 ⇒ 最贵的一块（视频/图像/音频）缺价告警失效 | **登记 Phase 2**（见下） |
| F9 | Warning | spec §4.1 仍写 pro=2200 / 18.5%，与新矩阵 3330 / 40.0% 矛盾（而 CHANGELOG 宣称「已同步」） | **已修**：spec §4/§4.1/§5 同步 |
| F10 | Info | 代码 docstring 仍写「分」（列名已改 micros）⇒ 10000 倍单位陷阱 | **已修**：`credit_price_service.py` / `models_credit.py` 注释改微元 |
| F11 | Info | spec §4/§5 仍引用已删列名 `cost_cents` / `credit_unit_price_cents` / `unit_price_cents` | **已修**：随 F9 一并同步 |
| F12 | Info | `--check` / `--dry-run` 仍调 `init_db()`（DDL 写）⇒ 会建库建表，却打印「未写库」 | **已修**：只读模式改为只读探测表是否存在，不建表 |
| F13 | Info | 执行记录里写种子路径是 `data/`，实际是 `seed/` | **已修**（本节上方第 2 条） |
| F14 | Info | `officialCreditMonthly` 允许 -1（不限），但 `> 0` 判据会把「不限」判成「没额度」⇒ 能力声明整条消失 ⇒ `consumeFeature('official_credit')` 403 | **已修**：判据改 `!== 0`（与 `maxCloudAccounts` 同一形态）；同族 `videoMonthly` 一并修 |

⇒ 11 条**已修并各有回归测试**，3 条（F5 / F7 / F8）**登记为 Phase 2 显式待办**（理由见下）。
⚠️ 评审本身给出的 severity 全是 Warning / Info，**无 Critical**。

### 三条登记为待办的，理由要写清（不是「没空修」）

- **F5（迁移）**：本 PR 改了 `model_price_cards` / `credit_price_config` 的**列名**与**唯一约束**，
  而 SQLite 的 `create_all` **不改已有表** ⇒ 跑过 #4322 的存量库上这两张表仍是旧 schema
  ⇒ 灌种子会 `OperationalError: no such column: model_price_cards.unit_price_micros`。
  **不自动修的理由**：① 改唯一约束在 SQLite 上**只能重建表**，而仓内 4 处既有迁移
  （`usage_migration` / `model_preset_service` / `prompt_eval_migration` / `update_policy_migration`）
  **全部是「加列」，没有表重建先例**；② 重建表要搬运营可能已建的价格卡数据 ⇒ 不可逆；
  ③ #4322 **今天**才合并 ⇒ 存量库的现实面几乎为零。
  **仍必须做的**：不能让存量库**静默**炸 ⇒ 写库前**先探测 schema**，
  发现旧 schema 就**报明确错误并给人工修复指引**（而不是抛 traceback）。
- **F7（`cost` 列双写者）**：属**产品/财务口径**问题（这一列到底允不允许客户端写），
  修法是「两列分离」或「回算只写专用列」⇒ 属 Phase 2 的扣减接线范围，不宜在本 PR 顺手改。
- **F8（非 LLM 桶告警盲区）**：要覆盖视频/图像/音频必须先有**事件级用量表**（带 duration / spec）
  ⇒ 依赖 Phase 2 的 `generation_requests` 台账。

### 覆盖缺口（评审自己点名的，如实记录）

- 评审**没有**展开 PostgreSQL 侧（`identity_credit_ledger.cost_cents` / `credit-schema.js`）——
  那是另一张表、另一套 schema，本 PR 未改动它。
- 评审**没有**验证任何真实部署库的 schema 状态（仓内没有部署清单）⇒ F5 的实际影响面无法从仓内确认。
- 评审跑测试时用的是**自建内存 SQLite**，与 CI 的 `conftest` 隔离库不是同一个环境。

## 口径与边界（如实记录，不要越读）

- **回算当前只覆盖 LLM 的 token 维度**。视频/图像/TTS/ASR 的行在回算里被
  `if not tokens: continue` **直接跳过，连「缺价格」告警都没有** ⇒ 成本统计会**系统性偏低而运营看不出来**。
  这是当前链路的真实边界，已在种子的 `pending` 里逐项标注。
- **回算按 `(provider_id, action_type)` 定位价格卡**：日聚合表没有 model / spec / duration 字段 ⇒
  价格卡必须是 `model_id=''` 的**通用卡**；带 spec 的卡在当前回算下会「多张都命中、只取最新一条」⇒ **静默用错规格的价**。
- **`model_usage_daily` 没有 user_id / plan 字段** ⇒ 回算能回答「哪个 provider 贵」，
  **不能**回答「standard 档实际花了多少」。1600/3330 的成本占比是**按赠送量 × 单价推算**的，
  **不是**被回算数据验证过的。
- **种子只灌 `priced`，不灌 `pending`** ⇒ 缺价必须产生告警（10-11 §13：UNKNOWN + fail-closed，不填暂定数字）。
  ⚠️ 尤其**绝不插 0 价卡**：0 价卡会被静默命中，既不告警又被当成「免费」。
- 视频/图像/TTS/ASR 的价格**本身不缺**（10-08 §3.2 有挂牌价），缺的是**用量维度**（duration / spec）
  与**时间单位的整数精度**（TTS 0.043 分/秒 ⇒ 换「微元/秒」是 433.33 非整数 ⇒ 需改用每分钟口径）。
- `credit_multiplier` / `proc_discount` 未配采购折扣 ⇒ 一律 1.0（**没有编造折扣**）。
- 豆包那张卡取的是**火山引擎官方定价页「套餐外按量计费」的 doubao-pro-32k**，
  与 mulpub 实际在用的模型名逐字对得上；⚠️ 注意它与豆包 2.1 Pro（¥6/¥30 每百万）**不是同一代模型**，价格差 7.5 倍。

## 测试与验证

- `packages/api-publish-engine/test/plan-matrix.test.js`：**22/22 绿**（含新增 3 条：成本占比守线、official_credit 能力声明、-1 不限仍声明能力）
- `ops-center/backend/tests/`：credit 四件套 **39/39 绿**
  （`test_credit_price_service.py` / `test_credit_cost_backfill_service.py` /
  `test_credit_pricing_api.py`（**新**）/ `test_credit_price_cards_seed.py`（**新**））
- ⚠️ **两个新测试文件的由来**：管理端价格卡 API 与种子脚本此前**一条断言都没有**
  ⇒ 57 个 ops-center 测试文件里没有任何一个引用 `routers/credit_pricing`
  ⇒ 列名写错时 CI 全绿、手工一调就 500（QM-6 的 F1/F2 就是这么活下来的）
- **变异验证**（每个变异后立即恢复并断言恢复成功）：**11 个变异全部被抓住**
  - `_tokens_of` 改回手写字面量 ⇒ 🔴 红
  - pro 赠送量 3330 → 2200 ⇒ 🔴 红
  - token 维度不再除 1000 ⇒ 🔴 红
  - 亚分单价存成 0 ⇒ 🔴 红
  - `CREDIT_UNIT_MICROS` 10000 → 1 ⇒ 🔴 红
  - `c.model_id` → `c.model`（还原 list 端点 AttributeError）⇒ 🔴 红
  - `model_id=` → `model=`（还原 create 端点 TypeError）⇒ 🔴 红
  - `action_type=` → `category=` ⇒ 🔴 红
  - `card.model_id` → `card.model`（service 侧潜伏缺陷）⇒ 🔴 红
  - 写接口下限 `CREDIT_UNIT_MICROS` → 1 ⇒ 🔴 红
  - 建卡 `minimum=1` → 默认 0（还原 0 价卡可插）⇒ 🔴 红
  - 回算侧去掉 `unit_price_micros <= 0` 判定（0 价卡当免费）⇒ 🔴 红
  - 种子脚本 0 价守卫失效 ⇒ 🔴 红
  - `--check` 也调 `init_db()` ⇒ 🔴 红
  - 旧 schema 探测的两条判定分别恒假 ⇒ 🔴 红（**各一次**）
  - ⚠️ 另有一例**变异没红**（改 `credit_unit_price_micros` 的 default）⇒ 查出「default 无测试覆盖」
    ⇒ 修法：把「1 积分 = 10000 微元」抽成**单一真源常量** `CREDIT_UNIT_MICROS`，
    并加结构断言把 default 钉死 ⇒ 重跑该变异即红
  - ⚠️ **两处断言自己先假绿过**（都是"字面量匹配"形态）：
    ① 幂等性用 `"冲突" not in stdout` ⇒ 撞上脚本汇总行本来就打的「冲突 0」⇒ 改用**行级标记** `! 冲突`；
    ② 旧 schema 探测用 `"unit_price_cents" in stdout` ⇒ 命中的是**人工修复指引里的 ALTER 语句**
    ⇒ 改用**完整行匹配**「存量旧 schema：…」前缀 ⇒ 之后两条判定分别恒假时都能红
- **种子脚本真跑过四步**：`--check`（rc=0）→ 干净库真灌（5/5 插入，rc=0）→ 再灌（0 插入 / 5 跳过，幂等）
  → 人为改库内单价后重灌（**rc=1，点名差异，不覆盖**；回读确认库内单价仍是改后的值，未被静默改回）
- **端到端回算**：灌卡 → 报用量 → 回算 ⇒ 成本 12000 微元（¥0.012）、积分 2、缺价 provider 被点名、
  **成本写回了 `model_usage_daily.cost`**
- **旧 schema 库端到端**：造一个 #4322 旧 schema 的库（`unit_price_cents` 列 + 唯一约束漏 `unit`）
  ⇒ 种子脚本 **rc=2**、三条问题逐条点名、给了 `ALTER TABLE` 人工修复指引、**未插任何数据**

## 本次没做 / 留给下一步

- **Phase 2 的扣减接线主体**（积分账户/账本、FIFO by 过期时间、充值双轨、预授权与结算两段式、
  降档 50% 保留、周期末过期分录、`generation_requests`）**未做** ⇒ 应独立 PR，避免半成品。
- **「回算只覆盖 LLM」**：需要事件级用量表（带 duration / spec）才能覆盖视频/图像/音频。
- **「零成本源」标记**（本地模型 / 免费素材）：需要价格卡支持「已知 0 成本」这一档，
  否则它们会一直报「缺价格」（噪音，但方向安全）。
- **免费档是否禁图像**：`plan-matrix` 里**没有图像配额字段**可派生，加 feature 属于编造 ⇒ 留待产品拍板。
- 计价能力**仍无服务端同侧判据**：`consumeFeature` 全仓只有一个调用点，只消费 `cloud_publish`；
  其余 features 目前是**下发给客户端的声明** ⇒ 绕过客户端可直接调服务端 ⇒ 护栏须在 Phase 2 落到能力源头。
- 本次改动**同时改了 #4322 引入的 ops-center 文件**（精度单位、唯一约束、字段名、commit）
  ⇒ 两个 PR 存在**合并顺序依赖**：本 PR 应在 #4322 之后合，或与之一并合。
- **列改名与唯一约束的 SQLite 迁移没有自动做**（QM-6 F5，见上节理由）：本 PR 改了
  `model_price_cards` / `credit_price_config` 的列名（分 → 微元）与唯一约束（加 `unit`），
  而 SQLite 的 `create_all` **不改已有表** ⇒ 跑过 #4322 的存量库上灌种子会 `OperationalError`。
  ⇒ 已做的是：**写库前只读探测旧 schema，发现即 fail-closed 拒绝 + 人工修复指引**
  （`scripts/seed_credit_price_cards.py` 的 `detect_legacy_schema`）⇒ 不会静默炸。
  ⇒ 仍需人工做的一步：**唯一约束含 `unit` 维度**在 SQLite 上只能**重建表**
  （CREATE TABLE new + INSERT SELECT 搬数据 + DROP old + RENAME new）—— 本 PR **故意不做**
  （要动运营可能已建的价格卡数据 ⇒ 不可逆；且仓内 4 处既有迁移全是「加列」、无表重建先例）。
  ⇒ 影响面：#4322 **今天**才合并 ⇒ 存量库的现实面几乎为零；但**若你的库是今天下午之后建过的**，
  灌种子前请先按上面的指引确认 schema。
- **`model_usage_daily.cost` 的双写者**（QM-6 F7）：回算按**覆写**写（服务端权威成本），
  上报路径按**累加**写（客户端上报值）⇒ 同一列两个语义相反的写者
  ⇒ Phase 2 必须把「客户端上报值」与「服务端回算值」拆成两列。
- **非 LLM 桶的缺价告警盲区**（QM-6 F8）：`if not tokens: continue` 让视频/图像/音频的日桶
  在缺价判定**之前**被跳过 ⇒ 最贵的一块缺价告警失效 ⇒ 已在种子的 `pending` 里逐项标注，
  解法依赖 Phase 2 的事件级用量表（带 duration / spec）。
