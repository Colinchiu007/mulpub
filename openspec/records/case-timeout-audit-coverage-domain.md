---
record: case-timeout-audit-coverage-domain
task: 把 CLI e2e 用例预算复测入口的采样域从"单 workflow × 单作业族"升级成 (workflow × 作业名) 生产者登记表，覆盖度逐轴判
date: 2026-10-20
---

## 本次执行记录：采样域的两根轴（case-timeout-audit-coverage-domain，2026-10-20）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | PASS | 混合 PR（改 CI 复测脚本本体 `scripts/case-timeout-audit.js` + 其锁 `apps/desktop/tests/gui-ci-exit-contract.test.js` + 预算模块 `apps/desktop/tests/gui-cli-e2e-budget.js`）⇒ 隔离 worktree `<仓库父目录>/mp-worktrees/mp-case-timeout-audit-coverage-domain`、裸分支 `case-timeout-audit-coverage-domain`（`git rev-parse --abbrev-ref HEAD` 实证），基线 = `origin/main` 的 `f1be2639e`（即 PR #4072 的合并提交）；依赖就绪经 `node scripts/verify-worktree-deps.js` ⇒ `消费方解析通过 11 项 / OK` |
| 第一性原因（QM-5 ①） | PASS | 域被写成**两个单数常量各持一根轴**：`WORKFLOW = 'quality-gate.yml'` + `JOB_RE = /QG Desktop Shards/`。这不只是"少了一个作业族"（#4072 修过的那根轴），而是**第二根轴在代码里不可表示**——没有任何数据结构能回答"还有别的 workflow 在跑这条用例吗"。当场取证（逐份作业日志按**目标用例全名** `CLI 端到端：真 git 仓库里文档改动判否、桌面改动判是，取证失败必须 rc=1 且不写产出` 过滤 verbose 行）：run `39381404956`（quality-gate）`QG Coverage` 1 条 = **1705ms**、`Shards (1/2)` 1 条 = 1261ms、`Shards (2/2)` 0 条；run `39394756637`（**另一个 workflow**）`electron-ci.yml / electron-tests` 1 条 = **1331ms**、同 run 的 `Changes` 作业 0 条 ⇒ 旧域两条都不认 |
| 逃逸分析（QM-5 ②） | PASS | ① **既有锁全部测的是"解析与出处"，没有一条测"域"**：`gui-ci-exit-contract.test.js` 有 stripAnsi 三形态、harvest 单一实现、parseArgs 严格校验、judgeDrift 四方向、coverageSufficient 三值——全是"采到之后对不对"，没有"从哪儿采"。归类 测试场景缺失；② **零样本出口挡不住"少采"**：旧域照样每条 run 采到 1 条、打印 `OK: 预算余量成立（headroom=36×）`，缺陷自洽；归类 断言不精确；③ **#4072 当时把它记成「未判定」而不是修掉**，所以缺陷又多活了一次合并——这暴露一条流程漏洞：**取证成本极低（一次日志 grep）的遗留，应该当场做完取证**，否则"遗留"会变成一条没人再跑的判据。本轮由我在 #68 收尾时补做，取证为"是"。归类 流程缺失 |
| 系统性漏洞定位（QM-5 ③） | PASS | 落点不是"JOB_RE 少一族"，而是**"域"没有一个能同时表达两根轴的数据结构**。单数常量的形状决定了它只能各表一维，任何按维度的收敛（补一个作业名、补一个 workflow）都会留下另一维无人问；因此正解是 `PRODUCERS` 登记表（每项 = workflow × jobRe）+ 纯判据 `isProducer(workflow, jobName)` + **覆盖度逐轴判**（合并 run 总数会让稀少那条轴静默采不满） |
| 修复 + 回归保护（QM-5 ④） | PASS | 修复：① `PRODUCERS` 三条显式登记（Shards 族 / Coverage / electron-ci × electron-tests），每条在注释里带当场读数与 run 号；② `isProducer / producerWorkflows / pickProducerJobs` 三个纯函数（A/B 负控直接打在纯判据上，无需网络）；③ `listRuns(workflow, wanted, errors)` 改为按 workflow 各列一份窗口，`collect` 循环 `producerWorkflows()`；④ 覆盖度 `coverageSufficient` 挪进循环体，产出 `shortWorkflows`，`main` 的 PARTIAL 出口逐轴点名缺口；⑤ 删掉两个单数常量（含导出键 `JOB_RE`），⑥ 出处 `source` 写明"现存 max=12744 是旧域量 ⇒ **下界**、扩域后样本量按轴倍增、重测须整份粘回、更低值不构成收紧理由"。回归锁 46 条（起点 44）：A 臂三生产者命中（含 **`(2/2)` 也必须命中**——该用例落哪片由 vitest `--shard` 决定，按今天落在哪片来排除会在重分片后静默丢样）/ B 臂作业名轴 5 个不命中 + `electron-ci.yml × Changes` 不命中 / B 臂 **workflow 轴**（同名作业挂在未登记 workflow 上不命中）/ `producerWorkflows()` 必须**恰好等于**两条（防"扫所有 workflow"）/ `pickProducerJobs` 对合成作业表只挑 completed 的生产者 / 反向锁两个单数常量不得回来 / 正向锚"循环取域并喂进 listRuns"且 `listRuns(` 后不得跟字面量 / 覆盖度判据必须落在循环体内。TDD：先红 `2 failed \| 44 passed`（红因 = `PRODUCERS` 缺席、`source` 未点名生产者）⇒ 实现后 `46 passed` |
| 防止再次发生（QM-5 ⑤） | PASS | ① **把"只扩一根轴"变成会红的动作**：workflow 轴的 B 臂负控 + `producerWorkflows()` 精确等于 + 反向单数常量锁（K1/K2/K4 各测一格，均实测指名红）；② **把"按今天落在哪片来排除"这颗雷提前拆掉**：`(2/2)` 命中是**显式断言**（K5 实测红），注释写明 shard 分配不是稳定属性；③ **覆盖度按轴判**有行为锚（K6 实测红——把判据搬到循环外比较合并总数即红，不是靠"变量没出现过"）；④ 现场端到端可复现：`node scripts/case-timeout-audit.js --runs=1` 实跑 ⇒ `wf=electron-ci.yml … hits=1 max=1331` + 两条 `wf=quality-gate.yml … max=1525/1632`，`runs=2 jobs=3 samples=3 max=1632 drift=OK_BELOW_RECORD` 且 rc=0；**同一窗口旧域只会有 1 条样本**，这就是"少采不会触发任何出口"的现场对照；⑤ 同源复述同步：脚本头新增第 8 条坑「域有两根轴，只扩一根会伪装成已修完」+ verbose reporter 那条补上 electron-ci 也实测打该行 + 成本口径（3 生产者 × 2 workflow ⇒ `--runs=8` 最多 32 份日志，这是它不进 CI 的第二条理由）、预算模块新增口径 ③；⑥ 教训落内置记忆 / 外部记忆（本文件）/ EverOS |
| 行尾与 diff 对账 | PASS | 三个被改文件 `git ls-files --eol` 均 `i/lf w/crlf attr=text=auto`，工作副本实测纯 CRLF（`case-timeout-audit.js` / `gui-cli-e2e-budget.js` / `gui-ci-exit-contract.test.js` 各自 CR==LF，lone CR 0、NUL 0）；新增行一律带 `\r`（Edit 按文件既有 EOL 写回），变异驱动最初按 LF 拼锚点会报「锚点未命中」⇒ 驱动按 LF/CRLF 两种形态各试一次（K1/K4/K6 实测走 CRLF 支路、K2/K3/K5 走 LF 支路，两个分支都被真实走到）；`git diff --numstat` 与 `--ignore-cr-at-eol --numstat` 两口径逐字相等；CHANGELOG 置顶插入按"逐行保留原行尾 + 新增行补 `\r`"，并断言旧行多重集零丢失、CR 增量 == LF 增量 == 新增行数 |
| 接线棘轮 | PASS | 本片**不新增测试文件**（锁落在已被 CI 收集的 `apps/desktop/tests/gui-ci-exit-contract.test.js`，vitest include `tests/**/*.test.js` ⇒ `QG Desktop Shards` / `QG Coverage` / `electron-tests` 三处都会跑它），无新点名需求；`node scripts/check-unwired-tests.js --root=.` ⇒ OK、rc=0；`check-workflow-structure` 未动 workflow 正文（files=15 violations=0）；导出面变更（删 `JOB_RE`）先做未截断 `git grep` 清点：消费者只有那份测试文件与脚本自己，实测无人引用 `audit.JOB_RE` |
| QM-1 打包 / QM-4 视觉 | N/A | 未触 `apps/desktop/electron/` 生产代码、`packages/rpa-engine/`、任何 `.vue`/样式/locale；预算取值 `60000ms` 一字未动（改的是"量它的尺"与"从哪儿量"）⇒ 产物与像素判定域无交集 |
| QM-6 CCG 双模型外部评审 | 自演，非外部模型 | 按用户指定「QM-6 你自己来模拟外部评审」执行：以 QM-6 两轴标准逐条自审实现 diff，结论与处置见下节。**如实标注：这不是外部模型产出，不得当作双模型证据登记**；机械链上 CCG 未安装（pre-commit 打印「未找到 CCG（run_skill.js），已跳过」），该闸门对本 PR 无从判红 |
| 远程同步 | 由门禁推导 | 本行**不需要事后改写**：合并后门禁按主干历史推导归属（`scripts/lib/merge-ledger.js`，只认 squash 尾注 `(#NNNN)`）；现场读数看 CI 步骤首行 `MERGE-LEDGER prs=<n>`。合并前这篇文件还不在基线上，判 byDesign 不红；把本行状态列写成 `PASS` 会被判「预写不存在的证据」而红 |

