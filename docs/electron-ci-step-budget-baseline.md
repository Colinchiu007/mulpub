# Electron CI 串行单测步骤的预算基线

> 建立于 2026-09-28，起因：PR #2525（修 #2458）合并后第一次 main push 的真实运行数据，
> 与 #2458 登记时引用的数字**不是同一个量纲**。本文是该步骤预算的唯一事实源。

## 两个层级的数字，不能混用

| 层级 | 数字 | 来源 |
| --- | --- | --- |
| **步骤级**（`timeout(1)` 实际约束的对象） | **794 s**（13m14s） | run `36380533567` / job `108795205438`（main push `bef5fb72`，2026-09-28 05:08:39 → 05:21:53）。日志自证行：`[electron-ci-timeout-budget] elapsed=794s budget=2100s rc=0`，同轮 `Test Files 674 passed \| 3 skipped` |
| **job 级**（含两次 install、checkout、冒烟等） | 18m44s – 21m32s | #2458 登记时从 `gh run list` 读到的 job 总时长 |

被替换掉的旧墙 `--kill-after=30s 20m` = **1200 s**，约束的是**步骤**。

## 由此得出的两个结论

1. **#2458 原文里"自然耗时已贴着 20m 墙、余量只剩约 1 分钟"这句话混用了层级。** 步骤自身健康耗时 794 s，对 1200 s 的墙本来还有约 400 s（≈33%）余量；真正把它推过墙的是 runner 负载放大，不是"套件自然时长已≈墙"。所以该 issue 的**根因描述需要修正**为：*余量在负载下不够 + 超时不可归因*，而不是*预算已被自然时长吃光*。
2. **预算取值仍然成立，但依据要换成步骤级。** 现值 `BUDGET_SECONDS=2100` 相当于健康步骤耗时的 **2.64 倍**、被替换旧墙的 **1.75 倍**。结构锁因此改为对这两个关系断言，不再拿 job 级总时长当步骤级基线（那会把一个偏大的数当"实测上界"，让锁比实际需要更松）。

## 记录在案的一处遗留不精确

`CHANGELOG.md` 里 #2525 那条写的是「自然耗时实测 18m44s~21m32s」，这是 job 级数字。
本文**取代**该表述作为预算依据；不回头改写那条历史记录（它是当时的真实观测，只是层级被误标）。

## 结构锁位置与反向要求

- 锁：`apps/desktop/tests/gui-ci-exit-contract.test.js` → 用例
  「Electron CI 串行单测预算挂实测、超时可自证、且不与 job 级倒挂」。
- 任何后续调预算都要**先补一次步骤级实测**（从 runner 日志读 `elapsed=` 行，而不是看 job 总时长），
  再改锁里的常量；只改 workflow 不改锁 = 锁失效。
- 真失败判据仍要求 `exit 124` 时能自证（`elapsed/budget/rc` + 摘要行数），见 #2458 档 3。
  ⚠️ **2026-10-20 更正：这一条此前写着「已实现」，是错的 —— 见下面「自证其实从未执行过」。**
- #2458 未做的两档继续挂在该 issue 上：~~档 2 用 `--shard` 切开这一轮（根因，已于 2026-10-20 落地，见下）~~、
  档 4 让 `CI Failure Handler` 把「`exit 124` 且无摘要行」归类为 `ci-timeout-budget`（仍未做）。

---

## 2026-10-20：档 2 **未落地**（shard 三片尝试了三轮均失败），并更正档 3 的「已实现」

### 自证其实从未执行过

`electron-ci.yml` 里 `timeout … | tee "$LOG"` 之后跟着 `RC=${PIPESTATUS[0]}` 与整段
`TIMEOUT_BUDGET_EXCEEDED` 诊断。但该 job 的 shell 是 `bash -e -o pipefail`：
`timeout` 返回 124 时 `-e` **立刻退出步骤**，其后每一行都不执行。

实测证据（2026-10-19，`4832662e9` 的两次 attempt，以及**不是本仓 PR 内容**的 `715391c88`）：

