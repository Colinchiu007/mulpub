---
record: credit-cost-accounting-phase1
task: 积分成本核算 Phase 1 —— 版本化价格卡、事件级用量表、PG 侧积分账户与不可变账本、已有用量的服务端成本回算
date: 2026-10-23
branch: credit-cost-accounting-phase1
---

## 本次执行记录：积分成本核算 Phase 1（credit-cost-accounting-phase1，2026-10-23）【混合 PR】

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ | **混合 PR**：运行时代码（`packages/api-publish-engine/src/auth/**`、`ops-center/backend/**`）+ 迁移文件（`migrations/postgresql/**`）+ 文档（`01-docs/**`）。裸分支 `credit-cost-accounting-phase1`（`rev-parse --abbrev-ref HEAD` 实证）。⚠️ 隔离方式与仓库正规入口 `scripts/start-mp-task.ps1` 不同：本次在**独立 clone 的仓库**内工作（沙箱无 D 盘与 PowerShell 入口），共享根未被他人在飞会话占用；已在该 clone 内完成 `git worktree prune` 清掉一次被中断的 worktree 残留。**基线已 rebase 到最新 main**（`origin/main` = `b642881`），`git diff origin/main..HEAD -- CHANGELOG.md` 为空 |
| 第一性原因（QM-5 ①） | ✅ | 不是"缺一张价格表"（`official_keys.cost_per_1k_tokens` 与 `model_usage_daily.cost` 都已存在），而是**三者没接上线**：① `consumeFeature` 只被用于**次数配额**（`publish-api-server.js:639/665` 扣 `cloud_publish`），**积分额度 `official_credit_monthly` 从未被扣**；② 代码自认「单价换算属 ModelPriceCard 后续立项」（`model-provider-manager.js:371`）；③ `model_usage_daily` 只按 `client_id` 聚合、**无 `user_id`** ⇒ 成本无法归到用户；④ 成本由客户端算、服务端只校验非负，单一混合单价且**无价格版本化** |
| 逃逸分析（QM-5 ②） | ✅ | ①**无测试载体**：价格换算与账本原子性此前无任何测试；②**测试执行层**：api-publish-engine 用 `node scripts/run-tests.js`（非 vitest），不在册文件走 `node --test` 直跑——新测试须写成 `node:test` 风格否则 `describe is not defined`；③**信任边界层**：`usage_service._validate_item` 只做类型/非负校验，`cost` 与 `tokens` 的自洽性无人校验 |
| 修复 + 回归保护（QM-5 ④） | ✅ | 新增 **17 例**：① `test/credit-ledger-migrations.test.js`（8 例）—— 迁移与开发态 SCHEMA **逐语句防漂移**（去注释 + 忽略空白，比对口径照抄 006）+ 余额非负 CHECK / 分录白名单 / 幂等索引口径锁定；② `test/credit-repository.test.js`（8 例）—— 发放幂等、消耗幂等、**余额不足不写分录**、amount 正整数校验、周期边界校验、**扣减语句必须带 `balance >= $2`**（并发下只允许一个扣成功）；③ `ops-center/backend/tests/test_credit_price_service.py`（9 例）—— 成本按 1K token 口径、**整数分无浮点漂移**、**缺价格卡显式上报而非静默按 0**、积分向上取整、倍率、单价为 0 的除零兜底、跨年周期边界。实测读数：`node --test` 8/8 + 8/8 全绿；`pytest` **9 passed** |
| 防止再次发生（QM-5 ⑤） | ✅ | ① 新增 `01-docs/usage-metering-spec.md` 固定口径（五类 token / 整数分 / 版本化价格 / 信任边界 / 缺价不许静默）；② 漂移锁进 `test/credit-ledger-migrations.test.js`（`check-unwired-tests.js` 按 `run-tests.js` 的 `test/*.test.js` 发现机制纳入）；③ 成本计算拆成**纯函数**（`compute_cost_cents` / `compute_credit_cost`）⇒ 口径可被单测直接锁死，不依赖 DB |
| 迁移编号的唯一性纪律 | ✅ | **`008_credit_ledger.sql`**——不是凭规格写的编号：`ls migrations/postgresql/` 实测当前为 002~006；`007` 已被活跃 change `compute-key-envelope-migration` 预定（其 tasks 3.1 写的仍是已被占用的 `006_official_key_envelopes.sql`，**该订正至今未落到文件**，本片不代改，只在 §遗留记录）；本片占 `008` |
| 加文件与执行同批部署 | ✅ | 迁移文件与开发态 SCHEMA（`credit-schema.js`）**同批入库**；`postgres-identity-repository.js` 的 `SCHEMA` 与 `REQUIRED_SCHEMA_RELATIONS` 同批追加（`identity_credit_accounts` / `identity_credit_ledger`），满足 `allowPending:false` 的启动期硬失败前置条件 |
| 债务基线（filesOver500） | ✅ | 新增代码**全部单独立文件**，未推高既有超限文件：`postgres-identity-repository.js` 428→432 行（+4，仅 require + SCHEMA 展开 + 关系表两项）；`models.py` 804 行**未改动**（新 ORM 落 `models_credit.py`）；`publish-api-server.js` 1573 行**未改动**；`model-provider-manager.js` 1283 行**未改动** |
| 接线棘轮 | ✅ | api-publish-engine 两个新测试走 `node --test` 直跑分支（**不登记进 `VITEST_FILES`** —— 登记进去反而会报 "No test suite found"，口径与 `member-commerce-migrations.test.js` 一致）；ops-center 新测试由 pytest 按 `tests/test_*.py` 发现；新 ORM 由 `database.init_db()` 内延迟 import 注册进 `Base.metadata`（否则 `create_all` 不建这三张表） |
| QM-1 打包 / QM-4 视觉 | N/A | 未触碰 `apps/desktop/**` 与任何 `.vue` / 样式 / locale 文件 ⇒ 无打包面与视觉面变更 |
| 门禁判据（`check-gate-record-debt`） | ❌ **主干红，非本 PR** | 本 PR 与 `origin/main` **同判据同读数**：均为「声明的来源 PR 与主干事实不符 **7 篇**」。那 7 篇全是**他人记录**（`error-message-user-friendly-audit` / `hotfile-docs-error-message-audit` 等），本 PR 未触碰其任一文件。跨源比对现场：配对 131 组 / 违例 0 / 承认 0 |
| 门禁判据（`check-pr-exec-record`） | ✅ | `OK: 本 PR 携带执行记录或带原因的豁免`；读数：本 PR 变更文件 **16 个**（A=12 M=4 D=0）/ 新增记录 **1 篇** |
| 门禁判据（`check-main-red`） | ❌ **判据自身故障 exit=4** | 需 `gh` CLI，本机无 ⇒ `pickBaseline` 取数失败。**已用 API 做等价差集取证**：PR 侧 9 项检查 **0 红**、主干侧 **0 红** ⇒ **本 PR 新增红 0**。⚠️ 但**主干红 ⇒ 按 AGENTS.md「禁止自动合并」须停下报告用户**（本 PR 不是去修那条红的） |
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

