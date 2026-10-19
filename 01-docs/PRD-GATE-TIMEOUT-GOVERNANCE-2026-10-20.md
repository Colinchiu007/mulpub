# PRD：全仓 CI 作业超时常量的取证治理（gate-timeout-all-cells，2026-10-20）

> 一句话：把「`timeout-minutes` 是无人看管的预算常量」从**一格**治理扩到**全仓 24 格**，
> 并装上**清单棘轮** —— 新增的裸常量、消失的登记项、变慢到不够用的作业，都在 PR 当场点名。

## 1. 为什么做这件事

来路三段，每一段都是一次真实的证据丢失或工具失明：

| 时点 | 现场 | 后果 |
|---|---|---|
| 2026-10-18 | `QG Coverage` 的 `timeout-minutes: 40` 撞死过两趟 main push（`39037127191` = #3836、`39084091986`），都恰好停在 40.0 分钟 | 不是"跑挂"，是 **main 侧证据永久丢失**（那一步连日志都没写完） |
| 2026-10-19 | 同一机制复测发现 60 也已不够（真实 max 43.3）⇒ 65；并修掉采样器把「在飞作业」当「漏样」⇒ **只要仓库有 CI 在跑就永远调不了预算** | 预算常量被冻结在过期读数上 |
| 2026-10-20（本片） | 全仓实测 **24 格** `timeout-minutes` 分布在 11 个 workflow，而**只有 1 格**有人看 | 其余 23 格是同型隐患：变慢 → 撞死 → 静默丢证据 → 无人察觉 |

**关键判断**：这次不是再改数字。24 格**当前全部满足** `timeout ≥ ceil(max × 1.5)`（最紧的 `Autonomous Loop` 30 vs 需 27、`QG Changes`/`debt-guard` 5 vs 2、`QG Static` 15 vs 12）。
真正缺的是**机制**：一个没人看的数字，只有在"新增它"和"它变慢"这两个时刻被拦下，才叫治理。

## 2. 治理面定义（先把边界钉死）

- **纳入**：`.github/workflows/*.yml` 中**作业级**（恰好 4 空格缩进）的 `timeout-minutes`。实测 24 格。
- **不纳入**：**步级**（>4 空格缩进）的 `timeout-minutes`（实测 2 格，均在 `electron-ci.yml` 的 `electron-tests` 内，值 10）。
  这不是遗漏而是分层：步级预算是"步内预算"，与作业天花板是两条不同规则；但它们**必须被显式列出**，
  不得静默忽略 —— 静默正是"这一层没人看"的成因。
- **缩进必须钉死**：`electron-tests` 的作业级是 **70**，步级是 **10**。用 `^\s+timeout-minutes:` 收会取到步级值，
  把 70 读成 10 ⇒ 对一格**合规**作业报 `UNDER_BUDGET`。**假违规与假绿同害**，所以解析器只认 4 空格并对此上锁。

## 3. 数据模型（单一真源）

唯一真源：`scripts/gate-timeout-registry.json`。数据与判据分离（先例：`doc-abs-paths-baseline.json`、`gate-record-debt-ledger.json`）——
改数不必改判据，审数不必读代码。

| 字段 | 语义 | 校验（fail closed，坏即抛） |
|---|---|---|
| `workflow` | 仓库相对路径 `.github/workflows/*.yml` | 形态不合法即抛 |
| `jobId` | workflow 里的作业键 | `^[A-Za-z0-9_-]+$` |
| `displayName` | 作业显示名（GitHub job name） | 必填非空 |
| `samplerPattern` | 可选，采样匹配前缀（矩阵/模板名作业必须给） | 若给必须非空 |
| `timeoutMinutes` | 该格天花板，**必须与 workflow 实际值逐字相等** | 正整数 |
| `state` | `measured` / `seeded` | 枚举之外即抛 |
| `provenance.samples` | **成功**样本数（别的档位会伪装成长尾） | ≥0 整数 |
| `provenance.maxMinutes` | 成功样本最大值 | ≥0 数字 |
| `provenance.p90Minutes` | 成功样本 p90 | `≤ maxMinutes`（否则抛） |
| `provenance.censoredAtCeiling` | 贴着该天花板被杀的趟数（**右截尾**证据） | ≥0 整数 |
| `provenance.ceilingMinutesSampled` | 采样窗口内**实际生效**的那条天花板 | 正整数；有截尾样本时 `≥ maxMinutes` |
| `provenance.runsListed` | 列出的 run 数（分母） | ≥0 整数；`samples ≤ runsListed` |
| `provenance.collectedAt` | 采集日，**UTC 日期**（与采样器逐字一致） | `YYYY-MM-DD` |