- 保留门禁：变更类型与隔离 ✅ | 行尾对账 ✅ | 品牌残留 ✅（全文无竞品名） | 文档同步 ✅（脚本头 + 预算模块口径与代码同 PR） | 远程同步 由门禁推导

## 1. 现场取证与对照

**A 臂 · 三个生产者的当场读数**（按目标用例全名过滤，不是按文件全体行取 max）

| workflow | 作业 | 该用例耗时行 | 值 | 在旧域里？ |
|---|---|---|---|---|
| quality-gate.yml | `QG Desktop Shards (1/2)` | 1 | 1261 ms | ✅ |
| quality-gate.yml | `QG Desktop Shards (2/2)` | **0**（shard 分配漂移） | — | ✅（且必须继续留在域内） |
| quality-gate.yml | `QG Coverage` | 1 | **1705 ms** | ❌ |
| **electron-ci.yml** | `electron-tests` | 1 | **1331 ms** | ❌（另一根轴） |
| electron-ci.yml | `Changes` | 0 | — | B 臂负控 |

**B 臂 · 扩域后的端到端实跑**（`node scripts/case-timeout-audit.js --runs=1`）

```
[case-timeout-audit] wf=electron-ci.yml run=39394756637 job=118535919574 hits=1 max=1331 total=1
[case-timeout-audit] wf=quality-gate.yml run=39387149889 job=118510922707 hits=1 max=1525 total=2
[case-timeout-audit] wf=quality-gate.yml run=39387149889 job=118510922774 hits=1 max=1632 total=3
[case-timeout-audit] pages=2 runs=2 jobs=3 samples=3 p50=1525ms max=1632ms errors=1
OK: 预算余量成立（headroom=36.76×，drift=OK_BELOW_RECORD）
```