---

## 本 PR 自身的失误与修正（2026-10-24 复盘，如实记）

### 失误 1：把主干的 `CHANGELOG.md` 整段删掉了 436 行

**起因链**：初次提交基于 `c1c6880`，主干随后前进到 `9e95b7fe` → `b642881`。
`git rebase` 遇冲突时走了 `git commit` 而非 `git rebase --continue`，
把工作区里那份**旧版 CHANGELOG.md** 整文件带进了提交 ⇒ 相对新主干净删 **436 行**。

**形态**：**无声还原**——diff 只显示删除，看不出是我方误带；只有把
「PR 的 changed_files / 增删行数」与「我提交时的读数」对比才发现：
PR 侧 `17 个文件 / +2062-3`，而我提交时是 `15 个 / +1869-1`。

**修正**（2026-10-24）：rebase 到最新 `origin/main`（`b642881`），冲突处 `CHANGELOG.md`
取 **main 版**（`git checkout --ours`，rebase 的 ours = upstream）。
取 main 版**不是"后推覆盖"**——本 PR 本就不该有 CHANGELOG 变更
（台账的唯一写入口是 `scripts/aggregate-changelog.js`，PR 直改会与并发合并冲突），
所以「放弃我方那份删除」才是正解。修正后 `git diff origin/main..HEAD -- CHANGELOG.md` **为空**，
436 行删除归零，`mergeable` 由 `False` 变 `True`。

**教训**：`git rebase` 遇冲突**不要用 `git commit` 绕过**——正确路径是
`git checkout --ours/--theirs` → `git add` → `git rebase --continue`；
用 `git commit` 会把冲突文件按**工作区内容整文件**带入提交。
末尾追加型写面（`CHANGELOG.md` / `.quality-gates.md` / `scripts/gate-record-debt-ledger.json`）
尤其危险，因为它们在 diff 里只会表现为"删除"。

### 失误 2：另一个自动化会话的修复 commit 在 rebase 后成了空提交