| 现象 | 读数 |
| --- | --- |
| 步骤结局 | `##[error]Process completed with exit code 124` |
| 自证行 `[electron-ci-timeout-budget] elapsed=… rc=…` | **不存在** |
| `×` 失败用例 / `FAIL` 行 / vitest 摘要行 | **各 0 条**（整轮没跑完） |

也就是说 #2525 的标题「让超时失败能自证」**从未兑现过一次**：它专门为之设计的场景，
恰恰是它唯一不出现的场景。旧结构锁只断言那四行**字符串存在于 YAML**，
而被测性质是**运行时执行路径**——判据域错位，于是锁一直是绿的。

修法：`set +e` / `set -e` 包住管道（与本文件同一 `run:` 块里的 Electron 冒烟步骤同形）。
锁改成**真执行**：取 `run` 原文，在 `bash -e -o pipefail` 下跑一遍（预算压到 1s、
内层命令换成必超时的 `sleep`），断言自证行真的打印。摘掉 `set +e` 后该锁立刻变红
（已做变异反证），故它测的是行为而不是文本。

> ⚠️ **2026-10-20 收尾修正：本节是当时的计划，未落地。** 分片被 ruleset
> `main-ci-gate` 的 required context `electron-tests` 与 matrix 后缀名冲突卡住，三轮尝试的现场
> 见 `openspec/records/electron-ci-shard.md` §九。当前 `BUDGET_SECONDS` 仍是 **2100**（整轮），
> 本轮只落地了「接通自证块」。

### 分片：单片基线而非整轮基线

| 项 | 值 |
| --- | --- |
| 分片数 | 3（`strategy.matrix.shard: [1,2,3]`，`--shard=<i>/<total>`） |
| 单片健康耗时 | ≈ 794 / 3 ≈ **265 s** |
| 单片预算 | `BUDGET_SECONDS=900` ≈ 单片健康 ×3.4，且**严格低于**被替换的 1200 s 旧墙 |
| 不变式 | `--maxWorkers=1 --no-file-parallelism` 保留 ⇒ 确定性语义与「main 侧第二次独立运行」的 flake 检出原意都不丢 |

**为什么这不是「抬预算」的包装**：单片墙 900 s **比被替换的旧墙 1200 s 更矮**。
抬预算的判据是数字变大，分片的判据是「每片工作量降到 1/N 且单片墙变小」——
结构锁里的 `expect(budgetSeconds).toBeLessThan(20 * 60)` 就是这条反向判据。

**由此得出的换算规则**：整轮的 794 s 不能直接拿来卡单片预算。用整轮基线卡单片会得出
「必须 ≥1588 s」这种把分片收益又吐回去的结论。**要卡单片，就先把基线按片摊薄。**

### matrix 与 required context（含我第一次取证取错的更正）

`electron-tests` **就是** required context —— 但 gate 挂在 **ruleset** 上，不在 legacy protection API 上。

这是本轮我犯的一个实质错误，必须留证：我最初只查了
`gh api repos/<owner>/<repo>/branches/main/protection`，它返回 `required_status_checks.contexts`
只有 4 条（`Gate Result` / `build` / `QG Unit Tests` / `QG Coverage`），于是我写下「matrix 不会破坏
分支保护」。**该结论是错的**：真正的 gate 在 `gh api repos/<owner>/<repo>/rulesets` 里 ——
ruleset `main-ci-gate`（id 23749994，enforcement=active）要求的 context 是：

```
QG Static / QG Unit Tests / electron-tests / 文档同步检查
债务熔断检查 / 单元测试 + Lint / GUI Gate Result
```

matrix 会把作业报成 `electron-tests (1)` / `(2)` / `(3)`，**`electron-tests` 这个 context 于是永远
不会出现** ⇒ 22 项全绿的 PR 依然被判 `base branch policy prohibits the merge`（2026-10-20 实测）。

修法：加一个汇入作业 `electron-tests-summary`，`name: electron-tests`、`needs: [electron-tests]`、
`if: always()`，把 matrix 的聚合结果按 required 名报出去（任一片失败即失败；docs-only 短路时是
`skipped`，按本仓既有约定放行）。结构锁同时钉住：汇入作业不得被删、名字不得改、
matrix 作业自己不得叫同一个名字。

