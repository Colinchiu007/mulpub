---
record: coverage-timeout-provenance
task: 把 QG Coverage 的 timeout-minutes 从"无人看管的预算常量"变成有实测分布 + 每次 PR 机械对账的对象，并按规则抬 40→60
date: 2026-10-18
---

## 本次执行记录：QG Coverage 预算取证化（coverage-timeout-provenance，2026-10-18）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ | 混合 PR（`.github/workflows/` + `scripts/` 工具脚本 + 文档）：`classify-docs-only --base=origin/main --head=HEAD` = **false** ⇒ 走完整质量节拍，重型 job 不短路。worktree `mp-coverage-timeout-provenance` + 裸分支 `coverage-timeout-provenance`，由 `start-mp-task.ps1` 创建并过 `verify-worktree-deps`（11 项解析通过）|
| 第一性原因（QM-5 ①） | ✅ | 预算常量与"它够不够"之间**没有任何东西在看**：`timeout-minutes: 40` 自 `052599cbd`（#3313，2026-10-11）那次"job 上限 40→55"的治理中被留在原地——那一次治的是 Gate 4 / shard 的**步级预算对**，`coverage` 作业没有步级预算，于是成了漏网的一格。丢失形态：GitHub 掐掉整个作业 ⇒ 末尾汇总与诊断不写完 ⇒ **main 侧证据永久不可回答**（不是跑挂）。|
| 逃逸分析（QM-5 ②） | ✅ | **本行被自家 CI 纠正过一次，下面是纠正后的口径**（PRD §1b）。我初稿写"没有任何东西在看这个数"——不成立：`scripts/gate-budget.test.js:168` 钉着字面量 40，理由"coverage job 没有 WaitForExit 站点，本次不得顺手改它"；本 PR 第一次推上去就是被它判红（`QG Static` `not ok 128`，`expected 40 / actual 60`）。真实形状比"没人看"更值得记：**那条锁的理由是对的，但它把"不动"写成了结论**，于是"40 够不够"从未进入任何判据 —— 既有锁可以既精确又守错东西。另三条照常漏过：CI 全量测试（预算不属测试面）、`workflow-contract` 结构锁（看步骤名不看数值充分性）、`gate-budget.js` 真源（作用域写死在 Gate 4 / shard）。#3836 那次我读到 `cancelled` 并归因到天花板，但归因只落在文档、没落进判据：**读到了 ≠ 有人在守**。|
| 修复 + 回归保护（QM-5 ④） | ✅ | ①`timeout-minutes: 40 → 60`（= `ceil(39.7 × SAFETY_MULTIPLIER)`，系数 require 自 `scripts/gate-budget.js`，不新写第二个 1.5）；②单点取证 `scripts/lib/coverage-budget-provenance.js`；③可重跑采集 `scripts/coverage-budget-sample.js`；④对账 `scripts/check-coverage-budget.js` 五条判据（UNDER_BUDGET / HUGGING / INSUFFICIENT_SAMPLES / STALE_PROVENANCE / PROVENANCE_VALUE_DRIFT），读不到数值走退出码 2。回归锁 `scripts/check-coverage-budget.test.js` **17 条**，含"改哪格读哪格"的双向对照、截尾 floor 的正/反向对偶、截尾单边的双向对照（40.3 算 / 30 不算）、字段同源 parity、漏样可见性。⑤ **被改到的既有锁同步更新**：`scripts/gate-budget.test.js` 那条钉 40 的断言改为等值于本片单点（不把字面量从一处搬到另一处），并配 M11b 反证。|
| 防止再次发生（QM-5 ⑤） | ✅ | ① Gate 2b7 接线（`changes` 作业、`shell: bash` fail-fast、只用内置模块）；② `check-unwired-tests.js` 实跑（提交后再跑一次作数，`git ls-files` 域）；③ `.gitignore` 补两条 negation（`scripts/*.js` 默认吞新脚本，`git add` 会当场报错）；④ PRD `01-docs/PRD-COVERAGE-TIMEOUT-PROVENANCE-2026-10-18.md`（含 §1b 那条被 CI 纠正的过断、"为什么不复用 gate-budget 的全部"、以及"60 这条新天花板还没有数据"三处诚实边界）；⑤ 记忆更新（预算常量的取证化落点）。|
| 行尾与 diff 对账 | ✅ | 改动文件 `git diff --numstat` 与 `--ignore-cr-at-eol --numstat` 逐档相等（以当场打印为准，见提交前自测块）|
| 接线棘轮 | ✅ | 新增 `scripts/check-coverage-budget.test.js` **在同一次改动里**登记进 `quality-gate.yml` Gate 2b7；编号取 2b7 而非 2b5（`#3724` 占用 "Gate 2b5 - CCG evidence anchor"，2b6 已被占）——同号会在 squash 后撞成两步同名|
| QM-1 打包 / QM-4 视觉 | N/A | 未触 `apps/desktop/electron/`、`packages/rpa-engine/` 与任何渲染面；改动是 CI workflow 与根级门禁脚本|
| QM-6 CCG 双模型外部评审 | ✅ 两轴各有实物（后端走替代通道） | 前端＝**规定通道 claude**，审 `1b6fbbe83`（F1–F4，采纳 3 拒绝 2）；后端＝**替代通道 nemotron**，审 `7bd844c2b`（C1–C4，采纳 1 拒绝 2）—— 规定 codex 13.2 min 零结论、替代通道首投 503，第三次自愈成功。跨家族独立性因此**打折**，逐次读数与每条复量见「QM-6」节 |
| 远程同步 | 由门禁推导 | 本 PR 不手写状态词、不为收口另开 PR（`gate-record-sync-derived-status` / #3879）；合并发生即由 `scripts/lib/merge-ledger.js` 推导收口 |