CI 失败后有一条自动修复流程在本 PR 上补了两个 commit：
① `fix(ops-center): 重新生成端点鉴权面清单，消掉 auth-surface 夹具漂移`
   （本 PR 新增 `credit_pricing.py` 路由 ⇒ 端点鉴权面清单 `ops-center/backend/tests/fixtures/auth-surface.json`
   漂移导致 CI 红；该修复已保留在分支上，+92/-1）
② `fix(changelog): 还原被本 PR 整段删掉的 101 行既有条目`
   ——它在**当时的 base** 上还原；而主干又前进后，rebase 使它成为**空提交并被丢弃**。
   效果等价（CHANGELOG 直接取 main 版，比逐行还原更彻底且不丢任何内容），
   但**没有留下"由谁还原"的痕迹**，故在此如实记录。

### 现象复盘：为什么本地全绿而 CI 红

`check-gate-record-debt` / Gate 2b11 等判据在**本地与主干上都绿**，
但 CI 红——根因是 CI 跑的是 **merge ref**（`refs/pull/4322/merge`）：
PR 当时有 CHANGELOG 冲突 ⇒ GitHub 生成 merge commit 时把**冲突标记**带进文件 ⇒
解析 CHANGELOG 的判据在 CI 上红，**本地却永远看不到**（本地 checkout 的是纯 head）。
⇒ **判据只在 merge ref 上暴露的问题，本地复现不了**；`mergeable=False` 本身就是最早的红信号。

---

## 门禁失败的定位与修复（2026-10-24，`QG Unit Tests` 红）

### 现象

CI 的 `quality-gate` / `QG Unit Tests` 红，失败 step 是 `Gate 4 - Workspace unit tests`
（Windows runner + nx run-many 的 workspace 单测）。**日志端点 401**（本机 PAT 无 Actions log 读权限），
`gh` CLI 又装不上（TLS 握手失败）⇒ **拿不到失败输出**，annotations 只有一句
「Process completed with exit code 1」。

### 定位路径（没有日志时怎么找到根因）

1. **先排除主干责任**：查 `origin/main` 的 tip 与最近 8 个主干 PR 的 `QG Unit Tests`，
   **全部 success** ⇒ 这个红是本 PR 引入的，必须自己修（不能归为"主干红"）。
2. **本地复跑我的新测试**：`credit-ledger-migrations` / `credit-repository` 均 8/8 绿
   ⇒ **不是新增测试自身的问题**。
3. **本地全量跑**：得 20 个 `not ok`，但根因是 `MODULE_NOT_FOUND` at `src/base-adapter.js:1`
   ⇒ **本地没装 node_modules，这批红全是环境噪音，不可用**（差点据此误判方向）。
4. **定向 grep**：找"断言了 `REQUIRED_SCHEMA_RELATIONS` 内容"的测试 ⇒
   `test/postgres-identity-repository.test.js` 有**三处硬编码清单**（`expected` /
   `expectedRelations` / 「生产迁移 ↔ 运行时表一致性」那张表名列表）。
5. **探针法定位全部同步点**：用 006 那张表的 `identity_payment_customers` 作探针，
   `grep` 全仓找出 006 加表时同步过的**每一个**位置 ⇒ 确认需要同步的是 **3 处**
   （其中第 3 处在 155 行，**只看前两处会漏**）。
6. **本地复跑确认**：修完 57/57 全绿（7 个相关测试文件）。

### 根因

`REQUIRED_SCHEMA_RELATIONS` 加了 `identity_credit_accounts` / `identity_credit_ledger`，
但**既有测试里那三份硬编码清单**没同步 ⇒ readiness 断言拿"期望 13 张表"比"实际 15 张表"，
报 `BUSINESS_DATABASE_SCHEMA_NOT_READY`；第 3 处「生产迁移 ↔ 运行时表一致性」只拼了
002~006 五个迁移文件，**我的 008 不在其中** ⇒ 运行时要求存在的表在生产迁移里查不到。

### 修法

三处清单按 `REQUIRED_SCHEMA_RELATIONS` 的**同一顺序**追加两张表（顺序必须一致：
`assert.deepStrictEqual(calls[1].values, [expected])` 逐项比对），
第 3 处的迁移文件列表补上 `'008_credit_ledger.sql'`。

### 教训

- **「运行时清单」是多方硬编码的**：改了 `REQUIRED_SCHEMA_RELATIONS` 就要同步**每一份**副本。
  探针法（拿上一张同类表作 grep 锚点）比逐个读文件快，也比"我以为只有一处"可靠。
- **本地全量红 ≠ 真的红**：先看失败原因是**断言不符**还是**环境缺依赖**，两者会把你引向完全相反的方向。
- **CI 日志拿不到时的替代路径**：主干对比 → 新测试单跑 → 既有测试定向 grep → 探针法。
  没有日志不等于查不出来。
