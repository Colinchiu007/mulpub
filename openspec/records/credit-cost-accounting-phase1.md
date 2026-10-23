---
record: credit-cost-accounting-phase1
task: 积分成本核算 Phase 1 —— 版本化价格卡、事件级用量表、PG 侧积分账户与不可变账本、已有用量的服务端成本回算
date: 2026-10-23
branch: credit-cost-accounting-phase1
---

## 本次执行记录：积分成本核算 Phase 1（credit-cost-accounting-phase1，2026-10-23）【混合 PR】

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ | **混合 PR**：运行时代码（`packages/api-publish-engine/src/auth/**`、`ops-center/backend/**`）+ 迁移文件（`migrations/postgresql/**`）+ 文档（`01-docs/**`）。裸分支 `credit-cost-accounting-phase1`（`rev-parse --abbrev-ref HEAD` 实证）。⚠️ 隔离方式与仓库正规入口 `scripts/start-mp-task.ps1` 不同：本次在**独立 clone 的仓库**内工作（沙箱无 D 盘与 PowerShell 入口），共享根未被他人在飞会话占用；已在该 clone 内完成 `git worktree prune` 清掉一次被中断的 worktree 残留 |
| 第一性原因（QM-5 ①） | ✅ | 不是"缺一张价格表"（`official_keys.cost_per_1k_tokens` 与 `model_usage_daily.cost` 都已存在），而是**三者没接上线**：① `consumeFeature` 只被用于**次数配额**（`publish-api-server.js:639/665` 扣 `cloud_publish`），**积分额度 `official_credit_monthly` 从未被扣**；② 代码自认「单价换算属 ModelPriceCard 后续立项」（`model-provider-manager.js:371`）；③ `model_usage_daily` 只按 `client_id` 聚合、**无 `user_id`** ⇒ 成本无法归到用户；④ 成本由客户端算、服务端只校验非负，单一混合单价且**无价格版本化** |
| 逃逸分析（QM-5 ②） | ✅ | ①**无测试载体**：价格换算与账本原子性此前无任何测试；②**测试执行层**：api-publish-engine 用 `node scripts/run-tests.js`（非 vitest），不在册文件走 `node --test` 直跑——新测试须写成 `node:test` 风格否则 `describe is not defined`；③**信任边界层**：`usage_service._validate_item` 只做类型/非负校验，`cost` 与 `tokens` 的自洽性无人校验 |
| 修复 + 回归保护（QM-5 ④） | ✅ | 新增 **17 例**：① `test/credit-ledger-migrations.test.js`（8 例）—— 迁移与开发态 SCHEMA **逐语句防漂移**（去注释 + 忽略空白，比对口径照抄 006）+ 余额非负 CHECK / 分录白名单 / 幂等索引口径锁定；② `test/credit-repository.test.js`（8 例）—— 发放幂等、消耗幂等、**余额不足不写分录**、amount 正整数校验、周期边界校验、**扣减语句必须带 `balance >= $2`**（并发下只允许一个扣成功）；③ `ops-center/backend/tests/test_credit_price_service.py`（9 例）—— 成本按 1K token 口径、**整数分无浮点漂移**、**缺价格卡显式上报而非静默按 0**、积分向上取整、倍率、单价为 0 的除零兜底、跨年周期边界。实测读数：`node --test` 8/8 + 8/8 全绿；`pytest` **9 passed** |
| 防止再次发生（QM-5 ⑤） | ✅ | ① 新增 `01-docs/usage-metering-spec.md` 固定口径（五类 token / 整数分 / 版本化价格 / 信任边界 / 缺价不许静默）；② 漂移锁进 `test/credit-ledger-migrations.test.js`（`check-unwired-tests.js` 按 `run-tests.js` 的 `test/*.test.js` 发现机制纳入）；③ 成本计算拆成**纯函数**（`compute_cost_cents` / `compute_credit_cost`）⇒ 口径可被单测直接锁死，不依赖 DB |
| 迁移编号的唯一性纪律 | ✅ | **`008_credit_ledger.sql`**——不是凭规格写的编号：`ls migrations/postgresql/` 实测当前为 002~006；`007` 已被活跃 change `compute-key-envelope-migration` 预定（其 tasks 3.1 写的仍是已被占用的 `006_official_key_envelopes.sql`，**该订正至今未落到文件**，本片不代改，只在 §遗留记录）；本片占 `008` |
| 加文件与执行同批部署 | ✅ | 迁移文件与开发态 SCHEMA（`credit-schema.js`）**同批入库**；`postgres-identity-repository.js` 的 `SCHEMA` 与 `REQUIRED_SCHEMA_RELATIONS` 同批追加（`identity_credit_accounts` / `identity_credit_ledger`），满足 `allowPending:false` 的启动期硬失败前置条件 |
| 债务基线（filesOver500） | ✅ | 新增代码**全部单独立文件**，未推高既有超限文件：`postgres-identity-repository.js` 428→432 行（+4，仅 require + SCHEMA 展开 + 关系表两项）；`models.py` 804 行**未改动**（新 ORM 落 `models_credit.py`）；`publish-api-server.js` 1573 行**未改动**；`model-provider-manager.js` 1283 行**未改动** |
| 接线棘轮 | ✅ | api-publish-engine 两个新测试走 `node --test` 直跑分支（**不登记进 `VITEST_FILES`** —— 登记进去反而会报 "No test suite found"，口径与 `member-commerce-migrations.test.js` 一致）；ops-center 新测试由 pytest 按 `tests/test_*.py` 发现；新 ORM 由 `database.init_db()` 内延迟 import 注册进 `Base.metadata`（否则 `create_all` 不建这三张表） |
| QM-1 打包 / QM-4 视觉 | N/A | 未触碰 `apps/desktop/**` 与任何 `.vue` / 样式 / locale 文件 ⇒ 无打包面与视觉面变更 |
| QM-6 CCG 双模型外部评审 | **未执行** | 本机未见可用的外部评审通道（`codeagent-wrapper` 类工具未探测到）。**如实记为未执行，不以自审冒充通过** —— 本片为 M+ 复杂度，**这是遗留风险** |
| 远程同步 | 由门禁推导 | 本记录按 2026-10-17 起的现行形态书写：状态列不手写状态词，收口由 `scripts/lib/merge-ledger.js` 按主干历史推导 |

