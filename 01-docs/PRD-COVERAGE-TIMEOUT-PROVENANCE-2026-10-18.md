# PRD：QG Coverage 预算常量取证化（coverage-timeout-provenance，2026-10-18）

## 1. 这片修什么

`.github/workflows/quality-gate.yml` 的 `coverage` 作业带 `timeout-minutes: 40`，而**没有任何东西在看这个数够不够**。
它不是"跑挂"型故障，而是**证据丢失**型：GitHub 在 40 分钟掐掉整个作业，末尾的汇总与诊断都不写完，
于是这次合并到底在 main 上有没有拿到 QG 证据，这件事**永久不可回答**。

两条当场读数（都不是推算）：

| 现场 | 读数 | 取法 |
|---|---|---|
| 被天花板杀掉的两趟 | run `39037127191`（PR #3836 的 main push）与 run `39084091986`，**都恰好停在 40.0 分钟** | `gh api repos/<repo>/actions/runs/<id>/jobs` 取 `QG Coverage` 的 `started_at`/`completed_at` |
| 成功样本贴着天花板过线 | 当前 60 趟窗口里成功尾部是 39.4 / 39.4 / 39.5 / 39.5 / **39.7**（39.7 ÷ 40 = **0.9925**） | `node scripts/coverage-budget-sample.js --limit=60 --ceiling=40` 现场输出 |

合起来说明 40 不是"够用但运气差"，而是**已经没有余量**。

## 1b. 更正一条我在 PR 初稿里写下的过断（被自家 CI 当场纠正）

我最初写的是「没有任何东西在看这个数」。**不准确**：仓库里有一条锁钉着它 ——
`scripts/gate-budget.test.js:168`（#3313 引入）原文是 `assert.equal(cov.timeoutMin, 40, 'coverage job 没有 WaitForExit 站点，本次不得顺手改它')`。
本 PR 第一次推上去时，`QG Static` 就是被这条钉红的（`not ok 128`，`expected 40 / actual 60`）。

真正的漏洞形状比"没人看"更值得记：**那条锁的理由是对的**（coverage 确实没有步级 `WaitForExit` 预算），
**但它把"不动"写成了结论** —— 于"40 够不够"这个问题从没有进入过任何判据。
既有锁可以既精确又守错东西（本仓"装饰性门禁"的第 N 种落点：**锁钉住的是决策的边界，不是决策的依据**）。

处置不是把 40 改成 60 了事（那只是把裸字面量从一个文件搬到另一个文件），而是把它**委派**给本片的单点：

```
assert.equal(cov.timeoutMin, covProv.TIMEOUT_MINUTES, '…… 不得在本文件另写字面量')
```

反证 M11b 已实跑：把 workflow 改成 45 ⇒ `gate-budget.test.js` 红 1 条且**点名这条断言**，还原后逐字节相同。
于是"改数值不改出处"这条路现在同时被两处拦：那条委派锁 + 本片的 `PROVENANCE_VALUE_DRIFT`。

## 2. 为什么不复用 `scripts/gate-budget.js`（以及复用了什么）

`gate-budget.js` 是本仓既有的预算单一真源（#3313 立），它守的是 **Gate 4 / Desktop shard 的步级 `WaitForExit` 预算 + 作业上限**这一对；
本作业**没有步级预算**——天花板就是它唯一的预算，所以那条"内层预算 + 前置开销 + 余量再取整"的双层规则在这里退化成一层。
把两套强行合并会让其中一套在另一套的形态上**静默失效**（正是本仓反复登记的"各抄一份"反面：同一句话服务两个不同问题）。

真正同源的那个数**确实复用了**：`SAFETY_MULTIPLIER` 与贴脸比例 `HARD_RATIO` 都从 `scripts/gate-budget.js` require 过来，
本片没有新写一个 1.5 或一个 0.9。

## 3. 改成什么

