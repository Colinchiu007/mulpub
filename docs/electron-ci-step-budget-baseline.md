# Electron CI 串行单测步骤的预算基线

> 建立于 2026-09-28，起因：PR #2525（修 #2458）合并后第一次 main push 的真实运行数据，
> 与 #2458 登记时引用的数字**不是同一个量纲**。本文是该步骤预算的唯一事实源。

## 两个层级的数字，不能混用

| 层级 | 数字 | 来源 |
| --- | --- | --- |
| **步骤级**（`timeout(1)` 实际约束的对象） | **1678 s / 1759 s**（两次成功运行） | 2026-10-21 main push：`2a63373d3` 的自证行 `[electron-ci-timeout-budget] elapsed=1759s budget=2100s rc=0`、`760826d19` 的 `elapsed=1678s budget=2100s rc=0`。⚠️ 这两个数**取代**了下面那条 2026-09-28 的 794 s —— 套件这一个月长了不少，794 s 已严重过时（用它算余量会得出"还有 33% 余量"的假结论） |
| **步骤级**（负载下的红） | **≥ 2100 s**（两次撞墙） | 2026-10-21 main push：`617e4bf69` 与 `e8799536c`（本次 PR #4163 的合并 SHA）都是 `elapsed=2100s budget=2100s rc=124` + `TIMEOUT_BUDGET_EXCEEDED` + **零** vitest 摘要行（整轮没跑完，不是断言失败） |
| **job 级**（含两次 install、checkout、冒烟等） | 18m44s – 21m32s（2026-09-28 口径，已随套件增长过时） | #2458 登记时从 `gh run list` 读到的 job 总时长 |

被替换掉的旧墙 `--kill-after=30s 20m` = **1200 s**，约束的是**步骤**。

## 由此得出的两个结论

1. **#2458 原文里"自然耗时已贴着 20m 墙、余量只剩约 1 分钟"这句话混用了层级。** 步骤自身健康耗时 794 s，对 1200 s 的墙本来还有约 400 s（≈33%）余量；真正把它推过墙的是 runner 负载放大，不是"套件自然时长已≈墙"。所以该 issue 的**根因描述需要修正**为：*余量在负载下不够 + 超时不可归因*，而不是*预算已被自然时长吃光*。
   **2026-10-21 更正（按新实测）**：健康耗时已从 794 s 长到 **1678–1759 s**，而墙仍是 2100 s ⇒ 余量只剩 **19%–25%**。也就是说，"余量不够"这件事在今天比 2026-09-28 严重得多：红灯不是偶发，是**常态**（main 近 12 次 `Electron CI` 6 红，且与代码无关）。
2. **预算取值仍然成立，但依据要换成步骤级。** 现值 `BUDGET_SECONDS=2100` 相当于健康步骤耗时的 **1.19–1.25 倍**（2026-09-28 时是 2.64 倍）—— 也就是说，**这个墙今天已经贴着健康耗时了**，"抬预算"这条路走到头了：再抬只是把不可归因的超时往后推。结构锁因此改为对这两个关系断言，不再拿 job 级总时长当步骤级基线（那会把一个偏大的数当"实测上界"，让锁比实际需要更松）。

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

## 2026-10-20：档 2 落地（shard 三片），并更正档 3 的「已实现」

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

> ⚠️ **2026-10-21 更正（本段原文有一半是错的）**：原文写「`electron-tests` **不在**分支保护的
> required checks 里（取证：`branches/main/protection` 只有 4 个 context）…因此 matrix 产生的
> `electron-tests (1)`/`(2)`/`(3)` 不会造成『Expected — waiting for status to be reported』」。
> **这半句来自第一次取证只查了 legacy protection API**。真相（2026-10-20 实测 + 2026-10-21 复核）：
> 拦人的是 **ruleset** `main-ci-gate`（id 23749994，enforcement=active），它的 required contexts 里
> **有** `electron-tests`：
>
> ```
> gh api repos/<owner>/<repo>/rulesets/23749994
>   → QG Static / QG Unit Tests / electron-tests / 文档同步检查
>            债务熔断检查 / 单元测试 + Lint / GUI Gate Result
> ```
>
> 所以 matrix 一旦把作业报成 `electron-tests (1)`，那个 context **永不出现** ⇒
> 无论多少项全绿都判 `base branch policy prohibits the merge`。
> **正解**（2026-10-21 落地）：matrix 作业改 id（`electron-tests-shards`）+ 一个 id 与 name 都叫
> `electron-tests` 的**非 matrix** 汇入作业，把聚合结果按 required 名报出去。
> 本变更**不改**分支保护规则、不改 `CI_IGNORED_PATHS` 白名单。