- 保留门禁：判定 docs-only=false（走完整节拍）| 行尾对账 ✅ | 品牌残留 随 CI | 文档同步 随 CI doc-gate | 执行记录 ✅ 本文件（旧载体 `.quality-gates.md` 与 ledger 按 2026-10-15「旧载体冻结」政策**零改写**）| 迁移编号 ✅ 实测 008 | 远程同步 由门禁推导

## 本片做了什么（一句话）

把"成本"从**客户端透传的观测值**变成**服务端按版本化价格卡算出的可审计值**，
并把"积分"从**从未被扣的展示数字**变成**有账户、有不可变账本、有原子扣减语义**的账本地基。

## 关键设计取舍

| # | 取舍 | 理由 |
|---|---|---|
| 1 | **次数配额与积分余额分表**（`identity_entitlement_usage` vs `identity_credit_accounts`） | 混表会得到"发了 1600 积分，用户发 1600 篇就超限"这种荒谬语义。次数管防刷，金额管计费 |
| 2 | **成本一律服务端算**，客户端 cost 仅作对拍样本 | 客户端算钱 = 客户端说了算；且项目自己的注释已定过调 |
| 3 | **价格卡版本化、禁 UPDATE 单价** | 被 `price_id` 引用的价格若可改写，历史成本即不可复算，账目失去审计能力 |
| 4 | **改价 = 插新行 + 给旧行补 `effective_to`**，不提供 UPDATE 端点 | 同上 |
| 5 | **积分向上取整**（`ceil`） | 宁可少收 1 积分，不可多付 1 分成本 |
| 6 | **缺价格卡必须告警，不许静默按 0** | 静默按 0 ⇒ 成本统计失真 ⇒ 亏了都不知道 |
| 7 | **扣减与写分录同事务**，且扣减带 `balance >= amount` | 并发下两个请求只有一个能扣成功；事务保证账实一致 |
| 8 | **日聚合表 `model_usage_daily` 不动**，新增事件表承载 user_id 粒度 | 改既有表唯一键会破坏存量数据与既有看板；事件表为下一期扣减接线预留 |
| 9 | 账本与账户都**物理新增**，不接 `consumeFeature` | `consumeFeature` 的 amount 语义是**次数**（正整数）；积分是**金额**，两者语义不同，接线留给下一期 |