全局标量：`minSamples: 20`（一次读数不构成分布）、`staleDays: 90`、`seededGraceDays: 30`。
安全系数**不在这里** —— 取自 `scripts/gate-budget.js` 的 `SAFETY_MULTIPLIER`（1.5），不另立一份。

## 4. 判定规则（判据本体 `scripts/check-coverage-budget.js`）

### 4.1 逐格规则

| 规则 | 条件 | 为什么要它 |
|---|---|---|
| `PROVENANCE_VALUE_DRIFT` | 注册表值 ≠ workflow 实际值 | 表与 runner 不同源时，判据变成自证 |
| `UNDER_BUDGET` | `timeout < ceil(floor × 1.5)`，`floor = max(maxMinutes, 有截尾时的 ceilingMinutesSampled)` | 核心规则。`floor` 取法必须含截尾：被杀趟永不以 success 出现，只看 max 会系统性低估长尾 |
| `INSUFFICIENT_SAMPLES` | `state=measured` 且 `samples < 20` | 一次读数不构成分布 |
| `SEEDED_STALE` | `state=seeded` 但 `samples ≥ 20` | 攒够了却不升级 = 把宽限期当永久豁免 |
| `SEEDED_EXPIRED` | `state=seeded` 且 `age > 30` 天仍不足 | 宽限期到期必须重采或如实降级说明 |
| `STALE_PROVENANCE` | `collectedAt` 距今 > 90 天 | 数字不随仓库变，样本会 |
| `HUGGING` | `max ≥ HARD_RATIO × timeout`（HARD_RATIO 取 `gate-budget.js`，=0.9） | "贴天花板跑成功"是下一趟被杀的预告，不是安全证明 |

### 4.2 清单棘轮（本片的核心，两个新规则）

| 规则 | 条件 | 为什么 |
|---|---|---|
| `UNREGISTERED_TIMEOUT_CELL` | workflow 里出现 `timeout-minutes` 但注册表未登记 | **新增的裸常量不得溜进来**。没有这条，24 格只是一次性快照，下一个会话照样能加一个没人看的数 |
| `MISSING_TIMEOUT_CELL` | 注册表登记了，但 workflow 里已读不到该格 | 删/改名后必须同步，否则表会越来越像"全部合规"（假绿） |

### 4.3 退出码语义（不可混用）

- `0` 通过（逐格合规 + 棘轮通过）
- `1` 违规（点名规则与格；正解只有两条：重采样并更新注册表 / 抬 timeout；**禁止**改宽判据或删登记项）
- `2` 判据自身故障（读不到 workflow、`timeout-minutes` 非整数、注册表 JSON 坏、`--timeout` 未指名到格）
  —— **把工具的失明读成结论是本仓反复登记的老错型**，所以失明必须走 2，不得走 0 或 1。

## 5. 采集方法（可重跑是硬要求）

`node scripts/coverage-budget-sample.js [--workflow=<f>] [--job=<jobId|显示名>] [--limit=N] [--ceiling=M]`

- **坐标**：逐 run 拉 `/actions/runs/<id>/jobs`（`/actions/workflows/<id>/jobs` 本机实测 404）。
- **窗口**：默认 60 趟/工作流。样本不足 `minSamples` 时**扩窗，不凑数**（2026-10-19 的教训：60 趟窗口里 success 只剩 16 条 ⇒ 那是"样本不够下结论"，不是"预算够用"）。
- **在飞 vs 漏样（必须分开）**：
  - 在飞（`status != completed`）⇒ **不是漏样、不是样本**，单列 `in_flight=` 并打印；
  - 已完成却无时长 ⇒ **真漏样**，`rc=2` 拒绝出数。
  混同的后果是"只要仓库有 CI 在跑就永远调不了预算"。