1. `timeout-minutes: 40 → 60`。60 = `ceil(39.7 × 1.5)`，也是"被 40 杀过两趟"之后仍有整分钟余量的最小档。
   **不是** 55（同文件兄弟作业那档）：55 只比观测最大值多 15%，低于本仓自己那条 ×1.5 规则——
   本片判据当场就会把 55 判成 `UNDER_BUDGET`，这是自我一致，不是巧合。
2. `scripts/lib/coverage-budget-provenance.js`：数值 + 分布 + 采样窗口 + 天花板锚点，单点持有。
3. `scripts/coverage-budget-sample.js`：**可重跑的复测入口**（AGENTS「实测分布支撑必须自带一条可重跑的采集路径」的落点）。
4. `scripts/check-coverage-budget.js`：每次 PR 对账，接在 `quality-gate.yml` 的 **Gate 2b7**（`changes` 作业，只用 node 内置模块——那个作业不装依赖）。

判据五条（`--timeout=` 只用于注入坏值做负控，不作为绕过口）：

```
UNDER_BUDGET           timeout < ceil(floor × SAFETY_MULTIPLIER)，
                       floor = max(成功最大值, 有被杀趟时的采样天花板)   ← 右截尾
HUGGING                max ≥ HARD_RATIO(0.9) × timeout ⇒ 即便上条仍站得住也必须重定数
INSUFFICIENT_SAMPLES   成功样本 < 20（一次读数不构成分布）
STALE_PROVENANCE       采集日距今 > 90 天
PROVENANCE_VALUE_DRIFT provenance 记的数值 ≠ workflow 那一格的实际值
```

## 4. 为什么 `floor` 不能只看成功最大值（这条是本片的技术内核）

被天花板杀掉的趟**永远不会以 success 出现** ⇒ 成功样本是**右截尾**的。只看 `maxMinutes` 会系统性低估长尾：
更糟的是，只要有一趟成功恰好贴着天花板过线（今天就是 39.7），
"用观测到的最大值当天花板"这种偷懒写法会把真正被杀的那两趟**全部读成 0**——判据最关键的输入自己失效。
所以：天花板必须**显式给定**（`--ceiling=`，默认取 workflow 现值；回答"上一代天花板杀了几趟"要显式传 40），
且 `censoredAtCeiling` 是**单边下界**：`ceiling − 时长 ≤ 0.5` ⇒ 含"杀在天花板之上几十秒"（GitHub 掐作业有收尾延迟，40.3 这种形态最常见），
排除"中途取消 / 被新 push 顶掉"（30 分的 cancelled 不算）。写成 `|ceiling − min| ≤ 0.5` 反而会把前一格漏掉 —— 这条由测试 8b 双向钉住。

## 5. 采集坐标本身会骗人（三条现场纠正）

- `/actions/workflows/<id>/jobs` 与 `/actions/workflows/quality-gate.yml/jobs` 在本机 gh 下**一律 404**（数字 id、路径名、带不带 `name` 过滤共 5 种形态全试）；
  能用的是 `/actions/runs/<id>/jobs`。后者只返回**最新 attempt** —— 那正是决定该 check 的那趟，符合取证口径，但重跑过的 run 会覆盖旧 attempt 的证据（既有记忆已记）。
- 第一次读数（`max=28.6`，n=28）与第二次（`max=39.7`，n=24）**不是同一批样本**：窗口按"最近 60 趟"滑动。
  所以 provenance 必须连窗口一起写（`runsListed` + `collectedAt`），否则下一个人复测得到不同的数，会以为判据不稳定。
- `skipped`（docs-only PR 按设计短路整个作业）时长为 0，**不是样本缺失**；而"活跃却取不到时长"是**漏样**。
  两者必须分开计数，且后者 >0 时采集器直接以非零码失败——否则"没采到"会被读成"没有长尾"。

## 6. 证据

- 自测 **17/17**（`node --test scripts/check-coverage-budget.test.js`），先红后绿：首跑红在 `Cannot find module`，实现后逐条转绿。
  被改到的既有套件同跑：`scripts/gate-budget.test.js` **25/25**（含本片重写的那条 coverage 钉，见 §1b）。