⇒ 同一窗口旧域只会有 **1 条**样本；`errors=1` 是 `Shards (2/2)` 那趟 0 命中的留痕（不是静默跳过）。
`drift=OK_BELOW_RECORD` 且 **没有**据此把 `maxObservedMs=12744` 改小——那是那条不对称纪律的现场兑现。

**一条必须记下的自我纠正**：最初我报的 1705/1261 是对该文件**全部** 43 条 verbose 行取 max；重新按目标用例全名过滤后确认这两个数**恰好就是**该用例自己的耗时（它是该文件最慢一条）。结论未变，但"用全体取 max 冒充单用例"这个推导过程是错的——判据一律按名字过滤后再取。

## 2. 变异反证 K1–K6（控制跑 `rc=0 passed=46 failed=0`）

| 编号 | 变异（取被禁形态本身） | 红在哪条锁 | 指名 | 还原 |
|---|---|---|---|---|
| K1 | `PRODUCERS` 退回只有一条 Shards（缺陷原始形态） | A 臂 | ✅ | byte-equal |
| K2 | `isProducer` 抹平 workflow 轴（只按作业名） | workflow 轴 B 臂 + `producerWorkflows()` 精确等于 | ✅ | byte-equal |
| K3 | `jobRe` 写成 `/./*/`（"扫所有作业"那个更省事写法） | B 臂作业名轴 | ✅ | byte-equal |
| K4 | `collect` 的循环写死成 `['quality-gate.yml']` | 正向锚 + `listRuns(` 字面量负锚 | ✅ | byte-equal |
| K5 | 把 `(2/2)` 按"今天不产出"排除 | shard 漂移那条 A 臂断言 | ✅ | byte-equal |
| K6 | 覆盖度判据搬到循环外（比较合并总数） | 循环体内锚 | ✅ | byte-equal |