- **矩阵归并**：`QG Desktop Shards (1/2)`/`(2/2)` 去后缀归并到同一格（否则样本恒为 0）。
- **模板名归并**：`Autonomous Loop (迭代 3 轮)` 用注册表里的 `samplerPattern` 前缀匹配（正名永远匹配不到）。
- **零样本必须出声**：某格窗口内无成功样本 ⇒ 明确打印"没采到"并 `rc≠0`，不得返回空表让人读成"没有长尾"。

## 6. 本轮实测数据（24 格，`collectedAt=2026-10-18`）

| # | workflow | job | 天花板 | 样本 | max | p90 | 需≥ | 余量 | state |
|---|---|---|---|---|---|---|---|---|---|
| 1 | agent-judge.yml | agent-judge | 15 | 29 | 1.3 | 1.3 | 2 | 13 | measured |
| 2 | autonomous-loop.yml | loop | 30 | 56 | 18 | 17.2 | **27** | **3** | measured |
| 3 | build.yml | changes | 5 | 26 | 0.4 | 0.4 | 1 | 4 | measured |
| 4 | build.yml | build | 60 | 18 | 6.1 | 6 | 10 | 50 | seeded |
| 5 | clock-shift-oracle.yml | 时钟位移引信巡检 | 45 | 2 | 17 | 17 | 26 | 19 | seeded |
| 6 | debt-guard.yml | 债务熔断检查 | 5 | 26 | 0.7 | 0.6 | 2 | 3 | measured |
| 7 | dep-audit.yml | 依赖漏洞审计 | 15 | 26 | 0.7 | 0.6 | 2 | 13 | measured |
| 8 | electron-ci.yml | changes | 5 | 28 | 0.6 | 0.4 | 1 | 4 | measured |
| 9 | electron-ci.yml | electron-tests | 70 | 15 | 30.1 | 3.4 | 46 | 24 | seeded |
| 10 | gui-test.yml | GUI Changes | 5 | 26 | 0.4 | 0.3 | 1 | 4 | measured |
| 11 | gui-test.yml | gui-gate-result | 5 | 14 | 0.1 | 0.1 | 1 | 4 | seeded |
| 12 | gui-test.yml | gui-test | 30 | 18 | 3.7 | 3.7 | 6 | 24 | seeded |
| 13 | ops-center-ci.yml | ops-center 后端测试 | 25 | 25 | 10.8 | 10 | 17 | 8 | measured |
| 14 | quality-gate.yml | QG Changes | 5 | 23 | 1.2 | 1.2 | 2 | 3 | measured |
| 15 | quality-gate.yml | QG Static | 15 | 16 | 7.9 | 7.9 | 12 | 3 | seeded |
| 16 | quality-gate.yml | QG Unit Tests | 55 | 17 | 3.6 | 3.5 | 6 | 49 | seeded |
| 17 | quality-gate.yml | QG Desktop Shards | 55 | 57 | 22 | 20.8 | 33 | 22 | measured |
| 18 | quality-gate.yml | QG Coverage | 65 | 53 | 43.3 | 41.4 | **65** | **0** | measured |
| 19 | quality-gate.yml | QG Visual | 20 | 16 | 5.4 | 5.1 | 9 | 11 | seeded |
| 20 | quality-gate.yml | QG Browser E2E | 20 | 17 | 7.3 | 7.2 | 11 | 9 | seeded |
| 21 | quality-gate.yml | QG Autonomous | 15 | 17 | 7 | 6.5 | 11 | 4 | seeded |
| 22 | quality-gate.yml | QG Business API Postgres | 15 | 18 | 1.1 | 1 | 2 | 13 | seeded |
| 23 | quality-gate.yml | Gate Result | 5 | 6 | 0.1 | 0.1 | 1 | 4 | seeded |
| 24 | visual-test.yml | visual-test | 20 | 30 | 5 | 4.4 | 8 | 12 | measured |