- **11 道变异反证逐条实跑、红集互不相同、11/11 CAUGHT**：10 道判据/采集器内部形态 + M11b（委派锁反证），
  另有一条**接线反证**（摘掉 Gate 2b7 的 `node --test` ⇒ `check-unwired-tests.js` 立刻点名新测试文件，rc=1）。
  驱动都在 `.tools/tmp/coverage-timeout/`，基线先证绿、还原按 md5 逐字节核对。
  M11b 第一次跑被**我自己的探针字符串**骗过一次：我搜"不许在本文件另写字面量"，断言原文是"不得……" ⇒ 误判成"没点名"；
  改搜断言原文子串后才看到它确实点名。读数与断言文本必须逐字对上再下结论。
- 现场读数：`[COVERAGE-BUDGET] job=QG Coverage timeout=60 需≥60 余量=0 分 floor=39.7 samples=24 max=39.7 p90=39.4 censored_at_ceiling=0(绑 40 分那条天花板，非当前值) collected=2026-10-18 age_days=0 ⇒ OK`。
- 注入负控：`--timeout=1` ⇒ `EXIT_VIOLATION`（1），`--timeout=40` ⇒ `HUGGING` + `PROVENANCE_VALUE_DRIFT` 同时点名。

## 7. 遗留（不假装已闭合）

- `censoredAtCeiling=0` 只描述**它声明的那个窗口**（最近 60 趟）。两条 40.0 的杀记录在窗口滑动之前，已作为现场写进第 1 节，但没有进数值字段——
  字段不能为了好看写成别的数，这是设计上的诚实代价：读数会随窗口移动，`STALE_PROVENANCE` 因此不可省。
- ~~"任意 cancelled 这一形态没有锁能区分"~~ —— **本 PR 内已闭合**（测试 8b：40.3 的 cancelled 算、30 分的不算）。
  这条最初是当盲区写下的，是 QM-6 前端轴 F3① 把我逼到去看那一行的：它指出文档写"±0.5"而代码是单边。
  **代码是对的、文档是错的**，所以修法是把文档改成单边口径 + 补一条双向锁，而不是把代码改成绝对值（那会漏掉"杀在天花板之上几十秒"这一最常见形态）。
  仍留下的残余：GitHub API 不返回取消**原因**，我们只能按时长 proximity 推断 ⇒ 一趟在 39.9 分被**人工取消**的 run 会被算成截尾。
- `censored_at_ceiling` 绑的是**采样窗口内生效的那条天花板**（现在是 40），所以 stdout 明确写着"绑 40 分那条天花板，非当前值"。
  这带来一个当前无法消除的空档：**60 这条新天花板还没有任何数据**（本 PR 未合并，窗口里没有跑在 60 下的趟），
  因此"60 够不够"现在只有 ×1.5 规则这一个依据，没有被截尾证据反向确认过。第一次能回答它的时间点是合并后攒够 20 趟成功样本 + 一次 `--limit=60` 复测。
- 仓库里现在有**四个"=20"**（本片 `MIN_SAMPLES`，`gate-budget.js` 的 `MIN_SAMPLE_GATE4_SUCCESS` 与 `MIN_SAMPLE_CURRENT_FORM`，以及别处一个）。
  四者同值不同事（分母是不同的池），QM-6 前端轴提醒这会把下一个维护者引向"随手统一"的错误合并 —— 这里**显式不许统一**。
- 其余 9 个 `timeout-minutes` 字面量（5 / 15 / 20 / 55）仍是无对账的裸常量。本片只把**已被现场证明丢过证据**的那一格纳入治理；
  把它们一次性收进同一张表是更大的改动（要逐作业采集），按"先修有证据的"排序留作后续。
- 抬到 60 的代价写在明处：该作业的**最坏耗时上界**从 40 变 60 分钟，PR 侧排队时长随之变长。
  这是"证据完整"与"合入延迟"的交换，由用户 2026-10-18 授权（原话「要动」）。