## QM-6（如实登记）

### 通道读数（逐次，不写"失败了"，写它当场回了什么）

| 轴 | 通道 | 派发 | 现场读数 | 结论 |
|---|---|---|---|---|
| 前端 | **规定** `[routing.frontend].primary=claude` | 10:59Z 起 | rc=0、5.1 min、stdout **11880 B**、artifact 未写（结论在 stdout 段）、正文首行回显 `1b6fbbe83` + 8 文件差量 | **出货**，审的就是这个 head |
| 后端 | **规定** `[routing.backend].primary=codex` | 10:59Z 起，16 min 预算 | rc=1、13.2 min、stdout 只有 `SESSION_ID` 分隔行、artifact 不存在 | 零结论（既有第 5 种死法复发：`missing field cmd` 类工具层畸形） |
| 后端 | 替代 `opencode/nemotron-3-ultra-free` | 11:1x 起 | rc=1、1.9 min、stderr `Error: Streaming response failed: [503] Upstream error from Nvidia: Service temporarily overloaded`、stdout 0 字节 | 零结论（同模型 02:30 的 PONG 探针仍通 ⇒ 是上游瞬时过载，不是额度门槛也不是任务书） |

**后端轴第三次于 `7bd844c2b` 出货**（前两次的零结论原样保留在表里，不改写）：所以本 PR 是**两轴各有实物**，
但后端走的是**替代通道**、规定通道 claude 只成了前端一轴 ⇒ 跨家族独立性按本仓口径打折，如实记在这里；
不以自审冒充交叉审查这条仍然生效（第三次确实由 codex 派发失败后由另一模型交付）。
`:15721` 本轮实测 **OPEN**，所以原因**不能**写成"CC Switch 没起"。

### 前端轴四条的处置（每条都当场对代码复量过再决定采纳/拒绝）

| 项 | severity | 主张 | 复量 | 处置 |
|---|---|---|---|---|
| F1 | info | 与既有 `scripts/gate-budget.js` 是"同一问题抄两份"还是"两个问题各守各的"？哪些常量真被复用 | 复量：`SAFETY_MULTIPLIER` 与 `HARD_RATIO` 确实 require 过来（未新写 1.5 / 0.9）；`MIN_SAMPLES=20`、`STALE_DAYS=90`、`TIMEOUT_MINUTES=60` 属本作业自有量 | **判"分开成立"采纳**；它另点出一条有用的：仓库里现在有**四个 =20**，同值不同事 ⇒ 写进 PRD 遗留并**显式禁止统一** |
| F2 | low | `floor` 这个名字会被读成统计下界（它其实是"由右截尾推出的观测上界"） | 成立。`floorMinutes` 无任何程序消费者 | **改读数现场不改字段名**：改名需另配一份字段清单锁才算有锁（与 #3875 那轮 F1 同口径）；readout 增打 `余量=`，并把截尾标签从"天花板 40 分"改成"绑 40 分那条天花板，非当前值" |
| F3① | low | PRD 写"贴天花板 ±0.5"，代码是单边 `ceiling − min ≤ 0.5` | **成立，且代码是对的、文档是错的**：单边含"杀在天花板之上几十秒"（40.3，GitHub 掐作业有收尾延迟），改成绝对值反而会漏掉这一格 | **采纳**：文档改单边口径 + 新增测试 8b 双向锁（40.3 算、30 不算）—— 这条把一片原本的"已知盲区"关掉了 |
| F3② | low | workflow 注释把 39.4/39.4/39.5/39.5 写成 39.4/39.5 | 成立，属省略重复值，非矛盾 | 不改 |
| F4 | medium | 被拦者判断"该抬数值还是该重采集"缺三个读数：`required − timeout`、p95/p99、`censored_at_ceiling` 绑的是旧天花板而 stdout 看不出 | ①缺，成立；②n=24 时 p95≈max，加了是重复读数；③**前半不成立** —— readout 一直打印 `(天花板 40 分)`；后半成立且更重要：**60 这条新天花板当前无任何数据** | **①采纳**（`余量=` 实跑核对：`timeout=60 需≥60 余量=0 分`）；**②拒绝**并写明理由；**③按"新天花板还没有数据"重写进 PRD 遗留**，同时把标签措辞改清楚 |