## 验证结果（实测读数）

```
$ node --test packages/api-publish-engine/test/credit-ledger-migrations.test.js
# tests 8  # pass 8  # fail 0

$ node --test packages/api-publish-engine/test/credit-repository.test.js
# tests 8  # pass 8  # fail 0

$ cd ops-center/backend && python3 -m pytest tests/test_credit_price_service.py -q
9 passed in 1.34s
```

## 遗留与下一期（明确不在本片范围）

| # | 遗留 | 影响 | 下一期做法 |
|---|---|---|---|
| 1 | **桌面端未上报 `user_id` / `byok` / `model`** | 事件表暂无真实数据；成本仍只能按 provider 通用价回算（回算已可用，但精度受限） | `usage-reporter.js` 增事件上报路径（`model_provider_logs` 本就是单次调用粒度）；`byok` 判定需先厘清官方 Key 与用户自带 Key 的分界 |
| 2 | **扣减未接线** | 积分额度仍不扣 | 新增 `consumeCredit` 接线 + 预授权/结算两段式（沿用 `api-usage-governor.js` 已有的"准入/归还分离 + 代次"范式） |
| 3 | **未用积分不结转**（用户已拍板） | 年付用户每月发放、12 个月累积 ⇒ **成本敞口随时间线性增长** | 需补监控指标（年付用户积分余额分布）与发放量的时间衰减策略 |
| 4 | **降档时未用积分按 50% 保留**（用户已拍板） | 需在 `subscription-service.js` 的降级路径实现 | 与第 2 项同批做 |
| 5 | **免费档禁用视频/图像模型**（用户已拍板） | **这是最大的亏本口**：free 档 30 积分若允许调视频模型（比文本贵几十倍），一次即吃掉整月额度 | 在 `plan-matrix.js` 的 features 派生层加限制 + 服务端同侧判据（防绕过） |
| 6 | **`compute-key-envelope-migration` 的 006 撞号未订正** | 该 change 若照 tasks 落 `006_official_key_envelopes.sql`，会与 `006_payment_orders.sql` 撞 checksum ⇒ 启动期硬失败 ⇒ 会员中心整体降级 | **本片不代改**（改别的 change 的规格是另一件事）；建议该 change 自行订正为 `007`（与本片的 `008` 不冲突） |
| 7 | **QM-6 CCG 双模型外部评审未执行** | M+ 复杂度任务缺外部评审这一环 | 需要有外部评审通道的环境补做 |
| 8 | **`official_credit_monthly` 的 `-1`（不限）语义** | 积分改余额制后 `-1` 进 `balance` 会击穿 `CHECK (balance >= 0)` 写坏账 | 下一期改 `null` 语义（"该档不发放积分"），DB 层 CHECK 兜底 |

## 附：三个用户决策的落点

| 决策 | 落点 | 状态 |
|---|---|---|
| 未用积分**不结转** | 发放周期边界（`identity_credit_accounts.period_start/end`） | 语义已在账本模型就位；**周期末清零的具体实现留到下一期**（与扣减接线同批） |
| 降档时未用积分**按 50% 保留** | 降级路径写 `adjust` 分录 | 下一期 |
| 免费档**禁用视频/图像模型** | `plan-matrix.js` features 派生层 | 下一期（**本片未实现，勿当已生效**） |
