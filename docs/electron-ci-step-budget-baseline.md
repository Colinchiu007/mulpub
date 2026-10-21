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
  > **2026-10-21 状态**：档 2 已落地，但落地形状是「同一步内两片并行」而不是 2026-10-20 那节设想的
  > matrix + 汇入作业（见文末新节）；档 4 仍未做。

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
>
> ⚠️ **2026-10-21 再更新（本行只作导航，不改写上面那段当时的事实）**：分片已用**另一种形状**落地
> ——同一步内两片并行、不用 matrix；步骤预算 2100 → **2700**。全文见文末「2026-10-21」节。

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

---

## 2026-10-21：分片以「同一步内两片并行」落地，取代上文 2026-10-20 那节的两条结论

上面那节（含其 ⚠ 收尾修正）在本节之前都是最新的；现在它有两句话过期，逐条标明：

| 过期陈述（2026-10-20） | 现状（2026-10-21 实测） |
| --- | --- |
| 「分片被 required context 卡住，本轮只落地接通自证块，`BUDGET_SECONDS` 仍是 2100（整轮）」 | **分片已落地**，但**不用 matrix**：`node scripts/electron-ci-desktop-step.js` 在**同一个作业内**并起两片 `--shard=1/2`、`--shard=2/2`，作业名仍是 `electron-tests` ⇒ required context 一个字都不用改，那条阻塞前提被绕开而不是被解决 |
| 「自证块已改成 `set +e` 包住管道，锁改成真执行」 | 自证块**从 bash 移进脚本**：`rc=124` / `TIMEOUT_BUDGET_EXCEEDED` / 逐片计数由 `runStep` 产出，workflow 那一步只剩一行 `node …`。真执行锁同步迁移（`gui-ci-exit-contract.test.js` 起真 Git Bash 跑桩） |

### 这一轮现取的读数（复测入口 `node scripts/electron-ci-shard-audit.js`）

| 项 | 读数 | 取证方式 |
| --- | --- | --- |
| `electron-ci` push 窗口 | 最近 12 趟：success=4、nonSuccess=8 | `gh run list --workflow=electron-ci.yml --event=push --limit=12` |
| 8 趟非绿的**归因** | **8/8 都是预算墙**（`rc=124`×1、`TIMEOUT_BUDGET_EXCEEDED`×2、断言红=0） | 逐趟 `gh api …/actions/jobs/<id>/logs --allow-escape-sequences` 后剥时间戳与 ANSI 再计数 |
| 红趟作业墙钟 | 2177–2215s | 作业自己的 `started_at/completed_at` |
| 成功趟作业墙钟 | 1511 / 1542 / 1820 / 1934s | 同上 |
| 旧计数器报的「已完成测试行数: 0」 | **是失明不是事实**：同一批红趟按修好的锚重读得 `✓×行=18156–18929、摘要=0` | 锚必须**先剥 Actions 时间戳**再剥 ANSI（`^[[:space:]]+[✓…]` 对行首是 `033[32m✓` 的真实行恒不命中） |
| 单片耗时基线 | `QG Desktop Shards` 7 趟 14 片：min 11.2 / p50 18.6 / **max 23.2** min | 同上（只取 `conclusion=success`） |

### 预算为什么同时改形状和数字（2100 → 2700）

`max(单片) × 1.5 = 2091s` 对旧墙 2100s 只剩 **9 秒**。而那批样本的测量形状是
**每片独占一个 runner**，本步是**同一个 runner 跑两片** ⇒ 争用倍数未测。
按本仓口径，贴脸（HUGGING）是**事前证据**，正解是"先量再定数"，不是接受零余量、
更不是放宽那条 `≥ max × 倍数` 的断言。取 `2700s ≈ max × 1.94`：

- 给同-runner 争用留约一倍空间；
- 仍是**单调放宽**，不会让任何原本通过的运行变红；
- 不与 job 级 `timeout-minutes: 70` 倒挂 —— 本 job 其余带步骤级 timeout 的步骤合计 20 min，
  `20 + 45 = 65 < 70`（这条由 `gui-ci-exit-contract.test.js` 的「不倒挂」断言逐步骤实算，不写死）。

第一次真跑后必须按脚本打印的逐片 `elapsed=` 重定数；`electron-ci-shard-audit.js` 的
`verdict` 有 **NO_SAMPLES / BELOW_FLOOR / HUGGING / OK** 四档，其中零样本与自身故障都以
非零码出声（把"没量到"读成"预算没问题"是本仓反复出现的同型事故）。

### 一条反失明判据当场拦住了一次改动（不是事后追认）

`workflow-contract.test.js` 的「消费者覆盖面下界 3」在本次改动的**中途**真实报红：
`["quality-gate.yml:desktop-shards","quality-gate.yml:coverage"]`（2 < 3）。根因是委托判据取
**第一个** `node scripts/*.js` 命中，而我在同一步的注释里写了「复测入口
node scripts/electron-ci-shard-audit.js」——那行注释把真正的委托挡在前面，
`electron-tests` 于是整片从覆盖面消失，而"少一个消费者"与"全部合规"逐字同形。
正解不是改注释措辞，而是把判据改成扫**全部**候选并按语义判定，同时补两类对照：
注释遮挡形态必须仍判 true、只有那个不跑桌面全量的脚本必须判 false
（否则上一条 true 是同义反复）。这与 `check-unwired-tests.js` 的"按可执行正文匹配"是同一族纪律。