### 后端轴第三次重投：出货（替代通道 nemotron-3-ultra-free，7.0 min，stdout 1901 B，回显 head `7bd844c2b`）

前两次零结论（规定 codex 13.2 min / 替代通道 503）后按"先等自愈"重投第三次于本 head 成功 ⇒ **后端轴不算未跑成**，
但审的是 `7bd844c2b`（第二笔），不是初稿。四条处置：

| 项 | severity | 主张 | 复量 | 处置 |
|---|---|---|---|---|
| C1 | info | 60 与 `ceil(39.7×1.5)` 吻合、provenance 与采集产出口径一致（只数 success、截尾不混入 max、被杀趟单独计） | 逐字段核对一致 | 无需动作（它同时确认了口径） |
| C2 | Warning | `censoredAtCeiling` 若被误标成 0，`UNDER_BUDGET` 可被绕过判 OK | **已有对偶兜住**：那种情形下 `max` 仍会贴脸（现场 39.7/40=0.9925）⇒ `HUGGING` 先红，测试 11 就是拿 `censoredAtCeiling: 0` 做的正控。残余（runner 关机也报 cancelled、API 不给原因）已在 PRD 遗留 | **拒绝为它改判据**，指回测试 11 + 遗留第一条 |
| C3 | Warning | ①test 1 只验"改 visual 格不影响 coverage"；②test 7/12 只比键名集合，不验 `samples`/`maxMinutes` 的语义；③`noDuration` 只报错不阻断 | ①不成立：test 1 同时断言 `r.timeoutMinutes === 60`，块域一旦指到文件里第一格（5 分）就读不出 60；②**成立且是真洞**：键名 parity 对"字段语义漂移"结构性免疫；③**不成立**：`coverage-budget-sample.js:175-179` 明确 `return 2` | ②**采纳**：test 7 加三条语义断言（samples 是计数、maxMinutes 必须是成功样本最大值而非全局、p90 ≤ max），配反证 **M12**（把 `maxMinutes` 改成含被杀趟的全局最大值 ⇒ 2 条红且点名，还原逐字节相同）；①③按实测拒绝并留行号 |
| C4 | info | 只用内置模块、采集脚本不会被 CI 误跑、`gate-result` 的 `needs` 仍含 coverage ⇒ required 语义未变 | 逐条核对一致 | 无需动作 |

两轴合计：**前端采纳 3 拒绝 2、后端采纳 1 拒绝 2**（各附实测理由）。规定通道仍只跑成一条（claude 前端轴）；
后端走的是替代通道 ⇒ 跨家族独立性按本仓口径打折，如实记在这里。



### 本片的第三个"外部眼睛"来自自家 CI，不是模型

`QG Static` 第一次跑就红在 `scripts/gate-budget.test.js:168`（钉 40 那条）。它既否证了我 PRD 初稿"没有任何东西在看这个数"，
也把真正该改的东西指出来：**那条锁钉的是决策的边界，不是决策的依据**。这条纠正比评审任何一条都更硬，因为它是执行出来的。

## 自测块（提交前当场跑）

```
node --test scripts/check-coverage-budget.test.js   → tests 17 / pass 17 / fail 0
node --test scripts/gate-budget.test.js             → tests 25 / pass 25 / fail 0（含本片重写的 coverage 钉）
node scripts/check-coverage-budget.js               → timeout=60 需≥60 余量=0 分 floor=39.7 samples=24 ⇒ RC 0
node scripts/coverage-budget-sample.js --limit=60 --ceiling=40 → 60 趟窗口，probe_errors=0
变异反证                                            → 12 道逐条实跑，红集互不相同，12/12 CAUGHT
                                                        （10 道判据/采集器 + M11b 委派锁 + M12 字段语义漂移）
                                                        + 一条接线反证（摘 Gate 2b7 ⇒ unwired 点名，还原逐字节相同）
```

被改到的既有套件同跑：`scripts/gate-budget.test.js` **25/25**（含本片重写的 coverage 钉）。
CI 现场：`Gate 2b7 - Coverage budget provenance` 在 `QG Changes` 里实跑（该作业 rc=success）；
第二条记录同时纠正一处我自己的过程错误 —— **看守日志被两只进程串台**（新那只启动时截断了旧那只在写的文件，
旧那行的 `SHA_CHANGED` 落进新日志尾部 ⇒ 读末行会误判"当前看守放弃了"），已按 `grep -c '^# watcher'` 与
`gh pr checks` 独立回读双源核过，不拿日志末行当结论。
