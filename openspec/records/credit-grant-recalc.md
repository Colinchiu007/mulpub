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
   - `ops-center/backend/data/model_price_cards.seed.json`：`priced` 5 张卡 + `pending` 18 组待确认项
   - `ops-center/backend/scripts/seed_credit_price_cards.py`：幂等导入，**只插不改价**
3. **③ 回算链路修复**（5 个真缺陷，见下）
4. **精度单位从「分」改「微元」**：LLM 的每千 token 单价天然是**亚分**
   （DeepSeek V4.1-Flash 高峰价 ¥3/百万 tokens ⇒ 0.3 分/1K），
   整数「分」列存不下 ⇒ 只能存 0（静默当免费、恒 0 成本）或 1（放大 3.3 倍）

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

- `packages/api-publish-engine/test/plan-matrix.test.js`：**21/21 绿**（含新增 2 条：成本占比守线、official_credit 能力声明）
- `ops-center/backend/tests/test_credit_price_service.py` + `test_credit_cost_backfill_service.py`：**19/19 绿**
- **变异验证**（每个变异后立即恢复并断言恢复成功）：
  - `_tokens_of` 改回手写字面量 ⇒ 🔴 红
  - pro 赠送量 3330 → 2200 ⇒ 🔴 红
  - token 维度不再除 1000 ⇒ 🔴 红
  - 亚分单价存成 0 ⇒ 🔴 红
  - `CREDIT_UNIT_MICROS` 10000 → 1 ⇒ 🔴 红
  - ⚠️ 另有一例**变异没红**（改 `credit_unit_price_micros` 的 default）⇒ 查出「default 无测试覆盖」
    ⇒ 修法：把「1 积分 = 10000 微元」抽成**单一真源常量** `CREDIT_UNIT_MICROS`，
    并加结构断言把 default 钉死 ⇒ 重跑该变异即红
- **种子脚本真跑过四步**：`--check`（rc=0）→ 干净库真灌（5/5 插入，rc=0）→ 再灌（0 插入 / 5 跳过，幂等）
  → 人为改库内单价后重灌（**rc=1，点名差异，不覆盖**；回读确认库内单价仍是改后的值，未被静默改回）
- **端到端回算**：灌卡 → 报用量 → 回算 ⇒ 成本 12000 微元（¥0.012）、积分 2、缺价 provider 被点名、
  **成本写回了 `model_usage_daily.cost`**

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