**无一处 `UNDER_BUDGET`** ⇒ 本片不改任何数字，只装机制。最紧的四处（余量 ≤4 分）：`QG Coverage` 0、`Autonomous Loop` 3、`QG Changes` 3、`debt-guard` 3、`QG Static` 3、`QG Autonomous` 4。

## 7. 接线（它防的是哪道短路，就落哪个作业）

落点：`quality-gate.yml` 的 **`changes` 作业**（Gate 2b7，已有该步，本片只扩范围）。
理由与 Gate 2b2/2b3/2b4 同口径：`static-gates` 带 `docs-only` 门槛，守门判据落在会被自己防的短路里 = 给自己关掉校验。
该作业**没有 Install deps** ⇒ 判据与加载器**只能 require node 内置模块**（已满足，并有锁）。

## 8. 给下一个维护者的操作手册

```bash
# 1) 复测某格（窗口按样本量决定，别为省时间缩窗）
node scripts/coverage-budget-sample.js --workflow=quality-gate.yml --job=coverage --limit=120
#    末行给出候选条目 JSON（12 个字段），逐字替换 scripts/gate-timeout-registry.json 里同名项
#    rc=2 ⇒ 采集不可信（probe 失败 / 真漏样），先修采集再谈预算
#    "零成功样本" ⇒ 那是"没采到"，不是"没有长尾"

# 2) 复测全仓（逐格）
node scripts/coverage-budget-sample.js --limit=60

# 3) 对账
node scripts/check-coverage-budget.js          # 必须 rc=0
node --test scripts/check-coverage-budget.test.js

# 4) 新增一格怎么办
#    先在注册表登记（state=seeded + 实测 provenance），否则棘轮会当场红；攒够 20 个成功样本后改 measured
```

## 9. 遗留（不假装已闭合）

- **12 格是 `seeded`**（样本 <20）：`build`、`clock-shift-oracle`、`electron-tests`、`gui-gate-result`、`gui-test`、
  `QG Static`、`QG Unit Tests`、`QG Visual`、`QG Browser E2E`、`QG Autonomous`、`QG Business API Postgres`、`Gate Result`。
  它们**规则①（预算够不够）已被强制**，但规则②（样本量）还没满足 ⇒ 30 天宽限期后若仍不足即判红（`SEEDED_EXPIRED`）。
  这不是放水：宽限期是"允许现在还不够"，不是"永远不用够"。
- **步级 `timeout-minutes`（2 格）不在治理面**：本片显式列出但未纳入。要纳入需要另一套规则（步内预算 + 前置开销），
  按"先修有证据的"排序留作后续。
- **`censoredAtCeiling` 全 0**：24 格在当前天花板下都没有贴脸被杀的本窗口证据。这意味着"够不够"仍只有 ×1.5 公式一个依据，
  未被截尾证据反向确认 —— 与 `QG Coverage` 65 那次同样的处境。
- **文件名沿用 `coverage-budget-*`**：执行体（`check-coverage-budget.js` / `coverage-budget-sample.js`）在本次是"就地扩成 24 格"，
  重命名会让单笔改动超过 CCG 的 200 行双审查阈值（实测改后 382 行 vs 原 191 行，git 判成 D+A 共 573 行）。
  新东西已用准确名字：`scripts/lib/gate-timeout-registry.js` + `scripts/gate-timeout-registry.json`。
  重命名留作一次**独立的小提交**（纯 `git mv` + 改 5 处 require，0 逻辑改动），那时 diff 只有个位数行。
- **`MIN_SAMPLES` 与另外三个"=20"** 同值不同事（分母是不同的池），**显式不许统一**（同前几片的判断）。
- **耗时仍在涨**：本轮 `QG Coverage` 43.3、`QG Desktop Shards` 22、`autonomous-loop` 18。若某格 max 逼近 0.9×天花板，`HUGGING` 会先叫；
  但**它需要有人去看那条读数**才生效 —— 这条机制只保证"变红"，不保证"有人行动"。