**教训**：取证要看**所有**承载 gate 的机制。GitHub 有两套并存的分支保护面
（legacy protection + rulesets），只查一套就得出「不受约束」的结论，是「查到第一个空结果就收工」。
`electron-tests` **不在分支保护的 required checks 里**（取证：

```
gh api repos/<owner>/<repo>/branches/main/protection
  → required_status_checks.contexts = ["Gate Result", "build", "QG Unit Tests", "QG Coverage"]
```

）。因此 matrix 产生的 `electron-tests (1)`/`(2)`/`(3)` 不会造成
「Expected — waiting for status to be reported」。本变更不改分支保护规则、
不改 `CI_IGNORED_PATHS` 白名单。

## 2026-10-20（第二轮）：按重测长尾把墙从 35m 重挂到 70m —— 这是退守，不是根因修法

### 为什么墙必须重挂：健康长尾已经顶到墙底下

2026-09-28 定 2100s 时，依据的健康耗时是 **794s（单样本）**，当时 794s 对 1200s 旧墙还有约 33% 余量。
到 2026-10-20 重测，取最近 **23 次成功运行**（electron-ci on main，branch=main event=push，2026-10-19~10-20）
的单测步骤耗时：

| 统计 | 值 |
| --- | --- |
| 最小 | 1282s |
| 中位 | 1692s |
| 均值 | 1639s |
| **长尾（最大）** | **2094s** |

**关键读数：最慢的那次成功已经是 2094s，而墙是 2100s —— 只剩 6 秒余量。**

这解释了超时为何从「偶尔」变成「常态」：不是 runner 突然变差，是**健康长尾长到了墙底下**，
稍微抖一下就翻过去。近 74 次失败里 **45 次是撞墙（61%）**，且这些运行连 vitest 摘要行都没有，
因为跑到一半被 `timeout` 杀掉、缓冲区没刷出来。

### 新值与它的依据

| 项 | 旧 | 新 | 依据 |
| --- | --- | --- | --- |
| 步骤预算 `BUDGET_SECONDS` | 2100s（35m） | **4200s（70m）** | 长尾 2094s × 2.006，沿用「≥ 实测 ×2」档 |
| job `timeout-minutes` | 70 | **95** | 必须 > 其余步骤上限之和(20) + 4200/60(70) = 90 |

注意**口径换了对象**：老注释的 ×2.6 乘的是 794s 那个**单样本**；这里乘的是**窗口长尾**，更保守。
锁里的 `measuredStepElapsedSeconds` 也从 794 同步为 **2094**（长尾），并写明了样本与出处 ——
**实测基线必须定期重测**，否则「挂实测」会退化成「挂一个三年前的数字」。

### 抬墙的两个理由，以及为什么它仍然不是「修好了」

1. **让被超时埋掉的真失败浮出来。** 近 74 次失败里 **21 次是真测试失败**（有 `Test Files N failed`，
   失败用例 1/9/10 个），抓的是 `windows-file-lock`（真跑一次，仅 Windows）与 **9 个 preload 产物对账**
   用例 —— 正是 PR 侧分 2 片并行时最容易漏掉的那类。而 45 次超时把这类真失败盖住了：红是常态，
   没人能分辨「真失败」和「又超时」。
2. **成本其实下降。** 现在撞墙是耗满 35 分钟后判失败（白烧）；抬墙后中位数仍是约 28 分钟，
   只有长尾才会跑到 70 分钟。

**但它不是根因修法。** 根因仍是把这一轮按 `--shard` 切开（issue 档 2）。分片当前被两件事挡住：
① matrix 会让 check 名带 `(1)` 后缀，而 ruleset `main-ci-gate` 要的是不带后缀的 `electron-tests`；
② 结构性锁按 job 名断言「单测必须在 `electron-tests` 里」，任何把单测搬出去的方案都会红那两条。
所以本轮抬墙登记为**退守**：有实测依据、单调放宽（不会让任何原本通过的运行变红）、并且明确知道
套件再长还得再量一次。