红集互不相同（六条各测一格，`failedN=1` 全部只红在指名锁上）。

**实现选择反过来纠正了我自己写的一条结构锁**：正向锚最初按我设想的写法 `for (const p of PRODUCERS) … listRuns(p.workflow` 锚，而实现选了"按 workflow 去重分组"（同一 workflow 的两个生产者不该把 run 窗口列两遍）⇒ 锚点未命中。处置是**改锚点的形状**（不锁变量名，锁"循环取域 + 把域喂进 listRuns"这条可执行链，并另加一条 `listRuns(` 后不得跟字面量的负锚），**不是放宽判据**：K4 把循环写死成单 workflow 后新锚照样红。这条锁抓不到什么写在上面第 ⑤ 条里。

## 3. QM-6 自演双轴发现与处置

| 编号 | 轴 | 级别 | 发现 | 处置 |
|---|---|---|---|---|
| S1 | 后端 | MAJOR | `producerWorkflows()` 若只判"非空"，把登记表改成"扫所有 workflow"照样绿，而样本来源将无法归因 | 已锁 `toEqual(['electron-ci.yml','quality-gate.yml'])` 精确等于（K2/K4 实测红），并在 B 臂加"同名作业挂错 workflow 必须不命中" |
| S2 | 后端 | MAJOR | 覆盖度合并计数会让"electron-ci 那条轴一条都没采到"读成"总共 8 个 run，够了" | 已改为逐轴判 + `shortWorkflows` 点名缺口，行为锚在循环体内（K6 实测红） |
| S3 | 前端 | MINOR | `(2/2)` 本次 0 命中，容易被"顺手精确化"排除掉 | 显式断言它必须命中，注释给出理由（shard 分配不稳定）；K5 实测红 |
| S4 | 前端 | MINOR | `isProducer` 三个纯函数若只被测试调用、没被 `collect` 用，就是"注册≠注入"同族 | 加正向锚 `for (const … of producerWorkflows()) … listRuns(` 并用 `--runs=1` 端到端实跑证明链路真的在动 |
| S5 | 维护 | INFO | 出处文案只说"脚本扫两档"，读不出第二根轴存在 | `source` 重写：点名三个生产者 + "现存是旧域读数 ⇒ 下界" + 扩域后须整份重测粘回 + 不对称纪律 |

## 4. 遗留（不假装已闭合）

1. **provenance 数字未回填**（刻意）：扩域后需要一整窗重测 `node scripts/case-timeout-audit.js --runs=8 --json`（约 32 份作业日志、十分钟级），把输出整份粘回 `GUI_CLI_E2E_BUDGET_PROVENANCE`。本轮只有一次 `--runs=1` 的小窗（max=1632），它**不足以**替代 8-run 窗口，也不构成收紧理由；现存 `maxObservedMs=12744` 仍是左删失下限 + 旧域下界的双重标记。
2. **`lock-timing-audit.js` 的 workflow 轴仍未扩**（#4072 执行记录 §4 第 3 条）：本片只把 `case-timeout-audit.js` 的两根轴做完整。两处现在一份修法、一份待办，先例已建立（`PRODUCERS` + `isProducer` + 逐轴覆盖度），照搬即可，但要注意两个脚本的取数对象不同（握手行 vs verbose 行），不能直接共享同一份登记表。
3. **`event === 'push'` 过滤使 `workflow_dispatch` 手跑不进入样本**：这是有意的（手工触发的负载面不可比），但意味着 main push 稀疏时 electron-ci 那条轴更容易 PARTIAL——`shortWorkflows` 正是为此存在。
4. QM-6 是自演（用户指定），**不构成**双模型外部评审证据；CCG 未安装 ⇒ 机械闸门对本 PR 无从判红（AGENTS「残留风险」一节已记录，未闭合）。
5. 三条等人工的项未动：`~/.local/bin/env` 缺 `exec "$@"`、共享根那个游离空目录、把 `scripts/doc-abs-paths-baseline.json` 加进 `CI_IGNORED_PATHS`（属"改谁来守门"）。
